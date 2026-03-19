import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query } from '../db';
import { requireAuth, AuthRequest } from './middleware';

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
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, tenantName: tenant.name },
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
  }>(
    `SELECT u.id, u.email, u.name, u.role, u.password_hash, u.tenant_id, t.name AS tenant_name
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = $1`,
    [email]
  );
  const user = result.rows[0];

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!user.password_hash) {
    res.status(401).json({ error: 'This account uses SSO. Please sign in with your identity provider.' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken(user.id, user.role, user.tenant_id);
  res.status(200).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id, tenantName: user.tenant_name },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const result = await query<{ id: string; email: string; name: string; role: string; tenant_id: string; tenant_name: string }>(
    `SELECT u.id, u.email, u.name, u.role, u.tenant_id, t.name AS tenant_name
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
  });
});

export default router;
