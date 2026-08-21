// ============================================
// lanes — the five destinations. One definition. Everywhere.
// ============================================
// THE PROBLEM THIS EXISTS TO END
//   A job's destination was defined in at least four places:
//     BoardView.COLUMNS      — what the swim lanes are called
//     BoardView.LANE_MOVES   — what the move buttons are called
//     MoveStatus.MOVES       — what the ticket panel offers
//     JobFinishSheet.DISPOS  — what a tech picks in the field
//   They drifted. The board said "New / Notes", the mover said "Triage", the
//   field sheet said "Needs estimate", and Tentative existed in one of them.
//   Same card, four vocabularies, and a destination you could see but not reach.
//
// Everything that moves a job imports from here. If a label needs changing, it
// changes once and every screen follows.

// BLOCKED IS NOT INTAKE. It was folded into triage, so a $65,688 job waiting
// on a customer read as "New / Notes" — unfiled, unlooked-at, indistinguishable
// from something nobody had typed a scope into yet. Blocked is the one state a
// person asserts on purpose, and it is the only one that carries a reason.
export const BLOCKED_LANE = {
  key: 'blocked',
  label: 'Blocked',
  icon: '🛑',
  color: '#ef4444',
  target: 'blocked',
  statuses: ['blocked'],
  means: 'Cannot move until something outside us changes \u2014 say what',
};

export const LANES = [
  {
    key: 'triage',
    label: 'New / Notes',
    icon: '📝',
    color: '#ef4444',
    // Where a job LANDS when sent here.
    target: 'new',
    // Statuses that render in this lane.
    statuses: ['new', 'needs_details', 'needs_parts', 'pending_materials', 'pending_decision'],
    // What choosing this means, in the words a person would use.
    means: 'Not actionable yet — needs info, parts or a decision',
  },
  {
    key: 'ready',
    label: 'Ready to Schedule',
    icon: '✅',
    color: '#22c55e',
    target: 'ready_to_schedule',
    // return_pending RENDERS in this column (one scheduling queue on the
    // board) but it is NOT the same thing — see RETURN_LANE below.
    statuses: ['ready_to_schedule', 'return_pending'],
    means: 'Good to go — someone needs to put it on a calendar',
  },
  {
    key: 'tentative',
    label: 'Tentative',
    icon: '✏️',
    color: '#f59e0b',
    // No target status: a hold is an overlay on tentative_date, not a status.
    // Choosing it opens the scheduler, because a hold needs a date.
    virtual: 'tentative',
    needsScheduler: 'hold',
    statuses: [],
    means: 'Pencilled in on the Tent calendar — nobody booked yet',
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    icon: '📅',
    color: '#3b82f6',
    // Also scheduler-only. Marking this by hand is what produced nine
    // "scheduled" jobs with no date, no tech and no calendar event.
    needsScheduler: 'book',
    statuses: ['scheduled'],
    means: 'A tech is booked and it is on their calendar',
  },
  {
    key: 'estimates',
    label: 'Estimates',
    icon: '📋',
    color: '#a855f7',
    target: 'needs_estimate',
    statuses: ['needs_estimate', 'estimate_sent', 'won', 'lost'],
    means: 'Priced work — waiting on a number or on the customer',
  },
];

// A RETURN is not "ready to schedule." Ready means fresh work waiting for a
// slot. Return means work STARTED and somebody has to go back — it carries a
// reason, it feeds return_cards, and treating the two as one erases why the
// truck is rolling twice. It shares the Ready COLUMN (one scheduling queue)
// but is its own destination with its own name everywhere else.
export const RETURN_LANE = {
  key: 'return',
  label: 'Return Visit',
  icon: '🔄',
  color: '#d97706',
  target: 'return_pending',
  statuses: ['return_pending'],
  means: 'Work started — needs another trip. Say why.',
};

// Billing is a real destination but lives on its own screen, so it is offered
// as a move without being a board column.
export const BILLING_LANE = {
  key: 'billing',
  label: 'Done — To Bill',
  icon: '💵',
  color: '#22c55e',
  target: 'to_bill',
  // 'billed' USED TO LIVE HERE. That was wrong twice over: a paid job rendered
  // as "Done — To Bill" forever, and because no lane had target:'billed' there
  // was no way to reach it — the only exits from To Bill were back to a work
  // lane or Clear, which archives the job and throws away the fact it was
  // invoiced. Eight jobs with real invoice numbers were stuck like that.
  statuses: ['complete', 'to_bill'],
  means: 'Work finished — hours go to Billing to invoice',
};

// Invoiced and closed. The end of the line, and now actually reachable.
export const BILLED_LANE = {
  key: 'billed',
  label: 'Billed',
  icon: '💰',
  color: '#6b7280',
  target: 'billed',
  statuses: ['billed'],
  means: 'Invoiced — nothing further owed on it',
};

// Leaves the active board without touching money. For test rows and dupes.
export const CLEAR_LANE = {
  key: 'clear',
  label: 'Clear (not billable)',
  icon: '🗑️',
  color: '#94a3b8',
  target: 'archived',
  statuses: ['archived', 'dead'],
  means: 'Not real work — remove it without billing anything',
};

export const ALL_LANES = [...LANES, RETURN_LANE, BILLING_LANE, BILLED_LANE, CLEAR_LANE];

const STATUS_TO_LANE = {};
// Order matters: RETURN_LANE registers LAST so return_pending resolves to
// Return (its identity), not Ready (the column it happens to render in).
[...LANES, BLOCKED_LANE, BILLING_LANE, BILLED_LANE, CLEAR_LANE, RETURN_LANE]
  .forEach(l => l.statuses.forEach(s => { STATUS_TO_LANE[s] = l; }));

// Which lane a job is currently sitting in. A tentative hold wins over the
// underlying status, because that is what the board shows.
// A hold is a PENCIL MARK ON OPEN WORK. It was outranking every status except
// 'scheduled', so a job that got held, worked and marked To Bill stayed in the
// Tentative column with a "To Bill" chip on it — the board showing a plan for
// work that was already finished. A hold can only win while the job is still
// open; once it reaches a settled status the hold is history, not a location.
const SETTLED = ['complete', 'to_bill', 'billed', 'won', 'lost', 'dead', 'archived'];
export const isSettled = (job) => SETTLED.includes(job?.status);

export function laneOf(job) {
  if (!job) return null;
  if (job.tentative_date && job.status !== 'scheduled' && !isSettled(job)) {
    return LANES.find(l => l.key === 'tentative');
  }
  return STATUS_TO_LANE[job.status] || null;
}

// The board used to inline this test twice to build its columns, which is how
// the rule and the lane could disagree. Ask laneOf; don't re-derive it.
export const isHeld = (job) => laneOf(job)?.key === 'tentative';

export const laneLabel = (job) => laneOf(job)?.label || job?.status || 'Unknown';
export const laneColor = (job) => laneOf(job)?.color || '#64748b';

// The moves offered from where a job is now — every lane except its own.
// Deliberately NOT a restrictive transition table: the old one had five
// statuses with no exits at all, so those tickets could not be moved.
// ── Estimate sub-status moves ───────────────────────────────────────────────
// These are not lanes — they are steps within the Estimates lane. They only
// appear when the job is already in the estimates flow so the full board list
// does not drown them out.
// EVERY ENTRY HERE NEEDS A `target`. These were written with only `key`, while
// every lane above carries `target` — and TicketSheet commits a move with
// `onMove(lane.target)`. So `target` was undefined, supabase-js dropped the
// undefined `status` out of the PATCH body, the row came back unchanged, and
// the UI reported success. Sent / Won / Lost looked clickable and did nothing.
// That is why `won` has zero rows in the entire table.
const ESTIMATE_STEPS = [
  { key: 'needs_estimate', target: 'needs_estimate', icon: '📋', label: 'Needs Estimate', color: '#f59e0b', means: 'Not written yet — on us' },
  { key: 'estimate_sent',  target: 'estimate_sent',  icon: '📤', label: 'Estimate Sent',  color: '#3b82f6', means: 'Sent — waiting on customer' },
  { key: 'won',            target: 'won',            icon: '🏆', label: 'Won',            color: '#10b981', means: 'Customer approved — schedule it' },
  { key: 'lost',           target: 'lost',           icon: '❌', label: 'Lost',           color: '#ef4444', means: 'Did not get the job' },
];

const ESTIMATE_STATUSES = new Set(ESTIMATE_STEPS.map(s => s.key));

// `mayBill` — whether the person looking at this ticket is the one who
// invoices. Defaults to FALSE on purpose: "Done — To Bill" is a statement of
// fact a tech is entitled to make, but "Billed" is a claim that an invoice
// went out, and a caller that forgets to say who is asking should get the
// safe answer rather than the permissive one.
export function movesFor(job, { includeBilling = true, includeClear = true, mayBill = false } = {}) {
  const here = laneOf(job)?.key;
  const currentStatus = job?.status;

  // A note or task is not work. Nobody drives to it, it has no scope, no
  // hours and no invoice — so the six-lane work ladder is nonsense on one.
  // Two things can happen to it: somebody does it, or it turns out to be
  // real work and becomes a job. Everything else on this list was noise.
  if (job?.job_type === 'note' || job?.job_type === 'task') {
    // A note has three exits and they are equals. Make it a job, hand it to
    // somebody as a task, or it is already handled. "Make it a task" is not in
    // this list because it is not a status move — it writes a row in `notes`
    // via the composer above, which is why it renders as its own button.
    return [
      { key: 'ready_to_schedule', target: 'ready_to_schedule', icon: '🔧', label: 'Make it a job',
        color: '#97c459', means: 'Real work — needs a customer, then a calendar' },
      { key: 'archived', target: 'archived', icon: '✅', label: 'Mark it done',
        color: '#22c55e', means: 'Handled. Stays on the customer record.' },
    ];
  }

  // When inside the estimates flow, show the sub-status steps instead of
  // the full board list. The full list is still available via "Move to" but
  // the primary options are the estimate progression.
  if (ESTIMATE_STATUSES.has(currentStatus)) {
    return [
      ...ESTIMATE_STEPS.filter(s => s.key !== currentStatus),
      // Escape hatches back to the main board. These were missing `target`
      // too, so an estimate job could not get out of the estimates flow either.
      { key: 'ready_to_schedule', target: 'ready_to_schedule', icon: '✅', label: 'Ready to Schedule', color: '#22c55e', means: 'Estimate won — put it on the calendar' },
      { key: 'new',               target: 'new',               icon: '📝', label: 'Back to New/Notes',  color: '#94a3b8', means: 'Not ready yet — needs more info' },
      // The old comment claimed the full list was "still available via Move to."
      // There is no such control — this list IS the control. Billing and Clear
      // were therefore unreachable from any estimate status, which is how a
      // needs_estimate note with nothing behind it could never be cleared.
      ...(includeBilling ? [BILLING_LANE] : []),
      ...(includeClear ? [CLEAR_LANE] : []),
    ];
  }

  // Billed is only a sensible destination for work that is actually finished.
  const finished = ['complete', 'to_bill', 'billed'].includes(currentStatus);
  // ── NEW HAS TWO EXITS ────────────────────────────────────────────────
  // Anything sitting in New either gets a person on it — which makes it a
  // task, done with Create a task on the ticket — or it is real work and
  // becomes Ready to Schedule. Offering the whole ladder from New is how a
  // brand-new card gets pushed straight to Estimates or Tentative before
  // anyone has decided what it is, and then ages there with no owner.
  // Clear stays: a card filed in error has to be able to leave.
  if (currentStatus === 'new') {
    const ready = LANES.find(l => l.key === 'ready' || l.target === 'ready_to_schedule');
    return [
      ...(ready ? [ready] : []),
      ...(includeClear ? [CLEAR_LANE] : []),
    ].filter(l => l.key !== here);
  }

  return [
    ...LANES.slice(0, 2),        // New/Notes, Ready
    RETURN_LANE,
    ...LANES.slice(2),           // Tentative, Scheduled, Estimates
    ...(includeBilling ? [BILLING_LANE] : []),
    ...(includeBilling && finished && mayBill ? [BILLED_LANE] : []),
    ...(includeClear ? [CLEAR_LANE] : []),
  ].filter(l => l.key !== here);
}
// jobs.scheduled_date is a DATE ('2026-08-28'), not a timestamp. new Date() on
// a bare date string reads it as UTC midnight, and in Denver that renders as
// the PREVIOUS DAY — Aug 28 showing up as Thu Aug 27. Every screen that
// printed a scheduled date was a day early. Split the parts and build a local
// Date so the day is the day.
export function localDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function fmtLocalDate(dateStr, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const dt = localDate(dateStr);
  return dt ? dt.toLocaleDateString('en-US', opts) : '';
}

export const COMMITTED_STATUSES = [
  "ready_to_schedule", "return_pending", "scheduled",
  "complete", "to_bill", "won",
];

export function requiresDisposition(job) {
  if (!job) return false;
  return COMMITTED_STATUSES.includes(job.status) || !!job.scheduled_date;
}
