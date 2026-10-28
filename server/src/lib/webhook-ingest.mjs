/**
 * App-side webhook intake.
 *
 * Ownership boundary: PayKit 0.2.0 owns the Stripe endpoint contract, the SDK signature check, its
 * own idempotent claim on paykit_webhook_event and every write to paykit_* tables — including
 * paykit_subscription, our source of truth. We own exactly one table, app_webhook_event, which is
 * the replay guard and notification log for this module. This module therefore:
 *   - verifies the Stripe signature itself (no PayKit verifier is exported),
 *   - records the event once in app_webhook_event and never in paykit_webhook_event,
 *   - hands the same raw request to PayKit's handler (./paykit-apply.mjs) so PayKit performs the
 *     subscription / payment / invoice writes it is responsible for,
 *   - sends at most one subscription-status email through the existing mailer/template layers.
 *
 * Keeping our rows out of paykit_webhook_event matters: PayKit treats a unique violation on
 * stripe_event_id as a replay and only re-claims rows that are 'failed' or stale 'processing', so
 * one of our rows on that id would make PayKit skip applying the event and paykit_subscription —
 * the source of truth — would silently stop updating.
 *
 * Order is apply-then-notify: the status email reads paykit_subscription, so it may only be sent
 * after the subscription row reflects the event. A failed apply answers 500 so Stripe redelivers;
 * the redelivery finds our 'apply_failed' row and retries the apply instead of calling it a replay.
 *
 * Our status vocabulary here is 'received' -> 'applied' -> 'notified' | 'notify_failed', plus
 * 'ignored' for types we do not notify about and 'apply_failed' when PayKit rejected the event.
 * The pool is the single lazily created pool from ./subscriptions.mjs.
 */
import crypto from 'node:crypto';
import { getPool, getUserContact } from './subscriptions.mjs';
import { render, STATUS_TEMPLATES } from '../emails/index.mjs';
import { sendEmail } from './mailer.mjs';
import { applyWithPayKit } from './paykit-apply.mjs';
import { resolveStripeConfig } from './billing.mjs';

const SIGNATURE_HEADER = 'stripe-signature';
const TOLERANCE_SECONDS = 300;

/** Stripe event types that can change what a user's subscription-status email should say. */
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
]);

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const direct = headers.get(name);
    if (direct != null) return direct;
    const lower = headers.get(name.toLowerCase());
    if (lower != null) return lower;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * Stripe-style signature check: HMAC-SHA256 over "<timestamp>.<raw body>".
 * Returns { ok: true } or { ok: false, reason } — never throws.
 * A missing/blank secret is reported as 'webhook_secret_missing'; callers must answer 503
 * rather than accepting an unsigned payload.
 */
export function verifySignature(rawBody, headers, secret) {
  if (typeof secret !== 'string' || secret.trim() === '') {
    return { ok: false, reason: 'webhook_secret_missing' };
  }

  const header = headerValue(headers, SIGNATURE_HEADER);
  if (!header) return { ok: false, reason: 'signature_missing' };

  const pairs = String(header)
    .split(',')
    .map((part) => part.trim().split('=', 2))
    .filter((pair) => pair.length === 2);
  const timestamp = pairs.find(([key]) => key === 't')?.[1];
  const signatures = pairs.filter(([key]) => key === 'v1').map(([, value]) => value);

  if (!timestamp || signatures.length === 0) return { ok: false, reason: 'malformed_signature_header' };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'malformed_signature_header' };
  if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody ?? '').toString('utf8');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const matched = signatures.some((hex) => {
    let candidate;
    try {
      candidate = Buffer.from(hex, 'hex');
    } catch {
      return false;
    }
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  });

  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

function eventStatus(event) {
  const type = event?.type ?? '';
  const object = event?.data?.object ?? {};
  if (type === 'customer.subscription.deleted') return 'canceled';
  if (type === 'invoice.payment_failed') return 'past_due';
  if (typeof object.status === 'string' && object.status) return object.status;
  return null;
}

function customerIdFrom(event) {
  const object = event?.data?.object ?? {};
  const customer = object.customer;
  if (typeof customer === 'string' && customer) return customer;
  if (customer && typeof customer === 'object' && typeof customer.id === 'string') return customer.id;
  return null;
}

/**
 * Persist one raw webhook event, ask PayKit to apply it, then (for subscription-relevant types)
 * notify the mapped user.
 *
 * @param {{ rawBody: string, headers: object, secret?: string, apply?: Function }} input
 *   `apply` is the PayKit forwarding seam from ./paykit-apply.mjs; tests pass a stub to walk the
 *   failure and retry branches without touching PayKit.
 * @returns {Promise<{ ok: boolean, outcome: 'processed'|'retried'|'already_seen'|'ignored_type'|
 *   'apply_failed'|'bad_signature'|'webhook_secret_missing'|'invalid_payload'|'persist_failed',
 *   httpStatus: number, eventId: string|null, applied: boolean|null, notified: boolean,
 *   error?: string|null }>}
 */
export async function ingestEvent({ rawBody, headers, secret, apply = applyWithPayKit } = {}) {
  const secretFromEnv = secret === undefined;
  const effectiveSecret = secretFromEnv ? (process.env.STRIPE_WEBHOOK_SECRET ?? '') : String(secret ?? '');
  const verification = verifySignature(rawBody, headers, effectiveSecret);
  if (!verification.ok) {
    // A secret that is present but still a placeholder (an environment variable shadowing .env is
    // the usual cause) would reject every genuine event as a bad signature. That is a deployment
    // fault, not a bad payload: answer 503, which is both visible to ops and retried by Stripe.
    const unusable = secretFromEnv
      && verification.reason === 'signature_mismatch'
      && resolveStripeConfig().webhook.reason !== 'ok';
    if (verification.reason === 'webhook_secret_missing') {
      return { ok: false, outcome: 'webhook_secret_missing', httpStatus: 503, eventId: null, applied: null, notified: false, error: verification.reason };
    }
    if (unusable) {
      return { ok: false, outcome: 'webhook_secret_unusable', httpStatus: 503, eventId: null, applied: null, notified: false, error: resolveStripeConfig().webhook.reason };
    }
    return { ok: false, outcome: 'bad_signature', httpStatus: 400, eventId: null, applied: null, notified: false, error: verification.reason };
  }

  let event;
  try {
    event = JSON.parse(typeof rawBody === 'string' ? rawBody : String(rawBody ?? ''));
  } catch (error) {
    return { ok: false, outcome: 'invalid_payload', httpStatus: 400, eventId: null, applied: null, notified: false, error: 'invalid_json' };
  }

  const eventId = typeof event?.id === 'string' && event.id ? event.id : null;
  const type = typeof event?.type === 'string' && event.type ? event.type : 'unknown';
  if (!eventId) {
    return { ok: false, outcome: 'invalid_payload', httpStatus: 400, eventId: null, applied: null, notified: false, error: 'missing_event_id' };
  }

  let rowId;
  try {
    const { rows } = await getPool().query(
      `INSERT INTO app_webhook_event
         (id, stripe_event_id, type, payload, status, error, received_at, processed_at)
       VALUES ($1, $2, $3, $4::jsonb, 'received', NULL, now(), NULL)
       ON CONFLICT (stripe_event_id) DO NOTHING
       RETURNING id`,
      [`evt_app_${crypto.randomUUID()}`, eventId, type, JSON.stringify(event)],
    );
    rowId = rows[0]?.id ?? null;
  } catch (error) {
    return { ok: false, outcome: 'persist_failed', httpStatus: 500, eventId, applied: null, notified: false, error: error?.message ?? 'insert_failed' };
  }

  // Replay guard: the unique stripe_event_id means no row came back for a duplicate.
  if (!rowId) {
    return finishExistingEvent({ event, eventId, type, rawBody, headers, apply });
  }

  const applied = await applyToPayKit(apply, rawBody, headers);
  if (!applied.ok) {
    // Answer 500 so Stripe redelivers; the redelivery retries the apply instead of calling it a replay.
    await finish(rowId, 'apply_failed', describeApply(applied));
    return { ok: false, outcome: 'apply_failed', httpStatus: 500, eventId, applied: false, notified: false, error: describeApply(applied) };
  }

  if (!SUBSCRIPTION_EVENTS.has(type)) {
    await finish(rowId, 'ignored', null);
    return { ok: true, outcome: 'ignored_type', httpStatus: 200, eventId, applied: true, notified: false, error: null };
  }

  const { notified, note } = await notifyOnce(event);
  await finish(rowId, notified ? 'notified' : 'notify_failed', note);
  return { ok: true, outcome: 'processed', httpStatus: 200, eventId, applied: true, notified, error: note };
}

/** Human-readable tail for the error column: outcome, detail and a bounded handler message. */
function describeApply(result) {
  const detail = result?.detail ? `:${result.detail}` : '';
  const message = result?.message ? ` ${result.message}` : '';
  return `${result?.outcome ?? 'apply_failed'}${detail}${message}`.trim();
}

/**
 * Call the PayKit forwarding seam and never let it throw into the route: a thrown applier is
 * reported as a failed apply so the event stays retryable.
 */
async function applyToPayKit(applyFn, rawBody, headers) {
  try {
    const result = await applyFn({ rawBody, headers });
    if (result && typeof result.ok === 'boolean') return result;
    return { ok: false, outcome: 'apply_failed', detail: 'invalid_applier_result' };
  } catch (error) {
    return { ok: false, outcome: 'apply_failed', detail: 'applier_error', message: String(error?.message ?? '').slice(0, 300) };
  }
}

/**
 * A duplicate event id is not automatically "nothing to do": if the earlier delivery stopped before
 * PayKit applied it (process crash) or PayKit rejected it, Stripe's redelivery is the retry that
 * still writes the subscription row. Only an event whose notification step already completed — or
 * whose type we never notify about — is answered as a plain replay.
 */
async function finishExistingEvent({ event, eventId, type, rawBody, headers, apply }) {
  let previous = null;
  try {
    const { rows } = await getPool().query(
      'SELECT status FROM app_webhook_event WHERE stripe_event_id = $1',
      [eventId],
    );
    previous = rows[0] ?? null;
  } catch {
    /* an unreadable row must not turn a duplicate into an apply: fall through to already_seen */
  }

  const settled = previous?.status === 'notified' || previous?.status === 'ignored';
  if (!previous || settled) {
    return { ok: true, outcome: 'already_seen', httpStatus: 200, eventId, applied: null, notified: false, error: null };
  }

  const applied = await applyToPayKit(apply, rawBody, headers);
  if (!applied.ok) {
    await markStatus(eventId, 'apply_failed', describeApply(applied));
    return { ok: false, outcome: 'apply_failed', httpStatus: 500, eventId, applied: false, notified: false, error: describeApply(applied) };
  }

  if (!SUBSCRIPTION_EVENTS.has(type)) {
    await markStatus(eventId, 'ignored', null);
    return { ok: true, outcome: 'retried', httpStatus: 200, eventId, applied: true, notified: false, error: null };
  }

  const { notified, note } = await notifyOnce(event);
  await markStatus(eventId, notified ? 'notified' : 'notify_failed', note);
  return { ok: true, outcome: 'retried', httpStatus: 200, eventId, applied: true, notified, error: note };
}

/** One notification attempt for a status-changing event; returns the note to store on failure. */
async function notifyOnce(event) {
  let notified = false;
  let note = null;
  try {
    notified = await notifyStatusChange(event);
    note = notified ? null : 'no_status_template_applied';
  } catch (error) {
    note = error?.message ?? 'notify_failed';
  }
  return { notified, note };
}

async function markStatus(eventId, status, error) {
  try {
    await getPool().query(
      'UPDATE app_webhook_event SET status = $2, error = $3, processed_at = now() WHERE stripe_event_id = $1',
      [eventId, status, error],
    );
  } catch {
    /* the event is already persisted; a bookkeeping failure must not fail the caller */
  }
}

async function finish(rowId, status, error) {
  try {
    await getPool().query(
      'UPDATE app_webhook_event SET status = $2, error = $3, processed_at = now() WHERE id = $1',
      [rowId, status, error],
    );
  } catch {
    /* the event is already persisted; a bookkeeping failure must not fail the caller */
  }
}

/** Send at most one status email for a subscription event. Returns true when a message was written. */
async function notifyStatusChange(event) {
  const customerId = customerIdFrom(event);
  if (!customerId) return false;

  // Identity resolution (user row + email) is owned by subscriptions.mjs, which reads whatever
  // shape the deployed Stack Auth table has; this module must not re-hardcode those columns.
  //
  // Two mapping shapes exist in the wild and both must resolve:
  //   - app_billing_owner.paykit_customer_id holds PayKit's internal customer id, which is what the
  //     live database stores; the event only carries the provider (Stripe) customer id, so the id
  //     has to be translated through paykit_customer.stripe_customer_id;
  //   - older rows (and the offline fixture) store the provider id directly.
  const { rows } = await getPool().query(
    `SELECT o.user_id
       FROM app_billing_owner o
       JOIN paykit_customer c ON c.id = o.paykit_customer_id
      WHERE c.stripe_customer_id = $1
      UNION
     SELECT o.user_id
       FROM app_billing_owner o
      WHERE o.paykit_customer_id = $1
      LIMIT 1`,
    [customerId],
  );
  if (rows.length === 0) return false; // no mapped user: nothing to notify

  const user = await getUserContact(rows[0].user_id);
  if (!user.email) return false;

  const fromEvent = eventStatus(event);
  let status = STATUS_TEMPLATES[fromEvent] ? fromEvent : null;
  let periodEnd = null;
  let plan = null;

  const { rows: subRows } = await getPool().query(
    `SELECT s.status AS status, s.current_period_end_at AS current_period_end, s.product_internal_id AS product
       FROM paykit_subscription s
      WHERE s.customer_id = $1
      ORDER BY s.created_at DESC NULLS LAST
      LIMIT 1`,
    [customerId],
  );
  periodEnd = subRows[0]?.current_period_end ?? null;
  plan = subRows[0]?.product ?? null;

  // For events that do not carry a subscription status (checkout / invoice.paid), read the
  // authoritative status from our own database instead of inventing one.
  if (!status) {
    const dbStatus = subRows[0]?.status ?? null;
    status = STATUS_TEMPLATES[dbStatus] ? dbStatus : null;
    if (!status) return false;
  }

  const template = STATUS_TEMPLATES[status];
  const data = {
    name: user.display_name ?? undefined,
    plan: plan ?? undefined,
    periodEnd: periodEnd ?? null,
    currentPeriodEnd: periodEnd ?? null,
    status,
  };
  const message = render(template, data);

  const sent = await sendEmail({
    to: user.email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    template,
    data: { ...data, userId: user.user_id, customerId },
  });

  return sent.ok === true;
}