# SSO Authentication (SAML/OIDC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OIDC and SAML 2.0 SSO support so enterprise customers can sign in via their identity provider with auto-provisioned Green Desk accounts.

**Architecture:** New `sso` module in the API handles auth flows (OIDC + SAML), a shared state store (in-memory TTL Map) tracks CSRF state/codeVerifier per request, and admin endpoints manage SSO connection configs. After IdP callback the server issues a JWT and redirects the browser to `/sso-callback?token=<jwt>`, which the frontend reads and stores.

**Tech Stack:** `openid-client@4` (OIDC), `@node-saml/node-saml` (SAML), PostgreSQL (connection config), in-memory state store, React (frontend pages).

---

## File Map

**Create:**
- `packages/api/migrations/006_sso.sql` — new tables + schema changes
- `packages/api/src/sso/state-store.ts` — in-memory state with TTL
- `packages/api/src/sso/oidc.ts` — OIDC auth URL + token exchange
- `packages/api/src/sso/saml.ts` — SAML redirect URL + assertion validation
- `packages/api/src/sso/provisioning.ts` — find-or-create user logic
- `packages/api/src/sso/router.ts` — public SSO auth endpoints
- `packages/api/src/__tests__/sso.test.ts` — SSO router tests
- `packages/api/src/__tests__/admin-sso.test.ts` — Admin SSO CRUD tests
- `packages/web/src/pages/SsoCallback.tsx` — reads token from URL, stores, redirects
- `packages/web/src/pages/admin/AdminSSO.tsx` — admin SSO connection management

**Modify:**
- `packages/api/src/auth/router.ts` — guard login when password_hash is NULL
- `packages/api/src/admin/router.ts` — add SSO connection CRUD endpoints
- `packages/api/src/index.ts` — register sso router at `/api/auth/sso`
- `packages/web/src/App.tsx` — add `/sso-callback` and `/admin/sso` routes
- `packages/web/src/pages/Login.tsx` — add "Sign in with SSO" section
- `packages/web/src/pages/admin/AdminLayout.tsx` — add SSO nav link

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/api/package.json`

- [ ] **Step 1: Install API SSO dependencies**

```bash
cd "packages/api"
npm install openid-client@4 @node-saml/node-saml
npm install --save-dev @types/node-saml
```

Expected: packages added to node_modules, no errors.

- [ ] **Step 2: Verify install**

```bash
node -e "require('openid-client'); console.log('openid-client OK')"
node -e "require('@node-saml/node-saml'); console.log('node-saml OK')"
```

Expected output: two OK lines.

- [ ] **Step 3: Commit**

```bash
cd "../.."
git add packages/api/package.json packages/api/package-lock.json
git commit -m "chore: add openid-client and node-saml dependencies

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Database migration

**Files:**
- Create: `packages/api/migrations/006_sso.sql`

- [ ] **Step 1: Write migration**

Create `packages/api/migrations/006_sso.sql`:

```sql
-- Migration: 006_sso
-- Description: SSO connections and user SSO fields

-- SSO connections table
CREATE TABLE IF NOT EXISTS sso_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,                          -- nullable; reserved for future multi-tenant
  provider_type TEXT NOT NULL CHECK (provider_type IN ('oidc', 'saml')),
  name TEXT NOT NULL,                       -- human-readable label, e.g. "Acme Corp OKTA"
  config JSONB NOT NULL DEFAULT '{}',       -- OIDC or SAML config blob (see docs)
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER sso_connections_updated_at
  BEFORE UPDATE ON sso_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Extend users for SSO identity
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS sso_connection_id UUID REFERENCES sso_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_id TEXT;          -- IdP subject identifier

-- Prevent two SSO users from sharing the same (connection, externalId)
CREATE UNIQUE INDEX IF NOT EXISTS users_sso_connection_external
  ON users (sso_connection_id, external_id)
  WHERE sso_connection_id IS NOT NULL AND external_id IS NOT NULL;
```

- [ ] **Step 2: Verify SQL syntax (dry-run)**

No database is required here — a quick visual review is enough. Ensure:
- `update_updated_at_column()` is referenced (created in migration 001).
- `ALTER COLUMN password_hash DROP NOT NULL` is present.
- The partial unique index is correct.

- [ ] **Step 3: Commit**

```bash
git add packages/api/migrations/006_sso.sql
git commit -m "feat(db): migration 006 — sso_connections table and user SSO fields

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: State store utility

**Files:**
- Create: `packages/api/src/sso/state-store.ts`
- Test: `packages/api/src/__tests__/sso.test.ts` (first test group)

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/__tests__/sso.test.ts` with state-store tests:

```typescript
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
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/api
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '../sso/state-store'`.

- [ ] **Step 3: Implement state store**

Create `packages/api/src/sso/state-store.ts`:

```typescript
export interface StateEntry {
  connectionId: string;
  codeVerifier: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const store = new Map<string, StateEntry>();

export const stateStore = {
  set(key: string, entry: StateEntry): void {
    store.set(key, entry);
  },

  /** Returns entry and deletes it (one-time use). Returns null if missing or expired. */
  get(key: string): StateEntry | null {
    const entry = store.get(key);
    if (!entry) return null;
    store.delete(key); // consume
    if (Date.now() - entry.createdAt > TTL_MS) return null;
    return entry;
  },

  clear(): void {
    store.clear();
  },
};
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/sso/state-store.ts packages/api/src/__tests__/sso.test.ts
git commit -m "feat(sso): in-memory state store with TTL

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: OIDC service

**Files:**
- Create: `packages/api/src/sso/oidc.ts`
- Test: add to `packages/api/src/__tests__/sso.test.ts`

The OIDC service wraps `openid-client` v4. It is designed to be mockable in tests.

- [ ] **Step 1: Write the failing tests** (append to sso.test.ts)

Add this section to `packages/api/src/__tests__/sso.test.ts` (after state-store tests):

```typescript
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
    Object.assign(this.Client.prototype, mockClient);
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../sso/oidc'`.

- [ ] **Step 3: Implement oidc.ts**

Create `packages/api/src/sso/oidc.ts`:

```typescript
import { Issuer, generators } from 'openid-client';

export interface OidcConfig {
  issuer_url: string;
  client_id: string;
  client_secret: string;
  allowed_domains?: string[];
}

export interface SsoConnection {
  id: string;
  provider_type: 'oidc' | 'saml';
  config: OidcConfig | Record<string, unknown>;
}

export interface OidcAuthResult {
  authUrl: string;
  state: string;
  codeVerifier: string;
}

export interface SsoUserInfo {
  externalId: string;
  email: string;
  name: string;
}

function asOidcConfig(config: unknown): OidcConfig {
  return config as OidcConfig;
}

async function buildClient(config: OidcConfig, redirectUri: string) {
  const issuer = await Issuer.discover(config.issuer_url);
  return new issuer.Client({
    client_id: config.client_id,
    client_secret: config.client_secret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  });
}

function checkAllowedDomain(email: string, allowedDomains?: string[]): void {
  if (!allowedDomains || allowedDomains.length === 0) return;
  const domain = email.split('@')[1];
  if (!allowedDomains.includes(domain)) {
    throw new Error('Email domain not allowed');
  }
}

export async function buildOidcAuthUrl(
  connection: SsoConnection,
  redirectUri: string,
): Promise<OidcAuthResult> {
  const config = asOidcConfig(connection.config);
  const client = await buildClient(config, redirectUri);
  const state = generators.state();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const authUrl = client.authorizationUrl({
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { authUrl, state, codeVerifier };
}

export async function exchangeOidcCode(
  connection: SsoConnection,
  redirectUri: string,
  params: { code: string; state: string },
  codeVerifier: string,
): Promise<SsoUserInfo> {
  const config = asOidcConfig(connection.config);
  const client = await buildClient(config, redirectUri);
  const tokenSet = await client.callback(redirectUri, params, {
    code_verifier: codeVerifier,
    state: params.state,
  });
  const claims = tokenSet.claims();

  const email = (claims.email as string | undefined) ?? '';
  checkAllowedDomain(email, config.allowed_domains);

  return {
    externalId: claims.sub as string,
    email,
    name: (claims.name as string | undefined) ?? email,
  };
}
```

- [ ] **Step 4: Run all sso tests**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/sso/oidc.ts packages/api/src/__tests__/sso.test.ts
git commit -m "feat(sso): OIDC auth URL builder and token exchange

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: SAML service

**Files:**
- Create: `packages/api/src/sso/saml.ts`
- Test: add to `packages/api/src/__tests__/sso.test.ts`

- [ ] **Step 1: Write the failing tests** (append to sso.test.ts)

```typescript
import { buildSamlAuthUrl, validateSamlResponse } from '../sso/saml';

jest.mock('@node-saml/node-saml', () => {
  return {
    SAML: jest.fn().mockImplementation(() => ({
      getAuthorizeUrlAsync: jest.fn().mockResolvedValue('https://idp.example.com/sso?SAMLRequest=abc&RelayState=rs'),
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../sso/saml'`.

- [ ] **Step 3: Implement saml.ts**

Create `packages/api/src/sso/saml.ts`:

```typescript
import { SAML } from '@node-saml/node-saml';
import type { SsoConnection, SsoUserInfo } from './oidc';

export interface SamlConfig {
  idp_sso_url: string;
  idp_entity_id: string;
  idp_certificate: string;
  idp_metadata_url?: string;
  allowed_domains?: string[];
}

function asSamlConfig(config: unknown): SamlConfig {
  return config as SamlConfig;
}

function buildSamlInstance(config: SamlConfig, callbackUrl: string): SAML {
  return new SAML({
    entryPoint: config.idp_sso_url,
    issuer: callbackUrl.replace('/callback', ''), // SP entity ID
    cert: config.idp_certificate,
    callbackUrl,
    wantAssertionsSigned: true,
    signatureAlgorithm: 'sha256',
  });
}

function checkAllowedDomain(email: string, allowedDomains?: string[]): void {
  if (!allowedDomains || allowedDomains.length === 0) return;
  const domain = email.split('@')[1];
  if (!allowedDomains.includes(domain)) {
    throw new Error('Email domain not allowed');
  }
}

export async function buildSamlAuthUrl(
  connection: SsoConnection,
  callbackUrl: string,
  relayState: string,
): Promise<string> {
  const config = asSamlConfig(connection.config);
  const saml = buildSamlInstance(config, callbackUrl);
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

export async function validateSamlResponse(
  connection: SsoConnection,
  callbackUrl: string,
  body: Record<string, unknown>,
): Promise<SsoUserInfo> {
  const config = asSamlConfig(connection.config);
  const saml = buildSamlInstance(config, callbackUrl);
  const { profile } = await saml.validatePostResponseAsync(body);

  if (!profile) throw new Error('SAML validation returned no profile');

  const email: string = (profile.email as string | undefined)
    ?? (profile['urn:oid:1.2.840.113549.1.9.1'] as string | undefined)
    ?? '';
  const givenName = profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] as string | undefined;
  const name = givenName ?? email;

  checkAllowedDomain(email, config.allowed_domains);

  return {
    externalId: profile.nameID as string,
    email,
    name,
  };
}
```

- [ ] **Step 4: Run all sso tests**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/sso/saml.ts packages/api/src/__tests__/sso.test.ts
git commit -m "feat(sso): SAML auth URL builder and assertion validation

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: User provisioning

**Files:**
- Create: `packages/api/src/sso/provisioning.ts`
- Test: add to `packages/api/src/__tests__/sso.test.ts`

- [ ] **Step 1: Write the failing tests** (append to sso.test.ts)

```typescript
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../sso/provisioning'`.

- [ ] **Step 3: Implement provisioning.ts**

Create `packages/api/src/sso/provisioning.ts`:

```typescript
import { query } from '../db';
import type { SsoConnection, SsoUserInfo } from './oidc';

export interface ProvisionedUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

const USER_COLS = 'id, email, name, role';

export async function findOrProvisionUser(
  connection: SsoConnection,
  info: SsoUserInfo,
): Promise<ProvisionedUser> {
  // 1. Lookup by (sso_connection_id, external_id) — fastest path for repeat logins
  const bySSO = await query<ProvisionedUser>(
    `SELECT ${USER_COLS} FROM users WHERE sso_connection_id = $1 AND external_id = $2`,
    [connection.id, info.externalId],
  );
  if (bySSO.rows.length > 0) return bySSO.rows[0];

  // 2. Lookup by email — existing local user first logs in via SSO
  const byEmail = await query<ProvisionedUser>(
    `SELECT ${USER_COLS} FROM users WHERE email = $1`,
    [info.email],
  );
  if (byEmail.rows.length > 0) {
    // Link the SSO identity going forward
    const updated = await query<ProvisionedUser>(
      `UPDATE users SET sso_connection_id = $1, external_id = $2 WHERE id = $3 RETURNING ${USER_COLS}`,
      [connection.id, info.externalId, byEmail.rows[0].id],
    );
    return updated.rows[0];
  }

  // 3. Auto-provision new user
  const inserted = await query<ProvisionedUser>(
    `INSERT INTO users (email, name, sso_connection_id, external_id)
     VALUES ($1, $2, $3, $4)
     RETURNING ${USER_COLS}`,
    [info.email, info.name, connection.id, info.externalId],
  );
  return inserted.rows[0];
}
```

- [ ] **Step 4: Run all sso tests**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/sso/provisioning.ts packages/api/src/__tests__/sso.test.ts
git commit -m "feat(sso): find-or-provision user from SSO identity

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 7: SSO auth router

**Files:**
- Create: `packages/api/src/sso/router.ts`
- Test: `packages/api/src/__tests__/sso.test.ts` (add router tests)

Endpoints:
- `GET /api/auth/sso/connections` — list enabled connections (id + name only, no secrets)
- `GET /api/auth/sso/:connectionId/login` — redirect to IdP
- `GET /api/auth/sso/:connectionId/callback` — OIDC code exchange
- `POST /api/auth/sso/:connectionId/callback` — SAML POST binding

After success: redirect to `<FRONTEND_URL>/sso-callback?token=<jwt>`

- [ ] **Step 1: Write the failing tests** (append to sso.test.ts)

```typescript
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';

// Mock modules used by the router
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

describe('GET /api/auth/sso/connections', () => {
  test('returns list of enabled connections', async () => {
    // mockQuery is already defined above from the db mock
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
      rows: [{ id: 'c1', provider_type: 'oidc', config: { issuer_url: 'https://idp.example.com', client_id: 'cid', client_secret: 'sec' }, enabled: true }],
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
    // Load connection
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', provider_type: 'oidc', config: {}, enabled: true }],
    });
    // State was stored by the login step (inject manually)
    const { stateStore } = require('../sso/state-store');
    stateStore.set('s123', { connectionId: 'c1', codeVerifier: 'verifier', createdAt: Date.now() });

    const res = await request(app).get('/api/auth/sso/c1/callback?code=auth-code&state=s123');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('sso-callback?token=');
    const token = new URL(res.headers.location).searchParams.get('token');
    expect(token).toBeTruthy();
    const decoded = jwt.verify(token!, 'test-secret') as Record<string, unknown>;
    expect(decoded.sub).toBe('user-sso-1');
  });
});

describe('POST /api/auth/sso/:connectionId/callback (SAML)', () => {
  test('validates SAML response and redirects with token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c2', provider_type: 'saml', config: {}, enabled: true }],
    });
    const res = await request(app)
      .post('/api/auth/sso/c2/callback')
      .type('form')
      .send({ SAMLResponse: 'encoded-response', RelayState: 'relay-1' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('sso-callback?token=');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | tail -10
```

Expected: FAIL — Cannot find module `../sso/router` (imported by index).

- [ ] **Step 3: Implement router.ts**

Create `packages/api/src/sso/router.ts`:

```typescript
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { stateStore } from './state-store';
import { buildOidcAuthUrl, exchangeOidcCode } from './oidc';
import { buildSamlAuthUrl, validateSamlResponse } from './saml';
import { findOrProvisionUser } from './provisioning';

const router = Router();

function signToken(userId: string, role: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ sub: userId, role }, secret, { expiresIn } as import('jsonwebtoken').SignOptions);
}

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173';
}

function callbackUrl(req: Request, connectionId: string, protocol: 'oidc' | 'saml'): string {
  const base = process.env.API_BASE_URL
    ?? `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/sso/${connectionId}/callback`;
}

interface SsoConnectionRow {
  id: string;
  provider_type: 'oidc' | 'saml';
  config: Record<string, unknown>;
  enabled: boolean;
  name: string;
}

async function loadConnection(connectionId: string): Promise<SsoConnectionRow | null> {
  const result = await query<SsoConnectionRow>(
    `SELECT id, provider_type, config, enabled, name
     FROM sso_connections WHERE id = $1`,
    [connectionId],
  );
  return result.rows[0] ?? null;
}

// GET /api/auth/sso/connections — public: list enabled connections for login page
router.get('/connections', async (_req: Request, res: Response): Promise<void> => {
  const result = await query<{ id: string; name: string; provider_type: string }>(
    `SELECT id, name, provider_type FROM sso_connections WHERE enabled = true ORDER BY name`,
  );
  res.json(result.rows);
});

// GET /api/auth/sso/:connectionId/login — redirect to IdP
router.get('/:connectionId/login', async (req: Request, res: Response): Promise<void> => {
  const connection = await loadConnection(req.params.connectionId);
  if (!connection || !connection.enabled) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  try {
    if (connection.provider_type === 'oidc') {
      const cbUrl = callbackUrl(req, connection.id, 'oidc');
      const { authUrl, state, codeVerifier } = await buildOidcAuthUrl(connection, cbUrl);
      stateStore.set(state, { connectionId: connection.id, codeVerifier, createdAt: Date.now() });
      res.redirect(authUrl);
    } else {
      const cbUrl = callbackUrl(req, connection.id, 'saml');
      const relayState = crypto.randomUUID();
      stateStore.set(relayState, { connectionId: connection.id, codeVerifier: '', createdAt: Date.now() });
      const samlUrl = await buildSamlAuthUrl(connection, cbUrl, relayState);
      res.redirect(samlUrl);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SSO initiation failed';
    res.status(500).json({ error: msg });
  }
});

// GET /api/auth/sso/:connectionId/callback — OIDC code exchange
router.get('/:connectionId/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query as Record<string, string>;

  const stateEntry = stateStore.get(state);
  if (!stateEntry) {
    res.status(400).json({ error: 'Invalid or expired SSO state' });
    return;
  }

  const connection = await loadConnection(req.params.connectionId);
  if (!connection) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  try {
    const cbUrl = callbackUrl(req, connection.id, 'oidc');
    const userInfo = await exchangeOidcCode(connection, cbUrl, { code, state }, stateEntry.codeVerifier);
    const user = await findOrProvisionUser(connection, userInfo);
    const token = signToken(user.id, user.role);
    res.redirect(`${frontendUrl()}/sso-callback?token=${encodeURIComponent(token)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SSO callback failed';
    res.redirect(`${frontendUrl()}/login?error=${encodeURIComponent(msg)}`);
  }
});

// POST /api/auth/sso/:connectionId/callback — SAML assertion POST binding
router.post('/:connectionId/callback', async (req: Request, res: Response): Promise<void> => {
  const { RelayState } = req.body as Record<string, string>;

  // RelayState is required — it carries the CSRF state token we set at login
  if (!RelayState) {
    res.status(400).json({ error: 'Missing RelayState' });
    return;
  }
  const entry = stateStore.get(RelayState);
  if (!entry) {
    res.status(400).json({ error: 'Invalid or expired SSO state' });
    return;
  }

  const connection = await loadConnection(req.params.connectionId);
  if (!connection) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  try {
    const cbUrl = callbackUrl(req, connection.id, 'saml');
    const userInfo = await validateSamlResponse(connection, cbUrl, req.body as Record<string, unknown>);
    const user = await findOrProvisionUser(connection, userInfo);
    const token = signToken(user.id, user.role);
    res.redirect(`${frontendUrl()}/sso-callback?token=${encodeURIComponent(token)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SAML callback failed';
    res.redirect(`${frontendUrl()}/login?error=${encodeURIComponent(msg)}`);
  }
});

export default router;
```

- [ ] **Step 4: Register router in index.ts**

Add to `packages/api/src/index.ts` (after the auth import line):

```typescript
import ssoRouter from './sso/router';
```

And register it (after the `/api/auth` line):

```typescript
app.use('/api/auth/sso', ssoRouter);
```

Also add `express.urlencoded` middleware (required for SAML POST) before the JSON middleware:

```typescript
app.use(express.urlencoded({ extended: false }));
```

- [ ] **Step 5: Run sso tests**

```bash
npx jest --testPathPattern="__tests__/sso.test.ts" --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/sso/router.ts packages/api/src/index.ts packages/api/src/__tests__/sso.test.ts
git commit -m "feat(sso): SSO auth router — login redirect, OIDC + SAML callbacks

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 8: Fix password-only login for SSO users

**Files:**
- Modify: `packages/api/src/auth/router.ts`
- Test: `packages/api/src/__tests__/auth.test.ts`

When `password_hash` is NULL (SSO-only user), the local login should return 401.

- [ ] **Step 1: Write the failing test** (append to auth.test.ts)

```typescript
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern="__tests__/auth.test.ts" --forceExit 2>&1 | tail -10
```

Expected: FAIL — returns 500 (bcrypt.compare crashes on null) or 200.

- [ ] **Step 3: Add the guard to auth/router.ts**

In `packages/api/src/auth/router.ts`, in the `POST /api/auth/login` handler, after fetching the user, add before the bcrypt.compare call:

```typescript
if (!user.password_hash) {
  res.status(401).json({ error: 'This account uses SSO. Please sign in with your identity provider.' });
  return;
}
```

The SELECT query already fetches `password_hash`; update its type to allow `string | null`:

```typescript
const result = await query<{ id: string; email: string; name: string; role: string; password_hash: string | null }>(
  'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
  [email]
);
```

- [ ] **Step 4: Run auth tests**

```bash
npx jest --testPathPattern="__tests__/auth.test.ts" --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/router.ts packages/api/src/__tests__/auth.test.ts
git commit -m "fix(auth): reject password login for SSO-only accounts

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 9: Admin SSO connection CRUD

**Files:**
- Modify: `packages/api/src/admin/router.ts`
- Create: `packages/api/src/__tests__/admin-sso.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/__tests__/admin-sso.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest --testPathPattern="__tests__/admin-sso.test.ts" --forceExit 2>&1 | tail -10
```

Expected: FAIL — 404 on admin SSO endpoints.

- [ ] **Step 3: Add SSO CRUD to admin/router.ts**

Append to `packages/api/src/admin/router.ts` (before `export default router`):

```typescript
// ── SSO Connections ────────────────────────────────────────────────────────

type SsoProviderType = 'oidc' | 'saml';

// GET /api/admin/sso-connections
router.get('/sso-connections', requireAuth, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const result = await query(
    `SELECT id, name, provider_type, config, enabled, created_at, updated_at
     FROM sso_connections ORDER BY created_at DESC`,
  );
  res.json(result.rows);
});

// POST /api/admin/sso-connections
router.post('/sso-connections', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, provider_type, config } = req.body as Record<string, unknown>;

  if (typeof name !== 'string' || !name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (provider_type !== 'oidc' && provider_type !== 'saml') {
    res.status(400).json({ error: 'provider_type must be "oidc" or "saml"' });
    return;
  }

  const result = await query(
    `INSERT INTO sso_connections (name, provider_type, config)
     VALUES ($1, $2, $3)
     RETURNING id, name, provider_type, config, enabled, created_at, updated_at`,
    [name, provider_type as SsoProviderType, JSON.stringify(config ?? {})],
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/admin/sso-connections/:id
router.patch('/sso-connections/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, config, enabled } = req.body as Record<string, unknown>;

  const existing = await query('SELECT id FROM sso_connections WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (typeof name === 'string') {
    params.push(name);
    updates.push(`name = $${params.length}`);
  }
  if (config !== undefined) {
    params.push(JSON.stringify(config));
    updates.push(`config = $${params.length}`);
  }
  if (typeof enabled === 'boolean') {
    params.push(enabled);
    updates.push(`enabled = $${params.length}`);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  params.push(id);
  const result = await query(
    `UPDATE sso_connections SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, name, provider_type, config, enabled, created_at, updated_at`,
    params,
  );
  res.json(result.rows[0]);
});

// DELETE /api/admin/sso-connections/:id
router.delete('/sso-connections/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const existing = await query('SELECT id FROM sso_connections WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  await query('DELETE FROM sso_connections WHERE id = $1', [id]);
  res.status(204).end();
});
```

- [ ] **Step 4: Run admin-sso tests**

```bash
npx jest --testPathPattern="__tests__/admin-sso.test.ts" --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: PASS.

- [ ] **Step 5: Run all API tests**

```bash
npx jest --forceExit 2>&1 | grep -E "PASS|FAIL|Tests:|Test Suites:"
```

Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/admin/router.ts packages/api/src/__tests__/admin-sso.test.ts
git commit -m "feat(admin): SSO connection CRUD endpoints

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 10: Frontend — SSO callback page

**Files:**
- Create: `packages/web/src/pages/SsoCallback.tsx`
- Modify: `packages/web/src/App.tsx`

Reads `?token=` from URL, stores it, then navigates to `/dashboard`.

- [ ] **Step 1: Create SsoCallback.tsx**

```tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function SsoCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    localStorage.setItem('token', token);
    refreshUser().then(() => navigate('/dashboard', { replace: true }));
  }, []);

  return <p style={{ padding: '2rem' }}>Signing you in…</p>;
}
```

Note: `refreshUser` must be added to `AuthContext` — see next step.

- [ ] **Step 2: Add `refreshUser` to AuthContext**

In `packages/web/src/context/AuthContext.tsx`:

1. Add `refreshUser: () => Promise<void>` to `AuthContextValue`.
2. Implement:

```typescript
async function refreshUser() {
  const u = await api.get<User>('/auth/me');
  setUser(u);
}
```

3. Pass `refreshUser` in the Provider value.

- [ ] **Step 3: Register route in App.tsx**

Add import:
```tsx
import { SsoCallback } from './pages/SsoCallback';
```

Add route (public, outside ProtectedRoute):
```tsx
<Route path="/sso-callback" element={<SsoCallback />} />
```

Place it alongside the `/login` and `/register` routes.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/SsoCallback.tsx packages/web/src/App.tsx packages/web/src/context/AuthContext.tsx
git commit -m "feat(web): SSO callback page — stores token and navigates to dashboard

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 11: Frontend — SSO button on login page

**Files:**
- Modify: `packages/web/src/pages/Login.tsx`

Fetch enabled connections on mount; show a divider and SSO buttons only if connections exist.

- [ ] **Step 1: Update Login.tsx**

Replace file contents with this extended version:

```tsx
import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import styles from './Auth.module.css';

interface SsoConnection {
  id: string;
  name: string;
  provider_type: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(searchParams.get('error') ?? '');
  const [loading, setLoading] = useState(false);
  const [ssoConnections, setSsoConnections] = useState<SsoConnection[]>([]);

  useEffect(() => {
    api.get<SsoConnection[]>('/auth/sso/connections')
      .then(setSsoConnections)
      .catch(() => { /* non-critical */ });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSsoLogin(connectionId: string) {
    window.location.href = `${API_BASE}/auth/sso/${connectionId}/login`;
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Sign in to Green Desk</h1>
        {error && <p className={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input type="email" className={styles.input} value={email}
              onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className={styles.label}>
            Password
            <input type="password" className={styles.input} value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {ssoConnections.length > 0 && (
          <>
            <p className={styles.divider}>or</p>
            {ssoConnections.map((conn) => (
              <button
                key={conn.id}
                className={styles.btnSecondary}
                onClick={() => handleSsoLogin(conn.id)}
              >
                Sign in with {conn.name}
              </button>
            ))}
          </>
        )}

        <p className={styles.footer}>
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for new elements to Auth.module.css**

In `packages/web/src/pages/Auth.module.css`, append:

```css
.divider {
  text-align: center;
  color: #888;
  margin: 12px 0;
  font-size: 0.85rem;
}

.btnSecondary {
  width: 100%;
  padding: 10px;
  margin-top: 8px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 0.95rem;
}

.btnSecondary:hover {
  background: #f5f5f5;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Login.tsx packages/web/src/pages/Auth.module.css
git commit -m "feat(web): show SSO sign-in buttons on login page

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 12: Frontend — Admin SSO Settings page

**Files:**
- Create: `packages/web/src/pages/admin/AdminSSO.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/pages/admin/AdminLayout.tsx`

- [ ] **Step 1: Create AdminSSO.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import styles from './Admin.module.css';

interface SsoConnection {
  id: string;
  name: string;
  provider_type: 'oidc' | 'saml';
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

type ProviderType = 'oidc' | 'saml';

const EMPTY_FORM = { name: '', provider_type: 'oidc' as ProviderType, config: '' };

export function AdminSSO() {
  const [connections, setConnections] = useState<SsoConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SsoConnection[]>('/admin/sso-connections')
      .then(setConnections)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(form.config);
    } catch {
      setFormError('Config must be valid JSON');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<SsoConnection>('/admin/sso-connections', {
        name: form.name,
        provider_type: form.provider_type,
        config: parsedConfig,
      });
      setConnections(prev => [created, ...prev]);
      setForm(EMPTY_FORM);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(conn: SsoConnection) {
    try {
      const updated = await api.patch<SsoConnection>(`/admin/sso-connections/${conn.id}`, {
        enabled: !conn.enabled,
      });
      setConnections(prev => prev.map(c => c.id === conn.id ? updated : c));
    } catch {
      // surface via error state if needed
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this SSO connection? Users linked to it will lose SSO access.')) return;
    try {
      await api.delete(`/admin/sso-connections/${id}`);
      setConnections(prev => prev.filter(c => c.id !== id));
    } catch {
      // surface error
    }
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>SSO Connections</h2>
      </div>

      {loading && <p className={styles.meta}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && (
        <>
          {connections.length === 0 && <p className={styles.meta}>No SSO connections configured.</p>}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(conn => (
                <tr key={conn.id}>
                  <td>{conn.name}</td>
                  <td>{conn.provider_type.toUpperCase()}</td>
                  <td>
                    <span className={`${styles.badge} ${conn.enabled ? styles.badgeAdmin : styles.badgeMember}`}>
                      {conn.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <button className={styles.toggle} onClick={() => handleToggle(conn)}>
                      {conn.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {' '}
                    <button className={styles.toggle} onClick={() => handleDelete(conn.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: '2rem' }}>Add SSO Connection</h3>
          {formError && <p className={styles.error}>{formError}</p>}
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}>
            <label>
              Name
              <input
                className={styles.input ?? ''}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label>
              Type
              <select
                value={form.provider_type}
                onChange={e => setForm(f => ({ ...f, provider_type: e.target.value as ProviderType }))}
              >
                <option value="oidc">OIDC</option>
                <option value="saml">SAML</option>
              </select>
            </label>
            <label>
              Config (JSON)
              <textarea
                rows={6}
                value={form.config}
                onChange={e => setForm(f => ({ ...f, config: e.target.value }))}
                placeholder={form.provider_type === 'oidc'
                  ? '{"issuer_url":"https://...","client_id":"...","client_secret":"...","allowed_domains":["corp.com"]}'
                  : '{"idp_sso_url":"https://...","idp_entity_id":"https://...","idp_certificate":"MIIC..."}'}
                required
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
            </label>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Add Connection'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register route in App.tsx**

Add import:
```tsx
import { AdminSSO } from './pages/admin/AdminSSO';
```

Add route inside the `<AdminRoute>/<AdminLayout>` block:
```tsx
<Route path="/admin/sso" element={<AdminSSO />} />
```

- [ ] **Step 3: Add nav link in AdminLayout.tsx**

Add before the closing `</nav>`:
```tsx
<NavLink
  to="/admin/sso"
  className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
>
  SSO
</NavLink>
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/admin/AdminSSO.tsx packages/web/src/App.tsx packages/web/src/pages/admin/AdminLayout.tsx
git commit -m "feat(web): admin SSO settings page

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 13: Final integration check

- [ ] **Step 1: Run full API test suite**

```bash
cd packages/api
npx jest --forceExit 2>&1 | grep -E "PASS|FAIL|Test Suites:|Tests:"
```

Expected: all PASS, zero failures.

- [ ] **Step 2: TypeScript compile check (API)**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: TypeScript compile check (web)**

```bash
cd ../web
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Final commit**

```bash
cd ../..
git add -A
git commit -m "chore: SSO authentication feature complete — OIDC + SAML

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Summary

| Area | Files |
|------|-------|
| DB migration | `006_sso.sql` |
| API services | `sso/state-store.ts`, `sso/oidc.ts`, `sso/saml.ts`, `sso/provisioning.ts` |
| API routes | `sso/router.ts`, `admin/router.ts` (extended) |
| API tests | `__tests__/sso.test.ts`, `__tests__/admin-sso.test.ts`, `__tests__/auth.test.ts` (extended) |
| Frontend pages | `SsoCallback.tsx`, `AdminSSO.tsx` |
| Frontend wiring | `App.tsx`, `Login.tsx`, `AdminLayout.tsx`, `AuthContext.tsx` |
