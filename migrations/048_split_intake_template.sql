-- 048 — pull the intake template apart on the 80 cards that carry it
--
-- WHY
-- 047 gave the template's three homeless lines real columns. This moves the
-- existing rows into them, so `jobs.issue` holds ONLY the scope of work — the
-- answer to "what are we doing" — on old cards as well as new ones.
--
-- This matters more since 9.81.0 than it did before it: `issue` is now what
-- the tech reads on the job card and what prints into the Google Calendar
-- description. Every one of these 80 cards renders a seven-line form skeleton
-- in both places, three lines of which duplicate columns that are already
-- printed on their own (customer_name, customer_phone, cms_account_id).
--
-- SHAPE OF THE DATA (measured, not assumed)
--   80  rows carry "Scope of Work:"
--   52  have a real scope   → issue becomes just that
--   28  have a BLANK scope  → issue becomes NULL. These cards never had a job
--                             written on them; the skeleton only made it look
--                             like they did. NULL is the honest value and the
--                             new intake form flags it in amber.
--   14  have an on-site contact name    → site_contact_name
--   14  have an on-site contact phone   → site_contact_phone
--    0  ever ticked the Access box      → access_permission stays NULL
--                                        ("never asked"), which is the truth.
--
-- NOTHING IS DISCARDED. `residue` below is whatever is left after the seven
-- known template lines are removed. On a row where somebody typed outside the
-- skeleton, that text is appended to the scope rather than dropped. The full
-- original `issue` is also kept in jobs_backup_048 regardless.

BEGIN;

-- ── BACKUP ────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS jobs_backup_048;
CREATE TABLE jobs_backup_048 AS
SELECT id, issue, site_contact_name, site_contact_phone, access_permission
FROM jobs
WHERE issue ILIKE '%Scope of Work:%';

-- ── PARSE ─────────────────────────────────────────────────────────────
WITH parsed AS (
  SELECT
    id,
    btrim(coalesce(substring(issue from 'On-Site Contact:([^\n\r]*)'), '')) AS onsite_name,
    btrim(coalesce(substring(issue from 'Contact Phone:([^\n\r]*)'),   '')) AS onsite_phone,
    btrim(coalesce(substring(issue from 'Scope of Work:((?:.|\n|\r)*)$'), '')) AS scope,
    -- everything that is NOT one of the seven known template lines
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(issue, 'Scope of Work:(?:.|\n|\r)*$', '', 'g'),
        '^(Name:|Phone:|On-Site Contact:|Contact Phone:|CMS #:|Access:)[^\n\r]*[\n\r]*', '', 'gm'),
      -- On at least one row the Access label and its checkbox wrapped onto
      -- separate lines, so the box survived the pass above and would have been
      -- carried into the scope as junk.
      '^[☐☑☒]\s*Permission to enter without client present[^\n\r]*[\n\r]*', '', 'gm'
    )) AS residue
  FROM jobs
  WHERE issue ILIKE '%Scope of Work:%'
),
final AS (
  SELECT
    id,
    nullif(onsite_name,  '') AS onsite_name,
    nullif(onsite_phone, '') AS onsite_phone,
    nullif(btrim(concat_ws(E'\n\n', nullif(scope, ''), nullif(residue, ''))), '') AS new_issue
  FROM parsed
)
UPDATE jobs j
SET issue              = f.new_issue,
    site_contact_name  = coalesce(j.site_contact_name,  f.onsite_name),
    site_contact_phone = coalesce(j.site_contact_phone, f.onsite_phone)
FROM final f
WHERE j.id = f.id;

COMMIT;

-- ── VERIFY ────────────────────────────────────────────────────────────
-- Expect: templates_left = 0, and the counts below matching the header.
--
--   SELECT
--     (SELECT count(*) FROM jobs WHERE issue ILIKE '%Scope of Work:%') AS templates_left,
--     (SELECT count(*) FROM jobs j JOIN jobs_backup_048 b ON b.id=j.id
--        WHERE j.issue IS NOT NULL)                                   AS issue_kept,
--     (SELECT count(*) FROM jobs j JOIN jobs_backup_048 b ON b.id=j.id
--        WHERE j.issue IS NULL)                                       AS issue_now_null,
--     (SELECT count(*) FROM jobs j JOIN jobs_backup_048 b ON b.id=j.id
--        WHERE j.site_contact_name IS NOT NULL)                       AS onsite_names,
--     (SELECT count(*) FROM jobs_backup_048)                          AS rows_touched;
