// ============================================
// Jovelin — QBO OAuth: token exchange + store
// GET /api/qbo/callback?code=...&realmId=...&state=<tenant_id>.<nonce>
// Validates the nonce in `state` against the cookie set by connect.js —
// this is the actual CSRF check. A callback with a missing or mismatched
// nonce is rejected before any token exchange happens.
// ============================================
import { getSupabase } from './_client.js';

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export default async function handler(req, res) {
  const { code, realmId, state, error } = req.query || {};
  if (error) return res.status(400).send(`QBO error: ${error}`);
  if (!code || !realmId) return res.status(400).send('Missing code or realmId');
  if (!state || !state.includes('.')) return res.status(400).send('Missing or malformed state');

  const dotIndex = state.indexOf('.');
  const tenantId = state.slice(0, dotIndex);
  const nonce = state.slice(dotIndex + 1);
  const cookieNonce = getCookie(req, 'qbo_csrf');

  if (!cookieNonce || cookieNonce !== nonce) {
    return res.status(403).send('CSRF check failed — this callback did not match a connection request from this browser. Please start the connection again from Jovelin.');
  }
  // One-time use — clear it so the same callback URL can't be replayed.
  res.setHeader('Set-Cookie', 'qbo_csrf=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/api/qbo');

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI || `https://${req.headers.host}/api/qbo/callback`;
  if (!clientId || !clientSecret) return res.status(500).send('QBO credentials not configured');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok) return res.status(502).send(`Token exchange failed: ${JSON.stringify(tok)}`);

  const supabase = getSupabase();
  const { error: dbErr } = await supabase.from('qbo_connections').upsert({
    tenant_id: tenantId,
    realm_id: String(realmId),
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    token_expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' });
  if (dbErr) return res.status(500).send(`Storing token failed: ${dbErr.message}`);

  res.writeHead(302, { Location: '/?qbo=connected' });
  res.end();
}
