// ── MERGE = UNION, NEVER CONDENSE ─────────────────────────────────────────────
// Merging two cards means "these are the same job": everything on the card
// going away that is new or different from the card that stays must come
// along, with its history intact. Which card is "newer" decides nothing —
// if a return card is accidentally merged INTO the scheduled card, the
// return card's notes, hours and return reason still come across whole.
//
// Pure functions only (no supabase import) so they can be unit-tested.

// Contact / access / scheduling fields: the survivor keeps its own value,
// the dead card only fills a blank.
export const FILL_GAP_FIELDS = [
  'issue', 'customer_id', 'customer_phone', 'customer_address', 'customer_email',
  'cms_account_id', 'gate_code', 'panel_password',
  'site_contact_name', 'site_contact_phone',
  'assigned_to', 'tech_assigned', 'tech_name',
  'scheduled_date', 'estimated_hours', 'hours_budget', 'hourly_rate',
];

// Event links travel with their calendar id.
export const EVENT_PAIRS = [
  ['calendar_event_id', 'calendar_id'],
  ['scheduled_event_id', 'scheduled_calendar_id'],
  ['tentative_event_id', 'tentative_date'],
];

// Free-text work fields: when both cards have something different, KEEP BOTH.
// (completion_notes is not here — it is carried as its own dated note.)
export const APPEND_TEXT_FIELDS = ['materials_used', 'parts', 'parts_notes', 'return_reason'];

// Billing identifiers are never silently overwritten or dropped: if the dead
// card has one, it is written into the survivor's history as a dated record.
export const RECORD_ONLY_FIELDS = [
  'invoice_number', 'invoice_ref', 'invoice_id', 'materials_invoice_number',
  'materials_cost', 'materials_invoiced', 'estimate_amount', 'invoiced_amount',
  'deposit_amount', 'qbo_estimate_ref', 'p_number', 's_number',
];

const blank = v => v == null || (typeof v === 'string' && v.trim() === '');

export const fmtDay = iso => {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown date'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Returns { patch, record } — patch is the update for the survivor's jobs row;
// record is a list of "field: value" strings that could not be merged into a
// column without overwriting something, so they go into history instead.
export function buildSurvivorPatch(dead, survivor) {
  const patch = {};
  const record = [];

  for (const f of FILL_GAP_FIELDS) {
    if (blank(survivor[f]) && !blank(dead[f])) patch[f] = dead[f];
  }

  for (const [idCol, pairCol] of EVENT_PAIRS) {
    if (blank(survivor[idCol]) && !blank(dead[idCol])) {
      patch[idCol] = dead[idCol];
      if (!blank(dead[pairCol])) patch[pairCol] = dead[pairCol];
    } else if (!blank(dead[idCol]) && dead[idCol] !== survivor[idCol]) {
      record.push(`${idCol}: ${dead[idCol]}`);
    }
  }

  const tag = `— from merged card (${fmtDay(dead.created_at)}):`;
  for (const f of APPEND_TEXT_FIELDS) {
    const d = blank(dead[f]) ? '' : String(dead[f]).trim();
    if (!d) continue;
    const s = blank(survivor[f]) ? '' : String(survivor[f]).trim();
    if (!s) patch[f] = d;
    else if (!s.includes(d)) patch[f] = `${s}\n\n${tag} ${d}`;
  }

  // Hours worked on either card are hours worked on the job. Add them.
  const dh = Number(dead.actual_hours);
  if (dead.actual_hours != null && Number.isFinite(dh) && dh !== 0) {
    const sh = Number(survivor.actual_hours) || 0;
    patch.actual_hours = Math.round((sh + dh) * 100) / 100;
  }

  for (const f of RECORD_ONLY_FIELDS) {
    if (!blank(dead[f]) && dead[f] !== survivor[f]) record.push(`${f}: ${dead[f]}`);
  }

  return { patch, record };
}

// A merged-away card points at its survivor via action_note. Used to follow
// chains (A→B, then B→C) so nothing lands on a card that is itself dead.
export const MERGED_INTO_RE = /Merged into job ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function mergedIntoId(job) {
  if (!job || job.status !== 'dead') return null;
  const m = MERGED_INTO_RE.exec(job.action_note || '');
  return m ? m[1] : null;
}

// Board snippet: a note carried in from a merged card is a real human note
// with its real date. Strip the carry prefix so it can be "the latest note".
export function unwrapCarriedNote(text) {
  return String(text || '').replace(/^↪\s*from merged job\s*\([^)]*\)\s*:\s*/i, '').trim();
}
