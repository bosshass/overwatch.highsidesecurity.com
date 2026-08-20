-- 052 ROLLBACK — drop read state. Every message returns to unread.
ALTER TABLE notes DROP COLUMN IF EXISTS read_at;
ALTER TABLE notes DROP COLUMN IF EXISTS read_by;
