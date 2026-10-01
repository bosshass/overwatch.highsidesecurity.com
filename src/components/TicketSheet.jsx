// ============================================
// TicketSheet — ONE ticket. One look. Everywhere.
// ============================================
// Opening a ticket looked different in three places because it WAS three
// components: JobDetail (with two internal branches of its own), the board's
// LANE_MOVES panel, and JobFinishSheet in the field. Same job, three layouts,
// three vocabularies for the same five destinations.
//
// Every ticket asks one question: WHERE DOES THIS GO NEXT?
// The only real difference is that some surfaces also capture hours.
//
//   board      → where next
//   my tasks   → where next
//   work today → where next + time in/out
//   billing    → where next + what's billable
//
// So: one panel, one lane picker (from utils/lanes.js), and optional sections.
// Adding a surface means passing a prop, not writing a fourth design.

import ArchiveModal from './ArchiveModal.jsx';
import { reasonLabel } from '../config/archiveReasons.js';
import { useState, useEffect } from 'react';
import { supabase, jobsApi } from '../services/supabase.js';
import { sendGmail, assignmentEmail } from '../services/gmailSend.js';
import { assignmentMessage, APP_BASE } from '../config/appBase.js';
import { PHONE_BY_EMAIL } from '../utils/ownership.js';
import { ASSIGNEES, assigneeOf, EMAIL_BY_NAME, canonicalEmail, NAME_BY_EMAIL } from '../utils/ownership.js';
import { LANES, movesFor, laneOf, isHeld , requiresDisposition } from '../utils/lanes.js';
import { canBill } from '../utils/ownership.js';
import { stripIntakeTemplate } from '../utils/statusMachine.js';
import NotesPanel from './NotesPanel.jsx';
import { releaseCalendar } from '../services/schedule.js';
import { syncIssueToEvents } from '../services/calendarSync.js';
import TextButton, { clientTemplates } from './TextButton.jsx';
import SmsComposer from './SmsComposer.jsx';
import { formatPhone } from '../services/sms.js';
import { shortJobLink } from '../config/appBase.js';
import { needsDisposition, dispositionDueAt } from '../utils/staleness.js';
import FieldVisits from './FieldVisits.jsx';

const C = {
  bg: '#0f1729', panel: '#16233a', raised: '#1b2b45', line: '#2a3b56',
  text: '#e9f1ff', muted: '#93a5bd', dim: '#64748b',
  blue: '#3b82f6', amber: '#f59e0b',
};

const SMS_IN_RE  = /^📲 Text from (.+?) \((\+?[0-9]+)\):\n?([\s\S]*)$/;
const SMS_OUT_RE = /^📱 Texted (.+?) \((\+?[0-9]+)\):\n?([\s\S]*)$/;

// Parse a human-written time string into decimal hours for the scheduler.
// Handles "2h", "2.5h", "2 hours", "90 min", "half day", "full day", bare numbers.
function parseEstHours(s) {
  if (!s) return null;
  const lower = s.toLowerCase().trim();
  if (/half.?day/.test(lower)) return 4;
  if (/full.?day/.test(lower)) return 8;
  const hMatch = lower.match(/^(\d+\.?\d*)\s*h/);
  if (hMatch) return parseFloat(hMatch[1]);
  const mMatch = lower.match(/^(\d+\.?\d*)\s*m/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) / 60 * 10) / 10;
  const numMatch = lower.match(/^(\d+\.?\d*)$/);
  if (numMatch) return parseFloat(numMatch[1]);
  return null;
}
const fmtSmsTime = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const Row = ({ label, children }) => children == null || children === '' ? null : (
  <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 13 }}>
    <span style={{ color: C.muted, minWidth: 110, flexShrink: 0 }}>{label}</span>
    <span style={{ color: C.text, flex: 1, minWidth: 0 }}>{children}</span>
  </div>
);

// Why a job is blocked. Structured tags so the office can scan the board fast;
// free text below for detail. Tag is prepended to the note on move.
const BLOCKED_REASONS = [
  { key: 'pending_payment',    label: 'Pending Payment' },
  { key: 'materials_needed',   label: 'Materials Needed' },
  { key: 'no_access',          label: 'No Access' },
  { key: 'customer_not_ready', label: 'Customer Not Ready' },
  { key: 'waiting_on_sub',     label: 'Waiting on Sub' },
];

export default function TicketSheet({
  job,
  userEmail,
  accessToken,
  onMove,            // (targetStatus, note) => Promise
  onOpenScheduler,   // (mode: 'hold' | 'book') => void
  onClose,
  onAssigned,        // (jobId, email|null) => void — let the parent refresh its list
  onUpdated = null,  // (job) => void — the issue was edited; refresh the list behind
  // Optional sections — the ONLY things that differ between surfaces.
  timeSection = null,     // Work To Do Today passes its time entry block here
  billingSection = null,  // Billing passes its unbilled-hours block here
  headerExtra = null,
  extras = null,          // surface-specific tools (merge, UUID link) — AFTER notes
  onSchedulePrimary = null, // renders the big "Open Scheduler" button when set
  busy = false,
}) {
  const [note, setNote] = useState('');
  const [clearing, setClearing] = useState(false);
  const [pending, setPending] = useState(null);
  // Structured blocked-reason tag. Reset whenever the pending lane changes.
  const [blockedTag, setBlockedTag] = useState(null);
  // Contract capture on the Won step.
  const [askContract, setAskContract] = useState(false);
  const [contractDone, setContractDone] = useState(false);
  const [cAmount, setCAmount] = useState('');
  const [cHours, setCHours] = useState('');
  const [cRef, setCRef] = useState('');
  const [cSaving, setCSaving] = useState(false);

  const saveContract = async (skip) => {
    setCSaving(true);
    if (!skip) {
      const { error } = await supabase.from('jobs').update({
        estimate_amount:  cAmount ? Number(cAmount) : null,
        estimated_hours:  cHours ? Number(cHours) : null,
        qbo_estimate_ref: cRef.trim() || null,
      }).eq('id', job.id);
      if (error) { setCSaving(false); setErr(error.message); return; }
    }
    setCSaving(false);
    setAskContract(false);
    setContractDone(true);
    // Let the move through now that the contract is on the job.
    try {
      await onMove?.('won', note.trim() || null);
      setPending(null); setNote('');
    } catch (e) { setErr(e.message || 'Move failed'); }
  };
  const [err, setErr] = useState('');
  // OWNERSHIP LIVES HERE NOW.
  // 9.11.0 rebuilt every ticket surface around this component but did not bring
  // the assign control with it — BoardView.assignTo survived as a function
  // nobody called. For fifteen versions there has been no way to assign a job
  // from any screen. It lives in the sheet itself (not passed in) so the board,
  // My Tasks and /j/ links cannot drift apart again.
  const [owner, setOwner] = useState(null);   // local echo after a write
  const [saving, setSaving] = useState(false);
  const [notifyAssignee, setNotifyAssignee] = useState(null); // email to offer notify prompt for
  // Spawn-a-task composer. Lives on the job card because that is where the
  // work is described — retyping it into a separate notes screen is how the
  // task ends up saying something different from the job.
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskBody, setTaskBody] = useState('');
  const [taskWho, setTaskWho]   = useState('');
  const [taskMsg, setTaskMsg]   = useState('');
  const [taskNext, setTaskNext] = useState('');   // handoff_to
  const [openTasks, setOpenTasks] = useState([]); // tasks already live on this job
  const [taskRefreshTick, setTaskRefreshTick] = useState(0);
  const [tasksOpen, setTasksOpen] = useState(true);

  // ── Calendar event start (for appointment-time in client text templates) ────
  // Only fetched for jobs that have a scheduled calendar event; not on every
  // card open. Null = no event or still loading; templates fall back to date-only.
  const [eventStart, setEventStart] = useState(null);
  useEffect(() => {
    const eventId = job?.scheduled_event_id || job?.calendar_event_id;
    const calId   = job?.scheduled_calendar_id;
    if (!accessToken || !eventId || !calId) return;
    let dead = false;
    fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then(r => r.ok ? r.json() : null)
      .then(ev => { if (!dead && ev?.start?.dateTime) setEventStart(ev.start.dateTime); })
      .catch(() => {});
    return () => { dead = true; };
  }, [job?.id, job?.scheduled_event_id, job?.calendar_event_id]);
  // ── Editing the issue ────────────────────────────────────────────────
  const [issueEdit, setIssueEdit]     = useState(false);
  const [issueText, setIssueText]     = useState('');
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueMsg, setIssueMsg]       = useState('');
  // The saved value, so the box reflects the edit without waiting for the
  // parent to refetch. Null until something is saved here.
  const [issueLocal, setIssueLocal]   = useState(null);
  const [showMoves, setShowMoves] = useState(false);

  // "Make a Note" — writes to the notes table with assigned_to=null.
  // Invisible on the job card (TicketSheet filters to assigned_to != null).
  // Visible in CustomerHistory (queries all notes by customer_id).
  const [internalNoteOpen, setInternalNoteOpen]   = useState(false);
  const [internalNoteText, setInternalNoteText]   = useState('');
  const [internalNoteSaving, setInternalNoteSaving] = useState(false);
  const [internalNoteMsg, setInternalNoteMsg]     = useState('');

  // Inline editing of the on-site contact name and phone.
  const [siteEdit, setSiteEdit]             = useState(false);
  const [siteContactName, setSiteContactName] = useState('');
  const [siteContactPhone, setSiteContactPhone] = useState('');
  const [siteSaving, setSiteSaving]         = useState(false);
  const [siteMsg, setSiteMsg]               = useState('');
  const [siteLocalName, setSiteLocalName]   = useState(null);
  const [siteLocalPhone, setSiteLocalPhone] = useState(null);

  // ── Return-trip plan (return_cards) ─────────────────────────────────
  // Fetched and shown prominently when status is return_pending so the tech
  // knows WHAT to do on the next trip, not just that one is needed.
  const [returnCard, setReturnCard]       = useState(null);
  const [rcEdit, setRcEdit]               = useState(false);
  const [rcReason, setRcReason]           = useState('');
  const [rcMaterials, setRcMaterials]     = useState('');
  const [rcEstTime, setRcEstTime]         = useState('');
  const [rcSaving, setRcSaving]           = useState(false);
  const [rcMsg, setRcMsg]                 = useState('');

  // Fetch the return_card for this job — shown prominently so the tech knows
  // what to do on this trip before reading the original scope. Loaded whenever
  // the card is open (not just return_pending) so the brief stays visible after
  // the job is re-scheduled for the return visit.
  useEffect(() => {
    let dead = false;
    (async () => {
      let rc = null;
      // Path 1: event ids that JobFinishSheet wrote as original_event_id.
      const eventIds = [job?.scheduled_event_id, job?.calendar_event_id, job?.tentative_event_id].filter(Boolean);
      if (eventIds.length) {
        const { data } = await supabase.from('return_cards')
          .select('id, reason, materials_needed, estimated_time')
          .in('original_event_id', eventIds)
          .order('created_at', { ascending: false }).limit(1);
        rc = data?.[0] || null;
      }
      // Path 2: time_entries with disposition='return' linked to this job.
      if (!rc && job?.id) {
        const { data: entries } = await supabase.from('time_entries')
          .select('id').eq('job_id', job.id).eq('disposition', 'return');
        const ids = (entries || []).map(e => e.id);
        if (ids.length) {
          const { data } = await supabase.from('return_cards')
            .select('id, reason, materials_needed, estimated_time')
            .in('time_entry_id', ids)
            .order('created_at', { ascending: false }).limit(1);
          rc = data?.[0] || null;
        }
      }
      // Path 3: customer_id fallback — handles the case where the job's event IDs
      // changed after re-scheduling (original_event_id no longer matches any
      // current event on the job row).
      if (!rc && job?.customer_id) {
        const { data } = await supabase.from('return_cards')
          .select('id, reason, materials_needed, estimated_time')
          .eq('customer_id', job.customer_id)
          .order('created_at', { ascending: false }).limit(1);
        rc = data?.[0] || null;
      }
      if (!dead) setReturnCard(rc);
    })();
    return () => { dead = true; };
  }, [job?.id, job?.status, job?.scheduled_event_id, job?.calendar_event_id, job?.tentative_event_id]);

  const saveReturnCard = async () => {
    setRcSaving(true); setRcMsg('');
    try {
      if (returnCard?.id) {
        const { error } = await supabase.from('return_cards')
          .update({ reason: rcReason.trim() || null, materials_needed: rcMaterials.trim() || null, estimated_time: rcEstTime.trim() || null })
          .eq('id', returnCard.id);
        if (error) throw error;
        setReturnCard(rc => ({ ...rc, reason: rcReason.trim() || null, materials_needed: rcMaterials.trim() || null, estimated_time: rcEstTime.trim() || null }));
      } else {
        const eventId = job.scheduled_event_id || job.calendar_event_id || job.tentative_event_id;
        const { data, error } = await supabase.from('return_cards').insert({
          customer_id:          job.customer_id || null,
          customer_name_raw:    job.customer_name || null,
          original_event_id:    eventId || null,
          original_calendar_id: job.scheduled_calendar_id || null,
          original_event_title: job.customer_name || null,
          original_location:    job.customer_address || null,
          reason:               rcReason.trim() || null,
          materials_needed:     rcMaterials.trim() || null,
          estimated_time:       rcEstTime.trim() || null,
          flagged_by_email:     userEmail || null,
          time_entry_id:        null,
        }).select('id, reason, materials_needed, estimated_time').single();
        if (error) throw error;
        setReturnCard(data);
      }
      setRcEdit(false);
      setRcMsg('Saved');
    } catch (e) { setRcMsg(e.message || 'Could not save'); }
    finally { setRcSaving(false); }
  };

  // WHAT IS ALREADY OUT THERE. Without this the card happily lets you send a
  // third copy of the same ask to a third person, and none of them know about
  // each other.
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!job?.id) return;
      // lane 'done' IS INCLUDED NOW. It used to be filtered out on the grounds
      // that nobody is actively working it — true, but "Shana finished this and
      // is waiting on you to confirm" is precisely what the card was supposed
      // to tell you, and excluding it made the task vanish from the job at the
      // one moment somebody had to act on it. The lane is rendered instead, so
      // "on it" and "says done" read differently rather than one disappearing.
      const { data } = await supabase.from('notes')
        .select('id, body, assigned_to, assigned_by, lane, handoff_to, created_at, done_at, done_by')
        .eq('job_id', job.id).eq('status', 'open')
        .not('assigned_to', 'is', null)
        .neq('lane', 'done')
        .order('created_at', { ascending: false });
      if (!dead) setOpenTasks(data || []);
    })();
    return () => { dead = true; };
  }, [job?.id, taskMsg, taskRefreshTick]);

  // ── SMS thread for this customer's phone ─────────────────────────────────
  const [smsMessages,    setSmsMessages]    = useState(null);
  const [smsUnread,      setSmsUnread]      = useState(0);
  const [smsTick,        setSmsTick]        = useState(0);
  const [smsOpen,        setSmsOpen]        = useState(false);
  const [smsReplyPhone,  setSmsReplyPhone]  = useState(null);
  const [sms,            setSms]            = useState(null);

  // Refresh unread count when another surface (MessagesView) marks texts read
  useEffect(() => {
    const refresh = () => setSmsTick(t => t + 1);
    window.addEventListener('task-skips-changed', refresh);
    return () => window.removeEventListener('task-skips-changed', refresh);
  }, []);
  useEffect(() => {
    if (!job?.id) { setSmsMessages([]); return; }
    const phone = job?.customer_phone ? formatPhone(job.customer_phone) : null;
    const sitePhone = job?.site_contact_phone ? formatPhone(job.site_contact_phone) : null;
    const hasPhone = phone && /^\+\d{10,15}$/.test(phone);
    let dead = false;
    (async () => {
      let q = supabase.from('notes')
        .select('id, body, created_at, read_at, status')
        .order('created_at', { ascending: true })
        .limit(50);
      if (hasPhone) {
        q = q.like('body', `%${phone}%`);
      } else if (sitePhone && /^\+\d{10,15}$/.test(sitePhone)) {
        q = q.like('body', `%${sitePhone}%`);
      } else {
        // No phone on the job — fetch all notes for this job and let the regex
        // filter client-side. Using .or() with emoji in the filter string is
        // unreliable; client-side filtering is simpler and safe at this scale.
        q = q.eq('job_id', job.id);
      }
      const { data } = await q;
      if (dead) return;
      const msgs = (data || []).flatMap(n => {
        const inb = SMS_IN_RE.exec(n.body);
        if (inb) return [{ id: n.id, dir: 'in', phone: inb[2], text: inb[3].trim(), at: n.created_at, unread: !n.read_at && n.status === 'open' }];
        const out = SMS_OUT_RE.exec(n.body);
        if (out) return [{ id: n.id, dir: 'out', phone: out[2], text: out[3].trim(), at: n.created_at }];
        return [];
      });
      setSmsMessages(msgs);
      setSmsUnread(msgs.filter(m => m.unread).length);
      // Best phone for Reply: job fields first, then any E.164 number found in
      // the message bodies (with or without + prefix), then parsed message phones.
      const bodyPhone = (data || []).flatMap(n => {
        const m = /\((\+?[0-9]{10,15})\)/.exec(n.body);
        return m ? [m[1]] : [];
      }).find(p => /^\+?\d{10,15}$/.test(p)) || null;
      const msgPhone = msgs.slice().reverse().find(m => m.phone)?.phone || null;
      setSmsReplyPhone(job.customer_phone || job.site_contact_phone || bodyPhone || msgPhone);
    })();
    return () => { dead = true; };
  }, [job?.id, job?.customer_phone, job?.site_contact_phone, smsTick]);

  if (!job) return null;

  const here = laneOf(job);
  // Billing's move is billing's to offer. Everyone else can still send the
  // card to them — that is BILLING_LANE, "Done — To Bill", and it stays.
  const moves = movesFor(job, { mayBill: canBill(userEmail) });
  // Opened from the home screen's No Disposition list, this is the whole
  // reason the card is in front of you. Say so at the top instead of making
  // someone infer it from a status chip.
  const awaitingDispo = needsDisposition(job);
  const dispoDue = awaitingDispo ? dispositionDueAt(job.scheduled_date) : null;
  // JobDetail always stripped the intake form's fixed header ("Name: Phone:
  // ... Scope of Work:") before showing the issue text — TicketSheet never
  // picked that up when it replaced JobDetail on every surface tonight, so
  // any job whose scope was never filled in past the template shows the raw
  // boilerplate verbatim. Same rule here: if nothing real was written after
  // "Scope of Work:", there is nothing to show, and the box doesn't render.
  const cleanIssue = issueLocal !== null ? issueLocal : stripIntakeTemplate(job.issue);
  const displaySiteName  = siteLocalName  !== null ? siteLocalName  : (job.site_contact_name  || '');
  const displaySitePhone = siteLocalPhone !== null ? siteLocalPhone : (job.site_contact_phone || '');

  // ONE rule for who owns this, from ownership.js. The board card used to read
  // job.tech_name directly, which is why assigning somebody left the card
  // reading "Unassigned" — the write went to assigned_to and the card was
  // looking at a different column.
  const ownerName = owner === '\u0000' ? null : (owner || assigneeOf(job));
  const ownerEmail = ownerName ? EMAIL_BY_NAME[ownerName.toLowerCase()] || null : null;

  // WRITES assigned_to (migration 030) — the real column. It does NOT touch
  // tech_name: that field means "who was physically on site", and overwriting
  // it to record an office assignment is how the two meanings got tangled.
  // Spawn a task off this job. The note carries job_id, so the task can link
  // straight back to the card and Sara can move the job to Estimate Sent from
  // the same place she reads that JR finished writing it. assigned_by is what
  // brings it home when the assignee marks it done.
  const createTask = async () => {
    const body = taskBody.trim();
    // taskWho is the in-composer pick; ownerEmail is the job's current assignee.
    // taskWho wins when set (explicit choice); ownerEmail is the pre-selected default.
    const who = taskWho || ownerEmail;
    if (!body || !who) return;
    setSaving(true); setTaskMsg('');
    try {
      const meEmail = canonicalEmail(userEmail);
      const { error } = await supabase.from('notes').insert({
        body,
        job_id: job.id,
        customer_id: job.customer_id || null,
        author_email: meEmail,
        assigned_to: who,
        assigned_by: meEmail,
        handoff_to: taskNext || null,
        lane: 'todo',
        status: 'open',
      });
      if (error) throw error;
      // CLOSE THE SHEET. It used to collapse back to exactly the state you were
      // in before, with a grey line of confirmation text under a purple button
      // — so the only evidence anything happened was easy to miss, and the
      // obvious read was that the button had done nothing.
      setTaskBody(''); setTaskWho(''); setTaskNext(''); setTaskOpen(false);
      const name = ASSIGNEES.find(a => a.email === who)?.name || who;

      // TELL THEM. Assigning a JOB has emailed the assignee since 9.x; creating
      // a TASK wrote the row and told nobody, so the only way to discover work
      // had landed on you was to go looking for it. Same channel, same OAuth
      // token already in scope — no Twilio, no server, nothing to configure.
      if (accessToken && who) {
        const fromName = NAME_BY_EMAIL[canonicalEmail(userEmail)] || 'Overwatch';
        const nextName = taskNext
          ? (ASSIGNEES.find(a => a.email === taskNext)?.name || taskNext) : null;
        sendGmail(accessToken, {
          to: who,
          subject: `[Overwatch] ${fromName} needs something: ${job.customer_name || 'a job'}`,
          body: [
            body,
            '',
            `Customer: ${job.customer_name || '—'}`,
            job.customer_address ? `Address: ${job.customer_address}` : null,
            nextName ? `When you finish, it goes to ${nextName}.` : null,
            '',
            'Open your tasks in Overwatch:',
            `${APP_BASE}/tasks`,
          ].filter(Boolean).join('\n'),
        }).catch(() => {});   // never block the write on a notification
      }

      setTaskMsg(`Task sent to ${name}.`);
      setTimeout(() => { try { onClose?.(); } catch (_) {} }, 650);
    } catch (e) { setTaskMsg(e.message || String(e)); }
    setSaving(false);
  };

  const markTaskDone = async (taskId) => {
    try {
      await supabase.from('notes').update({
        lane: 'done',
        done_at: new Date().toISOString(),
        done_by: canonicalEmail(userEmail),
      }).eq('id', taskId);
      setTaskRefreshTick(t => t + 1);
    } catch (e) { console.warn('markTaskDone failed:', e?.message || e); }
  };

  const assign = async (email) => {
    setErr(''); setSaving(true); setNotifyAssignee(null);
    try {
      const { error } = await supabase.from('jobs')
        .update({ assigned_to: email, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      if (error) throw error;
      setOwner(email ? (ASSIGNEES.find(a => a.email === email)?.name || email) : '\u0000');
      onAssigned?.(job.id, email);
      if (email) setNotifyAssignee(email);
    } catch (e) { setErr(e.message || 'Could not assign'); }
    finally { setSaving(false); }
  };

  // What a STAFF text says before she edits it.
  //
  // NOT the raw task body. These bodies are machine-composed and several still
  // carry the old intake template inline ("Name: ... Phone: ... On-Site
  // Contact:"), which is not something to send a person. The LAST paragraph is
  // the most recent thing anybody added — a reply, a question, the actual ask —
  // so that leads, under the customer's name, with a short link so the
  // recipient can open the card instead of texting back to ask what it is about.
  const draftForTask = (t) => {
    const paras = String(t.body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    let ask = paras.length ? paras[paras.length - 1] : '';
    ask = ask.replace(/^—\s*/, '');
    if (ask.length > 220) ask = ask.slice(0, 218).trimEnd() + '…';
    const who = job.customer_name || 'this job';
    return [`${who} — ${ask}`.trim(), '', shortJobLink(job.id)].join('\n');
  };

  const textTask = (t) => {
    const phone = PHONE_BY_EMAIL[canonicalEmail(t.assigned_to)] || null;
    const name  = ASSIGNEES.find(a => a.email === t.assigned_to)?.name || t.assigned_to;
    if (sms?.key === `task:${t.id}`) { setSms(null); return; }
    setSms({ key: `task:${t.id}`, to: phone, name, internal: true, draft: draftForTask(t) });
  };

  // fetchEventStart: on-demand fetch for appointment time (eventStart state is
  // declared above via main's useEffect which auto-populates it). This fallback
  // is only used by textClient when the auto-fetch hasn't resolved yet.
  const fetchEventStart = async () => {
    const eventId = job.scheduled_event_id || job.calendar_event_id;
    const calId   = job.scheduled_calendar_id;
    if (!accessToken || !eventId || !calId) return null;
    try {
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) return null;
      const ev = await r.json();
      return ev?.start?.dateTime || null;
    } catch { return null; }
  };

  // Two numbers can be on a card and they are different people: the account
  // holder, and whoever the tech actually meets on site (migration 047).
  const textClient = async (which) => {
    const isSite = which === 'site';
    const to   = isSite ? displaySitePhone : job.customer_phone;
    const name = isSite
      ? (displaySiteName || 'the on-site contact')
      : (job.customer_name || 'the client');
    if (sms?.key === `client:${which}`) { setSms(null); return; }
    const when = eventStart ?? await fetchEventStart();
    if (when && !eventStart) setEventStart(when);
    setSms({ key: `client:${which}`, to, name, internal: false, draft: '',
             templates: clientTemplates({ when, scheduledDate: job.scheduled_date }) });
  };

  // Save the issue, then mirror it to the calendar.
  //
  // ORDER MATTERS AND IS NOT NEGOTIABLE. The database write happens first and
  // its failure is the only failure that can lose the edit. The calendar patch
  // is best-effort after the fact: Google being slow, the token being stale,
  // or the event having been deleted must never throw away what someone just
  // typed. When the mirror does not land, the message says so rather than
  // reporting a clean save — an issue that is right in Overwatch and stale on
  // the tech's phone is exactly the kind of quiet disagreement this app keeps
  // being bitten by.
  const saveIssue = async () => {
    const next = issueText.trim();
    setIssueSaving(true);
    setIssueMsg('');
    try {
      await jobsApi.update(job.id, { issue: next || null }, userEmail);
      setIssueLocal(next);
      setIssueEdit(false);
      onUpdated?.({ ...job, issue: next || null });

      const hasEvent = job.scheduled_event_id || job.calendar_event_id || job.tentative_event_id;
      if (!hasEvent) {
        setIssueMsg('Saved. Not on a calendar yet — it will carry over when this is scheduled.');
      } else if (!accessToken) {
        setIssueMsg('⚠ Saved here, but not signed in to Google — the calendar event still shows the old text.');
      } else {
        // Guard against firing calendar API calls with a known-expired token.
        // A 401 from inside syncIssueToEvents triggers the app's interceptor,
        // which shows the silent-refresh popup once per failing request —
        // multiple events → multiple flashes → reconnect overlay mid-edit.
        // Checking the stored expiry prevents that: if the token is already
        // past its lifetime we show the warning without ever touching Google.
        const expStr = localStorage.getItem('juce_v4_token_expiry');
        const tokenFresh = expStr ? new Date(expStr).getTime() > Date.now() + 30_000 : true;
        if (!tokenFresh) {
          setIssueMsg('⚠ Saved here, but your Google session has expired — sign back in to sync the calendar event.');
        } else {
          const r = await syncIssueToEvents(accessToken, job, next);
          setIssueMsg(r.patched > 0
            ? `Saved · calendar updated (${r.patched} event${r.patched === 1 ? '' : 's'})`
            : '⚠ Saved here, but the calendar event could not be updated.');
        }
      }
    } catch (e) {
      setIssueMsg(`⚠ Could not save: ${e.message || e}`);
    } finally {
      setIssueSaving(false);
    }
  };

  const saveSiteContact = async () => {
    setSiteSaving(true);
    setSiteMsg('');
    try {
      await jobsApi.update(job.id, {
        site_contact_name:  siteContactName.trim() || null,
        site_contact_phone: siteContactPhone.trim() || null,
      }, userEmail);
      const savedName  = siteContactName.trim() || null;
      const savedPhone = siteContactPhone.trim() || null;
      setSiteLocalName(savedName);
      setSiteLocalPhone(savedPhone);
      setSiteEdit(false);
      onUpdated?.({ ...job, site_contact_name: savedName, site_contact_phone: savedPhone });
      setSiteMsg('Saved.');
      setTimeout(() => setSiteMsg(''), 2500);
    } catch (e) {
      setSiteMsg(`⚠ Could not save: ${e.message || e}`);
    } finally {
      setSiteSaving(false);
    }
  };

  const saveInternalNote = async () => {
    const body = internalNoteText.trim();
    if (!body) return;
    setInternalNoteSaving(true); setInternalNoteMsg('');
    try {
      const { error } = await supabase.from('notes').insert({
        body,
        job_id: job.id,
        customer_id: job.customer_id || null,
        author_email: canonicalEmail(userEmail),
        assigned_to: null,
        lane: 'todo',
        status: 'open',
      });
      if (error) throw error;
      setInternalNoteText(''); setInternalNoteOpen(false);
      setInternalNoteMsg('Saved — visible in client search, not on this card.');
      setTimeout(() => setInternalNoteMsg(''), 3500);
    } catch (e) {
      setInternalNoteMsg(`⚠ ${e.message || e}`);
    } finally {
      setInternalNoteSaving(false);
    }
  };

  const choose = async (lane) => {
    setErr('');
    // Tentative and Scheduled both need a DATE, so they hand off to the
    // scheduler rather than writing a status. A job cannot claim to be held or
    // booked without one — that is exactly how nine jobs ended up "scheduled"
    // with no date, no tech and no calendar event.
    if (lane.needsScheduler) {
      onOpenScheduler?.(lane.needsScheduler);
      return;
    }
    if (pending?.key !== lane.key) { setPending(lane); setBlockedTag(null); setNote(''); return; }

    // WON IS WHERE A CONTRACT IS BORN.
    // Nothing in the app ever wrote estimate_amount, so no job knew it was
    // fixed fee — and Billing kept offering Jeanneret's 28 hours hourly
    // against a $19,420 contract they were already sold under. The moment
    // somebody says the estimate came back accepted is the moment the number
    // is known and the only moment anyone will type it.
    if ((lane.target || lane.key) === 'won' && !contractDone) {
      setAskContract(true);
      return;
    }
    // Clearing committed work needs a reason, not a second tap. Identical to
    // the Billing screen's clear-instead-of-invoice path — see lanes.js.
    if ((lane.target || lane.key) === 'archived' && requiresDisposition(job)) {
      setClearing(true);
      return;
    }
    // A destination with no target is a BUG, not a no-op. It used to sail
    // straight through to changeStatus(id, undefined), which wrote nothing and
    // reported success. Say so instead of pretending the move happened.
    const target = lane.target || lane.key;
    if (!target) { setErr(`"${lane.label}" has no destination — tell Sara.`); return; }
    // BLOCKED IS THE ONE STATE THAT CARRIES A REASON. Its own definition says
    // so — "cannot move until something outside us changes — say what." A card
    // parked in Blocked with no reason is indistinguishable from a card
    // somebody forgot, which is the exact confusion the lane exists to end,
    // and nobody remembers in three weeks why the GC was waiting.
    if (target === 'blocked' && !note.trim()) {
      setErr('Say what is blocking it — that is the whole point of this lane.');
      return;
    }
    // A JOB WITHOUT A CUSTOMER IS NOT A JOB. Notes get filed against nobody all
    // the time and that is fine — a note is a thought. The moment it becomes
    // real work somebody has to drive to, it needs an address to drive to, and
    // promoting it silently is how a card ends up on the board that cannot be
    // scheduled, billed, or found by customer.
    if (target === 'ready_to_schedule' && !job.customer_id && !job.customer_name) {
      setErr('This needs a customer before it can be a job — add one above, or file it as a task instead.');
      return;
    }
    try {
      // For Blocked, prepend the structured tag to the free text so the audit log
      // and board card both carry a scannable reason without requiring a separate column.
      const tagLabel = pending.key === 'blocked' && blockedTag
        ? BLOCKED_REASONS.find(r => r.key === blockedTag)?.label
        : null;
      const finalNote = [tagLabel, note.trim()].filter(Boolean).join(' — ') || null;
      await onMove?.(target, finalNote);
      // The job is over — take its event off the tech calendar. Non-fatal: a
      // failed delete must not unwind a status move that already succeeded,
      // and the job row is the record either way.
      if (['billed', 'archived', 'dead', 'lost'].includes(target)) {
        try { await releaseCalendar({ job, accessToken }); }
        catch (e) { console.warn('calendar release failed (non-fatal)', e.message); }
      }
      setPending(null); setNote(''); setBlockedTag(null);
    } catch (e) { setErr(e.message || 'Move failed'); }
  };

  const commitClear = async (reason) => {
    try {
      await onMove?.('archived', `${reasonLabel(reason)}${note.trim() ? ' — ' + note.trim() : ''}`, reason);
      setClearing(false); setPending(null); setNote('');
    } catch (e) { setErr(e.message || 'Move failed'); }
  };

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100%',
                  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif' }}>

      {clearing && (
        <ArchiveModal count={1} hours={null}
          onCancel={() => { setClearing(false); setPending(null); }}
          onConfirm={commitClear} />
      )}

      {/* ── Header ── */}
      <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.line}`,
                    position: 'sticky', top: 0, background: C.bg, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {here && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                            background: `${here.color}1f`, color: here.color, borderRadius: 20,
                            padding: '3px 10px', fontSize: 11, fontWeight: 800, marginBottom: 8 }}>
                {here.icon} {here.label}
              </div>
            )}
            <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15 }}>
              {job.customer_name || 'Unnamed'}
            </div>
            {isHeld(job) && (
              <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, marginTop: 5 }}>
                ✏️ Held {new Date(job.tentative_date).toLocaleDateString('en-US',
                  { weekday: 'short', month: 'short', day: 'numeric' })} — nobody booked
              </div>
            )}
          </div>
          {onClose && (
            <button onClick={onClose}
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22,
                       cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
          )}
        </div>
        {headerExtra}
      </div>

      <div style={{ padding: '14px 18px 28px' }}>

        {/* ── Facts ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: '6px 14px', marginBottom: 14 }}>
          <Row label="Type">{job.job_type || 'service'}</Row>
          <Row label="Address">{job.customer_address}</Row>
          <Row label="Phone">
            {job.customer_phone}
            <TextButton to={job.customer_phone} name={job.customer_name || 'client'}
              internal={false} accessToken={accessToken} size="sm"
              templates={clientTemplates({ when: eventStart, scheduledDate: job.scheduled_date })}
              logTo={{ jobId: job.id, customerId: job.customer_id, userEmail }}
              style={{ marginLeft: 9 }}
              onSent={() => {
                const phone = formatPhone(job.customer_phone);
                if (phone) {
                  supabase.from('notes').update({ read_at: new Date().toISOString(), read_by: userEmail })
                    .is('read_at', null).eq('status', 'open')
                    .like('body', `📲 Text from%`).like('body', `%${phone}%`)
                    .then(() => window.dispatchEvent(new Event('task-skips-changed')));
                }
                setSmsTick(t => t + 1);
              }}
            />
          </Row>
          {siteEdit ? (
            <div style={{ padding: '7px 0' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ color: C.muted, minWidth: 110, flexShrink: 0, fontSize: 13, paddingTop: 7 }}>On site</span>
                <div style={{ flex: 1 }}>
                  <input value={siteContactName} onChange={e => setSiteContactName(e.target.value)}
                    placeholder="Contact name (optional)"
                    style={{ width: '100%', boxSizing: 'border-box', background: '#0f1729',
                             border: `1px solid ${C.line}`, borderRadius: 6, color: C.text,
                             padding: '6px 9px', fontSize: 13, fontFamily: 'inherit',
                             outline: 'none', marginBottom: 5 }} />
                  <input value={siteContactPhone} onChange={e => setSiteContactPhone(e.target.value)}
                    placeholder="Phone number" type="tel"
                    style={{ width: '100%', boxSizing: 'border-box', background: '#0f1729',
                             border: `1px solid ${C.line}`, borderRadius: 6, color: C.text,
                             padding: '6px 9px', fontSize: 13, fontFamily: 'inherit',
                             outline: 'none' }} />
                  <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
                    <button onClick={saveSiteContact} disabled={siteSaving}
                      style={{ flex: 2, background: C.blue, border: 'none', borderRadius: 7,
                               padding: '7px 0', color: '#04121f', fontSize: 12.5, fontWeight: 800,
                               cursor: siteSaving ? 'default' : 'pointer', fontFamily: 'inherit',
                               opacity: siteSaving ? 0.6 : 1 }}>
                      {siteSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => { setSiteEdit(false); setSiteMsg(''); }} disabled={siteSaving}
                      style={{ flex: 1, background: 'transparent', border: `1px solid ${C.line}`,
                               borderRadius: 7, padding: '7px 0', color: C.muted, fontSize: 12.5,
                               fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                  </div>
                  {siteMsg && (
                    <div style={{ fontSize: 12, color: siteMsg.startsWith('⚠') ? C.amber : C.muted, marginTop: 6 }}>
                      {siteMsg}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 13, alignItems: 'center' }}>
              <span style={{ color: C.muted, minWidth: 110, flexShrink: 0 }}>On site</span>
              <span style={{ color: C.text, flex: 1, minWidth: 0 }}>
                {displaySitePhone ? (
                  <>
                    {displaySiteName || 'contact'} · {displaySitePhone}
                    <button onClick={() => textClient('site')}
                      style={{ marginLeft: 9, background: sms?.key === 'client:site' ? '#9b6cff' : 'transparent',
                               border: '1px solid #9b6cff66', borderRadius: 7,
                               color: sms?.key === 'client:site' ? '#08121f' : '#c4a6ff',
                               fontSize: 11.5, fontWeight: 800, padding: '4px 10px',
                               cursor: 'pointer', fontFamily: 'inherit' }}>
                      📱 Text
                    </button>
                  </>
                ) : (
                  <span style={{ color: C.dim }}>—</span>
                )}
              </span>
              <button
                onClick={() => { setSiteEdit(true); setSiteContactName(displaySiteName); setSiteContactPhone(displaySitePhone); setSiteMsg(''); }}
                style={{ background: 'transparent', border: 'none', color: C.blue,
                         fontSize: 12, fontWeight: 800, cursor: 'pointer',
                         fontFamily: 'inherit', padding: 0, flexShrink: 0 }}>
                {displaySitePhone ? 'Edit' : 'Add'}
              </button>
            </div>
          )}
          {sms?.key?.startsWith('client:') && (
            <div style={{ padding: '4px 0 10px' }}>
              <SmsComposer
                key={sms.key}
                to={sms.to} name={sms.name} internal={sms.internal}
                draft={sms.draft} templates={sms.templates} accessToken={accessToken}
                logTo={{ jobId: job.id, customerId: job.customer_id, userEmail }}
                onSent={() => setTimeout(() => setSms(null), 2600)}
                onCancel={() => setSms(null)}
              />
            </div>
          )}
          <Row label="Tech on site">{job.tech_name}</Row>{/* physical presence, NOT ownership — see the Assigned to block */}
          <Row label="Scheduled">{job.scheduled_date
            ? new Date(job.scheduled_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : null}</Row>
          <Row label="CMS">{job.cms_account_id}</Row>
        </div>

        {/* ── SMS thread — conversation with this customer ──────────── */}
        {smsMessages !== null && (smsMessages.length > 0 || smsReplyPhone) && (() => {
          const replyPhone = smsReplyPhone;
          const onSent = () => {
            const phone = replyPhone ? formatPhone(replyPhone) : null;
            if (phone) {
              supabase.from('notes').update({ read_at: new Date().toISOString(), read_by: userEmail })
                .is('read_at', null).eq('status', 'open')
                .like('body', `📲 Text from%`).like('body', `%${phone}%`)
                .then(() => window.dispatchEvent(new Event('task-skips-changed')));
            }
            setSmsTick(t => t + 1);
          };
          return (
          <div style={{ background: C.panel, borderRadius: 12, marginBottom: 14,
                        border: smsUnread > 0 ? '1px solid #14b8a644' : 'none' }}>
            {/* Header — always shows reply button; tap label area to expand/collapse */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
              <button onClick={() => setSmsOpen(o => !o)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                         background: 'none', border: 'none',
                         cursor: smsMessages.length > 0 ? 'pointer' : 'default',
                         textAlign: 'left', fontFamily: 'inherit', padding: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b',
                               textTransform: 'uppercase', letterSpacing: 0.7 }}>
                  💬 Messages {smsMessages.length > 0 ? `(${smsMessages.length})` : ''}
                </span>
                {smsUnread > 0 && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%',
                                 background: '#14b8a6', display: 'inline-block', flexShrink: 0 }} />
                )}
                {smsMessages.length > 0 && (
                  <span style={{ color: '#475569', fontSize: 14 }}>
                    {smsOpen ? '▾' : '▸'}
                  </span>
                )}
              </button>
              {replyPhone && (
                <TextButton
                  to={replyPhone} name={job.customer_name || 'client'}
                  internal={false} accessToken={accessToken} size="sm"
                  logTo={{ jobId: job.id, customerId: job.customer_id, userEmail }}
                  label="↩ Reply"
                  style={{ background: '#9b6cff', border: 'none', color: '#08121f',
                           padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: 800,
                           flexShrink: 0 }}
                  onSent={onSent}
                />
              )}
            </div>

            {smsOpen && smsMessages.length > 0 && (
              <div style={{ padding: '0 14px 14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {smsMessages.slice(-8).map(msg => (
                    <div key={msg.id}
                      style={{ display: 'flex', flexDirection: 'column',
                               alignItems: msg.dir === 'out' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '85%',
                        background: msg.dir === 'out' ? '#1e3a5f' : (msg.unread ? '#0d2a1e' : '#1a232e'),
                        borderRadius: msg.dir === 'out' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                        padding: '8px 11px', fontSize: 13, lineHeight: 1.45,
                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                        border: `1px solid ${msg.dir === 'out' ? '#2d5a8e' : (msg.unread ? '#14b8a6' : '#2a3b56')}`,
                      }}>
                        {msg.text || '(no text)'}
                      </div>
                      <div style={{ fontSize: 10.5, color: C.dim, marginTop: 2 }}>
                        {fmtSmsTime(msg.at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* ── Assigned to ───────────────────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b',
                        textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>
            Assigned to
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {ASSIGNEES.map(a => {
              const active = (ownerName === a.name) || (!ownerName && assigneeOf(job) === a.name);
              return (
                <button key={a.email}
                  onClick={() => assign(active ? null : a.email)}
                  disabled={saving}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                    background: active ? '#00c8e8' : 'transparent',
                    color: active ? '#07111f' : '#94a3b8',
                    border: `1px solid ${active ? '#00c8e8' : '#334155'}`,
                    transition: 'all 0.15s',
                  }}>
                  {a.name}
                </button>
              );
            })}
          </div>
          {notifyAssignee && (() => {
            const a = ASSIGNEES.find(x => x.email === notifyAssignee);
            const name = a?.name || notifyAssignee;
            const phone = PHONE_BY_EMAIL[canonicalEmail(notifyAssignee)] || null;
            return (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Notify {name}?</span>
                <TextButton
                  to={phone} name={name} internal={true}
                  accessToken={accessToken}
                  draft={`${job.customer_name || 'Job'} — assigned to you.\n\n${shortJobLink(job.id)}`}
                  logTo={{ jobId: job.id, customerId: job.customer_id, userEmail }}
                  label="Text" size="sm"
                  onOpen={() => setNotifyAssignee(null)}
                  style={{ background: 'transparent', border: '1px solid #334155',
                           color: '#94a3b8', padding: '3px 10px', borderRadius: 12, fontSize: 11 }}
                />
                {accessToken && (
                  <button onClick={() => {
                    const { subject, body } = assignmentEmail(name, job);
                    sendGmail(accessToken, { to: notifyAssignee, subject, body }).catch(() => {});
                    setNotifyAssignee(null);
                  }} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11,
                               cursor: 'pointer', fontFamily: 'inherit',
                               background: 'transparent', border: '1px solid #334155', color: '#94a3b8' }}>
                    Email
                  </button>
                )}
                <button onClick={() => setNotifyAssignee(null)} style={{ padding: '3px 8px', borderRadius: 12,
                           fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                           background: 'transparent', border: 'none', color: '#475569' }}>
                  Skip
                </button>
              </div>
            );
          })()}
        </div>

        {/* ── Return trip brief — THIS VISIT ONLY ─────────────────────
            The Issue panel below is why we first went. This panel is why we
            are coming back. Shown FIRST so the tech reads the brief for
            today's trip before reading the original scope. Editable so the
            office can fill it in when the tech left it blank on the finish
            sheet. Data lives in return_cards.reason / materials_needed. */}
        {(job.status === 'return_pending' || (returnCard?.reason || returnCard?.materials_needed)) && (
          <div style={{ background: 'rgba(249,115,22,0.1)',
                        border: '1px solid rgba(249,115,22,0.4)',
                        borderLeft: '4px solid #fb923c',
                        borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: rcEdit ? 8 : (returnCard?.reason || returnCard?.materials_needed ? 6 : 0) }}>
              <span style={{ fontSize: 10, fontWeight: 900, color: '#fb923c',
                             textTransform: 'uppercase', letterSpacing: 0.7 }}>
                🔄 This return trip — what are we doing?
              </span>
              {!rcEdit && job.status === 'return_pending' && (
                <button
                  onClick={() => { setRcEdit(true); setRcReason(returnCard?.reason || ''); setRcMaterials(returnCard?.materials_needed || ''); setRcEstTime(returnCard?.estimated_time || ''); setRcMsg(''); }}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none',
                           color: '#fb923c', fontSize: 12, fontWeight: 800,
                           cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  {returnCard?.reason || returnCard?.materials_needed ? 'Edit' : 'Add it'}
                </button>
              )}
            </div>

            {rcEdit ? (
              <>
                <textarea value={rcReason} onChange={e => setRcReason(e.target.value)} rows={3}
                  placeholder="What are we doing this trip? e.g. Replace front door contact, re-program Z-wave module"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#0f1729',
                           border: '1px solid #fb923c88', borderRadius: 8, color: '#e2e8f0',
                           padding: '9px 11px', fontSize: 13.5, lineHeight: 1.5,
                           fontFamily: 'inherit', resize: 'vertical', outline: 'none', marginBottom: 6 }} />
                <textarea value={rcMaterials} onChange={e => setRcMaterials(e.target.value)} rows={2}
                  placeholder="Materials to bring (e.g. 2206L contact, Z-wave module)"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#0f1729',
                           border: '1px solid #fb923c88', borderRadius: 8, color: '#e2e8f0',
                           padding: '9px 11px', fontSize: 13.5, lineHeight: 1.5,
                           fontFamily: 'inherit', resize: 'vertical', outline: 'none', marginBottom: 6 }} />
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>How long should we plan on-site?</div>
                <input value={rcEstTime} onChange={e => setRcEstTime(e.target.value)}
                  placeholder="e.g. 2h, half day"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#0f1729',
                           border: '1px solid #fb923c88', borderRadius: 8, color: '#e2e8f0',
                           padding: '9px 11px', fontSize: 13.5,
                           fontFamily: 'inherit', outline: 'none', marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 7 }}>
                  <button onClick={saveReturnCard} disabled={rcSaving}
                    style={{ flex: 2, background: '#fb923c', border: 'none', borderRadius: 8,
                             padding: '9px 0', color: '#0f1729', fontSize: 13, fontWeight: 800,
                             cursor: rcSaving ? 'default' : 'pointer', fontFamily: 'inherit',
                             opacity: rcSaving ? 0.6 : 1 }}>
                    {rcSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => { setRcEdit(false); setRcMsg(''); }} disabled={rcSaving}
                    style={{ flex: 1, background: 'transparent', border: '1px solid #fb923c44',
                             borderRadius: 8, padding: '9px 0', color: '#94a3b8', fontSize: 13,
                             fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                </div>
                {rcMsg && (
                  <div style={{ fontSize: 12, color: rcMsg.startsWith('Saved') ? '#fb923c' : '#ef4444', marginTop: 6 }}>
                    {rcMsg}
                  </div>
                )}
              </>
            ) : returnCard?.reason || returnCard?.materials_needed ? (
              <>
                {returnCard.reason && (
                  <div style={{ fontSize: 13.5, color: '#fed7aa', lineHeight: 1.55,
                                whiteSpace: 'pre-wrap', marginBottom: returnCard.materials_needed ? 6 : 0 }}>
                    {returnCard.reason}
                  </div>
                )}
                {returnCard.materials_needed && (
                  <div style={{ fontSize: 13, color: '#fbbf24', marginBottom: returnCard.estimated_time ? 4 : 0 }}>🔧 {returnCard.materials_needed}</div>
                )}
                {returnCard.estimated_time && (
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: returnCard.materials_needed ? 0 : 4 }}>
                    <span style={{ fontWeight: 700, color: '#64748b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 5 }}>Time needed</span>
                    {returnCard.estimated_time}
                  </div>
                )}
                {rcMsg && (
                  <div style={{ fontSize: 12, color: '#fb923c', marginTop: 6 }}>{rcMsg}</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#f59e0b' }}>
                No return brief yet — the tech will arrive without knowing the plan.
              </div>
            )}
          </div>
        )}

        {/* ── Issue — hidden until Ready to Schedule ─────────────────
            A quick task ("call customer", "order part") lives in the New/Notes
            lane. At that stage there is no issue yet — the scope gets written
            when the job moves to Ready to Schedule. Showing the empty panel
            earlier just adds noise and implies work that hasn't happened yet.
            Once the job leaves the new-bucket the panel renders as normal. */}
        {!['new', 'needs_details', 'needs_parts', 'pending_materials', 'pending_decision']
            .includes(job.status) && (
        <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                           letterSpacing: 0.6 }}>Issue — what are we doing?</span>
            {!issueEdit && (
              <button onClick={() => { setIssueEdit(true); setIssueText(cleanIssue || ''); setIssueMsg(''); }}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none',
                         color: C.blue, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                         fontFamily: 'inherit', padding: 0 }}>
                {cleanIssue ? 'Edit' : 'Add it'}
              </button>
            )}
          </div>

          {issueEdit ? (
            <>
              <textarea
                value={issueText}
                onChange={e => setIssueText(e.target.value)}
                rows={4}
                placeholder="e.g. Front door contact not reporting — check sensor and panel programming"
                style={{ width: '100%', boxSizing: 'border-box', background: '#0f1729',
                         border: `1px solid ${C.blue}`, borderRadius: 8, color: '#e2e8f0',
                         padding: '9px 11px', fontSize: 14, lineHeight: 1.5,
                         fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
              <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                <button onClick={saveIssue} disabled={issueSaving}
                  style={{ flex: 2, background: C.blue, border: 'none', borderRadius: 8,
                           padding: '9px 0', color: '#04121f', fontSize: 13, fontWeight: 800,
                           cursor: issueSaving ? 'default' : 'pointer', fontFamily: 'inherit',
                           opacity: issueSaving ? 0.6 : 1 }}>
                  {issueSaving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setIssueEdit(false); setIssueMsg(''); }} disabled={issueSaving}
                  style={{ flex: 1, background: 'transparent', border: `1px solid ${C.line}`,
                           borderRadius: 8, padding: '9px 0', color: C.muted, fontSize: 13,
                           fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
              </div>
            </>
          ) : cleanIssue ? (
            <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{cleanIssue}</div>
          ) : (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: C.amber }}>
              Nothing written yet — the tech will arrive without knowing the job.
            </div>
          )}

          {issueMsg && (
            <div style={{ fontSize: 12, color: issueMsg.startsWith('⚠') ? C.amber : C.muted, marginTop: 7 }}>
              {issueMsg}
            </div>
          )}
        </div>
        )} {/* end new-bucket gate */}

        {/* ── WHAT CAME BACK ───────────────────────────────────────────
            The issue above is why we went. This is what happened: the tech's
            note, their materials, their hours, and the disposition they chose.
            Together those two blocks are the whole story of the card, so they
            belong next to each other at the top.

            This used to render near the BOTTOM, below the lane buttons and the
            task composer — so the newest and most decisive fact about a job,
            the one that explains why it is sitting where it is, was the last
            thing you reached and on a phone was usually off-screen. Opening a
            dispositioned card showed you the old scope and made you scroll
            past everything to find out it had already been worked. ── */}
        <FieldVisits job={job} />

        {/* ── Time — only where hours are captured ── */}
        {timeSection && (
          <div style={{ marginBottom: 14 }}>{timeSection}</div>
        )}

        {/* ── Billing — only on the billing surface ── */}
        {billingSection && (
          <div style={{ marginBottom: 14 }}>{billingSection}</div>
        )}

        {/* Scheduler as a primary action for schedulable statuses */}
        {onSchedulePrimary && (
          <button onClick={() => onSchedulePrimary(parseEstHours(returnCard?.estimated_time))}
            style={{ width: '100%', background: '#8b5cf6', border: 'none', borderRadius: 12,
                     color: '#fff', fontWeight: 800, fontSize: 14, padding: '13px 0',
                     cursor: 'pointer', marginBottom: 14 }}>
            {job.status === 'scheduled' ? '🔁 Reschedule (pick new tech + time)' : '📅 Open Scheduler (pick tech + time)'}
          </button>
        )}

        {/* ── NO DISPOSITION — loudest thing on the card when it applies ── */}
        {awaitingDispo && (
          <div style={{ background:'#3f0d12', border:'2px solid #dc2626', borderRadius:12,
                        padding:'13px 15px', marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:900, letterSpacing:'0.06em',
                          textTransform:'uppercase', color:'#fca5a5', marginBottom:6 }}>
              ⚠ Nobody said what happened
            </div>
            <div style={{ fontSize:13, color:'#fecaca', lineHeight:1.5 }}>
              Scheduled {String(job.scheduled_date).slice(0,10)}
              {dispoDue ? ` · was due ${dispoDue.toLocaleDateString('en-US',{ weekday:'short', month:'short', day:'numeric' })} 8am` : ''}.
              {' '}Write a note, then pick a disposition below. Until you do there is no
              time entry and nothing to invoice.
            </div>
          </div>
        )}


        {/* ── WHERE NEXT — identical on every surface ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14,
                      border: awaitingDispo ? '2px solid #dc2626' : 'none' }}>
          {awaitingDispo && (
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 12 }}>
              What happened on site?
            </div>
          )}

          {/* SEVEN LANES, COLLAPSED. A card in Ready to Schedule wants ONE
              thing — the scheduler, which is the purple button above. Every
              other lane is an exception, and laying all seven out full height
              made the exceptions louder than the answer and pushed the notes
              off the bottom of the screen.
              Left open when a disposition is owed: that IS the question then. */}
          {!awaitingDispo && !showMoves && (
            <button onClick={() => setShowMoves(true)}
              style={{ width: '100%', padding: '11px 0', borderRadius: 9, cursor: 'pointer',
                       background: 'transparent', border: `1px solid ${C.line}`,
                       color: C.muted, fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>
              Move it somewhere else ▾
            </button>
          )}

          <div style={{ display: (awaitingDispo || showMoves) ? 'grid' : 'none',
                        gridTemplateColumns: '1fr', gap: 7 }}>
            {moves.map(lane => {
              const armed = pending?.key === lane.key;
              // The two estimate moves carry the money and are the two that get
              // missed — an estimate nobody wrote and an estimate nobody chased
              // both look exactly like a quiet board. Give them size.
              const big = lane.key === 'needs_estimate' || lane.key === 'estimate_sent';
              return (
                <button key={lane.key} onClick={() => choose(lane)} disabled={busy}
                  style={{ display: 'flex', alignItems: 'center', gap: big ? 13 : 11, textAlign: 'left',
                           background: armed ? `${lane.color}22` : big ? `${lane.color}14` : C.raised,
                           border: `${big ? 2 : 1}px solid ${armed ? lane.color : big ? `${lane.color}88` : C.line}`,
                           borderRadius: big ? 12 : 10, padding: big ? '17px 15px' : '11px 13px',
                           cursor: 'pointer', color: C.text, fontFamily: 'inherit' }}>
                  <span style={{ fontSize: big ? 24 : 17 }}>{lane.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: big ? 17 : 14, fontWeight: big ? 900 : 700, color: lane.color }}>
                      {lane.label}
                    </span>
                    <span style={{ display: 'block', fontSize: big ? 12.5 : 11, color: C.muted, marginTop: 2, lineHeight: 1.35 }}>
                      {lane.needsScheduler
                        ? (lane.needsScheduler === 'hold' ? 'Opens the scheduler — pick a day to hold' : 'Opens the scheduler — pick tech + time')
                        : lane.means}
                    </span>
                  </span>
                  {armed && <span style={{ fontSize: 11, color: lane.color, fontWeight: 800 }}>confirm →</span>}
                </button>
              );
            })}
          </div>

          {pending && (
            <div style={{ marginTop: 11 }}>
              {pending.key === 'blocked' && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.muted,
                                textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    Why is it blocked?
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {BLOCKED_REASONS.map(r => {
                      const on = blockedTag === r.key;
                      return (
                        <button key={r.key}
                          onClick={() => setBlockedTag(t => t === r.key ? null : r.key)}
                          style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12,
                                   fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? '#fb7185' : C.line}`,
                                   background: on ? 'rgba(239,68,68,0.15)' : C.raised,
                                   color: on ? '#fb7185' : C.muted }}>
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: '#fb7185', marginBottom: 6 }}>
                    Say what is blocking it — that is the whole point of this lane.
                  </div>
                </>
              )}
              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder={pending.key === 'blocked' ? 'More detail (optional)' : `Why is this moving to ${pending.label}? (optional)`}
                style={{ width: '100%', boxSizing: 'border-box', background: C.bg,
                         border: `1px solid ${C.line}`, borderRadius: 9, color: C.text,
                         padding: '10px 12px', fontSize: 13, outline: 'none' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => choose(pending)} disabled={busy}
                  style={{ flex: 1, background: pending.color, border: 'none', borderRadius: 9,
                           color: '#08121f', padding: '11px 0', fontSize: 13, fontWeight: 800,
                           cursor: 'pointer' }}>
                  {busy ? 'Moving…' : `Move to ${pending.label}`}
                </button>
                <button onClick={() => { setPending(null); setNote(''); setBlockedTag(null); }}
                  style={{ background: 'transparent', border: `1px solid ${C.line}`, borderRadius: 9,
                           color: C.muted, padding: '11px 16px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {err && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 9 }}>{err}</div>}
        </div>

        {/* ── Notes — same component, same place, every surface ── */}
        {/* hideFieldNotes: FieldVisits above already renders time_entry notes
            as visit cards. Without this, the same note appears twice. */}
        <NotesPanel jobId={job.id} userEmail={userEmail} job={job} accessToken={accessToken} readOnly hideFieldNotes />

      {openTasks.length > 0 && (
        <div style={{ background: C.panel, borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
          <button onClick={() => setTasksOpen(o => !o)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                     padding: '11px 14px',
                     background: 'none', border: 'none', borderBottom: tasksOpen ? `1px solid ${C.line}` : 'none',
                     cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.7 }}>
              Tasks ({openTasks.length})
            </span>
            <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 14 }}>
              {tasksOpen ? '▾' : '▸'}
            </span>
          </button>
          {tasksOpen && (
            <div style={{ padding: '0 14px 2px' }}>
              {openTasks.map(t => {
                const assigneeName = ASSIGNEES.find(a => a.email === t.assigned_to)?.name || t.assigned_to;
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
                                           padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
                    <button
                      onClick={() => markTaskDone(t.id)}
                      style={{
                        width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                        background: 'transparent',
                        border: `2px solid #475569`,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: '#fff', padding: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: C.text,
                                     lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box',
                                     WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {t.body}
                      </div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{assigneeName}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SPAWN A TASK ────────────────────────────────────────────────
            An estimate that needs writing is not a stage of the job, it is a
            thing one person owes. It gets a task; the job stays the record. */}
        <div style={{ background: taskOpen ? C.panel : 'transparent',
                      borderRadius: 12, padding: taskOpen ? 14 : 0, marginBottom: 14 }}>
          {!taskOpen ? (
            // DEMOTED WHEN THE SCHEDULER IS THE ANSWER. A card in Ready to
            // Schedule has one obvious next move and it is the purple button
            // above; a second full-weight purple button under it competes with
            // the thing the card is actually for. Solid when there is no
            // scheduler CTA, outlined when there is.
            <button onClick={() => { setTaskOpen(true); setTaskMsg(''); }}
              style={{ width: '100%', padding: onSchedulePrimary ? '12px 14px' : '16px 14px',
                       borderRadius: 12, cursor: 'pointer',
                       background: onSchedulePrimary ? 'transparent' : '#9b6cff',
                       border: onSchedulePrimary ? '1px solid #9b6cff66' : 'none',
                       color: onSchedulePrimary ? '#c4a6ff' : '#0b0618',
                       fontSize: onSchedulePrimary ? 14 : 16, fontWeight: 900,
                       fontFamily: 'inherit',
                       display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left' }}>
              <span style={{ fontSize: onSchedulePrimary ? 18 : 22 }}>＋</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>
                  {openTasks.length ? 'Create another task' : 'Create a task'}
                </span>
                {/* SAY WHAT IS ALREADY OUT THERE. Nothing stopped you sending a
                    second and third copy of the same ask to different people,
                    none of whom knew about the others. Still allowed — a job
                    can genuinely need two — but not by accident. */}
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700,
                               opacity: 0.72, marginTop: 2 }}>
                  {openTasks.length
                    ? `${openTasks.length} already open · ${[...new Set(openTasks
                        .map(t => ASSIGNEES.find(a => a.email === t.assigned_to)?.name
                                  || t.assigned_to))].join(', ')}`
                    : 'Hand a piece of this to someone'}
                </span>
              </span>
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 900, marginBottom: 8 }}>What needs doing?</div>
              <textarea value={taskBody} onChange={e => setTaskBody(e.target.value)} rows={3} autoFocus
                placeholder="Write the estimate for this scope…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9,
                         border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0',
                         fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
              {/* WHO DOES THIS? — pill row below the textarea so the assignee
                  is always pickable, even when no job owner is set. Pre-selects
                  ownerEmail so the usual path (one person owns it) is zero-click. */}
              <div style={{ fontSize: 12, color: C.muted, margin: '11px 0 6px' }}>Who does this?</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                {ASSIGNEES.map(a => {
                  const selected = (taskWho || ownerEmail) === a.email;
                  return (
                    <button key={a.email}
                      onClick={() => setTaskWho(taskWho === a.email ? '' : a.email)}
                      style={{ padding: '7px 11px', borderRadius: 8, cursor: 'pointer',
                               background: selected ? '#3b82f6' : 'transparent',
                               border: `1px solid ${selected ? '#3b82f6' : '#334155'}`,
                               color: selected ? '#fff' : C.muted,
                               fontSize: 12.5, fontWeight: 800, fontFamily: 'inherit' }}>
                      {a.name}
                    </button>
                  );
                })}
              </div>
              {/* THEN IT GOES TO — optional follow-up assignee. */}
              {(taskWho || ownerEmail) && (
                <div style={{ marginTop: 13 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 7 }}>
                    Then it goes to… <span style={{ opacity: 0.7 }}>(optional)</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ASSIGNEES.filter(a => a.email !== (taskWho || ownerEmail)).map(a => {
                      const on = taskNext === a.email;
                      return (
                        <button key={a.email} onClick={() => setTaskNext(on ? '' : a.email)}
                          style={{ padding: '7px 11px', borderRadius: 8, cursor: 'pointer',
                                   background: on ? '#ffb020' : 'transparent',
                                   border: `1px solid ${on ? '#ffb020' : '#334155'}`,
                                   color: on ? '#231600' : C.muted,
                                   fontSize: 12.5, fontWeight: 800, fontFamily: 'inherit' }}>
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 7, marginTop: 13 }}>
                <button onClick={createTask} disabled={saving || !taskBody.trim() || !(taskWho || ownerEmail)}
                  style={{ flex: 2, padding: '11px 0', borderRadius: 9, background: '#22d16f',
                           border: 'none', color: '#052e16', fontSize: 14, fontWeight: 800,
                           fontFamily: 'inherit', cursor: 'pointer',
                           opacity: (saving || !taskBody.trim() || !(taskWho || ownerEmail)) ? 0.5 : 1 }}>
                  {saving ? 'Sending…' : 'Send task'}
                </button>
                <button onClick={() => { setTaskOpen(false); setTaskBody(''); setTaskWho(''); }}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 9, background: 'transparent',
                           border: '1px solid #334155', color: C.muted, fontSize: 14,
                           fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {taskMsg && <div style={{ fontSize: 12.5, color: '#93c5fd', marginTop: 9 }}>{taskMsg}</div>}
        </div>

        {/* ── MAKE A NOTE — office-only, invisible on this card ───────────
            Writes to the notes table with assigned_to=null. TicketSheet's
            task query filters to assigned_to != null, so this note never
            appears here. CustomerHistory queries all notes by customer_id,
            so it shows there — next to every other account touch. ── */}
        <div style={{ marginBottom: 14 }}>
          {!internalNoteOpen ? (
            <button onClick={() => { setInternalNoteOpen(true); setInternalNoteMsg(''); }}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                       background: 'transparent', border: `1px dashed ${C.line}`,
                       color: C.muted, fontSize: 14, fontWeight: 700,
                       fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🗒️</span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ display: 'block' }}>Make a note</span>
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, opacity: 0.65, marginTop: 1 }}>
                  Only visible in client search — not shown in the field
                </span>
              </span>
            </button>
          ) : (
            <div style={{ background: C.panel, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                            color: C.muted, marginBottom: 8 }}>
                Internal note · client search only
              </div>
              <textarea
                value={internalNoteText}
                onChange={e => setInternalNoteText(e.target.value)}
                rows={3} autoFocus
                placeholder="Only the office sees this — not on the job card, not synced to the calendar."
                style={{ width: '100%', boxSizing: 'border-box', background: C.bg,
                         border: `1px solid ${C.line}`, borderRadius: 8, color: C.text,
                         padding: '9px 11px', fontSize: 14, lineHeight: 1.5,
                         fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
              <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                <button onClick={saveInternalNote} disabled={internalNoteSaving || !internalNoteText.trim()}
                  style={{ flex: 2, background: '#1e3a5f', border: '1px solid #3b82f6',
                           borderRadius: 8, padding: '9px 0', color: '#93c5fd', fontSize: 13,
                           fontWeight: 800, cursor: internalNoteSaving ? 'default' : 'pointer',
                           fontFamily: 'inherit', opacity: internalNoteSaving || !internalNoteText.trim() ? 0.55 : 1 }}>
                  {internalNoteSaving ? 'Saving…' : 'Save note'}
                </button>
                <button onClick={() => { setInternalNoteOpen(false); setInternalNoteText(''); setInternalNoteMsg(''); }}
                  style={{ flex: 1, background: 'transparent', border: `1px solid ${C.line}`,
                           borderRadius: 8, padding: '9px 0', color: C.muted, fontSize: 13,
                           fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {internalNoteMsg && (
            <div style={{ fontSize: 12, marginTop: 6,
                          color: internalNoteMsg.startsWith('⚠') ? C.amber : C.muted }}>
              {internalNoteMsg}
            </div>
          )}
        </div>

        {/* ── Surface-specific tools (merge, UUID link) — deliberately LAST.
            They exist, they matter, and they are not the reason anyone opens
            a ticket. ── */}
        {extras}
      </div>

      {/* What did we sell? Asked once, at the only moment anyone knows. */}
      {askContract && (
        <div onClick={() => setAskContract(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,16,0.82)', zIndex: 970,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14,
                     padding: 20, width: '100%', maxWidth: 440 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>What did we sell?</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 3, marginBottom: 16 }}>
              {job.customer_name || 'This job'} \u2014 accepted estimate
            </div>

            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4,
                            textTransform: 'uppercase', color: '#94a3b8', marginBottom: 5 }}>
              Contract amount
            </label>
            <input type="number" inputMode="decimal" value={cAmount} autoFocus
              onChange={e => setCAmount(e.target.value)} placeholder="19420"
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 9,
                       border: '1px solid #1e293b', background: '#0b1220', color: '#e2e8f0',
                       fontSize: 16, fontFamily: 'inherit', marginBottom: 12 }} />

            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4,
                            textTransform: 'uppercase', color: '#94a3b8', marginBottom: 5 }}>
              Labour hours sold
            </label>
            <input type="number" inputMode="decimal" value={cHours}
              onChange={e => setCHours(e.target.value)} placeholder="125"
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 9,
                       border: '1px solid #1e293b', background: '#0b1220', color: '#e2e8f0',
                       fontSize: 16, fontFamily: 'inherit', marginBottom: 12 }} />

            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4,
                            textTransform: 'uppercase', color: '#94a3b8', marginBottom: 5 }}>
              Estimate number
            </label>
            <input value={cRef} onChange={e => setCRef(e.target.value)} placeholder="5511, 5512"
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 9,
                       border: '1px solid #1e293b', background: '#0b1220', color: '#e2e8f0',
                       fontSize: 15, fontFamily: 'inherit' }} />

            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
              With an amount on it the hours are held against the contract instead of
              being offered hourly in Billing. Leave it blank for time and materials.
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => saveContract(true)} disabled={cSaving}
                style={{ flex: 1, padding: '11px 0', borderRadius: 9, background: 'transparent',
                         border: '1px solid #334155', color: '#94a3b8', fontSize: 13.5,
                         fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Time &amp; materials
              </button>
              <button onClick={() => saveContract(false)} disabled={cSaving || !cAmount}
                style={{ flex: 2, padding: '11px 0', borderRadius: 9, border: 'none',
                         background: cAmount ? '#10b981' : '#1e293b',
                         color: cAmount ? '#052e16' : '#475569',
                         fontSize: 14.5, fontWeight: 800,
                         cursor: cAmount ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {cSaving ? 'Saving\u2026' : 'Fixed fee \u2014 mark won'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
