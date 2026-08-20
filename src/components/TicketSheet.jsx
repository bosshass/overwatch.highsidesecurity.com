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
import { sendGmail } from '../services/gmailSend.js';
import { assignmentMessage, APP_BASE } from '../config/appBase.js';
import { PHONE_BY_EMAIL } from '../utils/ownership.js';
import { ASSIGNEES, assigneeOf, EMAIL_BY_NAME, canonicalEmail, NAME_BY_EMAIL } from '../utils/ownership.js';
import { LANES, movesFor, laneOf, isHeld , requiresDisposition } from '../utils/lanes.js';
import { stripIntakeTemplate } from '../utils/statusMachine.js';
import NotesPanel from './NotesPanel.jsx';
import { releaseCalendar } from '../services/schedule.js';
import { syncIssueToEvents } from '../services/calendarSync.js';
import { needsDisposition, dispositionDueAt } from '../utils/staleness.js';
import FieldVisits from './FieldVisits.jsx';

const C = {
  bg: '#0f1729', panel: '#16233a', raised: '#1b2b45', line: '#2a3b56',
  text: '#e9f1ff', muted: '#93a5bd', dim: '#64748b',
};

const Row = ({ label, children }) => children == null || children === '' ? null : (
  <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 13 }}>
    <span style={{ color: C.muted, minWidth: 110, flexShrink: 0 }}>{label}</span>
    <span style={{ color: C.text, flex: 1, minWidth: 0 }}>{children}</span>
  </div>
);

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
  // Spawn-a-task composer. Lives on the job card because that is where the
  // work is described — retyping it into a separate notes screen is how the
  // task ends up saying something different from the job.
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskBody, setTaskBody] = useState('');
  const [taskWho, setTaskWho]   = useState('');
  const [taskMsg, setTaskMsg]   = useState('');
  const [taskNext, setTaskNext] = useState('');   // handoff_to
  const [openTasks, setOpenTasks] = useState([]); // tasks already live on this job

  // ── Editing the issue ────────────────────────────────────────────────
  const [issueEdit, setIssueEdit]     = useState(false);
  const [issueText, setIssueText]     = useState('');
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueMsg, setIssueMsg]       = useState('');
  // The saved value, so the box reflects the edit without waiting for the
  // parent to refetch. Null until something is saved here.
  const [issueLocal, setIssueLocal]   = useState(null);
  const [showMoves, setShowMoves] = useState(false);

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
        .order('created_at', { ascending: true });
      if (!dead) setOpenTasks(data || []);
    })();
    return () => { dead = true; };
  }, [job?.id, taskMsg]);

  if (!job) return null;

  const here = laneOf(job);
  const moves = movesFor(job);
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
    // ONE ASSIGNEE ROW, NOT TWO. The card already asks who owns this directly
    // under the customer; asking again inside the composer was the same
    // question twice, and the two could disagree.
    const who = ownerEmail;
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

  const assign = async (email) => {
    setErr(''); setSaving(true);
    try {
      const { error } = await supabase.from('jobs')
        .update({ assigned_to: email, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      if (error) throw error;
      setOwner(email ? (ASSIGNEES.find(a => a.email === email)?.name || email) : '\u0000');
      onAssigned?.(job.id, email);

      // Notify the assignee — send email via Gmail using the same OAuth token
      // that's already in scope. No Twilio, no server, no extra config.
      // Falls back silently if the token lacks gmail.send scope.
      if (email && accessToken) {
        const name = ASSIGNEES.find(a => a.email === email)?.name || email;
        sendGmail(accessToken, {
          to: email,
          subject: `[Overwatch] Assigned: ${job.customer_name || 'a job'}`,
          body: assignmentMessage(job),
        }).catch(() => {}); // never block the UI on a notification
      }
    } catch (e) { setErr(e.message || 'Could not assign'); }
    finally { setSaving(false); }
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
        const r = await syncIssueToEvents(accessToken, job, next);
        setIssueMsg(r.patched > 0
          ? `Saved · calendar updated (${r.patched} event${r.patched === 1 ? '' : 's'})`
          : '⚠ Saved here, but the calendar event could not be updated.');
      }
    } catch (e) {
      setIssueMsg(`⚠ Could not save: ${e.message || e}`);
    } finally {
      setIssueSaving(false);
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
    if (pending?.key !== lane.key) { setPending(lane); return; }

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
      await onMove?.(target, note.trim() || null);
      // The job is over — take its event off the tech calendar. Non-fatal: a
      // failed delete must not unwind a status move that already succeeded,
      // and the job row is the record either way.
      if (['billed', 'archived', 'dead', 'lost'].includes(target)) {
        try { await releaseCalendar({ job, accessToken }); }
        catch (e) { console.warn('calendar release failed (non-fatal)', e.message); }
      }
      setPending(null); setNote('');
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
          <Row label="Phone">{job.customer_phone}</Row>
          <Row label="Tech on site">{job.tech_name}</Row>{/* physical presence, NOT ownership — see the Assigned to block */}
          <Row label="Scheduled">{job.scheduled_date
            ? new Date(job.scheduled_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : null}</Row>
          <Row label="CMS">{job.cms_account_id}</Row>
        </div>

        {/* ── Owner — WHO IS DOING THIS. Above the issue, because an
             unowned ticket is the failure mode, not an unread one. ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
            <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                           letterSpacing: 0.6 }}>Assigned to</span>
            {ownerName
              ? <span style={{ fontSize: 14, fontWeight: 800, color: '#60a5fa',
                               background: '#1e3a8a44', padding: '3px 10px', borderRadius: 6 }}>{ownerName}</span>
              : <span style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24',
                               background: '#78350f44', padding: '3px 10px', borderRadius: 6 }}>Unassigned</span>}
            {saving && <span style={{ fontSize: 11, color: C.dim }}>saving…</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {ASSIGNEES.map(a => {
              const on = a.email === ownerEmail;
              return (
                <button key={a.email} onClick={() => assign(a.email)} disabled={saving || busy}
                  style={{ background: on ? '#1d4ed8' : C.raised,
                           border: `1px solid ${on ? '#60a5fa' : C.line}`,
                           color: on ? '#fff' : C.text, borderRadius: 999,
                           padding: '7px 14px', fontSize: 13, fontWeight: 700,
                           cursor: 'pointer', fontFamily: 'inherit' }}>
                  {a.name}
                </button>
              );
            })}
            <button onClick={() => assign(null)} disabled={saving || busy || !ownerName}
              style={{ background: 'transparent', border: `1px dashed ${C.line}`,
                       color: C.muted, borderRadius: 999, padding: '7px 14px',
                       fontSize: 13, fontWeight: 700, cursor: ownerName ? 'pointer' : 'default',
                       opacity: ownerName ? 1 : 0.45, fontFamily: 'inherit' }}>
              Nobody
            </button>
          </div>
        </div>

        {/* ── Issue ── */}
        {/* ── THE ISSUE, EDITABLE ──────────────────────────────────────
            "What are we doing?" is the one thing on a card that everybody
            needs and nobody could change. It was read-only here, so a scope
            that arrived wrong stayed wrong — and 28 live cards had no issue at
            all, which made a read-only box render nothing rather than offering
            somewhere to fix it. Now it always renders, empty included.
            Saving writes jobs.issue and then patches the linked calendar
            events, replacing only the fenced issue region of the description —
            the CUSTOMER_ID stamp, field notes and anything hand-typed are left
            exactly as they are. See applyIssueToDescription. */}
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
          <button onClick={() => onSchedulePrimary()}
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

        {/* THIS CARD HAS TASKS ON IT. The job stays exactly where it is — a note
          in New with a task hanging off it is a perfectly normal state — but
          the card has to SAY so, or the only way to know somebody is already
          working a piece of it is to open the composer and read the button. */}
      {openTasks.length > 0 && (
        <div style={{ background: '#1a1533', border: '1px solid #9b6cff66',
                      borderRadius: 11, padding: '10px 13px', marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.06em',
                        color: '#c4a6ff', marginBottom: 9 }}>
            {openTasks.length === 1 ? 'TASK ON THIS JOB' : `${openTasks.length} TASKS ON THIS JOB`}
          </div>
          {/* This was one line — a comma-joined list of names and the words
              "working a piece of this". It named who, and nothing else: not
              what was asked, not whether they had started, not whether they
              had already handed it back. Which is the actual question when you
              open a card and want to know what is happening. */}
          {openTasks.map(t => {
            const owner = ASSIGNEES.find(a => a.email === t.assigned_to)?.name || t.assigned_to;
            const asker = ASSIGNEES.find(a => a.email === t.assigned_by)?.name || t.assigned_by;
            const days  = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
            // Three states, three colours. 'done' means the doer finished and
            // it is sitting with whoever asked — that is a prompt for the
            // reader, not a closed item, so it is the loudest of the three.
            const state = t.lane === 'done'
              ? { label: 'SAYS DONE — needs your OK', color: '#c4a6ff' }
              : t.lane === 'doing'
                ? { label: 'ON IT', color: '#38bdf8' }
                : { label: 'TO DO', color: '#94a3b8' };
            return (
              <div key={t.id} style={{ paddingTop: 8, marginTop: 8,
                                       borderTop: '1px solid #9b6cff33' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, color: '#e2e8f0', fontWeight: 800 }}>{owner}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.05em',
                                 color: state.color, border: `1px solid ${state.color}55`,
                                 borderRadius: 5, padding: '2px 6px' }}>
                    {state.label}
                  </span>
                  <span style={{ fontSize: 11.5, marginLeft: 'auto',
                                 color: days >= 21 ? '#ef4444' : days >= 7 ? '#f59e0b' : C.muted }}>
                    {days > 0 ? `${days}d` : 'today'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.45, marginTop: 3,
                              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {t.body || '(no detail)'}
                </div>
                {(asker || t.handoff_to) && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                    {asker ? `asked by ${asker}` : ''}
                    {t.handoff_to ? ` · then → ${ASSIGNEES.find(a => a.email === t.handoff_to)?.name || t.handoff_to}` : ''}
                  </div>
                )}
              </div>
            );
          })}
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
              {/* NO SECOND PILL ROW. The card asks who owns this directly under
                  the customer — asking again here was the same question twice
                  and the two answers could disagree. */}
              <div style={{ fontSize: 12.5, color: ownerName ? '#93c5fd' : '#f59e0b',
                            margin: '11px 0 2px', fontWeight: 700 }}>
                {ownerName
                  ? `Goes to ${ownerName}`
                  : 'Nobody is assigned yet — pick someone above first.'}
              </div>
              {/* THEN IT GOES TO — optional. When the doer is not the person who
                  closes the loop with the customer, this is the field that was
                  missing: two live tasks had the chain written out in prose
                  ("once it's complete, Shana will reach out to the client")
                  because there was nowhere to put it. */}
              {ownerEmail && (
                <div style={{ marginTop: 13 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 7 }}>
                    Then it goes to… <span style={{ opacity: 0.7 }}>(optional)</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ASSIGNEES.filter(a => a.email !== ownerEmail).map(a => {
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
                <button onClick={createTask} disabled={saving || !taskBody.trim() || !ownerEmail}
                  style={{ flex: 2, padding: '11px 0', borderRadius: 9, background: '#22d16f',
                           border: 'none', color: '#052e16', fontSize: 14, fontWeight: 800,
                           fontFamily: 'inherit', cursor: 'pointer',
                           opacity: (saving || !taskBody.trim() || !taskWho) ? 0.5 : 1 }}>
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

        {/* ── WHERE NEXT — identical on every surface ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14,
                      border: awaitingDispo ? '2px solid #dc2626' : 'none' }}>
          <div style={{ fontSize: awaitingDispo ? 16 : 14, fontWeight: 900, marginBottom: 2 }}>
            {awaitingDispo ? 'What happened on site?' : 'Where does this go next?'}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            {here ? <>Currently <b style={{ color: here.color }}>{here.label}</b>.</> : null}
          </div>

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
              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder={`Why is this moving to ${pending.label}? (optional)`}
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
                <button onClick={() => { setPending(null); setNote(''); }}
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
        <NotesPanel jobId={job.id} userEmail={userEmail} job={job} accessToken={accessToken} readOnly />

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
