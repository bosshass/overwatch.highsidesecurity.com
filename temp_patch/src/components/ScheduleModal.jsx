// ============================================
// Overwatch V3 - ScheduleModal Component
// ============================================
// Schedule or tentatively assign jobs to techs
// - Checks REAL Google Calendar availability
// - Shows actual conflicts from GCal events
// - Shana removed (no longer on team)
// - "Day is open" only shows when GCal confirms it

import { useState, useEffect, useMemo, useCallback } from 'react';
import { assignmentsApi, jobsApi, techsApi, notesApi, JOB_STATUS, queries } from '../services/supabase.js';
import { notifyJobAssigned } from '../services/pushNotifications.js';
import { INSTALL_TYPES } from '../utils/statusMachine.js';
import { TECH_COLORS, CALENDARS } from '../config/calendars.js';
import { scheduleToTechCalendar } from '../services/calendarSync.js';

const TIME_SLOTS = [
  '7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM',
  '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM'
];

// Active techs only — Shana no longer on team
const ACTIVE_TECHS = ['Austin', 'JR', 'Trevor'];

// Map tech name → Google Calendar ID for freebusy queries
const TECH_GCAL_ID = {
  'Austin':  CALENDARS.DRH_TECH_1,
  'JR':      CALENDARS.JR_APPOINTMENT,
  'Trevor':  null, // Trevor doesn't have a dedicated GCal yet — fall back to Supabase only
};

const getWeekDates = (offset = 0) => {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + (offset * 7));
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
};

const parseTime = (timeStr) => {
  const [time, period] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
};

const formatTimeShort = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// Format a Google Calendar event time range
const formatGCalTime = (start, end) => {
  const s = new Date(start.dateTime || start.date);
  const e = new Date(end.dateTime || end.date);
  if (start.date) return 'All day';
  return `${s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

// Fetch Google Calendar events for a tech on a specific day
async function fetchGCalEvents(accessToken, calendarId, date) {
  if (!accessToken || !calendarId) return null;
  try {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('timeMin', start.toISOString());
    url.searchParams.set('timeMax', end.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '20');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items || [];
  } catch (e) {
    console.warn('GCal fetch failed:', e);
    return null;
  }
}

// Count busy hours from GCal events (to show load indicator on day buttons)
async function fetchGCalBusyCount(accessToken, calendarId, weekDates) {
  if (!accessToken || !calendarId) return {};
  try {
    const timeMin = new Date(weekDates[0]);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(weekDates[weekDates.length - 1]);
    timeMax.setHours(23, 59, 59, 999);

    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }]
      })
    });
    if (!res.ok) return {};
    const data = await res.json();
    const busy = data.calendars?.[calendarId]?.busy || [];

    // Count busy blocks per day
    const counts = {};
    busy.forEach(block => {
      const day = new Date(block.start).toISOString().split('T')[0];
      counts[day] = (counts[day] || 0) + 1;
    });
    return counts;
  } catch (e) {
    return {};
  }
}

export default function ScheduleModal({ job, onClose, onScheduled, userEmail, userRole, accessToken }) {
  const [techs, setTechs] = useState([]);
  const [selectedTech, setSelectedTech] = useState(null);
  const [helperTech, setHelperTech] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState('9:00 AM');
  const [isTentative, setIsTentative] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Supabase job data
  const [allJobs, setAllJobs] = useState([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);

  // Google Calendar data
  const [gcalEvents, setGcalEvents] = useState(null);       // events for selected tech+day
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalBusyCounts, setGcalBusyCounts] = useState({}); // { 'YYYY-MM-DD': count }
  const [gcalBusyLoading, setGcalBusyLoading] = useState(false);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Load techs and all scheduled jobs from Supabase
  useEffect(() => {
    const loadData = async () => {
      setIsLoadingJobs(true);
      try {
        const [techList, jobs] = await Promise.all([
          techsApi.getAll(),
          queries.getAllOpenJobsWithTech()
        ]);
        // Filter to active techs only (no Shana, no Sara)
        setTechs(techList.filter(t => ACTIVE_TECHS.includes(t.name)));
        setAllJobs(jobs);
      } catch (e) {
        console.error('Load error:', e);
      } finally {
        setIsLoadingJobs(false);
      }
    };
    loadData();

    // Default to today if weekday
    const today = new Date();
    if (today.getDay() >= 1 && today.getDay() <= 6) {
      setSelectedDate(today);
    } else {
      const monday = new Date(today);
      monday.setDate(today.getDate() + 1);
      setSelectedDate(monday);
    }
  }, []);

  // When tech or week changes, fetch GCal busy counts for the week
  useEffect(() => {
    if (!selectedTech || !accessToken) return;
    const calId = TECH_GCAL_ID[selectedTech.name];
    if (!calId) return;

    setGcalBusyLoading(true);
    fetchGCalBusyCount(accessToken, calId, weekDates).then(counts => {
      setGcalBusyCounts(counts);
      setGcalBusyLoading(false);
    });
  }, [selectedTech, weekDates, accessToken]);

  // When tech or date changes, fetch GCal events for that day
  useEffect(() => {
    if (!selectedTech || !selectedDate || !accessToken) {
      setGcalEvents(null);
      return;
    }
    const calId = TECH_GCAL_ID[selectedTech.name];
    if (!calId) {
      setGcalEvents(null);
      return;
    }

    setGcalLoading(true);
    setGcalEvents(null);
    fetchGCalEvents(accessToken, calId, selectedDate).then(events => {
      setGcalEvents(events);
      setGcalLoading(false);
    });
  }, [selectedTech, selectedDate, accessToken]);

  // Get Supabase jobs for a specific tech on a specific day
  const getJobsForTechDay = useCallback((techName, date) => {
    if (!date) return [];
    const dateStr = date.toISOString().split('T')[0];
    return allJobs.filter(j => {
      if (!j._scheduled_for || !j._tech_name) return false;
      if (j._tech_name !== techName) return false;
      const jobDate = new Date(j._scheduled_for).toISOString().split('T')[0];
      return jobDate === dateStr;
    }).sort((a, b) => new Date(a._scheduled_for) - new Date(b._scheduled_for));
  }, [allJobs]);

  // Get busy count for day button indicator
  // Combines Supabase job count + GCal busy count
  const getBusyCountForDay = useCallback((techName, date) => {
    const supabaseCount = getJobsForTechDay(techName, date).length;
    const dateStr = date.toISOString().split('T')[0];
    const gcalCount = gcalBusyCounts[dateStr] || 0;
    return Math.max(supabaseCount, gcalCount);
  }, [getJobsForTechDay, gcalBusyCounts]);

  const isToday = (d) => d.toDateString() === new Date().toDateString();
  const isPast = (d) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
  };
  const isSelected = (d) => selectedDate && d.toDateString() === selectedDate.toDateString();

  const [showMondayWarning, setShowMondayWarning] = useState(false);

  const handleSubmit = async () => {
    if (!selectedTech || !selectedDate) return;

    if (selectedDate.getDay() === 1 && INSTALL_TYPES.includes(job.job_type) && !showMondayWarning) {
      if (userRole === 'operator') {
        setShowMondayWarning(true);
        return;
      } else {
        alert('⚠️ Company Policy: No installations on Mondays.\n\nPlease select a different day (Tuesday-Friday).\nOnly operators can override this policy.');
        return;
      }
    }
    setShowMondayWarning(false);
    setIsSubmitting(true);

    try {
      const { hours, minutes } = parseTime(selectedTime);
      const scheduledFor = new Date(selectedDate);
      scheduledFor.setHours(hours, minutes, 0, 0);

      const assignment = await assignmentsApi.create({
        job_id: job.id,
        tech_id: selectedTech.id,
        scheduled_for: scheduledFor.toISOString()
      }, userEmail);

      if (accessToken) {
        try {
          const calEvent = await scheduleToTechCalendar(accessToken, job, selectedTech, scheduledFor);
          if (calEvent?.id && assignment?.id) {
            await assignmentsApi.update(assignment.id, { calendar_event_id: calEvent.id });
          }
        } catch (calErr) {
          console.error('Calendar sync failed:', calErr);
          alert('⚠️ Job scheduled in Overwatch but Google Calendar sync failed: ' + calErr.message);
        }
      }

      if (helperTech) {
        try {
          const helperAssignment = await assignmentsApi.create({
            job_id: job.id,
            tech_id: helperTech.id,
            scheduled_for: scheduledFor.toISOString()
          }, userEmail);
          if (accessToken) {
            try {
              const helperCalEvent = await scheduleToTechCalendar(accessToken, job, helperTech, scheduledFor);
              if (helperCalEvent?.id && helperAssignment?.id) {
                await assignmentsApi.update(helperAssignment.id, { calendar_event_id: helperCalEvent.id });
              }
            } catch (calErr) {
              console.warn('Helper calendar sync failed (non-fatal):', calErr);
            }
          }
        } catch (helperErr) {
          console.warn('Helper assignment failed (non-fatal):', helperErr);
        }
      }

      if (!isTentative) {
        const noteText = helperTech
          ? `Scheduled for ${selectedTech.name} + ${helperTech.name} on ${selectedDate.toLocaleDateString()} at ${selectedTime}`
          : `Scheduled for ${selectedTech.name} on ${selectedDate.toLocaleDateString()} at ${selectedTime}`;
        await jobsApi.changeStatus(job.id, JOB_STATUS.SCHEDULED, userEmail, noteText);
      } else {
        const noteText = helperTech
          ? `📌 TENTATIVELY assigned to ${selectedTech.name} + ${helperTech.name} for ${selectedDate.toLocaleDateString()} at ${selectedTime}`
          : `📌 TENTATIVELY assigned to ${selectedTech.name} for ${selectedDate.toLocaleDateString()} at ${selectedTime}`;
        await notesApi.addNote(job.id, noteText, userEmail);
      }

      notifyJobAssigned(selectedTech.name, job.customer_name, scheduledFor.toISOString());
      onClose();
      try { onScheduled?.(); } catch (_) {}
    } catch (e) {
      console.error('Schedule error:', e);
      alert('Error scheduling: ' + e.message);
      setIsSubmitting(false);
    }
  };

  // Supabase jobs for selected tech/day
  const selectedDayJobs = selectedTech && selectedDate
    ? getJobsForTechDay(selectedTech.name, selectedDate)
    : [];

  // Determine if day looks truly open (both Supabase and GCal)
  const calId = selectedTech ? TECH_GCAL_ID[selectedTech.name] : null;
  const hasGcalForTech = !!calId;
  const gcalConfirmedOpen = hasGcalForTech && gcalEvents !== null && gcalEvents.length === 0;
  const gcalHasEvents = hasGcalForTech && gcalEvents !== null && gcalEvents.length > 0;
  const dayIsOpen = selectedDayJobs.length === 0 && gcalConfirmedOpen;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 300,
      display: 'flex', flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px', borderBottom: '1px solid #334155',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer'
        }}>✕ Cancel</button>
        <div style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>📅 Schedule Job</div>
        <div style={{ width: '60px' }} />
      </div>

      {/* Job info */}
      <div style={{ padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <div style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '15px' }}>{job.customer_name}</div>
        <div style={{ color: '#94a3b8', fontSize: '13px' }}>{job.issue || job.customer_address || 'No details'}</div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>

        {/* Lead Tech picker */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
            LEAD TECH
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {techs.map(tech => (
              <button
                key={tech.id}
                onClick={() => {
                  setSelectedTech(tech);
                  setGcalEvents(null);
                  setGcalBusyCounts({});
                  if (helperTech?.id === tech.id) setHelperTech(null);
                }}
                style={{
                  padding: '10px 18px', borderRadius: '10px', fontSize: '14px', fontWeight: '600',
                  cursor: 'pointer', border: 'none',
                  background: selectedTech?.id === tech.id ? TECH_COLORS[tech.name] || '#3b82f6' : '#1e293b',
                  color: selectedTech?.id === tech.id ? '#fff' : '#94a3b8',
                  boxShadow: selectedTech?.id === tech.id ? `0 0 0 2px ${TECH_COLORS[tech.name] || '#3b82f6'}` : 'none'
                }}
              >
                {tech.name}
              </button>
            ))}
          </div>
        </div>

        {/* Helper Tech picker */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
            HELPER (optional)
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setHelperTech(null)}
              style={{
                padding: '10px 16px', borderRadius: '10px', fontSize: '14px', fontWeight: '600',
                cursor: 'pointer', border: 'none',
                background: !helperTech ? '#334155' : '#1e293b',
                color: !helperTech ? '#e2e8f0' : '#64748b'
              }}
            >
              None
            </button>
            {techs.filter(t => t.id !== selectedTech?.id).map(tech => (
              <button
                key={tech.id}
                onClick={() => setHelperTech(tech)}
                style={{
                  padding: '10px 16px', borderRadius: '10px', fontSize: '14px', fontWeight: '600',
                  cursor: 'pointer', border: 'none',
                  background: helperTech?.id === tech.id ? `${TECH_COLORS[tech.name]}80` : '#1e293b',
                  color: helperTech?.id === tech.id ? '#fff' : '#64748b'
                }}
              >
                + {tech.name}
              </button>
            ))}
          </div>
        </div>

        {/* Week picker */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600' }}>WHEN</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setWeekOffset(w => w - 1)} style={{
                background: '#334155', border: 'none', borderRadius: '6px', padding: '6px 10px',
                color: '#e2e8f0', fontSize: '11px', cursor: 'pointer'
              }}>←</button>
              <button onClick={() => setWeekOffset(0)} style={{
                background: weekOffset === 0 ? '#3b82f6' : '#334155', border: 'none', borderRadius: '6px',
                padding: '6px 10px', color: '#e2e8f0', fontSize: '11px', cursor: 'pointer'
              }}>Today</button>
              <button onClick={() => setWeekOffset(w => w + 1)} style={{
                background: '#334155', border: 'none', borderRadius: '6px', padding: '6px 10px',
                color: '#e2e8f0', fontSize: '11px', cursor: 'pointer'
              }}>→</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
            {weekDates.map((d, i) => {
              const busyCount = selectedTech ? getBusyCountForDay(selectedTech.name, d) : 0;
              return (
                <button
                  key={i}
                  onClick={() => !isPast(d) && setSelectedDate(d)}
                  disabled={isPast(d)}
                  style={{
                    padding: '8px 2px', borderRadius: '8px', border: 'none', cursor: isPast(d) ? 'default' : 'pointer',
                    background: isSelected(d) ? '#3b82f6' : isToday(d) ? '#1e3a5f' : '#1e293b',
                    opacity: isPast(d) ? 0.4 : 1,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px'
                  }}
                >
                  <span style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '600' }}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  <span style={{
                    color: isSelected(d) ? '#fff' : isToday(d) ? '#00c8e8' : '#e2e8f0',
                    fontSize: '16px', fontWeight: '700'
                  }}>
                    {d.getDate()}
                  </span>
                  {selectedTech && busyCount > 0 && (
                    <span style={{
                      background: busyCount >= 5 ? '#ef4444' : busyCount >= 3 ? '#f59e0b' : '#22c55e',
                      color: '#fff', fontSize: '9px', fontWeight: '700',
                      padding: '1px 5px', borderRadius: '6px'
                    }}>
                      {busyCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Schedule for selected tech/day — shows REAL GCal events */}
        {selectedTech && selectedDate && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ 
              color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <span>
                {selectedTech.name.toUpperCase()}'S SCHEDULE — {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              {hasGcalForTech && (
                <span style={{ 
                  fontSize: '9px', color: gcalLoading ? '#64748b' : '#00c8e8',
                  background: '#00c8e810', padding: '2px 6px', borderRadius: '4px'
                }}>
                  {gcalLoading ? '⏳ Loading GCal...' : '📅 Live from Google'}
                </span>
              )}
            </div>

            {gcalLoading ? (
              <div style={{ color: '#64748b', fontSize: '12px', padding: '12px', textAlign: 'center' }}>
                Checking Google Calendar...
              </div>
            ) : dayIsOpen ? (
              <div style={{
                background: '#0f172a', borderRadius: '8px', padding: '12px',
                color: '#22c55e', fontSize: '13px', textAlign: 'center'
              }}>
                ✓ Day is open — confirmed in Google Calendar
              </div>
            ) : (
              <div style={{ background: '#0f172a', borderRadius: '8px', overflow: 'hidden' }}>

                {/* GCal events (real calendar blocks) */}
                {gcalHasEvents && gcalEvents.map((event, idx) => {
                  const isAllDay = !!event.start?.date;
                  const isUnavailable = event.summary?.toLowerCase().includes('unavailable') ||
                    event.summary?.toLowerCase().includes('blocked') ||
                    event.summary?.toLowerCase().includes('busy');
                  return (
                    <div key={event.id || idx} style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #1e293b',
                      borderLeft: `3px solid ${isUnavailable ? '#ef4444' : TECH_COLORS[selectedTech.name] || '#f59e0b'}`,
                      background: isUnavailable ? '#ef444410' : '#f59e0b08'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>
                            {isUnavailable ? '🚫 ' : '📅 '}{event.summary || '(No title)'}
                          </div>
                          {event.location && (
                            <div style={{ color: '#64748b', fontSize: '11px' }}>{event.location.slice(0, 50)}</div>
                          )}
                        </div>
                        <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: '600', textAlign: 'right', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                          {formatGCalTime(event.start, event.end)}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Supabase jobs (already scheduled in Overwatch) */}
                {selectedDayJobs.map((j, idx) => {
                  const isTentativeJob = j.status !== JOB_STATUS.SCHEDULED;
                  return (
                    <div key={j.id} style={{
                      padding: '10px 12px',
                      borderBottom: idx < selectedDayJobs.length - 1 ? '1px solid #1e293b' : 'none',
                      borderLeft: `3px solid ${isTentativeJob ? '#f59e0b' : TECH_COLORS[selectedTech.name] || '#3b82f6'}`,
                      background: isTentativeJob ? '#f59e0b10' : '#3b82f610'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>
                            🔧 {j.customer_name}
                          </div>
                          <div style={{ color: '#64748b', fontSize: '11px' }}>
                            {j.issue?.slice(0, 40) || j.customer_address || 'Overwatch job'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{
                            color: isTentativeJob ? '#f59e0b' : '#94a3b8',
                            fontSize: '12px', fontWeight: '600'
                          }}>
                            {formatTimeShort(j._scheduled_for)}
                          </div>
                          {isTentativeJob && (
                            <div style={{ color: '#f59e0b', fontSize: '9px' }}>TENTATIVE</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* If no GCal for this tech but Supabase is empty */}
                {!hasGcalForTech && selectedDayJobs.length === 0 && (
                  <div style={{
                    background: '#0f172a', borderRadius: '8px', padding: '12px',
                    color: '#22c55e', fontSize: '13px', textAlign: 'center'
                  }}>
                    ✓ No jobs scheduled in Overwatch
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Time picker */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>TIME</div>
          <button
            onClick={() => setShowTimePicker(!showTimePicker)}
            style={{
              width: '100%', padding: '12px 16px', background: '#1e293b', border: '1px solid #334155',
              borderRadius: '10px', color: '#e2e8f0', fontSize: '15px', fontWeight: '600',
              cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}
          >
            <span>🕐 {selectedTime}</span>
            <span style={{ color: '#64748b' }}>{showTimePicker ? '▲' : '▼'}</span>
          </button>

          {showTimePicker && (
            <div style={{
              marginTop: '6px', background: '#1e293b', borderRadius: '10px', padding: '6px',
              maxHeight: '160px', overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px'
            }}>
              {TIME_SLOTS.map(time => (
                <button
                  key={time}
                  onClick={() => { setSelectedTime(time); setShowTimePicker(false); }}
                  style={{
                    padding: '8px 4px', background: selectedTime === time ? '#3b82f6' : '#0f172a',
                    border: 'none', borderRadius: '6px', color: selectedTime === time ? '#fff' : '#94a3b8',
                    fontSize: '11px', cursor: 'pointer'
                  }}
                >
                  {time}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tentative toggle */}
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={() => setIsTentative(!isTentative)}
            style={{
              width: '100%', padding: '12px 14px',
              background: isTentative ? '#f59e0b15' : '#1e293b',
              border: isTentative ? '2px solid #f59e0b' : '1px solid #334155',
              borderRadius: '10px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '10px'
            }}
          >
            <span style={{
              width: '22px', height: '22px', borderRadius: '6px',
              background: isTentative ? '#f59e0b' : '#334155',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isTentative ? '#000' : '#64748b', fontWeight: '700', fontSize: '12px'
            }}>
              {isTentative ? '✓' : ''}
            </span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: isTentative ? '#f59e0b' : '#e2e8f0', fontWeight: '600', fontSize: '13px' }}>
                📌 Tentative
              </div>
              <div style={{ color: '#64748b', fontSize: '11px' }}>
                Assign without confirming — needs follow-up
              </div>
            </div>
          </button>
        </div>

      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #334155', background: '#0f172a',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))'
      }}>
        {selectedTech && selectedDate && (
          <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '10px', textAlign: 'center' }}>
            {isTentative ? '📌' : '📅'} {job.customer_name} →{' '}
            <span style={{ color: TECH_COLORS[selectedTech.name] || '#3b82f6', fontWeight: '600' }}>
              {selectedTech.name}
            </span>
            {helperTech && (
              <span style={{ color: TECH_COLORS[helperTech.name] || '#3b82f6' }}>
                {' + '}{helperTech.name}
              </span>
            )}
            {' · '}
            {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} @ {selectedTime}
          </div>
        )}

        {/* Monday install warning */}
        {showMondayWarning && (
          <div style={{
            background: '#7c2d1230', border: '1px solid #dc262640', borderRadius: '10px',
            padding: '12px', marginBottom: '10px'
          }}>
            <div style={{ color: '#f87171', fontSize: '13px', fontWeight: '700', marginBottom: '6px' }}>
              ⚠️ No Installs on Monday
            </div>
            <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '10px' }}>
              SOP says installs shouldn't be scheduled on Mondays. Schedule anyway?
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowMondayWarning(false)} style={{
                flex: 1, background: '#334155', color: '#e2e8f0', border: 'none',
                borderRadius: '8px', padding: '10px', fontSize: '13px', cursor: 'pointer'
              }}>Pick Another Day</button>
              <button onClick={handleSubmit} style={{
                flex: 1, background: '#dc2626', color: '#fff', border: 'none',
                borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer'
              }}>Schedule Anyway</button>
            </div>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!selectedTech || !selectedDate || isSubmitting}
          style={{
            width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
            background: selectedTech && selectedDate
              ? (isTentative ? '#f59e0b' : '#22c55e')
              : '#334155',
            color: selectedTech && selectedDate ? (isTentative ? '#000' : '#fff') : '#64748b',
            fontSize: '15px', fontWeight: '700', cursor: selectedTech && selectedDate ? 'pointer' : 'default',
            display: showMondayWarning ? 'none' : 'block'
          }}
        >
          {isSubmitting ? 'Scheduling...' : (isTentative ? '📌 Assign Tentatively' : '✓ Confirm Schedule')}
        </button>
      </div>
    </div>
  );
}
