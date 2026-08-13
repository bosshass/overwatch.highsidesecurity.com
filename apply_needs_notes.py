#!/usr/bin/env python3
"""
apply_needs_notes.py — a red NEEDS NOTES bar in Work To Do Today.

WHY
  A job scheduled last Thursday that nobody wrote up is not in today's Today.
  This view reads Google Calendar one day at a time, so the only way to find it
  was to know it existed and click < back through the days.

  This adds the one thing that view never had: a query against `jobs`. A red
  bar at the top counts everything still sitting in `scheduled` past its
  disposition deadline. Tapping it lists them, and tapping one jumps the day
  nav to that date — where the event and the finish sheet already are.

THE DEADLINE
  The scheduled day ends at 6pm. Fourteen hours later, 8am the next morning, a
  disposition is overdue. Weekends roll: a Friday visit is not late until
  Monday 8am. Computed locally in this file rather than imported so it cannot
  break if utils/staleness.js moves.

  Keyed on STATUS, not on notes. If the tech had dispositioned it on the finish
  sheet the status would have moved off `scheduled`. Notes can be written
  against an OLD visit; status cannot lie about this one.

RUN FROM THE REPO ROOT:
    python3 apply_needs_notes.py
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

patch('src/views/TechWorkToday.jsx', [

 ('import supabase',
  "import JobFinishSheet from '../components/JobFinishSheet.jsx';",
  "import JobFinishSheet from '../components/JobFinishSheet.jsx';\nimport { supabase } from '../services/supabase.js';",
  "from '../services/supabase.js'"),

 ('deadline helper',
  "const GCAL = 'https://www.googleapis.com/calendar/v3';",
  """const GCAL = 'https://www.googleapis.com/calendar/v3';

// ── DISPOSITION DEADLINE ────────────────────────────────────────────────────
// The scheduled day ends at 6pm; 14 hours later (8am next morning) a
// disposition is overdue. Weekends roll to Monday 8am, so nobody is chased at
// the weekend for Friday's paperwork.
// Dates are parsed by parts: new Date('2026-08-07') is UTC midnight, which is
// the previous evening in Denver and would make everything look a day late.
function dispoDueAt(scheduledDate) {
  if (!scheduledDate) return null;
  const [y, m, d] = String(scheduledDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d, 18, 0, 0, 0);
  due.setHours(due.getHours() + 14);
  while (due.getDay() === 0 || due.getDay() === 6) {
    due.setDate(due.getDate() + 1);
    due.setHours(8, 0, 0, 0);
  }
  return due;
}
const daysLate = (scheduledDate) => {
  const due = dispoDueAt(scheduledDate);
  return due ? Math.floor((Date.now() - due.getTime()) / 86400000) : 0;
};""",
  'function dispoDueAt'),

 ('needs-notes state + loader',
  "  const [offset, setOffset]     = useState(0);",
  """  const [offset, setOffset]     = useState(0);
  // Everything still sitting in `scheduled` past its deadline. This is the
  // first time this view has read the database — it has always been a pure
  // calendar reader, which is exactly why work from other days was invisible.
  const [needNotes, setNeedNotes] = useState([]);
  const [showNeedNotes, setShowNeedNotes] = useState(false);""",
  'setNeedNotes'),

 ('load the list',
  "  const load = useCallback(async () => {",
  """  const loadNeedNotes = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('jobs')
        .select('id, customer_name, scheduled_date, tech_name, assigned_to')
        .eq('status', 'scheduled')
        .not('scheduled_date', 'is', null)
        .limit(500);
      const late = (data || [])
        .filter(j => { const due = dispoDueAt(j.scheduled_date); return due && Date.now() > due.getTime(); })
        .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
      setNeedNotes(late);
    } catch (e) { console.warn('needs-notes load failed', e); }
  }, []);

  useEffect(() => { loadNeedNotes(); }, [loadNeedNotes]);

  // Jump the day nav to a specific date, so the event and the finish sheet are
  // right there instead of somewhere behind the < button.
  const goToDate = (scheduledDate) => {
    const [y, m, d] = String(scheduledDate).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return;
    const want = new Date(y, m - 1, d); want.setHours(0, 0, 0, 0);
    const now  = new Date();            now.setHours(0, 0, 0, 0);
    setOffset(Math.round((want - now) / 86400000));
    setShowNeedNotes(false);
  };

  const load = useCallback(async () => {""",
  'loadNeedNotes'),

 ('the red bar + list',
  "        {/* Day nav */}",
  """        {/* ── NEEDS NOTES ── the loudest thing on the screen when it applies.
            No note means no disposition, which means no time entry, which
            means nothing to invoice and nobody downstream knows what happened
            on site. ── */}
        {needNotes.length > 0 && (
          <div style={{ borderTop: '1px solid #e5e7eb' }}>
            <button onClick={() => setShowNeedNotes(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                       background: '#dc2626', border: 'none', color: '#fff',
                       padding: '13px 16px', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 18 }}>&#9888;</span>
              <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 900,
                             letterSpacing: '0.06em' }}>
                {needNotes.length} NEED NOTES
              </span>
              <span style={{ fontSize: 16 }}>{showNeedNotes ? '\\u25B2' : '\\u25BC'}</span>
            </button>
            {showNeedNotes && (
              <div style={{ background: '#fff1f2', borderBottom: '1px solid #fecaca' }}>
                <div style={{ fontSize: 12, color: '#9f1239', padding: '10px 16px 6px', lineHeight: 1.5 }}>
                  The day came and went and nobody said what happened. Tap one to jump
                  to that day, then finish it — notes, hours, then a disposition.
                </div>
                {needNotes.map(j => {
                  const late = daysLate(j.scheduled_date);
                  return (
                    <button key={j.id} onClick={() => goToDate(j.scheduled_date)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                               textAlign: 'left', background: 'none', border: 'none',
                               borderTop: '1px solid #fecaca', padding: '11px 16px',
                               cursor: 'pointer', fontFamily: 'inherit' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 700,
                                       color: '#1B2A4A', overflow: 'hidden',
                                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {j.customer_name || 'Unnamed'}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: '#9f1239' }}>
                          {j.tech_name || j.assigned_to || 'Unassigned'} \\u00b7 {String(j.scheduled_date).slice(0, 10)}
                        </span>
                      </span>
                      <span style={{ background: late >= 7 ? '#dc2626' : late >= 3 ? '#ea580c' : '#b45309',
                                     color: '#fff', fontSize: 12, fontWeight: 800,
                                     padding: '3px 9px', borderRadius: 6, flexShrink: 0 }}>
                        {late > 0 ? late + 'd late' : 'due'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Day nav */}""",
  'NEED NOTES'),

 ('refresh the list after a disposition',
  "          <button onClick={load}\n",
  "          <button onClick={() => { load(); loadNeedNotes(); }}\n",
  "{ load(); loadNeedNotes(); }"),
])

print('\n'.join(f'  {s:5} {w}' for s, w in report))
miss = [w for s, w in report if s == 'MISS']
print(f'\n{sum(1 for s,_ in report if s=="OK")} applied, '
      f'{sum(1 for s,_ in report if s=="SKIP")} already there, {len(miss)} missed')
if miss:
    print('\nMISSED — anchor not found, file untouched:')
    for w in miss: print('   ', w)
    sys.exit(1)
print('\nNow run:  npm run verify')
