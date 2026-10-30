import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { limitWebhook } from '../middleware/security.js';
import { ORDER_STATUS_BY_EVENT, verifyWebhookSignature } from '../services/rollypay.js';

export const webhookRouter = Router();

type WebhookBody = {
  event_type: string;
  payment_id: string;
  order_id: string;
  status: string;
  amount: string;
  currency: string;
  test?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Колбэк RollyPay.
 * 1) Проверяем HMAC-подпись по сырому телу — до разбора JSON и любых побочных эффектов.
 * 2) Только после этого обновляем заказ. Повторные доставки идемпотентны.
 * 3) Отвечаем 200 быстро (RollyPay ждёт ответ не дольше 10 с).
 */
webhookRouter.post('/rollypay', limitWebhook, (req: Request, res: Response) => {
  const signature = String(req.headers['x-signature'] || '');
  const timestamp = String(req.headers['x-timestamp'] || '');
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody) {
    console.error('[webhook] raw body отсутствует — проверка подписи невозможна');
    res.status(400).send('Bad Request');
    return;
  }

  const raw = rawBody.toString('utf8');
  if (!verifyWebhookSignature(raw, timestamp, signature)) {
    console.warn('[webhook] invalid signature — rejected');
    res.status(403).send('Invalid signature');
    return;
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  try {
    const targetStatus = ORDER_STATUS_BY_EVENT[body.event_type];
    const isTest = body.test === true || String(req.headers['x-test-mode']) === 'true';

    getDb()
      .prepare(
        `UPDATE payments SET status=?, webhook_event=?, webhook_raw=?,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE rollypay_payment_id=?`
      )
      .run(body.status || 'unknown', body.event_type, raw.slice(0, 4000), body.payment_id);

    const order = getDb()
      .prepare(`SELECT id, status FROM orders WHERE id=? OR rollypay_payment_id=?`)
      .get(body.order_id, body.payment_id) as { id: string; status: string } | undefined;

    if (order && targetStatus) {
      // Оплаченный заказ не откатываем назад из-за запоздавших событий
      const protectedStatuses = new Set(['paid', 'refunded']);
      const next = protectedStatuses.has(order.status) && targetStatus === 'pending' ? order.status : targetStatus;
      getDb()
        .prepare(`UPDATE orders SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .run(next, order.id);

      if (next === 'paid') {
        console.log(
          `[webhook] ✅ Заказ ${order.id} оплачен${isTest ? ' (ТЕСТОВЫЙ РЕЖИМ)' : ''}: ${body.amount} ${body.currency}`
        );
        // Точка расширения: уведомление менеджеру (WhatsApp/Telegram/e-mail)
      }
    } else if (!order) {
      console.warn('[webhook] заказ не найден:', body.order_id, body.payment_id);
    }
  } catch (e) {
    console.error('[webhook] processing error:', e);
    // Отвечаем 500, чтобы платёжный шлюз повторил доставку
    res.status(500).send('Processing error');
    return;
  }

  res.status(200).send('OK');
});

if (!config.rollypay.enabled) {
  console.warn('[webhook] RollyPay не настроен — вебхуки будут отклоняться до указания ключей');
}