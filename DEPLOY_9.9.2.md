# 9.9.2 — fixes the ROOT CAUSE of tonight's infinite loop

## What actually broke everything (found it)
src/App.jsx has the app version in TWO places:
  1. const APP_VERSION = '9.8.3'   (hardcoded, baked into the JS at build time)
  2. public/version.json           (a separate file)

Every 45s the app fetches version.json and compares it to APP_VERSION. If they
differ, it force-reloads. Every zip before this one bumped version.json but
never touched the hardcoded line — so the moment 9.9.0/9.9.1 went live, the
poller saw a permanent mismatch baked into its own bundle and reloaded forever,
on every device, cache or not, incognito or not. Not a caching bug — a real bug.

## The fix
Both values are now "9.9.2" in the SAME commit. They agree. The loop cannot
happen from this cause again, as long as future bumps update both together
(I'll do that from now on).

## Files (2 — this is ONLY the version-sync fix)
- src/App.jsx        (line 41: APP_VERSION -> '9.9.2')
- public/version.json -> 9.9.2

This does NOT re-touch MoveStatus/JobDetail/Billing/NotesPanel — those are
already committed on origin/main (commit 479ca3d) from earlier tonight. This
zip just fixes the version-string mismatch that was causing the loop.

## Deploy
cd into repo (should already be on main, up to date with origin)
unzip -o ~/Downloads/overwatch-9.9.2-version-fix.zip -d .
git add -A
git commit -m "9.9.2 fix version mismatch — sync APP_VERSION with version.json"
git push

No migration. No new feature. Verify /version.json = 9.9.2 and — most important —
confirm the page loads and STAYS, no reload loop, in a normal browser tab.
