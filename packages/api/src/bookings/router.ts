import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { sendBookingConfirmation, sendBookingCancellation } from '../services/email';
import { notifyBookingEvent } from '../services/webhook';
import { auditLog } from '../services/audit';
import { syncBookingCreated, syncBookingCancelled } from '../services/calendar';
import { generateCheckInToken, validateCheckInToken } from '../services/checkin';
import { logger } from '../logger';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// POST /api/bookings — create a booking with conflict detection
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { desk_id, date, start_time, end_time } = req.body as Record<string, unknown>;
  const userId = req.user!.sub;
  const tenantId = req.user!.tenantId;

  if (typeof desk_id !== 'string' || !desk_id.trim()) {
    res.status(400).json({ error: 'desk_id is required' });
    return;
  }
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    return;
  }
  if (typeof start_time !== 'string' || !TIME_RE.test(start_time)) {
    res.status(400).json({ error: 'start_time must be in HH:MM format' });
    return;
  }
  if (typeof end_time !== 'string' || !TIME_RE.test(end_time)) {
    res.status(400).json({ error: 'end_time must be in HH:MM format' });
    return;
  }
  if (end_time <= start_time) {
    res.status(400).json({ error: 'end_time must be after start_time' });
    return;
  }

  // Check desk exists and belongs to tenant
  const deskResult = await query<{ id: string }>('SELECT id FROM desks WHERE id = $1 AND tenant_id = $2', [desk_id, tenantId]);
  if (deskResult.rows.length === 0) {
    res.status(404).json({ error: 'Desk not found' });
    return;
  }

  // Conflict detection: check for overlapping confirmed bookings on the same desk+date
  const conflictResult = await query<{ id: string }>(
    `SELECT id FROM bookings
     WHERE desk_id = $1
       AND date = $2::date
       AND status = 'confirmed'
       AND start_time < $4::time
       AND end_time > $3::time`,
    [desk_id, date, start_time, end_time]
  );
  if (conflictResult.rows.length > 0) {
    res.status(409).json({ error: 'Time slot conflicts with an existing booking' });
    return;
  }

  const insertResult = await query<{
    id: string; desk_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string; created_at: string;
  }>(
    `INSERT INTO bookings (desk_id, user_id, date, start_time, end_time, tenant_id)
     VALUES ($1, $2, $3::date, $4::time, $5::time, $6)
     RETURNING id, desk_id, user_id, date, start_time, end_time, status, created_at`,
    [desk_id, userId, date, start_time, end_time, tenantId]
  );
  const booking = insertResult.rows[0];

  // Generate and store HMAC check-in token now that we have the booking ID
  const checkInToken = generateCheckInToken(booking.id);
  await query('UPDATE bookings SET check_in_token = $1 WHERE id = $2', [checkInToken, booking.id]);
  auditLog(req, { action: 'create', resourceType: 'booking', resourceId: booking.id });
  res.status(201).json({ ...booking, check_in_token: checkInToken });

  // Fire confirmation email non-blocking — do not await, never fail the booking
  query<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM users WHERE id = $1',
    [userId]
  ).then(async (userResult) => {
    if (!userResult.rows[0]) return;
    const deskFloorResult = await query<{ id: string; label: string; floor_id: string; floor_name: string; building: string }>(
      `SELECT d.id, d.label, d.floor_id, f.name AS floor_name, f.building
       FROM desks d JOIN floors f ON f.id = d.floor_id WHERE d.id = $1`,
      [desk_id]
    );
    if (!deskFloorResult.rows[0]) return;
    const row = deskFloorResult.rows[0];
    await sendBookingConfirmation(
      userResult.rows[0],
      booking,
      { id: row.id, label: row.label },
      { id: row.floor_id, name: row.floor_name, building: row.building }
    );
    await notifyBookingEvent(
      'booking_confirmed',
      booking,
      { label: row.label, resource_type: 'desk' },
      { name: row.floor_name, building: row.building },
      { name: userResult.rows[0].name, email: userResult.rows[0].email },
      tenantId,
    );
  }).catch((err: unknown) => logger.error({ err }, '[email] booking confirmation error'));

  // Sync to calendar non-blocking
  syncBookingCreated(booking.id, userId).catch((err: unknown) => logger.error({ err }, '[calendar] sync create error'));
});

// GET /api/bookings/me — list current user's bookings (upcoming + past)
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const tenantId = req.user!.tenantId;

  const result = await query<{
    id: string; desk_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string; created_at: string;
    desk_label: string; floor_id: string; floor_name: string; check_in_token: string | null;
    checked_in_at: string | null;
  }>(
    `SELECT b.id, b.desk_id, b.user_id, b.date, b.start_time, b.end_time, b.status, b.created_at,
            d.label AS desk_label, d.floor_id, f.name AS floor_name,
            b.check_in_token, b.checked_in_at
     FROM bookings b
     JOIN desks d ON d.id = b.desk_id
     JOIN floors f ON f.id = d.floor_id
     WHERE b.user_id = $1 AND b.tenant_id = $2
     ORDER BY b.date DESC, b.start_time DESC`,
    [userId, tenantId]
  );
  res.json(result.rows);
});

// GET /api/bookings?date=YYYY-MM-DD&floorId=X — list bookings for availability view
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, floorId } = req.query as Record<string, string>;
  const tenantId = req.user!.tenantId;

  if (!date || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'date query param is required and must be in YYYY-MM-DD format' });
    return;
  }

  if (floorId) {
    const result = await query<{
      id: string; desk_id: string; user_id: string; date: string;
      start_time: string; end_time: string; status: string; created_at: string;
      desk_label: string; floor_id: string;
    }>(
      `SELECT b.id, b.desk_id, b.user_id, b.date, b.start_time, b.end_time, b.status, b.created_at,
              d.label AS desk_label, d.floor_id
       FROM bookings b
       JOIN desks d ON d.id = b.desk_id
       WHERE b.date = $1::date AND d.floor_id = $2 AND b.status = 'confirmed' AND b.tenant_id = $3
       ORDER BY d.label, b.start_time`,
      [date, floorId, tenantId]
    );
    res.json(result.rows);
  } else {
    const result = await query<{
      id: string; desk_id: string; user_id: string; date: string;
      start_time: string; end_time: string; status: string; created_at: string;
      desk_label: string; floor_id: string;
    }>(
      `SELECT b.id, b.desk_id, b.user_id, b.date, b.start_time, b.end_time, b.status, b.created_at,
              d.label AS desk_label, d.floor_id
       FROM bookings b
       JOIN desks d ON d.id = b.desk_id
       WHERE b.date = $1::date AND b.status = 'confirmed' AND b.tenant_id = $2
       ORDER BY d.label, b.start_time`,
      [date, tenantId]
    );
    res.json(result.rows);
  }
});

// DELETE /api/bookings/:id — cancel a booking
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId;

  const existing = await query<{
    id: string; desk_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string;
  }>('SELECT id, desk_id, user_id, date, start_time, end_time, status FROM bookings WHERE id = $1 AND tenant_id = $2', [id, tenantId]);

  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  const booking = existing.rows[0];

  if (booking.status === 'cancelled') {
    res.status(409).json({ error: 'Booking is already cancelled' });
    return;
  }

  if (role !== 'admin' && booking.user_id !== userId) {
    res.status(403).json({ error: 'Forbidden: you can only cancel your own bookings' });
    return;
  }

  await query('UPDATE bookings SET status = $1 WHERE id = $2 AND tenant_id = $3', ['cancelled', id, tenantId]);
  auditLog(req, { action: 'delete', resourceType: 'booking', resourceId: id });
  res.status(204).send();

  // Fire cancellation email non-blocking
  query<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM users WHERE id = $1',
    [booking.user_id]
  ).then(async (userResult) => {
    if (!userResult.rows[0]) return;
    const deskFloorResult = await query<{ id: string; label: string; floor_id: string; floor_name: string; building: string }>(
      `SELECT d.id, d.label, d.floor_id, f.name AS floor_name, f.building
       FROM desks d JOIN floors f ON f.id = d.floor_id WHERE d.id = $1`,
      [booking.desk_id]
    );
    if (!deskFloorResult.rows[0]) return;
    const row = deskFloorResult.rows[0];
    await sendBookingCancellation(
      userResult.rows[0],
      { id: booking.id, date: booking.date, start_time: booking.start_time, end_time: booking.end_time },
      { id: row.id, label: row.label },
      { id: row.floor_id, name: row.floor_name, building: row.building }
    );
    await notifyBookingEvent(
      'booking_cancelled',
      { id: booking.id, date: booking.date, start_time: booking.start_time, end_time: booking.end_time },
      { label: row.label, resource_type: 'desk' },
      { name: row.floor_name, building: row.building },
      { name: userResult.rows[0].name, email: userResult.rows[0].email },
      tenantId,
    );
  }).catch((err: unknown) => logger.error({ err }, '[email] booking cancellation error'));

  // Sync cancellation to calendar non-blocking
  syncBookingCancelled(id).catch((err: unknown) => logger.error({ err }, '[calendar] sync cancel error'));
});

// POST /api/bookings/:id/check-in — validate QR token and mark booking as checked in
router.post('/:id/check-in', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { token } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  if (typeof token !== 'string' || !token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  const validatedId = validateCheckInToken(token);
  if (!validatedId || validatedId !== id) {
    res.status(400).json({ error: 'Invalid check-in token' });
    return;
  }

  const existing = await query<{
    id: string; status: string; date: string; start_time: string; end_time: string;
    desk_id: string; user_id: string;
  }>(
    'SELECT id, status, date, start_time, end_time, desk_id, user_id FROM bookings WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );

  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  const booking = existing.rows[0];

  if (booking.status === 'checked_in') {
    res.json({ message: 'Already checked in', booking });
    return;
  }

  if (!['confirmed'].includes(booking.status)) {
    res.status(409).json({ error: `Cannot check in: booking status is ${booking.status}` });
    return;
  }

  await query(
    'UPDATE bookings SET status = $1, checked_in_at = now() WHERE id = $2 AND tenant_id = $3',
    ['checked_in', id, tenantId]
  );

  auditLog(req, { action: 'check_in', resourceType: 'booking', resourceId: id });
  res.json({ message: 'Checked in successfully', bookingId: id });
});

export default router;
