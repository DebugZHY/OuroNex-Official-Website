/**
 * The single PayKit instance for this app, and the product definitions that back it.
 *
 * Two consumers read this file:
 *   - the app (server/src/lib/billing.mjs) for checkout and customer-portal sessions;
 *   - the PayKit CLI, which discovers this path (`src/lib/paykit.js`) and diffs these products
 *     against paykit_product and Stripe on `npx paykitjs push`.
 *
 * Products are derived from PLANS so the pricing page and the billing provider cannot drift apart:
 * PLANS stores cents, PayKit stores whole currency units, and free is the default plan.
 *
 * Stripe credentials are read here and nowhere else; the instance is only created when a secret key
 * is present so that a deployment without billing configured still boots (and reports
 * `billing_not_configured` from the API instead of crashing at import).
 */
import { createPayKit, plan } from 'paykitjs';
import { listPlans } from './plans.mjs';

export const PAYKIT_BASE_PATH = '/paykit';

/** Cents in PLANS -> whole units for PayKit. A 0 price means the plan is unpriced, not free-of-charge-at-0. */
function toPayKitPlan(entry) {
  const config = {
    id: entry.id,
    name: entry.name,
    group: 'default',
  };
  if (entry.price > 0) config.price = { amount: entry.price / 100, interval: entry.interval };
  if (entry.default === true) config.default = true;
  return plan(config);
}

export const products = listPlans().map(toPayKitPlan);

const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

/** Named `paykit` because that is the export the PayKit CLI looks for. */
export const paykit = secretKey && process.env.DATABASE_URL
  ? createPayKit({
    database: process.env.DATABASE_URL,
    stripe: { secretKey, webhookSecret },
    products,
    basePath: PAYKIT_BASE_PATH,
  })
  : null;

export function getPayKit() {
  if (!paykit) {
    const error = new Error('billing_not_configured');
    error.code = 'billing_not_configured';
    throw error;
  }
  return paykit;
}

export default paykit;
