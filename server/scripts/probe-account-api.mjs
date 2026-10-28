#!/usr/bin/env node
/**
 * Acceptance probe for the account API + dashboard page.
 *
 * Builds its own express app (the manager mounts the same router in server/src/index.js), serves
 * the router at /api/account plus server/public as static files, listens on an ephemeral port and
 * walks the identity cases by toggling NODE_ENV / AUTH_DEV_MODE inside this process — which is why
 * the seam must read the environment per request.
 *
 * Reads only: user ids are resolved from the scratch database, nothing is written anywhere.
 *
 * Usage:  node server/scripts/probe-account-api.mjs
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This probe is read-only. The account route now also triggers the welcome letter, so switch that
// path off here: sending mail to the fixture users would be a side effect of a read-only check.
process.env.OURONEX_WELCOME_ONCE = 'off';

import { accountRouter } from '../src/routes/account.mjs';
import { closePool, getPool, findUserIdsByEmails, getUserContact } from '../src/lib/subscriptions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../public');
const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function idsByEmail() {
  // Column names are resolved by the read model (subscriptions.mjs) so this probe does not
  // depend on which Stack Auth shape the database in front of it has.
  const wanted = ['alice@example.com', 'bob@example.com', 'carol@example.com'];
  const ids = await findUserIdsByEmails(wanted);
  const contacts = await Promise.all(ids.map((id) => getUserContact(id)));
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email, c.userId]));
  const missing = wanted.filter((email) => !byEmail.has(email));
  if (missing.length > 0) {
    throw new Error(`scratch database is missing fixtures for ${missing.join(', ')} `
      + '(apply server/db/fixtures/900-identity-unmapped.sql)');
  }
  return {
    alice: byEmail.get('alice@example.com'),
    bob: byEmail.get('bob@example.com'),
    carol: byEmail.get('carol@example.com'),
  };
}

function setEnv({ nodeEnv, devMode }) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (devMode === undefined) delete process.env.AUTH_DEV_MODE;
  else process.env.AUTH_DEV_MODE = devMode;
}

async function main() {
  const { alice, bob, carol } = await idsByEmail();
  console.log(`fixtures: alice=${alice}  bob=${bob}  carol=${carol}\n`);

  const app = express();
  app.use('/api/account', accountRouter);
  app.use(express.static(PUBLIC_DIR));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`probe app listening on ${base}\n`);

  const get = async (url, headers = {}) => {
    const response = await fetch(base + url, { headers, redirect: 'manual' });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body (the static page) is fine */
    }
    return { status: response.status, text, json };
  };

  // T1 — no identity at all (dev mode off)
  setEnv({ nodeEnv: undefined, devMode: undefined });
  {
    const r = await get('/api/account/me/subscription');
    record('T1 no identity -> 401 unauthenticated', r.status === 401 && r.json && r.json.error === 'unauthenticated',
      `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // T2 — alice, active subscription
  setEnv({ nodeEnv: undefined, devMode: 'on' });
  {
    const r = await get('/api/account/me/subscription', { 'x-ouronex-dev-user': alice });
    const ok = r.status === 200 && r.json && r.json.hasSubscription === true && r.json.status === 'active'
      && r.json.identity === 'dev_header';
    record('T2 dev header = alice -> 200 active', ok,
      `status=${r.status} hasSubscription=${r.json && r.json.hasSubscription} status_field=${r.json && r.json.status} periodEnd=${r.json && r.json.currentPeriodEnd}`);
  }

  // T3 — bob, customer mapping without a subscription row
  {
    const r = await get('/api/account/me/subscription', { 'x-ouronex-dev-user': bob });
    const ok = r.status === 200 && r.json && r.json.hasSubscription === false && r.json.reason === 'no_subscription_row';
    record('T3 dev header = bob -> 200 no_subscription_row', ok,
      `status=${r.status} hasSubscription=${r.json && r.json.hasSubscription} reason=${r.json && r.json.reason}`);
  }

  // T3b — carol, signed in but never bought anything: the status read has no billing row to join,
  // and the address still has to come back because that is who a welcome mail goes to.
  {
    const r = await get('/api/account/me/subscription', { 'x-ouronex-dev-user': carol });
    const ok = r.status === 200 && r.json && r.json.reason === 'no_customer_mapping'
      && r.json.email === 'carol@example.com';
    record('T3b dev header = carol (no billing row) -> 200 with email', ok,
      `status=${r.status} reason=${r.json && r.json.reason} email=${r.json && r.json.email}`);
  }

  // T4 — unknown uuid
  {
    const r = await get('/api/account/me/subscription', { 'x-ouronex-dev-user': RANDOM_UUID });
    const ok = r.status === 200 && r.json && r.json.hasSubscription === false && r.json.reason === 'no_customer_mapping';
    record('T4 dev header = random uuid -> 200 no_customer_mapping', ok,
      `status=${r.status} reason=${r.json && r.json.reason}`);
  }

  // T5 — header present but dev mode off
  setEnv({ nodeEnv: undefined, devMode: undefined });
  {
    const r = await get('/api/account/me/subscription', { 'x-ouronex-dev-user': alice });
    record('T5 header without AUTH_DEV_MODE -> 401', r.status === 401 && r.json && r.json.error === 'unauthenticated',
      `status=${r.status} identity=${r.json && r.json.identity} reason=${r.json && r.json.reason}`);
  }

  // T6 — production refuses the dev path
  setEnv({ nodeEnv: 'production', devMode: 'on' });
  {
    const r = await get('/api/account/me/subscription', { 'x-ouronex-dev-user': alice });
    const ok = r.status === 401 && r.json && r.json.identity === 'unconfigured'
      && r.json.reason === 'dev_mode_refused_in_production';
    record('T6 production + dev header -> 401 refused', ok,
      `status=${r.status} identity=${r.json && r.json.identity} reason=${r.json && r.json.reason}`);
  }
  setEnv({ nodeEnv: undefined, devMode: undefined });

  // T7 — the dashboard page is served by the same app
  {
    const r = await get('/dashboard.html');
    const hasSignedOutState = r.text.includes('id="state-signed-out"');
    const callsAccountApi = r.text.includes('/api/account/me/subscription');
    const noFakeLoginForm = !/<form[^>]*>/i.test(r.text);
    const ok = r.status === 200 && hasSignedOutState && callsAccountApi && noFakeLoginForm;
    record('T7 GET /dashboard.html -> 200 with page marker', ok,
      `status=${r.status} bytes=${r.text.length} signedOutState=${hasSignedOutState} accountApi=${callsAccountApi} noFakeForm=${noFakeLoginForm}`);
  }

  await new Promise((resolve) => server.close(resolve));
  await closePool();

  const failed = results.filter((row) => !row.passed);
  console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed.`);
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(async (error) => {
    console.error('probe failed to run:', error);
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  });