// ============================================
// tests/legacy-hours.test.mjs
// ============================================
// Every description below is copied verbatim off a real Google Calendar event
// on DRH Tech 1 Austin. Nothing here is invented.
// Run: node --test tests/legacy-hours.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLegacyHours } from '../src/utils/legacyHours.js';

const JUL30 = new Date('2025-07-30T00:00:00');

test('Invoice 8102 Kirk Eye Center — two trips, one line each', () => {
  // The event Sara pasted. Austin 7/28, JR returning 7/30; the description
  // accumulated both trips' notes and both hour lines.
  const d = `Error message on panel, no timer tests on CMS 6910015- NEED TO BILL FOR THIS TRIP 7/28

Need return trip by JR

(970) 214-7481
Kerry McKilllup- Sara LM 7/29

Radio installed by Trident- need to contact Comcast to get another line- Land it on the 66 block- once done call us back
1/1
1/1`;
  const r = extractLegacyHours(d, JUL30);
  assert.equal(r.method, 'ratio');
  assert.equal(r.trips.length, 2, 'two trips, one per 1/1 line');
  assert.equal(r.hours, 2);
  assert.equal(r.manHours, 2);
  assert.equal(r.confident, true);
});

test('the 7/28 inside the note is not read as 7 hours over 28 techs', () => {
  const r = extractLegacyHours('NEED TO BILL FOR THIS TRIP 7/28\n\nNeed return trip by JR', JUL30);
  assert.equal(r.method, 'default');
  assert.equal(r.hours, 1);
});

test('Invoice 8103 Boys & Girls — 3/2 is three hours with two techs', () => {
  const d = `Pushbar- "Panic bar" issues

Ribbon issue- advise Protzman to contact the installer regarding Ribbon and poor install. 

Brock- 

3/2`;
  const r = extractLegacyHours(d, JUL30);
  assert.equal(r.hours, 3, 'three hours on site');
  assert.equal(r.manHours, 6, 'two techs — six man-hours');
  assert.deepEqual(r.trips, [{ hours: 3, techs: 2 }]);
});

test('Invoice 8104 Ace Hardware — 1/1 on a two-hour block', () => {
  const d = `Troubleshoot monitor and warehouse system. 

NOTES: Trouble shot and brought remote access back online.  Confirmed the Warehouse system is up and recording.  Confirmed ethernet bridge is up and running and system has connection to the internet. Re-established connection to the front counter ceiling monitor.  Systems up and running. 

1/1`;
  const r = extractLegacyHours(d, new Date('2025-07-31T00:00:00'));
  assert.equal(r.hours, 1, 'the block was 2.0 hrs — the note says 1');
  assert.equal(r.manHours, 1);
});

test('Invoice 8114 Mountain & Plains Day 2 — free text beats the 5-hour block', () => {
  const d = `2nd Trip- We HAVE to make sure that the three units can arm and disarm independently. 

When we left today, all three were trying to arm at one time.

10hr 15 min`;
  const r = extractLegacyHours(d, JUL30);
  assert.equal(r.method, 'freetext');
  assert.equal(r.hours, 10.25);
});

test('Invoice 8078 Stan’s Auto — on site / offsite clock pair', () => {
  const d = `Camera system remote access down.

On site: 2:00
Offsite: 3:00
1/1

Remote access down. New IT company changed a setting needed updates made`;
  const r = extractLegacyHours(d, new Date('2025-06-30T00:00:00'));
  // The explicit ratio line wins, and both readings agree at one hour.
  assert.equal(r.method, 'ratio');
  assert.equal(r.hours, 1);
});

test('Estimate 5602 Bryan construction — clock pair with no ratio line', () => {
  const d = `Building C Madelyn is the contact on site.

Magnet lock delay issue, and when she updates employees, it's giving her a hard time.

On site: 9:20 AM
Offsite: 10am 

Notes: order new mag lock and submit estimate for new alula system

3 keypads 
11 zones / 4 motions.`;
  const r = extractLegacyHours(d, new Date('2025-07-09T00:00:00'));
  assert.equal(r.method, 'clock');
  assert.equal(r.hours, 0.67, '9:20 to 10:00 is forty minutes');
  // "11 zones / 4 motions." must not be read as eleven hours over four techs
  assert.equal(r.trips.length, 1);
});

test('Invoice 8398 Pavilions — inspection readings are not hours', () => {
  const d = `6910617 Building P 1: 13.5/216 2: 13.9/208
6910618 Building 0 13.4/78
6910619 Buildings A-K 13.7/172`;
  const r = extractLegacyHours(d, JUL30);
  assert.equal(r.method, 'default', 'voltage/resistance readings are mid-line, not hour lines');
});

test('Invoice 8099 Timothy Kruger — numbered findings are not hours', () => {
  const d = `Complete install.

1- The bedroom keypad is too far and won't connect to panel.
 2- The carbon monoxide and Temperature sensor in the bedroom both showed open when I added them to the zone list.`;
  const r = extractLegacyHours(d, JUL30);
  assert.equal(r.method, 'default');
  assert.equal(r.confident, false);
});

test('a trip with nothing written is one hour, one tech, and says so', () => {
  const r = extractLegacyHours('', JUL30);
  assert.equal(r.hours, 1);
  assert.equal(r.manHours, 1);
  assert.equal(r.method, 'default');
  assert.equal(r.confident, false, 'never passes as something a tech wrote');
});

test('HTML descriptions are read like plain ones', () => {
  const d = 'Ribbon issue- advise Protzman.<br><br>Brock- <br><br>3/2';
  const r = extractLegacyHours(d, JUL30);
  assert.equal(r.hours, 3);
  assert.equal(r.manHours, 6);
});

test('implausible values are rejected rather than imported', () => {
  assert.equal(extractLegacyHours('99/1', JUL30).method, 'default');   // 99 hours
  assert.equal(extractLegacyHours('3/40', JUL30).method, 'default');   // 40 techs
  assert.equal(extractLegacyHours('0/1', JUL30).method, 'default');    // zero hours
});
