import { Router, Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DeskInput {
  desk_id: string;
  assigned_user_id?: string | null;
}

// POST /api/team-bookings — create a team booking (admin only)
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const role = req.user!.role;
  if (role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: only admins can create team bookings' });
    return;
  }

  const { floor_id, date, title, desks } = req.body as Record<string, unknown>;
  const userId = req.user!.sub;

  if (typeof floor_id !== 'string' || !floor_id.trim()) {
    res.status(400).json({ error: 'floor_id is required' });
    return;
  }
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    return;
  }
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (!Array.isArray(desks) || desks.length === 0) {
    res.status(400).json({ error: 'desks must be a non-empty array' });
    return;
  }

  // Validate desk entries
  for (const d of desks as unknown[]) {
    if (typeof (d as Record<string, unknown>).desk_id !== 'string') {
      res.status(400).json({ error: 'each desk entry must have a desk_id string' });
      return;
    }
  }

  // Floor exists?
  const floorResult = await query<{ id: string }>('SELECT id FROM floors WHERE id = $1', [floor_id]);
  if (floorResult.rows.length === 0) {
    res.status(404).json({ error: 'Floor not found' });
    return;
  }

  const deskInputs = desks as DeskInput[];

  // Verify all desks exist and belong to this floor, then check conflicts
  const conflicts: string[] = [];
  for (const d of deskInputs) {
    const deskResult = await query<{ id: string; label: string }>(
      'SELECT id, label FROM desks WHERE id = $1 AND floor_id = $2 AND status = \'active\'',
      [d.desk_id, floor_id]
    );
    if (deskResult.rows.length === 0) {
      res.status(404).json({ error: `Desk ${d.desk_id} not found on this floor` });
      return;
    }
    const deskLabel = deskResult.rows[0].label;

    // Conflict with individual bookings
    const bookingConflict = await query<{ id: string }>(
      `SELECT id FROM bookings
       WHERE desk_id = $1 AND date = $2::date AND status = 'confirmed'`,
      [d.desk_id, date]
    );
    if (bookingConflict.rows.length > 0) {
      conflicts.push(deskLabel);
      continue;
    }

    // Conflict with other team bookings
    const teamConflict = await query<{ id: string }>(
      `SELECT tbd.id FROM team_booking_desks tbd
       JOIN team_bookings tb ON tb.id = tbd.team_booking_id
       WHERE tbd.desk_id = $1 AND tb.date = $2::date AND tb.status = 'confirmed'`,
      [d.desk_id, date]
    );
    if (teamConflict.rows.length > 0) {
      conflicts.push(deskLabel);
    }
  }

  if (conflicts.length > 0) {
    res.status(409).json({ error: 'Desk conflicts detected', conflicts });
    return;
  }

  // Insert team booking
  const tbResult = await query<{
    id: string; floor_id: string; created_by_user_id: string; date: string;
    title: string; status: string; created_at: string; updated_at: string;
  }>(
    `INSERT INTO team_bookings (floor_id, created_by_user_id, date, title)
     VALUES ($1, $2, $3::date, $4)
     RETURNING id, floor_id, created_by_user_id, date, title, status, created_at, updated_at`,
    [floor_id, userId, date, title]
  );
  const booking = tbResult.rows[0];

  // Insert desk assignments
  const deskRows = await query<{
    id: string; team_booking_id: string; desk_id: string; assigned_user_id: string | null;
  }>(
    `INSERT INTO team_booking_desks (team_booking_id, desk_id, assigned_user_id)
     SELECT $1, unnest($2::uuid[]), unnest($3::uuid[])
     RETURNING id, team_booking_id, desk_id, assigned_user_id`,
    [
      booking.id,
      deskInputs.map(d => d.desk_id),
      deskInputs.map(d => d.assigned_user_id ?? null),
    ]
  );

  res.status(201).json({ ...booking, desks: deskRows.rows });
});

// GET /api/team-bookings/me — list team bookings where user is creator or assigned
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const result = await query<{
    id: string; floor_id: string; created_by_user_id: string; date: string;
    title: string; status: string; created_at: string; floor_name: string;
  }>(
    `SELECT DISTINCT tb.id, tb.floor_id, tb.created_by_user_id, tb.date, tb.title, tb.status,
            tb.created_at, f.name AS floor_name
     FROM team_bookings tb
     JOIN floors f ON f.id = tb.floor_id
     LEFT JOIN team_booking_desks tbd ON tbd.team_booking_id = tb.id
     WHERE tb.created_by_user_id = $1 OR tbd.assigned_user_id = $1
     ORDER BY tb.date DESC`,
    [userId]
  );
  res.json(result.rows);
});

// GET /api/team-bookings — list team bookings (filter by date, floor)
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, floorId } = req.query as Record<string, string>;

  if (!date || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'date query param is required and must be in YYYY-MM-DD format' });
    return;
  }

  let result;
  if (floorId) {
    result = await query<{
      id: string; floor_id: string; created_by_user_id: string; date: string;
      title: string; status: string; created_at: string;
    }>(
      `SELECT id, floor_id, created_by_user_id, date, title, status, created_at
       FROM team_bookings
       WHERE date = $1::date AND floor_id = $2 AND status = 'confirmed'
       ORDER BY created_at`,
      [date, floorId]
    );
  } else {
    result = await query<{
      id: string; floor_id: string; created_by_user_id: string; date: string;
      title: string; status: string; created_at: string;
    }>(
      `SELECT id, floor_id, created_by_user_id, date, title, status, created_at
       FROM team_bookings
       WHERE date = $1::date AND status = 'confirmed'
       ORDER BY created_at`,
      [date]
    );
  }
  res.json(result.rows);
});

// GET /api/team-bookings/:id — detail with desk assignments
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const tbResult = await query<{
    id: string; floor_id: string; created_by_user_id: string; date: string;
    title: string; status: string; created_at: string; updated_at: string;
    floor_name: string;
  }>(
    `SELECT tb.id, tb.floor_id, tb.created_by_user_id, tb.date, tb.title, tb.status,
            tb.created_at, tb.updated_at, f.name AS floor_name
     FROM team_bookings tb
     JOIN floors f ON f.id = tb.floor_id
     WHERE tb.id = $1`,
    [id]
  );

  if (tbResult.rows.length === 0) {
    res.status(404).json({ error: 'Team booking not found' });
    return;
  }

  const desksResult = await query<{
    id: string; team_booking_id: string; desk_id: string; assigned_user_id: string | null;
    desk_label: string;
  }>(
    `SELECT tbd.id, tbd.team_booking_id, tbd.desk_id, tbd.assigned_user_id, d.label AS desk_label
     FROM team_booking_desks tbd
     JOIN desks d ON d.id = tbd.desk_id
     WHERE tbd.team_booking_id = $1
     ORDER BY d.label`,
    [id]
  );

  res.json({ ...tbResult.rows[0], desks: desksResult.rows });
});

// PATCH /api/team-bookings/:id — update desk assignments or cancel (admin only)
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const role = req.user!.role;
  if (role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: only admins can update team bookings' });
    return;
  }

  const { id } = req.params;
  const { desks } = req.body as { desks?: DeskInput[] };

  const existing = await query<{
    id: string; floor_id: string; date: string; status: string;
  }>('SELECT id, floor_id, date, status FROM team_bookings WHERE id = $1', [id]);

  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Team booking not found' });
    return;
  }

  const booking = existing.rows[0];

  if (desks !== undefined) {
    if (!Array.isArray(desks) || desks.length === 0) {
      res.status(400).json({ error: 'desks must be a non-empty array' });
      return;
    }

    // Conflict check for new desks (excluding current booking)
    const conflicts: string[] = [];
    for (const d of desks) {
      if (typeof d.desk_id !== 'string') {
        res.status(400).json({ error: 'each desk entry must have a desk_id string' });
        return;
      }

      const bookingConflict = await query<{ id: string }>(
        `SELECT id FROM bookings
         WHERE desk_id = $1 AND date = $2::date AND status = 'confirmed'`,
        [d.desk_id, booking.date]
      );
      if (bookingConflict.rows.length > 0) {
        conflicts.push(d.desk_id);
        continue;
      }

      const teamConflict = await query<{ id: string }>(
        `SELECT tbd.id FROM team_booking_desks tbd
         JOIN team_bookings tb ON tb.id = tbd.team_booking_id
         WHERE tbd.desk_id = $1 AND tb.date = $2::date AND tb.status = 'confirmed'
           AND tb.id != $3`,
        [d.desk_id, booking.date, id]
      );
      if (teamConflict.rows.length > 0) {
        conflicts.push(d.desk_id);
      }
    }

    if (conflicts.length > 0) {
      res.status(409).json({ error: 'Desk conflicts detected', conflicts });
      return;
    }

    // Replace desk assignments
    await query('DELETE FROM team_booking_desks WHERE team_booking_id = $1', [id]);
    await query(
      `INSERT INTO team_booking_desks (team_booking_id, desk_id, assigned_user_id)
       SELECT $1, unnest($2::uuid[]), unnest($3::uuid[])`,
      [id, desks.map(d => d.desk_id), desks.map(d => d.assigned_user_id ?? null)]
    );
  }

  // Return updated detail
  const tbResult = await query<{
    id: string; floor_id: string; created_by_user_id: string; date: string;
    title: string; status: string; created_at: string; updated_at: string;
  }>('SELECT id, floor_id, created_by_user_id, date, title, status, created_at, updated_at FROM team_bookings WHERE id = $1', [id]);

  const desksResult = await query<{
    id: string; desk_id: string; assigned_user_id: string | null; desk_label: string;
  }>(
    `SELECT tbd.id, tbd.desk_id, tbd.assigned_user_id, d.label AS desk_label
     FROM team_booking_desks tbd
     JOIN desks d ON d.id = tbd.desk_id
     WHERE tbd.team_booking_id = $1 ORDER BY d.label`,
    [id]
  );

  res.json({ ...tbResult.rows[0], desks: desksResult.rows });
});

// POST /api/team-bookings/:id/claim — claim an unassigned desk
router.post('/:id/claim', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;
  const { desk_id } = req.body as { desk_id?: unknown };

  if (typeof desk_id !== 'string' || !desk_id.trim()) {
    res.status(400).json({ error: 'desk_id is required' });
    return;
  }

  // Booking exists and is confirmed?
  const tbResult = await query<{ id: string; status: string }>(
    'SELECT id, status FROM team_bookings WHERE id = $1',
    [id]
  );
  if (tbResult.rows.length === 0) {
    res.status(404).json({ error: 'Team booking not found' });
    return;
  }
  if (tbResult.rows[0].status !== 'confirmed') {
    res.status(409).json({ error: 'Team booking is not active' });
    return;
  }

  // Find an unclaimed desk slot for this desk_id in this booking
  const deskResult = await query<{ id: string }>(
    `SELECT id FROM team_booking_desks
     WHERE team_booking_id = $1 AND desk_id = $2 AND assigned_user_id IS NULL`,
    [id, desk_id]
  );
  if (deskResult.rows.length === 0) {
    res.status(404).json({ error: 'No unclaimed desk slot found for this desk in the team booking' });
    return;
  }

  const slotId = deskResult.rows[0].id;

  // User already has a desk in this booking?
  const alreadyClaimed = await query<{ id: string }>(
    'SELECT id FROM team_booking_desks WHERE team_booking_id = $1 AND assigned_user_id = $2',
    [id, userId]
  );
  if (alreadyClaimed.rows.length > 0) {
    res.status(409).json({ error: 'You already have a desk in this team booking' });
    return;
  }

  // Claim it
  const claimResult = await query<{
    id: string; team_booking_id: string; desk_id: string; assigned_user_id: string;
  }>(
    `UPDATE team_booking_desks SET assigned_user_id = $1
     WHERE id = $2
     RETURNING id, team_booking_id, desk_id, assigned_user_id`,
    [userId, slotId]
  );

  res.json(claimResult.rows[0]);
});

// DELETE /api/team-bookings/:id — cancel entire team booking (admin only)
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const role = req.user!.role;
  if (role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: only admins can cancel team bookings' });
    return;
  }

  const { id } = req.params;

  const existing = await query<{ id: string; status: string }>(
    'SELECT id, status FROM team_bookings WHERE id = $1',
    [id]
  );

  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Team booking not found' });
    return;
  }

  if (existing.rows[0].status === 'cancelled') {
    res.status(409).json({ error: 'Team booking is already cancelled' });
    return;
  }

  await query('UPDATE team_bookings SET status = $1 WHERE id = $2', ['cancelled', id]);
  res.status(204).send();
});

export default router;
