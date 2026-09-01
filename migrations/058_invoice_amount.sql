-- 058 — invoice_amount on time_entries
--
-- "I want a dollars field" — the dollar value of the invoice that covers these
-- hours. Stamped when billing marks the entry billed, alongside invoice_ref.
-- Kept as numeric(12,2) so QuickBooks-style amounts survive a round-trip
-- without float weirdness.
--
-- THIS IS A UI RECORD, NOT AN ACCOUNTING SYSTEM.
-- Overwatch is not QuickBooks. This number is "the amount JR typed when he
-- clicked Mark Billed" — useful for reconciliation, not a source of truth for
-- revenue. QuickBooks is that. Two numbers existing for the same invoice is
-- fine as long as nobody pretends one overrides the other; this one belongs to
-- Overwatch and QuickBooks owns its own.

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS invoice_amount numeric(12,2);

COMMENT ON COLUMN time_entries.invoice_amount IS
  'Dollar amount of the invoice that covers this entry. Set alongside invoice_ref when billing marks the entry billed. Informational — QuickBooks is the authoritative ledger.';
