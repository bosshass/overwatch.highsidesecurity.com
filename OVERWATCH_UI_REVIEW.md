# Overwatch — UI Consistency Review

**Reviewed:** May 10, 2026 — against `main @ aa9840d` (cloned to `~/code/overwatch.highsidesecurity.com`)
**Reviewer:** Augment (read-only review, no code edits made)
**Companion to:** `OVERWATCH_REVIEW.md` (May 9, 2026 — backend / bug / security pass)
**Scope:** UI consistency only. Backend correctness, security, and dead-code findings live in the May-9 review and are not duplicated here.

---

## TL;DR

Overwatch has **18 user-reachable surfaces** and **no shared primitive layer**. Every surface re-invents:

- the page header (8 distinct back-button + title patterns across 12 routed views)
- the modal/sheet shell (8 different overlay opacities, 9 zIndex levels, 4 anchor positions)
- the "schedule a job" flow (5 separate implementations writing the same Google Calendar event)
- the job-status pill (3 separate `STATUS_LABELS` / `STATUS_COLORS` maps; `JobDetail` does its own switch-statement styling)
- the visual mode (`JobFinishSheet` and `TechWorkToday` are light-mode `#ffffff/#1B2A4A`; every other view is dark-mode `#0f1729/#e2e8f0`)

The single canonical primitive that does exist — `<JobFinishSheet>` (`src/components/JobFinishSheet.jsx`) — is a useful template for what the rest of the codebase should look like, but its colors fork from the rest of the app.

This review produces a **Screen × Action matrix**, an inventory of **visual primitives**, the **top 10 worst offenders**, and a **5-phase unification plan** that does not require a framework rewrite.

---

## Pass 1 — Screen taxonomy (the 18 surfaces)

### 1.1 Active full-screen routes (14)

| # | Route | Component | File | Lines | Who lands here |
|---|---|---|---|---:|---|
| 1 | `/` | `HomeScreen` (inline in App.jsx) | `src/App.jsx:686-774` | 89 | Everyone |
| 2 | `/calendar` | `TechCalendar` | `src/views/TechCalendar.jsx` | 1,278 | Operators + techs |
| 3 | `/work` | `TechWorkToday` | `src/views/TechWorkToday.jsx` | 389 | Techs (primary), operators |
| 4 | `/queue` | `Queue` | `src/views/Queue.jsx` | 851 | Operators |
| 5 | `/billing` | `Billing` | `src/views/Billing.jsx` | 848 | Operators (Accounting default) |
| 6 | `/todos` | `ThingsToDo` | `src/views/ThingsToDo.jsx` | 356 | Operators |
| 7 | `/newjob` | `NewJobModal` (as route) | `src/components/NewJobModal.jsx` | 845 | Everyone |
| 8 | `/lifeline` | placeholder | `src/App.jsx:548-557` | 10 | Placeholder |
| 9 | `/command` | `CommandCenter` | `src/views/CommandCenter.jsx` | 698 | Operator-only |
| 10 | `/office` | `OfficeHub` | `src/views/OfficeHub.jsx` | 1,475 | Operator-only |
| 11 | `/dashboard` | `OwnerDashboard` | `src/views/OwnerDashboard.jsx` | 1,095 | Operator-only |
| 12 | `/board` | `BoardView` | `src/views/BoardView.jsx` | 2,290 | Operators (Shana defaults here) |
| 13 | `/scheduler` | `Scheduler` | `src/views/Scheduler.jsx` | 962 | Operators |
| 14 | `/quicknotes` | `QuickNotes` | `src/views/QuickNotes.jsx` | 462 | Operators |
| 15 | `/admin/gap` | `AdminGap` | `src/views/AdminGap.jsx` | 364 | Operator-only |

### 1.2 Modal-launched full-flow surfaces (4)

These behave as full screens visually (full-viewport overlay) but don't have a route:

| # | Component | File | Lines | Launched from |
|---|---|---|---:|---|
| 16 | `JobDetail` | `src/components/JobDetail.jsx` | 1,185 | OwnerDashboard, OfficeHub, TechCalendar |
| 17 | `JobFinishSheet` | `src/components/JobFinishSheet.jsx` | 385 | App deep-link, TechCalendar, TechWorkToday |
| 18 | `ScheduleModal` | `src/components/ScheduleModal.jsx` | 738 | JobDetail (only — see §4 finding W-3) |
| (alt 18) | `NewJobModal` (as modal) | `src/components/NewJobModal.jsx` | 845 | OfficeHub, TechCalendar (also a route) |

**That is the 18.** Every other modal/component (`HelpBot`, `GlobalSearch`, `QuickGuide`, `StuckAlertGate`, `NotificationBell`, `InboxBar`, `NotesPanel`, identity/setup/backfill in App.jsx, etc.) is a slot inside one of the 18, not a destination.

### 1.3 Dead surfaces (excluded — already flagged in the May-9 review §2.2)

`OwnerView.jsx` (267 lines), `TechView.jsx` (238 lines), `TechTodayView.jsx` (983 lines) are imported nowhere. They will be deleted in Phase 1 alongside the consistency work. **Total dead: 1,488 lines — not counted in any matrix below.**

---

## Pass 2 — Action × Screen matrix

### 2.1 Action vocabulary (rows)

Every write the SPA can make, expressed as a verb. Grouped by domain. "Source of truth" notes whether the action lands in Google Calendar, Supabase, or both.

| Domain | Action key | Verb | Source of truth |
|---|---|---|---|
| Job lifecycle | `create_job` | Create a new job (intake / quick-add) | Supabase `jobs` + GCal event |
| | `transition_status` | Change `jobs.status` (NEW → READY → SCHEDULED → BILLED, etc.) | Supabase `jobs.status` + `job_history` |
| | `archive_merge` | Mark superseded / merge into another job | Supabase |
| Scheduling | `schedule_job` | Pick tech + day + time, create GCal event, set `jobs.status='scheduled'` | GCal + Supabase |
| | `reschedule_job` | Move existing GCal event to new slot | GCal |
| | `tag_calendar_event` | Patch `[BILL IT] / [SCHEDULED] / [NEEDS PARTS] / [BLOCKED] …` into GCal `summary` | GCal |
| | `move_to_queue` | Move event to TENTATIVELY_SCHEDULED + tag original `[MOVED TO QUEUE]` | GCal |
| Time | `log_time_entry` | Write `time_entries` row with disposition (`bill_it / return / in_progress / estimate`) | Supabase `time_entries` |
| | `mark_billed` | `time_entries.billed = true`, optionally store `invoice_ref` | Supabase |
| Returns | `create_return_card` | Write `return_cards` row + queue GCal event | Supabase + GCal |
| Notes | `add_note` | Append note to `job_history` (or completion_notes, or calendar description) | Supabase / GCal |
| | `quick_note` | Create job with `status='quick_note'`, `job_type='task'` | Supabase |
| Customer | `link_customer` | Patch GCal description with deep link + customer ID | GCal |
| | `edit_customer` | Update `customers` row | Supabase |
| Inbox / triage | `acknowledge` | `acknowledged_at` + `status='archived'` | Supabase |
| | `convert_to_job` | Change `job_type` from `task` → `service_res` | Supabase |
| Search | `search_global` | Find customer/job/material across the app | Read-only |
| Estimates | `update_qbo_status` | `jobs.qbo_estimate_status = won/lost/sent/to_bill` | Supabase |
| | `approve_install` | Manager approval gate before billing an install | Supabase |
| Tasks | `assign_item` | Assign queue/return to a tech (no scheduling yet) | GCal description / Supabase |

**20 distinct actions.** Several are aliases when read carelessly (e.g. `transition_status` and `tag_calendar_event` are the same logical action through two different sources of truth — see worst offender W-2).

### 2.2 The matrix (presence + variant)

Legend per cell:
- `—` not present
- `B` ButtonGroup (multi-action toolbar / footer)
- `M` Mode picker (tile selector that opens sub-flow)
- `R` Row affordance (button/icon embedded in a list row)
- `D` Dropdown / select
- `H` Header action (top-right of view)
- `S` Modal/sheet launcher
- `I` Inline / contextual (e.g. swipe, long-press, expand-then-show)
- Suffix `*` = duplicates a write that another screen also performs but with different code path / different look

| Action | Home | TechCal | Work | Queue | Billing | Todos | NewJob | Cmd | Office | Dash | Board | Sched | Quick | Admin | JobDet | Finish | SchedM |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `create_job` | — | S* | — | — | — | — | M | — | S* | — | — | — | S* | — | — | — | — |
| `transition_status` | — | (via JobDet) | — | — | R* | R* | — | — | R* | — | R* | — | — | R* | B | — | — |
| `archive_merge` | — | — | — | — | — | — | — | — | — | — | — | — | — | — | B | — | — |
| `schedule_job` | — | — | — | I* | — | — | — | M* | I* | — | I* | I* | — | — | S (canonical) | — | full screen |
| `reschedule_job` | — | I (drag) | — | — | — | — | — | I | — | — | — | — | — | — | S | — | — |
| `tag_calendar_event` | — | I* | — | — | — | — | — | — | — | — | I* (heaviest) | — | — | — | — | (writes new tag) | — |
| `move_to_queue` | — | I* | — | — | — | — | — | — | — | — | I* | — | — | — | — | — | — |
| `log_time_entry` | — | (via Finish) | (via Finish) | — | R (edit) | — | — | — | — | — | — | — | — | — | — | central | — |
| `mark_billed` | — | — | — | — | R | — | — | — | — | — | — | — | — | — | B (`To Bill→Billed`) | — | — |
| `create_return_card` | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | central | — |
| `add_note` | — | I | — | — | I | I | — | I | I | — | I | — | I | — | I | I | — |
| `quick_note` | — | — | — | — | — | — | M | M (task mode) | — | — | — | — | central | — | — | — | — |
| `link_customer` | — | I | — | — | — | — | I | — | I | — | — | — | — | — | I | I | — |
| `edit_customer` | — | — | — | — | — | — | — | — | central | — | — | — | — | — | — | — | — |
| `acknowledge` | — | — | — | — | — | — | — | — | (via InboxBar) | (via InboxBar) | — | — | — | — | — | — | — |
| `convert_to_job` | — | — | — | — | — | — | — | — | (via InboxBar) | (via InboxBar) | — | — | (via InboxBar) | — | — | — | — |
| `search_global` | H | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| `update_qbo_status` | — | — | — | — | — | — | — | — | — | — | R (most) | — | — | — | B | — | — |
| `approve_install` | — | — | — | — | — | — | — | — | (via InstallationApprovalModal) | — | — | — | — | — | — | — | — |
| `assign_item` | — | — | — | — | — | R | — | — | I (quickAssign) | — | — | — | — | — | — | — | — |

### 2.3 What the matrix tells us

- **Schedule** appears in 7 surfaces with **5 distinct UI implementations** (see W-3).
- **Status transition** appears in 7 surfaces with **4 distinct write paths** (see W-2).
- **Tag calendar event** is the most-duplicated action: 11 PATCH call sites just inside `BoardView.jsx` (`303, 325, 343, 414, 435, 473, 502, 1096, 1125, 1152, 1476`) plus 3 in `TechCalendar.jsx`, 5 in `Billing.jsx`, 2 in `ThingsToDo.jsx`, 3 in `QuickNotes.jsx`, 1 in `App.jsx` (backfill), 1 in `JobFinishSheet.jsx`. **27 PATCH sites** for what is logically one operation.
- **Search** is a Home-only header action — no other view has it. Operators on /board, /office, /dashboard cannot search without going Home first.
- `JobDetail` is the closest thing to a canonical "act on one job" surface (it owns merge, status transition, scheduling, billing, parts hold, completion-notes). But it isn't reachable from Queue, Billing, Todos, Board, or Scheduler — those views have their own row-level actions instead.

---

## Pass 3 — Visual primitive inventory

### 3.1 Color palette (occurrences in `*.jsx`)

Top 25 hex literals, by frequency (`grep -rhoE "'#[0-9a-fA-F]{6}'" src/`):

```
 351  #64748b   slate-500   secondary text
 290  #94a3b8   slate-400   tertiary text
 227  #e2e8f0   slate-200   primary text (dark mode)
 196  #1e293b   slate-800   secondary surface
 129  #22c55e   green-500   success / "go"
 128  #475569   slate-600   tertiary text alt
 126  #f59e0b   amber-500   warning / pending
 122  #334155   slate-700   border (canonical, 111 hits as `border:'1px solid #334155'`)
 104  #00c8e8   custom cyan brand accent
  94  #0f1729   custom navy primary surface (dark mode)
  86  #3b82f6   blue-500    info
  61  #ef4444   red-500     error / destructive
  55  #0f172a   slate-900   alt primary surface (used in 4 files)
  29  #6b7280   gray-500    !! tailwind-gray, not slate — only in TechWorkToday + JobFinishSheet (light mode)
  26  #8b5cf6   violet-500
  18  #f87171   red-400
  13  #06b6d4   cyan-600
  12  #f97316   orange-500  Austin tech color
  12  #60a5fa   blue-400
  12  #4ade80   green-400
  12  #1B2A4A   custom navy !! light-mode primary text (TechWorkToday + JobFinishSheet only)
  12  #1a2332   custom navy !! login-screen-only gradient endpoint
  11  #eab308   yellow-500
  11  #dc2626   red-600
  11  #9ca3af   gray-400    !! tailwind-gray (light mode)
```

**Findings:**

- **F-1 Two parallel palettes are in use.** Slate-* (`#64748b, #94a3b8, #e2e8f0, #475569, #334155`) is dark mode (16 of 18 surfaces). Gray-* (`#6b7280, #9ca3af, #d1d5db, #e5e7eb, #f3f4f6`) is light mode (only `TechWorkToday.jsx:184` and `JobFinishSheet.jsx:331-385`). Same purpose, different hex — not a deliberate theme switch, just a fork.
- **F-2 Three primary-surface colors:** `#0f1729` (94 hits), `#0f172a` (55 hits), `#1a2332` (12 hits). All three are "almost-black-navy". `#0f172a` is slate-900 from Tailwind's default; `#0f1729` and `#1a2332` are custom. Three different "page background" values.
- **F-3 Tech color assignments are inconsistent.** `BoardView.jsx:18` says Austin = `#f97316` orange. `TechWorkToday.jsx:259` says Austin = `#3b82f6` blue. `App.jsx` doesn't declare them. The matrix view (TechCalendar) has its own assignments in `config/calendars.js`. **No central tech-color map.**

### 3.2 Modal / sheet shells

`grep -rnE "position: 'fixed', inset: 0"` returns **30 distinct modal shell instances** across 14 files.

**Overlay backgrounds used (sorted by darkness):**

```
rgba(0,0,0,0.6)    TechCalendar (ScheduleSheet inner) — lightest
rgba(0,0,0,0.7)    JobSearchModal, BoardView (mobile)
rgba(15,23,41,0.75) JobFinishSheet — uses custom navy
rgba(0,0,0,0.75)   QuickNotes
rgba(0,0,0,0.85)   JobDetail (4×), App.jsx setup, App.jsx backfill, Scheduler, TechCalendar, NewJobModal (3×)
rgba(0,0,0,0.88)   GlobalSearch
rgba(0,0,0,0.9)    JobDetail (1×), CommandCenter, App.jsx identity-picker
rgba(0,0,0,0.92)   NewJobModal (1×)
rgba(0,0,0,0.95)   ScheduleModal, QuickGuide
#000000aa          Billing (raw 67% — equivalent to rgba(0,0,0,0.667))
```

**That's 10 different overlay opacity values for one logical concept.**

**zIndex values used:** `2, 5, 10, 20, 99, 100, 200, 300, 400, 500, 600, 1000, 9000, 9999`. **No scale.** Modals on `/board` use `1000`, `300` (ScheduleModal it launches), `500` (deeper sheet). `/calendar` uses `300`, `400`, `500`. `JobSearchModal` uses `9000`. `StuckAlertGate` uses `9999`. Stacking is purely accidental.

**Anchor pattern:**

| Anchor | Files |
|---|---|
| Centered (`alignItems:'center', justifyContent:'center'`) | NewJobModal, JobDetail, App.jsx (3×), Scheduler, Billing, BoardView |
| Bottom sheet (`alignItems:'flex-end'`) | CommandCenter, JobFinishSheet, QuickNotes, TechCalendar (2×) |
| Full screen (no flex anchor) | JobDetail (3×), GlobalSearch, ScheduleModal, NewJobModal (1×) |

Three different "feels" for what the user reads as the same gesture.

### 3.3 Page header / shell pattern

`<ViewShell>` (`App.jsx:481-512`) is the closest thing to a canonical header. **It is used by only 6 of 14 routed views**:

| Uses ViewShell | Renders own header |
|---|---|
| `/calendar`, `/command`, `/office`, `/dashboard`, `/board`, `/scheduler` | `/work`, `/queue`, `/billing`, `/todos`, `/newjob`, `/quicknotes`, `/admin/gap` |

Each of the 7 "rolls own header" views has a different back-button treatment:

| View | Back button style | Border-bottom | Padding |
|---|---|---|---|
| `Billing.jsx:417` | ghost outline `1px solid #334155` | `1px solid #1e293b` | `14px 16px` |
| `Queue.jsx:689` | (no back at top — uses `← Back` only inside scheduling sub-views with `#334155` filled) | `1px solid #334155` | `16px` |
| `ThingsToDo.jsx:322` | borderless link, fontSize 14 | `1px solid #1e293b` | `14px 16px` |
| `QuickNotes.jsx:216` | borderless link, fontSize 14 | `1px solid #1e293b` | `14px 16px` |
| `TechWorkToday.jsx:190` | **white-mode** ghost `1px solid #d1d5db` | `1px solid #e5e7eb` | `12px 16px` |
| `Scheduler.jsx:560` | bare `←` arrow, no border | (no border) | unspecified |
| `AdminGap.jsx:94` | `S.backBtn` (table-row visual) | `2px solid #1e293b` | varies |
| `ViewShell` (`App.jsx:488`) | filled `#1e293b`, fontWeight 700, "← Home" | `1px solid #1e293b` | `12px 16px` |

**8 distinct header patterns for an operator who navigates between 8 screens in a single session.**

### 3.4 Status pills / badges

There is **no shared `<StatusPill>` component**. Three separate definitions exist:

- `src/components/JobSearchModal.jsx:12` — `STATUS_LABELS` (10 statuses)
- `src/components/JobSearchModal.jsx:24` — `STATUS_COLORS` (matching colors)
- `src/views/AdminGap.jsx:16` — `STATUS_LABELS` (different subset, different colors)

Plus inline rendering in:

- `src/components/JobDetail.jsx:331-353` — switch-statement on `JOB_STATUS.*` rendering different colored chips
- `src/views/TechTodayView.jsx:131` — `getStatusStyle(status)` (in dead view)
- `src/views/Billing.jsx` — disposition pills rendered inline (4 colors)
- `src/views/BoardView.jsx` — column headers double as status pills with their own color map
- `src/views/Scheduler.jsx` — `PRIORITIES[item.priority].color` pills, different scale

**`borderRadius: 999`** (the canonical "pill" radius) appears **0 times** in the codebase. Every "chip" uses 4, 6, 8, 10, 12, or 50% — there is literally no consistent pill shape.

### 3.5 The dark/light fork

```
Dark mode (16 surfaces):  bg #0f1729, text #e2e8f0, border #334155, palette slate-*
Light mode (2 surfaces):  bg #f8f9fa/#ffffff, text #1B2A4A, border #d1d5db/#e5e7eb, palette gray-*
```

The two light-mode surfaces are **the most important tech-facing screens**:

- `TechWorkToday.jsx:184-260` — `/work`, the home screen for techs
- `JobFinishSheet.jsx:331-385` — the canonical "finish a job" sheet

A tech opens `/work` (white) → taps "Finish" → `JobFinishSheet` overlay (white) → confirms → returns to `/work` (white). That subflow is visually consistent. But that same tech then taps "Calendar" or "Home" → sudden mode switch to dark navy. **The fork is not a bug — it appears to be a design decision (light = tech action surfaces, dark = operator data surfaces) — but it is undocumented and inconsistently applied** (e.g. `TechCalendar.jsx` is dark-mode but is also a tech-facing surface).

---

## Pass 4 — Worst offenders (top 10)

### W-1 — Eight different page headers across 14 routed views

**Cite:** §3.3 above.
**Cost:** Every operator has to relearn "where is the Home button" per screen. Visual hierarchy of view title vs. action vs. user identity is inconsistent.
**Fix surface:** Adopt `<ViewShell>` for every routed view (7 views to migrate). Estimated 200 lines deleted, 0 added.

### W-2 — `transition_status` has 4 write paths to one column

The same logical action — change `jobs.status` — is written four ways:

| Path | Sites | Concern |
|---|---|---|
| `jobsApi.changeStatus(id, newStatus, userEmail, notes)` (canonical, writes `job_history`) | `JobDetail.jsx:144,167,209` | ✅ |
| `jobsApi.update(id, {status: ...}, userEmail)` | `OfficeHub.jsx:174`, `JobDetail.jsx:206,312` | Bypasses `job_history` write |
| Direct `supabase.from('jobs').update({status: ...})` | `InboxBar.jsx:53,83`, `AdminGap.jsx:79`, `BoardView.jsx:355` | Bypasses `job_history` AND `updated_by` AND any future hooks |
| Calendar tag PATCH (`[BILL IT]`, `[SCHEDULED]`) | 27 sites across 7 files | Different source of truth — no Supabase write at all |

**Cost:** `job_history` is the audit log. Three of four paths skip it silently. This was flagged in the May-9 review (B-1) as a security/correctness issue but it's also a UI consistency issue: from the user's perspective the same button on different screens has different downstream effects.
**Fix surface:** Make `jobsApi.changeStatus` the only allowed mutator; replace direct `.update({status})` calls.

### W-3 — Five separate "Schedule a job" implementations

| Where | File: lines | Shape | Source of truth |
|---|---|---|---|
| `<ScheduleModal>` (canonical) | `src/components/ScheduleModal.jsx:131-738` | Full-screen dark sheet, week picker, helper-tech, GCal busy lookup | Both (Supabase `job_assignments` + GCal event POST) |
| `<Queue>` inline | `src/views/Queue.jsx:515-660` | Day-grid + slot picker | GCal-only |
| `<BoardView>` inline | `src/views/BoardView.jsx:945-1490` | Modal with tab sub-menus, recommends slots | GCal-only |
| `<Scheduler>` view | `src/views/Scheduler.jsx:470-540` | Full-screen recommendation engine | GCal-only |
| `<CommandCenter>` mode picker | `src/views/CommandCenter.jsx:226-340` | Bottom sheet with mode tiles, then form | GCal-only |
| `<OfficeHub>` `quickAssign()` | `src/views/OfficeHub.jsx:174-184` | Single-click row affordance, no slot picker | Supabase + GCal |

**Cost:** 5 different scheduling experiences. The `Supabase + GCal` ones write `job_assignments` correctly; the GCal-only ones don't, so a job scheduled from BoardView won't appear in the OwnerDashboard "scheduled jobs" pipeline until the next `calendarSync` reconciliation. **This is also flagged in the May-9 review (B-4: CommandCenter passes a tech ID where calendar ID is required — broken).**
**Fix surface:** Replace 4 of 5 with `<ScheduleModal>`. Already used by `JobDetail`. Estimated 1,200 lines deleted across BoardView/Queue/CommandCenter/Scheduler.

### W-4 — 27 GCal PATCH sites for "tag this event"

**Cite:** §2.3.
**Cost:** Each site has its own retry behavior, error message, and tag vocabulary. `[BILL IT]` and `[TO BILL]` and `[BILLED]` and `[INVOICE]` and `[INVOICED]` and `[COMPLETED]` are all "done" per `BoardView.jsx:43` (`DONE_TAGS`). Some PATCH sites also strip the description; some don't.
**Fix surface:** Single helper `tagCalendarEvent(calendarId, eventId, tag, accessToken)` in `src/services/calendarSync.js`. Replace inline fetches.

### W-5 — Status pill: 3 label maps, 0 shared component, 0 `borderRadius:999`

**Cite:** §3.4.
**Cost:** Same status renders differently on Billing vs. JobDetail vs. JobSearchModal. The user cannot rely on color-of-pill = state-of-job.
**Fix surface:** New `<StatusPill status={JOB_STATUS.*} />` in `src/components/StatusPill.jsx`. Single label/color map in `src/utils/statusMachine.js` (where `JOB_STATUS` already lives).

### W-6 — Modal stack is unmanageable

zIndex values across the codebase: `2, 5, 10, 20, 99, 100, 200, 300, 400, 500, 600, 1000, 9000, 9999` — 14 distinct levels.
**Cost:** When `<JobDetail>` (z=200) opens `<ScheduleModal>` (z=300) which opens a confirmation sub-modal (z=300) — the second-level modal sits on top of itself by accident. `JobSearchModal.jsx:113` (z=9000) renders **above** `StuckAlertGate.jsx:167` (z=9999) **only because** the gate is set higher; flip those by accident and the search disappears behind a JR alert.
**Fix surface:** Define `Z = { base:0, sticky:10, navOverlay:50, dropdown:100, modal:200, modalNested:300, toast:400, criticalGate:500 }` in `src/utils/zIndex.js`. Migrate all 30 modal sites.

### W-7 — Three primary-surface colors (`#0f1729`, `#0f172a`, `#1a2332`)

**Cite:** §3.1, F-2.
**Cost:** Subtle banding when two regions of the same screen use different "page" backgrounds (visible in `OwnerDashboard.jsx:132` next to `OwnerDashboard.jsx:227`).
**Fix surface:** Single token `BG = '#0f1729'`. Find/replace.

### W-8 — "Search" only exists on Home

**Cite:** §2.2 — `search_global` row.
**Cost:** Operators on `/board` who notice "wait, when did Smith order that?" have to navigate Home → Search → Result. The `<GlobalSearch>` component is already a portable overlay (`src/components/GlobalSearch.jsx:111-280`); `<ViewShell>` could expose a search trigger in its top bar.
**Fix surface:** Add search button to `<ViewShell>`'s right cluster (already has identity, backfill, sign-out — natural place).

### W-9 — Tech color assignments don't agree

`BoardView.jsx:18` says Austin orange; `TechWorkToday.jsx:259` says Austin blue. `JR` is green in both. `Brian` is missing from `BoardView`'s `TECH_CALS` entirely.
**Fix surface:** Single export in `src/config/calendars.js` (`TECH_COLORS`). Already imported by App.jsx but not used by BoardView or TechWorkToday.

### W-10 — `JobFinishSheet` uses a different visual language than the rest of the dark surfaces it lives inside

**Cite:** §3.5. The component renders white-on-navy with pastel buttons (`#ecfeff`, `#fffbeb`, `#f5f3ff`) inside a dark TechCalendar (overlay rgba(0,0,0,0.85), then suddenly white sheet). Visually jarring the first time.
**Fix surface:** Pick one. Options:
1. JobFinishSheet adopts the dark palette (`#0f1729` sheet, `#e2e8f0` text) — cheaper, preserves no-light-fork rule.
2. The codebase commits to "tech surfaces are light, operator surfaces are dark" and `TechCalendar` (when launched by a tech) follows light mode. Expensive (re-themes a 1,278-line view).
**Recommendation:** Option 1. The light mode does not appear elsewhere (only `JobFinishSheet` and `TechWorkToday`); aligning to dark gives a consistent app.

---

## Pass 5 — Phased unification plan

Each phase is sized to be one focused PR. Phases are **independently shippable** — phase 2 does not require phase 1.

### Phase 0 — Decisions (no code; one async meeting)

Lock in the following, in this document, before any phase 1 code:

1. **Theme:** dark only? Or formalize "tech surfaces are light, operator surfaces are dark"?
   *Recommendation: dark only.* (See W-10 reasoning.)
2. **Canonical primary action color:** `#00c8e8` (cyan brand) is used 104 times. Lock it.
3. **zIndex scale:** the 8-level scale in W-6.
4. **Source-of-truth for status:** Supabase `jobs.status`. GCal tags become a *projection*, not a source. (Already implicit — make it explicit.)
5. **Tech color map:** single export, `config/calendars.js`. (Already imported as `TECH_COLORS` — verify completeness.)

### Phase 1 — Shared primitive kit (~1-2 sessions, 0 visual change to user)

New files in `src/components/ui/`. Each is a thin extraction from the existing dominant variant:

| Primitive | Replaces | Where used today | Source for canonical version |
|---|---|---|---|
| `<ViewShell>` | 7 ad-hoc headers | already in `App.jsx:481-512` | move out of App.jsx as-is |
| `<ModalSheet>` | 30 fixed-inset modal divs | scattered | bottom-sheet variant from `JobFinishSheet.jsx:330-340` adapted to dark |
| `<StatusPill>` | 3 label maps + 4 inline switch blocks | scattered | `JobSearchModal.jsx:12-50` + `JOB_STATUS` from `statusMachine.js` |
| `<PrimaryButton>` / `<GhostButton>` / `<DangerButton>` | ~200 inline button styles | scattered | `App.jsx`'s `ViewShell` button + `BoardView.jsx:1671` |
| `<EmptyState>` | 12 ad-hoc "Nothing here" blocks | scattered | `Billing.jsx`'s pattern |
| `<LoadingState>` | 14 ad-hoc loading blocks | scattered | `Billing.jsx`'s pattern |
| `tagCalendarEvent()` helper | 27 inline PATCH sites | scattered | extract from `BoardView.jsx:343` |
| `Z` zIndex scale | 14 ad-hoc z values | scattered | new file `src/utils/zIndex.js` |
| `theme.js` color tokens | 25+ raw hex literals | scattered | export `BG`, `SURFACE`, `BORDER`, `TEXT_*`, `ACCENT`, `STATE_*` |

**Net impact at end of Phase 1:** primitives exist but nothing uses them yet. **Build must still pass** — pure addition.

### Phase 2 — Header / shell unification (1 session)

Migrate the 7 routed views that don't use `<ViewShell>` to use it:

- `Billing.jsx:416-430` → `<ViewShell title="Billing" rightActions={...}>`
- `Queue.jsx:689-720`
- `ThingsToDo.jsx:321-340`
- `QuickNotes.jsx:213-240`
- `TechWorkToday.jsx:184-260` (also drops light-mode header)
- `Scheduler.jsx:560-580`
- `AdminGap.jsx:94-105`

Result: every operator sees the same header on every screen. Search button added to `<ViewShell>` per W-8. Estimated **−400 lines, +50 lines**.

### Phase 3 — Action consolidation: schedule + finish (2 sessions)

**3a — Schedule:** delete 4 of 5 schedule UIs, route them all to `<ScheduleModal>`. (`<JobDetail>` already uses it correctly.)

- `Queue.jsx:515-660` → open `<ScheduleModal>` from row
- `BoardView.jsx:945-1490` → open `<ScheduleModal>` from item card
- `CommandCenter.jsx:226-340` → open `<ScheduleModal>` from event sheet
- `Scheduler.jsx:470-540` (the recommendation engine) — keep, but its "Schedule" button opens `<ScheduleModal>` rather than POSTing inline

Estimated **−1,200 lines deleted**.

Side effect: closes May-9 review B-4 (CommandCenter passes wrong ID).

**3b — Finish:** `<JobFinishSheet>` adopts dark palette per W-10 option 1. Single component change. Estimated **±0 lines**, 100% visual.

### Phase 4 — Status pill rollout (1 session)

Replace every inline status chip with `<StatusPill>`:

- `JobDetail.jsx:331-353` (delete 22 lines of switch)
- `JobSearchModal.jsx:12-50` (delete the entire local map)
- `AdminGap.jsx:16-30`
- `Billing.jsx` disposition pills (note: dispositions, not statuses — separate `<DispositionPill>` may be needed)
- `BoardView.jsx` column headers
- `Scheduler.jsx` priority pills (consider `<PriorityPill>`)

Estimated **−150 lines, +20 lines**.

### Phase 5 — Long tail (ongoing)

- **5a Color tokens:** mechanical find/replace `#0f1729 → BG`, `#1e293b → SURFACE`, etc. Defer to a dedicated session, treat as one commit per token. ~30 minutes.
- **5b Modal stack hygiene:** migrate all 30 fixed-inset divs to `<ModalSheet>`. ~2 sessions.
- **5c Direct supabase.from('jobs').update writes:** replace with `jobsApi.changeStatus` per W-2. Closes May-9 review B-1.
- **5d Tech color map:** delete `BoardView.jsx:21-23` `TECH_CALS` color column, import from `config/calendars.js`. 5 minutes.
- **5e Add search to non-Home views:** trivial after Phase 2.

### Out of scope (per user direction, May 10, 2026)

- Lifeline ↔ Overwatch wire format. Lifeline owns its own client model.
- Migrating Overwatch off Google Calendar. **Overwatch will always rely on Google.**
- Native time entry inside Overwatch. (Overwatch keeps GCal source-of-truth via `time_entries.calendar_event_id`.)
- The 13 backend bugs and 3 P0 security findings in `OVERWATCH_REVIEW.md` — separate workstream.

---

## What NOT to refactor

- **`<JobFinishSheet>`'s logic** — it is the canonical "finish a job" flow and the cleanest component in the repo. Touch only colors (Phase 3b).
- **`<JobDetail>`'s state machine** — the `pendingAction → confirm modal → execute` pattern is the right pattern, even if visually verbose.
- **`config/calendars.js`** — single-source-of-truth pattern is already correct. Just make sure every tech-color consumer reads from it.
- **`api/sse.js` and the MCP tool surface** — not a UI concern. (Has its own P0 in the May-9 review.)
- **`HelpBot`, `QuickGuide`, `NotificationBell`, `StuckAlertGate`** — overlay UIs that work; visual fit can wait until Phase 5.

---

## Appendix A — Files inspected

```
src/App.jsx                                    (1,006 lines)
src/config/calendars.js                          (~120 lines)
src/config/roles.js                                (45 lines)
src/components/CustomerLookup.jsx                 (361 lines)
src/components/EnhancedDashboardMetrics.jsx       (305 lines)
src/components/GlobalSearch.jsx                   (~280 lines)
src/components/HelpBot.jsx                      (1,089 lines)
src/components/InboxBar.jsx                       (~150 lines)
src/components/InstallationApprovalModal.jsx      (344 lines)
src/components/JobCard.jsx                        (188 lines)
src/components/JobDetail.jsx                    (1,185 lines)
src/components/JobFinishSheet.jsx                 (385 lines)
src/components/JobSearchModal.jsx                 (280 lines)
src/components/NewJobModal.jsx                    (845 lines)
src/components/NotesPanel.jsx                     (~200 lines)
src/components/NotificationBell.jsx               (~160 lines)
src/components/PLDashboard.jsx                    (331 lines)
src/components/PLUpload.jsx                       (~190 lines)
src/components/QuickGuide.jsx                     (450 lines)
src/components/ScheduleModal.jsx                  (738 lines)
src/components/StuckAlerts.jsx                    (~180 lines)
src/components/TimeEntryBlock.jsx                 (~110 lines)
src/services/supabase.js                          (~940 lines)
src/services/calendarSync.js                      (~310 lines)
src/views/AdminGap.jsx                            (364 lines)
src/views/Billing.jsx                             (848 lines)
src/views/BoardView.jsx                         (2,290 lines)
src/views/CommandCenter.jsx                       (698 lines)
src/views/OfficeHub.jsx                         (1,475 lines)
src/views/OwnerDashboard.jsx                    (1,095 lines)
src/views/Queue.jsx                               (851 lines)
src/views/QuickNotes.jsx                          (462 lines)
src/views/Scheduler.jsx                           (962 lines)
src/views/TechCalendar.jsx                      (1,278 lines)
src/views/TechWorkToday.jsx                       (389 lines)
src/views/ThingsToDo.jsx                          (356 lines)
```

Excluded as dead (per `OVERWATCH_REVIEW.md` §2.2): `src/views/OwnerView.jsx`, `src/views/TechView.jsx`, `src/views/TechTodayView.jsx`.

## Appendix B — Things this review does NOT cover

- **Mobile vs. desktop responsiveness.** Spot checks suggest touch targets are generally acceptable (44px+) but no systematic audit was done.
- **Accessibility (ARIA, keyboard, focus trap).** The fixed-inset modals have no focus trap; tab order across views was not audited.
- **Animation / transition consistency.** Several views use ad-hoc `transition: all 0.2s` strings; no pattern enforced.
- **Empty-state copy.** "No items in backlog!" / "Nothing in {tab}" / "No new jobs today" / "📭" — voice and tone are inconsistent but this is a copy review, not structural.
- **Form-field sizing.** `inputStyle` is defined per-file (CommandCenter, NewJobModal, OfficeHub, ScheduleModal, Queue all have their own).

These are good candidates for a future Pass 6.
