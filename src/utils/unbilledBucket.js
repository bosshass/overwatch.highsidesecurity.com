// Pure (no supabase import) so the bucket rules can be unit-tested in node.
// Re-exported from jobResolve.js; callers are unchanged.
import { isNotReal } from '../config/archiveReasons.js';

// Why an hour isn't billable yet. Shared by the Unbilled screen and the home
// tile so the two can never report different numbers again.
//
// PRECEDENCE — this is the whole fix. The ENTRY is the thing that gets
// invoiced, so the entry's own fields outrank the job's status. Reading
// job.status first is what put 164 already-invoiced visits in "To bill", and
// what dropped sales calls into "Worked, then killed".
//
//   1. resolved_at        settled. Not a bucket — the caller should filter it
//                         out entirely before getting here.
//   2. billed/invoice_ref an invoice exists. Nothing else can outrank that.
//   3. billable === false covered by a contract, never separately invoiced.
//                         Label comes from non_billable_reason ("project hours").
//   4. archived           real cost DRH absorbed; archive_reason says why.
//   5. disposition        what the tech said in the field.
//   6. job.status         last resort, and only when the entry says nothing.
export function unbilledBucket(job, entry = null) {
  if (entry) {
    if (entry.resolved_at)                      return 'resolved';
    if (entry.billed || entry.invoice_ref)      return 'billed';
    if (entry.billable === false)               return 'project';
    // ── ARCHIVED IS TWO DIFFERENT THINGS ────────────────────────────────
    // This returned 'absorbed' for EVERY archived entry, which put test rows,
    // duplicates and data mistakes into the Absorbed cost bucket — a bucket
    // whose whole purpose is "real cost DRH ate." So marking something as test
    // data moved it one bucket sideways and it never left the screen.
    //
    // config/archiveReasons.js has always drawn the line and says why: a
    // not_real visit never happened — no truck rolled, no hours were spent —
    // and "it should vanish from BOTH sides of the ledger." Absorbed is the
    // opposite and must stay visible, which is the part that is working.
    if (entry.archived)
      return isNotReal(entry.archive_reason) ? 'not_real' : 'absorbed';
    // ── THE CONTRACT ALREADY SAID SO ────────────────────────────────────
    // `billable === false` above is the manual flag, and it has NEVER been
    // written: zero of 74 entries carry it, because nothing in the app could
    // set it. So the Project hours bucket has always been empty while
    // fixed-fee hours sat in Ready to bill looking invoiceable — 28 hours of
    // Jeanneret against an $1,881 fixed price, on a job already marked
    // is_fixed_fee.
    //
    // If the JOB is fixed-fee, its hours are cost against that price. That is
    // not a per-entry judgement anybody should have to make twelve times; the
    // decision was made once, on the job, when the price was agreed. Derive it.
    //
    // Below `billed` and `billable === false` deliberately: an invoice that
    // exists outranks everything, and an explicit human flag outranks a
    // derivation. Above `disposition`, because "bill it" from a tech means the
    // WORK is done — it was never a claim about how the job was sold.
    if (job?.is_fixed_fee)                      return 'project';
    // ── MERGED-IN HOURS FOLLOW THE CARD THEY LANDED ON ──────────────────
    // "The hours need to behave just like the status of the card that
    // they're being merged into." A tech's "bill it" on a card that was then
    // merged into a return card is now part of that return — so it waits with
    // the return, and goes ready when that card goes to To Bill / Complete.
    // Skip the disposition rules below and bucket by the card's status.
    if (entry.merged_from_job_id && job)        return jobStatusBucket(job);
    if (entry.disposition === 'estimate')       return 'sales';
    if (entry.disposition === 'in_progress')    return 'progress';
    // An entry parked as 'return' (waiting for a return visit) stays in the
    // return bucket UNLESS the linked job has since moved to to_bill or complete
    // — meaning the return trip happened and all hours for this job are now
    // ready to invoice together. Let the job status pull them back.
    if (entry.disposition === 'return') {
      const s = job?.status;
      return (s === 'to_bill' || s === 'complete') ? 'ready' : 'return';
    }
    // 'bill_it' HAD NO CASE. Four dispositions, three branches — so an entry the
    // tech marked "bill it" fell through to the job-status block below and was
    // bucketed by whatever the CARD said. A bill_it entry on a job still sitting
    // in 'scheduled' came back 'progress': not finished, not billable yet. That
    // contradicts the precedence this whole function exists to enforce — the
    // ENTRY is the thing that gets invoiced, so it outranks the job.
    //
    // The tech said the work is done and chargeable. Nothing above this line
    // disagreed (not resolved, not billed, not written off, not archived), so
    // it is ready. The job's status is not a second opinion.
    if (entry.disposition === 'bill_it')        return 'ready';
    // A WASTED TRIP IS STILL A TRIP. It gets its own bucket rather than
    // 'ready': the work was NOT done, so filing it with finished work would
    // have the office invoicing for a repair nobody made. And it must not fall
    // into 'nohours' either — a blocked visit legitimately has almost no
    // clocked time, so "nobody logged hours" would read as a data error when
    // it is the correct and expected shape of the thing.
    if (entry.disposition === 'blocked')        return 'trip';
  }
  if (!job) return 'nojob';
  return jobStatusBucket(job);
}

function jobStatusBucket(job) {
  const s = job.status;
  if (s === 'complete' || s === 'to_bill') return 'ready';
  if (s === 'return_pending') return 'return';
  if (s === 'billed') return 'mismatch';
  if (['dead', 'lost', 'archived'].includes(s)) return 'dead';
  return 'progress';
}
