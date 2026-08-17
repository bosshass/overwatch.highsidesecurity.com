-- 041_pre_july_time_entry_closeout.sql
-- Two steps, in this order. Order matters: test rows are DELETED, not billed,
-- so they must go before the close-out or we'd stamp invoice refs on garbage.
--
-- SCOPE NOTE: "on the Completed calendar" cannot be resolved from the database.
-- time_entries.calendar_id records the TECH calendar the entry was logged
-- against (Austin 194, JR 98, +2 group cals) -- never the Completed Work
-- calendar, because the sweep moved the calendar EVENT afterwards. The date
-- cutoff is used instead: everything before 2026-07-01 is closed.
--
-- RULES APPLIED (Sara, 2026-08-13):
--   * Invoice number is mandatory on billed. 00000 = no invoice exists.
--   * NC-ARCHIVED is history. Existing invoice_ref values are NEVER overwritten.
--   * Archived flags are left exactly as they are.

begin;

-- ── backup everything we touch ───────────────────────────────────────────────
create table if not exists time_entries_backup_041 as
select * from time_entries
where coalesce(event_start, created_at) < '2026-07-01'
   or customer_id in (select id from customers where short_code in
        ('TES422','TES423','YES481','EDM484','NUT487','ZZTEST'));

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 - remove QA test data
-- 73.0h logged against placeholder customers, plus 27.5h of test-titled rows
-- sitting on REAL customers (deleting the placeholders would not catch those).
-- ═══════════════════════════════════════════════════════════════════════════
delete from time_entries te
where te.customer_id in (
        select id from customers
        where short_code in ('TES422','TES423','YES481','EDM484','NUT487','ZZTEST'))
   or te.event_title ~* '^\s*(te?s?e?t|test)\b'
   or te.archive_reason ilike 'test%';

-- the placeholder customers themselves, so they stop showing in pickers
delete from customers
where short_code in ('TES422','TES423','YES481','ZZTEST')
  and not exists (select 1 from time_entries t where t.customer_id = customers.id)
  and not exists (select 1 from jobs j        where j.customer_id = customers.id);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 - close out everything before 2026-07-01
-- Rows stay visible and stay attributed to their customer. This only stops
-- them appearing as open work.
-- ═══════════════════════════════════════════════════════════════════════════
update time_entries
   set billed      = true,
       billed_at   = coalesce(billed_at, now()),
       invoice_ref = coalesce(nullif(trim(invoice_ref), ''), '00000')
 where coalesce(event_start, created_at) < '2026-07-01';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
-- nothing open before July:
--   select count(*) from time_entries
--    where coalesce(event_start,created_at) < '2026-07-01'
--      and (not billed or invoice_ref is null);          -- expect 0
--
-- existing invoice refs untouched:
--   select b.invoice_ref old, t.invoice_ref new, count(*)
--     from time_entries_backup_041 b join time_entries t on t.id=b.id
--    where b.invoice_ref is distinct from t.invoice_ref
--    group by 1,2;            -- expect only NULL/'' -> 00000
--
-- NC-ARCHIVED preserved:
--   select count(*) from time_entries where invoice_ref='NC-ARCHIVED';
--
-- what is actually left to work:
--   select count(*), round(sum(total_minutes)/60.0,1) hrs
--     from time_entries
--    where coalesce(event_start,created_at) >= '2026-07-01'
--      and not coalesce(billed,false) and not coalesce(archived,false);
