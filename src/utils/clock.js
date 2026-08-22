// ============================================
// src/utils/clock.js
// ============================================
// Reading a clock time off free text, in one place.
//
// This logic used to live inside TimeEntryBlock.jsx, where it read a bare
// "1:30" as 01:30 and then rescued the resulting negative span with a blind
// +24h. Crystal Osthoff, 12:00 in and 1:00 out — a one-hour call — stored 13
// hours. It is here now because the legacy calendar backfill has to read the
// SAME kind of free text ("On site: 2:00 / Offsite: 3:00") out of descriptions
// techs typed by hand for three years. Two copies of this would have meant
// fixing the bug once and shipping it again somewhere else.

export const DAY_MS      = 24 * 60 * 60 * 1000;
export const HALF_DAY_MS = 12 * 60 * 60 * 1000;
// Nothing on these calendars starts before 6am. A bare hour below it is the
// afternoon — a tech does not begin a residential service call at 1am.
export const WORK_START_HOUR = 6;
// Longer than this and something was mistyped, not worked.
export const MAX_PLAUSIBLE_MINUTES = 16 * 60;

// Accepts: 9:30 · 9:30am · 9:30 AM · 9:30a · 930 · 9am · 9p · 13:30
// Returns { h, min, explicit } where h is 24-hour and `explicit` says the
// writer actually told us which half of the day they meant.
export function parseClockParts(clock) {
  if (!clock) return null;
  const s = String(clock).trim().toLowerCase().replace(/[\s.]/g, '');
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?([ap]m?)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] == null ? 0 : parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  const mer = m[3] ? m[3][0] : null;      // 'a' | 'p' | null

  if (mer) {
    if (h > 12) return null;              // "13pm" is not a time
    if (mer === 'p' && h !== 12) h += 12;
    if (mer === 'a' && h === 12) h = 0;
    return { h, min, explicit: true };
  }
  // 13:00 and up can only be a 24-hour clock — already unambiguous.
  if (h > 12) return { h, min, explicit: true };
  // Bare hour. Below the workday start it is the afternoon; 12 stays noon.
  const h24 = (h < WORK_START_HOUR) ? h + 12 : h;
  return { h: h24, min, explicit: false };
}

export function parseClockOnDate(clock, baseDate) {
  const p = parseClockParts(clock);
  if (!p) return null;
  const d = new Date(baseDate);
  d.setHours(p.h, p.min, 0, 0);
  return d;
}

// Resolve a clock-in / clock-out pair into a real span.
export function resolveSpan(timeIn, timeOut, baseDate) {
  const pin  = parseClockParts(timeIn);
  const pout = parseClockParts(timeOut);
  if (!pin || !pout) return null;
  const at = (p) => { const d = new Date(baseDate || new Date()); d.setHours(p.h, p.min, 0, 0); return d; };

  const inD = at(pin);
  let outD  = at(pout);
  let diff  = outD - inD;

  // Out lands before in. If no am/pm was given on the clock-out, the other
  // half of the day was meant — 9:30 to 5:00 is seven and a half hours, not
  // nineteen and a half.
  if (diff <= 0 && !pout.explicit) {
    outD = new Date(outD.getTime() + HALF_DAY_MS);
    diff = outD - inD;
  }
  // Still backwards with an explicit meridiem: a real overnight job.
  if (diff <= 0) {
    outD = new Date(outD.getTime() + DAY_MS);
    diff = outD - inD;
  }
  return { in: inD, out: outD, ms: diff };
}
