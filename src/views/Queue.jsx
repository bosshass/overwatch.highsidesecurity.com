// Queue — Main Operator Hub
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
const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7am–6pm

// Tag patterns for Schedule tab (calendar-based)
const RETURN_TAGS = ['[RETURN]', '[RETURN NEEDED]', '[RETURN PENDING]'];
const PARTS_TAGS = ['[NEEDS PARTS]', '[PARTS]', '[WAITING PARTS]'];

// Tags that indicate work is DONE — filter these out even if they have [RETURN] or [NEEDS PARTS]
const DONE_TAGS = ['[BILLED]', '[INVOICED]', '[COMPLETED]', '[IGNORE]', '[IGNORED]', '[INVOICE'];

export default function Queue({ accessToken, onBack }) {
  const [activeTab, setActiveTab] = useState('triage');
  
  // Triage state
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('09:00');
  const [schedTech, setSchedTech] = useState('Austin');
  const [availability, setAvailability] = useState([]);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [addingNote, setAddingNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

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

  // Schedule tab state (calendar-based returns/parts)
  const [scheduleEvents, setScheduleEvents] = useState({ returns: [], parts: [] });
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIAGE TAB — Calendar events needing action
  // ═══════════════════════════════════════════════════════════════════════════

  const loadTriage = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const now = new Date();
    const tMin = new Date(); tMin.setDate(tMin.getDate() - 90);
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
          // Skip if starts with a done prefix
          if (SKIP_PREFIXES.some(p => titleUpper.startsWith(p.toUpperCase()))) return;
          // Skip if contains any done tag anywhere (handles stacked tags like [BILLED] [RETURN NEEDED])
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
  // JOBS TAB — Supabase job history lookup (not source of truth, just metadata)
  // ═══════════════════════════════════════════════════════════════════════════

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      if (jobSearch.length >= 2) {
        const results = await jobsApi.search(jobSearch);
        setJobs(results);
      } else {
        // Show recent jobs
        const results = await jobsApi.getByStatus([
          JOB_STATUS.SCHEDULED, JOB_STATUS.COMPLETE, JOB_STATUS.TO_BILL,
          JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT
        ]);
        setJobs(results.slice(0, 50));
      }
    } catch (e) {
      console.error('Jobs load error:', e);
      setJobs([]);
    }
    setJobsLoading(false);
  }, [jobSearch]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMERS TAB — Customer search with job history
  // ═══════════════════════════════════════════════════════════════════════════

  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true);
    try {
      if (customerSearch.length >= 2) {
        const results = await customersApi.search(customerSearch);
        setCustomers(results);
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
  // SCHEDULE TAB — Calendar events tagged as returns/parts (SOURCE OF TRUTH)
  // ═══════════════════════════════════════════════════════════════════════════

  const loadScheduleQueue = useCallback(async () => {
    if (!accessToken) return;
    setScheduleLoading(true);
    
    const tMin = new Date(); tMin.setDate(tMin.getDate() - 90);
    const tMax = new Date(); tMax.setDate(tMax.getDate() + 30);
    
    const returns = [];
    const parts = [];
    
    // Check all calendars for tagged events
    const allCals = [
      ...QUEUE_SOURCES,
      { id: CALENDARS.COMPLETED, name: 'Completed', color: '#22c55e' },
      { id: CALENDARS.SALES_ACCOUNTING, name: 'Sales/Acct', color: '#8b5cf6' },
    ];
    
    await Promise.all(allCals.map(async (cal) => {
      try {
        const params = new URLSearchParams({ 
          timeMin: tMin.toISOString(), 
          timeMax: tMax.toISOString(), 
          singleEvents: 'true', 
          maxResults: '250' 
        });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`, { 
          headers: { Authorization: `Bearer ${accessToken}` } 
        });
        if (!res.ok) return;
        const data = await res.json();
        
        (data.items || []).forEach(ev => {
          if (ev.status === 'cancelled') return;
          const title = (ev.summary || '').toUpperCase();
          
          // Skip if event has any done tag (billed, completed, invoiced, ignored)
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
            start: ev.start?.dateTime || ev.start?.date,
            location: ev.location || '',
            description: ev.description || '',
          };
          
          if (isReturn) returns.push(eventData);
          if (isParts) parts.push(eventData);
        });
      } catch (e) { console.warn('Schedule fetch error:', cal.name, e.message); }
    }));
    
    // Sort by date
    returns.sort((a, b) => new Date(a.start) - new Date(b.start));
    parts.sort((a, b) => new Date(a.start) - new Date(b.start));
    
    setScheduleEvents({ returns, parts });
    setScheduleLoading(false);
  }, [accessToken]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => { 
    if (activeTab === 'triage') loadTriage(); 
  }, [activeTab, loadTriage]);
  
  useEffect(() => { 
    if (activeTab === 'jobs') loadJobs(); 
  }, [activeTab, loadJobs]);
  
  useEffect(() => { 
    if (activeTab === 'customers') loadCustomers(); 
  }, [activeTab, loadCustomers]);
  
  useEffect(() => { 
    if (activeTab === 'schedule') loadScheduleQueue(); 
  }, [activeTab, loadScheduleQueue]);

  // Availability for scheduling
  useEffect(() => {
    if (!schedDate || !schedTech || !accessToken) { setAvailability([]); return; }
    const fetchAvail = async () => {
      setLoadingAvail(true);
      const calId = TECH_CAL_IDS[schedTech];
      const dayStart = new Date(`${schedDate}T00:00:00`);
      const dayEnd   = new Date(`${schedDate}T23:59:59`);
      try {
        const params = new URLSearchParams({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await res.json();
        setAvailability((data.items || []).filter(e => e.status !== 'cancelled' && e.start?.dateTime).map(e => ({ start: new Date(e.start.dateTime), end: new Date(e.end.dateTime), title: e.summary || '' })));
      } catch { setAvailability([]); }
      setLoadingAvail(false);
    };
    fetchAvail();
  }, [schedDate, schedTech, accessToken]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIAGE ACTIONS (Calendar operations)
  // ═══════════════════════════════════════════════════════════════════════════

  const saveNote = async (ev) => {
    if (!addingNote.trim()) return;
    setSavingNote(true);
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });
    const newDesc = (ev.description ? ev.description + '\n\n' : '') + `📝 ${ts}: ${addingNote.trim()}`;
    await fetch(`${GCAL}/calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: newDesc }),
    });
    setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, description: newDesc } : e));
    setAddingNote('');
    setSavingNote(false);
  };

  const moveToCompleted = async (ev) => {
    try {
      await fetch(`${GCAL}/calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (e) { console.warn('Move to completed failed:', e.message); }
  };

  const handleBill = async (ev) => {
    setActing(ev.id);
    const stripped = ev.title.replace(/^\[.*?\]\s*/, '');
    const newEvent = { summary: `[TO BILL] ${stripped}`, description: ev.description, location: ev.location, start: { date: new Date().toISOString().split('T')[0] }, end: { date: new Date().toISOString().split('T')[0] } };
    await fetch(`${GCAL}/calendars/${encodeURIComponent(CALENDARS.SALES_ACCOUNTING)}/events`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(newEvent) });
    await moveToCompleted(ev);
    setEvents(prev => prev.filter(e => e.id !== ev.id));
    setActing(null);
  };

  const handleNeedsParts = async (ev) => {
    setActing(ev.id);
    const stripped = ev.title.replace(/^\[.*?\]\s*/, '');
    await fetch(`${GCAL}/calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: `[NEEDS PARTS] ${stripped}` }),
    });
    setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, title: `[NEEDS PARTS] ${stripped}` } : e));
    setActing(null);
  };

  const handleIgnore = async (ev) => {
    setActing(ev.id);
    await moveToCompleted(ev);
    setEvents(prev => prev.filter(e => e.id !== ev.id));
    setActing(null);
  };

  const handleSchedule = async () => {
    if (!scheduling || !schedDate || !schedTime) return;
    setActing(scheduling.id);
    const techCalId = TECH_CAL_IDS[schedTech];
    const startDT = new Date(`${schedDate}T${schedTime}:00`);
    const endDT   = new Date(startDT.getTime() + 2 * 60 * 60 * 1000);
    const stripped = scheduling.title.replace(/^\[.*?\]\s*/, '');
    await fetch(`${GCAL}/calendars/${encodeURIComponent(techCalId)}/events`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: stripped, location: scheduling.location, description: (scheduling.description || '') + `\n\nScheduled via JUC-E Queue`, start: { dateTime: startDT.toISOString(), timeZone: 'America/Denver' }, end: { dateTime: endDT.toISOString(), timeZone: 'America/Denver' } }),
    });
    await moveToCompleted(scheduling);
    setEvents(prev => prev.filter(e => e.id !== scheduling.id));
    setScheduling(null);
    setActing(null);
  };

  // Schedule tab action: Remove tag and reschedule
  const handleClearTag = async (ev, tagType) => {
    setActing(ev.id);
    const tagsToRemove = tagType === 'return' ? RETURN_TAGS : PARTS_TAGS;
    let newTitle = ev.title;
    tagsToRemove.forEach(tag => {
      newTitle = newTitle.replace(new RegExp(tag.replace(/[[\]]/g, '\\$&'), 'gi'), '');
    });
    newTitle = newTitle.trim();
    
    await fetch(`${GCAL}/calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: newTitle }),
    });
    
    // Refresh
    loadScheduleQueue();
    setActing(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const isHourBusy = (h) => availability.some(b => { const s = b.start.getHours() + b.start.getMinutes()/60, e = b.end.getHours() + b.end.getMinutes()/60; return h < e && (h+1) > s; });
  const getBusyLabel = (h) => (availability.find(b => { const s = b.start.getHours() + b.start.getMinutes()/60, e = b.end.getHours() + b.end.getMinutes()/60; return h < e && (h+1) > s; }) || {}).title || '';
  const fmtHour = (h) => h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
  const formatDate = (dateStr) => { if (!dateStr) return ''; const d = new Date(dateStr); const ago = Math.floor((Date.now()-d)/86400000); return `${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${ago===0?'Today':ago===1?'Yesterday':ago>0?`${ago}d ago`:`in ${-ago}d`}`; };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  const tabs = [
    { key: 'triage', label: 'Triage', badge: events.length },
    { key: 'jobs', label: 'Jobs' },
    { key: 'customers', label: 'Customers' },
    { key: 'schedule', label: 'Schedule', badge: scheduleEvents.returns.length + scheduleEvents.parts.length },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderBottom:'1px solid #1e293b', position:'sticky', top:0, background:'#0f1729', zIndex:10 }}>
        <button onClick={onBack} style={{ background:'none', border:'1px solid #334155', borderRadius:8, color:'#94a3b8', padding:'6px 12px', fontSize:13, cursor:'pointer' }}>← Home</button>
        <div style={{ flex: 1 }}>
          <div style={{ color:'#f59e0b', fontWeight:700, fontSize:16 }}>🗂️ Queue</div>
        </div>
        <button onClick={() => {
          if (activeTab === 'triage') loadTriage();
          if (activeTab === 'jobs') loadJobs();
          if (activeTab === 'customers') loadCustomers();
          if (activeTab === 'schedule') loadScheduleQueue();
        }} style={{ background:'none', border:'1px solid #334155', borderRadius:8, color:'#64748b', padding:'6px 12px', fontSize:12, cursor:'pointer' }}>↻</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', position: 'sticky', top: 49, background: '#0f1729', zIndex: 9 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1, padding: '12px 8px', background: 'none', border: 'none',
              color: activeTab === t.key ? '#f59e0b' : '#64748b',
              fontSize: 13, fontWeight: activeTab === t.key ? 700 : 500,
              borderBottom: activeTab === t.key ? '2px solid #f59e0b' : '2px solid transparent',
              cursor: 'pointer', position: 'relative'
            }}
          >
            {t.label}
            {t.badge > 0 && (
              <span style={{
                marginLeft: 6, background: '#ef4444', color: '#fff',
                fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* TRIAGE TAB */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'triage' && (
        <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
          {loading && <div style={{ textAlign:'center', padding:40, color:'#475569' }}>Loading queue...</div>}
          {!loading && events.length === 0 && (
            <div style={{ textAlign:'center', padding:60 }}>
              <div style={{ fontSize:48, marginBottom:12 }}>🎉</div>
              <div style={{ color:'#22c55e', fontSize:18, fontWeight:700 }}>Queue is clear</div>
              <div style={{ color:'#475569', fontSize:13, marginTop:4 }}>Nothing waiting for attention</div>
            </div>
          )}
          {events.map(ev => {
            const isExpanded = expanded === ev.id;
            const cleanDesc = ev.description.replace(/\n\nScheduled.*|📱.*|Open in JUC-E.*/g,'').trim();
            const needsParts = ev.title.toUpperCase().startsWith('[NEEDS PARTS]');
            return (
            <div key={ev.id} style={{ background:'#1a1a2e', borderRadius:12, borderLeft:`3px solid ${needsParts?'#f97316':ev.calendarColor}`, overflow:'hidden' }}>
              <div onClick={() => { setExpanded(isExpanded ? null : ev.id); setAddingNote(''); }} style={{ padding:'12px 14px', cursor:'pointer' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:6 }}>
                  <span style={{ background:ev.calendarColor+'25', color:ev.calendarColor, fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap', marginTop:2 }}>{ev.calendarName}</span>
                  <div style={{ color:'#e2e8f0', fontSize:14, fontWeight:600, lineHeight:1.3, flex:1 }}>{ev.title}</div>
                  <span style={{ color:'#334155', fontSize:12, marginTop:2 }}>{isExpanded?'▲':'▼'}</span>
                </div>
                <div style={{ color:'#64748b', fontSize:11 }}>{formatDate(ev.start)}</div>
                {ev.location && <div style={{ color:'#475569', fontSize:11, marginTop:2 }}>📍 {ev.location}</div>}
                {!isExpanded && cleanDesc && (
                  <div style={{ color:'#475569', fontSize:11, marginTop:6, borderTop:'1px solid #1e293b', paddingTop:6, fontStyle:'italic' }}>
                    {cleanDesc.split('\n').filter(Boolean).pop()?.slice(0,90)}...
                  </div>
                )}
              </div>
              {isExpanded && (
                <div style={{ padding:'0 14px 12px', borderTop:'1px solid #0f1729' }}>
                  {cleanDesc ? (
                    <div style={{ margin:'10px 0 12px' }}>
                      {cleanDesc.split('\n\n').filter(Boolean).map((block, i) => (
                        <div key={i} style={{ color: block.startsWith('📝') ? '#94a3b8' : '#475569', fontSize:12, marginBottom:8, paddingBottom:8, borderBottom:'1px solid #0f1729' }}>
                          {block}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color:'#334155', fontSize:12, margin:'10px 0', fontStyle:'italic' }}>No notes yet</div>
                  )}
                  <div style={{ display:'flex', gap:8 }}>
                    <input value={addingNote} onChange={e => setAddingNote(e.target.value)} onKeyDown={e => e.key==='Enter' && saveNote(ev)}
                      placeholder="Add a note..." style={{ flex:1, padding:'8px 10px', background:'#0f1729', border:'1px solid #334155', borderRadius:8, color:'#e2e8f0', fontSize:13 }} />
                    <button onClick={() => saveNote(ev)} disabled={savingNote || !addingNote.trim()}
                      style={{ padding:'8px 14px', background:addingNote.trim()?'#1d4ed8':'#1e293b', border:'none', borderRadius:8, color:addingNote.trim()?'#fff':'#475569', fontSize:13, fontWeight:700, cursor:addingNote.trim()?'pointer':'not-allowed' }}>
                      {savingNote?'...':'💾'}
                    </button>
                  </div>
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:1, background:'#0f1729' }}>
                <button onClick={() => { setScheduling(ev); setSchedDate(''); setSchedTime('09:00'); setSchedTech('Austin'); setAvailability([]); }} disabled={acting===ev.id}
                  style={{ padding:'12px 6px', background:'#0f2544', border:'none', color:'#3b82f6', fontSize:12, fontWeight:700, cursor:'pointer' }}>📅 Schedule</button>
                <button onClick={() => handleBill(ev)} disabled={acting===ev.id}
                  style={{ padding:'12px 6px', background:'#1e0a3c', border:'none', color:'#a78bfa', fontSize:12, fontWeight:700, cursor:acting===ev.id?'not-allowed':'pointer' }}>{acting===ev.id?'...':'💰 Bill It'}</button>
                <button onClick={() => handleNeedsParts(ev)} disabled={acting===ev.id}
                  style={{ padding:'12px 6px', background:'#2d1a00', border:'none', color:'#f97316', fontSize:12, fontWeight:700, cursor:acting===ev.id?'not-allowed':'pointer' }}>{acting===ev.id?'...':'🔧 Needs Parts'}</button>
                <button onClick={() => handleIgnore(ev)} disabled={acting===ev.id}
                  style={{ padding:'12px 6px', background:'#1e293b', border:'none', color:'#64748b', fontSize:12, fontWeight:700, cursor:acting===ev.id?'not-allowed':'pointer' }}>{acting===ev.id?'...':'🗑️ Ignore'}</button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* JOBS TAB — Supabase lookup (metadata only, calendar is truth) */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'jobs' && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ marginBottom: 12, color: '#64748b', fontSize: 11, fontStyle: 'italic' }}>
            📌 Calendar is source of truth. This is for job history lookup only.
          </div>
          <input
            value={jobSearch}
            onChange={e => setJobSearch(e.target.value)}
            placeholder="Search jobs by customer, number, issue..."
            style={{
              width: '100%', padding: '12px 14px', background: '#1e293b',
              border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0',
              fontSize: 14, marginBottom: 12, boxSizing: 'border-box'
            }}
          />
          {jobsLoading && <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading...</div>}
          {!jobsLoading && jobs.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
              {jobSearch.length >= 2 ? 'No jobs found' : 'Type to search jobs'}
            </div>
          )}
          {jobs.map(job => {
            const statusInfo = STATUS_INFO[job.status] || {};
            return (
              <div key={job.id} style={{
                background: '#1e293b', borderRadius: 10, padding: '12px 14px',
                marginBottom: 8, cursor: 'pointer', borderLeft: `3px solid ${statusInfo.color || '#475569'}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{job.customer_name}</div>
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{job.issue?.slice(0, 60)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#00c8e8', fontSize: 11, fontWeight: 600 }}>{job.job_number}</div>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                      background: (statusInfo.color || '#475569') + '20',
                      color: statusInfo.color || '#475569'
                    }}>{statusInfo.label || job.status}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* CUSTOMERS TAB — For tech history lookup */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'customers' && !selectedCustomer && (
        <div style={{ padding: '12px 16px' }}>
          <input
            value={customerSearch}
            onChange={e => setCustomerSearch(e.target.value)}
            placeholder="Search by name, phone, address..."
            style={{
              width: '100%', padding: '12px 14px', background: '#1e293b',
              border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0',
              fontSize: 14, marginBottom: 12, boxSizing: 'border-box'
            }}
          />
          {customersLoading && <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading...</div>}
          {!customersLoading && customers.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
              {customerSearch.length >= 2 ? 'No customers found' : 'Type to search customers'}
            </div>
          )}
          {customers.map(c => (
            <div key={c.id} onClick={() => openCustomer(c)} style={{
              background: '#1e293b', borderRadius: 10, padding: '12px 14px',
              marginBottom: 8, cursor: 'pointer'
            }}>
              <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{c.name}</div>
              {c.address && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{c.address}</div>}
              {c.phone && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>📞 {c.phone}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Customer Detail View */}
      {activeTab === 'customers' && selectedCustomer && (
        <div style={{ padding: '12px 16px' }}>
          <button onClick={() => setSelectedCustomer(null)} style={{
            background: 'none', border: 'none', color: '#00c8e8',
            fontSize: 13, cursor: 'pointer', marginBottom: 12
          }}>← Back to customers</button>
          
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>{selectedCustomer.name}</div>
            {selectedCustomer.address && <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>📍 {selectedCustomer.address}</div>}
            {selectedCustomer.phone && <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>📞 {selectedCustomer.phone}</div>}
            {selectedCustomer.email && <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>✉️ {selectedCustomer.email}</div>}
            {selectedCustomer.gate_code && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>🔐 Gate: {selectedCustomer.gate_code}</div>}
            {selectedCustomer.panel_password && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 2 }}>🔑 Panel: {selectedCustomer.panel_password}</div>}
          </div>

          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
            Job History ({customerJobs.length})
          </div>
          {customerJobs.length === 0 && (
            <div style={{ color: '#475569', fontSize: 13, padding: 20, textAlign: 'center' }}>No jobs found</div>
          )}
          {customerJobs.map(job => {
            const statusInfo = STATUS_INFO[job.status] || {};
            return (
              <div key={job.id} style={{
                background: '#1a1a2e', borderRadius: 10, padding: '12px 14px',
                marginBottom: 8, borderLeft: `3px solid ${statusInfo.color || '#475569'}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{job.issue?.slice(0, 50)}</div>
                  <span style={{ color: '#00c8e8', fontSize: 11, fontWeight: 600 }}>{job.job_number}</span>
                </div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                  {new Date(job.created_at).toLocaleDateString()} • {statusInfo.label || job.status}
                </div>
                {job.completion_notes && (
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>
                    "{job.completion_notes.slice(0, 100)}"
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* SCHEDULE TAB — Calendar-based returns/parts queue */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'schedule' && (
        <div style={{ padding: '12px 16px' }}>
          {scheduleLoading && <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading...</div>}
          
          {/* Returns Section */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: '#ec489920', borderRadius: 10,
              borderLeft: '4px solid #ec4899', marginBottom: 10
            }}>
              <div>
                <div style={{ color: '#ec4899', fontSize: 14, fontWeight: 700 }}>🔄 Returns Pending</div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Calendar events tagged [RETURN]</div>
              </div>
              <div style={{
                background: '#ec4899', color: '#fff', fontSize: 16, fontWeight: 700,
                padding: '4px 12px', borderRadius: 12
              }}>{scheduleEvents.returns.length}</div>
            </div>
            {scheduleEvents.returns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#475569', fontSize: 13 }}>✓ No returns waiting</div>
            ) : (
              scheduleEvents.returns.map(ev => (
                <div key={ev.id} style={{
                  background: '#1e293b', borderRadius: 10, padding: '12px', marginBottom: 8,
                  borderLeft: '3px solid #ec4899'
                }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{ev.title}</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{formatDate(ev.start)}</div>
                  {ev.location && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>📍 {ev.location}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={() => { setScheduling(ev); setSchedDate(''); }} style={{
                      flex: 1, padding: '8px', border: 'none', borderRadius: 6,
                      background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}>📅 Schedule</button>
                    <button onClick={() => handleClearTag(ev, 'return')} disabled={acting === ev.id} style={{
                      flex: 1, padding: '8px', border: 'none', borderRadius: 6,
                      background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}>{acting === ev.id ? '...' : '✓ Done'}</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Parts Section */}
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: '#eab30820', borderRadius: 10,
              borderLeft: '4px solid #eab308', marginBottom: 10
            }}>
              <div>
                <div style={{ color: '#eab308', fontSize: 14, fontWeight: 700 }}>📦 Parts Waiting</div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Calendar events tagged [NEEDS PARTS]</div>
              </div>
              <div style={{
                background: '#eab308', color: '#000', fontSize: 16, fontWeight: 700,
                padding: '4px 12px', borderRadius: 12
              }}>{scheduleEvents.parts.length}</div>
            </div>
            {scheduleEvents.parts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#475569', fontSize: 13 }}>✓ No jobs waiting on parts</div>
            ) : (
              scheduleEvents.parts.map(ev => (
                <div key={ev.id} style={{
                  background: '#1e293b', borderRadius: 10, padding: '12px', marginBottom: 8,
                  borderLeft: '3px solid #eab308'
                }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{ev.title}</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{formatDate(ev.start)}</div>
                  {ev.location && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>📍 {ev.location}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={() => { setScheduling(ev); setSchedDate(''); }} style={{
                      flex: 1, padding: '8px', border: 'none', borderRadius: 6,
                      background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}>📅 Schedule</button>
                    <button onClick={() => handleClearTag(ev, 'parts')} disabled={acting === ev.id} style={{
                      flex: 1, padding: '8px', border: 'none', borderRadius: 6,
                      background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}>{acting === ev.id ? '...' : '✓ Parts In'}</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* SCHEDULING MODAL */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {scheduling && (
        <div onClick={() => setScheduling(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:100, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#1e293b', borderRadius:'20px 20px 0 0', padding:'24px 20px 36px', width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'#334155', borderRadius:2, margin:'0 auto 20px' }} />
            <div style={{ color:'#e2e8f0', fontSize:16, fontWeight:700, marginBottom:2 }}>📅 Schedule Job</div>
            <div style={{ color:'#64748b', fontSize:12, marginBottom:16 }}>{scheduling.title}</div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
              {['Austin','JR'].map(t => (
                <button key={t} onClick={() => setSchedTech(t)} style={{ padding:'12px', borderRadius:10, border:`2px solid ${schedTech===t?'#3b82f6':'#334155'}`, background:schedTech===t?'#0f2544':'#0f1729', color:schedTech===t?'#3b82f6':'#64748b', fontSize:14, fontWeight:700, cursor:'pointer' }}>{t}</button>
              ))}
            </div>

            <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
              style={{ width:'100%', padding:'12px', background:'#0f1729', border:'1px solid #334155', borderRadius:10, color:'#e2e8f0', fontSize:14, marginBottom:14, boxSizing:'border-box' }} />

            {schedDate && (
              <div style={{ marginBottom:16 }}>
                <div style={{ color:'#475569', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>
                  {loadingAvail ? `Checking ${schedTech}'s calendar...` : `${schedTech}'s Day — tap a slot`}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:4 }}>
                  {HOURS.map(h => {
                    const busy = isHourBusy(h);
                    const selected = schedTime === `${String(h).padStart(2,'0')}:00`;
                    return (
                      <button key={h} onClick={() => !busy && setSchedTime(`${String(h).padStart(2,'0')}:00`)}
                        title={busy ? getBusyLabel(h) : `${fmtHour(h)} — available`}
                        style={{ padding:'8px 2px', borderRadius:6, border:`2px solid ${selected?'#3b82f6':'transparent'}`, background:busy?'#450a0a':selected?'#052e16':'#0a2918', color:busy?'#fca5a5':'#86efac', fontSize:10, fontWeight:700, cursor:busy?'not-allowed':'pointer', textAlign:'center' }}>
                        {fmtHour(h)}
                        <div style={{ fontSize:8, marginTop:1 }}>{busy?'●':'○'}</div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize:10, color:'#334155', marginTop:6 }}>● busy &nbsp; ○ open</div>
              </div>
            )}

            <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
              style={{ width:'100%', padding:'12px', background:'#0f1729', border:'1px solid #334155', borderRadius:10, color:'#e2e8f0', fontSize:14, marginBottom:14, boxSizing:'border-box' }} />

            <button onClick={handleSchedule} disabled={!schedDate || !schedTime || !!acting}
              style={{ width:'100%', padding:'14px', border:'none', borderRadius:12, fontSize:15, fontWeight:700, background:schedDate&&schedTime?'#1d4ed8':'#1e293b', color:schedDate&&schedTime?'#fff':'#475569', cursor:schedDate&&schedTime?'pointer':'not-allowed' }}>
              {acting ? 'Scheduling...' : `Book on ${schedTech}'s Calendar →`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
