/**
 * PayKit apply step for incoming provider webhooks.
 *
 * Ownership boundary: PayKit owns the Stripe endpoint contract, its own idempotent claim on
 * paykit_webhook_event and every write to paykit_* tables — paykit_subscription above all, which is
 * the subscription source of truth this app reads. Our intake therefore must not write those rows;
 * it verifies the signature, records the event once in app_webhook_event for replay protection and
 * notification bookkeeping, and then hands the *same raw request* to PayKit's handler so PayKit
 * performs the write.
 *
 * Why a rebuilt request instead of a direct function call: PayKit's public surface is a web handler
 * (`paykit.handler(request) -> Response`) that routes on the request path and re-checks the Stripe
 * signature against the bytes it reads. Rebuilding the request from the bytes and headers Stripe
 * sent keeps that check meaningful, and keeps every source of truth write inside PayKit.
 *
 * The result never throws: a missing configuration, a rejected payload, a timeout and a broken
 * handler all come back as { ok: false, outcome, detail } so the caller can decide the HTTP status
 * (Stripe retries any non-2xx) without a crash taking the route down.
 */
import { getPayKit, PAYKIT_BASE_PATH } from './paykit.js';

/** Matches the route's own ceiling; a slow provider call must not hold the request open forever. */
const APPLY_TIMEOUT_MS = 20000;
/** Placeholder origin: the handler routes on the path only and never dials it. */
const LOCAL_ORIGIN = 'http://127.0.0.1';

function headerPairs(headers) {
  const pairs = [];
  if (!headers) return pairs;

  // Web Headers or Express IncomingHttpHeaders: both end up as [name, value] pairs.
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    headers.forEach((value, name) => {
      if (value != null) pairs.push([String(name), String(value)]);
    });
    return pairs;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) pairs.push([name, String(entry)]);
    } else {
      pairs.push([name, String(value)]);
    }
  }
  return pairs;
}

function truncate(value, limit = 300) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

/**
 * Hand one signature-verified event to PayKit.
 *
 * @param {{ rawBody?: string|Buffer, headers?: object, instance?: object|null }} input
 *   `instance` is for tests only: pass an object with handler() to stub PayKit, or null to exercise
 *   the "billing not configured" branch without touching the environment.
 * @returns {Promise<{ ok: boolean, outcome: 'applied'|'apply_failed'|'paykit_not_configured',
 *   detail: string, message?: string }>}
 */
export async function applyWithPayKit({ rawBody, headers, instance } = {}) {
  let paykit = instance;
  if (paykit === undefined) {
    try {
      paykit = getPayKit();
    } catch (error) {
      return {
        ok: false,
        outcome: 'paykit_not_configured',
        detail: error?.code ?? 'billing_not_configured',
      };
    }
  }
  if (!paykit || typeof paykit.handler !== 'function') {
    return { ok: false, outcome: 'paykit_not_configured', detail: 'billing_not_configured' };
  }

  const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody ?? '').toString('utf8');

  let response;
  try {
    const request = new Request(`${LOCAL_ORIGIN}${PAYKIT_BASE_PATH}/webhook`, {
      method: 'POST',
      headers: headerPairs(headers),
      body,
      signal: AbortSignal.timeout(APPLY_TIMEOUT_MS),
    });
    response = await paykit.handler(request);
  } catch (error) {
    return {
      ok: false,
      outcome: 'apply_failed',
      detail: error?.name === 'TimeoutError' ? 'timeout' : 'handler_error',
      message: truncate(error?.message ?? error),
    };
  }

  if (!response || typeof response.status !== 'number') {
    return { ok: false, outcome: 'apply_failed', detail: 'no_response' };
  }

  let text = '';
  try {
    text = await response.text();
  } catch {
    /* a bodiless or already-consumed response still carries the status we act on */
  }

  if (!response.ok) {
    return {
      ok: false,
      outcome: 'apply_failed',
      detail: `http_${response.status}`,
      message: truncate(text),
    };
  }

  return { ok: true, outcome: 'applied', detail: `http_${response.status}` };
}

export default { applyWithPayKit };
