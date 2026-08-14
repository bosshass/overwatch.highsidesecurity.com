#!/usr/bin/env python3
"""
apply_release_notes.py — a BUILDS entry for tonight.

BUILDS[0] was last touched at 9.11.13 on 2026-07-27. The modal takes the
version number as a prop now (it used to read it from here and announced
"9.8.3" for about fifty releases), but the CHANGELOG still comes from this
array — so anyone opening it sees July.

Format per the file's own note: short scannable lines, highlights not
documentation.

RUN FROM THE REPO ROOT:
    python3 apply_release_notes.py
    npm run verify
"""
import sys, pathlib

p = pathlib.Path('src/components/BuildLog.jsx')
if not p.exists():
    print('  MISS  src/components/BuildLog.jsx not found'); sys.exit(1)

s = p.read_text()
if "version: '9.28.0'" in s:
    print('  SKIP  release notes already added'); sys.exit(0)

ANCHOR = "export const BUILDS = [\n  {"
if ANCHOR not in s:
    print('  MISS  could not find the BUILDS array'); sys.exit(1)

ENTRY = """export const BUILDS = [
  {
    version: '9.28.0',
    date: '2026-08-13',
    label: 'Billing tells the truth; nothing guesses a customer any more',
    changes: [
      'Billing reads the TIME ENTRY, not the job status \\u2014 164 already-invoiced visits had been showing as "To bill" forever, because the chip read what the tech said in the field and that never changes',
      'New buckets: Project hours (fixed-fee work, real cost, never separately invoiced), Sales / pre-sale, and Absorbed cost (warranty, goodwill, duplicate) \\u2014 cost with no revenue stays visible instead of vanishing',
      'Ready to bill went from 28.1h of noise to 6.6h you can actually invoice',
      'Clearing anything out of Billing now asks WHY \\u2014 test entry, warranty, goodwill, covered by contract, sales call. The reason is stored as a key, so profitability can classify it later',
      'Clearing committed work (scheduled, ready, return) asks the same question. A New note or a quick task still clears in one tap \\u2014 nobody promised anything',
      'NO DISPOSITION badge on board cards: the scheduled day ended at 6pm, fourteen hours passed, and nobody said what happened. Weekends roll, so Friday is not late until Monday 8am',
      'NEEDS NOTES bar in Work To Do Today \\u2014 tap it for everything still waiting on a disposition, tap a row to jump to that day',
      'Rescheduling MOVES the calendar event instead of quietly making a second one',
      'Clearing a job now takes its event off the tech calendar. Nothing had ever done that',
      'Fuzzy name matching deleted. It once billed an hour to BG Automotive because a title said "Loveland", and picked HUANG, DAVID out of twelve Davids from the word "David". An event\\u2019s customer is known or it is blank \\u2014 blank is honest',
      'Event Audit starts at 13 Aug instead of 1 June, with a button to sweep back. Everything before that was closed out in the database',
      'Home: a Today calendar card, board tiles that open the right column, Tasks and Clients out of the Admin list, a much bigger +',
      'The assistant bubble is gone',
      'Housekeeping: 47 test time entries, 29 test jobs and 15 test notes removed (all reversible), 193 pre-July entries closed out, Boys & Girls Club unlinked from BG Automotive',
    ],
  },
  {"""

s = s.replace(ANCHOR, ENTRY, 1)
p.write_text(s)
print('  OK    release notes: 9.28.0 added')

v = pathlib.Path('src/version.js')
if v.exists():
    import re
    t = v.read_text()
    t2 = re.sub(r"APP_VERSION = '[^']*'", "APP_VERSION = '9.28.0'", t, count=1)
    if t2 != t:
        v.write_text(t2); print('  OK    src/version.js -> 9.28.0')

print('\nNow run:  npm run verify')
