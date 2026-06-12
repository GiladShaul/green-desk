import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { encryptToken, decryptToken, buildGoogleOAuth2Client } from '../services/calendar';
import { logger } from '../logger';

const router = Router();

// In-memory OAuth state store (same pattern as SSO)
const oauthStateStore = new Map<string, { userId: string; tenantId: string; createdAt: number }>();

// Prune states older than 10 minutes
function pruneStates() {
  const threshold = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of oauthStateStore) {
    if (v.createdAt < threshold) oauthStateStore.delete(k);
  }
}

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173';
}

// ---------------------------------------------------------------------------
// GET /api/calendar/connections — list user's connected calendars
// ---------------------------------------------------------------------------
router.get('/connections', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const result = await query<{
    id: string; provider: string; calendar_id: string | null;
    connected_at: string; revoked_at: string | null;
  }>(
    `SELECT id, provider, calendar_id, connected_at, revoked_at
     FROM user_calendar_connections WHERE user_id = $1 ORDER BY connected_at`,
    [userId],
  );
  res.json(result.rows);
});

// ---------------------------------------------------------------------------
// DELETE /api/calendar/connections/:id — disconnect a calendar
// ---------------------------------------------------------------------------
router.delete('/connections/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { id } = req.params;

  const existing = await query<{ id: string }>(
    'SELECT id FROM user_calendar_connections WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Calendar connection not found' });
    return;
  }

  await query(
    'UPDATE user_calendar_connections SET revoked_at = now() WHERE id = $1',
    [id],
  );
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

// GET /api/calendar/google/connect — redirect to Google consent screen
router.get('/google/connect', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const tenantId = req.user!.tenantId;

  pruneStates();
  const state = randomUUID();
  oauthStateStore.set(state, { userId, tenantId, createdAt: Date.now() });

  const oauth2Client = buildGoogleOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state,
  });

  res.redirect(url);
});

// GET /api/calendar/google/callback — handle Google OAuth callback
router.get('/google/callback', async (req: AuthRequest, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(`${frontendUrl()}/settings/calendar?error=${encodeURIComponent(error)}`);
    return;
  }

  const stateData = state ? oauthStateStore.get(state) : undefined;
  if (!stateData) {
    res.redirect(`${frontendUrl()}/settings/calendar?error=invalid_state`);
    return;
  }
  oauthStateStore.delete(state);

  try {
    const oauth2Client = buildGoogleOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      res.redirect(`${frontendUrl()}/settings/calendar?error=missing_tokens`);
      return;
    }

    await query(
      `INSERT INTO user_calendar_connections
         (user_id, tenant_id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at)
       VALUES ($1, $2, 'google', $3, $4, $5)
       ON CONFLICT (user_id, provider) DO UPDATE
         SET access_token_encrypted = EXCLUDED.access_token_encrypted,
             refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
             token_expires_at = EXCLUDED.token_expires_at,
             revoked_at = NULL,
             connected_at = now()`,
      [
        stateData.userId,
        stateData.tenantId,
        encryptToken(tokens.access_token),
        encryptToken(tokens.refresh_token),
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      ],
    );

    res.redirect(`${frontendUrl()}/settings/calendar?connected=google`);
  } catch (err) {
    logger.error({ err }, '[calendar] Google callback error');
    res.redirect(`${frontendUrl()}/settings/calendar?error=google_callback_failed`);
  }
});

// ---------------------------------------------------------------------------
// Microsoft OAuth
// ---------------------------------------------------------------------------

// GET /api/calendar/microsoft/connect — redirect to Microsoft consent screen
router.get('/microsoft/connect', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const tenantId = req.user!.tenantId;

  pruneStates();
  const state = randomUUID();
  oauthStateStore.set(state, { userId, tenantId, createdAt: Date.now() });

  const clientId = process.env.MICROSOFT_CLIENT_ID ?? '';
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? '';
  const scope = 'Calendars.ReadWrite offline_access';

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
    response_mode: 'query',
  });

  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`);
});

// GET /api/calendar/microsoft/callback — handle Microsoft OAuth callback
router.get('/microsoft/callback', async (req: AuthRequest, res: Response): Promise<void> => {
  const { code, state, error, error_description } = req.query as Record<string, string>;

  if (error) {
    const msg = error_description ?? error;
    res.redirect(`${frontendUrl()}/settings/calendar?error=${encodeURIComponent(msg)}`);
    return;
  }

  const stateData = state ? oauthStateStore.get(state) : undefined;
  if (!stateData) {
    res.redirect(`${frontendUrl()}/settings/calendar?error=invalid_state`);
    return;
  }
  oauthStateStore.delete(state);

  try {
    const clientId = process.env.MICROSOFT_CLIENT_ID ?? '';
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET ?? '';
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? '';

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'Calendars.ReadWrite offline_access',
    });

    const tokenResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!tokenResp.ok) {
      const body = await tokenResp.text();
      throw new Error(`Token exchange failed: ${tokenResp.status} ${body}`);
    }

    const tokenData = await tokenResp.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    if (!tokenData.access_token || !tokenData.refresh_token) {
      res.redirect(`${frontendUrl()}/settings/calendar?error=missing_tokens`);
      return;
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    await query(
      `INSERT INTO user_calendar_connections
         (user_id, tenant_id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at)
       VALUES ($1, $2, 'microsoft', $3, $4, $5)
       ON CONFLICT (user_id, provider) DO UPDATE
         SET access_token_encrypted = EXCLUDED.access_token_encrypted,
             refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
             token_expires_at = EXCLUDED.token_expires_at,
             revoked_at = NULL,
             connected_at = now()`,
      [
        stateData.userId,
        stateData.tenantId,
        encryptToken(tokenData.access_token),
        encryptToken(tokenData.refresh_token),
        expiresAt,
      ],
    );

    res.redirect(`${frontendUrl()}/settings/calendar?connected=microsoft`);
  } catch (err) {
    logger.error({ err }, '[calendar] Microsoft callback error');
    res.redirect(`${frontendUrl()}/settings/calendar?error=microsoft_callback_failed`);
  }
});

export default router;
