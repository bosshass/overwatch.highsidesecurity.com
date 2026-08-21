-- Rollback 053
update jobs j
set status = b.status, updated_by = b.updated_by, updated_at = b.updated_at
from backup_053_tae_won_suh b
where j.id = b.id;

delete from job_history
where job_id = '8bfbd411-496e-4e80-8269-ae32edd06504'
  and to_status = 'blocked'
  and changed_by = 'admin@jnbservice.com';

drop table if exists backup_053_tae_won_suh;
