-- 052 — read state for inbound texts
--
-- APPLIED LIVE 2026-08-20.
--
-- WHY
-- Inbound texts are a SHARED inbox: "ya'll can see all." Everybody sees every
-- message regardless of who it was routed to, so "have I dealt with this" is a
-- property of the MESSAGE, not of a person. One reader marking it read clears
-- it for everyone, because in a shared inbox a second person opening it is
-- duplicated work, not diligence.
--
-- Read is deliberately NOT the same as done. A message can be read and still
-- owe an answer; the assignee still owns replying. Read only silences the
-- notification, which is the thing that otherwise nags forever and trains
-- people to ignore the badge.
--
-- NULL read_at = unread, and unread is what the Tasks badge counts.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS read_at  timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS read_by  text;

COMMENT ON COLUMN notes.read_at IS
  'When somebody marked an inbound text read. Shared inbox: everyone sees every message, so one person reading it clears the flag for all. NULL = unread, and unread is what the Tasks badge counts.';
COMMENT ON COLUMN notes.read_by IS 'Who marked it read.';
