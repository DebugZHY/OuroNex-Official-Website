/**
 * Subscription canceled email — access end date when provided.
 * render(data) -> { subject, html, text }
 *
 * Confirms the cancellation without inventing retention promises or reasons.
 * Self-contained: no imports.
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
  const accessEnd = formatDate(data.accessEnd ?? data.currentPeriodEnd);

  const subject = "Your OuroNex subscription has been canceled";
  const greeting = name ? `Hello ${name},` : "Hello,";

  const text = [
    greeting,
    "",
    "Your OuroNex subscription" + (plan ? ` (${plan})` : "") + " has been canceled.",
    accessEnd
      ? `Access continues until ${accessEnd}. After that date the account stays on file but the subscription is inactive.`
      : "Access continues to the end of the current billing period. After that the account stays on file but the subscription is inactive.",
    "",
    "You can start a new subscription later from the billing area where you subscribed. If you",
    "canceled by mistake, or want help exporting work before access ends, reply to this message.",
    "",
    "— OuroNex",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f3f0e9;color:#172b46;font:16px/1.6 Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d9ceb9;border-radius:8px;padding:28px;">
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;">${esc(greeting)}</p>
      <p style="margin:0 0 16px;">Your OuroNex subscription${plan ? ` (<strong>${esc(plan)}</strong>)` : ""}
        has been canceled.</p>
      <p style="margin:0 0 16px;">${
        accessEnd
          ? `Access continues until <strong>${esc(accessEnd)}</strong>. After that date the account stays on file but the subscription is inactive.`
          : "Access continues to the end of the current billing period. After that the account stays on file but the subscription is inactive."
      }</p>
      <p style="margin:0 0 16px;">You can start a new subscription later from the billing area where you subscribed.
        If you canceled by mistake, or want help exporting work before access ends, reply to this message.</p>
      <p style="margin:20px 0 0;">— OuroNex</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export default { render };