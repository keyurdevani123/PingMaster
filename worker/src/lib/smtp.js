/**
 * Gmail SMTP client for Cloudflare Workers using cloudflare:sockets.
 * Connects to smtp.gmail.com:587, upgrades to TLS via STARTTLS,
 * authenticates with AUTH LOGIN, then sends the message.
 *
 * @param {Object} opts
 * @param {string} opts.user        - Gmail address (EMAIL_USER env var)
 * @param {string} opts.pass        - Gmail app password (EMAIL_PASS env var)
 * @param {string[]} opts.to        - Array of recipient email addresses
 * @param {string} opts.subject     - Email subject line
 * @param {string} opts.html        - HTML body
 * @param {string} opts.text        - Plain-text body (fallback)
 */
export async function sendViaGmail({ user, pass, to, subject, html, text }) {
  // Dynamic import so the module still loads in non-Worker environments
  const { connect } = await import("cloudflare:sockets");

  const socket = connect({ hostname: "smtp.gmail.com", port: 587 }, { secureTransport: "starttls" });

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  // Helper: read one or more lines until a line without a dash after the status code
  async function read() {
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      // SMTP multi-line: "250-..." lines end with a final "250 ..." line
      const lines = buf.split("\r\n");
      const last = lines.filter(Boolean).pop() || "";
      // A complete response line: 3 digits + space (not dash)
      if (/^\d{3} /.test(last)) break;
    }
    return buf;
  }

  async function cmd(line) {
    await writer.write(enc.encode(line + "\r\n"));
    return read();
  }

  function assertOk(response, ...codes) {
    const code = parseInt(response.slice(0, 3), 10);
    if (!codes.includes(code)) {
      throw new Error(`SMTP error: ${response.trim()}`);
    }
  }

  // ── Plain connection ──────────────────────────────────────────────────────
  const greeting = await read();
  assertOk(greeting, 220);

  assertOk(await cmd(`EHLO pingmaster`), 250);
  assertOk(await cmd("STARTTLS"), 220);

  // ── Upgrade to TLS ───────────────────────────────────────────────────────
  reader.releaseLock();
  writer.releaseLock();

  const tlsSocket = socket.startTls({ expectedServerHostname: "smtp.gmail.com" });
  const tlsReader = tlsSocket.readable.getReader();
  const tlsWriter = tlsSocket.writable.getWriter();

  async function tlsRead() {
    let buf = "";
    while (true) {
      const { value, done } = await tlsReader.read();
      if (done) break;
      buf += dec.decode(value);
      const lines = buf.split("\r\n");
      const last = lines.filter(Boolean).pop() || "";
      if (/^\d{3} /.test(last)) break;
    }
    return buf;
  }

  async function tlsCmd(line) {
    await tlsWriter.write(enc.encode(line + "\r\n"));
    return tlsRead();
  }

  assertOk(await tlsCmd("EHLO pingmaster"), 250);

  // ── AUTH LOGIN ───────────────────────────────────────────────────────────
  assertOk(await tlsCmd("AUTH LOGIN"), 334);
  assertOk(await tlsCmd(btoa(user)), 334);
  assertOk(await tlsCmd(btoa(pass)), 235);

  // ── Envelope ─────────────────────────────────────────────────────────────
  assertOk(await tlsCmd(`MAIL FROM:<${user}>`), 250);

  for (const addr of to) {
    assertOk(await tlsCmd(`RCPT TO:<${addr}>`), 250);
  }

  // ── DATA ─────────────────────────────────────────────────────────────────
  assertOk(await tlsCmd("DATA"), 354);

  const boundary = `pm_${Date.now()}_boundary`;
  const fromName = "PingMaster Alerts";
  const toHeader = to.join(", ");
  const dateHeader = new Date().toUTCString();

  const message = [
    `From: "${fromName}" <${user}>`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    `Date: ${dateHeader}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    encodeBase64(text || ""),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    encodeBase64(html || ""),
    ``,
    `--${boundary}--`,
    ``,
    `.`,
  ].join("\r\n");

  assertOk(await tlsCmd(message), 250);
  await tlsCmd("QUIT");

  tlsReader.releaseLock();
  tlsWriter.releaseLock();
  await tlsSocket.close();
}

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(String(str || ""));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  const chunks = [];
  for (let i = 0; i < base64.length; i += 76) {
    chunks.push(base64.slice(i, i + 76));
  }
  return chunks.join("\r\n");
}
