import { useState, useEffect, useCallback } from 'react';
import { CALENDARS } from '../config/calendars.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

const TECH_CAL_MAP = {
  'Austin':  CALENDARS.AUSTIN,  'austin':  CALENDARS.AUSTIN,
  'drhservicetech1@gmail.com':      CALENDARS.AUSTIN,
  'austin@drhsecurityservices.com': CALENDARS.AUSTIN,
  'JR':  CALENDARS.JR, 'jr':  CALENDARS.JR,
  'jr@drhsecurityservices.com':     CALENDARS.JR,
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

function formatElapsed(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function parseTimeInput(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60 * 60 * 1000);
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(parseFloat(m[1]) * 60 * 60 * 1000);
  m = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/);
  if (m) return parseInt(m[1], 10) * 60 * 1000;
  m = s.match(/^(\d+)\s*h\s*(\d+)\s*m$/);
  if (m) return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60 * 1000;
  return null;
}

function parseClockOnDate(clock, baseDate) {
  if (!clock) return null;
  const m = String(clock).trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(baseDate);
  d.setHours(h, min, 0, 0);
  return d;
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
  const [timeStartedAt, setTimeStartedAt] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [manualHours, setManualHours] = useState('');
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');


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

    // If showAllTechs, pull Austin + JR; otherwise just the tech's calendar
    const techCalendars = showAllTechs 
      ? [CALENDARS.AUSTIN, CALENDARS.JR]
      : [techCalId];
    
    // Only tech calendars - no queue or admin calendars
    const calIds = techCalendars;
    const fetches = calIds.map(calId =>
      fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).then(r => r.json())
        .then(data => (data.items || []).map(ev => ({ 
          ...ev, 
          _calId: calId,
          _techName: calId === CALENDARS.AUSTIN ? 'Austin' : calId === CALENDARS.JR ? 'JR' : null
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
  }, [accessToken, techCalId, offset, showAllTechs]);

  useEffect(() => { load(); }, [load]);

  const events = allEvents.filter(e => e.tab === activeTab);

  const openDetail = (ev) => { setSelected(ev); setNotes(''); };
  const closeSheet = ()   => {
    setSelected(null);
    setNotes('');
    setActing(false);
    setTimeStartedAt(null);
    setElapsedMs(0);
    setManualHours('');
    setTimeIn('');
    setTimeOut('');
  };

  const startTimer = () => {
    if (!timeStartedAt) setTimeStartedAt(Date.now());
  };

  const pauseTimer = () => {
    if (timeStartedAt) {
      setElapsedMs(prev => prev + (Date.now() - timeStartedAt));
      setTimeStartedAt(null);
    }
  };

  const resetTimer = () => {
    setTimeStartedAt(null);
    setElapsedMs(0);
    setManualHours('');
    setTimeIn('');
    setTimeOut('');
  };

  const computedTimerMs = timeStartedAt ? elapsedMs + (Date.now() - timeStartedAt) : elapsedMs;
  const selectedDate = selected?.start || new Date();
  const timeInDate = parseClockOnDate(timeIn, selectedDate);
  const timeOutDate = parseClockOnDate(timeOut, selectedDate);
  let inOutMs = null;
  if (timeInDate && timeOutDate) {
    let diff = timeOutDate - timeInDate;
    if (diff < 0) diff += 24 * 60 * 60 * 1000;
    inOutMs = diff;
  }
  const manualMs = parseTimeInput(manualHours);
  const effectiveTimeMs = manualMs ?? inOutMs ?? computedTimerMs;


  const patchEvent = async (ev, newTitle, appendDesc) => {
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });
    const timeLines = [];
    if (manualHours.trim()) timeLines.push(`Manual Time: ${manualHours.trim()}`);
    if (timeIn.trim()) timeLines.push(`Time In: ${timeIn.trim()}`);
    if (timeOut.trim()) timeLines.push(`Time Out: ${timeOut.trim()}`);
    if (effectiveTimeMs > 0) timeLines.push(`Total Time: ${formatElapsed(effectiveTimeMs)}`);
    const noteBlock = notes.trim() ? '
Notes: ' + notes.trim() : '';
    const timeBlock = timeLines.length ? '
' + timeLines.join(' • ') : '';
    const newDesc = [ev.description, appendDesc + noteBlock + timeBlock + ' — ' + ts].filter(Boolean).join('

');
    await fetch(`${GCAL}/calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: newTitle, description: newDesc }),
    });
    return newDesc;
  };

  const createEvent = async (calId, title, desc, location) => {
    const d = new Date().toISOString().split('T')[0];
    await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: title, description: desc, location, start: { date: d }, end: { date: d } }),
    });
  };

  const handleBillIt = async () => {
    if (!selected || acting) return;
    setActing(true);
    const name = cleanTitle(selected.title);
    const newDesc = await patchEvent(selected, name + ' [COMPLETED]', '✅ COMPLETED');
    await createEvent(CALENDARS.SALES_ACCOUNTING, name + ' [TO BILL]', newDesc, selected.location);
    setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [COMPLETED]', tab: 'billit' } : e));
    closeSheet();
  };

  const handleReturn = async () => {
    if (!selected || acting) return;
    setActing(true);
    const name = cleanTitle(selected.title);
    const newDesc = await patchEvent(selected, name + ' [RETURN NEEDED]', '🔄 NEEDS RETURN');
    await createEvent(CALENDARS.TENTATIVELY_SCHEDULED, name + ' [RETURN NEEDED]', newDesc, selected.location);
    setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [RETURN NEEDED]', tab: 'return' } : e));
    closeSheet();
  };

  const handleProjectProgress = async () => {
    if (!selected || acting) return;
    setActing(true);
    const name = cleanTitle(selected.title);
    await patchEvent(selected, name + ' [IN PROGRESS]', '🛠️ IN PROGRESS');
    setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [IN PROGRESS]', tab: 'new' } : e));
    closeSheet();
  };

  const handleEstimate = async () => {
    if (!selected || acting) return;
    setActing(true);
    const name = cleanTitle(selected.title);
    const newDesc = await patchEvent(selected, name + ' [ESTIMATE NEEDED]', '💰 ESTIMATE NEEDED');
    await createEvent(CALENDARS.SALES_ACCOUNTING, name + ' [ESTIMATE NEEDED]', newDesc, selected.location);
    setAll(prev => prev.map(e => e.id === selected.id ? { ...e, title: name + ' [ESTIMATE NEEDED]', tab: 'estimate' } : e));
    closeSheet();
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
    <div style={{ minHeight: '100vh', background: '#f8f9fa', color: '#1B2A4A', fontFamily: "'Inter', -apple-system, sans-serif" }}>

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
            style={{ background: '#ffffff', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto' }}>

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

            {selected.location && (
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>Address</div>
                <div style={{ fontSize: 14, color: '#374151' }}>{selected.location}</div>
              </div>
            )}

            {selected.description && (
              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>Job Details</div>
                <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {selected.description.replace(/📱.*|Open in JUC-E.*/g, '').trim()}
                </div>
              </div>
            )}

            <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px', marginBottom: 14, border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Time Entry</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1B2A4A' }}>⏱ {formatElapsed(effectiveTimeMs)}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <input value={manualHours} onChange={e => setManualHours(e.target.value)}
                  placeholder="Total hrs (e.g. 1.5)"
                  style={{ padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
                <input value={timeIn} onChange={e => setTimeIn(e.target.value)}
                  placeholder="Time in 11:30"
                  style={{ padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
                <input value={timeOut} onChange={e => setTimeOut(e.target.value)}
                  placeholder="Time out 1:15"
                  style={{ padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={startTimer}
                  style={{ padding: '10px 12px', background: '#ecfeff', border: '1px solid #67e8f9', borderRadius: 8, color: '#155e75', fontWeight: 700, cursor: 'pointer' }}>Start</button>
                <button onClick={pauseTimer}
                  style={{ padding: '10px 12px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, color: '#9a3412', fontWeight: 700, cursor: 'pointer' }}>Pause</button>
                <button onClick={resetTimer}
                  style={{ padding: '10px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, color: '#4b5563', fontWeight: 700, cursor: 'pointer' }}>Reset</button>
              </div>
            </div>

            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Add notes (what was done, what's needed...)"
              style={{ width: '100%', padding: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, color: '#1B2A4A', fontSize: 14, resize: 'none', height: 80, marginBottom: 14, boxSizing: 'border-box', fontFamily: 'inherit' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {selected.tab !== 'billit' && !isProjectLike(selected.title, selected.description) && (
                <button onClick={handleBillIt} disabled={acting}
                  style={{ padding: '15px', background: '#1B2A4A', border: 'none', borderRadius: 12, color: '#ffffff', fontSize: 15, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer' }}>
                  {acting ? 'Saving...' : '✅ Done — Bill It'}
                </button>
              )}

              {selected.tab === 'new' && isProjectLike(selected.title, selected.description) && (
                <>
                  <button onClick={handleProjectProgress} disabled={acting}
                    style={{ padding: '15px', background: '#ecfeff', border: '1.5px solid #67e8f9', borderRadius: 12, color: '#155e75', fontSize: 15, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer' }}>
                    🛠️ Done for Today — Keep In Progress
                  </button>
                  <button onClick={handleReturn} disabled={acting}
                    style={{ padding: '15px', background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 12, color: '#92400e', fontSize: 15, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer' }}>
                    🔄 Needs Return Visit
                  </button>
                  <button onClick={handleBillIt} disabled={acting}
                    style={{ padding: '15px', background: '#1B2A4A', border: 'none', borderRadius: 12, color: '#ffffff', fontSize: 15, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer' }}>
                    {acting ? 'Saving...' : '✅ Done — Bill It'}
                  </button>
                </>
              )}

              {selected.tab === 'new' && !isProjectLike(selected.title, selected.description) && (
                <>
                  <button onClick={handleReturn} disabled={acting}
                    style={{ padding: '15px', background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 12, color: '#92400e', fontSize: 15, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer' }}>
                    🔄 Needs Return Visit
                  </button>
                  <button onClick={handleEstimate} disabled={acting}
                    style={{ padding: '15px', background: '#f5f3ff', border: '1.5px solid #c4b5fd', borderRadius: 12, color: '#5b21b6', fontSize: 15, fontWeight: 700, cursor: acting ? 'not-allowed' : 'pointer' }}>
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
  );
}
