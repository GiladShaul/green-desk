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
