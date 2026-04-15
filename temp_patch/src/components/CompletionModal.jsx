// ============================================
// JUC-E — End of Job Completion Modal
// ============================================
// Triggered when deep link ?cal=X&job=Y is opened
// Tech picks: COMPLETED | RETURN | SALES OPP
// Writes to juce_job_status localStorage
// Patches GCal event title with [STATUS]

import { useState, useEffect } from 'react';
import { TECH_COLORS } from '../config/calendars.js';

const STATUS_KEY = 'juce_job_status';

const STATUS_OPTIONS = [
  {
    key: 'COMPLETED',
    label: '✅ COMPLETED',
    sub: 'Job is done',
    color: '#22c55e',
    dark: '#052e16',
    border: '#16a34a',
    emoji: '✅',
  },
  {
    key: 'RETURN',
    label: '🔄 RETURN',
    sub: 'Need to come back',
    color: '#f59e0b',
    dark: '#2d1a00',
    border: '#d97706',
    emoji: '🔄',
  },
  {
    key: 'SALES OPP',
    label: '💰 SALES OPP',
    sub: 'Estimate or upsell opportunity',
    color: '#a78bfa',
    dark: '#1a0533',
    border: '#7c3aed',
    emoji: '💰',
  },
];

export default function CompletionModal({ calendarId, eventId, accessToken, userEmail, onDone }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [chosen, setChosen] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!calendarId || !eventId || !accessToken) { setLoading(false); return; }
    fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then(r => r.json())
      .then(data => { setEvent(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [calendarId, eventId, accessToken]);

  const submit = async (statusOption) => {
    setChosen(statusOption.key);
    setSubmitting(true);

    const title = event?.summary || '(unknown job)';
    const stripped = title.replace(/^\[.*?\]\s*/, '').trim();
    const newTitle = `[${statusOption.key}] ${stripped}`;

    // 1. Patch GCal event title
    if (accessToken && calendarId && eventId) {
      try {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary: newTitle }),
          }
        );
      } catch (e) { console.warn('GCal patch failed:', e); }
    }

    // 2. Write to juce_job_status
    const existing = JSON.parse(localStorage.getItem(STATUS_KEY) || '[]');
    existing.unshift({
      id: `js_${Date.now()}`,
      created_at: new Date().toISOString(),
      status: statusOption.key,
      emoji: statusOption.emoji,
      title: stripped,
      calendarId,
      eventId,
      calendarName: event?.organizer?.displayName || '',
      start: event?.start?.dateTime || event?.start?.date || '',
      location: event?.location || '',
      notes: notes.trim(),
      // Sales flow
      salesStage: statusOption.key === 'SALES OPP' ? 'estimate_needed' : null,
      // Billing flow
      billed: false,
      billedAt: null,
    });
    localStorage.setItem(STATUS_KEY, JSON.stringify(existing));

    setSubmitting(false);
    setDone(true);
    setTimeout(() => { if (onDone) onDone(); }, 2200);
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0f1e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#64748b', fontSize: 16 }}>Loading job…</div>
    </div>
  );

  if (done) return (
    <div style={{ minHeight: '100vh', background: '#0a0f1e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 72 }}>{STATUS_OPTIONS.find(s => s.key === chosen)?.emoji}</div>
      <div style={{ color: STATUS_OPTIONS.find(s => s.key === chosen)?.color, fontSize: 28, fontWeight: 900 }}>
        {chosen}
      </div>
      <div style={{ color: '#64748b', fontSize: 14 }}>Status saved. Good work.</div>
    </div>
  );

  const title = event?.summary?.replace(/^\[.*?\]\s*/, '').trim() || '(unknown job)';
  const startDate = event?.start?.dateTime || event?.start?.date;
  const formattedDate = startDate
    ? new Date(startDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1e', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ textAlign: 'center', paddingTop: 12 }}>
        <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          End of Job
        </div>
        <div style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 8 }}>
          {title}
        </div>
        {formattedDate && (
          <div style={{ color: '#3b82f6', fontSize: 13, fontWeight: 600 }}>📅 {formattedDate}</div>
        )}
        {event?.location && (
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>📍 {event.location}</div>
        )}
      </div>

      <div style={{ color: '#475569', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
        What happened?
      </div>

      {/* Big status buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {STATUS_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => !submitting && submit(opt)}
            disabled={submitting}
            style={{
              padding: '22px 20px', borderRadius: 16,
              background: chosen === opt.key ? opt.color : opt.dark,
              border: `2px solid ${chosen === opt.key ? opt.color : opt.border}`,
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              transition: 'all 0.15s', opacity: submitting && chosen !== opt.key ? 0.4 : 1,
              transform: chosen === opt.key ? 'scale(1.02)' : 'scale(1)',
            }}
          >
            <div style={{ fontSize: 32 }}>{opt.emoji}</div>
            <div style={{ color: chosen === opt.key ? '#fff' : opt.color, fontSize: 20, fontWeight: 900 }}>
              {opt.key}
            </div>
            <div style={{ color: chosen === opt.key ? 'rgba(255,255,255,0.8)' : '#94a3b8', fontSize: 12 }}>
              {opt.sub}
            </div>
          </button>
        ))}
      </div>

      {/* Notes */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional) — parts needed, follow-up details, estimate info…"
        rows={3}
        style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
          color: '#e2e8f0', fontSize: 13, padding: '12px', outline: 'none', resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}
