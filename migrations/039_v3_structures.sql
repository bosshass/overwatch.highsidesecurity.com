-- 039_v3_structures.sql
-- STEP 1 of the V9 -> V3 restructure: build what doesn't exist yet.
--
-- Purely additive. Creates no obligations, moves no data, drops nothing.
-- Every table is transcribed from V3's shape with ONE deliberate change:
-- customer_id is uuid, not text, because V9 keys customers on uuid.
--
-- Nothing writes to these tables until app logic is routed in a later step.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. monitoring_accounts  -- many CMS accounts per customer
--    V9 crams a single cs_number onto customers, which is why the
--    346-flagged vs 257-billed reconciliation was so painful.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists monitoring_accounts (
  cs_number     text primary key,
  customer_id   uuid references customers(id),
  label         text,
  is_primary    boolean not null default false,
  is_active     boolean not null default true,
  import_batch  text,
  -- QBO LINKAGE. Transcribed from V3, which has NO QuickBooks fields anywhere —
  -- so these three were missing and had to be added. They are the whole point:
  -- without qbo_customer_id you cannot answer "which QBO customer does EL3552
  -- bill to", which is the Acertara problem and the 102 monitored customers
  -- with no QBO link.
  qbo_customer_id    text,
  qbo_customer_name  text,
  monthly_rate       numeric(10,2),
  created_at    timestamptz not null default now()
);
create index if not exists idx_mon_acct_qbo on monitoring_accounts(qbo_customer_id);
create index if not exists idx_mon_acct_customer on monitoring_accounts(customer_id);
comment on table monitoring_accounts is
  'One row per CMS account. A customer may hold several. Source of truth for '
  'monitoring billing -- customers.cs_number is legacy and will be frozen.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. estimates  -- pulls the qbo_* sales lifecycle off jobs
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists estimates (
  id                      uuid primary key default gen_random_uuid(),
  customer_id             uuid references customers(id),
  job_id                  uuid references jobs(id),
  estimate_number         text,
  status                  text,
  amount                  numeric,
  description             text,
  created_by              text,
  created_at              timestamptz not null default now(),
  sent_at                 timestamptz,
  decided_at              timestamptz,
  decided_note            text,
  contract_received       boolean not null default false,
  contract_signed         boolean not null default false,
  welcome_letter_sent     boolean not null default false,
  intro_letter_sent       boolean not null default false,
  materials_invoice_sent  boolean not null default false,
  materials_invoice_paid  boolean not null default false,
  spawned_job_id          uuid references jobs(id)
);
create index if not exists idx_est_customer on estimates(customer_id);
create index if not exists idx_est_job      on estimates(job_id);
comment on table estimates is
  'Sales lifecycle. Replaces jobs.qbo_estimate_id / qbo_estimate_ref / '
  'qbo_estimate_status / estimate_amount / deposit_*. spawned_job_id links '
  'an accepted estimate to the job it created.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. parts_orders  -- procurement lifecycle
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists parts_orders (
  id                       uuid primary key default gen_random_uuid(),
  job_id                   uuid references jobs(id),
  estimate_id              uuid references estimates(id),
  description              text,
  qty                      numeric,
  requested_at             timestamptz,
  requested_by             text,
  ordered_at               timestamptz,
  ordered_by               text,
  tracking_number          text,
  arrived_at               timestamptz,
  billable                 boolean,
  non_billable_reason      text,
  non_billable_note        text,
  billing_acknowledged_at  timestamptz,
  billing_acknowledged_by  text
);
create index if not exists idx_parts_job on parts_orders(job_id);
comment on table parts_orders is
  'requested -> ordered -> arrived. Replaces jobs.parts_ordered / '
  'parts_received / parts_notes / parts booleans, which could only ever '
  'describe one order per job.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. job_materials  -- line-item materials
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists job_materials (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid references jobs(id),
  tech_id      uuid references techs(id),
  description  text,
  qty          numeric,
  source       text,
  entered_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_jobmat_job on job_materials(job_id);
comment on table job_materials is
  'Line items. Replaces the free-text jobs.materials_used blob that techs '
  'were typing invoice-relevant costs into.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. tasks  -- office and field errands that are NOT jobs
--    These became junk-status jobs in V9 for lack of anywhere to live:
--    "Battery Plus cr123 for David", "Confirm fire x relay for Shirley
--    Watson", "PREPARE FOR CHRIS HARE INSTALL", "Order Parts for Jerry Pault"
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists tasks (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid references jobs(id),
  title              text not null,
  notes              text,
  assigned_to        text,
  assigned_by        text,
  due_date           date,
  on_complete        text,
  status             text not null default 'open'
                     check (status in ('open','done','promoted')),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  completed_by       text,
  promoted_to_job_id uuid references jobs(id)
);
create index if not exists idx_tasks_status on tasks(status) where status = 'open';
create index if not exists idx_tasks_job    on tasks(job_id);
comment on table tasks is
  'job_id null = standalone task. on_complete = lane key to move the job to '
  'when done, or null to leave it in place. Three statuses, enforced.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. customer_history  -- reference-only historical calendar events
--    Never a board card, never billable, never counted in utilization.
--    time_in_raw / time_out_raw stay TEXT on purpose: these are what the
--    calendar said, not verified clock time. Do not cast them.
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
create index if not exists idx_custhist_customer on customer_history(customer_id);
create index if not exists idx_custhist_occurred on customer_history(occurred_at);
comment on table customer_history is
  'Reference only -- never a board card, never billable, never counted in '
  'utilization. Hours are what the calendar said, not verified time. '
  'Rows stay fully visible and attributed to the customer.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Additive columns on existing tables
-- ═══════════════════════════════════════════════════════════════════════════

-- time_entries: separate "never happened" from "happened, ours to eat".
-- Today `archived` collapses both, which is why 98.1 hours can't be triaged.
alter table time_entries
  add column if not exists billable            boolean,
  add column if not exists non_billable_reason text,
  add column if not exists resolved_by         text,
  add column if not exists resolved_at         timestamptz,
  add column if not exists entered_by          text,
  add column if not exists assignment_id       uuid references job_assignments(id);

update time_entries
   set billable = not coalesce(archived, false)
 where billable is null;

-- job_assignments: the calendar lifecycle V9 never had.
-- event_state + removed_at replace title-string parsing.
-- completed_event_id records a Completed-Work move without mutating a title.
alter table job_assignments
  add column if not exists calendar_id                text,
  add column if not exists event_state                text,
  add column if not exists removed_at                 timestamptz,
  add column if not exists removed_by                 text,
  add column if not exists completed_event_id         text,
  add column if not exists billed_at                  timestamptz,
  add column if not exists returns_from_time_entry_id uuid references time_entries(id);

-- discriminators + tech capacity thresholds
alter table job_history add column if not exists kind text;
alter table notes       add column if not exists kind text;
alter table techs
  add column if not exists kind         text,
  add column if not exists weekly_hours numeric,
  add column if not exists amber_hours  numeric,
  add column if not exists red_hours    numeric;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
-- All six tables exist and are empty:
--   select relname, n_live_tup from pg_stat_user_tables
--    where relname in ('monitoring_accounts','estimates','parts_orders',
--                      'job_materials','tasks','customer_history');
--
-- billable backfilled, nothing else moved:
--   select billable, archived, count(*), round(sum(total_minutes)/60.0,1) hrs
--     from time_entries group by 1,2 order by 1,2;
--
-- ROLLUP CHECKSUM -- run before and after, must be identical:
--   select customer_id, count(*) n, sum(total_minutes) mins
--     from time_entries group by 1 order by 2 desc;
