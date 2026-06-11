// ============================================
// JUC-E V3 - Calendar Sync Service (Simplified)
// ============================================
// Simple toolkit: create events, archive events, detect orphans.
// Views decide WHEN to call these. No state machine.

import { jobsApi, assignmentsApi, techsApi, JOB_STATUS, notesApi, supabase } from './supabase.js';
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

// Fetch a single event by id. Returns the event object, or null on 404/error.
async function apiGetEvent(accessToken, calendarId, eventId) {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  return await res.json();
}

async function apiCreate(accessToken, calendarId, event) {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) }
  );
  if (!res.ok) throw new Error(`Create event error: ${(await res.json()).error?.message || res.statusText}`);
  return await res.json();
}

async function apiPatch(accessToken, calendarId, eventId, patch) {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
  );
  if (!res.ok) throw new Error(`Patch event error: ${(await res.json()).error?.message || res.statusText}`);
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
  const created = await apiCreate(accessToken, calendarId, event);
  try {
    const deepLink = `https://juc-e-v2.vercel.app/?cal=${encodeURIComponent(calendarId)}&job=${encodeURIComponent(created.id)}`;
    const updatedDesc = (event.description ? event.description + '\n\n' : '') + `📱 Open in JUC-E: ${deepLink}`;
    await apiPatch(accessToken, calendarId, created.id, { description: updatedDesc });
    created.description = updatedDesc;
  } catch (e) { console.warn('Deep link patch failed (non-fatal):', e.message); }
  return created;
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
// NOTE -> CALENDAR WRITE-BACK
// ============================================
// When a worker note is added to a job, mirror it onto the linked Google
// Calendar event(s) by appending a timestamped line to the event description.
// Notes are append-only on the calendar so the full thread stays visible.

// Friendly author name from an email (mirrors NotesPanel's map).
function resolveAuthorName(email) {
  if (!email) return 'Office';
  const names = {
    'drhservicetech1@gmail.com': 'Austin',
    'austin@drhsecurityservices.com': 'Austin',
    'jr@drhsecurityservices.com': 'JR',
    'brian@drhsecurityservices.com': 'Brian',
    'trevor@drhsecurityservices.com': 'Trevor',
    'subs@drhsecurityservices.com': 'Subs',
    'info@drhsecurityservices.com': 'Sara',
    'sara@jnbllc.com': 'Sara',
    'admin@jnbservice.com': 'Sara',
    'shanaparks@drhsecurityservices.com': 'Shana',
  };
  return names[email.toLowerCase()] || email.split('@')[0];
}

// Compact stamp like "6/8 2:45p" in Denver time.
function noteStamp(date = new Date()) {
  const s = date.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  // "6/8, 2:45 PM" -> "6/8 2:45p"
  return s.replace(',', '').replace(' AM', 'a').replace(' PM', 'p').replace(' ', ' ').replace(':', ':');
}

// Calendars an active (non-completed) job event could live on, in search order.
function noteSearchCalendars() {
  return [
    CALENDARS.AUSTIN,
    CALENDARS.JR,
    CALENDARS.TECH3,
    CALENDARS.SHANA,
    CALENDARS.SUBS,
    CALENDARS.INSTALLATIONS,
    CALENDARS.TENTATIVELY_SCHEDULED,
    CALENDARS.SALES_ACCOUNTING,
    CALENDARS.COMPLETED,
  ].filter(Boolean);
}

// Append a note line to every calendar event linked to this job's assignments.
// Non-fatal: never throws — the note is already saved in Supabase. Returns a
// small summary { patched, attempted } for optional logging.
export async function appendNoteToJobEvents(accessToken, job, noteText, authorEmail) {
  const summary = { patched: 0, attempted: 0 };
  if (!accessToken || !job || !noteText?.trim()) return summary;

  const assignments = job.assignments || [];
  // Collect unique event ids, remembering the assigned tech's calendar as the
  // preferred place to look first.
  const targets = new Map(); // eventId -> preferredCalendarId | null
  for (const a of assignments) {
    if (!a?.calendar_event_id) continue;
    if (!targets.has(a.calendar_event_id)) {
      const pref = a.tech ? getTechCalendarId(a.tech) : null;
      targets.set(a.calendar_event_id, pref);
    }
  }
  if (targets.size === 0) return summary; // unscheduled job / internal task — nothing to write

  const line = `📝 [${noteStamp()} ${resolveAuthorName(authorEmail)}] ${noteText.trim()}`;

  for (const [eventId, preferredCal] of targets) {
    summary.attempted++;
    try {
      const candidates = [preferredCal, ...noteSearchCalendars()].filter(Boolean);
      const seen = new Set();
      for (const calId of candidates) {
        if (seen.has(calId)) continue;
        seen.add(calId);
        const ev = await apiGetEvent(accessToken, calId, eventId);
        if (!ev) continue; // not on this calendar, keep looking
        const current = ev.description || '';
        const updated = current ? `${current}\n${line}` : line;
        await apiPatch(accessToken, calId, eventId, { description: updated });
        summary.patched++;
        break; // found and patched — done with this event
      }
    } catch (e) {
      console.warn('Note->calendar append failed (non-fatal):', e.message);
    }
  }
  return summary;
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
          // isJuce: matches BOTH the old "Managed by JUC-E" marker AND the deeplink marker makeJuceJob writes
          const isJuce = event.description?.includes('Managed by JUC-E') || 
                         event.description?.includes('📱 Open in JUC-E') ||
                         event.description?.includes('Open in JUC-E:');
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
// ORPHAN IGNORE — Supabase-backed, localStorage fallback
// ============================================

export async function ignoreOrphan(eventId) {
  const ignored = JSON.parse(localStorage.getItem('juce_ignored_events') || '[]');
  if (!ignored.includes(eventId)) {
    ignored.push(eventId);
    localStorage.setItem('juce_ignored_events', JSON.stringify(ignored));
  }
  try {
    await supabase.from('activity_log').upsert(
      { event_type: 'orphan_ignored', calendar_event_id: eventId, created_at: new Date().toISOString() },
      { onConflict: 'calendar_event_id' }
    );
  } catch (e) { console.warn('ignoreOrphan Supabase write failed (localStorage active):', e.message); }
}

export async function ignoreAllOrphans(eventIds) {
  const ignored = JSON.parse(localStorage.getItem('juce_ignored_events') || '[]');
  const merged = [...new Set([...ignored, ...eventIds])];
  localStorage.setItem('juce_ignored_events', JSON.stringify(merged));
  try {
    const rows = eventIds.map(id => ({ event_type: 'orphan_ignored', calendar_event_id: id, created_at: new Date().toISOString() }));
    if (rows.length) await supabase.from('activity_log').upsert(rows, { onConflict: 'calendar_event_id' });
  } catch (e) { console.warn('ignoreAllOrphans Supabase write failed:', e.message); }
}

export function isOrphanIgnored(eventId) {
  const ignored = JSON.parse(localStorage.getItem('juce_ignored_events') || '[]');
  return ignored.includes(eventId);
}

export async function syncIgnoredOrphansFromSupabase() {
  try {
    const { data } = await supabase.from('activity_log').select('calendar_event_id').eq('event_type', 'orphan_ignored');
    if (data?.length) {
      const local = JSON.parse(localStorage.getItem('juce_ignored_events') || '[]');
      localStorage.setItem('juce_ignored_events', JSON.stringify([...new Set([...local, ...data.map(r => r.calendar_event_id).filter(Boolean)])]));
    }
  } catch (e) { console.warn('syncIgnoredOrphans failed:', e.message); }
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
  ignoreAllOrphans,
  syncIgnoredOrphansFromSupabase,
  isOrphanIgnored
};
