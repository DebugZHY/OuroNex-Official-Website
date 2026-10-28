#!/usr/bin/env node
/**
 * Acceptance probe for "the welcome letter goes out exactly once" (server/src/lib/notification-once.mjs).
 *
 * Database-backed, but self-contained: every row it writes uses a `probe-welcome-` user id and is
 * deleted again at the end, so it leaves no state in the notification ledger behind. Mail goes
 * through the default dry-run driver (files under server/outbox/), which is what makes "exactly one
 * message" countable without a network.
 *
 * What it deliberately does NOT do: create users. Resolving a real Stack Auth user would mean writing
 * to the auth service's table, which this probe has no business touching — the no-recipient case is
 * covered with an id that no user row matches, which is exactly the shape the route sees for a user
 * that has not verified an address yet.
 *
 * Usage: node server/scripts/probe-welcome-once.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  claimNotification,
  sendOnce,
  sendWelcomeOnce,
  welcomeOnceEnabled,
  WELCOME_KIND,
} from '../src/lib/notification-once.mjs';
import { registerDriver, activeDriverName, OUTBOX_DIR, sendEmail } from '../src/lib/mailer.mjs';
import { getPool, closePool } from '../src/lib/subscriptions.mjs';

const USER_PREFIX = 'probe-welcome-';
const results = [];

function record(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function welcomeFiles() {
  // One dry-run message writes two files (the .eml plus a .html preview for inspection), so the
  // message count is the .eml count — counting both would make one send look like two.
  try {
    return fs.readdirSync(OUTBOX_DIR).filter((f) => f.toLowerCase().endsWith('.eml') && f.toLowerCase().includes('welcome'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** A fresh, unique probe identity per check so retries of the whole probe never collide with leftovers. */
function probeUser(label) {
  return `${USER_PREFIX}${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function ledgerRow(userId) {
  const { rows } = await getPool().query(
    'SELECT user_id, kind, status, attempts, sent_at, last_error FROM app_notification WHERE user_id = $1 AND kind = $2',
    [userId, WELCOME_KIND],
  );
  return rows[0] ?? null;
}

async function cleanup() {
  const { rowCount } = await getPool().query('DELETE FROM app_notification WHERE user_id LIKE $1', [`${USER_PREFIX}%`]);
  return rowCount;
}

/**
 * The dry-run driver writes one .eml + one .html per message; a probe that leaves them behind turns
 * every gate run into two dozen stray files in server/outbox/. Every message this probe sends goes to
 * probe-welcome@ouronex.local, whose slug is in the file name, so they are identifiable and removable.
 */
function removeProbeMail() {
  let removed = 0;
  try {
    for (const file of fs.readdirSync(OUTBOX_DIR)) {
      if (!file.toLowerCase().includes('probe-welcome')) continue;
      try {
        fs.unlinkSync(path.join(OUTBOX_DIR, file));
        removed += 1;
      } catch { /* leave it; the next run will try again */ }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return removed;
}

async function main() {
  console.log(`mail driver: ${activeDriverName()}  outbox: ${OUTBOX_DIR}`);
  const cleanedAtStart = await cleanup();
  if (cleanedAtStart) console.log(`cleaned ${cleanedAtStart} leftover probe row(s) from an earlier run\n`);

  // ------------------------------------------------ W1: first claim sends, row becomes 'sent'
  const w1User = probeUser('w1');
  const before1 = welcomeFiles().length;
  const w1 = await sendOnce({
    userId: w1User,
    kind: WELCOME_KIND,
    to: 'probe-welcome@ouronex.local',
    subject: 'Welcome probe',
    html: '<p>w1</p>',
    text: 'w1',
    template: 'welcome',
    data: {},
  });
  const w1Row = await ledgerRow(w1User);
  const after1 = welcomeFiles().length;
  record(
    'W1 first send goes out and is recorded once',
    w1.sent === true && w1Row?.status === 'sent' && Boolean(w1Row?.sent_at) && after1 - before1 === 1,
    `sent=${w1.sent} status=${w1Row?.status} newFiles=${after1 - before1}`,
  );

  // ------------------------------------------------ W2: second request is refused, no second mail
  const before2 = welcomeFiles().length;
  const w2 = await sendOnce({
    userId: w1User,
    kind: WELCOME_KIND,
    to: 'probe-welcome@ouronex.local',
    subject: 'Welcome probe',
    html: '<p>w2</p>',
    text: 'w2',
    template: 'welcome',
    data: {},
  });
  const after2 = welcomeFiles().length;
  const w2Row = await ledgerRow(w1User);
  record(
    'W2 second request -> already_sent, no second mail',
    w2.sent === false && w2.reason === 'already_sent' && after2 === before2 && w2Row?.status === 'sent',
    `sent=${w2.sent} reason=${w2.reason} newFiles=${after2 - before2}`,
  );

  // ------------------------------------------------ W3: five concurrent requests, one winner
  const w3User = probeUser('w3');
  const before3 = welcomeFiles().length;
  const racing = await Promise.all(
    Array.from({ length: 5 }, (_, i) => sendOnce({
      userId: w3User,
      kind: WELCOME_KIND,
      to: 'probe-welcome@ouronex.local',
      subject: `Welcome probe ${i}`,
      html: '<p>w3</p>',
      text: 'w3',
      template: 'welcome',
      data: {},
    })),
  );
  const after3 = welcomeFiles().length;
  const winners = racing.filter((r) => r.sent === true).length;
  const losers = racing.filter((r) => r.sent === false).every((r) => r.reason === 'already_sent' || r.reason === 'claimed_elsewhere');
  record(
    'W3 five concurrent sends -> exactly one mail',
    winners === 1 && losers && after3 - before3 === 1,
    `winners=${winners} newFiles=${after3 - before3} reasons=${racing.map((r) => r.reason ?? 'sent').join(',')}`,
  );

  // ------------------------------------------------ W4: a failed send stays retryable
  const w4User = probeUser('w4');
  const originalDriver = activeDriverName();
  registerDriver({
    name: 'probe-welcome-fail',
    send: async () => {
      throw new Error('probe_injected_failure');
    },
  });
  process.env.MAIL_DRIVER = 'probe-welcome-fail';
  let w4Threw = false;
  let w4;
  try {
    w4 = await sendOnce({
      userId: w4User,
      kind: WELCOME_KIND,
      to: 'probe-welcome@ouronex.local',
      subject: 'Welcome probe',
      html: '<p>w4</p>',
      text: 'w4',
      template: 'welcome',
      data: {},
    });
  } catch (error) {
    w4Threw = true;
    w4 = { sent: false, reason: `threw:${error.message}` };
  }
  const w4RowFailed = await ledgerRow(w4User);
  process.env.MAIL_DRIVER = originalDriver;
  const before4 = welcomeFiles().length;
  const w4Retry = await sendOnce({
    userId: w4User,
    kind: WELCOME_KIND,
    to: 'probe-welcome@ouronex.local',
    subject: 'Welcome probe',
    html: '<p>w4</p>',
    text: 'w4',
    template: 'welcome',
    data: {},
  });
  const after4 = welcomeFiles().length;
  const w4RowSent = await ledgerRow(w4User);
  record(
    'W4 send failure -> {ok:false}, no throw, row failed and retryable',
    w4Threw === false
      && w4.sent === false
      && w4.reason === 'failed'
      && w4RowFailed?.status === 'failed'
      && Boolean(w4RowFailed?.last_error)
      && w4Retry.sent === true
      && after4 - before4 === 1
      && w4RowSent?.status === 'sent'
      && w4RowSent?.attempts >= 2,
    `threw=${w4Threw} first=${w4.reason} row=${w4RowFailed?.status} retry=${w4Retry.sent} attempts=${w4RowSent?.attempts}`,
  );

  // ------------------------------------------------ W5: user without an address consumes no claim
  const w5User = probeUser('w5-without-email');
  const before5 = welcomeFiles().length;
  const w5 = await sendWelcomeOnce(w5User);
  const w5Row = await ledgerRow(w5User);
  const after5 = welcomeFiles().length;
  record(
    'W5 user without an email -> no_recipient, no ledger row burned',
    w5.sent === false && w5.reason === 'no_recipient' && w5Row === null && after5 === before5,
    `sent=${w5.sent} reason=${w5.reason} row=${w5Row ? w5Row.status : 'none'} newFiles=${after5 - before5}`,
  );

  // ------------------------------------------------ W6: the kill switch
  const w6User = probeUser('w6-disabled');
  const before6 = welcomeFiles().length;
  const w6 = await sendWelcomeOnce(w6User, { enabled: false });
  const w6Row = await ledgerRow(w6User);
  const after6 = welcomeFiles().length;
  const envOff = welcomeOnceEnabled({ OURONEX_WELCOME_ONCE: 'off' }) === false
    && welcomeOnceEnabled({}) === true;
  record(
    'W6 OURONEX_WELCOME_ONCE=off -> disabled, no mail, no row',
    w6.sent === false && w6.reason === 'disabled' && w6Row === null && after6 === before6 && envOff,
    `sent=${w6.sent} reason=${w6.reason} row=${w6Row ? w6Row.status : 'none'} envSwitch=${envOff}`,
  );

  // ------------------------------------------------ W7: the claim is the only gate, not the send
  const w7User = probeUser('w7-claim');
  const first = await claimNotification({ userId: w7User, kind: WELCOME_KIND });
  const second = await claimNotification({ userId: w7User, kind: WELCOME_KIND });
  record(
    'W7 second claim on a live row is refused (no double send window)',
    first.claimed === true && second.claimed === false && second.status === 'claimed',
    `first=${first.claimed} second=${second.claimed}/${second.status}`,
  );

  // A transport that reports failure without throwing must be handled the same way: the mailer
  // answers { ok:false } for an unusable recipient instead of raising.
  const w8 = await sendOnce({
    userId: probeUser('w8-bad-recipient'),
    kind: WELCOME_KIND,
    to: 'not-an-address',
    subject: 'Welcome probe',
    html: '<p>w8</p>',
    text: 'w8',
    template: 'welcome',
    data: {},
  });
  record(
    'W8 unusable recipient from the mailer -> failed, not thrown',
    w8.sent === false && w8.reason === 'failed' && Boolean(w8.detail),
    `sent=${w8.sent} reason=${w8.reason} detail=${w8.detail}`,
  );

  // sanity: the driver really is back to the default one for the rest of the suite
  const driverBack = (await sendEmail({ to: 'probe-welcome@ouronex.local', subject: 'sanity', template: 'welcome', text: 'sanity', html: '<p>sanity</p>' })).ok === true;
  record('W9 mail driver restored after the injected failure', driverBack, `driver=${activeDriverName()}`);

  // ------------------------------------------------ W10: the route keeps its response and still hooks in
  // Mounts the real router the app mounts. The identity is a dev-header id that matches no user row,
  // so the hook takes the no-recipient branch: what is being checked is that wiring the welcome in
  // neither changes the status code nor creates a phantom ledger row.
  const express = (await import('express')).default;
  process.env.AUTH_DEV_MODE = 'on';
  delete process.env.NODE_ENV;
  const { accountRouter } = await import('../src/routes/account.mjs');
  const app = express();
  app.use('/api/account', accountRouter);
  const listener = await new Promise((resolve) => {
    const l = app.listen(0, '127.0.0.1', () => resolve(l));
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const devUser = probeUser('w10-route');
  const hits = [];
  for (let i = 0; i < 2; i += 1) {
    const response = await fetch(`${base}/api/account/me/subscription`, { headers: { 'x-ouronex-dev-user': devUser } });
    hits.push(response.status);
  }
  const w10Row = await ledgerRow(devUser);
  listener.close();
  record(
    'W10 route answers 200 both times and burns no row without a recipient',
    hits.every((s) => s === 200) && w10Row === null,
    `statuses=${hits.join(',')} row=${w10Row ? w10Row.status : 'none'}`,
  );

  const removed = await cleanup();
  const removedMail = removeProbeMail();
  console.log(`\ncleaned up ${removed} probe row(s) and ${removedMail} dry-run mail file(s)`);

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${results.length} checks, ${passed} passed, ${results.length - passed} failed.`);
  await closePool();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`FAIL  probe crashed — ${error && error.message}`);
  try {
    await cleanup();
    await closePool();
  } catch { /* nothing left to clean */ }
  process.exit(1);
});
