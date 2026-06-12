import Redis from 'ioredis';
import { logger } from './logger';

let redisClient: Redis | null = null;
let redisConnected = false;

export function getRedis(): Redis | null {
  return redisConnected ? redisClient : null;
}

export async function initRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.info('[redis] REDIS_URL not set — using in-memory fallbacks');
    return;
  }

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  });

  client.on('ready', () => {
    redisConnected = true;
    logger.info('[redis] connected');
  });

  client.on('error', (err: Error) => {
    redisConnected = false;
    logger.error({ err }, '[redis] error');
  });

  client.on('reconnecting', () => {
    logger.warn('[redis] reconnecting');
  });

  try {
    await client.connect();
    redisClient = client;
  } catch (err) {
    logger.warn({ err }, '[redis] initial connect failed — continuing without Redis');
  }
}

export async function pingRedis(): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
