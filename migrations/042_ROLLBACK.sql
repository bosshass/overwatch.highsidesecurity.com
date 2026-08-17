-- 042_ROLLBACK.sql
-- Undoes 042. Simple, because 042 only ever WROTE to five new columns --
-- it never overwrote billed, invoice_ref, archived, archive_reason or
-- disposition. So the undo is clearing the new columns, not restoring rows.
--
-- Requires time_entries_backup_042 to still exist.

begin;

update time_entries t
   set billable            = b.billable,
       non_billable_reason = b.non_billable_reason,
       resolved_at         = b.resolved_at,
       resolved_by         = b.resolved_by,
       resolution_reason   = b.resolution_reason
  from time_entries_backup_042 b
 where b.id = t.id;

commit;

-- If 042 also CREATED the columns (039 had not been run), drop them too.
-- Only run this if you want the columns gone entirely:
--   alter table time_entries
--     drop column if exists billable,
--     drop column if exists non_billable_reason,
--     drop column if exists resolved_at,
--     drop column if exists resolved_by,
--     drop column if exists resolution_reason;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY THE ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
-- every row identical to the backup -- expect 0:
--   select count(*) from time_entries t join time_entries_backup_042 b on b.id=t.id
--    where (t.*) is distinct from (b.*);
--
-- nothing resolved -- expect 0:
--   select count(*) from time_entries where resolved_at is not null;
--
-- row count and hours unchanged -- expect 286 / 553.8:
--   select count(*), round(sum(total_minutes)/60.0,1) from time_entries;
