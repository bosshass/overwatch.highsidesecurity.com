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

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Template inlined rather than imported from ../lib so the function bundle
// is fully self-contained. Vercel does not reliably trace imports that
// reach outside the api/ directory.
const WELCOME_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DRH Security</title>
<style>
  body {
    margin:0 !important;
    padding:0 !important;
    background:#F5F7FA;
    font-family:Arial, Helvetica, sans-serif;
    -webkit-text-size-adjust:100%;
    -ms-text-size-adjust:100%;
  }
  table { border-collapse:collapse; border-spacing:0; }
  img { border:0; outline:none; text-decoration:none; display:block; }
  a { text-decoration:none; }
  .container { width:100%; max-width:660px; }
  .pad { padding-left:40px; padding-right:40px; }
  .h1 {
    font-size:36px; line-height:1.06; font-weight:800;
    color:#041A45; margin:0; letter-spacing:-.5px;
  }
  .h2 {
    font-size:22px; line-height:1.2; font-weight:800;
    color:#041A45; margin:0;
  }
  .body {
    font-size:16px; line-height:1.68; color:#1D2B3A;
  }
  .btn-red {
    display:inline-block; background:#D71920; color:#fff !important;
    font-size:15px; line-height:15px; font-weight:800;
    padding:15px 24px; border-radius:5px;
  }
  .btn-navy {
    display:inline-block; background:#062969; color:#fff !important;
    font-size:15px; line-height:15px; font-weight:800;
    padding:15px 24px; border-radius:5px;
  }
  .card {
    background:#fff; border:1px solid #DCE3EA; border-radius:8px;
  }
  @media only screen and (max-width:680px) {
    .container { width:100% !important; max-width:100% !important; }
    .pad { padding-left:22px !important; padding-right:22px !important; }
    .h1 { font-size:30px !important; }
    .stack { display:block !important; width:100% !important; }
    .stack-gap { padding-right:0 !important; padding-bottom:12px !important; }
    .logo { width:180px !important; max-width:180px !important; }
  }
</style>
</head>
<body>
<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">Welcome to DRH Security. Meet your team and see what happens next.</div>

<table role="presentation" width="100%" bgcolor="#F5F7FA">
<tr>
<td align="center" style="padding:24px 10px;">
<table role="presentation" class="container" width="660" bgcolor="#FFFFFF" style="width:660px; max-width:660px; border-radius:10px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.06);">

<!-- BRAND HEADER -->
<tr>
<td bgcolor="#041A45" align="center" style="padding:26px 26px 20px 26px;">
  <a href="https://www.drhsecurityservices.com/" aria-label="DRH Security website">
    <img class="logo" src="https://storage.mlcdn.com/account_image/1867553/Gn1kP5b7kTTEd29AmbxGAYlwJ4LXo5gdMNHb64u6.png" width="210" alt="DRH Security — A Division of Highside Security" style="width:210px; max-width:210px; height:auto; margin:0 auto;">
  </a>
</td>
</tr>
<tr>
<td bgcolor="#D71920" height="5" style="height:5px; line-height:5px; font-size:0;">&nbsp;</td>
</tr>


<tr>
<td class="pad" style="padding-top:40px; padding-bottom:20px;">
  <div style="font-size:11px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; color:#D71920; padding-bottom:10px;">Approved. Signed. Let’s get to work.</div>
  <h1 class="h1">Welcome to DRH Security.</h1>
  <div style="width:54px; height:4px; background:#29C7F3; margin-top:18px; margin-bottom:18px;"></div>
  <div class="body">Hi {{name}},<br><br>
    Thank you for choosing DRH Security. Your estimate has been approved, your agreement is signed, and your project is officially moving forward.<br><br>
    I’m <strong>JR Parks, owner of DRH Security.</strong> I oversee our technical standards, system design, and the quality of the work our team delivers. You’ll also have several people supporting your project from the office through installation, so you always know who handles what.</div>
</td>
</tr>
<tr><td class="pad" style="padding-top:4px; padding-bottom:14px;"><h2 class="h2">Who you’ll be working with</h2></td></tr>
<tr>
<td class="pad" style="padding-bottom:12px;">
<table role="presentation" width="100%">
<tr>
<td class="stack stack-gap" width="50%" valign="top" style="padding-right:6px;">
<table role="presentation" width="100%" class="card"><tr><td style="padding:18px;">
  <div style="font-size:15px;font-weight:800;color:#041A45;">JR Parks</div>
  <div style="font-size:11px;font-weight:800;color:#D71920;text-transform:uppercase;letter-spacing:.7px;padding-top:3px;">Owner &amp; Technical Oversight</div>
  <div style="font-size:13px;line-height:1.6;color:#667585;padding-top:10px;">JR founded DRH Security and oversees system design, technical standards, and the overall quality of the work our team delivers.</div>
</td></tr></table>
</td>
<td class="stack" width="50%" valign="top" style="padding-left:6px;">
<table role="presentation" width="100%" class="card"><tr><td style="padding:18px;">
  <div style="font-size:15px;font-weight:800;color:#041A45;">Sara Hass</div>
  <div style="font-size:11px;font-weight:800;color:#D71920;text-transform:uppercase;letter-spacing:.7px;padding-top:3px;">Project &amp; Client Operations</div>
  <div style="font-size:13px;line-height:1.6;color:#667585;padding-top:10px;">Sara manages the administrative and coordination side of your project from approval through completion. She handles project communication, contracts, change orders, billing, and coordination between the customer, scheduling team, and field crew.</div>
</td></tr></table>
</td>
</tr>
<tr><td colspan="2" height="12"></td></tr>
<tr>
<td class="stack stack-gap" width="50%" valign="top" style="padding-right:6px;">
<table role="presentation" width="100%" class="card"><tr><td style="padding:18px;">
  <div style="font-size:15px;font-weight:800;color:#041A45;">Shana Parks</div>
  <div style="font-size:11px;font-weight:800;color:#D71920;text-transform:uppercase;letter-spacing:.7px;padding-top:3px;">Scheduling &amp; Field Coordination</div>
  <div style="font-size:13px;line-height:1.6;color:#667585;padding-top:10px;">Shana manages DRH’s field schedule and keeps our technicians moving efficiently from job to job. She coordinates appointment dates, technician availability, arrival windows, reschedules, and day-of scheduling changes so everyone knows where they need to be and when.</div>
</td></tr></table>
</td>
<td class="stack" width="50%" valign="top" style="padding-left:6px;">
<table role="presentation" width="100%" class="card"><tr><td style="padding:18px;">
  <div style="font-size:15px;font-weight:800;color:#041A45;">Austin Carrier</div>
  <div style="font-size:11px;font-weight:800;color:#D71920;text-transform:uppercase;letter-spacing:.7px;padding-top:3px;">Security Systems Field Lead</div>
  <div style="font-size:13px;line-height:1.6;color:#667585;padding-top:10px;">Austin is a key part of DRH’s field operation and helps set the standard for how our work is completed in the field. He handles complex installations, system upgrades, troubleshooting, testing, and service while helping ensure projects are completed cleanly, correctly, and to DRH standards.</div>
</td></tr></table>
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td class="pad" style="padding-top:2px; padding-bottom:28px;">
<table role="presentation" width="100%" bgcolor="#F5F7FA" style="border-left:4px solid #29C7F3;">
<tr><td style="padding:17px 18px;">
  <div style="font-size:15px;font-weight:800;color:#041A45;">Our Field Team</div>
  <div style="font-size:13px;line-height:1.65;color:#667585;padding-top:6px;">Depending on your project, additional DRH technicians may work alongside Austin. We assign our field team based on the scope of work, schedule, and the expertise needed for your system.</div>
</td></tr>
</table>
</td>
</tr>

<tr><td class="pad" style="padding-bottom:16px;"><h2 class="h2">What happens next</h2></td></tr>
<tr>
<td class="pad" style="padding-bottom:34px;">
<table role="presentation" width="100%">
<tr>
<td width="33%" valign="top" style="padding-right:12px;">
  <div style="font-size:24px;font-weight:800;color:#29C7F3;">01</div>
  <div style="font-size:14px;font-weight:800;color:#041A45;padding-top:4px;">Project Review</div>
  <div style="font-size:12px;line-height:1.5;color:#667585;padding-top:5px;">We confirm the approved scope, equipment, materials, and project details.</div>
</td>
<td width="33%" valign="top" style="padding-right:12px;">
  <div style="font-size:24px;font-weight:800;color:#29C7F3;">02</div>
  <div style="font-size:14px;font-weight:800;color:#041A45;padding-top:4px;">Scheduling</div>
  <div style="font-size:12px;line-height:1.5;color:#667585;padding-top:5px;">Shana coordinates your installation or service date and keeps you updated.</div>
</td>
<td width="33%" valign="top">
  <div style="font-size:24px;font-weight:800;color:#29C7F3;">03</div>
  <div style="font-size:14px;font-weight:800;color:#041A45;padding-top:4px;">Installation</div>
  <div style="font-size:12px;line-height:1.5;color:#667585;padding-top:5px;">Our field team completes the work, tests the system, and makes sure everything is operating as intended.</div>
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td class="pad" style="padding-bottom:16px;">
  <div class="body">If questions come up at any point, you do not need to figure out who to contact. <strong>Reply to this email</strong>, call us at <a href="tel:+18007870545" style="color:#062969;font-weight:800;">800-787-0545</a>, or <a href="https://www.drhsecurityservices.com/contact" style="color:#062969;font-weight:800;">contact us online</a> and we’ll get you to the right person.</div>
</td>
</tr>

<tr>
<td class="pad" style="padding-bottom:38px;">
  <div class="body">We appreciate the trust you’ve placed in our team and look forward to working with you.<br><br>
    <strong style="color:#041A45;">JR Parks</strong><br>
    <span style="color:#667585;">Owner, DRH Security</span>
  </div>
</td>
</tr>

<!-- CONTACT BAND -->
<tr>
<td bgcolor="#062969" class="pad" style="padding-top:20px; padding-bottom:20px;">
  <table role="presentation" width="100%">
    <tr>
      <td class="stack stack-gap" width="33%" valign="top" style="padding-right:10px;">
        <div style="font-size:10px; font-weight:800; letter-spacing:1px; color:#29C7F3; text-transform:uppercase;">Call</div>
        <div style="font-size:14px; font-weight:800; color:#fff; padding-top:4px;">
          <a href="tel:+18007870545" style="color:#fff;">800-787-0545</a>
        </div>
      </td>
      <td class="stack stack-gap" width="42%" valign="top" style="padding-right:10px;">
        <div style="font-size:10px; font-weight:800; letter-spacing:1px; color:#29C7F3; text-transform:uppercase;">Email</div>
        <div style="font-size:13px; font-weight:700; color:#fff; padding-top:4px;">
          <a href="mailto:info@drhsecurityservices.com" style="color:#fff;">info@drhsecurityservices.com</a>
        </div>
      </td>
      <td class="stack" width="25%" valign="top">
        <div style="font-size:10px; font-weight:800; letter-spacing:1px; color:#29C7F3; text-transform:uppercase;">Online</div>
        <div style="font-size:13px; font-weight:700; color:#fff; padding-top:4px;">
          <a href="https://www.drhsecurityservices.com/contact" style="color:#fff;">Contact DRH</a>
        </div>
      </td>
    </tr>
  </table>
</td>
</tr>

<!-- FOOTER -->
<tr>
<td bgcolor="#041A45" class="pad" style="padding-top:22px; padding-bottom:24px; text-align:center;">
  <div style="font-size:12px; line-height:1.6; color:#C6D2E0;">
    <strong style="color:#fff;">DRH Security</strong> &nbsp;•&nbsp; A Division of Highside Security, Inc.
  </div>
  <div style="font-size:11px; line-height:1.55; color:#8398B0; padding-top:10px;">
    You’re receiving this because you’re a DRH Security customer.<br>
    1151 Eagle Drive #104, Loveland, CO 80537
  </div>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;

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
