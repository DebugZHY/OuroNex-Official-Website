#!/usr/bin/env node
/**
 * CLI probe for the subscription status read model.
 *
 * Usage:
 *   node server/scripts/probe-subscription-status.mjs [--dsn=<connection-string>] [userId ...]
 *
 * With no arguments it resolves the two seeded fixture users (alice@example.com,
 * bob@example.com), appends one random unknown uuid, and prints one JSON line per user id.
 * Exits non-zero only on a real SQL or connection error.
 */
import { randomUUID } from 'node:crypto';
import { getSubscriptionForUser, findUserIdsByEmails, closePool } from '../src/lib/subscriptions.mjs';

const DEFAULT_EMAILS = ['alice@example.com', 'bob@example.com'];

function parseArgs(argv) {
  const ids = [];
  let dsn = null;
  for (const arg of argv) {
    if (arg.startsWith('--dsn=')) dsn = arg.slice('--dsn='.length);
    else ids.push(arg);
  }
  return { ids, dsn };
}

async function main() {
  const { ids, dsn } = parseArgs(process.argv.slice(2));
  if (dsn) process.env.DATABASE_URL = dsn; // the pool is created lazily, so this is still early enough

  const targets = ids.length > 0 ? [...ids] : await findUserIdsByEmails(DEFAULT_EMAILS);
  targets.push(randomUUID()); // unknown-user case

  for (const userId of targets) {
    const status = await getSubscriptionForUser(userId);
    console.log(JSON.stringify(status));
  }
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(JSON.stringify({ error: error.message, code: error.code ?? null }));
    try {
      await closePool();
    } catch {
      /* the connection is already unusable */
    }
    process.exit(1);
  });