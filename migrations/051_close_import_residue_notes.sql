-- 051 — close the eight import-residue notes
--
-- APPLIED LIVE 2026-08-20, on Sara's instruction ("close the 8").
--
-- WHY THESE EIGHT AND NOTHING ELSE
-- Fifteen notes were open with no assignee. Seven are genuine client notes
-- written by real people between Aug 13 and Aug 19; those are Sara's to route
-- and are NOT touched here.
--
-- The other eight came out of a Jul 27-28 import. Every one of them was
-- verified against its job before being included:
--
--   * all eight sit in lane 'doing' with assigned_to NULL — nobody is working
--     them and the lane says somebody is
--   * all eight carry a job_id
--   * for all eight, the note body is a VERBATIM COPY of that job's `issue`
--   * all eight of those jobs are already TERMINAL — archived, lost, dead or
--     billed
--   * two are exact duplicates of each other (MC CRERY, CYNTHIA, twice)
--
-- So they hold nothing their job does not already hold, and the work they
-- describe is finished. Closing them removes a queue, not information.
--
-- HOW
-- Written exactly as the app's own Done button writes it (Notes.jsx `archive`):
-- status 'archived', archived_at, archived_by. The rows end up indistinguishable
-- from anything closed by hand.
--
-- on_customer_record is deliberately LEFT ALONE. That flag means "this belongs
-- on the client's history", and the job already carries the text — setting it
-- would put a second copy on the customer record.
--
-- NOTE ON 'archived' vs 'closed': notes.status currently holds three values
-- where the migration allowed two (open 31, archived 79, closed 14). That drift
-- is real and unresolved (DECISIONS.md). This uses 'archived' because that is
-- what the Done button writes today — resolving the drift is its own change,
-- and making these eight rows a fourth special case would add to the problem.

BEGIN;

DROP TABLE IF EXISTS notes_backup_051;
CREATE TABLE notes_backup_051 AS
SELECT n.id, n.status, n.lane, n.archived_at, n.archived_by
FROM notes n
JOIN jobs j ON j.id = n.job_id
WHERE n.status = 'open'
  AND n.assigned_to IS NULL
  AND n.lane = 'doing'
  AND n.job_id IS NOT NULL
  AND j.status IN ('archived', 'lost', 'dead', 'billed');

UPDATE notes n
SET status      = 'archived',
    archived_at = now(),
    archived_by = 'info@drhsecurityservices.com'
FROM notes_backup_051 b
WHERE n.id = b.id;

COMMIT;

-- VERIFY: expect closed = 8, and left_open = 7 (the genuine client notes).
--   SELECT (SELECT count(*) FROM notes_backup_051) AS closed,
--          (SELECT count(*) FROM notes WHERE status='open' AND assigned_to IS NULL) AS left_open;
