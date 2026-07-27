// ============================================
// My Tasks — the owner's board, not the company's
// ============================================
// THE FIRST VERSION WAS WRONG and this comment exists so it doesn't regress.
// v1 rendered `jobs` rows straight into To Do / Doing / Done, which made the
// lanes a renamed copy of job.status. Consequences: Shana couldn't move
// anything without changing the job, "Done" showed the whole company's billing
// pipeline instead of her finished work, and the screen was just the board
// wearing a different hat.
//
// THE MODEL NOW
//   To Do — a FEED, read from jobs. Work where she is the next action: ready
//           to schedule, return needed, estimate won, parts landed, plus
//           anything assigned to her. Plus her own open notes. Tapping a job
//           opens THAT TICKET, it does not move it.
//   Doing — HERS. Nothing lands here automatically. She pulls things in.
//   Done  — HER finished notes and HER scheduled items. Not billing.
//
// THE RULE: a card in Doing may POINT AT a job (`notes.job_id`) but moving it
// NEVER writes to that job. A job sits in ready_to_schedule whether or not she
// is working it, because the board is the company's view and this is hers.
// If a future change makes a lane move update jobs.status, that is the bug.
//
// Tentative scheduling records HER intent against the Tent calendar — which
// stays the source of truth. It does not dispatch a tech or schedule a job.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { shortCode } from '../config/appBase.js';
import { CALENDARS, SYNC_CALENDARS } from '../config/calendars.js';
import { ownsJob, assigneeOf, CLOSED_STATUSES, ASSIGNEES, NAME_BY_EMAIL } from '../utils/ownership.js';
import { statusLabel, statusColor, statusChipStyle } from '../utils/status.js';
import NewJobModal from '../components/NewJobModal.jsx';
import VisualSchedulerModal from '../components/VisualSchedulerModal.jsx';
import { techsApi } from '../services/supabase.js';
import { createEventOnCalendar } from '../services/calendarSync.js';
import CustomerPicker from '../components/CustomerPicker.jsx';
import TicketSheet from '../components/TicketSheet.jsx';
import { jobsApi } from '../services/supabase.js';
import { resolveJobForEvent } from '../utils/jobResolve.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';
// Watching cards are visually distinct so a card that came BACK to her never
// reads as brand-new work. Amber, not the neutral card background.
const WATCH_BG = '#2a1f08';
const BG = '#0f1729', SURFACE = '#1e293b', LINE = '#334155';
const TEXT = '#e2e8f0', MUTED = '#94a3b8', ACCENT = '#00c8e8';

// A job only reaches her To Do two ways: it is ASSIGNED to her, or she pulled
// it in herself. Status alone is not enough. Showing every ready/return/parts
// job in the company was the same mistake as v1 in a smaller costume — her
// column filled with work that was never hers and she stopped trusting it.
// Statuses that are finished or dead never surface even when assigned.



// Every person on the roster gets a My Tasks view. No per-person config to
// maintain — adding someone to ASSIGNEES adds their view and their switcher tab.
const WORKSPACES = Object.fromEntries(
  ASSIGNEES.map(a => [a.name.toLowerCase(), { title: a.name, email: a.email, name: a.name }])
);
// /workspace/all — everyone's lanes at once, with an owner chip on each card.
// Reached from the home screen when you want the whole picture rather than
// one person's. Read-only by intent: hand-off and tentative scheduling belong
// to whoever owns the item, and doing them from an aggregate view means acting
// as somebody else without meaning to.
WORKSPACES.all = { title: 'Everyone', email: null, name: 'all', isAll: true };

const fmtDay = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  : '';

// ── Tentative schedule picker ────────────────────────────────────────
// Reads the Tent calendar so she can attach an event she's already pencilled
// in. If there isn't one yet she can just set a date — the intent is the point,
// and the calendar entry can catch up.
// TentPicker DELETED 9.9.40. It was a second thing called "schedule" with a
// bare date box and no day view — so holding a slot threw away the availability
// picture the real scheduler already shows. Holding now lives inside
// VisualSchedulerModal as a second button under the same grid.

export default function Workspace({ accessToken, userEmail, userName }) {
  const navigate = useNavigate();
  const { who } = useParams();
  const location = useLocation();
  const key = (who || userName || '').toLowerCase();
  const config = WORKSPACES[key] || WORKSPACES.shana;
  const viewingSelf = (userName || '').toLowerCase() === config.name.toLowerCase();
  const owner = config.email;
  const ownerName = config.name;

  const [items, setItems] = useState([]);   // her notes — the real workspace
  const [feed, setFeed] = useState([]);     // jobs needing office action
  const [watchedJobs, setWatchedJobs] = useState({}); // job rows behind watch cards
  // Tent calendar events she has pencilled in that have NO job behind them.
  // These are real commitments living only in Google — the exact population the
  // home banner counts as "will not bill".
  const [tentEvents, setTentEvents] = useState([]);
  const [tentCustomer, setTentCustomer] = useState({});
  const [tentErr, setTentErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showNewJob, setShowNewJob] = useState(false);

  const [addWork, setAddWork] = useState(false);
  // THE scheduler — the same one the board uses. My Tasks previously had only
  // TentPicker, which looked like scheduling and wasn't, so "schedule" meant
  // two different things depending on which button you found.
  const [schedulingJob, setSchedulingJob] = useState(null);
  // Tickets open HERE, in the same sheet the board uses, instead of navigating
  // to /j/ and rendering a different component with a different layout. Three
  // ways to open a ticket was three designs because it was three components.
  const [openJob, setOpenJob] = useState(null);
  const [techs, setTechs] = useState([]);
  const [assignFor, setAssignFor] = useState(null); // job or note being handed off
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: notes }, { data: jobs }] = await Promise.all([
        config.isAll
          ? supabase.from('notes').select('*')
              .order('created_at', { ascending: true }).limit(1000)
          : supabase.from('notes').select('*')
              .eq('author_email', owner)
              .order('created_at', { ascending: true }).limit(500),
        config.isAll
          ? supabase.from('jobs')
              .select('id, customer_name, issue, status, assigned_to, tech_name, created_at, scheduled_date')
              .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
              .order('created_at', { ascending: true }).limit(1000)
          : supabase.from('jobs')
              .select('id, customer_name, issue, status, assigned_to, tech_name, created_at, scheduled_date')
              .or(`assigned_to.eq.${owner},tech_name.ilike.${ownerName}`)
              .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
              .order('created_at', { ascending: true }).limit(500),
      ]);
      setItems(notes || []);

      // Watched jobs are by definition NOT hers — they won't come back in the
      // ownership query above, so fetch them by id or the lane renders blind.
      // Any note that points at a job needs that job loaded — Doing cards now
      // schedule for real, and the scheduler needs the actual job row.
      const watchIds = (notes || []).filter(n => n.job_id).map(n => n.job_id);
      if (watchIds.length) {
        const { data: watched } = await supabase.from('jobs')
          .select('id, customer_name, issue, status, assigned_to, tech_name')
          .in('id', watchIds);
        setWatchedJobs(Object.fromEntries((watched || []).map(j => [j.id, j])));
      } else setWatchedJobs({});
      // The .or() above is a coarse net — it also catches jobs where tech_name
      // still says Shana but assigned_to has since been set to someone else.
      // An explicit assignment must beat a stale tech_name, so filter here.
      // In ALL mode owner is null and ownerName is 'all', so ownsJob() matches
      // nothing and the feed came back empty — the All tab looked broken. Keep
      // every job that has an owner; unassigned work belongs on the board, not
      // in somebody's task list.
      setFeed(config.isAll
        ? (jobs || []).filter(j => assigneeOf(j))
        : (jobs || []).filter(j => ownsJob(j, owner) || ownsJob(j, ownerName)));
    } catch (e) { console.error('workspace load', e); }
    setLoading(false);
  }, [owner, ownerName, config.isAll]);

  // Tent events, today forward. Anything already backed by a job is dropped —
  // it's on the board and doesn't need to sit in her Doing column twice.
  const loadTent = useCallback(async () => {
    if (!accessToken) return;
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 120);
      const params = new URLSearchParams({
        timeMin: from.toISOString(), timeMax: to.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      });
      const res = await fetch(
        `${GCAL}/calendars/${encodeURIComponent(CALENDARS.TENTATIVELY_SCHEDULED)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } });
      // Was a bare `return` — a 403 on the Tent calendar looked exactly like an
      // empty Tent calendar, so the Doing lane would just quietly show nothing.
      if (!res.ok) { console.warn('Tent calendar read failed:', res.status); setTentErr(`Tent calendar unreadable (${res.status})`); return; }
      setTentErr(null);
      const data = await res.json();
      const live = (data.items || []).filter(e => e.status !== 'cancelled');
      const unlinked = [];
      for (const ev of live) {
        const job = await resolveJobForEvent(ev.id);
        if (!job) unlinked.push(ev);
      }
      setTentEvents(unlinked);
    } catch (e) { console.warn('tent load failed', e); }
  }, [accessToken]);

  useEffect(() => {
    techsApi.getAll()
      .then(setTechs)
      .catch(async () => {
        const { data } = await supabase.from('techs').select('*').order('name');
        setTechs(data || []);
      });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTent(); }, [loadTent]);

  // A job she has already pulled in shouldn't also sit in the feed.
  // Hide a job from To Do once its owner has pulled it into Doing. In ALL mode
  // that de-duplication is wrong — one person parking a card would erase it
  // from everyone's view — so the feed stays whole.
  const pulledJobIds = useMemo(
    () => config.isAll
      ? new Set()
      : new Set(items.filter(i => i.job_id && i.lane !== 'todo').map(i => i.job_id)),
    [items, config.isAll]
  );

  const q = query.trim().toLowerCase();
  const matches = (text) => !q || (text || '').toLowerCase().includes(q);

  const todoFeed  = feed.filter(j => !pulledJobIds.has(j.id))
                        .filter(j => matches(`${j.customer_name} ${j.issue} ${j.tech_name}`));
  const todoNotes = items.filter(i => i.lane === 'todo'  && matches(i.body));
  const doing     = items.filter(i => i.lane === 'doing' && matches(i.body));
  const done      = items.filter(i => i.lane === 'done'  && matches(i.body));
  const watching  = items.filter(i => i.lane === 'watching' && matches(i.body));

  // A watched job that has come BACK to her shows in To Do with the watching
  // tint, so she can tell "this returned to me" from "this is new work".
  const watchedBackToMe = new Set(
    watching.filter(w => {
      const j = watchedJobs[w.job_id];
      return j && ownsJob(j, owner);
    }).map(w => w.job_id)
  );

  // ── Mutations. None of these touch `jobs`. That is the whole point. ──
  const pullIn = async (job) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('notes').insert([{
        body: `${job.customer_name || 'Job'}${job.issue ? ` — ${job.issue}` : ''}`,
        author_email: owner, job_id: job.id, lane: 'doing', status: 'open',
      }]);
      if (error) throw error;
      await load(); say('Moved to Doing ✓');
    } catch (e) { say('Could not move: ' + (e.message || e)); }
    setSaving(false);
  };

  // Hand a job to someone else. She stops owning the next action but keeps the
  // card — in Watching, not gone. This writes jobs.assigned_to (the one place
  // ownership lives) and parks her card, in that order.
  const handOff = async (target, email) => {
    setSaving(true);
    try {
      const jobId = target.job_id || target.id;
      const job = watchedJobs[jobId] || feed.find(j => j.id === jobId) || {};
      const { error } = await supabase.from('jobs')
        .update({ assigned_to: email, updated_at: new Date().toISOString() })
        .eq('id', jobId);
      if (error) throw error;

      if (target.job_id) {
        await supabase.from('notes').update({
          lane: 'watching', status: 'open', last_seen_status: job.status || null,
        }).eq('id', target.id);
      } else {
        await supabase.from('notes').insert([{
          body: `${job.customer_name || target.customer_name || 'Job'} — handed to ${NAME_BY_EMAIL[email] || email}`,
          author_email: owner, job_id: jobId, lane: 'watching', status: 'open',
          last_seen_status: job.status || target.status || null,
        }]);
      }
      setAssignFor(null);
      await load();
      say(`Handed to ${NAME_BY_EMAIL[email] || email} — watching \u2713`);
    } catch (e) { say('Could not hand off: ' + (e.message || e)); }
    setSaving(false);
  };

  // Turn a Tent event into a real board card, keeping the calendar event as the
  // link. Lands in Scheduled, which is where the board expects committed work —
  // so the thing she already promised a customer stops being invisible.
  const makeJob = async (ev) => {
    setSaving(true);
    try {
      const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
      const { data, error } = await supabase.from('jobs').insert([{
        customer_name:     (ev.summary || 'Untitled').replace(/\[[^\]]*\]\s*/g, '').trim(),
        customer_id:       tentCustomer[ev.id] || null,
        status:            'scheduled',
        issue:             (ev.description || '').slice(0, 500) || ev.summary || '',
        customer_address:  ev.location || '',
        scheduled_date:    start ? start.toISOString() : null,
        calendar_event_id: ev.id,
        calendar_id:       CALENDARS.TENTATIVELY_SCHEDULED,
        assigned_to:       owner,
      }]).select().single();
      if (error) throw error;
      setTentEvents(prev => prev.filter(x => x.id !== ev.id));
      await load();
      say('On the board — Scheduled \u2713');
      return data;
    } catch (e) { say('Could not create: ' + (e.message || e)); }
    setSaving(false);
  };

  const unwatch = async (item) => {
    setSaving(true);
    try {
      await supabase.from('notes').delete().eq('id', item.id);
      await load(); say('Stopped watching');
    } catch (e) { say('Could not remove: ' + (e.message || e)); }
    setSaving(false);
  };

  const moveLane = async (item, lane) => {
    setSaving(true);
    try {
      const patch = { lane };
      if (lane === 'done') {
        patch.status = 'archived';
        patch.archived_at = new Date().toISOString();
        patch.archived_by = userEmail || null;
      } else {
        patch.status = 'open';
        patch.archived_at = null;
      }
      const { error } = await supabase.from('notes').update(patch).eq('id', item.id);
      if (error) throw error;
      await load();
    } catch (e) { say('Could not move: ' + (e.message || e)); }
    setSaving(false);
  };

  // Tentative now does three things instead of one:
  //   1. creates a REAL event on the Tent calendar (unless she linked an
  //      existing one), so the hold exists where the team already looks
  //   2. stamps jobs.tentative_date, so the board card shows the hold
  //   3. records it on her note, as before
  // Writing only (3) is what made this feel broken — she pencilled something in
  // and nothing anywhere reflected it.

  const Lane = ({ label, hint, color, count, children, empty }) => (
    <div style={{ background: SURFACE, borderRadius: 12, padding: 12, minHeight: 120 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color }}>{label}</div>
        <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{count}</div>
      </div>
      <div style={{ fontSize: 11, color: MUTED, margin: '3px 0 10px' }}>{hint}</div>
      {count === 0
        ? <div style={{ color: MUTED, fontSize: 12, padding: '18px 0', textAlign: 'center' }}>
            {loading ? 'Loading…' : (empty || 'Nothing here.')}
          </div>
        : children}
    </div>
  );

  const Card = ({ children, accent, bg }) => (
    <div style={{ background: bg || BG, border: `1px solid ${LINE}`,
                  borderLeft: `3px solid ${accent || LINE}`, borderRadius: 10,
                  padding: 10, marginBottom: 8 }}>{children}</div>
  );

  const MoveBar = ({ item, lanes }) => (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {lanes.map(([lane, label]) => (
        <button key={lane} onClick={() => moveLane(item, lane)} disabled={saving}
          style={{ flex: 1, background: 'transparent', color: MUTED, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '5px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, paddingBottom: 60 }}>
      <div style={{ padding: '16px 16px 10px', borderBottom: `1px solid ${LINE}`,
                    position: 'sticky', top: 0, background: BG, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>
              {config.isAll ? 'Everyone' : viewingSelf ? 'My Tasks' : `${config.title}'s Tasks`}
            </div>
            <div style={{ color: MUTED, fontSize: 12, maxWidth: 460, lineHeight: 1.35 }}>
              Everything assigned to you, and somewhere to take notes.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => navigate('/notes')}
              style={{ background: SURFACE, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 8,
                       padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>📝 Notes</button>
            <button onClick={() => setAddWork(true)}
              style={{ background: SURFACE, color: ACCENT, border: `1px solid ${ACCENT}55`, borderRadius: 8,
                       padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Add work</button>
            <button onClick={() => setShowNewJob(true)}
              style={{ background: ACCENT, color: '#0f1729', border: 'none', borderRadius: 8,
                       padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ New</button>
            <button onClick={load} disabled={loading}
              style={{ background: SURFACE, border: 'none', color: MUTED, borderRadius: 8,
                       padding: '9px 13px', fontSize: 14, cursor: 'pointer' }}>{loading ? '…' : '↻'}</button>
          </div>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter…"
          style={{ width: '100%', boxSizing: 'border-box', background: SURFACE, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '9px 12px', color: TEXT, fontSize: 13, outline: 'none' }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>viewing</span>
          <button onClick={() => navigate('/workspace/all')}
            style={{ background: config.isAll ? ACCENT : SURFACE, color: config.isAll ? '#0f1729' : MUTED,
                     border: 'none', borderRadius: 20, padding: '4px 11px',
                     fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>All</button>
          {ASSIGNEES.map(a => (
            <button key={a.email} onClick={() => navigate(`/workspace/${a.name.toLowerCase()}`)}
              style={{ background: config.name === a.name ? ACCENT : SURFACE,
                       color: config.name === a.name ? '#0f1729' : MUTED,
                       border: 'none', borderRadius: 20, padding: '4px 11px',
                       fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {a.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, padding: 16 }}>

        {/* ── TO DO — a feed. Read-only against the board. ── */}
        <Lane label="To Do" hint="Assigned to you, plus your own notes"
          color="#f59e0b" count={todoFeed.length + todoNotes.length}
          empty={'Nothing assigned to you yet — tap "+ Add work" to claim some.'}>
          {todoNotes.map(n => (
            <Card key={n.id} accent={ACCENT}>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <MoveBar item={n} lanes={[['doing', '→ Doing'], ['done', '✓ Done']]} />
            </Card>
          ))}
          {todoFeed.map(j => (
            <Card key={j.id} accent={statusColor(j.status)} bg={watchedBackToMe.has(j.id) ? WATCH_BG : null}>
              <div onClick={() => setOpenJob(j)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{j.customer_name || 'Unnamed'}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', padding: '3px 7px', borderRadius: 20,
                                background: `${statusColor(j.status)}22`, color: statusColor(j.status) }}>
                    {statusLabel(j.status)}
                  </div>
                </div>
                {config.isAll && assigneeOf(j) && (
                  <div style={{ fontSize: 10, color: ACCENT, fontWeight: 700, marginTop: 3 }}>{assigneeOf(j)}</div>
                )}
                {j.issue && (
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                    {j.issue.length > 100 ? j.issue.slice(0, 98).trimEnd() + '…' : j.issue}
                  </div>
                )}
              </div>
              <button onClick={() => setSchedulingJob(j)} disabled={saving}
                style={{ marginTop: 8, width: '100%', background: '#22c55e', color: '#0f1729',
                         border: 'none', borderRadius: 8, padding: '7px 0',
                         fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                📅 Schedule
              </button>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => pullIn(j)} disabled={saving}
                  style={{ flex: 1, background: 'transparent', color: ACCENT,
                           border: `1px solid ${ACCENT}55`, borderRadius: 8, padding: '6px 0',
                           fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  → I'm working this
                </button>
                <button onClick={() => setAssignFor(j)} disabled={saving}
                  style={{ flex: 1, background: 'transparent', color: '#f59e0b',
                           border: '1px solid #f59e0b55', borderRadius: 8, padding: '6px 0',
                           fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  Hand off →
                </button>
              </div>
            </Card>
          ))}
        </Lane>

        {/* ── DOING — hers alone ── */}
        <Lane label="Doing" hint="Pencilled in, plus what you put here"
          color="#3b82f6" count={doing.length + tentEvents.length}>
          {tentErr && (
            <div style={{ background: '#3b0d0d', border: '1px solid #ef444455', borderRadius: 10,
                          padding: '8px 10px', marginBottom: 8, fontSize: 11, color: '#fca5a5' }}>
              ⚠️ {tentErr} — pencilled-in work may be missing from this list.
            </div>
          )}
          {/* Tent commitments with no board card behind them. Real promises to
              real customers that currently exist only in Google. */}
          {tentEvents.map(ev => (
            <div key={ev.id}
              style={{ background: WATCH_BG, border: '1px solid #f59e0b55',
                       borderLeft: '3px solid #f59e0b', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{ev.summary || '(untitled)'}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                Tent · {fmtDay(ev.start?.dateTime || ev.start?.date)}
              </div>
              <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginTop: 4 }}>
                not on the board yet
              </div>
              <div style={{ marginTop: 8 }}>
                <CustomerPicker compact
                  value={tentCustomer[ev.id] || null}
                  onChange={(id) => setTentCustomer(m => ({ ...m, [ev.id]: id }))}
                  placeholder="Link a client (optional)" />
              </div>
              <button onClick={() => makeJob(ev)} disabled={saving}
                style={{ marginTop: 8, width: '100%', background: '#22c55e', color: '#0f1729',
                         border: 'none', borderRadius: 8, padding: '7px 0',
                         fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Make it a job → Scheduled
              </button>
            </div>
          ))}
          {doing.map(n => (
            <Card key={n.id} accent="#3b82f6">
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>
                {/* The hold lives on the JOB now (jobs.tentative_date), so the
                    card shows the same date the board does instead of a private
                    copy on the note that could drift out of sync. */}
                {(watchedJobs[n.job_id]?.tentative_date || n.scheduled_for) && (
                  <span style={{ background: '#f59e0b22', color: '#f59e0b', borderRadius: 20,
                                 padding: '3px 9px', fontSize: 10, fontWeight: 700 }}>
                    ✏️ Held {fmtDay(watchedJobs[n.job_id]?.tentative_date || n.scheduled_for)}
                  </span>
                )}
                {n.calendar_event_id && <span style={{ color: MUTED, fontSize: 10 }}>🔗 calendar linked</span>}
                {n.job_id && (
                  <button onClick={() => setOpenJob(watchedJobs[n.job_id] || { id: n.job_id })}
                    style={{ background: 'none', border: 'none', color: ACCENT, fontSize: 10, cursor: 'pointer', padding: 0 }}>
                    open ticket →
                  </button>
                )}
              </div>
              {n.job_id && (
                <button onClick={() => setSchedulingJob(watchedJobs[n.job_id] || feed.find(j => j.id === n.job_id) || { id: n.job_id })}
                  disabled={saving}
                  style={{ marginTop: 8, width: '100%', background: '#22c55e', color: '#0f1729',
                           border: 'none', borderRadius: 8, padding: '7px 0',
                           fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  📅 Schedule or hold
                </button>
              )}
              <MoveBar item={n} lanes={[['todo', '← To Do'], ['done', '✓ Done']]} />
              {n.job_id && (
                <button onClick={() => setAssignFor(n)} disabled={saving}
                  style={{ marginTop: 6, width: '100%', background: 'transparent', color: '#f59e0b',
                           border: '1px solid #f59e0b55', borderRadius: 8, padding: '5px 0',
                           fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  Hand off →
                </button>
              )}
            </Card>
          ))}
        </Lane>

        {/* ── WATCHING — handed off, blocked, or just tracking ── */}
        <Lane label="Watching" hint="Someone else's move — you still need to know"
          color="#f59e0b" count={watching.length}
          empty={'Nothing you\'re tracking. Hand a card to someone and it lands here.'}>
          {watching.map(n => {
            const j = watchedJobs[n.job_id] || {};
            const moved = n.last_seen_status && j.status && n.last_seen_status !== j.status;
            return (
              <div key={n.id}
                style={{ background: WATCH_BG, border: `1px solid ${LINE}`,
                         borderLeft: '3px solid #f59e0b', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{j.customer_name || n.body}</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                  {moved ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e' }}>
                      {statusLabel(n.last_seen_status)} → {statusLabel(j.status)}
                    </span>
                  ) : (
                    <span style={{ ...statusChipStyle(j.status) }}>{statusLabel(j.status)}</span>
                  )}
                  {j.assigned_to && (
                    <span style={{ fontSize: 10, color: MUTED }}>
                      with {NAME_BY_EMAIL[j.assigned_to] || j.assigned_to}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {n.job_id && (
                    <button onClick={() => setOpenJob(watchedJobs[n.job_id] || { id: n.job_id })}
                      style={{ flex: 1, background: 'transparent', color: ACCENT, border: `1px solid ${ACCENT}55`,
                               borderRadius: 8, padding: '5px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Open ticket
                    </button>
                  )}
                  <button onClick={() => unwatch(n)} disabled={saving}
                    style={{ flex: 1, background: 'transparent', color: MUTED, border: `1px solid ${LINE}`,
                             borderRadius: 8, padding: '5px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    Stop watching
                  </button>
                </div>
              </div>
            );
          })}
        </Lane>

        {/* ── DONE — her finished work only ── */}
        <Lane label="Done" hint="Your finished notes and scheduled items" color="#22c55e" count={done.length}>
          {done.slice().reverse().map(n => (
            <Card key={n.id} accent="#22c55e">
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7 }}>
                {n.tentative && n.scheduled_for && (
                  <span style={{ color: MUTED, fontSize: 10 }}>📅 {fmtDay(n.scheduled_for)}</span>
                )}
                <span style={{ color: MUTED, fontSize: 10 }}>{fmtDay(n.archived_at || n.updated_at)}</span>
                {n.job_id && (
                  <button onClick={() => setOpenJob(watchedJobs[n.job_id] || { id: n.job_id })}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: ACCENT,
                             fontSize: 10, cursor: 'pointer', padding: 0 }}>
                    open ticket →
                  </button>
                )}
              </div>
              <MoveBar item={n} lanes={[['doing', '↩ Reopen']]} />
            </Card>
          ))}
        </Lane>
      </div>

      {assignFor && (
        <div onClick={() => setAssignFor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1200,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: SURFACE, borderRadius: 14, padding: 20, width: '100%', maxWidth: 380 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Hand off to</div>
            <div style={{ color: MUTED, fontSize: 12, margin: '3px 0 14px', lineHeight: 1.4 }}>
              They take the next action. The card moves to your Watching column so you
              still see it move.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ASSIGNEES.filter(a => a.email !== owner).map(a => (
                <button key={a.email} onClick={() => handOff(assignFor, a.email)} disabled={saving}
                  style={{ background: SURFACE, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 20,
                           padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {a.name}
                </button>
              ))}
            </div>
            <button onClick={() => setAssignFor(null)}
              style={{ marginTop: 16, width: '100%', background: 'transparent', color: MUTED,
                       border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 0',
                       fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* One ticket sheet, slid over — identical to the board's. */}
      {openJob && (
        <div onClick={() => setOpenJob(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,16,0.75)', zIndex: 1150,
                   display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, background: BG, overflowY: 'auto',
                     borderLeft: `1px solid ${LINE}` }}>
            <TicketSheet
              job={openJob}
              userEmail={userEmail}
              accessToken={accessToken}
              busy={saving}
              onClose={() => setOpenJob(null)}
              onOpenScheduler={() => { setSchedulingJob(openJob); setOpenJob(null); }}
              onMove={async (target, moveNote) => {
                await jobsApi.changeStatus(openJob.id, target, userEmail, moveNote);
                setOpenJob(null);
                await load();
                say('Moved ✓');
              }}
            />
          </div>
        </div>
      )}

      {schedulingJob && (
        <VisualSchedulerModal
          job={schedulingJob} techs={techs} accessToken={accessToken}
          onClose={() => setSchedulingJob(null)}
          onScheduled={() => { setSchedulingJob(null); load(); say('Scheduled — on the board ✓'); }} />
      )}

      {addWork && (
        <AddWork owner={owner} ownerName={ownerName} onClose={() => setAddWork(false)} onDone={load} />
      )}

      {showNewJob && (
        <NewJobModal accessToken={accessToken} userEmail={userEmail}
          onClose={() => setShowNewJob(false)}
          onCreated={() => { setShowNewJob(false); load(); say('Job created ✓'); }} />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                      background: '#22c55e', color: '#0f1729', padding: '10px 18px', borderRadius: 20,
                      fontSize: 13, fontWeight: 700, zIndex: 2000 }}>{toast}</div>
      )}
    </div>
  );
}
