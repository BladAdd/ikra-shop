import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { requireAdmin, requireAdminToken } from '../middleware/auth.js';
import { assertInsideRootSync } from '../middleware/security.js';

export const adminRouter = Router();

/* ---------------- Каталог ---------------- */

// Публичное чтение каталога
adminRouter.get('/catalog', (_req, res) => {
  try {
    const raw = fs.readFileSync(config.catalogPath, 'utf-8');
    res.type('application/json; charset=utf-8').send(raw);
  } catch {
    res.status(500).json({ error: 'Каталог недоступен' });
  }
});

// Запись каталога — только администратор (раньше было открыто всем)
adminRouter.put('/catalog', requireAdminToken, (req, res) => {
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

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

adminRouter.post('/upload', requireAdmin, (req, res) => {
  try {
    const { path: imgPath, content } = req.body as { path?: string; content?: string };
    if (!imgPath || !content) {
      res.status(400).json({ error: 'Нужны path и content (base64)' });
      return;
    }

    // Разрешаем только assets/img/ и только растровые расширения
    const relative = String(imgPath).replace(/^\/+/, '').replace(/\\/g, '/');
    if (!relative.startsWith('assets/img/')) {
      res.status(403).json({ error: 'Загружать можно только в assets/img/' });
      return;
    }
    if (!ALLOWED_EXT.has(path.extname(relative).toLowerCase())) {
      res.status(400).json({ error: 'Допустимы только JPG, PNG, WebP' });
      return;
    }

    // Главная защита: итоговый путь обязан остаться внутри проекта
    const fullPath = assertInsideRootSync(relative, config.rootDir);
    if (!fullPath.startsWith(path.join(config.rootDir, 'assets', 'img') + path.sep)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const buf = Buffer.from(content, 'base64');
    if (buf.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: 'Файл больше 8 МБ' });
      return;
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buf);
    res.json({ ok: true, path: relative });
  } catch (e) {
    if ((e as { code?: string }).code === 'PATH_TRAVERSAL') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    console.error('[upload]', e);
    res.status(400).json({ error: 'Не удалось сохранить файл' });
  }
});