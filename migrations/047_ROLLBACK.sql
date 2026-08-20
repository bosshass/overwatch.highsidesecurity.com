-- 047 ROLLBACK — drop the three site-contact columns.
--
-- Safe to run ONLY if 048 has not been applied, or has been rolled back first.
-- 048 moves data OUT of jobs.issue INTO these columns; dropping them after 048
-- without rolling 048 back would destroy the on-site contact details rather
-- than restore them.

ALTER TABLE jobs DROP COLUMN IF EXISTS site_contact_name;
ALTER TABLE jobs DROP COLUMN IF EXISTS site_contact_phone;
ALTER TABLE jobs DROP COLUMN IF EXISTS access_permission;
