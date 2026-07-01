// ============================================
// BoardView — NakedPM v3
// ============================================
// v3 changes:
//   - Note gate removed — status moves fire immediately
//   - Duplicate/merge flow added
//   - Date stamps show original created_at, not today
//   - updated_at stamps only on actual updates (no created_at overwrite)
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, JOB_STATUS, STATUS_INFO, techsApi, customersApi, notesApi } from '../services/supabase.js';
import { notifyJobAssigned } from '../services/pushNotifications.js';
import { CALENDARS } from '../config/calendars.js';
import NewJobModal from '../components/NewJobModal.jsx';
import SchedulerModal from '../components/SchedulerModal.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// All statuses a job can be moved to. Order = the natural workflow,
// but every status is reachable from any status (move any ticket anywhere).
const ALL_STATUSES = [
  'new','needs_details','needs_parts','pending_materials','needs_estimate',
  'estimate_sent','won','lost','ready_to_schedule','scheduled','return_pending',
  'complete','to_bill','billed','blocked','dead','archived',
];

// "Suggested" next step per status — used only to pick the ONE quick-move verb
// shown on the card. The full move list is always every other status.
const SUGGESTED_NEXT = {
  new:               'ready_to_schedule',
  needs_details:     'ready_to_schedule',
  needs_parts:       'ready_to_schedule',
  pending_materials: 'ready_to_schedule',
  needs_estimate:    'estimate_sent',
  estimate_sent:     'won',
  won:               'ready_to_schedule',
  ready_to_schedule: 'scheduled',
  scheduled:         'complete',
  return_pending:    'scheduled',
  complete:          'to_bill',
  to_bill:           'billed',
  billed:            'archived',
  lost:              'archived',
  dead:              'archived',
};

// Every status can move to every OTHER status (no one-way lock).
const STATUS_VERBS = Object.fromEntries(
  ALL_STATUSES.map(s => [s, ALL_STATUSES.filter(t => t !== s)])
);

// Move-to targets shown as the 6 board lanes (not 15 raw statuses).
// Tapping a lane sends the card there. Estimates expands to its stages.
const LANE_MOVES = [
  { key:'triage',    label:'🔥 Triage',    color:'#ef4444', target:'new',               statuses:['new','needs_details','needs_parts','pending_materials','needs_estimate'] },
  { key:'blocked',   label:'🚫 Blocked',   color:'#dc2626', target:'blocked',           statuses:['blocked'] },
  { key:'ready',     label:'✅ Ready',      color:'#22c55e', target:'ready_to_schedule', statuses:['ready_to_schedule'] },
  { key:'scheduled', label:'📅 Scheduled',  color:'#3b82f6', target:'scheduled',         statuses:['scheduled'] },
  { key:'estimates', label:'📋 Estimates',  color:'#f59e0b', target:'needs_estimate',    statuses:['needs_estimate','estimate_sent','won','lost'] },
  { key:'tobill',    label:'💵 To Bill',    color:'#8b5cf6', target:'to_bill',           statuses:['complete','to_bill','billed'] },
];

// Estimate sub-stages, revealed when Estimates is tapped.
const EST_STAGES = [
  { status:'needs_estimate', label:'Needed', color:'#f59e0b' },
  { status:'estimate_sent',  label:'Sent',   color:'#06b6d4' },
  { status:'won',            label:'Won',    color:'#22c55e' },
  { status:'lost',           label:'Lost',   color:'#6b7280' },
];

const COLUMNS = [
  { key:'triage',    label:'🔥 Triage',    color:'#ef4444', statuses:['new','needs_details','needs_parts','pending_materials','needs_estimate'] },
  { key:'blocked',   label:'🚫 Blocked',   color:'#dc2626', statuses:['blocked'] },
  { key:'ready',     label:'✅ Ready',      color:'#22c55e', statuses:['ready_to_schedule'] },
  { key:'returns',   label:'🔄 Returns',    color:'#06b6d4', statuses:['return_pending'] },
  { key:'scheduled', label:'📅 Scheduled',  color:'#3b82f6', statuses:['scheduled'] },
  { key:'estimates', label:'📋 Estimates',  color:'#f59e0b', statuses:['estimate_sent','won'] },
  { key:'tobill',    label:'💵 To Bill',    color:'#8b5cf6', statuses:['complete','to_bill'] },
];

const fmtMoney = n => n ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n) : '';

// Show original event date — not "today"
const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 0) return `in ${-days}d`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
};

// ── UUID Linker ───────────────────────────────────────────────────────────────
function UUIDLinker({ job, onLinked }) {
  const [query, setQuery] = useState(job.customer_name || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newName, setNewName] = useState(job.customer_name || '');
  const [newPhone, setNewPhone] = useState(job.customer_phone || '');
  const [newAddr, setNewAddr] = useState(job.customer_address || '');
  const [err, setErr] = useState('');

  const search = async q => {
    setQuery(q);
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try { setResults(await customersApi.search(q)); } catch(e) { setErr(e.message); }
    setSearching(false);
  };

  const link = async customerId => {
    setSaving(true);
    try {
      const { error } = await supabase.from('jobs').update({ customer_id: customerId }).eq('id', job.id);
      if (error) throw error;
      onLinked(customerId);
      setOpen(false);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  const createAndLink = async () => {
    if (!newName.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try {
      const c = await customersApi.createLoose({ name:newName, phone:newPhone, address:newAddr });
      await link(c.id);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width:'100%', padding:'8px 12px', borderRadius:6, border:'1px solid #92400e', background:'#451a03', color:'#fb923c', fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'left', marginBottom:10 }}>
      ⚠ no customer UUID — tap to link
    </button>
  );

  return (
    <div style={{ background:'#0f172a', borderRadius:8, padding:12, marginBottom:12, border:'1px solid #334155' }} onClick={e => e.stopPropagation()}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>link customer</span>
        <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:14 }}>✕</button>
      </div>
      {!createMode ? (
        <>
          <input value={query} onChange={e => search(e.target.value)} placeholder="search by name, phone, CMS…"
            style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #334155', background:'#1e293b', color:'#fff', fontSize:13, boxSizing:'border-box', marginBottom:6 }} />
          {searching && <div style={{ color:'#475569', fontSize:11, padding:'4px 0' }}>searching…</div>}
          {results.map(c => (
            <button key={c.id} onClick={() => link(c.id)} disabled={saving}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', background:'#1e293b', border:'0.5px solid #334155', borderRadius:6, color:'#fff', fontSize:12, cursor:'pointer', marginBottom:4 }}>
              <div style={{ fontWeight:600 }}>{c.name}</div>
              <div style={{ fontSize:10, color:'#64748b' }}>{[c.phone, c.address?.split(',')[0], c.cms_account_id].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
          <button onClick={() => setCreateMode(true)}
            style={{ width:'100%', marginTop:6, padding:'7px 0', borderRadius:6, border:'1px dashed #475569', background:'transparent', color:'#64748b', fontSize:12, cursor:'pointer' }}>
            + create new customer
          </button>
        </>
      ) : (
        <>
          {[['Name *',newName,setNewName],['Phone',newPhone,setNewPhone],['Address',newAddr,setNewAddr]].map(([label,val,set])=>(
            <div key={label} style={{ marginBottom:6 }}>
              <div style={{ fontSize:10, color:'#64748b', marginBottom:2 }}>{label}</div>
              <input value={val} onChange={e => set(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid #334155', background:'#1e293b', color:'#fff', fontSize:12, boxSizing:'border-box' }} />
            </div>
          ))}
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <button onClick={() => setCreateMode(false)} style={{ flex:1, padding:8, borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#94a3b8', fontSize:12, cursor:'pointer' }}>back</button>
            <button onClick={createAndLink} disabled={saving||!newName.trim()} style={{ flex:2, padding:8, borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontWeight:600, fontSize:12, cursor:'pointer' }}>
              {saving ? 'saving…' : 'create & link'}
            </button>
          </div>
        </>
      )}
      {err && <div style={{ color:'#ef4444', fontSize:11, marginTop:6 }}>{err}</div>}
    </div>
  );
}

// ── Merge/Duplicate finder ────────────────────────────────────────────────────
function MergeTool({ job, allJobs, onMerge, accessToken, userEmail }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(job.customer_name || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Find jobs with similar customer name, excluding self
  const candidates = allJobs.filter(j =>
    j.id !== job.id &&
    j.status !== 'dead' &&
    j.status !== 'archived' &&
    j.customer_name &&
    (j.customer_name.toLowerCase().includes(query.toLowerCase()) ||
     query.toLowerCase().includes(j.customer_name.toLowerCase().split(' ')[0]))
  ).slice(0, 10);

  const merge = async (survivorId) => {
    if (!window.confirm('Merge THIS job into the other? Notes, issue/scope details, contact info, CMS/access codes, and the calendar link carry over to the survivor; this one is marked dead.')) return;
    setSaving(true);
    setErr('');
    try {
      const survivor = allJobs.find(j => j.id === survivorId) || {};
      const by = userEmail || 'board';

      // 1) Carry the dead job's notes onto the survivor (never lose them).
      //    getAllForJob only reads job_history.notes + completion_notes — for
      //    a freshly-created job that's just the literal "Job created" string,
      //    NOT the real intake details, which live in the issue field. So we
      //    always surface the dead job's issue as its own note too, regardless
      //    of whether the survivor already has its own issue text — otherwise
      //    those details vanish with no trail at all.
      try {
        const deadNotes = await notesApi.getAllForJob(job.id);
        for (const n of deadNotes.slice().reverse()) {
          if (n.text?.trim()) {
            await notesApi.addNote(survivorId, `↪ from merged job: ${n.text}`, by);
          }
        }
        if (job.issue?.trim()) {
          await notesApi.addNote(survivorId, `↪ merged job details:\n${job.issue.trim()}`, by);
        }
      } catch (e) { console.warn('merge: note carry failed', e); }

      // 2) Fill survivor gaps — issue, contact info, CMS/access details, and
      //    the calendar link. Issue only backfills if survivor's is empty
      //    (step 1 above already preserved the dead job's issue as a note
      //    either way, so nothing is lost if survivor's issue wins here).
      const upd = {};
      if (!survivor.issue && job.issue) upd.issue = job.issue;
      if (!survivor.customer_phone && job.customer_phone) upd.customer_phone = job.customer_phone;
      if (!survivor.customer_address && job.customer_address) upd.customer_address = job.customer_address;
      if (!survivor.customer_email && job.customer_email) upd.customer_email = job.customer_email;
      if (!survivor.cms_account_id && job.cms_account_id) upd.cms_account_id = job.cms_account_id;
      if (!survivor.gate_code && job.gate_code) upd.gate_code = job.gate_code;
      if (!survivor.panel_password && job.panel_password) upd.panel_password = job.panel_password;
      if (!survivor.calendar_event_id && job.calendar_event_id) {
        upd.calendar_event_id = job.calendar_event_id;
        if (job.calendar_id) upd.calendar_id = job.calendar_id;
      }
      if (Object.keys(upd).length) {
        upd.updated_by = by;
        await supabase.from('jobs').update(upd).eq('id', survivorId);
      }

      // 3) Move the dead job's calendar event to the Completed calendar (best-effort)
      if (accessToken && job.calendar_event_id && job.calendar_id) {
        try {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(job.calendar_id)}/events/${encodeURIComponent(job.calendar_event_id)}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
            { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch (e) { console.warn('merge: calendar move failed', e); }
      }

      // 4) Mark this job dead, pointing at the survivor
      const { error } = await supabase.from('jobs').update({
        status: 'dead',
        action_note: `Merged into job ${survivorId}`,
        updated_by: by,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;

      onMerge(job.id, survivorId);
      setOpen(false);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width:'100%', padding:'7px 12px', borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#64748b', fontSize:11, cursor:'pointer', textAlign:'left', marginBottom:8 }}>
      🔁 mark as duplicate / merge
    </button>
  );

  return (
    <div style={{ background:'#0f172a', borderRadius:8, padding:12, marginBottom:12, border:'1px solid #334155' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>find duplicate to merge into</span>
        <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:14 }}>✕</button>
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="search by customer name…"
        style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #334155', background:'#1e293b', color:'#fff', fontSize:13, boxSizing:'border-box', marginBottom:8 }} />
      {candidates.length === 0
        ? <div style={{ color:'#475569', fontSize:12, padding:'8px 0' }}>no matches found</div>
        : candidates.map(c => {
          const si = STATUS_INFO[c.status] || {};
          return (
            <button key={c.id} onClick={() => merge(c.id)} disabled={saving}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', background:'#1e293b', border:'0.5px solid #334155', borderRadius:6, color:'#fff', fontSize:12, cursor:'pointer', marginBottom:4 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontWeight:600 }}>{c.customer_name}</span>
                <span style={{ fontSize:10, color:si.color||'#64748b' }}>{si.label||c.status}</span>
              </div>
              <div style={{ fontSize:10, color:'#64748b', marginTop:2 }}>
                {c.issue?.slice(0,60) || 'no issue'} · {fmtDate(c.created_at)}
              </div>
            </button>
          );
        })
      }
      {err && <div style={{ color:'#ef4444', fontSize:11, marginTop:6 }}>{err}</div>}
    </div>
  );
}

// ── Scheduler modal: shared component (src/components/SchedulerModal.jsx) ──────

// ── Detail drawer ─────────────────────────────────────────────────────────────
function DetailDrawer({ job, techs, accessToken, onStatusMove, onSchedule, onClose, moving, onUUIDLinked, allJobs, onMerge, onRenamed, userEmail }) {
  const verbs = STATUS_VERBS[job.status] || [];
  const si = STATUS_INFO[job.status] || {};
  const [editingTitle, setEditingTitle] = useState(false);
  const [showEstStages, setShowEstStages] = useState(false);
  const [titleVal, setTitleVal] = useState(job.customer_name || '');
  const [savingTitle, setSavingTitle] = useState(false);

  const saveTitle = async () => {
    const next = titleVal.trim();
    if (!next || next === job.customer_name) { setEditingTitle(false); return; }
    setSavingTitle(true);
    try {
      const { error } = await supabase.from('jobs').update({ customer_name: next }).eq('id', job.id);
      if (error) throw error;
      onRenamed?.(job.id, next);
      setEditingTitle(false);
    } catch (e) {
      alert('Could not rename: ' + e.message);
    } finally {
      setSavingTitle(false);
    }
  };

  // ── Add note ────────────────────────────────
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteOk, setNoteOk] = useState(false);
  const [jobNotes, setJobNotes] = useState([]);
  const loadNotes = useCallback(async () => {
    try { setJobNotes(await notesApi.getAllForJob(job.id)); } catch { setJobNotes([]); }
  }, [job.id]);
  useEffect(() => { loadNotes(); }, [loadNotes]);
  const addNote = async () => {
    const t = noteText.trim();
    if (!t) return;
    setSavingNote(true);
    try {
      await notesApi.addNote(job.id, t, userEmail || 'board');
      setNoteText('');
      setNoteOk(true);
      setTimeout(() => setNoteOk(false), 2000);
      loadNotes();
    } catch (e) {
      alert('Could not add note: ' + e.message);
    } finally {
      setSavingNote(false);
    }
  };

  // ── Assign (used especially when Blocked) ────
  const [assigning, setAssigning] = useState(false);
  const [typedAssignee, setTypedAssignee] = useState('');
  const assignTo = async (tech) => {
    if (!tech || !tech.name) return;
    setAssigning(true);
    try {
      const upd = { tech_name: tech.name };
      if (tech.id) upd.tech_assigned = tech.id;   // only set FK when a real tech row
      const { error } = await supabase.from('jobs').update(upd).eq('id', job.id);
      if (error) throw error;
      try { notifyJobAssigned(tech.name, job.customer_name || 'a job', job.scheduled_date || null); } catch {}
      try { await notesApi.addNote(job.id, `🚫 Assigned to ${tech.name}${job.status==='blocked'?' (BLOCKED — needs attention)':''}`, 'board'); } catch {}
      onRenamed?.(job.id, job.customer_name); // trigger parent refresh of this job
      setTypedAssignee('');
      alert(`Assigned to ${tech.name}. They'll be notified if push is enabled on their device.`);
    } catch (e) {
      alert('Could not assign: ' + e.message);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#1e293b', borderRadius:'16px 16px 0 0', width:'100%', maxWidth:520, padding:'20px 20px 40px', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ width:36, height:4, background:'#334155', borderRadius:2, margin:'0 auto 16px' }} />

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <span style={{ fontSize:11, color:si.color||'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:0.5 }}>{si.icon} {si.label}</span>
            {editingTitle ? (
              <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4 }}>
                <input autoFocus value={titleVal} onChange={e => setTitleVal(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter') saveTitle(); if (e.key==='Escape') { setTitleVal(job.customer_name||''); setEditingTitle(false); } }}
                  style={{ flex:1, padding:'6px 8px', borderRadius:6, border:'1px solid #475569', background:'#0f172a', color:'#fff', fontSize:16, boxSizing:'border-box' }} />
                <button onClick={saveTitle} disabled={savingTitle} style={{ padding:'6px 10px', borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontWeight:600, fontSize:13, cursor:'pointer' }}>{savingTitle?'…':'Save'}</button>
                <button onClick={() => { setTitleVal(job.customer_name||''); setEditingTitle(false); }} style={{ padding:'6px 8px', borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#94a3b8', fontSize:13, cursor:'pointer' }}>✕</button>
              </div>
            ) : (
              <h3 onClick={() => setEditingTitle(true)} title="Tap to rename"
                style={{ margin:'4px 0 0', color:'#fff', fontSize:17, cursor:'text' }}>
                {job.customer_name||'—'} <span style={{ fontSize:12, color:'#64748b' }}>✎</span>
              </h3>
            )}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b', fontSize:22, cursor:'pointer', minWidth:40 }}>✕</button>
        </div>

        {/* UUID linker */}
        {!job.customer_id && <UUIDLinker job={job} onLinked={onUUIDLinked} />}

        {/* Details — show original dates not today */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 16px', fontSize:12, marginBottom:14 }}>
          {[
            ['type', job.job_type],
            ['priority', job.priority],
            ['address', job.customer_address],
            ['phone', job.customer_phone],
            ['CMS', job.cms_account_id],
            ['tech', job.tech_name],
            ['scheduled', job.scheduled_date],
            ['created', fmtDate(job.created_at)],
            ['updated', job.updated_at !== job.created_at ? fmtDate(job.updated_at) : null],
          ].filter(([,v]) => v).map(([label,val]) => (
            <div key={label}>
              <div style={{ color:'#475569', fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:1 }}>{label}</div>
              <div style={{ color:'#cbd5e1' }}>{val}</div>
            </div>
          ))}
          {job.estimate_amount > 0 && (
            <div style={{ gridColumn:'1/-1' }}>
              <div style={{ color:'#475569', fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:1 }}>estimate</div>
              <div style={{ color:'#22c55e', fontWeight:600, fontSize:14 }}>{fmtMoney(job.estimate_amount)}</div>
            </div>
          )}
        </div>

        {job.issue && (
          <div style={{ background:'#0f172a', borderRadius:8, padding:12, marginBottom:14 }}>
            <div style={{ color:'#475569', fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:4 }}>issue</div>
            <div style={{ color:'#e2e8f0', fontSize:13, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{job.issue}</div>
          </div>
        )}

        {/* Add a note — works on any job */}
        <div style={{ marginBottom:14 }}>
          <div style={{ color:'#475569', fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:4 }}>add note</div>
          <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} placeholder="Type a note…"
            style={{ width:'100%', padding:10, borderRadius:8, border:'1px solid #334155', background:'#0f172a', color:'#fff', fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
          <button onClick={addNote} disabled={savingNote||!noteText.trim()}
            style={{ marginTop:6, padding:'8px 14px', borderRadius:8, border:'none', background:noteText.trim()?'#3b82f6':'#334155', color:'#fff', fontWeight:600, fontSize:13, cursor:noteText.trim()?'pointer':'not-allowed' }}>
            {savingNote ? 'Saving…' : noteOk ? '✓ Added' : '+ Add note'}
          </button>

          {/* Notes thread — shows the notes that were added */}
          {jobNotes.length > 0 && (
            <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
              {jobNotes.map(n => (
                <div key={n.id} style={{ background:'#0f172a', borderRadius:8, padding:'8px 10px', borderLeft:'2px solid #3b82f6' }}>
                  <div style={{ color:'#cbd5e1', fontSize:12, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{n.text}</div>
                  <div style={{ color:'#475569', fontSize:9, marginTop:3 }}>
                    {n.created_by || 'unknown'} · {fmtDate(n.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assign to a user — emphasized when Blocked */}
        <div style={{ marginBottom:14, padding:job.status==='blocked'?'12px':'0', borderRadius:8, background:job.status==='blocked'?'#dc262615':'transparent', border:job.status==='blocked'?'1px solid #dc262640':'none' }}>
          <div style={{ color:job.status==='blocked'?'#dc2626':'#475569', fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:6, fontWeight:600 }}>
            {job.status==='blocked' ? '🚫 Blocked — assign to someone' : 'assign to'}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {(techs||[]).map(tech => (
              <button key={tech.id} onClick={() => assignTo(tech)} disabled={assigning}
                style={{ padding:'6px 12px', borderRadius:6, border:`1px solid ${job.tech_assigned===tech.id?'#22c55e':'#334155'}`, background:job.tech_assigned===tech.id?'#22c55e22':'transparent', color:job.tech_assigned===tech.id?'#22c55e':'#cbd5e1', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                {job.tech_assigned===tech.id ? '✓ ' : ''}{tech.name}
              </button>
            ))}
            {(!techs || techs.length === 0) && (
              <div style={{ color:'#94a3b8', fontSize:12 }}>No team members loaded — type a name below.</div>
            )}
          </div>
          {/* Typed-name fallback — always available */}
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <input value={typedAssignee} onChange={e => setTypedAssignee(e.target.value)} placeholder="…or type a name"
              onKeyDown={e => { if (e.key==='Enter' && typedAssignee.trim()) assignTo({ id:null, name:typedAssignee.trim() }); }}
              style={{ flex:1, padding:'6px 10px', borderRadius:6, border:'1px solid #334155', background:'#0f172a', color:'#fff', fontSize:13, boxSizing:'border-box' }} />
            <button onClick={() => typedAssignee.trim() && assignTo({ id:null, name:typedAssignee.trim() })} disabled={assigning||!typedAssignee.trim()}
              style={{ padding:'6px 12px', borderRadius:6, border:'none', background:typedAssignee.trim()?'#22c55e':'#334155', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' }}>Assign</button>
          </div>
        </div>

        {/* Merge tool */}
        <MergeTool job={job} allJobs={allJobs} onMerge={onMerge} accessToken={accessToken} userEmail={userEmail} />

        {/* Optional scheduler for ready/return */}
        {(job.status==='ready_to_schedule'||job.status==='return_pending') && (
          <button onClick={() => { onSchedule(job); }}
            style={{ width:'100%', padding:12, borderRadius:8, border:'none', background:'#8b5cf6', color:'#fff', fontWeight:600, fontSize:14, cursor:'pointer', marginBottom:10 }}>
            📅 Open Scheduler (pick tech + time)
          </button>
        )}

        {/* Move to a lane — the 6 board buckets, not 15 raw statuses */}
        <div>
          <div style={{ color:'#475569', fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:6 }}>move to</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {LANE_MOVES.map(lane => {
              const isHere = lane.statuses.includes(job.status);
              if (lane.key === 'estimates') {
                return (
                  <button key={lane.key} onClick={() => setShowEstStages(s => !s)} disabled={moving}
                    style={{ padding:12, borderRadius:8, border:`1px solid ${lane.color}`, background:isHere?`${lane.color}22`:'transparent', color:lane.color, fontWeight:700, fontSize:13, cursor:'pointer', gridColumn: showEstStages ? '1 / -1' : 'auto' }}>
                    {lane.label} ▾
                  </button>
                );
              }
              return (
                <button key={lane.key} onClick={() => onStatusMove(job.id, lane.target)} disabled={moving||isHere}
                  style={{ padding:12, borderRadius:8, border:`1px solid ${lane.color}`, background:isHere?`${lane.color}33`:'transparent', color:isHere?'#fff':lane.color, fontWeight:700, fontSize:13, cursor:isHere?'default':'pointer', opacity:moving?0.6:1 }}>
                  {isHere ? '● ' : ''}{lane.label}
                </button>
              );
            })}
          </div>

          {/* Estimates sub-stages — revealed on tap */}
          {showEstStages && (
            <div style={{ marginTop:8, padding:10, borderRadius:8, background:'#0f172a', border:'1px solid #f59e0b40' }}>
              <div style={{ color:'#f59e0b', fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:8, fontWeight:700 }}>Estimate stage</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {EST_STAGES.map(st => (
                  <button key={st.status} onClick={() => onStatusMove(job.id, st.status)} disabled={moving||job.status===st.status}
                    style={{ padding:10, borderRadius:8, border:`1px solid ${st.color}`, background:job.status===st.status?`${st.color}33`:'transparent', color:job.status===st.status?'#fff':st.color, fontWeight:600, fontSize:12, cursor:'pointer' }}>
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Job card ──────────────────────────────────────────────────────────────────
function JobCard({ job, onSelect, onQuickMove, moving }) {
  const si = STATUS_INFO[job.status] || {};
  const isUrgent = job.priority === 'urgent';
  const isHigh = job.priority === 'high';
  const hasUUID = !!job.customer_id;
  const quickVerbs = SUGGESTED_NEXT[job.status] ? [SUGGESTED_NEXT[job.status]] : [];

  return (
    <div onClick={() => onSelect(job)}
      style={{ background:'#1e293b', borderRadius:8, padding:12, marginBottom:8, borderLeft:`3px solid ${isUrgent?'#ef4444':(si.color||'#334155')}`, cursor:'pointer', opacity:['dead','lost'].includes(job.status)?0.55:1 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:4 }}>
        <div style={{ fontSize:14, fontWeight:500, color:'#fff', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{job.customer_name||'—'}</div>
        <div style={{ display:'flex', gap:4, flexShrink:0 }}>
          {isUrgent && <span style={{ background:'#ef4444', color:'#fff', fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:4 }}>URGENT</span>}
          {isHigh && <span style={{ background:'#f59e0b', color:'#000', fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:4 }}>HIGH</span>}
          {!hasUUID && <span style={{ background:'#451a03', color:'#fb923c', fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:4 }}>NO UUID</span>}
        </div>
      </div>
      <div style={{ fontSize:12, color:'#64748b', marginBottom:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{job.issue||'no issue noted'}</div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
          {/* CURRENT status — the prominent tag */}
          <span style={{ fontSize:10, fontWeight:700, color:si.color||'#94a3b8', background:`${si.color||'#334155'}22`, padding:'2px 7px', borderRadius:5, whiteSpace:'nowrap' }}>
            {si.icon} {si.label||job.status}
          </span>
          {job.tech_name && <span style={{ fontSize:10, color:'#3b82f6' }}>· {job.tech_name}</span>}
          {job.estimate_amount>0 && <span style={{ fontSize:10, color:'#22c55e' }}>· {fmtMoney(job.estimate_amount)}</span>}
          <span style={{ fontSize:10, color:'#334155' }}>· {fmtDate(job.created_at)}</span>
        </div>
        {quickVerbs.length > 0 && (
          <button onClick={e => { e.stopPropagation(); onQuickMove(job, quickVerbs[0]); }} disabled={moving}
            title={`Move to ${STATUS_INFO[quickVerbs[0]]?.label||quickVerbs[0]}`}
            style={{ padding:'3px 8px', borderRadius:5, border:`1px solid ${STATUS_INFO[quickVerbs[0]]?.color||'#334155'}`, background:'transparent', color:STATUS_INFO[quickVerbs[0]]?.color||'#94a3b8', fontSize:10, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, opacity:0.8 }}>
            move → {STATUS_INFO[quickVerbs[0]]?.label||quickVerbs[0]}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Column ─────────────────────────────────────────────────────────────────────
function Column({ col, jobs, onSelect, onQuickMove, moving, activeCol, setActiveCol }) {
  const totalEstimate = jobs.filter(j=>j.estimate_amount>0).reduce((s,j)=>s+j.estimate_amount,0);
  return (
    <div style={{ flex:1, minWidth:260, maxWidth:340, display:'flex', flexDirection:'column' }}>
      <div onClick={() => setActiveCol(col.key)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'#0f172a', borderBottom:`3px solid ${col.color}`, borderRadius:'8px 8px 0 0', cursor:'pointer' }}>
        <span style={{ color:'#fff', fontWeight:600, fontSize:13 }}>{col.label}</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {totalEstimate>0 && <span style={{ fontSize:11, color:'#22c55e' }}>{fmtMoney(totalEstimate)}</span>}
          <span style={{ background:col.color, color:'#000', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:700 }}>{jobs.length}</span>
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:10, background:'#0f172a', borderRadius:'0 0 8px 8px' }}>
        {jobs.length===0
          ? <div style={{ color:'#334155', textAlign:'center', padding:20, fontSize:12 }}>empty</div>
          : jobs.map(j => <JobCard key={j.id} job={j} onSelect={onSelect} onQuickMove={onQuickMove} moving={moving} />)
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
export default function BoardView({ accessToken, onBack, userEmail, userName }) {
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [schedulingJob, setSchedulingJob] = useState(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [activeCol, setActiveCol] = useState('triage');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [stats, setStats] = useState({ total_open:0, needs_action:0, to_bill:0, returns_pending:0 });

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''), 2400); };

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const ACTIVE = ['new','needs_details','needs_parts','pending_materials','needs_estimate','estimate_sent','ready_to_schedule','return_pending','scheduled','complete','to_bill'];
      const { data, error } = await supabase.from('jobs').select('*').in('status', ACTIVE).order('created_at',{ascending:false}).limit(500);
      if (error) throw error;
      setJobs(data||[]);
      const j = data||[];
      setStats({
        total_open: j.length,
        needs_action: j.filter(x=>['new','needs_details','needs_parts','needs_estimate'].includes(x.status)).length,
        to_bill: j.filter(x=>['complete','to_bill'].includes(x.status)).length,
        returns_pending: j.filter(x=>x.status==='return_pending').length,
      });
    } catch(e) { console.error('loadJobs:', e); }
    setLoading(false);
  }, []);

  const loadTechs = useCallback(async () => {
    try {
      let list = await techsApi.getAll();
      // Fallback: if is_active filtering returned nothing, load every tech row
      if (!list || list.length === 0) {
        const { data } = await supabase.from('techs').select('*').order('name');
        list = data || [];
      }
      setTechs(list);
    } catch (e) {
      console.warn('techs:', e);
      try {
        const { data } = await supabase.from('techs').select('*').order('name');
        setTechs(data || []);
      } catch {}
    }
  }, []);

  useEffect(() => { loadJobs(); loadTechs(); }, [loadJobs, loadTechs]);

  // Status move — no note required, never touches created_at
  const moveStatus = useCallback(async (jobId, newStatus) => {
    setMoving(true);
    try {
      const { error } = await supabase.from('jobs').update({
        status: newStatus,
        updated_by: userEmail||'info@drhsecurityservices.com',
        updated_at: new Date().toISOString(),
        // created_at intentionally NOT included
      }).eq('id', jobId);
      if (error) throw error;
      setJobs(prev => prev.map(j => j.id===jobId ? {...j, status:newStatus} : j));
      setSelectedJob(prev => prev?.id===jobId ? {...prev, status:newStatus} : prev);
      showToast(`→ ${STATUS_INFO[newStatus]?.label||newStatus}`);
    } catch(e) { showToast(`Error: ${e.message}`); }
    setMoving(false);
  }, [userEmail]);

  const quickMove = useCallback(async (job, verb) => {
    await moveStatus(job.id, verb);
  }, [moveStatus]);

  const handleUUIDLinked = useCallback((customerId) => {
    if (!selectedJob) return;
    setJobs(prev => prev.map(j => j.id===selectedJob.id ? {...j, customer_id:customerId} : j));
    setSelectedJob(prev => prev ? {...prev, customer_id:customerId} : prev);
    showToast('Customer linked ✓');
  }, [selectedJob]);

  const handleMerge = useCallback((deadJobId, survivorId) => {
    setJobs(prev => prev.map(j => j.id===deadJobId ? {...j, status:'dead'} : j));
    setSelectedJob(null);
    showToast('Marked as duplicate ✓');
  }, []);

  const filtered = search
    ? jobs.filter(j =>
        (j.customer_name||'').toLowerCase().includes(search.toLowerCase()) ||
        (j.issue||'').toLowerCase().includes(search.toLowerCase()) ||
        (j.cms_account_id||'').toLowerCase().includes(search.toLowerCase())
      )
    : jobs;

  const buckets = COLUMNS.reduce((acc, col) => {
    acc[col.key] = filtered.filter(j => col.statuses.includes(j.status));
    return acc;
  }, {});

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', color:'#fff', display:'flex', flexDirection:'column' }}>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #1e293b' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={onBack} style={{ background:'#1e293b', border:'none', color:'#94a3b8', padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:13 }}>← Home</button>
          <span style={{ fontWeight:700, fontSize:16 }}>📋 Board</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowNewJob(true)} style={{ background:'#22c55e', border:'none', color:'#fff', padding:'8px 16px', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:13 }}>+ New Job</button>
          <button onClick={loadJobs} disabled={loading} style={{ background:'#1e293b', border:'none', color:'#94a3b8', padding:'8px 14px', borderRadius:8, cursor:'pointer', fontSize:13 }}>{loading?'…':'↻'}</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, padding:'10px 16px', borderBottom:'1px solid #1e293b', flexWrap:'wrap', alignItems:'center' }}>
        {[{label:'open',val:stats.total_open,color:'#64748b'},{label:'needs action',val:stats.needs_action,color:'#ef4444'},{label:'to bill',val:stats.to_bill,color:'#8b5cf6'},{label:'returns',val:stats.returns_pending,color:'#06b6d4'}].map(s=>(
          <div key={s.label} style={{ background:'#1e293b', padding:'6px 14px', borderRadius:8 }}>
            <div style={{ fontSize:10, color:'#475569', textTransform:'uppercase', letterSpacing:0.4 }}>{s.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color:s.color }}>{s.val}</div>
          </div>
        ))}
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search customer, issue, CMS…"
          style={{ marginLeft:'auto', padding:'6px 12px', borderRadius:8, border:'1px solid #1e293b', background:'#1e293b', color:'#fff', fontSize:13, width:220 }} />
      </div>

      <div style={{ display:'flex', overflowX:'auto', borderBottom:'1px solid #1e293b' }}>
        {COLUMNS.map(col => (
          <button key={col.key} onClick={() => setActiveCol(col.key)}
            style={{ padding:'10px 14px', background:'none', border:'none', whiteSpace:'nowrap', borderBottom:activeCol===col.key?`2px solid ${col.color}`:'2px solid transparent', color:activeCol===col.key?col.color:'#475569', cursor:'pointer', fontSize:12, fontWeight:activeCol===col.key?700:400 }}>
            {col.label} <span style={{ background:'#1e293b', padding:'1px 6px', borderRadius:10, fontSize:10 }}>{buckets[col.key]?.length||0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#334155', fontSize:14 }}>Loading from Supabase…</div>
      ) : (
        <div style={{ flex:1, display:'flex', gap:12, padding:14, overflowX:'auto', overflowY:'hidden' }}>
          {COLUMNS.map(col => (
            <Column key={col.key} col={col} jobs={buckets[col.key]||[]} onSelect={setSelectedJob} onQuickMove={quickMove} moving={moving} activeCol={activeCol} setActiveCol={setActiveCol} />
          ))}
        </div>
      )}

      {selectedJob && (
        <DetailDrawer
          job={selectedJob} techs={techs} accessToken={accessToken} moving={moving} userEmail={userEmail}
          allJobs={jobs}
          onStatusMove={(jobId, verb) => { moveStatus(jobId, verb); setSelectedJob(null); }}
          onSchedule={job => { setSelectedJob(null); setSchedulingJob(job); }}
          onClose={() => setSelectedJob(null)}
          onUUIDLinked={handleUUIDLinked}
          onMerge={handleMerge}
          onRenamed={(jobId, name) => {
            setJobs(prev => prev.map(j => j.id===jobId ? {...j, customer_name:name} : j));
            setSelectedJob(prev => prev?.id===jobId ? {...prev, customer_name:name} : prev);
          }}
        />
      )}

      {schedulingJob && (
        <SchedulerModal job={schedulingJob} techs={techs} accessToken={accessToken}
          onScheduled={() => { setSchedulingJob(null); loadJobs(); showToast('Scheduled ✓'); }}
          onClose={() => setSchedulingJob(null)} />
      )}

      {showNewJob && (
        <NewJobModal accessToken={accessToken} userEmail={userEmail}
          onCreated={() => { setShowNewJob(false); loadJobs(); showToast('Job created ✓'); }}
          onClose={() => setShowNewJob(false)} />
      )}

      {toast && (
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'#1e293b', border:'1px solid #334155', color:'#fff', padding:'10px 20px', borderRadius:10, fontSize:13, fontWeight:500, zIndex:9999, boxShadow:'0 4px 24px rgba(0,0,0,0.4)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
