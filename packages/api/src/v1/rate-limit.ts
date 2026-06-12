import { rateLimit, Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { Request, Response, NextFunction } from 'express';
import { ApiKeyRequest } from '../api-keys/middleware';
import { getRedis } from '../redis';

function buildLimiter(overrides?: Partial<Options>, store?: InstanceType<typeof RedisStore>) {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? String(15 * 60 * 1000), 10);
  const limit = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(store ? { store } : {}),
    keyGenerator: (req: Request) => (req as ApiKeyRequest).user?.keyId ?? 'unknown',
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' });
    },
    skip: (req: Request) => !(req as ApiKeyRequest).user?.keyId,
    ...(overrides ?? {}),
  });
}

export function createRateLimiter(overrides?: Partial<Options>) {
  // Stable in-memory limiter used when Redis is absent
  const memLimiter = buildLimiter(overrides);

  // Redis limiter created lazily on first request when Redis is connected;
  // cleared when Redis disconnects so it is rebuilt on reconnect.
  let redisLimiter: ReturnType<typeof rateLimit> | null = null;

  return (req: Request, res: Response, next: NextFunction): void => {
    const redis = getRedis();
    if (redis) {
      if (!redisLimiter) {
        const store = new RedisStore({
          sendCommand: (command: string, ...args: string[]) =>
            redis.call(command, ...args) as Promise<RedisReply>,
        });
        redisLimiter = buildLimiter(overrides, store);
      }
      redisLimiter(req, res, next);
    } else {
      redisLimiter = null;
      memLimiter(req, res, next);
    }
  };
}

export const v1RateLimit = createRateLimiter();
