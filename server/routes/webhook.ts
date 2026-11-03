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
 * Статус-машина заказа: целевой статус (из события) → допустимые текущие статусы.
 * Переход вне этой карты запрещён — прямой записи произвольного статуса нет.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['pending'], // повторный payment.created — идемпотентно
  paid: ['pending', 'canceled', 'expired'], // повторная оплата отменённого/истёкшего заказа разрешена
  canceled: ['pending'],
  expired: ['pending'],
  refunded: ['pending', 'paid'], // возврат возможен и для оплаченного заказа
};

/**
 * Колбэк RollyPay.
 * 1) Проверяем HMAC-подпись по сырому телу — до разбора JSON и любых побочных эффектов.
 * 2) Валидируем тело (белый список событий, строковые id), сверяем сумму вебхука
 *    с total_cents заказа и применяем статус только по карте разрешённых переходов.
 * 3) Повторная доставка того же события — no-op; на обработанные и отклонённые
 *    события отвечаем 200 (чтобы шлюз не ретраил), кроме битого тела/подписи.
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  // Валидация тела: только явные проверки типов, никакой динамики по прототипу
  if (typeof parsed !== 'object' || parsed === null) {
    res.status(400).send('Invalid body');
    return;
  }
  const body = parsed as WebhookBody;
  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  const paymentId = typeof body.payment_id === 'string' ? body.payment_id.trim() : '';
  const orderId = typeof body.order_id === 'string' ? body.order_id : '';
  // Статус шлюза пишем только в таблицу payments как справочный
  const gatewayStatus = typeof body.status === 'string' ? body.status.slice(0, 64) : 'unknown';

  if (!paymentId || !eventType || !Object.hasOwn(ORDER_STATUS_BY_EVENT, eventType)) {
    // Событие вне белого списка либо без id платежа — без side-effects
    console.warn('[webhook] событие вне белого списка или некорректно:', eventType, paymentId || '(пусто)');
    res.status(400).send('Invalid event');
    return;
  }
  const targetStatus: string = ORDER_STATUS_BY_EVENT[eventType];

  try {
    const db = getDb();

    // Идемпотентность: повторная доставка того же события — no-op
    const payment = db
      .prepare(`SELECT id, webhook_event FROM payments WHERE rollypay_payment_id=?`)
      .get(paymentId) as { id: number; webhook_event: string | null } | undefined;
    if (payment && payment.webhook_event === eventType) {
      console.log(`[webhook] повтор события ${eventType} для платежа ${paymentId} — no-op`);
      res.status(200).send('OK');
      return;
    }

    // Фиксируем доставленное событие в payments (аудит: сырое тело до 4 КБ)
    db.prepare(
      `UPDATE payments SET status=?, webhook_event=?, webhook_raw=?,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE rollypay_payment_id=?`
    ).run(gatewayStatus, eventType, raw.slice(0, 4000), paymentId);

    const order = db
      .prepare(`SELECT id, status, total_cents FROM orders WHERE id=? OR rollypay_payment_id=?`)
      .get(orderId, paymentId) as { id: string; status: string; total_cents: number } | undefined;

    if (!order) {
      console.warn('[webhook] заказ не найден:', orderId, paymentId);
      res.status(200).send('OK');
      return;
    }

    // Сверка суммы вебхука с суммой заказа из БД; при расхождении статус не меняем
    const webhookCents = typeof body.amount === 'string' ? Math.round(Number(body.amount) * 100) : NaN;
    if (!Number.isFinite(webhookCents) || webhookCents !== order.total_cents) {
      console.error(
        `[webhook][ANOMALY] сумма вебхука не совпадает с заказом ${order.id}: ` +
          `webhook=${String(body.amount)} ${String(body.currency)}, заказ=${(order.total_cents / 100).toFixed(2)} RUB — статус не изменён`
      );
      res.status(200).send('OK'); // 200, чтобы шлюз не ретраил
      return;
    }

    const allowedFrom = ALLOWED_TRANSITIONS[targetStatus];
    if (!allowedFrom || !allowedFrom.includes(order.status)) {
      // Запрещённый переход (например, запоздавшие canceled/expired поверх paid) — игнорируем
      console.warn(
        `[webhook] переход ${order.status} → ${targetStatus} запрещён (заказ ${order.id}) — пропущен`
      );
      res.status(200).send('OK');
      return;
    }

    // Условный UPDATE: статус меняется только с ожидаемого текущего значения
    const updated = db
      .prepare(
        `UPDATE orders SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id=? AND status=?`
      )
      .run(targetStatus, order.id, order.status);

    if (updated.changes > 0 && targetStatus === 'paid') {
      const isTest = body.test === true || String(req.headers['x-test-mode']) === 'true';
      console.log(
        `[webhook] ✅ Заказ ${order.id} оплачен${isTest ? ' (ТЕСТОВЫЙ РЕЖИМ)' : ''}: ${body.amount} ${body.currency}`
      );
      // Точка расширения: уведомление менеджеру (WhatsApp/Telegram/e-mail)
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
