# 9.9.3 — re-fix the /j/ deep link (regressed by the earlier revert)

## What happened
The uuid-range fix for ShortLink.jsx was originally shipped bundled inside the
9.9.0 zip, alongside the risky needs-notes migration feature. When 9.9.0 got
reverted to kill the loop, git reverted the WHOLE commit — including the good
ShortLink fix, which had nothing to do with the crash. It silently regressed
back to the broken `.filter('id::text','like',...)` cast, which is why deep
links started throwing "operator does not exist: uuid ~~ unknown" again.

Lesson applied: this fix ships ALONE this time, isolated, so it can never be
swept up in an unrelated revert again.

## Fix
src/views/ShortLink.jsx — resolves the short-code prefix as a uuid RANGE
(gte/lte) instead of a text LIKE cast. uuid supports the range operators
natively and the primary key index serves it.

## Version sync (the other bug from tonight)
src/App.jsx APP_VERSION and public/version.json are BOTH bumped to 9.9.3
together, in this same commit. This is now the standing rule for every future
version bump — never move one without the other.

## Files (3, no migration)
- src/views/ShortLink.jsx
- src/App.jsx
- public/version.json

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.3-shortlink-refix.zip -d .
git add -A
git commit -m "9.9.3 re-fix /j deep link (regressed by earlier revert) + version sync"
git push

Verify /version.json = 9.9.3, then tap a real /j/<code> link — it should open
the job, not throw the uuid error. Also confirm the page just sits there,
no reload loop.
