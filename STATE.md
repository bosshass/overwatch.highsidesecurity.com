# OVERWATCH — STATE OF THE SYSTEM

Everything: the code, the tables, the rules, what works, what is built and
broken, and what was never built.

**9.104.0 · 2026-08-20.** Every number here was read from the live database or
counted in the repo. Nothing is from memory.

Companion documents: **`MESSAGING.md`** (the texting layer in full),
**`DECISIONS.md`** (every settled call, with Sara's words),
**`OVERWATCH_FLOWS.md`** (the original data-access map — *contains known errors,
see Corrections in DECISIONS.md*), **`WALKTHROUGHS.md`** (the push gate).

---

## SCALE

| | |
|---|---|
| Application code | **32,106 lines** across `src/` and `api/` |
| Database tables | **20** (excluding backups) |
| Migrations | **24** files, 052 latest |
| Serverless endpoints | 5 — `send-sms`, `sms-inbound`, `sms-status`, `welcome-draft`, `sse` |
| Hosting | Vercel · `overwatch-highsidesecurity-com.vercel.app` |
| Database | Supabase `wolhqelloeypafmmvapn` |

The five biggest files are `App.jsx` (1,511), `JobDetail.jsx` (1,392),
`TechCalendar.jsx` (1,375), `BoardView.jsx` (1,284) and `supabase.js` (1,283).

---

## THE TABLES

| Table | Rows | What it is | State |
|---|---:|---|---|
| `job_history` | 3,504 | Every status move, with the note | live |
| `qbo_customers` | 920 | QuickBooks import | reference |
| `customers` | 864 | The client list | **live, core** |
| `jobs` | 456 | Cards. 83 columns | **live, core** |
| `customer_registry` | 381 | An older customer import | reference |
| `time_entries` | 309 | **The only authoritative record of hours** | **live, core** |
| `job_assignments` | 294 | Dispatch records | legacy — *"a calendar event is not an assignment"* |
| `notes` | 142 | Notes, tasks **and inbound texts** | **live, core** |
| `return_cards` | 81 | Written when a tech dispositions `return` | live |
| `pipeline_deals` | 37 | Sales pipeline | dashboard only |
| `pl_data` | 27 | P&L figures | dashboard only |
| `estimates` | 17 | *"A somewhat dead idea"* | **retired** |
| `techs` | 6 | The tech table | live |
| `weekly_financials` | 6 | Weekly roll-up | dashboard only |
| `clock_events` | 2 | | effectively unused |
| `settings` | 1 | | effectively unused |
| `activity_log` | 1 | | effectively unused |
| `clock_entries` | 0 | | **empty** |
| `messages` | 0 | | **empty — texts live in `notes`, not here** |

### Triggers

| Trigger | Table | Enabled |
|---|---|---|
| `trg_assign_p_number` | jobs | **YES — and it should not be** (see Broken #1) |
| `trg_stamp_materials_invoice_times` | jobs | yes |
| `jobs_updated_at` | jobs | yes |
| `trg_sync_time_entry_job_id` | return_cards | yes |
| `set_drh_id`, `trg_customers_updated`, `customers_updated_at` | customers | yes |
| `notes_touch` | notes | yes |
| `pipeline_deals_updated_at` | pipeline_deals | yes |

---

## THE RULES

Full reasoning in `DECISIONS.md`. In brief:

**closed ≠ complete.** *Closed* is set by the disposition — the doing is
finished. *Complete* is set by `invoiced = true` — the money is settled. A
fixed-fee project accrues closed visits for weeks with none complete, and that
is correct, not a backlog.

**stage is stored, lane is derived.** `laneOf(stage)` is a pure view function.
Two levels is right; storing both is what drifted.

**A disposition is a DISPATCH signal, not a billing one.** The tech says what
happened, which tells the scheduler what has to happen next. Billing reads the
same rows later and gets no vote.

**Every hour is a cost. Only some hours are an invoice line** — decided by how
the job was *sold*, never by a flag typed onto the hour.

**visits ≠ time entries.** One trip carries one disposition; two techs on it is
two time entries and still one outcome. Nothing may assume either is singular.

**`archived` and `p_number` are frozen.** Existing rows stay readable; nothing
may ever write them again.

**No bracket tags in calendar titles.** Status lives in the database. Five
writers removed.

**New cards do not create calendar events.** An event appears only when somebody
schedules.

**The pre-schedule checklist blocks nothing.** It must not stand between a card
and the board, or a tech and their disposition.

**Staff texts may carry an Overwatch link. Client texts may never.** Enforced in
`SmsComposer`, which disables Send rather than trusting the draft.

**Messages are a shared inbox.** Everyone sees every inbound text; *"{name}
answers"* carries ownership. Read silences the notification and is not done.

---

## BUILT AND WORKING

- **The board** — 7 lanes, deep links, merge tool, status moves with history
- **The finish sheet** — five dispositions, time, materials, photos (camera *and*
  library), notes, the issue and the last four notes visible to the tech
- **Scheduling** — visual scheduler, availability from Google Calendar, holds,
  reschedules, "Scheduled by" in the event description
- **Billing** — unbilled queue, write-through to the card on bill and on write-off
- **Customers** — search, history, notes, QuickBooks link
- **Texting** — staff, clients and on-site contacts; templates with YES/NO
  confirm; inbound replies routed back to the sender; read state; a
  **`💬 Messages` pill first in the Tasks filter row** carrying the unread
  count; a setup screen at `/sms` that names what is misconfigured
- **Auth** — Google OAuth with pre-emptive token renewal (the sign-in loop is fixed)

---

## BUILT BUT BROKEN

This is the section worth reading twice.

### 1. `trg_assign_p_number` is still enabled
`p_number` is frozen by decision — *"that P code also created duplicates, keep
what exists, never write to it again."* Removing the app code was only half of
it. **The trigger is still active on `jobs`**, `BEFORE UPDATE FOR EACH ROW`, and
issues `MAX+1` whenever a card enters `estimate_sent` with a null `p_number`.

It will keep minting codes regardless of what the app does. Seven customers
already hold fifteen codes.

**Fix:** drop the trigger. One migration.

### 2. Columns that do not exist, still in live queries

| Column | Refs | What breaks |
|---|---:|---|
| `job_number` | 6 | `getByJobNumber`, the number generator in `createLinkedJob` |
| `parent_job_id` | 6 | `createLinkedJob`, `getLinkedJobs`, `getJobWithFamily`, `getTotalJobValue`, **3 MCP tools** |
| `billed_at` (on `jobs`) | 3 | the column is `invoiced_at`; the two got conflated |

PostgREST 400s the whole query on an unknown column. Two of these were found and
fixed this session (the duplicate-event guard in `schedule.js`, and
`getAllNotes`, which returned `[]` for **every customer, always**). **The rest
are still there** and fail the same silent way.

### 3. Board drift — found, and it is not what I said it was

**Correction: the "7 cards where the lane contradicts the tech" list was wrong.**
Re-derived from `time_entries` against the disposition→status map the finish
sheet actually uses, only **one** open card genuinely contradicts its tech:

| Card | Lane says | Tech said | Verdict |
|---|---|---|---|
| Shepard Construction | To Bill | `in_progress` | deliberate — un-archived 8/16 as a rollup holding est 5760/5811/5812 |
| Rupert, Ed/Joann | Needs Estimate | `estimate` | **correct.** `estimate → needs_estimate` is the map |
| Sainati, Perry | Ready to Schedule | `return` | correct destination; stale since June 24 |
| Jeanneret | Scheduled | `return` | correct — the return got booked |
| DRH Security | Ready to Schedule | `estimate` | a person moved it → won → ready in 56 seconds |
| Jeff Goodell | To Bill | — | **zero time entries.** Not drift (see #12) |
| Tae Won Suh | Return Pending | — | **zero time entries.** Not drift (see #12) |
| Pault, Jerroud/Cynthia | To Bill | — | **zero time entries**, and a duplicate of a billed card |

**What actually made the board look untrustworthy: nothing records a move to
`scheduled`.**

`services/schedule.js` writes `status: 'scheduled'` with a direct
`supabase.from('jobs').update(...)` in **two** places — `scheduleJob` and
`linkToEvent` — bypassing `jobsApi.changeStatus`, which is the only thing that
writes `job_history`. So a booking left no line anywhere, and a legitimate move
was indistinguishable from a mystery one.

**And the audit log built to catch this has never written a single row.**
`logScheduleAction` inserts `to_status: null`; `job_history.to_status` is **NOT
NULL**; Postgres rejected every insert. supabase-js returns the error rather
than throwing, so the `try/catch` never fired, and the one call site did not
`await` it. Six months, zero rows. *Verified against the live database: the old
insert shape is rejected, the new one succeeds.*

**Scale of the gap, provable from the data itself** — compare each history row's
`from_status` with the previous row's `to_status`:

| | |
|---|---:|
| Status changes with no history row | **334** |
| Jobs affected | **213** |
| Of those, moves to `scheduled` | **~99** — the largest single group, still happening 2026-08-20 |

Other silent writers, all now fixed: `jobsApi.update()` (would write `status`
from any caller and log nothing — the structural hole), `InboxBar.acknowledge`
and `dismissAll` (bulk → `archived`), `CustomerAudit.markOrphanComplete`
(→ `archived`).

**Still true:** the 334 historical gaps cannot be reconstructed. Only new moves
are recorded.

### 12. Cards in outcome lanes with no visit behind them

Three open cards sit in a lane that asserts an outcome, with **zero time
entries** — nothing has been billed, returned or estimated because nobody has
recorded going:

- **Jeff Goodell** — To Bill, scheduled Aug 24
- **Tae Won Suh** — Return Pending, scheduled Aug 6
- **Pault, Jerroud/Cynthia** — To Bill, scheduled Aug 14, and a **duplicate** of
  a Pault card already billed in June

This is what I previously mis-read as the lane contradicting the tech. There is
no tech to contradict.

### 4. One job, several cards
**Laird Heikens is three cards. Jeanneret is two. Shepard is two.** There is no
`parent_job_id`, so related work cannot be recognised as related. Same root
cause as the fifteen P-codes.

### 5. Four scheduled cards with no issue
Tae Won Suh, David Huang, Jeanneret, **Nancy Neville — scheduled Aug 24**. A
tech is going somewhere with nothing telling them why. (Was 28 before migration
048; these are the ones that never had one.)

### 6. Five past visits with no disposition
Huang 8/17, Laird Heikens 8/06, Watson 8/13, plus Sherick and Spannring today.
Either the visit happened and nobody closed it out, or it did not and nobody
said so.

### 7. `notes.status` drift
Three values live where the migration allowed two: `open`, `archived`, `closed`.
`archived` and `closed` are the same end state reached from different screens, so
finishing a task behaves differently depending on where you finish it.

### 8. MyDay's dead button
`DidYouGo` is mounted at `MyDay:25` with **no `onOpenSheet`**, so "Close it out"
silently does nothing on JR's landing screen. `OpsHome` wires it correctly.

### 9. Notes reach only some calendar events
`appendNoteToJobEvents` reads `job.assignments[].calendar_event_id` only. It
never looks at `scheduled_event_id` — which is where the scheduler writes, and
**30 live jobs have one and no `calendar_event_id`.**

### 10. Reported, not reproduced
**"Clicking a job link isn't deep linking to the card."** I checked the resolver:
the UUID-prefix range query returns exactly 1 hit for a real code, the route is
not operator-gated, `MergeTool` exports correctly, and the post-login path
restore looks right. **I could not reproduce it and I do not know the cause.** It
needs the failing link and what appeared instead.

### 11. RLS is not a boundary
Every table is `USING (true)` and the anon key ships in the browser bundle. The
per-person filtering in Tasks is a **display convention**. Anyone who can sign in
can read everything. Six people share `info@drhsecurityservices.com` as owner, so
in practice most of the team already sees everything — which matches the shared
inbox decision, but should be a choice rather than a surprise.

---

## NOT BUILT

**Messaging:** no conversation thread view; no delivery-status callback (a
message that fails after being queued is visible only in the Twilio console); no
STOP tracking in the app (Twilio honours it, Overwatch does not know); no
inbound MMS — photos texted in are dropped.

**Approvals** — the office approving what is flagged billable, and approving an
invoice once created. Intent recorded, never shown to a user.

**The won gates** — materials invoiced → paid → contract signed → ordered →
received. Columns exist; only *materials paid* fires anything
(`api/welcome-draft.js`). Not wired as a stage.

**not_real cleanup** — a visit archived as test/duplicate/mistake should delete
its calendar event. The customer-view hiding is built; the calendar deletion is
not.

**Projects view / SoldWork** — retired, not redesigned.

**`overwatch.highsidesecurity.com`** — the subdomain has no DNS record and never
has. The app is at the `.vercel.app` host.

**The editable issue does not reach the tech's sheet.** It is editable on the job
card and mirrors to the calendar; the finish sheet reads it but cannot change it.

---

## VERIFICATION STATE

**What is actually tested:** the Twilio signature check
(`tests/twilio-signature.test.mjs`, 10 assertions against Twilio's own published
vector) and the calendar description rewriter (23 assertions, run once during
development).

**Everything else is verified by `npm run verify`** — an ESLint `no-undef` gate
plus a production build. That catches undefined references and syntax. It does
not catch a wrong query, a wrong lane, or a button that does nothing.

**There is no test suite, no CI, and no staging environment.** Migrations are
applied directly to production with a backup table and a written rollback.

Texting is the only subsystem exercised end to end against the real service —
outbound delivered, inbound received, both confirmed on 2026-08-20.
