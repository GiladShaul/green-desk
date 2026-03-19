import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { query } from '../db';
import { stateStore } from './state-store';
import { buildOidcAuthUrl, exchangeOidcCode } from './oidc';
import { buildSamlAuthUrl, validateSamlResponse } from './saml';
import { findOrProvisionUser } from './provisioning';

const router = Router();

function signToken(userId: string, role: string, tenantId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ sub: userId, role, tenantId }, secret, { expiresIn } as import('jsonwebtoken').SignOptions);
}

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173';
}

function callbackUrl(req: Request, connectionId: string): string {
  const base = process.env.API_BASE_URL
    ?? `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/sso/${connectionId}/callback`;
}

interface SsoConnectionRow {
  id: string;
  provider_type: 'oidc' | 'saml';
  config: Record<string, unknown>;
  enabled: boolean;
  name: string;
  tenant_id: string;
}

async function loadConnection(connectionId: string): Promise<SsoConnectionRow | null> {
  const result = await query<SsoConnectionRow>(
    `SELECT id, provider_type, config, enabled, name, tenant_id
     FROM sso_connections WHERE id = $1`,
    [connectionId],
  );
  return result.rows[0] ?? null;
}

// GET /api/auth/sso/connections — public: list enabled connections for login page
router.get('/connections', async (_req: Request, res: Response): Promise<void> => {
  const result = await query<{ id: string; name: string; provider_type: string }>(
    `SELECT id, name, provider_type FROM sso_connections WHERE enabled = true ORDER BY name`,
  );
  res.json(result.rows);
});

// GET /api/auth/sso/:connectionId/login — redirect to IdP
router.get('/:connectionId/login', async (req: Request, res: Response): Promise<void> => {
  const connection = await loadConnection(req.params.connectionId);
  if (!connection || !connection.enabled) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  try {
    const cbUrl = callbackUrl(req, connection.id);
    if (connection.provider_type === 'oidc') {
      const { authUrl, state, codeVerifier } = await buildOidcAuthUrl(connection, cbUrl);
      stateStore.set(state, { connectionId: connection.id, codeVerifier, createdAt: Date.now() });
      res.redirect(authUrl);
    } else {
      const relayState = randomUUID();
      stateStore.set(relayState, { connectionId: connection.id, codeVerifier: '', createdAt: Date.now() });
      const samlUrl = await buildSamlAuthUrl(connection, cbUrl, relayState);
      res.redirect(samlUrl);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SSO initiation failed';
    res.status(500).json({ error: msg });
  }
});

// GET /api/auth/sso/:connectionId/callback — OIDC code exchange
router.get('/:connectionId/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query as Record<string, string>;

  const stateEntry = stateStore.get(state);
  if (!stateEntry) {
    res.status(400).json({ error: 'Invalid or expired SSO state' });
    return;
  }

  if (stateEntry.connectionId !== req.params.connectionId) {
    res.status(400).json({ error: 'State/connection mismatch' });
    return;
  }

  const connection = await loadConnection(req.params.connectionId);
  if (!connection) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  try {
    const cbUrl = callbackUrl(req, connection.id);
    const userInfo = await exchangeOidcCode(connection, cbUrl, { code, state }, stateEntry.codeVerifier);
    const user = await findOrProvisionUser(connection, userInfo);
    const token = signToken(user.id, user.role, user.tenant_id);
    res.redirect(`${frontendUrl()}/sso-callback?token=${encodeURIComponent(token)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SSO callback failed';
    res.redirect(`${frontendUrl()}/login?error=${encodeURIComponent(msg)}`);
  }
});

// POST /api/auth/sso/:connectionId/callback — SAML assertion POST binding
router.post('/:connectionId/callback', async (req: Request, res: Response): Promise<void> => {
  const { RelayState } = req.body as Record<string, string>;

  // RelayState is required — it carries the CSRF state token we set at login
  if (!RelayState) {
    res.status(400).json({ error: 'Missing RelayState' });
    return;
  }
  const entry = stateStore.get(RelayState);
  if (!entry) {
    res.status(400).json({ error: 'Invalid or expired SSO state' });
    return;
  }

  if (entry.connectionId !== req.params.connectionId) {
    res.status(400).json({ error: 'State/connection mismatch' });
    return;
  }

  const connection = await loadConnection(req.params.connectionId);
  if (!connection) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  try {
    const cbUrl = callbackUrl(req, connection.id);
    const userInfo = await validateSamlResponse(connection, cbUrl, req.body as Record<string, unknown>);
    const user = await findOrProvisionUser(connection, userInfo);
    const token = signToken(user.id, user.role, user.tenant_id);
    res.redirect(`${frontendUrl()}/sso-callback?token=${encodeURIComponent(token)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SAML callback failed';
    res.redirect(`${frontendUrl()}/login?error=${encodeURIComponent(msg)}`);
  }
});

export default router;
