-- 050 — settle the job whose every time entry was written off as not-real
--
-- APPLIED LIVE 2026-08-20.
--
-- WHY
-- A DRH visit on Aug 19 was dispositioned "bill it", then cleared from Billing
-- as a Test entry. The archive wrote time_entries.archived = true and
-- archive_reason = 'test' — and stopped there. jobs.status stayed 'to_bill',
-- so the client's record still listed it under OPEN WORK: a job with no hours,
-- no revenue and nothing left to do, presented as outstanding work.
--
-- The code fix is the write-through in Unbilled.doArchive (9.85.0). It only
-- fires on future archives, so this one row is repaired by hand.
--
-- WHY 'dead' AND NOT 'complete'
-- The reason class decides. 'test' is not_real: no truck rolled, no hours were
-- spent. Calling it complete would assert work was done. 'dead' is the honest
-- terminal status and is already treated as done everywhere.
--
-- NOT 'archived' — that status is frozen (DECISIONS.md): existing rows stay
-- readable, nothing writes it again.
--
-- SCOPE: exactly one row. Three other jobs have no live time and a non-terminal
-- status (2 estimate_sent, 1 return_pending) and are DELIBERATELY LEFT ALONE —
-- their remaining obligation is a return visit or a customer's answer, not the
-- billing, so closing them would delete work somebody is expecting.

DROP TABLE IF EXISTS jobs_backup_050;
CREATE TABLE jobs_backup_050 AS
SELECT id, status, updated_at FROM jobs WHERE id = '8e216a1c-bc51-4871-94aa-4964bdb20e68';

UPDATE jobs SET status = 'dead', updated_by = 'info@drhsecurityservices.com'
WHERE id = '8e216a1c-bc51-4871-94aa-4964bdb20e68' AND status = 'to_bill';

INSERT INTO job_history (job_id, from_status, to_status, changed_by, notes)
VALUES ('8e216a1c-bc51-4871-94aa-4964bdb20e68', 'to_bill', 'dead',
        'info@drhsecurityservices.com',
        'All time written off — Test entry (retroactive: the archive write-through did not exist when this was cleared)');
