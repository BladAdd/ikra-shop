import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config, assertRuntimeConfig } from './config.js';
import { closeDb, initDb, purgeExpiredSessions } from './db.js';
import { corsMiddleware, errorHandler, limitApi, securityHeaders } from './middleware/security.js';
import { requireAdmin } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter } from './routes/payments.js';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';

assertRuntimeConfig();
initDb();

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security-заголовки — до всего остального
app.use(securityHeaders);

// Вебхук монтируется ПЕРВЫМ и со своим сырым парсером: подпись считается по точному телу
app.use(
  '/webhooks',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
    req.rawBody = req.body as Buffer;
    next();
  },
  webhookRouter
);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(corsMiddleware);

app.use('/api', limitApi);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    googleAuth: config.google.enabled,
    rollypay: config.rollypay.enabled,
    rollypayTestMode: config.rollypay.testMode,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);

// Кэш каталога: перечитываем файл только при изменении mtime —
// иначе каждый запрос блокирует event loop дисковым I/O
let catalogCache: { mtimeMs: number; raw: string } | null = null;
function readCatalog(): string | null {
  try {
    const st = fs.statSync(config.catalogPath);
    if (catalogCache && catalogCache.mtimeMs === st.mtimeMs) return catalogCache.raw;
    const raw = fs.readFileSync(config.catalogPath, 'utf-8');
    catalogCache = { mtimeMs: st.mtimeMs, raw };
    return raw;
  } catch {
    return null;
  }
}

// Старый путь совместимости: /api/catalog остаётся публичным на чтение
app.use((req, _res, next) => {
  if (req.path === '/api/catalog' && req.method === 'GET') {
    const raw = readCatalog();
    if (raw !== null) {
      _res.type('application/json; charset=utf-8').send(raw);
      return;
    }
    /* fallthrough при ошибке чтения */
  }
  next();
});

// Раздача статики, если сервер и фронт на одном домене (Railway single-service)
const distDir = path.join(config.rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { maxAge: '1h', index: false }));
  app.get('/', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

// Очистка просроченных OAuth-состояний и сессий
setInterval(() => {
  try {
    purgeExpiredSessions();
  } catch (e) {
    console.error('[cleanup]', e);
  }
}, 60_000).unref();

const server = app.listen(config.port, () => {
  console.log(`[server] Икра API слушает http://localhost:${config.port} (режим: ${config.nodeEnv})`);
  console.log(`[server] Google OAuth: ${config.google.enabled ? 'вкл' : 'выкл'}, RollyPay: ${config.rollypay.enabled ? (config.rollypay.testMode ? 'вкл (тест)' : 'вкл') : 'выкл'}`);
  console.log(`[server] Администраторы: ${config.administratorEmails.join(', ') || 'не заданы'}`);
  console.log(`[server] Webhook URL: ${config.appUrl}/webhooks/rollypay`);
});

// Необработанный rejection: логируем с контекстом (в Node >= 15 без обработчика процесс падает молча)
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

// Необработанное исключение: состояние процесса непредсказуемо — логируем и выходим
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException — форсированный выход:', err);
  try {
    closeDb();
  } catch {
    /* БД могла быть уже закрыта */
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return; // защита от повторного сигнала
  shuttingDown = true;
  console.log(`[server] ${signal} — остановка`);
  server.close(() => {
    // Закрываем БД после остановки приёма соединений: чекпоинт WAL-файлов
    try {
      closeDb();
    } catch (e) {
      console.error('[server] ошибка закрытия БД:', e);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, requireAdmin };