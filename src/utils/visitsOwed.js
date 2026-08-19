// ============================================
// visitsOwed — THE definition of "this visit still owes a disposition"
// ============================================
// There used to be three of these, and they disagreed:
//
//   1. DidYouGo    matched on job_id OR (customer_id + calendar day)
//   2. OpsHome     matched on calendar_event_id / scheduled_event_id
//   3. FieldVisits matched on calendar_event_id, falling back to customer_id
//
// So the Today tile could say "5 owed" while the DidYouGo card showed a
// different set, and a tech who had already written his notes still got
// nagged. Same question, three answers. This file is the only answer now.
//
// MATCH KEY. A time entry counts against a job if ANY of these line up:
//   • time_entries.job_id            = jobs.id                  (the real FK)
//   • time_entries.calendar_event_id = jobs.calendar_event_id
//   • time_entries.calendar_event_id = jobs.scheduled_event_id
//
// All three are required, and dropping any one of them reintroduces a bug we
// already had. Jeanneret is the standing proof: its calendar_event_id and its
// scheduled_event_id are DIFFERENT ids, so a check against either one alone
// reports a logged visit as missing.
//
// customer_id + day is deliberately NOT a match key. It was a heuristic
// covering for job_id being null on ~62% of rows, and it silently suppressed
// second visits — one customer had six entries in a single day. A rule that
// hides real work is worse than the gap it patched.
//
// CUTOFF. Nothing before LEGACY_HOURS_CUTOFF is ever reported as owed. Those
// visits are billed and closed; re-opening them would bury the techs in
// prompts for work finished months ago. See src/config/legacy.js.

import { supabase } from '../services/supabase.js';
import { LEGACY_HOURS_CUTOFF } from '../config/legacy.js';
import { JOB_STATUS } from '../services/supabase.js';

// Statuses that can owe a disposition. A visit that happened but was left in
// return_pending still owes one — the old OpsHome tile filtered to 'scheduled'
// only, which is why Boys & Girls Club and Heikens never appeared in the count.
const OWEABLE = [
  JOB_STATUS.SCHEDULED,
  JOB_STATUS.RETURN_PENDING,
  JOB_STATUS.IN_PROGRESS,
].filter(Boolean);

// Statuses that are finished business and never owe anything.
const CLOSED = ['archived', 'dead', 'billed', 'lost'];

function todayISO() {
  // Denver, not UTC. A job scheduled today is not owed until the day is over,
  // and UTC rolls at 6pm local — which reported same-day jobs as overdue.
  const now = new Date();
  const denver = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  return denver.toISOString().slice(0, 10);
}

/**
 * Visits that happened and still have no time entry against them.
 *
 * @param {object}   opts
 * @param {string[]} [opts.techNames]  limit to these techs (the DidYouGo card
 *                                     shows a tech only his own work; the
 *                                     OpsHome tile passes nothing and counts all)
 * @param {string}   [opts.since]      ISO date floor; defaults to the cutoff
 * @param {number}   [opts.limit]      max jobs to inspect, default 200
 * @returns {Promise<Array>} job rows, oldest first — each genuinely owed
 */
export async function visitsOwed({ techNames = null, since = null, limit = 200 } = {}) {
  const floor = since || LEGACY_HOURS_CUTOFF;
  const today = todayISO();

  let q = supabase
    .from('jobs')
    .select('id, customer_id, customer_name, tech_name, status, scheduled_date, calendar_event_id, scheduled_event_id, calendar_id, scheduled_calendar_id')
    .gte('scheduled_date', floor)
    .lt('scheduled_date', today)        // strictly before today — today isn't over
    .not('status', 'in', `(${CLOSED.join(',')})`)
    .order('scheduled_date', { ascending: true })
    .limit(limit);

  if (OWEABLE.length) q = q.in('status', OWEABLE);
  if (techNames?.length) q = q.in('tech_name', techNames);

  const { data: jobs, error } = await q;
  if (error) throw error;
  if (!jobs?.length) return [];

  // One round trip for the entries, matched on all three keys.
  const jobIds = jobs.map(j => j.id);
  const eventIds = [...new Set(
    jobs.flatMap(j => [j.calendar_event_id, j.scheduled_event_id]).filter(Boolean)
  )];

  const filters = [`job_id.in.(${jobIds.join(',')})`];
  if (eventIds.length) filters.push(`calendar_event_id.in.(${eventIds.join(',')})`);

  const { data: entries, error: eErr } = await supabase
    .from('time_entries')
    .select('job_id, calendar_event_id')
    .or(filters.join(','))
    .eq('archived', false);
  if (eErr) throw eErr;

  const byJob = new Set((entries || []).map(e => e.job_id).filter(Boolean));
  const byEvent = new Set((entries || []).map(e => e.calendar_event_id).filter(Boolean));

  return jobs.filter(j =>
    !byJob.has(j.id) &&
    !(j.calendar_event_id && byEvent.has(j.calendar_event_id)) &&
    !(j.scheduled_event_id && byEvent.has(j.scheduled_event_id))
  );
}

/** Count only — same rule, for the OpsHome tile. */
export async function visitsOwedCount(opts = {}) {
  const rows = await visitsOwed({ ...opts, limit: 200 });
  return rows.length;
}
