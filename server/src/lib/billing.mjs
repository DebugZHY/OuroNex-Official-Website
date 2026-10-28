/**
 * Billing operations: Stripe configuration, the user -> PayKit customer mapping, and the two
 * session creators the pricing page and dashboard call.
 *
 * Ownership: PayKit 0.2.0 owns every Stripe interaction and every write to paykit_* tables. This
 * module only decides *who* is asking and *which* plan, then delegates. It writes exactly one row
 * of its own: the app_billing_owner mapping, which is what lets a subscription be read back for a
 * user after a restore.
 *
 * Configuration is validated, not merely read: a secret key that is missing or still a placeholder
 * makes billing report itself unconfigured. Silently sending a placeholder key to Stripe turns a
 * configuration mistake into a 401 at the worst possible moment.
 */
import { getPlan } from './plans.mjs';
import { getPayKit, PAYKIT_BASE_PATH } from './paykit.js';
import { getPool, getUserContact } from './subscriptions.mjs';

export { PAYKIT_BASE_PATH };

const PLACEHOLDER = /(placeholder|replace[_-]?me|your[_-]?\w*key|changeme|dummy|xxxx)/i;
const SECRET_KEY_SHAPE = /^sk_(test|live)_[A-Za-z0-9]{16,}$/;
const WEBHOOK_SECRET_SHAPE = /^whsec_[A-Za-z0-9+/=]{20,}$/;

function classify(value, shape) {
  const key = String(value ?? '').trim();
  if (!key) return { ok: false, reason: 'missing' };
  if (PLACEHOLDER.test(key)) return { ok: false, reason: 'placeholder' };
  if (!shape.test(key)) return { ok: false, reason: 'malformed' };
  return { ok: true, reason: 'ok' };
}

/**
 * Stripe configuration for billing calls.
 *
 * @returns {{ configured: boolean, reason: string, mode: 'test'|'live'|null,
 *   secret: { ok: boolean, reason: string }, webhook: { ok: boolean, reason: string } }}
 */
export function resolveStripeConfig(source = process.env) {
  const secret = classify(source.STRIPE_SECRET_KEY, SECRET_KEY_SHAPE);
  const webhook = classify(source.STRIPE_WEBHOOK_SECRET, WEBHOOK_SECRET_SHAPE);
  const mode = secret.ok ? (String(source.STRIPE_SECRET_KEY).trim().startsWith('sk_live_') ? 'live' : 'test') : null;
  return {
    configured: secret.ok,
    reason: secret.ok ? 'ok' : `stripe_secret_${secret.reason}`,
    mode,
    secret,
    webhook,
  };
}

/**
 * PayKit customer id for one Stack Auth user.
 *
 * The mapping row is the only durable link between the two systems, so it is created once and
 * never rewritten: an existing row wins even if the contact details changed after it was written.
 * Concurrent first checkouts are handled by the unique constraints on both columns.
 */
export async function ensurePayKitCustomer(userId) {
  const existing = await getPool().query(
    'SELECT paykit_customer_id FROM app_billing_owner WHERE user_id = $1',
    [userId],
  );
  if (existing.rows.length > 0) return existing.rows[0].paykit_customer_id;

  const contact = await getUserContact(userId);
  const customer = await getPayKit().upsertCustomer({
    id: userId,
    email: contact.email ?? undefined,
    name: contact.displayName ?? undefined,
    upsertProviderCustomer: true,
  });

  await getPool().query(
    'INSERT INTO app_billing_owner (user_id, paykit_customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, customer.id],
  );

  const again = await getPool().query(
    'SELECT paykit_customer_id FROM app_billing_owner WHERE user_id = $1',
    [userId],
  );
  return again.rows[0]?.paykit_customer_id ?? customer.id;
}

/**
 * Create a Stripe Checkout session for a paid plan.
 *
 * @returns {Promise<{ok: true, url: string, planId: string, customerId: string}
 *   | {ok: false, reason: string, detail?: string}>}
 */
export async function createCheckoutSession({ userId, planId, successUrl, cancelUrl }) {
  const plan = getPlan(planId);
  if (!plan) return { ok: false, reason: 'unknown_plan' };
  if (!(plan.price > 0)) return { ok: false, reason: 'plan_not_purchasable' };

  const contact = await getUserContact(userId);
  if (!contact.email) return { ok: false, reason: 'missing_email' };

  const customerId = await ensurePayKitCustomer(userId);
  const result = await getPayKit().subscribe({ customerId, planId, successUrl, cancelUrl });
  const url = result?.paymentUrl ?? result?.invoice?.hostedUrl ?? null;
  if (!url) return { ok: false, reason: 'no_payment_url' };
  return { ok: true, url, planId, customerId };
}

/**
 * Create a Stripe customer-portal session, so a subscriber can change or cancel their plan without
 * a second billing UI. Returns {ok:false, reason} for an unknown user instead of creating a customer
 * as a side effect of looking at the portal.
 */
export async function createPortalSession({ userId, returnUrl }) {
  const { rows } = await getPool().query(
    'SELECT paykit_customer_id FROM app_billing_owner WHERE user_id = $1',
    [userId],
  );
  if (rows.length === 0) return { ok: false, reason: 'no_customer_mapping' };
  const result = await getPayKit().customerPortal({ customerId: rows[0].paykit_customer_id, returnUrl });
  if (!result?.url) return { ok: false, reason: 'no_portal_url' };
  return { ok: true, url: result.url };
}

export default { resolveStripeConfig, createCheckoutSession, createPortalSession, ensurePayKitCustomer };
