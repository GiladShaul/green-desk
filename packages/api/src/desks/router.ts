import { Router, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { auditLog } from '../services/audit';

const router = Router();

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin access required' });
    return;
  }
  next();
}

// POST /api/desks — create desk on a floor (admin only)
router.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { floor_id, label, x_position, y_position, status } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  if (typeof floor_id !== 'string' || !floor_id.trim()) {
    res.status(400).json({ error: 'floor_id is required' });
    return;
  }
  if (typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ error: 'label is required' });
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

  // Check floor exists and belongs to tenant
  const floorResult = await query<{ id: string }>('SELECT id FROM floors WHERE id = $1 AND tenant_id = $2', [floor_id, tenantId]);
  if (floorResult.rows.length === 0) {
    res.status(404).json({ error: 'Floor not found' });
    return;
  }

  const result = await query<{
    id: string; floor_id: string; label: string; x_position: number; y_position: number; status: string; created_at: string;
  }>(
    `INSERT INTO desks (floor_id, label, x_position, y_position, status, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, floor_id, label, x_position, y_position, status, created_at`,
    [floor_id, label.trim(), x_position ?? 0, y_position ?? 0, status ?? 'active', tenantId]
  );
  auditLog(req, { action: 'create', resourceType: 'desk', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// PATCH /api/desks/:id — update desk (admin only)
router.patch('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { label, x_position, y_position, status } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  if (label !== undefined && (typeof label !== 'string' || !label.trim())) {
    res.status(400).json({ error: 'label must be a non-empty string' });
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

  // Check desk exists and belongs to tenant
  const existing = await query<{ id: string; floor_id: string; label: string; x_position: number; y_position: number; status: string; created_at: string }>(
    'SELECT id, floor_id, label, x_position, y_position, status, created_at FROM desks WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Desk not found' });
    return;
  }

  const desk = existing.rows[0];
  const newLabel = typeof label === 'string' ? label.trim() : desk.label;
  const newX = x_position !== undefined ? x_position : desk.x_position;
  const newY = y_position !== undefined ? y_position : desk.y_position;
  const newStatus = status !== undefined ? status : desk.status;

  const result = await query<{
    id: string; floor_id: string; label: string; x_position: number; y_position: number; status: string; created_at: string;
  }>(
    `UPDATE desks SET label = $1, x_position = $2, y_position = $3, status = $4
     WHERE id = $5 AND tenant_id = $6
     RETURNING id, floor_id, label, x_position, y_position, status, created_at`,
    [newLabel, newX, newY, newStatus, id, tenantId]
  );
  auditLog(req, {
    action: 'update', resourceType: 'desk', resourceId: id,
    changes: { label: { old: desk.label, new: newLabel }, status: { old: desk.status, new: newStatus } },
  });
  res.json(result.rows[0]);
});

// DELETE /api/desks/:id — soft-delete / deactivate desk (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const existing = await query<{ id: string }>('SELECT id FROM desks WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Desk not found' });
    return;
  }

  await query('UPDATE desks SET status = $1 WHERE id = $2 AND tenant_id = $3', ['inactive', id, tenantId]);
  auditLog(req, { action: 'delete', resourceType: 'desk', resourceId: id });
  res.status(204).send();
});

export default router;
