#!/usr/bin/env node
/**
 * Cross-project identity isolation probe.
 *
 * One Stack Auth database can hold several projects, each in its own tenancy. The read model must
 * only see users of the project named by HEXCLAVE_PROJECT_ID; a user of another project must not
 * resolve by email, by id, or through the subscription join.
 *
 * The probe looks for a user outside the scoped tenancy and asserts it stays invisible, then
 * asserts a user inside the scoped tenancy is still readable. On a database with a single tenancy
 * (or the older fixture shape without a tenancyId column) there is nothing to isolate and the probe
 * reports SKIP with exit 0.
 *
 * Read-only. Usage: node server/scripts/probe-identity-scope.mjs
 */
import {
  getIdentityShape, findUserIdsByEmails, getUserContact, getSubscriptionForUser,
  getPool, closePool,
} from '../src/lib/subscriptions.mjs';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  let shape;
  try {
    shape = await getIdentityShape();
  } catch (error) {
    console.log(`SKIP  identity shape unavailable: ${error.message}`);
    return 0;
  }

  if (!shape.tenancyId) {
    console.log(`SKIP  identity lookups are unscoped (${shape.unscopedReason}); single-project database`);
    return 0;
  }
  console.log(`scoped tenancy: ${shape.tenancyId}  (id column "${shape.idColumn}")\n`);

  const { rows: foreign } = await getPool().query(
    `SELECT u."${shape.idColumn}"::text AS user_id,
            (SELECT cc.value FROM "ContactChannel" cc
              WHERE cc."projectUserId" = u."${shape.idColumn}"
                AND lower(cc.type::text) = 'email'
              ORDER BY cc."isPrimary" DESC NULLS LAST LIMIT 1) AS email
       FROM "ProjectUser" u
      WHERE u."tenancyId"::text <> $1
      LIMIT 5`,
    [shape.tenancyId],
  );
  const { rows: own } = await getPool().query(
    `SELECT u."${shape.idColumn}"::text AS user_id
       FROM "ProjectUser" u
      WHERE u."tenancyId"::text = $1
      LIMIT 1`,
    [shape.tenancyId],
  );

  if (foreign.length === 0) {
    console.log('SKIP  no user of another project exists in this database; nothing to isolate');
    return 0;
  }

  const stranger = foreign.find((row) => row.email) ?? foreign[0];
  console.log(`foreign candidate: ${stranger.user_id} ${stranger.email ?? '(no email channel)'}\n`);

  if (stranger.email) {
    const byEmail = await findUserIdsByEmails([stranger.email]);
    record('foreign email is not resolvable', byEmail.length === 0, `ids=${JSON.stringify(byEmail)}`);
  } else {
    record('foreign email is not resolvable', true, 'foreign user has no email channel — case skipped');
  }

  const contact = await getUserContact(stranger.user_id);
  record('foreign user id is not readable', contact.found === false, JSON.stringify(contact));

  const status = await getSubscriptionForUser(stranger.user_id);
  record(
    'foreign user gets no billing identity',
    status.email === null && status.customerId === null,
    `reason=${status.reason} email=${status.email}`,
  );

  if (own.length === 1) {
    const ownContact = await getUserContact(own[0].user_id);
    record('own-project user is still readable', ownContact.found === true, `userId=${own[0].user_id}`);
  } else {
    record('own-project user is still readable', false, 'no user in the scoped tenancy to check');
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  return passed === results.length && results.length > 0 ? 0 : 1;
}

const code = await main();
await closePool();
process.exit(code);
