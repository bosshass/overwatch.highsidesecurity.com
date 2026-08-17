-- 038_pre_july_closeout.sql
-- Close the book on everything dated before 2026-07-01.
--
-- These rows STAY VISIBLE. Nothing is hidden, nothing is detached.
--   * time_entries are untouched. Customer rollups key on
--     time_entries.customer_id and never on jobs.status -- 199 of 333 entries
--     already carry a customer with no job at all.
--   * Revenue/cost lives in time_entries (billed, billed_at, invoice_ref,
--     archive_reason). jobs.status is board state, not a money fact.
--
-- Status 'complete' + return_reason records WHY these closed, so the
-- mislabeled history stays legible instead of being erased.

begin;

create table if not exists jobs_backup_038_pre_july as
select * from jobs
where status in ('ready_to_schedule','blocked','to_bill','return_pending',
                 'scheduled','new','needs_estimate','needs_parts',
                 'pending_materials','pending_decision','needs_details',
                 'won','accepted','estimate_sent')
  and coalesce(scheduled_date, created_at::date) < '2026-07-01';

update jobs
   set status        = 'complete',
       return_reason = 'Considered completed - pre-2026-07-01 close-out (mig 038). '
                    || 'Prior status was carried by calendar bracket tags, not a disposition.',
       updated_at    = now(),
       updated_by    = 'sara@jnbservice.com'
 where id in (select id from jobs_backup_038_pre_july);

insert into job_history (job_id, from_status, to_status, changed_by, changed_at, notes)
select b.id, b.status, 'complete', 'sara@jnbservice.com', now(),
       'Considered completed. Pre-7/1 close-out. Row and its time entries remain '
       || 'fully visible and attributed to the customer.'
from jobs_backup_038_pre_july b;

-- Open scope carried forward onto the customer record so closing the job
-- does not bury unfinished work (Ferreri: z-wave + cell unit; Sainati: antenna).
insert into notes (body, author_email, customer_id, on_customer_record,
                   status, created_at, job_id, lane)
select 'Carried forward from pre-7/1 close-out (job ' || b.id || '):' || E'\n\n'
       || b.issue,
       'sara@jnbservice.com', b.customer_id, true,
       'open', now(), b.id, 'follow_up'
from jobs_backup_038_pre_july b
where b.customer_id is not null
  and coalesce(b.issue,'') <> '';

commit;

-- verify: pre-July should be only dead / lost / billed / archived / complete
-- select status, count(*) from jobs
--  where coalesce(scheduled_date, created_at::date) < '2026-07-01'
--  group by 1 order by 2 desc;

-- verify rollup is unaffected -- run before AND after, must match:
-- select customer_id, round(sum(total_minutes)/60.0,1) hrs, count(*)
--   from time_entries group by 1 order by 2 desc limit 20;
