/**
 * App-side PayKit webhook route. Mount path: /api/webhooks/paykit
 *
 * IMPORTANT: mount this router BEFORE the app's global express.json(). It installs its own
 * express.raw() parser so the Stripe signature is verified against the exact received bytes;
 * a preceding JSON parser would rewrite the body and every signature would fail.
 *
 * The handler never logs the signing secret or the payload.
 */
import express from 'express';
import { ingestEvent } from '../lib/webhook-ingest.mjs';

export const webhooksRouter = express.Router();

webhooksRouter.post('/', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  const result = await ingestEvent({ rawBody, headers: req.headers });
  res.status(result.httpStatus).json({ ok: result.ok, outcome: result.outcome, eventId: result.eventId });
});

// express.raw() rejects oversized payloads itself, before the handler runs. Stripe retries any
// non-2xx, so answer in the same JSON shape as the rest of this route instead of an HTML error page.
webhooksRouter.use((error, _req, res, _next) => {
  if (error && (error.type === 'entity.too.large' || error.status === 413)) {
    return res.status(413).json({ ok: false, outcome: 'payload_too_large', eventId: null });
  }
  return res.status(400).json({ ok: false, outcome: 'invalid_request', eventId: null });
});

export default webhooksRouter;