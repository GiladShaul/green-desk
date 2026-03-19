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

const floorA = { id: 'floor-1', name: 'Ground Floor', building: 'Main', floor_number: 1, created_at: new Date().toISOString() };
const desk1 = { id: 'desk-1', floor_id: 'floor-1', label: 'A-01', x_position: 100, y_position: 100, status: 'active', created_at: new Date().toISOString() };
const desk2 = { id: 'desk-2', floor_id: 'floor-1', label: 'A-02', x_position: 200, y_position: 100, status: 'active', created_at: new Date().toISOString() };

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/floors
// ---------------------------------------------------------------------------

describe('GET /api/floors', () => {
  test('returns list of floors for authenticated user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [floorA] });

    const res = await request(app)
      .get('/api/floors')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(floorA.id);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/floors');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/floors
// ---------------------------------------------------------------------------

describe('POST /api/floors', () => {
  test('admin can create a floor', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [floorA] });

    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ground Floor', building: 'Main', floor_number: 1 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(floorA.id);
    expect(res.body.name).toBe(floorA.name);
  });

  test('member cannot create a floor (403)', async () => {
    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Ground Floor', building: 'Main', floor_number: 1 });

    expect(res.status).toBe(403);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/floors')
      .send({ name: 'Ground Floor', building: 'Main', floor_number: 1 });

    expect(res.status).toBe(401);
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building: 'Main', floor_number: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when floor_number is not an integer', async () => {
    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ground', building: 'Main', floor_number: 'one' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/floors/:id/desks
// ---------------------------------------------------------------------------

describe('GET /api/floors/:id/desks', () => {
  test('returns desks without availability when no date provided', async () => {
    // Floor exists check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'floor-1' }] });
    // Desks list
    mockQuery.mockResolvedValueOnce({ rows: [desk1, desk2] });

    const res = await request(app)
      .get('/api/floors/floor-1/desks')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('returns desks with availability when date provided', async () => {
    // Floor exists check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'floor-1' }] });
    // Desks with availability
    mockQuery.mockResolvedValueOnce({
      rows: [
        { ...desk1, availability: 'booked' },
        { ...desk2, availability: 'available' },
      ],
    });

    const res = await request(app)
      .get('/api/floors/floor-1/desks?date=2024-03-19')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body[0].availability).toBe('booked');
    expect(res.body[1].availability).toBe('available');
  });

  test('returns 404 when floor does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/floors/nonexistent/desks')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid date format', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'floor-1' }] });

    const res = await request(app)
      .get('/api/floors/floor-1/desks?date=not-a-date')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/floors/floor-1/desks');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/desks
// ---------------------------------------------------------------------------

describe('POST /api/desks', () => {
  test('admin can create a desk', async () => {
    // Floor exists check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'floor-1' }] });
    // Insert result
    mockQuery.mockResolvedValueOnce({ rows: [desk1] });

    const res = await request(app)
      .post('/api/desks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'floor-1', label: 'A-01', x_position: 100, y_position: 100 });

    expect(res.status).toBe(201);
    expect(res.body.label).toBe('A-01');
  });

  test('member cannot create a desk (403)', async () => {
    const res = await request(app)
      .post('/api/desks')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ floor_id: 'floor-1', label: 'A-01' });

    expect(res.status).toBe(403);
  });

  test('returns 400 when label is missing', async () => {
    const res = await request(app)
      .post('/api/desks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'floor-1' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when floor_id is missing', async () => {
    const res = await request(app)
      .post('/api/desks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'A-01' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 for invalid status', async () => {
    const res = await request(app)
      .post('/api/desks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'floor-1', label: 'A-01', status: 'broken' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 404 when floor does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/desks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: 'nonexistent', label: 'A-01' });

    expect(res.status).toBe(404);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/desks')
      .send({ floor_id: 'floor-1', label: 'A-01' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/desks/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/desks/:id', () => {
  test('admin can update a desk label', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [desk1] }); // fetch existing
    mockQuery.mockResolvedValueOnce({ rows: [{ ...desk1, label: 'A-01-updated' }] }); // update

    const res = await request(app)
      .patch('/api/desks/desk-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'A-01-updated' });

    expect(res.status).toBe(200);
    expect(res.body.label).toBe('A-01-updated');
  });

  test('admin can update desk status to inactive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [desk1] });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...desk1, status: 'inactive' }] });

    const res = await request(app)
      .patch('/api/desks/desk-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');
  });

  test('member cannot update a desk (403)', async () => {
    const res = await request(app)
      .patch('/api/desks/desk-1')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ label: 'A-01-updated' });

    expect(res.status).toBe(403);
  });

  test('returns 404 when desk does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/desks/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'X-01' });

    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid status value', async () => {
    const res = await request(app)
      .patch('/api/desks/desk-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'broken' });

    expect(res.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .patch('/api/desks/desk-1')
      .send({ label: 'A-01' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/desks/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/desks/:id', () => {
  test('admin can soft-delete (deactivate) a desk', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'desk-1' }] }); // exists check
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update

    const res = await request(app)
      .delete('/api/desks/desk-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
  });

  test('member cannot delete a desk (403)', async () => {
    const res = await request(app)
      .delete('/api/desks/desk-1')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 when desk does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete('/api/desks/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app).delete('/api/desks/desk-1');
    expect(res.status).toBe(401);
  });
});
