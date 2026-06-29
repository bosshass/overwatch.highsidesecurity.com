// ============================================
// Overwatch — FieldVisits (board-card field report)
// ============================================
// Surfaces the tech's actual work on the Board card. The board reads jobs +
// job_history, which only receives a stub note on disposition ("bill_it
// disposition from Work Today"). The real substance — notes, materials, hours,
// disposition — lives in time_entries, which the board never read until now.
// Match is by calendar_event_id (the adopt-on-disposition link); falls back to
// customer_id so customers logged before adoption still surface.

import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
function hoursFromMin(min) {
  if (min == null) return null;
  const h = Number(min) / 60;
  if (!isFinite(h)) return null;
  return `${h.toFixed(1)}h`;
}
const DISPO = {
  bill_it:     { label: 'Bill it',     color: '#22c55e' },
  return:      { label: 'Return',      color: '#f97316' },
  estimate:    { label: 'Estimate',    color: '#3b82f6' },
  in_progress: { label: 'In progress', color: '#00c8e8' },
};
function dispo(d) {
  return DISPO[d] || { label: (d || '—').replace(/_/g, ' '), color: '#64748b' };
}

const FIELDS =
  'id, event_title, event_start, tech_name, total_minutes, disposition, materials, notes, customer_name_raw, registry_id, calendar_event_id';

export default function FieldVisits({ job }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let rows = [];
      try {
        // primary: the calendar event this job was adopted from
        if (job?.calendar_event_id) {
          const r = await supabase.from('time_entries').select(FIELDS)
            .eq('calendar_event_id', job.calendar_event_id)
            .order('event_start', { ascending: false });
          if (!r.error) rows = r.data || [];
        }
        // fallback: same customer, if nothing matched on the event
        if (rows.length === 0 && job?.customer_id) {
          const r = await supabase.from('time_entries').select(FIELDS)
            .eq('customer_id', job.customer_id)
            .order('event_start', { ascending: false })
            .limit(10);
          if (!r.error) rows = r.data || [];
        }
      } catch { /* leave rows empty */ }
      if (!cancelled) { setEntries(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [job?.calendar_event_id, job?.customer_id]);

  // Don't clutter non-field jobs: render nothing if there's nothing to show
  // and this job never came from a calendar event.
  if (loading) return null;
  if (entries.length === 0 && !job?.calendar_event_id) return null;

  const wrap   = { marginBottom: 16 };
  const header = { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 };
  const card   = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };

  return (
    <div style={wrap}>
      <div style={header}>
        <span>🔧 Field visits</span>
        <span style={{ color: '#475569', fontWeight: 600 }}>({entries.length})</span>
      </div>

      {entries.length === 0 && (
        <div style={{ color: '#475569', fontSize: 13, fontStyle: 'italic' }}>
          No field visit logged yet — tech hasn’t dispositioned this from Work Today.
        </div>
      )}

      {entries.map(e => {
        const d = dispo(e.disposition);
        return (
          <div key={e.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', marginBottom: e.materials || e.notes ? 8 : 0 }}>
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
    </div>
  );
}
