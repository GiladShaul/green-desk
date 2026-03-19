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

const memberToken = makeToken('member', 'member-1');
const otherMemberToken = makeToken('member', 'member-2');

const rb1 = {
  id: 'rb-1',
  user_id: 'member-1',
  desk_id: 'desk-1',
  floor_id: 'floor-1',
  day_of_week: 1, // Monday
  start_time: '09:00',
  end_time: '17:00',
  start_date: '2024-01-01',
  end_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// POST /api/recurring-bookings
// ---------------------------------------------------------------------------

describe('POST /api/recurring-bookings', () => {
  test('creates a recurring booking successfully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'desk-1', floor_id: 'floor-1' }] }); // desk exists
    mockQuery.mockResolvedValueOnce({ rows: [] });  // no conflicts
    mockQuery.mockResolvedValueOnce({ rows: [rb1] }); // insert
    // generate call (non-blocking, may fire additional queries but we return before that)

    const res = await request(app)
      .post('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        desk_id: 'desk-1',
        day_of_week: 1,
        start_time: '09:00',
        end_time: '17:00',
        start_date: '2024-01-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('rb-1');
    expect(res.body.day_of_week).toBe(1);
  });

  test('returns 409 when conflicting recurring booking exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'desk-1', floor_id: 'floor-1' }] }); // desk exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rb-existing' }] }); // conflict

    const res = await request(app)
      .post('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', day_of_week: 1, start_time: '09:00', end_time: '17:00', start_date: '2024-01-01' });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when desk does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // desk not found

    const res = await request(app)
      .post('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'nonexistent', day_of_week: 1, start_time: '09:00', end_time: '17:00', start_date: '2024-01-01' });

    expect(res.status).toBe(404);
  });

  test('returns 400 when desk_id is missing', async () => {
    const res = await request(app)
      .post('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ day_of_week: 1, start_time: '09:00', end_time: '17:00', start_date: '2024-01-01' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 for invalid day_of_week', async () => {
    const res = await request(app)
      .post('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', day_of_week: 7, start_time: '09:00', end_time: '17:00', start_date: '2024-01-01' });

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid start_date format', async () => {
    const res = await request(app)
      .post('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', day_of_week: 1, start_time: '09:00', end_time: '17:00', start_date: 'not-a-date' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when end_time is not after start_time', async () => {
    const res = await request(app)
      .post('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', day_of_week: 1, start_time: '17:00', end_time: '09:00', start_date: '2024-01-01' });

    expect(res.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/recurring-bookings')
      .send({ desk_id: 'desk-1', day_of_week: 1, start_time: '09:00', end_time: '17:00', start_date: '2024-01-01' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/recurring-bookings
// ---------------------------------------------------------------------------

describe('GET /api/recurring-bookings', () => {
  test('returns list of recurring bookings for current user', async () => {
    const enriched = { ...rb1, desk_label: 'A-01', floor_name: 'Ground Floor' };
    mockQuery.mockResolvedValueOnce({ rows: [enriched] });

    const res = await request(app)
      .get('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('rb-1');
    expect(res.body[0].desk_label).toBe('A-01');
  });

  test('returns empty array when no recurring bookings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/recurring-bookings')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/recurring-bookings');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/recurring-bookings/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/recurring-bookings/:id', () => {
  test('user can delete their own recurring booking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rb1] }); // fetch
    mockQuery.mockResolvedValueOnce({ rows: [] });    // delete

    const res = await request(app)
      .delete('/api/recurring-bookings/rb-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(204);
  });

  test('user cannot delete another user\'s recurring booking (403)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rb1] }); // owned by member-1

    const res = await request(app)
      .delete('/api/recurring-bookings/rb-1')
      .set('Authorization', `Bearer ${otherMemberToken}`); // member-2

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when recurring booking does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete('/api/recurring-bookings/nonexistent')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).delete('/api/recurring-bookings/rb-1');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recurring-bookings/generate
// ---------------------------------------------------------------------------

describe('POST /api/recurring-bookings/generate', () => {
  test('materializes bookings and returns count', async () => {
    // generate queries: fetch active recurring bookings (empty for simplicity)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no active recurring bookings

    const res = await request(app)
      .post('/api/recurring-bookings/generate')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('created');
    expect(typeof res.body.created).toBe('number');
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/recurring-bookings/generate');
    expect(res.status).toBe(401);
  });
});
