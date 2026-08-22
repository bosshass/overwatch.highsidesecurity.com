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

// TIMES WERE BEING READ TWELVE HOURS WRONG. This parser took a bare "1:30"
// at face value — 01:30, half past one in the morning — because the am/pm
// group was optional and nothing filled it in. The inputs below are free
// text placeholdered "In · 9:30", so a tech typing what the placeholder
// showed got the afternoon recorded as pre-dawn. 27 entries carry a
// clock-in before 6am; not one of them happened before 6am.
//
// Worse, resolveInOut used to rescue the resulting negative span with a
// blind +24h. Crystal Osthoff, 12:00 in and 1:00 out — a one-hour call —
// stored 13.00 hours. Three rows did that, 38.5 hours logged against 2.5
// hours of real work.
//
// So: bare hours resolve against the workday, and a backwards span is
// corrected by twelve hours, never twenty-four.
const DAY_MS      = 24 * 60 * 60 * 1000;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;
// Nothing on these calendars starts before 6am. A bare hour below it is the
// afternoon — a tech does not begin a residential service call at 1am.
const WORK_START_HOUR = 6;
// Longer than this and something was mistyped, not worked.
const MAX_PLAUSIBLE_MINUTES = 16 * 60;

// Accepts: 9:30 · 9:30am · 9:30 AM · 9:30a · 930 · 9am · 9p · 13:30
// Returns { h, min, explicit } where h is 24-hour and `explicit` says the
// tech actually told us which half of the day they meant.
function parseClockParts(clock) {
  if (!clock) return null;
  const s = String(clock).trim().toLowerCase().replace(/[\s.]/g, '');
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?([ap]m?)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] == null ? 0 : parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  const mer = m[3] ? m[3][0] : null;      // 'a' | 'p' | null

  if (mer) {
    if (h > 12) return null;              // "13pm" is not a time
    if (mer === 'p' && h !== 12) h += 12;
    if (mer === 'a' && h === 12) h = 0;
    return { h, min, explicit: true };
  }
  // 13:00 and up can only be a 24-hour clock — already unambiguous.
  if (h > 12) return { h, min, explicit: true };
  // Bare hour. Below the workday start it is the afternoon; 12 stays noon.
  const h24 = (h < WORK_START_HOUR) ? h + 12 : h;
  return { h: h24, min, explicit: false };
}

function parseClockOnDate(clock, baseDate) {
  const p = parseClockParts(clock);
  if (!p) return null;
  const d = new Date(baseDate);
  d.setHours(p.h, p.min, 0, 0);
  return d;
}

function fmtClock(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  const pin  = parseClockParts(v.timeIn);
  const pout = parseClockParts(v.timeOut);
  if (!pin || !pout) return null;
  const at = (p) => { const d = new Date(baseDate || new Date()); d.setHours(p.h, p.min, 0, 0); return d; };

  const inD = at(pin);
  let outD  = at(pout);
  let diff  = outD - inD;

  // Out lands before in. If the tech gave no am/pm on the clock-out they
  // meant the other half of the day — 9:30 to 5:00 is seven and a half
  // hours, not nineteen and a half.
  if (diff <= 0 && !pout.explicit) {
    outD = new Date(outD.getTime() + HALF_DAY_MS);
    diff = outD - inD;
  }
  // Still backwards with an explicit meridiem: a real overnight job.
  if (diff <= 0) {
    outD = new Date(outD.getTime() + DAY_MS);
    diff = outD - inD;
  }
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
  // Show the tech WHICH clock we read, so a 12-hour misread is caught in the
  // field instead of in a billing audit three months later.
  const spanLabel = io
    ? `${fmtClock(io.in)} – ${fmtClock(io.out)}`
    : null;
  const overLong = totalMins > MAX_PLAUSIBLE_MINUTES;
  // Below-minimum hint shows only when user has typed something but it's too short
  const belowMin = hasInput && totalMins < MIN_MINUTES;

  // 16px font on inputs is deliberate — anything smaller makes iOS Safari
  // zoom in on focus, which is the #1 reason mobile forms feel broken.
  const inp = {
    width: '100%', padding: '14px', boxSizing: 'border-box',
    border: '1.5px solid #d1d5db', borderRadius: 12, background: '#fff',
    fontSize: 16, color: '#1B2A4A', fontFamily: 'inherit', outline: 'none',
  };

  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      padding: 16,
      marginBottom: 14,
      border: `1.5px solid ${required && !valid ? '#fcd34d' : '#e5e7eb'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1B2A4A', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Time on job
          {required && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: valid ? '#16a34a' : '#d97706' }}>
              {valid ? '✓ set' : 'required'}
            </span>
          )}
        </div>
        {hasInput && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: (belowMin || overLong) ? '#b45309' : '#1a8a8a' }}>
              ⏱ {formatElapsed(displayMs)}
            </div>
            {spanLabel && (
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginTop: 2 }}>{spanLabel}</div>
            )}
          </div>
        )}
      </div>

      <input
        inputMode="decimal"
        value={v.manualHours}
        onChange={e => set({ manualHours: e.target.value })}
        placeholder="Hours worked — e.g. 1.5"
        style={inp}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 2px' }}>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>or clock in / out</span>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <input value={v.timeIn}  onChange={e => set({ timeIn: e.target.value })}  placeholder="In · 9:30am"  style={inp} />
        <input value={v.timeOut} onChange={e => set({ timeOut: e.target.value })} placeholder="Out · 1:30pm" style={inp} />
      </div>

      {required && !valid && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#b45309' }}>
          {belowMin
            ? 'Must be more than 6 minutes.'
            : 'Enter hours worked, or a clock-in and clock-out time.'}
        </div>
      )}

      {overLong && (
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: '#b45309' }}>
          That reads as {formatElapsed(displayMs)}. Check am/pm on both times.
        </div>
      )}
    </div>
  );
}
