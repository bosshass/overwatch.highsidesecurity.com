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
import { useState } from 'react';
import { supabase } from '../services/supabase.js';
import { sendGmail } from '../services/gmailSend.js';
import { assignmentMessage } from '../config/appBase.js';
import { PHONE_BY_EMAIL } from '../utils/ownership.js';
import { ASSIGNEES, assigneeOf, EMAIL_BY_NAME } from '../utils/ownership.js';
import { LANES, movesFor, laneOf, isHeld , requiresDisposition } from '../utils/lanes.js';
import { stripIntakeTemplate } from '../utils/statusMachine.js';
import NotesPanel from './NotesPanel.jsx';
import { releaseCalendar } from '../services/schedule.js';
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
  const cleanIssue = stripIntakeTemplate(job.issue);

  // ONE rule for who owns this, from ownership.js. The board card used to read
  // job.tech_name directly, which is why assigning somebody left the card
  // reading "Unassigned" — the write went to assigned_to and the card was
  // looking at a different column.
  const ownerName = owner === '\u0000' ? null : (owner || assigneeOf(job));
  const ownerEmail = ownerName ? EMAIL_BY_NAME[ownerName.toLowerCase()] || null : null;

  // WRITES assigned_to (migration 030) — the real column. It does NOT touch
  // tech_name: that field means "who was physically on site", and overwriting
  // it to record an office assignment is how the two meanings got tangled.
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
        {cleanIssue && (
          <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                          letterSpacing: 0.6, marginBottom: 6 }}>Issue</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{cleanIssue}</div>
          </div>
        )}

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

        {/* ── WHERE NEXT — identical on every surface ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14,
                      border: awaitingDispo ? '2px solid #dc2626' : 'none' }}>
          <div style={{ fontSize: awaitingDispo ? 16 : 14, fontWeight: 900, marginBottom: 2 }}>
            {awaitingDispo ? 'What happened on site?' : 'Where does this go next?'}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            {here ? <>Currently <b style={{ color: here.color }}>{here.label}</b>.</> : null} Pick one.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 7 }}>
            {moves.map(lane => {
              const armed = pending?.key === lane.key;
              return (
                <button key={lane.key} onClick={() => choose(lane)} disabled={busy}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left',
                           background: armed ? `${lane.color}22` : C.raised,
                           border: `1px solid ${armed ? lane.color : C.line}`,
                           borderRadius: 10, padding: '11px 13px', cursor: 'pointer',
                           color: C.text, fontFamily: 'inherit' }}>
                  <span style={{ fontSize: 17 }}>{lane.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: lane.color }}>
                      {lane.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.35 }}>
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

        {/* ── Field visits — the tech's actual logged time ── */}
        <FieldVisits job={job} />

        {/* ── Notes — same component, same place, every surface ── */}
        <NotesPanel jobId={job.id} userEmail={userEmail} job={job} accessToken={accessToken} />

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
