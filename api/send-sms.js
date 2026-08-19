import { createClient } from '@supabase/supabase-js';

// Service-role client, server-side only. Used ONLY to validate the caller's
// token — never to read or write on their behalf.
// URL falls back the same way welcome-draft.js does: this project stores it as
// VITE_SUPABASE_URL, not SUPABASE_URL. Requiring the bare name left admin null
// and the Bearer path silently dead — every browser token rejected, only the
// x-sms-secret header working. Shipped broken in 9.79.0, fixed in 9.79.1.
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const admin = (SB_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Same shape as authorize() in api/welcome-draft.js. Either a valid Supabase
// session (the browser path) or a shared secret for curl / server-side callers.
// Do NOT ship SMS_SECRET to the client — anything in the Vite bundle is public.
async function authorize(req) {
  const secret = req.headers['x-sms-secret'];
  if (secret && process.env.SMS_SECRET && secret === process.env.SMS_SECRET) {
    return { ok: true, actor: 'service' };
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !admin) return { ok: false };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { ok: false };
  return { ok: true, actor: data.user.email || data.user.id };
}

// ============================================
// Overwatch — SMS send endpoint (Twilio)
// ============================================
// Vercel Serverless Function: POST /api/send-sms
// Body: { to: "+1XXXXXXXXXX", message: "text" }
//
// Requires these Vercel Environment Variables:
//   TWILIO_ACCOUNT_SID   (starts with AC...)
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER   (your Twilio number, +1XXXXXXXXXX)
//
// Calls Twilio's REST API directly (no SDK dependency).
// ============================================

export default async function handler(req, res) {
  // CORS. Origin is NO LONGER '*'. This endpoint spends money — an open relay
  // on a Twilio number risks the A2P registration, not just the balance.
  const ALLOWED = (process.env.SMS_ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  if (ALLOWED.length && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-sms-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // AUTH — was entirely absent. Anyone on the internet could POST {to, message}
  // and send a text billed to DRH from your number.
  const auth = await authorize(req);
  if (!auth.ok) return res.status(401).json({ error: 'unauthorized' });

  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM = process.env.TWILIO_FROM_NUMBER;                  // +1XXXXXXXXXX (optional)
  const MSG_SERVICE = process.env.TWILIO_MESSAGING_SERVICE_SID;  // MG... (optional)

  // Need creds + at least ONE sender (Messaging Service preferred, else From number)
  if (!SID || !TOKEN || (!MSG_SERVICE && !FROM)) {
    return res.status(500).json({
      error: 'Twilio not configured',
      detail: 'Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID (MG...) or TWILIO_FROM_NUMBER (+1...).',
    });
  }

  // Parse body (Vercel usually parses JSON; guard for string just in case)
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { to, message } = body || {};

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing "to" or "message"' });
  }

  // Light normalization: ensure +1 on a bare 10-digit US number
  let toNum = String(to).replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(toNum)) toNum = '+1' + toNum;
  else if (/^1\d{10}$/.test(toNum)) toNum = '+' + toNum;

  try {
    // Messaging Service (MG...) takes priority; fall back to a plain From number.
    const params = new URLSearchParams({ To: toNum, Body: message });
    if (MSG_SERVICE) params.append('MessagingServiceSid', MSG_SERVICE);
    else params.append('From', FROM);

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    const data = await twilioRes.json();
    if (!twilioRes.ok) {
      // Twilio returns a helpful "message" + "code" on errors
      return res.status(twilioRes.status).json({
        error: 'Twilio error',
        code: data.code,
        detail: data.message || 'Unknown Twilio error',
      });
    }

    return res.status(200).json({ success: true, sid: data.sid, status: data.status, to: toNum });
  } catch (err) {
    return res.status(500).json({ error: 'Send failed', detail: err.message });
  }
}
