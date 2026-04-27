// ============================================
// TimeEntryBlock
// ============================================
// Required gate before tech can fire any "Finish" action.
// Two entry modes: manual total hours, OR time-in / time-out.
// Minimum: more than 0.1 hours (= more than 6 minutes) of work.
//
// Usage:
//   const [time, setTime] = useState(emptyTimeEntry());
//   <TimeEntryBlock value={time} onChange={setTime} eventDate={selectedEvent.start} />
//   ...
//   if (!isValidTimeEntry(time, baseDate)) { show error; return; }
//   const payload = timeEntryToPayload(time, baseDate);

// ── helpers ────────────────────────────────────────────────────
// Accepts: 1, 1.5, .5, 0.25, 1h, 0.5h, 1.5hours, 30m, 90min, 1h30m
function parseManualHours(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  // bare decimal hours (1, 1.5, .5)
  let m = s.match(/^(\d*\.?\d+)$/);
  if (m) return Math.round(parseFloat(m[1]) * 3600000);
  // "1.5h", ".5h", "2 hours"
  m = s.match(/^(\d*\.?\d+)\s*h(?:ours?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 3600000);
  // "30m", "90 min"
  m = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/);
  if (m) return parseInt(m[1], 10) * 60000;
  // "1h 30m"
  m = s.match(/^(\d+)\s*h\s*(\d+)\s*m$/);
  if (m) return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60000;
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

// Minimum: > 0.1 hours = > 6 minutes (so total_minutes >= 7 once rounded)
const MIN_MINUTES = 7;

// ── shape ──────────────────────────────────────────────────────
const EMPTY = {
  manualHours: '',
  timeIn: '',
  timeOut: '',
};

// ── public helpers ─────────────────────────────────────────────
function resolveInOut(v, baseDate) {
  const inD = parseClockOnDate(v.timeIn, baseDate);
  const outD = parseClockOnDate(v.timeOut, baseDate);
  if (!inD || !outD) return null;
  let diff = outD - inD;
  if (diff < 0) diff += 24 * 60 * 60 * 1000;
  return { in: inD, out: outD, ms: diff };
}

function totalMinutes(v, baseDate) {
  const manual = parseManualHours(v.manualHours);
  if (manual != null) return Math.round(manual / 60000);
  const io = resolveInOut(v, baseDate || new Date());
  if (io && io.ms > 0) return Math.round(io.ms / 60000);
  return 0;
}

export function isValidTimeEntry(v, baseDate) {
  if (!v) return false;
  return totalMinutes(v, baseDate) >= MIN_MINUTES;
}

export function timeEntryToPayload(v, baseDate) {
  const io = resolveInOut(v, baseDate || new Date());
  const manualMs = parseManualHours(v.manualHours);

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

  const io = resolveInOut(v, eventDate || new Date());
  const manualMs = parseManualHours(v.manualHours);
  const displayMs = manualMs ?? (io?.ms || 0);
  const totalMins = Math.round(displayMs / 60000);

  const valid = isValidTimeEntry(v, eventDate);
  const hasInput = displayMs > 0;
  // Below-minimum hint shows only when user has typed something but it's too short
  const belowMin = hasInput && totalMins < MIN_MINUTES;

  return (
    <div style={{
      background: '#f9fafb',
      borderRadius: 10,
      padding: 12,
      marginBottom: 12,
      border: `1px solid ${required && !valid ? '#fbbf24' : '#e5e7eb'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Time {required && <span style={{ color: valid ? '#16a34a' : '#d97706', marginLeft: 4 }}>{valid ? '✓' : '· required'}</span>}
        </div>
        {hasInput && (
          <div style={{ fontSize: 14, fontWeight: 700, color: belowMin ? '#b45309' : '#1B2A4A' }}>
            ⏱ {formatElapsed(displayMs)}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8 }}>
        <input
          inputMode="decimal"
          value={v.manualHours}
          onChange={e => set({ manualHours: e.target.value })}
          placeholder="Hours (0.5)"
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

      {required && !valid && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#b45309' }}>
          {belowMin
            ? 'Time must be more than 0.1 hours (6 minutes).'
            : 'Enter hours (e.g. 0.5) or time in + time out.'}
        </div>
      )}
    </div>
  );
}
