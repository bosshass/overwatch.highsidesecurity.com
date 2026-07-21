# 9.9.4 — Event Audit's orphan check now matches the board's definition

## The bug
scanForOrphans() (the "scan" button in Event Audit / "hand-made calendar
events") checked job_assignments (tech dispatch) + a fuzzy text marker in the
event description ("Managed by JUC-E") to decide if an event was "linked."

That is NOT what the board checks. The board reads jobs.calendar_event_id.
An event could dodge the orphan list — via a stale description marker, or
because it got tagged in Triage (which only rewrites calendar titles, never
creates a job row) — while having ZERO real job/card behind it. That's how
things like Boyd Lake sat tagged [NEEDS NOTES][NEEDS PARTS] for 14+ days and
never once showed up as a data problem.

## The fix
scanForOrphans now checks the exact same thing the board checks: does a row
in `jobs` have this event's calendar_event_id? If yes -> linked (has a card).
If no -> orphan, shows in Event Audit. "No card on the board" and "orphan in
Event Audit" are now the same definition, by construction.

## Note on manual scan
Left as click-to-scan (not auto-run on page load) — it hits the Google
Calendar API per event across every source calendar, and auto-running that
on every page load would slow the app down. That was already a deliberate
choice in the code; only the CORRECTNESS of the check was broken.

## Files (2, no migration)
- src/services/calendarSync.js  (the fix)
- src/App.jsx + public/version.json -> 9.9.4, synced together

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.4-event-audit-fix.zip -d .
git add -A
git commit -m "9.9.4 Event Audit orphan check matches board (jobs.calendar_event_id)"
git push

Test: Event Audit -> tap "scan" -> Boyd Lake (and anything else tagged but
never adopted into a real job) should now appear as an orphan.
