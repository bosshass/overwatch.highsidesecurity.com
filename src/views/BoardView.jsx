// ============================================
// BoardView — NakedPM v3 mobile-first
// ============================================
// - Supabase jobs table = only SOT
// - Single column on mobile, tabs switch columns
// - No note gate on status moves
// - UUID linker inline
// - Merge/duplicate tool
// - Original dates preserved
// - Scheduler optional, writes GCal + stamps calendar_event_id
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, STATUS_INFO, techsApi, customersApi } from '../services/supabase.js';
import NewJobModal from '../components/NewJobModal.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';

const C = {
  bg:    '#07111f',
  panel: '#101d31',
  card:  '#111f34',
  card2: '#1a2a42',
  line:  '#1d2f48',
  line2: '#263a55',
  text:  '#edf4ff',
  muted: '#8ea0b8',
  green: '#22d16f',
  red:   '#ff4f5e',
  blue:  '#4b8dff',
  cyan:  '#16c7df',
  amber: '#ffb020',
  purple:'#9b6cff',
};

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
  { key:'triage',    label:'Triage',    emoji:'🔥', color:C.red,    statuses:['new','needs_details','needs_parts','pending_materials','needs_estimate'] },
  { key:'ready',     label:'Ready',     emoji:'✅', color:C.green,  statuses:['ready_to_schedule'] },
  { key:'returns',   label:'Returns',   emoji:'🔄', color:C.cyan,   statuses:['return_pending'] },
  { key:'scheduled', label:'Scheduled', emoji:'📅', color:C.blue,   statuses:['scheduled'] },
  { key:'estimates', label:'Estimates', emoji:'📋', color:C.amber,  statuses:['estimate_sent'] },
  { key:'tobill',    label:'To Bill',   emoji:'💵', color:C.purple, statuses:['complete','to_bill'] },
];

const fmtMoney = n => n >= 1000 ? `$${(n/1000).toFixed(1)}k` : n ? `$${n}` : '';
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
  const [form, setForm] = useState({ name: job.customer_name||'', phone: job.customer_phone||'', address: job.customer_address||'' });
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
    if (!form.name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try {
      const c = await customersApi.createLoose(form);
      await link(c.id);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1px solid #6a2a39', background:'#23121a', color:'#ff8fa3', fontSize:13, fontWeight:700, cursor:'pointer', textAlign:'left', marginBottom:12 }}>
      ⚠ No customer UUID — tap to link
    </button>
  );

  return (
    <div style={{ background:C.panel, borderRadius:14, padding:14, marginBottom:14, border:`1px solid ${C.line2}` }} onClick={e => e.stopPropagation()}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5 }}>Link customer</span>
        <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:16 }}>✕</button>
      </div>
      {!createMode ? (
        <>
          <input value={query} onChange={e => search(e.target.value)} placeholder="Search name, phone, CMS…"
            style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.line2}`, background:C.card2, color:C.text, fontSize:14, boxSizing:'border-box', marginBottom:8, outline:'none' }} />
          {searching && <div style={{ color:C.muted, fontSize:12, padding:'4px 0' }}>searching…</div>}
          {results.map(c => (
            <button key={c.id} onClick={() => link(c.id)} disabled={saving}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'10px 12px', background:C.card2, border:`0.5px solid ${C.line2}`, borderRadius:10, color:C.text, fontSize:13, cursor:'pointer', marginBottom:6 }}>
              <div style={{ fontWeight:700 }}>{c.name}</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{[c.phone, c.address?.split(',')[0], c.cms_account_id].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
          <button onClick={() => setCreateMode(true)}
            style={{ width:'100%', marginTop:4, padding:'10px 0', borderRadius:10, border:`1px dashed ${C.line2}`, background:'transparent', color:C.muted, fontSize:13, cursor:'pointer' }}>
            + Create new customer
          </button>
        </>
      ) : (
        <>
          {[['Name *','name'],['Phone','phone'],['Address','address']].map(([label,key]) => (
            <div key={key} style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{label}</div>
              <input value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})}
                style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.line2}`, background:C.card2, color:C.text, fontSize:13, boxSizing:'border-box', outline:'none' }} />
            </div>
          ))}
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            <button onClick={() => setCreateMode(false)} style={{ flex:1, padding:10, borderRadius:10, border:`1px solid ${C.line2}`, background:'transparent', color:C.muted, fontSize:13, cursor:'pointer' }}>Back</button>
            <button onClick={createAndLink} disabled={saving||!form.name.trim()} style={{ flex:2, padding:10, borderRadius:10, border:'none', background:C.green, color:'#04130a', fontWeight:700, fontSize:13, cursor:'pointer' }}>
              {saving ? 'Saving…' : 'Create & link'}
            </button>
          </div>
        </>
      )}
      {err && <div style={{ color:C.red, fontSize:12, marginTop:8 }}>{err}</div>}
    </div>
  );
}

// ── Merge tool ────────────────────────────────────────────────────────────────
function MergeTool({ job, allJobs, onMerge }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(job.customer_name || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const candidates = allJobs.filter(j =>
    j.id !== job.id && !['dead','archived'].includes(j.status) && j.customer_name &&
    (j.customer_name.toLowerCase().includes(query.toLowerCase()) ||
     query.toLowerCase().includes((j.customer_name.toLowerCase().split(' ')[0] || '')))
  ).slice(0, 8);

  const merge = async survivorId => {
    if (!window.confirm('Mark this job as dead and keep the other?')) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('jobs').update({
        status:'dead', action_note:`Merged into ${survivorId}`,
        updated_by:'info@drhsecurityservices.com', updated_at:new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;
      onMerge(job.id, survivorId);
      setOpen(false);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width:'100%', padding:'9px 12px', borderRadius:10, border:`1px solid ${C.line2}`, background:'transparent', color:C.muted, fontSize:12, cursor:'pointer', textAlign:'left', marginBottom:10 }}>
      🔁 Mark as duplicate / merge
    </button>
  );

  return (
    <div style={{ background:C.panel, borderRadius:14, padding:14, marginBottom:14, border:`1px solid ${C.line2}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase' }}>Find duplicate</span>
        <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:16 }}>✕</button>
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customer name…"
        style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.line2}`, background:C.card2, color:C.text, fontSize:13, boxSizing:'border-box', marginBottom:8, outline:'none' }} />
      {candidates.length === 0
        ? <div style={{ color:C.muted, fontSize:12 }}>No matches</div>
        : candidates.map(c => {
          const si = STATUS_INFO[c.status]||{};
          return (
            <button key={c.id} onClick={() => merge(c.id)} disabled={saving}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'10px 12px', background:C.card2, border:`0.5px solid ${C.line2}`, borderRadius:10, color:C.text, fontSize:13, cursor:'pointer', marginBottom:6 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontWeight:700 }}>{c.customer_name}</span>
                <span style={{ fontSize:11, color:si.color||C.muted }}>{si.label||c.status}</span>
              </div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{c.issue?.slice(0,60)||'no issue'} · {fmtDate(c.created_at)}</div>
            </button>
          );
        })
      }
      {err && <div style={{ color:C.red, fontSize:12, marginTop:6 }}>{err}</div>}
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
  const tech = techs.find(t => t.id === techId);

  const submit = async () => {
    if (!techId || !date) { setErr('Tech and date required'); return; }
    setSaving(true); setErr('');
    try {
      let calEventId = null;
      if (accessToken && tech?.calendar_id) {
        const body = {
          summary: `${job.customer_name||'Customer'} — ${job.job_type||'Service'}`,
          description: [`Issue: ${job.issue||''}`, job.customer_phone?`Phone: ${job.customer_phone}`:'', notes?`Notes: ${notes}`:''].filter(Boolean).join('\n'),
          location: job.customer_address || '',
          start: { dateTime:`${date}T${startTime}:00`, timeZone:'America/Denver' },
          end:   { dateTime:`${date}T${endTime}:00`,   timeZone:'America/Denver' },
        };
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(tech.calendar_id)}/events`, {
          method:'POST', headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const ev = await res.json();
          calEventId = ev.id; // capture the event ID
        }
      }
      // Write Supabase — stamp calendar_event_id so TechWorkToday can find it
      const { error } = await supabase.from('jobs').update({
        status: 'scheduled',
        scheduled_date: date,
        tech_assigned: techId,
        tech_name: tech?.name || '',
        calendar_event_id: calEventId, // THE LINK
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;
      onScheduled();
    } catch(e) { setErr(e.message||'Failed'); }
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1100, display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#0d1a2e', borderRadius:'20px 20px 0 0', width:'100%', maxWidth:520, padding:'20px 20px calc(32px + env(safe-area-inset-bottom))', maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ width:36, height:4, background:C.line2, borderRadius:2, margin:'0 auto 18px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:4 }}>scheduling</div>
            <h3 style={{ margin:0, color:C.text, fontSize:18 }}>{job.customer_name}</h3>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, fontSize:24, cursor:'pointer' }}>✕</button>
        </div>

        {(job.issue || job.customer_address || job.customer_phone) && (
          <div style={{ background:C.card, borderRadius:12, padding:12, marginBottom:16, fontSize:13, color:C.muted }}>
            {job.issue && <div style={{ color:C.soft, marginBottom:4 }}>{job.issue.slice(0,100)}</div>}
            {job.customer_address && <div>📍 {job.customer_address}</div>}
            {job.customer_phone && <div>📞 {job.customer_phone}</div>}
          </div>
        )}

        <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>Tech *</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:18 }}>
          {techs.map(t => (
            <button key={t.id} onClick={() => setTechId(t.id)}
              style={{ padding:'10px 16px', borderRadius:12, border:`2px solid ${techId===t.id?t.color:C.line2}`, background:techId===t.id?`${t.color}22`:C.card, color:techId===t.id?t.color:C.muted, fontWeight:700, cursor:'pointer', fontSize:14 }}>
              {t.name}
            </button>
          ))}
        </div>

        <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>Date *</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ width:'100%', padding:12, borderRadius:12, border:`1px solid ${C.line2}`, background:C.card, color:C.text, fontSize:16, marginBottom:18, boxSizing:'border-box' }} />

        <div style={{ display:'flex', gap:12, marginBottom:18 }}>
          {[['Start',startTime,setStartTime],['End',endTime,setEndTime]].map(([label,val,set]) => (
            <div key={label} style={{ flex:1 }}>
              <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{label}</div>
              <input type="time" value={val} onChange={e => set(e.target.value)}
                style={{ width:'100%', padding:12, borderRadius:12, border:`1px solid ${C.line2}`, background:C.card, color:C.text, fontSize:16, boxSizing:'border-box' }} />
            </div>
          ))}
        </div>

        <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>Notes for tech</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          style={{ width:'100%', padding:12, borderRadius:12, border:`1px solid ${C.line2}`, background:C.card, color:C.text, fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box', marginBottom:18 }} />

        {err && <div style={{ color:C.red, fontSize:13, marginBottom:12 }}>{err}</div>}
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:14, borderRadius:14, border:`1px solid ${C.line2}`, background:'transparent', color:C.muted, fontWeight:700, cursor:'pointer', fontSize:14 }}>Cancel</button>
          <button onClick={submit} disabled={saving||!techId||!date}
            style={{ flex:2, padding:14, borderRadius:14, border:'none', background:techId&&date?C.green:C.line2, color:techId&&date?'#04130a':C.muted, fontWeight:900, cursor:techId&&date?'pointer':'not-allowed', fontSize:14 }}>
            {saving ? 'Scheduling…' : '✓ Confirm'}
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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#0d1a2e', borderRadius:'20px 20px 0 0', width:'100%', maxWidth:520, padding:'20px 18px calc(40px + env(safe-area-inset-bottom))', maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ width:36, height:4, background:C.line2, borderRadius:2, margin:'0 auto 18px' }} />

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div>
            <span style={{ fontSize:11, color:si.color||C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5 }}>{si.icon} {si.label}</span>
            <h3 style={{ margin:'4px 0 0', color:C.text, fontSize:20, lineHeight:1.2 }}>{job.customer_name||'—'}</h3>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, fontSize:24, cursor:'pointer', minWidth:40, padding:0 }}>✕</button>
        </div>

        {!job.customer_id && <UUIDLinker job={job} onLinked={onUUIDLinked} />}

        {/* Details */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 16px', fontSize:13, marginBottom:16 }}>
          {[
            ['Type', job.job_type],
            ['Priority', job.priority],
            ['Address', job.customer_address],
            ['Phone', job.customer_phone],
            ['CMS', job.cms_account_id],
            ['Tech', job.tech_name],
            ['Scheduled', job.scheduled_date],
            ['Created', fmtDate(job.created_at)],
          ].filter(([,v]) => v).map(([label,val]) => (
            <div key={label}>
              <div style={{ color:C.muted, fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:2 }}>{label}</div>
              <div style={{ color:C.soft }}>{val}</div>
            </div>
          ))}
          {job.estimate_amount > 0 && (
            <div style={{ gridColumn:'1/-1' }}>
              <div style={{ color:C.muted, fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:2 }}>Estimate</div>
              <div style={{ color:C.green, fontWeight:700, fontSize:16 }}>{fmtMoney(job.estimate_amount)}</div>
            </div>
          )}
        </div>

        {job.issue && (
          <div style={{ background:C.card, borderRadius:12, padding:14, marginBottom:16 }}>
            <div style={{ color:C.muted, fontSize:10, textTransform:'uppercase', letterSpacing:0.4, marginBottom:6 }}>Issue</div>
            <div style={{ color:C.text, fontSize:14, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{job.issue}</div>
          </div>
        )}

        <MergeTool job={job} allJobs={allJobs} onMerge={onMerge} />

        {(job.status==='ready_to_schedule'||job.status==='return_pending') && (
          <button onClick={() => onSchedule(job)}
            style={{ width:'100%', padding:14, borderRadius:14, border:'none', background:C.purple, color:'#fff', fontWeight:700, fontSize:15, cursor:'pointer', marginBottom:12 }}>
            📅 Open Scheduler
          </button>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {verbs.map((verb, i) => {
            const vsi = STATUS_INFO[verb]||{};
            const isPrimary = i === 0;
            return (
              <button key={verb} onClick={() => onStatusMove(job.id, verb)} disabled={moving}
                style={{ padding:14, borderRadius:14, border:isPrimary?'none':`1px solid ${vsi.color||C.line2}`, background:isPrimary?(vsi.color||C.line2):'transparent', color:isPrimary?'#fff':(vsi.color||C.muted), fontWeight:700, fontSize:14, cursor:'pointer', textAlign:'left', opacity:moving?0.6:1 }}>
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
  const si = STATUS_INFO[job.status]||{};
  const isUrgent = job.priority==='urgent';
  const isHigh = job.priority==='high';
  const hasUUID = !!job.customer_id;
  const quickVerb = (STATUS_VERBS[job.status]||[])[0];

  return (
    <div onClick={() => onSelect(job)}
      style={{ position:'relative', background:C.card2, border:`1px solid ${C.line2}`, borderRadius:16, padding:'14px 14px 14px 18px', marginBottom:10, cursor:'pointer', overflow:'hidden', opacity:['dead','lost'].includes(job.status)?0.5:1 }}>
      {/* Left accent */}
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:isUrgent?C.red:(si.color||C.line2) }} />

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:6 }}>
        <div style={{ fontSize:15, fontWeight:700, color:C.text, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.3 }}>{job.customer_name||'—'}</div>
        <div style={{ display:'flex', gap:4, flexShrink:0 }}>
          {isUrgent && <span style={{ background:C.red, color:'#fff', fontSize:9, fontWeight:900, padding:'3px 6px', borderRadius:6 }}>URGENT</span>}
          {isHigh && !isUrgent && <span style={{ background:C.amber, color:'#06101c', fontSize:9, fontWeight:900, padding:'3px 6px', borderRadius:6 }}>HIGH</span>}
          {!hasUUID && <span style={{ background:'#23121a', color:'#ff8fa3', fontSize:9, fontWeight:900, padding:'3px 6px', borderRadius:6 }}>NO UUID</span>}
        </div>
      </div>

      <div style={{ fontSize:12, color:C.muted, marginBottom:10, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.4 }}>{job.issue||'no issue noted'}</div>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'#4a5f7a' }}>{job.job_type||'service'}</span>
          {job.tech_name && <span style={{ fontSize:11, color:C.blue }}>· {job.tech_name}</span>}
          {job.estimate_amount>0 && <span style={{ fontSize:11, color:C.green }}>· {fmtMoney(job.estimate_amount)}</span>}
          <span style={{ fontSize:11, color:'#2d3f58' }}>· {fmtDate(job.created_at)}</span>
        </div>
        {quickVerb && (
          <button onClick={e => { e.stopPropagation(); onQuickMove(job, quickVerb); }} disabled={moving}
            style={{ padding:'6px 12px', borderRadius:8, border:`1px solid ${STATUS_INFO[quickVerb]?.color||C.line2}`, background:'transparent', color:STATUS_INFO[quickVerb]?.color||C.muted, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
            → {STATUS_INFO[quickVerb]?.label||quickVerb}
          </button>
        )}
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
  const [stats, setStats] = useState({ total:0, needsAction:0, toBill:0, returns:0 });

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
        total: j.length,
        needsAction: j.filter(x=>['new','needs_details','needs_parts','needs_estimate'].includes(x.status)).length,
        toBill: j.filter(x=>['complete','to_bill'].includes(x.status)).length,
        returns: j.filter(x=>x.status==='return_pending').length,
      });
    } catch(e) { console.error(e); }
    setLoading(false);
  }, []);

  const loadTechs = useCallback(async () => {
    try { setTechs(await techsApi.getAll()); } catch(e) { console.warn(e); }
  }, []);

  useEffect(() => { loadJobs(); loadTechs(); }, [loadJobs, loadTechs]);

  const moveStatus = useCallback(async (jobId, newStatus) => {
    setMoving(true);
    try {
      const { error } = await supabase.from('jobs').update({
        status: newStatus,
        updated_by: userEmail||'info@drhsecurityservices.com',
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
      if (error) throw error;
      setJobs(prev => prev.map(j => j.id===jobId ? {...j, status:newStatus} : j));
      setSelectedJob(prev => prev?.id===jobId ? {...prev, status:newStatus} : prev);
      showToast(`→ ${STATUS_INFO[newStatus]?.label||newStatus}`);
    } catch(e) { showToast(`Error: ${e.message}`); }
    setMoving(false);
  }, [userEmail]);

  const quickMove = useCallback(async (job, verb) => moveStatus(job.id, verb), [moveStatus]);

  const handleUUIDLinked = useCallback(customerId => {
    if (!selectedJob) return;
    setJobs(prev => prev.map(j => j.id===selectedJob.id ? {...j, customer_id:customerId} : j));
    setSelectedJob(prev => prev ? {...prev, customer_id:customerId} : prev);
    showToast('Customer linked ✓');
  }, [selectedJob]);

  const handleMerge = useCallback((deadId) => {
    setJobs(prev => prev.map(j => j.id===deadId ? {...j, status:'dead'} : j));
    setSelectedJob(null);
    showToast('Marked as duplicate ✓');
  }, []);

  const filtered = search
    ? jobs.filter(j => (j.customer_name||'').toLowerCase().includes(search.toLowerCase()) || (j.issue||'').toLowerCase().includes(search.toLowerCase()) || (j.cms_account_id||'').toLowerCase().includes(search.toLowerCase()))
    : jobs;

  const buckets = COLUMNS.reduce((acc, col) => {
    acc[col.key] = filtered.filter(j => col.statuses.includes(j.status));
    return acc;
  }, {});

  const activeColDef = COLUMNS.find(c => c.key === activeCol);
  const activeJobs = buckets[activeCol] || [];

  return (
    <div style={{ minHeight:'100vh', background:`radial-gradient(circle at top left,#10213c 0%,${C.bg} 32%,#050912 100%)`, color:C.text, fontFamily:'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif', display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div style={{ position:'sticky', top:0, zIndex:10, background:'rgba(7,17,31,0.97)', backdropFilter:'blur(14px)', borderBottom:`1px solid ${C.line}`, padding:'12px 16px 10px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button onClick={onBack} style={{ background:C.card, border:`1px solid ${C.line2}`, color:C.muted, padding:'7px 12px', borderRadius:10, cursor:'pointer', fontSize:13, fontWeight:700 }}>←</button>
            <span style={{ fontWeight:700, fontSize:17 }}>Board</span>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setShowNewJob(true)} style={{ background:C.green, border:'none', color:'#04130a', padding:'8px 16px', borderRadius:10, cursor:'pointer', fontWeight:900, fontSize:13 }}>+ New</button>
            <button onClick={loadJobs} disabled={loading} style={{ background:C.card, border:`1px solid ${C.line2}`, color:C.muted, padding:'8px 12px', borderRadius:10, cursor:'pointer', fontSize:15 }}>{loading?'…':'↻'}</button>
          </div>
        </div>

        {/* Search */}
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer, issue, CMS…"
          style={{ width:'100%', background:C.card, border:`1px solid ${C.line2}`, color:C.text, borderRadius:12, padding:'10px 13px', fontSize:14, outline:'none', boxSizing:'border-box', marginBottom:10 }} />

        {/* Stat pills */}
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2 }}>
          {[
            {label:'action', val:stats.needsAction, color:C.red},
            {label:'returns', val:stats.returns, color:C.cyan},
            {label:'to bill', val:stats.toBill, color:C.purple},
            {label:'total', val:stats.total, color:C.muted},
          ].map(s => (
            <div key={s.label} style={{ background:C.card, border:`1px solid ${C.line2}`, borderRadius:10, padding:'6px 12px', flexShrink:0 }}>
              <span style={{ fontSize:15, fontWeight:900, color:s.color }}>{s.val}</span>
              <span style={{ fontSize:10, color:C.muted, marginLeft:5 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Column tabs — scrollable, mobile primary nav */}
      <div style={{ background:'rgba(7,17,31,0.95)', borderBottom:`1px solid ${C.line}`, display:'flex', overflowX:'auto', flexShrink:0 }}>
        {COLUMNS.map(col => {
          const count = buckets[col.key]?.length||0;
          const isActive = activeCol === col.key;
          return (
            <button key={col.key} onClick={() => setActiveCol(col.key)}
              style={{ padding:'12px 14px', background:'none', border:'none', borderBottom:`3px solid ${isActive?col.color:'transparent'}`, color:isActive?col.color:C.muted, cursor:'pointer', fontSize:12, fontWeight:isActive?900:500, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
              <span>{col.emoji}</span>
              <span>{col.label}</span>
              <span style={{ background:isActive?col.color:C.line2, color:isActive?'#06101c':C.muted, borderRadius:999, padding:'2px 7px', fontSize:10, fontWeight:900 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Single column view — mobile first */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px', paddingBottom:32 }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:48, color:C.muted, fontSize:14 }}>Loading from Supabase…</div>
        ) : activeJobs.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, color:'#2d3f58', fontSize:14 }}>
            <div style={{ fontSize:32, marginBottom:12 }}>{activeColDef?.emoji}</div>
            <div>Nothing in {activeColDef?.label}</div>
          </div>
        ) : (
          activeJobs.map(j => (
            <JobCard key={j.id} job={j} onSelect={setSelectedJob} onQuickMove={quickMove} moving={moving} />
          ))
        )}
      </div>

      {/* Detail drawer */}
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
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:C.card2, border:`1px solid ${C.line2}`, color:C.text, padding:'12px 22px', borderRadius:14, fontSize:14, fontWeight:600, zIndex:9999, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', whiteSpace:'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
