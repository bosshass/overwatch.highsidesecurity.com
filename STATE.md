# OVERWATCH — STATE OF THE SYSTEM

Everything: the code, the tables, the rules, what works, what is built and
broken, and what was never built.

**9.106.0 · 2026-08-21.** Every number here was read from the live database or
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
| Migrations | **25** files, 053 latest |
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
finished. *Complete* is the money being settled — `is_complete` / `invoiced_at`
/ `invoiced_amount`; there is no `jobs.invoiced` column, though several places
in the code have believed there was. A
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

### 12. Cards in outcome lanes with no visit behind them — settled

Three open cards sat in a lane asserting an outcome with **zero time entries**.
Sara ruled on each:

- **Jeff Goodell** — To Bill, scheduled **Aug 24**. *"The 24th is future."* It is
  a `project` card carrying $9,558 invoiced with pre-wire still going. **Not a
  defect** — a project accrues, which is the closed ≠ complete rule working.
- **Tae Won Suh** — *"JR never did notes, no one was there, needs to bill a
  trip — that's what the blocked option was meant for."* Nothing was started, so
  nothing needed returning to. **Migration 053** moves it to `blocked`.
- **Pault** — two cards. The June one is a separate `project`, already billed.
  The live one is 7 days old, not 30, so the new rule below leaves it alone.

### 13. The `blocked` disposition existed and was unusable

`blocked` shipped with the database ready for it — `jobs_status_check` and
`time_entries_disposition_check` both allow it — and **zero of 307 time entries
have ever used it.** Three reasons, all now fixed:

1. **The button was labelled `📝 New / Notes`** — a board lane, not an outcome.
   A tech scanning five buttons reads the labels; the correct wording
   ("Couldn't do it — no access, wrong parts") was in the small print
   underneath. It now reads **`🚫 Couldn't do it`**, with the consequence a tech
   would otherwise assume is lost on the face of it: *the trip still bills*.
2. **It was missing from `utils/billing.js`**, the file that exists so every
   screen names and colours a disposition the same way. `dispo('blocked')` fell
   through to the generic branch: the bare word, in grey, with no meaning line.
3. **It could not reach billing.** `getBillingQueue` filtered
   `disposition = 'bill_it'`, so a tech marking "couldn't do it" sent the trip
   nowhere. Blocked visits now have their own bucket — **🚫 Trip to bill** —
   separate from finished work, and exempt from the zero-minutes downgrade,
   since a wasted trip legitimately carries almost no clocked time.

### 14. The billing button on the job card has never worked

`JobDetail.handleBilledSubmit` wrote **`billed_amount`** and
**`billing_notes`**. Neither column exists on `jobs` — the real ones are
`invoiced_amount` and `completion_notes`. PostgREST 400s the whole UPDATE on an
unknown column, `jobsApi.update` throws, and the catch logs "Billing error" to a
console nobody has open. **The status change never ran.** Same failure mode as
#2, found the same way — by asking the database what the columns actually are.

The modal header also rendered `job.job_number`, which does not exist, so it
printed the literal word **undefined** next to the customer's name on the one
screen where a number matters. It shows the invoice reference now, when there
is one.

### 15. The billing gate was a mailbox, and the mailbox is JR's

> *"They don't get to tell us how much they were invoicing — that's not for them
> to do."*

The invoice-amount modal was gated on `isInfoUser` —
`info@drhsecurityservices.com` or `sara@jnbllc.com` — written when info@ was
believed to be a shared office mailbox. **It is JR's login**, role `operator`.
So the one account the $ field opened for belonged to a tech.

Worse, the gate only covered the *modal*. The click handler read:

```js
else if (action.toStatus === BILLED && isInfoUser) { setShowBillingModal(true); }
else { handleStatusChange(action.toStatus); }
```

Everyone who was **not** info@ fell through to the `else` and **marked the job
billed with no amount, no invoice reference, and nothing recording who decided.**
The gate made the careful path exclusive and left the careless one open to all.

---

## WHO GETS TO SAY A JOB WAS INVOICED

This is the billing side of a rule the finish sheet already obeys: **a
disposition is a dispatch signal, not a billing one.** The tech says what
happened. What it is worth, and whether it went on an invoice, is settled later
by the people who send invoices.

**`canBill()` in `utils/ownership.js` is the one definition** — named for the
job, not for a mailbox, so it cannot drift the same way twice:

| | |
|---|---|
| **Can mark billed** | `accounting@`, `admin@jnbservice.com`, `sara@jnbllc.com`, `sara@jnbservice.com` |
| **Cannot** | `info@` (JR), `jr@`, `shanaparks@`, and every tech login |

Enforced in four places, because `billed` was reachable from all four:

1. **JobDetail** — the Mark Billed action is not offered, the modal cannot open,
   and `handleStatusChange` refuses `billed` outright (the status picker lists
   every destination, so the action buttons were never the only route).
2. **The board's quick-advance chip** — `to_bill → billed` was one tap, and the
   board is operators, which includes JR.
3. **TicketSheet** — `movesFor()` takes `mayBill`, **defaulting to false**: a
   caller that forgets to say who is asking gets the safe answer.
4. **Billing (`/unbilled`)** — Mark billed, the invoice-# field, and both
   "invoiced elsewhere" buttons. The screen is `OperatorOnly`, which is not the
   same as being the person who invoices.

**What everyone keeps.** *Done — To Bill* stays available to all — a tech saying
the work is finished is a fact they are entitled to state, and it is how work
reaches billing in the first place. Reading the queue, selecting rows, and
clearing junk with a reason all stay too. **One action moved, not a lockout.**

**Shana is excluded.** She schedules; accounting invoices. If she bills, adding
her is one line in `BILLING_EMAILS`.

**This is a UI convention, not a security boundary** — see #11. Every table is
RLS `USING (true)` and the anon key ships in the browser, so anyone signed in
can still write these columns directly. It stops the accident and the wrong
habit; it does not stop a determined person.

---

## THE 30-DAY NO-DISPOSITION RULE

> *"if it says June somehow — it should be greater than 30 days old, flag as no
> dispo, push to billing."* — Sara

A visit date that passed a month ago with **no time entry and no disposition**
is not work in progress. It is a decision nobody made, and after thirty days
nobody remembers enough to make it well.

**Thirty days, not seven.** A card whose date slipped by a week is usually a
tech who has not written it up yet; flagging those would bury the real ones. A
month is past every honest explanation.

It is deliberately **not** limited to To Bill and Complete like the existing
no-hours sweep. The cards this exists for are stuck in `scheduled` and
`return_pending` — lanes that say the work is still coming — which is exactly
why nothing has ever surfaced them.

They land in Billing as **⏳ Nobody closed it out**, carrying their age: bill
it, write it off, or rebook it.

**It fires on nothing today.** Eleven cards have a past date and no time entry;
the oldest is 16 days. The rule is a tripwire, not a cleanup — these are the
ones it will catch as they age:

| Card | Date | Age | Lane |
|---|---|---:|---|
| ShoCo — Main St | Aug 5 | 16d | To Bill |
| Laird Heikens | Aug 6 | 15d | Scheduled |
| Tynan, Shawn/Ann | Aug 11 | 10d | To Bill |
| Watson, Shirley | Aug 13 | 8d | Scheduled |
| Devereaux, Harry/Deb | Aug 14 | 7d | To Bill |
| Pault, Jerroud/Cynthia | Aug 14 | 7d | To Bill |
| + 5 more under a week | | | |

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
