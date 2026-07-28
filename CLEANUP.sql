-- 1. Stale holds: jobs pinned in Tentative by a hold nobody cleared.
SELECT id, customer_name, status, tentative_date FROM jobs
WHERE tentative_date IS NOT NULL
  AND status IN ('complete','to_bill','billed','won','lost','dead','archived');
-- UPDATE jobs SET tentative_date=NULL, tentative_event_id=NULL
-- WHERE tentative_date IS NOT NULL
--   AND status IN ('complete','to_bill','billed','won','lost','dead','archived');

-- 2. To Bill with no hours: the "floating in space" tickets.
SELECT j.id, j.customer_name, j.status, j.updated_at FROM jobs j
WHERE j.status IN ('to_bill','complete')
  AND NOT EXISTS (SELECT 1 FROM time_entries t
                  WHERE t.job_id = j.id OR t.calendar_event_id = j.calendar_event_id)
ORDER BY j.updated_at DESC;

-- 3. Ownership spread across columns.
SELECT
  count(*) FILTER (WHERE assigned_to IS NOT NULL)                       AS has_assigned_to,
  count(*) FILTER (WHERE assigned_to IS NULL AND tech_name IS NOT NULL) AS only_tech_name,
  count(*) FILTER (WHERE assigned_to IS NULL AND tech_name IS NULL)     AS unowned
FROM jobs WHERE status NOT IN ('billed','archived','dead','lost');
