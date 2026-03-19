import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// Materialize individual bookings from all active recurring rules for the next 2 weeks.
// Idempotent: skips dates where a confirmed booking already exists for that desk+time.
export async function generateRecurringBookings(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build array of dates: today through today+13 (14 days)
  const dates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }

  // Fetch all active recurring bookings
  const rbResult = await query<{
    id: string; user_id: string; desk_id: string; floor_id: string;
    day_of_week: number; start_time: string; end_time: string;
    start_date: string; end_date: string | null;
  }>(
    `SELECT id, user_id, desk_id, floor_id, day_of_week, start_time, end_time, start_date, end_date
     FROM recurring_bookings
     WHERE start_date <= CURRENT_DATE
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)`
  );

  let created = 0;

  for (const rb of rbResult.rows) {
    for (const dateStr of dates) {
      const d = new Date(dateStr + 'T00:00:00');
      const dow = d.getDay(); // 0=Sunday, matches day_of_week convention

      if (dow !== rb.day_of_week) continue;

      // Check date is within recurring booking range
      if (dateStr < rb.start_date.split('T')[0]) continue;
      if (rb.end_date && dateStr > rb.end_date.split('T')[0]) continue;

      // Skip if a confirmed booking already exists for this desk+date with overlapping times
      const conflictResult = await query<{ id: string }>(
        `SELECT id FROM bookings
         WHERE desk_id = $1
           AND date = $2::date
           AND status = 'confirmed'
           AND start_time < $4::time
           AND end_time > $3::time`,
        [rb.desk_id, dateStr, rb.start_time, rb.end_time]
      );
      if (conflictResult.rows.length > 0) continue;

      // Create the booking
      await query(
        `INSERT INTO bookings (desk_id, user_id, date, start_time, end_time)
         VALUES ($1, $2, $3::date, $4::time, $5::time)
         ON CONFLICT DO NOTHING`,
        [rb.desk_id, rb.user_id, dateStr, rb.start_time, rb.end_time]
      );
      created++;
    }
  }

  return created;
}

// POST /api/recurring-bookings — create a recurring booking
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { desk_id, day_of_week, start_time, end_time, start_date, end_date } =
    req.body as Record<string, unknown>;
  const userId = req.user!.sub;

  if (typeof desk_id !== 'string' || !desk_id.trim()) {
    res.status(400).json({ error: 'desk_id is required' });
    return;
  }
  if (typeof day_of_week !== 'number' || !Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6) {
    res.status(400).json({ error: 'day_of_week must be an integer 0–6 (0=Sunday)' });
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
  if (typeof start_date !== 'string' || !DATE_RE.test(start_date)) {
    res.status(400).json({ error: 'start_date must be in YYYY-MM-DD format' });
    return;
  }
  if (end_date !== undefined && end_date !== null) {
    if (typeof end_date !== 'string' || !DATE_RE.test(end_date)) {
      res.status(400).json({ error: 'end_date must be in YYYY-MM-DD format or null' });
      return;
    }
    if (end_date < start_date) {
      res.status(400).json({ error: 'end_date must be on or after start_date' });
      return;
    }
  }

  // Check desk exists and get floor_id
  const deskResult = await query<{ id: string; floor_id: string }>(
    'SELECT id, floor_id FROM desks WHERE id = $1',
    [desk_id]
  );
  if (deskResult.rows.length === 0) {
    res.status(404).json({ error: 'Desk not found' });
    return;
  }
  const { floor_id } = deskResult.rows[0];

  // Conflict detection: check for other recurring bookings on same desk+day with overlapping times
  const conflictResult = await query<{ id: string }>(
    `SELECT id FROM recurring_bookings
     WHERE desk_id = $1
       AND day_of_week = $2
       AND start_time < $4::time
       AND end_time > $3::time`,
    [desk_id, day_of_week, start_time, end_time]
  );
  if (conflictResult.rows.length > 0) {
    res.status(409).json({ error: 'A recurring booking already exists for this desk and day with a conflicting time slot' });
    return;
  }

  const endDateValue = (typeof end_date === 'string' && end_date) ? end_date : null;
  const result = await query<{
    id: string; user_id: string; desk_id: string; floor_id: string;
    day_of_week: number; start_time: string; end_time: string;
    start_date: string; end_date: string | null; created_at: string; updated_at: string;
  }>(
    `INSERT INTO recurring_bookings (user_id, desk_id, floor_id, day_of_week, start_time, end_time, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5::time, $6::time, $7::date, $8)
     RETURNING id, user_id, desk_id, floor_id, day_of_week, start_time, end_time, start_date, end_date, created_at, updated_at`,
    [userId, desk_id, floor_id, day_of_week, start_time, end_time, start_date, endDateValue]
  );
  const rb = result.rows[0];
  res.status(201).json(rb);

  // Materialize bookings non-blocking
  generateRecurringBookings().catch((err: unknown) =>
    console.error('[recurring-bookings] generate error:', err)
  );
});

// GET /api/recurring-bookings — list current user's recurring bookings
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const result = await query<{
    id: string; user_id: string; desk_id: string; floor_id: string;
    day_of_week: number; start_time: string; end_time: string;
    start_date: string; end_date: string | null; created_at: string; updated_at: string;
    desk_label: string; floor_name: string;
  }>(
    `SELECT rb.id, rb.user_id, rb.desk_id, rb.floor_id, rb.day_of_week,
            rb.start_time, rb.end_time, rb.start_date, rb.end_date,
            rb.created_at, rb.updated_at,
            d.label AS desk_label, f.name AS floor_name
     FROM recurring_bookings rb
     JOIN desks d ON d.id = rb.desk_id
     JOIN floors f ON f.id = rb.floor_id
     WHERE rb.user_id = $1
     ORDER BY rb.day_of_week, rb.start_time`,
    [userId]
  );
  res.json(result.rows);
});

// DELETE /api/recurring-bookings/:id — delete a recurring booking
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;

  const existing = await query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM recurring_bookings WHERE id = $1',
    [id]
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Recurring booking not found' });
    return;
  }
  if (existing.rows[0].user_id !== userId) {
    res.status(403).json({ error: 'Forbidden: you can only delete your own recurring bookings' });
    return;
  }

  await query('DELETE FROM recurring_bookings WHERE id = $1', [id]);
  res.status(204).send();
});

// POST /api/recurring-bookings/generate — materialize bookings for the next 2 weeks
router.post('/generate', requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  const created = await generateRecurringBookings();
  res.json({ created });
});

export default router;
