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

// POST /api/rooms — create a room (admin only)
router.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { floor_id, name, capacity, x_position, y_position, status, equipment } = req.body as Record<string, unknown>;

  if (typeof floor_id !== 'string' || !floor_id.trim()) {
    res.status(400).json({ error: 'floor_id is required' });
    return;
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (capacity !== undefined && (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1)) {
    res.status(400).json({ error: 'capacity must be a positive integer' });
    return;
  }
  if (x_position !== undefined && typeof x_position !== 'number') {
    res.status(400).json({ error: 'x_position must be a number' });
    return;
  }
  if (y_position !== undefined && typeof y_position !== 'number') {
    res.status(400).json({ error: 'y_position must be a number' });
    return;
  }
  if (status !== undefined && status !== 'active' && status !== 'inactive') {
    res.status(400).json({ error: 'status must be "active" or "inactive"' });
    return;
  }
  if (equipment !== undefined && !Array.isArray(equipment)) {
    res.status(400).json({ error: 'equipment must be an array of strings' });
    return;
  }
  if (Array.isArray(equipment) && !equipment.every((t) => typeof t === 'string')) {
    res.status(400).json({ error: 'equipment tags must be strings' });
    return;
  }

  // Check floor exists
  const floorResult = await query<{ id: string }>('SELECT id FROM floors WHERE id = $1', [floor_id]);
  if (floorResult.rows.length === 0) {
    res.status(404).json({ error: 'Floor not found' });
    return;
  }

  const result = await query<{
    id: string; floor_id: string; name: string; capacity: number;
    status: string; x_position: number; y_position: number; created_at: string; updated_at: string;
  }>(
    `INSERT INTO rooms (floor_id, name, capacity, x_position, y_position, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, floor_id, name, capacity, status, x_position, y_position, created_at, updated_at`,
    [floor_id, name.trim(), capacity ?? 4, x_position ?? 0, y_position ?? 0, status ?? 'active']
  );
  const room = result.rows[0];

  // Insert equipment tags if provided
  const tags: string[] = Array.isArray(equipment) ? (equipment as string[]).map(t => t.trim()).filter(Boolean) : [];
  if (tags.length > 0) {
    for (const tag of tags) {
      await query('INSERT INTO room_equipment (room_id, tag) VALUES ($1, $2)', [room.id, tag]);
    }
  }

  res.status(201).json({ ...room, equipment: tags });
});

// PATCH /api/rooms/:id — update room details (admin only)
router.patch('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, capacity, x_position, y_position, status, equipment } = req.body as Record<string, unknown>;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  if (capacity !== undefined && (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1)) {
    res.status(400).json({ error: 'capacity must be a positive integer' });
    return;
  }
  if (x_position !== undefined && typeof x_position !== 'number') {
    res.status(400).json({ error: 'x_position must be a number' });
    return;
  }
  if (y_position !== undefined && typeof y_position !== 'number') {
    res.status(400).json({ error: 'y_position must be a number' });
    return;
  }
  if (status !== undefined && status !== 'active' && status !== 'inactive') {
    res.status(400).json({ error: 'status must be "active" or "inactive"' });
    return;
  }
  if (equipment !== undefined && !Array.isArray(equipment)) {
    res.status(400).json({ error: 'equipment must be an array of strings' });
    return;
  }
  if (Array.isArray(equipment) && !equipment.every((t) => typeof t === 'string')) {
    res.status(400).json({ error: 'equipment tags must be strings' });
    return;
  }

  const existing = await query<{
    id: string; floor_id: string; name: string; capacity: number;
    status: string; x_position: number; y_position: number;
  }>(
    'SELECT id, floor_id, name, capacity, status, x_position, y_position FROM rooms WHERE id = $1',
    [id]
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  const room = existing.rows[0];
  const newName = typeof name === 'string' ? name.trim() : room.name;
  const newCapacity = capacity !== undefined ? capacity : room.capacity;
  const newX = x_position !== undefined ? x_position : room.x_position;
  const newY = y_position !== undefined ? y_position : room.y_position;
  const newStatus = status !== undefined ? status : room.status;

  const result = await query<{
    id: string; floor_id: string; name: string; capacity: number;
    status: string; x_position: number; y_position: number; created_at: string; updated_at: string;
  }>(
    `UPDATE rooms SET name = $1, capacity = $2, x_position = $3, y_position = $4, status = $5
     WHERE id = $6
     RETURNING id, floor_id, name, capacity, status, x_position, y_position, created_at, updated_at`,
    [newName, newCapacity, newX, newY, newStatus, id]
  );

  // Replace equipment tags if provided
  let tags: string[] = [];
  if (Array.isArray(equipment)) {
    tags = (equipment as string[]).map(t => t.trim()).filter(Boolean);
    await query('DELETE FROM room_equipment WHERE room_id = $1', [id]);
    for (const tag of tags) {
      await query('INSERT INTO room_equipment (room_id, tag) VALUES ($1, $2)', [id, tag]);
    }
  } else {
    const eqResult = await query<{ tag: string }>('SELECT tag FROM room_equipment WHERE room_id = $1 ORDER BY tag', [id]);
    tags = eqResult.rows.map(r => r.tag);
  }

  res.json({ ...result.rows[0], equipment: tags });
});

export default router;
