import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query } from '../db';
import { requireAuth, AuthRequest } from './middleware';
import { auditLogDirect } from '../services/audit';

function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
  }
  return (req.socket as { remoteAddress?: string })?.remoteAddress ?? null;
}

const router = Router();

function signToken(userId: string, role: string, tenantId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ sub: userId, role, tenantId }, secret, { expiresIn } as jwt.SignOptions);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function makeSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
  const suffix = randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password, name, orgName } = req.body as Record<string, unknown>;

  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password || typeof name !== 'string' || !name) {
    res.status(400).json({ error: 'email, password, and name are required' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  // Create a new tenant for this registrant
  const tenantName = typeof orgName === 'string' && orgName.trim() ? orgName.trim() : `${name}'s Organization`;
  const slug = makeSlug(tenantName);
  const tenantResult = await query<{ id: string; name: string; slug: string }>(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
    [tenantName, slug]
  );
  const tenant = tenantResult.rows[0];

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query<{ id: string; email: string; name: string; role: string; tenant_id: string }>(
    `INSERT INTO users (email, password_hash, name, role, tenant_id)
     VALUES ($1, $2, $3, 'admin', $4)
     RETURNING id, email, name, role, tenant_id`,
    [email, passwordHash, name, tenant.id]
  );
  const user = result.rows[0];
  const token = signToken(user.id, user.role, user.tenant_id);

  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, tenantName: tenant.name, onboardingCompleted: false },
  });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as Record<string, unknown>;

  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const result = await query<{
    id: string; email: string; name: string; role: string;
    password_hash: string | null; tenant_id: string; tenant_name: string;
    status: string; onboarding_completed: boolean;
  }>(
    `SELECT u.id, u.email, u.name, u.role, u.password_hash, u.tenant_id, t.name AS tenant_name,
            u.status, t.onboarding_completed
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = $1`,
    [email]
  );
  const user = result.rows[0];

  const ipAddress = getClientIp(req);
  const userAgent = req.headers['user-agent'] ?? null;

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (user.status === 'deactivated') {
    res.status(403).json({ error: 'Your account has been deactivated. Contact your administrator.' });
    return;
  }

  if (!user.password_hash) {
    res.status(401).json({ error: 'This account uses SSO. Please sign in with your identity provider.' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    auditLogDirect({
      tenantId: user.tenant_id,
      actorId: user.id,
      actorEmail: user.email,
      action: 'login_failed',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
    });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  auditLogDirect({
    tenantId: user.tenant_id,
    actorId: user.id,
    actorEmail: user.email,
    action: 'login',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress,
    userAgent,
  });
  const token = signToken(user.id, user.role, user.tenant_id);
  res.status(200).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, tenantName: user.tenant_name, onboardingCompleted: user.onboarding_completed },
  });
});

// GET /api/auth/invite/:token — validate an invitation token
router.get('/invite/:token', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  const result = await query<{
    id: string; email: string; role: string; expires_at: string; used_at: string | null; tenant_name: string;
  }>(
    `SELECT i.id, i.email, i.role, i.expires_at, i.used_at, t.name AS tenant_name
     FROM user_invitations i JOIN tenants t ON t.id = i.tenant_id
     WHERE i.token = $1`,
    [token]
  );
  const inv = result.rows[0];
  if (!inv) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  if (inv.used_at) {
    res.status(410).json({ error: 'Invitation has already been used' });
    return;
  }
  if (new Date(inv.expires_at) < new Date()) {
    res.status(410).json({ error: 'Invitation has expired' });
    return;
  }
  res.json({ id: inv.id, email: inv.email, role: inv.role, tenantName: inv.tenant_name });
});

// POST /api/auth/accept-invite — complete registration via invitation
router.post('/accept-invite', async (req: Request, res: Response): Promise<void> => {
  const { token, name, password } = req.body as Record<string, unknown>;

  if (typeof token !== 'string' || !token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const invResult = await query<{
    id: string; email: string; role: string; tenant_id: string; expires_at: string; used_at: string | null;
  }>(
    'SELECT id, email, role, tenant_id, expires_at, used_at FROM user_invitations WHERE token = $1',
    [token]
  );
  const inv = invResult.rows[0];
  if (!inv) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  if (inv.used_at) {
    res.status(410).json({ error: 'Invitation has already been used' });
    return;
  }
  if (new Date(inv.expires_at) < new Date()) {
    res.status(410).json({ error: 'Invitation has expired' });
    return;
  }

  const existingUser = await query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
    [inv.email, inv.tenant_id]
  );
  if (existingUser.rows.length > 0) {
    res.status(409).json({ error: 'An account with this email already exists in this organization' });
    return;
  }

  const passwordHash = await bcrypt.hash(password as string, 10);
  const userResult = await query<{ id: string; email: string; name: string; role: string; tenant_id: string }>(
    `INSERT INTO users (email, password_hash, name, role, tenant_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, role, tenant_id`,
    [inv.email, passwordHash, (name as string).trim(), inv.role, inv.tenant_id]
  );
  const user = userResult.rows[0];

  await query('UPDATE user_invitations SET used_at = now() WHERE id = $1', [inv.id]);

  const tenantResult = await query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [inv.tenant_id]);
  const tenantName = tenantResult.rows[0]?.name ?? '';
  const jwtToken = signToken(user.id, user.role, user.tenant_id);

  res.status(201).json({
    token: jwtToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, tenantName },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const result = await query<{ id: string; email: string; name: string; role: string; tenant_id: string; tenant_name: string; onboarding_completed: boolean }>(
    `SELECT u.id, u.email, u.name, u.role, u.tenant_id, t.name AS tenant_name, t.onboarding_completed
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1`,
    [userId]
  );
  const user = result.rows[0];

  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  res.status(200).json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenant_id,
    tenantName: user.tenant_name,
    onboardingCompleted: user.onboarding_completed,
  });
});

export default router;
