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

// GET /api/admin/users — list all users in tenant (admin only)
router.get('/users', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const result = await query<{ id: string; email: string; name: string; role: string; created_at: string }>(
    'SELECT id, email, name, role, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  res.json(result.rows);
});

// PATCH /api/admin/users/:id — update user role (admin only)
router.patch('/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { role } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  if (role !== 'admin' && role !== 'member') {
    res.status(400).json({ error: 'role must be "admin" or "member"' });
    return;
  }

  const existing = await query<{ id: string }>('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const result = await query<{ id: string; email: string; name: string; role: string; created_at: string }>(
    'UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, email, name, role, created_at',
    [role, id, tenantId]
  );
  res.json(result.rows[0]);
});

// GET /api/admin/analytics — utilization analytics (admin only)
router.get('/analytics', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const daysParam = req.query.days;
  const allowedDays = [7, 30, 90];
  const days = daysParam !== undefined ? parseInt(String(daysParam), 10) : 30;
  const tenantId = req.user!.tenantId;

  if (!allowedDays.includes(days)) {
    res.status(400).json({ error: 'days must be 7, 30, or 90' });
    return;
  }

  // Total confirmed bookings in range for this tenant
  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE date >= CURRENT_DATE - ($1 || ' days')::INTERVAL AND status = 'confirmed' AND tenant_id = $2`,
    [days, tenantId]
  );
  const totalBookings = parseInt(totalResult.rows[0].count, 10);

  // Active desk count for this tenant
  const deskCountResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM desks WHERE status = 'active' AND tenant_id = $1`,
    [tenantId]
  );
  const totalActiveDesks = parseInt(deskCountResult.rows[0].count, 10);

  // Bookings per floor for this tenant
  const floorResult = await query<{
    floor_id: string;
    floor_name: string;
    bookings: string;
    active_desks: string;
  }>(
    `SELECT f.id AS floor_id, f.name AS floor_name,
            COUNT(b.id) AS bookings,
            COUNT(DISTINCT d.id) AS active_desks
     FROM floors f
     LEFT JOIN desks d ON d.floor_id = f.id AND d.status = 'active'
     LEFT JOIN bookings b ON b.desk_id = d.id
       AND b.date >= CURRENT_DATE - ($1 || ' days')::INTERVAL
       AND b.status = 'confirmed'
     WHERE f.tenant_id = $2
     GROUP BY f.id, f.name
     ORDER BY bookings DESC`,
    [days, tenantId]
  );

  const bookingsByFloor = floorResult.rows.map(row => {
    const bookings = parseInt(row.bookings, 10);
    const activeDesks = parseInt(row.active_desks, 10);
    const maxSlots = activeDesks * days;
    const utilizationRate = maxSlots > 0 ? Math.round((bookings / maxSlots) * 100 * 10) / 10 : 0;
    return { floorId: row.floor_id, floorName: row.floor_name, bookings, activeDesks, utilizationRate };
  });

  // Peak days (top 5) for this tenant
  const peakDaysResult = await query<{ date: string; bookings: string }>(
    `SELECT date::text, COUNT(*) AS bookings
     FROM bookings
     WHERE date >= CURRENT_DATE - ($1 || ' days')::INTERVAL AND status = 'confirmed' AND tenant_id = $2
     GROUP BY date
     ORDER BY bookings DESC
     LIMIT 5`,
    [days, tenantId]
  );
  const peakDays = peakDaysResult.rows.map(r => ({ date: r.date, bookings: parseInt(r.bookings, 10) }));

  // Peak time slots (top 5) for this tenant
  const peakSlotsResult = await query<{ start_time: string; end_time: string; bookings: string }>(
    `SELECT start_time::text, end_time::text, COUNT(*) AS bookings
     FROM bookings
     WHERE date >= CURRENT_DATE - ($1 || ' days')::INTERVAL AND status = 'confirmed' AND tenant_id = $2
     GROUP BY start_time, end_time
     ORDER BY bookings DESC
     LIMIT 5`,
    [days, tenantId]
  );
  const peakTimeSlots = peakSlotsResult.rows.map(r => ({
    startTime: r.start_time,
    endTime: r.end_time,
    bookings: parseInt(r.bookings, 10),
  }));

  // Top 10 most booked desks for this tenant
  const topDesksResult = await query<{
    desk_id: string;
    label: string;
    floor_id: string;
    floor_name: string;
    bookings: string;
  }>(
    `SELECT d.id AS desk_id, d.label, f.id AS floor_id, f.name AS floor_name,
            COUNT(b.id) AS bookings
     FROM desks d
     JOIN floors f ON f.id = d.floor_id
     LEFT JOIN bookings b ON b.desk_id = d.id
       AND b.date >= CURRENT_DATE - ($1 || ' days')::INTERVAL
       AND b.status = 'confirmed'
     WHERE d.status = 'active' AND d.tenant_id = $2
     GROUP BY d.id, d.label, f.id, f.name
     ORDER BY bookings DESC
     LIMIT 10`,
    [days, tenantId]
  );
  const topDesks = topDesksResult.rows.map(r => ({
    deskId: r.desk_id,
    label: r.label,
    floorId: r.floor_id,
    floorName: r.floor_name,
    bookings: parseInt(r.bookings, 10),
  }));

  // Least used active desks (bottom 10) for this tenant
  const leastUsedResult = await query<{
    desk_id: string;
    label: string;
    floor_id: string;
    floor_name: string;
    bookings: string;
  }>(
    `SELECT d.id AS desk_id, d.label, f.id AS floor_id, f.name AS floor_name,
            COUNT(b.id) AS bookings
     FROM desks d
     JOIN floors f ON f.id = d.floor_id
     LEFT JOIN bookings b ON b.desk_id = d.id
       AND b.date >= CURRENT_DATE - ($1 || ' days')::INTERVAL
       AND b.status = 'confirmed'
     WHERE d.status = 'active' AND d.tenant_id = $2
     GROUP BY d.id, d.label, f.id, f.name
     ORDER BY bookings ASC
     LIMIT 10`,
    [days, tenantId]
  );
  const leastUsedDesks = leastUsedResult.rows.map(r => ({
    deskId: r.desk_id,
    label: r.label,
    floorId: r.floor_id,
    floorName: r.floor_name,
    bookings: parseInt(r.bookings, 10),
  }));

  // Overall utilization rate
  const overallUtilization = totalActiveDesks * days > 0
    ? Math.round((totalBookings / (totalActiveDesks * days)) * 100 * 10) / 10
    : 0;

  const avgDailyBookings = days > 0 ? Math.round((totalBookings / days) * 10) / 10 : 0;

  res.json({
    days,
    totalBookings,
    avgDailyBookings,
    utilizationRate: overallUtilization,
    bookingsByFloor,
    peakDays,
    peakTimeSlots,
    topDesks,
    leastUsedDesks,
  });
});

// ── SSO Connections ────────────────────────────────────────────────────────

type SsoProviderType = 'oidc' | 'saml';

// GET /api/admin/sso-connections
router.get('/sso-connections', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const result = await query(
    `SELECT id, name, provider_type, config, enabled, created_at, updated_at
     FROM sso_connections WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  const rows = result.rows.map((row: Record<string, unknown>) => {
    const config = row.config as Record<string, unknown>;
    const safeConfig = { ...config };
    delete safeConfig.client_secret;
    delete safeConfig.idp_certificate;
    return { ...row, config: safeConfig };
  });
  res.json(rows);
});

// POST /api/admin/sso-connections
router.post('/sso-connections', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, provider_type, config } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  if (typeof name !== 'string' || !name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (provider_type !== 'oidc' && provider_type !== 'saml') {
    res.status(400).json({ error: 'provider_type must be "oidc" or "saml"' });
    return;
  }

  const result = await query(
    `INSERT INTO sso_connections (name, provider_type, config, tenant_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, provider_type, config, enabled, created_at, updated_at`,
    [name, provider_type as SsoProviderType, JSON.stringify(config ?? {}), tenantId],
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/admin/sso-connections/:id
router.patch('/sso-connections/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, config, enabled } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  const existing = await query('SELECT id FROM sso_connections WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (typeof name === 'string') {
    params.push(name);
    updates.push(`name = $${params.length}`);
  }
  if (config !== undefined) {
    params.push(JSON.stringify(config));
    updates.push(`config = $${params.length}`);
  }
  if (typeof enabled === 'boolean') {
    params.push(enabled);
    updates.push(`enabled = $${params.length}`);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  params.push(id);
  params.push(tenantId);
  const result = await query(
    `UPDATE sso_connections SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
     RETURNING id, name, provider_type, config, enabled, created_at, updated_at`,
    params,
  );
  const row = result.rows[0] as Record<string, unknown>;
  const rowConfig = row.config as Record<string, unknown>;
  const safeConfig = { ...rowConfig };
  delete safeConfig.client_secret;
  delete safeConfig.idp_certificate;
  res.json({ ...row, config: safeConfig });
});

// DELETE /api/admin/sso-connections/:id
router.delete('/sso-connections/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const existing = await query('SELECT id FROM sso_connections WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'SSO connection not found' });
    return;
  }

  await query('DELETE FROM sso_connections WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  res.status(204).end();
});

// ── Webhook Integrations ───────────────────────────────────────────────────

type IntegrationProvider = 'slack' | 'teams';
const VALID_EVENTS = ['booking_confirmed', 'booking_cancelled', 'booking_reminder'] as const;

// GET /api/admin/integrations
router.get('/integrations', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const result = await query(
    `SELECT id, name, provider, webhook_url, events, enabled, created_at, updated_at
     FROM integrations WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  res.json(result.rows);
});

// POST /api/admin/integrations
router.post('/integrations', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, provider, webhook_url, events } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (provider !== 'slack' && provider !== 'teams') {
    res.status(400).json({ error: 'provider must be "slack" or "teams"' });
    return;
  }
  if (typeof webhook_url !== 'string' || !webhook_url.trim()) {
    res.status(400).json({ error: 'webhook_url is required' });
    return;
  }

  let eventsArr: string[] = ['booking_confirmed', 'booking_cancelled', 'booking_reminder'];
  if (events !== undefined) {
    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'events must be an array' });
      return;
    }
    const invalid = (events as unknown[]).filter(e => !VALID_EVENTS.includes(e as typeof VALID_EVENTS[number]));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid events: ${invalid.join(', ')}` });
      return;
    }
    eventsArr = events as string[];
  }

  const result = await query(
    `INSERT INTO integrations (name, provider, webhook_url, events, tenant_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, provider, webhook_url, events, enabled, created_at, updated_at`,
    [name, provider as IntegrationProvider, webhook_url, JSON.stringify(eventsArr), tenantId],
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/admin/integrations/:id
router.patch('/integrations/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, webhook_url, events, enabled } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;

  const existing = await query('SELECT id FROM integrations WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Integration not found' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (typeof name === 'string') {
    params.push(name);
    updates.push(`name = $${params.length}`);
  }
  if (typeof webhook_url === 'string') {
    params.push(webhook_url);
    updates.push(`webhook_url = $${params.length}`);
  }
  if (events !== undefined) {
    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'events must be an array' });
      return;
    }
    const invalid = (events as unknown[]).filter(e => !VALID_EVENTS.includes(e as typeof VALID_EVENTS[number]));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid events: ${invalid.join(', ')}` });
      return;
    }
    params.push(JSON.stringify(events));
    updates.push(`events = $${params.length}`);
  }
  if (typeof enabled === 'boolean') {
    params.push(enabled);
    updates.push(`enabled = $${params.length}`);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  params.push(id);
  params.push(tenantId);
  const result = await query(
    `UPDATE integrations SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
     RETURNING id, name, provider, webhook_url, events, enabled, created_at, updated_at`,
    params,
  );
  res.json(result.rows[0]);
});

// DELETE /api/admin/integrations/:id
router.delete('/integrations/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const existing = await query('SELECT id FROM integrations WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Integration not found' });
    return;
  }

  await query('DELETE FROM integrations WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  res.status(204).end();
});

export default router;
