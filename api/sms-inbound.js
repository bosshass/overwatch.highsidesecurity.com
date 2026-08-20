import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ============================================
// Overwatch — inbound SMS webhook (Twilio)
// ============================================
// Vercel Serverless Function: POST /api/sms-inbound
//
// WHY THIS EXISTS
// The number's "A message comes in" webhook was still pointed at
// https://demo.twilio.com/welcome/sms/reply/ — Twilio's sample endpoint. So
// every reply from a client was answered by Twilio's demo auto-responder and
// then discarded. Texting customers without this is a one-way radio: you can
// tell them a tech is coming, and their "actually can you come Thursday?" goes
// nowhere anybody can see.
//
// WHAT IT DOES
//   1. Verifies the request really came from Twilio (X-Twilio-Signature).
//   2. Matches the sender's number to a customer, or to a member of staff.
//   3. Files the message as an OPEN note, which is the app's inbox.
//   4. Returns empty TwiML so Twilio sends no auto-reply of its own.
//
// SET THE WEBHOOK TO:
//   https://overwatch.highsidesecurity.com/api/sms-inbound   (HTTP POST)
//
// Requires: TWILIO_AUTH_TOKEN, VITE_SUPABASE_URL (or SUPABASE_URL),
//           SUPABASE_SERVICE_ROLE_KEY.

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const admin = (SB_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Staff numbers, mirroring src/utils/ownership.js. Duplicated deliberately:
// this runs on the server and cannot import from the Vite bundle, and a reply
// from a tech must not be filed as if a customer sent it.
const STAFF_BY_PHONE = {
  '+18087474948': { name: 'Shana',  email: 'shanaparks@drhsecurityservices.com' },
  '+18088541757': { name: 'JR',     email: 'jr@drhsecurityservices.com' },
  '+17207500063': { name: 'Subs',   email: 'subs@drhsecurityservices.com' },
};

// Last 10 digits — the only comparison that survives the six ways a phone
// number gets typed into a CRM: "(970) 286-1192", "970-286-1192", "9702861192",
// "+19702861192". Comparing the stored strings finds almost nothing.
function last10(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

// Twilio signs: the exact URL, then every POST field appended as key+value in
// alphabetical order, HMAC-SHA1 with the auth token, base64.
function verifyTwilio(req, url, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers['x-twilio-signature'];
  if (!token || !sig) return false;
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

// Twilio wants TwiML back. An EMPTY response means "say nothing" — which is
// correct here: a human answers, not a robot. Returning anything else is how
// the demo endpoint ended up auto-replying to clients.
function twiml(res, body = '') {
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Vercel parses form bodies, but be explicit — Twilio posts
  // application/x-www-form-urlencoded and a string body would silently yield
  // an empty From and file every message as unknown.
  let p = req.body;
  if (typeof p === 'string') p = Object.fromEntries(new URLSearchParams(p));
  p = p || {};

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const url   = `${proto}://${host}${req.url}`;

  // A public URL that writes to the database has to prove who is calling it.
  // Without this, anyone could POST a fabricated message from a client's
  // number and it would land on that client's record looking genuine.
  if (!verifyTwilio(req, url, p)) {
    return res.status(403).json({ error: 'bad signature' });
  }

  const from = String(p.From || '');
  const body = String(p.Body || '').trim();
  const when = new Date().toISOString();
  if (!from || !body) return twiml(res);

  if (!admin) {
    // Nothing to write to. Say so in the log rather than dropping it silently.
    console.error('sms-inbound: Supabase admin client unavailable — message NOT stored:', from);
    return twiml(res);
  }

  const digits = last10(from);

  // Staff first: a reply from a tech is an internal note, not a client touch.
  const staff = STAFF_BY_PHONE[from] || Object.entries(STAFF_BY_PHONE)
    .find(([num]) => last10(num) === digits)?.[1];

  try {
    let customer = null;
    let jobId = null;

    if (!staff && digits) {
      // Match on the last 10 digits, in memory. Postgres cannot index a
      // normalization it does not store, and this table is small enough that
      // one read beats adding a column nothing else needs yet.
      const { data: customers } = await admin
        .from('customers').select('id, name, phone').is('merged_into', null).limit(2000);
      customer = (customers || []).find(c => last10(c.phone) === digits) || null;

      if (!customer) {
        // Not the account holder — try the on-site contacts (migration 047)
        // and the phone stored on the job itself.
        const { data: jobs } = await admin
          .from('jobs')
          .select('id, customer_id, customer_name, customer_phone, site_contact_phone')
          .not('status', 'in', '(dead,archived,lost)')
          .limit(1000);
        const hit = (jobs || []).find(j =>
          last10(j.site_contact_phone) === digits || last10(j.customer_phone) === digits);
        if (hit) { jobId = hit.id; customer = hit.customer_id ? { id: hit.customer_id, name: hit.customer_name } : null; }
      }

      // Attach to their most recent live job so the reply lands next to the
      // work it is about, not just on the customer.
      if (customer?.id && !jobId) {
        const { data: recent } = await admin
          .from('jobs').select('id')
          .eq('customer_id', customer.id)
          .not('status', 'in', '(dead,archived,lost,billed,complete)')
          .order('created_at', { ascending: false }).limit(1);
        jobId = recent?.[0]?.id || null;
      }
    }

    const who = staff ? staff.name : (customer?.name || `Unknown ${from}`);
    await admin.from('notes').insert({
      body: `📲 Text from ${who} (${from}):\n${body}`,
      customer_id: customer?.id || null,
      job_id: jobId,
      author_email: staff?.email || null,
      lane: 'todo',
      // OPEN, deliberately. An inbound message is a person waiting on an
      // answer. Filing it archived would make the inbox tidy and the client
      // ignored.
      status: 'open',
      on_customer_record: !staff && !!customer?.id,
      created_at: when,
    });
  } catch (e) {
    // Never 500 at Twilio — it retries, and a retry storm would file the same
    // message repeatedly. Log it and acknowledge.
    console.error('sms-inbound: could not store message:', e?.message || e);
  }

  return twiml(res);
}
