/**
 * All transactional email templates, keyed by the name the mailer records on each message.
 *
 * Each module exports render(data) -> { subject, html, text }; the records also carry the
 * PayKit status vocabulary that triggers them, so callers can map a subscription state
 * directly to a template without a second lookup table.
 */

import * as welcome from "./welcome.mjs";
import * as subscriptionActive from "./subscription-active.mjs";
import * as paymentFailed from "./payment-failed.mjs";
import * as subscriptionCanceled from "./subscription-canceled.mjs";

export { welcome, subscriptionActive, paymentFailed, subscriptionCanceled };

/** Status vocabulary this layer understands (PayKit): active, past_due, canceled. */
export const STATUS_TEMPLATES = {
  active: "subscription-active",
  past_due: "payment-failed",
  canceled: "subscription-canceled",
};

export const templates = {
  welcome,
  "subscription-active": subscriptionActive,
  "payment-failed": paymentFailed,
  "subscription-canceled": subscriptionCanceled,
};

/** render(templateName, data) -> { subject, html, text }; throws only for an unknown name. */
export function render(templateName, data = {}) {
  const template = templates[templateName];
  if (!template) {
    throw new Error(`unknown email template: ${templateName}`);
  }
  return template.render(data);
}

export default templates;