-- ============================================
-- 046 ROLLBACK · restore the "project hours" flags
-- ============================================
-- Reverses 046_unflag_project_hours.sql exactly.
-- Restores billable and non_billable_reason on the 17 rows from
-- time_entries_backup_046. Touches nothing else.
--
-- DO NOT DROP time_entries_backup_046 after running this — it is the only
-- record of the pre-046 state, and the 041/042/044/045 rule applies here too.
-- ========================================================================

UPDATE time_entries te
SET billable            = b.billable,
    non_billable_reason = b.non_billable_reason
FROM time_entries_backup_046 b
WHERE te.id = b.id;

-- Verify: both must return 17.
--   SELECT count(*) FROM time_entries WHERE non_billable_reason = 'project hours';
--   SELECT count(*) FROM time_entries WHERE billable IS FALSE;
--
-- And the billing queue should read 3 entries / 2.5h again:
--   SELECT count(*), round(sum(total_minutes)/60.0,1)
--   FROM time_entries
--   WHERE billed IS NOT TRUE AND archived IS NOT TRUE AND resolved_at IS NULL
--     AND disposition = 'bill_it' AND billable IS DISTINCT FROM FALSE;
