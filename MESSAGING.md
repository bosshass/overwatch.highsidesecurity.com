# OVERWATCH — MESSAGING

Everything that sends or receives a text message. The code, the rules, and why
each rule exists.

As of **9.89.0**. Nothing here is theoretical — every file named is in the repo
and every rule named is enforced in code, not by convention.

---

## THE SHAPE OF IT

```
                          ┌──────────────────────────┐
  a card in the app  ───► │  SmsComposer.jsx         │  one box, two modes
                          │  (the ONLY message box)  │
                          └───────────┬──────────────┘
                                      │ sendSms({to, message, accessToken})
                          ┌───────────▼──────────────┐
                          │  services/sms.js         │  the only caller of the
                          │  formatPhone/isSendable  │  endpoint
                          └───────────┬──────────────┘
                                      │ POST + Bearer <google token>
                          ┌───────────▼──────────────┐
                          │  api/send-sms.js         │  auth → Twilio REST
                          └───────────┬──────────────┘
                                      │
                                  ┌───▼────┐
                                  │ Twilio │
                                  └───┬────┘
                                      │  a client replies
                          ┌───────────▼──────────────┐
                          │  api/sms-inbound.js      │  signature → match →
                          │                          │  file as an OPEN note
                          └──────────────────────────┘
```

---

## FILES

| File | What it is |
|---|---|
| `src/components/SmsComposer.jsx` | The one message box. Segment counter, templates, the client/staff rules, the send, the log. |
| `src/services/sms.js` | The only place in `src/` that calls the endpoint. `formatPhone`, `isSendable`, `sendSms`. |
| `api/send-sms.js` | Outbound. Authorizes the caller, then calls Twilio's REST API directly (no SDK). |
| `api/sms-inbound.js` | Inbound webhook. Verifies Twilio's signature, matches the sender, files an open note. |
| `src/utils/ownership.js` | `ASSIGNEES` — the staff roster and their numbers. `PHONE_BY_EMAIL` derives from it. |
| `src/components/TicketSheet.jsx` | Where the buttons live: text a task owner, text the client, text the on-site contact. |

---

## THE RULES

### 1. Staff get links. Clients never do.

`SmsComposer` takes an `internal` flag and it is the most important prop on it.

- **`internal: true`** — a staff nudge. The draft carries `shortJobLink(job.id)`
  so the recipient can open the card instead of texting back to ask what it is
  about.
- **`internal: false`** — a client. **No Overwatch link, ever.** It is an
  internal app, the link exposes a job id, and it invites a customer to tap
  into something not meant for them.

This is not left to whoever wrote the draft. The composer runs a regex over the
message body at render time and **disables the send button** if a client message
contains an Overwatch-looking URL — including one typed in by hand after the
fact.

### 2. Client messages carry opt-out language

Every client template ends with `Reply STOP to opt out.` That is what A2P
registration expects of business messaging, and a toll-free number's
verification depends on the traffic matching what was registered.

Twilio handles the STOP keyword itself — the opt-out is real, not decorative.

### 3. Every send is logged as a note

A text that exists only on somebody's phone is not a record. On a successful
send the composer writes an archived note carrying the recipient, the first line
of the message, and the author.

`on_customer_record` is set to **`!internal`** — a text to a client is a real
touch and belongs on their history; an internal nudge does not.

### 4. An inbound message is OPEN, not archived

`api/sms-inbound.js` files replies with `status: 'open'`, `lane: 'todo'`.

A person is waiting on an answer. Filing it archived would make the inbox tidy
and the client ignored.

### 5. The endpoint proves who is calling it

`/api/send-sms` spends money. An open relay on a Twilio number risks the A2P
registration, not just the balance. Three ways in, in order:

1. `x-sms-secret` matching `SMS_SECRET` — for curl and server-side callers. **Never
   shipped to the browser**; anything in the Vite bundle is public.
2. A **Google** access token, verified against `googleapis.com/oauth2/v3/userinfo`,
   with the resulting address required to be on a company domain.
3. A Supabase session token — legacy, kept for a future caller.

> **Why path 2 had to be added.** The endpoint originally accepted *only* a
> Supabase session token, and Overwatch has never had one: it signs in with
> Google OAuth directly and talks to Supabase with the anon key under permissive
> RLS. There is no Supabase user to get a token for, and `sms.js` sent no
> `Authorization` header at all. **Every call from the browser would have
> returned 401.** That — not a missing button alone — is why `sendSms` sat in
> the repo with zero callers.

### 6. The inbound webhook proves the message is really from Twilio

`/api/sms-inbound` is a public URL that writes to the database. Without a
signature check, anyone could POST a fabricated message from a client's number
and it would land on that client's record looking genuine.

It verifies `X-Twilio-Signature`: HMAC-SHA1 over the exact URL plus every POST
field in alphabetical order, keyed with `TWILIO_AUTH_TOKEN`, compared in
constant time. A bad signature gets **403** and nothing is written.

### 7. Phone matching is on the last 10 digits

`(970) 286-1192`, `970-286-1192`, `9702861192`, `+19702861192` are one number
typed four ways, and all four are in the data. Comparing the stored strings
finds almost nothing.

Inbound matching order: **staff roster → customer by phone → job's
`site_contact_phone` or `customer_phone` → unmatched** (still stored, with the
raw number in the body).

### 8. "Sent" means accepted, not delivered

Twilio returns 201 and queues the message, then can fail it asynchronously.
**Error 30032 is "Toll-Free Number Has Not Been Verified"** — precisely the
failure a freshly approved 800 line hits while verification propagates.

So the card reports `Sent ✓ queued · from +1…` — Twilio's own status and the
number it actually left on. With a Messaging Service, Twilio picks the sending
number rather than the server, so echoing it back is the only way to know which
line was used.

### 9. Segments are counted honestly

Billed per **160** characters — but any character outside plain ASCII (an emoji,
a curly quote, an en dash) forces Unicode encoding and drops it to **70**.
Showing 160 when the real answer is 70 understates the bill by more than half.
`segmentsOf()` checks the encoding rather than assuming.

---

## WHERE THE BUTTONS ARE

All on the job card (`TicketSheet`):

| Button | Goes to | Mode |
|---|---|---|
| **📱 Text {name}** on a task | `PHONE_BY_EMAIL[assigned_to]` | staff — link included |
| **📱 Text** next to Phone | `job.customer_phone` | client — templates, no link |
| **📱 Text** next to On site | `job.site_contact_phone` | client — templates, no link |

The account holder and the on-site contact are **different people**, so they get
separate buttons rather than one that guesses.

### Client templates

`On the way` · `Confirm visit` · `Running late` · `Blank`

"Confirm visit" reads the job's `scheduled_date` and writes the real day, or
says a time is coming if it is not scheduled yet.

### Who has a number

From `src/utils/ownership.js`:

| | Phone |
|---|---|
| Shana | 808-747-4948 |
| JR | 808-854-1757 |
| Subs | 720-750-0063 |
| Austin, Brian, Trevor, Sara | **none** — their button reads "No number for X" and is disabled |

Add a number there and the button lights up. No other change needed.

---

## CONFIGURATION

### Vercel environment variables

Set for **Production**, then redeploy — Vercel does not pick up env changes
without one.

| Variable | Needed for | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | outbound | starts `AC…` |
| `TWILIO_AUTH_TOKEN` | outbound **and inbound** | inbound signature verification uses it |
| `TWILIO_FROM_NUMBER` | outbound | `+18005551234` — E.164, leading `+1`, no dashes |
| `TWILIO_MESSAGING_SERVICE_SID` | outbound | `MG…` — **takes priority over the From number** if set |
| `VITE_SUPABASE_URL` | inbound | already set |
| `SUPABASE_SERVICE_ROLE_KEY` | inbound | already set |
| `SMS_ALLOWED_DOMAINS` | outbound auth | optional. Defaults to `drhsecurityservices.com,jnbservice.com,jnbllc.com` |
| `SMS_SECRET` | server-side callers | optional |
| `SMS_ALLOWED_ORIGINS` | CORS | optional — the app is same-origin, so not required |

If a required one is missing, the endpoint returns the exact variable name and
**the card shows it to you**. Nothing fails silently.

### The Twilio number's webhook

Currently pointed at **`https://demo.twilio.com/welcome/sms/reply/`** — Twilio's
sample endpoint. Every client reply is answered by Twilio's demo auto-responder
and then discarded.

Change **"A message comes in"** to:

```
https://overwatch.highsidesecurity.com/api/sms-inbound
```

Method: **HTTP POST**. Leave the backup handler blank.

Until that is changed, texting clients is a one-way radio: you can tell them a
tech is coming, and their "actually, can you come Thursday?" goes nowhere
anybody can see.

---

## CHECKING THE SETUP

`GET /api/sms-status` answers "which part is wrong" directly, instead of by
elimination. **It never returns a secret** — not the auth token, not the
service-role key, not the account SID. Only whether each is *present*, plus
facts Twilio would tell anyone holding the number.

Two levels:

- **Open it in a phone browser, signed out.** Presence booleans for every
  variable, a `blocking` list naming what is missing in plain words, and the
  exact webhook string to paste. Setup happens in the Twilio console, not
  inside the app, so this deliberately needs no sign-in.
- **Called from Overwatch with a company Google account.** Additionally calls
  Twilio to prove the SID and token are a *working pair* — the one check
  presence booleans cannot do — and **reads back what the number's incoming
  webhook is actually set to**, so a console that was never saved shows up as a
  blocking item rather than as a text that never arrives.

```
https://overwatch.highsidesecurity.com/api/sms-status
```

`ready: true` means every variable is set, the credentials authenticate, a
sender exists, and the webhook points here.

## THE SIGNATURE IS TESTED

`tests/twilio-signature.test.mjs` — run it with `node tests/twilio-signature.test.mjs`.

Ten assertions against **Twilio's own published worked example** from
`twilio.com/docs/usage/security`: auth token `12345`, that URL, those five
parameters, expected `L/OH5YylLD5NRKLltdqwSvS0BnU=`. It checks the concatenated
string matches the documented one character for character, that insertion order
is irrelevant, and that a wrong URL, a trailing slash, a wrong token and a
dropped parameter all fail to validate.

This is the only part of the messaging layer that is verified rather than
merely built, and it is the part where a mistake fails **closed** — a bad
signature check rejects every genuine reply with a 403 and loses them exactly as
silently as the demo endpoint did.

### The trailing-slash trap

Twilio signs the URL **it** called, character for character. Reconstructing that
from request headers on Vercel is a guess: the request can arrive on the
`.vercel.app` host rather than the custom domain, and a webhook saved with a
trailing slash is a different string and therefore a different signature.

So `candidateUrls()` tries the plausible forms — both hosts, with and without a
trailing slash — and a rejection **logs every URL it tried**, because otherwise
the only symptom is a 403 and the only fix is guesswork. `TWILIO_WEBHOOK_URL`
settles it outright when it needs settling.

## WHAT IS NOT BUILT

Stated plainly so it is not assumed:

- **No conversation thread view.** Inbound messages land as notes. There is no
  screen that shows a back-and-forth with one client as a thread.
- **No delivery-status callback.** Twilio can POST delivery receipts to a status
  webhook; nothing consumes them, so a message that fails after being queued is
  visible only in the Twilio console.
- **No STOP tracking in Overwatch.** Twilio honours the opt-out at its end, but
  the app does not know a customer has opted out and will still offer the button.
- **No inbound media (MMS).** Photos texted in are dropped; only `Body` is read.
- **No rate limiting** beyond Twilio's own.
- **Numbers are not verified against a customer before sending.** The composer
  sends to whatever is on the card. A wrong number on a record is a wrong text.

---

## VERIFICATION STATE

The build is clean — `npm run verify` (lint gate + production build) passes.

**None of this has been exercised against a live Twilio account.** The endpoints
have never been called with real credentials, no message has been sent, and the
inbound webhook has never received a request. The first real send is the first
real test, which is why the card reports Twilio's raw status and error text
rather than a friendly summary.
