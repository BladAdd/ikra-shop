import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { optionalAuth, requireAdmin } from '../middleware/auth.js';
import { assertInsideRootSync } from '../middleware/security.js';

export const adminRouter = Router();

/* ---------------- Единый гард админ-зоны ---------------- */

// Строгий лимит только для попыток входа по legacy-токену: подбор x-admin-token
// не должен быть дешёвым. Лимитер свой (не общий limitApi/limitAuth), чтобы
// бюджет админ-зоны не смешивался с публичными зонами.
const limitAdminToken = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
});

// Constant-time сравнение строк: sha256 выравнивает длины буферов для timingSafeEqual
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Единый гард всех эндпоинтов /api/admin.
 *
 * ПЛАН МИГРАЦИИ на requireAdmin (JWT-сессия из БД):
 *   1) админка логинится через /api/auth/login и ходит с httpOnly-кукой;
 *   2) фронт перестаёт хранить/отправлять статический x-admin-token;
 *   3) ADMIN_API_TOKEN удаляется из env, этот гард заменяется на requireAdmin.
 *
 * До миграции: JWT-админ проходит без лимита legacy-зоны; все остальные попытки —
 * за строгим rate limit, а любой отказ (токен не задан в env / не передан /
 * неверный) отвечает одинаковым 404 — не раскрываем ни существование зоны, ни
 * факт конфигурации токена, и уж точно не «всё разрешено» при пустом токене.
 */
function adminAccess(req: Request, res: Response, next: NextFunction): void {
  optionalAuth(req, res, () => {
    // Полноценный JWT-админ (req.user заполняет optionalAuth) — без лимита legacy-зоны
    if (req.user?.is_admin) return next();
    limitAdminToken(req, res, () => {
      const token = req.headers['x-admin-token'];
      const ok =
        !!config.adminToken && // гвард: пустой конфиг не должен совпасть с пустым заголовком
        typeof token === 'string' &&
        safeEqual(token, config.adminToken);
      if (!ok) {
        console.warn('[admin] Отказ в доступе (нет валидного JWT-админа/токена):', req.ip);
        res.status(404).json({ error: 'Not Found' });
        return;
      }
      next();
    });
  });
}

/* ---------------- Каталог ---------------- */

// Чтение каталога — тоже за гардом; публичный источник витрины — GET /api/catalog (index.ts)
adminRouter.get('/catalog', adminAccess, (_req, res) => {
  try {
    const raw = fs.readFileSync(config.catalogPath, 'utf-8');
    res.type('application/json; charset=utf-8').send(raw);
  } catch {
    res.status(500).json({ error: 'Каталог недоступен' });
  }
});

// Запись каталога — за гардом (JWT-админ или legacy-токен)
adminRouter.put('/catalog', adminAccess, (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.catalog)) {
    res.status(400).json({ error: 'Ожидается объект с полем catalog' });
    return;
  }
  body.updatedAt = new Date().toISOString();
  fs.writeFileSync(config.catalogPath, JSON.stringify(body, null, 2) + '\n', 'utf-8');
  res.json({ ok: true, message: 'Сохранено' });
});

/* ---------------- Загрузка фото ---------------- */

// Расширение -> ожидаемый тип по магическим байтам (единый источник истины)
const EXT_TO_TYPE: Record<string, 'jpeg' | 'png' | 'webp'> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
};

// Определение реального типа изображения по сигнатуре (магическим байтам)
function detectImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'png';
  }
  // WebP: RIFF....WEBP
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

// Слаг-санитизация сегмента пути: только [a-z0-9._-], прочее — на '-';
// '..' как таковой не образуется, но явные '.'/'..' отсекаются в обработчике
function slugSegment(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

adminRouter.post('/upload', requireAdmin, (req, res) => {
  try {
    const { path: imgPath, content } = req.body as { path?: string; content?: string };
    if (typeof imgPath !== 'string' || typeof content !== 'string' || !imgPath || !content) {
      res.status(400).json({ error: 'Нужны path и content (base64)' });
      return;
    }

    // Разрешаем только assets/img/ и только растровые расширения
    const relative = imgPath.replace(/^\/+/, '').replace(/\\/g, '/');
    if (!relative.startsWith('assets/img/')) {
      res.status(403).json({ error: 'Загружать можно только в assets/img/' });
      return;
    }

    // Санитизация: каждый сегмент — слаг; пустой/'.'/'..' сегменты отклоняем явно
    const segments = relative.split('/').map(slugSegment);
    if (segments.some((s) => !s || s === '.' || s === '..')) {
      res.status(400).json({ error: 'Некорректное имя файла или путь' });
      return;
    }
    const sanitized = segments.join('/');
    const ext = path.extname(sanitized).toLowerCase();
    const expectedType = EXT_TO_TYPE[ext];
    if (!expectedType) {
      res.status(400).json({ error: 'Допустимы только JPG, PNG, WebP' });
      return;
    }

    // Главная защита: итоговый путь обязан остаться внутри проекта и внутри assets/img
    const fullPath = assertInsideRootSync(sanitized, config.rootDir);
    if (!fullPath.startsWith(path.join(config.rootDir, 'assets', 'img') + path.sep)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const buf = Buffer.from(content, 'base64');
    if (buf.length === 0) {
      res.status(400).json({ error: 'Пустой файл' });
      return;
    }
    if (buf.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: 'Файл больше 8 МБ' });
      return;
    }

    // Магические байты обязаны соответствовать расширению: полиглотты и подделки отсекаются
    if (detectImageType(buf) !== expectedType) {
      res.status(400).json({ error: 'Файл не является корректным изображением JPG/PNG/WebP' });
      return;
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buf);
    res.json({ ok: true, path: sanitized });
  } catch (e) {
    if ((e as { code?: string }).code === 'PATH_TRAVERSAL') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    console.error('[upload]', e);
    res.status(400).json({ error: 'Не удалось сохранить файл' });
  }
});
