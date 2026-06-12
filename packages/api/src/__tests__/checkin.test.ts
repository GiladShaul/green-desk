import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import * as db from '../db';
import { generateCheckInToken, validateCheckInToken } from '../services/checkin';

jest.mock('../db');
const mockQuery = db.query as jest.Mock;

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(role: 'admin' | 'member' = 'member', userId = 'user-1', tenantId = 'tenant-1'): string {
  return jwt.sign({ sub: userId, role, tenantId }, JWT_SECRET, { expiresIn: '1h' });
}

const memberToken = makeToken('member', 'user-1', 'tenant-1');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ── HMAC token helpers ────────────────────────────────────────────────────────

describe('generateCheckInToken / validateCheckInToken', () => {
  test('round-trips a booking id', () => {
    const token = generateCheckInToken('booking-abc');
    expect(validateCheckInToken(token)).toBe('booking-abc');
  });

  test('rejects a tampered token', () => {
    const token = generateCheckInToken('booking-abc');
    const tampered = token.replace(/.$/, 'x');
    expect(validateCheckInToken(tampered)).toBeNull();
  });

  test('rejects a token with no dot separator', () => {
    expect(validateCheckInToken('nodot')).toBeNull();
  });
});

// ── POST /api/bookings/:id/check-in ─────────────────────────────────────────

describe('POST /api/bookings/:id/check-in', () => {
  const bookingId = 'booking-1';

  test('successfully checks in with valid token', async () => {
    const token = generateCheckInToken(bookingId);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: bookingId, status: 'confirmed', date: '2024-06-01', start_time: '09:00', end_time: '10:00', desk_id: 'desk-1', user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await request(app)
      .post(`/api/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.bookingId).toBe(bookingId);
  });

  test('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  test('returns 400 when token is invalid', async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token: 'invalid.token' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('returns 400 when token belongs to a different booking', async () => {
    const token = generateCheckInToken('other-booking');

    const res = await request(app)
      .post(`/api/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token });

    expect(res.status).toBe(400);
  });

  test('returns 404 when booking not found', async () => {
    const token = generateCheckInToken(bookingId);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // booking not found

    const res = await request(app)
      .post(`/api/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token });

    expect(res.status).toBe(404);
  });

  test('returns 409 when booking is cancelled', async () => {
    const token = generateCheckInToken(bookingId);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: bookingId, status: 'cancelled', date: '2024-06-01', start_time: '09:00', end_time: '10:00', desk_id: 'desk-1', user_id: 'user-1' }] });

    const res = await request(app)
      .post(`/api/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token });

    expect(res.status).toBe(409);
  });

  test('returns 200 when already checked in (idempotent)', async () => {
    const token = generateCheckInToken(bookingId);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: bookingId, status: 'checked_in', date: '2024-06-01', start_time: '09:00', end_time: '10:00', desk_id: 'desk-1', user_id: 'user-1' }] });

    const res = await request(app)
      .post(`/api/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already/i);
  });
});
