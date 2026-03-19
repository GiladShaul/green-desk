import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';

jest.mock('../db');

const mockQuery = db.query as jest.Mock;

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(role: 'admin' | 'member' = 'member', userId = 'user-1'): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: '1h' });
}

const adminToken = makeToken('admin', 'admin-1');
const memberToken = makeToken('member', 'member-1');
const otherMemberToken = makeToken('member', 'member-2');

const desk1 = { id: 'desk-1', floor_id: 'floor-1', label: 'A-01', x_position: 100, y_position: 100, status: 'active', created_at: new Date().toISOString() };

const booking1 = {
  id: 'booking-1',
  desk_id: 'desk-1',
  user_id: 'member-1',
  date: '2024-06-01',
  start_time: '09:00',
  end_time: '10:00',
  status: 'confirmed',
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: return empty rows for any unmatched query (e.g. email-related lookups)
  mockQuery.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// POST /api/bookings
// ---------------------------------------------------------------------------

describe('POST /api/bookings', () => {
  test('authenticated user can create a booking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'desk-1' }] }); // desk exists
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // no conflicts
    mockQuery.mockResolvedValueOnce({ rows: [booking1] });          // insert

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', date: '2024-06-01', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('booking-1');
    expect(res.body.status).toBe('confirmed');
  });

  test('returns 409 when time slot conflicts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'desk-1' }] }); // desk exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'booking-x' }] }); // conflict found

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', date: '2024-06-01', start_time: '09:30', end_time: '10:30' });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when desk does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // desk not found

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'nonexistent', date: '2024-06-01', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(404);
  });

  test('returns 400 when desk_id is missing', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ date: '2024-06-01', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 for invalid date format', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', date: 'not-a-date', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid time format', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', date: '2024-06-01', start_time: '9am', end_time: '10:00' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when end_time is not after start_time', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1', date: '2024-06-01', start_time: '10:00', end_time: '09:00' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ desk_id: 'desk-1', date: '2024-06-01', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/bookings/me
// ---------------------------------------------------------------------------

describe('GET /api/bookings/me', () => {
  test('returns current user bookings', async () => {
    const enriched = { ...booking1, desk_label: 'A-01', floor_id: 'floor-1' };
    mockQuery.mockResolvedValueOnce({ rows: [enriched] });

    const res = await request(app)
      .get('/api/bookings/me')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('booking-1');
    expect(res.body[0].desk_label).toBe('A-01');
  });

  test('returns empty array when no bookings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/bookings/me')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/bookings/me');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/bookings
// ---------------------------------------------------------------------------

describe('GET /api/bookings', () => {
  test('returns bookings for a date', async () => {
    const enriched = { ...booking1, desk_label: 'A-01', floor_id: 'floor-1' };
    mockQuery.mockResolvedValueOnce({ rows: [enriched] });

    const res = await request(app)
      .get('/api/bookings?date=2024-06-01')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('returns bookings for a date and floor', async () => {
    const enriched = { ...booking1, desk_label: 'A-01', floor_id: 'floor-1' };
    mockQuery.mockResolvedValueOnce({ rows: [enriched] });

    const res = await request(app)
      .get('/api/bookings?date=2024-06-01&floorId=floor-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // Query should have been called with floorId filter
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('d.floor_id'),
      ['2024-06-01', 'floor-1']
    );
  });

  test('returns 400 when date is missing', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 for invalid date format', async () => {
    const res = await request(app)
      .get('/api/bookings?date=06-01-2024')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/bookings?date=2024-06-01');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/bookings/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/bookings/:id', () => {
  test('user can cancel their own booking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [booking1] }); // fetch booking
    mockQuery.mockResolvedValueOnce({ rows: [] });          // update

    const res = await request(app)
      .delete('/api/bookings/booking-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(204);
  });

  test('admin can cancel any booking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [booking1] }); // fetch booking (owned by member-1)
    mockQuery.mockResolvedValueOnce({ rows: [] });          // update

    const res = await request(app)
      .delete('/api/bookings/booking-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
  });

  test('user cannot cancel another user\'s booking (403)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [booking1] }); // booking owned by member-1

    const res = await request(app)
      .delete('/api/bookings/booking-1')
      .set('Authorization', `Bearer ${otherMemberToken}`); // member-2 trying to cancel

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when booking does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // not found

    const res = await request(app)
      .delete('/api/bookings/nonexistent')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 409 when booking is already cancelled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...booking1, status: 'cancelled' }] });

    const res = await request(app)
      .delete('/api/bookings/booking-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).delete('/api/bookings/booking-1');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Unused import prevention
// ---------------------------------------------------------------------------
void desk1;
