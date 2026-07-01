// ============================================
// Billing — jobs-table based (NakedPM)
// ============================================
// Reads the JOBS table by status (no calendar-tag scanning, no split brain).
// Tabs: To Bill · Estimate Needed · Estimate Sent · Won
// Triage + Return buckets removed (those live on the Board, not Billing).
// Every card shows its notes/issue until the job is marked billed.
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { supabase, STATUS_INFO } from '../services/supabase.js';
import NotesPanel from '../components/NotesPanel.jsx';
import { CALENDARS } from '../config/calendars.js';

const TABS = [
  { key: 'to_bill',        label: 'To Bill',         emoji: '💵', color: '#8b5cf6', statuses: ['to_bill'] },
  { key: 'needs_estimate', label: 'Estimate Needed', emoji: '📋', color: '#f59e0b', statuses: ['needs_estimate'] },
  { key: 'estimate_sent',  label: 'Estimate Sent',   emoji: '📤', color: '#06b6d4', statuses: ['estimate_sent'] },
  { key: 'won',            label: 'Won',             emoji: '🎉', color: '#22c55e', statuses: ['won'] },
];

// "Send back to board" targets — the active-work board lanes a billing card
// can be pulled back into. Mirrors the board's own lane vocabulary + colors.
const BOARD_LANES = [
  { label: '🔥 Triage',   target: 'new',               color: '#ef4444' },
  { label: '✅ Ready',     target: 'ready_to_schedule', color: '#22c55e' },
  { label: '📅 Scheduled', target: 'scheduled',         color: '#3b82f6' },
  { label: '🚫 Blocked',   target: 'blocked',           color: '#dc2626' },
];

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtMoney(n) {
  const v = parseFloat(n);
  if (!v) return null;
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtHours(n) {
  const v = parseFloat(n);
  if (!v) return null;
  return (Math.round(v * 10) / 10) + 'h';
}

// One billing card. Shows the issue until billed; notes live in NotesPanel
// (job_history via notesApi) — the same store JobDetail and the board's merge
// tool read from, so nothing written here gets orphaned or lost on a merge.
function BillingCard({ job, assignments, onMarkBilled, onSendToBoard, userEmail, accessToken, busy }) {
  const [showNotes, setShowNotes] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [showBillConfirm, setShowBillConfirm] = useState(false);
  const si = STATUS_INFO[job.status] || {};
  const isBilled = job.status === 'billed';

  // Only visits with logged hours are worth showing/selecting — a visit
  // with no actual_hours yet isn't billable time.
  const hourEntries = (assignments || []).filter(a => parseFloat(a.actual_hours) > 0);
  const totalHours = hourEntries.reduce((s, a) => s + parseFloat(a.actual_hours || 0), 0);

  const [selectedIds, setSelectedIds] = useState(() => new Set(hourEntries.map(a => a.id)));
  // assignments load asynchronously after the card first mounts — resync the
  // default selection (all checked) whenever the real data arrives.
  useEffect(() => {
    setSelectedIds(new Set(hourEntries.map(a => a.id)));
  }, [assignments]);
  const toggleId = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectedHours = hourEntries.filter(a => selectedIds.has(a.id)).reduce((s, a) => s + parseFloat(a.actual_hours || 0), 0);

  const confirmBill = () => {
    onMarkBilled(job.id, Array.from(selectedIds));
    setShowBillConfirm(false);
  };

  return (
    <div style={{ background:'#1e293b', borderRadius:10, padding:14, marginBottom:10, border:`1px solid ${si.color||'#334155'}30` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#fff', fontSize:15, fontWeight:600 }}>{job.customer_name || '—'}</div>
          <div style={{ color:'#64748b', fontSize:11, marginTop:2 }}>
            {job.cms_account_id ? `CMS ${job.cms_account_id} · ` : ''}{fmtDate(job.created_at)}
          </div>
          {totalHours > 0 && (
            <div style={{ color:'#06b6d4', fontSize:11, marginTop:3, fontWeight:600 }}>
              🕐 {fmtHours(totalHours)}
              {(() => {
                // Per-tech breakdown, e.g. "JR 3.5h, Austin 2h"
                const byTech = {};
                hourEntries.forEach(a => {
                  const name = a.tech?.name || 'unassigned';
                  byTech[name] = (byTech[name] || 0) + parseFloat(a.actual_hours || 0);
                });
                const parts = Object.entries(byTech).map(([name, h]) => `${name} ${fmtHours(h)}`);
                return parts.length ? ` · ${parts.join(', ')}` : '';
              })()}
            </div>
          )}
        </div>
        {fmtMoney(job.estimate_amount) && (
          <div style={{ textAlign:'right', whiteSpace:'nowrap' }}>
            <div style={{ color:'#22c55e', fontWeight:700, fontSize:16 }}>{fmtMoney(job.estimate_amount)}</div>
            {(() => {
              // QBO figures are last-synced, not live. Flag age so nobody bills off a stale number.
              const synced = job.synced_at ? new Date(job.synced_at) : null;
              const days = synced ? Math.floor((Date.now() - synced.getTime()) / 86400000) : null;
              const stale = days === null || days > 7;
              return (
                <div style={{ color: stale ? '#f59e0b' : '#64748b', fontSize:9, fontWeight:600, marginTop:2 }}>
                  {stale ? '🚧 ' : ''}as of {synced ? fmtDate(job.synced_at) : 'unknown'}{stale ? ' · verify in QBO' : ''}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Issue — visible until billed. Not a note; the customer-reported problem. */}
      {!isBilled && job.issue && (
        <div style={{ marginTop:10, background:'#0f172a', borderRadius:8, padding:10 }}>
          <div style={{ color:'#475569', fontSize:9, textTransform:'uppercase', letterSpacing:0.4, marginBottom:4 }}>issue</div>
          <div style={{ color:'#cbd5e1', fontSize:12, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{job.issue}</div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
        <button onClick={() => setShowNotes(o => !o)}
          style={{ padding:'6px 12px', borderRadius:6, border:'1px solid #334155', background: showNotes ? '#33415555' : 'transparent', color:'#94a3b8', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          {showNotes ? 'Close notes' : '📝 Notes'}
        </button>
        <button onClick={() => setShowMove(m => !m)} disabled={busy}
          style={{ padding:'6px 12px', borderRadius:6, border:'1px solid #334155', background: showMove ? '#33415555' : 'transparent', color:'#94a3b8', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          {showMove ? 'Close' : '↩ Send to board'}
        </button>
        {job.status === 'to_bill' && (
          <button onClick={() => setShowBillConfirm(o => !o)} disabled={busy}
            style={{ padding:'6px 14px', borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            💰 Mark Billed
          </button>
        )}
      </div>

      {/* Send back into the board workflow — pulls the card out of Billing */}
      {showMove && (
        <div style={{ marginTop:10, background:'#0f172a', borderRadius:8, padding:10 }}>
          <div style={{ color:'#475569', fontSize:9, textTransform:'uppercase', letterSpacing:0.4, marginBottom:8 }}>move back to board</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {BOARD_LANES.map(lane => (
              <button key={lane.target} onClick={() => onSendToBoard(job.id, lane.target)} disabled={busy}
                style={{ padding:'10px 8px', borderRadius:8, border:`1px solid ${lane.color}`, background:'transparent', color:lane.color, fontSize:13, fontWeight:700, cursor:busy?'default':'pointer', opacity:busy?0.6:1 }}>
                {lane.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mark Billed confirmation — pick which logged-hour visits this
          invoice covers. Checked ones get their calendar event archived to
          Completed and get named in the audit note; the job itself still
          moves fully to billed either way (jobs.status has no per-visit
          concept), but this is your record of exactly what you invoiced. */}
      {showBillConfirm && (
        <div style={{ marginTop:10, background:'#0f172a', borderRadius:8, padding:10 }}>
          <div style={{ color:'#475569', fontSize:9, textTransform:'uppercase', letterSpacing:0.4, marginBottom:8 }}>
            which hours are on this invoice?
          </div>
          {hourEntries.length === 0 ? (
            <div style={{ color:'#64748b', fontSize:12, marginBottom:8 }}>No logged hours found on this job — billing will proceed with no hour entries selected.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:10 }}>
              {hourEntries.map(a => (
                <label key={a.id} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 10px', borderRadius:6, background:'#1e293b', cursor:'pointer' }}>
                  <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleId(a.id)} style={{ marginTop:2 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                      <span style={{ color:'#fff', fontSize:13, fontWeight:600 }}>{a.tech?.name || 'Unassigned'}</span>
                      <span style={{ color:'#06b6d4', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>{fmtHours(a.actual_hours)}</span>
                    </div>
                    <div style={{ color:'#64748b', fontSize:11, marginTop:1 }}>
                      {fmtDate(a.scheduled_for || a.time_out || a.created_at)}
                      {a.completion_notes ? ` · ${a.completion_notes.slice(0, 60)}${a.completion_notes.length > 60 ? '…' : ''}` : ''}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setShowBillConfirm(false)} disabled={busy}
              style={{ flex:1, padding:'8px 14px', borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#94a3b8', fontSize:12, fontWeight:600, cursor:'pointer' }}>
              Cancel
            </button>
            <button onClick={confirmBill} disabled={busy}
              style={{ flex:2, padding:'8px 14px', borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
              ✓ Confirm & Bill{selectedHours > 0 ? ` (${fmtHours(selectedHours)})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* Same NotesPanel JobDetail uses: writes to job_history via notesApi,
          shows in the merge tool, and best-effort mirrors to the linked
          calendar event via appendNoteToJobEvents. */}
      {showNotes && (
        <div style={{ marginTop:10 }}>
          <NotesPanel jobId={job.id} userEmail={userEmail} job={job} accessToken={accessToken} />
        </div>
      )}
    </div>
  );
}

export default function Billing({ accessToken, userEmail, onBack }) {
  const [tab, setTab] = useState('to_bill');
  const [jobs, setJobs] = useState([]);
  const [assignmentsByJob, setAssignmentsByJob] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const activeTab = TABS.find(t => t.key === tab) || TABS[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .in('status', activeTab.statuses)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const jobList = data || [];
      setJobs(jobList);

      // Batch-fetch every visit (with hours + tech name) for the visible
      // jobs in one query, instead of one query per card.
      if (jobList.length > 0) {
        const { data: assigns } = await supabase
          .from('job_assignments')
          .select('*, tech:techs(name, color)')
          .in('job_id', jobList.map(j => j.id));
        const grouped = {};
        (assigns || []).forEach(a => {
          (grouped[a.job_id] = grouped[a.job_id] || []).push(a);
        });
        setAssignmentsByJob(grouped);
      } else {
        setAssignmentsByJob({});
      }
    } catch (e) {
      console.error('Billing load error:', e);
      setJobs([]);
      setAssignmentsByJob({});
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  // Best-effort: move calendar events for the SELECTED visits only (the ones
  // checked in the Mark Billed confirmation) to the Completed calendar.
  // Never throws — a calendar hiccup must not block the billing status write.
  const moveJobEventsToCompleted = async (jobId, selectedAssignmentIds) => {
    if (!accessToken) return;
    try {
      let query = supabase
        .from('job_assignments')
        .select('calendar_event_id')
        .eq('job_id', jobId)
        .not('calendar_event_id', 'is', null);
      if (selectedAssignmentIds && selectedAssignmentIds.length > 0) {
        query = query.in('id', selectedAssignmentIds);
      }
      const { data: assignments } = await query;
      if (!assignments || assignments.length === 0) return;

      const candidateCalendars = [
        CALENDARS.DRH_TECH_1, CALENDARS.JR_APPOINTMENT, CALENDARS.TECH3, CALENDARS.SUBS,
        CALENDARS.SHANA, CALENDARS.INSTALLATIONS, CALENDARS.SARA_TASKS, CALENDARS.SERVICE_QUEUE,
      ];

      for (const a of assignments) {
        if (!a.calendar_event_id) continue;
        for (const srcCal of candidateCalendars) {
          try {
            const moveUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(srcCal)}/events/${encodeURIComponent(a.calendar_event_id)}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`;
            const res = await fetch(moveUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
            if (res.ok) break; // found it and moved it — next assignment
          } catch { /* try next candidate calendar */ }
        }
      }
    } catch (e) {
      console.warn('Move to Completed failed (non-fatal):', e?.message || e);
    }
  };

  // Best-effort audit note: exactly which hour entries this invoice covered.
  // This is the durable record of what was billed, separate from the
  // job's own single billed status.
  const logInvoicedHours = async (jobId, selectedAssignmentIds, actor) => {
    try {
      const all = assignmentsByJob[jobId] || [];
      const selected = all.filter(a => selectedAssignmentIds?.includes(a.id) && parseFloat(a.actual_hours) > 0);
      if (selected.length === 0) return;
      const total = selected.reduce((s, a) => s + parseFloat(a.actual_hours || 0), 0);
      const parts = selected.map(a => `${a.tech?.name || 'Unassigned'} ${(Math.round(parseFloat(a.actual_hours) * 10) / 10)}h (${fmtDate(a.scheduled_for || a.time_out || a.created_at)})`);
      const note = `💰 Billed for: ${parts.join(' · ')} — total ${Math.round(total * 10) / 10}h`;
      await supabase.from('job_history').insert([{ job_id: jobId, from_status: 'to_bill', to_status: 'billed', changed_by: actor, notes: note }]);
    } catch (e) { console.warn('logInvoicedHours failed (non-fatal):', e?.message || e); }
  };

  // Resilient status write. Mirrors the board's proven pattern
  // ({status, updated_by, updated_at} — known to work in prod). For billing
  // we also try to stamp billed_at, but if that column isn't in the schema
  // we drop it and still complete the move. History logging is best-effort.
  const moveJobTo = async (jobId, newStatus, selectedAssignmentIds) => {
    setBusy(true);
    try {
      const actor = userEmail || 'info@drhsecurityservices.com';
      const fromStatus = jobs.find(j => j.id === jobId)?.status || null;
      const base = { status: newStatus, updated_by: actor, updated_at: new Date().toISOString() };
      const payload = newStatus === 'billed' ? { ...base, billed_at: new Date().toISOString() } : base;

      let { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
      // Optional audit column (e.g. billed_at) not in the schema cache → write the safe base.
      if (error && (error.code === 'PGRST204' || error.code === '42703' || /schema cache|does not exist/i.test(error.message || ''))) {
        ({ error } = await supabase.from('jobs').update(base).eq('id', jobId));
      }
      if (error) throw error;

      // Audit trail — never blocks the move.
      try {
        await supabase.from('job_history').insert([{ job_id: jobId, from_status: fromStatus, to_status: newStatus, changed_by: actor }]);
      } catch { /* ignore */ }

      // Billing is final — no invoice-number prompt, stays one click after
      // the checklist. Move only the visits that were actually checked to
      // Completed, and log exactly which hours this invoice covered.
      if (newStatus === 'billed') {
        moveJobEventsToCompleted(jobId, selectedAssignmentIds);
        logInvoicedHours(jobId, selectedAssignmentIds, actor);
      }

      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (e) {
      alert('Could not update this card: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const markBilled  = (jobId, selectedAssignmentIds) => moveJobTo(jobId, 'billed', selectedAssignmentIds);
  const sendToBoard = (jobId, target) => moveJobTo(jobId, target);

  // Pipeline total for the current tab
  const total = jobs.reduce((s, j) => s + (parseFloat(j.estimate_amount) || 0), 0);

  return (
    <div style={{ minHeight:'100vh', minHeight:'100dvh', background:'#0f172a', color:'#fff' }}>
      <div style={{ position:'sticky', top:0, zIndex:10, background:'#0f172a', borderBottom:'1px solid #1e293b', padding:'14px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
          <button onClick={onBack} style={{ background:'none', border:'none', color:'#94a3b8', fontSize:22, cursor:'pointer' }}>←</button>
          <h2 style={{ margin:0, fontSize:18 }}>💰 Billing</h2>
        </div>
        <div style={{ display:'flex', gap:6, overflowX:'auto' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding:'8px 14px', borderRadius:8, border:`1px solid ${tab===t.key?t.color:'#334155'}`, background:tab===t.key?`${t.color}22`:'transparent', color:tab===t.key?t.color:'#94a3b8', fontSize:13, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:16, maxWidth:600, margin:'0 auto' }}>
        {fmtMoney(total) && (
          <div style={{ marginBottom:12, color:'#64748b', fontSize:13 }}>
            {jobs.length} {jobs.length===1?'job':'jobs'} · pipeline <span style={{ color:'#22c55e', fontWeight:700 }}>{fmtMoney(total)}</span>
          </div>
        )}
        {loading ? (
          <div style={{ textAlign:'center', color:'#64748b', padding:40 }}>Loading…</div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign:'center', color:'#64748b', padding:40 }}>{activeTab.emoji} Nothing in {activeTab.label}</div>
        ) : (
          jobs.map(job => (
            <BillingCard key={job.id} job={job} assignments={assignmentsByJob[job.id]} onMarkBilled={markBilled} onSendToBoard={sendToBoard} userEmail={userEmail} accessToken={accessToken} busy={busy} />
          ))
        )}
      </div>
    </div>
  );
}
