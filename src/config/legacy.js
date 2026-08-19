// ============================================
// LEGACY HOURS — frozen columns, read-only
// ============================================
// Cutover: 2026-08-12 (the Wednesday). Everything on or after this date is
// expected to be clean. Everything before it is frozen as-is and NOT
// backfilled — those visits are billed and closed, and rewriting ~1,200
// historical entries to satisfy a new schema is a bigger risk than the
// inconsistency it would fix.
//
// THESE COLUMNS STILL HOLD REAL DATA. Do not drop them. Do not write to them.
//
//   jobs.actual_hours                    jobs.time_in       jobs.time_out
//   job_assignments.actual_hours         job_assignments.time_in
//   job_assignments.time_out             job_assignments.completion_notes
//
// The single source of truth for hours and field notes is time_entries:
//   hours -> time_entries.total_minutes
//   notes -> time_entries.notes
//
// WHY THEY EXIST. Four different code paths used to record "a tech finished a
// visit", and they didn't agree on where it went. JobFinishSheet, DidYouGo and
// TimeEntryBlock wrote time_entries; JobDetail wrote jobs + job_assignments and
// never touched time_entries at all. So the same action produced different
// stored data depending on which screen you happened to use, and JobDetail
// displayed a FieldVisits panel reading a table its own save path never wrote.
//
// Matching column comments live in the database itself (migration 038) so this
// is discoverable from the Supabase table editor without reading source.
//
// If you are here because you found data in one of those columns: it is real,
// it is historical, and it predates the cutover. Read it through the guard
// below, never directly.

export const LEGACY_HOURS_CUTOFF = '2026-08-12';

/**
 * True when a record is old enough that its hours may only exist in the frozen
 * columns. Post-cutover records always have their hours in time_entries, so
 * the legacy fallback must NOT render for them — showing a stale job.actual_hours
 * next to a fresh time entry is how the two-sources-of-truth confusion looked
 * on screen in the first place.
 *
 * @param {string|Date} date  the record's scheduled_date or created_at
 */
export function isLegacyRecord(date) {
  if (!date) return false;
  return String(date).slice(0, 10) < LEGACY_HOURS_CUTOFF;
}
