// ============================================
// Staleness — the 72-hour rule, in one place
// ============================================
// A job that hasn't been touched in 3 days is a job nobody is working.
// Board cards, the dashboard alert panel, and anything else that needs to
// judge "is this rotting?" all read from HERE so the rule can never drift
// between screens.

export const STALE_HOURS     = 72;   // amber — nobody has touched this in 3 days
export const VERY_STALE_HOURS = 168; // red — a full week

export function hoursSince(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

// "3d" / "5h" / "2w" — compact age label for a card
export function ageLabel(iso) {
  const h = hoursSince(iso);
  if (h < 1)  return 'just now';
  if (h < 24) return `${Math.round(h)}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

// Terminal statuses can't go stale — they're finished, not rotting.
const TERMINAL = ['complete', 'billed', 'archived', 'dead', 'lost', 'won'];

// Returns { level, hours, label } where level is 'ok' | 'stale' | 'very_stale'.
// Reads updated_at, falling back to created_at for rows that predate stamping.
export function stalenessOf(job) {
  if (!job || TERMINAL.includes(job.status)) return { level: 'ok', hours: 0, label: null };
  const last = job.updated_at || job.created_at;
  const h = hoursSince(last);
  if (h >= VERY_STALE_HOURS) return { level: 'very_stale', hours: h, label: `${ageLabel(last)} no update` };
  if (h >= STALE_HOURS)      return { level: 'stale',      hours: h, label: `${ageLabel(last)} no update` };
  return { level: 'ok', hours: h, label: null };
}

export const STALE_COLOR = { ok: null, stale: '#f59e0b', very_stale: '#ef4444' };
