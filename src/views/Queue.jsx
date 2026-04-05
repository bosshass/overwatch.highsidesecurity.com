// Queue V6.1 — Main Operator Hub with Visual Scheduler + Time Range Picker
// Tabs: Triage | Jobs | Customers | Schedule
// CALENDAR IS SOURCE OF TRUTH — Supabase is for metadata/history only

import { useState, useEffect, useCallback } from 'react';
import { CALENDARS } from '../config/calendars.js';
import { customersApi, jobsApi, JOB_STATUS, STATUS_INFO } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';
const SKIP_PREFIXES = ['[BILLED]','[TO BILL]','[COMPLETED]','[IGNORE]','[IGNORED]','[IGNORE] JR OFF','[ESTIMATE SENT]','[SCHEDULED]'];
const QUEUE_SOURCES = [
  { id: CALENDARS.ADMIN_NOTES,           name: 'Admin Notes',    color: '#ec4899' },
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Service/Urgent', color: '#f59e0b' },
  { id: CALENDARS.AUSTIN,                name: 'Austin',         color: '#f97316' },
  { id: CALENDARS.JR,                    name: 'JR',             color: '#22c55e' },
];
const TECH_CAL_IDS = { Austin: CALENDARS.AUSTIN, JR: CALENDARS.JR };
const TECH_CALENDARS = [CALENDARS.AUSTIN, CALENDARS.JR];
const TECHS = [
  { name: 'Austin', calendarId: CALENDARS.AUSTIN, color: '#f97316' },
  { name: 'JR', calendarId: CALENDARS.JR, color: '#22c55e' },
];

// Tag patterns
const RETURN_TAGS = ['[RETURN]', '[RETURN NEEDED]', '[RETURN PENDING]'];
const PARTS_TAGS = ['[NEEDS PARTS]', '[PARTS]', '[WAITING PARTS]'];
const DONE_TAGS = ['[BILLED]', '[INVOICED]', '[COMPLETED]', '[IGNORE]', '[IGNORED]', '[INVOICE'];

// Helper: strip tags from title to get customer name
const extractCustomerName = (title) => {
  return title
    .replace(/\[.*?\]/g, '')
    .replace(/Confirmed|confirmed/g, '')
    .replace(/- Install|- Return|- Service/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Helper: format date
const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${dayName} · ${diffDays}d ago`;
  return `${dayName}, ${monthDay} · ${diffDays}d ago`;
};

// Helper: generate time options in 30-min increments
const generateTimeOptions = (startHour = 7, endHour = 18) => {
  const times = [];
  for (let h = startHour; h <= endHour; h++) {
    times.push({ hour: h, min: 0, label: `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}` });
    if (h < endHour) {
      times.push({ hour: h, min: 30, label: `${h > 12 ? h - 12 : h}:30 ${h >= 12 ? 'PM' : 'AM'}` });
    }
  }
  return times;
};

const TIME_OPTIONS = generateTimeOptions();

export default function Queue({ accessToken, onBack }) {
  const [activeTab, setActiveTab] = useState('triage');
  
  // Triage state
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [addingNote, setAddingNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Visual Scheduler state
  const [scheduling, setScheduling] = useState(null);
  const [techAvailability, setTechAvailability] = useState({ Austin: [], JR: [] });
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [bookingSlot, setBookingSlot] = useState(null);
  
  // Time picker state
  const [selectedSlot, setSelectedSlot] = useState(null); // { tech, slot, dayData }
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // Jobs tab state
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobSearch, setJobSearch] = useState('');

  // Customers tab state
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerJobs, setCustomerJobs] = useState([]);

  // Schedule tab state
  const [scheduleEvents, setScheduleEvents] = useState({ returns: [], parts: [] });
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIAGE TAB — Calendar events needing action
  // ═══════════════════════════════════════════════════════════════════════════

  const loadQueue = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const now = new Date();
    const tMin = new Date(); tMin.setDate(tMin.getDate() - 60);
    const tMax = new Date(); tMax.setHours(23, 59, 59, 999);
    const results = [];

    await Promise.all(QUEUE_SOURCES.map(async (cal) => {
      try {
        const params = new URLSearchParams({ timeMin: tMin.toISOString(), timeMax: tMax.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '200' });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return;
        const data = await res.json();
        (data.items || []).forEach(ev => {
          if (ev.status === 'cancelled') return;
          const title = ev.summary || '';
          const titleUpper = title.toUpperCase();
          if (SKIP_PREFIXES.some(p => titleUpper.startsWith(p.toUpperCase()))) return;
          if (DONE_TAGS.some(tag => titleUpper.includes(tag.toUpperCase()))) return;
          if (TECH_CALENDARS.includes(cal.id)) {
            const start = new Date(ev.start?.dateTime || ev.start?.date);
            if (start > now) return;
          }
          results.push({ id: ev.id, calendarId: cal.id, calendarName: cal.name, calendarColor: cal.color, title, start: ev.start?.dateTime || ev.start?.date, location: ev.location || '', description: ev.description || '' });
        });
      } catch (e) { console.warn('Queue fetch error:', cal.name, e.message); }
    }));

    results.sort((a, b) => new Date(a.start) - new Date(b.start));
    setEvents(results);
    setLoading(false);
  }, [accessToken]);

  // ═══════════════════════════════════════════════════════════════════════════
  // JOBS TAB
  // ═══════════════════════════════════════════════════════════════════════════

  const searchJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const all = await jobsApi.getAll();
      if (jobSearch.trim()) {
        const q = jobSearch.toLowerCase();
        setJobs(all.filter(j => 
          (j.customer_name || '').toLowerCase().includes(q) ||
          (j.issue || '').toLowerCase().includes(q) ||
          (j.status || '').toLowerCase().includes(q)
        ).slice(0, 50));
      } else {
        setJobs(all.slice(0, 50));
      }
    } catch (e) {
      console.error('Jobs search error:', e);
      setJobs([]);
    }
    setJobsLoading(false);
  }, [jobSearch]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMERS TAB
  // ═══════════════════════════════════════════════════════════════════════════

  const searchCustomers = useCallback(async () => {
    setCustomersLoading(true);
    try {
      if (customerSearch.trim().length >= 2) {
        const results = await customersApi.search(customerSearch);
        setCustomers(results.slice(0, 30));
      } else {
        const all = await customersApi.getAll();
        setCustomers(all.slice(0, 30));
      }
    } catch (e) {
      console.error('Customers load error:', e);
      setCustomers([]);
    }
    setCustomersLoading(false);
  }, [customerSearch]);

  const openCustomer = async (customer) => {
    setSelectedCustomer(customer);
    try {
      const jobs = await customersApi.getJobs(customer.id);
      setCustomerJobs(jobs);
    } catch (e) {
      console.error('Customer jobs error:', e);
      setCustomerJobs([]);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULE TAB — Groups events by customer name
  // ═══════════════════════════════════════════════════════════════════════════

  const loadScheduleQueue = useCallback(async () => {
    if (!accessToken) return;
    setScheduleLoading(true);
    
    const tMin = new Date(); tMin.setDate(tMin.getDate() - 90);
    const tMax = new Date(); tMax.setDate(tMax.getDate() + 30);
    
    const returns = [];
    const parts = [];
    
    const allCals = [
      ...QUEUE_SOURCES,
      { id: CALENDARS.COMPLETED, name: 'Completed', color: '#22c55e' },
      { id: CALENDARS.SALES_ACCOUNTING, name: 'Sales/Acct', color: '#8b5cf6' },
    ];
    
    await Promise.all(allCals.map(async (cal) => {
      try {
        const params = new URLSearchParams({ timeMin: tMin.toISOString(), timeMax: tMax.toISOString(), singleEvents: 'true', maxResults: '250' });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return;
        const data = await res.json();
        
        (data.items || []).forEach(ev => {
          if (ev.status === 'cancelled') return;
          const title = (ev.summary || '').toUpperCase();
          
          const isDone = DONE_TAGS.some(tag => title.includes(tag.toUpperCase()));
          if (isDone) return;
          
          const isReturn = RETURN_TAGS.some(tag => title.includes(tag.toUpperCase()));
          const isParts = PARTS_TAGS.some(tag => title.includes(tag.toUpperCase()));
          
          const eventData = {
            id: ev.id,
            calendarId: cal.id,
            calendarName: cal.name,
            calendarColor: cal.color,
            title: ev.summary || '',
            customerName: extractCustomerName(ev.summary || ''),
            start: ev.start?.dateTime || ev.start?.date,
            location: ev.location || '',
            description: ev.description || '',
          };
          
          if (isReturn) returns.push(eventData);
          if (isParts) parts.push(eventData);
        });
      } catch (e) { console.warn('Schedule fetch error:', cal.name, e.message); }
    }));
    
    // Group by customer name
    const groupByCustomer = (items) => {
      const groups = {};
      items.forEach(item => {
        const key = item.customerName || 'Unknown';
        if (!groups[key]) {
          groups[key] = { customerName: key, location: item.location, events: [] };
        }
        groups[key].events.push(item);
        if (!groups[key].location && item.location) groups[key].location = item.location;
      });
      Object.values(groups).forEach(g => g.events.sort((a, b) => new Date(a.start) - new Date(b.start)));
      return Object.values(groups).sort((a, b) => new Date(a.events[0]?.start) - new Date(b.events[0]?.start));
    };
    
    setScheduleEvents({ returns: groupByCustomer(returns), parts: groupByCustomer(parts) });
    setScheduleLoading(false);
  }, [accessToken]);

  // ═══════════════════════════════════════════════════════════════════════════
  // VISUAL SCHEDULER — Load tech availability for next 14 days
  // ═══════════════════════════════════════════════════════════════════════════

  const loadTechAvailability = useCallback(async () => {
    if (!accessToken) return;
    setLoadingAvail(true);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 14);
    
    const availability = { Austin: [], JR: [] };
    
    for (const tech of TECHS) {
      try {
        const params = new URLSearchParams({
          timeMin: today.toISOString(),
          timeMax: endDate.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100'
        });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(tech.calendarId)}/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) continue;
        const data = await res.json();
        
        for (let d = 0; d < 14; d++) {
          const day = new Date(today);
          day.setDate(day.getDate() + d);
          const dayStr = day.toISOString().split('T')[0];
          
          const dayEvents = (data.items || []).filter(ev => {
            if (ev.status === 'cancelled') return false;
            const evStart = new Date(ev.start?.dateTime || ev.start?.date);
            return evStart.toISOString().split('T')[0] === dayStr;
          });
          
          let bookedHours = 0;
          dayEvents.forEach(ev => {
            const start = new Date(ev.start?.dateTime || ev.start?.date);
            const end = new Date(ev.end?.dateTime || ev.end?.date);
            bookedHours += (end - start) / (1000 * 60 * 60);
          });
          
          const workdayHours = 11;
          const freeHours = Math.max(0, workdayHours - bookedHours);
          
          // Find free slots
          const freeSlots = [];
          const busyPeriods = dayEvents.map(ev => ({
            start: new Date(ev.start?.dateTime || ev.start?.date),
            end: new Date(ev.end?.dateTime || ev.end?.date),
            title: ev.summary || ''
          })).sort((a, b) => a.start - b.start);
          
          const workStart = new Date(day); workStart.setHours(7, 0, 0, 0);
          const workEnd = new Date(day); workEnd.setHours(18, 0, 0, 0);
          
          let cursor = workStart;
          busyPeriods.forEach(busy => {
            if (busy.start > cursor) {
              const duration = (busy.start - cursor) / (1000 * 60 * 60);
              if (duration >= 0.5) freeSlots.push({ start: new Date(cursor), end: new Date(busy.start), hours: duration });
            }
            if (busy.end > cursor) cursor = new Date(busy.end);
          });
          if (cursor < workEnd) {
            const duration = (workEnd - cursor) / (1000 * 60 * 60);
            if (duration >= 0.5) freeSlots.push({ start: new Date(cursor), end: new Date(workEnd), hours: duration });
          }
          
          availability[tech.name].push({
            date: dayStr,
            day: day.toLocaleDateString('en-US', { weekday: 'short' }),
            dayNum: day.getDate(),
            month: day.toLocaleDateString('en-US', { month: 'short' }),
            bookedHours,
            freeHours,
            freeSlots,
            events: dayEvents.map(ev => ({ title: ev.summary || '', start: ev.start?.dateTime || ev.start?.date, end: ev.end?.dateTime || ev.end?.date })),
            isWeekend: day.getDay() === 0 || day.getDay() === 6
          });
        }
      } catch (e) { console.warn('Availability fetch error:', tech.name, e.message); }
    }
    
    setTechAvailability(availability);
    setLoadingAvail(false);
  }, [accessToken]);

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOK SLOT — Create calendar event with custom time range
  // ═══════════════════════════════════════════════════════════════════════════

  const openTimePicker = (tech, slot, dayData) => {
    setSelectedSlot({ tech, slot, dayData });
    // Default to slot start and +2 hours or slot end
    const defaultStart = `${slot.start.getHours().toString().padStart(2,'0')}:${slot.start.getMinutes().toString().padStart(2,'0')}`;
    const defaultEndDate = new Date(slot.start.getTime() + 2 * 60 * 60 * 1000);
    const maxEnd = slot.end < defaultEndDate ? slot.end : defaultEndDate;
    const defaultEnd = `${maxEnd.getHours().toString().padStart(2,'0')}:${maxEnd.getMinutes().toString().padStart(2,'0')}`;
    setStartTime(defaultStart);
    setEndTime(defaultEnd);
  };

  const confirmBooking = async () => {
    if (!selectedSlot || !startTime || !endTime || !scheduling) return;
    
    const { tech, slot } = selectedSlot;
    const calendarId = TECH_CAL_IDS[tech];
    
    // Build start/end dates
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    
    const startDate = new Date(slot.start);
    startDate.setHours(startH, startM, 0, 0);
    
    const endDate = new Date(slot.start);
    endDate.setHours(endH, endM, 0, 0);
    
    if (endDate <= startDate) {
      alert('End time must be after start time');
      return;
    }
    
    setBookingSlot(`${tech}-confirming`);
    
    const title = scheduling.title.includes('[RETURN') ? scheduling.title : `[RETURN] ${extractCustomerName(scheduling.title)}`;
    
    const newEvent = {
      summary: title,
      location: scheduling.location,
      description: `Return visit scheduled from Queue.\n\nOriginal: ${scheduling.title}\n\n${scheduling.description || ''}`,
      start: { dateTime: startDate.toISOString(), timeZone: 'America/Denver' },
      end: { dateTime: endDate.toISOString(), timeZone: 'America/Denver' }
    };
    
    try {
      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent)
      });
      
      if (res.ok) {
        const duration = (endDate - startDate) / (1000 * 60 * 60);
        alert(`✅ Booked ${duration.toFixed(1)}h on ${tech}'s calendar!\n\n${startDate.toLocaleString()} - ${endDate.toLocaleTimeString()}`);
        setScheduling(null);
        setSelectedDay(null);
        setSelectedSlot(null);
        loadTechAvailability();
        loadQueue();
        loadScheduleQueue();
      } else {
        const err = await res.json();
        alert(`❌ Failed: ${err.error?.message || 'Unknown error'}`);
      }
    } catch (e) { alert(`❌ Error: ${e.message}`); }
    
    setBookingSlot(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const updateEventTitle = async (event, newTitle) => {
    try {
      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: newTitle })
      });
      return res.ok;
    } catch (e) { return false; }
  };

  const markBilled = async (ev) => { setActing(ev.id); if (await updateEventTitle(ev, `[BILLED] ${ev.title}`)) loadQueue(); setActing(null); };
  const markIgnore = async (ev) => { setActing(ev.id); if (await updateEventTitle(ev, `[IGNORE] ${ev.title}`)) loadQueue(); setActing(null); };
  const markNeedsParts = async (ev) => { setActing(ev.id); if (await updateEventTitle(ev, `[NEEDS PARTS] ${ev.title}`)) loadQueue(); setActing(null); };
  const markDone = async (ev) => { setActing(ev.id); if (await updateEventTitle(ev, `[COMPLETED] ${ev.title}`)) { loadQueue(); loadScheduleQueue(); } setActing(null); };

  const addNote = async (ev) => {
    if (!addingNote.trim()) return;
    setSavingNote(true);
    const timestamp = new Date().toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
    const newDesc = `${ev.description || ''}\n\n💬 ${addingNote} — ${timestamp}`.trim();
    try {
      await fetch(`${GCAL}/calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newDesc })
      });
      setAddingNote('');
      loadQueue();
    } catch (e) { console.error('Add note error:', e); }
    setSavingNote(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => { loadQueue(); loadTechAvailability(); }, [loadQueue, loadTechAvailability]);
  useEffect(() => { if (activeTab === 'jobs') searchJobs(); }, [activeTab, searchJobs]);
  useEffect(() => { if (activeTab === 'customers') searchCustomers(); }, [activeTab, searchCustomers]);
  useEffect(() => { if (activeTab === 'schedule') loadScheduleQueue(); }, [activeTab, loadScheduleQueue]);

  const countReturns = scheduleEvents.returns.reduce((sum, g) => sum + g.events.length, 0);
  const countParts = scheduleEvents.parts.reduce((sum, g) => sum + g.events.length, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // VISUAL SCHEDULER MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  const renderSchedulerModal = () => {
    if (!scheduling) return null;
    
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div style={{ background: '#1e293b', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 800, maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>📅 Schedule Return</h3>
              <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 14 }}>{extractCustomerName(scheduling.title)}</p>
              {scheduling.location && <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: 12 }}>📍 {scheduling.location}</p>}
            </div>
            <button onClick={() => { setScheduling(null); setSelectedDay(null); setSelectedSlot(null); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' }}>✕</button>
          </div>
          
          {loadingAvail ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading availability...</div>
          ) : selectedSlot ? (
            /* TIME PICKER VIEW */
            <div>
              <button onClick={() => setSelectedSlot(null)} style={{ background: '#334155', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, marginBottom: 16, cursor: 'pointer' }}>← Back</button>
              
              <div style={{ background: '#0f172a', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: TECHS.find(t => t.name === selectedSlot.tech)?.color }} />
                  <span style={{ color: '#fff', fontWeight: 600 }}>{selectedSlot.tech}</span>
                  <span style={{ color: '#64748b' }}>·</span>
                  <span style={{ color: '#94a3b8' }}>{new Date(selectedSlot.slot.start).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                </div>
                
                <div style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                  Available: {selectedSlot.slot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {selectedSlot.slot.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ({selectedSlot.slot.hours.toFixed(1)}h)
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Start Time</label>
                    <input 
                      type="time" 
                      value={startTime} 
                      onChange={e => setStartTime(e.target.value)}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px', color: '#fff', fontSize: 16 }}
                    />
                  </div>
                  <div>
                    <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>End Time</label>
                    <input 
                      type="time" 
                      value={endTime} 
                      onChange={e => setEndTime(e.target.value)}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px', color: '#fff', fontSize: 16 }}
                    />
                  </div>
                </div>
                
                {startTime && endTime && (() => {
                  const [sh, sm] = startTime.split(':').map(Number);
                  const [eh, em] = endTime.split(':').map(Number);
                  const duration = (eh * 60 + em) - (sh * 60 + sm);
                  if (duration > 0) {
                    return <div style={{ color: '#22c55e', fontSize: 14, marginTop: 12, textAlign: 'center' }}>Duration: {(duration / 60).toFixed(1)} hours</div>;
                  }
                  return <div style={{ color: '#ef4444', fontSize: 14, marginTop: 12, textAlign: 'center' }}>End time must be after start time</div>;
                })()}
              </div>
              
              <button
                onClick={confirmBooking}
                disabled={bookingSlot || !startTime || !endTime}
                style={{ 
                  width: '100%', 
                  background: bookingSlot ? '#475569' : '#3b82f6', 
                  border: 'none', 
                  color: '#fff', 
                  padding: 16, 
                  borderRadius: 12, 
                  fontSize: 16, 
                  fontWeight: 600,
                  cursor: bookingSlot ? 'not-allowed' : 'pointer'
                }}
              >
                {bookingSlot ? 'Booking...' : `✓ Book on ${selectedSlot.tech}'s Calendar`}
              </button>
            </div>
          ) : selectedDay ? (
            /* DAY DETAIL VIEW */
            <div>
              <button onClick={() => setSelectedDay(null)} style={{ background: '#334155', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, marginBottom: 16, cursor: 'pointer' }}>← Back</button>
              <h4 style={{ color: '#fff', margin: '0 0 16px' }}>{new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h4>
              
              {TECHS.map(tech => {
                const dayData = techAvailability[tech.name]?.find(d => d.date === selectedDay);
                if (!dayData) return null;
                
                return (
                  <div key={tech.name} style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: tech.color }} />
                      <span style={{ color: '#fff', fontWeight: 600 }}>{tech.name}</span>
                      <span style={{ color: '#64748b', fontSize: 13 }}>{dayData.freeHours.toFixed(1)}h free</span>
                    </div>
                    
                    {dayData.events.length > 0 && (
                      <div style={{ marginBottom: 12, paddingLeft: 20 }}>
                        <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Booked:</div>
                        {dayData.events.map((ev, i) => (
                          <div key={i} style={{ color: '#94a3b8', fontSize: 13, padding: '4px 0' }}>
                            {new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {new Date(ev.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {ev.title}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {dayData.freeSlots.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 20 }}>
                        {dayData.freeSlots.map((slot, i) => (
                          <button
                            key={i}
                            onClick={() => openTimePicker(tech.name, slot, dayData)}
                            style={{ background: tech.color, border: 'none', color: '#fff', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
                          >
                            {slot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {slot.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            <span style={{ opacity: 0.7, marginLeft: 4 }}>({slot.hours.toFixed(1)}h)</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#ef4444', fontSize: 13, paddingLeft: 20 }}>No availability</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* CALENDAR GRID VIEW */
            <div>
              <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>Tap a day to see available time slots</p>
              
              {TECHS.map(tech => (
                <div key={tech.name} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: tech.color }} />
                    <span style={{ color: '#fff', fontWeight: 600 }}>{tech.name}</span>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                    {techAvailability[tech.name]?.map((day, i) => {
                      const pctFree = (day.freeHours / 11) * 100;
                      const bgColor = day.isWeekend ? '#1e293b' : pctFree > 70 ? '#166534' : pctFree > 30 ? '#ca8a04' : pctFree > 0 ? '#c2410c' : '#7f1d1d';
                      
                      return (
                        <button
                          key={i}
                          onClick={() => !day.isWeekend && setSelectedDay(day.date)}
                          disabled={day.isWeekend}
                          style={{ background: bgColor, border: 'none', borderRadius: 8, padding: 8, cursor: day.isWeekend ? 'not-allowed' : 'pointer', opacity: day.isWeekend ? 0.4 : 1, textAlign: 'center' }}
                        >
                          <div style={{ color: '#94a3b8', fontSize: 10 }}>{day.day}</div>
                          <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>{day.dayNum}</div>
                          <div style={{ color: '#94a3b8', fontSize: 10 }}>{day.freeHours.toFixed(0)}h</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 16 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#166534', marginRight: 4 }} />Wide open</span>
                <span style={{ color: '#94a3b8', fontSize: 12 }}><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#ca8a04', marginRight: 4 }} />Partial</span>
                <span style={{ color: '#94a3b8', fontSize: 12 }}><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#c2410c', marginRight: 4 }} />Tight</span>
                <span style={{ color: '#94a3b8', fontSize: 12 }}><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: '#7f1d1d', marginRight: 4 }} />Full</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderBottom: '1px solid #334155' }}>
        <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>← Home</button>
        <h2 style={{ margin: 0 }}>📂 Queue</h2>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #334155' }}>
        {[
          { key: 'triage', label: 'Triage', count: events.length },
          { key: 'jobs', label: 'Jobs' },
          { key: 'customers', label: 'Customers' },
          { key: 'schedule', label: 'Schedule', count: countReturns + countParts },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ flex: 1, padding: '12px 8px', background: 'none', border: 'none', borderBottom: activeTab === tab.key ? '2px solid #f59e0b' : '2px solid transparent', color: activeTab === tab.key ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontSize: 14 }}>
            {tab.label}
            {tab.count > 0 && <span style={{ marginLeft: 6, background: '#f59e0b', color: '#000', padding: '2px 6px', borderRadius: 10, fontSize: 11 }}>{tab.count}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {activeTab === 'triage' && (
          loading ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading queue...</div> :
          events.length === 0 ? <div style={{ textAlign: 'center', padding: 40 }}><div style={{ fontSize: 48, marginBottom: 16 }}>✅</div><div style={{ color: '#94a3b8' }}>Queue is clear!</div></div> :
          events.map(ev => (
            <div key={ev.id} style={{ background: '#1e293b', borderRadius: 12, marginBottom: 12, borderLeft: `4px solid ${ev.calendarColor}`, overflow: 'hidden' }}>
              <div onClick={() => setExpanded(expanded === ev.id ? null : ev.id)} style={{ padding: 16, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ background: ev.calendarColor, color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{ev.calendarName}</span>
                  <span style={{ color: '#fff', fontWeight: 500 }}>{ev.title}</span>
                </div>
                <div style={{ color: '#64748b', fontSize: 13 }}>{formatDate(ev.start)}</div>
                {ev.location && <div style={{ color: '#64748b', fontSize: 13 }}>📍 {ev.location}</div>}
              </div>
              
              {expanded === ev.id && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid #334155' }}>
                  {ev.description ? <div style={{ color: '#94a3b8', fontSize: 14, whiteSpace: 'pre-wrap', marginTop: 12 }}>{ev.description}</div> : <div style={{ color: '#64748b', fontSize: 14, fontStyle: 'italic', marginTop: 12 }}>No notes yet</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <input type="text" value={addingNote} onChange={e => setAddingNote(e.target.value)} placeholder="Add a note..." style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', color: '#fff' }} />
                    <button onClick={() => addNote(ev)} disabled={savingNote || !addingNote.trim()} style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>💾</button>
                  </div>
                </div>
              )}
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #334155' }}>
                <button onClick={() => { setScheduling(ev); loadTechAvailability(); }} style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: 12, cursor: 'pointer', borderRight: '1px solid #334155' }}>📅 Schedule</button>
                <button onClick={() => markBilled(ev)} disabled={acting === ev.id} style={{ background: '#059669', border: 'none', color: '#fff', padding: 12, cursor: 'pointer' }}>💰 Bill It</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #334155' }}>
                <button onClick={() => markNeedsParts(ev)} disabled={acting === ev.id} style={{ background: '#1e293b', border: 'none', color: '#f59e0b', padding: 12, cursor: 'pointer', borderRight: '1px solid #334155' }}>🔧 Needs Parts</button>
                <button onClick={() => markIgnore(ev)} disabled={acting === ev.id} style={{ background: '#1e293b', border: 'none', color: '#64748b', padding: 12, cursor: 'pointer' }}>🗑️ Ignore</button>
              </div>
            </div>
          ))
        )}

        {activeTab === 'jobs' && (
          <div>
            <input type="text" value={jobSearch} onChange={e => setJobSearch(e.target.value)} placeholder="Search jobs..." style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px 16px', color: '#fff', marginBottom: 16 }} />
            {jobsLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading...</div> :
             jobs.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No jobs found</div> :
             jobs.map(job => (
              <div key={job.id} style={{ background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <div style={{ fontWeight: 500 }}>{job.customer_name}</div>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>{job.issue}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <span style={{ background: STATUS_INFO[job.status]?.color || '#64748b', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{STATUS_INFO[job.status]?.label || job.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'customers' && (
          <div>
            <input type="text" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Search customers..." style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px 16px', color: '#fff', marginBottom: 16 }} />
            {selectedCustomer ? (
              <div>
                <button onClick={() => setSelectedCustomer(null)} style={{ background: '#334155', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, marginBottom: 16, cursor: 'pointer' }}>← Back</button>
                <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <h3 style={{ margin: '0 0 8px' }}>{selectedCustomer.name}</h3>
                  {selectedCustomer.phone && <div style={{ color: '#94a3b8' }}>📞 {selectedCustomer.phone}</div>}
                  {selectedCustomer.address && <div style={{ color: '#94a3b8' }}>📍 {selectedCustomer.address}</div>}
                </div>
                <h4 style={{ color: '#94a3b8', marginBottom: 12 }}>Job History ({customerJobs.length})</h4>
                {customerJobs.map(job => (
                  <div key={job.id} style={{ background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                    <div style={{ fontWeight: 500 }}>{job.issue}</div>
                    <div style={{ color: '#64748b', fontSize: 13 }}>{new Date(job.created_at).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            ) : customersLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading...</div> :
            customers.map(c => (
              <div key={c.id} onClick={() => openCustomer(c)} style={{ background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 12, cursor: 'pointer' }}>
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                {c.phone && <div style={{ color: '#64748b', fontSize: 13 }}>📞 {c.phone}</div>}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'schedule' && (
          scheduleLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading...</div> :
          <div>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ color: '#f59e0b', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>🔄 Returns Pending<span style={{ background: '#f59e0b', color: '#000', padding: '2px 8px', borderRadius: 10, fontSize: 12 }}>{countReturns}</span></h3>
              {scheduleEvents.returns.length === 0 ? <div style={{ color: '#64748b', fontStyle: 'italic' }}>No returns pending</div> :
              scheduleEvents.returns.map((group, i) => (
                <div key={i} style={{ background: '#1e293b', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ padding: 16, borderBottom: '1px solid #334155' }}>
                    <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>📦 {group.customerName}</div>
                    {group.location && <div style={{ color: '#64748b', fontSize: 13 }}>📍 {group.location}</div>}
                  </div>
                  {group.events.map((ev, j) => (
                    <div key={j} style={{ padding: '12px 16px', borderBottom: '1px solid #334155', background: '#0f172a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ color: ev.calendarColor, fontSize: 12, marginRight: 8 }}>{ev.calendarName}</span>
                          <span style={{ color: '#94a3b8', fontSize: 13 }}>{formatDate(ev.start)}</span>
                        </div>
                      </div>
                      {ev.description && <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{ev.description.slice(0, 100)}...</div>}
                    </div>
                  ))}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <button onClick={() => { setScheduling(group.events[0]); loadTechAvailability(); }} style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: 12, cursor: 'pointer', borderRight: '1px solid #334155' }}>📅 Schedule</button>
                    <button onClick={() => markDone(group.events[0])} disabled={acting === group.events[0]?.id} style={{ background: '#059669', border: 'none', color: '#fff', padding: 12, cursor: 'pointer' }}>✓ Done</button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <h3 style={{ color: '#f59e0b', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>🔧 Parts Waiting<span style={{ background: '#f59e0b', color: '#000', padding: '2px 8px', borderRadius: 10, fontSize: 12 }}>{countParts}</span></h3>
              {scheduleEvents.parts.length === 0 ? <div style={{ color: '#64748b', fontStyle: 'italic' }}>No parts waiting</div> :
              scheduleEvents.parts.map((group, i) => (
                <div key={i} style={{ background: '#1e293b', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ padding: 16, borderBottom: '1px solid #334155' }}>
                    <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>📦 {group.customerName}</div>
                    {group.location && <div style={{ color: '#64748b', fontSize: 13 }}>📍 {group.location}</div>}
                  </div>
                  {group.events.map((ev, j) => (
                    <div key={j} style={{ padding: '12px 16px', borderBottom: '1px solid #334155', background: '#0f172a' }}>
                      <span style={{ color: ev.calendarColor, fontSize: 12, marginRight: 8 }}>{ev.calendarName}</span>
                      <span style={{ color: '#94a3b8', fontSize: 13 }}>{formatDate(ev.start)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <button onClick={() => { setScheduling(group.events[0]); loadTechAvailability(); }} style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: 12, cursor: 'pointer', borderRight: '1px solid #334155' }}>📅 Schedule</button>
                    <button onClick={() => markDone(group.events[0])} style={{ background: '#059669', border: 'none', color: '#fff', padding: 12, cursor: 'pointer' }}>✓ Done</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {renderSchedulerModal()}
    </div>
  );
}
