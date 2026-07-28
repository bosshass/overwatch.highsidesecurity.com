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
import Spotlight from '../components/Spotlight.jsx';
import TicketSheet from '../components/TicketSheet.jsx';
import { MergeTool } from './BoardView.jsx';
import { jobsApi } from '../services/supabase.js';
import { resolveJobForEvent } from '../utils/jobResolve.js';
import { ignoreOrphan, isOrphanIgnored } from '../services/calendarSync.js';
import { isHeld } from '../utils/lanes.js';

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

// ── Add work ─────────────────────────────────────────────────────────
// RESTORED 9.10.5. The 9.9.40 TentPicker deletion swallowed this component
// too — it sat directly below the deleted block — so "+ Add work" crashed
// from 9.9.40 until now with a green build every time. (Vite doesn't check
// undefined identifiers; the new lint gate does.)
//
// Shows every open job nobody has claimed; taking one sets assigned_to and it
// lands in your To Do. It never changes the job's status. Jobs whose tech_name
// already resolves to you are excluded — they're already yours.
function AddWork({ owner, ownerName, onClose, onDone }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    supabase.from('jobs')
      .select('id, customer_name, issue, status, tech_name, created_at')
      .in('status', ['ready_to_schedule', 'return_pending', 'won', 'needs_parts', 'pending_materials'])
      .is('assigned_to', null)
      .order('created_at', { ascending: true }).limit(200)
      .then(({ data }) => setRows((data || []).filter(
        j => (assigneeOf(j) || '').toLowerCase() !== (ownerName || '').toLowerCase()
      )));
  }, [ownerName]);

  const hits = (rows || []).filter(r => {
    const t = q.trim().toLowerCase();
    return !t || `${r.customer_name} ${r.issue}`.toLowerCase().includes(t);
  });

  const take = async (job) => {
    setBusy(job.id);
    await supabase.from('jobs')
      .update({ assigned_to: owner, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    setRows(prev => prev.filter(r => r.id !== job.id));
    setBusy(null);
    onDone();
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1200,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: SURFACE, borderRadius: 14, padding: 18, width: '100%', maxWidth: 520,
                 maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Add work</div>
        <div style={{ color: MUTED, fontSize: 12, margin: '3px 0 12px' }}>
          Open jobs nobody has picked up. Taking one puts it in your To Do — it does
          not change the job's status.
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
          style={{ background: BG, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 12px',
                   color: TEXT, fontSize: 13, outline: 'none', marginBottom: 10 }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rows === null ? (
            <div style={{ color: MUTED, fontSize: 12, padding: 20, textAlign: 'center' }}>Loading…</div>
          ) : hits.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 12, padding: 20, textAlign: 'center' }}>
              Nothing unassigned. Everything open already has an owner.
            </div>
          ) : hits.map(j => (
            <div key={j.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                       borderBottom: `1px solid ${BG}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{j.customer_name || 'Unnamed'}
                  {isHeld(j) && (
                    <span style={{ marginLeft: 7, background: '#f59e0b22', color: '#f59e0b', borderRadius: 20,
                                   padding: '2px 8px', fontSize: 10, fontWeight: 800 }}>
                      ✏️ Held {new Date(j.tentative_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: MUTED }}>
                  {statusLabel(j.status)}{j.issue ? ` · ${j.issue.slice(0, 60)}` : ''}
                </div>
              </div>
              <button onClick={() => take(j)} disabled={busy === j.id}
                style={{ background: ACCENT, color: '#0f1729', border: 'none', borderRadius: 8,
                         padding: '7px 13px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                         whiteSpace: 'nowrap' }}>
                {busy === j.id ? '…' : "I'll take it"}
              </button>
            </div>
          ))}
        </div>
        <button onClick={onClose}
          style={{ marginTop: 12, background: 'transparent', color: MUTED, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '9px 0', fontSize: 12, cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  );
}

export default function Workspace({ accessToken, userEmail, userName, isOperator = false }) {
  const WORKSPACE_SPOTLIGHT_STEPS = [
    { target: 'wk-viewing', title: 'Whose board is this',
      body: 'Switch between your own tasks, someone else\'s, or everyone\'s at once.' },
    { target: 'wk-todo', title: 'To Do',
      body: 'Assigned to you, plus your own notes and quick tasks — nothing here goes to the board.' },
    { target: 'wk-doing', title: 'Doing',
      body: 'Pencilled in, plus anything you\'ve pulled in to work on yourself.' },
    { target: 'wk-watching', title: 'Watching',
      body: 'Handed off to someone else, but you still need to know when it moves. It comes back here tinted when it does.' },
    { target: 'wk-addwork', title: 'Add work',
      body: 'Open jobs nobody has claimed yet. Taking one doesn\'t change its status — just puts it in your To Do.' },
    { target: 'wk-board-link', title: 'Back to the board',
      body: 'My Tasks is yours. The board is everyone\'s. This is the way back.' },
  ];
  const WK_SPOTLIGHT_BUILD = '9.11.13';
  const wkSpotlightKey = (email) => `ow_wk_spotlight_${WK_SPOTLIGHT_BUILD}_${(email || '').toLowerCase()}`;
  const [showWkSpotlight, setShowWkSpotlight] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(wkSpotlightKey(userEmail))) setShowWkSpotlight(true); } catch {}
  }, [userEmail]);
  const closeWkSpotlight = () => {
    setShowWkSpotlight(false);
    try { localStorage.setItem(wkSpotlightKey(userEmail), new Date().toISOString()); } catch {}
  };
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
              .select('id, customer_name, issue, status, assigned_to, tech_name, created_at, scheduled_date, tentative_date')
              .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
              .order('created_at', { ascending: true }).limit(1000)
          : supabase.from('jobs')
              .select('id, customer_name, issue, status, assigned_to, tech_name, created_at, scheduled_date, tentative_date')
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
      const live = (data.items || []).filter(e => e.status !== 'cancelled' && !isOrphanIgnored(e.id));

      // Fuzzy-match each unlinked hold against OPEN jobs by customer name, the
      // same rule MergeTool uses. "Holding Tom and Donna Hanks" and an existing
      // unassigned job "HANKS, TOM/DONNA" are the same customer — offering
      // "Make it a job" as the ONLY option there creates a duplicate. A match
      // gets a Link button instead; no match still gets Make it a job.
      const rawName = (ev) => (ev.summary || '').replace(/^\s*holding\s+/i, '').trim();
      const { data: openJobs } = await supabase.from('jobs')
        .select('id, customer_name, status')
        .not('status', 'in', '(dead,archived)')
        .not('customer_name', 'is', null);
      const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const findMatch = (name) => {
        const n = norm(name);
        if (!n) return null;
        const parts = n.split(' ').filter(Boolean);
        return (openJobs || []).find(j => {
          const jn = norm(j.customer_name);
          return jn && (jn.includes(n) || n.includes(jn) ||
            parts.some(p => p.length > 2 && jn.includes(p)));
        }) || null;
      };

      // Dedupe: multiple hold events for the SAME customer (a multi-day job
      // pencilled one day at a time) collapse to one card instead of stacking
      // — a three-day job doesn't need three cards in the queue.
      const seen = new Set();
      const unlinked = [];
      for (const ev of live) {
        const job = await resolveJobForEvent(ev.id);
        if (job) continue;
        const name = rawName(ev);
        const match = findMatch(name);
        const dedupeKey = match ? `job:${match.id}` : `name:${norm(name)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        unlinked.push({ ...ev, _match: match, _customerName: name });
      }
      setTentEvents(unlinked);
    } catch (e) { console.warn('tent load failed', e); }
  }, [accessToken]);

  useEffect(() => {
    // Tent is the SCHEDULER'S queue (Shana, per spec — she manages new/old/
    // sales/returns and confirms holds). It was loading and rendering for
    // every viewer of every My Tasks page, which is what "shows up in
    // everyone's task list" meant — a shared queue duplicated N times.
    if (isOperator) loadTent();
  }, [isOperator, loadTent]);

  useEffect(() => {
    techsApi.getAll()
      .then(setTechs)
      .catch(async () => {
        const { data } = await supabase.from('techs').select('*').order('name');
        setTechs(data || []);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Adopt an existing hold event onto a job that ALREADY EXISTS on the board.
  // This is the fix for Tom and Donna Hanks: the calendar hold and the board
  // card were the same customer and stayed two separate things because
  // nothing connected them. Stamping tentative_date/tentative_event_id here is
  // the same adoption schedule.js's hold() does — just onto a job that's
  // already real instead of a freshly-created one.
  const linkHoldToJob = async (ev) => {
    if (!ev._match) return;
    setSaving(true);
    try {
      const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
      const { error } = await supabase.from('jobs').update({
        tentative_date: start ? start.toISOString() : null,
        tentative_event_id: ev.id,
        updated_at: new Date().toISOString(),
      }).eq('id', ev._match.id);
      if (error) throw error;
      setTentEvents(prev => prev.filter(x => x.id !== ev.id));
      await load();
      say(`Linked to ${ev._match.customer_name} \u2713`);
    } catch (e) { say('Could not link: ' + (e.message || e)); }
    setSaving(false);
  };

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
                        .filter(j => matches(`${j.customer_name} ${j.issue} ${assigneeOf(j) || ''}`));
  const todoNotes = items.filter(i => i.lane === 'todo'  && matches(i.body));
  const doing     = items.filter(i => i.lane === 'doing' && matches(i.body));
  const done      = items.filter(i => i.lane === 'done'  && matches(i.body));
  const watching  = items.filter(i => i.lane === 'watching' && matches(i.body));

  const [customerNameById, setCustomerNameById] = useState({});
  useEffect(() => {
    const ids = [...new Set(items.filter(i => i.customer_id).map(i => i.customer_id))]
      .filter(id => !(id in customerNameById));
    if (!ids.length) return;
    supabase.from('customers').select('id, name').in('id', ids).then(({ data }) => {
      if (!data) return;
      setCustomerNameById(prev => ({ ...prev, ...Object.fromEntries(data.map(c => [c.id, c.name])) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

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

  // NEW job from a hold with no match at all. This used to insert
  // status:'scheduled' directly — pretending a tech was booked for a job that
  // is, factually, still just a pencil mark. It also bypassed schedule.js, the
  // one place scheduling state is supposed to change. Now it ADOPTS the
  // existing hold event as a real tentative hold (tentative_date +
  // tentative_event_id) instead of both mis-stating status AND creating a
  // second calendar event nobody asked for.
  const makeJob = async (ev) => {
    setSaving(true);
    try {
      const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
      const { data, error } = await supabase.from('jobs').insert([{
        customer_name:      ev._customerName || (ev.summary || 'Untitled').replace(/\[[^\]]*\]\s*/g, '').trim(),
        customer_id:        tentCustomer[ev.id] || null,
        status:             'ready_to_schedule',
        issue:              (ev.description || '').slice(0, 500) || ev.summary || '',
        customer_address:   ev.location || '',
        tentative_date:     start ? start.toISOString() : null,
        tentative_event_id: ev.id,
        assigned_to:        owner,
      }]).select().single();
      if (error) throw error;
      setTentEvents(prev => prev.filter(x => x.id !== ev.id));
      await load();
      say('On the board — held \u2713');
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

  // Attach a customer for future reference. Additive only — does not touch
  // lane or create anything. The note becomes findable from that customer's
  // history without becoming a job.
  const attachCustomerToNote = async (note, customerId) => {
    if (!customerId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('notes')
        .update({ customer_id: customerId, on_customer_record: true })
        .eq('id', note.id);
      if (error) throw error;
      await load();
      say('Attached ✓');
    } catch (e) { say('Could not attach: ' + (e.message || e)); }
    setSaving(false);
  };

  // A quick note that turned into real work. Creates a real job, closes the
  // note out of To Do (its text lives on as the job's issue — nothing is
  // lost, it just stopped being a personal reminder and became a ticket),
  // and opens the scheduler immediately so note → job → booked is one motion.
  const convertNoteToJob = async (note) => {
    setSaving(true);
    try {
      let customerRow = null;
      if (note.customer_id) {
        const { data } = await supabase.from('customers')
          .select('id, name, address, phone').eq('id', note.customer_id).maybeSingle();
        customerRow = data || null;
      }
      const job = await jobsApi.create({
        customer_id: note.customer_id || undefined,
        customer_name: customerRow?.name || note.body.slice(0, 60),
        customer_address: customerRow?.address || '',
        customer_phone: customerRow?.phone || '',
        issue: note.body,
        status: 'ready_to_schedule',
        assigned_to: owner,
      }, userEmail);
      await supabase.from('notes').update({
        lane: 'done', status: 'archived', archived_at: new Date().toISOString(), archived_by: userEmail || null,
      }).eq('id', note.id);
      await load();
      say('Job created ✓');
      if (job?.id) setSchedulingJob(job);
    } catch (e) { say('Could not create job: ' + (e.message || e)); }
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

  const Lane = ({ label, hint, color, count, children, empty, tourId }) => (
    <div data-tour={tourId} style={{ background: SURFACE, borderRadius: 12, padding: 12, minHeight: 120 }}>
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
      {showWkSpotlight && (
        <Spotlight steps={WORKSPACE_SPOTLIGHT_STEPS} onDone={closeWkSpotlight} onSkip={closeWkSpotlight} />
      )}
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
            {/* There was no way back to the board from here at all — the
                board got links to My Tasks and Who's Stuck, this side never
                got the matching one. */}
            <button data-tour="wk-board-link" onClick={() => navigate('/board')}
              style={{ background: SURFACE, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 8,
                       padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>📋 Board</button>
            <button onClick={() => navigate('/notes')}
              style={{ background: SURFACE, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 8,
                       padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>📝 Notes</button>
            <button data-tour="wk-addwork" onClick={() => setAddWork(true)}
              style={{ background: SURFACE, color: ACCENT, border: `1px solid ${ACCENT}55`, borderRadius: 8,
                       padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Add work</button>
            <button onClick={() => setShowNewJob(true)}
              style={{ background: ACCENT, color: '#0f1729', border: 'none', borderRadius: 8,
                       padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ New</button>
            <button onClick={load} disabled={loading}
              style={{ background: SURFACE, border: 'none', color: MUTED, borderRadius: 8,
                       padding: '9px 13px', fontSize: 14, cursor: 'pointer' }}>{loading ? '…' : '↻'}</button>
            <button onClick={() => setShowWkSpotlight(true)} title="Show me around"
              style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: ACCENT, borderRadius: 8,
                       padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>▶</button>
          </div>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter…"
          style={{ width: '100%', boxSizing: 'border-box', background: SURFACE, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '9px 12px', color: TEXT, fontSize: 13, outline: 'none' }} />
        <div data-tour="wk-viewing" style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <Lane tourId="wk-todo" label="To Do" hint="Assigned to you, plus your own notes"
          color="#f59e0b" count={todoFeed.length + todoNotes.length}
          empty={'Nothing assigned to you yet — tap "+ Add work" to claim some.'}>
          {todoNotes.map(n => (
            <Card key={n.id} accent={ACCENT}>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              {n.customer_id && customerNameById[n.customer_id] && (
                <div style={{ fontSize: 11, color: '#00c8e8', fontWeight: 700, marginTop: 5 }}>
                  🔗 {customerNameById[n.customer_id]}
                </div>
              )}

              {/* Attach a customer for future reference. Doesn't create a job —
                  the note just becomes findable from that customer's history. */}
              {!n.customer_id && (
                <div style={{ marginTop: 8 }}>
                  <CustomerPicker compact
                    value={null}
                    onChange={(id) => attachCustomerToNote(n, id)}
                    placeholder="Attach a customer (optional)" />
                </div>
              )}

              {/* Escalate: this stopped being a reminder and became real
                  billable/schedulable work. Creates the job, closes the note
                  out of To Do (it did its job — the note's own text lives on
                  as the job's issue), and opens the scheduler immediately so
                  the whole "note → job → booked" trip is one motion. */}
              <button onClick={() => convertNoteToJob(n)} disabled={saving}
                style={{ marginTop: 8, width: '100%', background: 'transparent', color: '#22c55e',
                         border: '1px solid #22c55e55', borderRadius: 8, padding: '7px 0',
                         fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                → Make it a job
              </button>

              <MoveBar item={n} lanes={[['doing', '→ Doing'], ['done', '✓ Done']]} />
            </Card>
          ))}
          {todoFeed.map(j => (
            <Card key={j.id} accent={isHeld(j) ? '#f59e0b' : statusColor(j.status)}
              bg={watchedBackToMe.has(j.id) ? WATCH_BG : null}>
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
        <Lane tourId="wk-doing" label="Doing" hint="Pencilled in, plus what you put here"
          color="#3b82f6" count={doing.length + (isOperator ? tentEvents.length : 0)}>
          {isOperator && tentErr && (
            <div style={{ background: '#3b0d0d', border: '1px solid #ef444455', borderRadius: 10,
                          padding: '8px 10px', marginBottom: 8, fontSize: 11, color: '#fca5a5' }}>
              ⚠️ {tentErr} — pencilled-in work may be missing from this list.
            </div>
          )}
          {/* Tent orphans are the SCHEDULER'S queue, not personal task noise —
              gated to operators so they stop appearing on every tech's list.
              Same customer across multiple hold events collapses to one card
              (see loadTent's dedupe). A fuzzy name match against open jobs
              offers Link as the PRIMARY action — Make it a job stays, but as
              the fallback for when there really is nothing on the board yet. */}
          {isOperator && tentEvents.map(ev => (
            <div key={ev.id}
              style={{ background: WATCH_BG, border: '1px solid #f59e0b55',
                       borderLeft: '3px solid #f59e0b', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{ev.summary || '(untitled)'}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                Tent · {fmtDay(ev.start?.dateTime || ev.start?.date)}
              </div>
              {ev._match ? (
                <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginTop: 5,
                              background: '#22c55e18', borderRadius: 6, padding: '4px 7px' }}>
                  Looks like <b>{ev._match.customer_name}</b> — already on the board
                </div>
              ) : (
                <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginTop: 4 }}>
                  not on the board yet
                </div>
              )}
              {!ev._match && (
                <div style={{ marginTop: 8 }}>
                  <CustomerPicker compact
                    value={tentCustomer[ev.id] || null}
                    onChange={(id) => setTentCustomer(m => ({ ...m, [ev.id]: id }))}
                    placeholder="Link a client (optional)" />
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={async () => { await ignoreOrphan(ev.id); setTentEvents(p => p.filter(x => x.id !== ev.id)); }}
                  disabled={saving}
                  style={{ flex: 1, background: 'transparent', color: MUTED, border: `1px solid ${LINE}`,
                           borderRadius: 8, padding: '7px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  Dismiss
                </button>
              </div>
              {ev._match ? (
                <button onClick={() => linkHoldToJob(ev)} disabled={saving}
                  style={{ marginTop: 8, width: '100%', background: '#22c55e', color: '#0f1729',
                           border: 'none', borderRadius: 8, padding: '7px 0',
                           fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  Link to {ev._match.customer_name} →
                </button>
              ) : (
                <button onClick={() => makeJob(ev)} disabled={saving}
                  style={{ marginTop: 8, width: '100%', background: '#334155', color: '#cbd5e1',
                           border: 'none', borderRadius: 8, padding: '7px 0',
                           fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  No match — make it a new job → Scheduled
                </button>
              )}
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
        <Lane tourId="wk-watching" label="Watching" hint="Someone else's move — you still need to know"
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
              onAssigned={() => load()}
              onOpenScheduler={() => { setSchedulingJob(openJob); setOpenJob(null); }}
              onMove={async (target, moveNote) => {
                await jobsApi.changeStatus(openJob.id, target, userEmail, moveNote);
                setOpenJob(null);
                await load();
                say('Moved ✓');
              }}
              extras={<MergeTool job={openJob} accessToken={accessToken} userEmail={userEmail}
                        onMerge={() => { setOpenJob(null); load(); }} />}
            />
          </div>
        </div>
      )}

      {schedulingJob && (
        <VisualSchedulerModal
          job={schedulingJob} techs={techs} accessToken={accessToken} userEmail={userEmail}
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
