/**
 * Payment failed email — subscription is past_due.
 * render(data) -> { subject, html, text }
 *
 * Tone rule: informational, never threatening. The account stays readable; nothing is
 * deleted and no deadline is invented. Self-contained: no imports.
 */

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

function formatDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function render(data = {}) {
  const name = clean(data.name);
  const plan = clean(data.plan);
  const retryDate = formatDate(data.retryDate ?? data.nextRetryAt);

  const subject = "Action needed: we could not process your OuroNex payment";
  const greeting = name ? `Hello ${name},` : "Hello,";

  const text = [
    greeting,
    "",
    "We could not process the most recent payment for your OuroNex subscription" +
      (plan ? ` (${plan})` : "") + ".",
    "",
    "Your account and its history stay readable, and nothing has been deleted. To keep the",
    "subscription active, update the payment method in the billing area where you subscribed" +
      (retryDate ? `; we will try the payment again on ${retryDate}.` : "."),
    "",
    "If the card on file simply expired, replacing it is usually all that is needed. If you",
    "expected a different payment method to be used, reply to this message and we will look at it",
    "with you.",
    "",
    "— OuroNex",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f3f0e9;color:#172b46;font:16px/1.6 Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d9ceb9;border-radius:8px;padding:28px;">
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;">${esc(greeting)}</p>
      <p style="margin:0 0 16px;">We could not process the most recent payment for your OuroNex subscription${
        plan ? ` (<strong>${esc(plan)}</strong>)` : ""
      }.</p>
      <p style="margin:0 0 16px;">Your account and its history stay readable, and nothing has been deleted.
        To keep the subscription active, update the payment method in the billing area where you subscribed${
          retryDate ? `; we will try the payment again on <strong>${esc(retryDate)}</strong>.` : "."
        }</p>
      <p style="margin:0 0 16px;">If the card on file simply expired, replacing it is usually all that is needed.
        If you expected a different payment method to be used, reply to this message and we will look at it with you.</p>
      <p style="margin:20px 0 0;">— OuroNex</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export default { render };