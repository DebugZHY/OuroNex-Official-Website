#!/usr/bin/env node
/**
 * Renders every transactional template with representative fixture data and delivers it
 * through the mailer in dry-run mode, so the whole layer can be exercised with no
 * transport, no keys and no network.
 *
 * Usage:  node server/scripts/preview-emails.mjs
 * Exits non-zero if any template fails to render or the mailer refuses a message.
 */

import { templates } from "../src/emails/index.mjs";
import { activeDriverName, OUTBOX_DIR, sendEmail } from "../src/lib/mailer.mjs";

/** One fixture per template; the welcome fixture deliberately contains markup to prove escaping. */
export const FIXTURES = {
  welcome: {
    to: "new.customer@example.com",
    template: "welcome",
    data: {
      name: '<script>alert(1)</script>',
      email: "new.customer@example.com",
    },
  },
  "subscription-active": {
    to: "practice.lead@example.com",
    template: "subscription-active",
    data: {
      name: "Mei Lin",
      plan: "Professional SaaS — Structural team",
      periodEnd: "2026-12-31T00:00:00.000Z",
      renewal: false,
      subscriptionId: "sub_fixture_active",
    },
  },
  "payment-failed": {
    to: "billing@example.com",
    template: "payment-failed",
    data: {
      name: "Sam Okafor",
      plan: "Professional SaaS — Structural team",
      retryDate: "2026-11-02T00:00:00.000Z",
      subscriptionId: "sub_fixture_past_due",
    },
  },
  "subscription-canceled": {
    to: "owner@example.com",
    template: "subscription-canceled",
    data: {
      name: "A. Consultant",
      plan: "General Automation retainer",
      accessEnd: "2026-11-30T00:00:00.000Z",
      subscriptionId: "sub_fixture_canceled",
    },
  },
};

/** Also prove the refusal path: a missing and an implausible address must not throw. */
const REFUSAL_CASES = [
  { label: "missing recipient", args: { to: "", subject: "x", html: "<p>x</p>", text: "x", template: "welcome" } },
  { label: "implausible recipient", args: { to: "not-an-address", subject: "x", html: "<p>x</p>", text: "x", template: "welcome" } },
];

function pad(value, width) {
  return String(value).padEnd(width, " ");
}

export async function preview() {
  const rows = [];
  let failures = 0;

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const template = templates[name];
    if (!template) {
      rows.push({ template: name, subject: "(missing template)", file: "-", ok: false });
      failures += 1;
      continue;
    }
    const { subject, html, text } = template.render(fixture.data);
    const result = await sendEmail({ to: fixture.to, subject, html, text, template: name, data: fixture.data });
    if (!result.ok) failures += 1;
    rows.push({ template: name, subject, file: result.file ?? `(refused: ${result.reason})`, ok: result.ok });
  }

  for (const testCase of REFUSAL_CASES) {
    const result = await sendEmail(testCase.args);
    const refused = result.ok === false && Boolean(result.reason);
    if (!refused) failures += 1;
    rows.push({ template: `[refusal] ${testCase.label}`, subject: refused ? `refused: ${result.reason}` : "NOT REFUSED", file: "-", ok: refused });
  }

  const width = Math.max(...rows.map((row) => row.template.length), 10);
  console.log(`driver: ${activeDriverName()}   outbox: ${OUTBOX_DIR}`);
  console.log(`${pad("template", width)}  ${pad("subject", 52)}  file`);
  console.log("-".repeat(width + 60));
  for (const row of rows) {
    console.log(`${pad(row.template, width)}  ${pad(row.subject.slice(0, 52), 52)}  ${row.file}`);
  }
  console.log(`\n${rows.length} messages handled, ${failures} problem(s).`);
  return { rows, failures };
}

preview()
  .then(({ failures }) => {
    process.exitCode = failures === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error("preview failed:", error);
    process.exitCode = 1;
  });