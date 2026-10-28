#!/usr/bin/env node
/**
 * Production readiness preflight.
 *
 * Runs before a deployment is trusted: it resolves the configuration the server would actually use
 * and fails loudly when that configuration is a development one (fixture database, placeholder
 * Stripe keys, a dev-only identity path, or Stack Auth endpoints pointing at localhost).
 *
 * Node builtins only — no dependencies, no network calls, no writes. Secret values are never
 * printed: keys are shown masked (e.g. `sk_te***`) and database targets as host:port/db only.
 *
 * Usage:
 *   node server/scripts/preflight.mjs           human output, exit 1 if any FAIL
 *   node server/scripts/preflight.mjs --json    machine-readable output (same checks, same exit code)
 *
 * Exit code: 1 when at least one check is FAIL, otherwise 0 (WARN never changes the exit code).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeDatabaseConfig } from "../src/lib/subscriptions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, "..");
const ENV_PATH = path.join(SERVER_DIR, ".env");
const ENV_EXAMPLE_PATH = path.join(SERVER_DIR, ".env.example");

/** Must match the fallback used by server/src/lib/subscriptions.mjs. */
const FIXTURE = { host: "127.0.0.1", port: 55432, database: "ouronex_paykit" };
const PG_VARS = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"];
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const PRODUCTION = process.env.NODE_ENV === "production";
const JSON_MODE = process.argv.includes("--json");

const results = [];
const record = (id, title, level, detail) => results.push({ id, title, level, detail });

/** Mask any secret for display; never returns the full value. */
function mask(value) {
  if (value === undefined || value === null || value === "") return "(unset)";
  const text = String(value);
  return text.length <= 6 ? `${text[0] ?? ""}***` : `${text.slice(0, 6)}***`;
}

/** Minimal .env reader: KEY=VALUE, no substitution, values may be quoted. Real env wins. */
function readEnvFile(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

const fileEnv = readEnvFile(ENV_PATH);
const env = (name) => (process.env[name] !== undefined ? process.env[name] : fileEnv.get(name));
const fromFile = (name) => process.env[name] === undefined && fileEnv.has(name);

function describeDbTarget({ host, port, database }) {
  return `${host}:${port}/${database || "(default)"}`;
}

function parseDatabaseUrl(value) {
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)",
      user: url.username || null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 1. database target
// Resolution is NOT re-implemented here: server/src/lib/subscriptions.mjs owns it, and this check
// must answer "what would the server actually connect to", so it asks that module.
const mergedEnv = { ...Object.fromEntries(fileEnv) };
for (const [name, value] of Object.entries(process.env)) {
  if (value !== undefined) mergedEnv[name] = value;
}

let target = null;
if ((mergedEnv.DATABASE_URL ?? "") !== "" && PG_VARS.some((name) => (mergedEnv[name] ?? "") !== "")) {
  record(
    "db-ambiguous",
    "Database config sources",
    "WARN",
    "DATABASE_URL and PG* are both set; DATABASE_URL wins at runtime and the PG* values are ignored",
  );
}

try {
  const described = describeDatabaseConfig(mergedEnv);
  target = described;
  record(
    "db-target",
    "Database target",
    "PASS",
    `${described.host}:${described.port}/${described.database} — via ${described.source}`,
  );
} catch (error) {
  record(
    "db-target",
    "Database target",
    "FAIL",
    `no usable configuration: ${error.message} ` +
      `(set DATABASE_URL or the PG* variables; the development fixture ${describeDbTarget(FIXTURE)} is never ` +
      "used when a configuration is present)",
  );
}

// ---------------------------------------------------------------- 2. fixture guard
if (target) {
  const isFixture = LOCAL_HOSTS.has(String(target.host)) && Number(target.port) === FIXTURE.port;
  const isDriverDefaultLocalhost = typeof target.host === "string" && target.host.includes("driver default");
  if (isFixture && PRODUCTION) {
    record(
      "db-fixture",
      "Fixture database guard",
      "FAIL",
      "production pointed at the development fixture " +
        `(${describeDbTarget(target)}); refusing to run on stage-2 sample data`,
    );
  } else if (isFixture) {
    record("db-fixture", "Fixture database guard", "WARN", `development fixture in use (${describeDbTarget(target)})`);
  } else if (isDriverDefaultLocalhost && PRODUCTION) {
    record(
      "db-fixture",
      "Fixture database guard",
      "FAIL",
      `production leaves the host to the driver default (localhost) — set PGHOST or DATABASE_URL`,
    );
  } else {
    record("db-fixture", "Fixture database guard", "PASS", "target is not the development fixture");
  }
} else {
  record("db-fixture", "Fixture database guard", "FAIL", "cannot evaluate: no database target resolved");
}

// ---------------------------------------------------------------- 3. Stripe keys
const PLACEHOLDER_MARKERS = ["placeholder", "...", "xxx", "replace"];
function looksPlaceholder(value) {
  const lowered = String(value).toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

function checkKey({ id, title, name, pattern, patternLabel }) {
  const value = env(name);
  if (!value) {
    record(id, title, PRODUCTION ? "FAIL" : "WARN", `${name} is not set`);
    return;
  }
  if (!pattern.test(value)) {
    record(id, title, PRODUCTION ? "FAIL" : "WARN", `${name}=${mask(value)} does not match ${patternLabel}`);
    return;
  }
  if (looksPlaceholder(value)) {
    record(id, title, PRODUCTION ? "FAIL" : "WARN", `${name}=${mask(value)} is still a placeholder value`);
    return;
  }
  if (value.startsWith("sk_live_") && !PRODUCTION) {
    record("stripe-secret", title, "WARN", `${name}=${mask(value)} is a LIVE key in a non-production process`);
    return;
  }
  record(id, title, "PASS", `${name}=${mask(value)} looks well formed`);
}

checkKey({
  id: "stripe-secret",
  title: "Stripe secret key",
  name: "STRIPE_SECRET_KEY",
  pattern: /^sk_(test|live)_/,
  patternLabel: "^sk_(test|live)_",
});
checkKey({
  id: "stripe-webhook",
  title: "Stripe webhook secret",
  name: "STRIPE_WEBHOOK_SECRET",
  pattern: /^whsec_/,
  patternLabel: "^whsec_",
});
checkKey({
  id: "stripe-publishable",
  title: "Stripe publishable key",
  name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  pattern: /^pk_/,
  patternLabel: "^pk_",
});

// ---------------------------------------------------------------- 4. identity path
const devModeOn = env("AUTH_DEV_MODE") === "on";
if (devModeOn && PRODUCTION) {
  record(
    "auth-mode",
    "Identity path",
    "FAIL",
    "AUTH_DEV_MODE=on in production: auth-context refuses the dev header there anyway, so the account " +
      "API would reject every request",
  );
} else if (devModeOn) {
  record("auth-mode", "Identity path", "WARN", "dev identity header accepted (AUTH_DEV_MODE=on, non-production)");
} else {
  record(
    "auth-mode",
    "Identity path",
    "WARN",
    "account API has no working identity path yet (Stack Auth not deployed); every request will be 401",
  );
}

// ---------------------------------------------------------------- 5. Stack Auth endpoints
const stackUrls = ["NEXT_PUBLIC_STACK_API_URL", "NEXT_PUBLIC_STACK_DASHBOARD_URL"];
const missingStack = stackUrls.filter((name) => !env(name));
const localStack = stackUrls.filter((name) => {
  const value = env(name);
  if (!value) return false;
  const parsed = parseDatabaseUrl(value) || null;
  if (parsed) return LOCAL_HOSTS.has(parsed.host);
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
});

if (missingStack.length > 0) {
  record(
    "stack-urls",
    "Stack Auth endpoints",
    PRODUCTION ? "FAIL" : "WARN",
    `not set: ${missingStack.join(", ")}`,
  );
} else if (localStack.length > 0 && PRODUCTION) {
  record("stack-urls", "Stack Auth endpoints", "FAIL", `production points at localhost: ${localStack.join(", ")}`);
} else if (localStack.length > 0) {
  record("stack-urls", "Stack Auth endpoints", "WARN", `localhost targets in non-production: ${localStack.join(", ")}`);
} else {
  record("stack-urls", "Stack Auth endpoints", "PASS", "both Stack Auth URLs are set to non-local targets");
}

// ---------------------------------------------------------------- 6. .env presence
if (!existsSync(ENV_PATH)) {
  record("dotenv", "server/.env", "PASS", "no .env file: configuration comes from the process environment");
} else {
  const placeholderKeys = [...fileEnv.entries()]
    .filter(([, value]) => looksPlaceholder(value))
    .map(([key, value]) => `${key}=${mask(value)}`);
  if (placeholderKeys.length > 0) {
    record(
      "dotenv",
      "server/.env",
      "WARN",
      `placeholder values still present: ${placeholderKeys.join(", ")}`,
    );
  }
  if (PRODUCTION) {
    record(
      "dotenv-production",
      "server/.env in production",
      "WARN",
      "server/.env is present and will be the configuration source (dotenv-style defaults); " +
        "keep real production values in the process environment",
    );
  }
  if (existsSync(ENV_EXAMPLE_PATH) && placeholderKeys.length === 0) {
    record("dotenv", "server/.env", "PASS", "no placeholder values detected in server/.env");
  }
}

// ---------------------------------------------------------------- report
const summary = {
  production: PRODUCTION,
  passed: results.filter((row) => row.level === "PASS").length,
  warned: results.filter((row) => row.level === "WARN").length,
  failed: results.filter((row) => row.level === "FAIL").length,
  exitCode: results.some((row) => row.level === "FAIL") ? 1 : 0,
};

if (JSON_MODE) {
  console.log(JSON.stringify({ checks: results, summary }, null, 2));
} else {
  console.log(`OuroNex preflight — NODE_ENV=${process.env.NODE_ENV || "(unset)"}${JSON_MODE ? "" : ""}`);
  console.log("-".repeat(96));
  for (const row of results) {
    console.log(`${row.level.padEnd(4)} ${row.title.padEnd(26)} ${row.detail}`);
  }
  console.log("-".repeat(96));
  console.log(
    `${summary.passed} PASS, ${summary.warned} WARN, ${summary.failed} FAIL — ` +
      (summary.exitCode === 0 ? "ready for review" : "NOT ready: fix the FAIL lines above"),
  );
}

process.exitCode = summary.exitCode;