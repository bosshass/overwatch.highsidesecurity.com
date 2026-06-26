// ============================================
// JUC-E V3 - Status Machine
// ============================================

import { JOB_STATUS } from '../services/supabase.js';

// Linear "happy path". Users advance one step at a time along this sequence.
export const CORE_PATH = [
  JOB_STATUS.NEW,
  JOB_STATUS.NEEDS_DETAILS,
  JOB_STATUS.READY_TO_SCHEDULE,
  JOB_STATUS.SCHEDULED,
  JOB_STATUS.IN_PROGRESS,
  JOB_STATUS.COMPLETE,
  JOB_STATUS.TO_BILL,
  JOB_STATUS.BILLED,
  JOB_STATUS.ARCHIVED,
];

// Off-path states that branch from the core loop.
export const EXCEPTION_STATUSES = [
  JOB_STATUS.NEEDS_PARTS,
  JOB_STATUS.RETURN_PENDING,
  JOB_STATUS.SCHEDULE_SYNC_FAILED,
  JOB_STATUS.NEEDS_ESTIMATE,
  JOB_STATUS.ESTIMATE_SENT,
  JOB_STATUS.WON,
  JOB_STATUS.LOST,
  JOB_STATUS.CANCELLED,
];

// Hybrid model: each status offers its forward "happy path" step(s) first, then a
// fixed set of escape hatches that are always available so the operator can push a
// ticket To Bill / Billed / Archived / Dead, or back to Ready to Schedule, from
// anywhere (including un-archiving). Forward step(s) come first so they read as the
// default action; the order each list is built in is the order the buttons appear in.
const FORWARD_NEXT = {
  [JOB_STATUS.NEW]:                  [JOB_STATUS.NEEDS_DETAILS, JOB_STATUS.NEEDS_ESTIMATE],
  [JOB_STATUS.NEEDS_DETAILS]:        [JOB_STATUS.NEEDS_PARTS, JOB_STATUS.NEEDS_ESTIMATE],
  [JOB_STATUS.READY_TO_SCHEDULE]:    [JOB_STATUS.SCHEDULED, JOB_STATUS.NEEDS_DETAILS],
  [JOB_STATUS.SCHEDULED]:            [JOB_STATUS.IN_PROGRESS, JOB_STATUS.SCHEDULE_SYNC_FAILED],
  [JOB_STATUS.IN_PROGRESS]:          [JOB_STATUS.COMPLETE, JOB_STATUS.RETURN_PENDING, JOB_STATUS.NEEDS_PARTS, JOB_STATUS.NEEDS_ESTIMATE],
  [JOB_STATUS.COMPLETE]:             [JOB_STATUS.TO_BILL, JOB_STATUS.RETURN_PENDING, JOB_STATUS.NEEDS_ESTIMATE],
  [JOB_STATUS.TO_BILL]:              [JOB_STATUS.BILLED, JOB_STATUS.COMPLETE],
  [JOB_STATUS.BILLED]:               [JOB_STATUS.ARCHIVED],
  [JOB_STATUS.ARCHIVED]:             [],

  // Exception branches
  [JOB_STATUS.NEEDS_PARTS]:          [JOB_STATUS.READY_TO_SCHEDULE],
  [JOB_STATUS.RETURN_PENDING]:       [JOB_STATUS.SCHEDULED],
  [JOB_STATUS.SCHEDULE_SYNC_FAILED]: [JOB_STATUS.SCHEDULED],
  [JOB_STATUS.NEEDS_ESTIMATE]:       [JOB_STATUS.ESTIMATE_SENT],
  [JOB_STATUS.ESTIMATE_SENT]:        [JOB_STATUS.WON, JOB_STATUS.LOST, JOB_STATUS.NEEDS_ESTIMATE],
  [JOB_STATUS.WON]:                  [JOB_STATUS.READY_TO_SCHEDULE, JOB_STATUS.SCHEDULED, JOB_STATUS.TO_BILL],
  [JOB_STATUS.LOST]:                 [JOB_STATUS.ARCHIVED],
  [JOB_STATUS.CANCELLED]:            [JOB_STATUS.NEW],

  // Legacy statuses — exit-only into the new flow
  [JOB_STATUS.PENDING_DECISION]:     [JOB_STATUS.READY_TO_SCHEDULE, JOB_STATUS.NEEDS_PARTS, JOB_STATUS.NEEDS_ESTIMATE],
  [JOB_STATUS.PENDING_MATERIALS]:    [JOB_STATUS.READY_TO_SCHEDULE],
  [JOB_STATUS.DEAD]:                 [JOB_STATUS.NEW],
};

// Always-available operator overrides (escape hatches), appended after the
// forward step(s) for every status.
const ESCAPE_HATCHES = [
  JOB_STATUS.READY_TO_SCHEDULE,  // re-schedule / un-stick from anywhere
  JOB_STATUS.TO_BILL,            // Bill It from anywhere
  JOB_STATUS.BILLED,             // mark Billed from anywhere
  JOB_STATUS.DEAD,               // kill from anywhere
  JOB_STATUS.ARCHIVED,           // archive (and un-archive back into the flow)
];

export const VALID_TRANSITIONS = Object.fromEntries(
  Object.keys(FORWARD_NEXT).map(s => {
    const seen = new Set();
    const ordered = [...(FORWARD_NEXT[s] || []), ...ESCAPE_HATCHES]
      .filter(x => x !== s && !seen.has(x) && seen.add(x));
    return [s, ordered];
  })
);

export function canTransition(fromStatus, toStatus) {
  return (VALID_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function getNextStatuses(fromStatus) {
  return VALID_TRANSITIONS[fromStatus] || [];
}

export function isExceptionStatus(status) {
  return EXCEPTION_STATUSES.includes(status);
}

// The single "next logical" step along the core path (null at the end / off-path).
export function getPrimaryNext(fromStatus) {
  const idx = CORE_PATH.indexOf(fromStatus);
  if (idx === -1 || idx === CORE_PATH.length - 1) return null;
  return CORE_PATH[idx + 1];
}

// Actions
export const ACTIONS = {
  MARK_READY: { label: '✅ Ready to Schedule', toStatus: JOB_STATUS.READY_TO_SCHEDULE, color: '#22c55e' },
  NEEDS_DETAILS: { label: '📝 Needs Details', toStatus: JOB_STATUS.NEEDS_DETAILS, color: '#f97316' },
  NEEDS_PARTS: { label: '📦 Needs Parts', toStatus: JOB_STATUS.NEEDS_PARTS, color: '#eab308' },
  PENDING_DECISION: { label: '⏳ Pending Decision', toStatus: JOB_STATUS.PENDING_DECISION, color: '#a855f7' },
  MATERIALS_IN: { label: '🚚 Materials Received', toStatus: JOB_STATUS.READY_TO_SCHEDULE, color: '#22c55e' },
  SCHEDULE: { label: '📅 Schedule', toStatus: JOB_STATUS.SCHEDULED, color: '#3b82f6' },
  START_WORK: { label: '🔧 Start Work', toStatus: JOB_STATUS.IN_PROGRESS, color: '#0ea5e9' },
  RETRY_SYNC: { label: '🔁 Retry Calendar Sync', toStatus: JOB_STATUS.SCHEDULED, color: '#3b82f6' },
  // Finish Sheet dispositions — drive automated completion routing
  COMPLETE_FIXED: { label: '✅ Fixed', toStatus: JOB_STATUS.TO_BILL, color: '#22c55e' },
  COMPLETE_RETURN: { label: '🔄 Return Needed', toStatus: JOB_STATUS.RETURN_PENDING, color: '#f59e0b' },
  COMPLETE_SALES: { label: '📋 Needs Estimate', toStatus: JOB_STATUS.NEEDS_ESTIMATE, color: '#eab308' },
  COMPLETE_NC: { label: '🚫 No Charge', toStatus: JOB_STATUS.COMPLETE, color: '#6b7280' },
  COMPLETE_PARTS: { label: '📦 Pending Parts', toStatus: JOB_STATUS.NEEDS_PARTS, color: '#eab308' },
  MARK_BILLED: { label: '💰 Billed', toStatus: JOB_STATUS.BILLED, color: '#8b5cf6' },
  SEND_ESTIMATE: { label: '📤 Send Estimate', toStatus: JOB_STATUS.ESTIMATE_SENT, color: '#06b6d4' },
  MARK_WON: { label: '🎉 Won', toStatus: JOB_STATUS.WON, color: '#22c55e' },
  MARK_LOST: { label: '❌ Lost', toStatus: JOB_STATUS.LOST, color: '#6b7280' },
  MARK_CANCELLED: { label: '🚫 Cancel', toStatus: JOB_STATUS.CANCELLED, color: '#6b7280' },
  KICK_BACK: { label: '↩️ Kick Back', toStatus: JOB_STATUS.NEEDS_DETAILS, color: '#f97316' },
  ARCHIVE: { label: '📁 Archive', toStatus: JOB_STATUS.ARCHIVED, color: '#9ca3af' }
};

// Disposition -> action mapping for the Tech Finish Sheet (automated routing).
export const DISPOSITION_ROUTING = {
  fixed:          { toStatus: JOB_STATUS.TO_BILL, label: 'Fixed' },
  return_needed:  { toStatus: JOB_STATUS.RETURN_PENDING, label: 'Return Needed' },
  needs_estimate: { toStatus: JOB_STATUS.NEEDS_ESTIMATE, label: 'Needs Estimate' },
  no_charge:      { toStatus: JOB_STATUS.COMPLETE, label: 'No Charge' },
};

// Status groups for each role's view
export const STATUS_GROUPS = {
  ATC_TRIAGE: [JOB_STATUS.NEW, JOB_STATUS.NEEDS_DETAILS, JOB_STATUS.NEEDS_PARTS, JOB_STATUS.PENDING_MATERIALS],
  FLIGHT_DECK: [JOB_STATUS.READY_TO_SCHEDULE, JOB_STATUS.RETURN_PENDING],
  ACTIVE: [JOB_STATUS.SCHEDULED, JOB_STATUS.IN_PROGRESS, JOB_STATUS.SCHEDULE_SYNC_FAILED],
  BILLING: [JOB_STATUS.COMPLETE, JOB_STATUS.TO_BILL, JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT, JOB_STATUS.WON],
  TERMINAL: [JOB_STATUS.BILLED, JOB_STATUS.LOST, JOB_STATUS.CANCELLED, JOB_STATUS.DEAD, JOB_STATUS.ARCHIVED]
};

// Helpers
// Helpers — DRH-specific job types from Shana's SOP
export const JOB_TYPE_INFO = {
  service_res: { label: 'SVC - RESI', color: '#dc2626', icon: '🏠', full: 'Service Call - Residential', minutes: 60 },
  service_com: { label: 'SVC - COMM', color: '#b91c1c', icon: '🏢', full: 'Service Call - Commercial', minutes: 60 },
  return_trip: { label: 'RETURN', color: '#ec4899', icon: '🔄', full: 'Return Trip', minutes: 60 },
  install: { label: 'INSTALL', color: '#8b5cf6', icon: '🔨', full: 'New Install', minutes: null },
  new_construction: { label: 'NEW CONST', color: '#6d28d9', icon: '🏗️', full: 'New Construction Install', minutes: null },
  subcontractor: { label: 'SUB', color: '#0891b2', icon: '🤝', full: 'Subcontractor Job', minutes: null },
  government: { label: 'GOV', color: '#1d4ed8', icon: '🏛️', full: 'Government - Clearance', minutes: null },
  estimate: { label: 'ESTIMATE', color: '#0ea5e9', icon: '📐', full: 'Estimate', minutes: null },
  sales: { label: 'SALES', color: '#22c55e', icon: '💼', full: 'Sales Call', minutes: null },
  task: { label: 'TASK', color: '#f59e0b', icon: '📝', full: 'Internal Task', minutes: null },
  note: { label: 'NOTE', color: '#10b981', icon: '📌', full: 'Quick Note', minutes: null },
  service: { label: 'SERVICE', color: '#dc2626', icon: '🔧', full: 'Service Call (legacy)', minutes: 60 },
  project: { label: 'PROJECT', color: '#2563eb', icon: '📋', full: 'Project', minutes: null },
};

export const JOB_TYPE_PICKER = ['service_res', 'service_com', 'return_trip', 'install', 'new_construction', 'subcontractor', 'government', 'estimate', 'sales'];
export const INSTALL_TYPES = ['install', 'new_construction', 'subcontractor', 'government'];

// PRE-SCHEDULE CHECKLIST (Shana's SOP gates)
export const PRE_SCHEDULE_CHECKLIST = [
  { id: 'scope_defined', label: 'Scope clearly defined', auto: true },
  { id: 'tech_assigned', label: 'Technician assigned', auto: true },
  { id: 'parts_confirmed', label: 'Parts confirmed (in stock or ordered)', auto: true },
  { id: 'access_documented', label: 'Access info documented', auto: false },
  { id: 'client_availability', label: 'Client availability confirmed', auto: false },
  { id: 'notes_complete', label: 'Notes complete for tech', auto: false },
];

export function getChecklistState(job, assignments = [], manualChecks = {}) {
  const auto = {
    scope_defined: !!(job.issue && job.issue.trim().length > 3),
    tech_assigned: assignments.some(a => !a.is_complete),
    parts_confirmed: job.status !== 'needs_parts' && job.status !== 'pending_materials',
  };
  const state = {};
  PRE_SCHEDULE_CHECKLIST.forEach(item => {
    if (item.auto && auto[item.id] !== undefined) {
      state[item.id] = auto[item.id];
    } else {
      state[item.id] = !!(manualChecks[item.id]);
    }
  });
  return state;
}

export function getChecklistBlockers(checklistState) {
  return PRE_SCHEDULE_CHECKLIST.filter(item => !checklistState[item.id]);
}

export const PRIORITY_INFO = {
  urgent: { label: 'URGENT', color: '#dc2626', icon: '🔴' },
  high: { label: 'HIGH', color: '#f59e0b', icon: '🟠' },
  normal: { label: 'Normal', color: '#6b7280', icon: '⚪' },
  low: { label: 'Low', color: '#22c55e', icon: '🟢' }
};

export function getJobAge(createdAt) {
  if (!createdAt) return 0;
  const diffMs = Date.now() - new Date(createdAt).getTime();
  if (isNaN(diffMs)) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getAgeUrgency(days) {
  if (days >= 7) return { level: 'critical', color: '#dc2626', label: '7+ days' };
  if (days >= 4) return { level: 'overdue', color: '#f59e0b', label: '4-7 days' };
  if (days >= 2) return { level: 'attention', color: '#eab308', label: '2-3 days' };
  return { level: 'fresh', color: '#22c55e', label: 'Fresh' };
}
