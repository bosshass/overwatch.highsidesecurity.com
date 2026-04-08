// ============================================
// BoardView — Kanban-style overview
// ============================================
// Columns: Ready to Schedule | Open Tasks | Approved Estimates | Pending Estimates
// Calendar = Source of Truth for tasks
// Supabase = Source for estimates (QBO sync)

import { useState, useEffect, useCallback } from 'react';
import { CALENDARS } from '../config/calendars.js';
import { supabase } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// Tech calendars for scheduling
const TECH_CALS = [
  { name: 'Austin', id: CALENDARS.AUSTIN, color: '#f97316' },
  { name: 'JR', id: CALENDARS.JR, color: '#22c55e' },
];

// Calendars for "Ready to Schedule" — items that need tech assignment
const SCHEDULE_SOURCE_CALENDARS = [
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Queue', color: '#f59e0b' },
  { id: CALENDARS.RETURN_VISITS, name: 'Returns', color: '#06b6d4' },
];

// Calendars to pull open tasks from (already scheduled on tech calendars)
const TASK_CALENDARS = [
  { id: CALENDARS.AUSTIN, name: 'Austin', color: '#f97316' },
  { id: CALENDARS.JR, name: 'JR', color: '#22c55e' },
  { id: CALENDARS.INSTALLATIONS, name: 'Installations', color: '#3b82f6' },
  { id: CALENDARS.ADMIN_NOTES, name: 'Admin Notes', color: '#ec4899' },
  { id: CALENDARS.SALES_ACCOUNTING, name: 'Sales/Acct', color: '#8b5cf6' },
];

// Tags that mean task is DONE — exclude from board
const DONE_TAGS = ['[BILLED]', '[INVOICED]', '[COMPLETED]', '[IGNORE]', '[IGNORED]', '[INVOICE]', '[TO BILL]', '[SCHEDULED]', '[MOVED TO QUEUE]'];

// Tags that mean task is BLOCKED — show in Blocked column
const BLOCKED_TAGS = ['[NEEDS PARTS]', '[BLOCKED]', '[WAITING]', '[ON HOLD]', '[PENDING PARTS]'];

// Extract customer name from title
const extractCustomerName = (title) => {
  return title
    .replace(/\[.*?\]/g, '')
    .replace(/Confirmed|confirmed/g, '')
    .replace(/- Install|- Return|- Service/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export default function BoardView({ accessToken, onBack }) {
  const [loading, setLoading] = useState(true);
  const [readyToSchedule, setReadyToSchedule] = useState([]); // Queue + Returns + Approved Estimates
  const [blockedItems, setBlockedItems] = useState([]); // Items waiting on parts/info
  const [openTasks, setOpenTasks] = useState([]);
  const [approvedEstimates, setApprovedEstimates] = useState([]);
  const [pendingEstimates, setPendingEstimates] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeColumn, setActiveColumn] = useState('ready'); // For mobile view
  const [updating, setUpdating] = useState(false);
  
  // Search / Find matching event state
  const [searching, setSearching] = useState(false);
  const [matchingEvents, setMatchingEvents] = useState([]);
  const [showMatches, setShowMatches] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Scheduling state
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleEstimate, setScheduleEstimate] = useState(null);
  const [selectedTech, setSelectedTech] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleNotes, setScheduleNotes] = useState('');

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULE ESTIMATE TO CALENDAR
  // ═══════════════════════════════════════════════════════════════════════════

  const openScheduler = (estimate) => {
    setScheduleEstimate(estimate);
    setSelectedTech(null);
    setSelectedDate('');
    setStartTime('09:00');
    setEndTime('17:00');
    // Pre-fill notes with existing description
    const existingNotes = [
      estimate.issue || '',
      estimate.notes || '',
      estimate.customer_address ? `📍 ${estimate.customer_address}` : '',
      estimate.customer_phone ? `📞 ${estimate.customer_phone}` : '',
    ].filter(Boolean).join('\n\n');
    setScheduleNotes(existingNotes);
    setShowScheduler(true);
    setSelectedItem(null);
  };

  // Open scheduler for calendar items (Queue, Returns)
  const openSchedulerForCalendarItem = (item) => {
    setScheduleEstimate({
      id: item.id,
      type: 'calendar',
      calendarId: item.calendarId,
      customer_name: item.customerName || item.title,
      customer_address: item.location,
      issue: item.description,
    });
    setSelectedTech(null);
    setSelectedDate('');
    setStartTime('09:00');
    setEndTime('17:00');
    setScheduleNotes(item.description || '');
    setShowScheduler(true);
  };

  // Find matching events on tech calendars
  const findMatchingEvents = async (searchName) => {
    if (!accessToken || !searchName) return;
    
    setSearching(true);
    setMatchingEvents([]);
    setShowMatches(true);
    
    const matches = [];
    const now = new Date();
    const tMin = new Date();
    tMin.setDate(tMin.getDate() - 60);
    const tMax = new Date();
    tMax.setDate(tMax.getDate() + 60);
    
    // Search keywords from customer name
    const searchTerms = searchName.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    
    // Search all tech calendars
    const calendarsToSearch = [...TECH_CALS, { name: 'Installations', id: CALENDARS.INSTALLATIONS, color: '#3b82f6' }];
    
    await Promise.all(calendarsToSearch.map(async (cal) => {
      try {
        const params = new URLSearchParams({
          timeMin: tMin.toISOString(),
          timeMax: tMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100'
        });
        
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        if (!res.ok) return;
        const data = await res.json();
        
        (data.items || []).forEach(ev => {
          if (ev.status === 'cancelled') return;
          const title = (ev.summary || '').toLowerCase();
          const desc = (ev.description || '').toLowerCase();
          
          // Check if any search term matches
          const isMatch = searchTerms.some(term => title.includes(term) || desc.includes(term));
          if (!isMatch) return;
          
          matches.push({
            id: ev.id,
            calendarId: cal.id,
            calendarName: cal.name,
            calendarColor: cal.color,
            title: ev.summary || '',
            start: ev.start?.dateTime || ev.start?.date,
            location: ev.location || '',
            description: ev.description || '',
            isPast: new Date(ev.start?.dateTime || ev.start?.date) < now,
          });
        });
      } catch (e) {
        console.warn('Search error:', cal.name, e.message);
      }
    }));
    
    // Sort by date
    matches.sort((a, b) => new Date(a.start) - new Date(b.start));
    setMatchingEvents(matches);
    setSearching(false);
  };

  const createCalendarEvent = async () => {
    if (!selectedTech || !selectedDate || !startTime || !endTime) {
      alert('Please select tech, date, and times');
      return;
    }
    
    setScheduling(true);
    try {
      const est = scheduleEstimate;
      const startDateTime = `${selectedDate}T${startTime}:00`;
      const endDateTime = `${selectedDate}T${endTime}:00`;
      const isCalendarItem = est.type === 'calendar';
      
      // Create calendar event with user-edited notes
      const eventBody = {
        summary: `${est.customer_name || 'Customer'} - Install`,
        description: isCalendarItem 
          ? scheduleNotes 
          : `Est# ${est.qbo_estimate_ref || 'N/A'}\nAmount: $${est.estimate_amount?.toLocaleString() || '0'}\n\n${scheduleNotes}`.trim(),
        location: est.customer_address || '',
        start: { dateTime: startDateTime, timeZone: 'America/Denver' },
        end: { dateTime: endDateTime, timeZone: 'America/Denver' },
      };
      
      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(selectedTech.id)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody)
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to create event');
      }
      
      const newEvent = await res.json();
      
      if (isCalendarItem) {
        // Mark original calendar event as [SCHEDULED]
        try {
          const origRes = await fetch(`${GCAL}/calendars/${encodeURIComponent(est.calendarId)}/events/${est.id}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (origRes.ok) {
            const origEvent = await origRes.json();
            await fetch(`${GCAL}/calendars/${encodeURIComponent(est.calendarId)}/events/${est.id}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ summary: `[SCHEDULED] ${origEvent.summary}` })
            });
          }
        } catch (e) {
          console.warn('Could not mark original as scheduled:', e);
        }
      } else {
        // Update Supabase with calendar_event_id (for estimates)
        const { error: dbError } = await supabase
          .from('jobs')
          .update({ 
            calendar_event_id: newEvent.id,
            scheduled_date: selectedDate,
            tech_name: selectedTech.name
          })
          .eq('id', est.id);
        
        if (dbError) console.warn('Supabase update warning:', dbError);
      }
      
      // Refresh and close
      await loadAll();
      setShowScheduler(false);
      setScheduleEstimate(null);
      alert(`✅ Scheduled ${est.customer_name} with ${selectedTech.name} on ${selectedDate}`);
      
    } catch (e) {
      console.error('Schedule error:', e);
      alert(`Error: ${e.message}`);
    }
    setScheduling(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE ESTIMATE STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  const updateEstimateStatus = async (estimateId, newStatus) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ qbo_estimate_status: newStatus })
        .eq('id', estimateId);
      
      if (error) throw error;
      
      // Refresh data
      await loadEstimates();
      setSelectedItem(null);
    } catch (e) {
      console.error('Update error:', e);
      alert(`Error updating status: ${e.message}`);
    }
    setUpdating(false);
  };

  const markAsLost = async (estimateId) => {
    if (!confirm('Mark this estimate as Closed/Lost?')) return;
    await updateEstimateStatus(estimateId, 'Closed');
  };

  // Mark calendar task as complete
  const markTaskComplete = async (task) => {
    setUpdating(true);
    try {
      const newTitle = `[COMPLETED] ${task.title}`;
      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(task.calendarId)}/events/${task.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: newTitle })
      });
      
      if (!res.ok) throw new Error('Failed to update event');
      
      await loadOpenTasks();
      setSelectedItem(null);
    } catch (e) {
      console.error('Mark complete error:', e);
      alert(`Error: ${e.message}`);
    }
    setUpdating(false);
  };

  const sendTaskToBilling = async (task) => {
    setUpdating(true);
    try {
      const newTitle = `[TO BILL] ${task.title}`;
      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(task.calendarId)}/events/${task.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: newTitle })
      });
      
      if (!res.ok) throw new Error('Failed to update event');
      
      await loadOpenTasks();
      setSelectedItem(null);
    } catch (e) {
      console.error('Send to billing error:', e);
      alert(`Error: ${e.message}`);
    }
    setUpdating(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD DATA
  // ═══════════════════════════════════════════════════════════════════════════

  // Load "Ready to Schedule" items from Queue + Returns calendars + Approved Estimates
  const loadReadyToSchedule = useCallback(async () => {
    if (!accessToken) return;
    
    const items = [];
    const now = new Date();
    const tMin = new Date();
    tMin.setDate(tMin.getDate() - 60); // Look back 60 days
    const tMax = new Date();
    tMax.setDate(tMax.getDate() + 60); // Look ahead 60 days
    
    // Load from Queue + Returns calendars
    await Promise.all(SCHEDULE_SOURCE_CALENDARS.map(async (cal) => {
      try {
        const params = new URLSearchParams({
          timeMin: tMin.toISOString(),
          timeMax: tMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
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
          
          // Skip if done or blocked
          if (DONE_TAGS.some(tag => title.includes(tag.toUpperCase()))) return;
          if (BLOCKED_TAGS.some(tag => title.includes(tag.toUpperCase()))) return;
          
          items.push({
            id: ev.id,
            type: 'calendar',
            calendarId: cal.id,
            calendarName: cal.name,
            calendarColor: cal.color,
            title: ev.summary || '',
            customerName: extractCustomerName(ev.summary || ''),
            start: ev.start?.dateTime || ev.start?.date,
            location: ev.location || '',
            description: ev.description || '',
            isPast: new Date(ev.start?.dateTime || ev.start?.date) < now,
          });
        });
      } catch (e) {
        console.warn('Schedule source fetch error:', cal.name, e.message);
      }
    }));
    
    // Also load Approved estimates not scheduled
    try {
      const { data: approved } = await supabase
        .from('jobs')
        .select('*')
        .eq('qbo_estimate_status', 'Accepted')
        .is('calendar_event_id', null)
        .order('created_at', { ascending: false })
        .limit(100);
      
      (approved || []).forEach(est => {
        items.push({
          id: est.id,
          type: 'estimate',
          calendarName: 'Estimate Won',
          calendarColor: '#22c55e',
          title: est.customer_name || 'Unknown',
          customerName: est.customer_name || 'Unknown',
          start: est.created_at,
          location: est.customer_address || '',
          description: est.issue || est.notes || '',
          estimateAmount: est.estimate_amount,
          qbo_estimate_ref: est.qbo_estimate_ref,
          customer_phone: est.customer_phone,
          customer_address: est.customer_address,
          issue: est.issue,
          notes: est.notes,
        });
      });
    } catch (e) {
      console.warn('Estimates fetch error:', e);
    }
    
    // Sort by date
    items.sort((a, b) => new Date(a.start) - new Date(b.start));
    setReadyToSchedule(items);
  }, [accessToken]);

  // Load "Blocked" items — anything tagged with [NEEDS PARTS], [BLOCKED], etc.
  const loadBlockedItems = useCallback(async () => {
    if (!accessToken) return;
    
    const items = [];
    const now = new Date();
    const tMin = new Date();
    tMin.setDate(tMin.getDate() - 90);
    const tMax = new Date();
    tMax.setDate(tMax.getDate() + 60);
    
    // Check all calendars for blocked items
    const ALL_CALENDARS = [...SCHEDULE_SOURCE_CALENDARS, ...TASK_CALENDARS];
    
    await Promise.all(ALL_CALENDARS.map(async (cal) => {
      try {
        const params = new URLSearchParams({
          timeMin: tMin.toISOString(),
          timeMax: tMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
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
          
          // Only include if blocked
          if (!BLOCKED_TAGS.some(tag => title.includes(tag.toUpperCase()))) return;
          
          // Extract the blocking reason from the tag
          let blockReason = 'Blocked';
          for (const tag of BLOCKED_TAGS) {
            if (title.includes(tag.toUpperCase())) {
              blockReason = tag.replace(/[\[\]]/g, '');
              break;
            }
          }
          
          items.push({
            id: ev.id,
            type: 'blocked',
            calendarId: cal.id,
            calendarName: cal.name,
            calendarColor: '#ef4444',
            title: ev.summary || '',
            customerName: extractCustomerName(ev.summary || ''),
            start: ev.start?.dateTime || ev.start?.date,
            location: ev.location || '',
            description: ev.description || '',
            blockReason,
          });
        });
      } catch (e) {
        console.warn('Blocked fetch error:', cal.name, e.message);
      }
    }));
    
    items.sort((a, b) => new Date(a.start) - new Date(b.start));
    setBlockedItems(items);
  }, [accessToken]);

  const loadOpenTasks = useCallback(async () => {
    if (!accessToken) return;
    
    const now = new Date();
    const tMin = new Date();
    tMin.setDate(tMin.getDate() - 90); // Look back 90 days
    const tMax = new Date();
    tMax.setDate(tMax.getDate() + 30); // Look ahead 30 days
    
    const tasks = [];
    
    await Promise.all(TASK_CALENDARS.map(async (cal) => {
      try {
        const params = new URLSearchParams({
          timeMin: tMin.toISOString(),
          timeMax: tMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
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
          
          // Skip if done or blocked
          if (DONE_TAGS.some(tag => title.includes(tag.toUpperCase()))) return;
          if (BLOCKED_TAGS.some(tag => title.includes(tag.toUpperCase()))) return;
          
          tasks.push({
            id: ev.id,
            calendarId: cal.id,
            calendarName: cal.name,
            calendarColor: cal.color,
            title: ev.summary || '',
            customerName: extractCustomerName(ev.summary || ''),
            start: ev.start?.dateTime || ev.start?.date,
            location: ev.location || '',
            description: ev.description || '',
            isPast: new Date(ev.start?.dateTime || ev.start?.date) < now,
          });
        });
      } catch (e) {
        console.warn('Task fetch error:', cal.name, e.message);
      }
    }));
    
    // Sort: past tasks first (oldest), then future tasks
    tasks.sort((a, b) => new Date(a.start) - new Date(b.start));
    setOpenTasks(tasks);
  }, [accessToken]);

  const loadEstimates = useCallback(async () => {
    try {
      // Approved estimates not fully scheduled
      const { data: approved, error: approvedErr } = await supabase
        .from('jobs')
        .select('*')
        .eq('qbo_estimate_status', 'Accepted')
        .is('calendar_event_id', null)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (approvedErr) throw approvedErr;
      setApprovedEstimates(approved || []);
      
      // Pending estimates
      const { data: pending, error: pendingErr } = await supabase
        .from('jobs')
        .select('*')
        .eq('qbo_estimate_status', 'Pending')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (pendingErr) throw pendingErr;
      setPendingEstimates(pending || []);
      
    } catch (e) {
      console.error('Estimates load error:', e);
      setApprovedEstimates([]);
      setPendingEstimates([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadReadyToSchedule(), loadBlockedItems(), loadOpenTasks(), loadEstimates()]);
    setLoading(false);
  }, [loadReadyToSchedule, loadBlockedItems, loadOpenTasks, loadEstimates]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays === -1) return 'Tomorrow';
    if (diffDays > 0 && diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 0 && diffDays > -7) return `In ${-diffDays}d`;
    
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatMoney = (amount) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER CARD COMPONENTS
  // ═══════════════════════════════════════════════════════════════════════════

  const TaskCard = ({ task }) => (
    <div
      onClick={() => setSelectedItem({ type: 'task', data: task })}
      style={{
        background: '#1e293b',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        borderLeft: `3px solid ${task.calendarColor}`,
        cursor: 'pointer',
        opacity: task.isPast ? 0.8 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', flex: 1 }}>{task.customerName || task.title}</div>
        {task.isPast && <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>PAST</span>}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{task.calendarName}</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(task.start)}</div>
      {task.location && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>📍 {task.location.slice(0, 40)}...</div>}
    </div>
  );

  const EstimateCard = ({ estimate, isApproved }) => (
    <div
      onClick={() => setSelectedItem({ type: 'estimate', data: estimate })}
      style={{
        background: '#1e293b',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        borderLeft: `3px solid ${isApproved ? '#22c55e' : '#f59e0b'}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 4 }}>{estimate.customer_name || 'Unknown'}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{estimate.calendar_summary || estimate.issue || 'No description'}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: isApproved ? '#22c55e' : '#f59e0b' }}>
          {formatMoney(estimate.estimate_amount)}
        </span>
        <span style={{ fontSize: 11, color: '#64748b' }}>{formatDate(estimate.created_at)}</span>
      </div>
      {estimate.qbo_estimate_ref && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Est# {estimate.qbo_estimate_ref}</div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // DETAIL MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  const renderDetailModal = () => {
    if (!selectedItem) return null;
    
    const isTask = selectedItem.type === 'task';
    const isReady = selectedItem.type === 'ready';
    const isReadyEstimate = selectedItem.type === 'readyEstimate';
    const isBlocked = selectedItem.type === 'blocked';
    const item = selectedItem.data;
    
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: '#1e293b', borderRadius: 12, width: '100%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: isBlocked ? '#ef4444' : (isReadyEstimate ? '#22c55e' : ((isTask || isReady) ? item.calendarColor : '#22c55e')), marginBottom: 4 }}>
                {isBlocked ? item.blockReason : (isReadyEstimate ? 'Estimate Won' : ((isTask || isReady) ? item.calendarName : (item.qbo_estimate_status || 'Estimate')))}
              </div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>
                {isReadyEstimate ? item.customerName : ((isTask || isReady) ? (item.customerName || item.title) : item.customer_name)}
              </h3>
            </div>
            <button onClick={() => { setSelectedItem(null); setSearchQuery(''); setShowMatches(false); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' }}>✕</button>
          </div>
          
          {isReadyEstimate ? (
            <>
              <div style={{ color: '#22c55e', fontSize: 20, fontWeight: 600, marginBottom: 12 }}>{formatMoney(item.estimateAmount)}</div>
              {item.qbo_estimate_ref && <div style={{ color: '#64748b', fontSize: 13, marginBottom: 8 }}>Est# {item.qbo_estimate_ref}</div>}
              {item.customer_address && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📍 {item.customer_address}</div>}
              {item.customer_phone && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📞 {item.customer_phone}</div>}
              {(item.issue || item.notes || item.description) && (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Notes</div>
                  <div style={{ color: '#fff', fontSize: 14, whiteSpace: 'pre-wrap' }}>{item.issue || item.notes || item.description}</div>
                </div>
              )}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => { setSelectedItem(null); openScheduler(item); }}
                  style={{ background: '#8b5cf6', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  📅 Schedule Now
                </button>
                
                {/* Editable search field */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={searchQuery || item.customerName || ''}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => { if (!searchQuery) setSearchQuery(item.customerName || ''); }}
                    placeholder="Search name..."
                    style={{ 
                      flex: 1, 
                      background: '#0f172a', 
                      border: '1px solid #334155', 
                      borderRadius: 8, 
                      padding: '10px 12px', 
                      color: '#fff', 
                      fontSize: 14 
                    }}
                  />
                  <button
                    onClick={() => findMatchingEvents(searchQuery || item.customerName || '')}
                    disabled={searching}
                    style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {searching ? '...' : '🔍 Find'}
                  </button>
                </div>
                
                <button
                  onClick={async () => {
                    setUpdating(true);
                    try {
                      // Update estimate status to indicate billing needed
                      const { error } = await supabase
                        .from('jobs')
                        .update({ qbo_estimate_status: 'To Bill' })
                        .eq('id', item.id);
                      if (error) throw error;
                      await loadAll();
                      setSelectedItem(null);
                      alert('✅ Sent to billing');
                    } catch (e) {
                      alert(`Error: ${e.message}`);
                    }
                    setUpdating(false);
                  }}
                  disabled={updating}
                  style={{ background: '#f59e0b', border: 'none', color: '#000', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  💵 Send to Billing
                </button>
              </div>
              
              {/* Matching Events Results */}
              {showMatches && (
                <div style={{ marginTop: 16, background: '#0f172a', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#64748b', fontSize: 12 }}>Matching Events ({matchingEvents.length})</span>
                    <button onClick={() => setShowMatches(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
                  </div>
                  {searching ? (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: 8 }}>Searching...</div>
                  ) : matchingEvents.length === 0 ? (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: 8 }}>No matching events found</div>
                  ) : (
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {matchingEvents.map(ev => (
                        <a
                          key={`${ev.calendarId}-${ev.id}`}
                          href={`https://www.google.com/calendar/event?eid=${btoa(ev.id + ' ' + ev.calendarId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block',
                            background: '#1e293b',
                            borderRadius: 6,
                            padding: 8,
                            marginBottom: 6,
                            borderLeft: `3px solid ${ev.calendarColor}`,
                            textDecoration: 'none',
                            color: ev.isPast ? '#64748b' : '#fff',
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{ev.title}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {ev.calendarName} • {formatDate(ev.start)}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : isBlocked ? (
            <>
              <div style={{ background: '#ef444420', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>🚫 {item.blockReason}</div>
                <div style={{ color: '#94a3b8', fontSize: 12 }}>{item.calendarName}</div>
              </div>
              <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📅 {formatDate(item.start)}</div>
              {item.location && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📍 {item.location}</div>}
              {item.description && (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Notes</div>
                  <div style={{ color: '#fff', fontSize: 14, whiteSpace: 'pre-wrap' }}>{item.description}</div>
                </div>
              )}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={async () => {
                    setUpdating(true);
                    try {
                      // Remove the blocked tag from the title
                      let newTitle = item.title;
                      for (const tag of BLOCKED_TAGS) {
                        newTitle = newTitle.replace(new RegExp(tag.replace(/[[\]]/g, '\\$&'), 'gi'), '');
                      }
                      newTitle = newTitle.replace(/\s+/g, ' ').trim();
                      
                      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calendarId)}/events/${item.id}`, {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ summary: newTitle })
                      });
                      if (!res.ok) throw new Error('Failed to unblock');
                      await loadAll();
                      setSelectedItem(null);
                    } catch (e) {
                      alert(`Error: ${e.message}`);
                    }
                    setUpdating(false);
                  }}
                  disabled={updating}
                  style={{ background: '#22c55e', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  ✓ Unblock — Ready to Schedule
                </button>
                <a
                  href={`https://www.google.com/calendar/event?eid=${btoa(item.id + ' ' + item.calendarId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: '#334155', color: '#fff', padding: 12, borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontWeight: 600 }}
                >
                  View in Calendar
                </a>
              </div>
            </>
          ) : isReady ? (
            <>
              <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📅 {formatDate(item.start)}</div>
              {item.location && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📍 {item.location}</div>}
              {item.description && (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Notes</div>
                  <div style={{ color: '#fff', fontSize: 14, whiteSpace: 'pre-wrap' }}>{item.description}</div>
                </div>
              )}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => { setSelectedItem(null); openSchedulerForCalendarItem(item); }}
                  style={{ background: '#8b5cf6', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  📅 Schedule Now
                </button>
                
                {/* Editable search field */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={searchQuery || item.customerName || item.title}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => { if (!searchQuery) setSearchQuery(item.customerName || item.title); }}
                    placeholder="Search name..."
                    style={{ 
                      flex: 1, 
                      background: '#0f172a', 
                      border: '1px solid #334155', 
                      borderRadius: 8, 
                      padding: '10px 12px', 
                      color: '#fff', 
                      fontSize: 14 
                    }}
                  />
                  <button
                    onClick={() => findMatchingEvents(searchQuery || item.customerName || item.title)}
                    disabled={searching}
                    style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {searching ? '...' : '🔍 Find'}
                  </button>
                </div>
                
                <a
                  href={`https://www.google.com/calendar/event?eid=${btoa(item.id + ' ' + item.calendarId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: '#334155', color: '#fff', padding: 12, borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontWeight: 600 }}
                >
                  View in Calendar
                </a>
              </div>
              
              {/* Matching Events Results */}
              {showMatches && (
                <div style={{ marginTop: 16, background: '#0f172a', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#64748b', fontSize: 12 }}>Matching Events ({matchingEvents.length})</span>
                    <button onClick={() => setShowMatches(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
                  </div>
                  {searching ? (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: 8 }}>Searching...</div>
                  ) : matchingEvents.length === 0 ? (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: 8 }}>No matching events found</div>
                  ) : (
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {matchingEvents.map(ev => (
                        <a
                          key={`${ev.calendarId}-${ev.id}`}
                          href={`https://www.google.com/calendar/event?eid=${btoa(ev.id + ' ' + ev.calendarId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block',
                            background: '#1e293b',
                            borderRadius: 6,
                            padding: 8,
                            marginBottom: 6,
                            borderLeft: `3px solid ${ev.calendarColor}`,
                            textDecoration: 'none',
                            color: ev.isPast ? '#64748b' : '#fff',
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{ev.title}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {ev.calendarName} • {formatDate(ev.start)}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : isTask ? (
            <>
              <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📅 {formatDate(item.start)}</div>
              {item.location && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>📍 {item.location}</div>}
              {item.description && (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Notes</div>
                  <div style={{ color: '#fff', fontSize: 14, whiteSpace: 'pre-wrap' }}>{item.description}</div>
                </div>
              )}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a
                  href={`https://www.google.com/calendar/event?eid=${btoa(item.id + ' ' + item.calendarId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: '#3b82f6', color: '#fff', padding: 12, borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontWeight: 600 }}
                >
                  📅 Open in Calendar
                </a>
                <button
                  onClick={() => sendTaskToBilling(item)}
                  disabled={updating}
                  style={{ background: '#f59e0b', border: 'none', color: '#000', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  💵 Send to Billing
                </button>
                <button
                  onClick={() => markTaskComplete(item)}
                  disabled={updating}
                  style={{ background: '#22c55e', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  ✓ Mark Complete
                </button>
                <button
                  onClick={async () => {
                    setUpdating(true);
                    try {
                      const newTitle = `[NEEDS PARTS] ${item.title}`;
                      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calendarId)}/events/${item.id}`, {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ summary: newTitle })
                      });
                      if (!res.ok) throw new Error('Failed to update');
                      await loadAll();
                      setSelectedItem(null);
                    } catch (e) {
                      alert(`Error: ${e.message}`);
                    }
                    setUpdating(false);
                  }}
                  disabled={updating}
                  style={{ background: '#ef4444', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  🚫 Mark as Blocked (Needs Parts)
                </button>
                <button
                  onClick={async () => {
                    setUpdating(true);
                    try {
                      // Copy event to Service Queue calendar, then mark original as [MOVED]
                      const queueCalId = CALENDARS.TENTATIVELY_SCHEDULED;
                      
                      // Create new event on queue
                      const today = new Date().toISOString().split('T')[0];
                      const newEvent = {
                        summary: item.title,
                        description: item.description || '',
                        location: item.location || '',
                        start: { date: today },
                        end: { date: today },
                      };
                      
                      const createRes = await fetch(`${GCAL}/calendars/${encodeURIComponent(queueCalId)}/events`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(newEvent)
                      });
                      
                      if (!createRes.ok) throw new Error('Failed to create queue event');
                      
                      // Mark original as moved
                      const newTitle = `[MOVED TO QUEUE] ${item.title}`;
                      await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calendarId)}/events/${item.id}`, {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ summary: newTitle })
                      });
                      
                      await loadAll();
                      setSelectedItem(null);
                      alert('✅ Moved to Ready to Schedule queue');
                    } catch (e) {
                      alert(`Error: ${e.message}`);
                    }
                    setUpdating(false);
                  }}
                  disabled={updating}
                  style={{ background: '#8b5cf6', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  📋 Move to Ready to Schedule
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ color: '#22c55e', fontSize: 20, fontWeight: 600, marginBottom: 12 }}>{formatMoney(item.estimate_amount)}</div>
              {item.calendar_summary && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>{item.calendar_summary}</div>}
              {item.issue && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8 }}>{item.issue}</div>}
              {item.customer_address && <div style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>📍 {item.customer_address}</div>}
              {item.customer_phone && <div style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>📞 {item.customer_phone}</div>}
              {item.qbo_estimate_ref && <div style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>Est# {item.qbo_estimate_ref}</div>}
              {item.notes && (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Notes</div>
                  <div style={{ color: '#fff', fontSize: 14, whiteSpace: 'pre-wrap' }}>{item.notes}</div>
                </div>
              )}
              
              {/* Action Buttons */}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {item.qbo_estimate_status === 'Pending' && (
                  <>
                    <button
                      onClick={() => updateEstimateStatus(item.id, 'Accepted')}
                      disabled={updating}
                      style={{ background: '#22c55e', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      ✓ Mark as Approved
                    </button>
                    <button
                      onClick={() => markAsLost(item.id)}
                      disabled={updating}
                      style={{ background: '#ef4444', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      ✕ Mark as Lost
                    </button>
                  </>
                )}
                {item.qbo_estimate_status === 'Accepted' && !item.calendar_event_id && (
                  <>
                    <button
                      onClick={() => openScheduler(item)}
                      disabled={updating}
                      style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      📅 Schedule Now
                    </button>
                    <button
                      onClick={() => markAsLost(item.id)}
                      disabled={updating}
                      style={{ background: '#ef4444', border: 'none', color: '#fff', padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      ✕ Mark as Lost
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // COLUMN COMPONENT
  // ═══════════════════════════════════════════════════════════════════════════

  const Column = ({ title, count, color, children, columnKey }) => (
    <div style={{
      flex: 1,
      minWidth: 280,
      maxWidth: 400,
      display: activeColumn === columnKey || window.innerWidth > 768 ? 'flex' : 'none',
      flexDirection: 'column',
      height: '100%',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: '#0f172a',
        borderBottom: `3px solid ${color}`,
        borderRadius: '8px 8px 0 0',
      }}>
        <span style={{ color: '#fff', fontWeight: 600 }}>{title}</span>
        <span style={{ background: color, color: '#000', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{count}</span>
      </div>
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 12,
        background: '#0f172a',
        borderRadius: '0 0 8px 8px',
      }}>
        {children}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  const readyEstimateValue = readyToSchedule.filter(i => i.type === 'estimate').reduce((sum, e) => sum + (e.estimateAmount || 0), 0);
  const pendingValue = pendingEstimates.reduce((sum, e) => sum + (e.estimate_amount || 0), 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>← Home</button>
          <h2 style={{ margin: 0 }}>📋 Board</h2>
        </div>
        <button onClick={loadAll} disabled={loading} style={{ background: '#334155', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>

      {/* Summary Bar */}
      <div style={{ display: 'flex', gap: 16, padding: 16, borderBottom: '1px solid #334155', flexWrap: 'wrap' }}>
        <div style={{ background: '#1e293b', padding: '8px 16px', borderRadius: 8 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>Ready to Schedule</div>
          <div style={{ color: '#8b5cf6', fontSize: 18, fontWeight: 600 }}>{readyToSchedule.length}</div>
        </div>
        <div style={{ background: '#1e293b', padding: '8px 16px', borderRadius: 8 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>Open Tasks</div>
          <div style={{ color: '#3b82f6', fontSize: 18, fontWeight: 600 }}>{openTasks.length}</div>
        </div>
        <div style={{ background: '#1e293b', padding: '8px 16px', borderRadius: 8 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>To Schedule $</div>
          <div style={{ color: '#22c55e', fontSize: 18, fontWeight: 600 }}>{formatMoney(readyEstimateValue)}</div>
        </div>
        <div style={{ background: '#1e293b', padding: '8px 16px', borderRadius: 8 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>Pending $</div>
          <div style={{ color: '#f59e0b', fontSize: 18, fontWeight: 600 }}>{formatMoney(pendingValue)}</div>
        </div>
      </div>

      {/* Mobile Column Switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #334155' }} className="mobile-only">
        {[
          { key: 'ready', label: 'Schedule', count: readyToSchedule.length },
          { key: 'blocked', label: 'Blocked', count: blockedItems.length },
          { key: 'tasks', label: 'Tasks', count: openTasks.length },
          { key: 'pending', label: 'Pending', count: pendingEstimates.length },
        ].map(col => (
          <button
            key={col.key}
            onClick={() => setActiveColumn(col.key)}
            style={{
              flex: 1,
              padding: '12px 8px',
              background: 'none',
              border: 'none',
              borderBottom: activeColumn === col.key ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeColumn === col.key ? '#3b82f6' : '#64748b',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {col.label} ({col.count})
          </button>
        ))}
      </div>

      {/* Board Columns */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Loading...</div>
      ) : (
        <div style={{ flex: 1, display: 'flex', gap: 16, padding: 16, overflow: 'auto' }}>
          <Column title="📅 Ready to Schedule" count={readyToSchedule.length} color="#8b5cf6" columnKey="ready">
            {readyToSchedule.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>Nothing to schedule</div>
            ) : (
              readyToSchedule.map(item => (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => setSelectedItem({ type: item.type === 'estimate' ? 'readyEstimate' : 'ready', data: item })}
                  style={{
                    background: '#1e293b',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                    borderLeft: `3px solid ${item.calendarColor}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', flex: 1 }}>{item.customerName || item.title}</div>
                    {item.type === 'estimate' && <span style={{ background: '#22c55e', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>EST</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{item.calendarName}</div>
                  {item.estimateAmount && <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>{formatMoney(item.estimateAmount)}</div>}
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(item.start)}</div>
                </div>
              ))
            )}
          </Column>

          <Column title="🚫 Blocked" count={blockedItems.length} color="#ef4444" columnKey="blocked">
            {blockedItems.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>Nothing blocked</div>
            ) : (
              blockedItems.map(item => (
                <div
                  key={`blocked-${item.id}`}
                  onClick={() => setSelectedItem({ type: 'blocked', data: item })}
                  style={{
                    background: '#1e293b',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                    borderLeft: '3px solid #ef4444',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 4 }}>{item.customerName || item.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>{item.blockReason}</span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>{item.calendarName}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(item.start)}</div>
                </div>
              ))
            )}
          </Column>

          <Column title="Open Tasks" count={openTasks.length} color="#3b82f6" columnKey="tasks">
            {openTasks.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>No open tasks</div>
            ) : (
              openTasks.map(task => <TaskCard key={`${task.calendarId}-${task.id}`} task={task} />)
            )}
          </Column>

          <Column title="Pending Estimates" count={pendingEstimates.length} color="#f59e0b" columnKey="pending">
            {pendingEstimates.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>No pending estimates</div>
            ) : (
              pendingEstimates.map(est => <EstimateCard key={est.id} estimate={est} isApproved={false} />)
            )}
          </Column>
        </div>
      )}

      {/* Detail Modal */}
      {renderDetailModal()}

      {/* Scheduler Modal */}
      {showScheduler && scheduleEstimate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, width: '100%', maxWidth: 400, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>📅 Schedule Install</h3>
              <button onClick={() => setShowScheduler(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 24, cursor: 'pointer' }}>✕</button>
            </div>
            
            <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ color: '#fff', fontWeight: 600 }}>{scheduleEstimate.customer_name}</div>
              <div style={{ color: '#22c55e', fontSize: 14 }}>{formatMoney(scheduleEstimate.estimate_amount)}</div>
              {scheduleEstimate.customer_address && <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>📍 {scheduleEstimate.customer_address}</div>}
            </div>
            
            {/* Tech Selection */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Select Tech</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {TECH_CALS.map(tech => (
                  <button
                    key={tech.id}
                    onClick={() => setSelectedTech(tech)}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 8,
                      border: selectedTech?.id === tech.id ? `2px solid ${tech.color}` : '2px solid #334155',
                      background: selectedTech?.id === tech.id ? `${tech.color}20` : '#0f172a',
                      color: selectedTech?.id === tech.id ? tech.color : '#94a3b8',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {tech.name}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Date Selection */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#fff',
                  fontSize: 16,
                }}
              />
            </div>
            
            {/* Time Selection */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#fff',
                    fontSize: 16,
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#fff',
                    fontSize: 16,
                  }}
                />
              </div>
            </div>
            
            {/* Editable Notes */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8 }}>Job Notes (edit before scheduling)</label>
              <textarea
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#fff',
                  fontSize: 14,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
                placeholder="Add job details, special instructions, materials needed..."
              />
            </div>
            
            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowScheduler(false)}
                style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={createCalendarEvent}
                disabled={scheduling || !selectedTech || !selectedDate}
                style={{
                  flex: 2,
                  padding: 12,
                  borderRadius: 8,
                  border: 'none',
                  background: (!selectedTech || !selectedDate) ? '#334155' : '#22c55e',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: (!selectedTech || !selectedDate) ? 'not-allowed' : 'pointer',
                }}
              >
                {scheduling ? 'Scheduling...' : '✓ Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile-only styles */}
      <style>{`
        @media (min-width: 769px) {
          .mobile-only { display: none !important; }
        }
      `}</style>
    </div>
  );
}
