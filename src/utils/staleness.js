// ============================================
// Staleness — the "nobody has said anything" rule
// ============================================
// Measures the last time a HUMAN COMMENTED (last_note_at), not the last time a
// row was written. updated_at bumps on any status move or assignment, so a job
// could be dragged around the board all week and never look stale even though
// nobody actually said a word about it.
//
// The wall is MOVEABLE. Sara sets it from the Board header; it lives in
// localStorage so it survives reloads and is per-person — moving your wall does
// not change what anyone else sees. 'off' kills the pulse entirely.

const STALE_KEY = 'ow_stale_days';

export const STALE_OPTIONS = [
  { key: '1',   label: '1 day',   days: 1 },
  { key: '3',   label: '3 days',  days: 3 },
  { key: '7',   label: '7 days',  days: 7 },
  { key: '14',  label: '14 days', days: 14 },
  { key: 'off', label: 'Off',     days: null },
];

export function getStaleDays() {
  try {
    const v = localStorage.getItem(STALE_KEY);
    if (v === 'off') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
  } catch { return 3; }
}

export function setStaleDays(key) {
  try { localStorage.setItem(STALE_KEY, String(key)); } catch { /**/ }
}

// Red kicks in at ~2.3x the amber wall — so moving the wall moves both.
function thresholds() {
  const d = getStaleDays();
  if (d === null) return null;
  return { stale: d * 24, veryStale: d * 24 * 2.33 };
}

// Kept for the alert engine, which uses a fixed org-wide threshold.
export const STALE_HOURS      = 72;
export const VERY_STALE_HOURS = 168;

export function hoursSince(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

export function ageLabel(iso) {
  const h = hoursSince(iso);
  if (h < 1)  return 'just now';
  if (h < 24) return `${Math.round(h)}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

// Terminal work is finished, not rotting.
const TERMINAL = ['complete', 'billed', 'archived', 'dead', 'lost', 'won'];

// A job is stale when nobody has SAID or DONE anything about it — a typed note
// or a real status move both reset the clock. BoardView computes last_note_at;
// see the comment there for what counts and why updated_at does not.
export function stalenessOf(job) {
  if (!job || TERMINAL.includes(job.status)) return { level: 'ok', hours: 0, label: null };
  const T = thresholds();
  if (!T) return { level: 'ok', hours: 0, label: null };   // wall is off
  const last = job.last_note_at || job.created_at;
  const h = hoursSince(last);
  // "no comment" was a lie once status moves started counting — a card could
  // have been worked twice today and still say nobody commented. "no activity"
  // is what this actually measures.
  const word = job.last_note_at ? 'no activity' : 'never touched';
  if (h >= T.veryStale) return { level: 'very_stale', hours: h, label: `${ageLabel(last)} ${word}` };
  if (h >= T.stale)     return { level: 'stale',      hours: h, label: `${ageLabel(last)} ${word}` };
  return { level: 'ok', hours: h, label: null };
}

export const STALE_COLOR = { ok: null, stale: '#f59e0b', very_stale: '#ef4444' };

// ── DISPOSITION DEADLINE ────────────────────────────────────────────────────
// Scheduled work is a promise. Once the day is over somebody has to say what
// happened — Bill it, Return, Estimate, In progress. Until they do there is no
// disposition, so no time entry, so nothing to invoice and nothing anyone
// downstream can read. A silent visit is indistinguishable from one that never
// occurred.
//
// THE RULE (Sara, 2026-08-13): the day ends at 6pm. Fourteen hours later —
// 8am the next morning — a disposition is overdue. Weekends do not count, so
// a Friday visit is not late until Monday 8am. Nobody is being chased at the
// weekend for Friday's paperwork.
//
// Deliberately keyed on STATUS, not on notes. If the tech had dispositioned it
// on the finish sheet the status would have moved off `scheduled`. Notes can be
// written against an old visit and dragging a card writes history without
// saying anything — neither proves this visit was written up. Status does.
export const DAY_ENDS_HOUR = 18;          // 6pm
export const DISPOSITION_GRACE_HOURS = 14; // -> 8am next day

export function dispositionDueAt(scheduledDate) {
  if (!scheduledDate) return null;
  // Parse the parts. jobs.scheduled_date is a DATE, and new Date('2026-08-07')
  // is UTC midnight, which is the previous evening in Denver.
  const [y, m, d] = String(scheduledDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d, DAY_ENDS_HOUR, 0, 0, 0);
  due.setHours(due.getHours() + DISPOSITION_GRACE_HOURS);
  // Land on a weekend and it waits for Monday morning.
  while (due.getDay() === 0 || due.getDay() === 6) {
    due.setDate(due.getDate() + 1);
    due.setHours(8, 0, 0, 0);
  }
  return due;
}

// Still sitting in `scheduled` past the deadline = nobody wrote it up.
export function needsDisposition(job, now = new Date()) {
  if (!job || job.status !== 'scheduled' || !job.scheduled_date) return false;
  const due = dispositionDueAt(job.scheduled_date);
  return !!due && now > due;
}
