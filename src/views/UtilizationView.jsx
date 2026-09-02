// ============================================
// Utilization View — Tech Hours This Week
// ============================================
// Shows each tech their billed + unbilled hours by day for the current week.
// Operators see all techs. Restricted techs see only themselves.
// Click any day column → drill into that day's individual entries.

import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';

// Colour tokens — match the app's semantic palette exactly.
const TEAL   = '#5eead4';
const SLATE  = '#94a3b8';
const GREEN  = '#4ade80';
const AMBER  = '#f59e0b';
const RED    = '#fb7185';
const BLUE   = '#38bdf8';

// ── Week helpers ──────────────────────────────────────────────────────────────
function weekBounds(anchor = new Date()) {
  const d = new Date(anchor);
  // Monday = day 0 of our week
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setDate(d.getDate() + daysToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { mon, sun };
}

// Return array of 7 Date objects Mon–Sun for the week containing `anchor`
function weekDays(anchor = new Date()) {
  const { mon } = weekBounds(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
}

function fmtHours(minutes) {
  if (!minutes) return '—';
  const h = minutes / 60;
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function entryDay(entry) {
  // event_start is the authoritative date for time entries
  const raw = entry.event_start || entry.time_in;
  return raw ? new Date(raw) : null;
}

// ── Tech order for display ────────────────────────────────────────────────────
const TECH_ORDER = ['Austin', 'JR', 'Brian', 'Shana', 'Trevor', 'Sara'];

function sortedTechs(names) {
  const known = TECH_ORDER.filter(n => names.includes(n));
  const rest  = names.filter(n => !TECH_ORDER.includes(n)).sort();
  return [...known, ...rest];
}

// ── Urgency colour for utilization bars ──────────────────────────────────────
function hoursColor(hours) {
  if (hours >= 7)  return GREEN;
  if (hours >= 4)  return TEAL;
  if (hours >= 1)  return AMBER;
  return SLATE;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function UtilizationView({ userEmail, userName, isOperator = false, onBack }) {
  const [anchor, setAnchor]         = useState(new Date());
  const [entries, setEntries]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [drillDay, setDrillDay]     = useState(null);   // Date | null
  const [drillTech, setDrillTech]   = useState(null);   // string | null
  const [weekOffset, setWeekOffset] = useState(0);

  // Compute current anchor from weekOffset
  useEffect(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    setAnchor(base);
  }, [weekOffset]);

  const { mon, sun } = weekBounds(anchor);
  const days = weekDays(anchor);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isCurrentWeek = weekOffset === 0;

  // ── Load time_entries for this week ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        let q = supabase
          .from('time_entries')
          .select('id, tech_name, tech_email, customer_name_raw, event_start, total_minutes, billable, billed, job_id, event_title, disposition, notes')
          .gte('event_start', mon.toISOString())
          .lte('event_start', sun.toISOString())
          .not('total_minutes', 'is', null)
          .gt('total_minutes', 0)
          .order('event_start', { ascending: true });

        // Restricted tech: scope to their own entries only
        if (!isOperator) {
          q = q.or(`tech_email.eq.${userEmail},tech_name.ilike.${userName}`);
        }

        const { data, error } = await q.limit(500);
        if (!cancelled) {
          if (error) console.warn('utilization load error', error);
          setEntries(data || []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('utilization load failed', e);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mon.toISOString(), sun.toISOString(), isOperator, userEmail, userName]);

  // ── Aggregate ──────────────────────────────────────────────────────────────
  // { techName → { total: minutes, byDay: { iso_date: minutes } } }
  const byTech = {};
  for (const e of entries) {
    const tech = e.tech_name || 'Unknown';
    const day  = entryDay(e);
    if (!day) continue;
    const iso  = day.toISOString().slice(0, 10);

    if (!byTech[tech]) byTech[tech] = { total: 0, byDay: {} };
    byTech[tech].total         += (e.total_minutes || 0);
    byTech[tech].byDay[iso]    = (byTech[tech].byDay[iso] || 0) + (e.total_minutes || 0);
  }

  const techNames = isOperator
    ? sortedTechs(Object.keys(byTech))
    : [userName];

  // ── Drill-down entries ─────────────────────────────────────────────────────
  const drillEntries = drillDay
    ? entries.filter(e => {
        const d = entryDay(e);
        if (!d || !isSameDay(d, drillDay)) return false;
        if (drillTech && e.tech_name !== drillTech) return false;
        return true;
      })
    : [];

  // ── Week label ─────────────────────────────────────────────────────────────
  const weekLabel = isCurrentWeek
    ? 'This Week'
    : weekOffset === -1
      ? 'Last Week'
      : `Week of ${mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  // ── Column width calculation ───────────────────────────────────────────────
  // 7 day cols + 1 name col + 1 total col on the grid
  const COL_W = 44; // px per day column on desktop; shrinks on mobile via relative

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f1729',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      paddingBottom: 80,
    }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(7,17,31,0.96)',
        borderBottom: '1px solid #1d2f48',
        backdropFilter: 'blur(12px)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        {onBack && (
          <button onClick={onBack}
            style={{ background: 'none', border: 'none', color: SLATE, fontSize: 22, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>
            ‹
          </button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0', lineHeight: 1.1 }}>
            Utilization
          </div>
          <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
            Hours logged this week by tech
          </div>
        </div>

        {/* Week navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setWeekOffset(w => w - 1)}
            style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '6px 10px', cursor: 'pointer', fontSize: 14 }}>
            ‹
          </button>
          <span style={{ fontSize: 12, fontWeight: 700, color: TEAL, whiteSpace: 'nowrap', minWidth: 80, textAlign: 'center' }}>
            {weekLabel}
          </span>
          <button onClick={() => setWeekOffset(w => Math.min(w + 1, 0))}
            disabled={isCurrentWeek}
            style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: isCurrentWeek ? '#475569' : '#e2e8f0', padding: '6px 10px', cursor: isCurrentWeek ? 'default' : 'pointer', fontSize: 14 }}>
            ›
          </button>
        </div>
      </div>

      {/* ── Loading ────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: SLATE, fontSize: 14 }}>
          Loading hours…
        </div>
      )}

      {!loading && (
        <div style={{ padding: '16px' }}>

          {/* ── Week summary total ──────────────────────────────────────── */}
          {isOperator && (
            <WeekTotalBanner entries={entries} days={days} today={today} isCurrentWeek={isCurrentWeek} />
          )}

          {/* ── Per-tech grid ───────────────────────────────────────────── */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
              <thead>
                <tr>
                  {/* Name col */}
                  <th style={{ width: 90, minWidth: 80, padding: '6px 8px 10px 0', textAlign: 'left', fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Tech
                  </th>
                  {/* Day cols */}
                  {days.map(day => {
                    const isToday = isSameDay(day, new Date());
                    const isFuture = day > new Date() && !isToday;
                    return (
                      <th key={day.toISOString()} style={{
                        width: `${COL_W}px`, minWidth: `${COL_W}px`,
                        padding: '4px 4px 10px',
                        textAlign: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        color: isToday ? TEAL : isFuture ? '#475569' : SLATE,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}>
                        <div>{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                        <div style={{ fontWeight: 500, fontSize: 9, marginTop: 2 }}>
                          {day.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                        </div>
                        {isToday && (
                          <div style={{ width: 4, height: 4, borderRadius: '50%', background: TEAL, margin: '3px auto 0' }} />
                        )}
                      </th>
                    );
                  })}
                  {/* Total col */}
                  <th style={{ width: 56, padding: '6px 0 10px 8px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {techNames.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: '32px 0', textAlign: 'center', color: SLATE, fontSize: 14 }}>
                      No hours logged this week
                    </td>
                  </tr>
                )}
                {techNames.map(tech => {
                  const techData = byTech[tech] || { total: 0, byDay: {} };
                  const totalHrs = techData.total / 60;
                  return (
                    <TechRow
                      key={tech}
                      tech={tech}
                      techData={techData}
                      days={days}
                      today={today}
                      totalHrs={totalHrs}
                      drillDay={drillDay}
                      drillTech={drillTech}
                      onDrillDay={(day) => {
                        if (drillDay && isSameDay(drillDay, day) && drillTech === tech) {
                          setDrillDay(null); setDrillTech(null);
                        } else {
                          setDrillDay(day); setDrillTech(tech);
                        }
                      }}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Drill-down panel ────────────────────────────────────────── */}
          {drillDay && drillTech && (
            <DrillPanel
              day={drillDay}
              tech={drillTech}
              entries={drillEntries}
              onClose={() => { setDrillDay(null); setDrillTech(null); }}
            />
          )}

          {/* ── Legend ──────────────────────────────────────────────────── */}
          <div style={{ marginTop: 24, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { color: GREEN, label: '7h+ strong day' },
              { color: TEAL,  label: '4–7h solid' },
              { color: AMBER, label: '1–4h light' },
              { color: SLATE, label: 'No hours' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                <span style={{ fontSize: 11, color: SLATE }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Week Total Banner (operator only) ─────────────────────────────────────────
function WeekTotalBanner({ entries, days, today, isCurrentWeek }) {
  const totalMins  = entries.reduce((s, e) => s + (e.total_minutes || 0), 0);
  const totalHrs   = totalMins / 60;
  const daysThru   = isCurrentWeek
    ? days.filter(d => d <= today).length
    : days.length;
  const avgPerDay  = daysThru > 0 ? totalHrs / daysThru : 0;

  return (
    <div style={{
      background: '#1e293b',
      border: '1px solid #1d2f48',
      borderRadius: 12,
      padding: '14px 16px',
      marginBottom: 20,
      display: 'flex',
      gap: 24,
      flexWrap: 'wrap',
    }}>
      <Stat label="Total hours" value={fmtHours(totalMins)} color={TEAL} />
      <Stat label="Avg / day" value={`${avgPerDay.toFixed(1)}h`} color={BLUE} />
      <Stat label="Entries" value={String(entries.length)} color={SLATE} />
      {isCurrentWeek && (
        <Stat label="Days logged" value={`${daysThru} of 5`} color={SLATE} />
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: SLATE, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

// ── Tech Row ──────────────────────────────────────────────────────────────────
function TechRow({ tech, techData, days, today, totalHrs, drillDay, drillTech, onDrillDay }) {
  const weeklyTarget = 40; // hours
  const pct = Math.min(totalHrs / weeklyTarget, 1);

  return (
    <tr style={{ borderTop: '1px solid #1d2f48' }}>
      {/* Tech name */}
      <td style={{ padding: '10px 8px 10px 0', verticalAlign: 'middle' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{tech}</div>
        {/* Mini progress bar */}
        <div style={{ marginTop: 4, height: 3, background: '#1e293b', borderRadius: 2, width: 72, overflow: 'hidden' }}>
          <div style={{ width: `${pct * 100}%`, height: '100%', background: hoursColor(totalHrs / 5), borderRadius: 2, transition: 'width 0.4s' }} />
        </div>
      </td>

      {/* Day cells */}
      {days.map(day => {
        const iso  = day.toISOString().slice(0, 10);
        const mins = techData.byDay[iso] || 0;
        const hrs  = mins / 60;
        const isToday  = isSameDay(day, new Date());
        const isFuture = day > new Date() && !isToday;
        const isDrilled = drillDay && isSameDay(drillDay, day) && drillTech === tech;

        return (
          <td key={iso}
            onClick={() => !isFuture && onDrillDay(day)}
            style={{
              padding: '8px 4px',
              textAlign: 'center',
              verticalAlign: 'middle',
              cursor: isFuture ? 'default' : 'pointer',
              borderRadius: 6,
              background: isDrilled ? '#0f2a3f' : 'transparent',
              transition: 'background 0.15s',
            }}
          >
            {mins > 0 ? (
              <div>
                {/* Circle indicator */}
                <div style={{
                  width: 36, height: 36,
                  borderRadius: '50%',
                  background: `${hoursColor(hrs)}18`,
                  border: `2px solid ${hoursColor(hrs)}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto',
                  position: 'relative',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: hoursColor(hrs), fontVariantNumeric: 'tabular-nums' }}>
                    {hrs % 1 === 0 ? hrs : hrs.toFixed(1)}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: SLATE, marginTop: 3 }}>h</div>
              </div>
            ) : (
              <div style={{ width: 36, height: 36, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isFuture
                  ? <span style={{ fontSize: 16, color: '#334155' }}>·</span>
                  : isToday
                    ? <span style={{ fontSize: 18, color: '#334155' }}>○</span>
                    : <span style={{ fontSize: 12, color: '#334155' }}>—</span>
                }
              </div>
            )}
          </td>
        );
      })}

      {/* Weekly total */}
      <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
        <span style={{
          fontSize: 15, fontWeight: 900,
          color: hoursColor(totalHrs),
          fontVariantNumeric: 'tabular-nums',
        }}>
          {totalHrs > 0 ? `${totalHrs % 1 === 0 ? totalHrs : totalHrs.toFixed(1)}h` : '—'}
        </span>
      </td>
    </tr>
  );
}

// ── Drill Panel ───────────────────────────────────────────────────────────────
function DrillPanel({ day, tech, entries, onClose }) {
  const totalMins = entries.reduce((s, e) => s + (e.total_minutes || 0), 0);

  return (
    <div style={{
      marginTop: 16,
      background: '#1e293b',
      border: '1px solid #1d2f48',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        background: '#0f2a3f',
        borderBottom: '1px solid #1d2f48',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: TEAL }}>
            {tech} — {fmtDate(day)}
          </div>
          <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {fmtHours(totalMins)} total
          </div>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: SLATE, fontSize: 20, cursor: 'pointer', padding: '0 4px' }}>
          ×
        </button>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: SLATE, fontSize: 13 }}>
          No entries found for this day
        </div>
      ) : (
        <div style={{ padding: '8px 0' }}>
          {entries.map((e, i) => (
            <DrillEntry key={e.id || i} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function DrillEntry({ entry }) {
  const mins = entry.total_minutes || 0;
  const hrs  = mins / 60;
  const timeLabel = entry.event_start
    ? new Date(entry.event_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '';

  const dispoBadge = entry.disposition
    ? { in_progress: { label: 'In Progress', color: BLUE },
        done:        { label: 'Done',        color: GREEN },
        return_needed: { label: 'Return',    color: AMBER },
        needs_estimate: { label: 'Estimate', color: '#c084fc' },
        lost_stuck:  { label: 'Blocked',     color: RED },
      }[entry.disposition]
    : null;

  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: '1px solid #0f1729',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      {/* Hours circle */}
      <div style={{
        flexShrink: 0,
        width: 42, height: 42,
        borderRadius: '50%',
        background: `${hoursColor(hrs)}15`,
        border: `1.5px solid ${hoursColor(hrs)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: hoursColor(hrs), fontVariantNumeric: 'tabular-nums' }}>
          {hrs % 1 === 0 ? `${hrs}h` : `${hrs.toFixed(1)}h`}
        </span>
      </div>

      {/* Entry details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.customer_name_raw || entry.event_title || 'Unnamed'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {timeLabel && <span style={{ fontSize: 11, color: SLATE }}>{timeLabel}</span>}
          {entry.billable === false && (
            <span style={{ fontSize: 10, color: AMBER, background: '#f59e0b15', border: '1px solid #f59e0b40', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
              Non-billable
            </span>
          )}
          {entry.billed && (
            <span style={{ fontSize: 10, color: GREEN, background: '#4ade8015', border: '1px solid #4ade8040', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
              Billed
            </span>
          )}
          {dispoBadge && (
            <span style={{ fontSize: 10, color: dispoBadge.color, background: `${dispoBadge.color}15`, border: `1px solid ${dispoBadge.color}40`, padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
              {dispoBadge.label}
            </span>
          )}
        </div>
        {entry.notes && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.notes}
          </div>
        )}
      </div>
    </div>
  );
}
