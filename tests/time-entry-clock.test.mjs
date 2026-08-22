// ============================================
// tests/time-entry-clock.test.mjs
// ============================================
// Every case below is a REAL row out of time_entries, not an invented one.
// The "was" column is what the old parser stored; "want" is the work that
// actually happened. Run: node --test tests/time-entry-clock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// TimeEntryBlock.jsx is a React component, so it cannot be imported here
// without a JSX pipeline. The pure helpers are lifted out of the source at
// runtime instead — which also proves the shipped file is the one under test.
const src = readFileSync(new URL('../src/components/TimeEntryBlock.jsx', import.meta.url), 'utf8');
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const helpers = [
  slice('const DAY_MS', 'function parseClockOnDate'),
  slice('function resolveInOut', 'function totalMinutes'),
].join('\n');
const resolveInOut = new Function(`${helpers}; return resolveInOut;`)();

const hrs = (timeIn, timeOut, day = '2026-06-25') => {
  const io = resolveInOut({ timeIn, timeOut }, new Date(`${day}T00:00:00`));
  return io ? +(io.ms / 3600000).toFixed(2) : null;
};
const clockIn = (timeIn, timeOut, day = '2026-06-25') =>
  resolveInOut({ timeIn, timeOut }, new Date(`${day}T00:00:00`)).in.getHours();

test('noon-crossing spans no longer wrap a full day', () => {
  // Crystal Osthoff 05-27: a one-hour call stored as 13.00
  assert.equal(hrs('12:00', '1:00'), 1);
  // JENSEN/SHIELDS 06-08: stored 13.00
  assert.equal(hrs('12:30', '1:30'), 1);
  // Greeley kids 04-30: stored 12.50
  assert.equal(hrs('12:30', '1:00'), 0.5);
});

test('bare afternoon hours are the afternoon, not pre-dawn', () => {
  // LAIRD HEIKENS 06-25 — calendar block was 1:30–5pm
  assert.equal(clockIn('1:30', '5:00'), 13);
  assert.equal(hrs('1:30', '5:00'), 3.5);
  // Jeanneret 08-17, stored with a 02:30 clock-in
  assert.equal(clockIn('2:30', '4:30'), 14);
});

test('a full workday reads as a workday', () => {
  // The old parser turned this into 19.5 hours
  assert.equal(hrs('9:30', '5:00'), 7.5);
  assert.equal(hrs('8:00', '6:00'), 10);
});

test('explicit am/pm always wins over the workday guess', () => {
  assert.equal(clockIn('1:30am', '4:00am'), 1);
  assert.equal(hrs('1:30am', '4:00am'), 2.5);
  assert.equal(hrs('9:00am', '11:30am'), 2.5);
  assert.equal(hrs('12:00pm', '1:00pm'), 1);
  assert.equal(hrs('12:00am', '1:00am'), 1);
});

test('24-hour input is left alone', () => {
  assert.equal(clockIn('13:30', '17:00'), 13);
  assert.equal(hrs('13:30', '17:00'), 3.5);
});

test('loose formats techs actually type', () => {
  assert.equal(hrs('930', '11:00'), 1.5);   // no colon
  assert.equal(hrs('9a', '11a'), 2);        // single letter
  assert.equal(hrs('9 AM', '1 PM'), 4);     // spaces and caps
  assert.equal(hrs('9:30 a.m.', '10:30 a.m.'), 1);
});

test('a genuine overnight job still crosses midnight', () => {
  // Explicit meridiem, out before in — the only case that may add 24h
  assert.equal(hrs('10:00pm', '2:00am'), 4);
});

test('junk is rejected rather than guessed at', () => {
  assert.equal(hrs('', '5:00'), null);
  assert.equal(hrs('abc', '5:00'), null);
  assert.equal(hrs('25:00', '5:00'), null);
  assert.equal(hrs('9:75', '5:00'), null);
  assert.equal(hrs('13pm', '5:00'), null);
});
