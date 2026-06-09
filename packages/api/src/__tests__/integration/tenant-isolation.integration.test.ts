/**
 * Tenant isolation integration tests — verifies that tenant A cannot see or
 * modify data belonging to tenant B, using a real PostgreSQL instance.
 */
import request from 'supertest';
import app from '../../index';
import { migrate, truncateTables, pool, closePool } from './setup';

let tokenA: string;
let tokenB: string;
let tenantAId: string;
let tenantBId: string;
let deskAId: string;
let deskBId: string;
let bookingAId: string;

beforeAll(async () => {
  await migrate();
  await truncateTables();

  // Register two separate tenants (each registration auto-creates a tenant)
  const regA = await request(app)
    .post('/api/auth/register')
    .send({ email: 'tenant-a@isolation.test', password: 'passwordA1', name: 'Tenant A User', orgName: 'Org Alpha' });

  const regB = await request(app)
    .post('/api/auth/register')
    .send({ email: 'tenant-b@isolation.test', password: 'passwordB1', name: 'Tenant B User', orgName: 'Org Beta' });

  tokenA = regA.body.token;
  tokenB = regB.body.token;
  tenantAId = regA.body.user.tenantId;
  tenantBId = regB.body.user.tenantId;

  // Create a floor+desk for each tenant directly via DB
  const floorA = await pool.query(
    `INSERT INTO floors (name, building, floor_number, tenant_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    ['Floor A', 'Alpha HQ', 1, tenantAId]
  );
  const floorB = await pool.query(
    `INSERT INTO floors (name, building, floor_number, tenant_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    ['Floor B', 'Beta HQ', 1, tenantBId]
  );

  const deskA = await pool.query(
    `INSERT INTO desks (floor_id, label, tenant_id) VALUES ($1,$2,$3) RETURNING id`,
    [floorA.rows[0].id, 'A-01', tenantAId]
  );
  const deskB = await pool.query(
    `INSERT INTO desks (floor_id, label, tenant_id) VALUES ($1,$2,$3) RETURNING id`,
    [floorB.rows[0].id, 'B-01', tenantBId]
  );

  deskAId = deskA.rows[0].id;
  deskBId = deskB.rows[0].id;

  // Tenant A creates a booking
  const bookingRes = await request(app)
    .post('/api/bookings')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ desk_id: deskAId, date: '2030-02-10', start_time: '09:00', end_time: '10:00' });

  bookingAId = bookingRes.body.id;
});

afterAll(async () => {
  await truncateTables();
  await closePool();
});

describe('Tenant isolation — bookings (integration)', () => {
  test('tenant A can see their own bookings', async () => {
    const res = await request(app)
      .get('/api/bookings?date=2030-02-10')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((b: { tenant_id?: string }) => b.tenant_id === undefined || b.tenant_id === tenantAId)).toBe(true);
  });

  test('tenant B sees no bookings on a date where only tenant A has bookings', async () => {
    const res = await request(app)
      .get('/api/bookings?date=2030-02-10')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('tenant B cannot cancel tenant A booking — returns 404', async () => {
    const res = await request(app)
      .delete(`/api/bookings/${bookingAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    // The booking exists but not in tenant B scope → 404
    expect(res.status).toBe(404);

    // Confirm booking is still active in DB
    const { rows } = await pool.query(
      `SELECT status FROM bookings WHERE id = $1`,
      [bookingAId]
    );
    expect(rows[0].status).toBe('confirmed');
  });

  test('tenant B cannot book desk belonging to tenant A — returns 404', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ desk_id: deskAId, date: '2030-02-11', start_time: '09:00', end_time: '10:00' });

    expect(res.status).toBe(404);
  });
});

describe('Tenant isolation — floors (integration)', () => {
  test('tenant A only sees their own floors', async () => {
    const res = await request(app)
      .get('/api/floors')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const floorIds = res.body.map((f: { id: string }) => f.id);
    // Tenant A's floor is present
    expect(floorIds).not.toContain(
      (await pool.query(`SELECT id FROM floors WHERE tenant_id = $1`, [tenantBId])).rows[0]?.id
    );
  });

  test('tenant B only sees their own floors', async () => {
    const res = await request(app)
      .get('/api/floors')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const tenantAFloor = (await pool.query(`SELECT id FROM floors WHERE tenant_id = $1 LIMIT 1`, [tenantAId])).rows[0];
    const floorIds = res.body.map((f: { id: string }) => f.id);
    expect(floorIds).not.toContain(tenantAFloor?.id);
  });
});
