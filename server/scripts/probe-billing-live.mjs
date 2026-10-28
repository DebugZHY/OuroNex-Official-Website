#!/usr/bin/env node
/**
 * Read-only readiness probe for a deployable billing stack.
 *
 * Three questions the offline gate cannot answer, because each of them is about the *deployment*,
 * not about the code:
 *   1. does the Stripe configuration the process actually sees classify as usable? A placeholder key
 *      exported in a shell shadows .env (dotenv never overwrites), and the result used to look like
 *      "a bad signature" or "Invalid API Key" only at the moment a customer paid;
 *   2. has PayKit's own migration journal been applied to this database? A hand-migrated database
 *      without public.paykit_migrations makes PayKit refuse to apply webhooks in development;
 *   3. is there a webhook endpoint registered at Stripe at all? Without one, no event ever reaches
 *      this app and paykit_subscription — the subscription source of truth — never moves.
 *
 * It writes nothing: no product sync, no event, no payment. Everything it reads is reported as
 * PASS / FAIL / WARN / SKIP with the observed values, and it exits non-zero only on FAIL.
 *
 * Usage:  node scripts/probe-billing-live.mjs        (from server/)
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAYKIT_DIR = path.resolve(HERE, '..', 'node_modules', 'paykitjs', 'database', 'migrations');

const results = [];
function report(status, name, detail = '') {
  results.push({ status, name });
  console.log(`${status} ${name}${detail ? ' — ' + detail : ''}`);
}

const { resolveStripeConfig } = await import('../src/lib/billing.mjs');
const { getPool, closePool } = await import('../src/lib/subscriptions.mjs');

// --- 1. configuration as this probe's own process sees it. A FAIL here is only reported as a WARN:
// the authority is the running app (checked next), and this process's environment can legitimately
// differ from the app's (a shell that exported a placeholder shadows .env exactly as it would for
// an app started from that shell, which is why it is worth showing).
const config = resolveStripeConfig();
if (config.secret.ok && config.webhook.ok) {
  report('PASS', 'stripe configuration usable in this process', `mode=${config.mode} secret=ok webhook=ok`);
} else {
  report('WARN', 'stripe configuration shadowed in this process', `secret=${config.secret.reason} webhook=${config.webhook.reason} — an exported placeholder outranks .env`);
}

// The running app is a separate process with its own environment; when it is up, ask it directly.
const port = process.env.PORT || '3100';
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/billing/config`, { signal: AbortSignal.timeout(4000) });
  const body = await response.json();
  const ok = body.configured === true && body.webhook === 'ok';
  report(ok ? 'PASS' : 'FAIL', 'running app /api/billing/config', `configured=${body.configured} secret=${body.secret} webhook=${body.webhook}`);
} catch (error) {
  report('SKIP', 'running app /api/billing/config', `not reachable on :${port} (${error?.name ?? 'error'})`);
}

// --- 2. PayKit migration journal on this database
try {
  const journal = JSON.parse(readFileSync(path.join(PAYKIT_DIR, 'meta', '_journal.json'), 'utf8'));
  const total = journal.entries.length;
  const { rows } = await getPool().query('SELECT count(*)::int AS n FROM public.paykit_migrations');
  const applied = rows[0]?.n ?? 0;
  if (applied >= total) {
    report('PASS', 'paykit migrations applied', `${applied}/${total}`);
  } else {
    report('FAIL', 'paykit migrations incomplete', `${applied}/${total} — run npx paykitjs push`);
  }
} catch (error) {
  report('FAIL', 'paykit migrations applied', `cannot read journal or table: ${error?.message ?? error}`);
}

// --- 3. webhook endpoint registered at Stripe. The key comes from the effective configuration when
// it is usable, otherwise straight from .env: this check is about the .env <-> Stripe relationship,
// not about which shell started the probe.
function envFileSecret() {
  try {
    const text = readFileSync(path.resolve(HERE, '..', '.env'), 'utf8');
    const line = text.split(/\r?\n/).find((entry) => entry.startsWith('STRIPE_SECRET_KEY='));
    return line ? line.slice('STRIPE_SECRET_KEY='.length).trim() : '';
  } catch {
    return '';
  }
}

const stripeKey = config.secret.ok ? String(process.env.STRIPE_SECRET_KEY ?? '').trim() : envFileSecret();
try {
  const response = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=10', {
    headers: { authorization: `Bearer ${stripeKey}` },
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok) {
    report('FAIL', 'stripe webhook endpoints', `http ${response.status}: ${body?.error?.message ?? 'request rejected'}`);
  } else {
    const urls = (body.data ?? []).map((entry) => `${entry.url}${entry.status === 'enabled' ? '' : `(${entry.status})`}`);
    if (urls.length === 0) {
      report('FAIL', 'stripe webhook endpoints', 'none registered — no event can reach /api/webhooks/paykit');
    } else {
      report('PASS', 'stripe webhook endpoints', `${urls.length}: ${urls.join(', ')}`);
    }
  }
} catch (error) {
  report('FAIL', 'stripe webhook endpoints', `request failed: ${error?.name ?? error}`);
}

await closePool();

const failed = results.filter((entry) => entry.status === 'FAIL').length;
console.log(failed === 0
  ? `probe-billing-live: ${results.length} checks, 0 failed`
  : `probe-billing-live: ${results.length} checks, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
