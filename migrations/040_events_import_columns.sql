-- 040_events_import_columns.sql
-- Prepare V9 to receive Events_Final.xlsx (896 rows) and match it to existing data.
--
-- Idempotent and self-sufficient: runs whether or not 039 has been applied.
-- Purely additive. No existing row is touched.
--
-- TWO RULES BAKED IN:
--   1. Time_In / Time_Out land as TEXT and are NEVER cast or totalled.
--      79.6% of the source had no times; of the 192 that did, 100 carried a
--      pair copied across other events for the same customer. `minutes` stays
--      NULL until a human resolves a Time_Cluster.
--   2. Customer_ID from the sheet is a V3 short code (PETE0661), not a V9 uuid.
--      It lands raw in v3_customer_code; customer_id stays NULL until the
--      crosswalk assigns it.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. customer_history -- create if 039 hasn't run, then add the new columns
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists customer_history (
  event_id          text primary key,
  customer_id       uuid references customers(id),
  source_unique_id  text,
  occurred_at       timestamptz,
  calendar          text,
  summary           text,
  issue             text,
  invoice_number    text,
  completed_by      text,
  minutes           integer,
  time_in_raw       text,
  time_out_raw      text,
  materials         text,
  billing_notes     text,
  trip_cluster_id   text,
  is_all_day        boolean not null default false,
  job_id            uuid references jobs(id),
  imported_at       timestamptz not null default now()
);

alter table customer_history
  -- fields Events_Final carries that V3's shape had nowhere for
  add column if not exists work_status          text,
  add column if not exists job_number           text,
  add column if not exists tz_offset            text,
  add column if not exists last_activity_start  timestamptz,
  add column if not exists source_system        text,
  add column if not exists merged_row_count     integer default 1,
  add column if not exists merged_event_ids     text,
  add column if not exists data_flag            text,
  -- unresolved V3 key, pending the crosswalk
  add column if not exists v3_customer_code     text,
  -- what this event matched to in live V9 data
  add column if not exists v9_match_type        text,
  add column if not exists v9_match_id          uuid,
  add column if not exists v9_matched_at        timestamptz;

comment on column customer_history.time_in_raw is
  'Verbatim clock string from the calendar. NEVER cast to a timestamp and never '
  'subtract from time_out_raw -- these values were propagated across events, not measured.';
comment on column customer_history.minutes is
  'NULL until a human resolves the trip_cluster. Do not compute from raw times.';
comment on column customer_history.merged_event_ids is
  'Semicolon list of the original Event_IDs collapsed into this row. Only audit '
  'trail back to the 69 source rows merged into 23 during cleanup.';
comment on column customer_history.v3_customer_code is
  'V3 short code (PETE0661 form) as imported. customer_id stays NULL until the '
  'V3-V9 crosswalk resolves it to a uuid.';

create index if not exists idx_ch_v3code   on customer_history(v3_customer_code);
create index if not exists idx_ch_cluster  on customer_history(trip_cluster_id) where trip_cluster_id is not null;
create index if not exists idx_ch_matchid  on customer_history(v9_match_id) where v9_match_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. stg_events -- raw landing table, everything TEXT, 1:1 with the sheet
--    Import here first. Nothing is coerced on the way in, so a bad value is
--    visible rather than silently rejected.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists stg_events (
  event_id             text,
  customer_id          text,
  job_number           text,
  event_start          text,
  event_tz_offset      text,
  all_day              text,
  last_activity_start  text,
  calendar             text,
  work_status          text,
  invoice_number       text,
  event_summary        text,
  issue                text,
  completed_by         text,
  time_in              text,
  time_out             text,
  materials_used       text,
  billing_notes        text,
  source_system        text,
  merged_row_count     text,
  merged_event_ids     text,
  time_cluster_id      text,
  data_flag            text,
  sheet_row            integer generated always as identity
);
comment on table stg_events is
  'Raw landing for Events_Final.xlsx. All text, nothing coerced. Truncate and '
  're-import freely -- promotion into customer_history is a separate step.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. v_event_match -- what each staged event lines up with in live V9 data
--    Read-only. Run after loading stg_events, before promoting anything.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_event_match as
select
  s.event_id,
  s.customer_id                            as v3_customer_code,
  s.event_start,
  s.work_status,
  s.source_system,
  nullif(s.merged_row_count,'')::int       as merged_rows,
  j.id                                     as job_id,
  j.status                                 as job_status,
  j.customer_id                            as job_customer_uuid,
  ja.id                                    as assignment_id,
  te.id                                    as time_entry_id,
  te.total_minutes                         as te_minutes,
  te.billed                                as te_billed,
  case
    when j.id  is not null then 'job'
    when ja.id is not null then 'assignment'
    when te.id is not null then 'time_entry'
    else 'NO MATCH'
  end                                      as match_type
from stg_events s
left join jobs j
  on  j.calendar_event_id   = s.event_id
   or j.scheduled_event_id  = s.event_id
   or j.tentative_event_id  = s.event_id
left join job_assignments ja on ja.calendar_event_id = s.event_id
left join time_entries    te on te.calendar_event_id = s.event_id;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER LOADING stg_events (expect 896 rows), run these before promoting:
-- ═══════════════════════════════════════════════════════════════════════════
-- select count(*) from stg_events;                       -- expect 896
-- select count(distinct event_id) from stg_events;       -- expect 896
--
-- match rate:
--   select match_type, count(*) from v_event_match group by 1 order by 2 desc;
--
-- how many V3 customer codes we cannot yet resolve to a V9 uuid:
--   select count(distinct v3_customer_code) from v_event_match
--    where job_customer_uuid is null;
--
-- events that already have BILLED time in V9 (do not double count):
--   select count(*) from v_event_match where te_billed is true;
