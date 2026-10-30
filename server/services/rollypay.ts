import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Клиент RollyPay.
 * Документация: https://docs.rollypay.io
 * - Создание платежа: POST /api/v1/payments
 * - Аутентификация: заголовки X-API-Key и X-Nonce (уникальный UUID на каждый запрос)
 * - Вебхук: заголовки X-Signature (HMAC-SHA256 от `${timestamp}.${rawBody}`) и X-Timestamp
 */

export type CreatePaymentInput = {
  amount: string; // "1500.00"
  orderId: string;
  description?: string;
  customerId?: string;
  successRedirectUrl?: string;
  failRedirectUrl?: string;
  paymentMethod?: 'sbp' | 'card' | 'intl_card' | 'crypto';
  metadata?: Record<string, unknown>;
};

export type CreatePaymentResult = {
  payment_id: string;
  order_id: string;
  status: string;
  token?: string;
  pay_url: string;
  amount: string;
  payment_currency: string;
  qr_content?: string;
  expires_at?: string;
  environment?: string;
  test?: boolean;
};

export class RollyPayError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function assertConfigured(): void {
  if (!config.rollypay.enabled) {
    throw new RollyPayError(
      'RollyPay не настроен: задайте ROLLYPAY_API_KEY и ROLLYPAY_SIGNING_SECRET',
      503,
      null
    );
  }
}

export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  assertConfigured();

  const payload = {
    amount: input.amount,
    payment_currency: 'RUB',
    order_id: input.orderId,
    description: input.description || `Оплата заказа ${input.orderId}`,
    customer_id: input.customerId,
    success_redirect_url: input.successRedirectUrl,
    fail_redirect_url: input.failRedirectUrl,
    payment_method: input.paymentMethod,
    metadata: input.metadata,
    test: config.rollypay.testMode,
  };

  const res = await fetch(`${config.rollypay.baseUrl}/api/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.rollypay.apiKey,
      'X-Nonce': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* оставляем текст */
  }

  if (!res.ok) {
    throw new RollyPayError(
      `RollyPay createPayment failed: ${res.status}`,
      res.status,
      body
    );
  }
  return body as CreatePaymentResult;
}

export async function getPayment(paymentId: string): Promise<Record<string, unknown>> {
  assertConfigured();
  const res = await fetch(`${config.rollypay.baseUrl}/api/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.rollypay.apiKey,
      'X-Nonce': crypto.randomUUID(),
    },
  });
  const body = await res.json();
  if (!res.ok) throw new RollyPayError(`RollyPay getPayment failed: ${res.status}`, res.status, body);
  return body as Record<string, unknown>;
}

/**
 * Проверка подписи вебхука.
 * Подпись = HMAC-SHA256(signing_secret, `${timestamp}.${rawBody}`) в hex.
 * Сравнение через timingSafeEqual, чтобы исключить timing-атаки.
 */
export function verifyWebhookSignature(rawBody: string, timestamp: string, signature: string): boolean {
  if (!config.rollypay.signingSecret || !timestamp || !signature) return false;

  // Защита от replay: подпись старше 10 минут не принимаем
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > 600) return false;

  const expected = crypto
    .createHmac('sha256', config.rollypay.signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Статусы RollyPay → статусы заказа */
export const ORDER_STATUS_BY_EVENT: Record<string, string> = {
  'payment.paid': 'paid',
  'payment.canceled': 'canceled',
  'payment.expired': 'expired',
  'payment.chargeback': 'refunded',
  'payment.refunded': 'refunded',
  'payment.created': 'pending',
};