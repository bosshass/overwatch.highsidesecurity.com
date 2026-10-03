-- ROLLBACK 060 — put the 5 rows back on the merged-away cards
update time_entries t set job_id = b.job_id, merged_from_job_id = null
from time_entries_backup_060 b where t.id = b.id;
