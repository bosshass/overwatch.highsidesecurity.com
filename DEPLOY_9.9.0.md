# Overwatch 9.9.0 — full build (from your 9.8.3 repo)

## ⚠️ RUN MIGRATION FIRST
supabase/migrations/024_needs_notes.sql — adds jobs.needs_notes + needs_notes_flagged_at.
Run in Supabase SQL editor BEFORE deploying or the 🚩 flag button errors.

## Everything in this build (5 files + migration)
1. ShortLink.jsx — FIX: dead /j/ deep links (uuid ~~ unknown). The real break.
2. BoardView.jsx — New/Waiting column split, notes+tasks off board columns,
   + 💸 UNBILLED needs-notes badge on cards.
3. Queue.jsx — 🚩 Need Notes button in triage; adopts calendar-only events into
   the jobs table when flagged (plugs the calendar->DB money leak).
4. Unbilled.jsx — red "N visits can't be billed — no notes" banner, per-job rows,
   $135/hr + $102.22 trip-charge floor math.
5. TechWorkToday.jsx — per-tech "💸 $X can't be billed until you write notes" banner,
   bold callout for anything 3+ days old.

## Deploy
1. Run 024 in Supabase.
2. Unzip over repo root → git add -A && git commit -m "9.9.0" → git push
3. Verify /version.json = 9.9.0
4. Test: Triage → flag a note-less completed visit → confirm it shows in the
   Unbilled banner, lights the board badge, and appears on that tech's Today view.
