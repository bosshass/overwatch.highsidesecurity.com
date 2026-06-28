// ============================================
// Billing — jobs-table based (NakedPM)
// ============================================
// Reads the JOBS table by status (no calendar-tag scanning, no split brain).
// Tabs: To Bill · Estimate Needed · Estimate Sent · Won
// Triage + Return buckets removed (those live on the Board, not Billing).
// Every card shows its notes/issue until the job is marked billed.
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { supabase, STATUS_INFO, JOB_STATUS, notesApi } from '../services/supabase.js';

const TABS = [
  { key: 'to_bill',        label: 'To Bill',         emoji: '💵', color: '#8b5cf6', statuses: ['to_bill'] },
  { key: 'needs_estimate', label: 'Estimate Needed', emoji: '📋', color: '#f59e0b', statuses: ['needs_estimate'] },
  { key: 'estimate_sent',  label: 'Estimate Sent',   emoji: '📤', color: '#06b6d4', statuses: ['estimate_sent'] },
  { key: 'won',            label: 'Won',             emoji: '🎉', color: '#22c55e', statuses: ['won'] },
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

// One billing card. Shows notes/issue until the job is billed.
function BillingCard({ job, onMarkBilled, onAddNote, busy }) {
  const [open, setOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const si = STATUS_INFO[job.status] || {};
  const isBilled = job.status === 'billed';

  const addNote = async () => {
    const t = noteText.trim();
    if (!t) return;
    setSavingNote(true);
    try { await onAddNote(job.id, t); setNoteText(''); } finally { setSavingNote(false); }
  };

  return (
    <div style={{ background:'#1e293b', borderRadius:10, padding:14, marginBottom:10, border:`1px solid ${si.color||'#334155'}30` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#fff', fontSize:15, fontWeight:600 }}>{job.customer_name || '—'}</div>
          <div style={{ color:'#64748b', fontSize:11, marginTop:2 }}>
            {job.cms_account_id ? `CMS ${job.cms_account_id} · ` : ''}{fmtDate(job.created_at)}
            {job.p_number ? ` · ${job.p_number}` : ''}
          </div>
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

      {/* Notes / issue — visible until billed */}
      {!isBilled && (job.issue || job.notes || job.completion_notes) && (
        <div style={{ marginTop:10, background:'#0f172a', borderRadius:8, padding:10 }}>
          <div style={{ color:'#475569', fontSize:9, textTransform:'uppercase', letterSpacing:0.4, marginBottom:4 }}>notes</div>
          {job.issue && <div style={{ color:'#cbd5e1', fontSize:12, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{job.issue}</div>}
          {job.completion_notes && <div style={{ color:'#94a3b8', fontSize:12, whiteSpace:'pre-wrap', lineHeight:1.5, marginTop:6 }}>✓ {job.completion_notes}</div>}
          {job.notes && <div style={{ color:'#94a3b8', fontSize:12, whiteSpace:'pre-wrap', lineHeight:1.5, marginTop:6 }}>{job.notes}</div>}
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ padding:'6px 12px', borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#94a3b8', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          {open ? 'Close note' : '+ Note'}
        </button>
        {job.status === 'to_bill' && (
          <button onClick={() => onMarkBilled(job.id)} disabled={busy}
            style={{ padding:'6px 14px', borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            💰 Mark Billed
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop:8 }}>
          <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} placeholder="Add a note…"
            style={{ width:'100%', padding:8, borderRadius:6, border:'1px solid #334155', background:'#0f172a', color:'#fff', fontSize:12, fontFamily:'inherit', boxSizing:'border-box', resize:'vertical' }} />
          <button onClick={addNote} disabled={savingNote||!noteText.trim()}
            style={{ marginTop:6, padding:'6px 14px', borderRadius:6, border:'none', background:noteText.trim()?'#3b82f6':'#334155', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            {savingNote ? 'Saving…' : 'Add note'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Billing({ accessToken, onBack }) {
  const [tab, setTab] = useState('to_bill');
  const [jobs, setJobs] = useState([]);
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
      setJobs(data || []);
    } catch (e) {
      console.error('Billing load error:', e);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  const markBilled = async (jobId) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('jobs')
        .update({ status: 'billed', billed_at: new Date().toISOString() })
        .eq('id', jobId);
      if (error) throw error;
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (e) {
      alert('Could not mark billed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (jobId, text) => {
    try { await notesApi.addNote(jobId, text, 'billing'); }
    catch (e) { alert('Could not add note: ' + e.message); }
  };

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
            <BillingCard key={job.id} job={job} onMarkBilled={markBilled} onAddNote={addNote} busy={busy} />
          ))
        )}
      </div>
    </div>
  );
}
