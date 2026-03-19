import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';

jest.mock('../db');

const mockQuery = db.query as jest.Mock;

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(role: 'admin' | 'member' = 'member', userId = 'user-1', tenantId = 'tenant-1'): string {
  return jwt.sign({ sub: userId, role, tenantId }, JWT_SECRET, { expiresIn: '1h' });
}

const adminToken = makeToken('admin', 'admin-1');
const memberToken = makeToken('member', 'member-1');

const userA = { id: 'user-1', email: 'alice@example.com', name: 'Alice', role: 'admin', created_at: new Date().toISOString() };
const userB = { id: 'user-2', email: 'bob@example.com', name: 'Bob', role: 'member', created_at: new Date().toISOString() };

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

describe('GET /api/admin/users', () => {
  test('admin can list all users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [userA, userB] });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe(userA.id);
    expect(res.body[1].id).toBe(userB.id);
  });

  test('member cannot list users (403)', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id', () => {
  test('admin can promote a member to admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: userB.id }] }); // exists check
    mockQuery.mockResolvedValueOnce({ rows: [{ ...userB, role: 'admin' }] }); // update

    const res = await request(app)
      .patch(`/api/admin/users/${userB.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  test('admin can demote an admin to member', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: userA.id }] }); // exists check
    mockQuery.mockResolvedValueOnce({ rows: [{ ...userA, role: 'member' }] }); // update

    const res = await request(app)
      .patch(`/api/admin/users/${userA.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'member' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('member');
  });

  test('member cannot update user role (403)', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${userB.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });

  test('returns 400 for invalid role value', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${userB.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'superuser' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when user does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // not found

    const res = await request(app)
      .patch('/api/admin/users/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'member' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${userB.id}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/analytics
// ---------------------------------------------------------------------------

function mockAnalyticsQueries(overrides: {
  totalBookings?: number;
  totalActiveDesks?: number;
  bookingsByFloor?: object[];
  peakDays?: object[];
  peakSlots?: object[];
  topDesks?: object[];
  leastDesks?: object[];
} = {}) {
  const {
    totalBookings = 15,
    totalActiveDesks = 10,
    bookingsByFloor = [{ floor_id: 'f-1', floor_name: 'Floor 1', bookings: '15', active_desks: '10' }],
    peakDays = [{ date: '2024-06-01', bookings: '5' }],
    peakSlots = [{ start_time: '09:00', end_time: '10:00', bookings: '8' }],
    topDesks = [{ desk_id: 'd-1', label: 'A-01', floor_id: 'f-1', floor_name: 'Floor 1', bookings: '5' }],
    leastDesks = [{ desk_id: 'd-2', label: 'A-02', floor_id: 'f-1', floor_name: 'Floor 1', bookings: '0' }],
  } = overrides;

  mockQuery.mockResolvedValueOnce({ rows: [{ count: String(totalBookings) }] });    // total bookings
  mockQuery.mockResolvedValueOnce({ rows: [{ count: String(totalActiveDesks) }] }); // active desk count
  mockQuery.mockResolvedValueOnce({ rows: bookingsByFloor });                        // by floor
  mockQuery.mockResolvedValueOnce({ rows: peakDays });                              // peak days
  mockQuery.mockResolvedValueOnce({ rows: peakSlots });                             // peak slots
  mockQuery.mockResolvedValueOnce({ rows: topDesks });                              // top desks
  mockQuery.mockResolvedValueOnce({ rows: leastDesks });                            // least used
}

describe('GET /api/admin/analytics', () => {
  test('admin gets analytics with default 30-day range', async () => {
    mockAnalyticsQueries();

    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
    expect(res.body.totalBookings).toBe(15);
    expect(typeof res.body.avgDailyBookings).toBe('number');
    expect(typeof res.body.utilizationRate).toBe('number');
    expect(Array.isArray(res.body.bookingsByFloor)).toBe(true);
    expect(Array.isArray(res.body.peakDays)).toBe(true);
    expect(Array.isArray(res.body.peakTimeSlots)).toBe(true);
    expect(Array.isArray(res.body.topDesks)).toBe(true);
    expect(Array.isArray(res.body.leastUsedDesks)).toBe(true);
  });

  test('admin gets analytics with 7-day range', async () => {
    mockAnalyticsQueries({ totalBookings: 5 });

    const res = await request(app)
      .get('/api/admin/analytics?days=7')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(res.body.totalBookings).toBe(5);
  });

  test('admin gets analytics with 90-day range', async () => {
    mockAnalyticsQueries({ totalBookings: 45 });

    const res = await request(app)
      .get('/api/admin/analytics?days=90')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(90);
  });

  test('returns 400 for invalid days value', async () => {
    const res = await request(app)
      .get('/api/admin/analytics?days=15')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('bookingsByFloor contains expected fields', async () => {
    mockAnalyticsQueries();

    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const floor = res.body.bookingsByFloor[0];
    expect(floor).toHaveProperty('floorId');
    expect(floor).toHaveProperty('floorName');
    expect(floor).toHaveProperty('bookings');
    expect(floor).toHaveProperty('utilizationRate');
  });

  test('topDesks and leastUsedDesks contain expected fields', async () => {
    mockAnalyticsQueries();

    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const topDesk = res.body.topDesks[0];
    expect(topDesk).toHaveProperty('deskId');
    expect(topDesk).toHaveProperty('label');
    expect(topDesk).toHaveProperty('floorName');
    expect(topDesk).toHaveProperty('bookings');

    const leastDesk = res.body.leastUsedDesks[0];
    expect(leastDesk).toHaveProperty('deskId');
    expect(leastDesk.bookings).toBe(0);
  });

  test('member cannot access analytics (403)', async () => {
    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/admin/analytics');
    expect(res.status).toBe(401);
  });
});
