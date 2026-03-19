import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { requireAuth, AuthRequest } from './middleware';

const router = Router();

function signToken(userId: string, role: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ sub: userId, role }, secret, { expiresIn } as jwt.SignOptions);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password, name } = req.body as Record<string, unknown>;

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

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query<{ id: string; email: string; name: string; role: string }>(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, role',
    [email, passwordHash, name]
  );
  const user = result.rows[0];
  const token = signToken(user.id, user.role);

  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as Record<string, unknown>;

  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const result = await query<{ id: string; email: string; name: string; role: string; password_hash: string | null }>(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
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

  const token = signToken(user.id, user.role);
  res.status(200).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const result = await query<{ id: string; email: string; name: string; role: string }>(
    'SELECT id, email, name, role FROM users WHERE id = $1',
    [userId]
  );
  const user = result.rows[0];

  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  res.status(200).json(user);
});

export default router;
