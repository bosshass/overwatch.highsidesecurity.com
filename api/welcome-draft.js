// ============================================
// Overwatch — Welcome email draft endpoint (Gmail)
// ============================================
// Vercel Serverless Function: POST /api/welcome-draft
// Body: { job_id: "<uuid>" }
//
// Creates a Gmail DRAFT (never sends). A human reviews and sends it.
//
// Requires these Vercel Environment Variables:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GMAIL_REFRESH_TOKEN          (the 1// string from the OAuth Playground)
//   GMAIL_SENDER                 e.g. Shana Parks <shanaparks@drhsecurityservices.com>
//   VITE_SUPABASE_URL            (already set for the app)
//   SUPABASE_SERVICE_ROLE_KEY    NEW — server-side only, never VITE_ prefixed
//   WELCOME_SECRET               optional, for server-to-server / curl testing
//
// AUTH: the browser sends the logged-in user's Supabase access token as
// `Authorization: Bearer <token>`. Do NOT ship WELCOME_SECRET to the client —
// anything in the Vite bundle is public. The secret exists only for curl and
// server-side callers.
// ============================================

import { createClient } from '@supabase/supabase-js';
import { WELCOME_TEMPLATE } from '../lib/welcomeTemplate.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SUBJECT = 'Welcome to DRH Security';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Customer names in this table are rough: "RUPERT, ED/JOANN",
// "QSC RESTAURANTS INC- LEMAY", "ShoCo - Main St Location". None read well
// after "Hi ". Best effort — the human reviewing the draft is the real check.
function greetingName(raw) {
  if (!raw) return 'there';
  const name = String(raw).trim();
  if (!name) return 'there';
  if (/\b(inc|llc|corp|company|church|club|restaurants|realty|construction|fellowship|nursery|lofts)\b/i.test(name)) {
    return 'there';
  }
  const surnameFirst = name.match(/^([A-Za-z'\u2019-]+),\s*([A-Za-z'\u2019-]+)/);
  if (surnameFirst) return titleCase(surnameFirst[2]);
  const firstWord = name.split(/[\s\-\u2013\u2014:/]/)[0];
  if (!firstWord || firstWord.length < 2) return 'there';
  return titleCase(firstWord);
}

function titleCase(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// RFC 2047 encode a header value if it isn't plain ASCII.
function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMime({ to, from, replyTo, subject, html }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].join('\r\n');

  // Base64 wrapped at 76 chars per RFC 2045. Template has em dashes and curly
  // quotes, so this stays UTF-8 end to end.
  const body = Buffer.from(html, 'utf8')
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n');

  return Buffer.from(`${headers}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

// Either a valid Supabase user session, or the shared secret for non-browser
// callers. The browser path must use the session token.
async function authorize(req) {
  const secret = req.headers['x-welcome-secret'];
  if (secret && process.env.WELCOME_SECRET && secret === process.env.WELCOME_SECRET) {
    return { ok: true, actor: 'service' };
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { ok: false };

  return { ok: true, actor: data.user.email || data.user.id };
}

async function releaseClaim(jobId) {
  await admin
    .from('jobs')
    .update({ welcome_email_sent_at: null, welcome_email_draft_id: null })
    .eq('id', jobId);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Supabase not configured',
      detail: 'Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    });
  }

  const auth = await authorize(req);
  if (!auth.ok) return res.status(401).json({ error: 'unauthorized' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const jobId = body?.job_id;
  if (!jobId) return res.status(400).json({ error: 'Missing "job_id"' });

  // Claim before doing anything else. The .is(null) guard means a double-click
  // or a retry finds nothing to update and exits, instead of making a second
  // draft of the same email.
  const { data: claimed, error: claimError } = await admin
    .from('jobs')
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq('id', jobId)
    .is('welcome_email_sent_at', null)
    .select('id, customer_id, customer_name, status, materials_invoice_sent, materials_invoice_paid')
    .maybeSingle();

  if (claimError) {
    return res.status(500).json({ error: 'Claim failed', detail: claimError.message });
  }

  if (!claimed) {
    const { data: existing } = await admin
      .from('jobs')
      .select('welcome_email_draft_id')
      .eq('id', jobId)
      .maybeSingle();

    return res.status(200).json({
      status: 'skipped',
      reason: 'already_generated',
      draft_id: existing?.welcome_email_draft_id ?? null,
    });
  }

  const qualifies =
    claimed.status === 'won' &&
    claimed.materials_invoice_sent === true &&
    claimed.materials_invoice_paid === true;

  if (!qualifies) {
    await releaseClaim(jobId);
    return res.status(422).json({ status: 'skipped', reason: 'conditions_not_met' });
  }

  if (!claimed.customer_id) {
    await releaseClaim(jobId);
    return res.status(422).json({ status: 'skipped', reason: 'no_customer_linked' });
  }

  // jobs.customer_email is unpopulated across this table — the real address
  // lives on customers. Always join; never read the denormalised column.
  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('email, name, merged_into')
    .eq('id', claimed.customer_id)
    .maybeSingle();

  if (customerError) {
    await releaseClaim(jobId);
    return res.status(500).json({ error: 'Customer lookup failed', detail: customerError.message });
  }

  if (!customer?.email) {
    await releaseClaim(jobId);
    return res.status(422).json({ status: 'skipped', reason: 'no_email_on_customer' });
  }

  if (customer.merged_into) {
    await releaseClaim(jobId);
    return res.status(422).json({ status: 'skipped', reason: 'customer_is_merged_duplicate' });
  }

  const html = WELCOME_TEMPLATE.replace(
    /\{\{name\}\}/g,
    escapeHtml(greetingName(customer.name || claimed.customer_name))
  );

  const sender = process.env.GMAIL_SENDER;
  if (!sender) {
    await releaseClaim(jobId);
    return res.status(500).json({ error: 'GMAIL_SENDER not set' });
  }

  const raw = buildMime({
    to: customer.email,
    from: sender,
    replyTo: sender,
    subject: SUBJECT,
    html,
  });

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    await releaseClaim(jobId);
    return res.status(502).json({ error: 'Gmail auth failed', detail: err.message });
  }

  const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!draftRes.ok) {
    const detail = await draftRes.text();
    await releaseClaim(jobId);
    return res.status(502).json({ error: 'Gmail draft failed', status: draftRes.status, detail });
  }

  const draft = await draftRes.json();

  await admin
    .from('jobs')
    .update({ welcome_email_draft_id: draft.id })
    .eq('id', jobId);

  return res.status(200).json({
    status: 'drafted',
    job_id: jobId,
    to: customer.email,
    draft_id: draft.id,
    generated_by: auth.actor,
    // Deep-linking a specific compose window isn't an officially supported URL
    // format. The drafts folder, newest first, is the reliable landing spot.
    drafts_url: 'https://mail.google.com/mail/u/0/#drafts',
  });
}
