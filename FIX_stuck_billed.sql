-- Eight jobs invoiced (real invoice numbers) but still sitting in To Bill,
-- because until 9.16.1 the write-through couldn't find them, and until 9.17.0
-- there was no way to mark a job billed from the ticket at all.
-- SEE them first:
SELECT j.customer_name, j.status, max(t.invoice_ref) AS invoice
FROM jobs j
JOIN time_entries t ON t.job_id = j.id
   OR (j.calendar_event_id IS NOT NULL AND t.calendar_event_id = j.calendar_event_id)
WHERE j.status IN ('to_bill','complete')
GROUP BY j.id, j.customer_name, j.status
HAVING count(*) FILTER (WHERE t.billed IS TRUE) > 0
   AND count(*) FILTER (WHERE coalesce(t.billed,false)=false
                          AND coalesce(t.archived,false)=false) = 0;

-- Then move them. Only touches jobs where EVERY hour is already billed.
-- UPDATE jobs SET status = 'billed', billed_at = coalesce(billed_at, now())
-- WHERE id IN (
--   SELECT j.id FROM jobs j
--   JOIN time_entries t ON t.job_id = j.id
--      OR (j.calendar_event_id IS NOT NULL AND t.calendar_event_id = j.calendar_event_id)
--   WHERE j.status IN ('to_bill','complete')
--   GROUP BY j.id
--   HAVING count(*) FILTER (WHERE t.billed IS TRUE) > 0
--      AND count(*) FILTER (WHERE coalesce(t.billed,false)=false
--                             AND coalesce(t.archived,false)=false) = 0);
