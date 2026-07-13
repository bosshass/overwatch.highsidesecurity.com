// ============================================
// Archive reasons — and why the class matters
// ============================================
// A visit can fail to be billed for two COMPLETELY different reasons, and
// collapsing them destroys the profitability picture:
//
//   NOT_REAL  — it never happened. Test entry, duplicate, data mistake.
//               No truck rolled. No tech spent an hour. It should vanish from
//               BOTH sides of the ledger: zero revenue, zero cost.
//
//   ABSORBED  — it happened and DRH ate it. Warranty callback, rework we
//               caused, goodwill for a client. The truck rolled. A tech's
//               hours went in. That is REAL COST with ZERO REVENUE — the
//               single most important number on a profitability dashboard,
//               because it is invisible everywhere else.
//
// If an absorbed visit gets archived as 'test', its cost disappears and the
// dashboard reports a customer as profitable when DRH actually lost money on
// them. That mistake is unrecoverable after the fact — nobody remembers in
// six months. So the class is captured AT ARCHIVE TIME, deliberately.

export const ARCHIVE_REASONS = [
  // ── Never happened — excluded from revenue AND cost ──────────────
  { key: 'test',         cls: 'not_real', label: 'Test entry',            hint: 'Not real work. Excluded from everything.' },
  { key: 'duplicate',    cls: 'not_real', label: 'Duplicate',             hint: 'Same visit recorded twice.' },
  { key: 'mistake',      cls: 'not_real', label: 'Data mistake',          hint: 'Logged in error — wrong customer, bad clock-out.' },

  // ── Happened, we ate it — REAL COST, ZERO REVENUE ────────────────
  { key: 'warranty',     cls: 'absorbed', label: 'Warranty / callback',   hint: 'We went back under warranty. Real cost, no revenue.' },
  { key: 'rework',       cls: 'absorbed', label: 'Rework — our fault',    hint: 'We had to fix our own work. Real cost, no revenue.' },
  { key: 'goodwill',     cls: 'absorbed', label: 'Goodwill / no charge',  hint: 'We chose not to bill. Real cost, no revenue.' },
  { key: 'contract',     cls: 'absorbed', label: 'Covered by contract',   hint: 'Inside a monitoring/service agreement.' },
];

export const REASON_BY_KEY = Object.fromEntries(ARCHIVE_REASONS.map(r => [r.key, r]));

// Did a truck actually roll? Drives the cost side of profitability.
export function isRealCost(reason) {
  return REASON_BY_KEY[reason]?.cls === 'absorbed';
}

export function reasonLabel(reason) {
  return REASON_BY_KEY[reason]?.label || reason || 'archived';
}

export function reasonColor(reason) {
  const c = REASON_BY_KEY[reason]?.cls;
  if (c === 'absorbed') return '#f59e0b';   // amber — this cost you money
  if (c === 'not_real') return '#64748b';   // grey — never happened
  return '#64748b';
}
