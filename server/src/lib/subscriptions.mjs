/**
 * Subscription status read model.
 *
 * Resolves a Stack Auth user id to the app-owned billing link (app_billing_owner) and on to the
 * PayKit customer and subscription. Subscription state in our own PostgreSQL is the source of
 * truth; PayKit's tables are read-only from here and no vendor column is mutated.
 *
 * One pool, created lazily on first use and exported so the server can shut it down.
 *
 * Connection configuration, first match wins:
 *   1. DATABASE_URL — an explicit connection string always wins over ambient PG* variables.
 *   2. PG* environment variables (PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE — any one of
 *      them selects this branch). Missing pieces are left to the driver's own defaults
 *      (localhost:5432, the OS user name); they are NEVER filled in from the scratch fixture.
 *   3. outside production only: the local scratch fixture used by the stage-2 probe
 *      (127.0.0.1:55432, ouronex_paykit), so `node server/scripts/probe-subscription-status.mjs`
 *      works with no environment setup. In production a missing configuration throws instead of
 *      silently reading the scratch database.
 *
 * Why DATABASE_URL outranks PG*: a single stray PG* variable in a process environment (PGPASSWORD
 * is commonly exported by backup tooling and CI images) used to redirect the whole application,
 * because the PG* branch filled the missing host/port/database from the fixture. An explicit
 * connection string cannot be hijacked that way.
 *
 * Project scoping: one Stack Auth database can hold several projects ("tenancy" is Stack Auth's
 * per-project id space), and each has its own users. Every identity lookup here is therefore
 * restricted to the tenancy of HEXCLAVE_PROJECT_ID once more than one tenancy is present; reading
 * the whole "ProjectUser" table would let another project's user answer for ours. A fixture
 * database (no tenancyId column) or a single-tenancy database needs no restriction and gets none.
 */
import pg from 'pg';

const FIXTURE = {
  host: '127.0.0.1',
  port: 55432,
  user: 'postgres',
  password: 'postgres',
  database: 'ouronex_paykit',
};

const PGVARS = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];

let pool = null;

const present = (source, name) => source[name] !== undefined && source[name] !== '';

/**
 * Resolve the connection configuration for an environment map (defaults to process.env).
 * Pure: no caching, no connection. Throws when production is configured with neither source.
 */
export function resolveConfig(source = process.env) {
  if (present(source, 'DATABASE_URL')) return { connectionString: source.DATABASE_URL };

  if (PGVARS.some((name) => present(source, name))) {
    const config = {};
    if (present(source, 'PGHOST')) config.host = source.PGHOST;
    if (present(source, 'PGPORT')) {
      const port = Number(source.PGPORT);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`invalid PGPORT: ${source.PGPORT}`);
      }
      config.port = port;
    }
    if (present(source, 'PGUSER')) config.user = source.PGUSER;
    if (present(source, 'PGPASSWORD')) config.password = source.PGPASSWORD;
    if (present(source, 'PGDATABASE')) config.database = source.PGDATABASE;
    return config;
  }

  if (source.NODE_ENV === 'production') {
    throw new Error('no database configuration: set DATABASE_URL or the PG* variables');
  }
  return { ...FIXTURE };
}

/**
 * Describe the configuration resolveConfig() would use, for probes and preflight output.
 * Never returns a password. `source` says which branch was taken; `host`/`port`/`database` say
 * what will actually be connected to (driver defaults are spelled out when left unset).
 */
export function describeDatabaseConfig(source = process.env) {
  const config = resolveConfig(source);
  if (config.connectionString) {
    const url = new URL(config.connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(driver default)';
    return { source: 'DATABASE_URL', host: url.hostname, port: Number(url.port || 5432), database };
  }
  const fromFixture = config.host === FIXTURE.host && config.port === FIXTURE.port
    && config.database === FIXTURE.database;
  return {
    source: fromFixture ? 'fixture' : 'PG*',
    host: config.host ?? '(driver default: localhost)',
    port: config.port ?? '(driver default: 5432)',
    database: config.database ?? '(driver default: user name)',
  };
}

/** The lazily created pool (one per process). */
export function getPool() {
  if (!pool) pool = new pg.Pool({ ...resolveConfig(), max: 4 });
  return pool;
}

/** Close the pool; safe to call more than once. */
export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

/** Alias kept for callers that prefer a dispose-style name. */
export const closeSubscriptionPool = closePool;

// ---------------------------------------------------------------- identity table shape
// Stack Auth's user table is not shaped the same way in every release: the stage-2 fixture (and
// older images) expose "ProjectUser"(id, primaryEmail, displayName), while the current Hexclave
// image exposes "ProjectUser"(projectUserId, displayName) and keeps emails in "ContactChannel".
// The shape is read from information_schema once per process so one query builder works against
// both, instead of hard-coding the columns of whichever one happened to be deployed first.
const USER_TABLE = 'ProjectUser';

let shapePromise = null;

async function loadIdentityShape() {
  const { rows } = await getPool().query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [USER_TABLE],
  );
  if (rows.length === 0) {
    throw new Error(`identity table "${USER_TABLE}" is not present in this database`);
  }
  const columns = new Set(rows.map((row) => row.column_name));
  const idColumn = columns.has('projectUserId') ? 'projectUserId' : columns.has('id') ? 'id' : null;
  if (!idColumn) {
    throw new Error(`"${USER_TABLE}" has neither projectUserId nor id; cannot join an app user id`);
  }
  const displayNameSql = columns.has('displayName') ? 'u."displayName"' : 'NULL';

  let emailSql = null;
  if (columns.has('primaryEmail')) {
    emailSql = 'u."primaryEmail"';
  } else if (columns.has('email')) {
    emailSql = 'u."email"';
  } else {
    const { rows: contact } = await getPool().query(`SELECT to_regclass('public."ContactChannel"') AS t`);
    if (contact[0]?.t) {
      emailSql = `(SELECT cc.value FROM "ContactChannel" cc
                     WHERE cc."projectUserId" = u."${idColumn}"
                       AND lower(cc.type::text) = 'email'
                     ORDER BY cc."isPrimary" DESC NULLS LAST, cc."createdAt" ASC
                     LIMIT 1)`;
    }
  }

  const scope = await resolveTenancyScope(columns);

  // The tenancy literal reaches the ContactChannel subquery, which cannot take a parameter of its
  // own (it is embedded in several statements with different parameter positions). It is a uuid
  // read back from "Tenancy" in this process, never caller input.
  if (scope.emailIsContactChannel && scope.tenancyId) {
    emailSql = emailSql.replace(
      'AND lower(cc.type::text)',
      `AND cc."tenancyId"::text = '${scope.tenancyId}'\n                       AND lower(cc.type::text)`,
    );
  }

  return { idColumn, emailSql: emailSql ?? 'NULL', displayNameSql, ...scope };
}

/**
 * Which tenancy (Stack Auth project) this process may read users from.
 *
 * - no "tenancyId" column: the fixture/older shape has one project, nothing to scope.
 * - exactly one tenancy in use: same database, nothing to scope.
 * - more than one: HEXCLAVE_PROJECT_ID must name one of them; refusing to guess is the whole
 *   point, because guessing wrong means answering with another project's user.
 */
async function resolveTenancyScope(columns) {
  const unscoped = { tenancyId: null, emailIsContactChannel: false, unscopedReason: 'single_tenancy' };
  if (!columns.has('tenancyId')) return { ...unscoped, unscopedReason: 'no_tenancy_column' };

  const { rows } = await getPool().query(
    'SELECT DISTINCT "tenancyId"::text AS id FROM "ProjectUser"',
  );
  const tenancies = rows.map((row) => row.id).filter(Boolean);
  if (tenancies.length <= 1) return { ...unscoped, unscopedReason: 'single_tenancy' };

  const projectId = process.env.HEXCLAVE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      `"ProjectUser" holds ${tenancies.length} tenancies but HEXCLAVE_PROJECT_ID is not set; `
      + 'refusing to read users from every project at once',
    );
  }
  let owner = null;
  try {
    const found = await getPool().query(
      'SELECT id::text AS id FROM "Tenancy" WHERE "projectId" = $1 LIMIT 1',
      [projectId],
    );
    owner = found.rows[0]?.id ?? null;
  } catch (error) {
    throw new Error(
      `cannot resolve the tenancy of project ${projectId}: ${error && error.message} (${error && error.code})`,
    );
  }
  if (!owner) {
    throw new Error(
      `"Tenancy" has no row for project ${projectId}; set HEXCLAVE_PROJECT_ID to the project this `
      + 'server belongs to',
    );
  }
  return {
    tenancyId: owner,
    emailIsContactChannel: columns.has('primaryEmail') === false && columns.has('email') === false,
    unscopedReason: null,
  };
}

/** `AND u."tenancyId"::text = $n` when the read model is scoped, otherwise an empty fragment. */
function scopeClause(shape, alias, paramIndex) {
  if (!shape.tenancyId) return { sql: '', params: [] };
  return { sql: ` AND ${alias}."tenancyId"::text = $${paramIndex}`, params: [shape.tenancyId] };
}

/** Cached per process; a failed detection is not cached so a later call can retry. */
export async function getIdentityShape() {
  if (!shapePromise) {
    shapePromise = loadIdentityShape().catch((error) => {
      shapePromise = null;
      throw error;
    });
  }
  return shapePromise;
}

/** Stack Auth user ids whose primary email matches any of the given addresses. */
export async function findUserIdsByEmails(emails) {
  const wanted = (Array.isArray(emails) ? emails : []).filter((value) => typeof value === 'string' && value);
  if (wanted.length === 0) return [];
  const shape = await getIdentityShape();
  if (shape.emailSql === 'NULL') return [];
  const scope = scopeClause(shape, 'u', 2);
  const { rows } = await getPool().query(
    `SELECT u."${shape.idColumn}"::text AS user_id, ${shape.emailSql} AS email
       FROM "${USER_TABLE}" u
      WHERE lower(${shape.emailSql}) = ANY($1::text[])${scope.sql}
      ORDER BY 2`,
    [wanted.map((value) => value.toLowerCase()), ...scope.params],
  );
  return rows.map((row) => row.user_id);
}

/** Display name + email of one Stack Auth user, whatever shape that table currently has. */
export async function getUserContact(userId) {
  if (typeof userId !== 'string' || userId.length === 0) {
    return { userId: userId ?? null, email: null, displayName: null, found: false };
  }
  const shape = await getIdentityShape();
  const scope = scopeClause(shape, 'u', 2);
  const { rows } = await getPool().query(
    `SELECT u."${shape.idColumn}"::text AS user_id,
            ${shape.emailSql}           AS email,
            ${shape.displayNameSql}     AS display_name
       FROM "${USER_TABLE}" u
      WHERE u."${shape.idColumn}"::text = $1${scope.sql}
      LIMIT 1`,
    [userId, ...scope.params],
  );
  if (rows.length === 0) return { userId, email: null, displayName: null, found: false };
  return { userId, email: rows[0].email ?? null, displayName: rows[0].display_name ?? null, found: true };
}

// Single statement: app_billing_owner -> paykit_customer -> paykit_subscription, with LEFT JOINs
// so a dangling mapping (customer gone) and a customer without a subscription stay distinguishable.
function statusSql(shape) {
  const userScope = shape.tenancyId ? ` AND u."tenancyId"::text = $2` : '';
  return `
  SELECT m.user_id               AS user_id,
         m.paykit_customer_id    AS customer_id,
         c.id                    AS customer_found,
         ${shape.emailSql}       AS email,
         s.id                    AS subscription_id,
         s.status                AS status,
         s.current_period_end_at AS current_period_end,
         p.id                    AS plan_id
    FROM app_billing_owner m
    LEFT JOIN paykit_customer c     ON c.id = m.paykit_customer_id
    LEFT JOIN "${USER_TABLE}" u     ON u."${shape.idColumn}"::text = m.user_id${userScope}
    LEFT JOIN paykit_subscription s ON s.customer_id = c.id
    LEFT JOIN paykit_product p      ON p.internal_id = s.product_internal_id
   WHERE m.user_id = $1
   ORDER BY s.created_at DESC NULLS LAST
   LIMIT 1`;
}

function result(partial) {
  return {
    userId: null,
    email: null,
    hasSubscription: false,
    status: null,
    currentPeriodEnd: null,
    customerId: null,
    subscriptionId: null,
    planId: null,
    reason: null,
    ...partial,
  };
}

/**
 * Email of the identity row itself.
 *
 * The status query is anchored on app_billing_owner, so a user who has never bought anything has no
 * row to join a profile from — which is exactly the account a welcome mail has to address. Resolving
 * the address separately keeps that case from reporting null.
 */
async function identityEmail(userId) {
  try {
    const contact = await getUserContact(userId);
    return contact.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscription status for one Stack Auth user id.
 *
 * Never throws for missing data: an unknown user, a mapping without a subscription and a mapping
 * whose customer row is gone each return hasSubscription:false with a distinct reason. A NULL
 * current_period_end_at is passed through as null; no date is ever invented.
 *
 * @param {string} userId Stack Auth user id ("ProjectUser".id::text)
 * @returns {Promise<{userId: string|null, email: string|null, hasSubscription: boolean,
 *   status: string|null, currentPeriodEnd: string|null, customerId: string|null,
 *   subscriptionId: string|null, reason: 'ok'|'no_customer_mapping'|'no_subscription_row'|
 *   'customer_not_found'|'invalid_user_id'>}
 */
export async function getSubscriptionForUser(userId) {
  if (typeof userId !== 'string' || userId.length === 0) {
    return result({ userId: userId ?? null, reason: 'invalid_user_id' });
  }

  const shape = await getIdentityShape();
  let rows;
  try {
    const params = shape.tenancyId ? [userId, shape.tenancyId] : [userId];
    ({ rows } = await getPool().query(statusSql(shape), params));
  } catch (error) {
    // PayKit's tables are created by its own migrations. Reporting that as a distinct reason beats
    // a 500 that looks like an application bug on a deployment where stage 0 is not finished.
    if (error && error.code === '42P01') {
      return result({ userId, reason: 'paykit_schema_missing' });
    }
    throw error;
  }
  if (rows.length === 0) {
    return result({ userId, email: await identityEmail(userId), reason: 'no_customer_mapping' });
  }

  const row = rows[0];
  const base = {
    userId: row.user_id ?? userId,
    email: row.email ?? (await identityEmail(userId)),
    customerId: row.customer_id ?? null,
  };

  if (!row.customer_found) {
    return result({ ...base, reason: 'customer_not_found' });
  }
  if (!row.subscription_id) {
    return result({ ...base, reason: 'no_subscription_row' });
  }

  return result({
    ...base,
    hasSubscription: true,
    status: row.status,
    planId: row.plan_id ?? null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    subscriptionId: row.subscription_id,
    reason: 'ok',
  });
}