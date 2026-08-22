-- Rollback 057
update jobs j set is_fixed_fee = b.is_fixed_fee, updated_by = b.updated_by, updated_at = b.updated_at
from backup_057_jobs b where j.id = b.id;

delete from job_history
where job_id = 'a2ace2ac-0079-40c6-9221-fac870481ac4'
  and notes like 'Marked fixed fee — BG Automotive was always fixed fee%';

drop table if exists backup_057_jobs;
