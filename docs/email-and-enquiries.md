# Contact form: Resend + Supabase

How an enquiry from `nexusconnecthk.com/contact` reaches Keith and Tim, and where
the record of it lives.

## The path

1. The form on `/contact` posts JSON to **`/api/enquiry`** (`api/enquiry.js`).
2. The function validates, drops honeypot submissions, then **writes the row to
   Supabase first** — table `nc_website_enquiries` in the *Nexus Connect*
   project (`tcceomaxkotiitqopmwk`, ap-southeast-1).
3. It sends one email through **Resend** to both recipients, `reply_to` set to
   the enquirer, with the row id printed as a reference.
4. It patches the row with Resend's message id and `delivery_status = 'sent'`.
5. Minutes later Resend calls **`/api/resend-webhook`** with what happened to
   that message, and the row's `delivery_status` and `delivery_events` are
   updated.

Logging before sending is deliberate: if Resend is down or the mail bounces off
both inboxes, the enquiry still exists somewhere we can go and read it. The
visitor is told the truth either way — a send failure returns 502 and the form
tells them to phone, rather than thanking them for a message nobody has seen.

## Environment variables (Vercel project → Settings → Environment Variables)

| Name | Required | Value |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | Resend → API Keys. Sending permission is enough. |
| `SUPABASE_URL` | yes | `https://tcceomaxkotiitqopmwk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase → Settings → API Keys. Either generation works — a modern `sb_secret_…` key (preferred, rotatable on its own) or the legacy `service_role` JWT. **Server-side only**: both bypass RLS, so neither may appear in `css/`, `js/` or any HTML. |
| `RESEND_WEBHOOK_SECRET` | for delivery tracking | The `whsec_…` signing secret shown when the webhook endpoint is created in Resend. |
| `ENQUIRY_TO` | no | Comma-separated recipients. Defaults to `keith@lincorholdings.com,tim@lincorholdings.com`, so changing who gets these needs no deploy — just this variable. |
| `ENQUIRY_FROM` | no | Defaults to `Nexus Global <website@nexusconnecthk.com>`. Must stay on a domain verified in Resend or every send is rejected. |

Set all of them for Production, Preview and Development, then redeploy —
environment variables are read at invocation, but a running deployment does not
pick up new ones without one.

With no `RESEND_API_KEY` the endpoint returns 503 and refuses the message rather
than accepting one it cannot deliver.

### A note on the Supabase key header

Both functions sniff the key's format and set headers accordingly, so either
generation can be pasted into `SUPABASE_SERVICE_ROLE_KEY` without a code change:

- a legacy `service_role` JWT (`eyJ…`) goes on both `apikey` and
  `Authorization: Bearer`, as it always has;
- a modern `sb_secret_…` key goes on `apikey` **only** — it is opaque rather
  than a JWT, and Supabase rejects it on an `Authorization: Bearer` header.

Getting this wrong produces a 401 on every insert, which surfaces as enquiries
that email fine but never appear in the table.

## Resend setup

- **Domain:** `nexusconnecthk.com`, verified. SPF and DKIM records must stay in
  DNS; removing them silently breaks sending. A DMARC record is worth adding if
  it is not there — without one, deliverability to Outlook and Gmail is at the
  mercy of their heuristics.
- **Webhook:** Resend → Webhooks → Add endpoint,
  `https://nexusconnecthk.com/api/resend-webhook`. Subscribe to `email.sent`,
  `email.delivered`, `email.delivery_delayed`, `email.bounced` and
  `email.complained`. `email.opened` and `email.clicked` are also accepted and
  recorded, but they say nothing about delivery so they leave the status alone.
- Copy the signing secret into `RESEND_WEBHOOK_SECRET`. The endpoint verifies
  every request's Svix signature and rejects anything unsigned, tampered with,
  or older than five minutes — otherwise anyone who found the URL could mark a
  bounced enquiry delivered.

## The table

`public.nc_website_enquiries` — RLS is **enabled with no policies**, on purpose.
Nothing holding an anon or authenticated key can read a row, so an enquirer's
message and contact details are not exposed to the platform's logged-in
factories or clients. Only the service role key reaches it. Supabase's linter
reports this as an INFO-level "RLS enabled, no policy"; that finding is expected.

No IP address is stored. It is personal data under both GDPR and POPIA, and the
`country` Vercel already derives from it answers every question we actually have.

`delivery_status` moves in one direction only: a late `email.delivered` cannot
overwrite an `email.bounced`, because one message is addressed to both Keith and
Tim and a bounce for either of them is the fact worth surfacing.

## Reading the enquiries

Supabase → SQL editor (the table browser needs a policy to show rows; SQL runs
as the owner):

```sql
select created_at, name, company, email, phone, role, subject,
       delivery_status, message
  from nc_website_enquiries
 order by created_at desc
 limit 50;
```

Anything that did not arrive:

```sql
select created_at, company, email, delivery_status,
       delivery_events -> -1 -> 'data' as last_event
  from nc_website_enquiries
 where delivery_status in ('pending','failed','bounced','complained')
 order by created_at desc;
```

`pending` rows that never became `sent` mean the function logged an enquiry and
then could not reach Resend at all — check the Vercel function logs for
`[enquiry]`. Rows stuck at `sent` mean the webhook is not configured or its
secret is wrong; look for `[resend-webhook]` in the same place.

## Testing after setup

Submit the real form once with a recognisable company name, then confirm all
three: the mail lands in both inboxes, replying to it addresses the enquirer and
not the website, and the row appears with `delivery_status = 'delivered'` within
a few minutes.
