-- ============================================================================
-- 038 — Freeze the legacy hours/notes columns. Document, do not drop.
-- ============================================================================
-- Cutover: 2026-08-12.
--
-- These columns hold REAL historical data. Roughly 1,200 entries predate the
-- cutover, they are billed and closed, and rewriting them to satisfy a cleaner
-- schema is a bigger risk than the inconsistency it would fix. So they stay,
-- frozen, and the comments below make that discoverable from the Supabase
-- table editor without anyone having to read application source.
--
-- WHAT WENT WRONG. Four code paths recorded "a tech finished a visit" and they
-- did not agree on where it went:
--
--   JobFinishSheet  -> time_entries (+ return_cards)
--   DidYouGo        -> time_entries, with synthetic calendar ids
--   TimeEntryBlock  -> time_entries
--   JobDetail       -> jobs + job_assignments, and NEVER time_entries
--
-- JobDetail also rendered a FieldVisits panel that reads time_entries — a table
-- its own save path never wrote — so a job closed there showed no hours in the
-- panel directly above the button you just pressed. A UI fallback was added to
-- paper over it (render assignment hours, else job hours), which made the split
-- permanent instead of fixing it.
--
-- Source of truth going forward is time_entries:
--   hours -> time_entries.total_minutes
--   notes -> time_entries.notes
--
-- No trigger is installed here. Enforcement lands only after the application
-- stops writing these columns; a RAISE on this table today would throw on every
-- job completion. See migration 039.
-- ============================================================================

comment on column public.jobs.actual_hours is
  'DEPRECATED 2026-08-12. Frozen, read-only. Historical data retained — do NOT drop, do NOT write. Hours live in time_entries.total_minutes.';

comment on column public.jobs.time_in is
  'DEPRECATED 2026-08-12. Frozen, read-only. Historical data retained. See time_entries.time_in.';

comment on column public.jobs.time_out is
  'DEPRECATED 2026-08-12. Frozen, read-only. Historical data retained. See time_entries.time_out.';

comment on column public.job_assignments.actual_hours is
  'DEPRECATED 2026-08-12. Frozen, read-only. Historical data retained. Hours live in time_entries.total_minutes. Only 41 of 287 rows were ever populated — this column was written opportunistically and read by nothing.';

comment on column public.job_assignments.time_in is
  'DEPRECATED 2026-08-12. Frozen, read-only. Historical data retained. See time_entries.time_in.';

comment on column public.job_assignments.time_out is
  'DEPRECATED 2026-08-12. Frozen, read-only. Historical data retained. See time_entries.time_out.';

comment on column public.job_assignments.completion_notes is
  'DEPRECATED 2026-08-12. Frozen, read-only. Historical data retained. Field notes live in time_entries.notes.';

-- Table-level context, so the deprecation is visible without opening a column.
comment on table public.job_assignments is
  'DISPATCH ONLY: which tech, which day, which calendar event. The hours and notes columns on this table are frozen legacy as of 2026-08-12 — see individual column comments. Never a source of hours.';

comment on table public.time_entries is
  'SOURCE OF TRUTH for field hours and tech notes. Every completed visit writes exactly one row here, via JobFinishSheet. Match to a job on job_id, or on calendar_event_id against jobs.calendar_event_id OR jobs.scheduled_event_id — those two are not always the same value.';

-- Dead tables: zero rows, zero code references as of 2026-08-18.
comment on table public.clock_entries is
  'DEAD 2026-08-18. Zero rows, zero code references. Superseded by time_entries. Safe to drop.';

comment on table public.clock_events is
  'DEAD 2026-08-18. Two rows, zero code references. Superseded by time_entries. Safe to drop.';
