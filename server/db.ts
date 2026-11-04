import Database, { type Database as DB } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: DB;

export function getDb(): DB {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

/** Закрытие соединения — вызывать при graceful shutdown (чекпоинт WAL-файлов) */
export function closeDb(): void {
  if (!db) return;
  db.close();
}

export function initDb(): DB {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.dbPath);
  const journalMode = db.pragma('journal_mode = WAL', { simple: true });
  if (journalMode !== 'wal') {
    // ФС без поддержки WAL (сетевые диски и т.п.) — режим останется DELETE
    console.warn(`[db] WAL недоступен, journal_mode = ${journalMode}`);
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Пересоздание таблиц в миграциях (DROP parent при активных FK запрещён, а
  // PRAGMA foreign_keys внутри транзакции игнорируется) — выключаем на время
  db.pragma('foreign_keys = OFF');
  try {
    runMigrations(db);
  } finally {
    db.pragma('foreign_keys = ON');
  }
  seedAdmins(db);
  console.log(`[db] SQLite ready at ${config.dbPath}`);
  return db;
}

type Migration = {
  version: number;
  name: string;
  up: (conn: DB) => void;
};

/**
 * Последовательные миграции схемы. Миграция 1 = текущая схема.
 * Любые будущие изменения схемы добавлять НОВОЙ миграцией (version + 1),
 * старые миграции не редактировать — иначе живые БД разъедутся.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema (users, orders, payments, sessions_kv)',
    up: (conn) => {
      conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      avatar TEXT,
      provider TEXT NOT NULL CHECK(provider IN ('google','local')),
      password_hash TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      session_id TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      delivery_method TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('cart','pending','paid','canceled','expired','refunded','failed')),
      rollypay_payment_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    -- У orders индекс НЕ уникальный: при повторной оплате id платежа перезаписывается
    CREATE INDEX IF NOT EXISTS idx_orders_rollypay ON orders(rollypay_payment_id);

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      rollypay_payment_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      status TEXT NOT NULL DEFAULT 'created',
      pay_url TEXT,
      webhook_event TEXT,
      webhook_raw TEXT,
      test_mode INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

    CREATE TABLE IF NOT EXISTS sessions_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions_kv(expires_at);
  `);

      // Защита от дублей перед созданием UNIQUE-индекса (на живых БД, где дубли
      // могли накопиться): у повторов оставляем самую раннюю запись
      conn.exec(`
    UPDATE payments SET rollypay_payment_id = NULL
    WHERE rollypay_payment_id IS NOT NULL
      AND id NOT IN (
        SELECT MIN(id) FROM payments WHERE rollypay_payment_id IS NOT NULL GROUP BY rollypay_payment_id
      );
  `);

      // UNIQUE: один платёж RollyPay — максимум одна запись в payments
      conn.exec(`
    DROP INDEX IF EXISTS idx_payments_rp;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_rp
      ON payments(rollypay_payment_id)
      WHERE rollypay_payment_id IS NOT NULL;
  `);
    },
  },
  {
    version: 2,
    name: 'OAuth-провайдеры (Яндекс/VK/MAX): email nullable, user_identities',
    up: (conn) => {
      // users: email становится nullable (VK/MAX могут не отдавать почту),
      // CHECK(provider) расширяется на новых провайдеров. Пересоздание таблицы:
      // SQLite не умеет менять CHECK у существующей.
      conn.exec(`
    CREATE TABLE users_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      avatar TEXT,
      provider TEXT NOT NULL CHECK(provider IN ('local','google','yandex','vk','max')),
      password_hash TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO users_v2 (id, email, name, avatar, provider, password_hash, is_admin, created_at, updated_at)
      SELECT id, email, name, avatar, provider, password_hash, is_admin, created_at, updated_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_v2 RENAME TO users;
  `);

      // Связи «аккаунт — вход через провайдера»: у одного аккаунта может быть
      // несколько способов входа (почта + Яндекс + VK), у провайдера uid уникален
      conn.exec(`
    CREATE TABLE IF NOT EXISTS user_identities (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('google','yandex','vk','max')),
      provider_uid TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(provider, provider_uid)
    );
    CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
  `);
    },
  },
];

function runMigrations(conn: DB): void {
  const current = conn.pragma('user_version', { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    // Каждая миграция — в транзакции: либо вся, либо ничего
    const apply = conn.transaction(() => {
      m.up(conn);
      conn.pragma(`user_version = ${m.version}`);
    });
    apply();
    console.log(`[db] миграция ${m.version} применена: ${m.name}`);
  }
  // БД создана более новой версией кода — предупредим о даунгрейде
  if (current > MIGRATIONS.length) {
    console.warn(`[db] user_version=${current} больше последней известной миграции (${MIGRATIONS.length})`);
  }
}

function seedAdmins(conn: DB): void {
  if (!config.administratorEmails.length) return;
  const upsert = conn.prepare(`
    INSERT INTO users (email, name, provider, is_admin)
    VALUES (?, ?, 'local', 1)
    ON CONFLICT(email) DO UPDATE SET is_admin=1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);
  const tx = conn.transaction(() => {
    for (const email of config.administratorEmails) {
      upsert.run(email, email.split('@')[0]);
    }
  });
  tx();
  console.log(`[db] Admin emails seeded: ${config.administratorEmails.join(', ')}`);
}

/** Очистка устаревших сессий — вызывать раз в минуту по таймеру */
export function purgeExpiredSessions(): number {
  const r = getDb()
    .prepare(`DELETE FROM sessions_kv WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run();
  return r.changes;
}

export function setSession(key: string, value: unknown, ttlMs: number): void {
  const expires = new Date(Date.now() + ttlMs).toISOString();
  getDb()
    .prepare(`INSERT OR REPLACE INTO sessions_kv(key,value,expires_at) VALUES (?,?,?)`)
    .run(key, JSON.stringify(value), expires);
}

export function getSession<T>(key: string): T | null {
  const row = getDb().prepare(`SELECT value, expires_at FROM sessions_kv WHERE key=?`).get(key) as
    | { value: string; expires_at: string }
    | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare(`DELETE FROM sessions_kv WHERE key=?`).run(key);
    return null;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function deleteSession(key: string): void {
  getDb().prepare(`DELETE FROM sessions_kv WHERE key=?`).run(key);
}

export type OAuthProviderId = 'yandex' | 'vk' | 'max';

export type OAuthProfile = {
  uid: string;
  email: string | null;
  name: string;
  avatar: string | null;
};

// Вспомогательные запросы для пользователей
export const Users = {
  findByEmail: (email: string) =>
    getDb().prepare(`SELECT * FROM users WHERE email=? COLLATE NOCASE`).get(email.toLowerCase()) as UserRow | undefined,
  findById: (id: number) => getDb().prepare(`SELECT * FROM users WHERE id=?`).get(id) as UserRow | undefined,
  createLocal: (email: string, name: string, passwordHash: string) =>
    getDb()
      .prepare(`INSERT INTO users(email,name,provider,password_hash) VALUES (?,?,?,?)`)
      .run(email.toLowerCase(), name, 'local', passwordHash),

  findIdentity: (provider: OAuthProviderId, uid: string): number | undefined =>
    (
      getDb()
        .prepare(`SELECT user_id FROM user_identities WHERE provider=? AND provider_uid=?`)
        .get(provider, uid) as { user_id: number } | undefined
    )?.user_id,

  addIdentity: (userId: number, provider: OAuthProviderId, uid: string): void => {
    getDb()
      .prepare(`INSERT OR IGNORE INTO user_identities(user_id,provider,provider_uid) VALUES (?,?,?)`)
      .run(userId, provider, uid);
  },

  /**
   * Вход через OAuth-провайдера: находим аккаунт по связи, иначе по совпавшему
   * email (привязываем способ входа), иначе создаём новый аккаунт (email может
   * отсутствовать — например, VK не всегда отдаёт почту).
   */
  upsertOAuth: (provider: OAuthProviderId, prof: OAuthProfile): UserRow => {
    const db = getDb();
    const existingId = Users.findIdentity(provider, prof.uid);
    if (existingId) {
      // Обновим профиль (имя/аватар могли измениться у провайдера)
      db.prepare(`UPDATE users SET
          name=COALESCE(NULLIF(?,''),name),
          avatar=COALESCE(?,avatar),
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=?`).run(prof.name, prof.avatar, existingId);
      return Users.findById(existingId)!;
    }
    if (prof.email) {
      const byEmail = Users.findByEmail(prof.email);
      if (byEmail) {
        Users.addIdentity(byEmail.id, provider, prof.uid);
        db.prepare(`UPDATE users SET
            avatar=COALESCE(?,avatar),
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=?`).run(prof.avatar, byEmail.id);
        return Users.findById(byEmail.id)!;
      }
    }
    const res = db
      .prepare(`INSERT INTO users(email,name,avatar,provider) VALUES (?,?,?,?)`)
      .run(prof.email ? prof.email.toLowerCase() : null, prof.name || 'Покупатель', prof.avatar || null, provider);
    const newId = Number(res.lastInsertRowid);
    Users.addIdentity(newId, provider, prof.uid);
    return Users.findById(newId)!;
  },
};

export type UserRow = {
  id: number;
  email: string | null;
  name: string;
  avatar: string | null;
  provider: 'local' | 'google' | 'yandex' | 'vk' | 'max';
  password_hash: string | null;
  is_admin: number;
  created_at: string;
  updated_at: string;
};

export type OrderRow = {
  id: string;
  user_id: number | null;
  session_id: string | null;
  name: string;
  phone: string;
  address: string;
  delivery_method: string;
  payment_method: string;
  comment: string;
  items_json: string;
  total_cents: number;
  status: string;
  rollypay_payment_id: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: number;
  order_id: string;
  rollypay_payment_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  pay_url: string | null;
  webhook_event: string | null;
  webhook_raw: string | null;
  test_mode: number;
  created_at: string;
  updated_at: string;
};