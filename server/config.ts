import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

const NODE_ENV = env('NODE_ENV', 'development');
// 'production' — строго; 'prod', 'Production', пусто и прочее продом НЕ считаются,
// поэтому требуем секрет в любом окружении, кроме явно dev/test
const isProduction = NODE_ENV === 'production';
const secretRequired = NODE_ENV !== 'development' && NODE_ENV !== 'test';

// Дефолтный публично известный секрет допустим ТОЛЬКО в development/test.
// При отсутствии JWT_SECRET в остальных окружениях — падаем на старте.
function jwtSecretValue(): string {
  const v = env('JWT_SECRET');
  if (v) return v;
  if (!secretRequired) return 'dev-only-secret-change-me'; // только dev/test
  console.error(`[config] JWT_SECRET не задан (NODE_ENV="${NODE_ENV}") — запуск с известным дефолтным секретом недопустим. Сервер остановлен.`);
  process.exit(1);
}

// Числовые переменные с защитой от опечаток (NaN в расчётах недопустим)
function num(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    console.error(`[config] ${name}="${raw}" — не число. Сервер остановлен.`);
    process.exit(1);
  }
  return v;
}

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: num('PORT', 8080),

  // Абсолютные пути: на Railway файл БД живёт в смонтированном томе (/data).
  // DB_PATH якорим к ROOT, а не к CWD процесса — при запуске из другого каталога
  // (pm2/systemd с иным WorkingDirectory) БД не «потеряется»
  dbPath: path.resolve(ROOT, env('DB_PATH') || path.join('data', 'shop.db')),
  rootDir: ROOT,
  catalogPath: path.join(ROOT, 'data', 'catalog.json'),
  imgDir: path.join(ROOT, 'assets', 'img'),

  appUrl: env('APP_URL', 'http://localhost:8080').replace(/\/$/, ''),
  frontendUrl: env('FRONTEND_URL', 'http://localhost:3000').replace(/\/$/, ''),

  jwtSecret: jwtSecretValue(),
  jwtTtl: env('JWT_TTL', '30d'),

  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  administratorEmails: env('ADMIN_EMAILS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  rollypay: {
    apiKey: env('ROLLYPAY_API_KEY'),
    signingSecret: env('ROLLYPAY_SIGNING_SECRET'),
    baseUrl: env('ROLLYPAY_BASE_URL', 'https://rollypay.io'),
    testMode: env('ROLLYPAY_TEST_MODE', 'true') === 'true',
    get enabled() {
      return Boolean(this.apiKey && this.signingSecret);
    },
  },

  adminToken: env('ADMIN_API_TOKEN'),

  // Базовая сумма/пороги доставки
  freeShippingFrom: num('FREE_SHIPPING_FROM', 5000),
  deliveryFee: num('DELIVERY_FEE', 350),
};

export function assertRuntimeConfig(): void {
  const warnings: string[] = [];
  if (!config.google.enabled) warnings.push('Google OAuth выключен (нет GOOGLE_CLIENT_ID/SECRET) — вход через Google не сработает');
  if (!config.rollypay.enabled) warnings.push('RollyPay выключен (нет ROLLYPAY_API_KEY/SECRET) — онлайн-оплата недоступна, останется WhatsApp');
  if (!config.administratorEmails.length) warnings.push('ADMIN_EMAILS пуст — никто не войдёт в админку');
  // Проверка JWT_SECRET выполняется в jwtSecretValue() при создании конфига:
  // секрет обязателен для любого окружения, кроме development/test
  if (config.rollypay.testMode && config.isProduction) {
    warnings.push('ROLLYPAY_TEST_MODE=true в production — платежи тестовые');
  }
  warnings.forEach((w) => console.warn('[config] ⚠ ' + w));
}