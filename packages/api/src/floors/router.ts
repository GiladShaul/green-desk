import { Router, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';

const router = Router();

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin access required' });
    return;
  }
  next();
}

// GET /api/floors — list all floors
router.get('/', requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  const result = await query<{ id: string; name: string; building: string; floor_number: number; created_at: string }>(
    'SELECT id, name, building, floor_number, created_at FROM floors ORDER BY building, floor_number'
  );
  res.json(result.rows);
});

// POST /api/floors — create floor (admin only)
router.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, building, floor_number } = req.body as Record<string, unknown>;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof building !== 'string' || !building.trim()) {
    res.status(400).json({ error: 'building is required' });
    return;
  }
  if (typeof floor_number !== 'number' || !Number.isInteger(floor_number)) {
    res.status(400).json({ error: 'floor_number must be an integer' });
    return;
  }

  const result = await query<{ id: string; name: string; building: string; floor_number: number; created_at: string }>(
    'INSERT INTO floors (name, building, floor_number) VALUES ($1, $2, $3) RETURNING id, name, building, floor_number, created_at',
    [name.trim(), building.trim(), floor_number]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/floors/:id — update floor (admin only)
router.patch('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, building, floor_number } = req.body as Record<string, unknown>;

  const existing = await query<{ id: string; name: string; building: string; floor_number: number; created_at: string }>(
    'SELECT id, name, building, floor_number, created_at FROM floors WHERE id = $1',
    [id]
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Floor not found' });
    return;
  }

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  if (building !== undefined && (typeof building !== 'string' || !building.trim())) {
    res.status(400).json({ error: 'building must be a non-empty string' });
    return;
  }
  if (floor_number !== undefined && (typeof floor_number !== 'number' || !Number.isInteger(floor_number))) {
    res.status(400).json({ error: 'floor_number must be an integer' });
    return;
  }

  const floor = existing.rows[0];
  const newName = typeof name === 'string' ? name.trim() : floor.name;
  const newBuilding = typeof building === 'string' ? building.trim() : floor.building;
  const newFloorNumber = floor_number !== undefined ? floor_number : floor.floor_number;

  const result = await query<{ id: string; name: string; building: string; floor_number: number; created_at: string }>(
    'UPDATE floors SET name = $1, building = $2, floor_number = $3 WHERE id = $4 RETURNING id, name, building, floor_number, created_at',
    [newName, newBuilding, newFloorNumber, id]
  );
  res.json(result.rows[0]);
});

// DELETE /api/floors/:id — delete floor if no active desks (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const existing = await query<{ id: string }>('SELECT id FROM floors WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Floor not found' });
    return;
  }

  const activeDesks = await query<{ count: string }>(
    "SELECT COUNT(*) as count FROM desks WHERE floor_id = $1 AND status = 'active'",
    [id]
  );
  if (parseInt(activeDesks.rows[0].count, 10) > 0) {
    res.status(409).json({ error: 'Cannot delete floor with active desks' });
    return;
  }

  await query('DELETE FROM floors WHERE id = $1', [id]);
  res.status(204).send();
});

// GET /api/floors/:id — get a single floor
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const result = await query<{ id: string; name: string; building: string; floor_number: number; created_at: string }>(
    'SELECT id, name, building, floor_number, created_at FROM floors WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Floor not found' });
    return;
  }
  res.json(result.rows[0]);
});

// GET /api/floors/:id/desks — list desks on a floor with availability for a given date
router.get('/:id/desks', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { date } = req.query as Record<string, string>;

  // Check floor exists
  const floorResult = await query<{ id: string }>('SELECT id FROM floors WHERE id = $1', [id]);
  if (floorResult.rows.length === 0) {
    res.status(404).json({ error: 'Floor not found' });
    return;
  }

  if (date) {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
      return;
    }

    const result = await query<{
      id: string; floor_id: string; label: string; x_position: number; y_position: number;
      status: string; created_at: string; availability: string; has_recurring: boolean;
    }>(
      `SELECT d.id, d.floor_id, d.label, d.x_position, d.y_position, d.status, d.created_at,
        CASE WHEN COUNT(b.id) > 0 THEN 'booked' ELSE 'available' END AS availability,
        EXISTS(
          SELECT 1 FROM recurring_bookings rb
          WHERE rb.desk_id = d.id
            AND rb.day_of_week = EXTRACT(DOW FROM $2::date)::integer
            AND rb.start_date <= $2::date
            AND (rb.end_date IS NULL OR rb.end_date >= $2::date)
        ) AS has_recurring
       FROM desks d
       LEFT JOIN bookings b ON b.desk_id = d.id AND b.date = $2::date AND b.status = 'confirmed'
       WHERE d.floor_id = $1
       GROUP BY d.id
       ORDER BY d.label`,
      [id, date]
    );
    res.json(result.rows);
  } else {
    const result = await query<{
      id: string; floor_id: string; label: string; x_position: number; y_position: number;
      status: string; created_at: string;
    }>(
      'SELECT id, floor_id, label, x_position, y_position, status, created_at FROM desks WHERE floor_id = $1 ORDER BY label',
      [id]
    );
    res.json(result.rows);
  }
});

export default router;
