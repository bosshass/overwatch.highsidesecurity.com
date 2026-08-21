# OVERWATCH — STATE OF THE SYSTEM

Everything: the code, the tables, the rules, what works, what is built and
broken, and what was never built.

**9.109.0 · 2026-08-21.** Every number here was read from the live database or
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
| Migrations | **27** files, 055 latest |
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

**Overwatch does not do accounting.** A project is **a budget of hours, the
hours logged against it, and a delta.** Billing says *progress invoiced* and
*complete* — **no dollars**. What an invoice was for lives in QuickBooks; a
second figure typed here is a second version of it that will disagree within a
week. The money columns keep their data and are never written by the app again.

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

### 16. Blocked was defined and never offered

> *"I have no way to mark things blocked as an operator."*

`BLOCKED_LANE` has existed since the lane vocabulary was written, and it is in
the list `laneOf` reads — so a blocked card **renders** correctly. It was simply
never in the list `movesFor` returns, so the only route to the status was a tech
picking it in the field.

That is backwards. Blocked is the one state a **person** asserts on purpose, and
the office is usually who learns of it: the customer cancelled, the parts did not
land, the GC is not ready. It is offered from the ticket now, and **it will not
commit without a reason** — its own definition says *"cannot move until
something outside us changes — say what,"* and a card parked in Blocked with no
reason is indistinguishable from one somebody forgot.

### 17. Fixed-fee hours have never been marked, because nothing could mark them

`time_entries.billable` is read in three places — `unbilledBucket`,
`CalendarTechDay`, the Billing screen — and **written in none.** Zero of 74
entries carry it. So the **📐 Project hours** bucket, whose whole job is to hold
work covered by a fixed price, has always been empty while those hours sat in
*Ready to bill* looking invoiceable.

Jeanneret is the live case: **28 hours** against a job already flagged
`is_fixed_fee` with an **$1,881** agreed price, reading as billable by the hour.

Two fixes, and the first is the important one:

**The contract already said so — derive it.** If the job is `is_fixed_fee`, its
hours are cost against that price. That is not a judgement anyone should make
twelve times; it was made once, on the job, when the price was agreed. It sits
below `billed` and below an explicit `billable = false` (an invoice, and a human
flag, both outrank a derivation) and **above `disposition`** — "bill it" from a
tech means the *work* is done; it was never a claim about how the job was sold.
Twelve fixed-fee jobs correct themselves the moment this ships.

**And the switch that was missing.** Select visits in Billing → **📐 Fixed fee —
not by the hour**. It flags the entries *and the job*, because the flag belongs
on the job: that is where the price lives, and it is what makes every future
hour follow without anyone ticking it again. Not gated on `canBill` — saying how
a job was **sold** is a scoping fact, not a claim that an invoice went out.

### 18. Loose hours could not be joined to their job

**163 unarchived entries have no `job_id`.** They appear in Billing under
whatever name the calendar event carried, sitting next to the real card for the
same customer, and the only routes offered were *make a ticket* (a second card)
or *mark billed* (hide it). Neither joins them up.

> *"I show Jeanneret as a client in my To Bill — I want to select the time entry
> and merge it into the job."*

**🔗 Merge into a job** now appears both on the no-job bucket and in the
selection bar, so it reaches anything you can tick — including an entry that
resolves to a job through its calendar event while carrying a null `job_id`,
which *looks* attached and is not. The picker floats that customer's own open
jobs to the top and says which are fixed fee, since that changes what happens to
the hours the moment they land. Nothing is deleted; the entries point at the
card, and the job's history records the merge.

### 19. `logHistory` rejected every note-only row

Same trap as #3, one function over. `job_history.to_status` is **NOT NULL**, so
every caller that wanted to record something which *isn't* a status move — a
note, an audit line, a decision about money — passed null and had the insert
rejected, silently. A null destination now means "nothing moved" and is filled
in with the job's current status: the row records what happened without claiming
a transition that did not occur. Errors are surfaced instead of swallowed.

### 20. Tasks existed in one person's stack and nowhere else

> *"Tasks are born from notes cards — all of the stuff with the tasks should
> have a parent note in the board."*

A note is a thought. Assigning it makes it a **task**: work a person now owes.
Two creation paths wrote tasks with **no `job_id` at all** —
`NewJobModal.handleSubmitTask` and the assign button in `/notes`. So the work
lived in one stack and nowhere else: not on the board, not on the customer, not
findable by anyone who did not already know to look. If that person did not open
Tasks, it did not exist.

Of **33 open tasks**, found 2026-08-21:

| | |
|---|---:|
| No card at all | **8** |
| Pointing at an **archived** card | **4** |
| Pointing at a card killed by a **merge** | **1** |
| **Had a parent visible on the board** | **20** |

The merge one is its own bug: **the merge tool carried `job_history`, the issue,
the phone and the calendar event across — and left `notes.job_id` on the
corpse.** An open task outlived its parent and went invisible. A merge says
"these are the same job"; its tasks are the same tasks. It repoints notes now.

**The rule, in code:** `notesApi.ensureBoardCard()` — the moment a note becomes a
task it gets a parent card, `job_type` `note`, status `new`, in the New/Notes
lane. Not a job (nobody drives to it) but a thing on the board with a customer, a
history and a URL. Idempotent, and non-fatal: a missing card is a gap to fix,
never a reason to lose the assignment. Called from both creation paths and from
the handoff in Tasks.

**Inbound texts are excluded** everywhere in this rule. The webhook assigns every
reply to whoever sent the outgoing message, which looks exactly like a task to
anything keyed on `assigned_to` — a client's *"yes that works"* must not
manufacture a card on the board.

**Migration 054** settled the 13: the merged one follows its parent (recorded on
both sides, not guessed), the four archived parents come back to the New/Notes
lane — *a parent cannot be closed while the work it carries is open* — and the
eight get cards, `Internal` where there is no customer, because a gift basket is
still work, it is just not about anybody. **Verified after: 0 with no card, 0
whose parent is archived or dead.**

---

## A PROJECT IS HOURS

> *"Overwatch is NOT going to do accounting. Overwatch gets a budget of hours
> available and all the hours logged to it and a delta. The billing person gets
> to say when it is progress invoiced — no dollars — and then when it is
> complete. That's it."*

**What this replaced.** The fixed-fee panel asked for six money fields —
contract, rate per hour, materials cost, materials billed, billed to date — and
drew its progress bar from *hours × rate against contract minus materials*. A
P&L rebuilt by hand in a field-service app, next to a real one in QuickBooks
that would disagree with it within a week.

**Three numbers, and they are the three Overwatch actually owns:**

| | |
|---|---|
| **Budget** | hours the job was sold with — `jobs.hours_budget` |
| **Logged** | hours in `time_entries` against it |
| **Delta** | budget − logged. Red past zero |

**Two stamps, no amounts.** *Progress invoiced* — billing says an invoice went
out, not how much; repeatable, because a long project bills several times and
the count is what says so. *Complete* — billing says it is settled, and that is
the close-out. Both gated on `canBill`. **Setting the budget is not gated** —
that is scoping, decided when the job was sold, and the person running the work
is who knows it.

**Nothing is dropped.** `estimate_amount`, `hourly_rate`, `materials_cost`,
`materials_invoiced` and `invoiced_amount` keep their data and stay readable.
The money is simply no longer asked for, shown, or written. A column with
history in it does not get deleted on the strength of a UI decision.

**The job card's billing modal no longer asks for an amount** — it asks for an
invoice number, which is a *reference* to the book of record rather than a copy
of it, and writes `invoice_ref`. It also no longer refuses to submit without
dollars, which is what made it unpressable once the amount question became the
wrong question.

**In the customer view:** a **Projects** section above Open work, because a
project is the bigger fact about an account than any one card — budget, logged,
delta, the stamps, and *Close it out*. Above it, **Stats**: visits, hours, open
work, projects, last visit. All counted from rows Overwatch owns. **No money**,
for the same reason as everywhere else.

**Migration 055** adds `hours_budget`, `progress_invoiced_at/by`,
`progress_invoice_count` and `completed_by`, and seeds the budget from
`estimated_hours` where one existed — **five jobs**. The other eight fixed-fee
jobs read *"no hours budget yet"* rather than a number invented from a contract
price and a rate.

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
