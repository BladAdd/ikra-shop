import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { Users, type UserRow } from '../db.js';

// Защита от предсказуемого секрета: если JWT_SECRET не задан или равен дефолту —
// падаем сразу при загрузке модуля (require), независимо от NODE_ENV.
if (!config.jwtSecret || config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error(
    '[auth] JWT_SECRET не задан или совпадает с дефолтным значением. Запуск запрещён: задайте случайный секрет в переменных окружения.'
  );
}

export const AUTH_COOKIE = 'ikra_session';

// Срок жизни токена: 7 дней вместо прежних 30 (сервер ещё не задеплоен — миграция не нужна).
// Фиксируем локально, т.к. дефолт config.jwtTtl ('30d') остаётся в config.ts.
const JWT_TTL = '7d' as jwt.SignOptions['expiresIn'];

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
  // Явно пиним алгоритм подписи, чтобы совпадал с algorithms при verify
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: JWT_TTL });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? ('none' as const) : ('lax' as const),
    // Кука живёт столько же, сколько JWT (7 дней)
    maxAge: 7 * 24 * 60 * 60 * 1000,
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
    // Явный whitelist алгоритмов: блокирует подделку alg (none / RS->HS-путаницу)
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as unknown as AuthPayload;
    req.auth = decoded;
    req.user = Users.findById(decoded.sub) ?? null;
  } catch {
    // Любая ошибка verify (просрочен/подделан/битый) трактуется как «не аутентифицирован»:
    // requireAuth вернёт единый 401 без деталей ошибки
    req.user = null;
    req.auth = undefined;
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

/** Constant-time сравнение строк: хешируем sha256, чтобы длины буферов всегда совпадали */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Проверка статического токена для legacy-админки (админка на GitHub Pages) */
export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.is_admin) return next();
  const token = req.headers['x-admin-token'];
  // Гвард на пустой config.adminToken обязателен: иначе пустой заголовок совпадёт с пустым секретом
  if (config.adminToken && typeof token === 'string' && safeEqual(token, config.adminToken)) return next();
  res.status(403).json({ error: 'Forbidden' });
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, avatar: u.avatar, isAdmin: !!u.is_admin };
}