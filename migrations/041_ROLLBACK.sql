-- 041_ROLLBACK.sql
-- Undoes 041_purge_test_data.sql completely.
--
-- Valid ONLY while these three tables still exist:
--   time_entries_backup_041_test   (47 deleted rows, full copy)
--   customers_backup_041_test      (the 4 placeholder customers)
--   time_entries_relink_041        (pre-relink customer_id for the 2 Jake Pierson rows)
--
-- Once you drop those, 041 is permanent. Do not drop them until you have
-- lived with the result for at least a full billing cycle.

begin;

-- 1. customers first -- time_entries.customer_id points at them, so they have
--    to exist before the entries come back.
insert into customers
select * from customers_backup_041_test b
where not exists (select 1 from customers c where c.id = b.id);

-- 2. the 47 deleted time entries, byte for byte
insert into time_entries
select * from time_entries_backup_041_test b
where not exists (select 1 from time_entries t where t.id = b.id);

-- 3. undo the Jake Pierson relink
update time_entries te
   set customer_id       = r.old_customer_id,
       customer_name_raw = r.old_customer_name_raw
  from time_entries_relink_041 r
 where te.id = r.id;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY THE ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
-- all 47 back:
--   select count(*) from time_entries t
--     join time_entries_backup_041_test b on b.id = t.id;      -- expect 47
--
-- nothing differs from the backup:
--   select count(*) from time_entries t
--     join time_entries_backup_041_test b on b.id = t.id
--    where (t.*) is distinct from (b.*);                        -- expect 0
--
-- placeholder customers restored:
--   select short_code, name from customers
--    where short_code in ('TES422','TES423','YES481','ZZTEST');
--
-- relink undone:
--   select te.event_title, c.short_code from time_entries te
--     left join customers c on c.id = te.customer_id
--    where te.id in ('621a6e7d-d554-4332-9a03-c49098444456',
--                    '5e411839-69de-461e-999f-e6490231aafa');   -- expect YES481
--
-- table-wide hours match pre-041:
--   select count(*), round(sum(total_minutes)/60.0,1) from time_entries;
--   -- expect 333 rows again
