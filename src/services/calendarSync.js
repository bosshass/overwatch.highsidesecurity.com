// ============================================
// JUC-E V3 - Calendar Sync Service (Simplified)
// ============================================
// Simple toolkit: create events, archive events, detect orphans.
// Views decide WHEN to call these. No state machine.

import { jobsApi, assignmentsApi, techsApi, JOB_STATUS, notesApi } from './supabase.js';
import { SYNC_CALENDARS, CALENDARS, getTechCalendarId } from '../config/calendars.js';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

// ============================================
// LOW-LEVEL CALENDAR API
// ============================================

async function apiGet(accessToken, calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100'
  });
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Calendar API error: ${(await res.json()).error?.message || res.statusText}`);
  return (await res.json()).items || [];
}

async function apiCreate(accessToken, calendarId, event) {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) }
  );
  if (!res.ok) throw new Error(`Create event error: ${(await res.json()).error?.message || res.statusText}`);
  return await res.json();
}

async function apiDelete(accessToken, calendarId, eventId) {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok && res.status !== 404) throw new Error(`Delete error: ${res.statusText}`);
}

async function apiMove(accessToken, sourceCalendarId, eventId, destinationCalendarId) {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(sourceCalendarId)}/events/${eventId}/move?destination=${encodeURIComponent(destinationCalendarId)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Move error: ${res.statusText}`);
  return res.json();
}

// ============================================
// TOOLKIT FUNCTIONS (views call these)
// ============================================

// Create a new event on any calendar. Returns the created event.
export async function createEventOnCalendar(accessToken, calendarId, { title, description, location, startTime, endTime, colorId }) {
  const event = {
    summary: title,
    description: description || '',
    location: location || '',
    start: { dateTime: new Date(startTime).toISOString(), timeZone: 'America/Denver' },
    end: { dateTime: new Date(endTime || new Date(startTime).getTime() + 2 * 60 * 60 * 1000).toISOString(), timeZone: 'America/Denver' },
  };
  if (colorId) event.colorId = colorId;
  return await apiCreate(accessToken, calendarId, event);
}

// Archive an event: delete from source calendar
export async function archiveEvent(accessToken, sourceCalendarId, eventId) {
  try {
    // Move event to Completed calendar instead of deleting
    await apiMove(accessToken, sourceCalendarId, eventId, CALENDARS.COMPLETED);
  } catch (e) {
    // If move fails (permissions, already gone), try delete as fallback
    try {
      await apiDelete(accessToken, sourceCalendarId, eventId);
    } catch (e2) {
      console.warn('Could not archive or delete old event:', e2.message);
    }
  }
}

// Get the latest note for a job (for event descriptions)
export async function getLatestNote(jobId) {
  try {
    const notes = await notesApi.getAllForJob(jobId);
    return notes.length > 0 ? notes[0].text : '';
  } catch (e) {
    return '';
  }
}

// Build a clean event title from job data
export function buildEventTitle(job, tag) {
  let title = job.customer_name || 'Unknown';
  if (tag) title = `[${tag}] ${title}`;
  return title;
}

// Build event description with just the latest note
export function buildEventDescription(job, latestNote) {
  let desc = '';
  if (job.job_number) desc += `JOB #${job.job_number}\n`;
  if (job.customer_address) desc += `📍 ${job.customer_address}\n`;
  if (job.customer_phone) desc += `📞 ${job.customer_phone}\n`;
  if (job.gate_code) desc += `🚪 Gate: ${job.gate_code}\n`;
  if (job.panel_password) desc += `🔐 Panel: ${job.panel_password}\n`;
  if (job.issue) desc += `\nIssue: ${job.issue}\n`;
  if (latestNote) desc += `\n--- Latest Note ---\n${latestNote}\n`;
  desc += '\n⚡ Managed by JUC-E';
  return desc;
}

// Google Calendar color IDs
export function getColorId(type) {
  const colors = { urgent: '11', high: '6', normal: '7', low: '10', complete: '10', return: '6', sales: '5', nc: '8' };
  return colors[type] || '7';
}

// ============================================
// COMPOSITE HELPERS (common patterns)
// ============================================

// Schedule a job to a tech's calendar (used by FlightDeck + ATC)
export async function scheduleToTechCalendar(accessToken, job, tech, scheduledFor, estimatedHours = 2) {
  const calendarId = getTechCalendarId(tech);
  if (!calendarId) throw new Error(`No calendar configured for ${tech.name}`);

  const latestNote = await getLatestNote(job.id);
  const start = new Date(scheduledFor);
  const end = new Date(start.getTime() + estimatedHours * 60 * 60 * 1000);

  return await createEventOnCalendar(accessToken, calendarId, {
    title: buildEventTitle(job),
    description: buildEventDescription(job, latestNote),
    location: job.customer_address,
    startTime: start,
    endTime: end,
    colorId: getColorId(job.priority)
  });
}

// On complete: create event on Sales & Accounting, archive old event
export async function onJobComplete(accessToken, job, completionType, oldCalendarId, oldEventId) {
  const latestNote = await getLatestNote(job.id);

  const tagMap = { fixed: 'COMPLETE', return: 'RETURN NEEDED', sales: 'ESTIMATE NEEDED', nc: 'NO CHARGE' };
  const tag = tagMap[completionType] || 'COMPLETE';

  const start = new Date();
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  // Create new event on Sales & Accounting
  const newEvent = await createEventOnCalendar(accessToken, CALENDARS.SALES_ACCOUNTING, {
    title: buildEventTitle(job, tag),
    description: buildEventDescription(job, latestNote),
    location: job.customer_address,
    startTime: start,
    endTime: end,
    colorId: getColorId(completionType)
  });

  // Archive old event from tech's calendar
  if (oldCalendarId && oldEventId) {
    await archiveEvent(accessToken, oldCalendarId, oldEventId);
  }

  return newEvent;
}

// ============================================
// ORPHAN DETECTION (read-only scan)
// ============================================

export async function scanForOrphans(accessToken) {
  const results = { synced: 0, orphans: [], errors: [] };

  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 7);
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 30);

  // Only scan INPUT calendars — skip output/archive calendars
  const SKIP_TYPES = ['completed', 'sales', 'installations'];
  const sourceCalendars = SYNC_CALENDARS.filter(c => !SKIP_TYPES.includes(c.type));

  for (const cal of sourceCalendars) {
    try {
      const events = await apiGet(accessToken, cal.id, timeMin, timeMax);
      for (const event of events) {
        if (!event.start?.dateTime || event.status === 'cancelled') continue;

        const existing = await assignmentsApi.getByCalendarEventId(event.id);
        if (existing) {
          results.synced++;
        } else {
          const isJuce = event.description?.includes('Managed by JUC-E');
          if (!isJuce && !isOrphanIgnored(event.id)) {
            results.orphans.push({ event, calendar: cal });
          }
        }
      }
    } catch (err) {
      results.errors.push({ calendar: cal.name, error: err.message });
    }
  }

  return results;
}

// ============================================
// FETCH CALENDAR EVENTS (for hybrid views)
// ============================================

async function fetchCalendarEvents(accessToken, calendarIds, daysBack = 1, daysForward = 14) {
  const timeMin = new Date(); timeMin.setDate(timeMin.getDate() - daysBack);
  const timeMax = new Date(); timeMax.setDate(timeMax.getDate() + daysForward);
  const results = [];

  for (const cal of calendarIds) {
    const calId = typeof cal === 'string' ? cal : cal.id;
    const calName = typeof cal === 'string' ? calId : cal.name;
    try {
      const events = await apiGet(accessToken, calId, timeMin, timeMax);
      for (const e of events) {
        results.push({
          id: e.id,
          calendarId: calId,
          calendarName: calName,
          summary: e.summary || '(No title)',
          location: e.location || '',
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          description: e.description || '',
          _raw: e
        });
      }
    } catch (err) {
      console.warn(`Calendar fetch failed for ${calName}:`, err.message);
    }
  }

  return results.sort((a, b) => new Date(a.start) - new Date(b.start));
}

// ============================================
// ORPHAN IGNORE (localStorage for now)
// ============================================

export function ignoreOrphan(eventId) {
  const ignored = JSON.parse(localStorage.getItem('juce_ignored_events') || '[]');
  if (!ignored.includes(eventId)) {
    ignored.push(eventId);
    localStorage.setItem('juce_ignored_events', JSON.stringify(ignored));
  }
}

export function isOrphanIgnored(eventId) {
  const ignored = JSON.parse(localStorage.getItem('juce_ignored_events') || '[]');
  return ignored.includes(eventId);
}

export default {
  createEventOnCalendar,
  archiveEvent,
  getLatestNote,
  buildEventTitle,
  buildEventDescription,
  getColorId,
  scheduleToTechCalendar,
  onJobComplete,
  scanForOrphans,
  fetchCalendarEvents,
  ignoreOrphan,
  isOrphanIgnored
};
