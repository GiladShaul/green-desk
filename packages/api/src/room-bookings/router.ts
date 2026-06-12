import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { notifyBookingEvent } from '../services/webhook';
import { auditLog } from '../services/audit';
import { logger } from '../logger';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// POST /api/room-bookings — book a room for a time slot (with conflict detection)
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { room_id, date, start_time, end_time, title } = req.body as Record<string, unknown>;
  const userId = req.user!.sub;
  const tenantId = req.user!.tenantId;

  if (typeof room_id !== 'string' || !room_id.trim()) {
    res.status(400).json({ error: 'room_id is required' });
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
  if (title !== undefined && typeof title !== 'string') {
    res.status(400).json({ error: 'title must be a string' });
    return;
  }

  // Check room exists, is active, and belongs to tenant
  const roomResult = await query<{ id: string; floor_id: string; name: string; status: string }>(
    'SELECT id, floor_id, name, status FROM rooms WHERE id = $1 AND tenant_id = $2',
    [room_id, tenantId]
  );
  if (roomResult.rows.length === 0) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  if (roomResult.rows[0].status === 'inactive') {
    res.status(409).json({ error: 'Room is not available for booking' });
    return;
  }

  const room = roomResult.rows[0];

  // Conflict detection: overlapping confirmed booking on same room+date
  const conflictResult = await query<{ id: string; start_time: string; end_time: string }>(
    `SELECT id, start_time, end_time FROM room_bookings
     WHERE room_id = $1
       AND date = $2::date
       AND status = 'confirmed'
       AND start_time < $4::time
       AND end_time > $3::time`,
    [room_id, date, start_time, end_time]
  );
  if (conflictResult.rows.length > 0) {
    const conflict = conflictResult.rows[0];
    res.status(409).json({
      error: `Time slot conflicts with an existing booking (${conflict.start_time.slice(0, 5)} – ${conflict.end_time.slice(0, 5)})`,
    });
    return;
  }

  const result = await query<{
    id: string; room_id: string; user_id: string; floor_id: string; date: string;
    start_time: string; end_time: string; title: string | null; status: string; created_at: string;
  }>(
    `INSERT INTO room_bookings (room_id, user_id, floor_id, date, start_time, end_time, title, tenant_id)
     VALUES ($1, $2, $3, $4::date, $5::time, $6::time, $7, $8)
     RETURNING id, room_id, user_id, floor_id, date, start_time, end_time, title, status, created_at`,
    [room_id, userId, room.floor_id, date, start_time, end_time, title ?? null, tenantId]
  );
  const booking = result.rows[0];
  auditLog(req, { action: 'create', resourceType: 'room_booking', resourceId: booking.id });
  res.status(201).json(booking);

  // Fire webhook notification non-blocking
  query<{ name: string; floor_name: string; building: string }>(
    `SELECT r.name, f.name AS floor_name, f.building
     FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE r.id = $1`,
    [room_id]
  ).then(async (roomFloorResult) => {
    if (!roomFloorResult.rows[0]) return;
    const rf = roomFloorResult.rows[0];
    const userResult = await query<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = $1', [userId]);
    if (!userResult.rows[0]) return;
    await notifyBookingEvent(
      'booking_confirmed',
      booking,
      { label: rf.name, resource_type: 'room' },
      { name: rf.floor_name, building: rf.building },
      { name: userResult.rows[0].name, email: userResult.rows[0].email },
      tenantId,
    );
  }).catch((err: unknown) => logger.error({ err }, '[webhook] room booking notification error'));
});

// GET /api/room-bookings/me — list current user's room bookings
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const tenantId = req.user!.tenantId;

  const result = await query<{
    id: string; room_id: string; user_id: string; floor_id: string; date: string;
    start_time: string; end_time: string; title: string | null; status: string; created_at: string;
    room_name: string; floor_name: string; capacity: number;
  }>(
    `SELECT rb.id, rb.room_id, rb.user_id, rb.floor_id, rb.date, rb.start_time, rb.end_time,
            rb.title, rb.status, rb.created_at,
            r.name AS room_name, f.name AS floor_name, r.capacity
     FROM room_bookings rb
     JOIN rooms r ON r.id = rb.room_id
     JOIN floors f ON f.id = rb.floor_id
     WHERE rb.user_id = $1 AND rb.tenant_id = $2
     ORDER BY rb.date DESC, rb.start_time DESC`,
    [userId, tenantId]
  );
  res.json(result.rows);
});

// GET /api/room-bookings?roomId=X&date=Y — availability view for a room/date
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { roomId, date, floorId } = req.query as Record<string, string>;
  const tenantId = req.user!.tenantId;

  if (date && !DATE_RE.test(date)) {
    res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    return;
  }

  if (roomId && date) {
    const result = await query<{
      id: string; room_id: string; user_id: string; date: string;
      start_time: string; end_time: string; title: string | null; status: string;
      room_name: string; floor_name: string;
    }>(
      `SELECT rb.id, rb.room_id, rb.user_id, rb.date, rb.start_time, rb.end_time, rb.title, rb.status,
              r.name AS room_name, f.name AS floor_name
       FROM room_bookings rb
       JOIN rooms r ON r.id = rb.room_id
       JOIN floors f ON f.id = rb.floor_id
       WHERE rb.room_id = $1 AND rb.date = $2::date AND rb.status = 'confirmed' AND rb.tenant_id = $3
       ORDER BY rb.start_time`,
      [roomId, date, tenantId]
    );
    res.json(result.rows);
  } else if (floorId && date) {
    const result = await query<{
      id: string; room_id: string; user_id: string; date: string;
      start_time: string; end_time: string; title: string | null; status: string;
      room_name: string; floor_id: string;
    }>(
      `SELECT rb.id, rb.room_id, rb.user_id, rb.date, rb.start_time, rb.end_time, rb.title, rb.status,
              r.name AS room_name, rb.floor_id
       FROM room_bookings rb
       JOIN rooms r ON r.id = rb.room_id
       WHERE rb.date = $1::date AND rb.floor_id = $2 AND rb.status = 'confirmed' AND rb.tenant_id = $3
       ORDER BY r.name, rb.start_time`,
      [date, floorId, tenantId]
    );
    res.json(result.rows);
  } else if (date) {
    const result = await query<{
      id: string; room_id: string; user_id: string; date: string;
      start_time: string; end_time: string; title: string | null; status: string;
      room_name: string; floor_id: string;
    }>(
      `SELECT rb.id, rb.room_id, rb.user_id, rb.date, rb.start_time, rb.end_time, rb.title, rb.status,
              r.name AS room_name, rb.floor_id
       FROM room_bookings rb
       JOIN rooms r ON r.id = rb.room_id
       WHERE rb.date = $1::date AND rb.status = 'confirmed' AND rb.tenant_id = $2
       ORDER BY r.name, rb.start_time`,
      [date, tenantId]
    );
    res.json(result.rows);
  } else {
    res.status(400).json({ error: 'date query param is required' });
  }
});

// DELETE /api/room-bookings/:id — cancel own room booking
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;
  const role = req.user!.role;
  const tenantId = req.user!.tenantId;

  const existing = await query<{
    id: string; room_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string;
  }>(
    'SELECT id, room_id, user_id, date, start_time, end_time, status FROM room_bookings WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );

  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Room booking not found' });
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

  await query('UPDATE room_bookings SET status = $1 WHERE id = $2 AND tenant_id = $3', ['cancelled', id, tenantId]);
  auditLog(req, { action: 'delete', resourceType: 'room_booking', resourceId: id });
  res.status(204).send();
});

export default router;
