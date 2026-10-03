-- 059 — time_entries.merged_from_job_id
--
-- "When you merge, the hours need to behave just like the status of the card
-- they're being merged into." Billing buckets an hour by the TECH'S
-- disposition first (bill it / return / estimate) and only falls back to the
-- card's status. That's right for an hour logged on its own card — but an hour
-- that arrived by merge has to follow the card it now lives on.
--
-- This column is that marker. NULL for every existing row; set by the merge
-- (src/services/mergeJobs.js) on each entry it moves. unbilledBucket() in
-- src/utils/jobResolve.js reads it. Additive, nullable, no rows changed.

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS merged_from_job_id uuid;

COMMENT ON COLUMN time_entries.merged_from_job_id IS
  'Card this entry was moved off of by a merge. When set, Billing buckets the entry by the status of the card it now belongs to, not by its original disposition.';
