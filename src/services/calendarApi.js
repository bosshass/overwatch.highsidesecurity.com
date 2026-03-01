// ============================================
// OVERWATCH V3 - Calendar API Service
// ============================================
// Clean Google Calendar read/write. NO Supabase. NO database.
// Low-level API functions are battle-tested from V2.
// Views and tools call these. Nothing else touches Google Calendar.

import { SYNC_CALENDARS, CALENDARS, getTechCalendarId } from '../config/calendars.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

// ============================================
// LOW-LEVEL API (proven from V2)
// ============================================

async function apiRequest(accessToken, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || res.statusText;
    const error = new Error(`Calendar API ${res.status}: ${msg}`);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null; // DELETE returns no body
  return res.json();
}

// Fetch events from a single calendar within a time range
export async function apiGet(accessToken, calendarId, timeMin, timeMax, maxResults = 250) {
  const params = new URLSearchParams({
    timeMin: timeMin instanceof Date ? timeMin.toISOString() : timeMin,
    timeMax: timeMax instanceof Date ? timeMax.toISOString() : timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(maxResults),
  });
  const data = await apiRequest(accessToken,
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
  );
  return data.items || [];
}

// Fetch ALL events with pagination (for migration — can pull thousands)
export async function apiGetAll(accessToken, calendarId, timeMin, timeMax, onPage) {
  let pageToken = null;
  let allEvents = [];

  do {
    const params = new URLSearchParams({
      timeMin: timeMin instanceof Date ? timeMin.toISOString() : timeMin,
      timeMax: timeMax instanceof Date ? timeMax.toISOString() : timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await apiRequest(accessToken,
      `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    );

    const items = data.items || [];
    allEvents = allEvents.concat(items);
    pageToken = data.nextPageToken || null;

    if (onPage) onPage(items, allEvents.length);
  } while (pageToken);

  return allEvents;
}

// Create event on a calendar
export async function apiCreate(accessToken, calendarId, event) {
  return apiRequest(accessToken,
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(event) }
  );
}

// Update an existing event (PATCH — only sends changed fields)
export async function apiUpdate(accessToken, calendarId, eventId, updates) {
  return apiRequest(accessToken,
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    { method: 'PATCH', body: JSON.stringify(updates) }
  );
}

// Delete an event
export async function apiDelete(accessToken, calendarId, eventId) {
  return apiRequest(accessToken,
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    { method: 'DELETE' }
  );
}

// Move event between calendars (preserves event ID)
export async function apiMove(accessToken, sourceCalendarId, eventId, destinationCalendarId) {
  return apiRequest(accessToken,
    `${API_BASE}/calendars/${encodeURIComponent(sourceCalendarId)}/events/${eventId}/move?destination=${encodeURIComponent(destinationCalendarId)}`,
    { method: 'POST' }
  );
}

// ============================================
// FETCH HELPERS
// ============================================

// Fetch events from multiple calendars, returns flat sorted array
export async function fetchCalendarEvents(accessToken, calendars, daysBack = 1, daysForward = 14) {
  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - daysBack);
  timeMin.setHours(0, 0, 0, 0);

  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + daysForward);
  timeMax.setHours(23, 59, 59, 999);

  const calList = calendars || SYNC_CALENDARS;
  const results = [];

  for (const cal of calList) {
    const calId = typeof cal === 'string' ? cal : cal.id;
    const calName = typeof cal === 'string' ? calId : cal.name;
    const calColor = typeof cal === 'object' ? cal.color : null;
    try {
      const events = await apiGet(accessToken, calId, timeMin, timeMax);
      for (const e of events) {
        if (e.status === 'cancelled') continue;
        results.push({
          id: e.id,
          calendarId: calId,
          calendarName: calName,
          calendarColor: calColor,
          summary: e.summary || '(No title)',
          location: e.location || '',
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          allDay: !!e.start?.date,
          description: e.description || '',
          created: e.created,
          updated: e.updated,
          _raw: e,
        });
      }
    } catch (err) {
      console.warn(`Calendar fetch failed for ${calName}:`, err.message);
    }
  }

  return results.sort((a, b) => new Date(a.start) - new Date(b.start));
}

// Fetch ALL events from ALL calendars for migration (full history)
export async function fetchAllHistorical(accessToken, calendars, timeMin, timeMax, onProgress) {
  const calList = calendars || SYNC_CALENDARS;
  const results = [];

  for (let i = 0; i < calList.length; i++) {
    const cal = calList[i];
    const calId = typeof cal === 'string' ? cal : cal.id;
    const calName = typeof cal === 'string' ? calId : cal.name;

    if (onProgress) onProgress({ calendar: calName, index: i, total: calList.length, events: results.length });

    try {
      const events = await apiGetAll(accessToken, calId, timeMin, timeMax, (page, count) => {
        if (onProgress) onProgress({ calendar: calName, index: i, total: calList.length, events: results.length + count });
      });
      for (const e of events) {
        if (e.status === 'cancelled') continue;
        results.push({
          id: e.id,
          calendarId: calId,
          calendarName: calName,
          calendarColor: cal.color || null,
          summary: e.summary || '(No title)',
          location: e.location || '',
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          allDay: !!e.start?.date,
          description: e.description || '',
          created: e.created,
          updated: e.updated,
          _raw: e,
        });
      }
    } catch (err) {
      console.warn(`Historical fetch failed for ${calName}:`, err.message);
    }
  }

  return results.sort((a, b) => new Date(a.start) - new Date(b.start));
}

// ============================================
// WRITE HELPERS
// ============================================

// Create a V3-formatted event on a calendar
export async function createEvent(accessToken, calendarId, { title, description, location, startTime, endTime }) {
  const event = {
    summary: title,
    description: description || '',
    location: location || '',
    start: { dateTime: new Date(startTime).toISOString(), timeZone: 'America/Denver' },
    end: { dateTime: new Date(endTime || new Date(startTime).getTime() + 2 * 3600000).toISOString(), timeZone: 'America/Denver' },
  };
  return apiCreate(accessToken, calendarId, event);
}

// Update just the title and description of an event (for migration rewrite)
export async function rewriteEvent(accessToken, calendarId, eventId, { summary, description }) {
  const updates = {};
  if (summary !== undefined) updates.summary = summary;
  if (description !== undefined) updates.description = description;
  return apiUpdate(accessToken, calendarId, eventId, updates);
}

// Move to Completed calendar
export async function archiveEvent(accessToken, sourceCalendarId, eventId) {
  try {
    return await apiMove(accessToken, sourceCalendarId, eventId, CALENDARS.COMPLETED);
  } catch (e) {
    try { await apiDelete(accessToken, sourceCalendarId, eventId); } catch (_) {}
  }
}

// Google Calendar color IDs
export const COLOR_IDS = {
  urgent: '11',    // Red
  high: '6',       // Orange
  normal: '7',     // Cyan
  low: '10',       // Green
  complete: '2',   // Green (sage)
  return: '6',     // Orange
  sales: '5',      // Banana
  nc: '8',         // Graphite
};
