import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { config } from '../config.js';
import { getDb, type OrderRow } from '../db.js';
import { optionalAuth, requireAdmin, requireAuth } from '../middleware/auth.js';
import { limitOrders } from '../middleware/security.js';

export const ordersRouter = Router();

type CatalogItem = {
  id: string;
  name: string;
  weight?: string;
  price: number | null;
  unit?: string;
};

function loadCatalog(): Map<string, CatalogItem> {
  const raw = JSON.parse(fs.readFileSync(config.catalogPath, 'utf-8')) as {
    catalog: { items: CatalogItem[] }[];
  };
  const map = new Map<string, CatalogItem>();
  raw.catalog.forEach((cat) => cat.items.forEach((it) => map.set(it.id, it)));
  return map;
}

/** Цены НИКОГДА не берутся с клиента — только из каталога на сервере */
function priceCart(items: { id: string; qty: number }[]) {
  const catalog = loadCatalog();
  const lines: { id: string; name: string; weight?: string; qty: number; price: number; sum: number }[] = [];
  for (const { id, qty } of items) {
    const product = catalog.get(id);
    if (!product) throw new Error(`Товар не найден: ${id}`);
    if (product.price == null) throw new Error(`Товар «${product.name}» доступен только по запросу`);
    if (qty < 1 || qty > 99) throw new Error('Некорректное количество');
    lines.push({
      id,
      name: product.name,
      weight: product.weight,
      qty,
      price: product.price,
      sum: product.price * qty,
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.sum, 0);
  return { lines, subtotal };
}

const orderSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(80),
  phone: z
    .string()
    .trim()
    .min(10, 'Укажите телефон')
    .max(20)
    .regex(/^[\d\s+()\-]+$/, 'Телефон содержит недопустимые символы'),
  address: z.string().trim().max(300).default(''),
  delivery: z.string().trim().max(120).default('Курьер по Москве и МО'),
  payment: z.string().trim().max(120).default('Онлайн по ссылке'),
  comment: z.string().trim().max(1000).default(''),
  items: z
    .array(z.object({ id: z.string().min(1).max(80), qty: z.number().int().min(1).max(99) }))
    .min(1, 'Корзина пуста'),
});

function toPublicOrder(row: OrderRow) {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    phone: row.phone,
    address: row.address,
    delivery: row.delivery_method,
    payment: row.payment_method,
    comment: row.comment,
    items: JSON.parse(row.items_json),
    total: row.total_cents / 100,
    rollypayPaymentId: row.rollypay_payment_id,
    createdAt: row.created_at,
  };
}

/** Создание заказа. Доступно и гостям (без входа). */
ordersRouter.post('/', limitOrders, optionalAuth, (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Некорректный заказ' });
    return;
  }
  const data = parsed.data;

  let pricing;
  try {
    pricing = priceCart(data.items);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  // Доставка бесплатна от порога, иначе фиксированная плата — только для курьера
  const isCourier = /курьер/i.test(data.delivery);
  const deliveryFee =
    isCourier && pricing.subtotal < config.freeShippingFrom ? config.deliveryFee : 0;
  const total = pricing.subtotal + deliveryFee;

  const id = crypto.randomUUID();
  const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId.slice(0, 64) : null;

  getDb()
    .prepare(
      `INSERT INTO orders (id, user_id, session_id, name, phone, address, delivery_method,
         payment_method, comment, items_json, total_cents, status, metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?)`
    )
    .run(
      id,
      req.user?.id ?? null,
      sessionId,
      data.name,
      data.phone,
      data.address,
      data.delivery,
      data.payment,
      data.comment,
      JSON.stringify({ lines: pricing.lines, deliveryFee, subtotal: pricing.subtotal }),
      total * 100,
      JSON.stringify({ subtotal: pricing.subtotal, deliveryFee })
    );

  const row = getDb().prepare(`SELECT * FROM orders WHERE id=?`).get(id) as OrderRow;
  res.status(201).json({ order: toPublicOrder(row) });
});

/** Мои заказы (нужен вход) */
ordersRouter.get('/my', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare(`SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100`)
    .all(req.user!.id) as OrderRow[];
  res.json({ orders: rows.map(toPublicOrder) });
});

/** Заказ по номеру: гостю — только при совпадении секрета в metadata, пользователю — свой */
ordersRouter.get('/:id', optionalAuth, (req, res) => {
  const row = getDb().prepare(`SELECT * FROM orders WHERE id=?`).get(req.params.id) as OrderRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Заказ не найден' });
    return;
  }
  if (row.user_id && req.user?.id !== row.user_id && !req.user?.is_admin) {
    res.status(404).json({ error: 'Заказ не найден' });
    return;
  }
  res.json({ order: toPublicOrder(row) });
});

/* ---------------- Админские маршруты ---------------- */

ordersRouter.get('/', requireAdmin, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const rows = (
    status
      ? getDb().prepare(`SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT ?`).all(status, limit)
      : getDb().prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit)
  ) as OrderRow[];
  const stats = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS n, SUM(total_cents) AS sum_cents
       FROM orders GROUP BY status`
    )
    .all() as { status: string; n: number; sum_cents: number }[];
  res.json({ orders: rows.map(toPublicOrder), stats });
});

ordersRouter.patch('/:id/status', requireAdmin, (req, res) => {
  const allowed = ['pending', 'paid', 'canceled', 'expired', 'refunded', 'failed'];
  const status = String(req.body?.status || '');
  if (!allowed.includes(status)) {
    res.status(400).json({ error: 'Недопустимый статус' });
    return;
  }
  getDb()
    .prepare(`UPDATE orders SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(status, req.params.id);
  res.json({ ok: true });
});