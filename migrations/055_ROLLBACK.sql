-- Rollback 055. The money columns were never touched, so only the new ones go.
alter table jobs
  drop column if exists progress_invoiced_at,
  drop column if exists progress_invoiced_by,
  drop column if exists progress_invoice_count,
  drop column if exists completed_by,
  drop column if exists hours_budget;

update jobs j set is_complete = b.is_complete, completed_at = b.completed_at
from backup_055_jobs b where j.id = b.id;

drop table if exists backup_055_jobs;
