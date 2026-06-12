# Stripe Usage-Based Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Stripe so Green Desk can charge tenants on a per-seat model with free/starter/pro plans, webhook-driven subscription lifecycle, and plan enforcement on floors and user creation.

**Architecture:** A self-contained `billing/` module (`stripe.ts`, `router.ts`, `webhook.ts`, `plans.ts`) sits alongside existing feature modules. The webhook route is registered with `express.raw()` in `index.ts` BEFORE `express.json()` to capture raw body for Stripe signature verification. Plan enforcement is injected at `POST /api/floors` (floor limit) and a new `POST /api/admin/users` (seat limit) endpoint.

**Tech Stack:** Express.js + TypeScript, PostgreSQL via `node-pg`, `stripe@^14` Node SDK, Jest + supertest + `jest.mock` for tests, React + Vite frontend.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/api/migrations/009_billing.sql` | Create | Adds Stripe billing columns to tenants |
| `packages/api/src/billing/stripe.ts` | Create | Exports configured Stripe SDK client |
| `packages/api/src/billing/plans.ts` | Create | Plan limit constants + `getTenantPlanLimits` helper |
| `packages/api/src/billing/router.ts` | Create | `GET /status`, `POST /checkout`, `POST /portal` |
| `packages/api/src/billing/webhook.ts` | Create | `POST /webhook` handler (raw body + signature verify) |
| `packages/api/src/__tests__/billing.test.ts` | Create | All billing tests |
| `packages/web/src/pages/admin/AdminBilling.tsx` | Create | Billing page (plan info, upgrade/manage buttons) |
| `packages/api/src/index.ts` | Modify | Register webhook raw route before `express.json()`; mount billing router |
| `packages/api/src/admin/router.ts` | Modify | Add `POST /users` (invite) with seat limit enforcement |
| `packages/api/src/floors/router.ts` | Modify | Add floor limit enforcement to `POST /` |
| `packages/web/src/App.tsx` | Modify | Add `/admin/billing` route |
| `packages/web/src/pages/admin/AdminLayout.tsx` | Modify | Add Billing nav link |
| `.env.example` | Modify | Document Stripe env vars |

---

### Task 1: DB Migration — add billing columns to tenants

**Files:**
- Create: `packages/api/migrations/009_billing.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Migration: 009_billing
-- Description: Add Stripe billing columns to tenants table

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_email          TEXT,
  ADD COLUMN IF NOT EXISTS plan_seats_limit        INTEGER,
  ADD COLUMN IF NOT EXISTS current_period_end      TIMESTAMPTZ;
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/migrations/009_billing.sql
git commit -m "chore(billing): add stripe billing columns to tenants table

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Stripe client + plan constants

**Files:**
- Create: `packages/api/src/billing/stripe.ts`
- Create: `packages/api/src/billing/plans.ts`

- [ ] **Step 1: Install stripe SDK**

```bash
cd packages/api && npm install stripe
```

- [ ] **Step 2: Write failing unit tests for plan helpers**

Create `packages/api/src/__tests__/plans.test.ts`:

```typescript
import { getPlanLimits, PLAN_LIMITS, getTenantPlanLimits } from '../billing/plans';
import * as db from '../db';

jest.mock('../db');
const mockQuery = db.query as jest.Mock;

describe('getPlanLimits', () => {
  test('free plan: 5 users, 1 floor', () => {
    const l = getPlanLimits('free');
    expect(l.maxUsers).toBe(5);
    expect(l.maxFloors).toBe(1);
  });

  test('starter plan: 25 users, unlimited floors', () => {
    const l = getPlanLimits('starter');
    expect(l.maxUsers).toBe(25);
    expect(l.maxFloors).toBeNull();
  });

  test('pro plan: unlimited users and floors', () => {
    const l = getPlanLimits('pro');
    expect(l.maxUsers).toBeNull();
    expect(l.maxFloors).toBeNull();
  });

  test('unknown plan falls back to free limits', () => {
    const l = getPlanLimits('unknown');
    expect(l.maxUsers).toBe(5);
  });
});

describe('getTenantPlanLimits', () => {
  beforeEach(() => jest.resetAllMocks());

  test('returns plan limits for a free tenant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'free', plan_seats_limit: null }] });
    const result = await getTenantPlanLimits('tenant-1');
    expect(result.plan).toBe('free');
    expect(result.seatsLimit).toBe(5);
    expect(result.limits.maxFloors).toBe(1);
  });

  test('uses custom plan_seats_limit when set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'starter', plan_seats_limit: 10 }] });
    const result = await getTenantPlanLimits('tenant-1');
    expect(result.seatsLimit).toBe(10); // overrides default 25
  });
});
```

- [ ] **Step 3: Run tests — verify FAIL**

```bash
cd packages/api && npm test -- --testPathPattern=plans --forceExit 2>&1 | tail -15
```
Expected: FAIL (module not found)

- [ ] **Step 5: Create `packages/api/src/billing/stripe.ts`**

```typescript
import Stripe from 'stripe';

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret && process.env.NODE_ENV !== 'test') {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export const stripe = new Stripe(secret ?? 'sk_test_placeholder', {
  apiVersion: '2024-06-20',
});
```

- [ ] **Step 6: Create `packages/api/src/billing/plans.ts`**

```typescript
import { query } from '../db';

export interface PlanLimits {
  maxUsers: number | null;   // null = unlimited
  maxFloors: number | null;  // null = unlimited
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:    { maxUsers: 5,    maxFloors: 1 },
  starter: { maxUsers: 25,   maxFloors: null },
  pro:     { maxUsers: null, maxFloors: null },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['free'];
}

export async function getTenantPlanLimits(tenantId: string): Promise<{
  plan: string;
  limits: PlanLimits;
  seatsLimit: number | null;
}> {
  const result = await query<{ plan: string; plan_seats_limit: number | null }>(
    'SELECT plan, plan_seats_limit FROM tenants WHERE id = $1',
    [tenantId]
  );
  const row = result.rows[0];
  const plan = row?.plan ?? 'free';
  const limits = getPlanLimits(plan);
  return { plan, limits, seatsLimit: row?.plan_seats_limit ?? limits.maxUsers };
}
```

- [ ] **Step 7: Run tests — verify PASS**

```bash
cd packages/api && npm test -- --testPathPattern=plans --forceExit 2>&1 | tail -15
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/billing/stripe.ts packages/api/src/billing/plans.ts packages/api/src/__tests__/plans.test.ts packages/api/package.json packages/api/package-lock.json
git commit -m "feat(billing): stripe client and plan limits constants

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: GET /api/billing/status — TDD

**Files:**
- Create: `packages/api/src/billing/router.ts`
- Create: `packages/api/src/__tests__/billing.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/__tests__/billing.test.ts`:

```typescript
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';
import { stripe } from '../billing/stripe';

// Explicit factory mock — jest automock doesn't recurse into nested Stripe namespaces
jest.mock('../billing/stripe', () => ({
  stripe: {
    customers:     { create: jest.fn() },
    checkout:      { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    webhooks:      { constructEvent: jest.fn() },
  },
}));
jest.mock('../db');

const mockStripe = stripe as jest.Mocked<typeof stripe>;
const mockQuery = db.query as jest.Mock;
const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(tenantId: string, userId: string, role: 'admin' | 'member' = 'admin'): string {
  return jwt.sign({ sub: userId, role, tenantId }, JWT_SECRET, { expiresIn: '1h' });
}

const adminToken = makeToken('tenant-1', 'user-1');

describe('GET /api/billing/status', () => {
  beforeEach(() => jest.resetAllMocks());

  test('returns plan info for tenant', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        plan: 'free',
        stripe_customer_id: null,
        stripe_subscription_id: null,
        billing_email: null,
        plan_seats_limit: null,
        current_period_end: null,
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const res = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('free');
    expect(res.body.seatsUsed).toBe(3);
    expect(res.body.seatsLimit).toBe(5);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/billing/status');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin', async () => {
    const memberToken = makeToken('tenant-1', 'user-2', 'member');
    const res = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -20
```
Expected: FAIL (module not found)

- [ ] **Step 3: Create `packages/api/src/billing/router.ts`**

```typescript
import { Router, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { getPlanLimits } from './plans';

const router = Router();

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin access required' });
    return;
  }
  next();
}

// GET /api/billing/status
router.get('/status', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;

  const tenantResult = await query<{
    plan: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    billing_email: string | null;
    plan_seats_limit: number | null;
    current_period_end: string | null;
  }>(
    'SELECT plan, stripe_customer_id, stripe_subscription_id, billing_email, plan_seats_limit, current_period_end FROM tenants WHERE id = $1',
    [tenantId]
  );

  if (tenantResult.rows.length === 0) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  const tenant = tenantResult.rows[0];
  const limits = getPlanLimits(tenant.plan);

  const userCountResult = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM users WHERE tenant_id = $1',
    [tenantId]
  );
  const seatsUsed = parseInt(userCountResult.rows[0].count, 10);

  res.json({
    plan: tenant.plan,
    seatsUsed,
    seatsLimit: tenant.plan_seats_limit ?? limits.maxUsers,
    floorsLimit: limits.maxFloors,
    subscriptionStatus: tenant.stripe_subscription_id ? 'active' : 'none',
    currentPeriodEnd: tenant.current_period_end,
    billingEmail: tenant.billing_email,
    hasCustomer: !!tenant.stripe_customer_id,
  });
});

export default router;
```

- [ ] **Step 4: Register billing router in `packages/api/src/index.ts`**

Add after the existing router imports:
```typescript
import billingRouter from './billing/router';
```

Add after the existing `app.use(...)` router registrations (before the `if (require.main === module)` block):
```typescript
app.use('/api/billing', billingRouter);
```

- [ ] **Step 5: Run test — verify PASS**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/billing/router.ts packages/api/src/__tests__/billing.test.ts packages/api/src/index.ts
git commit -m "feat(billing): GET /api/billing/status endpoint

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: Plan enforcement — floor limit + seat limit (TDD)

**Files:**
- Modify: `packages/api/src/floors/router.ts`
- Modify: `packages/api/src/admin/router.ts`
- Modify: `packages/api/src/__tests__/billing.test.ts`

- [ ] **Step 1: Append plan enforcement tests to `billing.test.ts`**

```typescript
describe('Plan enforcement — floors', () => {
  beforeEach(() => jest.resetAllMocks());

  test('free plan: rejects creating 2nd floor with 402', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'free', plan_seats_limit: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // already has 1 floor

    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Floor 2', building: 'HQ', floor_number: 2 });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/upgrade/i);
  });

  test('starter plan: allows multiple floors', async () => {
    // starter has maxFloors=null so floor count query is skipped — only getTenantPlanLimits + INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'starter', plan_seats_limit: 25 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'floor-new', name: 'Floor 6', building: 'HQ', floor_number: 6, created_at: new Date().toISOString() }],
    });

    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Floor 6', building: 'HQ', floor_number: 6 });

    expect(res.status).toBe(201);
  });
});

describe('Plan enforcement — users', () => {
  beforeEach(() => jest.resetAllMocks());

  test('free plan: rejects inviting 6th user with 402', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'free', plan_seats_limit: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] }); // 5 users already

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'New User', email: 'new@example.com', password: 'Password1!' });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/upgrade/i);
  });

  test('free plan: allows inviting 5th user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'free', plan_seats_limit: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '4' }] });   // 4 users so far
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // email uniqueness check
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-new', email: 'new@example.com', name: 'New User', role: 'member', created_at: new Date().toISOString() }],
    });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'New User', email: 'new@example.com', password: 'Password1!' });

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -30
```
Expected: FAIL (floors enforcement missing, admin POST /users endpoint missing)

- [ ] **Step 3: Add floor limit enforcement to `packages/api/src/floors/router.ts`**

Add import at top of file:
```typescript
import { getTenantPlanLimits } from '../billing/plans';
```

In the `POST /` handler, add this block BEFORE the INSERT query (after the input validation block):

```typescript
  // Check floor limit for current plan
  const { limits } = await getTenantPlanLimits(tenantId);
  if (limits.maxFloors !== null) {
    const floorCountResult = await query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM floors WHERE tenant_id = $1',
      [tenantId]
    );
    if (parseInt(floorCountResult.rows[0].count, 10) >= limits.maxFloors) {
      res.status(402).json({
        error: `Floor limit reached for your plan. Upgrade to add more floors.`,
        upgradeUrl: '/api/billing/checkout',
      });
      return;
    }
  }
```

- [ ] **Step 4: Add `POST /admin/users` to `packages/api/src/admin/router.ts`**

Add import at top of file:
```typescript
import { getTenantPlanLimits } from '../billing/plans';
```

Append BEFORE `export default router`:

```typescript
// POST /api/admin/users — invite/create a member (admin only)
router.post('/users', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, email, password } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }

  // Check seat limit
  const { seatsLimit } = await getTenantPlanLimits(tenantId);
  if (seatsLimit !== null) {
    const countResult = await query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM users WHERE tenant_id = $1',
      [tenantId]
    );
    if (parseInt(countResult.rows[0].count, 10) >= seatsLimit) {
      res.status(402).json({
        error: `Seat limit reached for your plan. Upgrade to add more users.`,
        upgradeUrl: '/api/billing/checkout',
      });
      return;
    }
  }

  // Check email uniqueness within tenant
  const existing = await query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
    [email.trim().toLowerCase(), tenantId]
  );
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'A user with that email already exists' });
    return;
  }

  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await query<{ id: string; email: string; name: string; role: string; created_at: string }>(
    'INSERT INTO users (email, password_hash, name, role, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role, created_at',
    [email.trim().toLowerCase(), passwordHash, name.trim(), 'member', tenantId]
  );
  res.status(201).json(result.rows[0]);
});
```

- [ ] **Step 5: Run billing tests — verify PASS**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -30
```
Expected: PASS

- [ ] **Step 6: Run full test suite — ensure nothing broken**

```bash
cd packages/api && npm test --forceExit 2>&1 | tail -30
```
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/billing/plans.ts packages/api/src/floors/router.ts packages/api/src/admin/router.ts packages/api/src/__tests__/billing.test.ts
git commit -m "feat(billing): plan enforcement — floor and seat limits with 402 responses

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: Stripe Checkout + Portal endpoints (TDD)

**Files:**
- Modify: `packages/api/src/billing/router.ts`
- Modify: `packages/api/src/__tests__/billing.test.ts`

- [ ] **Step 1: Append Checkout + Portal tests to `billing.test.ts`**

```typescript
describe('POST /api/billing/checkout', () => {
  beforeEach(() => jest.resetAllMocks());

  test('creates a checkout session and returns URL', async () => {
    process.env.STRIPE_STARTER_PRICE_ID = 'price_starter_test';
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'free', stripe_customer_id: null, billing_email: null }] });
    (mockStripe.customers.create as jest.Mock).mockResolvedValueOnce({ id: 'cus_test123' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE stripe_customer_id
    (mockStripe.checkout.sessions.create as jest.Mock).mockResolvedValueOnce({ url: 'https://checkout.stripe.com/test' });

    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ planId: 'starter' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/test');
  });

  test('returns 400 for invalid planId', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ planId: 'enterprise' });

    expect(res.status).toBe(400);
  });

  test('reuses existing stripe customer', async () => {
    process.env.STRIPE_STARTER_PRICE_ID = 'price_starter_test';
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'free', stripe_customer_id: 'cus_existing', billing_email: null }] });
    (mockStripe.checkout.sessions.create as jest.Mock).mockResolvedValueOnce({ url: 'https://checkout.stripe.com/test2' });

    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ planId: 'starter' });

    expect(res.status).toBe(200);
    expect(mockStripe.customers.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/portal', () => {
  beforeEach(() => jest.resetAllMocks());

  test('creates a portal session and returns URL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_test123' }] });
    (mockStripe.billingPortal.sessions.create as jest.Mock).mockResolvedValueOnce({ url: 'https://billing.stripe.com/portal' });

    const res = await request(app)
      .post('/api/billing/portal')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://billing.stripe.com/portal');
  });

  test('returns 400 if no stripe customer yet', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_customer_id: null }] });

    const res = await request(app)
      .post('/api/billing/portal')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -20
```

- [ ] **Step 3: Add `POST /checkout` and `POST /portal` to `billing/router.ts`**

Add import at top of `billing/router.ts`:
```typescript
import { stripe } from './stripe';
```

Append before `export default router`:

```typescript
// POST /api/billing/checkout — create Stripe Checkout Session for plan upgrade
router.post('/checkout', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { planId } = req.body as { planId?: string };
  const tenantId = req.user!.tenantId;

  if (planId !== 'starter' && planId !== 'pro') {
    res.status(400).json({ error: 'planId must be "starter" or "pro"' });
    return;
  }

  const priceId = planId === 'starter'
    ? process.env.STRIPE_STARTER_PRICE_ID
    : process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) {
    res.status(500).json({ error: `STRIPE_${planId.toUpperCase()}_PRICE_ID not configured` });
    return;
  }

  const tenantResult = await query<{ plan: string; stripe_customer_id: string | null; billing_email: string | null }>(
    'SELECT plan, stripe_customer_id, billing_email FROM tenants WHERE id = $1',
    [tenantId]
  );
  const tenant = tenantResult.rows[0];

  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: tenant.billing_email ?? undefined,
      metadata: { tenantId },
    });
    customerId = customer.id;
    await query('UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2', [customerId, tenantId]);
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/admin/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/admin/billing`,
    metadata: { tenantId, planId },  // planId needed so webhook can update plan column
  });

  res.json({ url: session.url });
});

// POST /api/billing/portal — create Stripe Customer Portal session
router.post('/portal', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;

  const tenantResult = await query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  const customerId = tenantResult.rows[0]?.stripe_customer_id;

  if (!customerId) {
    res.status(400).json({ error: 'No active Stripe customer. Please subscribe first.' });
    return;
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/admin/billing`,
  });

  res.json({ url: portalSession.url });
});
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/router.ts packages/api/src/__tests__/billing.test.ts
git commit -m "feat(billing): POST /api/billing/checkout and /portal Stripe integration

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Stripe Webhook Handler (TDD)

**Files:**
- Create: `packages/api/src/billing/webhook.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/__tests__/billing.test.ts`

- [ ] **Step 1: Append webhook tests to `billing.test.ts`**

```typescript
describe('POST /api/billing/webhook', () => {
  const webhookSecret = 'whsec_test';
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

  beforeEach(() => jest.resetAllMocks());

  function makeWebhookEvent(type: string, dataObject: object): object {
    return { id: 'evt_test', type, data: { object: dataObject } };
  }

  test('checkout.session.completed activates subscription and updates plan', async () => {
    (mockStripe.webhooks.constructEvent as jest.Mock).mockReturnValueOnce(
      makeWebhookEvent('checkout.session.completed', {
        metadata: { tenantId: 'tenant-1', planId: 'starter' },
        subscription: 'sub_123',
        customer: 'cus_123',
      })
    );
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'checkout.session.completed' }));

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('plan = $3'),
      expect.arrayContaining(['sub_123', 'cus_123', 'starter', 'tenant-1'])
    );
  });

  test('customer.subscription.deleted downgrades to free', async () => {
    (mockStripe.webhooks.constructEvent as jest.Mock).mockReturnValueOnce(
      makeWebhookEvent('customer.subscription.deleted', {
        metadata: { tenantId: 'tenant-1' },
        id: 'sub_123',
      })
    );
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'customer.subscription.deleted' }));

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("plan = 'free'"),
      expect.arrayContaining(['tenant-1'])
    );
  });

  test('returns 400 on invalid signature', async () => {
    (mockStripe.webhooks.constructEvent as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', 'bad_sig')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -20
```

- [ ] **Step 3: Create `packages/api/src/billing/webhook.ts`**

```typescript
import { Request, Response } from 'express';
import { stripe } from './stripe';
import { query } from '../db';

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not configured' });
    return;
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
  } catch (err) {
    res.status(400).json({ error: `Webhook signature verification failed: ${(err as Error).message}` });
    return;
  }

  const data = event.data.object as Record<string, unknown>;

  switch (event.type) {
    case 'checkout.session.completed': {
      const meta = data.metadata as Record<string, string> | undefined;
      const tenantId = meta?.tenantId;
      const planId = meta?.planId;
      const subscriptionId = data.subscription as string;
      const customerId = data.customer as string;
      if (tenantId && planId) {
        await query(
          'UPDATE tenants SET stripe_subscription_id = $1, stripe_customer_id = $2, plan = $3 WHERE id = $4',
          [subscriptionId, customerId, planId, tenantId]
        );
      }
      break;
    }

    case 'invoice.paid': {
      const subscriptionId = data.subscription as string;
      const lines = data.lines as { data: Array<{ period: { end: number } }> } | undefined;
      const periodEnd = lines?.data[0]?.period?.end;
      if (subscriptionId && periodEnd) {
        const periodEndDate = new Date(periodEnd * 1000).toISOString();
        await query(
          'UPDATE tenants SET current_period_end = $1 WHERE stripe_subscription_id = $2',
          [periodEndDate, subscriptionId]
        );
      }
      break;
    }

    case 'invoice.payment_failed': {
      console.warn(`[billing] invoice.payment_failed for subscription: ${data.subscription}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const tenantId = (data.metadata as Record<string, string>)?.tenantId;
      if (tenantId) {
        await query(
          "UPDATE tenants SET plan = 'free', stripe_subscription_id = NULL, current_period_end = NULL WHERE id = $1",
          [tenantId]
        );
      }
      break;
    }

    default:
      break;
  }

  res.json({ received: true });
}
```

- [ ] **Step 4: Register raw webhook route in `packages/api/src/index.ts` BEFORE `express.json()`**

Add import:
```typescript
import { handleStripeWebhook } from './billing/webhook';
```

Add this line BEFORE `app.use(express.urlencoded({ extended: false }))`:
```typescript
// Stripe webhook — raw body required for signature verification
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
```

- [ ] **Step 5: Run billing tests — verify PASS**

```bash
cd packages/api && npm test -- --testPathPattern=billing --forceExit 2>&1 | tail -20
```

- [ ] **Step 6: Run full test suite**

```bash
cd packages/api && npm test --forceExit 2>&1 | tail -30
```
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/billing/webhook.ts packages/api/src/index.ts packages/api/src/__tests__/billing.test.ts
git commit -m "feat(billing): Stripe webhook handler — subscription lifecycle events

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 7: Frontend Billing Page

**Files:**
- Create: `packages/web/src/pages/admin/AdminBilling.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/pages/admin/AdminLayout.tsx`

- [ ] **Step 1: Create `packages/web/src/pages/admin/AdminBilling.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

interface BillingStatus {
  plan: string;
  seatsUsed: number;
  seatsLimit: number | null;
  floorsLimit: number | null;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  billingEmail: string | null;
}

export function AdminBilling() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    api.get<BillingStatus>('/billing/status')
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(planId: 'starter' | 'pro') {
    setActionLoading(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/checkout', { planId });
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setActionLoading(false);
    }
  }

  async function handleManage() {
    setActionLoading(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/portal', {});
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setActionLoading(false);
    }
  }

  if (loading) return <p>Loading billing info…</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!status) return null;

  const isNearLimit = status.seatsLimit !== null && status.seatsUsed >= status.seatsLimit - 1;

  return (
    <div style={{ maxWidth: 600 }}>
      <h1>Billing</h1>

      {isNearLimit && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffc107',
          borderRadius: 6,
          padding: '10px 16px',
          marginBottom: 20,
        }}>
          {status.seatsLimit !== null
            ? `${status.seatsUsed}/${status.seatsLimit} seats used — upgrade to add more users`
            : `${status.seatsUsed} seats used`}
        </div>
      )}

      <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 24 }}>
        <tbody>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600, width: 180 }}>Plan</td>
            <td style={{ textTransform: 'capitalize' }}>{status.plan}</td>
          </tr>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600 }}>Seats used</td>
            <td>
              {status.seatsUsed}
              {status.seatsLimit !== null ? ` / ${status.seatsLimit}` : ' (unlimited)'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600 }}>Floors limit</td>
            <td>{status.floorsLimit !== null ? status.floorsLimit : 'Unlimited'}</td>
          </tr>
          <tr>
            <td style={{ padding: '8px 0', fontWeight: 600 }}>Subscription</td>
            <td style={{ textTransform: 'capitalize' }}>{status.subscriptionStatus}</td>
          </tr>
          {status.currentPeriodEnd && (
            <tr>
              <td style={{ padding: '8px 0', fontWeight: 600 }}>Next billing date</td>
              <td>{new Date(status.currentPeriodEnd).toLocaleDateString()}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {status.plan === 'free' && (
          <>
            <button
              onClick={() => handleUpgrade('starter')}
              disabled={actionLoading}
              style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Upgrade to Starter
            </button>
            <button
              onClick={() => handleUpgrade('pro')}
              disabled={actionLoading}
              style={{ padding: '10px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Upgrade to Pro
            </button>
          </>
        )}
        {status.plan !== 'free' && (
          <button
            onClick={handleManage}
            disabled={actionLoading}
            style={{ padding: '10px 20px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Manage Subscription
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route to `packages/web/src/App.tsx`**

Add import:
```typescript
import { AdminBilling } from './pages/admin/AdminBilling';
```

Inside the `<AdminLayout>` route group, add:
```tsx
<Route path="/admin/billing" element={<AdminBilling />} />
```

- [ ] **Step 3: Add Billing nav link to `packages/web/src/pages/admin/AdminLayout.tsx`**

After the Integrations `<NavLink>`, add:
```tsx
<NavLink
  to="/admin/billing"
  className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
>
  Billing
</NavLink>
```

- [ ] **Step 4: Verify frontend builds without errors**

```bash
cd packages/web && npm run build 2>&1 | tail -20
```
Expected: Compiled successfully

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/admin/AdminBilling.tsx packages/web/src/App.tsx packages/web/src/pages/admin/AdminLayout.tsx
git commit -m "feat(billing): admin billing page with plan info, upgrade, and manage flows

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 8: Document Stripe environment variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append Stripe section to `.env.example`**

```
# ─── Stripe billing ─────────────────────────────────────────────────────────────
# Stripe secret key — use test mode (sk_test_*) for development
STRIPE_SECRET_KEY=

# Stripe publishable key — used by frontend for Stripe.js
STRIPE_PUBLISHABLE_KEY=

# Stripe webhook endpoint secret (from Dashboard → Webhooks → Signing secret)
STRIPE_WEBHOOK_SECRET=

# Stripe Price IDs — create in Dashboard → Products → Add Product
STRIPE_STARTER_PRICE_ID=
STRIPE_PRO_PRICE_ID=

# Public URL for Stripe redirect callbacks (no trailing slash)
APP_URL=http://localhost:5173
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(billing): document Stripe environment variables in .env.example

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Summary

After all tasks complete:

| Endpoint | Description |
|----------|-------------|
| `GET /api/billing/status` | Plan, seats used/limit, subscription status |
| `POST /api/billing/checkout` | Create Stripe Checkout Session (upgrade) |
| `POST /api/billing/portal` | Create Stripe Customer Portal session (manage) |
| `POST /api/billing/webhook` | Handle Stripe events (raw body, signature verified) |
| `POST /api/admin/users` | Invite user (with seat limit enforcement) |
| `POST /api/floors` | Create floor (with floor limit enforcement) |

**Plan limits enforced:**
- Free: max 5 users, max 1 floor → 402 on violation
- Starter: max 25 users, unlimited floors
- Pro: unlimited

**Webhook events handled:** `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
