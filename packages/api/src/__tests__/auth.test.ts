import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';

// Mock the db module so tests don't need a real Postgres instance
jest.mock('../db');

const mockQuery = db.query as jest.Mock;

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRES_IN = '1h';

const existingUser = {
  id: 'user-uuid-1',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'member',
  password_hash: bcrypt.hashSync('correct-password', 10),
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  test('registers a new user and returns a JWT', async () => {
    mockQuery
      // email-exists check returns no rows
      .mockResolvedValueOnce({ rows: [] })
      // insert returns new user
      .mockResolvedValueOnce({
        rows: [{ id: 'new-uuid', email: 'bob@example.com', name: 'Bob', role: 'member' }],
      });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bob@example.com', password: 'securepass', name: 'Bob' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    const decoded = jwt.verify(res.body.token, JWT_SECRET) as Record<string, unknown>;
    expect(decoded.sub).toBe('new-uuid');
  });

  test('returns 409 when email is already registered', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [existingUser] });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: 'anypassword', name: 'Alice' });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'securepass', name: 'Bob' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bob@example.com', password: 'short', name: 'Bob' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bob@example.com' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  test('returns a JWT for valid credentials', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [existingUser] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    const decoded = jwt.verify(res.body.token, JWT_SECRET) as Record<string, unknown>;
    expect(decoded.sub).toBe(existingUser.id);
  });

  test('returns 401 for wrong password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [existingUser] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 401 when user does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'any-password' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'any-password' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  test('returns the current user for a valid token', async () => {
    const token = jwt.sign({ sub: existingUser.id, role: existingUser.role }, JWT_SECRET, { expiresIn: '1h' });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: existingUser.id, email: existingUser.email, name: existingUser.name, role: existingUser.role }],
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(existingUser.id);
    expect(res.body.email).toBe(existingUser.email);
    expect(res.body).not.toHaveProperty('password_hash');
  });

  test('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 401 for an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer totally.invalid.token');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 401 for an expired token', async () => {
    const expiredToken = jwt.sign({ sub: existingUser.id }, JWT_SECRET, { expiresIn: '-1s' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/auth/login — SSO user', () => {
  test('returns 401 when user has no password (SSO-only account)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'sso-user-1', email: 'alice@corp.com', name: 'Alice', role: 'member', password_hash: null }],
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@corp.com', password: 'anything' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('SSO');
  });
});
