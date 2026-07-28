// ============================================
// Jovelin — Settings
// ============================================
// Two entirely different screens depending on who's looking:
//
// Super admin (sara@jnbservice.com only): add new tenants (name -> connect
// QuickBooks -> add that tenant's first admin user), and per-tenant feature
// toggles — a feature left off still shows in nav, but using it shows an
// upgrade message instead of the real screen.
//
// Everyone else (tenant admins): manage up to 2 additional users for their
// own tenant. Those users are permanently Time-only — no path for them (or
// anyone at the tenant) to grant themselves more access from inside the app.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useUserRole } from '../context/UserRoleContext.jsx';
import { useSignature } from '../utils/useSignature.js';
import { openGmailCompose } from '../utils/gmailCompose.js';
import BrandingEditor from '../components/BrandingEditor.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const inputStyle = { width: '100%', padding: '9px 12px', fontSize: 14, border: `1px solid ${BORDER}`, borderRadius: 8, boxSizing: 'border-box' };

const FEATURE_LABELS = {
  board: 'Board', overview: 'Command Center', estimates: 'Estimates',
  work: 'Time', billing: 'Billing', revenue: 'Revenue', profitability: 'Profit',
};

function fmtLastSeen(info) {
  if (!info) return '…';
  // This check only sees Supabase Auth accounts — someone signing in
  // through the app's separate Google Sign-In path (like Sara herself)
  // will never show up here even though they have real, working access.
  // Saying "No account yet" outright would be false for that case.
  if (!info.exists) return 'No Supabase account found (may use Google Sign-In instead)';
  if (!info.lastSignInAt) return 'Invited — never logged in';
  return `Last login ${new Date(info.lastSignInAt).toLocaleString()}`;
}

// Shared between the tenant-admin and super-admin views — a single user
// row with audit info (from Supabase's admin API, not just our own table)
// and the two actions that were missing entirely: reset password, remove
// access (which revokes rather than deletes — see the schema note on
// revoked_at for why that distinction matters).
function UserRow({ user, auditInfo, onChanged, tenantName, signature }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const resetPassword = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await apiFetch('/api/generate-reset-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email }),
      }).then(res => res.json());
      if (!r.actionLink) { setMsg(r.error || 'Could not generate reset link.'); setBusy(false); return; }
      openGmailCompose({
        to: user.email, subject: 'Reset your Jovelin password',
        body: `Hi,\n\nHere's a link to reset your Jovelin password:\n${r.actionLink}\n\nThanks,${signature || ''}`,
      });
      setMsg('Reset link ready — a Gmail draft just opened for you to send.');
    } catch (e) {
      setMsg('Could not generate reset link: ' + e.message);
    }
    setBusy(false);
  };

  const removeAccess = async () => {
    if (!window.confirm(`Remove ${user.email}'s access? This can be undone later, but they'll be blocked immediately.`)) return;
    setBusy(true);
    await supabase.from('user_roles').update({ revoked_at: new Date().toISOString() }).eq('id', user.id);
    setBusy(false);
    onChanged?.();
  };

  const restoreAccess = async () => {
    setBusy(true);
    await supabase.from('user_roles').update({ revoked_at: null }).eq('id', user.id);
    setBusy(false);
    onChanged?.();
  };

  // Only reachable for tenant_admin/tenant_user — super_admin can never
  // go through /api/invite-user, so if THIS role has no Supabase account,
  // it's genuinely a stuck invite (generateLink failed after the role row
  // was already created), not a Google Sign-In legacy account like Sara's.
  const resendInvite = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await apiFetch('/api/invite-user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, tenant_id: user.tenant_id, role: user.role, invited_by: user.invited_by }),
      }).then(res => res.json());
      if (!r.actionLink) { setMsg(r.error || 'Could not resend invite.'); setBusy(false); return; }
      openGmailCompose({
        to: user.email, subject: `You're invited to Jovelin${tenantName ? ' — ' + tenantName : ''}`,
        body: `Hi,\n\nUse this link to set your password and get started:\n${r.actionLink}\n\nThanks,${signature || ''}`,
      });
      setMsg('Invite resent — a Gmail draft just opened for you to send.');
      onChanged?.();
    } catch (e) {
      setMsg('Could not resend invite: ' + e.message);
    }
    setBusy(false);
  };

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #e5e9eb', opacity: user.revoked_at ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <span style={{ fontSize: 13, color: '#1c1c1e', fontWeight: 600 }}>{user.email}</span>
          <span style={{ fontSize: 11, color: '#6b7787', marginLeft: 8, textTransform: 'capitalize' }}>{user.role.replace('_', ' ')}</span>
          {tenantName && <span style={{ fontSize: 11, color: '#0D4F5C', marginLeft: 8, fontWeight: 700 }}>· {tenantName}</span>}
          {user.revoked_at && <span style={{ fontSize: 11, color: '#dc2626', marginLeft: 8, fontWeight: 700 }}>REVOKED</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 , flexWrap: 'wrap'}}>
          {user.revoked_at ? (
            <button onClick={restoreAccess} disabled={busy} style={{ background: 'none', border: '1px solid #16a34a', color: '#16a34a', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Restore</button>
          ) : (
            <>
              {user.role !== 'super_admin' && auditInfo && !auditInfo.exists && (
                <button onClick={resendInvite} disabled={busy} style={{ background: 'none', border: '1px solid #d97706', color: '#d97706', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Resend Invite</button>
              )}
              <button onClick={resetPassword} disabled={busy} style={{ background: 'none', border: '1px solid #e5e9eb', color: '#6b7787', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Reset PW</button>
              <button onClick={removeAccess} disabled={busy} style={{ background: 'none', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Remove Access</button>
            </>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{fmtLastSeen(auditInfo)}</div>
      {msg && <div style={{ fontSize: 11, color: msg.startsWith('Could not') ? '#dc2626' : '#16a34a', marginTop: 2 }}>{msg}</div>}
    </div>
  );
}

export default function Settings({ userEmail }) {
  const { currentTenantId, currentTenant, tenants, reload: reloadTenants } = useTenant();
  const { isSuperAdmin, isStaff, canManageTenants } = useUserRole();
  const signature = useSignature(userEmail);

  return (
    <>
      <MySignature userEmail={userEmail} />
      <TenantBranding userEmail={userEmail} />
      {(isSuperAdmin || isStaff)
        // Staff get the same cross-client user management, minus anything
        // that changes what a client HAS — creating clients, plan features
        // and seat limits stay with the super admin.
        ? <SuperAdminSettings userEmail={userEmail} tenants={tenants} reloadTenants={reloadTenants}
            signature={signature} canManageTenants={canManageTenants} />
        : <TenantSettings tenantId={currentTenantId} tenantName={currentTenant?.name} userEmail={userEmail} signature={signature} />}
    </>
  );
}

// ============================================
// Everyone's own signature — used by AR Chase and Send to Customer, built
// directly into the email body Jovelin generates. This is deliberately
// NOT Gmail's own signature setting: that only shows up if that specific
// Google account happens to have one configured, and varies by which
// account is active in the browser. Storing it here means the same
// signature appears every time, regardless of whose Gmail tab opens.
// ============================================
// Same editor the A/R screen embeds — one implementation, so the two
// places can't drift apart.
function TenantBranding({ userEmail }) {
  return (
    <div style={{ background: '#f7f9fa', padding: '0 16px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e5e9eb', borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <div style={{ color: '#0D4F5C', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Branding</div>
          <BrandingEditor userEmail={userEmail} />
        </div>
      </div>
    </div>
  );
}

function MySignature({ userEmail }) {
  const [signature, setSignature] = useState('');
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) return;
    supabase.from('user_signatures').select('signature').eq('email', userEmail.toLowerCase()).maybeSingle()
      .then(({ data }) => { setSignature(data?.signature || `\n${userEmail}`); setLoading(false); });
  }, [userEmail]);

  const save = async () => {
    await supabase.from('user_signatures').upsert({ email: userEmail.toLowerCase(), signature, updated_at: new Date().toISOString() }, { onConflict: 'email' });
    setSaved(true);
  };

  if (loading) return null;
  return (
    <div style={{ background: '#f7f9fa', minHeight: 0, padding: '20px 16px 0', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e5e9eb', borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <div style={{ color: '#0D4F5C', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>My Email Signature</div>
          <div style={{ color: '#6b7787', fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
            Appended to A/R Chase and Send to Customer emails. <b>Plain text only</b> — Jovelin opens a Gmail draft, and
            draft links can't carry HTML, so tags or images typed here appear literally.
            <br /><br />
            <b>Want a formatted signature with a logo?</b> Set it up in Gmail instead (Settings → General → Signature).
            Gmail appends it to every draft automatically, including the ones Jovelin opens, and it supports images,
            links, and formatting. If you do that, leave this box <b>empty</b> — otherwise you'll get both signatures
            stacked on the same email.
          </div>
          <textarea value={signature} onChange={e => { setSignature(e.target.value); setSaved(false); }} rows={4}
            style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #e5e9eb', borderRadius: 8, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
          <button onClick={save} disabled={saved} style={{ marginTop: 8, background: saved ? '#e5e9eb' : '#0D4F5C', color: saved ? '#6b7787' : '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: saved ? 'default' : 'pointer', fontSize: 12 }}>
            {saved ? 'Saved' : 'Save Signature'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Tenant-level: manage up to 2 Time-only users
// ============================================
function TenantSettings({ tenantId, tenantName, userEmail, signature }) {
  const [users, setUsers] = useState([]);
  const [auditByEmail, setAuditByEmail] = useState({});
  const [seatLimit, setSeatLimit] = useState(2);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: userData }, { data: featData }] = await Promise.all([
      supabase.from('user_roles').select('*').eq('tenant_id', tenantId).order('created_at'),
      supabase.from('tenant_features').select('user_seat_limit').eq('tenant_id', tenantId).maybeSingle(),
    ]);
    setUsers(userData || []);
    setSeatLimit(featData?.user_seat_limit ?? 2);
    setLoading(false);
    if (userData?.length) {
      const r = await apiFetch('/api/admin-user-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: userData.map(u => u.email) }),
      }).then(res => res.json()).catch(() => ({ users: {} }));
      setAuditByEmail(r.users || {});
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const tenantUserCount = users.filter(u => u.role === 'tenant_user' && !u.revoked_at).length;
  const atLimit = tenantUserCount >= seatLimit;

  const addUser = async () => {
    if (!newEmail.trim()) return;
    setInviting(true); setMsg('');
    try {
      const r = await apiFetch('/api/invite-user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim().toLowerCase(), tenant_id: tenantId, role: 'tenant_user', invited_by: userEmail }),
      }).then(res => res.json());
      if (r.invited && r.actionLink) {
        openGmailCompose({
          to: newEmail.trim(), subject: `You're invited to Jovelin — ${tenantName}`,
          body: `Hi,\n\nYou've been added to Jovelin for ${tenantName}. Use this link to set your password and get started:\n${r.actionLink}\n\nThanks,${signature || ''}`,
        });
        setMsg(`${newEmail} invited — a Gmail draft just opened for you to send.`); setNewEmail(''); load();
      } else setMsg(r.error || 'Could not invite user.');
    } catch (e) {
      setMsg('Could not invite user: ' + e.message);
    }
    setInviting(false);
  };

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>Settings</h1>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 20 }}>{tenantName} — users you add here can only see Time (tasks, jobs, logging hours). Nothing else in the platform.</p>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>QuickBooks Connection</div>
          <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 10 }}>If financial data looks wrong or missing, reconnecting refreshes {tenantName}'s connection to its QuickBooks company.</div>
          <a href={`/api/qbo/connect?tenant_id=${tenantId}`} style={{
            display: 'inline-block', background: TEAL, color: '#fff', fontWeight: 700, padding: '9px 18px',
            borderRadius: 8, textDecoration: 'none', fontSize: 13,
          }}>Connect / Reconnect QuickBooks</a>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Users ({tenantUserCount} / {seatLimit})</div>
          {loading ? <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div> : users.length === 0 ? (
            <div style={{ color: SUBTEXT, fontSize: 13, marginBottom: 12 }}>No users added yet.</div>
          ) : users.map(u => (
            <UserRow key={u.id} user={u} auditInfo={auditByEmail[u.email.toLowerCase()]} onChanged={load} signature={signature} />
          ))}

          {atLimit ? (
            <div style={{ background: '#fff7ed', color: AMBER, borderRadius: 8, padding: '12px 14px', fontSize: 13, marginTop: 12 }}>
              You've reached your {seatLimit}-user limit for this tenant. <b>Contact JNB</b> to add more.
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <input type="email" placeholder="email@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} style={inputStyle} />
              <button onClick={addUser} disabled={inviting} style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}>
                {inviting ? '…' : '+ Add'}
              </button>
            </div>
          )}
          {msg && <div style={{ color: msg.startsWith('Invited') ? GREEN : RED, fontSize: 12, marginTop: 10 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Super admin: provision tenants, set feature access
// ============================================
function SuperAdminSettings({ userEmail, tenants, reloadTenants, signature, canManageTenants = true }) {
  const [newTenantName, setNewTenantName] = useState('');
  const [creating, setCreating] = useState(false);
  const [provisioning, setProvisioning] = useState(null); // { tenantId, name, step }
  const [adminEmail, setAdminEmail] = useState('');
  const [featuresByTenant, setFeaturesByTenant] = useState({});
  const [seatLimitByTenant, setSeatLimitByTenant] = useState({});
  const [usersByTenant, setUsersByTenant] = useState({});
  const [allUsers, setAllUsers] = useState([]);
  const [staffEmail, setStaffEmail] = useState('');
  const [invitingStaff, setInvitingStaff] = useState(false);
  // Whether THIS browser holds a real Supabase session. Until every active
  // user does, enabling RLS would lock them out — so this is the gate on
  // doing it, shown to the person who'd be doing it.
  const [mySession, setMySession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMySession(data?.session?.user?.email || null));
  }, []);
  const [auditByEmail, setAuditByEmail] = useState({});
  const [msg, setMsg] = useState('');

  const loadFeatures = useCallback(async () => {
    const { data } = await supabase.from('tenant_features').select('*');
    const fMap = {}, sMap = {};
    (data || []).forEach(r => { fMap[r.tenant_id] = r.features; sMap[r.tenant_id] = r.user_seat_limit; });
    setFeaturesByTenant(fMap);
    setSeatLimitByTenant(sMap);
  }, []);

  const saveSeatLimit = async (tenantId, value) => {
    const n = Math.max(0, parseInt(value) || 0);
    setSeatLimitByTenant(s => ({ ...s, [tenantId]: n }));
    await supabase.from('tenant_features').update({ user_seat_limit: n }).eq('tenant_id', tenantId);
  };

  const loadUsers = useCallback(async () => {
    const { data } = await supabase.from('user_roles').select('*').order('created_at');
    const map = {};
    (data || []).forEach(u => { if (u.tenant_id) (map[u.tenant_id] = map[u.tenant_id] || []).push(u); });
    setUsersByTenant(map);
    setAllUsers(data || []);
    if (data?.length) {
      const r = await apiFetch('/api/admin-user-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: data.map(u => u.email) }),
      }).then(res => res.json()).catch(() => ({ users: {} }));
      setAuditByEmail(r.users || {});
    }
  }, []);

  useEffect(() => { loadFeatures(); loadUsers(); }, [loadFeatures, loadUsers]);

  const [inviteOpenId, setInviteOpenId] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('tenant_admin');
  const [inviting, setInviting] = useState(false);

  const addStaff = async () => {
    if (!staffEmail.trim()) return;
    setInvitingStaff(true); setMsg('');
    const r = await apiFetch('/api/invite-user', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // No tenant_id — staff belong to every client, not one.
      body: JSON.stringify({ email: staffEmail.trim().toLowerCase(), role: 'staff', invited_by: userEmail }),
    }).then(res => res.json()).catch(e => ({ error: e.message }));
    setInvitingStaff(false);
    if (r.invited && r.actionLink) {
      openGmailCompose({
        to: staffEmail.trim(), subject: 'You\u2019ve been added to Jovelin',
        body: `Hi,\n\nYou've been set up with staff access to Jovelin, covering every client. Use this link to set your password:\n${r.actionLink}\n\nThanks,${signature || ''}`,
      });
      setMsg(`${staffEmail} added as staff — a Gmail draft just opened for you to send.`);
      setStaffEmail(''); loadUsers();
    } else setMsg(r.error || 'Could not add that staff member.');
  };

  const inviteToTenant = async (tenantId) => {
    if (!inviteEmail.trim()) return;
    // Applies to any role now — a 'seat limit' displayed next to a user
    // list that only ever gated tenant_user invites let tenant_admin
    // count grow unbounded through this exact flow, which is exactly
    // the contradiction: two admins sitting under a 'limit of 2'.
    const currentCount = (usersByTenant[tenantId] || []).filter(u => !u.revoked_at).length;
    const limit = seatLimitByTenant[tenantId] ?? 2;
    if (currentCount >= limit) { setMsg(`At the ${limit}-seat limit for this tenant — raise it above before adding more.`); return; }
    setInviting(true);
    const r = await apiFetch('/api/invite-user', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), tenant_id: tenantId, role: inviteRole, invited_by: userEmail }),
    }).then(res => res.json());
    setInviting(false);
    if (r.invited && r.actionLink) {
      const t = tenants.find(x => x.id === tenantId);
      openGmailCompose({
        to: inviteEmail.trim(), subject: `You're invited to Jovelin${t ? ' — ' + t.name : ''}`,
        body: `Hi,\n\nYou've been added to Jovelin${t ? ' for ' + t.name : ''}. Use this link to set your password and get started:\n${r.actionLink}\n\nThanks,${signature || ''}`,
      });
      setMsg(`Invited ${inviteEmail} as ${inviteRole.replace('_', ' ')} — a Gmail draft just opened for you to send.`);
      setInviteEmail(''); setInviteOpenId(null); loadUsers();
    } else setMsg(r.error || 'Could not invite.');
  };

  const createTenant = async () => {
    if (!newTenantName.trim()) return;
    setCreating(true);
    const slug = newTenantName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const { data, error } = await supabase.from('tenants').insert({ name: newTenantName.trim(), slug }).select().single();
    setCreating(false);
    if (error) { setMsg(error.message); return; }
    await supabase.from('tenant_features').insert({ tenant_id: data.id });
    setNewTenantName('');
    setProvisioning({ tenantId: data.id, name: data.name, step: 'qbo' });
    reloadTenants(); loadFeatures();
  };

  const addTenantAdmin = async () => {
    if (!adminEmail.trim() || !provisioning) return;
    const r = await apiFetch('/api/invite-user', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail.trim().toLowerCase(), tenant_id: provisioning.tenantId, role: 'tenant_admin', invited_by: userEmail }),
    }).then(res => res.json());
    if (r.invited && r.actionLink) {
      openGmailCompose({
        to: adminEmail.trim(), subject: `You're the admin for ${provisioning.name} on Jovelin`,
        body: `Hi,\n\nYou've been set up as the admin for ${provisioning.name} on Jovelin. Use this link to set your password and get started:\n${r.actionLink}\n\nThanks,${signature || ''}`,
      });
      setMsg(`${provisioning.name}: admin ${adminEmail} invited — a Gmail draft just opened for you to send.`);
      setProvisioning(null); setAdminEmail(''); loadUsers();
    } else setMsg(r.error || 'Could not invite admin.');
  };

  const toggleFeature = async (tenantId, key) => {
    const current = featuresByTenant[tenantId] || {};
    const next = { ...current, [key]: !current[key] };
    setFeaturesByTenant(f => ({ ...f, [tenantId]: next }));
    await supabase.from('tenant_features').upsert({ tenant_id: tenantId, features: next }, { onConflict: 'tenant_id' });
  };

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>
          Settings — {canManageTenants ? 'Super Admin' : 'Staff'}
        </h1>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 12 }}>
          {canManageTenants
            ? 'Add tenants, connect QuickBooks, invite their admin, and control which features each one has.'
            : 'Every client, and the people who can reach them. Creating clients, plan features and seat limits are super admin only.'}
        </p>

        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#3730a3' }}>
          ⓘ This page is <b>not</b> scoped to whichever client is selected in the sidebar above — it always shows every tenant, all at once.
          Each tenant's own settings and users live inside its own card below, clearly labeled by name.
        </div>

        {msg && <div style={{
          background: msg.includes('opened for you to send') ? '#e6f4ea' : '#fdecea',
          color: msg.includes('opened for you to send') ? GREEN : RED,
          borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14,
        }}>{msg}</div>}

        {canManageTenants && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add a Tenant</div>
          <div style={{ display: 'flex', gap: 8 , flexWrap: 'wrap'}}>
            <input placeholder="Client name" value={newTenantName} onChange={e => setNewTenantName(e.target.value)} style={inputStyle} />
            <button onClick={createTenant} disabled={creating} style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontWeight: 700, cursor: 'pointer' }}>
              {creating ? '…' : '+ Create'}
            </button>
          </div>

          {provisioning && (
            <div style={{ marginTop: 14, padding: 14, background: '#f7f9fa', borderRadius: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{provisioning.name} — finish setup</div>
              <a href={`/api/qbo/connect?tenant_id=${provisioning.tenantId}`} style={{
                display: 'inline-block', background: TEAL, color: '#fff', fontWeight: 700, padding: '9px 16px',
                borderRadius: 8, textDecoration: 'none', fontSize: 13, marginBottom: 12,
              }}>1. Connect QuickBooks</a>
              <div style={{ display: 'flex', gap: 8 , flexWrap: 'wrap'}}>
                <input type="email" placeholder="Admin's email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} style={inputStyle} />
                <button onClick={addTenantAdmin} style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}>2. Invite Admin</button>
              </div>
            </div>
          )}
        </div>
        )}

        {canManageTenants && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>JNB Staff</div>
          <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
            Your own people. They work inside every client — billing, A/R, estimates — regardless of what that client's
            plan includes, and can add users to any client. They <b>cannot</b> create or deactivate clients, change a
            client's plan, or approve their own writes to QuickBooks: everything they send lands in Admin for you.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="email" placeholder="staff@yourcompany.com" value={staffEmail}
              onChange={e => setStaffEmail(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px' }} />
            <button onClick={addStaff} disabled={invitingStaff}
              style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontWeight: 700, cursor: 'pointer' }}>
              {invitingStaff ? '…' : '+ Add staff'}
            </button>
          </div>
        </div>
        )}

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>All Users ({allUsers.length})</div>
          <div style={{
            background: mySession ? '#e6f4ea' : '#fff7ed',
            color: mySession ? GREEN : AMBER,
            borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 12, lineHeight: 1.5,
          }}>
            {mySession
              ? `Database session active for ${mySession}. Row-level security can identify you.`
              : 'No database session — you are signed in, but the database cannot yet identify you. Sign out and back in to establish one. Row-level security must not be enabled until every active user shows a session here.'}
          </div>
          {allUsers.length === 0 ? (
            <div style={{ color: SUBTEXT, fontSize: 13 }}>No users yet.</div>
          ) : (
            allUsers.map(u => (
              <UserRow key={u.id} user={u} auditInfo={auditByEmail[u.email.toLowerCase()]} onChanged={loadUsers} signature={signature}
                tenantName={u.role === 'super_admin' ? 'Super Admin — all clients'
                  : u.role === 'staff' ? 'JNB Staff — all clients'
                  : (tenants.find(t => t.id === u.tenant_id)?.name || 'Unknown tenant')} />
            ))
          )}
        </div>

        <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Tenants & Features</div>
        {tenants.map(t => (
          <div key={t.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: TEAL, color: '#fff', padding: '10px 16px', fontWeight: 700, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {t.name}
              <a href={`/api/qbo/connect?tenant_id=${t.id}`} style={{ color: '#fff', fontSize: 11, fontWeight: 700, textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                Connect / Reconnect QuickBooks
              </a>
            </div>
            <div style={{ padding: 16 }}>
              {canManageTenants && (<>
              <div style={{ color: SUBTEXT, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Features for {t.name}</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${BORDER}` }}>
                {Object.keys(FEATURE_LABELS).map(key => {
                  const on = featuresByTenant[t.id]?.[key] !== false;
                  return (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT, cursor: 'pointer' , flexWrap: 'wrap'}}>
                      <input type="checkbox" checked={on} onChange={() => toggleFeature(t.id, key)} />
                      {FEATURE_LABELS[key]}
                    </label>
                  );
                })}
              </div>
              </>)}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 , flexWrap: 'wrap'}}>
                <div style={{ color: SUBTEXT, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Users at {t.name} ({(usersByTenant[t.id] || []).filter(u => !u.revoked_at).length} / {seatLimitByTenant[t.id] ?? 2} seats — any role counts)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 , flexWrap: 'wrap'}}>
                  <span style={{ color: SUBTEXT, fontSize: 11 }}>Seat limit</span>
                  {canManageTenants ? (
                    <input type="number" min="0" defaultValue={seatLimitByTenant[t.id] ?? 2}
                      onBlur={e => saveSeatLimit(t.id, e.target.value)}
                      style={{ width: 50, padding: '3px 6px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 12, textAlign: 'center' }} />
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{seatLimitByTenant[t.id] ?? 2}</span>
                  )}
                </div>
              </div>
              {(usersByTenant[t.id] || []).length === 0 ? (
                <div style={{ color: SUBTEXT, fontSize: 12 }}>No users yet.</div>
              ) : (
                (usersByTenant[t.id] || []).map(u => (
                  <UserRow key={u.id} user={u} auditInfo={auditByEmail[u.email.toLowerCase()]} onChanged={loadUsers} signature={signature} />
                ))
              )}

              {inviteOpenId === t.id ? (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <input type="email" placeholder="email@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px' }} />
                    <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ ...inputStyle, flex: '0 0 140px' }}>
                      <option value="tenant_admin">Tenant Admin</option>
                      <option value="tenant_user">Tenant User</option>
                    </select>
                    <button onClick={() => inviteToTenant(t.id)} disabled={inviting} style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '0 14px', fontWeight: 700, cursor: 'pointer' }}>
                      {inviting ? '…' : 'Invite'}
                    </button>
                    <button onClick={() => setInviteOpenId(null)} style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '0 10px', cursor: 'pointer', color: SUBTEXT }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setInviteOpenId(t.id); setInviteEmail(''); setInviteRole('tenant_admin'); }} style={{ marginTop: 10, background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 }}>
                  + Add Admin or User to {t.name}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
