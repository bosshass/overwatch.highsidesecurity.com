# 9.9.5 — /j/ links open the card directly (no board round-trip)

## The bug
ShortLink resolved the job fine, then did:
  navigate(`/board?job=${id}`)
...and relied on a SEPARATE effect inside BoardView.jsx to notice the `?job=`
query param and open JobDetail. That hand-off is what was silently failing —
landing on the plain board, no card. The resolve step (fixed in 9.9.3) was
never the remaining problem; the relay to the board was.

## The fix
ShortLink now renders JobDetail DIRECTLY, itself, the moment it resolves the
job id. No query param, no second component's effect to depend on, no relay
to fail. One component, one job, straight through.

Also answers the open design question: /j/ links open the FULL JOB RECORD
(JobDetail — status, notes, MoveStatus, everything), not the personal
"Work To Do Today" view. That view is tech-filtered and time-boxed; a job in
needs_estimate or ready_to_schedule wouldn't even show there. The link points
at a record, so it opens the record.

## Files (3, no migration)
- src/views/ShortLink.jsx  (rewritten — renders JobDetail directly)
- src/App.jsx              (the /j/:code route now passes accessToken,
  userEmail, userRole into ShortLink so it can hand them to JobDetail;
  APP_VERSION -> 9.9.5)
- public/version.json -> 9.9.5

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.5-shortlink-direct.zip -d .
git add -A
git commit -m "9.9.5 /j links open JobDetail directly, skip the board relay"
git push

Test: tap a real /j/<code> link — the actual job card (with notes, status,
Move control) should open immediately. Closing it lands on the plain board.
