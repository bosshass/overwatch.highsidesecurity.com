// ============================================================
// Event Audit — the reconciliation workbench.
// Every calendar event (time_entry) since Jan 1:
//   • assign / re-assign to a Registry customer (writes time_entries.registry_id)
//   • change the disposition inline (Bill it / Return / Estimate / In progress)
//   • push to the Board as a ticket — ONLY on explicit confirm (never auto)
//   • expand the full history thread (job_history) inline
// ============================================================

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase, jobsApi, notesApi, JOB_STATUS } from '../services/supabase.js';

const SINCE = '2026-01-01';

const DISPO = {
  bill_it:     { label: 'Bill it',     color: '#22c55e' },
  return:      { label: 'Return',      color: '#f59e0b' },
  estimate:    { label: 'Estimate',    color: '#06b6d4' },
  in_progress: { label: 'In progress', color: '#3b82f6' },
};
const DISPO_KEYS = ['bill_it', 'return', 'estimate', 'in_progress'];

// disposition -> the board status a ticket should land in
const DISPO_STATUS = {
  bill_it:     JOB_STATUS.TO_BILL,
  estimate:    JOB_STATUS.NEEDS_ESTIMATE,
  return:      JOB_STATUS.RETURN_PENDING,
  in_progress: JOB_STATUS.SCHEDULED,
};
const STATUS_LABEL = {
  [JOB_STATUS.TO_BILL]:        'To Bill',
  [JOB_STATUS.NEEDS_ESTIMATE]: 'Needs Estimate',
  [JOB_STATUS.RETURN_PENDING]: 'Return Pending',
  [JOB_STATUS.SCHEDULED]:      'Scheduled',
};

const AUTHORS = {
  'drhservicetech1@gmail.com': 'Austin', 'austin@drhsecurityservices.com': 'Austin',
  'jr@drhsecurityservices.com': 'JR', 'brian@drhsecurityservices.com': 'Brian',
  'trevor@drhsecurityservices.com': 'Trevor', 'subs@drhsecurityservices.com': 'Subs',
  'info@drhsecurityservices.com': 'Office', 'sara@jnbllc.com': 'Sara',
  'shanaparks@drhsecurityservices.com': 'Shana',
};
const author = e => AUTHORS[(e || '').toLowerCase()] || (e ? e.split('@')[0] : 'Office');

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function hrs(mins) { return mins ? (mins / 60).toFixed(1) + 'h' : null; }

function Chip({ color, children }) {
  return <span style={{ background: `${color}20`, color, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}

// ── Searchable customer picker ───────────────────────────────
function CustomerPicker({ registry, onPick, onClose }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? registry.filter(c =>
      (c.name || '').toLowerCase().includes(s) || (c.code || '').toLowerCase().includes(s) ||
      (c.address || '').toLowerCase().includes(s) || (c.cs_legacy || '').toLowerCase().includes(s)) : registry;
    return list.slice(0, 40);
  }, [q, registry]);
  return (
    <div style={{ marginTop: 10, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, code, address…"
          style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 14, padding: '8px 10px', outline: 'none', fontFamily: 'inherit' }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {matches.length === 0 && <div style={{ color: '#475569', fontSize: 13, padding: 12, textAlign: 'center' }}>No match for "{q}"</div>}
        {matches.map(c => (
          <div key={c.code} onClick={() => onPick(c)} style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: '#1a1a2e', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: '#00c8e8', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.code}</span>
            </div>
            {c.address && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{c.address}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CustomerAudit({ onBack }) {
  const userEmail = (typeof localStorage !== 'undefined' && localStorage.getItem('juce_v4_email')) || 'audit';

  const [registry, setRegistry] = useState([]);
  const [events, setEvents] = useState([]);
  const [jobByEvent, setJobByEvent] = useState({}); // calendar_event_id -> { id, status }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(true);

  const [openPickerId, setOpenPickerId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [dispoBusyId, setDispoBusyId] = useState(null);
  const [confirmTicketId, setConfirmTicketId] = useState(null);
  const [ticketBusyId, setTicketBusyId] = useState(null);
  const [openHistoryId, setOpenHistoryId] = useState(null);
  const [historyById, setHistoryById] = useState({}); // entryId -> { loading, rows, hasJob }

  const byCode = useMemo(() => { const m = {}; for (const c of registry) m[c.code] = c; return m; }, [registry]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true); setErr(null);
    try {
      const [{ data: reg, error: e1 }, { data: ev, error: e2 }, { data: jobs, error: e3 }] = await Promise.all([
        supabase.from('customer_registry').select('code, name, cs_legacy, address').order('name'),
        supabase.from('time_entries')
          .select('id, event_title, event_start, created_at, calendar_event_id, customer_id, tech_name, total_minutes, disposition, materials, notes, customer_name_raw, registry_id')
          .gte('created_at', SINCE).limit(2000),
        supabase.from('jobs').select('id, status, calendar_event_id').not('calendar_event_id', 'is', null).limit(3000),
      ]);
      if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;
      setRegistry(reg || []);
      const map = {};
      for (const j of (jobs || [])) if (j.calendar_event_id) map[j.calendar_event_id] = { id: j.id, status: j.status };
      setJobByEvent(map);
      setEvents((ev || []).sort((a, b) => new Date(b.event_start || b.created_at) - new Date(a.event_start || a.created_at)));
    } catch (e) { setErr(e.message || String(e)); }
    setLoading(false);
  }

  async function assign(entryId, code) {
    setSavingId(entryId);
    try {
      const { error } = await supabase.from('time_entries').update({ registry_id: code }).eq('id', entryId);
      if (error) throw error;
      setEvents(prev => prev.map(e => e.id === entryId ? { ...e, registry_id: code } : e));
      setOpenPickerId(null);
    } catch (e) { alert('Could not save: ' + (e.message || e)); }
    setSavingId(null);
  }

  async function changeDispo(entryId, dispo) {
    setDispoBusyId(entryId);
    try {
      const { error } = await supabase.from('time_entries').update({ disposition: dispo }).eq('id', entryId);
      if (error) throw error;
      setEvents(prev => prev.map(e => e.id === entryId ? { ...e, disposition: dispo } : e));
    } catch (e) { alert('Could not change disposition: ' + (e.message || e)); }
    setDispoBusyId(null);
  }

  // Create or update a board ticket — ONLY called after explicit confirm.
  async function pushToBoard(ev) {
    const target = DISPO_STATUS[ev.disposition] || JOB_STATUS.SCHEDULED;
    const existing = ev.calendar_event_id ? jobByEvent[ev.calendar_event_id] : null;
    setTicketBusyId(ev.id); setConfirmTicketId(null);
    try {
      if (existing) {
        await jobsApi.changeStatus(existing.id, target, userEmail, `Set to ${STATUS_LABEL[target] || target} from Audit`);
        setJobByEvent(m => ({ ...m, [ev.calendar_event_id]: { ...existing, status: target } }));
      } else {
        const job = {
          customer_name: byCode[ev.registry_id]?.name || ev.customer_name_raw || ev.event_title || 'Customer',
          customer_id: ev.customer_id || undefined,
          status: target,
          issue: ev.notes || ev.event_title || '',
          scheduled_date: ev.event_start ? new Date(ev.event_start).toISOString() : undefined,
          calendar_event_id: ev.calendar_event_id || undefined,
        };
        const created = await jobsApi.create(job, userEmail);
        if (ev.calendar_event_id && created?.id) setJobByEvent(m => ({ ...m, [ev.calendar_event_id]: { id: created.id, status: target } }));
      }
    } catch (e) { alert('Could not push to board: ' + (e.message || e)); }
    setTicketBusyId(null);
  }

  async function toggleHistory(ev) {
    if (openHistoryId === ev.id) { setOpenHistoryId(null); return; }
    setOpenHistoryId(ev.id);
    if (historyById[ev.id]) return; // cached
    const job = ev.calendar_event_id ? jobByEvent[ev.calendar_event_id] : null;
    if (!job) { setHistoryById(h => ({ ...h, [ev.id]: { loading: false, rows: [], hasJob: false } })); return; }
    setHistoryById(h => ({ ...h, [ev.id]: { loading: true, rows: [], hasJob: true } }));
    try {
      const rows = await notesApi.getAllForJob(job.id);
      setHistoryById(h => ({ ...h, [ev.id]: { loading: false, rows: rows || [], hasJob: true } }));
    } catch {
      setHistoryById(h => ({ ...h, [ev.id]: { loading: false, rows: [], hasJob: true } }));
    }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return events.filter(e => {
      if (unassignedOnly && e.registry_id) return false;
      if (!s) return true;
      const cust = byCode[e.registry_id];
      return (e.event_title || '').toLowerCase().includes(s) || (e.customer_name_raw || '').toLowerCase().includes(s) ||
        (e.notes || '').toLowerCase().includes(s) || (e.materials || '').toLowerCase().includes(s) ||
        (e.tech_name || '').toLowerCase().includes(s) || (cust?.name || '').toLowerCase().includes(s) ||
        (e.registry_id || '').toLowerCase().includes(s);
    });
  }, [events, search, unassignedOnly, byCode]);

  const assignedCount = events.filter(e => e.registry_id).length;
  const total = events.length;

  const btn = (active, color) => ({
    border: `1px solid ${active ? color : '#334155'}`, background: active ? `${color}25` : 'transparent',
    color: active ? color : '#64748b', borderRadius: 7, padding: '5px 9px', fontSize: 11, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: 100 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 16, cursor: 'pointer', padding: '4px 0' }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🔎 Event Audit</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            <span style={{ color: '#22c55e', fontWeight: 700 }}>{assignedCount}</span> / {total} assigned
          </div>
        </div>
        <div style={{ height: 4, background: '#1e293b', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: total ? `${(assignedCount / total) * 100}%` : '0%', background: '#22c55e' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by title, note, tech, customer…"
            style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', fontSize: 14, padding: '9px 12px', outline: 'none', fontFamily: 'inherit' }} />
          <button onClick={() => setUnassignedOnly(v => !v)} style={{
            background: unassignedOnly ? '#00c8e820' : '#1e293b', border: `1px solid ${unassignedOnly ? '#00c8e8' : '#334155'}`,
            color: unassignedOnly ? '#00c8e8' : '#64748b', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {unassignedOnly ? 'Unassigned only' : 'All events'}
          </button>
        </div>
        <div style={{ color: '#475569', fontSize: 11, marginTop: 6 }}>Events since Jan 1, 2026</div>
      </div>

      <div style={{ padding: 14 }}>
        {loading && <div style={{ textAlign: 'center', color: '#64748b', padding: 60, fontSize: 14 }}>Loading events…</div>}
        {err && <div style={{ background: '#ef444420', border: '1px solid #ef444440', color: '#fca5a5', borderRadius: 10, padding: 14, fontSize: 13 }}>{err}</div>}
        {!loading && !err && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#334155', padding: 60, fontSize: 14 }}>
            {unassignedOnly ? 'Nothing left to assign 🎉' : 'No events match.'}
          </div>
        )}

        {!loading && !err && filtered.map(e => {
          const d = DISPO[e.disposition] || { label: e.disposition || '—', color: '#64748b' };
          const cust = byCode[e.registry_id];
          const job = e.calendar_event_id ? jobByEvent[e.calendar_event_id] : null;
          const target = DISPO_STATUS[e.disposition] || JOB_STATUS.SCHEDULED;
          const onBoardSynced = job && job.status === target;
          const hist = historyById[e.id];
          return (
            <div key={e.id} style={{ background: '#1a1a2e', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{e.event_title || e.customer_name_raw || '(untitled event)'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip color={d.color}>{d.label}</Chip>
                {e.tech_name && <span style={{ color: '#64748b', fontSize: 11 }}>👷 {e.tech_name}</span>}
                <span style={{ color: '#64748b', fontSize: 11 }}>📅 {fmtDate(e.event_start || e.created_at)}</span>
                {hrs(e.total_minutes) && <span style={{ color: '#00c8e8', fontSize: 11 }}>⏱ {hrs(e.total_minutes)}</span>}
              </div>

              {e.materials && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>🔧 {e.materials}</div>}
              {e.notes && <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.notes}</div>}

              {/* Disposition changer */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e293b' }}>
                <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Disposition {dispoBusyId === e.id && <span style={{ color: '#64748b' }}>· saving…</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DISPO_KEYS.map(k => (
                    <button key={k} onClick={() => e.disposition !== k && changeDispo(e.id, k)} style={btn(e.disposition === k, DISPO[k].color)}>
                      {DISPO[k].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer assignment */}
              <div style={{ marginTop: 10 }}>
                {cust ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700, marginRight: 6 }}>✓ {e.registry_id}</span>
                      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{cust.name}</span>
                    </div>
                    <button onClick={() => setOpenPickerId(openPickerId === e.id ? null : e.id)} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#64748b', padding: '5px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Change</button>
                  </div>
                ) : (
                  <button onClick={() => setOpenPickerId(openPickerId === e.id ? null : e.id)} disabled={savingId === e.id}
                    style={{ width: '100%', background: '#00c8e820', border: '1px solid #00c8e8', borderRadius: 8, color: '#00c8e8', padding: '9px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {savingId === e.id ? 'Saving…' : '+ Assign customer'}
                  </button>
                )}
                {openPickerId === e.id && <CustomerPicker registry={registry} onPick={c => assign(e.id, c.code)} onClose={() => setOpenPickerId(null)} />}
              </div>

              {/* Board ticket + History */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e293b', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {onBoardSynced ? (
                  <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600 }}>✓ On board · {STATUS_LABEL[job.status] || job.status}</span>
                ) : confirmTicketId === e.id ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#cbd5e1', fontSize: 12 }}>
                      {job ? 'Update board ticket →' : 'Create board ticket →'} <b style={{ color: '#e2e8f0' }}>{STATUS_LABEL[target] || target}</b>?
                    </span>
                    <button onClick={() => pushToBoard(e)} style={{ background: '#22c55e25', border: '1px solid #22c55e', color: '#22c55e', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes</button>
                    <button onClick={() => setConfirmTicketId(null)} style={{ background: 'none', border: '1px solid #334155', color: '#64748b', borderRadius: 7, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmTicketId(e.id)} disabled={ticketBusyId === e.id}
                    style={{ background: 'none', border: '1px solid #8b5cf6', color: '#a78bfa', borderRadius: 7, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {ticketBusyId === e.id ? 'Working…' : job ? `Update ticket → ${STATUS_LABEL[target] || target}` : `Create ticket → ${STATUS_LABEL[target] || target}`}
                  </button>
                )}

                <button onClick={() => toggleHistory(e)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  {openHistoryId === e.id ? 'Hide history' : 'View history'}
                </button>
              </div>

              {openHistoryId === e.id && (
                <div style={{ marginTop: 10, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 10 }}>
                  {hist?.loading && <div style={{ color: '#64748b', fontSize: 12 }}>Loading…</div>}
                  {hist && !hist.loading && !hist.hasJob && (
                    <div style={{ color: '#475569', fontSize: 12, fontStyle: 'italic' }}>No board ticket yet — only the field note above. Create a ticket to start a history thread.</div>
                  )}
                  {hist && !hist.loading && hist.hasJob && hist.rows.length === 0 && (
                    <div style={{ color: '#475569', fontSize: 12, fontStyle: 'italic' }}>Ticket exists but has no notes yet.</div>
                  )}
                  {hist && !hist.loading && hist.rows.map(r => (
                    <div key={r.id} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ color: '#00c8e8', fontSize: 11, fontWeight: 700 }}>{author(r.created_by)}</span>
                        {r.from_status && r.to_status && <span style={{ color: '#475569', fontSize: 10 }}>{r.from_status} → {r.to_status}</span>}
                        <span style={{ color: '#475569', fontSize: 10, marginLeft: 'auto' }}>{fmtDateTime(r.created_at)}</span>
                      </div>
                      <div style={{ color: '#cbd5e1', fontSize: 12.5, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{r.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
