// ============================================
// TimeEntryBlock
// ============================================
// Required gate before tech can fire any "Finish" action.
// Supports three entry modes: manual total hrs, time-in/time-out, or live timer.
// Exposes `value` (controlled) and an imperative `toPayload()` helper for the parent.
//
// Usage:
//   const [time, setTime] = useState(TimeEntryBlock.empty());
//   <TimeEntryBlock value={time} onChange={setTime} eventDate={selectedEvent.start} />
//   ...
//   if (!TimeEntryBlock.isValid(time)) { show error; return; }
//   const payload = TimeEntryBlock.toPayload(time, selectedEvent.start);

import { useEffect, useState } from 'react';

// ── helpers ────────────────────────────────────────────────────
function parseManualHours(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60 * 60 * 1000);
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(parseFloat(m[1]) * 60 * 60 * 1000);
  m = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/);
  if (m) return parseInt(m[1], 10) * 60 * 1000;
  m = s.match(/^(\d+)\s*h\s*(\d+)\s*m$/);
  if (m) return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60 * 1000;
  return null;
}

function parseClockOnDate(clock, baseDate) {
  if (!clock) return null;
  const m = String(clock).trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(baseDate);
  d.setHours(h, min, 0, 0);
  return d;
}

function formatElapsed(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// ── shape ──────────────────────────────────────────────────────
const EMPTY = {
  manualHours: '',
  timeIn: '',
  timeOut: '',
  timerStartedAt: null,   // ms epoch when running, else null
  timerAccumMs: 0,        // accumulated from prior start/pause cycles
};

// ── public helpers (static-ish) ────────────────────────────────
function effectiveMs(v) {
  const manual = parseManualHours(v.manualHours);
  if (manual != null) return manual;
  // in/out — don't resolve here since it needs baseDate; resolved at validate/toPayload time
  const timerLive = v.timerStartedAt ? (v.timerAccumMs + (Date.now() - v.timerStartedAt)) : v.timerAccumMs;
  return timerLive;
}

function resolveInOut(v, baseDate) {
  const inD = parseClockOnDate(v.timeIn, baseDate);
  const outD = parseClockOnDate(v.timeOut, baseDate);
  if (!inD || !outD) return null;
  let diff = outD - inD;
  if (diff < 0) diff += 24 * 60 * 60 * 1000;
  return { in: inD, out: outD, ms: diff };
}

export function isValidTimeEntry(v, baseDate) {
  if (!v) return false;
  if (parseManualHours(v.manualHours) != null) return true;
  const io = resolveInOut(v, baseDate || new Date());
  if (io && io.ms > 0) return true;
  const timerMs = v.timerStartedAt ? (v.timerAccumMs + (Date.now() - v.timerStartedAt)) : v.timerAccumMs;
  if (timerMs > 0) return true;
  return false;
}

export function timeEntryToPayload(v, baseDate) {
  const io = resolveInOut(v, baseDate || new Date());
  const manualMs = parseManualHours(v.manualHours);
  const timerMs = v.timerStartedAt ? (v.timerAccumMs + (Date.now() - v.timerStartedAt)) : v.timerAccumMs;

  let method = 'manual';
  let totalMs = 0;
  let timeInISO = null;
  let timeOutISO = null;

  if (manualMs != null) {
    method = 'manual';
    totalMs = manualMs;
  } else if (io && io.ms > 0) {
    method = 'inout';
    totalMs = io.ms;
    timeInISO = io.in.toISOString();
    timeOutISO = io.out.toISOString();
  } else if (timerMs > 0) {
    method = 'timer';
    totalMs = timerMs;
  }

  return {
    entry_method: method,
    total_minutes: Math.round(totalMs / 60000),
    time_in: timeInISO,
    time_out: timeOutISO,
  };
}

export const emptyTimeEntry = () => ({ ...EMPTY });

// ── component ──────────────────────────────────────────────────
export default function TimeEntryBlock({ value, onChange, eventDate, required = true }) {
  const v = value || EMPTY;
  const set = (patch) => onChange({ ...v, ...patch });

  const [, tick] = useState(0);
  useEffect(() => {
    if (!v.timerStartedAt) return;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [v.timerStartedAt]);

  const start = () => { if (!v.timerStartedAt) set({ timerStartedAt: Date.now() }); };
  const pause = () => {
    if (v.timerStartedAt) {
      set({
        timerAccumMs: v.timerAccumMs + (Date.now() - v.timerStartedAt),
        timerStartedAt: null,
      });
    }
  };
  const reset = () => set(EMPTY);

  const liveMs = effectiveMs(v);
  const io = resolveInOut(v, eventDate || new Date());
  const displayMs = (parseManualHours(v.manualHours) ?? (io?.ms || 0)) || liveMs;

  const valid = isValidTimeEntry(v, eventDate);

  return (
    <div style={{
      background: '#f9fafb',
      borderRadius: 10,
      padding: 12,
      marginBottom: 14,
      border: `1px solid ${required && !valid ? '#fbbf24' : '#e5e7eb'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
          Time Entry {required && <span style={{ color: valid ? '#16a34a' : '#d97706' }}>{valid ? '✓' : '· required'}</span>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1B2A4A' }}>⏱ {formatElapsed(displayMs)}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        <input
          value={v.manualHours}
          onChange={e => set({ manualHours: e.target.value })}
          placeholder="Total hrs (1.5)"
          style={{ padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
        />
        <input
          value={v.timeIn}
          onChange={e => set({ timeIn: e.target.value })}
          placeholder="In 11:30"
          style={{ padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
        />
        <input
          value={v.timeOut}
          onChange={e => set({ timeOut: e.target.value })}
          placeholder="Out 1:15"
          style={{ padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={start}
          style={{ padding: '10px 12px', background: '#ecfeff', border: '1px solid #67e8f9', borderRadius: 8, color: '#155e75', fontWeight: 700, cursor: 'pointer' }}>
          {v.timerStartedAt ? 'Running...' : 'Start'}
        </button>
        <button type="button" onClick={pause}
          style={{ padding: '10px 12px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, color: '#9a3412', fontWeight: 700, cursor: 'pointer' }}>
          Pause
        </button>
        <button type="button" onClick={reset}
          style={{ padding: '10px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, color: '#4b5563', fontWeight: 700, cursor: 'pointer' }}>
          Reset
        </button>
      </div>

      {required && !valid && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#b45309' }}>
          Enter manual hours, time in+out, or run the timer to continue.
        </div>
      )}
    </div>
  );
}
