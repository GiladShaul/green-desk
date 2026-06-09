import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../index';
import { migrate, truncateTables, closePool } from './setup';

beforeAll(async () => {
  await migrate();
  await truncateTables();
});

afterAll(async () => {
  await truncateTables();
  await closePool();
});

describe('POST /api/auth/register (integration)', () => {
  test('registers a new user and returns a valid JWT', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@integration.test', password: 'securepass1', name: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe('alice@integration.test');
    expect(res.body.user.role).toBe('admin');

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET!) as Record<string, unknown>;
    expect(decoded.sub).toBe(res.body.user.id);
    expect(decoded.tenantId).toBe(res.body.user.tenantId);
  });

  test('returns 409 when email is already registered', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@integration.test', password: 'securepass1', name: 'Dup' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@integration.test', password: 'securepass1', name: 'Dup Again' });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'securepass1', name: 'Bob' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@integration.test', password: 'short', name: 'Short' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login (integration)', () => {
  const email = 'login@integration.test';
  const password = 'loginpass1';

  beforeAll(async () => {
    await request(app).post('/api/auth/register').send({ email, password, name: 'Login User' });
  });

  test('returns a valid JWT for correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET!) as Record<string, unknown>;
    expect(decoded.sub).toBe(res.body.user.id);
  });

  test('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  test('returns 401 when user does not exist', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@integration.test', password: 'anypassword' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me (integration)', () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'me@integration.test', password: 'mepassword', name: 'Me User' });
    token = res.body.token;
  });

  test('returns the current user for a valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@integration.test');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  test('returns 401 when no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 for an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(401);
  });
});
