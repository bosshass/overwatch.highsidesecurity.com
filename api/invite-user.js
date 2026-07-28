// ============================================
// Jovelin — Invite a user
// POST /api/invite-user  { email, tenant_id, role, invited_by }
// Uses generateLink({ type: 'invite' }) instead of inviteUserByEmail —
// this generates the real, working invite link WITHOUT Supabase sending
// any email itself. Sidesteps the whole rate-limit/SMTP problem entirely:
// the frontend gets the link back and opens a Gmail compose draft with
// it (same pattern as AR Chase), letting the admin review and send it
// themselves through their own Gmail.
// ============================================
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { email, tenant_id, role, invited_by } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  if (role === 'super_admin') return res.status(403).json({ error: 'super_admin cannot be granted through this endpoint' });
  if (!['tenant_admin', 'tenant_user', 'staff'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  // staff work across every client, so they have no tenant of their own.
  if (role !== 'staff' && !tenant_id) return res.status(400).json({ error: 'tenant_id required for this role' });

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // WHO is inviting, verified against the database rather than trusted
  // from the request body. Previously only staff creation was checked,
  // which left every other invite open: any caller could grant themselves
  // or anyone else tenant_admin on any client, and read that client's
  // books. Hiding the form in the UI was never a control.
  const inviterEmail = String(invited_by || '').toLowerCase().trim();
  if (!inviterEmail) return res.status(403).json({ error: 'Inviter not identified.' });

  const { data: inviter, error: inviterErr } = await supabase.from('user_roles')
    .select('role, tenant_id').eq('email', inviterEmail).is('revoked_at', null).maybeSingle();

  // Fails closed — an unreadable or missing role grants nothing.
  if (inviterErr || !inviter) {
    return res.status(403).json({ error: 'You do not have permission to invite users.' });
  }

  const isSuper = inviter.role === 'super_admin';
  const isStaff = inviter.role === 'staff';
  const isTenantAdmin = inviter.role === 'tenant_admin';

  // Staff reach every client's accounting, so only a super admin makes one.
  if (role === 'staff' && !isSuper) {
    return res.status(403).json({ error: 'Only a super admin can create staff accounts.' });
  }
  // Super admins and staff invite into any client; a tenant_admin only
  // into their own, and only the restricted user tier — otherwise they
  // could promote a peer, or themselves via a second account.
  if (!isSuper && !isStaff) {
    if (!isTenantAdmin) {
      return res.status(403).json({ error: 'You do not have permission to invite users.' });
    }
    if (String(inviter.tenant_id) !== String(tenant_id)) {
      return res.status(403).json({ error: 'You can only invite people to your own client.' });
    }
    if (role !== 'tenant_user') {
      return res.status(403).json({ error: 'You can only invite standard users.' });
    }
  }
  const siteUrl = process.env.SITE_URL || 'https://jovelin.vercel.app';

  try {
    // If a role row already exists for this email, this is a resend/retry
    // (e.g. the earlier attempt's generateLink call failed after the row
    // was created — a real state this hit once already) — don't fail on
    // the unique constraint, just proceed straight to generating the link.
    const { data: existing } = await supabase.from('user_roles').select('id').eq('email', email).maybeSingle();
    if (!existing) {
      const { error: roleErr } = await supabase.from('user_roles').insert({ email, tenant_id: tenant_id || null, role, invited_by: invited_by || null });
      if (roleErr) return res.status(400).json({ error: roleErr.message });
    }

    const { data, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'invite', email, options: { redirectTo: siteUrl },
    });
    if (linkErr) return res.status(502).json({ error: `${existing ? 'Role already existed' : 'Role created'}, but generating the invite link failed: ${linkErr.message}` });

    const actionLink = data?.properties?.action_link || data?.action_link || null;
    if (!actionLink) return res.status(502).json({ error: 'Role exists, but no invite link came back — check Supabase project settings.' });

    return res.status(200).json({ invited: true, userId: data?.user?.id || null, actionLink });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
}
