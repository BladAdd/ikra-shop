import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { Users, type UserRow } from '../db.js';

export const AUTH_COOKIE = 'ikra_session';

export type AuthPayload = {
  sub: number;
  email: string;
  admin: boolean;
};

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow | null;
    auth?: AuthPayload;
  }
}

export function signToken(user: UserRow): string {
  const payload: AuthPayload = { sub: user.id, email: user.email, admin: !!user.is_admin };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtTtl as jwt.SignOptions['expiresIn'] });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? ('none' as const) : ('lax' as const),
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

/** Мягкая аутентификация: читает cookie/Authorization, но не блокирует запрос */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = bearer || (req.cookies?.[AUTH_COOKIE] as string | undefined);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as unknown as AuthPayload;
    req.auth = decoded;
    req.user = Users.findById(decoded.sub) ?? null;
  } catch {
    req.user = null;
  }
  next();
}

/** Требует авторизации */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  optionalAuth(req, res, () => {
    if (!req.user) {
      res.status(401).json({ error: 'Требуется вход в аккаунт' });
      return;
    }
    next();
  });
}

/** Требует прав администратора */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  optionalAuth(req, res, () => {
    if (!req.user || !req.user.is_admin) {
      res.status(403).json({ error: 'Доступ только для администратора' });
      return;
    }
    next();
  });
}

/** Проверка статического токена для legacy-админки (админка на GitHub Pages) */
export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.is_admin) return next();
  const token = req.headers['x-admin-token'];
  if (config.adminToken && typeof token === 'string' && token === config.adminToken) return next();
  res.status(403).json({ error: 'Forbidden' });
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, avatar: u.avatar, isAdmin: !!u.is_admin };
}