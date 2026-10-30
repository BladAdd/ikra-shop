import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config, assertRuntimeConfig } from './config.js';
import { initDb, purgeExpiredSessions } from './db.js';
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

// Старый путь совместимости: /api/catalog остаётся публичным на чтение
app.use((req, _res, next) => {
  if (req.path === '/api/catalog' && req.method === 'GET') {
    try {
      const raw = fs.readFileSync(config.catalogPath, 'utf-8');
      _res.type('application/json; charset=utf-8').send(raw);
      return;
    } catch {
      /* fallthrough */
    }
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
  console.log(`[server] Икра API слушает http://localhost:${config.port}`);
  console.log(`[server] Google OAuth: ${config.google.enabled ? 'вкл' : 'выкл'}, RollyPay: ${config.rollypay.enabled ? (config.rollypay.testMode ? 'вкл (тест)' : 'вкл') : 'выкл'}`);
  console.log(`[server] Администраторы: ${config.administratorEmails.join(', ') || 'не заданы'}`);
  console.log(`[server] Webhook URL: ${config.appUrl}/webhooks/rollypay`);
});

function shutdown(signal: string) {
  console.log(`[server] ${signal} — остановка`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, requireAdmin };