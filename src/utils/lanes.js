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

export const LANES = [
  {
    key: 'triage',
    label: 'New / Notes',
    icon: '📝',
    color: '#ef4444',
    // Where a job LANDS when sent here.
    target: 'new',
    // Statuses that render in this lane.
    statuses: ['new', 'needs_details', 'needs_parts', 'pending_materials', 'pending_decision', 'blocked'],
    // What choosing this means, in the words a person would use.
    means: 'Not actionable yet — needs info, parts or a decision',
  },
  {
    key: 'ready',
    label: 'Ready to Schedule',
    icon: '✅',
    color: '#22c55e',
    target: 'ready_to_schedule',
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

// Billing is a real destination but lives on its own screen, so it is offered
// as a move without being a board column.
export const BILLING_LANE = {
  key: 'billing',
  label: 'Done — To Bill',
  icon: '💵',
  color: '#22c55e',
  target: 'to_bill',
  statuses: ['complete', 'to_bill', 'billed'],
  means: 'Work finished — hours go to Billing to invoice',
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

export const ALL_LANES = [...LANES, BILLING_LANE, CLEAR_LANE];

const STATUS_TO_LANE = {};
ALL_LANES.forEach(l => l.statuses.forEach(s => { STATUS_TO_LANE[s] = l; }));

// Which lane a job is currently sitting in. A tentative hold wins over the
// underlying status, because that is what the board shows.
export function laneOf(job) {
  if (!job) return null;
  if (job.tentative_date && job.status !== 'scheduled') {
    return LANES.find(l => l.key === 'tentative');
  }
  return STATUS_TO_LANE[job.status] || null;
}

export const laneLabel = (job) => laneOf(job)?.label || job?.status || 'Unknown';
export const laneColor = (job) => laneOf(job)?.color || '#64748b';

// The moves offered from where a job is now — every lane except its own.
// Deliberately NOT a restrictive transition table: the old one had five
// statuses with no exits at all, so those tickets could not be moved.
export function movesFor(job, { includeBilling = true, includeClear = true } = {}) {
  const here = laneOf(job)?.key;
  return [
    ...LANES,
    ...(includeBilling ? [BILLING_LANE] : []),
    ...(includeClear ? [CLEAR_LANE] : []),
  ].filter(l => l.key !== here);
}
