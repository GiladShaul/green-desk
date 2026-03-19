import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';

jest.mock('../sso/oidc', () => ({
  buildOidcAuthUrl: jest.fn().mockResolvedValue({
    authUrl: 'https://idp.example.com/authorize?state=s123',
    state: 's123',
    codeVerifier: 'verifier',
  }),
  exchangeOidcCode: jest.fn().mockResolvedValue({
    externalId: 'sub-1',
    email: 'alice@corp.com',
    name: 'Alice',
  }),
}));

jest.mock('../sso/saml', () => ({
  buildSamlAuthUrl: jest.fn().mockResolvedValue('https://idp.example.com/sso?SAMLRequest=abc'),
  validateSamlResponse: jest.fn().mockResolvedValue({
    externalId: 'saml-sub-1',
    email: 'bob@corp.com',
    name: 'Bob',
  }),
}));

jest.mock('../sso/provisioning', () => ({
  findOrProvisionUser: jest.fn().mockResolvedValue({
    id: 'user-sso-1',
    email: 'alice@corp.com',
    name: 'Alice',
    role: 'member',
    tenant_id: 'tenant-1',
  }),
}));

jest.mock('../db');
const mockQuery = db.query as jest.Mock;

process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'http://localhost:5173';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/auth/sso/connections', () => {
  test('returns list of enabled connections', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', name: 'Corp OKTA', provider_type: 'oidc' }],
    });
    const res = await request(app).get('/api/auth/sso/connections');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/auth/sso/:connectionId/login (OIDC)', () => {
  test('redirects to IdP authorize URL', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', provider_type: 'oidc', config: { issuer_url: 'https://idp.example.com', client_id: 'cid', client_secret: 'sec' }, enabled: true, name: 'Corp OKTA', tenant_id: 'tenant-1' }],
    });
    const res = await request(app).get('/api/auth/sso/c1/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://idp.example.com/authorize');
  });

  test('returns 404 when connection not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/auth/sso/nonexistent/login');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/auth/sso/:connectionId/callback (OIDC)', () => {
  test('exchanges code and redirects to frontend with token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', provider_type: 'oidc', config: {}, enabled: true, name: 'Corp OKTA', tenant_id: 'tenant-1' }],
    });
    // Inject state manually into the state store
    const { stateStore } = require('../sso/state-store');
    stateStore.set('s123', { connectionId: 'c1', codeVerifier: 'verifier', createdAt: Date.now() });

    const res = await request(app).get('/api/auth/sso/c1/callback?code=auth-code&state=s123');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('sso-callback?token=');
    const tokenEncoded = new URL(res.headers.location).searchParams.get('token');
    expect(tokenEncoded).toBeTruthy();
    const token = decodeURIComponent(tokenEncoded!);
    const decoded = jwt.verify(token, 'test-secret') as Record<string, unknown>;
    expect(decoded.sub).toBe('user-sso-1');
  });
});

describe('POST /api/auth/sso/:connectionId/callback (SAML)', () => {
  test('validates SAML response and redirects with token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c2', provider_type: 'saml', config: {}, enabled: true, name: 'Acme SAML', tenant_id: 'tenant-1' }],
    });
    // Inject RelayState
    const { stateStore } = require('../sso/state-store');
    stateStore.set('relay-1', { connectionId: 'c2', codeVerifier: '', createdAt: Date.now() });

    const res = await request(app)
      .post('/api/auth/sso/c2/callback')
      .type('form')
      .send({ SAMLResponse: 'encoded-response', RelayState: 'relay-1' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('sso-callback?token=');
  });

  test('returns 400 when RelayState is missing', async () => {
    const res = await request(app)
      .post('/api/auth/sso/c2/callback')
      .type('form')
      .send({ SAMLResponse: 'encoded-response' });
    expect(res.status).toBe(400);
  });
});
