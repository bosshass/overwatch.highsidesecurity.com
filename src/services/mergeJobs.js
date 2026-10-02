// ── ONE MERGE, EVERY SURFACE ──────────────────────────────────────────────────
// There were two merge buttons doing two different things. The board's
// MergeTool carried history; JobDetail's wrote ONE summary note
// ("🔗 MERGED FROM JOB… Issue: …") and archived the card — condensing it,
// with its hours, tasks and notes left behind on a card nobody opens again.
//
// A merge is a union: every note keeps its original date, every hour moves,
// every task / return card / text / assignment moves, and job-level fields
// that differ are kept side by side, not picked between. Direction does not
// matter — merging the return card into the scheduled card loses nothing.
import { supabase, notesApi } from './supabase.js';
import { CALENDARS } from '../config/calendars.js';
import { buildSurvivorPatch, mergedIntoId, fmtDay } from '../utils/mergeUnion.js';

// Tables whose rows belong to a job and must follow it to the survivor.
// time_entries is first and fatal: hours are never left behind.
const CHILD_TABLES = ['time_entries', 'clock_entries', 'notes', 'return_cards', 'messages', 'estimates'];

async function loadJob(id) {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single();
  if (error || !data) throw new Error(`Could not load job ${id}: ${error?.message || 'not found'}`);
  return data;
}

// If the chosen survivor was itself merged away, follow it to the live card.
async function resolveSurvivor(id, deadId) {
  let job = await loadJob(id);
  for (let hops = 0; hops < 10; hops++) {
    const next = mergedIntoId(job);
    if (!next) break;
    if (next === deadId) throw new Error('That card was merged into this one — pick a different card.');
    job = await loadJob(next);
  }
  if (job.id === deadId) throw new Error('Cannot merge a card into itself.');
  return job;
}

export async function mergeJobs({ deadJobId, survivorId, by = 'board', accessToken = null }) {
  const dead = await loadJob(deadJobId);
  const survivor = await resolveSurvivor(survivorId, deadJobId);
  const sid = survivor.id;
  const moved = {};
  let minutes = 0;

  // 1) MOVE EVERYTHING THAT HANGS OFF THE DEAD CARD. Any failure stops the
  //    merge before the card is killed — a half-merge must never strand hours.
  for (const table of CHILD_TABLES) {
    const { data, error } = await supabase.from(table)
      .update({ job_id: sid }).eq('job_id', dead.id).select(table === 'time_entries' ? 'id, total_minutes' : 'id');
    if (error) throw new Error(`Merge stopped — could not move ${table}: ${error.message}. Nothing was archived.`);
    moved[table] = (data || []).length;
    if (table === 'time_entries') minutes += (data || []).reduce((a, r) => a + (Number(r.total_minutes) || 0), 0);
  }
  // job_assignments is UNIQUE (job_id, tech_id, day_number): if both cards
  // had the same tech on the same day, that row can't move. Move what can,
  // and keep the hours/notes of any that can't as a dated history record.
  const assignmentRecord = [];
  moved.job_assignments = 0;
  {
    const { data: asg, error } = await supabase.from('job_assignments').select('*').eq('job_id', dead.id);
    if (error) throw new Error(`Merge stopped — could not read assignments: ${error.message}. Nothing was archived.`);
    for (const a of asg || []) {
      const { error: mErr } = await supabase.from('job_assignments').update({ job_id: sid }).eq('id', a.id);
      if (!mErr) { moved.job_assignments++; continue; }
      if (a.actual_hours || a.completion_notes?.trim() || a.time_in) {
        assignmentRecord.push(`day ${a.day_number ?? '?'} tech ${a.tech_id}: `
          + [a.actual_hours ? `${a.actual_hours}h` : null, a.time_in ? `in ${a.time_in}` : null,
             a.time_out ? `out ${a.time_out}` : null, a.completion_notes?.trim() || null].filter(Boolean).join(' · '));
      }
    }
  }

  // Visits logged against the dead card's calendar event but never linked by
  // job_id (FieldVisits matches on event ids too). Claim them for the survivor.
  const deadEvents = [dead.calendar_event_id, dead.scheduled_event_id, dead.tentative_event_id].filter(Boolean);
  if (deadEvents.length) {
    const { data, error } = await supabase.from('time_entries')
      .update({ job_id: sid }).is('job_id', null).in('calendar_event_id', deadEvents).select('id, total_minutes');
    if (error) throw new Error(`Merge stopped — could not move unlinked visits: ${error.message}. Nothing was archived.`);
    moved.time_entries += (data || []).length;
    minutes += (data || []).reduce((a, r) => a + (Number(r.total_minutes) || 0), 0);
  }

  // 2) CARRY THE DEAD CARD'S HISTORY WITH ITS ORIGINAL DATES. Field notes are
  //    skipped here — they live on the time entries that just moved, so they
  //    already show on the survivor once, at their real visit date.
  const status = survivor.status;
  const rows = [];
  const deadNotes = await notesApi.getAllForJob(dead.id);
  deadNotes
    .filter(n => n.source !== 'field' && n.text?.trim())
    .forEach(n => rows.push({
      job_id: sid, from_status: status, to_status: status,
      changed_by: n.created_by || by,
      notes: `↪ from merged job (${fmtDay(n.created_at)}): ${n.text}`,
      changed_at: n.created_at || dead.created_at,
    }));
  if (dead.issue?.trim() && dead.issue.trim() !== (survivor.issue || '').trim()) {
    rows.push({
      job_id: sid, from_status: status, to_status: status, changed_by: by,
      notes: `↪ merged job details (originally logged ${fmtDay(dead.created_at)}):\n${dead.issue.trim()}`,
      changed_at: dead.created_at || new Date().toISOString(),
    });
  }

  // 3) JOB-LEVEL FIELDS: fill blanks, keep both texts, add hours together,
  //    and write anything that would otherwise be overwritten into history.
  const { patch, record } = buildSurvivorPatch(dead, survivor);
  record.push(...assignmentRecord.map(r => `assignment ${r}`));
  if (record.length) {
    rows.push({
      job_id: sid, from_status: status, to_status: status, changed_by: by,
      notes: `📎 From merged card (${dead.customer_name || dead.id}, was "${dead.status}") — kept for the record:\n${record.join('\n')}`,
    });
  }
  const hrs = minutes ? ` (${(minutes / 60).toFixed(2)}h)` : '';
  rows.push({
    job_id: sid, from_status: status, to_status: status, changed_by: by,
    notes: `🔀 Merged in duplicate: ${dead.customer_name || dead.id} — history carried with original dates; `
      + `moved ${moved.time_entries} time entr${moved.time_entries === 1 ? 'y' : 'ies'}${hrs}, ${moved.notes} task(s), `
      + `${moved.return_cards} return card(s), ${moved.messages} text(s)`,
  });
  const { error: hErr } = await supabase.from('job_history').insert(rows);
  if (hErr) throw new Error(`Merge stopped — could not carry history: ${hErr.message}. Hours/tasks already moved; nothing was archived.`);

  if (Object.keys(patch).length) {
    patch.updated_by = by;
    const { error } = await supabase.from('jobs').update(patch).eq('id', sid);
    if (error) throw new Error(`Merge stopped — could not update the surviving card: ${error.message}`);
  }

  // 4) Retire the dead card's calendar event — unless the survivor just
  //    adopted that same event, in which case it is the live appointment.
  const adopted = Object.values(patch).includes(dead.calendar_event_id);
  if (accessToken && dead.calendar_event_id && dead.calendar_id && !adopted
      && dead.calendar_event_id !== survivor.calendar_event_id) {
    try {
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(dead.calendar_id)}/events/${encodeURIComponent(dead.calendar_event_id)}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
      );
    } catch (e) { console.warn('merge: calendar move failed', e); }
  }

  // 5) Only now is the merged card put away — ARCHIVED, not dead. It is
  //    still the record of that specific visit and stays on the customer's
  //    history; it just leaves the board. Its hours/tasks now live on the
  //    survivor, so nothing on it lands in Billing's "worked, then killed".
  const { error } = await supabase.from('jobs').update({
    status: 'archived',
    action_note: `Merged into job ${sid}`,
    updated_by: by,
    updated_at: new Date().toISOString(),
  }).eq('id', dead.id);
  if (error) throw error;
  try {
    await supabase.from('job_history').insert([{
      job_id: dead.id, from_status: dead.status, to_status: 'archived', changed_by: by,
      notes: `🔀 Merged into: ${survivor.customer_name || sid}`,
    }]);
  } catch (e) { console.warn('merge: dead-job event log failed', e); }

  return { survivorId: sid, survivor, moved, minutes };
}
