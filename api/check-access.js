// ============================================
// Jovelin — Is this email allowed into the app?
// POST /api/check-access  { email }
// ============================================
// Deliberately server-side, using the service role.
//
// The obvious implementation is a user_roles lookup straight from the
// browser, and that's what this replaces. It works today only because
// user_roles is still readable by the anon key. The moment tenant-scoped
// RLS lands, an anonymous read of user_roles returns nothing — and since
// the access check has to run BEFORE a session exists, every user would
// look unauthorised and the whole app would lock itself out.
//
// Running it with the service role makes the check independent of RLS, so
// enabling policies can't turn the front door into a wall.
//
// Returns only a boolean. It never reveals whether an address exists, what
// role it holds, or which tenant it belongs to.
import { createClient } from '@supabase/supabase-js';

const OPERATOR_SET = (process.env.VITE_OPERATOR_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const email = (req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ allowed: false });

  // Legacy operators (the original single-company team) keep access
  // without needing a user_roles row.
  if (OPERATOR_SET.includes(email)) return res.status(200).json({ allowed: true });

  try {
    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.from('user_roles')
      .select('id, tenant_id, role').eq('email', email).is('revoked_at', null).maybeSingle();
    if (error || !data) return res.status(200).json({ allowed: false });

    // Super admins aren't tied to a tenant. Everyone else loses access when
    // the client they belong to is deactivated — otherwise switching a
    // client off would leave their staff still able to sign in and work.
    if (data.role === 'super_admin' || !data.tenant_id) return res.status(200).json({ allowed: true });

    const { data: tenant } = await supabase.from('tenants')
      .select('deactivated_at').eq('id', data.tenant_id).maybeSingle();
    return res.status(200).json({ allowed: !!tenant && !tenant.deactivated_at });
  } catch (err) {
    // Fail CLOSED — an outage must not become an open door.
    return res.status(200).json({ allowed: false });
  }
}
