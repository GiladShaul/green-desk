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

const floor1 = { id: 'floor-1', name: 'Ground Floor', building: 'HQ', floor_number: 1 };
const desk1 = { id: 'desk-1', floor_id: 'floor-1', label: 'A-01', status: 'active' };
const desk2 = { id: 'desk-2', floor_id: 'floor-1', label: 'A-02', status: 'active' };

const teamBooking1 = {
  id: 'tb-1',
  floor_id: 'floor-1',
  created_by_user_id: 'admin-1',
  date: '2024-07-01',
  title: 'Engineering team day',
  status: 'confirmed',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const teamBookingDesk1 = {
  id: 'tbd-1',
  team_booking_id: 'tb-1',
  desk_id: 'desk-1',
  assigned_user_id: 'member-1',
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  // resetAllMocks clears queued mockResolvedValueOnce values between tests
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// POST /api/team-bookings
// ---------------------------------------------------------------------------

describe('POST /api/team-bookings', () => {
  test('admin can create a team booking with multiple desks', async () => {
    // Handler processes each desk fully (existence + 2 conflict checks) before next desk
    mockQuery.mockResolvedValueOnce({ rows: [floor1] });           // 1. floor exists
    mockQuery.mockResolvedValueOnce({ rows: [desk1] });            // 2. desk-1 exists
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // 3. desk-1 no booking conflict
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // 4. desk-1 no team booking conflict
    mockQuery.mockResolvedValueOnce({ rows: [desk2] });            // 5. desk-2 exists
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // 6. desk-2 no booking conflict
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // 7. desk-2 no team booking conflict
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });     // 8. insert team_booking
    mockQuery.mockResolvedValueOnce({                               // 9. insert team_booking_desks
      rows: [
        teamBookingDesk1,
        { ...teamBookingDesk1, id: 'tbd-2', desk_id: 'desk-2', assigned_user_id: null },
      ],
    });

    const res = await request(app)
      .post('/api/team-bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        floor_id: 'floor-1',
        date: '2024-07-01',
        title: 'Engineering team day',
        desks: [
          { desk_id: 'desk-1', assigned_user_id: 'member-1' },
          { desk_id: 'desk-2' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 'tb-1');
    expect(res.body).toHaveProperty('title', 'Engineering team day');
    expect(res.body).toHaveProperty('desks');
  });

  test('member cannot create a team booking', async () => {
    const res = await request(app)
      .post('/api/team-bookings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ floor_id: 'floor-1', date: '2024-07-01', title: 'Team day', desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(403);
  });

  test('returns 400 when date is missing', async () => {
    const res = await request(app)
      .post('/api/team-bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'floor-1', title: 'Team day', desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when desks array is empty', async () => {
    const res = await request(app)
      .post('/api/team-bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'floor-1', date: '2024-07-01', title: 'Team day', desks: [] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when floor does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // floor not found

    const res = await request(app)
      .post('/api/team-bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'bad-floor', date: '2024-07-01', title: 'Team day', desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(404);
  });

  test('returns 409 when a desk has an individual booking conflict', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [floor1] });             // floor exists
    mockQuery.mockResolvedValueOnce({ rows: [desk1] });              // desk-1 exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'booking-x' }] }); // booking conflict for desk-1

    const res = await request(app)
      .post('/api/team-bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'floor-1', date: '2024-07-01', title: 'Team day', desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('conflicts');
  });

  test('returns 409 when a desk is already in another team booking on same date', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [floor1] });             // floor exists
    mockQuery.mockResolvedValueOnce({ rows: [desk1] });              // desk-1 exists
    mockQuery.mockResolvedValueOnce({ rows: [] });                   // no individual booking conflict
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tbd-x', team_booking_id: 'tb-x' }] }); // team booking conflict

    const res = await request(app)
      .post('/api/team-bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'floor-1', date: '2024-07-01', title: 'Team day', desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('conflicts');
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/team-bookings')
      .send({ floor_id: 'floor-1', date: '2024-07-01', title: 'Team day', desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/team-bookings
// ---------------------------------------------------------------------------

describe('GET /api/team-bookings', () => {
  test('returns team bookings filtered by date', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });

    const res = await request(app)
      .get('/api/team-bookings?date=2024-07-01')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns team bookings filtered by date and floor', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });

    const res = await request(app)
      .get('/api/team-bookings?date=2024-07-01&floorId=floor-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns 400 when date is not provided', async () => {
    const res = await request(app)
      .get('/api/team-bookings')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/team-bookings?date=2024-07-01');

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/team-bookings/me
// ---------------------------------------------------------------------------

describe('GET /api/team-bookings/me', () => {
  test('returns team bookings where user is creator or assigned member', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });

    const res = await request(app)
      .get('/api/team-bookings/me')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/team-bookings/me');

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/team-bookings/:id
// ---------------------------------------------------------------------------

describe('GET /api/team-bookings/:id', () => {
  test('returns team booking detail with desk assignments', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });      // booking + floor JOIN
    mockQuery.mockResolvedValueOnce({ rows: [teamBookingDesk1] });  // desk assignments

    const res = await request(app)
      .get('/api/team-bookings/tb-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'tb-1');
    expect(res.body).toHaveProperty('desks');
    expect(Array.isArray(res.body.desks)).toBe(true);
  });

  test('returns 404 when team booking not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // booking not found

    const res = await request(app)
      .get('/api/team-bookings/nonexistent')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/team-bookings/tb-1');

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/team-bookings/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/team-bookings/:id', () => {
  test('admin can update desk assignments', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });      // 1. existing booking
    mockQuery.mockResolvedValueOnce({ rows: [] });                   // 2. no booking conflict for desk-1
    mockQuery.mockResolvedValueOnce({ rows: [] });                   // 3. no team booking conflict for desk-1
    mockQuery.mockResolvedValueOnce({ rows: [] });                   // 4. delete old desks
    mockQuery.mockResolvedValueOnce({ rows: [teamBookingDesk1] });  // 5. insert new desks
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });      // 6. re-fetch booking
    mockQuery.mockResolvedValueOnce({ rows: [teamBookingDesk1] });  // 7. re-fetch desks

    const res = await request(app)
      .patch('/api/team-bookings/tb-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ desks: [{ desk_id: 'desk-1', assigned_user_id: 'member-1' }] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'tb-1');
  });

  test('non-admin cannot update a team booking', async () => {
    const res = await request(app)
      .patch('/api/team-bookings/tb-1')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(403);
  });

  test('returns 404 when team booking does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // booking not found

    const res = await request(app)
      .patch('/api/team-bookings/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ desks: [{ desk_id: 'desk-1' }] });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/team-bookings/:id/claim
// ---------------------------------------------------------------------------

describe('POST /api/team-bookings/:id/claim', () => {
  const unclaimedDesk = { ...teamBookingDesk1, assigned_user_id: null, desk_id: 'desk-2' };

  test('team member can claim an unassigned desk', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });   // booking exists + confirmed
    mockQuery.mockResolvedValueOnce({ rows: [unclaimedDesk] });  // unclaimed desk slot exists
    mockQuery.mockResolvedValueOnce({ rows: [] });               // user not already assigned
    mockQuery.mockResolvedValueOnce({ rows: [{ ...unclaimedDesk, assigned_user_id: 'member-1' }] }); // claim

    const res = await request(app)
      .post('/api/team-bookings/tb-1/claim')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-2' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('assigned_user_id', 'member-1');
  });

  test('returns 404 when no unclaimed desk found for desk_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] }); // booking exists
    mockQuery.mockResolvedValueOnce({ rows: [] });              // no unclaimed desk slot

    const res = await request(app)
      .post('/api/team-bookings/tb-1/claim')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-2' });

    expect(res.status).toBe(404);
  });

  test('returns 409 when user already has a desk in this booking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] });
    mockQuery.mockResolvedValueOnce({ rows: [unclaimedDesk] });              // unclaimed desk found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-claim' }] });   // user already assigned

    const res = await request(app)
      .post('/api/team-bookings/tb-1/claim')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-2' });

    expect(res.status).toBe(409);
  });

  test('returns 404 when team booking not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // booking not found

    const res = await request(app)
      .post('/api/team-bookings/nonexistent/claim')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ desk_id: 'desk-1' });

    expect(res.status).toBe(404);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/team-bookings/tb-1/claim')
      .send({ desk_id: 'desk-1' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/team-bookings/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/team-bookings/:id', () => {
  test('admin can cancel entire team booking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [teamBooking1] }); // booking exists
    mockQuery.mockResolvedValueOnce({ rows: [] });              // update succeeds

    const res = await request(app)
      .delete('/api/team-bookings/tb-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
  });

  test('member cannot cancel a team booking', async () => {
    const res = await request(app)
      .delete('/api/team-bookings/tb-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 when team booking does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // booking not found

    const res = await request(app)
      .delete('/api/team-bookings/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 409 when team booking is already cancelled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...teamBooking1, status: 'cancelled' }] });

    const res = await request(app)
      .delete('/api/team-bookings/tb-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .delete('/api/team-bookings/tb-1');

    expect(res.status).toBe(401);
  });
});
