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
