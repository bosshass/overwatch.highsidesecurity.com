-- 051 ROLLBACK — reopen the eight notes exactly as they were.
UPDATE notes n
SET status      = b.status,
    lane        = b.lane,
    archived_at = b.archived_at,
    archived_by = b.archived_by
FROM notes_backup_051 b
WHERE n.id = b.id;

-- VERIFY: back to 15.
--   SELECT count(*) FROM notes WHERE status='open' AND assigned_to IS NULL;
