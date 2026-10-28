/**
 * Welcome email — account created.
 * render(data) -> { subject, html, text }
 *
 * Self-contained on purpose: no imports, no shared helper file, so a template can be
 * rendered in isolation (preview script, tests, future transport) without side effects.
 */

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const nameOf = (data) => (data && typeof data.name === "string" && data.name.trim() ? data.name.trim() : null);

export function render(data = {}) {
  const name = nameOf(data);
  const email = typeof data.email === "string" && data.email.trim() ? data.email.trim() : null;
  const greeting = name ? `Welcome, ${name}.` : "Welcome.";

  const subject = "Welcome to OuroNex";

  const text = [
    greeting,
    "",
    "Your OuroNex account is ready." + (email ? ` It is registered to ${email}.` : ""),
    "",
    "OuroNex applies AI to real engineering work: domain-grounded automation, specialist",
    "software, and workflow training, with qualified engineers reviewing anything that ships.",
    "",
    "What you can do next:",
    "  - Sign in from the OuroNex site where you created this account.",
    "  - Start from one real workflow rather than a broad rollout.",
    "  - Reply to this message if you want help scoping that first workflow.",
    "",
    "No action is required to keep the account open.",
    "",
    "— OuroNex",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f3f0e9;color:#172b46;font:16px/1.6 Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d9ceb9;border-radius:8px;padding:28px;">
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;">${esc(greeting)}</p>
      <p style="margin:0 0 16px;">Your OuroNex account is ready.${
        email ? ` It is registered to <strong>${esc(email)}</strong>.` : ""
      }</p>
      <p style="margin:0 0 16px;">OuroNex applies AI to real engineering work: domain-grounded automation,
        specialist software, and workflow training, with qualified engineers reviewing anything that ships.</p>
      <p style="margin:0 0 8px;font-weight:600;">What you can do next</p>
      <ul style="margin:0 0 16px;padding-left:20px;">
        <li>Sign in from the OuroNex site where you created this account.</li>
        <li>Start from one real workflow rather than a broad rollout.</li>
        <li>Reply to this message if you want help scoping that first workflow.</li>
      </ul>
      <p style="margin:0;color:#526176;">No action is required to keep the account open.</p>
      <p style="margin:20px 0 0;">— OuroNex</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export default { render };