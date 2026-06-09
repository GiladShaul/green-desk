/**
 * /api/v1 — versioned endpoints for API key authentication.
 * All routes require a valid API key (Bearer gd_...) and the appropriate scope.
 */
import { Router, Response } from 'express';
import { query } from '../db';
import { requireApiKey, requireScope, ApiKeyRequest } from '../api-keys/middleware';

const router = Router();

router.use(requireApiKey);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// ── Bookings ──────────────────────────────────────────────────────────────────

// GET /api/v1/bookings?date=YYYY-MM-DD&floorId=X&page=1&pageSize=50
router.get('/bookings', requireScope('read:bookings'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { date, floorId, page: pageParam, pageSize: pageSizeParam } = req.query as Record<string, string>;

  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeParam ?? '50', 10) || 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['b.tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (date) {
    if (!DATE_RE.test(date)) {
      res.status(400).json({ error: 'date must be in YYYY-MM-DD format', code: 'VALIDATION_ERROR' });
      return;
    }
    params.push(date);
    conditions.push(`b.date = $${params.length}::date`);
  }

  if (floorId) {
    params.push(floorId);
    conditions.push(`d.floor_id = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM bookings b JOIN desks d ON d.id = b.desk_id WHERE ${where}`,
    params,
  );
  const total = parseInt(totalResult.rows[0].count, 10);

  params.push(pageSize);
  params.push(offset);

  const result = await query<{
    id: string; desk_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string; created_at: string;
    desk_label: string; floor_id: string; floor_name: string;
  }>(
    `SELECT b.id, b.desk_id, b.user_id, b.date, b.start_time, b.end_time, b.status, b.created_at,
            d.label AS desk_label, d.floor_id, f.name AS floor_name
     FROM bookings b
     JOIN desks d ON d.id = b.desk_id
     JOIN floors f ON f.id = d.floor_id
     WHERE ${where}
     ORDER BY b.date DESC, b.start_time DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ data: result.rows, total, page, pageSize });
});

// POST /api/v1/bookings — create a booking
router.post('/bookings', requireScope('write:bookings'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { desk_id, user_id, date, start_time, end_time } = req.body as Record<string, unknown>;

  if (typeof desk_id !== 'string' || !desk_id.trim()) {
    res.status(400).json({ error: 'desk_id is required', code: 'VALIDATION_ERROR' });
    return;
  }
  if (typeof user_id !== 'string' || !user_id.trim()) {
    res.status(400).json({ error: 'user_id is required', code: 'VALIDATION_ERROR' });
    return;
  }
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'date must be in YYYY-MM-DD format', code: 'VALIDATION_ERROR' });
    return;
  }
  if (typeof start_time !== 'string' || !TIME_RE.test(start_time)) {
    res.status(400).json({ error: 'start_time must be in HH:MM format', code: 'VALIDATION_ERROR' });
    return;
  }
  if (typeof end_time !== 'string' || !TIME_RE.test(end_time)) {
    res.status(400).json({ error: 'end_time must be in HH:MM format', code: 'VALIDATION_ERROR' });
    return;
  }
  if (end_time <= start_time) {
    res.status(400).json({ error: 'end_time must be after start_time', code: 'VALIDATION_ERROR' });
    return;
  }

  const deskResult = await query<{ id: string }>('SELECT id FROM desks WHERE id = $1 AND tenant_id = $2', [desk_id, tenantId]);
  if (deskResult.rows.length === 0) {
    res.status(404).json({ error: 'Desk not found', code: 'NOT_FOUND' });
    return;
  }

  const userResult = await query<{ id: string }>('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [user_id, tenantId]);
  if (userResult.rows.length === 0) {
    res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    return;
  }

  const conflictResult = await query<{ id: string }>(
    `SELECT id FROM bookings
     WHERE desk_id = $1 AND date = $2::date AND status = 'confirmed'
       AND start_time < $4::time AND end_time > $3::time`,
    [desk_id, date, start_time, end_time],
  );
  if (conflictResult.rows.length > 0) {
    res.status(409).json({ error: 'Time slot conflicts with an existing booking', code: 'CONFLICT' });
    return;
  }

  const result = await query<{
    id: string; desk_id: string; user_id: string; date: string;
    start_time: string; end_time: string; status: string; created_at: string;
  }>(
    `INSERT INTO bookings (desk_id, user_id, date, start_time, end_time, tenant_id)
     VALUES ($1, $2, $3::date, $4::time, $5::time, $6)
     RETURNING id, desk_id, user_id, date, start_time, end_time, status, created_at`,
    [desk_id, user_id, date, start_time, end_time, tenantId],
  );

  res.status(201).json(result.rows[0]);
});

// DELETE /api/v1/bookings/:id — cancel a booking
router.delete('/bookings/:id', requireScope('write:bookings'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const existing = await query<{ id: string; status: string }>(
    'SELECT id, status FROM bookings WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Booking not found', code: 'NOT_FOUND' });
    return;
  }
  if (existing.rows[0].status === 'cancelled') {
    res.status(409).json({ error: 'Booking is already cancelled', code: 'CONFLICT' });
    return;
  }

  await query('UPDATE bookings SET status = $1 WHERE id = $2 AND tenant_id = $3', ['cancelled', id, tenantId]);
  res.status(204).end();
});

// ── Floors ────────────────────────────────────────────────────────────────────

// GET /api/v1/floors
router.get('/floors', requireScope('read:floors'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const result = await query<{ id: string; name: string; building: string; floor_number: number; created_at: string }>(
    'SELECT id, name, building, floor_number, created_at FROM floors WHERE tenant_id = $1 ORDER BY building, floor_number',
    [tenantId],
  );
  res.json({ data: result.rows });
});

// ── Desks ─────────────────────────────────────────────────────────────────────

// GET /api/v1/desks?floorId=X
router.get('/desks', requireScope('read:desks'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { floorId } = req.query as Record<string, string>;

  const conditions: string[] = ['d.tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (floorId) {
    params.push(floorId);
    conditions.push(`d.floor_id = $${params.length}`);
  }

  const result = await query<{ id: string; label: string; floor_id: string; floor_name: string; status: string }>(
    `SELECT d.id, d.label, d.floor_id, f.name AS floor_name, d.status
     FROM desks d JOIN floors f ON f.id = d.floor_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY f.building, f.floor_number, d.label`,
    params,
  );

  res.json({ data: result.rows });
});

// ── Rooms ─────────────────────────────────────────────────────────────────────

// GET /api/v1/rooms?floorId=X
router.get('/rooms', requireScope('read:rooms'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { floorId } = req.query as Record<string, string>;

  const conditions: string[] = ['r.tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (floorId) {
    params.push(floorId);
    conditions.push(`r.floor_id = $${params.length}`);
  }

  const result = await query<{ id: string; name: string; floor_id: string; capacity: number; amenities: string[] }>(
    `SELECT r.id, r.name, r.floor_id, r.capacity, r.amenities
     FROM rooms r
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.name`,
    params,
  );

  res.json({ data: result.rows });
});

// ── Analytics ─────────────────────────────────────────────────────────────────

// GET /api/v1/analytics?days=7|30|90
router.get('/analytics', requireScope('read:analytics'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const daysParam = req.query.days as string | undefined;
  const allowedDays = [7, 30, 90];
  const days = daysParam !== undefined ? parseInt(daysParam, 10) : 30;

  if (!allowedDays.includes(days)) {
    res.status(400).json({ error: 'days must be 7, 30, or 90', code: 'VALIDATION_ERROR' });
    return;
  }

  const [totalResult, deskCountResult, floorResult] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bookings
       WHERE date >= CURRENT_DATE - ($1 || ' days')::INTERVAL AND status = 'confirmed' AND tenant_id = $2`,
      [days, tenantId],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM desks WHERE status = 'active' AND tenant_id = $1`,
      [tenantId],
    ),
    query<{ floor_name: string; bookings: string; active_desks: string }>(
      `SELECT f.name AS floor_name, COUNT(b.id) AS bookings, COUNT(DISTINCT d.id) AS active_desks
       FROM floors f
       LEFT JOIN desks d ON d.floor_id = f.id AND d.status = 'active'
       LEFT JOIN bookings b ON b.desk_id = d.id
         AND b.date >= CURRENT_DATE - ($1 || ' days')::INTERVAL AND b.status = 'confirmed'
       WHERE f.tenant_id = $2
       GROUP BY f.id, f.name ORDER BY bookings DESC`,
      [days, tenantId],
    ),
  ]);

  const totalBookings = parseInt(totalResult.rows[0].count, 10);
  const totalActiveDesks = parseInt(deskCountResult.rows[0].count, 10);
  const overallUtilization = totalActiveDesks * days > 0
    ? Math.round((totalBookings / (totalActiveDesks * days)) * 100 * 10) / 10 : 0;

  res.json({
    days,
    totalBookings,
    avgDailyBookings: days > 0 ? Math.round((totalBookings / days) * 10) / 10 : 0,
    utilizationRate: overallUtilization,
    bookingsByFloor: floorResult.rows.map(r => ({
      floorName: r.floor_name,
      bookings: parseInt(r.bookings, 10),
      activeDesks: parseInt(r.active_desks, 10),
    })),
  });
});

// ── Users ─────────────────────────────────────────────────────────────────────

// GET /api/v1/users
router.get('/users', requireScope('read:users'), async (req: ApiKeyRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const result = await query<{ id: string; email: string; name: string; role: string; created_at: string }>(
    'SELECT id, email, name, role, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId],
  );
  res.json({ data: result.rows });
});

export default router;
