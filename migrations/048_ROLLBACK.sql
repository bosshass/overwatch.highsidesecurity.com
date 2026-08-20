-- 048 ROLLBACK — put the original `issue` text back on all 80 rows.
--
-- Restores issue, site_contact_name, site_contact_phone and access_permission
-- to exactly what they were before 048 ran. Requires jobs_backup_048, which
-- 048 creates. Run this BEFORE 047_ROLLBACK if you are undoing both.

BEGIN;

UPDATE jobs j
SET issue              = b.issue,
    site_contact_name  = b.site_contact_name,
    site_contact_phone = b.site_contact_phone,
    access_permission  = b.access_permission
FROM jobs_backup_048 b
WHERE j.id = b.id;

COMMIT;

-- VERIFY: should return 80, matching the row count of jobs_backup_048.
--   SELECT count(*) FROM jobs WHERE issue ILIKE '%Scope of Work:%';
