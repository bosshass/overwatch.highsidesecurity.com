// node --test tests/merge-union.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurvivorPatch, mergedIntoId, unwrapCarriedNote } from '../src/utils/mergeUnion.js';

// The case that started this: the RETURN card gets merged INTO the scheduled
// card by accident. The return card is "newer" — that must not drop anything.
test('return card merged into scheduled card keeps everything', () => {
  const scheduled = { status: 'scheduled', customer_phone: '555', materials_used: '2 sensors', actual_hours: 1.5, calendar_event_id: 'evS' };
  const ret = { status: 'return_pending', created_at: '2026-09-20T12:00:00Z', customer_phone: '999', materials_used: '1 keypad',
    return_reason: 'swap keypad', actual_hours: 2, calendar_event_id: 'evR', invoice_number: 'INV-77' };
  const { patch, record } = buildSurvivorPatch(ret, scheduled);
  assert.equal(patch.customer_phone, undefined, 'survivor contact is not overwritten');
  assert.match(patch.materials_used, /2 sensors[\s\S]*1 keypad/, 'both materials kept');
  assert.equal(patch.return_reason, 'swap keypad');
  assert.equal(patch.actual_hours, 3.5, 'hours are added, not dropped');
  assert.ok(record.includes('calendar_event_id: evR'));
  assert.ok(record.includes('invoice_number: INV-77'), 'billing ref recorded, never overwritten');
});

test('blanks are filled, identical text not duplicated', () => {
  const { patch } = buildSurvivorPatch({ gate_code: '1234', parts: 'x' }, { gate_code: '', parts: 'x' });
  assert.equal(patch.gate_code, '1234');
  assert.equal(patch.parts, undefined);
});

test('merge chains are followed only from dead cards', () => {
  const id = '1f68dc01-14c7-4268-b981-cd9b502b1467';
  assert.equal(mergedIntoId({ status: 'dead', action_note: `Merged into job ${id}` }), id);
  assert.equal(mergedIntoId({ status: 'archived', action_note: `Merged into job ${id}` }), id, 'merged cards are archived now');
  assert.equal(mergedIntoId({ status: 'scheduled', action_note: `Merged into job ${id}` }), null);
});

test('carried notes unwrap to their real text for the board snippet', () => {
  assert.equal(unwrapCarriedNote('↪ from merged job (Sep 20, 2026): tech found bad keypad'), 'tech found bad keypad');
  assert.equal(unwrapCarriedNote('plain note'), 'plain note');
});

// Merged-in hours behave like the status of the card they landed on.
import { unbilledBucket } from '../src/utils/unbilledBucket.js';
test('merged-in hours follow the surviving card status, not their old disposition', () => {
  const billIt = { disposition: 'bill_it', merged_from_job_id: 'x' };
  assert.equal(unbilledBucket({ status: 'return_pending' }, billIt), 'return', 'bill-it hour merged into a return waits with the return');
  assert.equal(unbilledBucket({ status: 'to_bill' }, { disposition: 'return', merged_from_job_id: 'x' }), 'ready');
  assert.equal(unbilledBucket({ status: 'needs_estimate' }, billIt), 'progress');
  // An hour that never moved still goes by the tech's disposition.
  assert.equal(unbilledBucket({ status: 'return_pending' }, { disposition: 'bill_it' }), 'ready');
  // Billed / written-off still outrank everything.
  assert.equal(unbilledBucket({ status: 'return_pending' }, { ...billIt, billed: true }), 'billed');
});
