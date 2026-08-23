-- ============================================
-- 058 — What parts does the return trip need?
-- ============================================
-- The return handover asks a tech three things: what you did today, what still
-- needs doing, and what parts to bring. Two of those have somewhere to live —
-- time_entries.notes and return_cards.reason. The parts do not.
--
-- Without this column the answer has one place to go: appended into
-- return_cards.reason as prose. Then scheduling cannot tell "needs a PIR and a
-- 12V supply" from the rest of the sentence, nobody can list what is on order
-- across every pending return, and the only way back out of that field is to
-- read it — which is the free-text disease this codebase spent months undoing.
--
-- So: its own column. Nullable, because a return that needs no parts is normal
-- and must not be blocked on an empty box.
--
-- SAFE TO RUN TWICE. ADD COLUMN IF NOT EXISTS touches nothing that exists.
-- No data is read, moved or deleted. Nothing writes to this column until
-- JobFinishSheet is updated to send it — running this alone changes no
-- behaviour anywhere in the app.

ALTER TABLE return_cards
  ADD COLUMN IF NOT EXISTS materials_needed TEXT;

COMMENT ON COLUMN return_cards.materials_needed IS
  'Parts/equipment the return trip needs, written by the tech who flagged it. '
  'Free text on purpose — it is a shopping list for a human, not a key. '
  'NULL means nothing was listed, not that nothing is needed.';

-- Check it landed:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'return_cards' AND column_name = 'materials_needed';
