// Resend delivery webhook.
//
// /api/enquiry knows only that Resend accepted the message. Whether it reached
// Keith and Tim is decided minutes later, and without this endpoint that answer
// only ever exists in the Resend dashboard - so a bounced enquiry looks exactly
// like a delivered one from our side, which is the failure mode most worth
// catching on a form that is the site's only conversion path.
//
// .mjs, and a Web-standard handler, on purpose. Vercel's Node helpers parse
// req.body eagerly and hand back a JavaScript object, and re-serialising that
// object will not reproduce the bytes Resend signed - key order, spacing and
// unicode escaping all differ, so every signature check would fail. A Web
// handler receives the untouched Request, and request.text() gives the exact
// payload the HMAC was computed over.
//
// Note the export shape at the bottom: `export default { fetch }`, which is the
// documented way to declare a Web handler in /api. A plain default-exported
// function is read as a legacy (request, response) Node handler instead, and
// then request.text() does not exist - the signature check would fail on every
// call for a reason that looks nothing like the cause. .mjs is what makes the
// ES module syntax work without a package.json.
//
// No npm dependencies, so the Svix signature scheme is implemented here against
// node:crypto rather than pulling in the svix package. It is a short scheme and
// this keeps the site free of a package.json and an install step.

import { createHmac, timingSafeEqual } from 'node:crypto';

// Svix rejects anything older than five minutes, and so do we: without a
// freshness window, a signed payload captured once could be replayed forever.
const TOLERANCE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 6000;

// Svix sends svix-*; the Standard Webhooks spec it is derived from names the
// same headers webhook-*. Accept either, so this keeps working if Resend
// migrates to the vendor-neutral names.
const header = (h, name) => h.get(`svix-${name}`) || h.get(`webhook-${name}`) || '';

// Supabase has two generations of secret key and they want different headers.
// The legacy service_role key is a JWT (eyJ...) and goes in both apikey and
// Authorization. The newer sb_secret_... keys are opaque, not JWTs, and are
// *rejected* on an Authorization: Bearer header - they must travel on apikey
// alone. Sniffing the format means either key works. Duplicated from
// enquiry.js rather than shared: every file under api/ is deployed as its own
// function, so a shared module there would become a third public endpoint.
const sbHeaders = key => ({
  apikey: key,
  ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
  'Content-Type': 'application/json',
});

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex, nofollow' },
});

const verify = (secret, id, timestamp, signature, payload) => {
  // Secrets are handed out as whsec_<base64>. The prefix is a label, not part
  // of the key material.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest();

  // The header carries a space-separated list so a secret can be rotated with
  // both old and new signatures in flight. Any one match is a pass.
  return signature.split(' ').some(part => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    // timingSafeEqual throws on a length mismatch rather than returning false.
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
};

async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !key) {
    console.error('[resend-webhook] missing RESEND_WEBHOOK_SECRET, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    // 500, not 200: Svix will retry, so a webhook that arrives during a
    // misconfiguration is redelivered once the env vars are in place instead of
    // being acknowledged and lost.
    return json(500, { ok: false, error: 'Webhook not configured' });
  }

  const raw = await request.text();
  const id = header(request.headers, 'id');
  const timestamp = header(request.headers, 'timestamp');
  const signature = header(request.headers, 'signature');
  if (!id || !timestamp || !signature) return json(400, { ok: false, error: 'Missing signature headers' });

  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > TOLERANCE_MS) {
    return json(400, { ok: false, error: 'Timestamp outside tolerance' });
  }

  if (!verify(secret, id, timestamp, signature, raw)) {
    // Anyone can POST to this URL. Without the check, they could mark a bounced
    // enquiry delivered, which is worse than having no delivery data at all.
    console.error('[resend-webhook] signature verification failed for', id);
    return json(401, { ok: false, error: 'Invalid signature' });
  }

  let event;
  try { event = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'Malformed payload' }); }

  const type = String((event && event.type) || '');
  const messageId = String((event && event.data && event.data.email_id) || '');
  if (!type || !messageId) {
    // Signed, so it came from Resend, but there is nothing here to file. Ack it
    // rather than making Svix retry a payload that will never be usable.
    console.error('[resend-webhook] signed event with no type or email_id:', raw.slice(0, 200));
    return json(200, { ok: true, recorded: false });
  }

  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/nc_record_enquiry_delivery`, {
      method: 'POST',
      headers: sbHeaders(key),
      body: JSON.stringify({
        p_message_id: messageId,
        p_event_id: id,
        p_type: type,
        // event.data carries the envelope and, for a bounce, the reason. It
        // never contains the message body, so this is a delivery record rather
        // than a second copy of the enquiry.
        p_event: (event && event.data) || {},
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);

    const updated = await r.json().catch(() => null);
    if (updated === -1) {
      // The enquiry row exists for every send, so an unknown message id means
      // the id never got attached - most likely Supabase was unreachable for
      // that one PATCH in /api/enquiry.
      console.error('[resend-webhook] no enquiry carries message id', messageId, `(${type})`);
    }
    return json(200, { ok: true, recorded: updated > 0 });
  } catch (err) {
    console.error('[resend-webhook] could not record', type, 'for', messageId, err && err.message);
    // 500 so Svix retries. Delivery events are worth a second attempt.
    return json(500, { ok: false, error: 'Could not record event' });
  }
}

// The documented Web-handler shape for a function in /api. Vercel hands `fetch`
// the untouched Request, which is the whole reason this file exists.
export default { fetch: handler };
