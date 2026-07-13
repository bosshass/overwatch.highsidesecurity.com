// ============================================
// appBase — where THIS app actually lives
// ============================================
// Deep links written into Google Calendar events were hardcoded to
// `https://juc-e-v2.vercel.app` — the OLD JUC-E deployment. Anyone clicking
// one landed in a different app on its generic board, never reaching the
// finish sheet. Which also means they never dispositioned, never created a
// time_entry, and the job never showed up in Event Audit or Billing.
//
// Deriving the base from the browser makes it correct on production, on
// Vercel preview builds, and on localhost — and it can never silently rot
// again when a domain changes.
//
// SCOPE: this only affects links written from NOW ON. Existing calendar
// events keep their old links until they are dealt with separately — see
// the orphan scan in TechCalendar, which is the real path for pulling
// untracked calendar work into Overwatch.

export const APP_BASE =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://overwatch.highsidesecurity.com';

// The canonical deep link to a calendar-backed job.
export function jobDeepLink(calendarId, eventId) {
  return `${APP_BASE}/?cal=${encodeURIComponent(calendarId)}&job=${encodeURIComponent(eventId)}`;
}

// Link to a JOB by its Supabase UUID. This is the universal anchor — it works
// for calendar-backed jobs AND for jobs that have no calendar event at all
// ("JR to sign his taxes"), which is most of what gets captured as a note.
// Notes hang off job_id, so a job link is a note link.
export function jobLink(jobId) {
  return `${APP_BASE}/board?job=${encodeURIComponent(jobId)}`;
}
