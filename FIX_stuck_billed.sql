-- Jobs invoiced (real invoice refs) but still parked in To Bill.
-- NOTE: the column is invoiced_at, NOT billed_at. billed_at lives on
-- time_entries; the two were conflated and that is why nothing ever moved.

-- SEE them:
SELECT j.customer_name, j.status, max(t.invoice_ref) AS invoice
FROM jobs j
JOIN time_entries t ON t.job_id = j.id
   OR (j.calendar_event_id IS NOT NULL AND t.calendar_event_id = j.calendar_event_id)
WHERE j.status IN ('to_bill','complete')
GROUP BY j.id, j.customer_name, j.status
HAVING count(*) FILTER (WHERE t.billed IS TRUE) > 0
   AND count(*) FILTER (WHERE coalesce(t.billed,false)=false
                          AND coalesce(t.archived,false)=false) = 0;

-- Move them (only where EVERY hour is already billed):
UPDATE jobs SET status = 'billed', invoiced_at = coalesce(invoiced_at, now())
WHERE id IN (
  SELECT j.id FROM jobs j
  JOIN time_entries t ON t.job_id = j.id
     OR (j.calendar_event_id IS NOT NULL AND t.calendar_event_id = j.calendar_event_id)
  WHERE j.status IN ('to_bill','complete')
  GROUP BY j.id
  HAVING count(*) FILTER (WHERE t.billed IS TRUE) > 0
     AND count(*) FILTER (WHERE coalesce(t.billed,false)=false
                            AND coalesce(t.archived,false)=false) = 0);
