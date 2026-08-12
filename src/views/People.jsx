// ============================================
// People — who owns what. One screen.
// ============================================
// WHAT THIS REPLACES AND WHY
//   OfficeHub had the interaction that actually worked: tabs across the top,
//   quick-select a person, schedule them. But it read ownership from
//   job_assignments (18 rows) via `_tech_name`, so it showed almost every job
//   as unassigned and every tech lane as empty. It was right about the shape
//   and wrong about the data, and nobody reported it — because nobody could
//   reach it. It was never linked from anywhere.
//
//   Meanwhile My Tasks (Workspace) had the correct ownership rule and a
//   separate design, which is why the team kept asking what the difference
//   was between My Tasks and the Board. There wasn't a good answer: My Tasks
//   is just People, filtered to you. So it's the same screen now.
//
// ONE VOCABULARY
//   Ownership   -> utils/ownership.js  (assigneeOf / emailsFor)
//   Lanes       -> utils/lanes.js      (the same five the board shows)
//   The ticket  -> components/TicketSheet.jsx
//   Scheduling  -> components/VisualSchedulerModal.jsx -> services/schedule.js
//   Nothing here defines its own version of any of those.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { sendGmail } from '../services/gmailSend.js';
import { supabase, jobsApi } from '../services/supabase.js';
import {
  ASSIGNEES, assigneeOf, canonicalEmail, emailsFor,
  NAME_BY_EMAIL, CLOSED_STATUSES,
} from '../utils/ownership.js';
import { LANES, laneOf, localDate } from '../utils/lanes.js';
import { stalenessOf, STALE_COLOR } from '../utils/staleness.js';
import { TECH_COLORS, getTechCalendarId } from '../config/calendars.js';
import TicketSheet from '../components/TicketSheet.jsx';
import VisualSchedulerModal from '../components/VisualSchedulerModal.jsx';
import NewJobModal from '../components/NewJobModal.jsx';

const C = {
  bg: '#0f1729', panel: '#16233a', raised: '#1b2b45', line: '#2a3b56',
  text: '#e9f1ff', muted: '#93a5bd', dim: '#64748b', cyan: '#00c8e8',
  amber: '#f59e0b', red: '#ef4444', green: '#22c55e',
};

// The task lanes are the person's own list — deliberately NOT the job lanes.
// A job's lane says where the WORK goes next; a task lane says what the PERSON
// is doing about it. Conflating them is what made My Tasks feel like a second,
// disagreeing board.
const TASK_LANES = [
  { key: 'todo',     label: 'To do',    color: C.cyan,  empty: 'Nothing queued. Add a note or pick up a job below.' },
  { key: 'doing',    label: 'Doing',    color: C.amber, empty: 'Nothing in progress.' },
  { key: 'watching', label: 'Watching', color: '#a855f7', empty: 'Not watching anything. Hand a job off and it lands here.' },
  { key: 'done',     label: 'Done',     color: C.dim,   empty: 'Nothing finished yet.' },
];

const fmtDay = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  : null;

export default function People({ userEmail, userName, accessToken, onBack }) {
  const navigate = useNavigate();
  const { who } = useParams();

  // Default to the signed-in person, resolved through the login aliases so
  // JR on info@ lands on JR and not on whoever is first in the roster.
  const myName = NAME_BY_EMAIL[canonicalEmail(userEmail)] || userName || null;
  const [person, setPerson] = useState(() => {
    if (who && who.toLowerCase() === 'all') return 'all';
    const hit = ASSIGNEES.find(a => a.name.toLowerCase() === (who || '').toLowerCase());
    return hit ? hit.name : (myName || 'all');
  });

  const [tab, setTab] = useState('work');
  const [jobs, setJobs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openJob, setOpenJob] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [toast, setToast] = useState('');
  const [newJob, setNewJob] = useState(false);

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      // Everything open, once. Filtering by person happens in memory so
      // switching people is instant and the counts on every chip stay honest.
      const [{ data: j, error: je }, { data: n }] = await Promise.all([
        supabase.from('jobs')
          .select('id, customer_name, issue, status, assigned_to, tech_name, created_at, updated_at, scheduled_date, tentative_date, customer_address, customer_phone, job_type, estimate_amount, customer_id, calendar_event_id')
          .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
          .order('created_at', { ascending: true })
          .limit(2000),
        supabase.from('notes').select('*')
          .eq('status', 'open')
          .order('created_at', { ascending: true })
          .limit(1000),
      ]);
      if (je) throw je;
      setJobs(j || []);
      setNotes(n || []);
    } catch (e) { setErr(e.message || String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep the URL honest so a person's view is linkable and the back button works.
  useEffect(() => {
    const slug = person === 'all' ? 'all' : person.toLowerCase();
    if ((who || '').toLowerCase() !== slug) navigate(`/people/${slug}`, { replace: true });
  }, [person, who, navigate]);

  const jobsFor = useCallback(
    (name) => name === 'all' ? jobs : jobs.filter(j => assigneeOf(j) === name),
    [jobs]);

  const notesFor = useCallback((name) => {
    // "all" used to return every note in the system, so a private note written
    // by one person showed up on everybody's tab. A note is yours until you
    // assign it; only an assigned one — a task — is anyone else's business.
    if (name === 'all') return notes.filter(n => n.assigned_to);
    const hit = ASSIGNEES.find(a => a.name === name);
    if (!hit) return [];
    // A task is a note somebody OWNS. This filtered on author_email, so the
    // tab showed everything a person had ever written — Shana had 11 tasks
    // because she typed 11 notes, not because any of them were hers to do.
    // Assignment is what makes a note a task; that is the only thing to match.
    const mine = new Set(emailsFor(hit.email));
    return notes.filter(n => mine.has((n.assigned_to || '').toLowerCase()));
  }, [notes]);

  // "Unassigned" was never a state. A job is scheduled or it isn't; a note is
  // a note or, once somebody owns it, a task. Nobody-owns-this was a fourth
  // bucket that existed only because assignment was being treated as a
  // lifecycle stage, and it let real work sit in a pile nobody read.
  // Unowned jobs now appear in the lanes with everything else.
  // The pill counted jobs. The tabs count work + tasks + schedule. So a
  // person's number never matched the sum of what was under it — Shana read
  // 11 while her three tabs added to something else. One definition now:
  // open work you own, plus tasks assigned to you.
  const countFor = useCallback((name) => {
    const js = name === 'all'
      ? jobs
      : jobs.filter(j => assigneeOf(j) === name).concat(jobs.filter(j => !assigneeOf(j)));
    const ns = name === 'all'
      ? notes.filter(n => n.assigned_to && n.lane !== 'done')
      : (() => {
          const hit = ASSIGNEES.find(a => a.name === name);
          if (!hit) return [];
          const mine = new Set(emailsFor(hit.email));
          return notes.filter(n => mine.has((n.assigned_to || '').toLowerCase()) && n.lane !== 'done');
        })();
    return js.length + ns.length;
  }, [jobs, notes]);

  const myJobs = useMemo(() => {
    const own = jobsFor(person);
    if (person === 'all') return own;
    return own.concat(jobs.filter(j => !assigneeOf(j)));
  }, [jobsFor, person, jobs]);
  const myNotes = useMemo(() => notesFor(person), [notesFor, person]);

  // A task had no exit. The card opened its job if it had one and did nothing
  // if it didn't, so nothing could ever be finished — which is why they piled
  // up. Two moves are all a note needs: pick it up, or be done with it.
  // Assigning is what turns a note into a task — it is the only difference
  // between the two. Nothing in the app wrote assigned_to, so a note could
  // never become one; it just sat where it was written forever.
  const assignNote = async (id, email) => {
    const { error } = await supabase.from('notes')
      .update({ assigned_to: email }).eq('id', id);
    if (error) { setErr(error.message); return; }
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, assigned_to: email } : n)));

    // A task is the ONLY thing that needs a mail. A job reaches its tech
    // through the calendar; a task has no other way of arriving. Unassigning
    // sends nothing — there is nobody to tell.
    if (email && accessToken) {
      const note = notes.find(n => n.id === id);
      const body = (note?.body || '').trim();
      const who  = NAME_BY_EMAIL[canonicalEmail(email)] || email.split('@')[0];
      sendGmail(accessToken, {
        to: email,
        subject: '[Overwatch] Task for you',
        body: `${who},\n\n${body.length > 400 ? body.slice(0, 398) + '\u2026' : body}\n\n`
            + `From ${NAME_BY_EMAIL[canonicalEmail(userEmail)] || userEmail}.\n`
            + `It's on your Tasks tab in Overwatch.`,
      }).catch(() => {}); // never block the UI on a notification
    }
  };

  const moveNote = async (id, lane) => {
    const patch = lane === 'done'
      ? { lane, status: 'closed', done_at: new Date().toISOString(), done_by: canonicalEmail(userEmail) }
      : { lane };
    const { error } = await supabase.from('notes').update(patch).eq('id', id);
    if (error) { setErr(error.message); return; }
    setNotes(prev => lane === 'done'
      ? prev.filter(n => n.id !== id)
      : prev.map(n => (n.id === id ? { ...n, ...patch } : n)));
  };

  // Work is what still needs a decision. Scheduled and Tentative are already
  // the Schedule tab in full, with dates and a Reschedule button — listing
  // them here too meant the same job appeared under two tabs and neither
  // count meant anything.
  const WORK_LANES = LANES.filter(l => !['scheduled', 'tentative'].includes(l.key));

  const byLane = useMemo(() => {
    const m = {};
    WORK_LANES.forEach(l => { m[l.key] = []; });
    myJobs.forEach(j => {
      const lane = laneOf(j);
      if (lane && m[lane.key]) m[lane.key].push(j);
    });
    return m;
  }, [myJobs]);

  // A schedule is what is COMING. Done-To Bill and Complete were listed here
  // because they still carry a date — so finished work sat in the calendar
  // alongside next week's bookings and the tab count meant nothing. Anything
  // already worked belongs in billing, not on a schedule.
  const upcoming = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const FINISHED = ['to_bill', 'complete', 'billed', 'dead', 'lost', 'archived'];
    return myJobs
      .filter(j => (j.scheduled_date || j.tentative_date) && !FINISHED.includes(j.status))
      .filter(j => localDate(j.scheduled_date || j.tentative_date) >= today)
      .sort((a, b) => localDate(a.scheduled_date || a.tentative_date)
                    - localDate(b.scheduled_date || b.tentative_date));
  }, [myJobs]);

  // Grouped by day so it reads as a calendar rather than a list of rows that
  // happen to have dates on them.
  const byDay = useMemo(() => {
    const m = new Map();
    upcoming.forEach(j => {
      const key = String(j.scheduled_date || j.tentative_date).slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(j);
    });
    return [...m.entries()];
  }, [upcoming]);

  // Claim / hand over in one tap. The old My Tasks had "I'll take it" and
  // People shipped without it, so the only route was open ticket -> assign.
  // Writes assigned_to, the one ownership column.
  const giveTo = async (job, name) => {
    const who = ASSIGNEES.find(a => a.name === name);
    if (!who) return;
    const { error } = await supabase.from('jobs')
      .update({ assigned_to: who.email, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    if (error) { say('Could not assign'); return; }
    await load();
    say(`${job.customer_name || 'Job'} → ${name}`);
  };

  const moveJob = async (job, target, note) => {
    await jobsApi.changeStatus(job.id, target, userEmail, note);
    setOpenJob(null);
    await load();
    say('Moved');
  };

  // ── chrome ────────────────────────────────────────────────────────────────
  const PersonChip = ({ name, count, color, active }) => (
    <button onClick={() => setPerson(name)}
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7,
        background: active ? `${color}22` : C.raised,
        border: `1px solid ${active ? color : C.line}`,
        borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
        color: active ? color : C.text, fontSize: 14,
        fontWeight: active ? 800 : 600, fontFamily: 'inherit',
      }}>
      {name === 'all' ? 'Everyone' : name}
      <span style={{
        background: active ? color : C.line, color: active ? '#08121f' : C.muted,
        borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 800,
      }}>{count}</span>
    </button>
  );

  const JobRow = ({ job }) => {
    const lane = laneOf(job);
    const stale = stalenessOf(job);
    const staleColor = STALE_COLOR[stale.level];
    const when = job.scheduled_date || job.tentative_date;
    return (
      <button onClick={() => setOpenJob(job)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', background: C.raised,
          border: `1px solid ${C.line}`, borderLeft: `3px solid ${staleColor || lane?.color || C.line}`,
          borderRadius: 10, padding: '11px 13px', marginBottom: 7, cursor: 'pointer',
          color: C.text, fontFamily: 'inherit',
        }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>
          {job.customer_name || 'Unnamed'}
        </div>
        {job.issue && (
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.4, marginBottom: 6,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {job.issue}
          </div>
        )}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          {lane && (
            <span style={{ fontSize: 11, fontWeight: 700, color: lane.color,
                           background: `${lane.color}1f`, padding: '2px 7px', borderRadius: 5 }}>
              {lane.icon} {lane.label}
            </span>
          )}
          {when && (
            <span style={{ fontSize: 11.5, color: C.muted }}>{fmtDay(when)}</span>
          )}
          {staleColor && (
            <span style={{ fontSize: 11, fontWeight: 700, color: staleColor }}>
              {stale.label}
            </span>
          )}
        </div>
      </button>
    );
  };

  const Empty = ({ children }) => (
    <div style={{ color: C.dim, fontSize: 13, padding: '14px 2px', lineHeight: 1.5 }}>{children}</div>
  );

  const Section = ({ title, color, count, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.04em',
                       textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 11, color: C.dim, fontWeight: 700 }}>{count}</span>
      </div>
      {children}
    </div>
  );

  const TABS = [
    { key: 'work',     label: 'Work',     badge: WORK_LANES.reduce((n, l) => n + (byLane[l.key]?.length || 0), 0) },
    { key: 'tasks',    label: 'Tasks',    badge: myNotes.filter(n => n.lane !== 'done').length },
    { key: 'schedule', label: 'Schedule', badge: upcoming.length },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100dvh', color: C.text,
                  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
                  paddingBottom: 90 }}>

      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.line}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                    position: 'sticky', top: 0, background: C.bg, zIndex: 60 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.muted,
                                            fontSize: 20, cursor: 'pointer', padding: 0 }}>‹</button>
        )}
        <div style={{ flex: 1, fontSize: 19, fontWeight: 800 }}>People</div>
        <button onClick={load}
          style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8,
                   color: C.muted, fontSize: 12, padding: '6px 11px', cursor: 'pointer',
                   fontFamily: 'inherit' }}>Refresh</button>
      </div>

      {/* Person quick-select — the thing that worked in OfficeHub */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 16px',
                    borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 53,
                    background: C.bg, zIndex: 55, WebkitOverflowScrolling: 'touch' }}>
        <PersonChip name="all" count={countFor('all')} color={C.cyan} active={person === 'all'} />
        {ASSIGNEES.map(a => (
          <PersonChip key={a.email} name={a.name}
            count={countFor(a.name)}
            color={TECH_COLORS[a.name] || C.cyan}
            active={person === a.name} />
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`,
                    position: 'sticky', top: 110, background: C.bg, zIndex: 50 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: '12px 0', background: 'none', border: 'none',
                     color: tab === t.key ? C.cyan : C.dim, fontSize: 14,
                     fontWeight: tab === t.key ? 800 : 500, cursor: 'pointer',
                     position: 'relative', fontFamily: 'inherit',
                     borderBottom: `2px solid ${tab === t.key ? C.cyan : 'transparent'}` }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: C.muted }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: '14px 16px' }}>
        {loading && <Empty>Loading…</Empty>}
        {err && <div style={{ color: '#fca5a5', fontSize: 13 }}>Couldn’t load: {err}</div>}

        {/* ── WORK ── their jobs, in the board's five lanes ── */}
        {!loading && tab === 'work' && (
          <>
            {myJobs.length === 0 && (
              <Empty>
                {person === 'all'
                  ? 'No open jobs.'
                  : `${person} has no open work.`}
              </Empty>
            )}
            {WORK_LANES.map(lane => byLane[lane.key]?.length ? (
              <Section key={lane.key} title={`${lane.icon} ${lane.label}`}
                color={lane.color} count={byLane[lane.key].length}>
                {byLane[lane.key].map(j => <JobRow key={j.id} job={j} />)}
              </Section>
            ) : null)}

          </>
        )}

        {/* ── TASKS ── the person's own list (was My Tasks) ── */}
        {!loading && tab === 'tasks' && (
          <>
            {TASK_LANES.map(tl => {
              const items = myNotes.filter(n => n.lane === tl.key);
              return (
                <Section key={tl.key} title={tl.label} color={tl.color} count={items.length}>
                  {items.length === 0 && <Empty>{tl.empty}</Empty>}
                  {items.map(n => {
                    const job = n.job_id ? jobs.find(j => j.id === n.job_id) : null;
                    return (
                      // A note is a thing somebody wrote down. A job is a
                      // visit that produces hours and an invoice. They were
                      // rendered identically — same slab, same left rule, same
                      // weight — so a scribbled reminder read as work.
                      // Paper, not a card: lighter ground, no heavy border,
                      // and a rule down the side that says who wrote it.
                      <div key={n.id}
                        style={{ background: 'transparent',
                                 borderLeft: `2px solid ${n.assigned_to ? tl.color : C.line}`,
                                 borderRadius: 0,
                                 padding: '6px 0 10px 12px', marginBottom: 4, color: C.text }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                          {/* Assignment is the only thing that separates the two.
                              Labelling every row "Task" made a private note look
                              like something somebody had been handed. */}
                          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6,
                                         textTransform: 'uppercase',
                                         color: n.assigned_to ? tl.color : C.muted,
                                         border: `1px solid ${n.assigned_to ? tl.color + '55' : C.line}`,
                                         borderRadius: 4, padding: '1px 5px' }}>
                            {n.assigned_to ? 'Task' : 'Note'}
                          </span>
                          <span style={{ fontSize: 11, color: C.muted }}>{fmtDay(n.created_at)}</span>
                        </div>
                        <div
                          onClick={() => job ? setOpenJob(job) : null}
                          style={{ fontSize: 13.5, lineHeight: 1.5, color: C.text,
                                   cursor: job ? 'pointer' : 'default' }}>
                          {n.body}
                        </div>
                        {n.author_email && (
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                            {NAME_BY_EMAIL[canonicalEmail(n.author_email)] || n.author_email.split('@')[0]} wrote this
                          </div>
                        )}
                        {job && (
                          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5 }}>
                            {job.customer_name} · {laneOf(job)?.label || job.status}
                          </div>
                        )}
                        {tl.key !== 'done' && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 9 }}>
                            <span style={{ fontSize: 11, color: C.muted, marginRight: 2 }}>
                              {n.assigned_to ? 'Owner' : 'Give to'}
                            </span>
                            {ASSIGNEES.map(a => {
                              const on = (n.assigned_to || '').toLowerCase() === a.email.toLowerCase();
                              return (
                                <button key={a.email}
                                  onClick={() => assignNote(n.id, on ? null : a.email)}
                                  title={on ? 'Unassign — back to a private note' : `Give to ${a.name}`}
                                  style={{ padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
                                           background: on ? C.cyan : 'transparent',
                                           border: `1px solid ${on ? C.cyan : C.line}`,
                                           color: on ? '#0f172a' : C.muted,
                                           fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit' }}>
                                  {a.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {tl.key !== 'done' && (
                          <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                            {tl.key === 'todo' && (
                              <button onClick={() => moveNote(n.id, 'doing')}
                                style={{ flex: 1, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
                                         background: 'transparent', border: `1px solid ${C.amber}`,
                                         color: C.amber, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit' }}>
                                Start
                              </button>
                            )}
                            <button onClick={() => moveNote(n.id, 'done')}
                              style={{ flex: 1, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
                                       background: 'transparent', border: '1px solid #22c55e',
                                       color: '#22c55e', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit' }}>
                              ✓ Done
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Section>
              );
            })}
          </>
        )}

        {/* ── SCHEDULE ── what's booked, and a way to book more ── */}
        {!loading && tab === 'schedule' && (
          <>
            {upcoming.length === 0 && (
              <Empty>
                Nothing on {person === 'all' ? 'the' : `${person}’s`} calendar yet.
                Open a job from Work and choose Scheduled to book it.
              </Empty>
            )}
            {byDay.map(([day, items]) => {
              const d = localDate(day);
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const isToday = d && d.getTime() === today.getTime();
              return (
                <div key={day} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 8,
                                paddingBottom: 6, borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 15, fontWeight: 800,
                                   color: isToday ? C.cyan : C.text }}>
                      {d ? d.toLocaleDateString('en-US', { weekday: 'long' }) : day}
                    </span>
                    <span style={{ fontSize: 12.5, color: C.muted }}>
                      {d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                    </span>
                    {isToday && (
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                                     textTransform: 'uppercase', color: C.cyan }}>Today</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
                      {items.length} {items.length === 1 ? 'stop' : 'stops'}
                    </span>
                  </div>
                  {items.map(j => (
                    <div key={j.id} style={{ marginBottom: 7 }}>
                      <JobRow job={j} />
                      <button onClick={() => setScheduling(j)}
                        style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8,
                                 color: C.cyan, fontSize: 12, fontWeight: 700, padding: '6px 12px',
                                 cursor: 'pointer', fontFamily: 'inherit', marginLeft: 2 }}>
                        {j.scheduled_date ? 'Reschedule' : 'Book this hold'}
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* One ticket, same as the board and /j/ links */}
      {openJob && (
        <div onClick={() => setOpenJob(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,16,0.75)', zIndex: 900,
                   display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 540, background: C.bg, overflowY: 'auto',
                     borderLeft: `1px solid ${C.line}` }}>
            <TicketSheet
              job={openJob}
              userEmail={userEmail}
              accessToken={accessToken}
              onClose={() => setOpenJob(null)}
              onAssigned={() => load()}
              onOpenScheduler={() => { setScheduling(openJob); setOpenJob(null); }}
              onSchedulePrimary={
                ['ready_to_schedule', 'return_pending', 'scheduled'].includes(openJob.status)
                  ? () => { setScheduling(openJob); setOpenJob(null); } : null
              }
              onMove={(target, note) => moveJob(openJob, target, note)}
            />
          </div>
        </div>
      )}

      {scheduling && (
        <VisualSchedulerModal
          job={scheduling}
          /* VisualSchedulerModal filters on t.calendar_id and renders "No techs
             with a calendar configured" when nothing survives. The roster in
             ownership.js has no calendar on it — that lives in
             config/calendars.js — so every person was being filtered out.
             getTechCalendarId() is the one place that mapping exists. */
          techs={ASSIGNEES
            .map(a => ({
              id: a.email,
              name: a.name,
              email: a.email,
              calendar_id: getTechCalendarId(a.email),
              color: TECH_COLORS[a.name] || null,
            }))
            .filter(t => t.calendar_id)}
          accessToken={accessToken}
          userEmail={userEmail}
          onClose={() => setScheduling(null)}
          onScheduled={() => { setScheduling(null); load(); say('Scheduled'); }}
        />
      )}

      {/* Same floating + as Home and the Board. People had no way to add
          anything at all, which made it a read-only screen by accident. */}
      <button onClick={() => setNewJob(true)} aria-label="Add work"
        style={{ position: 'fixed', bottom: 80, right: 20, width: 56, height: 56,
                 borderRadius: 999, background: C.green, border: 'none', color: '#04130a',
                 fontSize: 28, fontWeight: 900, cursor: 'pointer', zIndex: 20,
                 boxShadow: '0 8px 24px rgba(34,197,94,0.35)', display: 'grid',
                 placeItems: 'center', fontFamily: 'inherit' }}>+</button>

      {newJob && (
        <NewJobModal
          accessToken={accessToken}
          userEmail={userEmail}
          onClose={() => setNewJob(false)}
          onCreated={() => { setNewJob(false); load(); say('Added'); }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 84, left: '50%', transform: 'translateX(-50%)',
                      background: C.raised, border: `1px solid ${C.line}`, borderRadius: 999,
                      padding: '9px 18px', fontSize: 13, fontWeight: 700, zIndex: 1200 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
