import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { Users, setSession, getSession, deleteSession, type OAuthProfile, type OAuthProviderId } from '../db.js';
import { limitAuth } from '../middleware/security.js';
import {
  AUTH_COOKIE,
  cookieOptions,
  optionalAuth,
  publicUser,
  signToken,
} from '../middleware/auth.js';

export const authRouter = Router();

/* ==========================================================================
   OAuth-вход через Яндекс ID, VK ID и MAX (Authorization Code flow).
   Общий каркас: /:provider/start → кука с state(+PKCE) → провайдер →
   /:provider/callback → обмен кода → профиль → upsert аккаунта → JWT-кука.
   ========================================================================== */

const OAUTH_STATE_COOKIE = 'ikra_oauth';

type OAuthCookie = { state: string; verifier?: string; intent?: 'admin' };

type ProviderSpec = {
  label: string;
  usesPkce: boolean;
  authorizeUrl(p: { redirectUri: string; state: string; codeChallenge: string }): string;
  exchange(p: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    deviceId: string;
    state: string;
  }): Promise<OAuthProfile>;
};

/* ---------------- Яндекс ID (oauth.yandex.ru) ---------------- */

const yandex: ProviderSpec = {
  label: 'Яндекс',
  // Яндекс проверяет client_secret; PKCE не требуется
  usesPkce: false,
  authorizeUrl: ({ redirectUri, state }) => {
    const url = new URL('https://oauth.yandex.ru/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.yandex.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('force_confirm', 'yes');
    return url.toString();
  },
  exchange: async ({ code, redirectUri }) => {
    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.yandex.clientId,
        client_secret: config.yandex.clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error('yandex_token_exchange ' + (await tokenRes.text()));
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) throw new Error('yandex_no_access_token');

    const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: 'OAuth ' + tokens.access_token },
    });
    if (!infoRes.ok) throw new Error('yandex_userinfo ' + infoRes.status);
    const info = (await infoRes.json()) as {
      id?: string | number;
      login?: string;
      default_email?: string;
      emails?: string[];
      real_name?: string;
      first_name?: string;
      is_avatar_empty?: boolean;
      default_avatar_id?: string;
    };
    const uid = info.id !== undefined ? String(info.id) : '';
    if (!uid) throw new Error('yandex_no_uid');
    const email =
      info.default_email ||
      (Array.isArray(info.emails) ? info.emails[0] : undefined) ||
      (info.login && info.login.includes('@') ? info.login : undefined) ||
      null;
    // Аватар: по докам Яндекса аватарки отдаются через get-yapic (islands-200)
    const avatar =
      !info.is_avatar_empty && info.default_avatar_id
        ? `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200`
        : null;
    return {
      uid,
      email,
      name: info.real_name || info.first_name || (info.login && info.login.includes('@') ? info.login.split('@')[0] : info.login) || 'Покупатель',
      avatar,
    };
  },
};

/* ---------------- VK ID (id.vk.ru, OAuth 2.1 + PKCE S256) ----------------
   Спецификация по официальным докам, проверено 04.11.2026
   (fleet/reports/research-vk.md): хост id.vk.ru, обмен кода — только
   form-urlencoded, профиль — POST /oauth2/user_info (get_userinfo удалён). */

const vk: ProviderSpec = {
  label: 'VK',
  usesPkce: true,
  authorizeUrl: ({ redirectUri, state, codeChallenge }) => {
    const url = new URL('https://id.vk.ru/authorize');
    url.searchParams.set('client_id', config.vk.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'vkid_personal_info email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  },
  exchange: async ({ code, redirectUri, codeVerifier, deviceId, state }) => {
    // device_id приходит query-параметром на redirect_uri вместе с code
    const tokenRes = await fetch('https://id.vk.ru/oauth2/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.vk.clientId,
        client_secret: config.vk.clientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        device_id: deviceId,
        state,
        // Для конфиденциальных приложений VK требует сервисный токен в обмене
        ...(config.vk.serviceToken ? { service_token: config.vk.serviceToken } : {}),
      }),
    });
    if (!tokenRes.ok) throw new Error('vk_token_exchange ' + (await tokenRes.text()));
    const tokens = (await tokenRes.json()) as { access_token?: string; user_id?: string };
    if (!tokens.access_token) throw new Error('vk_no_access_token');

    const infoRes = await fetch('https://id.vk.ru/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: tokens.access_token,
        client_id: config.vk.clientId,
      }),
    });
    if (!infoRes.ok) throw new Error('vk_userinfo ' + infoRes.status);
    const info = (await infoRes.json()) as {
      user?: {
        user_id?: string | number;
        first_name?: string;
        last_name?: string;
        email?: string;
        avatar?: string;
      };
    };
    const u = info.user || {};
    const uid = String(u.user_id ?? tokens.user_id ?? '');
    if (!uid) throw new Error('vk_no_uid');
    // Аватар VK — готовый URL (параметры as/cs задают размер); режем служебные «|»
    const rawAvatar = typeof u.avatar === 'string' ? u.avatar.split('|')[0] : '';
    return {
      uid,
      email: u.email || null,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Покупатель',
      avatar: rawAvatar || null,
    };
  },
};

/* ---------------- MAX: мини-приложение + одноразовый код ----------------
   Официального OAuth «Вход через MAX» не существует (проверено 04.11.2026
   по dev.max.ru, см. fleet/reports/research-max.md). Единственный официальный
   механизм — мини-приложение внутри webview MAX: сервер валидирует initData
   HMAC-подписью токена бота и выдаёт одноразовый код, который покупатель
   вводит на сайте. Email в профиле MAX нет — аккаунт создаётся по id. */

// Валидация initData по разделу «Валидация данных» dev.max.ru:
// 1) WebAppData из фрагмента; каждый параметр ровно один раз, hash присутствует;
// 2) убрать hash, URL-декодировать значения, отсортировать по ключам, собрать
//    «key=value» через \n;
// 3) secret_key = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN);
// 4) computed = hex(HMAC_SHA256(key=secret_key, data=launch_params));
// 5) constant-time сравнение с hash; auth_date не старше часа.
function validateMaxInitData(initData: string, debug?: string[]): { uid: string; name: string; photo: string | null } | null {
  if (!config.max.webappToken) { debug?.push('no_token'); return null; }
  const pairs = new URLSearchParams(initData);
  const hash = pairs.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) { debug?.push('hash_format'); return null; }
  if ([...pairs.keys()].filter((k) => k === 'hash').length !== 1) { debug?.push('hash_dup'); return null; }
  pairs.delete('hash');
  const launchParams = [...pairs.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort((a, b) => (a.split('=')[0] < b.split('=')[0] ? -1 : 1))
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.max.webappToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(launchParams).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { debug?.push('sig'); return null; }
  const authDate = Number(pairs.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 3600) { debug?.push('stale'); return null; }
  let user: { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } = {};
  try {
    user = JSON.parse(pairs.get('user') || '{}');
  } catch {
    debug?.push('user_parse'); return null;
  }
  if (!user.id) { debug?.push('no_uid'); return null; }
  return {
    uid: String(user.id),
    name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Покупатель',
    photo: user.photo_url || null,
  };
}

authRouter.post('/max/webapp', limitAuth, (req, res) => {
  const initData = String(req.body?.initData || '');
  const dbg: string[] = [];
  const prof = validateMaxInitData(initData, dbg);
  if (!prof) {
    console.warn(`[auth] max/webapp: подпись initData не прошла (${dbg.join(',') || 'ok-ветка'})`);
    res.status(401).json({ error: 'Не удалось подтвердить вход через MAX' });
    return;
  }
  const user = Users.upsertOAuth('max', { uid: prof.uid, email: null, name: prof.name, avatar: prof.photo });
  // Одноразовый код: внутри webview MAX кука нашего домена не заведётся,
  // поэтому вход на обычном сайте — по коду, действующему 5 минут
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  setSession(`maxlogin:${code}`, { userId: user.id }, 5 * 60 * 1000);
  console.log(`[auth] max/webapp: код выдан для user ${user.id}`);
  res.json({ code, name: user.name });
});

authRouter.post('/max/claim', limitAuth, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const data = getSession<{ userId: number }>(`maxlogin:${code}`);
  if (!data) {
    res.status(401).json({ error: 'Код неверный или устарел' });
    return;
  }
  deleteSession(`maxlogin:${code}`);
  const user = Users.findById(data.userId);
  if (!user) {
    res.status(401).json({ error: 'Аккаунт не найден' });
    return;
  }
  res.cookie(AUTH_COOKIE, signToken(user), cookieOptions());
  res.json({ user: publicUser(user) });
});

/* ---------------- OAuth-редиректы: Яндекс / VK ---------------- */

const providers: Record<'yandex' | 'vk', ProviderSpec> = { yandex, vk };

function isProviderId(v: string): v is 'yandex' | 'vk' {
  return v === 'yandex' || v === 'vk';
}

function providerConfig(id: 'yandex' | 'vk') {
  return id === 'yandex' ? config.yandex : config.vk;
}

/* ---------------- Локальная регистрация и вход ---------------- */

/** Обмен кода на профиль: единая обвязка ошибок для редирект-провайдеров */
async function exchangeProfile(
  id: 'yandex' | 'vk',
  q: { code?: string; device_id?: string; state?: string },
  kv: OAuthCookie,
  redirectUri: string,
): Promise<OAuthProfile> {
  const spec = providers[id];
  return spec.exchange({
    code: String(q.code || ''),
    redirectUri,
    codeVerifier: kv.verifier || '',
    deviceId: String(q.device_id || ''),
    state: String(q.state || ''),
  });
}

authRouter.get('/:provider/start', (req, res) => {
  const id = String(req.params.provider);
  if (!isProviderId(id)) {
    res.status(404).json({ error: 'Неизвестный способ входа' });
    return;
  }
  if (!providerConfig(id).enabled) {
    res.status(503).json({ error: `Вход через ${providers[id].label} пока не настроен на сервере` });
    return;
  }
  const state = crypto.randomBytes(24).toString('hex');
  const kv: OAuthCookie = { state };
  if (req.query.redirect === 'admin') kv.intent = 'admin';
  // VK ID работает по OAuth 2.1: код_verifier должен дожить до callback — в куке
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  if (providers[id].usesPkce) kv.verifier = codeVerifier;
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  res.cookie(OAUTH_STATE_COOKIE, JSON.stringify(kv), {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'none' : 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });

  const redirectUri = `${config.appUrl}/api/auth/${id}/callback`;
  res.redirect(providers[id].authorizeUrl({ redirectUri, state, codeChallenge }));
});

authRouter.get('/:provider/callback', async (req, res) => {
  const id = String(req.params.provider);
  if (!isProviderId(id)) {
    res.redirect(`${config.frontendUrl}/?auth_error=failed`);
    return;
  }
  const fail = (code: string) => res.redirect(`${config.frontendUrl}/?auth_error=${code}`);

  if (!providerConfig(id).enabled) return fail(`${id}_disabled`);
  // Пользователь отказался в окне провайдера (error=access_denied и т.п.)
  if (req.query.error) {
    console.warn(`[auth] ${id}: провайдер вернул error=${req.query.error}`);
    return fail(`${id}_failed`);
  }
  const { code, state, intent } = req.query as { code?: string; state?: string; intent?: string };

  // CSRF-защита: state из query обязан совпасть с тем, что мы выдали в куке
  let kv: OAuthCookie | null = null;
  try {
    kv = JSON.parse(String(req.cookies?.[OAUTH_STATE_COOKIE] || '')) as OAuthCookie;
  } catch {
    kv = null;
  }
  if (!state || !kv || kv.state !== state) {
    console.warn(`[auth] ${id}: OAuth state mismatch`);
    return fail('state_mismatch');
  }
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

  try {
    const redirectUri = `${config.appUrl}/api/auth/${id}/callback`;
    const profile = await exchangeProfile(id, req.query as Record<string, string>, kv, redirectUri);
    const user = Users.upsertOAuth(id, profile);
    // intent=admin приходит из админ-формы: без прав — не впускаем
    if ((intent === 'admin' || kv.intent === 'admin') && !user.is_admin) {
      return fail('not_admin');
    }
    res.cookie(AUTH_COOKIE, signToken(user), cookieOptions());
    return res.redirect(`${config.frontendUrl}/?auth=ok`);
  } catch (e) {
    console.error(`[auth] ${id} callback failed:`, e);
    return fail(`${id}_failed`);
  }
});

/* ---------------- Локальная регистрация и вход ---------------- */

// Единый текст ошибки аутентификации: не раскрываем, что именно неверно
// (несуществующая почта / неверный пароль / занятый при регистрации)
const AUTH_ERROR = 'Неверная почта или пароль';

// Заранее вычисленный bcrypt-хеш случайной строки: сравнение с ним для несуществующих
// пользователей делает время ответа логина одинаковым и не выдаёт существование аккаунта
const DUMMY_HASH = '$2b$12$3Z5Wau5.oLA2HsBROTIlteHKmIZb6EjvaYhXBFRZuNPcPrVYfmTD6';

const emailSchema = z.string().email().max(254);
const passwordSchema = z.string().min(8, 'Пароль должен быть не короче 8 символов').max(128);
const nameSchema = z.string().trim().min(1).max(80);

authRouter.post('/register', limitAuth, async (req, res) => {
  try {
    const body = z
      .object({ email: emailSchema, password: passwordSchema, name: nameSchema })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message || 'Некорректные данные' });
      return;
    }
    const { email, password, name } = body.data;
    if (Users.findByEmail(email)) {
      // Не раскрываем существование аккаунта: без 409 и явного «занят».
      // Хешируем пароль и на этой ветке — время ответа не отличается от успешной регистрации.
      console.warn(`[auth] register: отклонена попытка дубликата аккаунта (${email})`);
      await bcrypt.hash(password, 12);
      res.status(401).json({ error: AUTH_ERROR });
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    Users.createLocal(email, name, hash);
    const user = Users.findByEmail(email)!;
    res.cookie(AUTH_COOKIE, signToken(user), cookieOptions());
    res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    console.error('[auth] register:', e);
    res.status(500).json({ error: 'Не удалось зарегистрироваться' });
  }
});

authRouter.post('/login', limitAuth, async (req, res) => {
  try {
    const body = z.object({ email: emailSchema, password: passwordSchema }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Некорректные данные' });
      return;
    }
    const user = Users.findByEmail(body.data.email);
    // bcrypt.compare выполняется всегда: для несуществующего email и аккаунта
    // без пароля (OAuth) — с фейковым хешем, чтобы время ответа не выдавало
    const ok = await bcrypt.compare(body.data.password, user?.password_hash || DUMMY_HASH);
    if (!user || !user.password_hash || !ok) {
      res.status(401).json({ error: AUTH_ERROR });
      return;
    }
    res.cookie(AUTH_COOKIE, signToken(user), cookieOptions());
    res.json({ user: publicUser(user) });
  } catch (e) {
    console.error('[auth] login:', e);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get('/me', optionalAuth, (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});
