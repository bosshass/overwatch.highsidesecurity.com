-- ============================================================
-- Migration 023 — let junk leave the queue WITHOUT being "billed"
-- ============================================================
-- WHY NOT JUST SET billed = true?
--   Because it's a lie. Test entries, duplicates and mistakes were never
--   invoiced. If we flag them billed, they land in billing history, they
--   count toward revenue reconciliation, and every future question of the
--   form "what did we actually invoice" comes back wrong. Junk needs its
--   own exit, separate from money.
--
-- WHAT THIS ADDS
--   archived        - true = removed from the billing/audit queues
--   archived_at     - when
--   archived_by     - who (email)
--   archive_reason  - why: 'test', 'duplicate', 'mistake', 'not_billable'
--
-- SAFETY
--   Adds columns only. Touches no existing rows. Everything defaults to
--   archived = false, so today's behaviour is unchanged until someone
--   actively archives something. Nothing is ever deleted — an archived
--   entry can be brought straight back by clearing the flag.

BEGIN;

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS archived       boolean DEFAULT false;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS archived_at    timestamptz;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS archived_by    text;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS archive_reason text;

-- The queues read "not archived and not billed", so index for that.
CREATE INDEX IF NOT EXISTS idx_time_entries_queue
  ON time_entries (archived, billed)
  WHERE coalesce(archived, false) = false;

COMMIT;

-- ------------------------------------------------------------
-- SANITY (read-only)
-- ------------------------------------------------------------
-- select count(*) filter (where coalesce(archived,false) = false) as still_in_queue,
--        count(*) filter (where archived) as archived
-- from time_entries;
--   expect: still_in_queue = every row, archived = 0
