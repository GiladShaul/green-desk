import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';

jest.mock('../db');
const mockQuery = db.query as jest.Mock;

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(tenantId: string, userId: string, role: 'admin' | 'member' = 'member'): string {
  return jwt.sign({ sub: userId, role, tenantId }, JWT_SECRET, { expiresIn: '1h' });
}

const tokenA = makeToken('tenant-a', 'user-a-1');
const tokenB = makeToken('tenant-b', 'user-b-1');

const bookingA = {
  id: 'booking-a-1',
  user_id: 'user-a-1',
  desk_id: 'desk-a-1',
  floor_id: 'floor-a-1',
  floor_name: 'Floor A',
  desk_label: 'A-01',
  date: '2024-06-01',
  start_time: '09:00',
  end_time: '17:00',
  status: 'confirmed',
  tenant_id: 'tenant-a',
  created_at: new Date().toISOString(),
};

const bookingB = {
  id: 'booking-b-1',
  user_id: 'user-b-1',
  desk_id: 'desk-b-1',
  floor_id: 'floor-b-1',
  floor_name: 'Floor B',
  desk_label: 'B-01',
  date: '2024-06-01',
  start_time: '09:00',
  end_time: '17:00',
  status: 'confirmed',
  tenant_id: 'tenant-b',
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.resetAllMocks();
  // Default: all queries return empty results (simulates no cross-tenant access)
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('Multi-tenant isolation — bookings', () => {
  test('tenant A only sees their own bookings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [bookingA] });

    const res = await request(app)
      .get('/api/bookings?date=2024-06-01')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('booking-a-1');
    expect(res.body[0].tenant_id).toBe('tenant-a');

    // Verify DB query was scoped to tenant-a
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('tenant-a');
  });

  test('tenant B only sees their own bookings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [bookingB] });

    const res = await request(app)
      .get('/api/bookings?date=2024-06-01')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('booking-b-1');
    expect(res.body[0].tenant_id).toBe('tenant-b');

    // Verify DB query was scoped to tenant-b
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('tenant-b');
  });

  test('tenant A querying bookings is NOT given tenant-b data (cross-tenant isolation)', async () => {
    // Default mock returns empty — simulating that tenant-b bookings are invisible to tenant-a
    const res = await request(app)
      .get('/api/bookings?date=2024-06-01')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);

    // Verify query scoped to tenant-a, not tenant-b
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('tenant-a');
    expect(params).not.toContain('tenant-b');
  });

  test('tenant A cannot delete tenant B booking (returns 404)', async () => {
    // Default mock returns empty rows — booking-b-1 not found in tenant-a scope
    const res = await request(app)
      .delete('/api/bookings/booking-b-1')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);

    // Verify existence check was scoped to tenant-a
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('tenant-a');
    expect(params).not.toContain('tenant-b');
  });

  test('tenant B cannot delete tenant A booking (returns 404)', async () => {
    // Default mock returns empty rows — booking-a-1 not found in tenant-b scope
    const res = await request(app)
      .delete('/api/bookings/booking-a-1')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);

    // Verify existence check was scoped to tenant-b
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('tenant-b');
    expect(params).not.toContain('tenant-a');
  });
});

describe('Multi-tenant isolation — floors', () => {
  const floorA = { id: 'floor-a-1', name: 'Floor A', tenant_id: 'tenant-a', created_at: new Date().toISOString() };
  const floorB = { id: 'floor-b-1', name: 'Floor B', tenant_id: 'tenant-b', created_at: new Date().toISOString() };

  test('tenant A only sees their own floors', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [floorA] });

    const res = await request(app)
      .get('/api/floors')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('floor-a-1');
    expect(res.body[0].tenant_id).toBe('tenant-a');
  });

  test('tenant B only sees their own floors', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [floorB] });

    const res = await request(app)
      .get('/api/floors')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('floor-b-1');
    expect(res.body[0].tenant_id).toBe('tenant-b');
  });

  test('tenant A querying floors is NOT given tenant-b floors', async () => {
    // Default: empty result — tenant-b floors are not visible to tenant-a
    const res = await request(app)
      .get('/api/floors')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('Multi-tenant isolation — token without tenantId is rejected', () => {
  test('request with legacy token (no tenantId) returns 401', async () => {
    const legacyToken = jwt.sign({ sub: 'user-old-1', role: 'member' }, JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/api/bookings?date=2024-06-01')
      .set('Authorization', `Bearer ${legacyToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/session expired/i);
  });
});
