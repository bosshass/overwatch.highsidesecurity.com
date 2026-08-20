-- 049 — let a tech say "I didn't get to go"
--
-- WHY
-- JobFinishSheet has offered five dispositions since 9.4.0. The database has
-- only ever accepted four:
--
--   CHECK (disposition = ANY (ARRAY['bill_it','return','estimate','in_progress']))
--
-- 'blocked' — no access, wrong parts, customer turned the tech away — is
-- rejected by Postgres. The insert throws, the sheet fails, and the visit is
-- recorded as nothing at all. time_entries holds ZERO blocked rows, which
-- reads like a disposition nobody uses and is actually a button that has never
-- once worked. The one 'blocked' job in the system was moved from the board by
-- hand.
--
-- The cost is not the missing rows. It is that a tech who could not do the
-- work had no way to say so, so the honest options were "In progress" — which
-- leaves the job sitting in Scheduled looking like it is still happening — or
-- nothing.
--
-- WHAT
-- Widen the constraint to the five the UI already offers. No data changes: no
-- existing row can violate the wider check, because the narrower one held.

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_disposition_check;

ALTER TABLE time_entries ADD CONSTRAINT time_entries_disposition_check
  CHECK (disposition = ANY (ARRAY['bill_it','return','estimate','in_progress','blocked']));
