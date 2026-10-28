/**
 * Transactional mail adapter.
 *
 * Shape: one send() seam per driver, selected by MAIL_DRIVER (default "dry-run").
 *   - dry-run: writes each message to server/outbox/ as a .eml file (multipart/alternative with
 *     text and html parts) plus a plain .html file for quick inspection. Never opens a socket.
 *   - smtp:    delivers over SMTP using SMTP_URL. Uses node:net / node:tls only: EHLO, STARTTLS
 *     when the server advertises it, AUTH PLAIN or AUTH LOGIN when the server advertises AUTH and
 *     the URL carries credentials, MAIL FROM, RCPT TO, DATA (CRLF + dot-stuffing) and QUIT.
 *
 * Environment read per call (never cached), so a process can switch transports between sends:
 *   MAIL_DRIVER                "dry-run" (default) | "smtp"
 *   MAIL_FROM                  header From, its address is also the SMTP envelope sender
 *   SMTP_URL                   smtp://[user:pass@]host[:port] (25) | smtps://… (implicit TLS, 465)
 *   SMTP_ALLOW_INSECURE_TLS    "1" accepts an untrusted certificate (local test servers only)
 *   SMTP_TIMEOUT_MS            per-socket timeout, default 10000
 *
 * sendEmail({ to, subject, html, text, template, data }) -> { ok, driver, file }
 * It never throws: invalid recipients, a missing/invalid SMTP_URL and driver errors all come back
 * as { ok: false, reason }.
 */

import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUTBOX_DIR = path.resolve(HERE, "../../outbox");

const MAX_ADDRESS_LENGTH = 254;
// Plausible-address check only: one @, no whitespace, a dot in the domain, no header injection.
const ADDRESS_RE = /^[^\s@<>,;:"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 10_000);

function validateRecipient(to) {
  if (typeof to !== "string" || !to.trim()) return { ok: false, reason: "missing_recipient" };
  const address = to.trim();
  if (address.length > MAX_ADDRESS_LENGTH) return { ok: false, reason: "recipient_too_long" };
  if (/[\r\n]/.test(address)) return { ok: false, reason: "recipient_contains_newline" };
  if (!ADDRESS_RE.test(address)) return { ok: false, reason: "implausible_recipient" };
  return { ok: true, address };
}

function sanitizeHeaderValue(value, fallback = "") {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return text || fallback;
}

function slugify(value, maxLength = 40) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "message").slice(0, maxLength);
}

function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function base64Utf8(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

/**
 * Build the multipart/alternative message. dryRun adds the two inspection headers that must never
 * leave the process over a real transport.
 */
function buildEml({ from, to, subject, html, text, template, data, dryRun = true }) {
  const boundary = `ourex-${base64Utf8(`${to}${subject}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
  const headers = [
    `From: ${sanitizeHeaderValue(from, "OuroNex <no-reply@localhost>")}`,
    `To: ${to}`,
    `Subject: ${sanitizeHeaderValue(subject, "(no subject)")}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `X-OuroNex-Template: ${sanitizeHeaderValue(template, "unknown")}`,
  ];
  if (dryRun) {
    headers.push("X-OuroNex-Driver: dry-run", "X-OuroNex-Dry-Run: true");
  }
  if (data && typeof data === "object" && data.subscriptionId) {
    headers.push(`X-OuroNex-Subscription: ${sanitizeHeaderValue(data.subscriptionId)}`);
  }
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(html),
    `--${boundary}--`,
    "",
  ];

  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

/** The dry-run transport: writes files, never opens a socket. */
const dryRunDriver = {
  name: "dry-run",
  async send({ to, subject, html, text, template, data }) {
    const from = process.env.MAIL_FROM || "OuroNex <no-reply@localhost>";
    const base = `${fileTimestamp()}-${slugify(template, 30)}-${slugify(to.split("@")[0], 24)}`;
    const emlPath = path.join(OUTBOX_DIR, `${base}.eml`);
    const htmlPath = path.join(OUTBOX_DIR, `${base}.html`);

    await mkdir(OUTBOX_DIR, { recursive: true });
    await writeFile(emlPath, buildEml({ from, to, subject, html, text, template, data }), "utf8");
    await writeFile(htmlPath, String(html ?? ""), "utf8");

    return { ok: true, driver: "dry-run", file: emlPath, htmlFile: htmlPath, to, subject, template };
  },
};

/** Parse SMTP_URL into a connection config. Never throws. */
export function parseSmtpUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "smtp_url_missing" };
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "smtp_url_invalid" };
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return { ok: false, reason: "smtp_url_invalid" };

  const secure = url.protocol === "smtps:";
  const host = url.hostname;
  const port = url.port ? Number(url.port) : secure ? 465 : 25;
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return { ok: false, reason: "smtp_url_invalid" };

  return {
    ok: true,
    config: {
      host,
      port,
      secure,
      user: url.username ? decodeURIComponent(url.username) : null,
      pass: url.password ? decodeURIComponent(url.password) : null,
      allowInsecureTls: process.env.SMTP_ALLOW_INSECURE_TLS === "1",
    },
  };
}

/** Envelope sender address: the part inside <...>, or the raw value when it is already an address. */
function envelopeAddress(value) {
  const text = sanitizeHeaderValue(value, "no-reply@localhost");
  const angled = text.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : text).trim();
  return candidate.includes("@") ? candidate : "no-reply@localhost";
}

/**
 * Normalise any line ending to CRLF and dot-stuff line-leading dots. Exported so a probe can
 * assert the exact transformation the SMTP transport applies to the DATA payload.
 */
export function normalizeAndDotStuff(payload) {
  const normalised = String(payload ?? "").replace(/\r\n|\r|\n/g, "\r\n").replace(/^\./gm, "..");
  return normalised.endsWith("\r\n") ? normalised : `${normalised}\r\n`;
}

/** A reply reader over a socket that can be replaced when STARTTLS upgrades it. */
function smtpChannel(initialSocket) {
  let socket = initialSocket;
  let buffer = "";
  let pending = null;

  const fail = (error) => {
    if (!pending) return;
    const waiter = pending;
    pending = null;
    waiter.reject(error instanceof Error ? error : new Error(String(error)));
  };
  const pump = () => {
    if (!pending) return;
    let index;
    while ((index = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      pending.lines.push(line);
      if (/^\d{3}[ ]/.test(line)) {
        const waiter = pending;
        pending = null;
        waiter.resolve({ code: Number(line.slice(0, 3)), lines: waiter.lines });
        return;
      }
    }
  };
  const attach = (next) => {
    socket = next;
    next.setEncoding("utf8");
    next.on("data", (chunk) => {
      buffer += chunk;
      pump();
    });
    next.on("error", fail);
    next.on("close", () => fail(new Error("smtp_connection_closed")));
    next.on("timeout", () => next.destroy(new Error("smtp_timeout")));
  };
  attach(initialSocket);

  return {
    socket: () => socket,
    attach,
    write: (line) => socket.write(`${line}\r\n`),
    writeRaw: (payload) => socket.write(payload),
    readReply: () =>
      new Promise((resolve, reject) => {
        pending = { lines: [], resolve, reject };
        pump();
      }),
  };
}

function connectSocket(config) {
  return new Promise((resolve, reject) => {
    const options = { host: config.host, port: config.port, rejectUnauthorized: !config.allowInsecureTls };
    const socket = config.secure
      ? tls.connect({ ...options, ...(net.isIP(config.host) === 0 ? { servername: config.host } : {}) })
      : net.connect(options);
    socket.setTimeout(SMTP_TIMEOUT_MS);
    socket.once(config.secure ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("smtp_connect_timeout"));
    });
    socket.once("error", reject);
  });
}

function upgradeToTls(socket, config) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({
      socket,
      ...(net.isIP(config.host) === 0 ? { servername: config.host } : {}),
      rejectUnauthorized: !config.allowInsecureTls,
    });
    secured.setTimeout(SMTP_TIMEOUT_MS);
    secured.once("secureConnect", () => resolve(secured));
    secured.once("timeout", () => {
      secured.destroy();
      reject(new Error("smtp_starttls_timeout"));
    });
    secured.once("error", reject);
  });
}

async function deliverViaSmtp(config, { envelopeFrom, envelopeTo, payload }) {
  const socket = await connectSocket(config);
  const channel = smtpChannel(socket);

  const greeting = await channel.readReply();
  if (greeting.code !== 220) throw new Error(`smtp_greeting_${greeting.code}`);

  const ehlo = async () => {
    channel.write(`EHLO ${process.env.SMTP_EHLO_NAME || "ouronex.local"}`);
    const reply = await channel.readReply();
    if (reply.code !== 250) throw new Error(`smtp_ehlo_${reply.code}`);
    return reply.lines.join("\n");
  };

  let capabilities = await ehlo();
  let usedStartTls = false;

  if (!config.secure && /STARTTLS/i.test(capabilities)) {
    channel.write("STARTTLS");
    const reply = await channel.readReply();
    if (reply.code === 220) {
      const secured = await upgradeToTls(socket, config);
      channel.attach(secured);
      capabilities = await ehlo();
      usedStartTls = true;
    }
  }

  if (config.user && /\bAUTH\b/i.test(capabilities)) {
    const advertised = (capabilities.match(/AUTH\s+([^\n]+)/i)?.[1] || "").toUpperCase();
    if (advertised.includes("PLAIN")) {
      const token = Buffer.from(`\u0000${config.user}\u0000${config.pass ?? ""}`, "utf8").toString("base64");
      channel.write(`AUTH PLAIN ${token}`);
      const reply = await channel.readReply();
      if (reply.code !== 235) throw new Error(`smtp_auth_${reply.code}`);
    } else if (advertised.includes("LOGIN")) {
      channel.write("AUTH LOGIN");
      let reply = await channel.readReply();
      if (reply.code !== 334) throw new Error(`smtp_auth_login_${reply.code}`);
      channel.write(Buffer.from(config.user, "utf8").toString("base64"));
      reply = await channel.readReply();
      if (reply.code !== 334) throw new Error(`smtp_auth_user_${reply.code}`);
      channel.write(Buffer.from(config.pass ?? "", "utf8").toString("base64"));
      reply = await channel.readReply();
      if (reply.code !== 235) throw new Error(`smtp_auth_pass_${reply.code}`);
    }
  }

  channel.write(`MAIL FROM:<${envelopeFrom}>`);
  let reply = await channel.readReply();
  if (reply.code !== 250) throw new Error(`smtp_mail_from_${reply.code}`);

  channel.write(`RCPT TO:<${envelopeTo}>`);
  reply = await channel.readReply();
  if (reply.code !== 250) throw new Error(`smtp_rcpt_to_${reply.code}`);

  channel.write("DATA");
  reply = await channel.readReply();
  if (reply.code !== 354) throw new Error(`smtp_data_${reply.code}`);

  channel.writeRaw(`${normalizeAndDotStuff(payload)}.\r\n`);
  reply = await channel.readReply();
  if (reply.code !== 250) throw new Error(`smtp_data_end_${reply.code}`);

  try {
    channel.write("QUIT");
    await channel.readReply();
  } catch {
    /* the server may hang up first; the message is already accepted */
  }
  channel.socket().end();

  return { tls: config.secure || usedStartTls };
}

/** The SMTP transport: one conversation per message, no pooling, no dependencies. */
const smtpDriver = {
  name: "smtp",
  async send({ to, subject, html, text, template, data }) {
    const parsed = parseSmtpUrl(process.env.SMTP_URL);
    if (!parsed.ok) throw new Error(parsed.reason);

    const from = process.env.MAIL_FROM || "OuroNex <no-reply@localhost>";
    const payload = buildEml({ from, to, subject, html, text, template, data, dryRun: false });
    const delivery = await deliverViaSmtp(parsed.config, {
      envelopeFrom: envelopeAddress(from),
      envelopeTo: to,
      payload,
    });

    return { ok: true, driver: "smtp", file: null, tls: delivery.tls, to, subject, template };
  },
};

/** Driver registry — the single extension point for a real transport. */
const DRIVERS = new Map([
  [dryRunDriver.name, dryRunDriver],
  [smtpDriver.name, smtpDriver],
]);

export function registerDriver(driver) {
  if (!driver || typeof driver.send !== "function" || !driver.name) {
    throw new Error("registerDriver expects { name, send() }");
  }
  DRIVERS.set(driver.name, driver);
  return driver.name;
}

export function activeDriverName() {
  return sanitizeHeaderValue(process.env.MAIL_DRIVER, "dry-run") || "dry-run";
}

export async function sendEmail({ to, subject, html, text, template, data } = {}) {
  const driverName = activeDriverName();
  const recipient = validateRecipient(to);
  if (!recipient.ok) {
    return { ok: false, reason: recipient.reason, driver: driverName, file: null };
  }

  const driver = DRIVERS.get(driverName);
  if (!driver) {
    return {
      ok: false,
      reason: `unknown_driver:${driverName}`,
      driver: driverName,
      file: null,
      knownDrivers: [...DRIVERS.keys()],
    };
  }

  // Transport configuration errors are reported here rather than thrown by the driver.
  if (driverName === "smtp") {
    const parsed = parseSmtpUrl(process.env.SMTP_URL);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason, driver: driverName, file: null };
    }
  }

  try {
    const result = await driver.send({
      to: recipient.address,
      subject: sanitizeHeaderValue(subject, "(no subject)"),
      html: String(html ?? ""),
      text: String(text ?? ""),
      template: sanitizeHeaderValue(template, "unknown"),
      data,
    });
    return {
      ok: true,
      driver: driver.name,
      file: result.file ?? null,
      htmlFile: result.htmlFile,
      ...(result.tls === undefined ? {} : { tls: result.tls }),
      to: recipient.address,
      subject: sanitizeHeaderValue(subject, "(no subject)"),
      template: sanitizeHeaderValue(template, "unknown"),
    };
  } catch (error) {
    return {
      ok: false,
      reason: `driver_error:${error && error.message ? error.message : "unknown"}`,
      driver: driver.name,
      file: null,
    };
  }
}

export default { sendEmail, registerDriver, activeDriverName, parseSmtpUrl, normalizeAndDotStuff, OUTBOX_DIR };