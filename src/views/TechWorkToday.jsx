import { useState, useEffect, useCallback } from 'react';
import { CALENDARS, getWorkViewCalendars } from '../config/calendars.js';
import TimeEntryBlock, { emptyTimeEntry, isValidTimeEntry, timeEntryToPayload } from '../components/TimeEntryBlock.jsx';
import CustomerLookup from '../components/CustomerLookup.jsx';
import { timeEntriesApi, returnCardsApi } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

const TECH_CAL_MAP = {
  'Austin':  CALENDARS.AUSTIN,  'austin':  CALENDARS.AUSTIN,
  'drhservicetech1@gmail.com':      CALENDARS.AUSTIN,
  'austin@drhsecurityservices.com': CALENDARS.AUSTIN,
  'JR':  CALENDARS.JR, 'jr':  CALENDARS.JR,
  'jr@drhsecurityservices.com':     CALENDARS.JR,
  'Brian': CALENDARS.TECH3, 'brian': CALENDARS.TECH3,
  'brian@drhsecurityservices.com':  CALENDARS.TECH3,
  'Shana': CALENDARS.SHANA, 'shana': CALENDARS.SHANA,
  'shanaparks@drhsecurityservices.com': CALENDARS.SHANA,
};

const HARD_SKIP = ['[BILLED]', '[IGNORED]', '[IGNORE]'];

function cleanTitle(title) {
  return (title || '').replace(/\s*\[.*?\]/g, '').trim();
}

function getTab(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('[COMPLETED]') || t.includes('[TO BILL]')) return 'billit';
  if (t.includes('[RETURN') || t.includes('NEEDS RETURN'))  return 'return';
  if (t.includes('[ESTIMATE') || t.includes('ESTIMATE NEEDED') || t.includes('[SALES]')) return 'estimate';
  return 'new';
}

function dayStart(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function dayEnd(d)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }


function isProjectLike(title = '', description = '') {
  const t = `${title} ${description}`.toLowerCase();
  return [
    'install', 'project', 'phase', 'day 1', 'day 2', 'rough-in',
    'trim out', 'trim-out', 'wire pull', 'camera install', 'access control install'
  ].some(k => t.includes(k));
}

const TABS = [
  { key: 'new',      label: 'New',      emoji: '🆕', color: '#1a8a8a' },
  { key: 'return',   label: 'Return',   emoji: '🔄', color: '#d97706' },
  { key: 'estimate', label: 'Estimate', emoji: '💰', color: '#7c3aed' },
  { key: 'billit',   label: 'Bill It',  emoji: '✅', color: '#1B2A4A' },
];

export default function TechWorkToday({ accessToken, userEmail, userName, onBack, showAllTechs = false }) {
  const today = dayStart(new Date());
  const [offset, setOffset]     = useState(0);
  const [allEvents, setAll]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setTab]     = useState('new');
  const [selected, setSelected] = useState(null);
  const [notes, setNotes]       = useState('');
  const [acting, setActing]     = useState(false);

  // NEW: time entry widget state
  const [timeEntry, setTimeEntry] = useState(emptyTimeEntry());
  // NEW: linked customer for the currently selected event
  const [linkedCustomer, setLinkedCustomer] = useState(null);
  // NEW: return-reason input (required when disposition is "return")
  const [returnReason, setReturnReason] = useState('');


  // Single tech calendar OR all techs for operators
  const techCalId = TECH_CAL_MAP[userEmail?.toLowerCase()] || TECH_CAL_MAP[userName] || CALENDARS.AUSTIN;

  const viewDate = new Date(today);
  viewDate.setDate(today.getDate() + offset);

  const dayLabel = () => {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    if (offset === -1) return 'Yesterday';
    return viewDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const d = new Date(today); d.setDate(today.getDate() + offset);
    const params = new URLSearchParams({
      timeMin: dayStart(d).toISOString(), timeMax: dayEnd(d).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '100'
    });

    // Per-user list: which tech calendars show up in this user's Work view.
    // Operators see Austin + JR + Brian. Austin sees his own + Brian's.
    // JR sees JR. Brian sees Brian. (Defined in config/calendars.js)
    const workCals = getWorkViewCalendars(userEmail);
    // Fallback: if no rule matched (unknown user), show their own tech calendar
    const techCalendars = workCals.length > 0
      ? workCals
      : [{ id: techCalId, name: null }];

    const calIds = techCalendars.map(c => c.id);
    const calNameById = Object.fromEntries(techCalendars.map(c => [c.id, c.name]));
    const fetches = calIds.map(calId =>
      fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).then(r => r.json())
        .then(data => (data.items || []).map(ev => ({
          ...ev,
          _calId: calId,
          _techName: calNameById[calId] || null
        })))
        .catch(() => [])
    );

    const results = await Promise.all(fetches);
    const merged  = results.flat();

    const items = merged.filter(ev => {
      if (ev.status === 'cancelled') return false;
      // Skip events with no title or empty title
      if (!ev.summary || !ev.summary.trim()) return false;
      const t = (ev.summary || '').toUpperCase();
      return !HARD_SKIP.some(s => t.includes(s.toUpperCase()));
    }).map(ev => ({
      id: ev.id,
      calendarId: ev._calId,
      techName: ev._techName,
      title: ev.summary || '(no title)',
      start: ev.start?.dateTime ? new Date(ev.start.dateTime) : new Date((ev.start?.date || '') + 'T08:00:00'),
      end:   ev.end?.dateTime   ? new Date(ev.end.dateTime)   : new Date((ev.end?.date   || '') + 'T09:00:00'),
      location: ev.location || '',
      description: ev.description || '',
      isAllDay: !ev.start?.dateTime,
      tab: getTab(ev.summary || ''),
    })).sort((a, b) => a.start - b.start);

    setAll(items);
    setLoading(false);
  }, [accessToken, userEmail, techCalId, offset, showAllTechs]);

  useEffect(() => { load(); }, [load]);

  const events = allEvents.filter(e => e.tab === activeTab);

  const openDetail = (ev) => {
    setSelected(ev);
    setNotes('');
    setTimeEntry(emptyTimeEntry());
    setLinkedCustomer(null);
    setReturnReason('');
  };
  const closeSheet = () => {
    setSelected(null);
    setNotes('');
    setActing(false);
    setTimeEntry(emptyTimeEntry());
    setLinkedCustomer(null);
    setReturnReason('');
    // Scroll the page back up so the user sees the refreshed list,
    // not the whitespace where the just-finished item used to be.
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const selectedDate = selected?.start || new Date();
  const timeValid = isValidTimeEntry(timeEntry, selectedDate);
  const hasLinkedCustomer = !!linkedCustomer?.id;
  // Every finish action requires a time entry AND a linked customer.
  const canFinish = timeValid && hasLinkedCustomer && !acting;

  // Calendar PATCH — title only. Description is owned by CustomerLookup (CUSTOMER_ID tag).
  const patchEventTitle = async (ev, newTitle) => {
    await fetch(`${GCAL}/calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: newTitle }),
    });
  };

  // Single Supabase write that every finish action routes through.
  const writeTimeEntry = async (disposition) => {
    const tPayload = timeEntryToPayload(timeEntry, selectedDate);
    return timeEntriesApi.create({
      customer_id: linkedCustomer?.id || null,
      customer_name_raw: linkedCustomer?.name || cleanTitle(selected.title) || null,
      calendar_event_id: selected.id,
      calendar_id: selected.calendarId,
      event_title: selected.title,
      event_start: selected.start?.toISOString?.() || null,
      tech_email: userEmail || null,
      tech_name: selected.techName || userName || null,
      time_in: tPayload.time_in,
      time_out: tPayload.time_out,
      total_minutes: tPayload.total_minutes,
      entry_method: tPayload.entry_method,
      disposition,
      notes: notes.trim() || null,
    });
  };

  // ── BILL IT ─── closes job. No calendar duplication. Row in time_entries drives billing queue.
  const handleBillIt = async () => {
    if (!canFinish || !selected) return;
    setActing(true);
    try {
      const name = cleanTitle(selected.title);
      await patchEventTitle(selected, name + ' [COMPLETED]');
      await writeTimeEntry('bill_it');
      setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [COMPLETED]', tab: 'billit' } : e));
      closeSheet();
    } catch (e) {
      console.error('Bill It failed:', e);
      alert('Failed to save: ' + (e.message || 'unknown error'));
      setActing(false);
    }
  };

  // ── RETURN ─── spawns a return_card (no sibling calendar event).
  const handleReturn = async () => {
    if (!canFinish || !selected) return;
    if (!returnReason.trim()) { alert('Please add a reason for the return visit.'); return; }
    setActing(true);
    try {
      const name = cleanTitle(selected.title);
      await patchEventTitle(selected, name + ' [RETURN NEEDED]');
      const entry = await writeTimeEntry('return');
      await returnCardsApi.create({
        customer_id: linkedCustomer?.id || null,
        customer_name_raw: linkedCustomer?.name || name || null,
        original_event_id: selected.id,
        original_calendar_id: selected.calendarId,
        original_event_title: selected.title,
        original_location: selected.location || null,
        flagged_by_email: userEmail || null,
        flagged_by_name: selected.techName || userName || null,
        reason: returnReason.trim(),
        time_entry_id: entry?.id || null,
      });
      setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [RETURN NEEDED]', tab: 'return' } : e));
      closeSheet();
    } catch (e) {
      console.error('Return failed:', e);
      alert('Failed to save: ' + (e.message || 'unknown error'));
      setActing(false);
    }
  };

  // ── IN PROGRESS ─── project stays open, logs today's time entry.
  const handleProjectProgress = async () => {
    if (!canFinish || !selected) return;
    setActing(true);
    try {
      const name = cleanTitle(selected.title);
      await patchEventTitle(selected, name + ' [IN PROGRESS]');
      await writeTimeEntry('in_progress');
      setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [IN PROGRESS]', tab: 'new' } : e));
      closeSheet();
    } catch (e) {
      console.error('In Progress failed:', e);
      alert('Failed to save: ' + (e.message || 'unknown error'));
      setActing(false);
    }
  };

  // ── ESTIMATE NEEDED ─── flag for sales. Still TBD: also push to bill-it + create sales task.
  // For now: just marks the event and writes the time entry.
  const handleEstimate = async () => {
    if (!canFinish || !selected) return;
    setActing(true);
    try {
      const name = cleanTitle(selected.title);
      await patchEventTitle(selected, name + ' [ESTIMATE NEEDED]');
      await writeTimeEntry('estimate');
      setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [ESTIMATE NEEDED]', tab: 'estimate' } : e));
      closeSheet();
    } catch (e) {
      console.error('Estimate failed:', e);
      alert('Failed to save: ' + (e.message || 'unknown error'));
      setActing(false);
    }
  };

  const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const extractPhone = (desc) => {
    const m = (desc || '').match(/(?:Phone|Ph|Tel|Call)?:?\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i);
    return m ? m[1] : null;
  };

  const tabCounts   = {};
  TABS.forEach(t => { tabCounts[t.key] = allEvents.filter(e => e.tab === t.key).length; });
  const activeTabObj = TABS.find(t => t.key === activeTab);
  
  const headerTitle = showAllTechs ? "Tech Jobs (Austin + JR)" : `${userName}'s Jobs`;

  return (
    <div style={{ minHeight: '100vh', minHeight: '100dvh', background: '#0f1729', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 500, minHeight: '100vh', minHeight: '100dvh', background: '#f8f9fa', color: '#1B2A4A', fontFamily: "'Inter', -apple-system, sans-serif", boxShadow: '0 0 24px rgba(0,0,0,0.15)' }}>

      {/* Header */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0' }}>
          <button onClick={onBack}
            style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 8, color: '#6b7280', padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
            ← Home
          </button>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1B2A4A' }}>{headerTitle}</div>
          <button onClick={load}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, color: '#6b7280', padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>
            ↻
          </button>
        </div>

        {/* Day nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>
          <button onClick={() => setOffset(o => o - 1)}
            style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 18, cursor: 'pointer', color: '#374151' }}>‹</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: offset === 0 ? '#1a8a8a' : '#1B2A4A' }}>{dayLabel()}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              {viewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {!loading && ' · ' + allEvents.length + ' total'}
            </div>
          </div>
          <button onClick={() => setOffset(o => o + 1)}
            style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 18, cursor: 'pointer', color: '#374151' }}>›</button>
        </div>

        {/* Four Tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: '1px solid #e5e7eb' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setTab(tab.key)}
              style={{
                background: 'none', border: 'none',
                borderBottom: activeTab === tab.key ? '3px solid ' + tab.color : '3px solid transparent',
                padding: '10px 4px 8px', cursor: 'pointer', textAlign: 'center',
                color: activeTab === tab.key ? tab.color : '#9ca3af',
                fontWeight: activeTab === tab.key ? 700 : 400, fontSize: 12,
              }}>
              <div style={{ fontSize: 16, marginBottom: 2 }}>{tab.emoji}</div>
              <div>{tab.label}</div>
              {tabCounts[tab.key] > 0 && (
                <div style={{
                  display: 'inline-block', marginTop: 2,
                  background: activeTab === tab.key ? tab.color : '#e5e7eb',
                  color: activeTab === tab.key ? '#fff' : '#6b7280',
                  borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px',
                }}>{tabCounts[tab.key]}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading && <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>Loading...</div>}

        {!loading && events.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{activeTab === 'new' && offset === 0 ? '🎉' : '📭'}</div>
            <div style={{ color: '#6b7280', fontSize: 16, fontWeight: 600 }}>
              {activeTab === 'new' && offset === 0 ? 'No new jobs today' : 'Nothing in ' + activeTabObj?.label}
            </div>
          </div>
        )}

        {!loading && events.map((ev, i) => {
          const name  = cleanTitle(ev.title);
          const phone = extractPhone(ev.description);
          const now   = new Date();
          const isNow = ev.start <= now && ev.end >= now;
          const techColor = ev.techName === 'Austin' ? '#3b82f6' : ev.techName === 'JR' ? '#22c55e' : null;

          return (
            <div key={ev.id} onClick={() => openDetail(ev)}
              style={{
                background: '#ffffff',
                borderRadius: i === 0 && events.length === 1 ? 12 : i === 0 ? '12px 12px 0 0' : i === events.length - 1 ? '0 0 12px 12px' : 0,
                padding: '14px 16px', cursor: 'pointer',
                borderBottom: i < events.length - 1 ? '1px solid #f3f4f6' : 'none',
                borderLeft: '3px solid ' + (techColor || (isNow ? '#1a8a8a' : activeTabObj?.color || '#e5e7eb')),
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isNow && <div style={{ color: '#1a8a8a', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>In Progress</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  {ev.techName && (
                    <span style={{ 
                      background: techColor + '20', 
                      color: techColor, 
                      fontSize: 10, 
                      fontWeight: 700, 
                      padding: '2px 6px', 
                      borderRadius: 4 
                    }}>
                      {ev.techName}
                    </span>
                  )}
                  <span style={{ fontWeight: 600, fontSize: 15, color: '#1B2A4A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name || '(no name)'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>
                  {ev.isAllDay ? 'All day' : fmtTime(ev.start) + ' – ' + fmtTime(ev.end)}
                  {ev.location && ' · ' + ev.location.split(',')[0]}
                </div>
                {phone && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>📞 {phone}</div>}
              </div>
              <div style={{ color: '#d1d5db', fontSize: 18, marginLeft: 8 }}>›</div>
            </div>
          );
        })}
      </div>

      {/* Bottom Sheet */}
      {selected && (
        <div onClick={closeSheet}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#ffffff', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', width: '100%', maxWidth: 480, maxHeight: '88vh', maxHeight: '88dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

            <div style={{ width: 36, height: 4, background: '#e5e7eb', borderRadius: 2, margin: '0 auto 18px' }} />

            <div style={{ fontWeight: 700, fontSize: 20, color: '#1B2A4A', marginBottom: 4 }}>
              {cleanTitle(selected.title)}
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 18 }}>
              {selected.isAllDay ? 'All day' : fmtTime(selected.start) + ' – ' + fmtTime(selected.end)}
            </div>

            {(selected.location || extractPhone(selected.description)) && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                {selected.location && (
                  <a href={'https://maps.google.com/?q=' + encodeURIComponent(selected.location)}
                    target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, color: '#2563eb', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                    🗺️ Navigate
                  </a>
                )}
                {extractPhone(selected.description) && (
                  <a href={'tel:' + (extractPhone(selected.description) || '').replace(/\D/g, '')}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#16a34a', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                    📞 Call
                  </a>
                )}
              </div>
            )}

            <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>Address</div>
              <div style={{ fontSize: 14, color: '#374151' }}>
                {linkedCustomer?.address || selected.location || <span style={{ color: '#9ca3af' }}>(link a customer to auto-fill)</span>}
              </div>
            </div>

            {selected.description && (
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>Job Details</div>
                <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {selected.description
                    .replace(/📱.*|Open in JUC-E.*/g, '')
                    .replace(/CUSTOMER_ID:\s*[A-Za-z0-9\-_]+\s*/g, '')
                    .trim()}
                </div>
              </div>
            )}

            {/* Customer link (required) */}
            <CustomerLookup
              event={selected}
              accessToken={accessToken}
              value={linkedCustomer}
              onChange={setLinkedCustomer}
            />

            {/* Time entry (required) */}
            <TimeEntryBlock
              value={timeEntry}
              onChange={setTimeEntry}
              eventDate={selectedDate}
              required
            />

            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Add notes (what was done, what's needed...)"
              style={{ width: '100%', padding: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, color: '#1B2A4A', fontSize: 14, resize: 'none', height: 80, marginBottom: 14, boxSizing: 'border-box', fontFamily: 'inherit' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Gate hint */}
              {!canFinish && (
                <div style={{
                  padding: '10px 12px', background: '#fffbeb', border: '1px solid #fcd34d',
                  borderRadius: 10, fontSize: 12, color: '#92400e', textAlign: 'center',
                }}>
                  {!hasLinkedCustomer && !timeValid && 'Link a customer and add time to finish.'}
                  {!hasLinkedCustomer && timeValid && 'Link a customer to finish.'}
                  {hasLinkedCustomer && !timeValid && 'Add a time entry to finish.'}
                </div>
              )}

              {selected.tab !== 'billit' && !isProjectLike(selected.title, selected.description) && (
                <button onClick={handleBillIt} disabled={!canFinish}
                  style={{ padding: '15px', background: canFinish ? '#1B2A4A' : '#cbd5e1', border: 'none', borderRadius: 12, color: '#ffffff', fontSize: 15, fontWeight: 700, cursor: canFinish ? 'pointer' : 'not-allowed' }}>
                  {acting ? 'Saving...' : '✅ Done — Bill It'}
                </button>
              )}

              {selected.tab === 'new' && isProjectLike(selected.title, selected.description) && (
                <>
                  <button onClick={handleProjectProgress} disabled={!canFinish}
                    style={{ padding: '15px', background: canFinish ? '#ecfeff' : '#f1f5f9', border: `1.5px solid ${canFinish ? '#67e8f9' : '#cbd5e1'}`, borderRadius: 12, color: canFinish ? '#155e75' : '#94a3b8', fontSize: 15, fontWeight: 700, cursor: canFinish ? 'pointer' : 'not-allowed' }}>
                    🛠️ Done for Today — Keep In Progress
                  </button>
                  <ReturnButtonWithReason
                    canFinish={canFinish} acting={acting}
                    reason={returnReason} setReason={setReturnReason}
                    onConfirm={handleReturn}
                  />
                  <button onClick={handleBillIt} disabled={!canFinish}
                    style={{ padding: '15px', background: canFinish ? '#1B2A4A' : '#cbd5e1', border: 'none', borderRadius: 12, color: '#ffffff', fontSize: 15, fontWeight: 700, cursor: canFinish ? 'pointer' : 'not-allowed' }}>
                    {acting ? 'Saving...' : '✅ Done — Bill It'}
                  </button>
                </>
              )}

              {selected.tab === 'new' && !isProjectLike(selected.title, selected.description) && (
                <>
                  <ReturnButtonWithReason
                    canFinish={canFinish} acting={acting}
                    reason={returnReason} setReason={setReturnReason}
                    onConfirm={handleReturn}
                  />
                  <button onClick={handleEstimate} disabled={!canFinish}
                    style={{ padding: '15px', background: canFinish ? '#f5f3ff' : '#f1f5f9', border: `1.5px solid ${canFinish ? '#c4b5fd' : '#cbd5e1'}`, borderRadius: 12, color: canFinish ? '#5b21b6' : '#94a3b8', fontSize: 15, fontWeight: 700, cursor: canFinish ? 'pointer' : 'not-allowed' }}>
                    💰 Needs Estimate
                  </button>
                </>
              )}
              <button onClick={closeSheet}
                style={{ padding: '13px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 12, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ── ReturnButtonWithReason ─────────────────────────────────────
// Inline-expands a reason field before firing onConfirm, since
// every return_card needs a reason to be useful in the Scheduler view.
function ReturnButtonWithReason({ canFinish, acting, reason, setReason, onConfirm }) {
  const [expanded, setExpanded] = useState(false);
  const ready = canFinish && reason.trim().length > 0;

  if (!expanded) {
    return (
      <button
        onClick={() => canFinish && setExpanded(true)}
        disabled={!canFinish}
        style={{
          padding: '15px',
          background: canFinish ? '#fffbeb' : '#f1f5f9',
          border: `1.5px solid ${canFinish ? '#fbbf24' : '#cbd5e1'}`,
          borderRadius: 12,
          color: canFinish ? '#92400e' : '#94a3b8',
          fontSize: 15, fontWeight: 700,
          cursor: canFinish ? 'pointer' : 'not-allowed',
        }}>
        🔄 Needs Return Visit
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>
        Return reason (required)
      </div>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="e.g. needs battery, customer not home, waiting on part..."
        autoFocus
        rows={2}
        style={{
          padding: 10, border: '1px solid #fcd34d', borderRadius: 8,
          fontSize: 13, resize: 'none', fontFamily: 'inherit', background: '#fff',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setExpanded(false); setReason(''); }}
          style={{ flex: 1, padding: 10, background: '#fff', border: '1px solid #fcd34d', borderRadius: 8, color: '#92400e', fontSize: 13, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={onConfirm} disabled={!ready || acting}
          style={{
            flex: 2, padding: 10,
            background: ready ? '#d97706' : '#e5e7eb',
            color: ready ? '#fff' : '#9ca3af',
            border: 'none', borderRadius: 8,
            fontSize: 13, fontWeight: 700,
            cursor: ready && !acting ? 'pointer' : 'not-allowed',
          }}>
          {acting ? 'Saving...' : 'Confirm Return'}
        </button>
      </div>
    </div>
  );
}
