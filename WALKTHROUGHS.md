# OVERWATCH — PUSH WALKTHROUGHS

**No code push ships without walking the lifecycle it touches, end to end.**

Standing rule, set 2026-08-20. Not a smoke test — the full round trip, creation to
completion, including the steps nobody remembers to check.

---

## WHO DOES WHAT

The app requires a Google sign-in, so I cannot click through it. The database I can read
directly. That splits the work cleanly:

| | |
|---|---|
| **You** | Every UI action below. Sign in, tap the thing, say what you saw. |
| **Me** | Every `VERIFY` block. I run it against the live database and report pass/fail before anything reaches `main`. |
| **Me** | `npm run verify` (0 errors), and the preview build. |

`npm` needs no authentication — the registry is public. **The only thing gated on you is
the browser.** If you would rather not click, say so and I will ship code that is
build-verified and DB-verified but not UI-verified, and label it that way.

---

## WALKTHROUGH 1 — NOTE → TASK → DONE → BACK TO THE REQUESTER

The lifecycle in the code today. Six states, and step 5 is the one that gets forgotten.

```
lane 'note'   status 'open'    no assignee          a note. nobody owns it.
    ↓ assign
lane 'todo'   status 'open'    assigned_to set      NOW IT IS A TASK
    ↓ assignee picks it up
lane 'doing'  status 'open'
    ↓ assignee finishes
lane 'done'   status 'open'    done_at, done_by     done, but NOT confirmed
    ↓ requester confirms                            ← THE ROUND TRIP
lane 'done'   status 'closed'                       finished
    or ↓ requester rejects  (sendBack)
lane 'doing'  done_at NULL, done_by NULL            back to the assignee
```

### 1.1 · Create a note

**Do:** `/notes` → type a note → save. Do not assign it.

**Expect:** appears in the notes list. Does **not** appear on the board.

```sql
-- VERIFY
SELECT lane, status, assigned_to, author_email, job_id, customer_id
FROM notes WHERE body = '<your text>' ORDER BY created_at DESC LIMIT 1;
-- PASS: lane='note', status='open', assigned_to IS NULL
-- FAIL: lane='todo' with no assignee — that is the orphan-task bug
```

### 1.2 · Note → task (assign it)

**Do:** assign the note to someone.

**Expect:** leaves your notes list, lands in their To Do. Their nav badge increments.

```sql
-- VERIFY
SELECT lane, status, assigned_to, assigned_by FROM notes WHERE id = '<id>';
-- PASS: lane='todo', assigned_to = them, assigned_by = you
-- assigned_by is the only record of who is owed an answer. It must not be null.
```

### 1.3 · Assignee marks it Doing

**Do:** sign in as the assignee → `/tasks` → mark Doing.

```sql
-- VERIFY
SELECT lane, status, done_at, done_by FROM notes WHERE id = '<id>';
-- PASS: lane='doing', done_at IS NULL
```

### 1.4 · Assignee responds and marks it Done

**Do:** answer, then mark Done.

**Expect:** leaves their active list. **Does not vanish** — it goes back to you to confirm.

```sql
-- VERIFY
SELECT lane, status, done_at, done_by FROM notes WHERE id = '<id>';
-- PASS: lane='done', status='open', done_at set, done_by = the assignee
-- FAIL: status already 'closed' — the round trip was skipped
```

### 1.5 · Requester confirms — THE ROUND TRIP

**Do:** back as the requester → confirm it.

This is `confirmClosed` at `TaskStack.jsx:256`. **It is the step most likely to be broken
by a refactor**, because it is the only one that runs as a different user than the one who
marked it done.

```sql
-- VERIFY
SELECT lane, status FROM notes WHERE id = '<id>';
-- PASS: lane='done', status='closed'
```

### 1.6 · Reject instead — send it back

**Do:** on a different done task, reject rather than confirm.

This is `sendBack` at `TaskStack.jsx:259`.

```sql
-- VERIFY
SELECT lane, status, done_at, done_by FROM notes WHERE id = '<id>';
-- PASS: lane='doing', done_at IS NULL, done_by IS NULL
-- Both must clear, or the next Done shows a stale timestamp.
```

### 1.7 · Return to the card

**Do:** if the task carried a `job_id`, open that card on the board.

**Expect:** the answer is visible on the card, under the `issue`.

```sql
-- VERIFY
SELECT n.body, n.status, n.job_id, j.customer_name, j.status AS job_status
FROM notes n JOIN jobs j ON j.id = n.job_id WHERE n.id = '<id>';
```

---

### ⚠ FOUND WHILE WRITING THIS — two words for done

`notes.status` has **three** values live, and the migration-028 constraint only ever
allowed two:

| value | rows | written by |
|---|---:|---|
| `open` | 31 | everywhere |
| `archived` | 79 | `People.jsx:178` · `Notes.jsx:247` |
| `closed` | 14 | `TaskStack.jsx:256` |

`archived` and `closed` are **the same end state reached by two different screens.** Your
model says tasks get *closed*. So `closed` is right and `archived` is the drift — 79 rows
of it.

This also means **step 1.5 behaves differently depending on which screen you finish from.**
Finish in TaskStack → `closed`. Finish in People or Notes → `archived`. Same intent, two
records, and any query filtering on one silently misses the other.

Not fixed here. Filed for Phase B alongside the status collapse.

---

## WALKTHROUGH 2 — READY → SCHEDULED → DISPOSITIONED → INVOICED

Every disposition, not just the happy one. Five branches, and one of them is broken today.

### 2.1 · Card reaches Ready

**Do:** move a card to Ready to Schedule.

```sql
-- VERIFY
SELECT j.status, j.tentative_date, j.tentative_event_id,
       (SELECT count(*) FROM notes n
         WHERE n.job_id = j.id AND n.assigned_to = 'shanaparks@drhsecurityservices.com'
           AND n.status = 'open') AS scheduling_task
FROM jobs j WHERE j.id = '<job id>';
-- PASS: status='ready_to_schedule', tentative_* NULL, scheduling_task = 1
-- The auto-task is the point. A column is not an owner.
-- Bounce it out and back: scheduling_task must still be 1, never 2.
```

### 2.2 · Book it

**Do:** schedule it to a tech with a real time.

**Expect:** the event appears on that tech's Google calendar.

```sql
-- VERIFY
SELECT status, scheduled_date, scheduled_event_id, scheduled_calendar_id,
       tech_assigned, tech_name, assigned_to, tentative_date, tentative_event_id
FROM jobs WHERE id = '<job id>';
-- PASS: status='scheduled' AND all three of scheduled_date,
--       scheduled_event_id, scheduled_calendar_id are set.
-- FAIL: any one of them null. That is the "said scheduled, had no event" bug,
--       and it is the single most important assertion in this document.
-- ALSO: assigned_to must be NULL. Booking settles ownership.
```

### 2.3 · Reschedule it

**Do:** move it to a different day or tech.

**Expect:** the **old event is gone** from the calendar. Exactly one event exists.

```sql
-- VERIFY
SELECT scheduled_event_id, scheduled_calendar_id, scheduled_date FROM jobs WHERE id='<job id>';
-- PASS: scheduled_event_id is a NEW value, and the old id is not on any calendar.
-- FAIL: two events on the calendar — the duplicate-event bug.
```

### 2.4 · Disposition — walk all five

For each: open the visit in `/work` or `/calendar`, pick the disposition, submit.

| Pick | disposition | Job goes to | Also writes |
|---|---|---|---|
| Done — To Bill | `bill_it` | `to_bill` | — |
| Return Visit | `return` | `return_pending` | a `return_cards` row; reason required |
| Still Scheduled | `in_progress` | `scheduled` | stays open |
| Estimates | `estimate` | `needs_estimate` | — |
| New / Notes | `blocked` | `blocked` | **BROKEN — see below** |

```sql
-- VERIFY, after each one
SELECT te.disposition, te.job_id, te.tech_email, te.total_minutes,
       te.billable, te.non_billable_reason, j.status AS job_status
FROM time_entries te LEFT JOIN jobs j ON j.id = te.job_id
WHERE te.calendar_event_id = '<event id>';
-- PASS: exactly ONE row per tech, job_id NOT NULL, job_status per the table above
-- FAIL: job_id NULL — the entry landed unlinked, which is the 62% bug
-- FAIL: two rows for one tech — duplicate disposition
-- FAIL: billable IS FALSE — nothing should write that any more (migration 046)
```

**After A2 ships, also assert the calendar title is UNCHANGED.** No `[BILL IT]`, no
`[RETURN]`. The field notes should still be appended to the event *description*.

**`blocked` is broken today** — the tag map has no entry so the title becomes
"Customer Name undefined", then the insert fails the CHECK constraint and the job never
moves. A2 and A3 fix it. Until then, expect this branch to fail; that is the known state,
not a regression.

### 2.5 · Return visit round trip

**Do:** on the `return` card, link it to a job, then schedule the return.

```sql
-- VERIFY
SELECT rc.status, rc.job_id, rc.new_event_id, rc.time_entry_id,
       te.job_id AS entry_job_id
FROM return_cards rc LEFT JOIN time_entries te ON te.id = rc.time_entry_id
WHERE rc.id = '<card id>';
-- PASS after linking: rc.job_id set AND te.job_id = rc.job_id
--   (a DB trigger propagates it — if the entry did not follow, the trigger is gone)
-- PASS after scheduling: status='scheduled', new_event_id set
```

### 2.6 · Bill it

**Do:** `/unbilled` → select the visit → mark billed with an invoice reference.

```sql
-- VERIFY
SELECT te.billed, te.billed_at, te.invoice_ref, j.status AS job_status
FROM time_entries te LEFT JOIN jobs j ON j.id = te.job_id
WHERE te.id = '<entry id>';
-- PASS: billed=true, billed_at set, invoice_ref = what you typed
-- PASS: job_status='billed' IF no other unbilled entry remains on that job
--       (the write-through). If another visit is still owed, the job MUST
--       stay in to_bill — that is correct, not a failure.
```

### 2.7 · Not billed, and why

**Do:** on a different visit, clear it with a reason instead of billing.

```sql
-- VERIFY
SELECT archived, archived_at, archived_by, archive_reason FROM time_entries WHERE id='<id>';
-- PASS: archive_reason is a KEY from src/config/archiveReasons.js
--       ('warranty', 'goodwill', 'test'...), never a sentence.
-- Prose here is what made 44 rows impossible to classify.
```

**Class matters more than the act.** After D3 ships, also assert:

- `test` / `duplicate` / `mistake` → **gone** from the customer view, calendar event deleted
- `warranty` / `goodwill` / `rework` / `contract` → **still visible**, flagged as absorbed cost
- `sales_call` → still visible, counted as pipeline cost, not as a mistake

If an absorbed visit gets recorded as `test`, its cost disappears and the dashboard calls a
customer profitable when real hours went into them. Unrecoverable after the fact.

---

## THE GATE

Before any code push:

1. `npm install && npm run verify` → **0 errors**
2. Walk the lifecycle the change touches — 1 for anything note/task, 2 for anything
   schedule/disposition/billing. Both if the change touches `supabase.js`, `lanes.js`,
   or `statusMachine.js`.
3. Every `VERIFY` block passes.
4. Review on the **preview URL**, not production.
5. Only then does merging to `main` come up, as a separate decision.

A step that cannot be walked gets said out loud, not skipped quietly.
