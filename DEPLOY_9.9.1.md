# 9.9.1 — Bidirectional status moves (the billing bounce-back)

## The primitive, piece 1 of the JR-loop rebuild
Adds MoveStatus.jsx — a control on every job detail + billing card that moves a
job to any APPROPRIATE status, forward OR backward, with the note traveling in
job_history. No migration: uses jobsApi.changeStatus (already direction-agnostic)
and job_history (already the note thread).

### What it unlocks
- Billing opens a To Bill card, reads the thread, realizes it isn't billable,
  and hits "↩ Send back to Scheduling" — a note is REQUIRED on backward moves,
  so Shana sees exactly why it bounced. Card lands in Ready to Schedule.
- Any role can move a card from any screen. Backward/bounce moves force a note;
  forward moves make the note optional.

### Files (3, no migration)
- src/components/MoveStatus.jsx  (new)
- src/components/JobDetail.jsx   (renders MoveStatus above NotesPanel)
- src/views/Billing.jsx          (renders MoveStatus on billing cards)

### Deploy
Unzip over repo → commit → push. Verify /version.json = 9.9.1.
Test: open any job detail → "Move" row appears with valid targets. On a To Bill
card in Billing, "↩ Send back to Scheduling" requires a note, then the card
leaves the billing queue and appears in Ready to Schedule with the note on top.

### NOTE — production is currently reverted to 9.8.3.
This builds cleanly on 9.8.3. It does NOT include the earlier 9.9.0 no-notes
feature (that was reverted). This is a fresh, smaller, migration-free increment.
