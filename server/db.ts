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

export function initDb(): DB {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  seedAdmins(db);
  console.log(`[db] SQLite ready at ${config.dbPath}`);
  return db;
}

function runMigrations(conn: DB): void {
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
    CREATE INDEX IF NOT EXISTS idx_payments_rp ON payments(rollypay_payment_id);

    CREATE TABLE IF NOT EXISTS sessions_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions_kv(expires_at);
  `);
}

function seedAdmins(conn: DB): void {
  if (!config.administratorEmails.length) return;
  const upsert = conn.prepare(`
    INSERT INTO users (email, name, provider, is_admin)
    VALUES (?, ?, 'google', 1)
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

// Вспомогательные запросы для пользователей
export const Users = {
  findByEmail: (email: string) =>
    getDb().prepare(`SELECT * FROM users WHERE email=? COLLATE NOCASE`).get(email.toLowerCase()) as UserRow | undefined,
  findById: (id: number) => getDb().prepare(`SELECT * FROM users WHERE id=?`).get(id) as UserRow | undefined,
  createLocal: (email: string, name: string, passwordHash: string) =>
    getDb()
      .prepare(`INSERT INTO users(email,name,provider,password_hash) VALUES (?,?,?,?)`)
      .run(email.toLowerCase(), name, 'local', passwordHash),
  upsertGoogle: (email: string, name: string, avatar?: string) => {
    const stmt = getDb().prepare(`
      INSERT INTO users(email,name,avatar,provider) VALUES (?,?,?,'google')
      ON CONFLICT(email) DO UPDATE SET
        name=COALESCE(NULLIF(excluded.name,''),users.name),
        avatar=COALESCE(excluded.avatar,users.avatar),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `);
    stmt.run(email.toLowerCase(), name, avatar || null);
    return Users.findByEmail(email)!;
  },
};

export type UserRow = {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
  provider: 'google' | 'local';
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