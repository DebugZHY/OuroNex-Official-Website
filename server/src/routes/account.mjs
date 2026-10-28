/**
 * Account API router.
 *
 * Mount path: the server mounts this router at `/api/account` (server/src/index.js), so the
 * client-facing URL is `GET /api/account/me/subscription`. Paths inside this file are relative.
 *
 * Identity comes from the auth-context seam; the subscription read model is reused as-is so the
 * SQL lives in exactly one place (server/src/lib/subscriptions.mjs).
 */

import express from 'express';
import { resolveUserId } from '../lib/auth-context.mjs';
import { getSubscriptionForUser } from '../lib/subscriptions.mjs';
import { sendWelcomeOnce, welcomeOnceEnabled } from '../lib/notification-once.mjs';

export const accountRouter = express.Router();

/**
 * First authenticated request for a user is also the first moment we know they exist, so the
 * welcome letter is triggered here. Nothing about this may change the response: it runs after the
 * body is committed, failures are logged and swallowed, and `OURONEX_WELCOME_ONCE=off` skips it.
 */
function welcomeOnceInBackground(userId) {
  if (!welcomeOnceEnabled()) return;
  Promise.resolve()
    .then(() => sendWelcomeOnce(userId))
    .then((outcome) => {
      if (outcome && outcome.sent !== true && outcome.reason !== 'already_sent') {
        console.warn('[account] welcome not sent:', outcome.reason, outcome.detail ?? '');
      }
    })
    .catch((error) => console.warn('[account] welcome hook failed:', sanitizeForLog(error && error.message)));
}

/** Remove anything that looks like a connection string or credential before logging. */
function sanitizeForLog(message) {
  return String(message ?? 'unknown error')
    .replace(/postgres(ql)?:\/\/\S+/gi, '[redacted-connection-string]')
    .replace(/password=\S+/gi, 'password=[redacted]');
}

accountRouter.get('/me/subscription', async (req, res) => {
  let identity;
  try {
    identity = await resolveUserId(req);
  } catch (error) {
    console.error('[account] identity resolution failed:', sanitizeForLog(error && error.message));
    return res.status(401).json({ error: 'unauthenticated', identity: 'unconfigured', reason: 'identity_error' });
  }

  if (!identity.userId) {
    return res.status(401).json({ error: 'unauthenticated', identity: identity.mode, reason: identity.reason });
  }

  let subscription;
  try {
    subscription = await getSubscriptionForUser(identity.userId);
  } catch (error) {
    console.error('[account] subscription lookup failed:', sanitizeForLog(error && error.message));
    return res.status(500).json({ error: 'subscription_lookup_failed' });
  }

  res.json({ ...subscription, identity: identity.mode });
  welcomeOnceInBackground(identity.userId);
  return undefined;
});

export default accountRouter;