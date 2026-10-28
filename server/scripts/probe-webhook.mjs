#!/usr/bin/env node
/**
 * Self-contained acceptance probe for the app-side PayKit webhook intake.
 *
 * Builds its own express app (router mounted at /api/webhooks/paykit), signs fixture Stripe
 * events in-process, and checks the five behaviours W1-W5 against a PRIVATE copy of the scratch
 * database (default wh_test_whp3). It refuses to run against ouronex_paykit.
 *
 * It writes .eml/.html files only through the existing dry-run mailer, deletes the files it
 * produced, and leaves server/outbox absent if it did not exist before.
 *
 * Usage: node server/scripts/probe-webhook.mjs   (from the repository root)
 * Prints one PASS/FAIL line per check and exits non-zero on any failure.
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { readdir, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

const DB = process.env.PROBE_DB || 'wh_test_whp3';
const SECRET = 'whsec_probeSecretW1abcdefghijklmnop';
const MOUNT = '/api/webhooks/paykit';

if (DB === 'ouronex_paykit') {
  console.error('refusing to run: PROBE_DB must be a private copy, never ouronex_paykit');
  process.exit(2);
}

// Environment first, imports after: PayKit reads its database connection and Stripe credentials at
// module load, so the module graph below is imported dynamically once these are in place.
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '55432';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = DB;
// The apply step needs a connection string: PayKit only builds an instance when DATABASE_URL is set.
process.env.DATABASE_URL = `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${DB}`;
// Syntactically valid but fake: PayKit builds its provider at load time and this path never dials Stripe.
process.env.STRIPE_SECRET_KEY = 'sk_test_probe_dummy_key';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.MAIL_DRIVER = 'dry-run';
// Production semantics: PayKit's dev-only "pending migrations" assertion counts rows in
// public.paykit_migrations, and this hand-migrated fixture copy has no journal table. The deployed
// database has that journal, so production is the honest mode for the apply step here.
process.env.NODE_ENV = 'production';

const { webhooksRouter } = await import('../src/routes/webhooks.mjs');
const { getPool, closePool } = await import('../src/lib/subscriptions.mjs');
const { applyWithPayKit } = await import('../src/lib/paykit-apply.mjs');
const { OUTBOX_DIR } = await import('../src/lib/mailer.mjs');
const { ingestEvent } = await import('../src/lib/webhook-ingest.mjs');

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}

function sign(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

function fixture(id, type, object) {
  return JSON.stringify({ id, object: 'event', api_version: '2025-01-01', type, data: { object } });
}

async function eventRows(eventId) {
  const { rows } = await getPool().query(
    'SELECT count(*)::int AS n FROM app_webhook_event WHERE stripe_event_id = $1', [eventId]);
  return rows[0].n;
}

async function rowState(eventId) {
  const { rows } = await getPool().query(
    'SELECT status, error, processed_at IS NOT NULL AS processed FROM app_webhook_event WHERE stripe_event_id = $1',
    [eventId]);
  return rows[0] ?? null;
}

async function outboxEmls() {
  try {
    const entries = await readdir(OUTBOX_DIR);
    return entries.filter((name) => name.endsWith('.eml')).map((name) => path.join(OUTBOX_DIR, name));
  } catch {
    return [];
  }
}

async function newEmls(before) {
  return (await outboxEmls()).filter((file) => !before.has(file));
}

/** A subscription event whose ids match the fixture rows PayKit resolves provider ids against. */
function subscriptionEvent(id, status, periodEnd = 1900000000) {
  return fixture(id, 'customer.subscription.updated', {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status,
    current_period_start: 1800000000,
    current_period_end: periodEnd,
    cancel_at_period_end: false,
    // PayKit reads the price from items.data[0] and its period bounds from the same item; a missing
    // item or a missing period on it makes its normalizer produce an Invalid Date.
    items: {
      object: 'list',
      data: [{
        id: 'si_probe',
        price: { id: 'price_probe', product: 'pro' },
        current_period_start: 1800000000,
        current_period_end: periodEnd,
      }],
    },
  });
}

async function paykitEventRows(eventId) {
  const { rows } = await getPool().query(
    'SELECT count(*)::int AS n, min(status) AS status FROM paykit_webhook_event WHERE stripe_event_id = $1',
    [eventId]);
  return rows[0] ?? { n: 0, status: null };
}

async function subscriptionState() {
  const { rows } = await getPool().query(
    "SELECT status, current_period_end_at, stripe_subscription_id FROM paykit_subscription WHERE id = 'sub_1'");
  return rows[0] ?? null;
}

async function main() {
  const outboxExisted = (await readdir(path.dirname(OUTBOX_DIR)).catch(() => []))
    .includes(path.basename(OUTBOX_DIR));
  const emlsBefore = new Set(await outboxEmls());

  // --- database guard: private copy only
  const { rows: dbRows } = await getPool().query('SELECT current_database() AS db');
  if (dbRows[0].db !== DB) {
    console.error(`refusing to run against database ${dbRows[0].db}`);
    process.exit(2);
  }
  await getPool().query("DELETE FROM app_webhook_event WHERE stripe_event_id LIKE 'evt_probe_%'");
  await getPool().query("DELETE FROM paykit_webhook_event WHERE stripe_event_id LIKE 'evt_probe_%'");

  // --- fixture state the apply step needs: PayKit maps provider ids onto its own columns, and the
  // hand-migrated fixture copy has them empty.
  await getPool().query("UPDATE paykit_customer SET stripe_customer_id = 'cus_1' WHERE id = 'cus_1'");
  await getPool().query("UPDATE paykit_subscription SET stripe_subscription_id = 'sub_1', status = 'active', current_period_end_at = NULL WHERE id = 'sub_1'");

  const { rows: paykitBeforeRows } = await getPool().query('SELECT count(*)::int AS n FROM paykit_webhook_event');
  const paykitBefore = paykitBeforeRows[0].n;

  // --- own express app + router under test
  const app = express();
  app.use(MOUNT, webhooksRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const port = server.address().port;
  const post = (body, headers) => new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: MOUNT,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch { /* non-JSON body */ }
        resolve({ status: response.statusCode, json });
      });
    });
    request.on('error', reject);
    request.end(body);
  });

  try {
    // W1 - valid signature, subscription.updated -> processed + 1 row + 1 email
    const w1 = subscriptionEvent('evt_probe_w1', 'active', null);
    const r1 = await post(w1, { 'stripe-signature': sign(w1, SECRET) });
    const afterW1 = await newEmls(emlsBefore);
    const emlBody = afterW1.length > 0 ? await readFile(afterW1[0], 'utf8') : '';
    check('W1 valid signature, subscription.updated -> 200 processed, 1 row, 1 email',
      r1.status === 200 && r1.json.outcome === 'processed' && r1.json.eventId === 'evt_probe_w1'
        && (await eventRows('evt_probe_w1')) === 1 && afterW1.length === 1
        && emlBody.includes('X-OuroNex-Template: subscription-active'),
      `status=${r1.status} outcome=${r1.json.outcome} rows=${await eventRows('evt_probe_w1')} newEmls=${afterW1.length}`);

    // W2 - byte-identical replay -> already_seen, still 1 row, no new email
    const r2 = await post(w1, { 'stripe-signature': sign(w1, SECRET) });
    check('W2 replay -> 200 already_seen, still 1 row, no new email',
      r2.status === 200 && r2.json.outcome === 'already_seen'
        && (await eventRows('evt_probe_w1')) === 1 && (await outboxEmls()).filter((f) => !emlsBefore.has(f)).length === 1,
      `status=${r2.status} outcome=${r2.json.outcome} rows=${await eventRows('evt_probe_w1')} newEmls=${(await outboxEmls()).filter((f) => !emlsBefore.has(f)).length}`);

    // W3 - tampered body, signature from the original body -> bad_signature, no row, no email
    const tampered = fixture('evt_probe_w3', 'customer.subscription.updated',
      { id: 'sub_1', customer: 'cus_1', status: 'past_due', current_period_end: null });
    const r3 = await post(tampered, { 'stripe-signature': sign(w1, SECRET) });
    check('W3 tampered body -> 400 bad_signature, 0 rows, no email',
      r3.status === 400 && r3.json.outcome === 'bad_signature'
        && (await eventRows('evt_probe_w3')) === 0
        && (await outboxEmls()).filter((f) => !emlsBefore.has(f)).length === 1,
      `status=${r3.status} outcome=${r3.json.outcome} rows=${await eventRows('evt_probe_w3')}`);

    // W4 - secret unset -> 503, no row, no email
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const w4 = fixture('evt_probe_w4', 'customer.subscription.updated', { id: 'sub_1', customer: 'cus_1', status: 'active' });
    const r4 = await post(w4, { 'stripe-signature': sign(w4, SECRET) });
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    check('W4 secret unset -> 503 webhook_secret_missing, 0 rows, no email',
      r4.status === 503 && r4.json.outcome === 'webhook_secret_missing'
        && (await eventRows('evt_probe_w4')) === 0
        && (await outboxEmls()).filter((f) => !emlsBefore.has(f)).length === 1,
      `status=${r4.status} outcome=${r4.json.outcome} rows=${await eventRows('evt_probe_w4')}`);

    // W5 - unrelated type -> ignored_type, 1 row, no email
    const w5 = fixture('evt_probe_w5', 'payment_method.detached', { id: 'pm_1', customer: 'cus_1' });
    const r5 = await post(w5, { 'stripe-signature': sign(w5, SECRET) });
    const w5State = await rowState('evt_probe_w5');
    check('W5 unrelated type -> 200 ignored_type, 1 row, no email',
      r5.status === 200 && r5.json.outcome === 'ignored_type' && (await eventRows('evt_probe_w5')) === 1
        && w5State?.status === 'ignored' && w5State?.processed === true
        && (await outboxEmls()).filter((f) => !emlsBefore.has(f)).length === 1,
      `status=${r5.status} outcome=${r5.json.outcome} rows=${await eventRows('evt_probe_w5')} rowStatus=${w5State?.status}`);

    // ---------------------------------------------------------------------------------------
    // A* - the apply step. Every paykit_* write below must come from PayKit's own handler.
    // ---------------------------------------------------------------------------------------

    // A1 - PayKit applies the event: paykit_subscription is the source of truth and must move.
    const a1 = subscriptionEvent('evt_probe_a1', 'past_due');
    const beforeA1 = new Set(await outboxEmls());
    const rA1 = await post(a1, { 'stripe-signature': sign(a1, SECRET) });
    const subA1 = await subscriptionState();
    const pkA1 = await paykitEventRows('evt_probe_a1');
    const emlA1 = await newEmls(beforeA1);
    check('A1 PayKit applies the event -> paykit_subscription past_due + paykit_webhook_event processed + 1 email',
      rA1.status === 200 && rA1.json.outcome === 'processed'
        && pkA1.n === 1 && pkA1.status === 'processed'
        && subA1?.status === 'past_due' && subA1?.current_period_end_at != null
        && emlA1.length === 1,
      `status=${rA1.status} paykitRows=${pkA1.n}/${pkA1.status} subStatus=${subA1?.status} periodEnd=${subA1?.current_period_end_at ? 'set' : 'null'} newEmls=${emlA1.length}`);

    // A2 - replay of an applied event: PayKit's own claim makes it a no-op, no second email.
    const beforeA2 = new Set(await outboxEmls());
    const rA2 = await post(a1, { 'stripe-signature': sign(a1, SECRET) });
    const pkA2 = await paykitEventRows('evt_probe_a1');
    const subA2 = await subscriptionState();
    check('A2 replay -> 200 already_seen, 1 paykit row, subscription unchanged, no new email',
      rA2.status === 200 && rA2.json.outcome === 'already_seen'
        && pkA2.n === 1 && subA2?.status === 'past_due' && (await newEmls(beforeA2)).length === 0,
      `status=${rA2.status} outcome=${rA2.json.outcome} paykitRows=${pkA2.n} subStatus=${subA2?.status}`);

    // A3 - PayKit rejects the event -> 500 so Stripe retries, our row says apply_failed, and no
    // status email goes out (the email reads the subscription row, which did not move).
    const a3 = subscriptionEvent('evt_probe_a3', 'canceled');
    const beforeA3 = new Set(await outboxEmls());
    const failingApply = async () => ({ ok: false, outcome: 'apply_failed', detail: 'http_500', message: 'stub rejection' });
    const failedApply = await ingestEvent({ rawBody: a3, headers: { 'stripe-signature': sign(a3, SECRET) }, secret: SECRET, apply: failingApply });
    const stateA3 = await rowState('evt_probe_a3');
    const pkA3 = await paykitEventRows('evt_probe_a3');
    check('A3 failed apply -> 500 apply_failed, row apply_failed, no paykit row, no email',
      failedApply.httpStatus === 500 && failedApply.outcome === 'apply_failed'
        && stateA3?.status === 'apply_failed' && stateA3?.processed === true
        && pkA3.n === 0 && (await newEmls(beforeA3)).length === 0
        && (await subscriptionState())?.status === 'past_due',
      `http=${failedApply.httpStatus} rowStatus=${stateA3?.status} paykitRows=${pkA3.n} newEmls=${(await newEmls(beforeA3)).length}`);

    // A4 - the redelivery Stripe sends for that same event id retries the apply instead of being
    // dismissed as a replay, and only then sends the status email.
    const beforeA4 = new Set(await outboxEmls());
    const rA4 = await post(a3, { 'stripe-signature': sign(a3, SECRET) });
    const stateA4 = await rowState('evt_probe_a3');
    const pkA4 = await paykitEventRows('evt_probe_a3');
    const subA4 = await subscriptionState();
    const emlA4 = await newEmls(beforeA4);
    check('A4 redelivery retries the apply -> 200 retried, notified, subscription canceled, 1 email',
      rA4.status === 200 && rA4.json.outcome === 'retried'
        && stateA4?.status === 'notified' && pkA4.n === 1 && pkA4.status === 'processed'
        && subA4?.status === 'canceled' && emlA4.length === 1,
      `status=${rA4.status} outcome=${rA4.json.outcome} rowStatus=${stateA4?.status} paykit=${pkA4.n}/${pkA4.status} subStatus=${subA4?.status} newEmls=${emlA4.length}`);

    // A5 - an applier that throws must not take the route down: same retryable answer.
    const a5 = subscriptionEvent('evt_probe_a5', 'active');
    const throwingApply = async () => { throw new Error('stub explosion'); };
    const threw = await ingestEvent({ rawBody: a5, headers: { 'stripe-signature': sign(a5, SECRET) }, secret: SECRET, apply: throwingApply });
    const stateA5 = await rowState('evt_probe_a5');
    check('A5 throwing applier -> 500 apply_failed with the error recorded, no crash',
      threw.httpStatus === 500 && threw.outcome === 'apply_failed'
        && stateA5?.status === 'apply_failed' && (stateA5?.error ?? '').includes('applier_error'),
      `http=${threw.httpStatus} rowStatus=${stateA5?.status} error=${(stateA5?.error ?? '').slice(0, 40)}`);

    // A6 - no PayKit instance (billing not configured) is reported, not guessed.
    const notConfigured = await applyWithPayKit({ rawBody: subscriptionEvent('evt_probe_a6', 'active'), headers: {}, instance: null });
    check('A6 missing PayKit instance -> paykit_not_configured, no throw',
      notConfigured.ok === false && notConfigured.outcome === 'paykit_not_configured',
      `outcome=${notConfigured.outcome} detail=${notConfigured.detail}`);

    // A7 - the mapping shape the live database uses: app_billing_owner points at PayKit's internal
    // customer id while the event only carries the provider (Stripe) customer id. Without the
    // translation through paykit_customer.stripe_customer_id no status email ever goes out.
    await getPool().query("UPDATE paykit_customer SET stripe_customer_id = 'cus_probe_stripe_1' WHERE id = 'cus_1'");
    const a7 = subscriptionEvent('evt_probe_a7', 'active');
    const beforeA7 = new Set(await outboxEmls());
    const rA7 = await ingestEvent({ rawBody: a7, headers: { 'stripe-signature': sign(a7, SECRET) }, secret: SECRET });
    const stateA7 = await rowState('evt_probe_a7');
    check('A7 provider customer id resolves through paykit_customer.stripe_customer_id -> email sent',
      rA7.outcome === 'processed' && rA7.notified === true
        && stateA7?.status === 'notified' && (await newEmls(beforeA7)).length === 1,
      `outcome=${rA7.outcome} notified=${rA7.notified} rowStatus=${stateA7?.status} newEmls=${(await newEmls(beforeA7)).length}`);
    await getPool().query("UPDATE paykit_customer SET stripe_customer_id = 'cus_1' WHERE id = 'cus_1'");


    // A8 - a placeholder secret in the environment (the usual shape of a stale exported variable
    // shadowing .env) must be reported as a deployment fault, not answered as a bad signature:
    // Stripe retries a 503 and ops can see it, while a 400 would look like a malformed payload.
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_replace_me_placeholder';
    const a8 = subscriptionEvent('evt_probe_a8', 'active');
    const rA8 = await post(a8, { 'stripe-signature': sign(a8, SECRET) });
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    check('A8 placeholder webhook secret -> 503 webhook_secret_unusable, no row',
      rA8.status === 503 && rA8.json.outcome === 'webhook_secret_unusable'
        && (await eventRows('evt_probe_a8')) === 0,
      `status=${rA8.status} outcome=${rA8.json.outcome} rows=${await eventRows('evt_probe_a8')}`);


    // W7 - a real Stripe event can be larger than express.raw()'s 100kb default (invoice.paid with
    // many lines). 300kb must be accepted; anything past the route's own 2mb ceiling must come back
    // as JSON 413 (Stripe retries any non-2xx, so a silent HTML error page is not acceptable).
    const big = JSON.stringify({
      id: 'evt_probe_big_ok', object: 'event', api_version: '2025-01-01',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', blob: 'x'.repeat(300 * 1024),
        items: { object: 'list', data: [{ id: 'si_probe', price: { id: 'price_probe', product: 'pro' },
          current_period_start: 1800000000, current_period_end: 1900000000 }] },
        current_period_start: 1800000000, current_period_end: 1900000000, cancel_at_period_end: false } },
    });
    const r7 = await post(big, { 'stripe-signature': sign(big, SECRET) });
    const huge = JSON.stringify({
      id: 'evt_probe_big_huge', object: 'event', api_version: '2025-01-01',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', blob: 'x'.repeat(2560 * 1024) } },
    });
    const r8 = await post(huge, { 'stripe-signature': sign(huge, SECRET) });
    check('W7 300kb signed event accepted, 2.5mb rejected as JSON payload_too_large',
      r7.status === 200 && r7.json.outcome === 'processed'
        && r8.status === 413 && r8.json.outcome === 'payload_too_large',
      `300kb=${r7.status}/${r7.json.outcome} 2.5mb=${r8.status}/${r8.json.outcome}`);

    // W6 - our intake itself must never write PayKit's table: every paykit_webhook_event row that
    // exists belongs to an event PayKit accepted, and the events that never reached PayKit (rejected
    // signature, missing secret, oversized body, failed apply) left no row behind.
    const { rows: paykitIdRows } = await getPool().query(
      "SELECT stripe_event_id FROM paykit_webhook_event WHERE stripe_event_id LIKE 'evt_probe_%' ORDER BY stripe_event_id");
    const appliedIds = paykitIdRows.map((row) => row.stripe_event_id);
    const forwarded = ['evt_probe_a1', 'evt_probe_a3', 'evt_probe_a7', 'evt_probe_big_ok', 'evt_probe_w1', 'evt_probe_w5'];
    const neverForwarded = ['evt_probe_a5', 'evt_probe_big_huge', 'evt_probe_w3', 'evt_probe_w4'];
    check('W6 paykit_webhook_event holds only events PayKit accepted (no direct writes by our intake)',
      appliedIds.every((id) => forwarded.includes(id))
        && neverForwarded.every((id) => !appliedIds.includes(id))
        && appliedIds.includes('evt_probe_a1') && appliedIds.includes('evt_probe_a3'),
      `rows=${JSON.stringify(appliedIds)} before=${paykitBefore}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));

    // --- clean up everything this probe produced
    for (const file of await outboxEmls()) {
      if (!emlsBefore.has(file)) {
        await rm(file, { force: true });
        await rm(file.replace(/\.eml$/, '.html'), { force: true });
      }
    }
    if (!outboxExisted) await rm(OUTBOX_DIR, { recursive: true, force: true });
    await getPool().query("DELETE FROM app_webhook_event WHERE stripe_event_id LIKE 'evt_probe_%'");
    // PayKit's own rows and the fixture columns this probe adjusted are restored too, so a re-run
    // starts from the same state (a leftover claim would make PayKit skip the event as a duplicate).
    await getPool().query("DELETE FROM paykit_webhook_event WHERE stripe_event_id LIKE 'evt_probe_%'");
    await getPool().query("UPDATE paykit_customer SET stripe_customer_id = NULL WHERE id = 'cus_1'");
    await getPool().query("UPDATE paykit_subscription SET stripe_subscription_id = NULL, status = 'active', current_period_end_at = NULL WHERE id = 'sub_1'");
    await closePool();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(failed === 0
    ? `probe-webhook: ${results.length}/${results.length} checks passed`
    : `probe-webhook: ${results.length - failed}/${results.length} checks passed (${failed} failed)`);
  process.exitCode = failed === 0 ? 0 : 1;
}

async function ensureDatabaseExists() {
  try {
    await getPool().query('SELECT 1');
  } catch (error) {
    console.error(`cannot reach database ${DB} on ${process.env.PGHOST}:${process.env.PGPORT}: ${error.message}`);
    console.error('create a private copy first, e.g.: createdb -h 127.0.0.1 -p 55432 -U postgres -T ouronex_paykit ' + DB);
    process.exit(2);
  }
}

await ensureDatabaseExists();
await mkdir(path.dirname(OUTBOX_DIR), { recursive: true });
await main();