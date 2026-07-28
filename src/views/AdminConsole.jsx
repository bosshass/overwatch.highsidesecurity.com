// ============================================
// Jovelin — Admin console (super admin only)
// ============================================
// Deliberately outside any single tenant and not tied to QuickBooks. It
// exists to stand above the tenants rather than inside one: pick which
// client to work in, and review anything waiting to be written to a
// client's live books.
//
// The approval queue is the important half. Writing to a client's
// accounting is the one action in this app that can't be quietly undone,
// and until now any operator in any tenant could do it directly. Requests
// now land here first, showing who asked and exactly what would be sent.
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useUserRole } from '../context/UserRoleContext.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const card = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 };

const KIND_LABEL = {
  custom_invoice: 'Invoice from time',
  invoice_from_estimate: 'Invoice from estimate',
  cost_tag: 'Assign cost to customer',
};

export default function AdminConsole({ userEmail }) {
  const navigate = useNavigate();
  const { tenants, setCurrentTenantId, currentTenantId, reload: reloadTenants } = useTenant();
  const { canApprovePushes, canManageTenants, isStaff } = useUserRole();
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [approvalByTenant, setApprovalByTenant] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [pendingRes, histRes, featRes] = await Promise.all([
      supabase.from('qbo_push_queue').select('*').eq('status', 'pending').order('requested_at', { ascending: false }),
      supabase.from('qbo_push_queue').select('*').neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(15),
      supabase.from('tenant_features').select('tenant_id, require_push_approval'),
    ]);
    setQueue(pendingRes.data || []);
    setHistory(histRes.data || []);
    const m = {};
    (featRes.data || []).forEach(r => { m[r.tenant_id] = r.require_push_approval !== false; });
    setApprovalByTenant(m);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const tenantName = (id) => tenants.find(t => t.id === id)?.name || 'Unknown tenant';

  const review = async (item, action) => {
    if (action === 'approve' && !window.confirm(
      `Send this to ${tenantName(item.tenant_id)}'s QuickBooks?\n\n${item.summary}\n\nThis writes to their live books.`
    )) return;
    setBusyId(item.id); setMsg('');
    try {
      const r = await apiFetch('/api/admin/review-push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue_id: item.id, action, reviewer: userEmail }),
      }).then(res => res.json());

      if (r.rejected) setMsg('Rejected — nothing was sent to QuickBooks.');
      else if (r.approved && r.succeeded) setMsg('Sent to QuickBooks and confirmed.');
      else if (r.approved) {
        // A client deactivated after the request was queued is the likely
        // cause here, and 'tenant_inactive' on its own doesn't explain that.
        const reason = r.result?.reason === 'tenant_inactive'
          ? 'that client is now deactivated, so nothing can be written to their QuickBooks'
          : (r.result?.error || r.result?.reason || 'unknown reason');
        setMsg(`Not sent — ${reason}.`);
      }
      else setMsg(r.error || 'Could not complete that.');
      load();
    } catch (e) {
      setMsg('Could not complete that: ' + e.message);
    }
    setBusyId(null);
  };

  const toggleApproval = async (tenantId, current) => {
    if (current && !window.confirm(
      `Turn OFF review for ${tenantName(tenantId)}?\n\nTheir users will be able to write to that client's live QuickBooks directly, with no approval step.`
    )) return;
    await supabase.from('tenant_features').update({ require_push_approval: !current }).eq('tenant_id', tenantId);
    setApprovalByTenant(m => ({ ...m, [tenantId]: !current }));
  };

  const setActive = async (t, activate) => {
    const name = t.name;
    if (!activate && !window.confirm(
      `Deactivate ${name}?\n\n` +
      `• Their users can no longer sign in\n` +
      `• Nothing more can be written to their QuickBooks\n` +
      `• The client disappears from the picker for everyone but you\n\n` +
      `No data is deleted, and you can reactivate at any time.`
    )) return;

    const { error } = await supabase.from('tenants').update(
      activate
        ? { deactivated_at: null, deactivated_by: null }
        : { deactivated_at: new Date().toISOString(), deactivated_by: userEmail }
    ).eq('id', t.id);

    if (error) { setMsg('Could not update that client: ' + error.message); return; }
    setMsg(activate ? `${name} reactivated.` : `${name} deactivated — no data was deleted.`);
    reloadTenants();
    load();
  };

  const goToTenant = (id) => {
    setCurrentTenantId(id);
    navigate('/overview');
  };

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>Admin</h1>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 20 }}>
          {canApprovePushes
            ? "Across every client, and not tied to any one QuickBooks company. Choose a client to work in, or review what's waiting to be written to their books."
            : "Across every client. Choose one to work in — everything you send to their QuickBooks goes to a super admin for approval first."}
        </p>

        {msg && (
          <div style={{
            background: msg.includes('confirmed') || msg.includes('Rejected') ? '#e6f4ea' : '#fdecea',
            color: msg.includes('confirmed') || msg.includes('Rejected') ? GREEN : RED,
            borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
          }}>{msg}</div>
        )}

        {/* ── Clients first: choosing one is why most people are here ── */}
        {/* ── Clients ────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Clients</div>
          <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12 }}>
            Open one to work inside it, or control whether its users can write to QuickBooks without review.
          </div>
          {tenants.map(t => {
            const needsApproval = approvalByTenant[t.id] !== false;
            const inactive = !!t.deactivated_at;
            return (
              <div key={t.id} style={{ borderTop: `1px solid ${BORDER}`, padding: '11px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: inactive ? SUBTEXT : TEXT, fontWeight: 600, fontSize: 14 }}>
                    {t.name}
                    {inactive && (
                      <span style={{ fontSize: 9, fontWeight: 700, marginLeft: 8, padding: '2px 8px', borderRadius: 10, background: '#f1f3f4', color: SUBTEXT }}>
                        INACTIVE
                      </span>
                    )}
                    {t.id === currentTenantId && !inactive && <span style={{ color: SUBTEXT, fontWeight: 400, fontSize: 11 }}> · currently open</span>}
                  </div>
                  <div style={{ color: inactive ? SUBTEXT : (needsApproval ? SUBTEXT : AMBER), fontSize: 11 }}>
                    {inactive
                      ? `Deactivated ${new Date(t.deactivated_at).toLocaleDateString()} — users blocked, no QuickBooks writes. Data intact.`
                      : needsApproval
                        ? 'QuickBooks writes need your approval'
                        : 'Writes go straight to QuickBooks — no review'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  {inactive ? (
                    // Only a super admin can bring a client back.
                    canManageTenants ? (
                      <button onClick={() => setActive(t, true)}
                        style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                        Reactivate
                      </button>
                    ) : null
                  ) : (
                    <>
                      {/* Changing what a client HAS stays with the super
                          admin. Staff choose a client and work in it. */}
                      {canManageTenants && (
                        <>
                          <button onClick={() => toggleApproval(t.id, needsApproval)}
                            style={{ background: 'none', border: `1px solid ${BORDER}`, color: SUBTEXT, borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                            {needsApproval ? 'Allow direct writes' : 'Require approval'}
                          </button>
                          <button onClick={() => setActive(t, false)}
                            style={{ background: 'none', border: `1px solid ${RED}`, color: RED, borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                            Deactivate
                          </button>
                        </>
                      )}
                      <button onClick={() => goToTenant(t.id)}
                        style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                        Open →
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Waiting for review ─────────────────────────────── */}
        {canApprovePushes && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <div style={{ color: queue.length ? AMBER : TEAL, fontWeight: 700, fontSize: 14 }}>
              Waiting for review {queue.length > 0 && `(${queue.length})`}
            </div>
            <button onClick={load} disabled={loading}
              style={{ background: 'none', border: `1px solid ${BORDER}`, color: TEAL, borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
          <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12 }}>
            Nothing here has reached QuickBooks. Approving is what sends it.
          </div>

          {loading ? (
            <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
          ) : queue.length === 0 ? (
            <div style={{ color: SUBTEXT, fontSize: 13 }}>Nothing waiting.</div>
          ) : queue.map(item => (
            <div key={item.id} style={{ borderTop: `1px solid ${BORDER}`, padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                  <div style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>{item.summary || KIND_LABEL[item.kind] || item.kind}</div>
                  <div style={{ color: SUBTEXT, fontSize: 11, marginTop: 2 }}>
                    <b style={{ color: TEAL }}>{tenantName(item.tenant_id)}</b>
                    {' · '}{KIND_LABEL[item.kind] || item.kind}
                    {' · requested by '}{item.requested_by || 'unknown'}
                    {' · '}{new Date(item.requested_at).toLocaleString()}
                  </div>
                  <button onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    style={{ background: 'none', border: 'none', color: TEAL, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '4px 0 0' }}>
                    {expanded === item.id ? 'Hide' : 'Show'} exactly what would be sent
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-start' }}>
                  <button onClick={() => review(item, 'approve')} disabled={busyId === item.id}
                    style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    {busyId === item.id ? 'Sending…' : 'Approve & send'}
                  </button>
                  <button onClick={() => review(item, 'reject')} disabled={busyId === item.id}
                    style={{ background: 'none', border: `1px solid ${RED}`, color: RED, borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    Reject
                  </button>
                </div>
              </div>

              {expanded === item.id && (
                <pre style={{
                  background: '#f7f9fa', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, marginTop: 10,
                  fontSize: 11, color: TEXT, overflow: 'auto', maxHeight: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{JSON.stringify(item.payload, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
        )}

        {/* ── Global settings ────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Global settings</div>
          <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12 }}>
            Users, branding, signature and per-client features.
          </div>
          <button onClick={() => navigate('/settings')}
            style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Open Settings
          </button>
        </div>

        {/* ── Recently reviewed ──────────────────────────────── */}
        {history.length > 0 && (
          <div style={card}>
            <div style={{ color: TEAL, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Recently reviewed</div>
            {history.map(h => (
              <div key={h.id} style={{ borderTop: `1px solid ${BORDER}`, padding: '9px 0', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: TEXT }}>{h.summary || KIND_LABEL[h.kind] || h.kind}</div>
                  <div style={{ color: SUBTEXT, fontSize: 11 }}>
                    {tenantName(h.tenant_id)} · {h.reviewed_by || 'unknown'} · {h.reviewed_at ? new Date(h.reviewed_at).toLocaleString() : ''}
                  </div>
                </div>
                <span style={{
                  flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                  background: h.status === 'pushed' ? '#e6f4ea' : h.status === 'rejected' ? '#f1f3f4' : '#fdecea',
                  color: h.status === 'pushed' ? GREEN : h.status === 'rejected' ? SUBTEXT : RED,
                }}>{h.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
