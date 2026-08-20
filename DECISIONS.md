# OVERWATCH — DECISIONS

Settled calls, with the reasoning. Sara's words are quoted where they decide the answer.
Anything not here is not decided.

Last updated: 2026-08-20

---

## THE CORE LOOP

The thing everything else serves:

> create new job → take notes in a customer view → add an issue to the note/job card →
> dispose it in a job finish sheet → flag returns / estimates → **not for billing, for the
> scheduler to see** → then a lane on the board

**The disposition's primary consumer is the SCHEDULER, not billing.** This reverses how the
current code treats it. A disposition is a *dispatch* signal — the tech says what happened,
which tells Shana what has to happen next, and the lane is that answer. Billing reads the same
rows later, downstream, and gets no vote in what the lane says.

Consequence: `return` and `estimate` matter more than `bill_it`. Those create work for
somebody. `bill_it` is the quiet outcome — nothing more to do on site.

---

## VOCABULARY

### closed ≠ complete
> "Tasks get closed — it's done. Visits which have time — if invoiced = true then the time and
> the visit are closed; I use **complete**… A FF job wouldn't mark the visits or the time as
> complete until invoiced = true."

Two axes on a visit, never one field:

| Axis | Set by | Means |
|---|---|---|
| **closed** | the disposition | The *doing* is finished. Nothing more happens on site. |
| **complete** | `invoiced = true` | The *money* is settled. Only the billing modal sets it. |

A fixed-fee project accrues **closed** visits for weeks with none **complete**. That is correct,
not a backlog. Tasks and notes have only the first axis — no money on them.

The card's terminal settled stage is **`complete`**, not `billed`. Sara's word.

### stage / lane / gate
- **stage** is stored — one column on the card
- **lane** is derived — `laneOf(stage)`, a pure view function, never stored
- **gates** are a checklist inside a stage

Two levels are correct. The board was collapsed to lanes deliberately because it was too big to
read. The bug was never that there are two levels — it was that *both were stored* and drifted.

---

## WON GATES

`won` is a **holding stage with an ordered checklist**, not a status and not a transition.

1. materials invoiced — *column exists, fires nothing yet*
2. materials paid — *column exists · **fires the welcome email***
3. contract signed
4. materials ordered
5. materials received

**Estimate-track cards only.** A plain service call goes `new → ready` and never sees them.

> "Are gates sequential — like visually do they show sequentially, sure. Should we force the
> sequence, no. Should it be recommended, yes."

Order is **shown and recommended, never enforced**. All five **are** required before the card
can be scheduled.

`api/welcome-draft.js` is the gate-2 side effect. It was never dead code — it required
`status='won' AND materials_invoice_sent AND materials_invoice_paid` and was waiting for this
stage to work.

---

## COST vs REVENUE

> "Those entries then become job costs vs billable hours… time entries may roll up into a FF or
> estimated scope of work — all tracked, not necessarily billed the same as a service call."

**Every hour is a cost. Only some hours are an invoice line** — and which, is decided by how the
job was *sold*, never by a flag typed onto the hour.

| Sold as | Cost | Revenue |
|---|---|---|
| Service call, hourly | every entry | the same entries are the invoice lines |
| Fixed fee / won estimate | every entry | burns against `estimate_amount`, never invoiced hourly |
| Warranty / goodwill | every entry | none, by decision — the reason key says which |

`non_billable_reason` **stays**, narrowed: it records **deliberate write-offs only**.
`'project hours'` was the right answer in the wrong field — sale type belongs to the card.

### Not billed, and why
Three classes, already correct in `src/config/archiveReasons.js`:

| Class | Reasons | Behaviour |
|---|---|---|
| **not_real** | `test` `duplicate` `mistake` | Zero revenue, **zero cost**. **Hidden from the customer view, and the calendar event is deleted.** ← not built yet |
| **absorbed** | `warranty` `rework` `goodwill` `contract` | Real cost, zero revenue. **Stays visible** in the customer view. |
| **sales** | `sales_call` | Real cost, zero revenue, deliberately *not* lumped with warranty — prospecting is healthy, callbacks are not. |

---

## ENTITIES

**visits ≠ time entries.**

- **visit** — one trip. Carries the **disposition**: two techs on one visit is still one outcome.
- **time entry** — one tech's hours on one visit. Two techs, two rows.

> "A card could have 5–100 open visits — if it is a FF project with 1,000 hours it could be
> scheduled for weeks in the future as a multi-day visit. The visit may also need more than one
> tech."

Nothing may assume "the visit" or "the tech" is singular.

Invoice state lives on the **visit**, travels with the hours, and is **displayed only in the
billing modal** — never on the card.

---

## FROZEN — keep what exists, never write again

### `archived`
> "Archived is old… leave alone — block these columns from allowing anything to write in the
> future."

125 job rows stay exactly as they are. Frozen legacy value: still valid so existing rows stay
readable, **nothing may ever write it again**. Two layers — removed from every code path, **plus
a database trigger that rejects the write**. Code alone is not a guarantee.

### `p_number`
> "That P code also created duplicates in the DB — keep what exists — never write to it again."

Confirmed, with the mechanism. `trg_assign_p_number` is **enabled**, `BEFORE UPDATE ON jobs FOR
EACH ROW`, and issues `MAX+1` whenever a card enters `estimate_sent` with a null `p_number`.

No two cards share a code — the duplication runs the other way. **One project splits across
cards and each card takes a number.** Seven customers hold fifteen codes:

| Customer | Codes |
|---|---|
| Boys & Girls Club Loveland | **P-003 · P-070 · P-072** |
| BG Automotive HQ | P-002 · P-035 |
| Jerry Allen Construction | P-052 · P-058 |
| RLR LLP · MARSCHKE · ANDERSON · SMITH | 2 each |

Same root cause as Allen's seventeen flat cards: **no `parent_job_id` column exists**, so related
work cannot be recognised as related, and a re-quote becomes a new card with a new number.

The freeze is three parts: **drop the trigger** (it issues codes on its own — removing app code
changes nothing while it lives), remove `createProjectJob` and `assign_s_number` (which fire it
deliberately), and stop reading `[P-NNN]` out of calendar titles.

---

## RULES

### No bracket tags in calendar titles — DONE
> "We are not to update calendar events with [name] to reflect status in the app — no Bill it,
> no [RETURN], no."

Five writers removed. Status lives in the database. Field notes still append to the event
**description**; only the title is left alone.

### New cards do not create calendar events
An event appears only when somebody schedules. This also removes a duplicate scheduler:
`NewJobModal` has its own `createCalendarEvent()` that bypasses `services/schedule.js`, writes
`status:'scheduled'` directly, and **never sets `scheduled_event_id` or
`scheduled_calendar_id`**.

### The pre-schedule checklist is advisory
> "It needs to not affect the functionality of the current cards — and of the field tech's
> disposition."

**Blocks nothing.** A card schedules with it half-empty; a tech dispositions with it half-empty.
Add **materials needed** (free text) and **contact name + phone** (auto, flags when missing).
Drop "technician assigned" (the calendar decides that *at* booking, so it cannot be a
precondition *for* booking) and "parts confirmed" (keys off retiring statuses).

Distinct from the won gates, which **are** a hard gate.

### Week = Monday to Friday
Counts **booked hours**, **booked events by day**, and **logged hours vs booked hours**.

Current state: all three week screens start Monday, but only `CalendarTechDay` honours M–F.
`TechCalendar` renders a 7-day grid and `WeeklyRecap` counts a 7-day window.

**Open:** there are **4 Saturday visits / 17.0 hours** in the data (no Sundays). A strict M–F
week makes those invisible. Suggested resolution — render M–F, but show a Saturday column *only
when it has something on it*, and count the full Mon–Sun span in totals so nothing vanishes.

### Photos — DONE
Camera **and** library. `capture="environment"` alone jumped straight to the rear camera and made
an already-stored picture unattachable. Two buttons, one input each.

### Identity
Remove the who-are-you prompt. `info@drhsecurityservices.com` = owner: all calendars, tasks,
notes, weekly view, billing, admin. Six people share that mailbox, so this grants all six.
Sara's call, made knowingly.

---

## RETIRED

| | Why |
|---|---|
| **Help & onboarding** — HelpBot, Tour, Spotlight, BuildLog | **DONE.** 2,290 lines. Teaches the old vocabulary and would be wrong the day the stages change. Comes back once the core loop is right. HelpBot was already dead — zero mounts. |
| **Projects view** | "Projects in the new world of Overwatch is a card being mapped to estimate or FF job." Not redesigned — retired. |
| **SoldWork** | "Sold work is a concept of the Projects view — save for later." Deferred with it. |
| **LinkAudit · ReconcileView · PreviewChanges** | Sara does not recognise them. All three are scaffolding around the four event-ID columns the model collapses to one. |
| **`estimates` table** | "A somewhat dead idea." The estimate *flow* lives on as stages. |
| **`feedback` table** | "This should be removed." |
| **`job_assignments`** | "A calendar event is not necessarily an assignment — it's a calendar event." |

**Kept:** `UpdateBanner` — deploy plumbing, not onboarding. **CommandCenter** — "a different
construct", left alone. **Approvals** — deferred, intent recorded: the office approves what is
flagged Billable, and approves an invoice once created. Never shown to an end user.

---

## PROCESS

- **Preview, never production.** Work lands on the feature branch → Vercel preview URL.
  Production only moves on a merge to `main`, which is a separate explicit decision.
- **Backup before anything.** Code: `backup/pre-rewrite-9.80.0`. Database: ten
  `*_backup_pre_rewrite` snapshot tables, taken in one pass, row-for-row verified.
- **Every push walks the lifecycle it touches**, creation to completion. See `WALKTHROUGHS.md`.
- **`npm run verify`, never `npm run build`.** npm needs no auth; the build gate is mine to run.
  The browser needs a Google sign-in, so UI verification needs a human — and when a change ships
  without it, that gets said, not skipped.

---

## STILL OPEN

1. **Saturday hours** — 17.0h across 4 visits. Strict M–F hides them. Proposal above.
2. **MyDay's dead button** — `DidYouGo` is mounted at `MyDay:25` with **no `onOpenSheet`**, so
   "Close it out" silently does nothing on JR's landing screen. `OpsHome` wires it correctly.
3. **`notes.status` drift** — three values live where the migration allowed two: `open` 31,
   `archived` 79, `closed` 14. `archived` and `closed` are the same end state reached from
   different screens, so finishing a task behaves differently depending on where you finish it.

---

## CORRECTIONS TO EARLIER WORK

Recorded because the earlier documents were wrong and are still in the repo.

- **`job_number` and `parent_job_id` do not exist** on the live `jobs` table. The atlas listed
  both — read out of the code, not the database. Every path writing either throws, which kills
  `createLinkedJob`, `getLinkedJobs`, `getJobWithFamily`, `getTotalJobValue`, and three MCP
  tools. Filed originally as a *race*; it is a hard failure.
- **The `blocked` disposition** produced zero rows and never once succeeded. Called it "actively
  costing data"; it was a button that never worked. The one `blocked` job came from the board.
- **`won`** — advised keeping it, then making it a transition. Both wrong. It is a holding stage
  with gates.
- **`non_billable_reason`** — advised removing it from time entries. Too aggressive; it stays,
  narrowed to write-offs.
- **The atlas never mapped Supabase Storage.** The word appears zero times. Photos live in a
  bucket, and a bucket is not a table, so it was invisible to the method used.
