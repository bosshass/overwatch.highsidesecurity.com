#!/usr/bin/env python3
"""
apply_today_card.py — a calendar tile at the top of home, and a tidier list.

WHY
  There was no way to reach Work To Do Today from the home screen at all —
  the one place a tech goes every morning. This puts a calendar page at the
  top: today's date, how many jobs are on it, and a tap straight into the
  Today module.

  It also tightens "Scheduled, then nothing happened": a red left rail that
  darkens with age, the days-late number as a chip rather than buried in grey
  body text, and rows that read at a glance instead of as a wall.

RUN FROM THE REPO ROOT:
    python3 apply_today_card.py
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

patch('src/views/OpsHome.jsx', [

 # count what is actually on today, so the tile means something
 ('count today\'s jobs',
  "      const count = (...st) => (jobs || []).filter(j => st.includes(j.status)).length;\n      setBoard({",
  """      const _t = new Date(); _t.setHours(0, 0, 0, 0);
      const _todayStr = `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, '0')}-${String(_t.getDate()).padStart(2, '0')}`;
      const count = (...st) => (jobs || []).filter(j => st.includes(j.status)).length;
      setBoard({
        today:     (jobs || []).filter(j => String(j.scheduled_date || '').slice(0, 10) === _todayStr).length,""",
  'today:     (jobs'),

 # the calendar page itself, above the board tiles
 ('Today calendar card',
  "      <div style={{ flex:1, overflowY:'auto', paddingBottom:100 }}>",
  """      <div style={{ flex:1, overflowY:'auto', paddingBottom:100 }}>

        {/* ══ 0. TODAY ══ */}
        {/* Home had no route into Work To Do Today — the screen a tech opens
            every morning and the only place a visit can actually be finished.
            Built to read as a calendar page rather than another stat tile, so
            it is obvious what it is without a label explaining it. */}
        {(() => {
          const now = new Date();
          const MON = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
          const DOW = now.toLocaleDateString('en-US', { weekday: 'long' });
          const n = board?.today ?? null;
          return (
            <button onClick={() => go('/work')}
              style={{ display:'flex', alignItems:'center', gap:16, width:'calc(100% - 32px)',
                       margin:'16px', textAlign:'left', background:C.panel,
                       border:`1px solid ${C.line}`, borderRadius:20, padding:'16px 18px',
                       cursor:'pointer', color:C.text, fontFamily:'inherit' }}>
              {/* the page */}
              <span style={{ display:'block', width:72, borderRadius:12, overflow:'hidden',
                             border:`1px solid ${C.line2}`, flexShrink:0,
                             boxShadow:'0 6px 18px rgba(0,0,0,0.35)' }}>
                <span style={{ display:'block', background:'#dc2626', color:'#fff',
                               fontSize:10, fontWeight:900, letterSpacing:'0.12em',
                               textAlign:'center', padding:'4px 0' }}>{MON}</span>
                <span style={{ display:'block', background:'#f8fafc', color:'#0f172a',
                               fontSize:34, fontWeight:900, lineHeight:1.15,
                               textAlign:'center', padding:'6px 0 8px' }}>{now.getDate()}</span>
              </span>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:'block', fontSize:19, fontWeight:900 }}>Today</span>
                <span style={{ display:'block', fontSize:13, color:C.muted, marginTop:3 }}>{DOW}</span>
                <span style={{ display:'block', fontSize:13, marginTop:8,
                               color: n ? C.cyan : C.muted, fontWeight:700 }}>
                  {n === null ? 'Open the day \\u2192'
                    : n === 0 ? 'Nothing booked \\u2014 open the day \\u2192'
                    : `${n} on the calendar \\u2192`}
                </span>
              </span>
            </button>
          );
        })()}

""",
  'const MON = now.toLocaleDateString'),

 # make the stranded rows scannable
 ('stranded rows get a rail and a chip',
  """              <button key={j.id} onClick={() => go(j.date ? `/work?d=${String(j.date).slice(0, 10)}` : '/work')}
                style={{ display:'flex', width:'100%', alignItems:'center', gap:10, textAlign:'left',
                         background:'transparent', border:'none', borderTop:`1px solid ${C.amber}33`,
                         padding:'10px 0', cursor:'pointer', color:C.text, fontFamily:'inherit' }}>""",
  """              <button key={j.id} onClick={() => go(j.date ? `/work?d=${String(j.date).slice(0, 10)}` : '/work')}
                style={{ display:'flex', width:'100%', alignItems:'center', gap:10, textAlign:'left',
                         background:'#1a1206', border:`1px solid ${C.line}`,
                         borderLeft:`3px solid ${(j.days ?? 0) >= 7 ? '#dc2626' : (j.days ?? 0) >= 3 ? '#ea580c' : '#b45309'}`,
                         borderRadius:10, marginBottom:6,
                         padding:'11px 13px', cursor:'pointer', color:C.text, fontFamily:'inherit' }}>""",
  "borderLeft:`3px solid ${(j.days"),
])

print('\n'.join(f'  {s:5} {w}' for s, w in report))
miss = [w for s, w in report if s == 'MISS']
print(f'\n{sum(1 for s,_ in report if s=="OK")} applied, '
      f'{sum(1 for s,_ in report if s=="SKIP")} already there, {len(miss)} missed')
if miss:
    print('\nMISSED — anchor not found, file untouched:')
    for w in miss: print('   ', w)
    print('\nThe "stranded rows" one misses unless apply_today_link.py ran first.')
    sys.exit(1)
print('\nNow run:  npm run verify')
