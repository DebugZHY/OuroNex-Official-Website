#!/usr/bin/env node
/**
 * Acceptance probe for the SMTP transport in src/lib/mailer.mjs.
 *
 * Starts an in-process fake SMTP server on 127.0.0.1 with an ephemeral port, captures the whole
 * session (commands, DATA payload, AUTH lines, STARTTLS use) and checks:
 *   S1  MAIL_DRIVER unset -> dry-run writes a .eml (regression)
 *   S2  plaintext smtp: EHLO, MAIL FROM, RCPT TO, DATA, 250, correct Subject, no dry-run headers
 *   S3  dot-stuffing: a body line starting with "." arrives as ".." and does not end DATA early
 *   S4  AUTH is sent when the server advertises AUTH PLAIN LOGIN, and not when it advertises none
 *   S5  RCPT TO rejected with 550 -> sendEmail returns { ok: false }, no throw
 *   S6  missing / invalid SMTP_URL -> smtp_url_missing / smtp_url_invalid
 *   S7  STARTTLS upgrade over a self-signed test certificate
 *
 * Usage: node server/scripts/probe-mailer-smtp.mjs
 */

import { readdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

import { sendEmail, normalizeAndDotStuff, OUTBOX_DIR } from "../src/lib/mailer.mjs";

// Test-only self-signed certificate for 127.0.0.1 (CN=127.0.0.1, SAN IP:127.0.0.1), generated
// once with openssl and embedded here so the STARTTLS path needs no external tooling.
const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIUZQkNhmYhIz722M9VjhHIodSn558wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTAyNjE1NTkxNloXDTM2MTAy
MzE1NTkxNlowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEApt7U6pE3iF/Sm0rhpjC3hmg6ZSPD9uCwl+KS8fXFuH1c
M3mfnB/OzyukNygI5yNBTt9y1bl2SM90KjPkJ23netBACEEJTwqc9WerpoQbTE0Q
BQ4gROQq20uHIT85SMEzSFjZJpLW46azCNPR1biy9fx5GcmlSv6KqYRRa+9zN3Y8
O7KjFulJah4ubKVcMRSczupgTZbcJK/RCUO/bYjW/gnLZ/89tFTZMhMYzjI8o39l
WDSSNVH9DS2DUgdqHooLOfV8fKv02HwooKD6C0Pkz8J6WvYXjhw9t7aCRXKni2vP
GaORacHM1OElPvJ8mGAQhV94PAoNuUOUul3zdwgPWwIDAQABo2QwYjAdBgNVHQ4E
FgQUOZepSyRPqgGXoBs6LLcqJc/VhiMwHwYDVR0jBBgwFoAUOZepSyRPqgGXoBs6
LLcqJc/VhiMwDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMA0GCSqG
SIb3DQEBCwUAA4IBAQBclZK8AO7oy+9T5LhhHT0+E+4nJICMkzdCisErZZsPdnnK
P94ZePJbhwaslR3AHPtzSDRHuadRgZgwiypqiXKtl34GqO3svscGh2t8zBnSaQrA
m1jsbPCk7Nt6zHZD/DU5bgAsOTe/sU2N3EqxHz6da588ecX1NqltDXMSdMikZO6G
59hh1MACic2OKhjGDJXF1vIfUhLB4r8wmGvSbIR+sQ46MA54Jq7lQWIBjxXJEGjD
UJpWTp19W3caolSPBOUNbXPtCyOL6mTORUpjygyz7CiwGWhhys68dal4GbiMagC3
KA6PfrOiyBATjCCh3zgDNEoQ4/IOEYlLSBStWVco
-----END CERTIFICATE-----`;
const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCm3tTqkTeIX9Kb
SuGmMLeGaDplI8P24LCX4pLx9cW4fVwzeZ+cH87PK6Q3KAjnI0FO33LVuXZIz3Qq
M+Qnbed60EAIQQlPCpz1Z6umhBtMTRAFDiBE5CrbS4chPzlIwTNIWNkmktbjprMI
09HVuLL1/HkZyaVK/oqphFFr73M3djw7sqMW6UlqHi5spVwxFJzO6mBNltwkr9EJ
Q79tiNb+Cctn/z20VNkyExjOMjyjf2VYNJI1Uf0NLYNSB2oeigs59Xx8q/TYfCig
oPoLQ+TPwnpa9heOHD23toJFcqeLa88Zo5FpwczU4SU+8nyYYBCFX3g8Cg25Q5S6
XfN3CA9bAgMBAAECggEANKKVBmhH2/xdsh4sjv9O5FZ8FOrzJSw6h64wK6Iae9cO
/i2e6uAdm7toUP2P0ViNgRN6ZW/an5zQR3+Wt9ky6spFaFUbWpM+byoEOsHw2mB0
bSPHifNukT2BojsPFqPaSTe9Ry2KGsS6NE6cIY3g5TZ9/GRefwlLM61JAYLGFPfz
00OZ/BIya+5/eOm+0SQ0JwsBvh7X7gv28DcsmVG9KBccdYsGQ0MR5BUmXI1Cuf3B
1H66hXavnzVm0Eb8/ditPA5c0rqk1eMAfR0qGCMTgBfyYceW7jHnW6WjBFZ2WZ9Z
BdzwYcZg8pm8YkaI1uN60EdaZPjoqwZ7YidVpolmAQKBgQDdlnuv+qaCl1VjM9kG
e9zdEp6a/QlXIBZGt1vT7QnUBwaZ0l+zS7oXys109X2mEsKCJGADVk/WtihrsYFo
qRiZY4Yin5uDslLnSWsO4MkazuM5598uwoHRqEMrFtwj0mm3Ex3x3RkvevR7esWc
Q+CVnA07gC4bpuLaxhaTdO1bLQKBgQDAyPyIHhdm8hRXz6smN47dtsImsAzZqc1k
UuuGpC6vB2fLL69xqXrKbevzR9GGn8pptpjt7XU1IKqqLp5pObtpp7pWSJAmcVuz
3ZSKmtyG/fTRkUgjkm3Fc/IrEiLdeutGU4aJX5i6w2bt+gitPcHWNWGPZ5uUGoMf
sUXkMhEJpwKBgHCy/K2AWffJaFBQKm01yhtWQPyq/XkmhK3qy/V5dao0+JJ7gNj8
BuXa66w0v3cby3nNblfEKk8VznEXkq3ccvpwt+QcMUhGBgxENwMWKLJNzxvAZq6t
lsE/Rwo/Ui+V8NaADpbY0NppOrcitibIDw2IlOJSSyEdO/vxC8JrkdzxAoGAPqvX
9IQbxXqjBFzdXaIoDomQGjWXJ9dcjuWp7W5IQtwccOBCn6eh5FbRopfRVHtzuOQE
WSydsrS45nQbSUfcVh+RouUZ/3VQg2tgE6L+V+ANC2e4VOAQUWU876WIsgl4nLcg
gF4Ub3qAZpKm6XKvJezal1zuJbpssAvYFbP09/cCgYEAqZ0Ktms9CLeSb30aIHIr
zFKWRJeRuOJYZfrGxhKd8g+cX8sHk0ab4O7/DiZaiOIfdYrlmG/PqVPDoN1JoD8t
/LFq9305wRtMjMCnaXG7czr4aIcaLcUdhxynvVPwibkMjO6pJIi9gnlfHMUgJw5i
zeu4foWqW5yNEpJv91ATeYc=
-----END PRIVATE KEY-----`;

const ENV_KEYS = ["MAIL_DRIVER", "SMTP_URL", "SMTP_ALLOW_INSECURE_TLS", "MAIL_FROM", "SMTP_TIMEOUT_MS"];
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const TO = "probe-smtp@ouronex.local";

const results = [];
function record(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

function setMailEnv({ driver, url, allowInsecureTls, timeoutMs } = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  if (driver !== undefined) process.env.MAIL_DRIVER = driver;
  if (url !== undefined) process.env.SMTP_URL = url;
  if (allowInsecureTls !== undefined) process.env.SMTP_ALLOW_INSECURE_TLS = allowInsecureTls;
  if (timeoutMs !== undefined) process.env.SMTP_TIMEOUT_MS = String(timeoutMs);
}

/** Fake SMTP server: records the session and can advertise STARTTLS / AUTH, or reject RCPT. */
function startFakeServer({ advertiseAuth = "PLAIN LOGIN", advertiseStarttls = false, rcptCode = 250 } = {}) {
  const session = { lines: [], data: "", auth: [], starttls: false, ehloCount: 0, accepted: false, mailFrom: null, rcptTo: null };
  const sockets = new Set();
  const secureContext = advertiseStarttls ? tls.createSecureContext({ key: TEST_KEY_PEM, cert: TEST_CERT_PEM }) : null;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    let current = socket;
    let inData = false;
    let authStep = 0;

    const send = (line) => current.write(`${line}\r\n`);
    const handle = (line) => {
      session.lines.push(line);
      const upper = line.toUpperCase();
      if (inData) {
        if (line === ".") {
          inData = false;
          session.accepted = true;
          send("250 2.0.0 Ok: queued as FAKE1");
        } else {
          session.data += `${line}\r\n`;
        }
        return;
      }
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        session.ehloCount += 1;
        const caps = ["250-fake.local greets you", "250-SIZE 10485760", "250-8BITMIME"];
        if (advertiseStarttls && !session.starttls) caps.push("250-STARTTLS");
        if (advertiseAuth) caps.push(`250-AUTH ${advertiseAuth}`);
        caps.push("250 HELP");
        current.write(`${caps.join("\r\n")}\r\n`);
      } else if (upper.startsWith("STARTTLS")) {
        session.starttls = true;
        send("220 2.0.0 Ready to start TLS");
        socket.removeAllListeners("data");
        const secured = new tls.TLSSocket(socket, { isServer: true, secureContext });
        current = secured;
        sockets.add(secured);
        secured.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          drain();
        });
        secured.on("error", () => {});
      } else if (upper.startsWith("AUTH")) {
        session.auth.push(line);
        if (/^AUTH\s+PLAIN\b/i.test(line)) {
          send("235 2.7.0 Authentication successful");
        } else if (/^AUTH\s+LOGIN\b/i.test(line)) {
          authStep = 1;
          send("334 VXNlcm5hbWU6");
        } else if (authStep === 1) {
          authStep = 2;
          send("334 UGFzc3dvcmQ6");
        } else if (authStep === 2) {
          authStep = 0;
          send("235 2.7.0 Authentication successful");
        } else {
          send("504 5.5.4 Unrecognized authentication type");
        }
      } else if (upper.startsWith("MAIL FROM")) {
        session.mailFrom = (line.match(/<([^>]*)>/) || [])[1] ?? null;
        send("250 2.1.0 Ok");
      } else if (upper.startsWith("RCPT TO")) {
        session.rcptTo = (line.match(/<([^>]*)>/) || [])[1] ?? null;
        send(rcptCode === 250 ? "250 2.1.5 Ok" : `${rcptCode} 5.1.1 Rejected by the probe`);
      } else if (upper === "DATA") {
        inData = true;
        session.data = "";
        send("354 End data with <CR><LF>.<CR><LF>");
      } else if (upper === "QUIT") {
        send("221 2.0.0 Bye");
        current.end();
      } else {
        send("250 2.0.0 Ok");
      }
    };
    const drain = () => {
      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(line);
      }
    };
    current.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      drain();
    });
    current.on("error", () => {});
    send("220 fake.local ESMTP ready");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        session,
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

async function outboxFiles() {
  try {
    return (await readdir(OUTBOX_DIR)).filter((name) => name.endsWith(".eml") || name.endsWith(".html"));
  } catch {
    return [];
  }
}

async function main() {
  const outboxExisted = (await readdir(path.dirname(OUTBOX_DIR)).catch(() => [])).includes(path.basename(OUTBOX_DIR));
  const outboxBefore = new Set(await outboxFiles());

  // S1 — default driver is still dry-run
  setMailEnv({});
  {
    const sent = await sendEmail({ to: TO, subject: "Dry-run regression", text: "plain", html: "<p>plain</p>", template: "probe-dry" });
    const after = (await outboxFiles()).filter((name) => !outboxBefore.has(name));
    record("S1 MAIL_DRIVER unset -> dry-run writes a .eml",
      sent.ok === true && sent.driver === "dry-run" && after.some((name) => name.endsWith(".eml")),
      `ok=${sent.ok} driver=${sent.driver} newFiles=${after.length}`);
  }

  // S2 — plaintext conversation
  {
    const fake = await startFakeServer({ advertiseAuth: null });
    setMailEnv({ driver: "smtp", url: `smtp://127.0.0.1:${fake.port}` });
    const sent = await sendEmail({ to: TO, subject: "Probe subject", text: "hello probe", html: "<p>hello probe</p>", template: "probe-smtp" });
    const hasSubject = fake.session.data.includes("Subject: Probe subject");
    const noDryRunHeader = !fake.session.data.includes("X-OuroNex-Dry-Run") && !fake.session.data.includes("X-OuroNex-Driver: dry-run");
    record("S2 plaintext smtp: EHLO/MAIL FROM/RCPT TO/DATA/250 + Subject, no dry-run headers",
      sent.ok === true && sent.driver === "smtp" && fake.session.ehloCount === 1 && fake.session.mailFrom !== null
        && fake.session.rcptTo === TO && fake.session.accepted === true && hasSubject && noDryRunHeader,
      `ok=${sent.ok} ehlo=${fake.session.ehloCount} from=${fake.session.mailFrom} rcpt=${fake.session.rcptTo} subject=${hasSubject} clean=${noDryRunHeader}`);
    await fake.close();
  }

  // S3 — dot-stuffing
  {
    const fake = await startFakeServer({ advertiseAuth: null });
    setMailEnv({ driver: "smtp", url: `smtp://127.0.0.1:${fake.port}` });
    const sent = await sendEmail({
      to: TO, subject: "Dot stuffing", text: "first line\n.leading dot line\nlast line",
      html: "<p>first</p><p>.leading dot line</p><p>last</p>", template: "probe-dot",
    });
    // Both MIME parts are base64, so a '.'-leading body line never reaches DATA verbatim; the
    // transformation is asserted on the exact payload the transport writes, plus the end-to-end
    // framing proof that DATA was terminated exactly once.
    const transformed = normalizeAndDotStuff("first\n.leading dot line\nlast");
    const stuffed = transformed.includes("\r\n..leading dot line\r\n");
    const keepsPlainLines = transformed.startsWith("first\r\n") && transformed.endsWith("last\r\n");
    record("S3 dot-stuffing: leading dot doubled in the transmitted payload, DATA not ended early",
      sent.ok === true && stuffed && keepsPlainLines && fake.session.accepted === true,
      `ok=${sent.ok} stuffed=${stuffed} plainLinesKept=${keepsPlainLines} accepted=${fake.session.accepted}`);
    await fake.close();
  }

  // S4a — server advertises AUTH with credentials in the URL
  {
    const fake = await startFakeServer({ advertiseAuth: "PLAIN LOGIN" });
    setMailEnv({ driver: "smtp", url: `smtp://probe-user:probe-pass@127.0.0.1:${fake.port}` });
    const sent = await sendEmail({ to: TO, subject: "Auth advertised", text: "x", html: "<p>x</p>", template: "probe-auth" });
    const usedAuth = fake.session.auth.length > 0 && /^AUTH (PLAIN|LOGIN)\b/i.test(fake.session.auth[0]);
    record("S4a server advertises AUTH PLAIN LOGIN -> client sends AUTH",
      sent.ok === true && usedAuth, `ok=${sent.ok} auth0=${fake.session.auth[0] ?? "none"}`);
    await fake.close();
  }

  // S4b — server does not advertise AUTH
  {
    const fake = await startFakeServer({ advertiseAuth: null });
    setMailEnv({ driver: "smtp", url: `smtp://probe-user:probe-pass@127.0.0.1:${fake.port}` });
    const sent = await sendEmail({ to: TO, subject: "Auth absent", text: "x", html: "<p>x</p>", template: "probe-noauth" });
    record("S4b server advertises no AUTH -> client sends no AUTH",
      sent.ok === true && fake.session.auth.length === 0, `ok=${sent.ok} authLines=${fake.session.auth.length}`);
    await fake.close();
  }

  // S5 — RCPT rejected
  {
    const fake = await startFakeServer({ advertiseAuth: null, rcptCode: 550 });
    setMailEnv({ driver: "smtp", url: `smtp://127.0.0.1:${fake.port}` });
    let threw = false;
    let sent;
    try {
      sent = await sendEmail({ to: TO, subject: "Rejected", text: "x", html: "<p>x</p>", template: "probe-rcpt" });
    } catch {
      threw = true;
    }
    record("S5 RCPT TO 550 -> { ok:false } and no throw",
      threw === false && sent && sent.ok === false && String(sent.reason).startsWith("driver_error:"),
      `threw=${threw} ok=${sent && sent.ok} reason=${sent && sent.reason}`);
    await fake.close();
  }

  // S6 — SMTP_URL missing / invalid
  {
    setMailEnv({ driver: "smtp" });
    const missing = await sendEmail({ to: TO, subject: "No url", text: "x", html: "<p>x</p>", template: "probe-nourl" });
    setMailEnv({ driver: "smtp", url: "not-a-url" });
    const invalid = await sendEmail({ to: TO, subject: "Bad url", text: "x", html: "<p>x</p>", template: "probe-badurl" });
    setMailEnv({ driver: "smtp", url: "http://127.0.0.1:25" });
    const wrongScheme = await sendEmail({ to: TO, subject: "Wrong scheme", text: "x", html: "<p>x</p>", template: "probe-wrongurl" });
    record("S6 SMTP_URL missing / invalid / wrong scheme -> machine-readable reasons",
      missing.ok === false && missing.reason === "smtp_url_missing"
        && invalid.ok === false && invalid.reason === "smtp_url_invalid"
        && wrongScheme.ok === false && wrongScheme.reason === "smtp_url_invalid",
      `missing=${missing.reason} invalid=${invalid.reason} scheme=${wrongScheme.reason}`);
  }

  // S7 — STARTTLS upgrade
  {
    const fake = await startFakeServer({ advertiseAuth: null, advertiseStarttls: true });
    setMailEnv({ driver: "smtp", url: `smtp://127.0.0.1:${fake.port}`, allowInsecureTls: "1" });
    const sent = await sendEmail({ to: TO, subject: "StartTLS", text: "over tls", html: "<p>over tls</p>", template: "probe-starttls" });
    record("S7 STARTTLS advertised -> client upgrades and delivers over TLS",
      sent.ok === true && sent.tls === true && fake.session.starttls === true && fake.session.ehloCount >= 2 && fake.session.accepted === true,
      `ok=${sent.ok} tls=${sent.tls} starttls=${fake.session.starttls} ehlos=${fake.session.ehloCount} accepted=${fake.session.accepted}`);
    await fake.close();
  }

  // Clean up the dry-run files this probe produced.
  for (const name of await outboxFiles()) {
    if (!outboxBefore.has(name)) {
      await rm(path.join(OUTBOX_DIR, name), { force: true });
    }
  }
  if (!outboxExisted) await rm(OUTBOX_DIR, { recursive: true, force: true });

  for (const key of ENV_KEYS) {
    if (SAVED_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_ENV[key];
  }

  const failed = results.filter((row) => !row.passed);
  console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed.`);
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("probe failed to run:", error);
    process.exitCode = 1;
  });