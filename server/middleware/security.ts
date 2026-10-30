import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/** Helmet с CSP, адаптированным под фронтенд (inline стили/скрипты разрешены для Vite-сборки) */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://mc.yandex.ru', 'https://accounts.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: [
        "'self'",
        config.appUrl,
        config.frontendUrl,
        'https://rollypay.io',
        'https://api.github.com',
        'https://oauth2.googleapis.com',
      ],
      frameSrc: ['https://accounts.google.com', 'https://pay.rollypay.io'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", 'https://accounts.google.com', 'https://pay.rollypay.io'],
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
});

export const corsMiddleware = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    const allowed = [config.frontendUrl, config.appUrl];
    if (allowed.some((a) => origin === a || origin.startsWith(a + '/'))) return cb(null, true);
    // Любой localhost-порт в режиме разработки (Vite 3000, http.server 8799 и т. п.)
    if (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS blocked for ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token', 'Accept'],
});

const limiterDefaults = {
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
};

export const limitAuth = rateLimit({ ...limiterDefaults, max: 30, message: { error: 'Слишком много попыток входа. Попробуйте позже.' } });
export const limitOrders = rateLimit({ ...limiterDefaults, max: 20, message: { error: 'Слишком много заказов. Подождите минуту.' } });
export const limitWebhook = rateLimit({ ...limiterDefaults, max: 200, message: { error: 'Too many webhook calls' } });
export const limitApi = rateLimit({ ...limiterDefaults, max: 120, message: { error: 'Rate limit exceeded' } });

/** Блокировка path traversal: путь должен быть внутри базовой директории */
export function assertInsideRootSync(candidatePath: string, rootDir: string): string {
  const resolved = path.resolve(rootDir, candidatePath);
  const rel = path.relative(rootDir, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathTraversalError(candidatePath);
  }
  return resolved;
}

export class PathTraversalError extends Error {
  code = 'PATH_TRAVERSAL';
  constructor(input: string) {
    super(`Path traversal blocked: ${input}`);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof PathTraversalError) {
    console.warn('[security] PATH_TRAVERSAL attempt:', err.message);
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: config.isProduction ? 'Internal Server Error' : String(err) });
}