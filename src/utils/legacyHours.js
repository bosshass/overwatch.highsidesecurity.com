// ============================================
// src/utils/legacyHours.js
// ============================================
// Reading billable hours out of pre-Overwatch calendar descriptions.
//
// Before Overwatch there was no time entry. A tech wrote what they did into
// the Google Calendar description and put the hours at the bottom by hand.
// Three years of work — back to February 2023 — is recorded that way and
// nowhere else.
//
// THE CALENDAR BLOCK IS NOT THE HOURS. This is the whole reason this file
// exists. One week of July 2025 makes it plain:
//
//     Invoice 8104 Ace Hardware   2.0 hr block   description says 1/1
//     Invoice 8103 Boys & Girls   1.0 hr block   description says 3/2
//     Invoice 8114 M&P Day 2      5.0 hr block   description says "10hr 15 min"
//
// Backfilling from block durations would have produced a confident, wrong
// number on every one of those.
//
// THREE NOTATIONS, in the order they are trusted:
//
//   1. H/T on its own line — hours over techs, ONE LINE PER TRIP.
//      Invoice 8102 Kirk Eye Center carries two "1/1" lines because it was
//      two trips: Austin on 7/28, JR returning on 7/30. The trips are the
//      lines; the denominator is how many techs stood there.
//      "3/2" is three hours with two techs on site — SIX man-hours.
//
//   2. On site: / Offsite: — a clock pair, parsed by utils/clock.js so the
//      am/pm handling matches what the live app does.
//
//   3. Free text at the end — "10hr 15 min", "1.5 hrs".
//
// A trip with none of the three is a one-hour, one-tech charge. That is the
// standing rule for a trip that happened, not an invention by this parser —
// but it is returned with method 'default' so it can never be mistaken for
// something a tech actually wrote.

import { resolveSpan } from './clock.js';

// A tech count above this is not a crew, it is a misparse — which is exactly
// what saves us from reading the "7/28" in "NEED TO BILL FOR THIS TRIP 7/28"
// as seven hours with twenty-eight techs.
const MAX_TECHS = 6;
const MAX_HOURS = 16;

const DEFAULT_TRIP = { hours: 1, techs: 1 };

// ── 1. H/T lines ──────────────────────────────────────────────────────
// The line must be ONLY the token. Dates and measurements live inside
// sentences ("13.5/216" on the Pavilions inspection, "7/28" mid-note), so
// requiring the whole line to be the number is what keeps them out.
function readRatioLines(text) {
  const trips = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/[.,;]+$/, '');
    const m = line.match(/^(\d{1,2}(?:\.\d{1,2})?)\s*\/\s*(\d{1,2})$/);
    if (!m) continue;
    const hours = parseFloat(m[1]);
    const techs = parseInt(m[2], 10);
    if (!(hours > 0) || hours > MAX_HOURS) continue;
    if (!(techs > 0) || techs > MAX_TECHS) continue;
    trips.push({ hours, techs });
  }
  return trips;
}

// ── 2. On site: / Offsite: ────────────────────────────────────────────
// Seen in the wild as "On site: 2:00", "Time on site:", "Offsite: 10am",
// "Time off site:", "on site 11 AM".
const ON_SITE  = /(?:time\s*)?on[-\s]?site\s*:?\s*([0-9][0-9:.\sapm]*)/i;
const OFF_SITE = /(?:time\s*)?off[-\s]?site\s*:?\s*([0-9][0-9:.\sapm]*)/i;

function readClockPair(text, baseDate) {
  const a = text.match(ON_SITE);
  const b = text.match(OFF_SITE);
  if (!a || !b) return null;
  const span = resolveSpan(a[1].trim(), b[1].trim(), baseDate || new Date());
  if (!span) return null;
  const hours = span.ms / 3600000;
  if (!(hours > 0) || hours > MAX_HOURS) return null;
  return { hours: Math.round(hours * 100) / 100, techs: 1 };
}

// ── 3. free text totals ───────────────────────────────────────────────
// "10hr 15 min", "1.5 hrs", "45 min", "2 hours"
const FREE_HM   = /(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\s*(\d{1,2})\s*(?:m|min|mins|minutes)/i;
const FREE_H    = /(\d{1,2}(?:\.\d{1,2})?)\s*(?:h|hr|hrs|hour|hours)\b/i;
const FREE_M    = /(\d{1,3})\s*(?:min|mins|minutes)\b/i;

function readFreeText(text) {
  let m = text.match(FREE_HM);
  if (m) {
    const hours = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
    if (hours > 0 && hours <= MAX_HOURS) return { hours: Math.round(hours * 100) / 100, techs: 1 };
  }
  m = text.match(FREE_H);
  if (m) {
    const hours = parseFloat(m[1]);
    if (hours > 0 && hours <= MAX_HOURS) return { hours, techs: 1 };
  }
  m = text.match(FREE_M);
  if (m) {
    const hours = parseInt(m[1], 10) / 60;
    if (hours > 0 && hours <= MAX_HOURS) return { hours: Math.round(hours * 100) / 100, techs: 1 };
  }
  return null;
}

// Calendar descriptions are sometimes HTML (Google stores whatever was pasted).
function toPlainText(description) {
  return String(description || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/**
 * Pull the billable hours out of one legacy calendar event.
 *
 * @param {string} description  the Google Calendar description, HTML or plain
 * @param {Date|string} eventDate  the event's start, for resolving clock times
 * @returns {{
 *   trips:      Array<{hours:number, techs:number}>,
 *   hours:      number,   // hours ON SITE, summed across trips
 *   manHours:   number,   // hours x techs, summed — what gets billed
 *   method:     'ratio'|'clock'|'freetext'|'default',
 *   confident:  boolean   // false means nothing was written down
 * }}
 */
export function extractLegacyHours(description, eventDate) {
  const text = toPlainText(description);

  const ratio = readRatioLines(text);
  if (ratio.length) return summarize(ratio, 'ratio', true);

  const clock = readClockPair(text, eventDate);
  if (clock) return summarize([clock], 'clock', true);

  const free = readFreeText(text);
  if (free) return summarize([free], 'freetext', true);

  // Nothing written. A trip that happened is a one-hour, one-tech charge.
  return summarize([DEFAULT_TRIP], 'default', false);
}

function summarize(trips, method, confident) {
  const hours    = trips.reduce((n, t) => n + t.hours, 0);
  const manHours = trips.reduce((n, t) => n + t.hours * t.techs, 0);
  return {
    trips,
    hours:    Math.round(hours * 100) / 100,
    manHours: Math.round(manHours * 100) / 100,
    method,
    confident,
  };
}
