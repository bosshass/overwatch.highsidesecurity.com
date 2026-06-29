// ============================================
// Overwatch — FieldVisits (board-card field history)
// ============================================
// The board reads jobs + job_history, which only gets a stub note on
// disposition. The real field comments live in time_entries. This pulls the
// FULL field history for the job's customer — every visit, not just the one
// event this job was adopted from — and shows each with its complete note,
// materials, hours, tech, and disposition. Collapses behind a "view all" link.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function hoursFromMin(min) {
  if (min == null) return null;
  const h = Number(min) / 60;
  return isFinite(h) ? `${h.toFixed(1)}h` : null;
}
const DISPO = {
  bill_it:     { label: 'Bill it',     color: '#22c55e' },
  return:      { label: 'Return',      color: '#f97316' },
  estimate:    { label: 'Estimate',    color: '#3b82f6' },
  in_progress: { label: 'In progress', color: '#00c8e8' },
};
const dispo = d => DISPO[d] || { label: (d || '—').replace(/_/g, ' '), color: '#64748b' };

const FIELDS =
  'id, event_title, event_start, tech_name, total_minutes, disposition, materials, notes, customer_name_raw, registry_id, calendar_event_id, customer_id, created_at';

const PREVIEW = 3; // rows shown before "view all"

export default function FieldVisits({ job }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setShowAll(false);
      const byId = {};
      try {
        // 1) this job's exact calendar event
        if (job?.calendar_event_id) {
          const r = await supabase.from('time_entries').select(FIELDS)
            .eq('calendar_event_id', job.calendar_event_id);
          if (!r.error) for (const row of (r.data || [])) byId[row.id] = row;
        }
        // 2) EVERY other visit for the same customer (the full field history)
        if (job?.customer_id) {
          const r = await supabase.from('time_entries').select(FIELDS)
            .eq('customer_id', job.customer_id).limit(100);
          if (!r.error) for (const row of (r.data || [])) byId[row.id] = row;
        }
      } catch { /* leave what we have */ }
      const rows = Object.values(byId).sort(
        (a, b) => new Date(b.event_start || b.created_at) - new Date(a.event_start || a.created_at)
      );
      if (!cancelled) { setEntries(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [job?.calendar_event_id, job?.customer_id]);

  const shown = useMemo(() => (showAll ? entries : entries.slice(0, PREVIEW)), [entries, showAll]);

  if (loading) return null;
  if (entries.length === 0 && !job?.calendar_event_id) return null;

  const wrap   = { marginBottom: 16 };
  const header = { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 };
  const card   = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };

  return (
    <div style={wrap}>
      <div style={header}>
        <span>🔧 Field history</span>
        <span style={{ color: '#475569', fontWeight: 600 }}>({entries.length})</span>
      </div>

      {entries.length === 0 && (
        <div style={{ color: '#475569', fontSize: 13, fontStyle: 'italic' }}>
          No field visit logged yet — tech hasn’t dispositioned this from Work Today.
        </div>
      )}

      {shown.map(e => {
        const d = dispo(e.disposition);
        return (
          <div key={e.id} style={card}>
            {e.event_title && <div style={{ fontWeight: 700, fontSize: 13.5, color: '#e2e8f0', marginBottom: 6 }}>{e.event_title}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', marginBottom: (e.materials || e.notes) ? 8 : 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${d.color}20`, color: d.color, border: `1px solid ${d.color}40` }}>{d.label}</span>
              {e.tech_name && <span>👷 {e.tech_name}</span>}
              {e.event_start && <span>📅 {fmtDateTime(e.event_start)}</span>}
              {hoursFromMin(e.total_minutes) && <span>⏱ {hoursFromMin(e.total_minutes)}</span>}
              {e.registry_id && <span style={{ color: '#00c8e8', fontWeight: 700 }}>{e.registry_id}</span>}
            </div>
            {e.materials && <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 4 }}>🔧 {e.materials}</div>}
            {e.notes && <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{e.notes}</div>}
          </div>
        );
      })}

      {entries.length > PREVIEW && (
        <button onClick={() => setShowAll(v => !v)} style={{ background: 'none', border: 'none', color: '#00c8e8', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '2px 0', textDecoration: 'underline' }}>
          {showAll ? 'Show less' : `View all ${entries.length} visits →`}
        </button>
      )}
    </div>
  );
}
