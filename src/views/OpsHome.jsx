// ============================================
// OpsHome — Command home screen
// ============================================
// Design: command cards + stat bar, Supabase-driven counts.
// Only shows what's actually built and working.
// Mobile-first, bottom nav, FAB for quick add.
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { supabase, JOB_STATUS } from '../services/supabase.js';
import NewJobModal from '../components/NewJobModal.jsx';
import { scanForOrphans } from '../services/calendarSync.js';

const C = {
  bg:     '#07111f',
  bg2:    '#0b1628',
  panel:  '#101d31',
  panel2: '#14243b',
  card:   '#111f34',
  line:   '#1d2f48',
  line2:  '#263a55',
  text:   '#edf4ff',
  muted:  '#8ea0b8',
  soft:   '#cbd6e6',
  green:  '#22d16f',
  red:    '#ff4f5e',
  blue:   '#4b8dff',
  cyan:   '#16c7df',
  amber:  '#ffb020',
  purple: '#9b6cff',
};

const fmtMoney = n => n >= 1000
  ? `$${(n/1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  : n ? `$${n}` : '';

const KPI_EMAILS = ['sara@jnbllc.com', 'admin@jnbservice.com'];

export default function OpsHome({
  userName, isOperator, accessToken, userEmail,
  onNavigate, onSignOut, onSearch,
}) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNewJob, setShowNewJob] = useState(false);
  // Work that exists in the real world but not in Overwatch. Loud on purpose.
  const [gap, setGap] = useState(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const ACTIVE = [
        'new','needs_details','needs_parts','pending_materials','blocked','pending_decision',
        'needs_estimate','estimate_sent','ready_to_schedule',
        'return_pending','scheduled','complete','to_bill','won',
      ];
      const { data } = await supabase
        .from('jobs').select('id, status, estimate_amount, calendar_event_id')
        .in('status', ACTIVE).limit(500);
      const j = data || [];

      // ── To Bill ────────────────────────────────────────────────────────
      // This tile used to count JOBS sitting in complete/to_bill. That number
      // was 18 while the Unbilled screen said 2 hours, because `jobs.status`
      // and `time_entries.billed` are independent switches and marking time
      // billed never moved the card. Thirteen of those 18 were already paid.
      //
      // A job count isn't money anyway. This now reads the SAME source the
      // Unbilled screen reads — unbilled, unarchived time entries resolved to
      // a job in complete/to_bill — so the tile and the screen it links to can
      // never disagree again. Entries link by job_id OR calendar_event_id;
      // most have a null job_id, so both paths are required.
      const billableJobIds  = new Set(j.filter(x => ['complete','to_bill'].includes(x.status)).map(x => x.id));
      const billableEventIds = new Set(
        j.filter(x => ['complete','to_bill'].includes(x.status) && x.calendar_event_id).map(x => x.calendar_event_id)
      );

      let toBillMinutes = 0, toBillEntries = 0;
      try {
        const { data: te } = await supabase
          .from('time_entries')
          .select('total_minutes, job_id, calendar_event_id')
          .not('billed', 'is', true)
          .or('archived.is.null,archived.eq.false')
          .limit(2000);
        (te || []).forEach(e => {
          const linked = (e.job_id && billableJobIds.has(e.job_id))
                      || (e.calendar_event_id && billableEventIds.has(e.calendar_event_id));
          if (linked) { toBillMinutes += (e.total_minutes || 0); toBillEntries += 1; }
        });
      } catch (err) { console.warn('to-bill hours lookup failed', err); }

      setStats({
        needsAction: j.filter(x => ['new','needs_details','needs_parts','needs_estimate'].includes(x.status)).length,
        ready:       j.filter(x => x.status === 'ready_to_schedule').length,
        readyValue:  j.filter(x => x.status === 'ready_to_schedule').reduce((s,x) => s+(parseFloat(x.estimate_amount)||0), 0),
        returns:     j.filter(x => x.status === 'return_pending').length,
        scheduled:   j.filter(x => x.status === 'scheduled').length,
        estimates:   j.filter(x => ['needs_estimate','estimate_sent'].includes(x.status)).length,
        toBillHours:   Math.round(toBillMinutes / 6) / 10,
        toBillEntries: toBillEntries,
        total:       j.length,
      });
    } catch(e) { console.error(e); }
    setLoading(false);
  }, []);

  // ── The gap ────────────────────────────────────────────────────────────
  // Work that HAPPENED but that Overwatch never captured. Two piles:
  //   • calendar events created by hand — no "Managed by JUC-E" marker, so
  //     Overwatch never made them, nobody dispositions them, and they will
  //     NEVER produce a time entry or an invoice
  //   • jobs with no customer attached — real work that cannot be billed
  //     because there is nobody to bill
  // This was buried on /audit behind a manual scan button, which meant it was
  // only ever seen by someone who already suspected a problem. It is money
  // walking out the door, so it belongs at the top of the first screen anyone
  // opens. The calendar half hits Google, so it resolves after paint rather
  // than holding up the page.
  const loadGap = useCallback(async () => {
    try {
      const { count: orphanJobs } = await supabase
        .from('jobs').select('id', { count: 'exact', head: true })
        .is('customer_id', null)
        .not('status', 'in', '(billed,archived,dead,lost)');

      let manual = 0;
      if (accessToken) {
        try {
          const res = await scanForOrphans(accessToken);
          manual = (res.orphans || []).length;
        } catch (e) { console.warn('orphan scan failed', e); }
      }
      setGap({ manual, orphanJobs: orphanJobs || 0 });
    } catch (e) { console.warn('gap load failed', e); }
  }, [accessToken]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadGap(); }, [loadGap]);

  const go = path => onNavigate(path);

  const COMMAND_CARDS = [
    {
      label: 'Board',
      sub: stats ? `${stats.needsAction} need action` : '—',
      icon: '▤',
      accent: C.red,
      path: '/board',
      show: true,
    },
    {
      label: 'Work To Do',
      sub: 'Today\'s jobs + field notes',
      icon: '✓',
      accent: C.green,
      path: '/work',
      show: true,
    },
    {
      label: 'Quick Notes',
      sub: 'Capture before it disappears',
      icon: '✎',
      accent: C.amber,
      path: '/todos',
      show: true,
      wip: true,
    },
    {
      label: 'Unbilled',
      sub: 'Every unbilled hour — and what is blocking it',
      icon: '$',
      accent: C.purple,
      path: '/unbilled',
      show: true,
    },
    {
      label: 'Triage Queue',
      sub: 'Returns, parts & scheduling',
      icon: '📋',
      accent: C.cyan,
      path: '/queue',
      show: true,
    },
    {
      label: 'Event Audit',
      sub: 'Tag events to a customer',
      icon: '🔎',
      accent: C.cyan,
      path: '/audit',
      show: isOperator,
    },
    {
      // Names who is and isn't actioning work. That's a conversation Sara has
      // deliberately, not a screen the team wanders into.
      label: 'KPIs',
      sub: 'Aging, returns, who is moving cards',
      icon: '📊',
      accent: C.amber,
      path: '/kpi',
      show: KPI_EMAILS.includes((userEmail || '').toLowerCase()),
    },
  ];

  const STAT_PILLS = stats ? [
    { label: 'Needs Action', val: stats.needsAction, accent: C.red },
    { label: 'Ready',        val: stats.ready,       accent: C.green,  sub: fmtMoney(stats.readyValue) },
    { label: 'Returns',      val: stats.returns,     accent: C.cyan },
    { label: 'Scheduled',    val: stats.scheduled,   accent: C.blue },
    { label: 'Estimates',    val: stats.estimates,   accent: C.amber },
    // To Bill now COUNTS time entries, so it must LAND on the screen that
    // manages them. /unbilled reads time_entries (correct); the older /billing
    // screen reads job_assignments, which is why the two numbers never agreed.
    // Techs can't open /unbilled (OperatorOnly bounces them), so they keep the
    // board — better than a tap that silently throws them back to Home.
    { label: 'To Bill',      val: `${stats.toBillHours}h`, accent: C.purple,
      sub: stats.toBillEntries === 1 ? '1 entry' : `${stats.toBillEntries} entries`,
      path: isOperator ? '/unbilled' : '/board' },
  ] : [];

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });

  return (
    <div style={{ minHeight:'100vh', background: `radial-gradient(circle at top left, #10213c 0%, ${C.bg} 32%, #050912 100%)`, color: C.text, fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif', display:'flex', flexDirection:'column' }}>

      {/* Sticky header */}
      <div style={{ position:'sticky', top:0, zIndex:10, background:'rgba(7,17,31,0.96)', backdropFilter:'blur(14px)', borderBottom:`1px solid ${C.line}`, padding:'14px 16px 12px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:12, display:'grid', placeItems:'center', background:'#13233b', border:`1px solid #30445f`, color:'#9fd5ff', fontWeight:900, fontSize:13 }}>OW</div>
            <div>
              <div style={{ fontSize:19, fontWeight:700, lineHeight:1 }}>Overwatch</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{today}{userName ? ` · ${userName}` : ''}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={loadStats}
              style={{ width:38, height:38, borderRadius:13, background:'#15243a', border:`1px solid #30445f`, color:C.text, fontWeight:900, fontSize:16, cursor:'pointer' }}>
              ↻
            </button>
            {isOperator && (
              <button onClick={onSignOut}
                style={{ width:38, height:38, borderRadius:13, background:'#15243a', border:`1px solid #30445f`, color:C.muted, fontWeight:900, fontSize:13, cursor:'pointer' }}>
                ⏻
              </button>
            )}
          </div>
        </div>
        <input onClick={onSearch} readOnly placeholder="Search customers, jobs, CMS…"
          style={{ width:'100%', background:'#111f34', border:`1px solid #293d58`, color:'#dbe7f8', borderRadius:15, padding:'11px 13px', fontSize:14, outline:'none', cursor:'pointer', boxSizing:'border-box' }} />
      </div>

      {/* Scrollable body */}
      <div style={{ flex:1, overflowY:'auto', paddingBottom:100 }}>

        {/* ── THE GAP — work that never made it into Overwatch ── */}
        {gap && (gap.manual > 0 || gap.orphanJobs > 0) && (
          <button onClick={() => go('/audit')}
            style={{ margin:'14px 16px 0', width:'calc(100% - 32px)', textAlign:'left',
                     background:'linear-gradient(180deg,#3b0d0d,#2a0a0a)', border:'1px solid #ef4444',
                     borderRadius:18, padding:'16px 18px', cursor:'pointer', color:'#fff',
                     display:'block', fontFamily:'inherit' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:8 }}>
              <span style={{ fontSize:18 }}>🚨</span>
              <span style={{ fontSize:12, fontWeight:900, letterSpacing:'0.09em',
                             textTransform:'uppercase', color:'#fca5a5' }}>
                Not in Overwatch — will not bill
              </span>
            </div>
            <div style={{ display:'flex', gap:22, flexWrap:'wrap', alignItems:'flex-end' }}>
              {gap.manual > 0 && (
                <div>
                  <div style={{ fontSize:34, fontWeight:900, lineHeight:1, color:'#ef4444' }}>{gap.manual}</div>
                  <div style={{ fontSize:12, color:'#fca5a5', marginTop:3 }}>
                    calendar event{gap.manual === 1 ? '' : 's'} made by hand
                  </div>
                </div>
              )}
              {gap.orphanJobs > 0 && (
                <div>
                  <div style={{ fontSize:34, fontWeight:900, lineHeight:1, color:'#f59e0b' }}>{gap.orphanJobs}</div>
                  <div style={{ fontSize:12, color:'#fcd34d', marginTop:3 }}>
                    job{gap.orphanJobs === 1 ? '' : 's'} with no client
                  </div>
                </div>
              )}
            </div>
            <div style={{ fontSize:12, color:'#fca5a5', marginTop:11, lineHeight:1.4 }}>
              This work happened. Nobody dispositioned it, so it will never produce a
              time entry or an invoice. Tap to fix →
            </div>
          </button>
        )}

        {/* Hero stat block */}
        {stats && (
          <div style={{ margin:'14px 16px', padding:'18px', borderRadius:22, background:`linear-gradient(180deg,${C.panel2},${C.panel})`, border:`1px solid #304761` }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:5 }}>open jobs</div>
            <div style={{ fontSize:32, fontWeight:900, letterSpacing:'-0.03em', lineHeight:1 }}>
              {loading ? '—' : stats.total}
            </div>
            <div style={{ marginTop:8, fontSize:13, color:'#b1bfd0', lineHeight:1.35 }}>
              {stats.needsAction > 0 ? `${stats.needsAction} need attention` : 'Board is clear'}{stats.toBillHours > 0 ? ` · ${stats.toBillHours}h to bill` : ''}
            </div>
          </div>
        )}

        {/* Needs action carryover — only if >0 */}
        {stats?.needsAction > 0 && (
          <button onClick={() => go('/board')}
            style={{ display:'block', width:'calc(100% - 32px)', margin:'0 16px 14px', padding:'14px 15px', borderRadius:18, background:'linear-gradient(180deg,#301923,#23121a)', border:`1px solid #6a2a39`, cursor:'pointer', textAlign:'left', color:C.text }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <strong style={{ fontSize:14 }}>Needs action</strong>
              <span style={{ background:C.red, color:'#fff', borderRadius:999, padding:'4px 8px', fontSize:11, fontWeight:900 }}>{stats.needsAction}</span>
            </div>
            <p style={{ margin:0, color:'#e0b8c0', fontSize:12, lineHeight:1.4 }}>
              New jobs, missing info, and blocked items waiting on a decision.
            </p>
          </button>
        )}

        {/* Stat pills row */}
        {stats && STAT_PILLS.length > 0 && (
          <div style={{ padding:'0 16px 16px', display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
            {STAT_PILLS.map(s => (
              <button key={s.label} onClick={() => go(s.path || '/board')}
                style={{ background:C.card, border:`1px solid ${C.line2}`, borderRadius:15, padding:'12px 10px', textAlign:'left', cursor:'pointer', color:C.text }}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.label}</div>
                <div style={{ fontSize:20, fontWeight:900, color:s.accent }}>{s.val}</div>
                {s.sub && <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{s.sub}</div>}
              </button>
            ))}
          </div>
        )}

        {/* Command cards */}
        <div style={{ padding:'0 16px', display:'flex', flexDirection:'column', gap:10 }}>
          {COMMAND_CARDS.filter(c => c.show).map(card => (
            <button key={card.path} onClick={() => go(card.path)}
              style={{ position:'relative', display:'grid', gridTemplateColumns:'44px 1fr auto', gap:14, alignItems:'center', background:`linear-gradient(180deg,${C.panel2},${C.panel})`, border:`1px solid ${C.line2}`, borderRadius:18, padding:'18px 18px 18px 20px', cursor:'pointer', textAlign:'left', color:C.text, overflow:'hidden' }}>
              {/* Left accent bar */}
              <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:card.accent }} />
              {/* Icon */}
              <div style={{ width:44, height:44, borderRadius:14, background:'#0b1526', border:`1px solid #314563`, display:'grid', placeItems:'center', fontSize:20, color:card.accent }}>
                {card.icon}
              </div>
              {/* Text */}
              <div>
                <div style={{ fontSize:17, fontWeight:700, marginBottom:4 }}>{card.label}</div>
                <div style={{ fontSize:12, color:C.muted }}>{card.sub}</div>
              </div>
              {/* Chevron */}
              <div style={{ color:'#4a5f7a', fontSize:22 }}>›</div>
              {/* Under-construction corner badge (purely visual; tap still works) */}
              {card.wip && (
                <span style={{
                  position:'absolute', top:8, right:8, zIndex:3,
                  display:'inline-flex', alignItems:'center', gap:4,
                  background:'#1a1200', border:'1px solid #f59e0b',
                  color:'#f59e0b', fontSize:9, fontWeight:800,
                  borderRadius:6, padding:'2px 7px', letterSpacing:0.3,
                }}>🚧 Under Construction</span>
              )}
            </button>
          ))}
        </div>

        {/* Sign out — tucked at bottom for ops users */}
        {isOperator && (
          <div style={{ padding:'24px 16px 0', textAlign:'center' }}>
            <button onClick={onSignOut} style={{ background:'none', border:'none', color:C.muted, fontSize:12, cursor:'pointer' }}>sign out</button>
          </div>
        )}
      </div>

      {/* FAB */}
      <button onClick={() => setShowNewJob(true)}
        style={{ position:'fixed', bottom:80, right:20, width:56, height:56, borderRadius:999, background:C.green, border:'none', color:'#04130a', fontSize:28, fontWeight:900, cursor:'pointer', boxShadow:'0 8px 24px rgba(34,209,111,0.35)', zIndex:20, display:'grid', placeItems:'center' }}>
        +
      </button>

      {/* Bottom nav now lives globally in App.jsx, visible on every screen */}

      {/* New job modal */}
      {showNewJob && (
        <NewJobModal accessToken={accessToken} userEmail={userEmail}
          onCreated={() => { setShowNewJob(false); loadStats(); }}
          onClose={() => setShowNewJob(false)} />
      )}
    </div>
  );
}
