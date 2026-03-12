// ============================================
// JUC-E V4 - TechCalendar View
// ============================================
// Default: Full Google Calendar (week/day) with filter chips
// Tab 2: Task cards from Supabase
// Tap any event to open in Google Calendar for editing

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { assignmentsApi, jobsApi, queries, JOB_STATUS, techsApi, supabase } from '../services/supabase.js';
import { scanForOrphans, ignoreOrphan } from '../services/calendarSync.js';
import { SYNC_CALENDARS, TECH_COLORS } from '../config/calendars.js';
import { JOB_TYPE_INFO, getJobAge, getAgeUrgency } from '../utils/statusMachine.js';
import usePullToRefresh from '../utils/usePullToRefresh.jsx';
import JobCard from '../components/JobCard.jsx';
import JobDetail from '../components/JobDetail.jsx';
import NewJobModal from '../components/NewJobModal.jsx';

// Merge tech colors from config with non-tech calendar colors
const CALENDAR_COLORS = {
  ...TECH_COLORS,
  'Service Queue': '#ef4444',
  'Sales & Accounting': '#ec4899',
  'Completed': '#6b7280',
  'Installations': '#14b8a6',
};

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6);

function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + (offset * 7));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatHour(h) {
  if (h === 0 || h === 12) return h === 0 ? '12a' : '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export default function TechCalendar({ accessToken, userEmail, defaultCalendar, pinUnlocked, onRequestPin, isRestricted, isOperator, userName }) {
  // Techs get card view by default, operators get calendar
  const [mainTab, setMainTab] = useState(isOperator ? 'calendar' : 'tasks');
  const pendingTasks = useRef(false);

  // Auto-switch to Tasks after PIN unlock
  useEffect(() => {
    if (pinUnlocked && pendingTasks.current) {
      pendingTasks.current = false;
      setMainTab('tasks');
    }
  }, [pinUnlocked]);

  // ===== CALENDAR STATE =====
  const [calEvents, setCalEvents] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calLoading, setCalLoading] = useState(true);
  const [hiddenCalendars, setHiddenCalendars] = useState(() => {
    try {
      const saved = localStorage.getItem(`juce-cal-hidden-${userEmail}`);
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    // If defaultCalendar is set, hide everything except that one
    if (defaultCalendar) {
      const allNames = SYNC_CALENDARS.filter(c => c.type !== 'completed').map(c => c.name);
      return new Set(allNames.filter(n => n !== defaultCalendar));
    }
    return new Set();
  });
  const [calViewMode, setCalViewMode] = useState('week');
  const todayRef = new Date();
  todayRef.setHours(0, 0, 0, 0);
  const [selectedDay, setSelectedDay] = useState(todayRef.getDay() === 0 ? 6 : todayRef.getDay() - 1);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ===== TASKS STATE =====
  const [taskTab, setTaskTab] = useState('today');
  const [jobs, setJobs] = useState([]);
  const [orphans, setOrphans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [adoptingOrphan, setAdoptingOrphan] = useState(null);
  const [showOrphanActions, setShowOrphanActions] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searchLoading, setSearchLoading] = useState(false);

  // ========== GOOGLE CALENDAR FETCH ==========
  const fetchCalendarEvents = useCallback(async () => {
    if (!accessToken) return;
    setCalLoading(true);
    const timeMin = new Date(weekDates[0]);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(weekDates[6]);
    timeMax.setHours(23, 59, 59, 999);
    const allEvents = [];

    await Promise.all(SYNC_CALENDARS.map(async (cal) => {
      try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?` +
          `timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=250`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return;
        const data = await res.json();
        (data.items || []).forEach(event => {
          if (event.status === 'cancelled') return;
          const start = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? new Date(event.start.date + 'T00:00:00') : null;
          const end = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? new Date(event.end.date + 'T23:59:59') : null;
          if (!start) return;
          allEvents.push({
            id: event.id, calendarId: cal.id, calendarName: cal.name, calendarType: cal.type,
            summary: event.summary || '(no title)', location: event.location || '',
            description: event.description || '', htmlLink: event.htmlLink || '',
            start, end, isAllDay: !event.start?.dateTime,
            color: CALENDAR_COLORS[cal.name] || '#6b7280',
          });
        });
      } catch (e) { console.error(`Error fetching ${cal.name}:`, e); }
    }));

    allEvents.sort((a, b) => a.start - b.start);

    // Also fetch Supabase assignments so jobs appear on calendar even if GCal sync failed
    try {
      const { data: assignments } = await supabase
        .from('job_assignments')
        .select('*, job:jobs(*), tech:techs(*)')
        .gte('scheduled_for', weekDates[0].toISOString())
        .lte('scheduled_for', new Date(weekDates[6].getTime() + 24*60*60*1000).toISOString())
        .or('is_complete.is.null,is_complete.eq.false');

      if (assignments?.length) {
        const gcalIds = new Set(allEvents.map(e => e.id));
        assignments.forEach(a => {
          // Skip if already matched by calendar_event_id
          if (a.calendar_event_id && gcalIds.has(a.calendar_event_id)) return;
          const techName = a.tech?.name || 'Unknown';
          const start = new Date(a.scheduled_for);
          const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
          allEvents.push({
            id: `juce-${a.id}`,
            calendarId: 'juce-internal',
            calendarName: techName,
            calendarType: 'tech',
            summary: a.job?.customer_name || 'Unknown',
            location: a.job?.customer_address || '',
            description: a.job?.issue || '',
            htmlLink: '',
            start, end, isAllDay: false,
            color: CALENDAR_COLORS[techName] || '#6b7280',
            _juceJobId: a.job_id,
            _juceAssignment: true,
          });
        });
        allEvents.sort((a, b) => a.start - b.start);
      }
    } catch (e) { console.warn('Supabase assignment fetch for calendar failed:', e); }

    setCalEvents(allEvents);
    setCalLoading(false);
  }, [accessToken, weekDates]);

  useEffect(() => { if (mainTab === 'calendar') fetchCalendarEvents(); }, [fetchCalendarEvents, mainTab]);

  // ========== CALENDAR HELPERS ==========
  const toggleCalendar = (name) => {
    setHiddenCalendars(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      localStorage.setItem(`juce-cal-hidden-${userEmail}`, JSON.stringify([...next]));
      return next;
    });
  };

  const visibleEvents = calEvents.filter(e => !hiddenCalendars.has(e.calendarName));

  const getEventsForDay = (dayIndex) => {
    const date = weekDates[dayIndex];
    return visibleEvents.filter(e => {
      const eDate = new Date(e.start);
      return eDate.getFullYear() === date.getFullYear() && eDate.getMonth() === date.getMonth() && eDate.getDate() === date.getDate();
    });
  };

  const isToday = (date) => date.getTime() === today.getTime();

  // Smart event opener — tries to match to a JUC-E job first
  const [eventPreview, setEventPreview] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);

  const openEvent = async (event) => {
    // If it's a JUC-E internal event, open directly
    if (event._juceJobId) {
      setSelectedJobId(event._juceJobId);
      return;
    }
    setEventLoading(true);
    try {
      // Try to match calendar event to a JUC-E job via assignment
      const assignment = await assignmentsApi.getByCalendarEventId(event.id);
      if (assignment?.job_id) {
        setSelectedJobId(assignment.job_id);
        setEventLoading(false);
        return;
      }
      // Try fuzzy match by summary against recent jobs
      const summary = (event.summary || '').toLowerCase();
      if (summary.length > 3) {
        const { data: matchedJobs } = await supabase
          .from('jobs')
          .select('id, customer_name, issue')
          .or(`customer_name.ilike.%${summary.slice(0, 30)}%,issue.ilike.%${summary.slice(0, 30)}%`)
          .limit(1);
        if (matchedJobs?.length > 0) {
          setSelectedJobId(matchedJobs[0].id);
          setEventLoading(false);
          return;
        }
      }
    } catch (e) { console.warn('Event match error:', e); }
    // No match — show preview card
    setEventPreview(event);
    setEventLoading(false);
  };

  // ========== TASK DATA LOAD ==========
  const loadTaskData = useCallback(async () => {
    setIsLoading(true);
    try {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
      const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
      let startDate, endDate;
      if (taskTab === 'today') { startDate = now.toISOString(); endDate = tomorrow.toISOString(); }
      else if (taskTab === 'tomorrow') { startDate = tomorrow.toISOString(); endDate = new Date(tomorrow.getTime() + 86400000).toISOString(); }
      else { startDate = now.toISOString(); endDate = weekEnd.toISOString(); }

      const allAssigned = await assignmentsApi.getAllSchedule(startDate, endDate);
      const newJobs = taskTab === 'today' ? await queries.getATCQueue() : [];
      setJobs([...allAssigned, ...newJobs.map(j => ({ ...j, _isQueue: true }))]);

      if (accessToken) {
        try { const scan = await scanForOrphans(accessToken); setOrphans(scan.orphans || []); }
        catch (e) { console.warn('Orphan scan error:', e); }
      }
    } catch (e) { console.error('Load error:', e); }
    finally { setIsLoading(false); }
  }, [taskTab, accessToken]);

  useEffect(() => { if (mainTab === 'tasks') loadTaskData(); }, [loadTaskData, mainTab]);

  // ========== SEARCH ==========
  const runSearch = useCallback(async (query) => {
    if (!query || query.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true);
    const q = query.toLowerCase();
    const results = { calendarEvents: [], jobs: [] };

    // Search loaded calendar events
    results.calendarEvents = calEvents.filter(e =>
      e.summary.toLowerCase().includes(q) ||
      e.location.toLowerCase().includes(q) ||
      e.calendarName.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q)
    );

    // Also search Google Calendar across a 90-day range if we have an access token
    if (accessToken && results.calendarEvents.length < 5) {
      try {
        const searchMin = new Date(); searchMin.setDate(searchMin.getDate() - 30);
        const searchMax = new Date(); searchMax.setDate(searchMax.getDate() + 60);
        const searchPromises = SYNC_CALENDARS.map(async (cal) => {
          try {
            const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?` +
              `timeMin=${searchMin.toISOString()}&timeMax=${searchMax.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50&q=${encodeURIComponent(query)}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.items || []).filter(e => e.status !== 'cancelled').map(event => {
              const start = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? new Date(event.start.date + 'T00:00:00') : null;
              const end = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? new Date(event.end.date + 'T23:59:59') : null;
              return {
                id: event.id, calendarId: cal.id, calendarName: cal.name, calendarType: cal.type,
                summary: event.summary || '(no title)', location: event.location || '',
                htmlLink: event.htmlLink || '', start, end, isAllDay: !event.start?.dateTime,
                color: CALENDAR_COLORS[cal.name] || '#6b7280',
              };
            });
          } catch { return []; }
        });
        const apiResults = (await Promise.all(searchPromises)).flat();
        // Merge, dedup by event id
        const existing = new Set(results.calendarEvents.map(e => e.id));
        apiResults.forEach(e => { if (!existing.has(e.id)) results.calendarEvents.push(e); });
      } catch (e) { console.error('Calendar search error:', e); }
    }

    // Search Supabase jobs
    try {
      const jobResults = await jobsApi.search(query);
      results.jobs = jobResults || [];
    } catch {
      results.jobs = jobs.filter(j =>
        (j.customer_name || '').toLowerCase().includes(q) ||
        (j.issue || '').toLowerCase().includes(q) ||
        (j.job_number || '').toLowerCase().includes(q)
      );
    }

    results.calendarEvents.sort((a, b) => (a.start || 0) - (b.start || 0));
    setSearchResults(results);
    setSearchLoading(false);
  }, [calEvents, accessToken, jobs]);

  useEffect(() => {
    const timer = setTimeout(() => runSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, runSearch]);

  const { PullIndicator } = usePullToRefresh(mainTab === 'calendar' ? fetchCalendarEvents : loadTaskData);

  const scheduledJobs = jobs.filter(j => {
    if (!j._isQueue && j.scheduled_for) {
      // Restricted users only see their own assignments
      if (isRestricted && j.tech_name && j.tech_name.toLowerCase() !== userName?.toLowerCase()) return false;
      return true;
    }
    return false;
  });
  const queueJobs = isRestricted ? [] : jobs.filter(j => j._isQueue);
  const sortedScheduled = [...scheduledJobs].sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
  const groupByDay = (items) => {
    const groups = {};
    items.forEach(j => {
      const date = new Date(j.scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (!groups[date]) groups[date] = [];
      groups[date].push(j);
    });
    return groups;
  };
  const dayGroups = taskTab === 'week' ? groupByDay(sortedScheduled) : null;

  const handleAdoptOrphan = (orphan) => { setAdoptingOrphan(orphan); setShowNewJob(true); };
  const handleIgnoreOrphan = (orphan) => { ignoreOrphan(orphan.event.id); setOrphans(prev => prev.filter(o => o.event.id !== orphan.event.id)); };
  const formatTime = (dateStr) => { if (!dateStr) return ''; return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); };

  const OrphanActions = ({ orphan, onClose }) => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#1e293b', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '500px', padding: '20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}>
        <h3 style={{ color: '#e2e8f0', margin: '0 0 12px 0', fontSize: '16px' }}>📅 {orphan.event.summary}</h3>
        <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0' }}>Found on <strong>{orphan.calendarName}</strong> but not in JUC-E.</p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { handleAdoptOrphan(orphan); onClose(); }} style={{ flex: 1, background: '#22c55e', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>Adopt → New Task</button>
          <button onClick={() => { handleIgnoreOrphan(orphan); onClose(); }} style={{ flex: 1, background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', cursor: 'pointer' }}>Ignore</button>
        </div>
        <button onClick={onClose} style={{ width: '100%', background: 'none', border: 'none', color: '#475569', padding: '12px', fontSize: '13px', cursor: 'pointer', marginTop: '8px' }}>Cancel</button>
      </div>
    </div>
  );

  // ========== DAY VIEW ==========
  const renderDayView = () => {
    const dayEvents = getEventsForDay(selectedDay);
    const allDay = dayEvents.filter(e => e.isAllDay);
    const timed = dayEvents.filter(e => !e.isAllDay);

    return (
      <div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, overflowX: 'auto' }}>
          {weekDates.map((d, i) => (
            <button key={i} onClick={() => setSelectedDay(i)} style={{
              flex: 1, minWidth: 42, padding: '8px 4px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: selectedDay === i ? '#00c8e8' : isToday(d) ? '#0f3460' : 'transparent',
              color: selectedDay === i ? '#000' : isToday(d) ? '#00c8e8' : '#64748b',
              fontWeight: selectedDay === i || isToday(d) ? 600 : 400, fontSize: 11
            }}>
              <div>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{d.getDate()}</div>
            </button>
          ))}
        </div>

        {allDay.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {allDay.map(e => (
              <div key={e.id} onClick={() => openEvent(e)} style={{
                padding: '6px 10px', marginBottom: 4, borderRadius: 6, fontSize: 12,
                background: e.color + '33', borderLeft: `3px solid ${e.color}`, cursor: 'pointer', color: '#e2e8f0'
              }}>
                <span style={{ opacity: 0.7 }}>{e.calendarName}</span> · {e.summary}
              </div>
            ))}
          </div>
        )}

        <div style={{ position: 'relative', marginLeft: 36 }}>
          {HOURS.map(h => (
            <div key={h} style={{ height: 48, borderTop: '1px solid #1e293b', position: 'relative' }}>
              <span style={{ position: 'absolute', left: -36, top: -8, fontSize: 10, color: '#475569', width: 30, textAlign: 'right' }}>{formatHour(h)}</span>
            </div>
          ))}
          {timed.map(e => {
            const startHour = e.start.getHours() + e.start.getMinutes() / 60;
            const endHour = e.end ? e.end.getHours() + e.end.getMinutes() / 60 : startHour + 1;
            const top = (startHour - 6) * 48;
            const height = Math.max((endHour - startHour) * 48, 24);
            return (
              <div key={e.id} onClick={() => openEvent(e)} style={{
                position: 'absolute', top, left: 0, right: 4, height, zIndex: 2,
                background: e.color + 'cc', borderRadius: 6, padding: '3px 8px',
                fontSize: 11, overflow: 'hidden', cursor: 'pointer', borderLeft: `3px solid ${e.color}`, color: '#fff'
              }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e._juceAssignment ? '⚡ ' : ''}{e.summary}</div>
                {height > 28 && <div style={{ opacity: 0.8, fontSize: 10 }}>
                  {e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {e.calendarName !== 'Service Queue' ? ` · ${e.calendarName}` : ''}
                </div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ========== WEEK VIEW ==========
  const renderWeekView = () => (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        <div />
        {weekDates.map((d, i) => (
          <div key={i} onClick={() => { setSelectedDay(i); setCalViewMode('day'); }} style={{
            textAlign: 'center', padding: '4px 0', cursor: 'pointer', borderRadius: 6,
            background: isToday(d) ? '#00c8e8' : 'transparent',
            color: isToday(d) ? '#000' : '#94a3b8'
          }}>
            <div style={{ fontSize: 10, fontWeight: 600 }}>{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][i]}</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{d.getDate()}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
        {HOURS.map(h => (
          <div key={h} style={{ display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)', gap: 2, height: 40, borderTop: '1px solid #1e293b' }}>
            <div style={{ fontSize: 9, color: '#475569', textAlign: 'right', paddingRight: 4, marginTop: -6 }}>{formatHour(h)}</div>
            {weekDates.map((_, di) => <div key={di} style={{ background: '#1e293b22' }} />)}
          </div>
        ))}
        {weekDates.map((date, dayIdx) => {
          const dayEvents = getEventsForDay(dayIdx).filter(e => !e.isAllDay);
          return dayEvents.map(e => {
            const startHour = e.start.getHours() + e.start.getMinutes() / 60;
            const endHour = e.end ? e.end.getHours() + e.end.getMinutes() / 60 : startHour + 1;
            const top = (startHour - 6) * 40;
            const height = Math.max((endHour - startHour) * 40, 16);
            const colWidth = `calc((100% - 30px) / 7)`;
            const left = `calc(30px + ${dayIdx} * ${colWidth} + 2px)`;
            return (
              <div key={`${dayIdx}-${e.id}`} onClick={() => { setSelectedDay(dayIdx); setCalViewMode('day'); }} style={{
                position: 'absolute', top, left, width: `calc(${colWidth} - 4px)`, height, zIndex: 2,
                background: e.color + 'cc', borderRadius: 4, padding: '1px 4px',
                fontSize: 9, overflow: 'hidden', cursor: 'pointer', lineHeight: '1.2', color: '#fff'
              }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e._juceAssignment ? '⚡ ' : ''}{e.summary}</div>
              </div>
            );
          });
        })}
      </div>
    </div>
  );

  // ========== MAIN RENDER ==========
  return (
    <div style={{ padding: '0' }}>
      <PullIndicator />

      {/* Main tabs — techs get My Day card view, operators get Calendar grid + Tasks */}
      <div style={{
        display: 'flex', gap: '0', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: '49px', background: '#0f1729', zIndex: 50
      }}>
        {(isRestricted ? [
          // Field techs: My Day only (card view)
          { key: 'tasks', label: `📋 My Day` },
        ] : isOperator ? [
          // Operator: Calendar grid + Tasks
          { key: 'calendar', label: '📅 Calendar' },
          { key: 'tasks', label: pinUnlocked ? '📋 Tasks' : '🔒 Tasks' },
        ] : [
          // Office techs (JR, Shana): My Day default + Calendar available
          { key: 'tasks', label: pinUnlocked ? '📋 My Day' : '🔒 My Day' },
          { key: 'calendar', label: '📅 Calendar' },
        ]).map(t => (
          <button key={t.key} onClick={() => {
            if (t.key === 'tasks' && !pinUnlocked && !isRestricted) { pendingTasks.current = true; onRequestPin?.(); return; }
            setMainTab(t.key);
          }} style={{
            flex: 1, padding: '12px', background: 'none', border: 'none',
            color: mainTab === t.key ? '#00c8e8' : '#64748b',
            fontSize: '14px', fontWeight: mainTab === t.key ? '700' : '400', cursor: 'pointer',
            borderBottom: mainTab === t.key ? '2px solid #00c8e8' : '2px solid transparent'
          }}>{t.label}</button>
        ))}
      </div>

      {/* ===== CALENDAR TAB ===== */}
      {mainTab === 'calendar' && (
        <div style={{ padding: '12px' }}>
          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Search events, jobs, customers..."
              style={{
                width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
                color: '#e2e8f0', padding: '10px 14px', paddingRight: searchQuery ? '36px' : '14px',
                fontSize: '14px', outline: 'none', boxSizing: 'border-box'
              }}
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults(null); }} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#64748b', fontSize: '18px', cursor: 'pointer', padding: 0
              }}>✕</button>
            )}
          </div>

          {/* Search results overlay */}
          {searchResults ? (
            <div>
              {searchLoading && <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 13 }}>Searching...</div>}
              {!searchLoading && searchResults.calendarEvents.length === 0 && searchResults.jobs.length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: '#475569', fontSize: 13 }}>No results for "{searchQuery}"</div>
              )}

              {searchResults.calendarEvents.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
                    📅 Calendar Events ({searchResults.calendarEvents.length})
                  </div>
                  {searchResults.calendarEvents.map(e => (
                    <div key={`${e.calendarId}-${e.id}`} onClick={() => openEvent(e)} style={{
                      background: '#1e293b', borderRadius: 8, padding: '10px 12px', marginBottom: 6,
                      cursor: 'pointer', borderLeft: `3px solid ${e.color}`
                    }}>
                      <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{e._juceAssignment ? '⚡ ' : ''}{e.summary}</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: e.color }}>{e.calendarName}</span>
                        {e.start && <span>{e.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
                        {e.start && !e.isAllDay && <span>{e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
                        {e.location && <span>📍 {e.location}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchResults.jobs.length > 0 && (
                <div>
                  <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
                    📋 Tasks ({searchResults.jobs.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {searchResults.jobs.map(j => (
                      <JobCard key={j.id} job={j} onClick={() => setSelectedJobId(j.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Normal calendar view */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: '#1e293b', border: 'none', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', cursor: 'pointer' }}>◀</button>
                  <button onClick={() => { setWeekOffset(0); setSelectedDay(today.getDay() === 0 ? 6 : today.getDay() - 1); }} style={{ background: '#1e293b', border: 'none', borderRadius: 6, color: '#00c8e8', padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Today</button>
                  <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: '#1e293b', border: 'none', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', cursor: 'pointer' }}>▶</button>
                  <span style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>
                    {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setCalViewMode('week')} style={{ background: calViewMode === 'week' ? '#00c8e8' : '#1e293b', color: calViewMode === 'week' ? '#000' : '#64748b', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Week</button>
                  <button onClick={() => setCalViewMode('day')} style={{ background: calViewMode === 'day' ? '#00c8e8' : '#1e293b', color: calViewMode === 'day' ? '#000' : '#64748b', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Day</button>
                </div>
              </div>

              {/* Calendar filter chips */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
                {SYNC_CALENDARS.filter(c => c.type !== 'completed').map(cal => (
                  <button key={cal.name} onClick={() => toggleCalendar(cal.name)} style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    background: hiddenCalendars.has(cal.name) ? '#1e293b' : (CALENDAR_COLORS[cal.name] || '#6b7280') + '33',
                    color: hiddenCalendars.has(cal.name) ? '#334155' : CALENDAR_COLORS[cal.name] || '#6b7280',
                    textDecoration: hiddenCalendars.has(cal.name) ? 'line-through' : 'none'
                  }}>{cal.name}</button>
                ))}
              </div>

              {calLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 13 }}>Loading calendars...</div>
              ) : (
                calViewMode === 'week' ? renderWeekView() : renderDayView()
              )}
            </>
          )}
        </div>
      )}

      {/* ===== TASKS TAB ===== */}
      {mainTab === 'tasks' && (
        <>
          <div style={{
            display: 'flex', gap: '0', borderBottom: '1px solid #1e293b',
            position: 'sticky', top: '94px', background: '#0f1729', zIndex: 49
          }}>
            {['today', 'tomorrow', 'week'].map(t => (
              <button key={t} onClick={() => setTaskTab(t)} style={{
                flex: 1, padding: '10px', background: 'none', border: 'none',
                color: taskTab === t ? '#00c8e8' : '#64748b',
                fontSize: '13px', fontWeight: taskTab === t ? '700' : '400', cursor: 'pointer', textTransform: 'capitalize',
                borderBottom: taskTab === t ? '2px solid #00c8e8' : '2px solid transparent'
              }}>
                {t === 'today' ? `Today (${sortedScheduled.filter(j => { const d = new Date(j.scheduled_for); return d.toDateString() === new Date().toDateString(); }).length})` : t === 'tomorrow' ? 'Tomorrow' : 'This Week'}
              </button>
            ))}
          </div>
          <div style={{ padding: '12px' }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading...</div>
            ) : (
              <>
                {!isRestricted && orphans.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ color: '#f59e0b', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>⚠️ Unmatched Calendar Events ({orphans.length})</div>
                    {orphans.map(o => (
                      <div key={o.event.id} onClick={() => setShowOrphanActions(o)} style={{
                        background: '#f59e0b15', border: '1px solid #f59e0b30', borderRadius: '10px', padding: '10px 12px', marginBottom: '6px', cursor: 'pointer'
                      }}>
                        <div style={{ color: '#f59e0b', fontSize: '13px', fontWeight: '600' }}>{o.event.summary}</div>
                        <div style={{ color: '#64748b', fontSize: '11px' }}>{o.calendarName} · {new Date(o.event.start?.dateTime || o.event.start?.date).toLocaleDateString()}</div>
                      </div>
                    ))}
                  </div>
                )}

                {taskTab === 'week' ? (
                  Object.keys(dayGroups || {}).length > 0 ? (
                    Object.entries(dayGroups).map(([date, items]) => (
                      <div key={date} style={{ marginBottom: '16px' }}>
                        <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '6px', textTransform: 'uppercase' }}>{date}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {items.map(j => <JobCard key={j.assignment_id || j.id} job={j} showTime onClick={() => setSelectedJobId(j.job_id || j.id)} />)}
                        </div>
                      </div>
                    ))
                  ) : <div style={{ textAlign: 'center', padding: '30px', color: '#475569' }}>No jobs scheduled this week</div>
                ) : (
                  <>
                    {sortedScheduled.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                        {sortedScheduled.map(j => (
                          <div key={j.assignment_id || j.id} onClick={() => setSelectedJobId(j.job_id || j.id)} style={{
                            background: '#1e293b', borderRadius: '14px', padding: '14px 16px', cursor: 'pointer',
                            borderLeft: `4px solid ${CALENDAR_COLORS[j.tech_name] || '#00c8e8'}`,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                          }}>
                            {/* Time + Type */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ color: '#00c8e8', fontSize: '16px', fontWeight: '700' }}>
                                {j.scheduled_for ? formatTime(j.scheduled_for) : 'TBD'}
                              </span>
                              <span style={{ background: '#0f172940', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', color: '#94a3b8', fontWeight: '600' }}>
                                {j.job_type === 'service_call' ? '🔧 Service' : j.job_type === 'install' ? '🏗️ Install' : j.job_type === 'inspection' ? '🔍 Inspect' : j.job_type || '📋'}
                              </span>
                            </div>
                            {/* Customer */}
                            <div style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: '700', marginBottom: '4px' }}>
                              {j.customer_name || 'Unknown Customer'}
                            </div>
                            {/* Address */}
                            {j.customer_address && (
                              <div onClick={(e) => { e.stopPropagation(); window.open(`https://maps.google.com/?q=${encodeURIComponent(j.customer_address)}`); }} style={{ color: '#3b82f6', fontSize: '13px', marginBottom: '4px', textDecoration: 'underline' }}>
                                📍 {j.customer_address}
                              </div>
                            )}
                            {/* Phone */}
                            {j.customer_phone && (
                              <div onClick={(e) => { e.stopPropagation(); window.open(`tel:${j.customer_phone}`); }} style={{ color: '#22c55e', fontSize: '13px', marginBottom: '4px' }}>
                                📞 {j.customer_phone}
                              </div>
                            )}
                            {/* Issue */}
                            {j.issue && (
                              <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: '1.4', marginTop: '4px' }}>
                                {j.issue.length > 80 ? j.issue.slice(0, 80) + '...' : j.issue}
                              </div>
                            )}
                            {/* Tech name if not restricted (Sara/Shana see who's assigned) */}
                            {!isRestricted && j.tech_name && (
                              <div style={{ color: CALENDAR_COLORS[j.tech_name] || '#64748b', fontSize: '11px', fontWeight: '600', marginTop: '6px' }}>
                                {j.tech_name}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '30px', color: '#475569' }}>
                        {taskTab === 'today' ? 'Nothing scheduled today' : 'Nothing scheduled tomorrow'}
                      </div>
                    )}
                  </>
                )}

                {taskTab === 'today' && queueJobs.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>🆕 Needs Attention ({queueJobs.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {queueJobs.map(j => <JobCard key={j.id} job={j} onClick={() => setSelectedJobId(j.id)} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* FAB */}
      <button onClick={() => { setAdoptingOrphan(null); setShowNewJob(true); }} style={{
        position: 'fixed', bottom: '80px', left: '16px', zIndex: 90,
        width: '52px', height: '52px', borderRadius: '50%',
        background: '#22c55e', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '26px', color: '#fff', boxShadow: '0 4px 15px rgba(34,197,94,0.3)'
      }}>+</button>

      {selectedJobId && (
        <JobDetail jobId={selectedJobId} onClose={() => setSelectedJobId(null)} onUpdate={mainTab === 'tasks' ? loadTaskData : fetchCalendarEvents} accessToken={accessToken} userEmail={userEmail} userRole={isOperator ? 'operator' : 'tech'} />
      )}

      {/* Event loading indicator */}
      {eventLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#00c8e8', fontSize: 14 }}>Matching to job...</div>
        </div>
      )}

      {/* Event preview — no matching JUC-E job found */}
      {eventPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '20px' }}
          onClick={() => setEventPreview(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#1e293b', borderRadius: '16px 16px 0 0', padding: '20px', width: '100%', maxWidth: 420,
            borderTop: `4px solid ${eventPreview.color}`, marginBottom: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>{eventPreview.summary}</div>
                <div style={{ color: eventPreview.color, fontSize: 12, marginTop: 2 }}>{eventPreview.calendarName}</div>
              </div>
              <button onClick={() => setEventPreview(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            {eventPreview.start && (
              <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                📅 {eventPreview.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                {!eventPreview.isAllDay && ` · ${eventPreview.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                {eventPreview.end && !eventPreview.isAllDay && ` – ${eventPreview.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              </div>
            )}

            {eventPreview.location && (
              <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>📍 {eventPreview.location}</div>
            )}

            {eventPreview.description && (
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12, maxHeight: 80, overflow: 'auto', lineHeight: 1.4 }}>
                {eventPreview.description.slice(0, 300)}
              </div>
            )}

            <div style={{ background: '#0f1729', borderRadius: 10, padding: '10px 14px', marginBottom: 16, border: '1px solid #334155' }}>
              <div style={{ color: '#f59e0b', fontSize: 12, fontWeight: 600 }}>⚠️ No matching JUC-E job found</div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>This event isn't linked to a task yet. Create one or open in Google Calendar.</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => {
                setAdoptingOrphan({ event: eventPreview });
                setShowNewJob(true);
                setEventPreview(null);
              }} style={{
                flex: 1, background: '#22c55e', color: '#000', border: 'none', borderRadius: 10,
                padding: '14px', fontSize: 14, fontWeight: 700, cursor: 'pointer'
              }}>+ Create Job</button>
              <button onClick={() => {
                if (eventPreview.htmlLink) window.open(eventPreview.htmlLink, '_blank');
                setEventPreview(null);
              }} style={{
                flex: 1, background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 10,
                padding: '14px', fontSize: 14, fontWeight: 600, cursor: 'pointer'
              }}>Open Calendar ↗</button>
            </div>
          </div>
        </div>
      )}
      {showNewJob && (
        <NewJobModal
          onClose={() => { setShowNewJob(false); setAdoptingOrphan(null); }}
          onCreated={() => { mainTab === 'tasks' ? loadTaskData() : fetchCalendarEvents(); }}
          userEmail={userEmail}
          prefill={adoptingOrphan ? { customerName: adoptingOrphan.event.summary?.replace(/^\[.*?\]\s*[-–—]?\s*/, '').trim() || adoptingOrphan.event.summary || '', address: adoptingOrphan.event.location || '', issue: adoptingOrphan.event.description || adoptingOrphan.event.summary || '' } : null}
        />
      )}
      {showOrphanActions && <OrphanActions orphan={showOrphanActions} onClose={() => setShowOrphanActions(null)} />}
    </div>
  );
}
