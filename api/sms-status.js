// ============================================
// Overwatch — messaging setup check
// ============================================
// Vercel Serverless Function: GET /api/sms-status
//
// WHY
// Setting Twilio up means getting four environment variables and one webhook
// URL right, in a dashboard, on a phone. Every one of them fails the same way
// — a text that does not arrive — and none of them says which one was wrong.
// This answers that directly instead of by elimination.
//
// WHAT IT WILL NOT DO
// It never returns a secret. Not the auth token, not the service-role key, not
// the account SID. Only whether each one is PRESENT, plus facts Twilio itself
// would tell anyone holding the number: the sending number and the account's
// friendly name.
//
// TWO LEVELS
//   Unauthenticated — presence booleans and the webhook URL to paste. Safe to
//     open in a phone browser with no sign-in, which is the point: setup
//     happens in the Twilio console, not inside the app.
//   With a Google token from a company domain — additionally CALLS Twilio to
//     prove the credentials actually work, which is the only check that
//     matters and the only one that costs a round trip.

const has = (v) => Boolean(v && String(v).trim());

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const SID     = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN   = process.env.TWILIO_AUTH_TOKEN;
  const FROM    = process.env.TWILIO_FROM_NUMBER;
  const SERVICE = process.env.TWILIO_MESSAGING_SERVICE_SID;

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;

  const config = {
    TWILIO_ACCOUNT_SID:           has(SID),
    TWILIO_AUTH_TOKEN:            has(TOKEN),
    TWILIO_FROM_NUMBER:           has(FROM),
    TWILIO_MESSAGING_SERVICE_SID: has(SERVICE),
    VITE_SUPABASE_URL:            has(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY:    has(process.env.SUPABASE_SERVICE_ROLE_KEY),
    TWILIO_WEBHOOK_URL:           has(process.env.TWILIO_WEBHOOK_URL),
  };

  // A Messaging Service takes priority over a From number, so having only one
  // of them is fine and having neither is fatal. Say which.
  const canSendOutbound = config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN
    && (config.TWILIO_FROM_NUMBER || config.TWILIO_MESSAGING_SERVICE_SID);
  const canReceive = config.TWILIO_AUTH_TOKEN && config.VITE_SUPABASE_URL
    && config.SUPABASE_SERVICE_ROLE_KEY;

  const blocking = [];
  if (!config.TWILIO_ACCOUNT_SID) blocking.push('TWILIO_ACCOUNT_SID is not set — outbound cannot work.');
  if (!config.TWILIO_AUTH_TOKEN)  blocking.push('TWILIO_AUTH_TOKEN is not set — neither outbound nor inbound can work.');
  if (!config.TWILIO_FROM_NUMBER && !config.TWILIO_MESSAGING_SERVICE_SID) {
    blocking.push('No sender: set TWILIO_FROM_NUMBER (+1…) or TWILIO_MESSAGING_SERVICE_SID (MG…).');
  }
  if (!config.SUPABASE_SERVICE_ROLE_KEY) blocking.push('SUPABASE_SERVICE_ROLE_KEY is not set — inbound replies cannot be stored.');

  const out = {
    checkedAt: new Date().toISOString(),
    config,
    canSendOutbound,
    canReceive,
    blocking,
    webhook: {
      // The exact string to paste into the number's "A message comes in" field.
      setThisInTwilio: `${proto}://${host}/api/sms-inbound`,
      method: 'HTTP POST',
      note: 'If this does not match the URL Twilio actually calls, character for character, every reply is rejected as a bad signature. TWILIO_WEBHOOK_URL overrides the guess.',
    },
    twilio: null,
  };

  // ── The live check. Only for a signed-in company address. ────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  let actor = null;
  if (token) {
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const info = await r.json();
        const email = String(info?.email || '').toLowerCase();
        const domains = (process.env.SMS_ALLOWED_DOMAINS
          || 'drhsecurityservices.com,jnbservice.com,jnbllc.com')
          .split(',').map(d => d.trim().toLowerCase());
        if (email && domains.includes(email.split('@')[1] || '')) actor = email;
      }
    } catch { /* stay unauthenticated */ }
  }

  if (actor && has(SID) && has(TOKEN)) {
    out.signedInAs = actor;
    const basic = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    try {
      // Fetching the account proves the SID and token are a working pair —
      // the one thing presence booleans cannot tell you. Wrong credentials
      // return 401 here instead of silently failing on the first real text.
      const acc = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}.json`,
        { headers: { Authorization: basic } });
      const body = await acc.json().catch(() => null);
      if (!acc.ok) {
        out.twilio = { credentials: 'REJECTED', status: acc.status,
          detail: body?.message || 'Twilio refused these credentials.' };
      } else {
        out.twilio = {
          credentials: 'ok',
          account: body?.friendly_name || null,
          accountStatus: body?.status || null,   // active / suspended / closed
        };

        // ── WHICH INBOUND WEBHOOK ACTUALLY APPLIES ────────────────────
        // A number inside a Messaging Service has TWO inbound webhooks, and a
        // flag on the Service decides which one Twilio calls:
        //
        //   use_inbound_webhook_on_number = true   -> the NUMBER's sms_url
        //   use_inbound_webhook_on_number = false  -> the SERVICE's
        //                                             inbound_request_url
        //
        // The console warns that the Service "may override" the number, but
        // does not show the flag on the number's page — so setting the number's
        // webhook and testing is a coin flip, and the failure looks the same
        // either way: a reply that never arrives. Read the flag and say which
        // one is live.
        if (has(SERVICE)) {
          const svc = await fetch(`https://messaging.twilio.com/v1/Services/${SERVICE}`,
            { headers: { Authorization: basic } });
          const sb = await svc.json().catch(() => null);
          if (sb) {
            const onNumber = sb.use_inbound_webhook_on_number === true;
            out.twilio.inbound = {
              decidedBy: onNumber ? "the NUMBER's webhook" : "the MESSAGING SERVICE's webhook",
              useInboundWebhookOnNumber: sb.use_inbound_webhook_on_number,
              serviceName: sb.friendly_name || null,
              serviceInboundUrl: sb.inbound_request_url || null,
              serviceInboundMethod: sb.inbound_method || null,
            };
            if (!onNumber) {
              const want = out.webhook.setThisInTwilio;
              if ((sb.inbound_request_url || '') !== want) {
                out.blocking.push(
                  `Inbound is handled by the Messaging Service "${sb.friendly_name || SERVICE}", whose webhook is "${sb.inbound_request_url || 'not set'}". Set the SERVICE's inbound URL to ${want} (Messaging → Services → Integration), or the number's webhook will be ignored.`);
              }
            }
            if ((sb.inbound_method || 'POST').toUpperCase() !== 'POST' && !onNumber) {
              out.blocking.push("The Messaging Service's inbound method is not POST.");
            }
          }

          const ms = await fetch(
            `https://messaging.twilio.com/v1/Services/${SERVICE}/PhoneNumbers`,
            { headers: { Authorization: basic } });
          const msb = await ms.json().catch(() => null);
          out.twilio.sender = {
            via: 'messaging-service',
            numbers: (msb?.phone_numbers || []).map(n => n.phone_number),
            note: 'A Messaging Service picks the sending number, not this app.',
          };
          if (!out.twilio.sender.numbers.length) {
            out.blocking.push('The Messaging Service has no phone numbers in it — nothing can send.');
          }
        } else if (has(FROM)) {
          const num = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(FROM)}`,
            { headers: { Authorization: basic } });
          const nb = await num.json().catch(() => null);
          const hit = (nb?.incoming_phone_numbers || [])[0];
          out.twilio.sender = hit
            ? {
                via: 'from-number',
                number: hit.phone_number,
                smsUrl: hit.sms_url || null,
                smsMethod: hit.sms_method || null,
                // The whole reason this endpoint exists: read back what the
                // number's webhook is ACTUALLY set to, rather than trusting
                // that the console was saved.
                webhookMatches: (hit.sms_url || '') === out.webhook.setThisInTwilio,
                capabilities: hit.capabilities || null,
              }
            : { via: 'from-number', number: FROM,
                warning: 'TWILIO_FROM_NUMBER is not a number on this account.' };
          // The number may still be inside a Messaging Service even though this
          // app is configured to send from the bare number. If it is, the
          // Service can be the one handling inbound.
          if (hit?.sid) {
            try {
              const belongs = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers/${hit.sid}.json`,
                { headers: { Authorization: basic } });
              const bb = await belongs.json().catch(() => null);
              if (bb?.sms_application_sid) {
                out.blocking.push('This number routes inbound through a TwiML App, which overrides the webhook you set on the number.');
              }
            } catch { /* best effort */ }
          }
          if (out.twilio.sender.smsUrl && !out.twilio.sender.webhookMatches) {
            out.blocking.push(
              `The number's incoming webhook is "${out.twilio.sender.smsUrl}" — replies will not reach Overwatch. Set it to ${out.webhook.setThisInTwilio}`);
          }
          if (out.twilio.sender.capabilities && out.twilio.sender.capabilities.sms === false) {
            out.blocking.push('That number is not SMS-capable.');
          }
        }
      }
    } catch (e) {
      out.twilio = { credentials: 'unknown', detail: e?.message || 'Could not reach Twilio.' };
    }
  } else if (!actor) {
    out.twilio = { credentials: 'not checked',
      detail: 'Sign in and open this from Overwatch to test the credentials against Twilio.' };
  }

  out.ready = out.blocking.length === 0 && canSendOutbound && canReceive;
  return res.status(200).json(out);
}
