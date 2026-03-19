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
