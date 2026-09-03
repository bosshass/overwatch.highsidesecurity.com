import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CALENDARS, getWorkViewCalendars } from '../config/calendars.js';
import JobFinishSheet from '../components/JobFinishSheet.jsx';
import { supabase } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// ── DISPOSITION DEADLINE ────────────────────────────────────────────────────
// The scheduled day ends at 6pm; 14 hours later (8am next morning) a
// disposition is overdue. Weekends roll to Monday 8am, so nobody is chased at
// the weekend for Friday's paperwork.
// Dates are parsed by parts: new Date('2026-08-07') is UTC midnight, which is
// the previous evening in Denver and would make everything look a day late.
function dispoDueAt(scheduledDate) {
  if (!scheduledDate) return null;
  const [y, m, d] = String(scheduledDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d, 18, 0, 0, 0);
  due.setHours(due.getHours() + 14);
  while (due.getDay() === 0 || due.getDay() === 6) {
    due.setDate(due.getDate() + 1);
    due.setHours(8, 0, 0, 0);
  }
  return due;
}
const daysLate = (scheduledDate) => {
  const due = dispoDueAt(scheduledDate);
  return due ? Math.floor((Date.now() - due.getTime()) / 86400000) : 0;
};

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
  'Subs': CALENDARS.SUBS, 'subs': CALENDARS.SUBS,
  'subs@drhsecurityservices.com':      CALENDARS.SUBS,
};

const HARD_SKIP = ['[BILLED]', '[IGNORED]', '[IGNORE]'];

function cleanTitle(title) {
  return (title || '').replace(/\s*\[.*?\]/g, '').trim();
}

function getTab(title) {
  const t = (title || '').toUpperCase();
  // Bill-it bucket — accept new canonical [BILL IT] plus legacy [COMPLETED] / [TO BILL]
  if (t.includes('[BILL IT]') || t.includes('[COMPLETED]') || t.includes('[TO BILL]')) return 'billit';
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

// Labels match the shared lane vocabulary (utils/lanes.js). "Bill It" was this
// screen's own phrase for what the rest of the app calls To Bill — same pile,
// two names. Keys, tab logic and data flow are untouched on purpose: this
// screen is half-adopted in the field and the fastest way to lose the other
// half is to move things around under their thumbs.
const TABS = [
  { key: 'new',    label: 'Today',    emoji: '📋', color: '#1a8a8a' },
  { key: 'billit', label: 'To Bill',  emoji: '💵', color: '#1B2A4A' },
];

export default function TechWorkToday({ accessToken, userEmail, userName, onBack, showAllTechs = false }) {
  const navigate = useNavigate();
  const today = dayStart(new Date());
  const [offset, setOffset]     = useState(0);
  // Everything still sitting in `scheduled` past its deadline. This is the
  // first time this view has read the database — it has always been a pure
  // calendar reader, which is exactly why work from other days was invisible.
  const [needNotes, setNeedNotes] = useState([]);
  const [showNeedNotes, setShowNeedNotes] = useState(false);
  const [allEvents, setAll]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setTab]     = useState('new');
  const [selected, setSelected] = useState(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [doneToast, setDoneToast] = useState(null); // { msg, disposition }

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

  const loadNeedNotes = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('jobs')
        .select('id, customer_name, scheduled_date, tech_name, assigned_to')
        .eq('status', 'scheduled')
        .not('scheduled_date', 'is', null)
        .limit(500);
      const late = (data || [])
        .filter(j => { const due = dispoDueAt(j.scheduled_date); return due && Date.now() > due.getTime(); })
        .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
      setNeedNotes(late);
    } catch (e) { console.warn('needs-notes load failed', e); }
  }, []);

  useEffect(() => { loadNeedNotes(); }, [loadNeedNotes]);

  // Jump the day nav to a specific date, so the event and the finish sheet are
  // right there instead of somewhere behind the < button.
  const goToDate = (scheduledDate) => {
    const [y, m, d] = String(scheduledDate).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return;
    const want = new Date(y, m - 1, d); want.setHours(0, 0, 0, 0);
    const now  = new Date();            now.setHours(0, 0, 0, 0);
    setOffset(Math.round((want - now) / 86400000));
    setShowNeedNotes(false);
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

    let items = merged.filter(ev => {
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

    // ── Database-driven disposition override + customer link data ────
    // The calendar title is never tagged with [BILL IT] / [RETURN] / etc.
    // (Sara's explicit rule: status lives in the database, not in calendar
    // titles). That means getTab() above can only return 'new' for every
    // event on a fresh load, so a disposed event re-appears in Today after
    // any refresh. Cross-reference time_entries to get the real disposition
    // and move the event to the correct tab, matching what the tech saw
    // immediately after they saved.
    // Also fetch customer_id via job_assignments so the tech can tap through
    // to the customer's full history without having to search by name.
    if (items.length > 0) {
      try {
        const eventIds = items.map(e => e.id);

        // Run both lookups in parallel — dispositions and customer IDs
        const [{ data: entries }, { data: assignments }] = await Promise.all([
          supabase
            .from('time_entries')
            .select('calendar_event_id, disposition')
            .in('calendar_event_id', eventIds)
            .eq('archived', false),
          supabase
            .from('job_assignments')
            .select('calendar_event_id, job:job_id(customer_id)')
            .in('calendar_event_id', eventIds)
            .not('job_id', 'is', null),
        ]);

        // Most-recent-first: if the same event has two entries (e.g. a
        // correction), take the last one written. The query returns them in
        // insertion order; iterate reverse so the last write wins.
        const dispoByEventId = {};
        for (const e of [...(entries || [])].reverse()) {
          if (e.calendar_event_id) dispoByEventId[e.calendar_event_id] = e.disposition;
        }

        const customerIdByEventId = {};
        for (const a of assignments || []) {
          if (a.calendar_event_id && a.job?.customer_id) {
            customerIdByEventId[a.calendar_event_id] = a.job.customer_id;
          }
        }

        items = items.map(ev => {
          const d = dispoByEventId[ev.id];
          const tab = d
            ? (d === 'bill_it' ? 'billit' : d === 'return' ? 'return' : d === 'estimate' ? 'estimate' : ev.tab)
            : ev.tab; // in_progress and blocked stay in Today tab
          return {
            ...ev,
            tab,
            disposition: d || null,
            customerId: customerIdByEventId[ev.id] || null,
          };
        });
      } catch (e) {
        // Non-fatal — the calendar-only view is still usable.
        console.warn('TechWorkToday: DB cross-reference failed', e);
      }
    }

    setAll(items);
    setLoading(false);
  }, [accessToken, userEmail, techCalId, offset, showAllTechs]);

  useEffect(() => { load(); }, [load]);

  // The first tab ("Today") shows the tech's WHOLE day — every scheduled job
  // that isn't already billed/completed, including ones tagged [RETURN] or
  // [ESTIMATE]. This is the safety fix: a scheduled appointment can never be
  // hidden from the tech just because it carries a return/estimate tag.
  // Return / Estimate / Bill It remain filtered views of the same day.
  const events = activeTab === 'new'
    ? allEvents.filter(e => e.tab !== 'billit')
    : allEvents.filter(e => e.tab === activeTab);

  const openDetail = (ev) => {
    setSelected(ev);
    setDetailsExpanded(false);
  };
  const closeSheet = () => {
    setSelected(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Called by JobFinishSheet after a successful disposition.
  // Optimistically updates the local list so the just-finished item flips
  // tabs immediately, then closes the sheet.
  const DISPO_CONFIRM = {
    bill_it:     { msg: '✅ Marked to bill — entry saved.',           color: '#166534', bg: '#f0fdf4' },
    return:      { msg: '🔄 Return visit flagged — office can see it.', color: '#92400e', bg: '#fffbeb' },
    in_progress: { msg: '📅 Still in progress — entry saved.',        color: '#1e40af', bg: '#eff6ff' },
    estimate:    { msg: '📋 Sent to estimates — entry saved.',        color: '#7e22ce', bg: '#faf5ff' },
    blocked:     { msg: "🚫 Couldn't complete — flagged on the board.", color: '#b91c1c', bg: '#fef2f2' },
  };
  // JobFinishSheet passes the calendar event id as the second argument so the
  // update doesn't have to rely on `selected` being current in the closure.
  // `selected?.id` is the fallback for callers that haven't been updated yet.
  const onFinished = (disposition, eventId) => {
    const targetId = eventId ?? selected?.id;
    const newTab =
      disposition === 'bill_it'     ? 'billit' :
      disposition === 'return'      ? 'return' :
      disposition === 'estimate'    ? 'estimate' :
      'new'; // in_progress and blocked stay in 'new' tab
    // The TITLE is deliberately not touched — Overwatch no longer tags calendar
    // events, so there is no new title to swap in. Only the tab moves.
    setAll(prev => prev.map(e => e.id === targetId ? { ...e, tab: newTab } : e));
    closeSheet();
    // Brief confirmation so the tech knows the disposition actually landed.
    // Without this, the sheet just closed — identical to a cancel — and
    // there was no way to tell if anything was saved.
    const confirm = DISPO_CONFIRM[disposition];
    if (confirm) {
      setDoneToast(confirm);
      setTimeout(() => setDoneToast(null), 4000);
    }
  };

  // Customer link is rendered inside the rich detail header AND fed to JobFinishSheet
  // (via prefillCustomer) so the tech doesn't have to link twice.

  // ── DISPOSITION HANDLERS — now live in JobFinishSheet (../components/JobFinishSheet.jsx)
  // Removed in the consolidation cleanup. JobFinishSheet writes time_entries +
  // return_cards and patches the calendar title with canonical [BILL IT] / [RETURN] /
  // [IN PROGRESS] / [ESTIMATE] tags.

  const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const extractPhone = (desc) => {
    const m = (desc || '').match(/(?:Phone|Ph|Tel|Call)?:?\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i);
    return m ? m[1] : null;
  };

  const tabCounts   = {};
  TABS.forEach(t => { tabCounts[t.key] = allEvents.filter(e => e.tab === t.key).length; });
  // "Today" shows everything not yet billed, so its badge counts that.
  tabCounts.new = allEvents.filter(e => e.tab !== 'billit').length;
  const activeTabObj = TABS.find(t => t.key === activeTab);
  
  const headerTitle = showAllTechs ? "Tech Jobs (Austin + JR + Brian + Subs)" : `${userName}'s Jobs`;

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#f8f9fa', color: '#1B2A4A', fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* Disposition confirmation toast — tells the tech their entry actually
          landed. The sheet closing looked identical whether it saved or was
          cancelled, so there was no way to tell. */}
      {doneToast && (
        <div style={{
          position: 'fixed', bottom: 'calc(24px + env(safe-area-inset-bottom))', left: '50%',
          transform: 'translateX(-50%)', zIndex: 300,
          background: doneToast.bg, border: `1.5px solid ${doneToast.color}`,
          borderRadius: 12, padding: '12px 20px',
          fontSize: 14, fontWeight: 700, color: doneToast.color,
          boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
          maxWidth: 340, width: 'calc(100vw - 40px)', textAlign: 'center',
          pointerEvents: 'none',
        }}>
          {doneToast.msg}
        </div>
      )}

      {/* Header — fixed at top; list scrolls below it. No sticky needed. */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb', flexShrink: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0' }}>
          <button onClick={onBack}
            style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 8, color: '#6b7280', padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
            ← Home
          </button>
          <img src="/overwatch-logo.png" alt="Overwatch" style={{ width: 30, height: 30, borderRadius: 7 }} />
          <div style={{ fontWeight: 800, fontSize: 15, color: '#1B2A4A' }}>{headerTitle}</div>
          <button onClick={() => { load(); loadNeedNotes(); }}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, color: '#6b7280', padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>
            ↻
          </button>
        </div>

        {/* ── NEEDS NOTES ── the loudest thing on the screen when it applies.
            No note means no disposition, which means no time entry, which
            means nothing to invoice and nobody downstream knows what happened
            on site. ── */}
        {needNotes.length > 0 && (
          <div style={{ borderTop: '1px solid #e5e7eb' }}>
            <button onClick={() => setShowNeedNotes(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                       background: '#dc2626', border: 'none', color: '#fff',
                       padding: '13px 16px', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 18 }}>&#9888;</span>
              <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 900,
                             letterSpacing: '0.06em' }}>
                {needNotes.length} NEED NOTES
              </span>
              <span style={{ fontSize: 16 }}>{showNeedNotes ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showNeedNotes && (
              <div style={{ background: '#fff1f2', borderBottom: '1px solid #fecaca' }}>
                <div style={{ fontSize: 12, color: '#9f1239', padding: '10px 16px 6px', lineHeight: 1.5 }}>
                  The day came and went and nobody said what happened. Tap one to jump
                  to that day, then finish it — notes, hours, then a disposition.
                </div>
                {needNotes.map(j => {
                  const late = daysLate(j.scheduled_date);
                  return (
                    <button key={j.id} onClick={() => goToDate(j.scheduled_date)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                               textAlign: 'left', background: 'none', border: 'none',
                               borderTop: '1px solid #fecaca', padding: '11px 16px',
                               cursor: 'pointer', fontFamily: 'inherit' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 700,
                                       color: '#1B2A4A', overflow: 'hidden',
                                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {j.customer_name || 'Unnamed'}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: '#9f1239' }}>
                          {j.tech_name || j.assigned_to || 'Unassigned'} \u00b7 {String(j.scheduled_date).slice(0, 10)}
                        </span>
                      </span>
                      <span style={{ background: late >= 7 ? '#dc2626' : late >= 3 ? '#ea580c' : '#b45309',
                                     color: '#fff', fontSize: 12, fontWeight: 800,
                                     padding: '3px 9px', borderRadius: 6, flexShrink: 0 }}>
                        {late > 0 ? late + 'd late' : 'due'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Day nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>
          <button onClick={() => setOffset(o => o - 1)}
            style={{ background: '#f3f4f6', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 22, cursor: 'pointer', color: '#374151', minWidth: 52 }}>‹</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: offset === 0 ? '#1a8a8a' : '#1B2A4A' }}>{dayLabel()}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              {viewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {!loading && ' · ' + allEvents.length + ' total'}
            </div>
          </div>
          <button onClick={() => setOffset(o => o + 1)}
            style={{ background: '#f3f4f6', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 22, cursor: 'pointer', color: '#374151', minWidth: 52 }}>›</button>
        </div>

        {/* Four Tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderTop: '1px solid #e5e7eb' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setTab(tab.key)}
              style={{
                background: 'none', border: 'none',
                borderBottom: activeTab === tab.key ? '3px solid ' + tab.color : '3px solid transparent',
                padding: '12px 4px 10px', cursor: 'pointer', textAlign: 'center',
                color: activeTab === tab.key ? tab.color : '#9ca3af',
                fontWeight: activeTab === tab.key ? 700 : 500, fontSize: 14,
              }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{tab.emoji}</div>
              <div>{tab.label}</div>
              {tabCounts[tab.key] > 0 && (
                <div style={{
                  display: 'inline-block', marginTop: 3,
                  background: activeTab === tab.key ? tab.color : '#e5e7eb',
                  color: activeTab === tab.key ? '#fff' : '#6b7280',
                  borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '2px 8px',
                }}>{tabCounts[tab.key]}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* List — takes remaining height and scrolls; header stays pinned above */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 16px calc(80px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading && <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>Loading...</div>}

        {!loading && events.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{activeTab === 'new' && offset === 0 ? '🎉' : '📭'}</div>
            <div style={{ color: '#6b7280', fontSize: 16, fontWeight: 600 }}>
              {activeTab === 'new' && offset === 0 ? 'Nothing scheduled today' : activeTab === 'new' ? 'Nothing scheduled' : 'Nothing in ' + activeTabObj?.label}
            </div>
          </div>
        )}

        {!loading && events.map((ev, i) => {
          const name  = cleanTitle(ev.title);
          const phone = extractPhone(ev.description);
          const now   = new Date();
          const isNow = ev.start <= now && ev.end >= now;
          const techColor = ev.techName === 'Austin' ? '#3b82f6' : ev.techName === 'JR' ? '#22c55e' : ev.techName === 'Brian' ? '#FB923C' : ev.techName === 'Subs' ? '#EC4899' : null;

          return (
            <div key={ev.id} onClick={() => openDetail(ev)}
              style={{
                background: '#ffffff',
                borderRadius: i === 0 && events.length === 1 ? 12 : i === 0 ? '12px 12px 0 0' : i === events.length - 1 ? '0 0 12px 12px' : 0,
                padding: '18px 16px', cursor: 'pointer',
                borderBottom: i < events.length - 1 ? '1px solid #f3f4f6' : 'none',
                borderLeft: '4px solid ' + (techColor || (isNow ? '#1a8a8a' : activeTabObj?.color || '#e5e7eb')),
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isNow && <div style={{ color: '#1a8a8a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>In Progress</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  {ev.techName && (
                    <span style={{
                      background: techColor + '20',
                      color: techColor,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 4
                    }}>
                      {ev.techName}
                    </span>
                  )}
                  {ev.tab === 'return' && (
                    <span style={{ background: '#fef3c7', color: '#b45309', fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>🔄 Return Visit</span>
                  )}
                  {ev.tab === 'estimate' && (
                    <span style={{ background: '#ede9fe', color: '#6d28d9', fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>→ Estimates</span>
                  )}
                  {ev.disposition === 'in_progress' && (
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>⚙️ In Progress</span>
                  )}
                  {ev.customerId ? (
                    <span
                      role="link"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); navigate(`/customers?customerId=${ev.customerId}`); }}
                      style={{ fontWeight: 700, fontSize: 17, color: '#1a8a8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                      {name || '(no name)'}
                    </span>
                  ) : (
                    <span style={{ fontWeight: 700, fontSize: 17, color: '#1B2A4A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name || '(no name)'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, color: '#6b7280' }}>
                  {ev.isAllDay ? 'All day' : fmtTime(ev.start) + ' – ' + fmtTime(ev.end)}
                  {ev.location && ' · ' + ev.location.split(',')[0]}
                </div>
                {/* Issue preview — first useful line from GCal description, never time_entries.notes */}
                {(() => {
                  const lines = (ev.description || '').split('\n').map(l => l.trim()).filter(l => {
                    if (!l) return false;
                    if (/^\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/.test(l)) return false; // phone line
                    if (/^https?:\/\//i.test(l)) return false; // URL line
                    return true;
                  });
                  const preview = lines.join(' ').slice(0, 80);
                  if (!preview) return null;
                  return (
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preview}{lines.join(' ').length > 80 ? '…' : ''}
                    </div>
                  );
                })()}
                {phone && (
                  <div style={{ fontSize: 12, marginTop: 3, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <a href={'tel:' + phone.replace(/\D/g, '')} onClick={e => e.stopPropagation()}
                      style={{ color: '#16a34a', fontWeight: 600, textDecoration: 'none' }}>📞 {phone}</a>
                    <a href={'sms:' + phone.replace(/\D/g, '')} onClick={e => e.stopPropagation()}
                      style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>💬 Text</a>
                  </div>
                )}
              </div>
              <div style={{ color: '#cbd5e1', fontSize: 26, marginLeft: 10 }}>›</div>
            </div>
          );
        })}
      </div>

      {/* Bottom Sheet */}
      {selected && (
        <div onClick={closeSheet}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#ffffff', borderRadius: '20px 20px 0 0', padding: '16px 16px calc(24px + env(safe-area-inset-bottom))', width: '100%', maxWidth: 480, maxHeight: '92dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

            <div style={{ width: 40, height: 5, background: '#e5e7eb', borderRadius: 3, margin: '0 auto 14px' }} />

            <div style={{ fontWeight: 800, fontSize: 19, color: '#1B2A4A', marginBottom: 3 }}>
              {cleanTitle(selected.title)}
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
              {selected.isAllDay ? 'All day' : fmtTime(selected.start) + ' – ' + fmtTime(selected.end)}
            </div>

            {(selected.location || extractPhone(selected.description)) && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                {selected.location && (
                  <a href={'https://maps.google.com/?q=' + encodeURIComponent(selected.location)}
                    target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, color: '#2563eb', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
                    🗺️ Navigate
                  </a>
                )}
                {extractPhone(selected.description) && (() => {
                  const p = (extractPhone(selected.description) || '').replace(/\D/g, '');
                  return (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <a href={'tel:' + p}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#16a34a', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
                        📞 Call
                      </a>
                      <a href={'sms:' + p}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, color: '#2563eb', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
                        💬 Text
                      </a>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Finish form — customer link, time entry, notes, materials, disposition buttons.
                Lives in src/components/JobFinishSheet.jsx and is the SINGLE canonical
                "tech finishes a job" UI used everywhere in the app. */}
            <JobFinishSheet
              inline
              event={{
                id: selected.id,
                title: selected.title,
                calendarId: selected.calendarId,
                start: selected.start,
                end: selected.end,
                description: selected.description,
                location: selected.location,
                techName: selected.techName,
              }}
              accessToken={accessToken}
              userEmail={userEmail}
              userName={userName}
              mode="full"
              onFinished={onFinished}
              onCancel={closeSheet}
            />
          </div>
        </div>
      )}
    </div>
  );
}
