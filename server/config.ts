import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function requiredInProduction(name: string): string {
  const v = env(name);
  if (!v && isProduction) {
    console.error(`[config] Переменная ${name} обязательна в production. Сервер остановлен.`);
    process.exit(1);
  }
  return v;
}

const NODE_ENV = env('NODE_ENV', 'development');
const isProduction = NODE_ENV === 'production';

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: Number(env('PORT', '8080')),

  // Абсолютные пути: на Railway файл БД живёт в смонтированном томе (/data).
  dbPath: env('DB_PATH', path.join(ROOT, 'data', 'shop.db')),
  rootDir: ROOT,
  catalogPath: path.join(ROOT, 'data', 'catalog.json'),
  imgDir: path.join(ROOT, 'assets', 'img'),

  appUrl: env('APP_URL', 'http://localhost:8080').replace(/\/$/, ''),
  frontendUrl: env('FRONTEND_URL', 'http://localhost:3000').replace(/\/$/, ''),

  jwtSecret: requiredInProduction('JWT_SECRET') || 'dev-only-secret-change-me',
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
  freeShippingFrom: Number(env('FREE_SHIPPING_FROM', '5000')),
  deliveryFee: Number(env('DELIVERY_FEE', '350')),

  get isProductionSafe() {
    return isProduction ? this.jwtSecret !== 'dev-only-secret-change-me' : true;
  },
};

export function assertRuntimeConfig(): void {
  const warnings: string[] = [];
  if (!config.google.enabled) warnings.push('Google OAuth выключен (нет GOOGLE_CLIENT_ID/SECRET) — вход через Google не сработает');
  if (!config.rollypay.enabled) warnings.push('RollyPay выключен (нет ROLLYPAY_API_KEY/SECRET) — онлайн-оплата недоступна, останется WhatsApp');
  if (!config.administratorEmails.length) warnings.push('ADMIN_EMAILS пуст — никто не войдёт в админку');
  if (config.isProduction && config.jwtSecret === 'dev-only-secret-change-me') {
    console.error('[config] JWT_SECRET не задан в production.');
    process.exit(1);
  }
  if (config.rollypay.testMode && config.isProduction) {
    warnings.push('ROLLYPAY_TEST_MODE=true в production — платежи тестовые');
  }
  warnings.forEach((w) => console.warn('[config] ⚠ ' + w));
}