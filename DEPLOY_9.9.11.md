# 9.9.11 — remove To Bill from board + forced fuzzy-match duplicate flag

## 1. To Bill removed from the board
Billing already has its own screen (Unbilled/Billing.jsx). Removed the
"To Bill" column, its lane-move target, and its stat chip from BoardView.
complete/to_bill/billed jobs still exist and are still managed in Billing —
they just don't duplicate a column on the board anymore.

## 2. Forced fuzzy-match duplicate flag
There was ALREADY a duplicate-check tool in JobDetail (the 🔗 Merge Duplicate
button) — but it only did exact-match or substring-containment, e.g.
"sainati".includes("santini") is false either direction. That's the actual
reason duplicates kept slipping through all session: the check existed, it
just structurally could not catch a phonetic near-miss or a spelling variant.

New: src/utils/fuzzyMatch.js — token-overlap + edit-distance similarity,
threshold calibrated against tonight's real cases (not guessed):
  Sainati/Santini 0.43, Jeanneret/Jeanerette 0.70, JAllen/Jerry Allen 0.55,
  Eckstein/"ECKSTEIN, NEIL" 0.62 — all correctly flag at threshold 0.4.
  Boyd Lake/Chris Hare 0.30, Anderson/Allen 0.38, Rupert/Goodell 0.14 —
  all correctly stay quiet.
Known false-positive: BG Automotive's different physical locations score
0.73-0.77 and WILL flag, even though "different cs_number = different
location, keep both" is an established rule. That's fine — this is an
advisory flag for a human glance, not an auto-merge.

Three things now force this flag automatically (no more remembering to click
"check for duplicates"):
  - JobDetail: runs the fuzzy check the moment any job loads. If matches
    exist, a loud orange banner sits right under the header — tap it to open
    the EXISTING merge modal, unchanged. Covers "still on the board" AND
    "scheduled in the future" (both are just open jobs-table rows).
  - Event Audit's orphan scan: each unlinked calendar event now also gets
    fuzzy-matched against every open job (fetched once, checked in memory —
    no extra API calls), and flagged inline if one looks like a likely
    duplicate. Covers "is in Event Audit."

## Files (6, no migration)
- src/utils/fuzzyMatch.js       (new — the matcher)
- src/components/JobDetail.jsx  (replaced weak matching, auto-run + banner)
- src/services/calendarSync.js  (orphan tagging)
- src/views/CustomerAudit.jsx   (surfaces the tag)
- src/views/BoardView.jsx       (To Bill removed)
- src/App.jsx + public/version.json -> 9.9.11, synced

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.11-dedup-and-board.zip -d .
git add -A
git commit -m "9.9.11 remove To Bill from board + forced fuzzy duplicate flag"
git push

Test: open Vinyard Church (one of the known 3-card duplicates) — the orange
banner should appear automatically, no button click needed.
