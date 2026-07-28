// ============================================
// MoveStatus — bidirectional status control
// ============================================
// Drops onto ANY card, on ANY screen (board, triage, calendar detail).
// Lets any role move a job to any appropriate status — FORWARD or BACKWARD —
// and requires a note when the move goes backward or bounces to another team,
// so the reason travels with the card in job_history.
//
// The data layer already supports this: jobsApi.changeStatus(id, status, by, note)
// is direction-agnostic and logs history. This is just the UI that exposes it.
//
// Example the business actually hits: billing opens a To Bill card, reads the
// thread, realizes it isn't billable yet, and moves it BACK to Ready to Schedule
// with "sent back — needs panel swap first." Shana sees it in her queue with
// that note on top.

import { useState } from 'react';
import { jobsApi, JOB_STATUS } from '../services/supabase.js';

// Curated move targets per current status. Only the transitions that make
// business sense are offered — but both directions are first-class.
// `back: true` marks a backward/bounce move, which forces a note.
const MOVES = {
  [JOB_STATUS.NEW]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
    { to: JOB_STATUS.NEEDS_ESTIMATE,    label: 'Needs Estimate' },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Waiting on Parts' },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked' },
  ],
  [JOB_STATUS.NEEDS_ESTIMATE]: [
    { to: JOB_STATUS.ESTIMATE_SENT,     label: 'Estimate Sent' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
    { to: JOB_STATUS.NEW,               label: 'Back to New', back: true },
  ],
  [JOB_STATUS.ESTIMATE_SENT]: [
    { to: JOB_STATUS.WON,               label: 'Won → Ready to Schedule' },
    { to: JOB_STATUS.LOST,              label: 'Lost', back: true },
    { to: JOB_STATUS.NEEDS_ESTIMATE,    label: 'Re-quote', back: true },
  ],
  [JOB_STATUS.WON]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
  ],
  [JOB_STATUS.NEEDS_PARTS]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Parts in → Ready to Schedule' },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked', back: true },
  ],
  [JOB_STATUS.PENDING_MATERIALS]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked', back: true },
  ],
  [JOB_STATUS.BLOCKED]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Unblock → Ready to Schedule' },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Waiting on Parts' },
  ],
  [JOB_STATUS.READY_TO_SCHEDULE]: [
    { to: JOB_STATUS.SCHEDULED,         label: 'Scheduled' },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Waiting on Parts', back: true },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked', back: true },
  ],
  [JOB_STATUS.SCHEDULED]: [
    { to: JOB_STATUS.TO_BILL,           label: 'Done → To Bill' },
    { to: JOB_STATUS.RETURN_PENDING,    label: 'Needs Return' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Back to Scheduling', back: true },
  ],
  [JOB_STATUS.RETURN_PENDING]: [
    { to: JOB_STATUS.SCHEDULED,         label: 'Scheduled' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
  ],
  [JOB_STATUS.COMPLETE]: [
    { to: JOB_STATUS.TO_BILL,           label: 'To Bill' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Back to Scheduling', back: true },
  ],
  [JOB_STATUS.TO_BILL]: [
    { to: JOB_STATUS.BILLED,            label: 'Billed ✓' },
    // The bounce-back the billing team needs:
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Send back to Scheduling', back: true },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Send back — needs parts', back: true },
  ],
  [JOB_STATUS.BILLED]: [
    { to: JOB_STATUS.TO_BILL,           label: 'Reopen billing', back: true },
  ],
};

const LABEL = {
  new:'New', needs_details:'Needs Details', needs_parts:'Waiting on Parts',
  pending_decision:'Pending', pending_materials:'Waiting on Materials',
  ready_to_schedule:'Ready to Schedule', return_pending:'Return Pending',
  scheduled:'Scheduled', complete:'Complete', to_bill:'To Bill', billed:'Billed',
  needs_estimate:'Needs Estimate', estimate_sent:'Estimate Sent', won:'Won',
  lost:'Lost', blocked:'Blocked', dead:'Dead', archived:'Archived',
};

export default function MoveStatus({ job, userEmail, onMoved }) {
  const [picking, setPicking]   = useState(null);   // the pending move target
  const [note, setNote]         = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');

  const moves = MOVES[job.status] || [];
  if (!moves.length) return null;

  const commit = async (move) => {
    // Backward / bounce moves require a note so the reason travels with the card.
    if (move.back && !note.trim()) { setErr('A note is required to send this back.'); return; }
    setBusy(true); setErr('');
    try {
      await jobsApi.changeStatus(job.id, move.to, userEmail || 'unknown', note.trim() || null);
      setPicking(null); setNote('');
      onMoved?.(move.to);
    } catch (e) {
      setErr(e.message || 'Move failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#8497b0', marginBottom: 6 }}>
        Move · now: {LABEL[job.status] || job.status}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {moves.map(m => (
          <button key={m.to}
            onClick={() => { setPicking(picking?.to === m.to ? null : m); setErr(''); }}
            style={{
              fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${m.back ? '#d9770655' : '#2a3f5c'}`,
              background: picking?.to === m.to ? (m.back ? '#d97706' : '#3b82f6') : (m.back ? '#d977060f' : '#0e1a2b'),
              color: picking?.to === m.to ? '#fff' : (m.back ? '#fcd34d' : '#8497b0'),
            }}>
            {m.back ? '↩ ' : ''}{m.label}
          </button>
        ))}
      </div>

      {picking && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={picking.back ? 'Why is this going back? (required)' : 'Add a note (optional)'}
            rows={2}
            style={{
              width: '100%', background: '#0a121f', border: `1px solid ${picking.back ? '#d97706' : '#1e2f47'}`,
              borderRadius: 8, color: '#eaf1fb', fontSize: 13, padding: '8px 10px', resize: 'vertical',
              fontFamily: 'inherit',
            }} />
          {err && <div style={{ color: '#ff8a85', fontSize: 11, marginTop: 4 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={() => commit(picking)} disabled={busy}
              style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: picking.back ? '#d97706' : '#3b82f6', color: '#fff', fontWeight: 800, fontSize: 13 }}>
              {busy ? 'Moving…' : `Move → ${LABEL[picking.to] || picking.to}`}
            </button>
            <button onClick={() => { setPicking(null); setNote(''); setErr(''); }} disabled={busy}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #2a3f5c', cursor: 'pointer',
                background: 'transparent', color: '#8497b0', fontWeight: 700, fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
