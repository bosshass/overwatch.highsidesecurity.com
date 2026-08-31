-- ============================================================
-- 034 — Add original_event_date to return_cards
-- ============================================================
-- return_cards was missing the actual date of the original visit.
-- `created_at` was the only date reference, which always reads as
-- today even when the card was raised for a visit last Friday.
-- The scheduler and board would see today as the visit date and
-- sort / display accordingly — making last week's blocked trip look
-- like today's.
-- ============================================================

ALTER TABLE return_cards
  ADD COLUMN IF NOT EXISTS original_event_date TIMESTAMPTZ;

-- Back-fill from time_entries where the link exists.
-- time_entries.event_start carries the correct calendar event date.
UPDATE return_cards rc
SET    original_event_date = te.event_start
FROM   time_entries te
WHERE  rc.time_entry_id = te.id
  AND  rc.original_event_date IS NULL
  AND  te.event_start IS NOT NULL;
