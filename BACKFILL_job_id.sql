-- 320 of 357 time_entries have job_id = NULL and link only via calendar_event_id.
-- Every screen has to remember to check both, and Billing forgot.
-- SEE what would change first:
SELECT count(*) AS would_be_linked
FROM time_entries t
JOIN jobs j ON j.calendar_event_id = t.calendar_event_id
WHERE t.job_id IS NULL AND t.calendar_event_id IS NOT NULL;

-- Then link them (safe: only fills blanks, never overwrites):
-- UPDATE time_entries t SET job_id = j.id
-- FROM jobs j
-- WHERE t.job_id IS NULL
--   AND t.calendar_event_id IS NOT NULL
--   AND j.calendar_event_id = t.calendar_event_id;

-- Jobs stuck in To Bill whose hours were ALREADY invoiced.
-- These are done and paid; the card just never moved.
SELECT j.id, j.customer_name, j.status
FROM jobs j
WHERE j.status IN ('to_bill','complete')
  AND EXISTS (SELECT 1 FROM time_entries t
              WHERE (t.job_id = j.id OR t.calendar_event_id = j.calendar_event_id)
                AND t.billed IS TRUE)
  AND NOT EXISTS (SELECT 1 FROM time_entries t
                  WHERE (t.job_id = j.id OR t.calendar_event_id = j.calendar_event_id)
                    AND t.billed IS NOT TRUE
                    AND coalesce(t.archived,false) = false);
