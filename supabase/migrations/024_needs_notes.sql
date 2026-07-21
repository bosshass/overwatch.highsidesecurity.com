-- 024: "No Notes, No Money" — flag completed visits with no tech notes.
-- Flag RIDES ON TOP of status; it does not hijack the status machine.
alter table jobs add column if not exists needs_notes boolean default false;
alter table jobs add column if not exists needs_notes_flagged_at timestamptz;
create index if not exists idx_jobs_needs_notes on jobs (needs_notes) where needs_notes = true;
