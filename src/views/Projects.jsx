// ============================================
// Projects — rollup of P-numbered jobs vs logged time
// ============================================
// Each row: P-NNN job → estimate $ (budget), Σ time_entries.total_minutes
// where project_ref = p_number, tech breakdown.
//
// Time entries are linked to a project via time_entries.project_ref, which is
// auto-extracted from the calendar event title at write time
// (services/supabase.js → extractProjectRef). For this to populate, the GCal
// event title must include [P-NNN] (added via "Mark as Project" on the Board).

import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase.js';

const formatMoney = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const formatHours = (mins) => `${(Number(mins || 0) / 60).toFixed(1)}h`;

export default function Projects({ onBack }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { (async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: jobs, error: jobsErr } = await supabase
        .from('jobs')
        .select('id, p_number, s_number, customer_name, customer_address, status, qbo_estimate_status, estimate_amount, invoiced_amount, remaining_amount, created_at')
        .not('p_number', 'is', null)
        .order('p_number', { ascending: false });
      if (jobsErr) throw jobsErr;

      const refs = (jobs || []).map(j => j.p_number).filter(Boolean);
      let entriesByRef = {};
      if (refs.length > 0) {
        const { data: entries, error: teErr } = await supabase
          .from('time_entries')
          .select('id, project_ref, tech_name, tech_email, total_minutes, time_in, event_title, disposition, materials')
          .in('project_ref', refs)
          .order('time_in', { ascending: false });
        if (teErr) throw teErr;
        for (const e of (entries || [])) {
          const k = e.project_ref;
          (entriesByRef[k] = entriesByRef[k] || []).push(e);
        }
      }

      const merged = (jobs || []).map(j => {
        const es = entriesByRef[j.p_number] || [];
        const totalMinutes = es.reduce((s, e) => s + (Number(e.total_minutes) || 0), 0);
        const techs = {};
        for (const e of es) {
          const t = e.tech_name || e.tech_email || 'Unknown';
          techs[t] = (techs[t] || 0) + (Number(e.total_minutes) || 0);
        }
        return { ...j, entries: es, totalMinutes, techs };
      });
      setRows(merged);
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  })(); }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>← Home</button>
          <h2 style={{ margin: 0 }}>🔨 Projects</h2>
        </div>
        <span style={{ color: '#64748b', fontSize: 12 }}>{rows.length} projects</span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>}
        {error && <div style={{ color: '#ef4444', padding: 12, background: '#7f1d1d22', borderRadius: 8 }}>Error: {error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No P-numbered projects yet.</div>
        )}
        {!loading && !error && rows.map(j => {
          const isOpen = expanded === j.id;
          const isTerminal = ['Lost', 'Billed'].includes(j.qbo_estimate_status);
          return (
            <div key={j.id} style={{ background: '#1e293b', borderRadius: 8, padding: 14, borderLeft: '3px solid #22c55e', opacity: isTerminal ? 0.6 : 1 }}>
              <div onClick={() => setExpanded(isOpen ? null : j.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ background: '#1d4ed8', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>{j.p_number}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{j.customer_name || 'Unknown'}</span>
                    {j.qbo_estimate_status && (
                      <span style={{ fontSize: 10, color: '#94a3b8', background: '#33415540', padding: '2px 6px', borderRadius: 4 }}>{j.qbo_estimate_status}</span>
                    )}
                  </div>
                  {j.customer_address && <div style={{ fontSize: 11, color: '#64748b' }}>{j.customer_address}</div>}
                </div>
                <div style={{ textAlign: 'right', minWidth: 140 }}>
                  <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>{formatMoney(j.estimate_amount)} budget</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{formatHours(j.totalMinutes)} logged · {j.entries.length} entr{j.entries.length === 1 ? 'y' : 'ies'}</div>
                </div>
              </div>
              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #334155' }}>
                  {Object.keys(j.techs).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      {Object.entries(j.techs).map(([t, m]) => (
                        <span key={t} style={{ fontSize: 11, color: '#cbd5e1', background: '#33415560', padding: '3px 8px', borderRadius: 4 }}>
                          {t}: {formatHours(m)}
                        </span>
                      ))}
                    </div>
                  )}
                  {j.entries.length === 0 && <div style={{ color: '#64748b', fontSize: 12, fontStyle: 'italic' }}>No time entries logged yet.</div>}
                  {j.entries.map(e => (
                    <div key={e.id} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#cbd5e1' }}>{e.tech_name || e.tech_email?.split('@')[0] || 'Unknown'} · {formatHours(e.total_minutes)}</span>
                        <span style={{ color: '#64748b' }}>{e.time_in ? new Date(e.time_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                      </div>
                      {e.event_title && <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{e.event_title}</div>}
                      {e.disposition && <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>→ {e.disposition}</div>}
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
