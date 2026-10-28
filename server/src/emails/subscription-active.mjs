/**
 * Subscription active email — subscription started or renewed.
 * render(data) -> { subject, html, text }
 *
 * Self-contained: no imports so the template renders in isolation.
 * `plan` and `periodEnd` are optional; the email adapts instead of inventing values.
 */

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Accepts an ISO string or Date and returns an unambiguous English date, or null if unusable. */
function formatDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function render(data = {}) {
  const name = clean(data.name);
  const plan = clean(data.plan);
  const periodEnd = formatDate(data.periodEnd ?? data.currentPeriodEnd);
  const renewal = data.renewal === true;

  const subject = renewal ? "Your OuroNex subscription renewed" : "Your OuroNex subscription is active";
  const opening = renewal ? "Your OuroNex subscription has renewed." : "Your OuroNex subscription is now active.";
  const greeting = name ? `Hello ${name},` : "Hello,";

  const facts = [];
  if (plan) facts.push(`Plan: ${plan}`);
  if (periodEnd) facts.push(renewal ? `Current period ends: ${periodEnd}` : `Current period ends: ${periodEnd}`);
  if (!plan && !periodEnd) facts.push("Your plan details are shown in your account.");

  const text = [
    greeting,
    "",
    opening,
    "",
    ...facts,
    "",
    "Nothing changes on your side — keep working as usual. Your plan covers the services",
    "described on the OuroNex site, delivered under the same review model: AI assists and",
    "qualified engineers decide.",
    "",
    "You can review or change the subscription from the billing area where you subscribed.",
    "",
    "— OuroNex",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f3f0e9;color:#172b46;font:16px/1.6 Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d9ceb9;border-radius:8px;padding:28px;">
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;">${esc(greeting)}</p>
      <p style="margin:0 0 16px;">${esc(opening)}</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px;">
${
  plan
    ? `        <tr><td style="padding:8px 0;color:#526176;">Plan</td><td style="padding:8px 0;font-weight:600;">${esc(plan)}</td></tr>\n`
    : ""
}${
  periodEnd
    ? `        <tr><td style="padding:8px 0;color:#526176;">Current period ends</td><td style="padding:8px 0;font-weight:600;">${esc(periodEnd)}</td></tr>\n`
    : ""
}</table>
      <p style="margin:0 0 16px;">Nothing changes on your side — keep working as usual. Your plan covers the services
        described on the OuroNex site, delivered under the same review model: AI assists and qualified engineers decide.</p>
      <p style="margin:0;color:#526176;">You can review or change the subscription from the billing area where you subscribed.</p>
      <p style="margin:20px 0 0;">— OuroNex</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export default { render };