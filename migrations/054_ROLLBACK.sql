-- Rollback 054
-- Delete the cards this migration created, then restore notes.job_id and the
-- statuses of the parents it revived.
delete from job_history where job_id in (
  select j.id from jobs j
  where j.job_type='note' and j.created_by is not null
    and j.id in (select job_id from notes where id in (select id from backup_054_notes where job_id is null)));

delete from jobs where id in (
  select job_id from notes where id in (select id from backup_054_notes where job_id is null));

update notes n set job_id = b.job_id from backup_054_notes b where n.id = b.id;

update jobs j set status = b.status, updated_by = b.updated_by, updated_at = b.updated_at
from backup_054_jobs b where j.id = b.id;

drop table if exists backup_054_notes;
drop table if exists backup_054_jobs;
