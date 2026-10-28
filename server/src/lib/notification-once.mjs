/**
 * Exactly-once notifications that our own application initiates.
 *
 * Why this exists: the self-hosted auth service has no webhook we can rely on ("user created"
 * never reaches us), so a welcome letter has to be triggered by the application itself — which
 * means the application also has to guarantee it is sent once. That guarantee lives in
 * `app_notification` (migration 0004): one row per (user_id, kind), and the row insert *is* the
 * claim. Concurrent requests race on the primary key, so at most one of them gets to send.
 *
 * Status vocabulary: 'claimed' -> 'sent' | 'failed'. 'sent' is terminal; 'failed' is re-claimable so
 * a later request retries the send. A 'claimed' row older than STALE_CLAIM_MINUTES is treated as
 * abandoned (the process died mid-send) and may be claimed again, so a crash does not permanently
 * silence a user while a live concurrent request still cannot double-send.
 *
 * Nothing here throws at the caller: a notification is never allowed to fail the HTTP request that
 * triggered it. Failure reasons are returned as values and recorded in `last_error`.
 */
import { getPool, getUserContact } from './subscriptions.mjs';
import { render } from '../emails/index.mjs';
import { sendEmail } from './mailer.mjs';

export const WELCOME_KIND = 'welcome';

const ENABLE_VAR = 'OURONEX_WELCOME_ONCE';
const STALE_CLAIM_MINUTES = 15;

/** The welcome path can be switched off for load tests and probes; anything but an explicit off value means on. */
export function welcomeOnceEnabled(env = process.env) {
  const raw = String(env?.[ENABLE_VAR] ?? '').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false' || raw === 'no');
}

/** Remove anything that looks like a connection string or credential before it reaches a log or a row. */
function sanitize(message) {
  return String(message ?? 'unknown error')
    .replace(/postgres(ql)?:\/\/\S+/gi, '[redacted-connection-string]')
    .replace(/password=\S+/gi, 'password=[redacted]')
    .slice(0, 500);
}

/**
 * Try to take the (user, kind) claim.
 *
 * Returns { claimed, status, attempts }. `claimed: false` means someone else already owns this
 * notification: either it was sent, or a live request is sending it right now.
 *
 * The conflict clause is what makes this safe: it only updates rows that are 'failed' or look
 * abandoned, so the insert of the *first* request wins and the other racing requests update nothing
 * and get no row back.
 */
export async function claimNotification({ userId, kind } = {}) {
  if (typeof userId !== 'string' || userId.length === 0) throw new Error('claimNotification: userId required');
  if (typeof kind !== 'string' || kind.length === 0) throw new Error('claimNotification: kind required');

  const { rows } = await getPool().query(
    `INSERT INTO app_notification (user_id, kind)
          VALUES ($1, $2)
     ON CONFLICT (user_id, kind) DO UPDATE
            SET attempts   = app_notification.attempts + 1,
                status     = 'claimed',
                claimed_at = now(),
                last_error = NULL
          WHERE app_notification.status = 'failed'
             OR (app_notification.status = 'claimed'
                 AND app_notification.claimed_at < now() - ($3 || ' minutes')::interval)
      RETURNING user_id, kind, status, attempts`,
    [userId, kind, String(STALE_CLAIM_MINUTES)],
  );

  if (rows.length > 0) {
    return { claimed: true, status: rows[0].status, attempts: rows[0].attempts };
  }

  const { rows: existing } = await getPool().query(
    'SELECT status, attempts, sent_at FROM app_notification WHERE user_id = $1 AND kind = $2',
    [userId, kind],
  );
  return {
    claimed: false,
    status: existing[0]?.status ?? null,
    attempts: existing[0]?.attempts ?? null,
    sentAt: existing[0]?.sent_at ?? null,
  };
}

/** Record a delivered notification: 'sent' is terminal, so no later request can claim it again. */
export async function markSent({ userId, kind } = {}) {
  await getPool().query(
    `UPDATE app_notification
        SET status = 'sent', sent_at = now(), last_error = NULL
      WHERE user_id = $1 AND kind = $2`,
    [userId, kind],
  );
  return { ok: true };
}

/** Record a failed delivery attempt; the row stays re-claimable so a later request can retry. */
export async function markFailed({ userId, kind, message } = {}) {
  await getPool().query(
    `UPDATE app_notification
        SET status = 'failed', last_error = $3
      WHERE user_id = $1 AND kind = $2`,
    [userId, kind, sanitize(message)],
  );
  return { ok: true };
}

/**
 * Claim, deliver, then record the outcome — in that order, and never throwing.
 *
 * Returns one of:
 *   { sent: true,  driver, file, attempts }
 *   { sent: false, reason: 'already_sent' | 'claimed_elsewhere' | 'claim_failed' | 'failed' | 'no_recipient' | 'disabled' }
 */
export async function sendOnce({ userId, kind, to, subject, html, text, template, data } = {}) {
  if (!to) return { sent: false, reason: 'no_recipient' };

  let claim;
  try {
    claim = await claimNotification({ userId, kind });
  } catch (error) {
    console.error('[notify-once] claim failed:', sanitize(error && error.message));
    return { sent: false, reason: 'claim_failed', detail: sanitize(error && error.message) };
  }

  if (claim.claimed !== true) {
    return {
      sent: false,
      reason: claim.status === 'sent' ? 'already_sent' : 'claimed_elsewhere',
      status: claim.status,
    };
  }

  let delivery;
  try {
    delivery = await sendEmail({ to, subject, html, text, template, data });
  } catch (error) {
    delivery = { ok: false, reason: `threw:${(error && error.message) || 'unknown'}` };
  }

  if (delivery && delivery.ok === true) {
    try {
      await markSent({ userId, kind });
    } catch (error) {
      // The mail went out; failing to record it must not turn a delivery into an error, but it is
      // worth a log line because it means a later request may claim the stale row and re-send.
      console.error('[notify-once] sent but not recorded:', sanitize(error && error.message));
    }
    return { sent: true, driver: delivery.driver, file: delivery.file, attempts: claim.attempts };
  }

  const reason = (delivery && delivery.reason) || 'unknown';
  try {
    await markFailed({ userId, kind, message: reason });
  } catch (error) {
    console.error('[notify-once] failed to record failure:', sanitize(error && error.message));
  }
  return { sent: false, reason: 'failed', detail: reason, attempts: claim.attempts };
}

/**
 * Welcome letter for a user, at most once ever.
 *
 * The recipient is resolved *before* the claim: a user without an email address must not consume the
 * claim, or they could never be welcomed later once they add one.
 */
export async function sendWelcomeOnce(userId, { enabled = welcomeOnceEnabled() } = {}) {
  if (!enabled) return { sent: false, reason: 'disabled' };
  if (typeof userId !== 'string' || userId.length === 0) return { sent: false, reason: 'no_recipient' };

  let contact;
  try {
    contact = await getUserContact(userId);
  } catch (error) {
    console.error('[notify-once] contact lookup failed:', sanitize(error && error.message));
    return { sent: false, reason: 'contact_lookup_failed' };
  }

  const email = contact?.email;
  if (!email) return { sent: false, reason: 'no_recipient' };

  const data = { name: contact.displayName ?? undefined, email };
  let message;
  try {
    message = render('welcome', data);
  } catch (error) {
    return { sent: false, reason: 'render_failed', detail: sanitize(error && error.message) };
  }

  return sendOnce({
    userId,
    kind: WELCOME_KIND,
    to: email,
    subject: message.subject,
    template: 'welcome',
    data,
    html: message.html,
    text: message.text,
  });
}

export default { claimNotification, markSent, markFailed, sendOnce, sendWelcomeOnce, welcomeOnceEnabled };
