import { useState } from 'react';
import { supabase } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

export default function SchedulerModal({ job, techs, accessToken, onScheduled, onClose }) {
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
