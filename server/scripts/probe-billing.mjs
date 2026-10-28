#!/usr/bin/env node
/**
 * Acceptance probe for the billing API (server/src/routes/billing.mjs).
 *
 * Offline by design: no database, no Stripe network. Every check walks an input-validation or
 * configuration branch that must be decided *before* a Stripe session is ever created, which is
 * exactly where a placeholder key would otherwise leak into a provider call.
 *
 * The identity used here is the development header on a fixed user id, so the checks do not depend
 * on the Stack Auth project being reachable.
 *
 * Usage: node server/scripts/probe-billing.mjs
 */
import express from 'express';

const DEV_USER = '00000000-0000-4000-8000-0000000000b1';
const PLACEHOLDER_SECRET = 'sk_test_placeholder_replace_me';

process.env.AUTH_DEV_MODE = 'on';
delete process.env.NODE_ENV;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const { billingRouter } = await import('../src/routes/billing.mjs');
const { resolveStripeConfig } = await import('../src/lib/billing.mjs');

const results = [];
function check(name, passed, detail = '') {
  results.push(passed);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
}

const app = express();
app.use(express.json());
app.use('/api/billing', billingRouter);

const server = await new Promise((resolve) => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function call(path, { body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  let json = {};
  try { json = await response.json(); } catch { /* non-JSON body */ }
  return { status: response.status, json, raw: JSON.stringify(json) };
}

const authed = { 'x-ouronex-dev-user': DEV_USER };

try {
  // B1 - no identity at all
  const b1 = await call('/api/billing/checkout', { body: { planId: 'basic' } });
  check('B1 checkout without identity -> 401', b1.status === 401 && b1.json.error === 'unauthenticated',
    `status=${b1.status} error=${b1.json.error}`);

  // B2 - identity but no plan
  const b2 = await call('/api/billing/checkout', { body: {}, headers: authed });
  check('B2 checkout without planId -> 400 missing_plan', b2.status === 400 && b2.json.error === 'missing_plan',
    `status=${b2.status} error=${b2.json.error}`);

  // B3 - identity, unknown plan
  const b3 = await call('/api/billing/checkout', { body: { planId: 'enterprise' }, headers: authed });
  check('B3 unknown plan -> 400 unknown_plan (not a Stripe call)', b3.status === 400 && b3.json.error === 'unknown_plan',
    `status=${b3.status} error=${b3.json.error}`);

  // B4 - the free plan is not purchasable through checkout
  const b4 = await call('/api/billing/checkout', { body: { planId: 'free' }, headers: authed });
  check('B4 free plan -> 400 plan_not_purchasable', b4.status === 400 && b4.json.error === 'plan_not_purchasable',
    `status=${b4.status} error=${b4.json.error}`);

  // B5 - a placeholder secret key must stop at the configuration gate, and must never be echoed
  process.env.STRIPE_SECRET_KEY = PLACEHOLDER_SECRET;
  const b5 = await call('/api/billing/checkout', { body: { planId: 'basic' }, headers: authed });
  const leaked = b5.raw.includes(PLACEHOLDER_SECRET) || b5.raw.includes('sk_test_');
  check('B5 placeholder Stripe key -> 503 billing_not_configured / stripe_secret_placeholder, no key echo',
    b5.status === 503 && b5.json.reason === 'stripe_secret_placeholder' && !leaked,
    `status=${b5.status} reason=${b5.json.reason} leaked=${leaked}`);

  // B6 - no secret key at all
  delete process.env.STRIPE_SECRET_KEY;
  const b6 = await call('/api/billing/checkout', { body: { planId: 'basic' }, headers: authed });
  check('B6 missing Stripe key -> 503 stripe_secret_missing',
    b6.status === 503 && b6.json.reason === 'stripe_secret_missing',
    `status=${b6.status} reason=${b6.json.reason}`);

  // B7 - portal without identity
  const b7 = await call('/api/billing/portal', {});
  check('B7 portal without identity -> 401', b7.status === 401 && b7.json.error === 'unauthenticated',
    `status=${b7.status} error=${b7.json.error}`);

  // B8 - portal with identity but unconfigured Stripe
  const b8 = await call('/api/billing/portal', { headers: authed });
  check('B8 portal with placeholder/missing key -> 503 billing_not_configured',
    b8.status === 503 && b8.json.error === 'billing_not_configured',
    `status=${b8.status} error=${b8.json.error}`);

  // B9 - configuration classifier itself
  const live = resolveStripeConfig({ STRIPE_SECRET_KEY: 'sk_live_' + 'a'.repeat(24), STRIPE_WEBHOOK_SECRET: 'whsec_' + 'b'.repeat(28) });
  const test = resolveStripeConfig({ STRIPE_SECRET_KEY: 'sk_test_' + 'c'.repeat(24), STRIPE_WEBHOOK_SECRET: 'whsec_' + 'd'.repeat(28) });
  const bogus = resolveStripeConfig({ STRIPE_SECRET_KEY: 'sk_test_your_key_here' });
  check('B9 classifier: live/test accepted, placeholder rejected',
    live.configured && live.mode === 'live' && test.configured && test.mode === 'test'
      && bogus.configured === false && bogus.reason === 'stripe_secret_placeholder',
    `live=${live.mode} test=${test.mode} bogus=${bogus.reason}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0
  ? `probe-billing: ${results.length}/${results.length} checks passed`
  : `probe-billing: ${results.length - failed}/${results.length} checks passed (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
