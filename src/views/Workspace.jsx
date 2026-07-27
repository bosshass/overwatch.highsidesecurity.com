// ============================================
// Workspace — role-based views over the same data
// ============================================
// The board grew to 6 lanes and 17 statuses. Shana stopped opening it and went
// back to her spreadsheet; JR can't find the rollup he wants. This is the fix
// agreed in the July 26 concept mockup (overwatch-workspaces-concept.html):
//
//   ONE component, THREE configs. Not three builds.
//
// Nothing here is a new data model. Every lane is a filter over the same
// `jobs` rows /board already reads. Anything scheduled from here goes through
// VisualSchedulerModal, the same path /board uses — so the calendar write, the
// [SCHEDULED] tag, and the scheduled_event_id stamp are all identical.
//
// WHAT EACH CONFIG SEES
//   shana — To Do / Doing / Done. Execution. Schedule button on ready work.
//   sara  — same three lanes, oversight framing, plus her own sales pipeline.
//   jr    — rollup + "viewing as" switcher (Phase 2 — config is stubbed below).
//
// Tech view is deliberately untouched. TechWorkToday stays exactly as it is.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, techsApi } from '../services/supabase.js';
import { ageLabel } from '../utils/staleness.js';
import VisualSchedulerModal from '../components/VisualSchedulerModal.jsx';
import NewJobModal from '../components/NewJobModal.jsx';

// ── Lane definitions ─────────────────────────────────────────────────
// Three lanes, not six. Every active status maps into exactly one of them,
// so nothing can hide between columns the way it does on the current board.
const LANES = [
  {
    key: 'todo',
    label: 'To Do',
    hint: 'Ready, returns, won estimates, parts in',
    color: '#f59e0b',
    // Shana's To Do is not "everything that isn't scheduled." It is the work
    // where SHE is the next action: something is ready to go on the calendar,
    // a return has to be booked, an estimate came back won, or parts landed
    // and the job can finally move. Triage, blocked and needs-estimate are
    // somebody else's decision and were only ever noise in her column.
    statuses: ['ready_to_schedule', 'return_pending', 'won', 'needs_parts', 'pending_materials'],
  },
  {
    key: 'doing',
    label: 'Doing',
    hint: 'On the calendar or in progress',
    color: '#3b82f6',
    statuses: ['scheduled', 'return_pending'],
  },
  {
    key: 'done',
    label: 'Done',
    hint: 'Finished — billing handles it from here',
    color: '#22c55e',
    statuses: ['complete', 'to_bill', 'billed'],
    // Done is a receipt, not an archive. Anything older than this drops off
    // so the lane doesn't become the 500-row graveyard the old board became.
    withinDays: 14,
  },
];

// Statuses where scheduling is the actual next action — these cards get the
// Schedule button. Everything else needs a decision first, not a slot.
const SCHEDULABLE = ['ready_to_schedule', 'won', 'return_pending'];

// Short human labels. The raw status strings are database values, not English.
const STATUS_LABEL = {
  new: 'New', needs_details: 'Needs details', needs_parts: 'Needs parts',
  pending_materials: 'Waiting on materials', pending_decision: 'Waiting on customer',
  blocked: 'Blocked', needs_estimate: 'Needs estimate', estimate_sent: 'Estimate sent',
  won: 'Won', ready_to_schedule: 'Ready to schedule', scheduled: 'Scheduled',
  return_pending: 'Return needed', complete: 'Complete', to_bill: 'To bill', billed: 'Billed',
};

const STATUS_COLOR = {
  new: '#ef4444', needs_details: '#ef4444', needs_parts: '#f97316',
  pending_materials: '#f97316', pending_decision: '#f97316', blocked: '#dc2626',
  needs_estimate: '#f59e0b', estimate_sent: '#06b6d4', won: '#22c55e',
  ready_to_schedule: '#22c55e', scheduled: '#3b82f6', return_pending: '#8b5cf6',
  complete: '#22c55e', to_bill: '#22c55e', billed: '#64748b',
};

// ── Workspace configs ────────────────────────────────────────────────
// Adding a person is adding an object here. It is not a new screen.
const WORKSPACES = {
  shana: {
    title: 'Shana',
    subtitle: 'Scheduling',
    lanes: LANES,
    canSchedule: true,
    // Shana works everything — no owner filter. If that changes later,
    // set `filter: j => j.assigned_to === 'Shana'` and nothing else moves.
    filter: null,
    pipeline: false,
  },
  sara: {
    title: 'Sara',
    subtitle: 'Oversight + pipeline',
    lanes: LANES,
    canSchedule: true,
    filter: null,
    pipeline: true, // adds the estimates-out section below the lanes
  },
  jr: {
    title: 'JR',
    subtitle: 'Business rollup',
    lanes: LANES,
    canSchedule: true,
    filter: null,
    pipeline: false,
    // Phase 2: the "viewing as" switcher renders above the lanes and swaps
    // `config` to shana / austin without remounting anything.
    rollup: true,
  },
};

const BG = '#0f1729', SURFACE = '#1e293b', LINE = '#334155';
const TEXT = '#e2e8f0', MUTED = '#94a3b8';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export default function Workspace({ accessToken, userEmail, userName }) {
  const navigate = useNavigate();
  const { who } = useParams();

  // Default to whoever is signed in; fall back to Shana's config.
  const key = (who || userName || '').toLowerCase();
  const config = WORKSPACES[key] || WORKSPACES.shana;

  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schedulingJob, setSchedulingJob] = useState(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const allStatuses = [...new Set(config.lanes.flatMap(l => l.statuses))];
      const { data, error } = await supabase
        .from('jobs').select('*')
        .in('status', allStatuses)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setJobs(data || []);
    } catch (e) {
      console.error('Workspace load:', e);
    }
    setLoading(false);
  }, [JSON.stringify(config.lanes.map(l => l.key))]);

  const loadTechs = useCallback(async () => {
    try { setTechs(await techsApi.getAll()); }
    catch (e) {
      // techsApi filters on is_active; fall back to the raw table so a missing
      // flag never leaves the scheduler with zero techs to offer.
      const { data } = await supabase.from('techs').select('*').order('name');
      setTechs(data || []);
    }
  }, []);

  useEffect(() => { load(); loadTechs(); }, [load, loadTechs]);

  const byLane = useMemo(() => {
    const cutoffs = {};
    config.lanes.forEach(l => { if (l.withinDays) cutoffs[l.key] = daysAgo(l.withinDays); });
    const q = query.trim().toLowerCase();

    return config.lanes.map(lane => {
      let rows = jobs.filter(j => lane.statuses.includes(j.status));
      if (cutoffs[lane.key]) {
        rows = rows.filter(j => (j.updated_at || j.created_at) >= cutoffs[lane.key]);
      }
      if (config.filter) rows = rows.filter(config.filter);
      if (q) {
        rows = rows.filter(j =>
          `${j.customer_name || ''} ${j.issue || ''} ${j.job_number || ''} ${j.tech_name || ''}`
            .toLowerCase().includes(q)
        );
      }
      // Oldest first inside a lane — the thing that has been waiting longest
      // is the thing that should get looked at, not the newest shiny card.
      rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return { ...lane, rows };
    });
  }, [jobs, config, query]);

  const openJob = (job) => navigate(`/board?job=${encodeURIComponent(job.id)}`);

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, paddingBottom: 60 }}>
      {/* ── Header ── */}
      <div style={{ padding: '16px 16px 10px', borderBottom: `1px solid ${LINE}`, position: 'sticky', top: 0, background: BG, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{config.title}'s workspace</div>
            <div style={{ color: MUTED, fontSize: 12 }}>{config.subtitle}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => navigate('/notes')}
              style={{ background: SURFACE, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              📝 Notes
            </button>
            <button onClick={() => setShowNewJob(true)}
              style={{ background: '#00c8e8', color: '#0f1729', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + New
            </button>
            <button onClick={load} disabled={loading}
              style={{ background: SURFACE, border: 'none', color: MUTED, borderRadius: 8, padding: '9px 13px', fontSize: 14, cursor: 'pointer' }}>
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by customer, job number, tech…"
          style={{ width: '100%', boxSizing: 'border-box', background: SURFACE, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '9px 12px', color: TEXT, fontSize: 13, outline: 'none' }}
        />
      </div>

      {/* ── Lanes ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, padding: 16 }}>
        {byLane.map(lane => (
          <div key={lane.key} style={{ background: SURFACE, borderRadius: 12, padding: 12, minHeight: 120 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: lane.color }}>{lane.label}</div>
              <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{lane.rows.length}</div>
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>{lane.hint}</div>

            {lane.rows.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 12, padding: '18px 0', textAlign: 'center' }}>
                {loading ? 'Loading…' : 'Nothing here.'}
              </div>
            ) : lane.rows.map(job => {
              const schedulable = config.canSchedule && SCHEDULABLE.includes(job.status);
              return (
                <div key={job.id}
                  style={{ background: BG, border: `1px solid ${LINE}`, borderLeft: `3px solid ${STATUS_COLOR[job.status] || LINE}`,
                           borderRadius: 10, padding: 10, marginBottom: 8 }}>
                  <div onClick={() => openJob(job)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>
                        {job.customer_name || 'Unnamed'}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', padding: '3px 7px', borderRadius: 20,
                                    background: `${STATUS_COLOR[job.status] || LINE}22`, color: STATUS_COLOR[job.status] || MUTED }}>
                        {STATUS_LABEL[job.status] || job.status}
                      </div>
                    </div>

                    {job.issue && (
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.35 }}>
                        {job.issue.length > 110 ? job.issue.slice(0, 108).trimEnd() + '…' : job.issue}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7, fontSize: 10, color: MUTED }}>
                      {job.tech_name && <span>👤 {job.tech_name}</span>}
                      {job.scheduled_date && (
                        <span>📅 {new Date(job.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      )}
                      <span>{ageLabel ? ageLabel(job.created_at) : ''}</span>
                    </div>
                  </div>

                  {schedulable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSchedulingJob(job); }}
                      style={{ marginTop: 9, width: '100%', background: 'transparent', color: '#00c8e8',
                               border: '1px solid #00c8e855', borderRadius: 8, padding: '7px 0',
                               fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      📅 Schedule
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Sales pipeline (Sara only) ── */}
      {config.pipeline && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ background: SURFACE, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Estimates out</div>
            {jobs.filter(j => j.status === 'estimate_sent').length === 0 ? (
              <div style={{ color: MUTED, fontSize: 12 }}>Nothing waiting on a customer.</div>
            ) : jobs.filter(j => j.status === 'estimate_sent').map(j => (
              <div key={j.id} onClick={() => openJob(j)}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0',
                         borderBottom: `1px solid ${LINE}`, cursor: 'pointer', fontSize: 13 }}>
                <span>{j.customer_name}</span>
                <span style={{ color: MUTED }}>
                  {j.estimate_amount ? `$${Number(j.estimate_amount).toLocaleString()}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {schedulingJob && (
        <VisualSchedulerModal
          job={schedulingJob}
          techs={techs}
          accessToken={accessToken}
          onClose={() => setSchedulingJob(null)}
          onScheduled={() => { setSchedulingJob(null); load(); showToast('Scheduled ✓'); }}
        />
      )}

      {showNewJob && (
        <NewJobModal
          accessToken={accessToken}
          userEmail={userEmail}
          onClose={() => setShowNewJob(false)}
          onCreated={() => { setShowNewJob(false); load(); showToast('Job created ✓'); }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                      background: '#22c55e', color: '#0f1729', padding: '10px 18px', borderRadius: 20,
                      fontSize: 13, fontWeight: 700, zIndex: 2000 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
