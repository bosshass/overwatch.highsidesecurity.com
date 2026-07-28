// ============================================
// Jovelin — QBO disconnect landing
// GET /api/qbo/disconnect?realmId=...
// Where Intuit sends someone after they disconnect the app from within
// QuickBooks' own "Manage My Apps" screen. Handles both jobs: cleans up
// the stale connection in Jovelin's own database (if a realmId came
// through — defensive, since it's not certain every disconnect flow
// includes it) so the app doesn't keep trying to use dead tokens, and
// shows a plain confirmation page either way. Public — no Jovelin sign-in
// exists at this point, since this comes from Intuit's side, not ours.
// ============================================
import { getSupabase } from './_client.js';

function page({ title, message, color }) {
  return `<!DOCTYPE html><html><head><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Inter,system-ui,sans-serif;background:#f7f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .card{background:#fff;border:1px solid #e5e9eb;border-radius:14px;padding:36px;max-width:420px;text-align:center}
  h1{color:${color};font-size:18px;margin:0 0 8px}p{color:#6b7787;font-size:14px;line-height:1.6;margin:0}</style></head>
  <body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

export default async function handler(req, res) {
  const realmId = req.query.realmId || req.query.realmid;
  res.setHeader('Content-Type', 'text/html');

  if (!realmId) {
    return res.status(200).send(page({
      title: 'Disconnected from QuickBooks',
      message: "This QuickBooks company has been disconnected. If Jovelin still shows it as connected, use \u201cConnect QuickBooks\u201d again from Settings to refresh it.",
      color: '#0D4F5C',
    }));
  }

  try {
    const supabase = getSupabase();
    await supabase.from('qbo_connections').delete().eq('realm_id', String(realmId));
    return res.status(200).send(page({
      title: 'Disconnected from QuickBooks',
      message: 'This company has been disconnected, and Jovelin has been updated to match \u2014 the stale connection was removed on our end too.',
      color: '#16a34a',
    }));
  } catch (err) {
    return res.status(200).send(page({
      title: 'Disconnected from QuickBooks',
      message: "This company has been disconnected from QuickBooks' side. Jovelin's own record of it may need a manual check.",
      color: '#d97706',
    }));
  }
}
