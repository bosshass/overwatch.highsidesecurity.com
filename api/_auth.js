// ============================================
// Jovelin — who is calling this endpoint?
// ============================================
// Every /api/qbo/* endpoint used to take tenant_id straight off the query
// string and answer with service-role data. No session, no role, no
// membership check. That made a client's live QuickBooks P&L readable by
// anyone who knew a tenant UUID — and tenant UUIDs were readable with the
// anon key that ships in the browser bundle.
//
// This module is the gate. It verifies the caller's Supabase JWT with the
// service role, resolves their user_roles row, and answers two questions:
// may this person touch this tenant at all, and is this tenant one whose
// books only the super admin may see.
//
// Fails CLOSED everywhere. A missing token, an unverifiable token, a
// revoked row, or a lookup error is a 401/403 — never a pass.
import { createClient } from '@supabase/supabase-js';

let _admin = null;
function admin() {
  if (!_admin) {
    _admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _admin;
}

// Legacy operators (the original single-company team) can still sign in
// without a user_roles row — check-access.js honours the same list. They
// are deliberately NOT promoted to super_admin here: an escape hatch for
// the front door must not become an escape hatch for someone's books.
const OPERATOR_SET = (process.env.VITE_OPERATOR_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Resolves the caller, or null if they cannot be established.
export async function resolveCaller(req) {
  const token = bearer(req);
  if (!token) return null;

  const sb = admin();
  let email = null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error) return null;
    email = data?.user?.email?.toLowerCase() || null;
  } catch (e) {
    return null;
  }
  if (!email) return null;

  try {
    const { data: row, error } = await sb.from('user_roles')
      .select('role, tenant_id, revoked_at').eq('email', email).maybeSingle();
    if (error) return null;
    if (row?.revoked_at) return null;
    if (row) return { email, role: row.role, tenantId: row.tenant_id };
    // No row at all. Allowed in only for the legacy operator list, and
    // only at the lowest tier.
    if (OPERATOR_SET.includes(email)) return { email, role: 'legacy_operator', tenantId: null };
    return null;
  } catch (e) {
    return null;
  }
}

// A tenant flagged internal is JNB's own books. Only the super admin sees
// anything financial there; everyone else gets Time and nothing else.
// Unreadable flag is treated as internal — the safe direction.
export async function tenantIsInternal(tenantId) {
  try {
    const { data, error } = await admin().from('tenants')
      .select('is_internal').eq('id', tenantId).maybeSingle();
    if (error || !data) return true;
    return !!data.is_internal;
  } catch (e) {
    return true;
  }
}

// Drop this at the top of any endpoint that touches tenant data.
// Returns the caller, or null after having already sent the error response
// — so the caller just does: `const who = await requireCaller(...); if (!who) return;`
export async function requireCaller(req, res, { tenantId = null } = {}) {
  const caller = await resolveCaller(req);
  if (!caller) {
    res.status(401).json({ error: 'Sign in required.' });
    return null;
  }

  if (tenantId) {
    // Someone pinned to a tenant may never read another one, whatever the
    // query string says.
    if (caller.tenantId && caller.tenantId !== tenantId) {
      res.status(403).json({ error: 'Not your client.' });
      return null;
    }
    // Cross-tenant roles roam freely — except into JNB's own books.
    if (caller.role !== 'super_admin' && await tenantIsInternal(tenantId)) {
      res.status(403).json({ error: 'This client is internal to JNB. Time entry only.' });
      return null;
    }
  }

  return caller;
}
