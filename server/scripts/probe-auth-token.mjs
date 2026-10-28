#!/usr/bin/env node
/**
 * Acceptance probe for real Stack Auth session verification.
 *
 * Builds the same express surface the server mounts (`/api/account`) and walks the identity cases
 * against the deployed Stack Auth API: unconfigured, forged token, real session via Authorization,
 * real session via x-stack-access-token, the production/dev-header refusal, and a token presented
 * against a different project.
 *
 * A real session is obtained by signing up a throwaway user through the Stack Auth REST API, which
 * is the same call a browser makes; no password is stored here and nothing is written to our
 * billing tables. Requires `NEXT_PUBLIC_STACK_API_URL`, `HEXCLAVE_PROJECT_ID` and
 * `HEXCLAVE_SECRET_SERVER_KEY` (server/.env) plus a reachable database.
 *
 * Usage:  node server/scripts/probe-auth-token.mjs
 */
import express from 'express';

import { accountRouter } from '../src/routes/account.mjs';
import { closePool, getIdentityShape } from '../src/lib/subscriptions.mjs';

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signUp(baseUrl, projectId, publishableKey) {
  const email = `probe+${Date.now()}@ouronex.local`;
  const response = await fetch(`${baseUrl}/api/v1/auth/password/sign-up`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stack-project-id': projectId,
      'x-stack-publishable-client-key': publishableKey,
      'x-stack-access-type': 'client',
    },
    body: JSON.stringify({ email, password: `Probe-${Math.random().toString(36).slice(2)}-2026!` }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new Error(`sign-up failed: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return { email, token: body.access_token };
}

async function main() {
  const baseUrl = (process.env.NEXT_PUBLIC_STACK_API_URL || '').trim().replace(/\/+$/, '');
  const projectId = (process.env.HEXCLAVE_PROJECT_ID || '').trim();
  const secretKey = (process.env.HEXCLAVE_SECRET_SERVER_KEY || '').trim();
  const publishableKey = (process.env.HEXCLAVE_PUBLISHABLE_CLIENT_KEY || '').trim();
  if (!baseUrl || !projectId || !secretKey || !publishableKey) {
    console.log('SKIP  Stack Auth is not configured in this environment (NEXT_PUBLIC_STACK_API_URL / HEXCLAVE_*)');
    return 0;
  }

  // The sandbox database must be reachable before any identity case is meaningful.
  await getIdentityShape();

  const app = express();
  app.use('/api/account', accountRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (headers, path = '/api/account/me/subscription') =>
    fetch(`${base}${path}`, { headers }).then(async (response) => ({ status: response.status, body: await response.json() }));

  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_DEV_MODE: process.env.AUTH_DEV_MODE,
    baseUrl: process.env.NEXT_PUBLIC_STACK_API_URL,
    projectId: process.env.HEXCLAVE_PROJECT_ID,
    secretKey: process.env.HEXCLAVE_SECRET_SERVER_KEY,
  };
  const restore = () => {
    for (const [key, value] of Object.entries({
      NODE_ENV: savedEnv.NODE_ENV,
      AUTH_DEV_MODE: savedEnv.AUTH_DEV_MODE,
      NEXT_PUBLIC_STACK_API_URL: savedEnv.baseUrl,
      HEXCLAVE_PROJECT_ID: savedEnv.projectId,
      HEXCLAVE_SECRET_SERVER_KEY: savedEnv.secretKey,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    // A1 — configuration removed: an unconfigured server cannot authenticate anyone.
    delete process.env.NEXT_PUBLIC_STACK_API_URL;
    delete process.env.HEXCLAVE_PROJECT_ID;
    delete process.env.HEXCLAVE_SECRET_SERVER_KEY;
    delete process.env.AUTH_DEV_MODE;
    delete process.env.NODE_ENV;
    const a1 = await call({ authorization: 'Bearer whatever' });
    record('A1 unconfigured stack -> 401 stack_auth_not_configured',
      a1.status === 401 && a1.body.reason === 'stack_auth_not_configured',
      `status=${a1.status} reason=${a1.body.reason}`);
    restore();

    // A2 — a token that does not exist.
    const a2 = await call({ authorization: 'Bearer not-a-real-token' });
    record('A2 forged token -> 401 stack_session_invalid',
      a2.status === 401 && a2.body.reason === 'stack_session_invalid',
      `status=${a2.status} reason=${a2.body.reason}`);

    // A3 — a real session, presented as a bearer token.
    const session = await signUp(baseUrl, projectId, publishableKey);
    const a3 = await call({ authorization: `Bearer ${session.token}` });
    const expectedId = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: {
        'x-stack-project-id': projectId,
        'x-stack-secret-server-key': secretKey,
        'x-stack-access-type': 'server',
        'x-stack-access-token': session.token,
      },
    }).then((response) => response.json()).then((body) => body.id);
    record('A3 real session -> 200 identity=stack with the API user id',
      a3.status === 200 && a3.body.identity === 'stack' && a3.body.userId === expectedId,
      `status=${a3.status} identity=${a3.body.identity} userIdMatches=${a3.body.userId === expectedId} reason=${a3.body.reason}`);
    record('A3b new user has no billing mapping',
      a3.body.reason === 'no_customer_mapping',
      `reason=${a3.body.reason}`);

    // A4 — the same session in the SDK-style header.
    const a4 = await call({ 'x-stack-access-token': session.token });
    record('A4 x-stack-access-token path -> same user',
      a4.status === 200 && a4.body.userId === expectedId,
      `status=${a4.status} userIdMatches=${a4.body.userId === expectedId}`);

    // A5 — production refuses the development header even when dev mode is on.
    process.env.NODE_ENV = 'production';
    process.env.AUTH_DEV_MODE = 'on';
    const a5 = await call({ 'x-ouronex-dev-user': RANDOM_UUID });
    record('A5 production refuses dev header -> 401 dev_mode_refused_in_production',
      a5.status === 401 && a5.body.reason === 'dev_mode_refused_in_production',
      `status=${a5.status} reason=${a5.body.reason}`);
    restore();

    // A6 — a token of our project must not be accepted while claiming another project.
    process.env.HEXCLAVE_PROJECT_ID = 'internal';
    const a6 = await call({ authorization: `Bearer ${session.token}` });
    record('A6 foreign project id -> 401 stack_session_invalid',
      a6.status === 401 && a6.body.reason === 'stack_session_invalid',
      `status=${a6.status} reason=${a6.body.reason}`);
    restore();

    // A7 — an Authorization header of another scheme is not treated as a session.
    const a7 = await call({ authorization: 'Basic dXNlcjpwYXNz' });
    record('A7 non-bearer authorization -> 401 stack_no_credential',
      a7.status === 401 && a7.body.reason === 'stack_no_credential',
      `status=${a7.status} reason=${a7.body.reason}`);

    await sleep(0);
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }

  const passed = results.filter((item) => item.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  return passed === results.length && results.length > 0 ? 0 : 1;
}

const code = await main().catch((error) => {
  console.error(`probe-auth-token failed: ${error.message}`);
  return 1;
});
await closePool();
process.exit(code);
