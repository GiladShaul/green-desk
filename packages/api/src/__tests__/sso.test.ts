import { stateStore } from '../sso/state-store';

describe('SSO state store', () => {
  beforeEach(() => stateStore.clear());

  test('stores and retrieves state', () => {
    stateStore.set('abc', { connectionId: 'conn-1', codeVerifier: 'verifier', createdAt: Date.now() });
    const entry = stateStore.get('abc');
    expect(entry).not.toBeNull();
    expect(entry!.connectionId).toBe('conn-1');
    expect(entry!.codeVerifier).toBe('verifier');
  });

  test('returns null for unknown state', () => {
    expect(stateStore.get('unknown')).toBeNull();
  });

  test('deletes entry after retrieval', () => {
    stateStore.set('xyz', { connectionId: 'c', codeVerifier: 'v', createdAt: Date.now() });
    stateStore.get('xyz');          // first get deletes it
    expect(stateStore.get('xyz')).toBeNull();
  });

  test('returns null for expired state (TTL)', () => {
    const old = Date.now() - 11 * 60 * 1000; // 11 minutes ago
    stateStore.set('expired', { connectionId: 'c', codeVerifier: 'v', createdAt: old });
    expect(stateStore.get('expired')).toBeNull();
  });
});

import { buildOidcAuthUrl, exchangeOidcCode } from '../sso/oidc';

// Mock openid-client
jest.mock('openid-client', () => {
  const mockClient = {
    authorizationUrl: jest.fn().mockReturnValue('https://idp.example.com/authorize?state=s&code_challenge=c'),
    callback: jest.fn().mockResolvedValue({
      claims: () => ({
        sub: 'user-123',
        email: 'alice@corp.com',
        name: 'Alice',
        email_verified: true,
      }),
    }),
  };
  const MockIssuer = function (this: Record<string, unknown>, _meta: unknown) {
    this.Client = function (this: unknown) {};
    Object.assign((this.Client as { prototype: object }).prototype, mockClient);
  };
  MockIssuer.discover = jest.fn().mockResolvedValue(new (MockIssuer as unknown as new () => unknown)());
  const generators = {
    state: jest.fn().mockReturnValue('random-state'),
    codeVerifier: jest.fn().mockReturnValue('verifier-abc'),
    codeChallenge: jest.fn().mockReturnValue('challenge-xyz'),
  };
  return { Issuer: MockIssuer, generators };
});

const oidcConnection = {
  id: 'conn-oidc-1',
  provider_type: 'oidc' as const,
  config: {
    issuer_url: 'https://idp.example.com',
    client_id: 'client-abc',
    client_secret: 'secret-xyz',
    allowed_domains: ['corp.com'],
  },
};

describe('buildOidcAuthUrl', () => {
  test('returns authUrl and state', async () => {
    const result = await buildOidcAuthUrl(oidcConnection, 'https://app.example.com/callback/oidc');
    expect(result.authUrl).toContain('https://idp.example.com');
    expect(result.state).toBe('random-state');
    expect(result.codeVerifier).toBe('verifier-abc');
  });
});

describe('exchangeOidcCode', () => {
  test('returns normalized user info', async () => {
    const info = await exchangeOidcCode(
      oidcConnection,
      'https://app.example.com/callback/oidc',
      { code: 'auth-code', state: 'random-state' },
      'verifier-abc',
    );
    expect(info.email).toBe('alice@corp.com');
    expect(info.externalId).toBe('user-123');
    expect(info.name).toBe('Alice');
  });

  test('throws if email domain not in allowed_domains', async () => {
    const restrictedConn = { ...oidcConnection, config: { ...oidcConnection.config, allowed_domains: ['other.com'] } };
    await expect(exchangeOidcCode(restrictedConn, 'https://app/cb', { code: 'c', state: 's' }, 'v'))
      .rejects.toThrow('Email domain not allowed');
  });
});

import { buildSamlAuthUrl, validateSamlResponse } from '../sso/saml';

jest.mock('@node-saml/node-saml', () => {
  return {
    SAML: jest.fn().mockImplementation(() => ({
      getAuthorizeUrlAsync: jest.fn().mockResolvedValue('https://idp.example.com/sso?SAMLRequest=abc&RelayState=relay-123'),
      validatePostResponseAsync: jest.fn().mockResolvedValue({
        profile: {
          nameID: 'saml-user-456',
          email: 'bob@enterprise.com',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Bob',
        },
        loggedOut: false,
      }),
    })),
  };
});

const samlConnection = {
  id: 'conn-saml-1',
  provider_type: 'saml' as const,
  config: {
    idp_sso_url: 'https://idp.example.com/sso',
    idp_entity_id: 'https://idp.example.com',
    idp_certificate: 'MIIC...',
    allowed_domains: ['enterprise.com'],
  },
};

describe('buildSamlAuthUrl', () => {
  test('returns redirect URL with RelayState', async () => {
    const result = await buildSamlAuthUrl(samlConnection, 'https://app.example.com/callback/saml', 'relay-123');
    expect(result).toContain('https://idp.example.com/sso');
    expect(result).toContain('relay-123');
  });
});

describe('validateSamlResponse', () => {
  test('returns normalized user info', async () => {
    const info = await validateSamlResponse(samlConnection, 'https://app/cb', { SAMLResponse: 'encoded' });
    expect(info.externalId).toBe('saml-user-456');
    expect(info.email).toBe('bob@enterprise.com');
  });

  test('throws if email domain not in allowed_domains', async () => {
    const restrictedConn = { ...samlConnection, config: { ...samlConnection.config, allowed_domains: ['other.com'] } };
    await expect(validateSamlResponse(restrictedConn, 'https://app/cb', { SAMLResponse: 'e' }))
      .rejects.toThrow('Email domain not allowed');
  });
});

import * as db from '../db';
import { findOrProvisionUser } from '../sso/provisioning';

jest.mock('../db');
const mockQuery = db.query as jest.Mock;

describe('findOrProvisionUser', () => {
  beforeEach(() => jest.clearAllMocks());

  const conn = { id: 'conn-1', provider_type: 'oidc' as const, config: {} };
  const info = { externalId: 'ext-001', email: 'carol@corp.com', name: 'Carol' };

  test('returns existing user matched by sso_connection_id + external_id', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'carol@corp.com', name: 'Carol', role: 'member' }],
    });
    const user = await findOrProvisionUser(conn, info);
    expect(user.id).toBe('u1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('matches by email when no existing SSO record', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // no SSO match
      .mockResolvedValueOnce({ rows: [{ id: 'u2', email: 'carol@corp.com', name: 'Carol', role: 'member' }] }) // email match
      .mockResolvedValueOnce({ rows: [{ id: 'u2', email: 'carol@corp.com', name: 'Carol', role: 'member' }] }); // update returning
    const user = await findOrProvisionUser(conn, info);
    expect(user.id).toBe('u2');
  });

  test('auto-provisions a new user when no match', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // no SSO match
      .mockResolvedValueOnce({ rows: [] })  // no email match
      .mockResolvedValueOnce({ rows: [{ id: 'u3', email: 'carol@corp.com', name: 'Carol', role: 'member' }] }); // insert
    const user = await findOrProvisionUser(conn, info);
    expect(user.id).toBe('u3');
  });
});

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';

// Mock sso modules (these may already be partially mocked above — but jest.mock calls are hoisted so additional mocks here are fine)
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
  }),
}));

process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'http://localhost:5173';

// Reset mockQuery before each router integration test to avoid queue pollution
// from earlier unit tests that set mockResolvedValueOnce but never consumed the values
// (because findOrProvisionUser/buildOidcAuthUrl etc. are mocked at module level above).
beforeEach(() => mockQuery.mockReset());

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
      rows: [{ id: 'c1', provider_type: 'oidc', config: { issuer_url: 'https://idp.example.com', client_id: 'cid', client_secret: 'sec' }, enabled: true, name: 'Corp OKTA' }],
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
      rows: [{ id: 'c1', provider_type: 'oidc', config: {}, enabled: true, name: 'Corp OKTA' }],
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
      rows: [{ id: 'c2', provider_type: 'saml', config: {}, enabled: true, name: 'Acme SAML' }],
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
