-- 041_purge_test_data.sql
-- STEP 1 ONLY. Test data purge. Run this before any close-out.
--
-- Explicit IDs, no regex. A pattern match against 333 rows of live billing data
-- is how "Jake Pierson - Install last camera" nearly got deleted for containing
-- the letters l-l-l. Every id below was eyeballed against its title, customer,
-- tech, date and minutes.
--
-- DELIBERATELY NOT DELETED (matched a pattern, are real work):
--   fc0bbaf1  Jake Pierson - Install last camera - Confirmed   150m  JAK202
--   f77984c8  Vet Center Monthly Panic Button Testing           30m  VET450
--   43b398ca  Texas Road House - NuTech Job                    240m  NUT487  <- real customer
--   dc4537e7  EDM International Fort Collins - Sales Call       60m  EDM484  <- real customer
--
-- RELINKED, NOT DELETED: two real Jake Pierson entries were logged against the
-- "Yest" test customer. They move to JAK202 instead of dying with it.

begin;

-- Fail loudly rather than reuse a stale backup from an aborted run.
do $$ begin
  if to_regclass('public.time_entries_backup_041_test') is not null then
    raise exception '041 backup table already exists. Inspect it, then drop it deliberately before re-running.';
  end if;
end $$;

create table time_entries_backup_041_test as
select * from time_entries where id in (
 -- Test / TES422
 '820f41fa-8674-4af8-a497-7a504a9cee79','bc331a22-4bcc-4828-9bda-259a84504869',
 '821461b4-4503-4c32-ad9c-0afbcd02bc44','59411b50-020b-43e2-bcd4-86e468d90db7',
 'd8f7d038-9a1b-4d18-887d-fd886eb513bc','53d84e06-4a19-417b-ae05-d5c6caa8f4ec',
 'a7450b10-07c1-470c-a512-0c9680da9132','8cb0e720-427b-4561-85b5-56b423a93ebd',
 'aa74ff8e-eae8-45fd-9a6e-36fc1ad006ca','6a0006ba-fbad-4a6d-88fb-c0404ed73972',
 '88082ad9-a77e-44c0-8ff8-9512ad7c9022','453ec1d3-090c-4b96-90d9-e78ee8a3b167',
 'd5121369-4113-4802-8a00-d715ce2542b1','2466ce94-2663-4cb0-98fd-2209133ee397',
 '481bec2e-cfbf-4d63-be90-6d4a13790825','ae19398e-b5ed-469f-ba87-5245f58da715',
 '6ed194b6-31d4-44c3-b4b5-cf13835a7507','df974711-3027-4cbe-bee0-af2d4049deec',
 '5f0f9644-7fe7-47b8-ac39-da95e6fc425f','935881e4-69fc-4114-9933-a0587606b9b4',
 '5c54f654-d985-49e2-8198-c4d5382a129e','2fd5a997-1fb8-436d-a4d0-f817c0701981',
 '5c086113-fda2-4459-a852-95bf4dec489b','4afdf7f3-67c3-4288-85f6-f142c37b03f0',
 '208404d4-8940-4a33-b283-c1c025a3d345','77d8cc4c-5b0e-4e24-9e36-1784deda9866',
 'ba9f08b8-5c2e-4ae6-b811-3864a7e125fe','65214207-6a97-477b-bdfc-3c39d5b7e95b',
 'd60e904a-4512-4ab1-b091-931bdd45319f',
 -- Test - A / TES423
 '766e6b00-be7f-46c3-a2e9-7e26bc5629f4','43067b44-bb89-480e-843a-01cff65db053',
 'bd74f20f-02f7-474c-aaeb-4c9574f2a7ae','862d5720-55e8-4d9d-97c2-75609fcedf1b',
 'dccf8686-7721-4194-82a5-1699ce67b586','dcface1b-86cb-4bf8-9d78-fef20d190e2c',
 '09697b74-6ce6-4db9-a8fb-1b40f1981de4',
 -- Yest / YES481  (only the actual test row)
 'c7b5abc7-4ab7-4e51-84d2-b6477b90f109',
 -- test rows sitting on REAL customers
 'ca564cce-0b92-4320-b393-1f7d6198b8d6',  -- "Teset"        ADAMS, CORINNE L.
 'dc08c90a-7f45-41e5-9737-0a80d49cef7c',  -- "Test"         BG AUTOMOTIVE LONGMONT
 '7324fb87-d662-4c49-8348-59d5fba1a26a',  -- "Test"         SMITH, ERIN FINK
 '3dbeaaf8-8481-4b27-88cc-eed07b4b872b',  -- "Test"         NORDIC   (tech: Accounting)
 'c061f60d-7e73-414a-819a-679f721f4510',  -- "Test - Return" 21h  IMT Cornerstar
 -- already tagged archive_reason = 'test'
 'a7b4896b-cdfd-407f-b7ab-31ad847b6b86',  -- ALLEN, JERRY/MARILYN
 'de1049db-5437-4121-98da-0e0af6a91ce2',  -- NORDIC
 '9b689425-d46a-4940-9145-36a175e68673',  -- NORDIC
 '8e230aea-af8e-429b-82fb-14d5bc2298b1',  -- NORDIC
 '210dc76b-ba6e-4dc6-929e-b1338187f04b'   -- NORDIC
);

-- ── guard: the id list must match what was reviewed ─────────────────────────
do $$ declare n int; begin
  select count(*) into n from time_entries_backup_041_test;
  if n <> 47 then
    raise exception '041 expected 47 rows, found %. Data changed since review - stop.', n;
  end if;
end $$;

-- ── back up the customers we may delete ─────────────────────────────────────
create table customers_backup_041_test as
select * from customers where short_code in ('TES422','TES423','YES481','ZZTEST');

-- ── record the pre-relink state so the rescue is reversible ─────────────────
create table time_entries_relink_041 as
select id, customer_id as old_customer_id, customer_name_raw as old_customer_name_raw
from time_entries
where id in ('621a6e7d-d554-4332-9a03-c49098444456',
             '5e411839-69de-461e-999f-e6490231aafa');

-- ── rescue: real work stranded on the Yest test customer ────────────────────
update time_entries
   set customer_id = (select id from customers where short_code='JAK202'),
       customer_name_raw = 'JAKE PEIRSON'
 where id in ('621a6e7d-d554-4332-9a03-c49098444456',
              '5e411839-69de-461e-999f-e6490231aafa');

-- ── delete ──────────────────────────────────────────────────────────────────
delete from time_entries
 where id in (select id from time_entries_backup_041_test);

-- ── placeholder customers, only once nothing references them ────────────────
delete from customers c
 where c.short_code in ('TES422','TES423','YES481','ZZTEST')
   and not exists (select 1 from time_entries t where t.customer_id=c.id)
   and not exists (select 1 from jobs j        where j.customer_id=c.id)
   and not exists (select 1 from notes n       where n.customer_id=c.id);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
-- what was removed:
--   select count(*) rows, round(sum(total_minutes)/60.0,1) hours
--     from time_entries_backup_041_test;          -- expect 47 rows
--
-- the four survivors are still here:
--   select id, event_title, total_minutes from time_entries
--    where id in ('fc0bbaf1-08e4-4769-9bbd-b53794e4a4bf',
--                 'f77984c8-ef20-4f03-851a-9d4414aaf178',
--                 '43b398ca-eaf8-49a5-8e8c-af876bc39a24',
--                 'dc4537e7-80c7-43b0-a53a-dfc716dc62c5');   -- expect 4
--
-- Jake Pierson rows rescued:
--   select te.event_title, c.short_code from time_entries te
--     join customers c on c.id=te.customer_id
--    where te.id in ('621a6e7d-d554-4332-9a03-c49098444456',
--                    '5e411839-69de-461e-999f-e6490231aafa');  -- expect JAK202
--
-- no test titles left:
--   select id, event_title from time_entries where event_title ~* '^\s*t?e?s?t';
