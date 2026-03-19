import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// POST /api/bookings — create a booking with conflict detection
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { desk_id, date, start_time, end_time } = req.body as Record<string, unknown>;
  const userId = req.user!.sub;

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

  // Check desk exists
  const deskResult = await query<{ id: string }>('SELECT id FROM desks WHERE id = $1', [desk_id]);
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

  const result = await query<{
    id: string; desk_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string; created_at: string;
  }>(
    `INSERT INTO bookings (desk_id, user_id, date, start_time, end_time)
     VALUES ($1, $2, $3::date, $4::time, $5::time)
     RETURNING id, desk_id, user_id, date, start_time, end_time, status, created_at`,
    [desk_id, userId, date, start_time, end_time]
  );
  res.status(201).json(result.rows[0]);
});

// GET /api/bookings/me — list current user's bookings (upcoming + past)
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const result = await query<{
    id: string; desk_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string; created_at: string;
    desk_label: string; floor_id: string;
  }>(
    `SELECT b.id, b.desk_id, b.user_id, b.date, b.start_time, b.end_time, b.status, b.created_at,
            d.label AS desk_label, d.floor_id
     FROM bookings b
     JOIN desks d ON d.id = b.desk_id
     WHERE b.user_id = $1
     ORDER BY b.date DESC, b.start_time DESC`,
    [userId]
  );
  res.json(result.rows);
});

// GET /api/bookings?date=YYYY-MM-DD&floorId=X — list bookings for availability view
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, floorId } = req.query as Record<string, string>;

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
       WHERE b.date = $1::date AND d.floor_id = $2 AND b.status = 'confirmed'
       ORDER BY d.label, b.start_time`,
      [date, floorId]
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
       WHERE b.date = $1::date AND b.status = 'confirmed'
       ORDER BY d.label, b.start_time`,
      [date]
    );
    res.json(result.rows);
  }
});

// DELETE /api/bookings/:id — cancel a booking
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;
  const role = req.user!.role;

  const existing = await query<{
    id: string; user_id: string; status: string;
  }>('SELECT id, user_id, status FROM bookings WHERE id = $1', [id]);

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

  await query('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', id]);
  res.status(204).send();
});

export default router;
