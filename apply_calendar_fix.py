#!/usr/bin/env python3
"""
apply_calendar_fix.py — rescheduling moves the event; clearing removes it.

TWO BUGS, BOTH PROVABLE FROM THE DATA
  1. RESCHEDULE MAKES A SECOND EVENT.
     book() deletes the previous event only when the job it was handed carries
     both scheduled_event_id and scheduled_calendar_id. The board refreshes its
     LIST after booking (loadJobs) but never refreshes selectedJob — the object
     the open drawer is holding. So the drawer keeps a pre-booking copy where
     those fields are null, the delete is skipped, and a second event appears.
     The database stores the newest id, so the first event is orphaned on the
     calendar with nothing pointing at it.

     FIX: book() re-reads the job from the database instead of trusting what
     the caller passed. One query, and it ends the whole class of bug rather
     than this one path.

  2. CLEARING A JOB LEAVES THE EVENT ON THE CALENDAR.
     onJobComplete() in calendarSync.js is exported and called from NOWHERE.
     changeStatus writes the job row and stops. 46 jobs that are archived, dead,
     lost or billed still hold a live scheduled_event_id — 46 events sitting on
     tech calendars for work that is finished or cancelled.

     FIX: releaseCalendar() in schedule.js, called from TicketSheet whenever a
     move lands on a terminal status.

RUN FROM THE REPO ROOT:
    python3 apply_calendar_fix.py
    npm run verify
"""
import sys, pathlib

ROOT = pathlib.Path('.')
report = []
def log(s, w): report.append((s, w))

def patch(rel, edits):
    p = ROOT / rel
    if not p.exists():
        log('MISS', f'{rel} — not found'); return
    src = orig = p.read_text()
    for e in edits:
        label, old, new = e[0], e[1], e[2]
        marker = e[3] if len(e) > 3 else new
        if marker in src:
            log('SKIP', f'{rel}: {label}'); continue
        if old not in src:
            log('MISS', f'{rel}: {label}'); continue
        src = src.replace(old, new, 1)
        log('OK', f'{rel}: {label}')
    if src != orig: p.write_text(src)

# ── 1. book() re-reads the job ─────────────────────────────────────────────
patch('src/services/schedule.js', [
 ('book re-reads the job from the database',
  """export async function book({ job, tech, start, end, accessToken, helpers = [], byEmail = null }) {
  if (!job?.id) throw new Error('No job');""",
  """export async function book({ job, tech, start, end, accessToken, helpers = [], byEmail = null }) {
  if (!job?.id) throw new Error('No job');
  // NEVER TRUST THE PASSED JOB. The board refreshes its list after a booking
  // but not the object the open drawer is holding, so a second booking from
  // that same drawer arrived here with scheduled_event_id still null — the
  // delete below was skipped and a duplicate event was created. Re-read the
  // row: one query, and no caller anywhere can hand us a stale copy again.
  {
    const { data: fresh } = await supabase
      .from('jobs')
      .select('id, status, scheduled_event_id, scheduled_calendar_id, tentative_event_id, customer_address, customer_name, customer_id, job_number, issue')
      .eq('id', job.id)
      .single();
    if (fresh) job = { ...job, ...fresh };
  }""",
  'NEVER TRUST THE PASSED JOB'),

 ('releaseCalendar',
  "// ── READ: one answer to \"what is this job's scheduling state?\" ─────────",
  """// ── RELEASE: the job is over, take it off the calendar ─────────────────
// calendarSync.js has an onJobComplete() for this. It is exported and called
// from nowhere, so nothing has ever removed an event when a job was cleared —
// 46 archived/dead/lost/billed jobs are still holding live event ids and their
// events are still on tech calendars.
//
// Deleting is deliberate rather than renaming with a [BILLED] tag: a title tag
// is a string somebody has to parse back, and the whole point of this pass is
// to stop deriving meaning from text. The job row keeps the history.
export async function releaseCalendar({ job, accessToken }) {
  if (!job?.id) return;
  // Re-read for the same reason book() does — the caller's copy may predate
  // the booking that created these ids.
  const { data: fresh } = await supabase
    .from('jobs')
    .select('scheduled_event_id, scheduled_calendar_id, tentative_event_id')
    .eq('id', job.id)
    .single();
  const j = fresh || job;
  if (j.scheduled_event_id && j.scheduled_calendar_id) {
    await deleteEvent(accessToken, j.scheduled_calendar_id, j.scheduled_event_id);
  }
  if (j.tentative_event_id) {
    await deleteEvent(accessToken, CALENDARS.TENTATIVELY_SCHEDULED, j.tentative_event_id);
  }
  // Clear the pointers whether or not Google accepted the delete. Leaving a
  // stale id behind is worse than leaving a stray event: it makes the next
  // booking think there is something to remove and skip creating cleanly.
  await supabase.from('jobs').update({
    scheduled_event_id: null,
    scheduled_calendar_id: null,
    tentative_event_id: null,
    tentative_date: null,
  }).eq('id', job.id);
}

// ── READ: one answer to \"what is this job's scheduling state?\" ─────────""",
  'export async function releaseCalendar'),
])

# ── 2. TicketSheet releases the calendar on a terminal move ────────────────
patch('src/components/TicketSheet.jsx', [
 ('import releaseCalendar',
  "import NotesPanel from './NotesPanel.jsx';",
  "import NotesPanel from './NotesPanel.jsx';\nimport { releaseCalendar } from '../services/schedule.js';",
  'releaseCalendar'),

 ('release on terminal move',
  """    try {
      await onMove?.(target, note.trim() || null);
      setPending(null); setNote('');
    } catch (e) { setErr(e.message || 'Move failed'); }""",
  """    try {
      await onMove?.(target, note.trim() || null);
      // The job is over — take its event off the tech calendar. Non-fatal: a
      // failed delete must not unwind a status move that already succeeded,
      // and the job row is the record either way.
      if (['billed', 'archived', 'dead', 'lost'].includes(target)) {
        try { await releaseCalendar({ job, accessToken }); }
        catch (e) { console.warn('calendar release failed (non-fatal)', e.message); }
      }
      setPending(null); setNote('');
    } catch (e) { setErr(e.message || 'Move failed'); }""",
  'releaseCalendar({ job, accessToken })'),
])

print('\n'.join(f'  {s:5} {w}' for s, w in report))
miss = [w for s, w in report if s == 'MISS']
print(f'\n{sum(1 for s,_ in report if s=="OK")} applied, '
      f'{sum(1 for s,_ in report if s=="SKIP")} already there, {len(miss)} missed')
if miss:
    print('\nMISSED — anchor not found, file untouched:')
    for w in miss: print('   ', w)
    sys.exit(1)
print('\nNow run:  npm run verify')
