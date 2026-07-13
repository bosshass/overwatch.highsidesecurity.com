-- Migration 021: track the tech-calendar event created by the Visual Scheduler
-- so jobs can be RESCHEDULED (old event gets deleted instead of orphaned).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_event_id text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_calendar_id text;
