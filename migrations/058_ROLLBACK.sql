-- Rollback 058
begin;

update jobs j
set customer_id        = b.customer_id,
    tech_assigned      = b.tech_assigned,
    tech_name          = b.tech_name,
    assigned_to        = b.assigned_to,
    status             = b.status,
    calendar_event_id  = b.calendar_event_id,
    scheduled_event_id = b.scheduled_event_id,
    scheduled_date     = b.scheduled_date,
    updated_by         = b.updated_by,
    updated_at         = b.updated_at
from backup_058_jobs b where j.id = b.id;

update time_entries t
set job_id = b.job_id, customer_id = b.customer_id
from backup_058_time_entries b where t.id = b.id;

delete from job_history where changed_by = 'admin@jnbservice.com' and notes like 'Data repair 058:%';

drop table if exists backup_058_jobs;
drop table if exists backup_058_time_entries;

commit;
