// ── THE merge tool. One button, every surface. ───────────────────────────────
// Board drawer, /j/ short links, Customer Audit and the job-detail screen all
// render this — there is no second merge UI. (JobDetail used to carry its own
// "Merge & Archive" modal that condensed the card into one note.)
//
// Candidates come from the database, not from whatever list the host screen
// happens to hold: the board only holds active lanes, so the second tech's
// card for the same customer — already in Billed, say — could not be found
// and the two cards could not be merged. Same customer (by id) is found even
// when the cards are named differently; same customer + same day ranks first.
import { useState, useEffect } from 'react';
import { supabase, STATUS_INFO } from '../services/supabase.js';
import { mergeJobs } from '../services/mergeJobs.js';

const fmtDay = iso => {
  if (!iso) return '';
  const d = new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const FIELDS = 'id, customer_id, customer_name, status, issue, tech_name, assigned_to, scheduled_date, created_at';

export function MergeTool({ job, allJobs = null, onMerge, accessToken, userEmail }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(job.customer_name || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [sameCustomer, setSameCustomer] = useState([]);
  const [byName, setByName] = useState([]);
  const [mergePending, setMergePending] = useState(null); // survivorId awaiting confirm

  // Every live card for this customer, whatever lane — billed included.
  useEffect(() => {
    if (!open || !job.customer_id) return;
    supabase.from('jobs').select(FIELDS)
      .eq('customer_id', job.customer_id).neq('id', job.id)
      .not('status', 'in', '(dead,archived)')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setSameCustomer(data || []));
  }, [open, job.customer_id, job.id]);

  // Typed search, for cards that were never linked to the customer.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setByName([]); return; }
    const t = setTimeout(() => {
      supabase.from('jobs').select(FIELDS)
        .ilike('customer_name', `%${q.split(/\s+/)[0]}%`).neq('id', job.id)
        .not('status', 'in', '(dead,archived)')
        .order('created_at', { ascending: false }).limit(30)
        .then(({ data }) => setByName(data || []));
    }, 250);
    return () => clearTimeout(t);
  }, [open, query, job.id]);

  const sameDay = c => job.scheduled_date && c.scheduled_date
    && String(c.scheduled_date).slice(0, 10) === String(job.scheduled_date).slice(0, 10);
  const seen = new Set();
  const candidates = [...sameCustomer, ...byName]
    .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => (sameDay(b) - sameDay(a))
      || ((b.customer_id === job.customer_id) - (a.customer_id === job.customer_id)))
    .slice(0, 15);
  const pool = candidates;

  const merge = async (survivorId, confirmed = false) => {
    if (!confirmed) { setMergePending(survivorId); return; }
    setSaving(true);
    setErr('');
    try {
      // One merge for every surface — see services/mergeJobs.js. It moves the
      // hours, tasks, return cards and texts, carries every note with its
      // original date, and only kills this card once all of that landed.
      const res = await mergeJobs({ deadJobId: job.id, survivorId, by: userEmail || 'board', accessToken });
      onMerge(job.id, res.survivorId);
      setOpen(false);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width:'100%', padding:'7px 12px', borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#cbd5e1', fontSize:11, cursor:'pointer', textAlign:'left', marginBottom:8 }}>
      🔁 merge into another card
    </button>
  );

  return (
    <div style={{ background:'#0f172a', borderRadius:8, padding:12, marginBottom:12, border:'1px solid #334155' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>find duplicate to merge into</span>
        <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:14 }}>✕</button>
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="search by customer name…"
        style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #334155', background:'#1e293b', color:'#fff', fontSize:13, boxSizing:'border-box', marginBottom:8 }} />
      {candidates.length === 0
        ? <div style={{ color:'#94a3b8', fontSize:12, padding:'8px 0' }}>no matches found</div>
        : candidates.map(c => {
          const si = STATUS_INFO[c.status] || {};
          return (
            <button key={c.id} onClick={() => merge(c.id)} disabled={saving}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', background:'#1e293b', border:'0.5px solid #334155', borderRadius:6, color:'#fff', fontSize:12, cursor:'pointer', marginBottom:4 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontWeight:600 }}>{c.customer_name}</span>
                <span style={{ fontSize:11, color:si.color||'#64748b' }}>{si.label||c.status}</span>
              </div>
              <div style={{ fontSize:11, color:'#cbd5e1', marginTop:2 }}>
                {sameDay(c) ? '📅 same day · ' : ''}{c.tech_name ? `${c.tech_name} · ` : ''}{c.issue?.slice(0,60) || 'no issue'} · {fmtDay(c.scheduled_date || c.created_at)}
              </div>
            </button>
          );
        })
      }
      {mergePending && (() => {
        const survivor = pool.find(j => j.id === mergePending);
        return (
          <div style={{ background:'#1e293b', border:'1px solid #f59e0b', borderRadius:8, padding:12, marginTop:8 }}>
            <div style={{ fontSize:12, color:'#fde68a', marginBottom:10, lineHeight:1.5 }}>
              Merge into <b>{survivor?.customer_name || mergePending}</b>? Everything on this card comes along — every note with its original date, all hours, tasks, return cards and texts. Nothing is condensed. This card is then stored on the customer's history as merged — not deleted.
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => { setMergePending(null); merge(mergePending, true); }}
                style={{ background:'#ef4444', border:'none', borderRadius:6, color:'#fff', padding:'6px 14px', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                Yes, merge
              </button>
              <button onClick={() => setMergePending(null)}
                style={{ background:'transparent', border:'1px solid #334155', borderRadius:6, color:'#94a3b8', padding:'6px 12px', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}
      {err && <div style={{ color:'#ef4444', fontSize:11, marginTop:6 }}>{err}</div>}
    </div>
  );
}


export default MergeTool;
