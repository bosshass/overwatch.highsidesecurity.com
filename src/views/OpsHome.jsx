// ============================================
// OpsHome — Command home screen
// ============================================
// REBUILT. The old version led with six tiles counting jobs by status —
// Needs Action 10, Ready 12, Returns 4 — which nobody acted on, because a
// count of a status is not a decision. It told you the shape of the queue and
// nothing about whether anyone was moving.
//
// What this answers instead, in order:
//   1. What is BROKEN — work that happened outside Overwatch and will never
//      bill. Loud, first, unmissable.
//   2. Who is stuck — a card per person with their To Do / Doing / Done, and
//      the oldest thing they haven't touched. Staleness, not volume.
//   3. What the board looks like — demoted to one rollup, because the board
//      already exists and doesn't need to be re-summarised six ways.
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import DidYouGo from '../components/DidYouGo.jsx';
import TaskStack from './TaskStack.jsx';
import { supabase, JOB_STATUS } from '../services/supabase.js';
import NewJobModal from '../components/NewJobModal.jsx';
import Spotlight from '../components/Spotlight.jsx';
import { ASSIGNEES, assigneeOf, CLOSED_STATUSES, emailsFor } from '../utils/ownership.js';
import { shortCode } from '../config/appBase.js';

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

// The board, grouped the way it reads on a phone. `lane` is the LANES key in
// utils/lanes.js that the tile opens; To Bill has no board column — complete
// and to_bill live on Billing — so it goes there instead.
const BOARD_TILES = [
  { key:'neu',       label:'New',               color:'#ef4444', lane:'triage'    },
  { key:'estimates', label:'Needs Estimate',    color:'#f5a524', lane:'estimates' },
  { key:'ready',     label:'Ready to Schedule', color:'#22d16f', lane:'ready'     },
  { key:'scheduled', label:'Scheduled',         color:'#a855f7', lane:'scheduled' },
  { key:'returns',   label:'Return Trips',      color:'#f5a524', lane:'ready'     },
  { key:'tobill',    label:'To Bill',           color:'#16c7df', lane:null        },
];

export default function OpsHome({
  userName, isOperator, isSuperAdmin, accessToken, userEmail,
  onNavigate, onSignOut, onSearch, onShowTour, onBackfill,
}) {
  const [people, setPeople] = useState(null);
  // HOME IS A GRID OF DOORS, NOT A STACK OF PANELS. The prompt and the task
  // card were rendered inline at full width above two small tiles, so the
  // screen had three different shapes on it and you scrolled past the nav to
  // reach the board. Four equal tiles; the two that need a workspace open one
  // ON TOP of home instead of pushing everything down.
  const [sheet, setSheet] = useState(null);   // 'visits' | 'tasks' | null
  const [tileCounts, setTileCounts] = useState({ visits: null, tasks: null });
  const [board, setBoard] = useState(null);
  // Jobs marked scheduled whose day came and went with nobody dispositioning them.
  const [stranded, setStranded] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewJob, setShowNewJob] = useState(false);

  const go = path => onNavigate(path);

  // Contextual help marker. Sits next to a section and opens the walkthrough at
  // that section's step, rather than making someone sit through a linear tour
  // to reach the part they're actually looking at.
  const Help = ({ topic, label }) => (
    <button onClick={(e) => { e.stopPropagation(); onShowTour?.(topic); }}
      aria-label={label || 'How this works'} title={label || 'How this works'}
      style={{ width:20, height:20, borderRadius:999, background:'transparent',
               border:`1px solid ${C.line2}`, color:C.muted, fontSize:11, fontWeight:800,
               cursor:'pointer', lineHeight:1, padding:0, flexShrink:0,
               fontFamily:'inherit' }}>?</button>
  );

  // ── Per-person rollup ──────────────────────────────────────────────────
  // Volume is not the signal. Everyone has a pile; what matters is whether the
  // BOTTOM of the pile is moving. So each card leads with counts but is judged
  // on its oldest untouched item — that is the thing quietly rotting, and it is
  // invisible on a board sorted by anything else.
  const loadPeople = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: jobs }, { data: notes }] = await Promise.all([
        supabase.from('jobs')
          .select('id, customer_name, status, assigned_to, tech_name, created_at, updated_at, scheduled_date')
          .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
          .limit(1000),
        supabase.from('notes')
          .select('id, body, author_email, assigned_to, lane, created_at, updated_at')
          .limit(1000),
      ]);

      const now = Date.now();
      const daysSince = (iso) => iso ? Math.floor((now - new Date(iso)) / 86400000) : null;

      const rows = ASSIGNEES.map(person => {
        const theirJobs  = (jobs || []).filter(j => assigneeOf(j) === person.name);
        // TASKS ARE ASSIGNED, NOT AUTHORED. This matched author_email, so the
        // column counted everything a person had ever typed — Shana read 11
        // tasks because she wrote 11 notes, none of them hers to do.
        const theirNotes = (notes || []).filter(n =>
          (n.assigned_to || '').toLowerCase() === person.email.toLowerCase());

        // JOBS AND TASKS WERE BEING ADDED TOGETHER. `theirJobs.length +
        // notes in lane 'todo'` put a job status count and a task lane count
        // into one number labelled To Do — 7 jobs and 1 task read as 8, and
        // no screen anywhere could reconcile it. They are separate counts of
        // separate things and they stay separate.
        const todo  = theirNotes.filter(n => n.lane === 'todo').length;
        const doing = theirNotes.filter(n => n.lane === 'doing').length;
        const done  = theirNotes.filter(n => n.lane === 'done').length;
        const watching = 0;   // lane retired

        // Oldest OPEN item by last movement. Done is excluded — a finished
        // thing sitting untouched is finished, not stalled.
        const open = [
          ...theirJobs.map(j => ({ label: j.customer_name || 'Unnamed', at: j.updated_at || j.created_at })),
          ...theirNotes.filter(n => n.lane !== 'done')
                       .map(n => ({ label: (n.body || '').slice(0, 40), at: n.updated_at || n.created_at })),
        ].filter(x => x.at).sort((a, b) => new Date(a.at) - new Date(b.at));

        const oldest = open[0] || null;
        return {
          ...person, todo, doing, done, watching,
          total: todo + doing + done,
          oldest: oldest ? { ...oldest, days: daysSince(oldest.at) } : null,
        };
      })
      // Somebody with nothing at all is noise on this screen.
      .filter(p => p.total > 0)
      // Most stalled first. The point of the screen.
      .sort((a, b) => (b.oldest?.days ?? -1) - (a.oldest?.days ?? -1));

      setPeople(rows);

      // ── Stranded work ──────────────────────────────────────────────────
      // A job marked `scheduled` whose date has passed, or that never got a
      // date at all. The red banner catches work that never entered Overwatch;
      // this is work that entered and then got stuck INSIDE it, which counted
      // as neither. Three jobs and several billable hours were sitting in that
      // blind spot.
      //
      // They're almost certainly showing on Work To Do Today with no note
      // against them — the tech saw the job and never dispositioned it, so the
      // hours never became billable.
      const todayISO = new Date(); todayISO.setHours(0, 0, 0, 0);
      setStranded((jobs || [])
        .filter(j => j.status === 'scheduled')
        .filter(j => !j.scheduled_date || new Date(j.scheduled_date) < todayISO)
        .map(j => ({
          id: j.id,
          name: j.customer_name || 'Unnamed',
          tech: assigneeOf(j),
          date: j.scheduled_date,
          days: j.scheduled_date
            ? Math.floor((todayISO - new Date(j.scheduled_date)) / 86400000)
            : null,
        }))
        .sort((a, b) => (b.days ?? 999) - (a.days ?? 999)));

      const count = (...st) => (jobs || []).filter(j => st.includes(j.status)).length;
      // `neu` and `oldest` feed the roll-up tile that replaced the old red
      // "Not in Overwatch" panel. Same query, two more derived numbers — no
      // second loader and no second state object.
      const NEW_STATUSES = ['new', 'needs_details', 'needs_parts', 'pending_materials', 'pending_decision', 'blocked'];
      const waiting = (jobs || []).filter(j =>
        NEW_STATUSES.includes(j.status) || ['ready_to_schedule', 'return_pending'].includes(j.status));
      setBoard({
        tobill:    count('complete', 'to_bill'),
        neu:       count(...NEW_STATUSES),
        oldest:    waiting.reduce((max, j) => {
                     const d = Math.floor((Date.now() - new Date(j.created_at).getTime()) / 86400000);
                     return d > max ? d : max;
                   }, 0),
        ready:     count('ready_to_schedule'),
        scheduled: count('scheduled'),
        estimates: count('needs_estimate', 'estimate_sent'),
        returns:   count('return_pending'),
      });
    } catch (e) { console.error('home rollup', e); }
    setLoading(false);
  }, []);

  // ── Board roll-up (was: the Google-scan gap tile) ──────────────────────
  // Work that HAPPENED but that Overwatch never captured: hand-made calendar
  // events that will never produce a time entry, and jobs with nobody to bill.
  // This is the only thing on this screen that represents money already lost,
  // so it goes first and it is the largest element on the page.
  const peopleRef = useRef(null);

  // Arriving from the board's "Who's stuck" button lands ON that section
  // instead of at the top of the page above two warning cards.
  useEffect(() => {
    if (loading || !people) return;
    const wants = new URLSearchParams(window.location.search).get('focus');
    if (wants === 'people' && peopleRef.current) {
      peopleRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, people]);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
  

  // Days-since colour. Under a week is normal, two weeks is a problem,
  // a month means nobody owns it.
  const staleColor = d => d == null ? C.muted : d >= 30 ? C.red : d >= 14 ? C.amber : d >= 7 ? C.soft : C.muted;

  const HOME_SPOTLIGHT_STEPS = [
    { target: 'home-search', title: 'Search everything',
      body: 'Customer name, job, or CMS number — searches across the whole system, not just what\'s on screen.' },
    { target: 'home-databad', title: 'Work that will never bill',
      body: 'Calendar events nobody turned into a job, and jobs with no client attached. Real work, invisible to billing until someone links it.' },
    { target: 'home-stranded', title: 'Scheduled, then nothing happened',
      body: 'The day came and went with no disposition. These are most likely sitting on Work To Do Today doing nothing.' },
    { target: 'home-people', title: "Who's stuck",
      body: 'Not volume — the OLDEST untouched thing per person. That\'s what\'s quietly rotting.' },
    { target: 'home-admin', title: 'Admin tools',
      body: 'Event Audit, Billing, Weekly Recap, and the tour you\'re on right now — all live here.' },
  ];
  const SPOTLIGHT_BUILD = '9.11.13';
  const spotlightKey = (email) => `ow_home_spotlight_${SPOTLIGHT_BUILD}_${(email || '').toLowerCase()}`;
  const [showSpotlight, setShowSpotlight] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(spotlightKey(userEmail))) setShowSpotlight(true); } catch {}
  }, [userEmail]);
  const closeSpotlight = () => {
    setShowSpotlight(false);
    try { localStorage.setItem(spotlightKey(userEmail), new Date().toISOString()); } catch {}
  };

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
            <button onClick={() => setShowSpotlight(true)} title="Show me around"
              style={{ width:38, height:38, borderRadius:13, background:'#00c8e822', border:'1px solid #00c8e8', color:'#00c8e8', fontWeight:900, fontSize:15, cursor:'pointer' }}>▶</button>
            <button onClick={() => { loadPeople(); }}
              style={{ width:38, height:38, borderRadius:13, background:'#15243a', border:`1px solid #30445f`, color:C.text, fontWeight:900, fontSize:16, cursor:'pointer' }}>↻</button>
            {isOperator && (
              <button onClick={onSignOut}
                style={{ width:38, height:38, borderRadius:13, background:'#15243a', border:`1px solid #30445f`, color:C.muted, fontWeight:900, fontSize:13, cursor:'pointer' }}>⏻</button>
            )}
          </div>
        </div>
        <input data-tour="home-search" onClick={onSearch} readOnly placeholder="Search customers, jobs, CMS…"
          style={{ width:'100%', background:'#111f34', border:`1px solid #293d58`, color:'#dbe7f8', borderRadius:15, padding:'11px 13px', fontSize:14, outline:'none', cursor:'pointer', boxSizing:'border-box' }} />
      </div>

      <div style={{ flex:1, overflowY:'auto', paddingBottom:100 }}>

        {/* SHEET — sits ON TOP of home rather than growing inside it. The
            prompt and the task stack both need room to work; giving it to them
            inline is what pushed the board below the fold. */}
        {sheet && (
          <div onClick={() => setSheet(null)}
            style={{ position:'fixed', inset:0, background:'rgba(3,8,16,0.82)', zIndex:800,
                     display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width:'100%', maxWidth:620, maxHeight:'88vh', overflowY:'auto',
                       background:C.bg, borderTopLeftRadius:20, borderTopRightRadius:20,
                       border:`1px solid ${C.line}`, padding:'14px 16px 26px' }}>
              <div style={{ display:'flex', alignItems:'center', marginBottom:12 }}>
                <span style={{ fontSize:17, fontWeight:900 }}>
                  {sheet === 'visits' ? 'Close out visits' : 'Your tasks'}
                </span>
                <button onClick={() => setSheet(null)}
                  style={{ marginLeft:'auto', background:'transparent', border:`1px solid ${C.line2}`,
                           borderRadius:9, color:C.muted, fontSize:13, fontWeight:800,
                           padding:'7px 13px', cursor:'pointer', fontFamily:'inherit' }}>
                  Close
                </button>
              </div>

              {sheet === 'visits' && <DidYouGo userEmail={userEmail} userName={userName} />}

              {sheet === 'tasks' && (
                <TaskStack userEmail={userEmail} userName={userName} accessToken={accessToken}
                  onNavigate={(to) => { setSheet(null); onNavigate?.(to); }} embedded />
              )}
            </div>
          </div>
        )}

        {showSpotlight && (
          <Spotlight steps={HOME_SPOTLIGHT_STEPS} onDone={closeSpotlight} onSkip={closeSpotlight} />
        )}

        {/* ══ 0. FOUR DOORS ══ */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11, margin:'16px 16px 0' }}>
          {[
            { key:'visits', icon:'📍', label:'Close out visits',
              sub: tileCounts.visits == null ? 'Checking…'
                 : tileCounts.visits ? `${tileCounts.visits} with no hours` : 'All caught up',
              hot: !!tileCounts.visits, sheet:'visits' },
            { key:'tasks', icon:'📋', label:'Your tasks',
              sub: tileCounts.tasks == null ? 'Checking…'
                 : tileCounts.tasks ? `${tileCounts.tasks} open` : 'Nothing open',
              sheet:'tasks' },
            { path:'/calendar',  icon:'📅', label:'Calendar', sub:"Who's booked, and how full" },
            { path:'/customers', icon:'🏠', label:'Clients',  sub:'History and open work' },
          ].map(t => (
            <button key={t.key || t.path}
              onClick={() => t.sheet ? setSheet(t.sheet) : go(t.path)}
              style={{ textAlign:'left', background:C.panel,
                       border:`1px solid ${t.hot ? C.amber : C.line}`,
                       borderLeft: t.hot ? `4px solid ${C.amber}` : `1px solid ${C.line}`,
                       borderRadius:16, padding:'15px 15px', cursor:'pointer', color:C.text,
                       fontFamily:'inherit', minHeight:104 }}>
              <div style={{ fontSize:23, marginBottom:7 }}>{t.icon}</div>
              <div style={{ fontSize:15, fontWeight:900 }}>{t.label}</div>
              <div style={{ fontSize:11, color: t.hot ? C.amber : C.muted, marginTop:3,
                            lineHeight:1.35, fontWeight: t.hot ? 800 : 400 }}>{t.sub}</div>
            </button>
          ))}
        </div>

        {/* ══ 1. BOARD ROLL-UP ══ */}
        {/* Was a red "Not in Overwatch — will not bill" panel driven by a live
            Google scan. It counted upcoming schedule as lost revenue and could
            not be right. What matters on open is the shape of the board. */}
        {board && (
          <div style={{ margin:'16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:11 }}>
              <span style={{ fontSize:12, fontWeight:900, letterSpacing:'0.1em',
                             textTransform:'uppercase', color:C.muted }}>The board</span>
              {board.oldest > 0 && (
                <span style={{ fontSize:12, fontWeight:800,
                               color: board.oldest > 14 ? '#ef4444' : board.oldest > 7 ? C.amber : C.muted }}>
                  oldest {board.oldest}d
                </span>
              )}
            </div>
            {/* Each tile opens the board with ITS column already expanded, via
                ?lane= — see BoardView's expandedCol. Tapping "Scheduled · 31"
                used to land on the top of the board with Triage open and those
                31 cards somewhere below the fold. */}
            <div style={{ display:'grid', gap:9,
                          gridTemplateColumns:'repeat(auto-fill, minmax(132px, 1fr))' }}>
              {BOARD_TILES.map(t => {
                const n = board[t.key] || 0;
                return (
                  <button key={t.key}
                    onClick={() => go(t.lane ? `/board?lane=${t.lane}` : '/unbilled')}
                    style={{ textAlign:'left', background:C.panel, border:`1px solid ${C.line}`,
                             borderRadius:14, padding:'13px 14px', cursor:'pointer',
                             color:'#fff', fontFamily:'inherit' }}>
                    <div style={{ fontSize:12, fontWeight:800, color:t.color, marginBottom:8 }}>
                      {t.label}
                    </div>
                    <div style={{ fontSize:34, fontWeight:900, lineHeight:0.95,
                                  color: n ? '#fff' : '#33455f' }}>{n}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}


        {/* STRANDED LIST REMOVED. It sat directly BELOW DidYouGo asking the
            same question — "the day came and went and nobody dispositioned
            these" — except DidYouGo asks the person who was actually there,
            one visit at a time, and writes the time entry when they answer.
            This was a read-only list of five things nobody could act on from
            where it sat, shown to everybody including people who were not on
            any of them. Two prompts for one problem, and the one that could
            not fix anything was louder. */}

        {/* PEOPLE ROLLUP REMOVED. It was a card per person with To Do /
            Doing / Done counts and the oldest untouched thing — a shape-of-the-
            pile readout that you could not act on from where it sat. Your own
            work now renders as real task cards above, and somebody else's list
            is a question you ask on purpose: Tasks has a person filter for
            operators. Two screens were answering "who owes what" and neither
            let you do anything about it. */}

        {/* ══ 4. ADMIN TOOLS ══ */}
        {/* The screens you go to on purpose, not the ones that should be
            shouting at you. Kept off the main flow deliberately — Event Audit
            and Billing are where you go to FIX things, and the warning banner
            above already tells you when that's needed. */}
        {isOperator && (
          <div data-tour="home-admin" style={{ padding:'22px 16px 0' }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted }}>
                Admin tools
              </span>
              <Help topic="warning" label="What to do with these" />
            </div>
            <div style={{ background:C.panel, border:`1px solid ${C.line}`, borderRadius:18, overflow:'hidden' }}>
              {[
                // Event Audit is a repair tool for whoever maintains the data,
                // not something the office should be reading. Super admin only.
                ...(isSuperAdmin ? [{ path:'/audit?scan=1', icon:'🔍', label:'Event Audit',
                  sub:'Calendar events with no job behind them' }] : []),
                // Clients moved to a primary button at the top of this screen
                // and into the footer. Listing it here as well was the same
                // duplication the board rollup had.
                { path:'/unbilled', icon:'💵', label:'Billing',
                  sub:'Every unbilled hour and material, by customer' },
                { path:'/recap', icon:'📊', label:'Weekly Recap',
                  sub:'Completed jobs, locations visited, who scheduled what' },
                { action:'tour', icon:'🎓', label:'How this works',
                  sub:'Tasks, dispositions, Tent calendar, scheduling' },
                // Backfill from calendar REMOVED. The bulk import it ran is
                // done; leaving a button that rewrites many records at once on
                // the home screen is a loaded gun with no job left to do.
              ].map((t, i) => (
                <button key={t.path || t.action}
                  onClick={() => t.action === 'tour' ? onShowTour?.('intro')
                    : t.action === 'backfill' ? onBackfill?.()
                    : go(t.path)}
                  style={{ display:'flex', width:'100%', alignItems:'center', gap:13, textAlign:'left',
                           background:'transparent', border:'none',
                           borderTop: i ? `1px solid ${C.line}` : 'none',
                           padding:'15px 17px', cursor:'pointer', color:C.text, fontFamily:'inherit' }}>
                  <span style={{ fontSize:20 }}>{t.icon}</span>
                  <span style={{ flex:1, minWidth:0 }}>
                    <span style={{ display:'block', fontSize:15, fontWeight:700 }}>{t.label}</span>
                    <span style={{ display:'block', fontSize:12, color:C.muted, marginTop:2 }}>{t.sub}</span>
                  </span>
                  {t.badge > 0 && (
                    <span style={{ background:t.badgeColor, color:'#fff', borderRadius:20,
                                   padding:'2px 9px', fontSize:11, fontWeight:900 }}>{t.badge}</span>
                  )}
                  <span style={{ color:'#4a5f7a', fontSize:20 }}>›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isOperator && (
          <div style={{ padding:'26px 16px 0', textAlign:'center' }}>
            <button onClick={onSignOut} style={{ background:'none', border:'none', color:C.muted, fontSize:12, cursor:'pointer' }}>sign out</button>
          </div>
        )}
      </div>

      <button onClick={() => setShowNewJob(true)}
        style={{ position:'fixed', bottom:88, right:18, width:76, height:76, borderRadius:999, background:C.green, border:'none', color:'#04130a', fontSize:44, fontWeight:900, lineHeight:1, cursor:'pointer', boxShadow:'0 10px 30px rgba(34,209,111,0.5)', zIndex:60, display:'grid', placeItems:'center' }}>
        +
      </button>

      {showNewJob && (
        <NewJobModal accessToken={accessToken} userEmail={userEmail}
          onCreated={() => { setShowNewJob(false); loadPeople(); }}
          onClose={() => setShowNewJob(false)} />
      )}
    </div>
  );
}
