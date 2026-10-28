// OuroNex server: account API, PayKit webhook intake, dashboard shell.
// Static marketing pages stay in the repo root; this server only serves
// /dashboard, /handler/* (Stack Auth, once deployed), /api/account/* and /api/webhooks/paykit.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { accountRouter } from './routes/account.mjs';
import { authRouter } from './routes/auth.mjs';
import { billingRouter } from './routes/billing.mjs';
import { webhooksRouter } from './routes/webhooks.mjs';
import { closePool } from './lib/subscriptions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3100);

// The webhook route verifies a signature over the exact received bytes, so it has to be mounted
// before the global JSON parser rewrites the body.
app.use('/api/webhooks/paykit', webhooksRouter);

app.use(express.json());

// Allow the static marketing origin to call the account API from the browser.
// The token is the only credential — cookies are not used cross-origin.
const STATIC_ORIGINS = new Set([
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && STATIC_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,accept');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health + config probes (no secrets)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ouronex-server', time: new Date().toISOString() });
});

app.use('/api/account', accountRouter);
app.use('/api/auth', authRouter);
app.use('/api/billing', billingRouter);

// Serve the server-side pages (dashboard, login fallback shell)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public config for the front-end SDK (publishable key is safe to expose)
app.get('/api/auth-config', (_req, res) => {
  res.json({
    projectId: process.env.HEXCLAVE_PROJECT_ID || process.env.STACK_PROJECT_ID || '',
    publishableClientKey: process.env.STACK_PUBLISHABLE_CLIENT_KEY || '',
    apiUrl: process.env.NEXT_PUBLIC_STACK_API_URL || 'http://localhost:8102',
  });
});
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({ event: 'listening', port: PORT }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ event: 'shutdown', signal }));
  server.close(async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
