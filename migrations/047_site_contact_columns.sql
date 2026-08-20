-- 047 — give the intake template's fields a real home
--
-- WHY
-- NewJobModal prefilled `jobs.issue` with a seven-line text template:
--
--     Name: / Phone: / On-Site Contact: / Contact Phone: / CMS #: /
--     Access: ☐ Permission to enter without client present / Scope of Work:
--
-- Three of those lines duplicated columns that already exist (customer_name,
-- customer_phone, cms_account_id). Three had no column at all, so they could
-- only ever live as prose inside `issue`. And "Scope of Work" — the one thing
-- that answers WHAT ARE WE DOING — was the last line of the blob.
--
-- The cost, measured on live data: of 80 cards carrying the template, 28 have
-- an EMPTY Scope of Work. Those went to a tech as a form skeleton with no job
-- on it. One card has "testing two techs" typed into the Contact Phone line,
-- because the form offered nowhere else to put it.
--
-- Since 9.81.0 `issue` is what the tech reads on the job card and what prints
-- into the Google Calendar description, so the blob is now visible noise in
-- two more places than it used to be.
--
-- WHAT
-- Additive only. Three nullable columns, no defaults that rewrite rows, no
-- constraints. Nothing reads them until the app ships alongside.
--
-- access_permission is BOOLEAN NULL on purpose, three-valued:
--   NULL  — never asked
--   false — asked, client must be present
--   true  — permission to enter without the client
-- A NOT NULL DEFAULT false would silently assert "we asked and they said no"
-- for all 453 existing rows.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_contact_name  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_contact_phone text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS access_permission  boolean;

COMMENT ON COLUMN jobs.site_contact_name  IS
  'Who the tech meets on site, when that is not the account holder. Was the "On-Site Contact:" line of the intake template.';
COMMENT ON COLUMN jobs.site_contact_phone IS
  'Phone for site_contact_name. Was the "Contact Phone:" line of the intake template.';
COMMENT ON COLUMN jobs.access_permission  IS
  'TRUE = may enter without the client present. FALSE = client must be there. NULL = never asked. Was the "Access: ☐" line of the intake template.';
