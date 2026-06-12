import express, { Response } from 'express';
import request from 'supertest';
import { createRateLimiter } from '../v1/rate-limit';
import { ApiKeyRequest } from '../api-keys/middleware';

function makeApp(limit: number) {
  const app = express();

  // Inject a fake authenticated API key without hitting the DB
  app.use((req: ApiKeyRequest, _res: Response, next) => {
    req.user = {
      sub: 'api_key:test-key-1',
      role: 'api_key',
      tenantId: 'tenant-1',
      scopes: ['read:floors'],
      keyId: 'test-key-1',
    };
    next();
  });

  app.use(createRateLimiter({ limit }));
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('v1 rate limiting', () => {
  test('includes RateLimit-* headers on successful requests', async () => {
    const app = makeApp(100);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('ratelimit');
    expect(res.headers).toHaveProperty('ratelimit-policy');
  });

  test('returns 429 JSON error after exceeding the configured limit', async () => {
    const app = makeApp(3);

    for (let i = 0; i < 3; i++) {
      const r = await request(app).get('/test');
      expect(r.status).toBe(200);
    }

    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' });
  });
});
