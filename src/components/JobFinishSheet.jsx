// ============================================
// JobFinishSheet — canonical "tech finishes a job" UI
// ============================================
// One bottom sheet, four dispositions, four canonical tags:
//   • [BILL IT]      — disposition: 'bill_it'
//   • [RETURN]       — disposition: 'return' (also writes a return_card)
//   • [IN PROGRESS]  — disposition: 'in_progress' (multi-day work, stays open)
//   • [ESTIMATE]     — disposition: 'estimate' (sales handoff)
//
// REPLACES (deleted): CompletionModal.jsx, JobCompleteModal.jsx, TimeCaptureModal.jsx
//
// Required gates: linked customer + valid time entry. Return also requires a reason.
// Writes ONE row to time_entries; for 'return' also writes ONE row to return_cards.
// Patches the calendar event TITLE only (description is owned by CustomerLookup).
//
// Props:
//   event           { id, title, calendarId, start, end, description, location, techName }
//   accessToken     Google OAuth bearer (required to PATCH calendar)
//   userEmail       signed-in user's email (becomes time_entry.tech_email)
//   userName        signed-in user's display name (fallback for tech_name)
//   prefillCustomer optional pre-linked customer (skips the lookup if provided)
//   onFinished      called after a successful disposition: (disposition, newTitle) => void
//   onCancel        called when the user dismisses the sheet
//   mode            optional; 'full' (default) shows all 4 buttons. 'bill-only' shows only Bill It.
//   inline          optional; when true, renders JUST the form (no overlay, no header) for use
//                   inside an existing sheet (e.g. TechWorkToday's rich detail sheet).

import { useState, useEffect } from 'react';
import { timeEntriesApi, returnCardsApi } from '../services/supabase.js';
import TimeEntryBlock, { emptyTimeEntry, isValidTimeEntry, timeEntryToPayload } from './TimeEntryBlock.jsx';
import CustomerLookup from './CustomerLookup.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// Canonical tags. Parsers in Billing/Queue/Board/Scheduler accept these PLUS legacy
// synonyms ([COMPLETED], [TO BILL], [RETURN NEEDED], etc.) for backward compatibility.
const TAG = {
  bill_it:     '[BILL IT]',
  return:      '[RETURN]',
  in_progress: '[IN PROGRESS]',
  estimate:    '[ESTIMATE]',
};

// Strip any existing leading/trailing tags from the title before applying a new one.
function cleanTitle(title) {
  return (title || '').replace(/\s*\[.*?\]/g, '').trim();
}

export default function JobFinishSheet({
  event,
  accessToken,
  userEmail,
  userName,
  prefillCustomer = null,
  onFinished,
  onCancel,
  mode = 'full',
  inline = false,
}) {
  const [notes, setNotes]               = useState('');
  const [materials, setMaterials]       = useState('');
  const [timeEntry, setTimeEntry]       = useState(emptyTimeEntry());
  const [linkedCustomer, setLinkedCust] = useState(prefillCustomer);
  const [returnReason, setReturnReason] = useState('');
  const [returnExpanded, setRetExp]     = useState(false);
  const [acting, setActing]             = useState(false);
  const [error, setError]               = useState('');

  // If the parent passes a different prefill customer mid-life, follow it.
  useEffect(() => { if (prefillCustomer) setLinkedCust(prefillCustomer); }, [prefillCustomer]);

  const eventDate     = event?.start ? new Date(event.start) : new Date();
  const timeValid     = isValidTimeEntry(timeEntry, eventDate);
  const hasCustomer   = !!linkedCustomer?.id;
  const canFinish     = timeValid && hasCustomer && !acting;

  // ── Calendar PATCH ────────────────────────────────────────────────
  // Patches the title and, when the tech left notes/materials, APPENDS them to
  // the event description so the worker's notes live on the calendar — not just
  // in Overwatch. Append-only: never overwrites the existing description.
  const patchTitle = async (newTitle) => {
    const body = { summary: newTitle };

    const noteText = notes.trim();
    const matText  = materials.trim();
    if (noteText || matText) {
      const stamp = new Date()
        .toLocaleString('en-US', {
          timeZone: 'America/Denver',
          month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
        })
        .replace(',', '').replace(' AM', 'a').replace(' PM', 'p');
      const who = event.techName || userName || 'Tech';
      const parts = [];
      if (noteText) parts.push(noteText);
      if (matText)  parts.push(`Materials: ${matText}`);
      const line = `📝 [${stamp} ${who}] ${parts.join(' — ')}`;

      // Read the event's CURRENT description straight from Google so we never
      // clobber the customer-info block (which CustomerLookup owns) — append only.
      let current = event.description || '';
      try {
        const getUrl = `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`;
        const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (getRes.ok) {
          const live = await getRes.json();
          current = live.description || '';
        }
      } catch { /* fall back to the passed-in description */ }

      body.description = current ? `${current}\n${line}` : line;
    }

    const url = `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Calendar patch failed: ${res.status}`);
  };

  // ── Supabase write — every disposition routes through this ────────
  const writeTimeEntry = async (disposition) => {
    const payload = timeEntryToPayload(timeEntry, eventDate);
    return timeEntriesApi.create({
      customer_id:        linkedCustomer?.id || null,
      customer_name_raw:  linkedCustomer?.name || cleanTitle(event.title) || null,
      calendar_event_id:  event.id,
      calendar_id:        event.calendarId,
      event_title:        event.title,
      event_start:        event.start ? new Date(event.start).toISOString() : null,
      tech_email:         userEmail || null,
      tech_name:          event.techName || userName || null,
      time_in:            payload.time_in,
      time_out:           payload.time_out,
      total_minutes:      payload.total_minutes,
      entry_method:       payload.entry_method,
      disposition,
      notes:              notes.trim() || null,
      materials:          materials.trim() || null,
    });
  };

  // ── Disposition handlers ──────────────────────────────────────────
  const finish = async (disposition, extra = {}) => {
    if (!canFinish || !event) return;
    setActing(true);
    setError('');
    try {
      const base = cleanTitle(event.title);
      const newTitle = `${base} ${TAG[disposition]}`;
      await patchTitle(newTitle);
      const entry = await writeTimeEntry(disposition);

      if (disposition === 'return') {
        await returnCardsApi.create({
          customer_id:          linkedCustomer?.id || null,
          customer_name_raw:    linkedCustomer?.name || base || null,
          original_event_id:    event.id,
          original_calendar_id: event.calendarId,
          original_event_title: event.title,
          original_location:    event.location || null,
          flagged_by_email:     userEmail || null,
          flagged_by_name:      event.techName || userName || null,
          reason:               extra.reason || null,
          time_entry_id:        entry?.id || null,
        });
      }

      onFinished?.(disposition, newTitle);
    } catch (e) {
      console.error(`${disposition} failed:`, e);
      setError(e.message || 'Failed to save — try again.');
      setActing(false);
    }
  };

  const handleBillIt   = () => finish('bill_it');
  const handleEstimate = () => finish('estimate');
  const handleProgress = () => finish('in_progress');
  const handleReturn   = () => {
    if (!returnReason.trim()) {
      setError('Please add a reason for the return visit.');
      return;
    }
    finish('return', { reason: returnReason.trim() });
  };

  if (!event) return null;

  // ── The actual form content (customer + time + notes + materials + buttons) ──
  const formContent = (
    <>
      {/* Customer link (required) */}
      <CustomerLookup
        event={event}
        accessToken={accessToken}
        value={linkedCustomer}
        onChange={setLinkedCust}
      />

      {/* Time entry (required) */}
      <TimeEntryBlock
        value={timeEntry}
        onChange={setTimeEntry}
        eventDate={eventDate}
        required
      />

      {/* Notes */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes (what was done, what's needed...)"
        style={textareaStyle}
      />

      {/* Materials */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        🔧 Materials
      </div>
      <textarea
        value={materials}
        onChange={e => setMaterials(e.target.value)}
        placeholder="Parts, supplies, equipment used or needed..."
        style={{ ...textareaStyle, background: '#fffbeb', border: '1px solid #fcd34d' }}
      />

      {/* Gate hint when not ready */}
      {!canFinish && !acting && (
        <div style={hintBox}>
          {!hasCustomer && !timeValid && 'Link a customer and add time to finish.'}
          {!hasCustomer && timeValid && 'Link a customer to finish.'}
          {hasCustomer && !timeValid && 'Add a time entry to finish.'}
        </div>
      )}

      {error && <div style={errorBox}>{error}</div>}

      {/* Disposition buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {mode === 'full' ? (
          <>
            <button onClick={handleProgress} disabled={!canFinish} style={btnInProgress(canFinish)}>
              🛠️ In Progress
            </button>

            <ReturnButtonWithReason
              canFinish={canFinish}
              acting={acting}
              expanded={returnExpanded}
              setExpanded={setRetExp}
              reason={returnReason}
              setReason={setReturnReason}
              onConfirm={handleReturn}
            />

            <button onClick={handleEstimate} disabled={!canFinish} style={btnEstimate(canFinish)}>
              💰 Needs Estimate
            </button>

            <button onClick={handleBillIt} disabled={!canFinish} style={btnBillIt(canFinish)}>
              {acting ? 'Saving…' : '✅ Done — Bill It'}
            </button>
          </>
        ) : (
          <button onClick={handleBillIt} disabled={!canFinish} style={btnBillIt(canFinish)}>
            {acting ? 'Saving…' : '✅ Done — Bill It'}
          </button>
        )}

        <button onClick={onCancel} style={btnCancel}>Cancel</button>
      </div>
    </>
  );

  // Inline mode — caller (e.g. TechWorkToday) provides its own overlay/sheet/header.
  if (inline) return formContent;

  // Standalone mode — render the full overlaid bottom sheet with a basic header.
  return (
    <div style={overlay} onClick={onCancel}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ color: '#1B2A4A', fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
              {cleanTitle(event.title) || '(untitled job)'}
            </div>
            {event.start && (
              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                {new Date(event.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}
                {new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
            )}
            {event.location && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>📍 {event.location}</div>}
          </div>
          <button onClick={onCancel} style={closeBtn}>×</button>
        </div>

        <div style={hr} />

        {formContent}
      </div>
    </div>
  );
}

// ── ReturnButtonWithReason ────────────────────────────────────────
// Inline-expands a reason field before firing onConfirm, since
// every return_card needs a reason to be useful in the Scheduler/Board view.
function ReturnButtonWithReason({ canFinish, acting, expanded, setExpanded, reason, setReason, onConfirm }) {
  const ready = canFinish && reason.trim().length > 0;

  if (!expanded) {
    return (
      <button
        onClick={() => canFinish && setExpanded(true)}
        disabled={!canFinish}
        style={btnReturnCollapsed(canFinish)}
      >
        🔄 Return Visit
      </button>
    );
  }

  return (
    <div style={{ background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Why is a return visit needed?
      </div>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Missing part, customer not home, needs follow-up…"
        autoFocus
        style={{
          width: '100%', padding: 8, fontSize: 13, color: '#1B2A4A',
          background: '#ffffff', border: '1px solid #fcd34d', borderRadius: 8,
          resize: 'none', height: 50, marginBottom: 8, boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setExpanded(false)} style={{ flex: 1, padding: 8, background: 'none', border: '1px solid #fcd34d', borderRadius: 8, color: '#92400e', fontSize: 12, cursor: 'pointer' }}>
          Back
        </button>
        <button onClick={onConfirm} disabled={!ready} style={{
          flex: 2, padding: 8,
          background: ready ? '#d97706' : '#fde68a',
          border: 'none', borderRadius: 8,
          color: ready ? '#ffffff' : '#92400e',
          fontSize: 13, fontWeight: 700,
          cursor: ready ? 'pointer' : 'not-allowed',
        }}>
          {acting ? 'Saving…' : 'Confirm Return'}
        </button>
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 41, 0.75)',
  zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
};
const sheet = {
  background: '#ffffff', borderRadius: '20px 20px 0 0',
  padding: '20px 18px 28px', width: '100%', maxWidth: 480,
  maxHeight: '92vh', overflowY: 'auto',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.2)',
};
const hr = { height: 1, background: '#e5e7eb', margin: '12px 0' };
const closeBtn = {
  background: 'none', border: 'none', color: '#9ca3af',
  fontSize: 24, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
};
const textareaStyle = {
  width: '100%', padding: 10,
  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
  color: '#1B2A4A', fontSize: 14, resize: 'none', height: 60,
  marginBottom: 8, boxSizing: 'border-box', fontFamily: 'inherit',
};
const hintBox = {
  padding: '8px 10px', background: '#fffbeb', border: '1px solid #fcd34d',
  borderRadius: 10, fontSize: 11, color: '#92400e', textAlign: 'center', marginBottom: 4,
};
const errorBox = {
  padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 10, fontSize: 12, color: '#b91c1c', marginBottom: 4,
};
const btnInProgress = (on) => ({
  padding: 12, background: on ? '#ecfeff' : '#f1f5f9',
  border: `1.5px solid ${on ? '#67e8f9' : '#cbd5e1'}`, borderRadius: 10,
  color: on ? '#155e75' : '#94a3b8', fontSize: 14, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnReturnCollapsed = (on) => ({
  padding: 12, background: on ? '#fffbeb' : '#f1f5f9',
  border: `1.5px solid ${on ? '#fbbf24' : '#cbd5e1'}`, borderRadius: 10,
  color: on ? '#92400e' : '#94a3b8', fontSize: 14, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnEstimate = (on) => ({
  padding: 12, background: on ? '#f5f3ff' : '#f1f5f9',
  border: `1.5px solid ${on ? '#c4b5fd' : '#cbd5e1'}`, borderRadius: 10,
  color: on ? '#5b21b6' : '#94a3b8', fontSize: 14, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnBillIt = (on) => ({
  padding: 12, background: on ? '#1B2A4A' : '#cbd5e1', border: 'none',
  borderRadius: 10, color: '#ffffff', fontSize: 14, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnCancel = {
  padding: 10, background: 'none', border: '1px solid #e5e7eb',
  borderRadius: 10, color: '#9ca3af', fontSize: 13, cursor: 'pointer',
};
