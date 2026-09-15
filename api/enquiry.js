// Enquiry endpoint.
//
// The form previously built a mailto: link and called it done. That fails
// silently for anyone without a configured desktop mail client - most phones,
// most locked-down corporate machines - with no error state and no record. For
// a site whose only conversion path is this form, lost enquiries also make any
// organic-traffic work impossible to measure.
//
// Two steps, in this order: log the enquiry to Supabase, then send it through
// Resend. Logging first is the whole point of logging - if Resend is down, or
// the mail bounces off both inboxes, the enquiry still exists somewhere we can
// go and read it. The reverse order would leave a failed send with nothing to
// show for it.
//
// No npm dependencies: both calls are plain HTTPS over the runtime's built-in
// fetch, so this ships without a package.json, a lockfile, or an install step
// on a site that is otherwise entirely static.

const FIELDS = ['name', 'company', 'email', 'phone', 'role', 'subject', 'message'];
const REQUIRED = ['name', 'company', 'email', 'message'];
const MAX = { name: 120, company: 160, email: 200, phone: 60, role: 60, subject: 80, message: 5000 };
// Only the message is allowed to contain line breaks. Every other field is a
// single-line input, so newlines in one mean either a paste accident or someone
// probing for header injection; either way they are collapsed on the way in
// rather than at the point of use, so no later caller has to remember to do it.
const MULTILINE = new Set(['message']);

// Human labels for the notification email. The column names are fine in a
// database and terse in an inbox.
const LABELS = {
  name: 'Name',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  role: 'They are a',
  subject: 'Nature of enquiry',
  message: 'Message',
};

// Nothing here should ever take long enough to hold a serverless invocation
// open. A hung upstream is a failure, so give each call a deadline of its own.
// Three of these run back to back in the worst case (insert, send, patch), so
// the total has to stay comfortably inside the maxDuration set for api/** in
// vercel.json - otherwise a slow upstream hands the visitor a 504 after the
// mail has already gone, which is the one outcome with no recovery path.
const TIMEOUT_MS = 6000;

// Timing trap. main.js stamps `ts` with Date.now() as soon as the form is
// interactive; a submission that lands sooner than a person could plausibly
// have read the form and typed into it is a script, not a visitor. 2.5s is
// generous - it is well under how long even a fast human takes on a form with
// six required-ish fields, chosen to keep false positives at effectively zero
// rather than to catch every bot.
const MIN_FILL_MS = 2500;

const clean = v => String(v == null ? '' : v)
  .replace(/\0/g, '')          // NUL truncates strings in some downstream systems
  .replace(/\r\n?/g, '\n')     // normalise CRLF/CR so length limits count real characters
  .trim();
// Header injection guard: nothing reaching a mail header may carry a line break.
const oneLine = v => clean(v).replace(/\n+/g, ' ').slice(0, 200);
const escapeHtml = v => clean(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Supabase, over PostgREST. The service role key bypasses RLS, which is exactly
// what this table needs: it carries no policies, so an enquirer's message and
// contact details stay invisible to the platform's logged-in factories and
// clients even if one of their keys leaks.
//
// Supabase has two generations of secret key and they want different headers.
// The legacy service_role key is a JWT (eyJ...) and goes in both apikey and
// Authorization, as everything has always done. The newer sb_secret_... keys
// are opaque, not JWTs, and are *rejected* on an Authorization: Bearer header -
// they must travel on apikey alone. Sniffing the format means either key works
// and whoever sets the env var cannot pick the wrong one.
//
// Three lines of this are duplicated in resend-webhook.mjs rather than shared:
// every file under api/ is deployed as its own function, so a shared module
// there would become a third public endpoint.
const sbHeaders = key => ({
  apikey: key,
  ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
  'Content-Type': 'application/json',
});

const sb = async (path, init) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...sbHeaders(key),
      ...(init && init.headers),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
};

// Cloudflare Turnstile. Unlike the honeypot and timing trap, this is a widget
// the visitor can see solve itself, so a failure here is told to them plainly
// and they are invited to retry - silence would just look like a broken form.
// remoteip is best-effort: Vercel's forwarded-for can hold a list or be
// absent behind some proxies, and Cloudflare accepts the field being omitted.
const verifyTurnstile = async (token, ip) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('[enquiry] TURNSTILE_SECRET_KEY is not set; refusing to accept a message we cannot verify');
    return false;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await r.json();
    return j && j.success === true;
  } catch (err) {
    console.error('[enquiry] Turnstile verification failed:', err && err.message);
    return false;
  }
};

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
  // differently, silence does not. Nothing is logged or sent.
  if (clean(body.website)) return res.status(200).json({ ok: true });

  // Timing trap. Same silent-200 treatment as the honeypot, and for the same
  // reason: a script hitting this endpoint directly never sends `ts` at all,
  // and one replaying main.js's own timestamp still cannot make the *request*
  // arrive later than it actually did.
  const elapsed = Date.now() - Number(body.ts);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) return res.status(200).json({ ok: true });

  // Turnstile. The one check a genuine visitor can see and retry, so it gets
  // a real error rather than a silent success.
  const ip = oneLine(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
  if (!(await verifyTurnstile(body['cf-turnstile-response'], ip))) {
    return res.status(400).json({ ok: false, error: 'That verification challenge did not go through. Please try again.' });
  }

  const data = {};
  for (const f of FIELDS) {
    data[f] = (MULTILINE.has(f) ? clean(body[f]) : oneLine(body[f])).slice(0, MAX[f]);
  }

  const missing = REQUIRED.filter(f => !data[f]);
  if (missing.length) return res.status(400).json({ ok: false, error: 'Missing required fields', fields: missing });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) {
    return res.status(400).json({ ok: false, error: 'That email address does not look right.', fields: ['email'] });
  }

  // ENQUIRY_TO may list several recipients, comma-separated, so the pair of
  // people who receive these can change without a deploy.
  const TO = (process.env.ENQUIRY_TO || 'keith@lincorholdings.com,tim@lincorholdings.com')
    .split(',').map(s => s.trim()).filter(Boolean);
  const FROM = process.env.ENQUIRY_FROM || 'Nexus Global <website@nexusconnecthk.com>';

  if (!process.env.RESEND_API_KEY) {
    console.error('[enquiry] RESEND_API_KEY is not set; refusing to accept a message we cannot send');
    return res.status(503).json({ ok: false, error: 'The enquiry form is not configured yet.' });
  }

  // Step one: the durable record. A logging failure must not cost us the
  // enquiry, so it is reported and stepped over rather than thrown - the mail
  // below is the part the sender is waiting on. Vercel's edge headers give us
  // the market the enquiry came from without retaining an IP address, which is
  // personal data under both GDPR and POPIA and answers no question we have.
  let id = null;
  try {
    const r = await sb('nc_website_enquiries', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ...data,
        phone: data.phone || null,
        role: data.role || null,
        subject: data.subject || null,
        source_page: oneLine(req.headers['referer'] || '/contact'),
        country: oneLine(req.headers['x-vercel-ip-country'] || '') || null,
        user_agent: oneLine(req.headers['user-agent'] || '') || null,
        notified_to: TO,
      }),
    });
    const rows = await r.json();
    id = (Array.isArray(rows) && rows[0] && rows[0].id) || null;
  } catch (err) {
    console.error('[enquiry] could not log to Supabase:', err && err.message);
  }

  const subject = `Website enquiry, ${oneLine(data.subject) || 'General'}, ${oneLine(data.company)}`;
  const rows = FIELDS.filter(f => data[f]).map(f =>
    `<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><strong>${LABELS[f]}</strong></td>` +
    `<td style="padding:4px 0">${escapeHtml(data[f]).replace(/\n/g, '<br>')}</td></tr>`).join('');
  // The reference is the Supabase row id, so a reply in an inbox can always be
  // traced back to the logged enquiry. Omitted entirely when logging failed,
  // rather than printed as a reassuring but meaningless blank.
  const ref = id ? `<p style="color:#666;font-size:12px;margin-top:16px">Reference ${id}</p>` : '';
  const html = `<table style="font-family:system-ui,sans-serif;font-size:14px">${rows}</table>${ref}`;
  const text = FIELDS.filter(f => data[f]).map(f => `${LABELS[f]}: ${data[f]}`).join('\n')
    + (id ? `\n\nReference ${id}` : '');

  // Step two: the mail. reply_to is the enquirer, so hitting reply in either
  // inbox answers the customer rather than the website.
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // A double-clicked submit button, or Vercel retrying the invocation,
        // must not put the same enquiry in front of Keith and Tim twice. The
        // row id is unique per submission and is the natural key for it.
        ...(id ? { 'Idempotency-Key': `enquiry-${id}` } : {}),
      },
      body: JSON.stringify({ from: FROM, to: TO, reply_to: data.email, subject, html, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);

    // Resend's id is what the delivery webhook arrives quoting, so it is the
    // join between this row and everything that happens to the message later.
    const sent = await r.json().catch(() => ({}));
    if (id && sent.id) {
      try {
        await sb(`nc_website_enquiries?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ resend_message_id: sent.id, delivery_status: 'sent' }),
        });
      } catch (err) {
        // The mail is away; not recording its id only costs us the delivery
        // trail, and is not worth failing the visitor's submission over.
        console.error('[enquiry] could not attach Resend id to', id, err && err.message);
      }
    }
  } catch (err) {
    console.error('[enquiry] send failed:', err && err.message);
    if (id) {
      try {
        await sb(`nc_website_enquiries?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ delivery_status: 'failed' }),
        });
      } catch (e) {
        console.error('[enquiry] could not mark', id, 'failed:', e && e.message);
      }
    }
    // Tell the sender it did not go through even though we hold a copy. The
    // alternative - a thank-you for a message nobody has been told about - is
    // worse: they would stop chasing an enquiry that nobody is reading.
    return res.status(502).json({ ok: false, error: 'We could not send that just now.' });
  }

  return res.status(200).json({ ok: true });
};
