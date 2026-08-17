-- 042_resolution_and_pre_july_closeout.sql
--
-- FOUR PARTS. Nothing overwrites an existing value anywhere.
--   1. Add the columns that let a row be settled without lying about money.
--   2. Mark 11 fixed-fee entries (39.0h) non-billable. Real cost, no invoice.
--   3. Close out everything before 2026-07-01, EXCEPT the 17 entries below.
--   4. Leave 6 entries (7.1h) fully open -- they still need invoicing.
--
-- WHY NOT billed = true:  asserts an invoice went out. It did not.
-- WHY NOT archived = true: archived means the work did not happen / is not
--   counted in utilization, and carries a deliberate taxonomy (warranty,
--   goodwill, duplicate, contract, sales_call). FF work DID happen and is real
--   cost against the project. Both flags would lie, in opposite directions.
--
-- billed, invoice_ref, archived, archive_reason and disposition are NEVER
-- touched by this migration. Rollback is just clearing the new columns.

begin;

do $$ begin
  if to_regclass('public.time_entries_backup_042') is not null then
    raise exception '042 backup already exists. Inspect and drop it deliberately before re-running.';
  end if;
end $$;

-- ── 1. columns (from the V3 shape; safe if 039 already added them) ──────────
alter table time_entries
  add column if not exists billable            boolean,
  add column if not exists non_billable_reason text,
  add column if not exists resolved_at         timestamptz,
  add column if not exists resolved_by         text,
  add column if not exists resolution_reason   text;

comment on column time_entries.billable is
  'FALSE = work happened, real cost, deliberately not invoiced (fixed fee, warranty, '
  'goodwill). Distinct from archived, which means it did not happen / not counted.';
comment on column time_entries.resolved_at is
  'Settled. Makes no claim about money. Open work = resolved_at IS NULL.';

create table time_entries_backup_042 as select * from time_entries;

-- baseline: anything not archived is presumed billable until stated otherwise
update time_entries set billable = not coalesce(archived,false) where billable is null;

-- ── 2. fixed-fee projects -- 11 entries, 39.0h ──────────────────────────────
update time_entries
   set billable            = false,
       non_billable_reason = 'fixed fee project',
       resolved_at         = now(),
       resolved_by         = 'sara@jnbservice.com',
       resolution_reason   = 'FF project - hours are cost, not invoiced'
 where id in (
 '7c203d35-ac41-468a-ae05-a3bf47126961',  -- Jeanneret            7/28  7.5h
 '93bd73fe-6ae0-45d8-bb8a-81388d52ce3d',  -- Jeanneret            7/30  9.0h
 '57084d38-0f2d-401d-88a8-85b299b74606',  -- BG Automotive HQ     6/15  1.0h
 '54c9aa1b-c617-4f4d-a35c-6cf83daf864c',  -- BG Automotive HQ     6/16  1.5h
 'f9a4c6f3-0671-4db7-b1e7-2277d2dc36af',  -- BG Automotive HQ     6/19  7.0h
 '20604dc8-efa0-46d9-ac92-220877bdc259',  -- BG Automotive HQ     7/02  3.0h
 'e8be124e-f862-4306-b0e2-00a7610bf44e',  -- BG Automotive HQ     7/02  3.5h
 'd5968261-b188-426f-bc1f-957513098efa',  -- Shepard Construction 7/22  4.0h
 '3df5c37b-de28-4f1e-8532-67ab0f57f8dd',  -- Jeff Goodell         8/06  1.0h
 'b25ad063-18af-4252-84d5-eb024439d863',  -- Allen, Jerry/Marilyn 6/29  1.0h
 'ac2aa7d7-f378-4751-a0ac-36e7213b3e14'   -- QSC Lemay            7/13  0.5h
);

-- ── 3. pre-July close-out, excluding all 17 reviewed entries ────────────────
update time_entries
   set resolved_at       = now(),
       resolved_by       = 'sara@jnbservice.com',
       resolution_reason = 'pre-2026-07-01 close-out'
 where coalesce(event_start, created_at) < '2026-07-01'
   and resolved_at is null
   and id not in (
 -- fixed fee (already resolved above, listed for clarity)
 '57084d38-0f2d-401d-88a8-85b299b74606','54c9aa1b-c617-4f4d-a35c-6cf83daf864c',
 'f9a4c6f3-0671-4db7-b1e7-2277d2dc36af','b25ad063-18af-4252-84d5-eb024439d863',
 -- STILL TO BILL - must stay open
 '75c607f0-1f51-43bc-a680-f762e3718f40',  -- Fort Collins Nursery  7/23  3.0h  "NEVER WENT"
 '67896839-24b5-4a6e-902a-d0e1dc8e1855',  -- ShoCo                 7/28  1.0h
 'e2b5e67f-c839-4e97-b3b3-109177052241',  -- Kim Campbell          7/29  1.0h
 'd5e074b0-ba42-4865-b2a3-c26b13d910a4',  -- Christ United Meth.   8/03  1.0h
 '51d6a681-eed3-4135-82a8-575eded85dad',  -- Cherry Street Lofts   8/06  0.6h
 'e705331c-8c84-483c-b348-d746d1d9c187'   -- Old Town Prof. Bldg   6/15  0.5h  <- pre-July, kept open
);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
-- money fields untouched -- expect 0:
--   select count(*) from time_entries t join time_entries_backup_042 b on b.id=t.id
--    where t.billed is distinct from b.billed
--       or t.invoice_ref is distinct from b.invoice_ref
--       or t.archived is distinct from b.archived
--       or t.disposition is distinct from b.disposition;
--
-- FF marked -- expect 11 rows / 39.0h:
--   select count(*), round(sum(total_minutes)/60.0,1) from time_entries
--    where non_billable_reason='fixed fee project';
--
-- STILL OPEN AND BILLABLE -- expect 6 rows / 7.1h:
--   select c.short_code, te.event_start::date, round(te.total_minutes/60.0,1) h, te.event_title
--     from time_entries te left join customers c on c.id=te.customer_id
--    where te.resolved_at is null and te.disposition='bill_it' and not te.billed
--    order by te.event_start;
--
-- nothing pre-July left open except Old Town -- expect 1:
--   select count(*) from time_entries
--    where coalesce(event_start,created_at) < '2026-07-01' and resolved_at is null;
--
-- hours still reconcile -- expect 286 / 553.8:
--   select count(*), round(sum(total_minutes)/60.0,1) from time_entries;
