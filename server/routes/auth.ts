import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { config } from '../config.js';
import { Users } from '../db.js';
import { limitAuth } from '../middleware/security.js';
import {
  AUTH_COOKIE,
  cookieOptions,
  optionalAuth,
  publicUser,
  signToken,
} from '../middleware/auth.js';

export const authRouter = Router();
const googleClient = new OAuth2Client(config.google.clientId, config.google.clientSecret);

/* ---------------- Google OAuth (Authorization Code flow) ---------------- */

authRouter.get('/google/start', (req, res) => {
  if (!config.google.enabled) {
    res.status(503).json({ error: 'Вход через Google не настроен на сервере' });
    return;
  }
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie('ikra_oauth_state', state, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'none' : 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });

  const redirectUri = `${config.appUrl}/api/auth/google/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.google.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  const target = req.query.redirect === 'admin' ? '&intent=admin' : '';
  res.redirect(url.toString() + target);
});

authRouter.get('/google/callback', async (req, res) => {
  const { code, state, intent } = req.query as { code?: string; state?: string; intent?: string };
  const expected = req.cookies?.ikra_oauth_state;

  if (!config.google.enabled) {
    return res.redirect(`${config.frontendUrl}/?auth_error=google_disabled`);
  }
  // CSRF защита OAuth-флоу: state должен совпасть с cookie
  if (!state || !expected || state !== expected) {
    console.warn('[auth] OAuth state mismatch');
    return res.redirect(`${config.frontendUrl}/?auth_error=state_mismatch`);
  }
  res.clearCookie('ikra_oauth_state', { path: '/' });

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code || ''),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: `${config.appUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error('token_exchange_failed ' + (await tokenRes.text()));
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error('no_id_token');

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) throw new Error('email_not_verified');

    const user = Users.upsertGoogle(payload.email, payload.name || payload.email.split('@')[0], payload.picture);
    if (intent === 'admin' && !user.is_admin) {
      return res.redirect(`${config.frontendUrl}/?auth_error=not_admin`);
    }

    res.cookie(AUTH_COOKIE, signToken(user), cookieOptions());
    return res.redirect(`${config.frontendUrl}/?auth=ok`);
  } catch (e) {
    console.error('[auth] google callback failed:', e);
    return res.redirect(`${config.frontendUrl}/?auth_error=google_failed`);
  }
});

/* ---------------- Локальная регистрация и вход ---------------- */

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
      res.status(409).json({ error: 'Пользователь с такой почтой уже зарегистрирован' });
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
    const body = z.object({ email: emailSchema, password: z.string().max(128) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Некорректные данные' });
      return;
    }
    const user = Users.findByEmail(body.data.email);
    // Одинаковый ответ для несуществующего пользователя и неверного пароля
    const ok = user && user.password_hash ? await bcrypt.compare(body.data.password, user.password_hash) : false;
    if (!ok || !user) {
      res.status(401).json({ error: 'Неверная почта или пароль' });
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