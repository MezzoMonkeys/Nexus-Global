// TEMPORARY diagnostic endpoint. DELETE THIS FILE once the deliverability
// question is settled - it is not part of the site.
//
// Why it exists: /api/enquiry can only ever send to ENQUIRY_TO, and answering
// "are these emails well-formed and deliverable" needs a copy delivered
// somewhere whose raw headers can be read and whose DKIM signature can be
// verified independently. This sends a byte-for-byte equivalent of a real
// enquiry notification to an analysable mailbox instead.
//
// Two things keep this from being an open relay, which is the obvious risk of
// any endpoint that sends mail to a caller-supplied address:
//   1. A bearer token, checked in constant time.
//   2. A recipient allowlist. Even holding the token, this can only send to the
//      disposable analysis mailbox or to Port25's public authentication
//      verifier - nowhere else, ever.
// The message body is fixed here too; nothing the caller sends is reflected
// into the email.

import { timingSafeEqual } from 'node:crypto';

const TOKEN = 'fef0eb93c86c435e8f12717db75aeff266e0aa78dcd6c239';

// Only these two destinations. Anything else is refused.
const ALLOWED = [
  /^[a-z0-9._%+-]+@emalupe\.com$/i,          // the disposable analysis mailbox
  /^check-auth@verifier\.port25\.com$/i,     // Port25's authentication reporter
];

const json = (status, body) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex, nofollow' },
});

const constantTimeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

async function handler(request) {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!constantTimeEqual(auth, TOKEN)) return json(401, { ok: false, error: 'Unauthorized' });

  if (!process.env.RESEND_API_KEY) return json(503, { ok: false, error: 'RESEND_API_KEY not set' });

  let body = {};
  try { body = await request.json(); } catch { /* defaults below */ }
  const to = String(body.to || '').trim();
  const replyTo = String(body.reply_to || '').trim();

  if (!ALLOWED.some(re => re.test(to))) {
    return json(400, { ok: false, error: 'Recipient not on the allowlist', to });
  }
  if (replyTo && !ALLOWED.some(re => re.test(replyTo))) {
    return json(400, { ok: false, error: 'reply_to not on the allowlist', replyTo });
  }

  // Deliberately identical in shape to what api/enquiry.js sends: same From, the
  // same subject pattern, the same inline-styled table. Testing a differently
  // shaped message would tell us nothing about the real one.
  const FROM = process.env.ENQUIRY_FROM || 'Nexus Global <website@nexusconnecthk.com>';
  const fields = [
    ['Name', 'Sarah Whitfield'],
    ['Company', 'Whitfield Bathware Ltd'],
    ['Email', 's.whitfield@example.com'],
    ['Phone', '+44 20 7946 0958'],
    ['They are a', 'Retailer'],
    ['Nature of enquiry', 'Private Label'],
    ['Message', 'We stock bathroom fittings across 14 UK showrooms and are looking for a private label manufacturing partner for a mid-range mixer tap range. Could someone send over your capabilities and minimum order quantities?'],
  ];
  const rows = fields.map(([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><strong>${k}</strong></td>` +
    `<td style="padding:4px 0">${v}</td></tr>`).join('');

  const payload = {
    from: FROM,
    to: [to],
    subject: 'Website enquiry, Private Label, Whitfield Bathware Ltd',
    html: `<table style="font-family:system-ui,sans-serif;font-size:14px">${rows}</table>`,
    text: fields.map(([k, v]) => `${k}: ${v}`).join('\n'),
    ...(replyTo ? { reply_to: replyTo } : {}),
  };

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* return raw below */ }

  // Echo Resend's own answer back, including the From actually used and whether
  // the key is domain-scoped correctly - a 403 here would say the API key is
  // not permitted to send from this domain, which is exactly the kind of thing
  // worth knowing explicitly rather than inferring.
  return json(r.ok ? 200 : 502, {
    ok: r.ok,
    resend_status: r.status,
    resend_response: parsed || text.slice(0, 500),
    from_used: FROM,
    to,
    reply_to: replyTo || null,
  });
}

export default { fetch: handler };
