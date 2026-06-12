import { rateLimit, Options } from 'express-rate-limit';
import { Request } from 'express';
import { ApiKeyRequest } from '../api-keys/middleware';

export function createRateLimiter(overrides?: Partial<Options>) {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? String(15 * 60 * 1000), 10);
  const limit = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => (req as ApiKeyRequest).user?.keyId ?? 'unknown',
    handler: (_req, res) => {
      res.status(429).json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' });
    },
    skip: (req: Request) => !(req as ApiKeyRequest).user?.keyId,
    ...(overrides ?? {}),
  });
}

export const v1RateLimit = createRateLimiter();
