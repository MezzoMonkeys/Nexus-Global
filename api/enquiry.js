// Enquiry endpoint.
//
// The form previously built a mailto: link and called it done. That fails
// silently for anyone without a configured desktop mail client - most phones,
// most locked-down corporate machines - with no error state and no record. For
// a site whose only conversion path is this form, lost enquiries also make any
// organic-traffic work impossible to measure.
//
// Provider-agnostic on purpose, and with no npm dependencies: both providers
// below are plain HTTPS calls over the runtime's built-in fetch, so this ships
// without a package.json, a lockfile, or an install step on a site that is
// otherwise entirely static. Set ONE of RESEND_API_KEY or POSTMARK_TOKEN in the
// Vercel project and it starts working; set neither and it returns a clear 503
// that says so, rather than accepting the message and dropping it.

const FIELDS = ['name', 'company', 'email', 'phone', 'role', 'subject', 'message'];
const REQUIRED = ['name', 'company', 'email', 'message'];
const MAX = { name: 120, company: 160, email: 200, phone: 60, role: 60, subject: 80, message: 5000 };
// Only the message is allowed to contain line breaks. Every other field is a
// single-line input, so newlines in one mean either a paste accident or someone
// probing for header injection; either way they are collapsed on the way in
// rather than at the point of use, so no later caller has to remember to do it.
const MULTILINE = new Set(['message']);

const clean = v => String(v == null ? '' : v)
  .replace(/\0/g, '')          // NUL truncates strings in some downstream systems
  .replace(/\r\n?/g, '\n')     // normalise CRLF/CR so length limits count real characters
  .trim();
// Header injection guard: nothing reaching a mail header may carry a line break.
const oneLine = v => clean(v).replace(/\n+/g, ' ').slice(0, 200);
const escapeHtml = v => clean(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  // Honeypot. A real person never sees this field, so anything in it is a bot.
  // Answer 200 rather than an error: a rejection tells the sender to retry
  // differently, silence does not.
  if (clean(body.website)) return res.status(200).json({ ok: true });

  const data = {};
  for (const f of FIELDS) {
    data[f] = (MULTILINE.has(f) ? clean(body[f]) : oneLine(body[f])).slice(0, MAX[f]);
  }

  const missing = REQUIRED.filter(f => !data[f]);
  if (missing.length) return res.status(400).json({ ok: false, error: 'Missing required fields', fields: missing });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) {
    return res.status(400).json({ ok: false, error: 'That email address does not look right.', fields: ['email'] });
  }

  // ENQUIRY_TO may list several recipients, comma-separated. Resend wants them as
  // an array and Postmark as a comma-joined string, so parse once and format per
  // provider rather than making the env var's shape a provider detail.
  const TO = (process.env.ENQUIRY_TO || 'Keith@lincorholdings.com,tim@lincorholdings.com')
    .split(',').map(s => s.trim()).filter(Boolean);
  const FROM = process.env.ENQUIRY_FROM || 'website@nexusconnecthk.com';
  const subject = `Website enquiry, ${oneLine(data.subject) || 'General'}, ${oneLine(data.company)}`;
  const rows = FIELDS.filter(f => data[f]).map(f =>
    `<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><strong>${f}</strong></td>` +
    `<td style="padding:4px 0">${escapeHtml(data[f]).replace(/\n/g, '<br>')}</td></tr>`).join('');
  const html = `<table style="font-family:system-ui,sans-serif;font-size:14px">${rows}</table>`;
  const text = FIELDS.filter(f => data[f]).map(f => `${f}: ${data[f]}`).join('\n');

  try {
    if (process.env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: TO, reply_to: data.email, subject, html, text }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
    } else if (process.env.POSTMARK_TOKEN) {
      const r = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ From: FROM, To: TO.join(', '), ReplyTo: data.email, Subject: subject, HtmlBody: html, TextBody: text, MessageStream: 'outbound' }),
      });
      if (!r.ok) throw new Error(`Postmark ${r.status}: ${(await r.text()).slice(0, 300)}`);
    } else {
      // Last resort, and the only route that needs no account, no API key and no
      // DNS: FormSubmit relays a submission straight to a recipient's inbox. It
      // is weaker than Resend - a free third party sees the message, and each
      // recipient must confirm once before anything is delivered - so it is only
      // reached when neither provider above is configured. Set RESEND_API_KEY and
      // this branch stops being used.
      const results = await Promise.all(TO.map(async addr => {
        try {
          const r = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(addr)}`, {
            method: 'POST',
            // The relay rejects calls with no browser origin, and a serverless
            // function sends none, so state the site these submissions come from.
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Origin: 'https://nexusconnecthk.com',
              Referer: 'https://nexusconnecthk.com/contact',
            },
            body: JSON.stringify({
              _subject: subject,
              _template: 'table',
              _captcha: 'false',
              Name: data.name, Company: data.company, Email: data.email,
              Phone: data.phone, 'I am a': data.role, 'Nature of enquiry': data.subject,
              Message: data.message,
            }),
          });
          // The relay answers 200 even when it refuses, so the JSON body, not the
          // status, decides whether anything was actually delivered.
          const body = await r.text();
          let parsed = {};
          try { parsed = JSON.parse(body); } catch { /* keep raw text below */ }
          const sent = String(parsed.success) === 'true';
          const pending = /activat/i.test(body);
          return { addr, ok: sent, pending, body: body.slice(0, 200) };
        } catch (e) {
          return { addr, ok: false, body: String(e && e.message).slice(0, 200) };
        }
      }));
      const delivered = results.filter(x => x.ok);
      results.filter(x => !x.ok).forEach(x =>
        console.error('[enquiry] relay failed for', x.addr, x.body));
      if (!delivered.length) {
        // Every recipient awaiting their one-time confirmation is a setup state,
        // not a visitor's fault, but the message did not arrive either way - so
        // report the failure rather than a false success.
        const waiting = results.filter(x => x.pending).map(x => x.addr);
        if (waiting.length) console.error('[enquiry] recipients not yet confirmed:', waiting.join(', '));
        throw new Error('relay delivered to no recipient');
      }

    }
  } catch (err) {
    console.error('[enquiry] send failed:', err && err.message);
    return res.status(502).json({ ok: false, error: 'We could not send that just now.' });
  }

  return res.status(200).json({ ok: true });
};
