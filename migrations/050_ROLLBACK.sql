-- 050 ROLLBACK — put the job back in to_bill.
UPDATE jobs j SET status = b.status
FROM jobs_backup_050 b WHERE j.id = b.id;

DELETE FROM job_history
WHERE job_id = '8e216a1c-bc51-4871-94aa-4964bdb20e68'
  AND notes LIKE 'All time written off — Test entry (retroactive%';
