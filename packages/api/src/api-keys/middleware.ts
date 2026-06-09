import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../db';
import { AuthPayload, AuthRequest } from '../auth/middleware';

// In-memory rate limiter: keyId → { count, resetAt }
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = parseInt(process.env.API_KEY_RATE_LIMIT ?? '100', 10);
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(keyId: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(keyId);
  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(keyId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Purge expired rate limit entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of rateLimitStore) {
    if (now >= entry.resetAt) rateLimitStore.delete(id);
  }
}, 5 * 60_000);

export interface ApiKeyPayload extends AuthPayload {
  scopes: string[];
  keyId: string;
}

export interface ApiKeyRequest extends Request {
  user?: ApiKeyPayload;
}

function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export async function requireApiKey(req: ApiKeyRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer gd_')) {
    res.status(401).json({ error: 'Missing or invalid API key', code: 'UNAUTHORIZED' });
    return;
  }

  const rawKey = authHeader.slice(7); // strip 'Bearer '
  // key_prefix is the first 11 chars of the raw key: 'gd_' + 8 hex chars
  const keyPrefix = rawKey.slice(0, 11);

  const result = await query<{
    id: string;
    tenant_id: string;
    key_hash: string;
    scopes: string[];
    expires_at: string | null;
    revoked_at: string | null;
  }>(
    `SELECT id, tenant_id, key_hash, scopes, expires_at, revoked_at
     FROM api_keys
     WHERE key_prefix = $1`,
    [keyPrefix],
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: 'Invalid API key', code: 'INVALID_API_KEY' });
    return;
  }

  const apiKey = result.rows[0];

  if (apiKey.revoked_at) {
    res.status(401).json({ error: 'API key has been revoked', code: 'REVOKED_API_KEY' });
    return;
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    res.status(401).json({ error: 'API key has expired', code: 'EXPIRED_API_KEY' });
    return;
  }

  const hash = hashKey(rawKey);
  if (hash !== apiKey.key_hash) {
    res.status(401).json({ error: 'Invalid API key', code: 'INVALID_API_KEY' });
    return;
  }

  if (!checkRateLimit(apiKey.id)) {
    res.status(429).json({ error: 'Rate limit exceeded (100 req/min)', code: 'RATE_LIMIT_EXCEEDED' });
    return;
  }

  // Update last_used_at non-blocking
  query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [apiKey.id]).catch(() => undefined);

  req.user = {
    sub: `api_key:${apiKey.id}`,
    role: 'api_key',
    tenantId: apiKey.tenant_id,
    scopes: Array.isArray(apiKey.scopes) ? apiKey.scopes : [],
    keyId: apiKey.id,
  };

  next();
}

export function requireScope(scope: string) {
  return (req: ApiKeyRequest, res: Response, next: NextFunction): void => {
    const user = req.user as ApiKeyPayload | undefined;
    if (!user?.scopes?.includes(scope)) {
      res.status(403).json({
        error: `Insufficient scope: ${scope} required`,
        code: 'INSUFFICIENT_SCOPE',
      });
      return;
    }
    next();
  };
}
