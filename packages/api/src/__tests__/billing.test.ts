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
