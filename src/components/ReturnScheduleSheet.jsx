// ReturnScheduleSheet.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Lean two-tap return scheduler. Tap a tech, tap a day, confirm.
//
// On confirm it does the in-sync write so the office side AND the tech side both
// see the return without anyone re-typing anything:
//   1. Creates a CHILD job linked to the parent (parent_job_id, inherits customer)
//   2. Creates the tech assignment (job + tech + slot)
//   3. Places the event on the tech's Google Calendar (what the tech sees)
//   4. Flips the child job RETURN_PENDING → SCHEDULED (writes status history)
//   5. Closes the parent's return_card if one drove this
//
// A return is a real record with a parent link — never a status flip that erases
// how many times you've been back out there.
//
// Props:
//   parentJob    the job being returned to (required)
//   returnCard   optional return_card that triggered this (gets marked scheduled)
//   accessToken  Google access token for calendar placement (required)
//   userEmail    who's scheduling (for created_by / status history)
//   onScheduled  (childJob, calEvent) => void   called after success
//   onCancel     () => void                     called on dismiss
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { jobsApi, assignmentsApi, techsApi, returnCardsApi, JOB_STATUS } from '../services/supabase.js';
import { scheduleToTechCalendar } from '../services/calendarSync.js';

const TIME_SLOTS = [
  { label: '8 AM', h: 8 }, { label: '9 AM', h: 9 }, { label: '10 AM', h: 10 },
  { label: '1 PM', h: 13 }, { label: '2 PM', h: 14 }, { label: '3 PM', h: 15 },
];

function dayChips() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
    out.push({ label, date: d });
  }
  return out;
}

export default function ReturnScheduleSheet({ parentJob, returnCard, accessToken, userEmail, onScheduled, onCancel }) {
  const [techs, setTechs] = useState([]);
  const [techId, setTechId] = useState(null);
  const [dayIdx, setDayIdx] = useState(null);
  const [slotH, setSlotH] = useState(9);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const days = dayChips();

  useEffect(() => {
    let alive = true;
    techsApi.getAll().then(t => { if (alive) setTechs(t); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const tech = techs.find(t => t.id === techId) || null;
  const ready = tech && dayIdx !== null && !busy;

  function buildScheduledFor() {
    const d = new Date(days[dayIdx].date);
    d.setHours(slotH, 0, 0, 0);
    return d;
  }

  async function scheduleReturn() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const scheduledFor = buildScheduledFor();
    try {
      // 1. Child job linked to the parent (inherits customer, sets parent_job_id, RETURN_PENDING)
      const childJob = await jobsApi.createLinkedJob(
        parentJob.id,
        { issue: reason.trim() || `Return visit for ${parentJob.job_number || parentJob.customer_name || 'job'}` },
        userEmail
      );

      // 2. Tech assignment for the slot
      const assignment = await assignmentsApi.create(
        { job_id: childJob.id, tech_id: tech.id, scheduled_for: scheduledFor.toISOString() },
        userEmail
      );

      // 3. Place it on the tech's calendar — this is what the tech actually sees
      let calEvent = null;
      try {
        calEvent = await scheduleToTechCalendar(accessToken, childJob, tech, scheduledFor);
      } catch (e) {
        console.warn('Return calendar placement failed:', e.message);
      }
      if (calEvent?.id) {
        await assignmentsApi.update(assignment.id, { calendar_event_id: calEvent.id });
      }

      // 4. Flip child RETURN_PENDING → SCHEDULED (writes status history + scheduled_at)
      await jobsApi.changeStatus(childJob.id, JOB_STATUS.SCHEDULED, userEmail, `Return scheduled — ${tech.name}`);

      // 5. Close the parent's return card if one drove this
      if (returnCard?.id) {
        try {
          await returnCardsApi.markScheduled(
            returnCard.id, calEvent?.id || null, tech.calendar_id || null, scheduledFor.toISOString()
          );
        } catch (e) {
          console.warn('Return card update failed:', e.message);
        }
      }

      onScheduled?.(childJob, calEvent);
    } catch (e) {
      setError(e.message || 'Could not schedule the return');
      setBusy(false);
    }
  }

  const custName = parentJob?.customer_name || parentJob?.customers?.name || 'Customer';
  const custAddr = parentJob?.customer_address || '';

  return (
    <div style={overlay} onClick={busy ? undefined : onCancel}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={grabber} />
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Schedule return</div>
          <div style={{ fontSize: 13, color: '#475569' }}>{custName}{custAddr ? ` · ${custAddr}` : ''}</div>
        </div>

        <Label>1 · Tech</Label>
        <div style={chipRow}>
          {techs.length === 0 && <span style={{ fontSize: 13, color: '#94a3b8' }}>Loading techs…</span>}
          {techs.map(t => (
            <button key={t.id} onClick={() => setTechId(t.id)}
              style={chip(techId === t.id, t.color || '#10b981')}>
              {t.name}
            </button>
          ))}
        </div>

        <Label>2 · Day</Label>
        <div style={chipRow}>
          {days.map((d, i) => (
            <button key={i} onClick={() => setDayIdx(i)} style={chip(dayIdx === i, '#0f766e')}>
              {d.label}
            </button>
          ))}
        </div>

        <Label>Time</Label>
        <div style={chipRow}>
          {TIME_SLOTS.map(s => (
            <button key={s.h} onClick={() => setSlotH(s.h)} style={chip(slotH === s.h, '#0f766e')}>
              {s.label}
            </button>
          ))}
        </div>

        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="What's the return for? (optional)"
          style={input} />

        {error && <div style={errBox}>{error}</div>}

        <button onClick={scheduleReturn} disabled={!ready} style={confirmBtn(ready)}>
          {busy ? 'Scheduling…'
            : ready ? `Schedule return — ${tech.name}, ${days[dayIdx].label}`
            : 'Pick a tech and a day'}
        </button>
        <button onClick={onCancel} disabled={busy} style={cancelBtn}>Cancel</button>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, margin: '12px 0 6px' }}>{children}</div>;
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000,
};
const sheet = {
  width: '100%', maxWidth: 520, background: '#fff',
  borderTopLeftRadius: 20, borderTopRightRadius: 20,
  padding: '12px 18px 24px', boxShadow: '0 -8px 30px rgba(0,0,0,0.2)',
  maxHeight: '88vh', overflowY: 'auto',
};
const grabber = { width: 40, height: 4, borderRadius: 2, background: '#cbd5e1', margin: '0 auto 12px' };
const chipRow = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const chip = (active, color) => ({
  padding: '8px 14px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  border: `1.5px solid ${active ? color : '#e2e8f0'}`,
  background: active ? color : '#fff',
  color: active ? '#fff' : '#334155',
});
const input = {
  width: '100%', marginTop: 14, padding: '10px 12px', borderRadius: 10,
  border: '1.5px solid #e2e8f0', fontSize: 14, boxSizing: 'border-box',
};
const errBox = { marginTop: 10, padding: 10, borderRadius: 10, background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#b91c1c', fontSize: 13 };
const confirmBtn = (ready) => ({
  width: '100%', marginTop: 16, padding: '14px', borderRadius: 12, border: 'none',
  fontSize: 15, fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed',
  background: ready ? '#0f766e' : '#e2e8f0', color: ready ? '#fff' : '#94a3b8',
});
const cancelBtn = {
  width: '100%', marginTop: 8, padding: '12px', borderRadius: 12,
  border: 'none', background: 'transparent', color: '#64748b', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
