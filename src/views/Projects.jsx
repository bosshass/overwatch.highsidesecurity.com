// ============================================
// Projects — billing command center for project work
// ============================================
// Shows every P-code / S-code that has hours or calendar events.
// Key signals on each card:
//   • Won → first-scheduled gap  (how long between landing the job and getting
//     it on the calendar — a long gap is a warning sign)
//   • Budget / Billed / Remaining  (inline-editable, saves to jobs table)
//   • Unbilled hours still on the bench
//
// Default sort: Priority — composite of age × √($ remaining).
// The oldest job with the most money left bubbles to the top.
// ============================================

import { useEffect, useState, useRef } from 'react';
import { supabase } from '../services/supabase.js';
import { fetchAllCalendars } from '../services/calendarApi.js';
import { CALENDARS } from '../config/calendars.js';

// ── Formatting helpers ────────────────────────────────────────────────────────
const fmt$ = (n) => {
  const v = Number(n) || 0;
  return v >= 1000
    ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
    : `$${v.toLocaleString()}`;
};
const fmtH = (mins) => `${((Number(mins) || 0) / 60).toFixed(1)}h`;
const fmtDay = (d) => d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  : '';
const daysSince = (d) => d
  ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  : null;
const daysBetween = (a, b) => (a && b)
  ? Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
  : null;

// ── Project-ref extraction ────────────────────────────────────────────────────
function extractRef(title) {
  const mP = (title || '').match(/\[P-(\d+)\]/i);
  if (mP) return `P-${mP[1]}`;
  const mS = (title || '').match(/\[S-(\d+)\]/i);
  if (mS) return `S-${mS[1]}`;
  const mProj = (title || '').match(/\[PROJ-(\d+)\]/i);
  return mProj ? `PROJ-${mProj[1]}` : null;
}
function cleanName(title) {
  let n = title || '';
  while (n.match(/^\[[^\]]+\]\s*/)) n = n.replace(/^\[[^\]]+\]\s*/, '');
  return n.split(' - ')[0].trim() || (title || '').trim();
}

// ── Sort ──────────────────────────────────────────────────────────────────────
const SORTS = [
  { key: 'priority', label: '🔥 Priority' },
  { key: 'oldest',   label: '⏳ Oldest'   },
  { key: 'money',    label: '💰 Most $ left' },
];

function priorityScore(row) {
  const age = daysSince(row.job?.created_at) || 0;
  const rem = Number(row.remaining) || 0;
  // Composite: age gives time-pressure; √remaining gives diminishing returns
  // so a $50k project 10 days old and a $5k project 100 days old score similarly
  return age * Math.sqrt(rem + 1);
}

function sortRows(rows, sort) {
  return [...rows].sort((a, b) => {
    if (sort === 'oldest') return (daysSince(b.job?.created_at) || 0) - (daysSince(a.job?.created_at) || 0);
    if (sort === 'money')  return (Number(b.remaining) || 0) - (Number(a.remaining) || 0);
    return priorityScore(b) - priorityScore(a); // 'priority'
  });
}

// ── Calendar sources ──────────────────────────────────────────────────────────
const PROJECT_CALENDARS = [
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Service Queue' },
  { id: CALENDARS.AUSTIN,                name: 'Austin'         },
  { id: CALENDARS.JR,                    name: 'JR'             },
  { id: CALENDARS.INSTALLATIONS,         name: 'Installations'  },
  { id: CALENDARS.COMPLETED,             name: 'Completed'      },
];

// ── Colour constants ──────────────────────────────────────────────────────────
const C = {
  bg:    '#07111f',
  card:  '#111f34',
  line:  '#1d2f48',
  muted: '#8ea0b8',
  text:  '#edf4ff',
  green: '#4ade80',
  amber: '#f59e0b',
  red:   '#fb4f5e',
  blue:  '#38bdf8',
  teal:  '#5eead4',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN VIEW
// ─────────────────────────────────────────────────────────────────────────────
export default function Projects({ accessToken, onBack }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [sort, setSort]       = useState('priority');
  const [showDone, setShowDone] = useState(false);
  const [expanded, setExpanded] = useState(null);

  // Local overrides for budget / billed / remaining — keyed by job.id
  // Written back to supabase on blur; also reflected here instantly.
  const [overrides, setOverrides] = useState({});

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        // 1. Jobs with a P-number
        const { data: jobs, error: jErr } = await supabase
          .from('jobs')
          .select('id, p_number, customer_name, customer_address, status, qbo_estimate_status, estimate_amount, invoiced_amount, remaining_amount, created_at, scheduled_date')
          .not('p_number', 'is', null);
        if (jErr) throw jErr;
        const jobByRef = {};
        for (const j of (jobs || [])) if (j.p_number) jobByRef[j.p_number] = j;

        // 2. Time entries tagged with a project ref
        const { data: entries, error: eErr } = await supabase
          .from('time_entries')
          .select('id, project_ref, tech_name, tech_email, total_minutes, event_start, event_title, calendar_event_id, disposition, materials, billed, billed_at, invoice_ref')
          .not('project_ref', 'is', null)
          .order('event_start', { ascending: false });
        if (eErr) throw eErr;
        const entriesByRef = {};
        for (const e of (entries || [])) {
          (entriesByRef[e.project_ref] = entriesByRef[e.project_ref] || []).push(e);
        }

        // 3. Calendar events tagged [P-NNN] (scheduled work)
        const eventsByRef = {};
        if (accessToken) {
          try {
            const timeMin = new Date(Date.now() - 365 * 86400000);
            const timeMax = new Date(Date.now() + 365 * 86400000);
            const calEvents = await fetchAllCalendars(accessToken, PROJECT_CALENDARS, timeMin, timeMax);
            for (const ev of (calEvents || [])) {
              const ref = extractRef(ev.summary);
              if (!ref) continue;
              (eventsByRef[ref] = eventsByRef[ref] || []).push({
                id: ev.id, summary: ev.summary || '',
                name: cleanName(ev.summary),
                start: ev.start?.dateTime || ev.start?.date || null,
                calendarName: ev._calendarName || '',
              });
            }
          } catch (e) {
            if (e.message !== 'TOKEN_EXPIRED') console.warn('Projects cal scan failed:', e.message);
          }
        }

        // 4. Union + merge
        const allRefs = new Set([
          ...Object.keys(jobByRef),
          ...Object.keys(entriesByRef),
          ...Object.keys(eventsByRef),
        ]);

        const merged = [...allRefs].map(ref => {
          const job = jobByRef[ref] || null;
          const es  = entriesByRef[ref] || [];
          const evs = eventsByRef[ref] || [];

          // Earliest calendar event across all sources → "first scheduled" date
          const allEventDates = evs
            .map(ev => ev.start)
            .filter(Boolean)
            .map(s => new Date(s).getTime());
          const firstScheduled = allEventDates.length
            ? new Date(Math.min(...allEventDates))
            : null;

          // Earliest logged time entry
          const entryDates = es.map(e => e.event_start).filter(Boolean).map(s => new Date(s).getTime());
          const firstWorked = entryDates.length ? new Date(Math.min(...entryDates)) : null;

          // Don't double-count events that already have a time entry
          const workedIds = new Set(es.map(e => e.calendar_event_id).filter(Boolean));
          const scheduledOnly = evs
            .filter(ev => !workedIds.has(ev.id))
            .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));

          const unbilledMins = es.filter(e => !e.billed).reduce((s, e) => s + (Number(e.total_minutes) || 0), 0);
          const billedMins   = es.filter(e =>  e.billed).reduce((s, e) => s + (Number(e.total_minutes) || 0), 0);
          const totalMins    = unbilledMins + billedMins;

          const techs = {};
          for (const e of es) {
            const t = e.tech_name || e.tech_email?.split('@')[0] || '?';
            techs[t] = (techs[t] || 0) + (Number(e.total_minutes) || 0);
          }

          const customerName = job?.customer_name
            || scheduledOnly[0]?.name
            || es.find(e => e.event_title)?.event_title?.replace(/^\[.*?\]\s*/, '').split(' - ')[0]
            || ref;

          // Financials — prefer job fields; remaining = budget − billed if not set
          const budget    = Number(job?.estimate_amount)  || null;
          const billed    = Number(job?.invoiced_amount)  || null;
          const remaining = Number(job?.remaining_amount) || (budget != null && billed != null ? budget - billed : null);

          const isTerminal = ['Lost', 'Billed', 'billed', 'lost', 'archived'].includes(job?.status || '');

          return {
            ref, job, entries: es, scheduled: scheduledOnly,
            unbilledMins, billedMins, totalMins, techs,
            customerName,
            address: job?.customer_address || '',
            status: job?.qbo_estimate_status || job?.status || null,
            budget, billed, remaining,
            isTerminal,
            wonAt: job?.created_at || null,
            firstScheduled,
            firstWorked,
          };
        });

        if (!dead) setRows(merged);
      } catch (e) {
        if (!dead) setError(e.message || String(e));
      }
      if (!dead) setLoading(false);
    })();
    return () => { dead = true; };
  }, [accessToken]);

  // ── Derived list ───────────────────────────────────────────────────────────
  const visible = sortRows(
    rows.filter(r => showDone ? true : !r.isTerminal),
    sort
  );

  const totalUnbilled = visible.reduce((s, r) => s + r.unbilledMins, 0);
  const totalRemaining = visible.reduce((s, r) => {
    const ov = overrides[r.job?.id];
    return s + (Number(ov?.remaining ?? r.remaining) || 0);
  }, 0);

  // ── Inline save to supabase ────────────────────────────────────────────────
  async function saveField(jobId, field, value) {
    if (!jobId) return;
    const num = parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0;
    setOverrides(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || {}), [field]: num },
    }));
    await supabase.from('jobs').update({ [field]: num }).eq('id', jobId);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(7,17,31,0.96)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.line}`, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: C.text, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>🔨 Projects</div>
            {!loading && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {visible.length} active · {fmtH(totalUnbilled)} unbilled
                {totalRemaining > 0 && ` · ${fmt$(totalRemaining)} remaining to bill`}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowDone(v => !v)}
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 7, border: `1px solid ${C.line}`, background: showDone ? '#1e3a5f' : 'transparent', color: showDone ? C.blue : C.muted, cursor: 'pointer' }}>
            {showDone ? 'Hide done' : 'Show done'}
          </button>
        </div>

        {/* Sort toggles */}
        <div style={{ display: 'flex', gap: 6 }}>
          {SORTS.map(s => (
            <button key={s.key} onClick={() => setSort(s.key)}
              style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 7, border: `1px solid ${sort === s.key ? C.teal : C.line}`, background: sort === s.key ? `${C.teal}18` : 'transparent', color: sort === s.key ? C.teal : C.muted, cursor: 'pointer' }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ textAlign: 'center', padding: 48, color: C.muted }}>Loading…</div>}
        {error   && <div style={{ color: '#ef4444', padding: 12, background: '#7f1d1d22', borderRadius: 8 }}>Error: {error}</div>}
        {!loading && !error && visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted, fontSize: 14 }}>
            No projects. Tag a time entry or calendar event with a P-code.
          </div>
        )}

        {!loading && !error && visible.map(r => (
          <ProjectCard
            key={r.ref}
            row={r}
            overrides={overrides[r.job?.id] || {}}
            onSave={(field, val) => saveField(r.job?.id, field, val)}
            expanded={expanded === r.ref}
            onToggle={() => setExpanded(expanded === r.ref ? null : r.ref)}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT CARD
// ─────────────────────────────────────────────────────────────────────────────
function ProjectCard({ row, overrides, onSave, expanded, onToggle }) {
  const budget    = Number(overrides.estimate_amount  ?? row.budget)    || null;
  const billed    = Number(overrides.invoiced_amount  ?? row.billed)    || null;
  const remaining = Number(overrides.remaining_amount ?? row.remaining)
    ?? (budget != null && billed != null ? budget - billed : null);

  const wonAge    = daysSince(row.wonAt);
  const schedGap  = row.firstScheduled
    ? daysBetween(row.wonAt, row.firstScheduled)
    : null;
  const workedGap = row.firstWorked
    ? daysBetween(row.wonAt, row.firstWorked)
    : null;

  // Urgency colour for the left border
  const borderColor = remaining > 10000 && wonAge > 30 ? C.red
    : remaining > 5000 && wonAge > 14 ? C.amber
    : remaining > 0 ? C.teal
    : C.line;

  const pctBilled = budget && billed ? Math.min(Math.round((billed / budget) * 100), 100) : null;

  return (
    <div style={{ background: C.card, borderRadius: 12, borderLeft: `3px solid ${borderColor}`, opacity: row.isTerminal ? 0.55 : 1, overflow: 'hidden' }}>

      {/* ── Top summary row (always visible) ─────────────────────────── */}
      <div onClick={onToggle} style={{ padding: '14px 16px', cursor: 'pointer' }}>

        {/* Row 1: ref badge + customer + age */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <span style={{ background: '#1d4ed8', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>{row.ref}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customerName}</div>
            {row.address && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{row.address}</div>}
          </div>
          {wonAge != null && (
            <span style={{ fontSize: 11, fontWeight: 800, color: wonAge > 60 ? C.red : wonAge > 30 ? C.amber : C.muted, background: wonAge > 60 ? '#fb4f5e18' : wonAge > 30 ? '#f59e0b18' : 'transparent', padding: '2px 6px', borderRadius: 5, flexShrink: 0 }}>
              {wonAge}d old
            </span>
          )}
        </div>

        {/* Row 2: Won → Scheduled gap */}
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.muted, marginBottom: 8, flexWrap: 'wrap' }}>
          {row.wonAt && (
            <span>Won {fmtDay(row.wonAt)}</span>
          )}
          {row.firstScheduled && schedGap != null && (
            <span style={{ color: schedGap > 14 ? C.amber : C.muted }}>
              → Scheduled {fmtDay(row.firstScheduled)} <span style={{ fontWeight: 700, color: schedGap > 14 ? C.amber : C.teal }}>({schedGap}d gap)</span>
            </span>
          )}
          {!row.firstScheduled && row.firstWorked && workedGap != null && (
            <span>→ First worked {fmtDay(row.firstWorked)} ({workedGap}d)</span>
          )}
          {!row.firstScheduled && !row.firstWorked && (
            <span style={{ color: C.amber }}>Not yet scheduled</span>
          )}
        </div>

        {/* Row 3: Financial strip */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <FinField
            label="Budget"
            value={budget}
            jobId={row.job?.id}
            field="estimate_amount"
            onSave={onSave}
            color={C.text}
          />
          <span style={{ color: C.line, fontSize: 12 }}>·</span>
          <FinField
            label="Billed"
            value={billed}
            jobId={row.job?.id}
            field="invoiced_amount"
            onSave={onSave}
            color={C.green}
          />
          <span style={{ color: C.line, fontSize: 12 }}>·</span>
          <FinField
            label="Remaining"
            value={remaining}
            jobId={row.job?.id}
            field="remaining_amount"
            onSave={onSave}
            color={remaining > 0 ? C.amber : C.muted}
            bold={remaining > 0}
          />
        </div>

        {/* Budget progress bar */}
        {pctBilled != null && (
          <div style={{ height: 4, background: '#1d2f48', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ width: `${pctBilled}%`, height: '100%', background: pctBilled >= 100 ? C.green : C.teal, borderRadius: 2, transition: 'width 0.4s' }} />
          </div>
        )}

        {/* Row 4: Hours summary */}
        <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap', alignItems: 'center' }}>
          {row.unbilledMins > 0 && (
            <span style={{ background: '#f59e0b18', color: C.amber, border: `1px solid ${C.amber}40`, padding: '2px 7px', borderRadius: 5, fontWeight: 700 }}>
              {fmtH(row.unbilledMins)} unbilled
            </span>
          )}
          {row.billedMins > 0 && (
            <span style={{ color: C.green, fontWeight: 600 }}>{fmtH(row.billedMins)} billed</span>
          )}
          {Object.entries(row.techs).map(([t, m]) => (
            <span key={t} style={{ color: C.muted }}>{t} {fmtH(m)}</span>
          ))}
          {row.scheduled.length > 0 && (
            <span style={{ color: C.blue }}>📅 {row.scheduled.length} upcoming</span>
          )}
          {row.status && (
            <span style={{ color: C.muted, background: '#33415540', padding: '2px 6px', borderRadius: 4 }}>{row.status}</span>
          )}
          {!row.job && (
            <span style={{ color: C.amber, fontSize: 10, background: '#78350f40', padding: '2px 6px', borderRadius: 4 }}>NO JOB ROW</span>
          )}
        </div>
      </div>

      {/* ── Expanded detail ───────────────────────────────────────────── */}
      {expanded && (
        <div style={{ padding: '0 16px 14px', borderTop: `1px solid ${C.line}` }}>

          {/* Logged entries */}
          {row.entries.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Logged time</div>
              {row.entries.map(e => {
                const isNC = e.invoice_ref === 'NC-ARCHIVED';
                const badge = isNC
                  ? { t: 'No Charge', c: '#9ca3af', bg: '#37415160' }
                  : e.billed
                    ? { t: 'Billed',   c: C.green,  bg: '#14532d60' }
                    : { t: 'Unbilled', c: C.amber,  bg: '#78350f60' };
                return (
                  <div key={e.id} style={{ background: '#0f172a', borderRadius: 7, padding: '8px 10px', marginBottom: 4, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: C.muted }}>{e.tech_name || '?'} · {fmtH(e.total_minutes)}</span>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: badge.bg, color: badge.c }}>{badge.t}</span>
                        <span style={{ color: C.muted }}>{fmtDay(e.event_start)}</span>
                      </span>
                    </div>
                    {e.event_title && <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{e.event_title}</div>}
                    {e.materials  && <div style={{ color: C.amber, fontSize: 11, marginTop: 2 }}>📦 {e.materials}</div>}
                    {e.invoice_ref && !isNC && <div style={{ color: C.green, fontSize: 11, marginTop: 2 }}>Invoice #{e.invoice_ref}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Upcoming calendar events */}
          {row.scheduled.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.blue, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Scheduled — no hours logged yet</div>
              {row.scheduled.map(ev => (
                <div key={ev.id} style={{ background: '#0c1a3d', borderRadius: 7, padding: '8px 10px', marginBottom: 4, fontSize: 12, border: `1px solid #1e3a5f` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#93c5fd' }}>📅 {ev.calendarName}</span>
                    <span style={{ color: C.muted }}>{fmtDay(ev.start)}</span>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>{ev.summary}</div>
                </div>
              ))}
            </div>
          )}

          {row.entries.length === 0 && row.scheduled.length === 0 && (
            <div style={{ color: C.muted, fontSize: 12, fontStyle: 'italic', paddingTop: 12 }}>No time entries or upcoming events yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INLINE EDITABLE FINANCIAL FIELD
// ─────────────────────────────────────────────────────────────────────────────
function FinField({ label, value, jobId, field, onSave, color, bold }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const inputRef              = useRef(null);

  function startEdit(e) {
    e.stopPropagation();
    if (!jobId) return; // no job row → can't save
    setDraft(value != null ? String(value) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commit() {
    setEditing(false);
    const num = parseFloat(draft.replace(/[^0-9.]/g, ''));
    if (!isNaN(num)) onSave(field, num);
  }

  return (
    <div onClick={editing ? undefined : startEdit} style={{ cursor: jobId ? 'text' : 'default' }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 }}>{label}</div>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          onClick={e => e.stopPropagation()}
          style={{ width: 72, background: '#0f172a', border: `1px solid ${C.teal}`, borderRadius: 5, color: C.teal, padding: '2px 6px', fontSize: 13, fontWeight: 800, outline: 'none', fontFamily: 'inherit' }}
        />
      ) : (
        <div style={{ fontSize: 13, fontWeight: bold ? 900 : 600, color: value != null ? color : C.muted, fontVariantNumeric: 'tabular-nums' }}>
          {value != null ? fmt$(value) : jobId ? <span style={{ fontSize: 11, color: '#475569' }}>tap to set</span> : '—'}
        </div>
      )}
    </div>
  );
}
