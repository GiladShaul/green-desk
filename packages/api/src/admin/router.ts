import { Router, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { query } from '../db';
import { requireAuth, AuthRequest } from '../auth/middleware';
import { getTenantPlanLimits } from '../billing/plans';
import { auditLog } from '../services/audit';
import { logger } from '../logger';

const router = Router();

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin access required' });
    return;
  }
  next();
}

// GET /api/admin/users — list all users in tenant, with optional search/filter
router.get('/users', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { search, role, status } = req.query as Record<string, string | undefined>;

  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (role) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const result = await query<{ id: string; email: string; name: string; role: string; status: string; created_at: string }>(
    `SELECT id, email, name, role, status, created_at FROM users WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  res.json(result.rows);
});

// PATCH /api/admin/users/:id — update role and/or status (admin only)
router.patch('/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { role, status } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;
  const actingUserId = req.user!.sub;

  if (role !== undefined && role !== 'admin' && role !== 'member' && role !== 'viewer') {
    res.status(400).json({ error: 'role must be "admin", "member", or "viewer"' });
    return;
  }
  if (status !== undefined && status !== 'active' && status !== 'deactivated') {
    res.status(400).json({ error: 'status must be "active" or "deactivated"' });
    return;
  }

  const existing = await query<{ id: string }>('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (id === actingUserId && status === 'deactivated') {
    res.status(400).json({ error: 'You cannot deactivate your own account' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  const changes: Record<string, unknown> = {};

  if (role !== undefined) {
    params.push(role);
    updates.push(`role = $${params.length}`);
    changes.role = { new: role };
  }
  if (status !== undefined) {
    params.push(status);
    updates.push(`status = $${params.length}`);
    changes.status = { new: status };
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  params.push(id);
  params.push(tenantId);
  const result = await query<{ id: string; email: string; name: string; role: string; status: string; created_at: string }>(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
     RETURNING id, email, name, role, status, created_at`,
    params
  );
  auditLog(req, { action: 'update', resourceType: 'user', resourceId: id, changes });
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
  auditLog(req, { action: 'create', resourceType: 'sso_connection', resourceId: (result.rows[0] as { id: string }).id });
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
  auditLog(req, { action: 'update', resourceType: 'sso_connection', resourceId: id });
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
  auditLog(req, { action: 'delete', resourceType: 'sso_connection', resourceId: id });
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
  auditLog(req, { action: 'create', resourceType: 'integration', resourceId: (result.rows[0] as { id: string }).id });
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
  auditLog(req, { action: 'update', resourceType: 'integration', resourceId: id });
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
  auditLog(req, { action: 'delete', resourceType: 'integration', resourceId: id });
  res.status(204).end();
});

// POST /api/admin/users/invite — create an invitation link (admin only)
router.post('/users/invite', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { email, role } = req.body as Record<string, unknown>;
  const tenantId = req.user!.tenantId;
  const invitedBy = req.user!.sub;

  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const inviteRole = (role === 'admin' || role === 'member' || role === 'viewer') ? role : 'member';

  // Check seat limit
  const { seatsLimit } = await getTenantPlanLimits(tenantId);
  if (seatsLimit !== null) {
    const countResult = await query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM users WHERE tenant_id = $1 AND status = $2',
      [tenantId, 'active']
    );
    if (parseInt(countResult.rows[0].count, 10) >= seatsLimit) {
      res.status(402).json({
        error: 'Seat limit reached for your plan. Upgrade to add more users.',
        upgradeUrl: '/api/billing/checkout',
      });
      return;
    }
  }

  // Don't re-invite someone already in this tenant
  const existingUser = await query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
    [normalizedEmail, tenantId]
  );
  if (existingUser.rows.length > 0) {
    res.status(409).json({ error: 'A user with that email already exists in this organization' });
    return;
  }

  // Expire any outstanding invite for the same email in this tenant
  await query(
    `UPDATE user_invitations SET used_at = now() WHERE tenant_id = $1 AND email = $2 AND used_at IS NULL`,
    [tenantId, normalizedEmail]
  );

  const token = randomBytes(32).toString('hex');
  const result = await query<{ id: string; email: string; role: string; token: string; expires_at: string }>(
    `INSERT INTO user_invitations (tenant_id, email, role, token, invited_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, role, token, expires_at`,
    [tenantId, normalizedEmail, inviteRole, token, invitedBy]
  );

  const invitation = result.rows[0];
  const inviteUrl = `${process.env.APP_URL ?? 'http://localhost:5173'}/accept-invite?token=${invitation.token}`;
  logger.info({ email: normalizedEmail, inviteUrl }, '[invite] Invitation created');

  auditLog(req, { action: 'create', resourceType: 'user', resourceId: invitation.id, changes: { email: normalizedEmail, role: inviteRole } });
  res.status(201).json({ ...invitation, inviteUrl });
});

// POST /api/admin/users/bulk-invite — invite multiple users from CSV body (admin only)
// Body: { rows: Array<{ email: string; role?: string }> }
router.post('/users/bulk-invite', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { rows } = req.body as { rows?: unknown };
  const tenantId = req.user!.tenantId;
  const invitedBy = req.user!.sub;

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows must be a non-empty array' });
    return;
  }
  if (rows.length > 200) {
    res.status(400).json({ error: 'Maximum 200 invitations per batch' });
    return;
  }

  const { seatsLimit } = await getTenantPlanLimits(tenantId);
  const activeCount = seatsLimit !== null
    ? parseInt((await query<{ count: string }>('SELECT COUNT(*) AS count FROM users WHERE tenant_id = $1 AND status = $2', [tenantId, 'active'])).rows[0].count, 10)
    : 0;

  const results: Array<{ email: string; status: 'invited' | 'skipped'; reason?: string; inviteUrl?: string }> = [];

  for (const row of rows as Record<string, unknown>[]) {
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : null;
    if (!email) {
      results.push({ email: String(row.email ?? ''), status: 'skipped', reason: 'Invalid email' });
      continue;
    }

    const inviteRole = row.role === 'admin' || row.role === 'member' || row.role === 'viewer' ? row.role : 'member';

    if (seatsLimit !== null && activeCount + results.filter(r => r.status === 'invited').length >= seatsLimit) {
      results.push({ email, status: 'skipped', reason: 'Seat limit reached' });
      continue;
    }

    const existingUser = await query<{ id: string }>('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [email, tenantId]);
    if (existingUser.rows.length > 0) {
      results.push({ email, status: 'skipped', reason: 'Already a member' });
      continue;
    }

    await query(`UPDATE user_invitations SET used_at = now() WHERE tenant_id = $1 AND email = $2 AND used_at IS NULL`, [tenantId, email]);
    const token = randomBytes(32).toString('hex');
    await query(
      `INSERT INTO user_invitations (tenant_id, email, role, token, invited_by) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, email, inviteRole, token, invitedBy]
    );
    const inviteUrl = `${process.env.APP_URL ?? 'http://localhost:5173'}/accept-invite?token=${token}`;
    results.push({ email, status: 'invited', inviteUrl });
  }

  res.status(207).json({ results });
});

// ── Tenant Settings ────────────────────────────────────────────────────────

// GET /api/admin/tenant — get tenant settings
router.get('/tenant', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const result = await query<{ id: string; name: string; plan: string; timezone: string; booking_rules: Record<string, unknown>; onboarding_completed: boolean }>(
    'SELECT id, name, plan, timezone, booking_rules, onboarding_completed FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  res.json(result.rows[0]);
});

// PATCH /api/admin/tenant — update tenant settings
router.patch('/tenant', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { timezone, booking_rules, onboarding_completed } = req.body as Record<string, unknown>;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (typeof timezone === 'string') {
    params.push(timezone);
    updates.push(`timezone = $${params.length}`);
  }
  if (booking_rules !== undefined && typeof booking_rules === 'object') {
    params.push(JSON.stringify(booking_rules));
    updates.push(`booking_rules = $${params.length}`);
  }
  if (typeof onboarding_completed === 'boolean') {
    params.push(onboarding_completed);
    updates.push(`onboarding_completed = $${params.length}`);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' });
    return;
  }

  params.push(tenantId);
  const result = await query<{ id: string; name: string; plan: string; timezone: string; booking_rules: Record<string, unknown>; onboarding_completed: boolean }>(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, name, plan, timezone, booking_rules, onboarding_completed`,
    params
  );
  auditLog(req, { action: 'update', resourceType: 'tenant', resourceId: tenantId });
  res.json(result.rows[0]);
});

// ── Audit Logs ─────────────────────────────────────────────────────────────

// GET /api/admin/audit-logs — paginated audit log (admin only)
router.get('/audit-logs', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const {
    page: pageParam,
    pageSize: pageSizeParam,
    from,
    to,
    actor,
    resourceType,
    action,
  } = req.query as Record<string, string>;

  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeParam ?? '50', 10) || 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['al.tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (from) {
    params.push(from);
    conditions.push(`al.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    conditions.push(`al.created_at <= $${params.length}::timestamptz`);
  }
  if (actor) {
    params.push(`%${actor}%`);
    conditions.push(`al.actor_email ILIKE $${params.length}`);
  }
  if (resourceType) {
    params.push(resourceType);
    conditions.push(`al.resource_type = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`al.action = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM audit_logs al WHERE ${where}`,
    params,
  );
  const total = parseInt(totalResult.rows[0].count, 10);

  params.push(pageSize);
  params.push(offset);
  const logsResult = await query(
    `SELECT al.id, al.actor_id, al.actor_email, al.action, al.resource_type,
            al.resource_id, al.changes, al.ip_address, al.user_agent, al.created_at
     FROM audit_logs al
     WHERE ${where}
     ORDER BY al.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ logs: logsResult.rows, total, page, pageSize });
});

// ── Check-in Settings ─────────────────────────────────────────────────────

// GET /api/admin/checkin-settings
router.get('/checkin-settings', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const result = await query<{ tenant_id: string; checkin_enabled: boolean; checkin_window_minutes: number }>(
    `SELECT tenant_id, checkin_enabled, checkin_window_minutes
     FROM tenant_checkin_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  if (result.rows.length === 0) {
    res.json({ tenant_id: tenantId, checkin_enabled: true, checkin_window_minutes: 15 });
    return;
  }
  res.json(result.rows[0]);
});

// PUT /api/admin/checkin-settings
router.put('/checkin-settings', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { checkin_enabled, checkin_window_minutes } = req.body as Record<string, unknown>;

  if (checkin_enabled !== undefined && typeof checkin_enabled !== 'boolean') {
    res.status(400).json({ error: 'checkin_enabled must be a boolean' });
    return;
  }
  if (checkin_window_minutes !== undefined) {
    if (typeof checkin_window_minutes !== 'number' || checkin_window_minutes < 1 || checkin_window_minutes > 120) {
      res.status(400).json({ error: 'checkin_window_minutes must be a number between 1 and 120' });
      return;
    }
  }

  const result = await query<{ tenant_id: string; checkin_enabled: boolean; checkin_window_minutes: number }>(
    `INSERT INTO tenant_checkin_settings (tenant_id, checkin_enabled, checkin_window_minutes)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE
       SET checkin_enabled = EXCLUDED.checkin_enabled,
           checkin_window_minutes = EXCLUDED.checkin_window_minutes,
           updated_at = now()
     RETURNING tenant_id, checkin_enabled, checkin_window_minutes`,
    [tenantId, checkin_enabled ?? true, checkin_window_minutes ?? 15],
  );
  auditLog(req, { action: 'update', resourceType: 'checkin_settings', resourceId: tenantId });
  res.json(result.rows[0]);
});

// GET /api/admin/no-show-report?from=YYYY-MM-DD&to=YYYY-MM-DD&floorId=X&userId=X
router.get('/no-show-report', requireAuth, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { from, to, floorId, userId } = req.query as Record<string, string>;

  const conditions: string[] = ['b.tenant_id = $1', "b.status = 'no_show'"];
  const params: unknown[] = [tenantId];

  if (from) {
    params.push(from);
    conditions.push(`b.date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`b.date <= $${params.length}::date`);
  }
  if (floorId) {
    params.push(floorId);
    conditions.push(`d.floor_id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`b.user_id = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const [bookingsResult, summaryResult] = await Promise.all([
    query<{
      id: string; date: string; start_time: string; end_time: string;
      desk_label: string; floor_name: string; building: string;
      user_id: string; user_name: string; user_email: string;
      no_show_released_at: string;
    }>(
      `SELECT b.id, b.date::text, b.start_time::text, b.end_time::text,
              d.label AS desk_label, f.name AS floor_name, f.building,
              u.id AS user_id, u.name AS user_name, u.email AS user_email,
              b.no_show_released_at
       FROM bookings b
       JOIN desks d ON d.id = b.desk_id
       JOIN floors f ON f.id = d.floor_id
       JOIN users u ON u.id = b.user_id
       WHERE ${where}
       ORDER BY b.date DESC, b.start_time DESC
       LIMIT 500`,
      params,
    ),
    query<{ user_id: string; user_name: string; user_email: string; no_show_count: string }>(
      `SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email,
              COUNT(b.id)::text AS no_show_count
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       WHERE ${where}
       GROUP BY u.id, u.name, u.email
       ORDER BY no_show_count DESC`,
      params,
    ),
  ]);

  res.json({
    total: bookingsResult.rows.length,
    bookings: bookingsResult.rows,
    byUser: summaryResult.rows.map(r => ({
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      noShowCount: parseInt(r.no_show_count, 10),
    })),
  });
});

export default router;
