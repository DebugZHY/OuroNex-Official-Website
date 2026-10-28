#!/usr/bin/env node
/**
 * Acceptance probe for the database configuration seam (server/src/lib/subscriptions.mjs).
 *
 * This seam has now produced two silent-wrong-database defects, so it gets its own probe:
 *   1. PG* was ignored unless PGHOST/PGDATABASE was set -> a lone PGPORT silently read the fixture.
 *   2. Any stray PG* variable outranked DATABASE_URL, and the PG* branch filled the missing
 *      host/port/database from the scratch fixture -> one leaked PGPASSWORD pointed production at
 *      127.0.0.1:55432/ouronex_paykit.
 *
 * Every case below is asserted against resolveConfig()/describeDatabaseConfig() (pure) and, where
 * it matters, against a real connection attempt. Nothing is written to any database.
 *
 * Usage: node server/scripts/probe-db-config.mjs   (from the server directory or the repo root)
 */
import pg from 'pg';
import { resolveConfig, describeDatabaseConfig } from '../src/lib/subscriptions.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}

const FIXTURE_DSN = 'postgres://postgres:postgres@127.0.0.1:55432/ouronex_paykit';
const LIVE_DSN = 'postgres://postgres:postgres@127.0.0.1:55432/wh_test_whp3';

function describe(env) {
  try {
    return describeDatabaseConfig(env);
  } catch (error) {
    return { thrown: error.message };
  }
}

function resolve(env) {
  try {
    return { config: resolveConfig(env) };
  } catch (error) {
    return { thrown: error.message };
  }
}

async function connect(env) {
  const { config, thrown } = resolve(env);
  if (thrown) return { error: thrown };
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const { rows } = await client.query('SELECT current_database() AS db');
    return { db: rows[0].db };
  } catch (error) {
    return { error: error.code || error.message };
  } finally {
    await client.end().catch(() => {});
  }
}

// S1 - nothing configured outside production: the scratch fixture, by design
const s1 = describe({});
check('S1 empty env -> documented fixture 127.0.0.1:55432/ouronex_paykit',
  s1.source === 'fixture' && s1.host === '127.0.0.1' && s1.port === 55432 && s1.database === 'ouronex_paykit',
  `${s1.source} ${s1.host}:${s1.port}/${s1.database}`);

// S2 - a lone PGPORT must select the PG* branch, never fall through to the fixture
const s2 = describe({ PGPORT: '59999' });
check('S2 PGPORT only -> PG* branch on PGPORT, fixture not used',
  s2.source === 'PG*' && s2.port === 59999,
  `${s2.source} ${s2.host}:${s2.port}/${s2.database}`);

// S3 - the leaked-PGPASSWORD case: driver defaults, never the fixture
const s3 = describe({ PGPASSWORD: 'postgres' });
check('S3 stray PGPASSWORD only -> driver defaults, not the fixture',
  s3.source === 'PG*' && String(s3.port) !== '55432' && String(s3.host).includes('default'),
  `${s3.source} ${s3.host}:${s3.port}/${s3.database}`);

// S4 - DATABASE_URL outranks a stray PG* variable, and really is the one connected to
const s4 = describe({ DATABASE_URL: LIVE_DSN, PGPASSWORD: 'wrong-password', PGPORT: '59999' });
const s4live = await connect({ DATABASE_URL: LIVE_DSN, PGPASSWORD: 'wrong-password', PGPORT: '59999' });
check('S4 DATABASE_URL wins over stray PG* and connects to the named database',
  s4.source === 'DATABASE_URL' && s4.database === 'wh_test_whp3' && s4live.db === 'wh_test_whp3',
  `${s4.source} ${s4.host}:${s4.port}/${s4.database} live=${s4live.db ?? s4live.error}`);

// S5 - production with nothing configured must throw, not read the fixture
const s5 = resolve({ NODE_ENV: 'production' });
check('S5 production with no configuration -> throws',
  Boolean(s5.thrown) && /no database configuration/.test(s5.thrown),
  s5.thrown ?? 'no error thrown');

// S6 - malformed PGPORT is rejected loudly instead of becoming NaN in the pool
const s6 = resolve({ PGPORT: 'not-a-number' });
check('S6 malformed PGPORT -> throws',
  Boolean(s6.thrown) && /invalid PGPORT/.test(s6.thrown),
  s6.thrown ?? 'no error thrown');

// S7 - a lone PGPORT that points nowhere must fail the connection, not quietly hit the fixture
const s7live = await connect({ PGPORT: '59999' });
check('S7 PGPORT only -> connection fails loudly (never the fixture)',
  Boolean(s7live.error) && s7live.error !== undefined && s7live.db === undefined,
  `error=${s7live.error}`);

// S8 - the fixture DSN through DATABASE_URL still connects (the probes' own path)
const s8live = await connect({ DATABASE_URL: FIXTURE_DSN });
check('S8 DATABASE_URL to the fixture connects to ouronex_paykit',
  s8live.db === 'ouronex_paykit',
  `live=${s8live.db ?? s8live.error}`);

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0
  ? `probe-db-config: ${results.length}/${results.length} checks passed`
  : `probe-db-config: ${results.length - failed}/${results.length} checks passed (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
