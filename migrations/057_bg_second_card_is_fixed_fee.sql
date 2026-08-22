-- 057 — BG Automotive's second card was always fixed fee too
--
-- "BG's were always FF, so were all of Jeanneret's — find any for those
--  clients and for Shepard that are marked bill it but never billed."
--
-- Found them. Almost nothing needed writing, because 9.109.0 already derives
-- it: unbilledBucket returns 'project' when the JOB carries is_fixed_fee, so
-- every hour on a flagged job reads as cost against the price without anyone
-- ticking each entry.
--
--   Jeanneret  38.0h on f0a7e60b  — job is fixed fee  -> already correct
--   Shepard    19.5h on 60cb9384  — job is fixed fee  -> already correct
--   BG         16.0h on ca8d24a9  — job is fixed fee  -> already correct
--   BG          3.0h on a2ace2ac  — NOT FLAGGED       -> the only gap
--
-- a2ace2ac is a second BG card (JR, 7/23, disposition `return`, status
-- complete). Its three hours read as invoiceable purely because nobody ever
-- ticked the box on that card. Same root as "one job, several cards": the
-- customer is fixed fee, the work is fixed fee, and one of their cards did not
-- know it.
--
-- ONE COLUMN, ONE ROW. Deliberately not merging a2ace2ac into ca8d24a9 — that
-- is a judgement about whether they are the same job, and the merge tool on the
-- board is where a person makes it with the history in front of them. Flagging
-- is reversible in a keystroke; merging is not.
--
-- APPLIED LIVE 2026-08-21. Backup written first.

create table if not exists backup_057_jobs as
  select id, is_fixed_fee, updated_by, updated_at from jobs
  where id = 'a2ace2ac-0079-40c6-9221-fac870481ac4';

update jobs
set is_fixed_fee = true, updated_by = 'admin@jnbservice.com', updated_at = now()
where id = 'a2ace2ac-0079-40c6-9221-fac870481ac4';

insert into job_history(job_id, from_status, to_status, changed_by, notes)
select id, status, status, 'admin@jnbservice.com',
       'Marked fixed fee — BG Automotive was always fixed fee. Its 3.0h read as invoiceable only because this card was never flagged.'
from jobs where id = 'a2ace2ac-0079-40c6-9221-fac870481ac4';
