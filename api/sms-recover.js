// ============================================
// ONE-SHOT RECOVERY — delete after use
// GET /api/sms-recover?since=2026-09-28
// Requires Google Bearer token from a company address.
// Fetches inbound Twilio messages since the given date,
// matches each sender to a customer/staff member,
// and inserts any that are not already in notes.
// ============================================

import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const admin  = (SB_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const STAFF_BY_PHONE = {
  '+18087474948': { name: 'Shana',  email: 'shanaparks@drhsecurityservices.com' },
  '+18088541757': { name: 'JR',     email: 'jr@drhsecurityservices.com' },
  '+17207500063': { name: 'Sara',   email: 'admin@jnbservice.com' },
  '+13372800021': { name: 'Austin', email: 'austin@drhsecurityservices.com' },
};

function last10(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

const ALLOWED_DOMAINS = (process.env.SMS_ALLOWED_DOMAINS
  || 'drhsecurityservices.com,jnbservice.com,jnbllc.com')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Auth — company Google token required
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Bearer token required' });

  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(401).json({ error: 'invalid token' });
    const info = await r.json();
    const email = String(info?.email || '').toLowerCase();
    const domain = email.split('@')[1] || '';
    if (!ALLOWED_DOMAINS.includes(domain))
      return res.status(403).json({ error: 'not allowed' });
  } catch {
    return res.status(401).json({ error: 'token check failed' });
  }

  if (!admin) return res.status(500).json({ error: 'Supabase not configured' });

  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  if (!SID || !TOKEN) return res.status(500).json({ error: 'Twilio not configured' });

  // Default: since Sep 28 (the last day inbound worked)
  const since = req.query.since || '2026-09-28';
  const basic = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

  // Fetch all inbound messages to the Overwatch number since the cutoff
  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`
    + `?Direction=inbound&DateSent%3E=${since}&PageSize=100`;

  const twilioRes = await fetch(url, { headers: { Authorization: basic } });
  if (!twilioRes.ok) {
    const tb = await twilioRes.json().catch(() => null);
    return res.status(502).json({ error: 'Twilio error', detail: tb?.message });
  }
  const twilioData = await twilioRes.json();
  const messages = twilioData.messages || [];

  // Load existing inbound note bodies to avoid duplicates (rough dedup by from+body+timestamp)
  const { data: existing } = await admin
    .from('notes')
    .select('body, created_at')
    .like('body', '📲%')
    .gte('created_at', `${since}T00:00:00Z`);
  const existingKeys = new Set((existing || []).map(n =>
    `${n.body.slice(0, 60)}|${n.created_at?.slice(0, 16)}`));

  // Load customers for matching
  const { data: customers } = await admin
    .from('customers').select('id, name, phone').is('merged_into', null).limit(2000);

  const inserted = [];
  const skipped  = [];

  for (const msg of messages) {
    const from = msg.from || '';
    const body = (msg.body || '').trim();
    const when = msg.date_sent
      ? new Date(msg.date_sent).toISOString()
      : new Date().toISOString();

    if (!from || !body) continue;

    const digits = last10(from);
    let staff = STAFF_BY_PHONE[from] || Object.entries(STAFF_BY_PHONE)
      .find(([num]) => last10(num) === digits)?.[1] || null;

    let customer = null;
    let jobId    = null;

    if (!staff && digits) {
      customer = (customers || []).find(c => last10(c.phone) === digits) || null;
    }

    const who = staff ? staff.name : (customer?.name || `Unknown ${from}`);
    const noteBody = `📲 Text from ${who} (${from}):\n${body}`;
    const dedupKey = `${noteBody.slice(0, 60)}|${when.slice(0, 16)}`;

    if (existingKeys.has(dedupKey)) {
      skipped.push({ from, body: body.slice(0, 40), when });
      continue;
    }

    // Find job for customer
    if (customer?.id) {
      const { data: recent } = await admin
        .from('jobs').select('id')
        .eq('customer_id', customer.id)
        .not('status', 'in', '(dead,archived,lost,billed)')
        .order('created_at', { ascending: false }).limit(1);
      jobId = recent?.[0]?.id || null;
    }

    // Find owner (who last texted this number)
    let owner = null;
    try {
      const { data: sent } = await admin
        .from('notes')
        .select('author_email')
        .like('body', `%(${from})%`)
        .not('author_email', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      owner = sent?.[0]?.author_email || null;
    } catch { /* best effort */ }

    const FALLBACK_OWNER = process.env.SMS_DEFAULT_OWNER || 'admin@jnbservice.com';

    try {
      await admin.from('notes').insert({
        body: noteBody,
        customer_id: customer?.id || null,
        job_id: jobId,
        author_email: staff?.email || null,
        assigned_to: owner || FALLBACK_OWNER,
        assigned_by: null,
        lane: 'note',
        status: 'open',
        on_customer_record: !staff && !!customer?.id,
        created_at: when,
      });
      inserted.push({ from, who, body: body.slice(0, 40), when });
      existingKeys.add(dedupKey);
    } catch (e) {
      skipped.push({ from, body: body.slice(0, 40), when, error: e?.message });
    }
  }

  return res.status(200).json({
    since,
    totalFromTwilio: messages.length,
    inserted: inserted.length,
    skipped: skipped.length,
    insertedMessages: inserted,
    skippedMessages: skipped,
  });
}
