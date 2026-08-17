-- 041b_repair_rollback.sql
-- Run after 041_purge_test_data.sql (the ORIGINAL, unpatched version).
--
-- 041 deleted two placeholder customers without backing them up:
--   77bc29e4-2be9-496d-916d-734cfc1e42e0  TES422  Test   (29 backup rows point here)
--   3e01d35d-9d55-4687-92b7-cc49d75b3923  YES481  Yest   ( 1 backup row  points here)
--
-- time_entries.customer_id has a FK to customers(id), so 041_ROLLBACK.sql would
-- fail on those 30 rows. This rebuilds the two customer rows and the relink
-- record so the rollback works as written. It changes nothing live.

begin;

-- ── reconstruct the deleted placeholder customers ───────────────────────────
create table if not exists customers_backup_041_test (like customers including all);

insert into customers_backup_041_test (id, short_code, drh_id, name, is_active, is_parent_org, notes)
values
 ('77bc29e4-2be9-496d-916d-734cfc1e42e0','TES422','TES422','Test', false, false,
  'Reconstructed by 041b for rollback only. Original row deleted by 041 without backup.'),
 ('3e01d35d-9d55-4687-92b7-cc49d75b3923','YES481','YES481','Yest', false, false,
  'Reconstructed by 041b for rollback only. Original row deleted by 041 without backup.')
on conflict (id) do nothing;

-- ── record the pre-relink state for the two rescued Jake Pierson entries ────
-- They were on YES481 (Yest) before 041 moved them to JAK202.
create table if not exists time_entries_relink_041 (
  id uuid primary key,
  old_customer_id uuid,
  old_customer_name_raw text
);

insert into time_entries_relink_041 (id, old_customer_id, old_customer_name_raw)
values
 ('621a6e7d-d554-4332-9a03-c49098444456','3e01d35d-9d55-4687-92b7-cc49d75b3923','Yest'),
 ('5e411839-69de-461e-999f-e6490231aafa','3e01d35d-9d55-4687-92b7-cc49d75b3923','Yest')
on conflict (id) do nothing;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY - rollback is now viable
-- ═══════════════════════════════════════════════════════════════════════════
-- no backup row would violate the FK anymore:
--   select count(*) from time_entries_backup_041_test b
--    where b.customer_id is not null
--      and not exists (select 1 from customers c            where c.id=b.customer_id)
--      and not exists (select 1 from customers_backup_041_test k where k.id=b.customer_id);
--   -- expect 0
--
-- three rollback tables present:
--   select table_name from information_schema.tables
--    where table_schema='public' and table_name like '%041%';
--   -- expect time_entries_backup_041_test, customers_backup_041_test, time_entries_relink_041


-- ═══════════════════════════════════════════════════════════════════════════
-- OPTIONAL - the last two test artifacts, left behind on purpose
-- 041's guard skipped TES423 and ZZTEST because each still has one archived
-- job. Both jobs are status='archived'. Run this block only if you want them
-- gone too. Backs up first.
-- ═══════════════════════════════════════════════════════════════════════════
-- begin;
--   create table jobs_backup_041b_test as
--   select j.* from jobs j join customers c on c.id=j.customer_id
--    where c.short_code in ('TES423','ZZTEST');
--
--   create table customers_backup_041b_test as
--   select * from customers where short_code in ('TES423','ZZTEST');
--
--   delete from jobs where id in (select id from jobs_backup_041b_test);
--   delete from customers c where c.short_code in ('TES423','ZZTEST')
--     and not exists (select 1 from time_entries t where t.customer_id=c.id)
--     and not exists (select 1 from jobs j        where j.customer_id=c.id)
--     and not exists (select 1 from notes n       where n.customer_id=c.id);
-- commit;
