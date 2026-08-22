// ============================================
// weekHours — this week, in hours, from the rows that already exist.
// ============================================
// "This requires zero new logic. Zero."
//
// Correct. Every number here is a SUM of `time_entries.total_minutes` sliced by
// something already stored — the disposition the tech picked, or the job the
// entry points at. Nothing is derived, inferred, or estimated. This file exists
// so the home tiles and the Billing screen read the same rows the same way; two
// places computing "project hours this week" independently is how they end up
// disagreeing by four hours and nobody knows which is right.
//
// ── THE WEEK ────────────────────────────────────────────────────────────────
// Monday 00:00 local through the following Monday. Matching Postgres's
// date_trunc('week'), so a number checked in SQL and a number on the screen
// cover the same days.
//
// ── THE BUCKETS ─────────────────────────────────────────────────────────────
//   project    hours against a fixed-fee job or a project card, or an entry
//              explicitly flagged as covered by the price. These are COST, not
//              an invoice line.
//   returns    hours you cannot invoice until somebody goes back. The tech
//              said `return`, or the card is sitting in return_pending.
//   billable   the tech said bill it and nobody has invoiced it yet.
//   settled    already billed.
//   other      logged, and in none of the above. Usually `in_progress` — real
//              work, mid-job, not yet anything. This is the bucket worth
//              watching: 12 of this week's 21.8 hours were sitting in it.
//
// Order matters and is deliberate: an hour lands in exactly ONE bucket, and the
// contract outranks the disposition — see utils/jobResolve.js for why.

import { supabase } from '../services/supabase.js';

export function weekBounds(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday. Monday is the start, so Sunday counts back six.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  const end = new Date(d);
  end.setDate(end.getDate() + 7);
  return { start: d, end };
}

const h = (mins) => Math.round(((mins || 0) / 60) * 10) / 10;

export async function weekHours(now = new Date()) {
  const { start, end } = weekBounds(now);
  const empty = {
    start, end, total: 0, project: 0, returns: 0, billable: 0, settled: 0, other: 0,
    visits: 0, unlinked: 0, unlinkedHours: 0,
  };

  const { data: ents, error } = await supabase
    .from('time_entries')
    .select('id, job_id, total_minutes, disposition, billed, billable, archived, event_start')
    .gte('event_start', start.toISOString())
    .lt('event_start', end.toISOString())
    .limit(2000);
  if (error) { console.warn('weekHours:', error.message); return empty; }

  const rows = (ents || []).filter(e => !e.archived);
  if (!rows.length) return empty;

  // One read for the jobs these entries point at. Entries with a null job_id —
  // six of nine this week — simply have no job to ask about, which is itself
  // the answer.
  const ids = [...new Set(rows.map(e => e.job_id).filter(Boolean))];
  let byId = {};
  if (ids.length) {
    const { data: jobs } = await supabase
      .from('jobs').select('id, status, is_fixed_fee, job_type').in('id', ids);
    byId = Object.fromEntries((jobs || []).map(j => [j.id, j]));
  }

  const out = { ...empty };
  for (const e of rows) {
    const m = e.total_minutes || 0;
    const j = e.job_id ? byId[e.job_id] : null;
    out.total += m;
    out.visits += 1;
    if (!e.job_id) { out.unlinked += 1; out.unlinkedHours += m; }

    if (j?.is_fixed_fee || j?.job_type === 'project' || e.billable === false) out.project += m;
    else if (e.disposition === 'return' || j?.status === 'return_pending')    out.returns += m;
    else if (e.billed)                                                        out.settled += m;
    else if (e.disposition === 'bill_it')                                     out.billable += m;
    else                                                                      out.other += m;
  }

  for (const k of ['total', 'project', 'returns', 'billable', 'settled', 'other', 'unlinkedHours']) {
    out[k] = h(out[k]);
  }
  return out;
}

// ── SCHEDULED vs LOGGED ─────────────────────────────────────────────────────
// "A Scheduled Hours card, and an over-under: logged / not logged."
//
// ONE HONEST LIMIT, SAID OUT LOUD: `jobs` has no duration column. A booking's
// LENGTH lives only on the Google Calendar event, so scheduled HOURS cannot be
// summed from the database at all — only scheduled VISITS can, and then whether
// each one produced hours. That is the over-under, and it is the part that
// actually matters: a visit with nothing logged is invisible work.
//
// Counting hours here would mean inventing a duration per visit, which is the
// kind of number that gets believed and then quietly wrong.
export async function weekScheduled(now = new Date()) {
  const { start, end } = weekBounds(now);
  const iso = d => d.toISOString().slice(0, 10);
  const out = { booked: 0, logged: 0, missing: 0, loggedHours: 0, start, end };

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, scheduled_date, status')
    .gte('scheduled_date', iso(start))
    .lt('scheduled_date', iso(end))
    .not('status', 'in', '(dead,archived,lost)')
    .limit(500);
  if (error) { console.warn('weekScheduled:', error.message); return out; }

  const list = jobs || [];
  out.booked = list.length;
  if (!list.length) return out;

  const { data: ents } = await supabase
    .from('time_entries')
    .select('job_id, total_minutes, archived')
    .in('job_id', list.map(j => j.id)).limit(2000);

  const mins = {};
  (ents || []).filter(e => !e.archived).forEach(e => {
    mins[e.job_id] = (mins[e.job_id] || 0) + (e.total_minutes || 0);
  });
  out.logged = list.filter(j => mins[j.id] > 0).length;
  out.missing = out.booked - out.logged;
  out.loggedHours = h(Object.values(mins).reduce((t, m) => t + m, 0));
  return out;
}
