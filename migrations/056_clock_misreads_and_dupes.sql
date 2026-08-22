-- 056 — repair what the clock parser and the bare INSERT left behind
--
-- NOT APPLIED. Review, then run.
--
-- Two bugs wrote this data, both now fixed in the app (TimeEntryBlock.jsx
-- parseClockParts/resolveInOut, services/supabase.js timeEntriesApi.create).
-- This migration repairs the rows they already produced. It touches nothing
-- else: every statement is scoped by the exact signature of its bug.
--
-- BUG 1 — a bare hour was read as AM
--   The clock inputs are free text placeholdered "In · 9:30", and the parser's
--   am/pm group was optional. A tech typing 1:30 for half past one in the
--   afternoon got 01:30 stored. 27 rows carry a clock-in before 6am. None of
--   them happened before 6am. The DURATION on these is right — both ends were
--   misread by the same twelve hours — so only the timestamps move.
--
-- BUG 1b — the same misread, but across noon
--   When the misread put clock-out BEFORE clock-in, resolveInOut rescued the
--   negative span with a blind +24h. Crystal Osthoff, 12:00 in and 1:00 out,
--   a one-hour call: 13.00 hours stored. Three rows, 38.5 hours logged against
--   2.5 hours of real work. Here the duration is wrong too.
--
-- BUG 2 — nothing stopped a second row
--   time_entries has a primary key, three foreign keys, two CHECKs and nine
--   indexes, and no uniqueness rule about the work itself. create() was a bare
--   INSERT, so every tap of the old disposition bar wrote another row.
--
--   THESE ARE NOT REPAIRED HERE, DELIBERATELY. They are not identical
--   duplicates — they are disposition trails whose MINUTES change down the
--   cluster. Garage on 06-11: in_progress 60, return 60, estimate 60,
--   bill_it 120, four rows in 55 seconds. BG Auto on 05-22: in_progress 480
--   then bill_it 30. Keeping the last row is probably right — it is the state
--   the tech settled on, and it is what create() now does inside the window —
--   but on BG Auto that turns 8 logged hours into 30 minutes, and all ten rows
--   are already billed = true. Rewriting invoiced history on an inference is
--   not a migration's call. Step 3 flags them for a human instead.

begin;

create table if not exists backup_056_time_entries as
  select id, time_in, time_out, total_minutes, archived, resolution_reason
  from time_entries;

-- Step 3 only annotates. If the columns are not there yet, add them.
alter table time_entries
  add column if not exists needs_review  boolean not null default false,
  add column if not exists review_reason text;

-- ── 1b. noon-crossing wraps: un-add the phantom 12 hours ──────────────
-- Ordered first: these rows have a noon clock-in, so the < 6am filter in
-- step 1 does not see them, and the two steps cannot both touch a row.
update time_entries
   set time_out      = time_out + interval '12 hours',
       total_minutes = total_minutes - 720,
       resolution_reason = '056 clock wrap repaired (was ' || total_minutes || ' min)'
 where entry_method = 'inout'
   and total_minutes > 600
   and time_out < time_in
   and total_minutes - 720 >= 7;      -- never leave a row below the 6-min floor

-- ── 1. am/pm misreads: shift both ends, keep the duration ─────────────
update time_entries
   set time_in  = time_in  + interval '12 hours',
       time_out = time_out + interval '12 hours',
       resolution_reason = '056 am/pm misread repaired'
 where entry_method = 'inout'
   and time_in is not null
   and time_out > time_in                     -- untangled spans only
   and extract(hour from time_in at time zone 'America/Denver') < 6
   and extract(hour from time_out at time zone 'America/Denver') < 12;

-- ── 3. disposition trails: flag, do not touch ────────────────────────
-- Same tech, same event, several rows inside five minutes. Marked so they
-- surface in review; hours, dispositions and billed state are left exactly
-- as they are.
with clusters as (
  select calendar_event_id, tech_email, created_at::date as d
    from time_entries
   where coalesce(archived, false) = false
     and calendar_event_id is not null
     and tech_email is not null
   group by 1, 2, 3
  having count(*) > 1
     and max(created_at) - min(created_at) < interval '5 minutes'
)
update time_entries t
   set needs_review   = true,
       review_reason  = '056 disposition trail — several rows in under 5 minutes, hours disagree'
  from clusters c
 where t.calendar_event_id = c.calendar_event_id
   and t.tech_email        = c.tech_email
   and t.created_at::date  = c.d;

commit;

-- ── verify ────────────────────────────────────────────────────────────
-- Expect: pre_dawn 0, over_10h 0, flagged 10.
--   select count(*) filter (where extract(hour from time_in at time zone 'America/Denver') < 6
--                             and entry_method = 'inout')                     as pre_dawn,
--          count(*) filter (where total_minutes > 600
--                             and entry_method = 'inout')                     as over_10h,
--          count(*) filter (where needs_review)                               as flagged
--     from time_entries where coalesce(archived, false) = false;
