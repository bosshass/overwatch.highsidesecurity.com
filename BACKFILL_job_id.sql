-- 320 of 357 time_entries have job_id = NULL; they link only via calendar_event_id.
-- SEE what would change:
SELECT count(*) AS would_be_linked
FROM time_entries t JOIN jobs j ON j.calendar_event_id = t.calendar_event_id
WHERE t.job_id IS NULL AND t.calendar_event_id IS NOT NULL;

-- Then link them (fills blanks only, never overwrites):
-- UPDATE time_entries t SET job_id = j.id FROM jobs j
-- WHERE t.job_id IS NULL AND t.calendar_event_id IS NOT NULL
--   AND j.calendar_event_id = t.calendar_event_id;
