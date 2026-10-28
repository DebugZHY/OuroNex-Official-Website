/**
 * Billing API router. Mount path: /api/billing (server/src/index.js).
 *
 * Endpoints, all authenticated by the same identity seam as the account API:
 *   POST /api/billing/checkout     { planId }  -> { ok, url }  a Stripe Checkout session
 *   POST /api/billing/portal       {}          -> { ok, url }  a Stripe customer-portal session
 *   GET  /api/billing/subscription {}          -> subscription status (alias of /api/account/me/subscription)
 *
 * The browser is sent to the URL this returns; no card data ever reaches this server. Landing URLs
 * are built from PUBLIC_BASE_URL rather than from the request body, so a crafted payload cannot turn
 * checkout into an open redirect. A `priceId` in the body is ignored: prices belong to the product
 * definitions PayKit synced, not to whatever id a page happens to carry.
 */
import express from 'express';
import { resolveUserId } from '../lib/auth-context.mjs';
import { getPlan } from '../lib/plans.mjs';
import { getSubscriptionForUser } from '../lib/subscriptions.mjs';
import {
  createCheckoutSession,
  createPortalSession,
  resolveStripeConfig,
} from '../lib/billing.mjs';

export const billingRouter = express.Router();

function appBase() {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return configured || `http://localhost:${process.env.PORT || 3100}`;
}

/** Stripe and driver messages can echo request details; only types are forwarded. */
function sanitizeForLog(error) {
  return String(error?.message ?? 'unknown error')
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, '[redacted-key]')
    .replace(/whsec_[A-Za-z0-9+/=]+/g, '[redacted-secret]')
    .replace(/postgres(ql)?:\/\/\S+/gi, '[redacted-connection-string]');
}

async function identityGate(req, res) {
  const identity = await resolveUserId(req);
  if (!identity.userId) {
    res.status(401).json({ ok: false, error: 'unauthenticated', reason: identity.reason });
    return null;
  }
  return identity;
}

function configGate(res) {
  const config = resolveStripeConfig();
  if (!config.configured) {
    res.status(503).json({ ok: false, error: 'billing_not_configured', reason: config.reason });
    return false;
  }
  return true;
}

// Create checkout session for a plan
billingRouter.post('/checkout', async (req, res) => {
  const identity = await identityGate(req, res);
  if (!identity) return;

  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  if (!planId) return res.status(400).json({ ok: false, error: 'missing_plan' });

  // Plan checks are local and cost nothing, so a bad request is answered as a bad request even on a
  // deployment where Stripe is not configured yet.
  const plan = getPlan(planId);
  if (!plan) return res.status(400).json({ ok: false, error: 'unknown_plan' });
  if (!(plan.price > 0)) return res.status(400).json({ ok: false, error: 'plan_not_purchasable' });

  if (!configGate(res)) return;

  const base = appBase();
  try {
    const result = await createCheckoutSession({
      userId: identity.userId,
      planId,
      successUrl: `${base}/dashboard?checkout=success`,
      cancelUrl: `${base}/pricing.html?checkout=cancelled`,
    });
    if (!result.ok) {
      const status = result.reason === 'unknown_plan' || result.reason === 'plan_not_purchasable' ? 400 : 502;
      return res.status(status).json({ ok: false, error: result.reason });
    }
    return res.json({ ok: true, url: result.url, planId: result.planId });
  } catch (error) {
    console.error('[billing] checkout failed:', sanitizeForLog(error));
    const notConfigured = error?.code === 'billing_not_configured';
    return res.status(notConfigured ? 503 : 502).json({
      ok: false,
      error: notConfigured ? 'billing_not_configured' : 'checkout_failed',
    });
  }
});

billingRouter.post('/portal', async (req, res) => {
  const identity = await identityGate(req, res);
  if (!identity) return;
  if (!configGate(res)) return;

  try {
    const result = await createPortalSession({
      userId: identity.userId,
      returnUrl: `${appBase()}/dashboard`,
    });
    if (!result.ok) {
      const status = result.reason === 'no_customer_mapping' ? 409 : 502;
      return res.status(status).json({ ok: false, error: result.reason });
    }
    return res.json({ ok: true, url: result.url });
  } catch (error) {
    console.error('[billing] portal failed:', sanitizeForLog(error));
    return res.status(502).json({ ok: false, error: 'portal_failed' });
  }
});

/**
 * Ops view of billing configuration: whether a real Stripe key is in effect, in which mode, and
 * whether the webhook secret is usable. No secret material is returned.
 */
billingRouter.get('/config', (_req, res) => {
  const config = resolveStripeConfig();
  res.json({
    ok: true,
    configured: config.configured,
    reason: config.reason,
    mode: config.mode,
    secret: config.secret.reason,
    webhook: config.webhook.reason,
  });
});

// Get customer's subscription status
billingRouter.get('/subscription', async (req, res) => {
  const identity = await identityGate(req, res);
  if (!identity) return;

  try {
    const subscription = await getSubscriptionForUser(identity.userId);
    return res.json({ ...subscription, identity: identity.mode });
  } catch (error) {
    console.error('[billing] subscription lookup failed:', sanitizeForLog(error));
    return res.status(500).json({ ok: false, error: 'subscription_lookup_failed' });
  }
});

export default billingRouter;
