import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';

jest.mock('../db');
const mockQuery = db.query as jest.Mock;

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function adminToken() {
  return jwt.sign({ sub: 'admin-1', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}
function memberToken() {
  return jwt.sign({ sub: 'member-1', role: 'member' }, JWT_SECRET, { expiresIn: '1h' });
}

const sampleConn = {
  id: 'conn-1',
  name: 'Acme OKTA',
  provider_type: 'oidc',
  config: { issuer_url: 'https://idp.acme.com', client_id: 'cid', client_secret: 'sec' },
  enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => jest.clearAllMocks());

describe('GET /api/admin/sso-connections', () => {
  test('returns list for admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleConn] });
    const res = await request(app)
      .get('/api/admin/sso-connections')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/sso-connections')
      .set('Authorization', `Bearer ${memberToken()}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/sso-connections', () => {
  test('creates a new connection', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleConn] });
    const res = await request(app)
      .post('/api/admin/sso-connections')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Acme OKTA', provider_type: 'oidc', config: { issuer_url: 'https://idp.acme.com', client_id: 'cid', client_secret: 'sec' } });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  test('returns 400 when provider_type is invalid', async () => {
    const res = await request(app)
      .post('/api/admin/sso-connections')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Bad', provider_type: 'oauth2', config: {} });
    expect(res.status).toBe(400);
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/admin/sso-connections')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ provider_type: 'oidc', config: {} });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/admin/sso-connections/:id', () => {
  test('updates enabled flag', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [sampleConn] })  // exists check
      .mockResolvedValueOnce({ rows: [{ ...sampleConn, enabled: false }] }); // update
    const res = await request(app)
      .patch('/api/admin/sso-connections/conn-1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  test('returns 404 when connection not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .patch('/api/admin/sso-connections/bad-id')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ enabled: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/sso-connections/:id', () => {
  test('deletes connection', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [sampleConn] })  // exists check
      .mockResolvedValueOnce({ rows: [] });            // delete
    const res = await request(app)
      .delete('/api/admin/sso-connections/conn-1')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(204);
  });

  test('returns 404 when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .delete('/api/admin/sso-connections/bad-id')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });
});
