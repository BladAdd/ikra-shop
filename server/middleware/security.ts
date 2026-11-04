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
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://mc.yandex.ru'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: [
        "'self'",
        config.appUrl,
        config.frontendUrl,
        'https://rollypay.io',
        'https://api.github.com',
      ],
      frameSrc: ['https://pay.rollypay.io'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", 'https://pay.rollypay.io'],
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  // Фронт/админка живут на другом origin (GitHub Pages), картинки и статика сервера
  // встраиваются кросс-доменно: дефолтный CORP 'same-origin' у helmet 8 заблокировал бы их.
  // Ослабляем только встраивание ресурсов — на CSP скриптов это не влияет.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// CORS: allowlist-функция + credentials:true. Wildcard '*' вместе с credentials
// запрещён браузерами и здесь не используется — cors отражает только разрешённые
// origin (frontendUrl/appUrl, в dev — любой localhost-порт).
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

/**
 * Ключ rate limit — ТОЛЬКО доверенный IP. Клиентские заголовки (X-Forwarded-For,
 * X-Real-IP и т.п.) здесь никогда не читаются напрямую: они учитываются исключительно
 * через req.ip, который Express вычисляет по app.set('trust proxy', N).
 *
 * ТРЕБОВАНИЕ: trust proxy должен равняться ТОЧНОМУ числу прокси перед сервером
 * (на Railway — 1, см. index.ts), но НЕ `true`. При `true` Express доверяет всей
 * цепочке XFF и берёт левое, клиентоуправляемое значение — лимит обходится
 * подстановкой произвольных заголовков. При корректном N req.ip = адрес,
 * аттестованный ближайшим доверенным прокси; без прокси это адрес TCP-сокета,
 * который клиент подделать не может.
 */
function trustedIpKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const limiterDefaults = {
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  // Единый ключ для всех лимитеров — только доверенный IP (см. trustedIpKey)
  keyGenerator: trustedIpKey,
};

// Единый бюджет на всю зону /api/auth/*: этот ОДИН экземпляр переиспользуется
// в routes/auth.ts и на /register, и на /login. Хранилище общее, путь в ключ
// не входит, поэтому попытки login+register в сумме дают один лимит 30/мин на IP,
// а не 30+30. Второй экземпляр для register не создавать — разделит бюджет.
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