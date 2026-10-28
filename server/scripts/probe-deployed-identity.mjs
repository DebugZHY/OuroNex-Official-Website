#!/usr/bin/env node
/**
 * Deployment smoke probe: runs against whatever database DATABASE_URL / PG* points at, so it can be
 * pointed at a real self-hosted Stack Auth + PayKit deployment (unlike the other probes, which
 * assume the development fixture and its alice/bob rows).
 *
 * What it asserts, read-only:
 *   D1  the identity table is present and its id/email columns could be resolved
 *   D2  PayKit's schema is present through PayKit's own migration ledger (paykit_migrations)
 *   D3  every app_billing_owner row resolves to a real user row + contact (no orphans)
 *   D4  the status read model answers for each mapped user in a well-formed shape
 *   D5  nothing in our tables changed while probing (row counts before == after)
 *
 * Exit codes: 0 every check passed (SKIP counts as pass), 1 one check failed,
 * 3 no database reachable.
 *
 * Usage: node scripts/probe-deployed-identity.mjs [--json]
 */
import { getPool, closePool, getIdentityShape, getUserContact, getSubscriptionForUser } from '../src/lib/subscriptions.mjs';

const JSON_MODE = process.argv.includes('--json');
const results = [];
const record = (id, title, level, detail) => {
  results.push({ id, title, level, detail });
  if (!JSON_MODE) console.log(`${level.padEnd(4)} ${id} ${title} — ${detail}`);
};

async function main() {
  const counts = async () => {
    const { rows } = await getPool().query(`
      SELECT (SELECT count(*)::int FROM app_billing_owner) AS owners,
             (SELECT count(*)::int FROM app_webhook_event) AS webhook_events`);
    return rows[0];
  };
  const before = await counts();

  // D1 — identity shape
  let shape = null;
  try {
    shape = await getIdentityShape();
    record('D1', 'identity table shape', 'PASS', `ProjectUser id column "${shape.idColumn}", email from ${shape.emailSql === 'NULL' ? 'nowhere' : shape.emailSql.includes('ContactChannel') ? 'ContactChannel' : 'an inline column'}`);
  } catch (error) {
    record('D1', 'identity table shape', 'FAIL', error.message);
  }

  // D2 — PayKit schema via its own ledger
  let paykitOk = false;
  try {
    const { rows } = await getPool().query(`
      SELECT (SELECT count(*)::int FROM public.paykit_migrations) AS ledger,
             (SELECT count(*)::int FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name LIKE 'paykit\\_%') AS tables`);
    const { ledger, tables } = rows[0];
    paykitOk = tables >= 10;
    record('D2', 'PayKit schema', paykitOk ? 'PASS' : 'FAIL',
      `paykit_migrations rows=${ledger}, paykit_* tables=${tables} (expected >= 10 created by PayKit's own migrations)`);
  } catch (error) {
    record('D2', 'PayKit schema', 'FAIL', error.code === '42P01' ? 'paykit_migrations is missing: PayKit\'s migrations were never applied through their own runner' : error.message);
  }

  // D3 — owner rows must resolve
  const { rows: owners } = await getPool().query('SELECT user_id, paykit_customer_id FROM app_billing_owner ORDER BY user_id');
  if (owners.length === 0) {
    record('D3', 'owner mapping rows', 'SKIP', 'app_billing_owner is empty: no mapped user to resolve');
  } else {
    const problems = [];
    for (const owner of owners) {
      const contact = await getUserContact(owner.user_id).catch((error) => ({ error: error.message }));
      if (contact.error) problems.push(`${owner.user_id}: ${contact.error}`);
      else if (!contact.found) problems.push(`${owner.user_id}: no user row`);
      else if (!contact.email) problems.push(`${owner.user_id}: no email contact`);
    }
    record('D3', 'owner mapping rows', problems.length === 0 ? 'PASS' : 'FAIL',
      problems.length === 0 ? `${owners.length} mapping(s) resolve to a user with an email` : problems.join('; '));
  }

  // D4 — read model answers for every mapped user
  if (owners.length === 0) {
    record('D4', 'status read model', 'SKIP', 'nothing mapped');
  } else {
    const problems = [];
    for (const owner of owners) {
      try {
        const status = await getSubscriptionForUser(owner.user_id);
        const okShape = status.userId === owner.user_id
          && typeof status.hasSubscription === 'boolean'
          && typeof status.reason === 'string'
          && (status.hasSubscription ? Boolean(status.subscriptionId) : true);
        if (!okShape) problems.push(`${owner.user_id}: ${JSON.stringify(status)}`);
        else if (!JSON_MODE) console.log(`     ${owner.user_id} -> reason=${status.reason} hasSubscription=${status.hasSubscription} status=${status.status ?? 'null'}`);
      } catch (error) {
        problems.push(`${owner.user_id}: ${error.message}`);
      }
    }
    record('D4', 'status read model', problems.length === 0 ? 'PASS' : 'FAIL',
      problems.length === 0 ? `${owners.length} user(s) answered` : problems.join('; '));
  }

  // D5 — read-only guarantee
  const after = await counts();
  const drift = after.owners !== before.owners || after.webhook_events !== before.webhook_events;
  record('D5', 'probe is read-only', drift ? 'FAIL' : 'PASS',
    drift ? `owners ${before.owners}->${after.owners}, webhook_events ${before.webhook_events}->${after.webhook_events}`
      : `owners=${after.owners} webhook_events=${after.webhook_events} unchanged`);
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (error) => {
    const unreachable = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '42P01'].includes(error.code);
    record('DB', 'database reachable', 'FAIL', `${error.message}${error.code ? ` (${error.code})` : ''}`);
    try {
      await closePool();
    } catch {
      /* already unusable */
    }
    process.exitCode = unreachable ? 3 : 1;
    return;
  })
  .finally(() => {
    const failed = results.filter((row) => row.level === 'FAIL').length;
    if (JSON_MODE) console.log(JSON.stringify({ checks: results, failed }, null, 2));
    else console.log(`\n${results.filter((r) => r.level === 'PASS').length} PASS, ${results.filter((r) => r.level === 'SKIP').length} SKIP, ${failed} FAIL`);
    if (process.exitCode === undefined) process.exitCode = failed > 0 ? 1 : 0;
  });
