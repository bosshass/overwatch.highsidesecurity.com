-- ============================================
-- 046 · Un-flag every "project hours" time entry
-- ============================================
-- APPLIED LIVE 2026-08-20 against wolhqelloeypafmmvapn.
-- This file is the record. Do not re-run; it is idempotent but pointless.
--
-- Audit slug: unflag-project-hours-2026-08-20
-- (time_entries has no updated_by column, so attribution lives here and in
--  time_entries_backup_046.backup_reason.)
--
-- ── WHY ─────────────────────────────────────────────────────────────────
-- Migration 042's backfill wrote billable=false, non_billable_reason='project
-- hours' onto 17 rows. That is the right answer in the wrong field.
--
-- billable / non_billable_reason record a DELIBERATE WRITE-OFF — warranty,
-- goodwill, test, duplicate. See src/config/archiveReasons.js.
--
-- "How the work was sold" is a different question and belongs to the CARD
-- (jobs.is_fixed_fee), not to the hour. Fixed-fee hours are not written off;
-- they are unbilled hours that burn against a contract. Putting that on the
-- row meant an individual entry could be — and was — wrongly marked.
--
-- Sara, 2026-08-20: "they are not complete or blocked - they are visits done
-- not billed." That applies to Jeanneret and Shepard too, which is why all 17
-- are cleared and not just the ten on non-fixed-fee jobs.
--
-- ── EFFECT ──────────────────────────────────────────────────────────────
--   billing queue   3 entries /  2.5h  →  14 entries / 41.5h
--   rows changed    17
--   untouched       307 total / 228 billed / 45 archived
--
-- Permanent fix is build step E4: revenue treatment derives from the card, so
-- 'project hours' stops being writable at the row level at all.
-- ========================================================================

-- Rollback set: only the two columns that change, for exactly the 17 rows.
CREATE TABLE IF NOT EXISTS time_entries_backup_046 AS
SELECT id, billable, non_billable_reason, now() AS backed_up_at,
       'A1 unflag-project-hours 2026-08-20' AS backup_reason
FROM time_entries
WHERE non_billable_reason = 'project hours';

UPDATE time_entries
SET billable = NULL,
    non_billable_reason = NULL
WHERE non_billable_reason = 'project hours';

-- Verify: both must return 0.
--   SELECT count(*) FROM time_entries WHERE non_billable_reason = 'project hours';
--   SELECT count(*) FROM time_entries WHERE billable IS FALSE;
