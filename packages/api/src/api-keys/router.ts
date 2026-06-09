import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { auditLog } from '../services/audit';

const router = Router();

export const ALL_SCOPES = [
  'read:bookings',
  'write:bookings',
  'read:floors',
  'read:desks',
  'read:rooms',
  'read:analytics',
  'read:users',
] as const;

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin access required', code: 'FORBIDDEN' });
    return;
  }
  next();
}

function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const hex = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  const rawKey = `gd_${hex}`;
  const keyPrefix = rawKey.slice(0, 11); // 'gd_' + 8 hex chars
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyHash, keyPrefix };
}

// POST /api/admin/api-keys — create a new API key (returns full key once)
router.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, scopes, expires_at } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;
  const userId = req.user!.sub;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required', code: 'VALIDATION_ERROR' });
    return;
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    res.status(400).json({ error: 'scopes must be a non-empty array', code: 'VALIDATION_ERROR' });
    return;
  }

  const invalidScopes = (scopes as unknown[]).filter(s => !ALL_SCOPES.includes(s as typeof ALL_SCOPES[number]));
  if (invalidScopes.length > 0) {
    res.status(400).json({
      error: `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${ALL_SCOPES.join(', ')}`,
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  if (expires_at !== undefined && expires_at !== null) {
    if (typeof expires_at !== 'string' || isNaN(Date.parse(expires_at as string))) {
      res.status(400).json({ error: 'expires_at must be a valid ISO 8601 date', code: 'VALIDATION_ERROR' });
      return;
    }
    if (new Date(expires_at as string) <= new Date()) {
      res.status(400).json({ error: 'expires_at must be in the future', code: 'VALIDATION_ERROR' });
      return;
    }
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();

  const result = await query<{
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    expires_at: string | null;
    created_at: string;
  }>(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, scopes, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, key_prefix, scopes, expires_at, created_at`,
    [tenantId, keyHash, keyPrefix, name.trim(), JSON.stringify(scopes), expires_at ?? null, userId],
  );

  const created = result.rows[0];
  auditLog(req, { action: 'create', resourceType: 'api_key' as never, resourceId: created.id });

  res.status(201).json({
    ...created,
    key: rawKey, // shown once only
  });
});

// GET /api/admin/api-keys — list all API keys for the tenant
router.get('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;

  const result = await query<{
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
    created_at: string;
  }>(
    `SELECT id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at
     FROM api_keys
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );

  res.json(result.rows.map(row => ({
    ...row,
    status: row.revoked_at ? 'revoked'
      : (row.expires_at && new Date(row.expires_at) < new Date()) ? 'expired'
      : 'active',
  })));
});

// DELETE /api/admin/api-keys/:id — revoke an API key
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const existing = await query<{ id: string; revoked_at: string | null }>(
    'SELECT id, revoked_at FROM api_keys WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );

  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'API key not found', code: 'NOT_FOUND' });
    return;
  }

  if (existing.rows[0].revoked_at) {
    res.status(409).json({ error: 'API key is already revoked', code: 'ALREADY_REVOKED' });
    return;
  }

  await query(
    'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );

  auditLog(req, { action: 'delete', resourceType: 'api_key' as never, resourceId: id });
  res.status(204).end();
});

export default router;
