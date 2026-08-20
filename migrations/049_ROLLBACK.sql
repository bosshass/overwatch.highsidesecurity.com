-- 049 ROLLBACK — narrow the disposition CHECK back to four values.
--
-- WILL FAIL if any blocked rows have been written since 049 was applied, which
-- is correct: refusing to narrow is better than silently orphaning them. Check
-- first, and decide what those visits should have been:
--
--   SELECT id, tech_name, event_title, created_at
--   FROM time_entries WHERE disposition = 'blocked';

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_disposition_check;

ALTER TABLE time_entries ADD CONSTRAINT time_entries_disposition_check
  CHECK (disposition = ANY (ARRAY['bill_it','return','estimate','in_progress']));
