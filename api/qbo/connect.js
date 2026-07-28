// ============================================
// Jovelin — QBO OAuth: kick off connect (Bloodline app)
// GET /api/qbo/connect?tenant_id=...  ->  302 to Intuit consent
// state carries tenant_id + a random CSRF nonce; the nonce is also set as
// a short-lived httpOnly cookie here and re-checked in callback.js. Without
// this, state was just the plain tenant_id — nothing tied the callback
// back to a request this server actually initiated.
// ============================================
import crypto from 'crypto';

export default async function handler(req, res) {
  const clientId = process.env.QBO_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'QBO_CLIENT_ID not configured' });
  const tenantId = req.query.tenant_id;
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectUri = process.env.QBO_REDIRECT_URI || `https://${req.headers.host}/api/qbo/callback`;
  const url = 'https://appcenter.intuit.com/connect/oauth2?' + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri,
    state: `${tenantId}.${nonce}`,
  });

  res.setHeader('Set-Cookie', `qbo_csrf=${nonce}; HttpOnly; Secure; SameSite=Lax; Max-Age=1800; Path=/api/qbo`);
  res.writeHead(302, { Location: url });
  res.end();
}
