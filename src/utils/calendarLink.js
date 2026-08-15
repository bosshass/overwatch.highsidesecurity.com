// ============================================
// eventOf — ONE answer to "is this job on a calendar".
// ============================================
// `jobs` carries THREE event-id columns and nothing in the naming says which
// applies when:
//
//   calendar_event_id    the event the job was born FROM (intake). This is the
//                        one time_entries join on — where the hours live.
//   scheduled_event_id   the event created BY book(), on scheduled_calendar_id.
//   tentative_event_id   a hold on the Tent calendar.
//
// They are not three names for one thing. 185 jobs carry an intake id, 78 a
// booking id, 48 carry BOTH — and on 23 of those the two ids are DIFFERENT
// events. The origin and the current booking are genuinely separate facts, and
// collapsing them would sever hours from jobs on those 23 rows.
//
// What was broken is that every caller picked a column by hand and could pick
// wrong. FORT COLLINS NURSERY was booked on Austin's calendar for a Monday;
// a check that read calendar_event_id concluded it was not on any calendar and
// raised a task telling Shana to go book it. It was already booked.
//
// So: same pattern as assigneeOf() in ownership.js. One function, one priority
// order, and no caller reads a raw column again.
//
// Priority is deliberate — booking beats hold beats intake, because the
// question people are actually asking is "where is this expected to happen
// NEXT", and only the booking answers that once one exists.

export function eventOf(job) {
  if (!job) return null;

  if (job.scheduled_event_id) {
    return {
      id: job.scheduled_event_id,
      calendarId: job.scheduled_calendar_id || null,
      kind: 'booked',
    };
  }
  if (job.tentative_event_id) {
    return {
      id: job.tentative_event_id,
      calendarId: null,          // always the Tent calendar — see config/calendars.js
      kind: 'held',
    };
  }
  if (job.calendar_event_id) {
    return {
      id: job.calendar_event_id,
      calendarId: job.calendar_id || null,
      kind: 'intake',
    };
  }
  return null;
}

// Is there ANY calendar presence at all? The check that got Fort Collins wrong.
export const isOnCalendar = (job) => !!eventOf(job);

// Is it actually BOOKED — a real appointment somebody will drive to? A hold is
// a pencil mark and an intake event may be long past, so neither counts.
export const isBooked = (job) => eventOf(job)?.kind === 'booked';

// The intake event specifically, for anything joining to time_entries. Named so
// that reaching for hours is a deliberate act rather than a lucky guess.
export const hoursEventIdOf = (job) => job?.calendar_event_id || null;
