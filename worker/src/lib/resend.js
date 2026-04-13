/**
 * Resend email delivery for Cloudflare Workers.
 * Uses Resend's REST API via fetch (no npm package needed).
 *
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 *
 * @param {object} opts
 * @param {string}   opts.apiKey          - RESEND_API_KEY env var
 * @param {string}   opts.fromAddress     - Verified sender e.g. "alerts@yourdomain.com"
 * @param {string[]} opts.to              - Array of recipient emails
 * @param {string}   opts.subject         - Email subject
 * @param {string}   opts.html            - HTML body
 * @param {string}   [opts.text]          - Plain-text fallback
 * @returns {Promise<string>}             - Resend message ID on success
 */
export async function sendViaResend({ apiKey, fromAddress, to, subject, html, text }) {
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  if (!fromAddress) throw new Error("RESEND_FROM_ADDRESS is not configured");

  const payload = {
    from: fromAddress,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(text ? { text } : {}),
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || data?.name || `Resend API error ${response.status}`;
    throw new Error(message);
  }

  return data?.id || "sent";
}
