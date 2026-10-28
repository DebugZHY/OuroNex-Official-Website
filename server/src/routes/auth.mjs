/**
 * Auth helpers router.
 *
 * Mount path: /api/auth
 *
 * These endpoints add the UX Stack Auth does not provide out of the box for our flows:
 *   POST /api/auth/resolve-username  -> look up the primary email for a username stored
 *                                       in ProjectUser.clientMetadata.username, so the
 *                                       login form can accept either email or username.
 *   POST /api/auth/forgot-password   -> thin wrapper over Stack Auth's send-reset-code that
 *                                       fixes the callback URL to our own /reset-password.html
 *                                       so the deployed origin is always right.
 *
 * Both endpoints are unauthenticated; they only return data the caller already knows
 * (the email they are trying to sign in with) or trigger an email to the address on file.
 */
import express from 'express';
import { getPool } from '../lib/subscriptions.mjs';

export const authRouter = express.Router();

const STACK_API_URL = process.env.NEXT_PUBLIC_STACK_API_URL || 'http://localhost:8102';
const STACK_PROJECT_ID = process.env.STACK_PROJECT_ID || process.env.HEXCLAVE_PROJECT_ID || '';
const STACK_PUB_KEY = process.env.STACK_PUBLISHABLE_CLIENT_KEY || '';
const APP_ORIGIN = process.env.PUBLIC_BASE_URL || 'http://localhost:3100';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/**
 * Resolve a username to the account's primary email.
 * Body: { username: string }
 * Returns: { email: string | null }
 */
authRouter.post('/resolve-username', async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'invalid_username' });
  }
  try {
    const { rows } = await getPool().query(
      `SELECT "projectUserId" AS id, "clientMetadata"->>'username' AS uname
       FROM "ProjectUser"
       WHERE lower("clientMetadata"->>'username') = $1
       LIMIT 1`,
      [username],
    );
    if (!rows.length) return res.json({ email: null });

    // Look up the primary email for this user. Stack Auth keeps emails in ContactChannel.
    // isPrimary is a BooleanTrue/BooleanFalse enum in this Stack Auth schema, not a boolean.
    const userId = rows[0].id;
    const { rows: emailRows } = await getPool().query(
      `SELECT value AS email
       FROM "ContactChannel"
       WHERE "projectUserId" = $1 AND type = 'EMAIL' AND "isPrimary"::text = 'TRUE'
       LIMIT 1`,
      [userId],
    );
    const email = emailRows.length ? emailRows[0].email : null;
    return res.json({ email });
  } catch (err) {
    console.error('[auth] resolve-username failed:', err && err.message);
    return res.status(500).json({ error: 'resolve_failed' });
  }
});

/**
 * Send a password-reset email for the given address.
 * Body: { email: string }
 * Always returns ok:true so callers cannot probe which emails are registered.
 */
authRouter.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  try {
    const upstream = await fetch(`${STACK_API_URL}/api/v1/auth/password/send-reset-code`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-stack-project-id': STACK_PROJECT_ID,
        'x-stack-publishable-client-key': STACK_PUB_KEY,
        'x-stack-access-type': 'client',
      },
      body: JSON.stringify({
        email,
        callback_url: `${APP_ORIGIN}/reset-password.html`,
      }),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      console.error('[auth] forgot-password upstream error:', upstream.status, text.slice(0, 200));
    }
  } catch (err) {
    console.error('[auth] forgot-password fetch failed:', err && err.message);
  }
  // Always report success — the response tells the caller nothing about whether the email exists.
  res.json({ ok: true });
});

export default authRouter;
