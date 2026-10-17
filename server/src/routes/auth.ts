import { NextFunction, Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/db.js';

const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';

export type AuthUser = { id: number; email: string; role: string; name: string };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.get('authorization');
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not logged in' });
  try {
    (req as any).user = jwt.verify(h.slice(7), secret()) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

/** Role gate. OWNER can do everything; STAFF manages catalog/orders/bot; AGENT only inbox. */
export function allow(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).user as AuthUser;
    if (u.role === 'OWNER' || roles.includes(u.role)) return next();
    res.status(403).json({ error: 'Not allowed for your role' });
  };
}

export const authRouter = Router();

// Simple brute-force protection: max 10 failed logins per IP per 15 minutes.
const failed = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60 * 1000;

authRouter.post('/login', async (req, res) => {
  const ip = req.ip ?? 'unknown';
  const f = failed.get(ip);
  if (f && f.until > Date.now() && f.n >= 10) return res.status(429).json({ error: 'Too many failed logins. Try again in 15 minutes.' });
  const { email, password } = req.body ?? {};
  const u = await prisma.adminUser.findUnique({ where: { email: String(email ?? '').toLowerCase().trim() } });
  if (!u || !(await bcrypt.compare(String(password ?? ''), u.passwordHash))) {
    const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + WINDOW };
    failed.set(ip, { n: cur.n + 1, until: cur.until });
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  failed.delete(ip);
  const user: AuthUser = { id: u.id, email: u.email, role: u.role, name: u.name };
  res.json({ token: jwt.sign(user, secret(), { expiresIn: '7d' }), user });
});

authRouter.get('/me', requireAuth, (req, res) => res.json((req as any).user));
