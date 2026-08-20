// ============================================
// JUC-E V3 - Calendar Sync Service (Simplified)
// ============================================
// Simple toolkit: create events, archive events, detect orphans.
// Views decide WHEN to call these. No state machine.

import { jobsApi, assignmentsApi, techsApi, JOB_STATUS, notesApi, supabase } from './supabase.js';
import { SYNC_CALENDARS, CALENDARS, getTechCalendarId } from '../config/calendars.js';
import { jobDeepLink } from '../config/appBase.js';
import { resolveJobForEvent } from '../utils/jobResolve.js';

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

// Format a Date as local wall-clock "YYYY-MM-DDTHH:mm:ss" (no Z, no offset)
// so Google honors the timeZone field alongside it.
function toWallClock(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Create a new event on any calendar. Returns the created event.
export async function createEventOnCalendar(accessToken, calendarId, { title, description, location, startTime, endTime, colorId }) {
  const event = {
    summary: title,
    description: description || '',
    location: location || '',
    // Wall-clock local time + explicit timeZone. NEVER toISOString() here:
    // an ISO string ends in Z (UTC) and Google IGNORES the timeZone field
    // when the dateTime carries an offset — that was the timezone bug.
    start: { dateTime: toWallClock(new Date(startTime)), timeZone: 'America/Denver' },
    end: { dateTime: toWallClock(new Date(endTime || new Date(startTime).getTime() + 2 * 60 * 60 * 1000)), timeZone: 'America/Denver' },
  };
  if (colorId) event.colorId = colorId;
  const created = await apiCreate(accessToken, calendarId, event);
  try {
    const deepLink = jobDeepLink(calendarId, created.id);
    const updatedDesc = (event.description ? event.description + '\n\n' : '') + `📱 Open in Overwatch: ${deepLink}`;
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

// Build a clean event title from job data.
//
// The `tag` parameter is GONE (2026-08-20). It prefixed the title with
// [COMPLETE] / [RETURN NEEDED] / [ESTIMATE NEEDED] / [NO CHARGE]. Overwatch does
// not tag calendar titles: status lives in the database, and a tag written into
// a summary is a string somebody has to parse back out later.
//
// The only caller that ever passed one was onJobComplete(), which is exported
// and called from nowhere — so removing it changes nothing that runs.
export function buildEventTitle(job) {
  return job.customer_name || 'Unknown';
}

// Build event description with just the latest note.
//
// `scheduledBy` is stamped so anyone reading the calendar can see WHO put this
// on the day. book() has always known it — it passes byEmail to the recap audit
// log — but it never reached the description, so a Google calendar full of
// events said what and when and never who. That is the first question asked
// when a booking looks wrong.
export function buildEventDescription(job, latestNote, { scheduledBy = null } = {}) {
  let desc = '';
  // The customer UUID is the anchor for everything downstream — billing,
  // Event Audit, customer history. Stamped FIRST so CustomerLookup finds it
  // the moment a tech opens the visit. It is now called out LOUDLY rather
  // than buried as one quiet line: if it's missing, the event says so at the
  // very top, so an unmatched job is obvious from the calendar itself instead
  // of being discovered months later in a billing audit.
  if (job.customer_id) {
    desc += `✅ CUSTOMER_ID: ${job.customer_id}\n`;
    if (job.customer_short_code) desc += `   Client: ${job.customer_short_code}\n`;
    desc += '\n';
  } else {
    desc += '⚠️⚠️ NO CUSTOMER LINKED ⚠️⚠️\n';
    desc += 'This job is NOT attached to a client in Overwatch.\n';
    desc += 'Open it and pick the customer, or it will not bill.\n\n';
  }
  if (job.job_number) desc += `JOB #${job.job_number}\n`;
  if (job.customer_address) desc += `📍 ${job.customer_address}\n`;
  if (job.customer_phone) desc += `📞 ${job.customer_phone}\n`;
  // On-site contact (migration 047). Used to be prose inside job.issue, which
  // meant the tech had to read a form skeleton to find who to ask for.
  if (job.site_contact_name)  desc += `👤 On site: ${job.site_contact_name}\n`;
  if (job.site_contact_phone) desc += `📱 On-site phone: ${job.site_contact_phone}\n`;
  if (job.access_permission === true)  desc += `🔓 May enter without client present\n`;
  if (job.access_permission === false) desc += `🔒 Client must be present\n`;
  if (job.gate_code) desc += `🚪 Gate: ${job.gate_code}\n`;
  if (job.panel_password) desc += `🔐 Panel: ${job.panel_password}\n`;
  if (job.issue) desc += `\nIssue: ${job.issue}\n`;
  if (scheduledBy) desc += `\n🗓 Scheduled by: ${resolveAuthorName(scheduledBy)}\n`;
  if (latestNote) desc += `\n--- Latest Note ---\n${latestNote}\n`;
  // "Managed by Overwatch" from here on. Nothing READS these markers anymore —
  // the orphan scan resolves against the database (9.9.27) — so old events
  // keeping the old JUC-E text costs nothing. This is purely what a human sees.
  desc += '\n⚡ Managed by Overwatch';
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
// ISSUE <-> CALENDAR DESCRIPTION
// ============================================
// "Calendar event desc and 'issue' are or should be the same — NEVER
// OVERWRITE." Both halves of that matter, and they pull against each other:
// the issue has to reach the event, but an event description also carries
// things the app must not destroy — the CUSTOMER_ID stamp that billing and
// CustomerLookup resolve against, appended field notes, the deep link, and
// whatever a human typed into it directly.
//
// So the issue gets a FENCED REGION of its own and nothing else is touched.
// Rewrites replace what is between the fences; every other byte of the
// description survives verbatim.
const ISSUE_OPEN  = '▼ ISSUE — edited in Overwatch';
const ISSUE_CLOSE = '▲';

// Legacy events have a bare "Issue: ..." line written by buildEventDescription
// before fences existed. It runs until the next structured line (an emoji
// marker, "Scheduled by", "Latest Note", "Managed by Overwatch") or the end.
// Matching it lets the first edit REPLACE the old text instead of leaving two
// contradictory copies of the job in one description.
const LEGACY_ISSUE = /^Issue:[^\n]*(?:\n(?![\u2600-\u27BF\uD83C-\uDBFF\u2190-\u21FF\u25A0-\u25FF]|---|\u26A1|Issue:)[^\n]*)*/m;

export function applyIssueToDescription(description, issueText) {
  const body  = (issueText || '').trim();
  const fenced = body ? `${ISSUE_OPEN}\n${body}\n${ISSUE_CLOSE}` : '';
  const current = description || '';

  // 1. Already fenced — swap the contents, touch nothing else.
  const fences = new RegExp(`${ISSUE_OPEN}\\n[\\s\\S]*?\\n${ISSUE_CLOSE}`);
  if (fences.test(current)) {
    return body ? current.replace(fences, fenced) : current.replace(fences, '').replace(/\n{3,}/g, '\n\n');
  }

  // 2. Legacy "Issue:" block — upgrade it in place.
  if (LEGACY_ISSUE.test(current)) {
    return body ? current.replace(LEGACY_ISSUE, fenced) : current.replace(LEGACY_ISSUE, '').replace(/\n{3,}/g, '\n\n');
  }

  if (!body) return current;

  // 3. Neither — insert ABOVE the "Managed by Overwatch" footer if there is
  // one, otherwise append. Never at the very top: the CUSTOMER_ID stamp is
  // deliberately first so a tech sees it without scrolling.
  const footer = current.indexOf('\u26A1 Managed by Overwatch');
  if (footer > -1) {
    return `${current.slice(0, footer).replace(/\s+$/, '')}\n\n${fenced}\n\n${current.slice(footer)}`;
  }
  return current ? `${current.replace(/\s+$/, '')}\n\n${fenced}` : fenced;
}

// Push the job's issue onto every calendar event that represents it.
// Non-fatal by design: the issue is already saved in Supabase before this
// runs, so a calendar failure must never cost the edit. Returns
// { patched, attempted } for the caller to report honestly.
export async function syncIssueToEvents(accessToken, job, issueText) {
  const summary = { patched: 0, attempted: 0 };
  if (!accessToken || !job) return summary;

  // All four homes an event id can live in — the same set jobResolve checks,
  // because an issue that reaches only one of them is an issue that disagrees
  // with itself depending on which calendar you opened.
  const ids = new Set([
    job.scheduled_event_id,
    job.calendar_event_id,
    job.tentative_event_id,
    ...(job.assignments || []).map(a => a?.calendar_event_id),
  ].filter(Boolean));
  if (ids.size === 0) return summary;

  const calendars = [job.scheduled_calendar_id, ...noteSearchCalendars()].filter(Boolean);

  for (const eventId of ids) {
    summary.attempted++;
    try {
      const seen = new Set();
      for (const calId of calendars) {
        if (seen.has(calId)) continue;
        seen.add(calId);
        const ev = await apiGetEvent(accessToken, calId, eventId);
        if (!ev) continue;
        const updated = applyIssueToDescription(ev.description || '', issueText);
        if (updated !== (ev.description || '')) {
          await apiPatch(accessToken, calId, eventId, { description: updated });
          summary.patched++;
        }
        break;
      }
    } catch (e) {
      console.warn('Issue->calendar sync failed (non-fatal):', e.message);
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

  // tagMap REMOVED 2026-08-20 — Overwatch does not tag calendar titles.
  // completionType still drives the event COLOUR below, which is a display
  // property rather than a fact somebody has to parse back out of a string.

  const start = new Date();
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  // Create new event on Sales & Accounting
  const newEvent = await createEventOnCalendar(accessToken, CALENDARS.SALES_ACCOUNTING, {
    title: buildEventTitle(job),
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

// Default back-wall for the orphan scan. Exported so the UI can offer a
// deeper sweep without hardcoding the date in two places.
export const ORPHAN_SCAN_FROM = '2026-08-13T00:00:00';
// The old wall, kept as the "look further back" option rather than deleted —
// an event before Aug 13 with no job AND no time entry is invisible everywhere
// else in the app, so the ability to go find it has to survive somewhere.
export const ORPHAN_SCAN_DEEP = '2026-06-01T00:00:00';

export async function scanForOrphans(accessToken, { since = ORPHAN_SCAN_FROM } = {}) {
  const results = { synced: 0, orphans: [], errors: [], since };

  // NO NAME MATCHING. Removed 2026-08-13.
  // This used to fuzzy-match each orphan's TITLE against every open job's
  // customer_name and present the winner as "Possible duplicate". Matching a
  // free-text title against a name column is guessing: "Battery Plus cr123
  // for David" resolved to HUANG, DAVID out of twelve customers named David
  // or Dave, and "Boys and Girls Club Loveland" resolved to BG AUTOMOTIVE-
  // LOVELAND1 on the token "Loveland" — an hour billed to the wrong customer.
  // An event's customer is known from a link or it is not known. A blank
  // field a human fills in is correct; a confident wrong answer is not.

  // AUGUST 13 2026 BACK-WALL. Moved from June 1 on 2026-08-13.
  // Everything before this date has been closed out in the database:
  // migration 041 deleted the QA test data, 042 stamped resolved_at on all
  // 193 pre-July time entries, and 045 removed the test jobs and notes.
  // Scanning back past it re-surfaces work that has already been decided and
  // is what kept this list reading ~53 when the real number was a handful.
  // The past is settled. This scan is for what happens from here forward.
  const timeMin = new Date(since);
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 30);

  // Billed-by-title: the team writes the invoice number into the event title
  // when it's been billed, and completed work carries the ✅ marker. Those are
  // DONE — flagging them as "will not bill" would bury the real leaks under
  // a pile of finished ones.
  const looksBilled = (ev) =>
    /\binv(oice)?\s*#?\s*\d{3,}/i.test(ev.summary || '') ||
    /\[(BILLED|BILL IT|PAID)\]/i.test(ev.summary || '') ||
    /✅\s*COMPLETED/i.test(ev.description || '');

  // Only scan INPUT calendars — skip output/archive calendars
  // 'queue' = the Tent calendar. Holds are PENCIL MARKS, not work — scanning
  // them made every "Holding X" since June 1 look like an untracked job, and
  // adopting one minted a fake scheduled job with no customer. The belt is
  // skipping the calendar; the suspenders is the title check below, which
  // also catches holds that ended up on the WRONG calendar during the weeks
  // the Tent ID was misconfigured.
  const SKIP_TYPES = ['completed', 'sales', 'installations', 'queue'];
  const sourceCalendars = SYNC_CALENDARS.filter(c => !SKIP_TYPES.includes(c.type));

  for (const cal of sourceCalendars) {
    try {
      const events = await apiGet(accessToken, cal.id, timeMin, timeMax);
      for (const event of events) {
        if (!event.start?.dateTime || event.status === 'cancelled') continue;
        if (looksBilled(event)) { results.synced++; continue; }
        if (/^\s*Holding\b/i.test(event.summary || '')) { results.synced++; continue; }

        // THE CARD CHECK — this is the fix. "Linked" now means exactly what
        // the board means by it: a jobs row references this calendar event.
        // The old check asked job_assignments (tech dispatch) instead, plus a
        // fuzzy "isJuce" text marker in the description as a fallback — which
        // let an event dodge the orphan list (stale marker, or tagged via the
        // triage buttons that only rewrite titles) while still having ZERO
        // real job behind it. That's why things could sit tagged in Triage
        // for weeks with no board card and never once show here as a problem.
        // Checks ALL THREE places an event id can live. Checking only
        // jobs.calendar_event_id (as this did) reports events as orphans when
        // they are linked via scheduled_event_id or a job_assignments row —
        // inflating the "will not bill" count with work that IS tracked.
        const linkedJob = await resolveJobForEvent(event.id);

        if (linkedJob) {
          results.synced++;
        } else if (!isOrphanIgnored(event.id)) {
          // No guess is offered. The reviewer picks the customer.
          results.orphans.push({ event, calendar: cal, possibleDuplicate: null });
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
