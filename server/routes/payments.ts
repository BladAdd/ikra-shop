import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { getDb, type OrderRow, type PaymentRow } from '../db.js';
import { optionalAuth } from '../middleware/auth.js';
import { limitOrders } from '../middleware/security.js';
import { createPayment, RollyPayError } from '../services/rollypay.js';

export const paymentsRouter = Router();

/** Создание платёжной ссылки для существующего заказа */
paymentsRouter.post('/create', limitOrders, optionalAuth, async (req, res) => {
  const parsed = z
    .object({
      orderId: z.string().uuid(),
      method: z.enum(['sbp', 'card', 'crypto']).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }

  const order = getDb().prepare(`SELECT * FROM orders WHERE id=?`).get(parsed.data.orderId) as OrderRow | undefined;
  if (!order) {
    res.status(404).json({ error: 'Заказ не найден' });
    return;
  }
  if (order.user_id && req.user?.id !== order.user_id) {
    res.status(403).json({ error: 'Нет доступа к заказу' });
    return;
  }
  if (order.status === 'paid') {
    res.status(409).json({ error: 'Заказ уже оплачен' });
    return;
  }

  try {
    const amount = (order.total_cents / 100).toFixed(2);
    const result = await createPayment({
      amount,
      orderId: order.id,
      description: `Заказ №${order.id.slice(0, 8)} — Икра & Рыба`,
      customerId: order.user_id ? String(order.user_id) : undefined,
      successRedirectUrl: `${config.frontendUrl}/payment-success.html?order=${order.id}`,
      failRedirectUrl: `${config.frontendUrl}/payment-fail.html?order=${order.id}`,
      paymentMethod: parsed.data.method,
      metadata: { order_id: order.id },
    });

    getDb()
      .prepare(
        `INSERT INTO payments (order_id, rollypay_payment_id, amount_cents, currency, status, pay_url, test_mode)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(order.id, result.payment_id, order.total_cents, 'RUB', result.status || 'created', result.pay_url, config.rollypay.testMode ? 1 : 0);

    getDb()
      .prepare(`UPDATE orders SET rollypay_payment_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(result.payment_id, order.id);

    res.json({ payUrl: result.pay_url, paymentId: result.payment_id, testMode: config.rollypay.testMode });
  } catch (e) {
    console.error('[payments] create failed:', e);
    if (e instanceof RollyPayError) {
      res.status(e.status === 503 ? 503 : 502).json({ error: 'Платёжный шлюз недоступен', detail: config.isProduction ? undefined : e.body });
      return;
    }
    res.status(500).json({ error: 'Не удалось создать платёж' });
  }
});

/** Статус платежа для страницы «спасибо» */
paymentsRouter.get('/:orderId/status', optionalAuth, (req, res) => {
  const row = getDb()
    .prepare(
      `SELECT o.status AS order_status, o.total_cents, p.status AS payment_status, p.pay_url
       FROM orders o LEFT JOIN payments p ON p.order_id = o.id
       WHERE o.id = ? ORDER BY p.id DESC LIMIT 1`
    )
    .get(req.params.orderId) as
    | { order_status: string; total_cents: number; payment_status: string | null; pay_url: string | null }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Заказ не найден' });
    return;
  }
  res.json({
    orderStatus: row.order_status,
    paymentStatus: row.payment_status,
    total: row.total_cents / 100,
    paid: row.order_status === 'paid',
  });
});

/** Список платежей для админки */
paymentsRouter.get('/', optionalAuth, (req, res) => {
  if (!req.user?.is_admin) {
    res.status(403).json({ error: 'Доступ только для администратора' });
    return;
  }
  const rows = getDb()
    .prepare(`SELECT * FROM payments ORDER BY id DESC LIMIT 200`)
    .all() as PaymentRow[];
  res.json({ payments: rows });
});