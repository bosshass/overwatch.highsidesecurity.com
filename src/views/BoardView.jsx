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
import { supabase, JOB_STATUS, STATUS_INFO, techsApi, customersApi } from '../services/supabase.js';
import NewJobModal from '../components/NewJobModal.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';

const STATUS_VERBS = {
  new:               ['needs_details','needs_parts','needs_estimate','ready_to_schedule','dead'],
  needs_details:     ['needs_parts','ready_to_schedule','dead'],
  needs_parts:       ['pending_materials','ready_to_schedule'],
  pending_materials: ['ready_to_schedule','needs_parts'],
  needs_estimate:    ['estimate_sent','needs_parts','dead'],
  estimate_sent:     ['won','lost'],
  won:               ['needs_parts','ready_to_schedule'],
  ready_to_schedule: ['scheduled','return_pending','needs_parts'],
  scheduled:         ['complete','return_pending','needs_parts'],
  return_pending:    ['scheduled','complete','dead'],
  complete:          ['to_bill','billed'],
  to_bill:           ['billed'],
  billed:            ['archived'],
  lost:              ['archived'],
  dead:              ['archived'],
};

const COLUMNS = [
  { key:'triage',    label:'🔥 Triage',    color:'#ef4444', statuses:['new','needs_details','needs_parts','pending_materials','needs_estimate'] },
  { key:'ready',     label:'✅ Ready',      color:'#22c55e', statuses:['ready_to_schedule'] },
  { key:'returns',   label:'🔄 Returns',    color:'#06b6d4', statuses:['return_pending'] },
  { key:'scheduled', label:'📅 Scheduled',  color:'#3b82f6', statuses:['scheduled'] },
  { key:'estimates', label:'📋 Estimates',  color:'#f59e0b', statuses:['estimate_sent'] },
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
function MergeTool({ job, allJobs, onMerge }) {
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
    if (!window.confirm('Mark THIS job as dead and keep the other as the survivor?')) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('jobs').update({
        status: 'dead',
        action_note: `Merged into job ${survivorId}`,
        updated_by: 'info@drhsecurityservices.com',
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

// ── Scheduler modal ───────────────────────────────────────────────────────────
function SchedulerModal({ job, techs, accessToken, onScheduled, onClose }) {
  const [techId, setTechId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [notes, setNotes] = useState(job.issue || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const selectedTech = techs.find(t => t.id === techId);

  const submit = async () => {
    if (!techId || !date) { setErr('Tech and date required'); return; }
    setSaving(true); setErr('');
    try {
      const { error: dbErr } = await supabase.from('jobs').update({
        status: 'scheduled',
        scheduled_date: date,
        tech_assigned: techId,
        tech_name: selectedTech?.name || '',
        updated_at: new Date().toISOString(),
        // NOTE: created_at is never touched
      }).eq('id', job.id);
      if (dbErr) throw dbErr;

      if (accessToken && selectedTech?.calendar_id) {
        const body = {
          summary: `${job.customer_name||'Customer'} — ${job.job_type||'Service'}`,
          description: [
            `Issue: ${job.issue||''}`,
            job.customer_phone ? `Phone: ${job.customer_phone}` : '',
            notes ? `Notes: ${notes}` : '',
          ].filter(Boolean).join('\n'),
          location: job.customer_address || '',
          start: { dateTime: `${date}T${startTime}:00`, timeZone: 'America/Denver' },
          end:   { dateTime: `${date}T${endTime}:00`,   timeZone: 'America/Denver' },
        };
        await fetch(`${GCAL}/calendars/${encodeURIComponent(selectedTech.calendar_id)}/events`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(e => console.warn('GCal write failed (non-fatal):', e));
      }
      onScheduled();
    } catch(e) { setErr(e.message||'Failed'); }
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1100, display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#1e293b', borderRadius:'16px 16px 0 0', width:'100%', maxWidth:520, padding:'20px 20px 32px', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ width:36, height:4, background:'#334155', borderRadius:2, margin:'0 auto 16px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ margin:0, color:'#fff', fontSize:17 }}>📅 Schedule — {job.customer_name}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#94a3b8', fontSize:22, cursor:'pointer' }}>✕</button>
        </div>

        <div style={{ background:'#0f172a', borderRadius:8, padding:12, marginBottom:16, fontSize:13, color:'#94a3b8' }}>
          {job.issue && <div style={{ color:'#cbd5e1', marginBottom:4 }}>{job.issue.slice(0,120)}</div>}
          {job.customer_address && <div>📍 {job.customer_address}</div>}
          {job.customer_phone && <div>📞 {job.customer_phone}</div>}
        </div>

        <label style={{ color:'#94a3b8', fontSize:12, display:'block', marginBottom:6 }}>Tech *</label>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
          {techs.map(t => (
            <button key={t.id} onClick={() => setTechId(t.id)}
              style={{ padding:'8px 14px', borderRadius:8, border:`2px solid ${techId===t.id?t.color:'#334155'}`, background:techId===t.id?`${t.color}22`:'#0f172a', color:techId===t.id?t.color:'#64748b', fontWeight:600, cursor:'pointer', fontSize:13 }}>
              {t.name}
            </button>
          ))}
        </div>

        <label style={{ color:'#94a3b8', fontSize:12, display:'block', marginBottom:6 }}>Date *</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ width:'100%', padding:10, borderRadius:8, border:'1px solid #334155', background:'#0f172a', color:'#fff', fontSize:15, marginBottom:16, boxSizing:'border-box' }} />

        <div style={{ display:'flex', gap:12, marginBottom:16 }}>
          {[['Start',startTime,setStartTime],['End',endTime,setEndTime]].map(([label,val,set]) => (
            <div key={label} style={{ flex:1 }}>
              <label style={{ color:'#94a3b8', fontSize:12, display:'block', marginBottom:6 }}>{label}</label>
              <input type="time" value={val} onChange={e => set(e.target.value)}
                style={{ width:'100%', padding:10, borderRadius:8, border:'1px solid #334155', background:'#0f172a', color:'#fff', fontSize:15, boxSizing:'border-box' }} />
            </div>
          ))}
        </div>

        <label style={{ color:'#94a3b8', fontSize:12, display:'block', marginBottom:6 }}>Notes for tech</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          style={{ width:'100%', padding:10, borderRadius:8, border:'1px solid #334155', background:'#0f172a', color:'#fff', fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box', marginBottom:16 }} />

        {err && <div style={{ color:'#ef4444', fontSize:12, marginBottom:12 }}>{err}</div>}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:12, borderRadius:8, border:'1px solid #334155', background:'transparent', color:'#94a3b8', fontWeight:600, cursor:'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={saving||!techId||!date}
            style={{ flex:2, padding:12, borderRadius:8, border:'none', background:techId&&date?'#22c55e':'#334155', color:'#fff', fontWeight:600, cursor:techId&&date?'pointer':'not-allowed' }}>
            {saving ? 'Scheduling…' : '✓ Confirm Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────
function DetailDrawer({ job, techs, accessToken, onStatusMove, onSchedule, onClose, moving, onUUIDLinked, allJobs, onMerge }) {
  const verbs = STATUS_VERBS[job.status] || [];
  const si = STATUS_INFO[job.status] || {};

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#1e293b', borderRadius:'16px 16px 0 0', width:'100%', maxWidth:520, padding:'20px 20px 40px', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ width:36, height:4, background:'#334155', borderRadius:2, margin:'0 auto 16px' }} />

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <span style={{ fontSize:11, color:si.color||'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:0.5 }}>{si.icon} {si.label}</span>
            <h3 style={{ margin:'4px 0 0', color:'#fff', fontSize:17 }}>{job.customer_name||'—'}</h3>
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

        {/* Merge tool */}
        <MergeTool job={job} allJobs={allJobs} onMerge={onMerge} />

        {/* Optional scheduler for ready/return */}
        {(job.status==='ready_to_schedule'||job.status==='return_pending') && (
          <button onClick={() => { onSchedule(job); }}
            style={{ width:'100%', padding:12, borderRadius:8, border:'none', background:'#8b5cf6', color:'#fff', fontWeight:600, fontSize:14, cursor:'pointer', marginBottom:10 }}>
            📅 Open Scheduler (pick tech + time)
          </button>
        )}

        {/* Verb buttons — fire immediately, no note gate */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {verbs.map((verb, i) => {
            const vsi = STATUS_INFO[verb] || {};
            const isPrimary = i === 0;
            return (
              <button key={verb} onClick={() => onStatusMove(job.id, verb)} disabled={moving}
                style={{ padding:12, borderRadius:8, border:isPrimary?'none':`1px solid ${vsi.color||'#334155'}`, background:isPrimary?(vsi.color||'#334155'):'transparent', color:isPrimary?'#fff':(vsi.color||'#94a3b8'), fontWeight:600, fontSize:13, cursor:'pointer', textAlign:'left', opacity:moving?0.6:1 }}>
                {vsi.icon} → {vsi.label||verb}
              </button>
            );
          })}
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
  const quickVerbs = (STATUS_VERBS[job.status] || []).slice(0,1);

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
        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
          <span style={{ fontSize:10, color:'#475569' }}>{job.job_type||'service'}</span>
          {job.tech_name && <span style={{ fontSize:10, color:'#3b82f6' }}>· {job.tech_name}</span>}
          {job.estimate_amount>0 && <span style={{ fontSize:10, color:'#22c55e' }}>· {fmtMoney(job.estimate_amount)}</span>}
          {/* Original date — not "today" */}
          <span style={{ fontSize:10, color:'#334155' }}>· {fmtDate(job.created_at)}</span>
        </div>
        {quickVerbs.length > 0 && (
          <button onClick={e => { e.stopPropagation(); onQuickMove(job, quickVerbs[0]); }} disabled={moving}
            style={{ padding:'3px 8px', borderRadius:5, border:`1px solid ${STATUS_INFO[quickVerbs[0]]?.color||'#334155'}`, background:'transparent', color:STATUS_INFO[quickVerbs[0]]?.color||'#94a3b8', fontSize:10, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
            → {STATUS_INFO[quickVerbs[0]]?.label||quickVerbs[0]}
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
    try { setTechs(await techsApi.getAll()); } catch(e) { console.warn('techs:', e); }
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
          job={selectedJob} techs={techs} accessToken={accessToken} moving={moving}
          allJobs={jobs}
          onStatusMove={(jobId, verb) => { moveStatus(jobId, verb); setSelectedJob(null); }}
          onSchedule={job => { setSelectedJob(null); setSchedulingJob(job); }}
          onClose={() => setSelectedJob(null)}
          onUUIDLinked={handleUUIDLinked}
          onMerge={handleMerge}
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
