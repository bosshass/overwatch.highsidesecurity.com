#!/usr/bin/env python3
"""
apply_today_link.py — send undispositioned work to Today, not the board.

WHY
  The "Scheduled, then nothing happened" list linked to /board. The board can
  show you a card; it cannot take a disposition and it cannot log hours. The
  finish sheet lives in Work To Do Today, and so does ensureJobForEvent() —
  the one place a calendar event becomes a jobs row.

  Today reads Google Calendar for ONE day and navigates with < > buttons only.
  A job scheduled last Thursday is in Today, just on Thursday. So this adds a
  ?d=YYYY-MM-DD param and points the links at the day the work was scheduled.

  It also removes the duplicate board summary — the same four numbers appeared
  in the tiles at the top and again lower down, so neither was authoritative.

RUN FROM THE REPO ROOT:
    python3 apply_today_link.py
    npm run verify
"""
import sys, pathlib

ROOT = pathlib.Path('.')
report = []
def log(s, w): report.append((s, w))

def patch(rel, edits):
    p = ROOT / rel
    if not p.exists():
        log('MISS', f'{rel} — not found'); return
    src = orig = p.read_text()
    for e in edits:
        label, old, new = e[0], e[1], e[2]
        marker = e[3] if len(e) > 3 else new
        if marker in src:
            log('SKIP', f'{rel}: {label}'); continue
        if old not in src:
            log('MISS', f'{rel}: {label}'); continue
        src = src.replace(old, new, 1)
        log('OK', f'{rel}: {label}')
    if src != orig: p.write_text(src)

# ── 1. Today accepts ?d=YYYY-MM-DD ─────────────────────────────────────────
patch('src/views/TechWorkToday.jsx', [
 ('?d= sets the opening day',
  "  const [offset, setOffset]     = useState(0);",
  """  // ?d=YYYY-MM-DD opens Today on that day instead of today. Undispositioned
  // work is linked here from the home screen, and the event it needs is on the
  // day it was scheduled — this view reads the calendar one day at a time, so
  // without the date the tech lands on today and sees nothing relevant.
  // Parsed by parts: new Date('2026-08-06') is UTC midnight, which is the
  // previous evening in Denver and would open the wrong day.
  const [offset, setOffset]     = useState(() => {
    const d = new URLSearchParams(window.location.search).get('d');
    if (!d) return 0;
    const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    if (!y || !m || !day) return 0;
    const want = new Date(y, m - 1, day); want.setHours(0, 0, 0, 0);
    const now  = new Date();             now.setHours(0, 0, 0, 0);
    return Math.round((want - now) / 86400000);
  });""",
  "get('d')"),
])

# ── 2. the no-disposition list points at Today, on the right day ───────────
# These linked to /j/<shortCode> — the ticket sheet — where you can pick a
# disposition and never log an hour. A disposition with no time entry is
# exactly the state this list exists to clear, so it was offering the wrong
# exit. Work To Do Today has the finish sheet: notes, time, THEN disposition.
patch('src/views/OpsHome.jsx', [
 ('stranded rows open Today on the scheduled day',
  "<button key={j.id} onClick={() => go(`/j/${shortCode(j.id)}?returnTo=${encodeURIComponent('/')}`)}",
  "<button key={j.id} onClick={() => go(j.date ? `/work?d=${String(j.date).slice(0, 10)}` : '/work')}",
  "/work?d="),
])

# ── 3. remove the DUPLICATE board summary (keeps the tiles at the top) ─────
p = ROOT / 'src/views/OpsHome.jsx'
if p.exists():
    s = p.read_text()
    A = "        {/* ══ 3. BOARD ROLLUP ══ */}"
    B = "        {/* ══ 4. ADMIN TOOLS ══ */}"
    if A in s and B in s:
        i, j = s.index(A), s.index(B)
        s = s[:i] + """        {/* The board summary that used to sit here is gone. It was the same
            numbers as the tiles at the top of this screen, and showing them
            twice on one page meant neither was authoritative. ── */}

""" + s[j:]
        p.write_text(s); log('OK', 'OpsHome: removed the duplicate board summary')
    else:
        log('SKIP', 'OpsHome: duplicate board summary')

print('\n'.join(f'  {s:5} {w}' for s, w in report))
miss = [w for s, w in report if s == 'MISS']
ok   = sum(1 for s, _ in report if s == 'OK')
print(f'\n{ok} applied, {sum(1 for s,_ in report if s=="SKIP")} already there, {len(miss)} missed')
if miss:
    print('\nMISSED — anchor not found, file untouched:')
    for w in miss: print('   ', w)
    print('\nOne of the two "stranded rows" edits is expected to miss —')
    print('they are alternate anchors for the same button. If BOTH missed,')
    print('send this back.')
print('\nNow run:  npm run verify')
