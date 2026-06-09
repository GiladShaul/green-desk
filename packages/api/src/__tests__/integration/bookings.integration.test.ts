import request from 'supertest';
import app from '../../index';
import { migrate, truncateTables, pool, closePool } from './setup';

let token: string;
let tenantId: string;
let deskId: string;

beforeAll(async () => {
  await migrate();
  await truncateTables();

  // Create a user (which auto-creates a tenant)
  const regRes = await request(app)
    .post('/api/auth/register')
    .send({ email: 'bookings@integration.test', password: 'bookingspass', name: 'Bookings User' });

  token = regRes.body.token;
  tenantId = regRes.body.user.tenantId;

  // Create a floor and desk for this tenant
  const floorRes = await pool.query(
    `INSERT INTO floors (name, building, floor_number, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Ground Floor', 'HQ', 1, tenantId]
  );
  const floorId = floorRes.rows[0].id;

  const deskRes = await pool.query(
    `INSERT INTO desks (floor_id, label, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
    [floorId, 'D-01', tenantId]
  );
  deskId = deskRes.rows[0].id;
});

afterAll(async () => {
  await truncateTables();
  await closePool();
});

describe('POST /api/bookings — conflict detection (integration)', () => {
  test('creates a booking for an available slot', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: deskId, date: '2030-01-10', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(201);
    expect(res.body.desk_id).toBe(deskId);
    expect(res.body.status).toBe('confirmed');
  });

  test('returns 409 when the same slot is booked again', async () => {
    // Book a slot
    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: deskId, date: '2030-01-11', start_time: '14:00', end_time: '16:00' });

    // Attempt an overlapping booking on the same desk+date
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: deskId, date: '2030-01-11', start_time: '15:00', end_time: '17:00' });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('allows booking adjacent (non-overlapping) slots on the same desk', async () => {
    // Book morning
    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: deskId, date: '2030-01-12', start_time: '09:00', end_time: '12:00' });

    // Book afternoon — should succeed (starts exactly when morning ends)
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: deskId, date: '2030-01-12', start_time: '12:00', end_time: '15:00' });

    expect(res.status).toBe(201);
  });

  test('returns 404 when desk does not belong to this tenant', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: '00000000-0000-0000-0000-000000000099', date: '2030-01-13', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid date format', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: deskId, date: '13/01/2030', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when end_time is before start_time', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ desk_id: deskId, date: '2030-01-14', start_time: '10:00', end_time: '09:00' });

    expect(res.status).toBe(400);
  });
});
