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

### The issue is its own field, and it is editable — DONE
> "The issue is pulling from the prefilled list on new creation — it isn't clear
> that this is where to enter."

`NewJobModal` opened `issue` as a seven-line text skeleton with **"Scope of Work:"
as the last line**. Three of those lines duplicated real columns; three had no
column at all. Measured: **80 cards carried the template, and 28 of them had an
empty Scope of Work** — sent to a tech as a form with no job written on it. One
card has `testing two techs` typed into the Contact Phone line, because there was
nowhere else to put it.

- The template is gone. `issue` is a labelled box of its own — *"What are we doing?"*
  — with an amber warning when it is empty. Warned, never blocked.
- The three homeless lines got real columns (**migration 047**): `site_contact_name`,
  `site_contact_phone`, `access_permission`. The last is three-valued — `NULL`
  means nobody was asked, which is true of all 453 existing rows.
- **Migration 048** split the 80 existing rows: 52 keep a real scope, 28 became
  NULL, 14 on-site contacts and 14 phones moved to their columns, and 2 rows with
  text outside the skeleton kept it. Backup: `jobs_backup_048`.
- The issue is now **editable on the card**, and saving mirrors it to the linked
  calendar events.

### Never overwrite the calendar description — DONE
> "Calendar event desc and 'issue' are or should be the same — never overwrite."

The issue gets a **fenced region** in the description; rewrites replace only what
is between the fences. The `CUSTOMER_ID` stamp, appended field notes, the deep
link and anything hand-typed survive untouched. A legacy bare `Issue:` block is
upgraded in place on first edit, so there is never a second contradictory copy.
23 assertions cover it, including a fourth-revision case with a field note below.

The database write happens first and the calendar patch is best-effort after it.
When the mirror does not land, **the card says so** instead of reporting a clean
save.

### No writing notes from the job card — DONE
> "Best to remove the ability to + a note from the job card… if you select + note
> you are taken into the client search tool."

The card offered three composers: Note, Response, and **"Customer note (no job)"**
— and the third *inserted a second card* (`job_type:'note'`) from a control that
read like a comment box. That is one of the ways spare cards appear without
anyone choosing to make one.

The feed stays; the composer is gone. One button navigates instead — deep-linked
to `/customers?customerId=…` when the job has a customer, to the client search
when it does not. The card's own writable field is the issue.

### Tasks are clickable, and the card says what is happening — DONE
> "The task created from a note isn't clickable — I should be able to see what is
> happening with the task associated to the card."

Both directions were broken:

- **Task → job.** "Open the job" had been *deliberately removed*, on the grounds
  that archived jobs "landed on nothing". That objection was stale — the board's
  deep link fetches the job directly by id and opens an archived card fine. It is
  back, with a customer-record fallback for tasks with no job and for non-operators
  (`/board` is operator-only).
- **Job → task.** The card showed a one-line banner: names, and the words
  "working a piece of this". No body, no state, no age. And it **filtered out
  `lane='done'`** — so a task somebody had finished and handed back vanished from
  the job at the exact moment it needed acting on. Now: each task, its text, who
  asked, its age, and one of *To do · On it · Says done — needs your OK*.

### Why we went, then what came back — DONE
> "The issue — the why we went — that is the top of the job disposition card.
> When it gets updated with notes, materials, and given an action… the tech note
> time entry should show at the top of the display."

The card now reads top-down as one story: **Issue — what are we doing?** then
**📝 What happened on site** — the tech's note, materials, hours, photos and the
disposition they chose.

That block used to render near the **bottom**, below the lane buttons and the
task composer, so the newest and most decisive fact about a job was the last
thing you reached and on a phone was usually off-screen.

Two bugs came out with it:

- It matched **one** event column, `calendar_event_id`. The scheduler writes
  `scheduled_event_id`, and **30 live jobs have one and no `calendar_event_id`** —
  so the match never fired for any of them.
- Those 30 fell through to a customer-wide query, which returns the client's
  entire history. The card showed **another job's visit as if it were this one's**.
  Now: `job_id` or any of the three event ids; the client's other visits are
  labelled as such and sit behind the toggle.

### "I didn't get to go" — DONE
`JobFinishSheet` has offered five dispositions since 9.4.0. The database
accepted four:

```
CHECK (disposition = ANY (ARRAY['bill_it','return','estimate','in_progress']))
```

`blocked` was **rejected by Postgres**. The insert threw, the sheet failed, and
the visit was recorded as nothing at all. Zero blocked rows in 307 entries — not
a disposition nobody uses, a button that has never once worked. **Migration 049**
widens the constraint to the five the UI already offers. `jobs.status` already
allowed `blocked`; only `time_entries` was blocking.

This also corrects the earlier note that `blocked` "produced zero rows and never
succeeded" without saying *why*. The why is a constraint, and it was fixable.

### The sign-in loop — DONE
> "When I login the yellow session exp appears, click sign back in, it makes me
> do this twice, then I get the app for seconds and then get directed to the
> pick Google account."

**Two keys, one of them never maintained.**

| Key | Written by | Read by | Meaning |
|---|---|---|---|
| `juce_v4_expiry` | the OAuth redirect (**36h**) | the session check | how long we let somebody stay signed in |
| `juce_v4_token_expiry` | **`silentRefresh` only** | the pre-emptive renewal, the dead-on-arrival check | when this Google token stops working |

`clearStorage` never removed the second one, and the OAuth redirect never wrote
it. So a fresh sign-in landed with a **new token and a `token_expiry` timestamp
from a previous session**. The dead-on-arrival check runs immediately on mount,
read that past timestamp, tried a silent refresh, and failed — so *"Your session
expired"* appeared seconds after signing in successfully. "Sign back in" ran the
same failing refresh, fell through to the full redirect, and the full redirect
carried `prompt=select_account`. **That is the account picker.** Round and round.

Four fixes, each addressing one turn of the loop:

1. **`clearStorage` clears `juce_v4_token_expiry`.** It never did.
2. **The redirect writes it**, from Google's own `expires_in` in the fragment —
   3600s, not an invented 36 hours.
3. **A failed background refresh no longer raises the gate by itself.**
   `silentRefresh` goes through GIS `requestAccessToken`, which opens a popup
   when it cannot complete silently — and **a popup with no user gesture behind
   it is blocked outright on mobile**. It failed routinely on a phone for
   reasons unrelated to the token. The 401 interceptor is the honest signal and
   still raises it; this path now also requires the token to be genuinely past
   expiry.
4. **Re-auth does not force the picker.** `handleSignIn({ reauth: true })` sends
   `login_hint` and omits `prompt`, so Google round-trips the same account. With
   six Google accounts on that phone, `select_account` meant hand-picking hers
   every time an hour-long token lapsed.

Plus a **boot repair**: anyone already signed in when this build lands still has
the poisoned value. It cannot be fixed by clearing on sign-out — that helps the
*next* login, not the open tab. So the app asks Google directly via `tokeninfo`,
which returns the token's actual remaining life, and re-stamps. If the token is
genuinely dead the call 400s and the normal expiry path takes over — the right
outcome, reached for a real reason instead of a stale string.

Also fixed: **GIS is loaded `async defer`**, so `window.google` may not exist
when the first refresh fires on a cold load. `getTokenClient()` returned null and
the refresh reported failure instantly — a load-order race being shown to the
user as a dead session. It now waits up to 3s.

### Unassigned notes — the button was missing, not the data
> "These 15 notes not assigned, can't take any action here."

`Notes.jsx` already had a working `assignTo()` — it stamps `assigned_to` /
`assigned_by` and moves the note to lane `todo`, which is exactly what turns a
note into a task in TaskStack — and an `assigning` state variable. **Nothing ever
called `setAssigning` and no picker was ever rendered.** The only button on an
unassigned note was ✓ Done, so a note that needed somebody to act had one exit:
pretend it was handled.

So the answer to *"would this happen again?"* is **yes, forever** — it was never
a data problem. The + Note button does not ask for an owner, so notes arrive
unowned by design, and there was no way to hand one over. **Give to…** is now
rendered next to Done. No SQL needed.

The 15 split into two clean populations:

| | What they are |
|---|---|
| **8** · lane `doing`, has `job_id`, Jul 27–28, several with a NULL author | Import residue. Every body is a **verbatim copy of its job's `issue`**, and **every one of those jobs is already terminal** (archived / lost / dead / billed). Two are exact duplicates of each other. They carry nothing the job does not. |
| **7** · lane `note`, 6 with a `customer_id`, Jul 27 – Aug 19, real authors | Genuine client notes. These need an owner, and now they can have one. |

**Migration 051** closed the eight on Sara's instruction. The seven are left for
her to route with the new button. Backup: `notes_backup_051`.

The Bob/Wally note reads "Yesterday" correctly — `created_at` is Aug 19 at
10:53 AM Denver, and its own body says *"Tomorrow, 8/20/2026 Bob and Wally are
onsite."* Written on the 19th about the 20th. Not a timezone display bug.

### Texting the person who owns a task — DONE
> "JR has a task on this card… I can't click on this task. I want to click it, I
> am the creator of the task. I want to be able to text JR. I have Twilio now."

The task block on the job card was a read-only label. The one thing the creator
of a task wants from that card is to chase whoever owns it, and there was no
control for it anywhere. Each task now carries **📱 Text {name}** — an editable
message, the number it will dial, and a live segment count (these bill per 160
characters, and a link pushes most messages to two on its own).

**The plumbing was already complete and unreachable, twice over.**

`api/send-sms.js` (Twilio, CORS, rate-guarded) and `services/sms.js` both
existed. `sendSms` had **zero callers**. And it could not have had any:

> the endpoint accepted only a **Supabase session token**, and Overwatch has
> never had one — it signs in with Google OAuth directly and talks to Supabase
> with the anon key under permissive RLS. There is no Supabase user to get a
> token for. `sms.js` sent no `Authorization` header at all. **Every call from
> the browser would have returned 401.**

So `authorize()` now also accepts the **Google** token the app actually holds:
verified against Google's userinfo, with the resulting address required to be on
a company domain (`SMS_ALLOWED_DOMAINS`, defaulting to the three DRH/JNB ones).
Nothing secret reaches the client and the sender is a named person, not anyone
who can reach the URL.

The draft is deliberately **not** the raw task body — several of those still
carry the old intake template inline, which is not something to send a person.
It leads with the customer and the **last paragraph** (the most recent thing
anybody added — the actual ask), then a short link.

Every text sent is logged as an archived note on the job, so it is part of the
record rather than something that happened only on somebody's phone.

**Needs in Vercel:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either
`TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`. If any is missing the
endpoint says exactly which, and the card shows it.

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
- **`job_number` was in three live queries and does not exist.** PostgREST 400s
  the whole query on an unknown column, and all three destructured the error
  away, so each failed silently and permanently:
  - `services/schedule.js` re-read the job before booking — the "NEVER TRUST THE
    PASSED JOB" guard written specifically to stop duplicate calendar events.
    `fresh` came back undefined every time, so **that guard has never once run**.
  - `customersApi.getAllNotes` returned `[]` for **every customer, always** — the
    customer view showed no notes for anybody and looked like a client nobody had
    ever written about. Now reads `p_number` (frozen, but reading is fine).
  - `createLinkedJob` still calls it; that path is separately dead on
    `parent_job_id` and is not repaired here.
- **The atlas never mapped Supabase Storage.** The word appears zero times. Photos live in a
  bucket, and a bucket is not a table, so it was invisible to the method used.
