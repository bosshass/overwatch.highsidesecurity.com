// ============================================
// JUC-E V6 — Gap Report (Admin Only)
// ============================================
// Access: ?view=gap or bookmark /gap
// Operator-only. Not in nav. Sara's reconciliation tool.
// Reads V6 jobs table from Supabase.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

const STATUS_FLOW = [
  'accepted', 'parts_ordered', 'scheduled', 'in_progress',
  'completed', 'invoiced', 'collected', 'on_hold'
];

const STATUS_LABELS = {
  accepted: 'Accepted',
  parts_ordered: 'Parts Ordered',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  invoiced: 'Invoiced',
  collected: 'Collected',
  on_hold: 'On Hold',
};

const PRIORITY = {
  RED:    { bg: '#2d1416', border: '#ef4444', text: '#fca5a5', label: 'No calendar link' },
  ORANGE: { bg: '#2d1f0e', border: '#f97316', text: '#fdba74', label: 'Needs invoice' },
  YELLOW: { bg: '#2d2a0e', border: '#eab308', text: '#fde047', label: 'Awaiting payment' },
  GREEN:  { bg: '#0d2818', border: '#22c55e', text: '#86efac', label: 'On track' },
};

function getPriority(job) {
  if (job.remaining_amount > 0 && !job.calendar_event_id) return 'RED';
  if (job.status === 'completed' && !job.invoice_id) return 'ORANGE';
  if (job.invoice_id && !job.collected_at) return 'YELLOW';
  return 'GREEN';
}

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

export default function AdminGap({ onBack }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [qboFilter, setQboFilter] = useState('all');
  const [expandedJob, setExpandedJob] = useState(null);
  const [saving, setSaving] = useState(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .gt('remaining_amount', 0)
      .order('remaining_amount', { ascending: false });
    if (!error && data) {
      setJobs(data.map(j => ({ ...j, _p: getPriority(j) })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const filtered = jobs.filter(j => {
    if (filter !== 'all' && j._p !== filter) return false;
    if (qboFilter !== 'all' && j.qbo_estimate_status !== qboFilter) return false;
    return true;
  });

  const byPriority = (key) => jobs.filter(j => j._p === key);
  const sumRemaining = (arr) => arr.reduce((s, j) => s + (j.remaining_amount || 0), 0);

  const updateJob = async (id, updates) => {
    setSaving(id);
    const { error } = await supabase.from('jobs').update(updates).eq('id', id);
    if (!error) {
      setJobs(prev => prev.map(j =>
        j.id === id ? { ...j, ...updates, _p: getPriority({ ...j, ...updates }) } : j
      ));
    }
    setSaving(null);
  };

  // ── RENDER ──────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={S.backBtn}>← Back</button>
          <div>
            <h1 style={S.h1}>Gap Report</h1>
            <p style={S.sub}>{jobs.length} jobs · {fmt(sumRemaining(jobs))} remaining</p>
          </div>
        </div>
        <button onClick={fetchJobs} style={S.refreshBtn} disabled={loading}>
          {loading ? '⟳ ...' : '⟳ Refresh'}
        </button>
      </div>

      {/* STAT CARDS */}
      <div style={S.statRow}>
        {[
          { key: 'RED', label: 'Dead Money' },
          { key: 'ORANGE', label: 'Needs Invoice' },
          { key: 'YELLOW', label: 'Awaiting Pay' },
          { key: 'GREEN', label: 'On Track' },
        ].map(({ key, label }) => {
          const pJobs = byPriority(key);
          const pc = PRIORITY[key];
          return (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? 'all' : key)}
              style={{
                ...S.statCard,
                borderColor: pc.border,
                background: filter === key ? pc.bg : '#1a1f2e',
                opacity: filter !== 'all' && filter !== key ? 0.4 : 1,
              }}
            >
              <div style={{ color: pc.text, fontSize: 20, fontWeight: 700, fontFamily: 'monospace' }}>
                {fmt(sumRemaining(pJobs))}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                {pJobs.length} {label}
              </div>
            </button>
          );
        })}
      </div>

      {/* QBO FILTER */}
      <div style={S.filterRow}>
        {['all', 'Accepted', 'Pending', 'Closed'].map(f => (
          <button
            key={f}
            onClick={() => setQboFilter(f)}
            style={{
              ...S.pill,
              ...(qboFilter === f ? { background: '#00c8e8', color: '#0f1729', borderColor: '#00c8e8' } : {}),
            }}
          >
            {f === 'all' ? 'All QBO' : f}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>{filtered.length} showing</span>
      </div>

      {/* TABLE */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              {['', 'Est #', 'Customer', 'Remaining', 'QBO', 'Pipeline', 'Calendar', ''].map((h, i) => (
                <th key={i} style={{ ...S.th, textAlign: h === 'Remaining' ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(job => (
              <JobRow
                key={job.id}
                job={job}
                expanded={expandedJob === job.id}
                onExpand={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                onUpdate={updateJob}
                saving={saving === job.id}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>No jobs match filters</div>
        )}
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading...</div>
        )}
      </div>
    </div>
  );
}

// ─── JOB ROW ─────────────────────────────────────────────────
function JobRow({ job, expanded, onExpand, onUpdate, saving }) {
  const pc = PRIORITY[job._p];
  const [linkMode, setLinkMode] = useState(false);
  const [calSummary, setCalSummary] = useState('');
  const [calDate, setCalDate] = useState('');

  const handleLink = () => {
    if (calSummary && calDate) {
      onUpdate(job.id, {
        calendar_event_id: `manual-${Date.now()}`,
        calendar_summary: calSummary,
        scheduled_date: calDate,
        status: 'scheduled',
      });
      setLinkMode(false);
      setCalSummary('');
      setCalDate('');
    }
  };

  return (
    <>
      <tr onClick={onExpand} style={{ ...S.tr, background: expanded ? pc.bg : 'transparent', cursor: 'pointer' }}>
        <td style={S.td}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: pc.border }} />
        </td>
        <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 600, color: '#e2e8f0' }}>{job.qbo_estimate_id}</td>
        <td style={{ ...S.td, fontWeight: 500, color: '#e2e8f0', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.customer_name}
        </td>
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: pc.text }}>
          {fmt(job.remaining_amount)}
        </td>
        <td style={S.td}>
          <span style={S.badge}>{job.qbo_estimate_status || '—'}</span>
        </td>
        <td style={S.td}>
          <select
            value={job.status}
            onClick={e => e.stopPropagation()}
            onChange={e => onUpdate(job.id, { status: e.target.value })}
            style={S.select}
            disabled={saving}
          >
            {STATUS_FLOW.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </td>
        <td style={S.td}>
          {job.calendar_event_id ? (
            <span style={{ color: '#86efac', fontSize: 12 }}>✓ {(job.calendar_summary || 'Linked').substring(0, 18)}</span>
          ) : (
            <button onClick={e => { e.stopPropagation(); setLinkMode(!linkMode); onExpand(); }} style={S.linkBtn}>+ Link</button>
          )}
        </td>
        <td style={S.td}>{saving && <span style={{ color: '#64748b', fontSize: 11 }}>saving...</span>}</td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={8} style={{ padding: 0, background: '#111827', borderBottom: '2px solid #1e293b' }}>
            <div style={S.detailGrid}>
              {/* MONEY */}
              <div>
                <div style={S.dLabel}>Estimate</div>
                <div style={S.dVal}>{fmt(job.estimate_amount)}</div>
                <div style={S.dLabel}>Invoiced</div>
                <div style={S.dVal}>{fmt(job.invoiced_amount)}</div>
                <div style={S.dLabel}>Remaining</div>
                <div style={{ ...S.dVal, color: pc.text, fontWeight: 700 }}>{fmt(job.remaining_amount)}</div>
              </div>

              {/* CHECKLIST */}
              <div>
                <div style={S.dLabel}>Activation Checklist</div>
                {[
                  ['parts_ordered', 'Parts ordered'],
                  ['parts_received', 'Parts received'],
                  ['customer_confirmed', 'Customer confirmed'],
                  ['sub_required', 'Sub required'],
                  ['deposit_invoiced', 'Deposit invoiced'],
                ].map(([field, label]) => (
                  <label key={field} style={S.check} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={job[field] || false}
                      onChange={() => onUpdate(job.id, { [field]: !job[field] })}
                    />
                    <span style={{ opacity: job[field] ? 0.5 : 1, textDecoration: job[field] ? 'line-through' : 'none' }}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>

              {/* TECH + NOTES */}
              <div>
                <div style={S.dLabel}>Tech</div>
                <select
                  value={job.tech_name || ''}
                  onChange={e => onUpdate(job.id, { tech_name: e.target.value || null })}
                  onClick={e => e.stopPropagation()}
                  style={S.select}
                >
                  <option value="">Unassigned</option>
                  <option value="Austin">Austin</option>
                  <option value="JR">JR</option>
                  <option value="Shana">Shana</option>
                  <option value="Sara">Sara</option>
                </select>
                <div style={{ ...S.dLabel, marginTop: 12 }}>Notes</div>
                <textarea
                  defaultValue={job.notes || ''}
                  onBlur={e => {
                    if (e.target.value !== (job.notes || '')) onUpdate(job.id, { notes: e.target.value });
                  }}
                  onClick={e => e.stopPropagation()}
                  style={S.textarea}
                  rows={3}
                  placeholder="Job notes..."
                />
              </div>

              {/* LINK FORM */}
              {linkMode && (
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #1e293b', paddingTop: 12 }}>
                  <div style={S.dLabel}>Link to Calendar Event</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    <input
                      type="text" placeholder="Event title (e.g. Vinyard Church - Install)"
                      value={calSummary} onChange={e => setCalSummary(e.target.value)}
                      onClick={e => e.stopPropagation()} style={S.input}
                    />
                    <input
                      type="date" value={calDate} onChange={e => setCalDate(e.target.value)}
                      onClick={e => e.stopPropagation()} style={{ ...S.input, flex: '0 0 160px' }}
                    />
                    <button onClick={handleLink} style={S.submitBtn}>Link It</button>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── STYLES (dark theme, matches V5) ────────────────────────
const S = {
  page: { maxWidth: 1280, margin: '0 auto', padding: '16px 16px 80px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#e2e8f0', fontSize: 14, minHeight: '100vh', background: '#0f1729' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  h1: { fontSize: 20, fontWeight: 700, margin: 0, color: '#00c8e8' },
  sub: { color: '#64748b', fontSize: 12, margin: '2px 0 0' },
  backBtn: { background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '4px 0' },
  refreshBtn: { padding: '8px 14px', border: '1px solid #334155', borderRadius: 6, background: '#1a1f2e', color: '#94a3b8', cursor: 'pointer', fontSize: 13 },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 },
  statCard: { padding: '12px 14px', borderRadius: 8, border: '2px solid', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' },
  filterRow: { display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' },
  pill: { padding: '4px 12px', border: '1px solid #334155', borderRadius: 4, background: '#1a1f2e', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 500 },
  tableWrap: { border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '10px 12px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', borderBottom: '2px solid #1e293b', background: '#111827' },
  tr: { borderBottom: '1px solid #1e293b', transition: 'background 0.1s' },
  td: { padding: '10px 12px', verticalAlign: 'middle', color: '#94a3b8' },
  badge: { padding: '2px 8px', borderRadius: 3, background: '#1e293b', fontSize: 11, color: '#94a3b8' },
  select: { padding: '4px 8px', border: '1px solid #334155', borderRadius: 4, fontSize: 12, background: '#1a1f2e', color: '#e2e8f0', cursor: 'pointer' },
  linkBtn: { padding: '3px 10px', border: '1px dashed #475569', borderRadius: 4, background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#64748b' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, padding: '16px 20px' },
  dLabel: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: 4 },
  dVal: { fontSize: 15, fontFamily: 'monospace', color: '#e2e8f0', marginBottom: 8 },
  check: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer', fontSize: 13, color: '#94a3b8' },
  textarea: { width: '100%', padding: 8, border: '1px solid #334155', borderRadius: 4, fontSize: 13, fontFamily: 'inherit', background: '#1a1f2e', color: '#e2e8f0', resize: 'vertical', boxSizing: 'border-box' },
  input: { padding: '6px 10px', border: '1px solid #334155', borderRadius: 4, fontSize: 13, background: '#1a1f2e', color: '#e2e8f0', flex: '1 1 200px' },
  submitBtn: { padding: '6px 16px', border: 'none', borderRadius: 4, background: '#00c8e8', color: '#0f1729', cursor: 'pointer', fontSize: 13, fontWeight: 700 },
};
