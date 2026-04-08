// ============================================
// Scheduler View - Job Classification & Auto-Schedule
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wolhqelloeypafmmvapn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvbGhxZWxsb2V5cGFmbW12YXBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM4MDEwNTMsImV4cCI6MjA1OTM3NzA1M30.BGPjPXH5fOSKGPOeMPH6z5OJvX8aTitGrwe1_Atgkp8';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Calendar IDs
const CALENDARS = {
  TENTATIVELY_SCHEDULED: 'de3d433f5c6c6a85f5474648e005cac43529d5bed542b74675a37a30cf0ece91@group.calendar.google.com',
  RETURN_VISITS: 'drhhsscalendar@gmail.com',
  AUSTIN: 'drhservicetech1@gmail.com',
  JR: 'do0i4f1jqbbakd72mpgpll9m6g@group.calendar.google.com',
};

// Job Types with durations (hours)
const JOB_TYPES = {
  SVC: { label: 'Service Call', duration: 2, color: '#3b82f6' },
  RTN: { label: 'Return Visit', duration: 4, color: '#06b6d4' },
  TRB: { label: 'Troubleshoot', duration: 2, color: '#8b5cf6' },
  EST: { label: 'Estimate/Walk', duration: 1, color: '#64748b' },
  'INS-S': { label: 'Install - Small', duration: 4, color: '#22c55e' },
  'INS-M': { label: 'Install - Medium', duration: 8, color: '#f59e0b' },
  'INS-L': { label: 'Install - Large', duration: 16, color: '#ef4444' },
};

// Priority levels
const PRIORITIES = {
  P1: { label: 'Urgent', color: '#ef4444', icon: '🔴', order: 1 },
  P2: { label: 'High', color: '#f59e0b', icon: '🟠', order: 2 },
  P3: { label: 'Normal', color: '#3b82f6', icon: '🟡', order: 3 },
  P4: { label: 'Low', color: '#22c55e', icon: '🟢', order: 4 },
};

// Tech info with weekly availability
const TECHS = [
  { id: 'austin', name: 'Austin', calendarId: CALENDARS.AUSTIN, color: '#3b82f6', hoursPerWeek: 32 },
  { id: 'jr', name: 'JR', calendarId: CALENDARS.JR, color: '#22c55e', hoursPerWeek: 20 },
];

// Tags to exclude from ready queue
const DONE_TAGS = ['[BILLED]', '[INVOICED]', '[COMPLETED]', '[IGNORE]', '[IGNORED]', '[INVOICE]', '[TO BILL]', '[SCHEDULED]', '[MOVED TO QUEUE]', '[COMPLETE]'];
const BLOCKED_TAGS = ['[NEEDS PARTS]', '[BLOCKED]', '[WAITING]', '[ON HOLD]', '[PENDING PARTS]', '[NEEDS NOTES]'];

export default function Scheduler({ accessToken, onBack }) {
  const [loading, setLoading] = useState(true);
  const [backlogItems, setBacklogItems] = useState([]);
  const [techSchedules, setTechSchedules] = useState({});
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [recommendations, setRecommendations] = useState([]);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch calendar events
  const fetchCalendarEvents = useCallback(async (calendarId, timeMin, timeMax) => {
    if (!accessToken) return [];
    try {
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    } catch (err) {
      console.error('Calendar fetch error:', err);
      return [];
    }
  }, [accessToken]);

  // Infer job type from title/description
  const inferJobType = (title, description = '') => {
    const text = `${title} ${description}`.toLowerCase();
    if (text.includes('install') && (text.includes('full') || text.includes('large') || text.includes('multi'))) return 'INS-L';
    if (text.includes('install') && (text.includes('small') || text.includes('quick'))) return 'INS-S';
    if (text.includes('install')) return 'INS-M';
    if (text.includes('return') || text.includes('rtn') || text.includes('[return needed]')) return 'RTN';
    if (text.includes('troubleshoot') || text.includes('trb') || text.includes('diagnose')) return 'TRB';
    if (text.includes('estimate') || text.includes('walk') || text.includes('quote') || text.includes('survey')) return 'EST';
    return 'SVC'; // Default to service call
  };

  // Infer priority from title/description
  const inferPriority = (title, description = '') => {
    const text = `${title} ${description}`.toLowerCase();
    if (text.includes('urgent') || text.includes('emergency') || text.includes('asap') || text.includes('!')) return 'P1';
    if (text.includes('important') || text.includes('priority') || text.includes('waiting')) return 'P2';
    if (text.includes('flexible') || text.includes('when available') || text.includes('low')) return 'P4';
    return 'P3'; // Default to normal
  };

  // Load data
  useEffect(() => {
    const loadData = async () => {
      if (!accessToken) return;
      setLoading(true);

      const now = new Date();
      const twoWeeksAgo = new Date(now);
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 60);
      const twoWeeksOut = new Date(now);
      twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

      // Fetch backlog items from Queue and Returns calendars
      const [queueEvents, returnEvents] = await Promise.all([
        fetchCalendarEvents(CALENDARS.TENTATIVELY_SCHEDULED, twoWeeksAgo, twoWeeksOut),
        fetchCalendarEvents(CALENDARS.RETURN_VISITS, twoWeeksAgo, twoWeeksOut),
      ]);

      // Filter to ready items (not done, not blocked)
      const filterReady = (events, source) => {
        return events
          .filter(e => {
            const title = (e.summary || '').toUpperCase();
            const hasDoneTag = DONE_TAGS.some(tag => title.includes(tag));
            const hasBlockedTag = BLOCKED_TAGS.some(tag => title.includes(tag));
            return !hasDoneTag && !hasBlockedTag;
          })
          .map(e => ({
            id: e.id,
            calendarId: source === 'queue' ? CALENDARS.TENTATIVELY_SCHEDULED : CALENDARS.RETURN_VISITS,
            title: e.summary || 'Untitled',
            description: e.description || '',
            location: e.location || '',
            source,
            jobType: inferJobType(e.summary, e.description),
            priority: inferPriority(e.summary, e.description),
            estimatedHours: JOB_TYPES[inferJobType(e.summary, e.description)]?.duration || 2,
            customerAvailability: null, // Could parse from description
            preferredTech: null,
          }));
      };

      const allBacklog = [
        ...filterReady(queueEvents, 'queue'),
        ...filterReady(returnEvents, 'returns'),
      ];

      // Also load Approved estimates not yet scheduled (same as Board)
      try {
        const { data: approved } = await supabase
          .from('jobs')
          .select('*')
          .eq('qbo_estimate_status', 'Accepted')
          .is('calendar_event_id', null)
          .order('created_at', { ascending: false })
          .limit(100);
        
        (approved || []).forEach(est => {
          allBacklog.push({
            id: est.id,
            calendarId: null, // Supabase estimate, no calendar yet
            title: est.customer_name || 'Unknown',
            description: est.issue || est.notes || '',
            location: est.customer_address || '',
            source: 'estimate',
            jobType: 'INS-M', // Default estimates to medium install
            priority: 'P2', // High priority - customer already approved
            estimatedHours: 8,
            estimateAmount: est.estimate_amount,
            customer_phone: est.customer_phone,
            customer_address: est.customer_address,
          });
        });
      } catch (e) {
        console.warn('Estimates fetch error:', e);
      }

      // Sort by priority
      allBacklog.sort((a, b) => PRIORITIES[a.priority].order - PRIORITIES[b.priority].order);
      setBacklogItems(allBacklog);

      // Fetch tech schedules for next 2 weeks
      const schedules = {};
      for (const tech of TECHS) {
        const events = await fetchCalendarEvents(tech.calendarId, now, twoWeeksOut);
        schedules[tech.id] = events
          .filter(e => {
            const title = (e.summary || '').toUpperCase();
            // Exclude blocked items from available time calc
            return !DONE_TAGS.some(tag => title.includes(tag));
          })
          .map(e => {
            const start = new Date(e.start?.dateTime || e.start?.date);
            const end = new Date(e.end?.dateTime || e.end?.date);
            return {
              id: e.id,
              title: e.summary,
              start,
              end,
              hours: (end - start) / (1000 * 60 * 60),
            };
          });
      }
      setTechSchedules(schedules);
      setLoading(false);
    };

    loadData();
  }, [accessToken, fetchCalendarEvents]);

  // Update item classification
  const updateItem = (itemId, field, value) => {
    setBacklogItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const updated = { ...item, [field]: value };
        if (field === 'jobType') {
          updated.estimatedHours = JOB_TYPES[value]?.duration || 2;
        }
        return updated;
      }
      return item;
    }));
  };

  // Calculate tech availability
  const getTechAvailability = (techId) => {
    const schedule = techSchedules[techId] || [];
    const tech = TECHS.find(t => t.id === techId);
    const now = new Date();
    const twoWeeksOut = new Date(now);
    twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

    // Use actual weekly hours (2 weeks)
    const totalCapacity = (tech?.hoursPerWeek || 40) * 2;

    // Calculate scheduled hours
    const scheduledHours = schedule.reduce((sum, e) => sum + (e.hours || 0), 0);
    const availableHours = Math.max(0, totalCapacity - scheduledHours);

    return {
      totalCapacity,
      scheduledHours: Math.round(scheduledHours),
      availableHours: Math.round(availableHours),
      utilization: Math.round((scheduledHours / totalCapacity) * 100),
    };
  };

  // Get free time slots for a tech
  const getTechFreeSlots = (techId) => {
    const schedule = techSchedules[techId] || [];
    const slots = [];
    const now = new Date();
    const twoWeeksOut = new Date(now);
    twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

    // Generate potential slots (9am-5pm, weekdays)
    const curr = new Date(now);
    curr.setHours(9, 0, 0, 0);
    if (curr < now) curr.setDate(curr.getDate() + 1);

    while (curr < twoWeeksOut) {
      const day = curr.getDay();
      if (day !== 0 && day !== 6) { // Weekdays only
        const dayStart = new Date(curr);
        dayStart.setHours(9, 0, 0, 0);
        const dayEnd = new Date(curr);
        dayEnd.setHours(17, 0, 0, 0);

        // Find events on this day
        const dayEvents = schedule.filter(e => {
          const eDate = new Date(e.start);
          return eDate.toDateString() === curr.toDateString();
        }).sort((a, b) => a.start - b.start);

        // Find gaps
        let lastEnd = dayStart;
        for (const event of dayEvents) {
          if (event.start > lastEnd) {
            const gapHours = (event.start - lastEnd) / (1000 * 60 * 60);
            if (gapHours >= 1) {
              slots.push({
                date: new Date(curr),
                start: new Date(lastEnd),
                end: new Date(event.start),
                hours: gapHours,
              });
            }
          }
          lastEnd = new Date(Math.max(lastEnd, event.end));
        }

        // Gap at end of day
        if (lastEnd < dayEnd) {
          const gapHours = (dayEnd - lastEnd) / (1000 * 60 * 60);
          if (gapHours >= 1) {
            slots.push({
              date: new Date(curr),
              start: new Date(lastEnd),
              end: new Date(dayEnd),
              hours: gapHours,
            });
          }
        }
      }
      curr.setDate(curr.getDate() + 1);
    }

    return slots;
  };

  // Generate scheduling recommendations
  const generateRecommendations = () => {
    const recs = [];
    const usedSlots = { austin: [], jr: [] };

    // Sort items by priority
    const sortedItems = [...backlogItems].sort((a, b) => {
      const priorityDiff = PRIORITIES[a.priority].order - PRIORITIES[b.priority].order;
      if (priorityDiff !== 0) return priorityDiff;
      return b.estimatedHours - a.estimatedHours; // Longer jobs first within same priority
    });

    for (const item of sortedItems) {
      const neededHours = item.estimatedHours;

      // Try each tech
      for (const tech of TECHS) {
        const slots = getTechFreeSlots(tech.id);

        // Find a slot that fits and isn't already used
        for (const slot of slots) {
          const slotKey = `${tech.id}-${slot.start.toISOString()}`;
          if (usedSlots[tech.id].includes(slotKey)) continue;

          if (slot.hours >= neededHours) {
            recs.push({
              item,
              tech,
              slot: {
                date: slot.date,
                start: slot.start,
                end: new Date(slot.start.getTime() + neededHours * 60 * 60 * 1000),
              },
              reason: item.priority === 'P1' ? 'Urgent priority' :
                item.priority === 'P2' ? 'High priority' :
                  `${tech.name} has availability`,
            });
            usedSlots[tech.id].push(slotKey);
            break;
          }
        }

        // If we found a slot, stop looking at other techs
        if (recs.find(r => r.item.id === item.id)) break;
      }
    }

    setRecommendations(recs);
    setShowRecommendations(true);
  };

  // Schedule an item (create calendar event)
  const scheduleItem = async (rec) => {
    if (!accessToken) return;
    setSaving(true);

    try {
      const event = {
        summary: rec.item.title,
        description: `${rec.item.description}\n\n[Scheduled via Overwatch Scheduler]`,
        location: rec.item.location,
        start: {
          dateTime: rec.slot.start.toISOString(),
          timeZone: 'America/Denver',
        },
        end: {
          dateTime: rec.slot.end.toISOString(),
          timeZone: 'America/Denver',
        },
      };

      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(rec.tech.calendarId)}/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (res.ok) {
        // Tag original as scheduled
        await tagEventAsScheduled(rec.item.calendarId, rec.item.id);

        // Remove from recommendations
        setRecommendations(prev => prev.filter(r => r.item.id !== rec.item.id));
        setBacklogItems(prev => prev.filter(i => i.id !== rec.item.id));
      }
    } catch (err) {
      console.error('Schedule error:', err);
    }

    setSaving(false);
  };

  // Tag original event as scheduled
  const tagEventAsScheduled = async (calendarId, eventId) => {
    try {
      // Get current event
      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;

      const event = await res.json();
      const newSummary = event.summary.includes('[SCHEDULED]')
        ? event.summary
        : `[SCHEDULED] ${event.summary}`;

      await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ summary: newSummary }),
      });
    } catch (err) {
      console.error('Tag error:', err);
    }
  };

  // Format date
  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Format time
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // Calculate totals
  const totalBacklogHours = backlogItems.reduce((sum, item) => sum + item.estimatedHours, 0);
  const austinAvail = getTechAvailability('austin');
  const jrAvail = getTechAvailability('jr');

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16, animation: 'pulse 2s infinite' }}>📅</div>
          <div style={{ color: '#64748b', fontSize: 14 }}>Loading scheduler...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', padding: '16px', paddingBottom: '100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>←</button>
          <div>
            <h1 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, margin: 0 }}>📅 Scheduler</h1>
            <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>Classify jobs & generate schedule</p>
          </div>
        </div>
        <button
          onClick={generateRecommendations}
          disabled={backlogItems.length === 0}
          style={{
            background: backlogItems.length === 0 ? '#334155' : '#8b5cf6',
            color: backlogItems.length === 0 ? '#64748b' : '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 14,
            fontWeight: 600,
            cursor: backlogItems.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          🤖 Generate Schedule
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Backlog Items</div>
          <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 700 }}>{backlogItems.length}</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Backlog Hours</div>
          <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 700 }}>{totalBacklogHours}</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Austin Available</div>
          <div style={{ color: '#3b82f6', fontSize: 24, fontWeight: 700 }}>{austinAvail.availableHours}h</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>{austinAvail.utilization}% booked</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>JR Available</div>
          <div style={{ color: '#22c55e', fontSize: 24, fontWeight: 700 }}>{jrAvail.availableHours}h</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>{jrAvail.utilization}% booked</div>
        </div>
      </div>

      {/* Backlog Table */}
      <div style={{ background: '#1e293b', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, margin: 0 }}>
            Ready to Schedule ({backlogItems.length})
          </h2>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            Click to edit classification
          </div>
        </div>

        {backlogItems.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div>No items in backlog!</div>
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {backlogItems.map((item, idx) => (
              <div
                key={item.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: idx < backlogItems.length - 1 ? '1px solid #334155' : 'none',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                {/* Title & Source */}
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                    {item.title.replace(/\[.*?\]/g, '').trim().substring(0, 50)}
                    {item.title.length > 50 && '...'}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>
                    {item.source === 'queue' ? '📋 Queue' : '🔄 Returns'}
                    {item.location && ` • ${item.location.split(',')[0]}`}
                  </div>
                </div>

                {/* Priority Selector */}
                <select
                  value={item.priority}
                  onChange={(e) => updateItem(item.id, 'priority', e.target.value)}
                  style={{
                    background: PRIORITIES[item.priority].color + '20',
                    color: PRIORITIES[item.priority].color,
                    border: `1px solid ${PRIORITIES[item.priority].color}40`,
                    borderRadius: 6,
                    padding: '6px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    minWidth: 90,
                  }}
                >
                  {Object.entries(PRIORITIES).map(([key, val]) => (
                    <option key={key} value={key}>{val.icon} {val.label}</option>
                  ))}
                </select>

                {/* Job Type Selector */}
                <select
                  value={item.jobType}
                  onChange={(e) => updateItem(item.id, 'jobType', e.target.value)}
                  style={{
                    background: JOB_TYPES[item.jobType].color + '20',
                    color: JOB_TYPES[item.jobType].color,
                    border: `1px solid ${JOB_TYPES[item.jobType].color}40`,
                    borderRadius: 6,
                    padding: '6px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    minWidth: 120,
                  }}
                >
                  {Object.entries(JOB_TYPES).map(([key, val]) => (
                    <option key={key} value={key}>{val.label} ({val.duration}h)</option>
                  ))}
                </select>

                {/* Hours */}
                <div style={{ color: '#64748b', fontSize: 12, textAlign: 'right', minWidth: 40 }}>
                  {item.estimatedHours}h
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recommendations Modal */}
      {showRecommendations && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#1e293b', borderRadius: 16, maxWidth: 600, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700, margin: 0 }}>🤖 Recommended Schedule</h2>
                <p style={{ color: '#64748b', fontSize: 12, margin: '4px 0 0 0' }}>{recommendations.length} items scheduled</p>
              </div>
              <button onClick={() => setShowRecommendations(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>

            {/* Recommendations List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {recommendations.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🤷</div>
                  <div>No slots available for remaining items</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {recommendations.map((rec, idx) => (
                    <div
                      key={rec.item.id}
                      style={{
                        background: '#0f172a',
                        borderRadius: 10,
                        padding: 14,
                        border: `1px solid ${rec.tech.color}40`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                            {rec.item.title.replace(/\[.*?\]/g, '').trim().substring(0, 40)}
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ background: PRIORITIES[rec.item.priority].color + '20', color: PRIORITIES[rec.item.priority].color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                              {PRIORITIES[rec.item.priority].icon} {PRIORITIES[rec.item.priority].label}
                            </span>
                            <span style={{ background: JOB_TYPES[rec.item.jobType].color + '20', color: JOB_TYPES[rec.item.jobType].color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                              {JOB_TYPES[rec.item.jobType].label}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => scheduleItem(rec)}
                          disabled={saving}
                          style={{
                            background: rec.tech.color,
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '8px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: saving ? 'not-allowed' : 'pointer',
                            opacity: saving ? 0.5 : 1,
                          }}
                        >
                          {saving ? '...' : '✓ Schedule'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: rec.tech.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
                            {rec.tech.name.substring(0, 2).toUpperCase()}
                          </div>
                          <span style={{ color: '#94a3b8', fontSize: 13 }}>{rec.tech.name}</span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 13 }}>
                          📅 {formatDate(rec.slot.date)}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 13 }}>
                          🕐 {formatTime(rec.slot.start)} - {formatTime(rec.slot.end)}
                        </div>
                      </div>

                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>
                        💡 {rec.reason}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #334155', display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowRecommendations(false)}
                style={{ background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Close
              </button>
              <button
                onClick={() => {
                  recommendations.forEach(rec => scheduleItem(rec));
                }}
                disabled={saving || recommendations.length === 0}
                style={{
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: (saving || recommendations.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (saving || recommendations.length === 0) ? 0.5 : 1,
                }}
              >
                Schedule All ({recommendations.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 16 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, margin: '0 0 12px 0' }}>Job Type Reference</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {Object.entries(JOB_TYPES).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: val.color }} />
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{key}: {val.label} ({val.duration}h)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
