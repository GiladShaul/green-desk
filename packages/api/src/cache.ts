import { getRedis } from './redis';
import { logger } from './logger';

const DEFAULT_TTL = 300; // 5 minutes

export const CacheKeys = {
  floorList: (tenantId: string) => `gd:floors:${tenantId}`,
  floor: (id: string, tenantId: string) => `gd:floor:${id}:${tenantId}`,
  floorDesks: (floorId: string, tenantId: string) => `gd:desks:floor:${floorId}:${tenantId}`,
  tenantPlan: (tenantId: string) => `gd:tenant:plan:${tenantId}`,
};

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (raw !== null) {
      logger.debug({ key }, '[cache] hit');
      return JSON.parse(raw) as T;
    }
    logger.debug({ key }, '[cache] miss');
    return null;
  } catch (err) {
    logger.warn({ err, key }, '[cache] get error');
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttl = DEFAULT_TTL): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    logger.warn({ err, key }, '[cache] set error');
  }
}

export async function cacheInvalidate(...keys: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
    logger.debug({ keys }, '[cache] invalidated');
  } catch (err) {
    logger.warn({ err, keys }, '[cache] invalidate error');
  }
}
