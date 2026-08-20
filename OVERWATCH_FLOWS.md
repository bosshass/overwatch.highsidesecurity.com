# OVERWATCH — FLOWS & DATA ACCESS MAP

Every flow. Every table. Every read and every write, with the file and line that does it.

Generated from the code at `claude/overwatch-flows-data-access-yshrqi`. ~32,000 lines across
`src/` and `api/`. **14 tables. ~250 call sites.**

Note: the root `README.md` says "Calendar-only read dashboard. No database. No Supabase."
That is V3 documentation sitting in the V9 repo. It is wrong for this codebase — this app is
Supabase-backed and writes to 14 tables.

---

## 1. SYSTEM MAP

```
┌───────────────────────────────────────────────────────────────────────┐
│  BROWSER (React + Vite, deployed to Vercel)                           │
│                                                                       │
│  Google OAuth (implicit) ──► accessToken ──► Google Calendar API      │
│         │                                     (read + write events)   │
│         ▼                                                             │
│  src/App.jsx  — routing, identity, role gates                         │
│         │                                                             │
│         ├─ views/*      (screens)                                     │
│         ├─ components/* (modals + sheets)                             │
│         │                                                             │
│         └─ services/supabase.js ──► Supabase (anon key, RLS `true`)   │
│            services/schedule.js ──► the ONLY writer of sched. state   │
│            services/calendarSync.js ─► Google Calendar helpers        │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  VERCEL SERVERLESS (api/)                                             │
│                                                                       │
│  api/sse.js          — MCP server. 17 tools. ANON key. Claude talks   │
│                        to Overwatch through this.                     │
│  api/welcome-draft.js— Gmail welcome-draft. SERVICE ROLE key.         │
│  api/send-sms.js     — Twilio relay. SERVICE ROLE (auth check only).  │
└───────────────────────────────────────────────────────────────────────┘
```

**Three write surfaces reach the same database:** the browser (anon key), the MCP server
(anon key), and `welcome-draft` (service role). Only the browser goes through
`services/supabase.js`. The MCP server re-implements its own queries — see §7.

### Identity & role

| | |
|---|---|
| Auth | Google OAuth implicit flow, `src/App.jsx:362` |
| Scopes | `openid email profile calendar gmail.readonly gmail.send` (`App.jsx:47`) |
| Role source | Hardcoded `USER_CONFIG` map, `App.jsx:66-92`. Not the database. |
| Unknown email | Silently defaults to `role: 'tech'` (`App.jsx:115`) |
| Gate | `OperatorOnly` = `<Navigate to="/" replace/>` if not operator (`App.jsx:981`) |
| Also | `isRestricted` via `RESTRICTED_EMAILS` (`App.jsx:640`) — the real lockdown |

`info@drhsecurityservices.com` is a **shared mailbox** with `needsIdentity: true` — six people
sign in on it, so the app forces a who-are-you prompt via the `settings` table (§2.11).

---

## 2. TABLE INVENTORY

Ranked by traffic. For each: what it is, who writes it, who reads it.

| # | Table | Calls | Writers | Role |
|---|-------|------:|---------|------|
| 1 | `jobs` | 111 | 30 sites | The board. Everything. |
| 2 | `time_entries` | 34 | 12 sites | Field hours. **Billing truth.** |
| 3 | `customers` | 24 | 4 sites | Separate model. Never merge into jobs. |
| 4 | `notes` | 23 | 11 sites | Notes AND tasks. |
| 5 | `job_history` | 15 | 9 sites | Audit trail + note store. |
| 6 | `job_assignments` | 15 | 6 sites | Dispatch rows. |
| 7 | `techs` | 12 | 1 site | Roster + calendar IDs. |
| 8 | `return_cards` | 9 | 6 sites | Return-visit queue. |
| 9 | `settings` | 3 | 1 site | K/V. Identity force + tech capacity. |
| 10 | `estimates` | 3 | 2 sites | QBO sold work. |
| 11 | `activity_log` | 3 | 2 sites | Only ever `orphan_ignored`. |
| 12 | `push_tokens` | 2 | 2 sites | FCM device tokens. |
| 13 | `pl_data` | 2 | 1 site | P&L spreadsheet upload. |
| 14 | `feedback` | 2 | 1 site | HelpBot. |

---

### 2.1 `jobs` — 111 call sites

The central table. A job is a unit of customer work on the board.

**Statuses** (`services/supabase.js:35-54`) — 18 of them:
`new · needs_details · needs_parts · pending_decision · pending_materials ·
ready_to_schedule · return_pending · scheduled · complete · to_bill · billed ·
needs_estimate · estimate_sent · won · lost · blocked · dead · archived`

**Column families:**

| Family | Columns |
|---|---|
| Identity | `id, job_number (DRH-NNNN), p_number, s_number, parent_job_id` |
| Customer | `customer_id, customer_name, customer_phone, customer_address, customer_email` |
| Work | `issue, job_type, priority, status, completion_notes, action_note, blocked_tags` |
| Scheduling | `scheduled_date, scheduled_event_id, scheduled_calendar_id, tentative_date, tentative_event_id, calendar_event_id, calendar_id` |
| Ownership | `assigned_to, tech_assigned, tech_name` |
| Money | `estimate_amount, estimated_hours, hourly_rate, materials_cost, materials_invoiced, invoiced_amount, remaining_amount, is_fixed_fee, qbo_estimate_ref, invoiced_at` |
| Access | `gate_code, panel_password, cms_account_id` |
| Welcome email | `welcome_email_sent_at, welcome_email_draft_id, materials_invoice_sent, materials_invoice_paid` |
| Audit | `created_by, updated_by, created_at, updated_at, completed_at, acknowledged_at, acknowledged_by` |

**Four separate event-ID columns.** `calendar_event_id` (intake), `scheduled_event_id`
(the tech-calendar booking), `tentative_event_id` (the hold), plus
`job_assignments.calendar_event_id`. `utils/jobResolve.js` is the ONE resolver that checks
all four — see §5.

#### WRITES to `jobs`

| Where | Action | Fields written |
|---|---|---|
| `supabase.js:278` | `jobsApi.create` | all non-empty + `created_by`, `updated_by`; then logs history |
| `supabase.js:293` | `jobsApi.update` | passthrough (allows `null`, strips `undefined`) + `updated_by` |
| `supabase.js:356` | `jobsApi.changeStatus` | `status, updated_by, tentative_date:null, tentative_event_id:null`; `+job_type:'service'` if promoting a note; `+return_reason` if archiveReason; `+completed_at` on complete/to_bill; `+invoiced_at` on billed; `+completion_notes` if notes |
| `supabase.js:723/734` | `notesApi.addNote` / `editCompletionNotes` | `updated_by` / `completion_notes` |
| `supabase.js:1222/1229` | `jobLinkingApi.createProjectJob` | insert `status:'new'` then update `status:'estimate_sent'` to fire the P-number trigger |
| `schedule.js:86` | `book()` | `status:'scheduled', scheduled_date, tech_assigned, tech_name, assigned_to:null, tentative_date:null, tentative_event_id:null, updated_at` |
| `schedule.js:146` | `book()` step 2 | `scheduled_event_id, scheduled_calendar_id` (after Google returns the ID) |
| `schedule.js:172` | `hold()` | `tentative_date, tentative_event_id, updated_at` |
| `schedule.js:219` | `linkToEvent()` | `status:'scheduled', scheduled_date, scheduled_event_id, scheduled_calendar_id, tech_name, tentative_*:null` |
| `schedule.js:282` | `clearHold()` | `tentative_date:null, tentative_event_id:null` |
| `schedule.js:301` | `releaseCalendar()` | `scheduled_event_id:null, scheduled_calendar_id:null, tentative_*:null` |
| `InboxBar.jsx:50` | Acknowledge | `acknowledged_at, acknowledged_by, status:'archived'` |
| `InboxBar.jsx:65` | Convert to job | `job_type:'service_res', acknowledged_at, acknowledged_by` |
| `InboxBar.jsx:80` | Dismiss all | same as acknowledge, `.in('id', ids)` |
| `JobFinishSheet.jsx:201` | Same-day rebind | `calendar_event_id` — binds a found job to this event so the miss can't repeat |
| `TicketSheet.jsx:77` | Save contract | `estimate_amount, estimated_hours, qbo_estimate_ref` |
| `TicketSheet.jsx:226` | (ticket edit) | job field patch |
| `BoardView.jsx:174` | inline edit | job field patch |
| `BoardView.jsx:402` | Merge — fill gaps | `issue, customer_phone, customer_address, customer_email, cms_account_id, gate_code, panel_password, calendar_event_id, calendar_id` — **only where survivor is empty** |
| `BoardView.jsx:416` | Merge — kill dupe | `status:'dead', action_note:'Merged into job <id>', updated_by, updated_at` |
| `CustomerAudit.jsx:246` | Link to existing | `calendar_event_id, calendar_id, updated_at` |
| `CustomerAudit.jsx:297` | Push to board | create/update ticket from a calendar event |
| `People.jsx:215` | `giveTo` | `assigned_to, updated_at` |
| `Unbilled.jsx:116` | Fixed-fee edit | `estimate_amount, estimated_hours, hourly_rate, materials_cost, materials_invoiced, invoiced_amount, updated_by` |
| `SoldWork.jsx:83` | Create job from estimate | full insert, `status:'ready_to_schedule'`, `qbo_estimate_ref` |
| `PreviewChanges.jsx:89` | **DELETE** | `.ilike('created_by','%PREVIEW%').eq('calendar_event_id', …)` |
| `PreviewChanges.jsx:99` | **DELETE** | `.eq('id', job.id)` |
| `api/sse.js:332` | MCP `update_job_status` | `status, updated_by, updated_at` — **bypasses `changeStatus`** |
| `api/sse.js:417` | MCP `create_job` | `job_number, customer_*, issue, job_type, priority, status:'new', created_by` |
| `api/sse.js:479` | MCP `create_return_visit` | inherits parent, `job_type:'return_trip'`, `status:'return_pending'` |
| `api/welcome-draft.js:388` | Claim | `welcome_email_sent_at` guarded by `.is(…, null)` |
| `api/welcome-draft.js:496` | Store draft | `welcome_email_draft_id` |
| `api/welcome-draft.js:360` | Release claim | `welcome_email_sent_at:null, welcome_email_draft_id:null` |

Deletes on `jobs` exist in exactly two places, both in `PreviewChanges.jsx` (the
preview-revert tool). Nothing else deletes a job — jobs go to `dead`/`archived`.

#### READS of `jobs`
`BoardView · OpsHome · OwnerDashboard · Scheduler · TechCalendar · TechWorkToday · Unbilled ·
Projects · People · TaskStack · CustomerAudit · CustomerHistory · LinkAudit · WeeklyRecap ·
ShortLink · PreviewChanges · GlobalSearch · InboxBar · JobDetail · JobFinishSheet ·
alertEngine · visitsOwed · jobResolve · schedule.js · api/sse.js · api/welcome-draft.js`

---

### 2.2 `time_entries` — 34 call sites

One row per tech "finish" action. **This is what billing reads — not job status.**

Schema (`supabase/migrations/001`, `002`, `003`, `023`, `039`):
```
id · customer_id → customers · customer_name_raw · job_id → jobs
calendar_event_id (NOT NULL) · calendar_id (NOT NULL) · event_title · event_start
tech_email · tech_name
time_in · time_out · total_minutes · entry_method (manual|inout|timer)
disposition (bill_it|return|estimate|in_progress)  ← CHECK constraint
notes · materials · photos · project_ref
billed · billed_at · invoice_ref
archived · archived_at · archived_by · archive_reason
resolved_at · billable · non_billable_reason      ← added by migration 042
created_at
```

**Billing precedence** (`utils/billing.js`, stated in `OVERWATCH-STATE.md`):
`resolved_at` → `billed`/`invoice_ref` → `billable` → `archived` → `disposition` → job status.
Reading job status first is what put 164 already-invoiced visits in "To bill" forever.

#### WRITES

| Where | Action | Fields |
|---|---|---|
| `supabase.js:913` | `timeEntriesApi.create` | Explicit whitelist of 18 fields. **Anything not on the list is silently dropped** — this is how `photos` and `job_id` were lost for months. |
| `supabase.js:967` | `markBilled` | `billed:true, billed_at, invoice_ref` |
| `supabase.js:977` | `update` | passthrough |
| `Unbilled.jsx:510` | Bulk bill (orphan) | `billed, billed_at, invoice_ref` `.in('id', ids)` |
| `Unbilled.jsx:529/539` | Clear with reason | `archived, archived_at, archived_by, archive_reason` — **reason is a KEY, never prose** |
| `Unbilled.jsx:560` | `markBilled` bulk | `billed, billed_at, invoice_ref` + job write-through (§4.5) |
| `Unbilled.jsx:638` | `doArchive` | `archived, archived_at, archived_by, archive_reason` |
| `CustomerAudit.jsx:198` | Assign customer | `customer_id` |
| `CustomerAudit.jsx:314` | Archive | `archived, archived_at, archived_by, archive_reason` |
| `CustomerAudit.jsx:332` | Change disposition | `disposition` |
| `CustomerHistory.jsx:345` | Assign customer | `customer_id` |

#### READS
`Unbilled (4×) · CustomerAudit · CustomerHistory (2×) · WeeklyRecap (2×) · Projects ·
BoardView · CalendarTechDay · FieldVisits (2×) · GlobalSearch · alertEngine · visitsOwed ·
supabase.js notesApi.getAllForJob (field notes) · timeEntriesApi (5 queries)`

---

### 2.3 `customers` — 24 call sites

A **separate model**. Line 4 of `services/supabase.js`: *"Customer is a SEPARATE model. Do not merge into jobs."*

Columns: `id, name, short_code, drh_id, cs_number, phone, address, email, cms_account_id,
qbo_customer_name, qbo_customer_id, is_active, merged_into, created_at`

`merged_into` is the dedupe pointer. **Every live read filters `.is('merged_into', null)`** —
a merged-away duplicate must never be handed back as if it were the customer.

#### WRITES — only 4

| Where | Action | Notes |
|---|---|---|
| `supabase.js:176` | `customersApi.create` | Raw insert. No dedupe. |
| `supabase.js:1146` | `customersApi.createLoose` | **The duplicate factory, closed.** Checks in order: exact normalized name → last-10-digits phone → street (first address segment). Then token-overlap ≥0.6 → throws `POSSIBLE_DUPLICATE` with `err.candidates` for the caller to offer. `{force:true}` inserts anyway. Writes `cms_account_id: null` not `''` — `''` was the fingerprint of every shell row. |
| `supabase.js:182` | `customersApi.update` | passthrough |
| `CustomerHistory.jsx:274` | `saveDetails` | whole `editForm` |

`createLoose` deliberately does **not** import `utils/fuzzyMatch.js` — that module was deleted
and must not be rebuilt (`OVERWATCH-STATE.md`, "THE ONE RULE").

#### READS
`CustomerLookup (2×) · CustomerPicker · GlobalSearch · JobDetail · NewJobModal · Notes ·
TaskStack · Unbilled · CustomerAudit · CustomerHistory (2×) · customersApi (4×) ·
queries.getAllOpenJobsWithTech (phone/address hydration) · api/sse.js (2×) ·
api/welcome-draft.js`

---

### 2.4 `notes` — 23 call sites

**Notes AND tasks live here.** A note with an `assigned_to` is a task. That is the only
difference — stated in `NewJobModal.jsx:369`: *"A TASK WITHOUT AN OWNER IS A NOTE."*

Schema (`028`, `029`, `031`, `032`):
```
id · body (NOT NULL) · author_email
customer_id → customers · on_customer_record (bool)
status (open|archived) · archived_at · archived_by
lane (NOT NULL, default 'todo', CHECK constraint)
assigned_to · assigned_by · handoff_to · done_at · done_by
job_id → jobs · tentative · scheduled_for · calendar_event_id · calendar_id
source_event_id (unique — import dedupe) · last_seen_status
created_at · updated_at (trigger-maintained)
```

#### WRITES

| Where | Action | Fields |
|---|---|---|
| `supabase.js:381` | Auto scheduling task | Fired inside `changeStatus` when a job enters `ready_to_schedule`/`return_pending`. Writes `body, job_id, customer_id, author_email, assigned_to:'shanaparks@…', assigned_by, lane:'todo', status:'open'`. **Idempotent** — checks for an existing open task first. Wrapped in try/catch: never unwinds a status move. |
| `NewJobModal.jsx:351` | Quick note | `body, author_email, lane:'note', status:'open', customer_id, on_customer_record` |
| `NewJobModal.jsx:375` | Quick task | same + `assigned_to, assigned_by, lane:'todo'`. Returns early if no assignee. |
| `TicketSheet.jsx:174` | Task from ticket | `body, job_id, customer_id, author_email, assigned_to, assigned_by, handoff_to, lane:'todo', status:'open'` |
| `Notes.jsx:229` | Add note | `body, author_email, customer_id, status:'open'` |
| `Notes.jsx:214` | **UPSERT** — calendar import | `onConflict:'source_event_id', ignoreDuplicates:true` |
| `Notes.jsx:103` | Assign | `assigned_to, assigned_by, lane:'todo'` |
| `Notes.jsx:246` | Archive | `status:'archived', archived_at, archived_by, customer_id, on_customer_record` |
| `People.jsx:167` | `assignNote` | `assigned_to, assigned_by` |
| `People.jsx:180` | `moveNote` | `lane`; if done: `+status:'archived', done_at, done_by` |
| `TaskStack.jsx:208` | `patch` | arbitrary fields + `updated_at` |

#### READS
`App.jsx:687 (nav badge)` · `TaskStack (2×)` · `Notes (2×)` · `People` · `OpsHome (2×)` ·
`BoardView` · `CustomerHistory` · `TicketSheet` · `supabase.js:376`

---

### 2.5 `job_history` — 15 call sites

Append-mostly. Doubles as the **note store** — `notesApi.addNote` writes a history row with
`from_status == to_status`.

Columns: `id, job_id, from_status, to_status, changed_by, changed_at, notes`

#### WRITES

| Where | Action |
|---|---|
| `supabase.js:222` | `customersApi.addNote` → attaches to customer's most recent job |
| `supabase.js:403` | `jobsApi.logHistory` — called by every `create` and `changeStatus`. try/catch, non-fatal |
| `supabase.js:719` | `notesApi.addNote` — `from_status = to_status = current` |
| `schedule.js:34` | `logScheduleAction` — `notes: '📅 RECAP: Scheduled\|Rescheduled'`, both statuses null. This is how WeeklyRecap counts scheduling activity |
| `BoardView.jsx:380` | Merge — carry duplicate's notes onto survivor with original dates |
| `BoardView.jsx:428` | Merge — log merge-out on the dead job's own trail |
| `api/sse.js:343` | MCP `update_job_status` |
| `api/sse.js:365` | MCP `add_job_note` |
| `api/sse.js:500` | MCP `create_return_visit` → logs on the parent |

**UPDATE:** one only — `supabase.js:728` `notesApi.editHistoryNote` sets `notes`.

#### READS
`supabase.js:209 (customer notes)` · `supabase.js:654 (getAllForJob)` · `BoardView:869` ·
`WeeklyRecap:66` · `api/sse.js:304`

---

### 2.6 `job_assignments` — 15 call sites

Dispatch rows: which tech, which day, which calendar event. **Not the same as
`jobs.scheduled_*`** — merging them severs time-entry joins (`OVERWATCH-STATE.md`).

Columns: `id, job_id, tech_id, scheduled_for, day_number, estimated_hours, actual_hours,
time_in, time_out, is_complete, completion_notes, office_notified, calendar_event_id,
calendar_synced_at, created_by`

#### WRITES

| Where | Action | Notes |
|---|---|---|
| `supabase.js:549` | **DELETE** inside `create` | Deletes the colliding row: same job + same tech + **same day**. Previously deleted every incomplete assignment for job+tech, so booking day 2 silently erased day 1 — `day_number` never exceeded 1 in 284 rows. |
| `supabase.js:577` | `assignmentsApi.create` | Auto-numbers `day_number` if absent (max+1) |
| `supabase.js:586` | `update` | passthrough |
| `supabase.js:600` | `markComplete` | `time_in, time_out, actual_hours, is_complete:true, completion_notes` `+office_notified` if given. Hours = manual override, else `(time_out - time_in)/3600000` |
| `supabase.js:610` | `delete` | by id |
| `NewJobModal.jsx:299` | Link GCal event | `calendar_event_id` after the event is created |

Also written indirectly by `schedule.js:bookExtraDay` → `assignmentsApi.create`, so a multi-day
job's extra days get a DB row and not just a Google event.

#### READS
`assignmentsApi (5 queries)` · `jobResolve.js:61` · `TechCalendar:211` ·
`queries.getAllOpenJobsWithTech` · `api/sse.js:310`

---

### 2.7 `techs` — 12 call sites, 1 writer

Roster. `id, name, email, calendar_id, color, phone, is_active, display_order`

**Only write:** `supabase.js:124` `techsApi.update` — passthrough. No create, no delete in app code.

`techsApi.getByEmail` (`supabase.js:89`) resolves in three steps: exact email → `calendar_id`
match → alternate emails sharing the same calendar via `TECH_CALENDAR_MAP`. That third hop
exists because several people share one calendar.

Reads: `techsApi (6 queries)` · `JobDetail:81` · `BoardView (2×)` · `ShortLink:117` ·
`api/sse.js:383` · plus embedded joins `tech:techs(*)` in every assignment query.

---

### 2.8 `return_cards` — 9 call sites

Created when a tech picks "Return Visit" in the finish sheet. Feeds the Scheduler.

Columns: `id, customer_id, customer_name_raw, original_event_id, original_calendar_id,
original_event_title, original_location, flagged_by_email, flagged_by_name, reason,
time_entry_id → time_entries, job_id → jobs, status
(pending_schedule|scheduled|cancelled|complete|quick_note), scheduled_at, new_event_id,
new_calendar_id, created_at, updated_at`

| Where | Action | Fields |
|---|---|---|
| `supabase.js:1003` | `create` | whitelist, `status:'pending_schedule'` |
| `supabase.js:1021` | `markScheduled` | `status:'scheduled', new_event_id, new_calendar_id, scheduled_at` |
| `supabase.js:1037` | `cancel` | `status:'cancelled'` |
| `supabase.js:1190` | `linkReturnCard` | `job_id` — **a DB trigger propagates this to the time entry** |
| `supabase.js:1202` | `unlinkReturnCard` | `job_id: null` |
| `supabase.js:1241` | `markAsQuickNote` | `status:'quick_note'` `.in('id', cardIds)` |

Reads: `getPending` · `getPendingReturnCards` · `alertEngine:81` (returns pending >72h).

---

### 2.9–2.14 The small six

| Table | Writes | Reads | Notes |
|---|---|---|---|
| `settings` | `CalendarTechDay.jsx:232` upsert `{key, value, updated_at}` on conflict `key` | `App.jsx:658` (`force_identity_after`), `CalendarTechDay.jsx:225` (tech capacity) | K/V, JSON `value`. `force_identity_after` drops saved identity on shared-login devices and reloads. |
| `estimates` | `SoldWork.jsx:97` (`job_id` link), `:106` (`closed_at, closed_by, closed_reason`) | `SoldWork.jsx:60` with `customers(...)` + `jobs(...)` joins | QBO import. Sold work with a balance lives ONLY here — never on the board. |
| `activity_log` | `calendarSync.js:468/481` upsert on conflict `calendar_event_id` | `calendarSync.js:492` | Only ever `event_type:'orphan_ignored'`. localStorage is primary; this is the cross-device sync. |
| `push_tokens` | `pushNotifications.js:93` upsert on conflict `token`; `:106` delete by `user_email` | — (server-side consumer not in this repo) | `{user_email, token, device (UA, 100 chars), updated_at}` |
| `pl_data` | `PLUpload.jsx:180` upsert on conflict `period_type,period_start,period_end,year` | `PLDashboard.jsx:24` | XLSX upload, one upsert per period. |
| `feedback` | `supabase.js:747` `feedbackApi.create` | `supabase.js:754` | `{type, message, user_email, current_view, metadata, created_at}`. Insert failure is warn-only. |

---

## 3. ROUTES

| Route | View | Gate |
|---|---|---|
| `/` | `OpsHome` | — |
| `/my` | `MyDay` | — |
| `/tasks` | `TaskStack` | — |
| `/calendar` | `TechCalendar` | — (`isRestricted` narrows it) |
| `/work` | `TechWorkToday` | — |
| `/newjob` | `NewJobModal` | — |
| `/notes` | `Notes` | — |
| `/customers` | `CustomerHistory` | — |
| `/scheduler` | `Scheduler` | — |
| `/sold` | `SoldWork` | — |
| `/j/:code` | `ShortLink` | — (deep link) |
| `/lifeline` | stub | — |
| `/board` | `BoardView` | **operator** |
| `/dashboard` | `OwnerDashboard` | **operator** |
| `/command` | `CommandCenter` | **operator** |
| `/projects` | `Projects` | **operator** |
| `/audit` | `CustomerAudit` | **operator** |
| `/recap` | `WeeklyRecap` | **operator** |
| `/unbilled` | `Unbilled` | **operator** |
| `/admin/reconcile` | `ReconcileView` | **operator** |
| `/admin/links` | `LinkAudit` | **operator** |
| `/admin/preview` | `PreviewChanges` | **operator** |

Redirects: `/people`, `/people/:who`, `/office` → `/tasks` · `/clients` → `/customers` ·
`/workspace*` → `/people` (→ `/tasks`) · `*` → `/`

Removed: `/triage` (9.9.30 — duplicate scheduler), `/billing` (9.9.31 — counted
`job_assignments` instead of `time_entries`, said 18 when 2 was true).

---

## 4. THE FLOWS

### 4.1 INTAKE — a job is born

Five doors into `jobs`:

| Door | Entry | Status | Writes |
|---|---|---|---|
| **Manual** | `/newjob` → `NewJobModal:285` | `new`, or `scheduled` if a date was picked | `jobs` insert → optional `job_assignments` → optional Google event → `job_assignments.calendar_event_id` |
| **Adopt from calendar** | `JobFinishSheet:ensureJobForEvent` | disposition's target status | `jobs` insert with BOTH `calendar_event_id` and `scheduled_event_id` set to the event |
| **From an estimate** | `SoldWork:83` | `ready_to_schedule` | `jobs` insert + `estimates.job_id` link |
| **MCP** | `api/sse.js:417` `create_job` | `new` | `jobs` insert only — **no history row** |
| **Project job** | `jobLinkingApi.createProjectJob:1222` | insert `new` → update `estimate_sent` | two writes, to fire the P-number DB trigger |

Job numbers are generated by reading the last `job_number` and adding 1
(`supabase.js:427`, `api/sse.js:407`). Two concurrent creates collide.

`NewJobModal` no longer writes an all-day Tentative event on create — that made a second
calendar copy of every queued job, dated today, never cleaned up (`NewJobModal:308-324`).

### 4.2 TRIAGE — the board

`BoardView` (operator only) reads `queries.getAllOpenJobsWithTech()`, which:
1. `jobs.select(*).in('status', [13 open statuses])`
2. `job_assignments` where `is_complete = false`, newest per job → `_tech_id/_tech_name/_tech_color`
3. Hydrates missing `customer_phone`/`customer_address` from `customers`

Lanes come from `utils/lanes.js` — **one definition, imported everywhere**. It exists because
the destination of a job was defined in four places (`BoardView.COLUMNS`,
`BoardView.LANE_MOVES`, `MoveStatus.MOVES`, `JobFinishSheet.DISPOS`) and they drifted:
same card, four vocabularies, a destination you could see but not reach.

`BLOCKED` is deliberately NOT intake — a $65,688 job waiting on a customer read as
"New / Notes", indistinguishable from something nobody had scoped yet.

**Clearing needs a reason** (`lanes.requiresDisposition`): a New/Note clears in one tap.
Once it is Ready/Scheduled/Return/Done/To Bill/Won it is a commitment, and clearing it is a
money decision. Reason is stored as a **key** (`warranty`, `goodwill`, `sales_call`) —
`isRealCost()` can classify a key, not a sentence.

**Merge duplicates** (`BoardView:370-435`) — four steps:
1. Carry the duplicate's `job_history` notes onto the survivor, original dates preserved
2. Fill survivor's **empty** fields only from the duplicate
3. Move the duplicate's Google event to the Completed calendar (best-effort)
4. `status:'dead'`, `action_note: 'Merged into job <id>'`, + a history row on the dead job

### 4.3 SCHEDULING — `services/schedule.js` owns it

> **RULE** (`schedule.js:17`): nothing outside this file writes `status='scheduled'`,
> `scheduled_date`, `scheduled_event_id`, `tentative_date` or `tentative_event_id`.

"Scheduled" lives in three independent representations: `jobs.status`, the `jobs.scheduled_*`
columns, and `job_assignments` rows — plus `tentative_*` for holds and three columns for WHO.
Every scheduling UI used to write its own subset in its own order. That is how nine jobs said
"scheduled" while two had no date, three had no calendar event and one had no tech.

| Function | Sequence |
|---|---|
| `book()` | **Re-reads the job first** (never trust the caller's copy — a stale drawer object caused duplicate events) → delete old Tent event → delete old tech event → **DB write** (`status, scheduled_date, tech_assigned, tech_name, assigned_to:null, tentative_*:null`) → create Google event → store `scheduled_event_id/scheduled_calendar_id` → mirror to helpers' calendars (non-fatal per helper) → `logScheduleAction` |
| `hold()` | delete old Tent event → create Tent event → write `tentative_date, tentative_event_id` |
| `bookExtraDay()` | create Google event → `assignmentsApi.create` row. **Does not touch the job row** — `scheduled_event_id` is one column, not a list |
| `linkToEvent()` | adopt an existing event. No new event is created — creating one is how a job ends up with two |
| `clearHold()` | delete Tent event → null the `tentative_*` columns |
| `releaseCalendar()` | re-read → delete scheduled + tentative events → null all four pointers **whether or not Google accepted the delete** |

DB-first ordering is deliberate: if the calendar write fails, the job is still visibly
scheduled and the error surfaces. The reverse order is how ghost events got made.

`book()` sets `assigned_to = null`: booking settles ownership. `assigned_to` meant "who is
looking into this"; once there is a tech and a date, leaving it gives the job two owners who
disagree.

**Callers:** only `VisualSchedulerModal` (book/bookExtraDay/hold/linkToEvent) and
`TicketSheet:296` (releaseCalendar).

### 4.4 FIELD WORK — the tech finish

`JobFinishSheet` — the highest-consequence flow in the app. `finish(disposition)`:

```
1. patchTitle()            → Google: append disposition tag; GET the live description
                             first so the customer-info block is never clobbered
2. writeTimeEntry()        → resolveJobForEvent(event.id) to get job_id
                             → time_entries INSERT
3. ensureJobForEvent()     → find-or-adopt the jobs row, move it to target status
4. if 'return'             → return_cards INSERT
```

Step 3 resolves in three escalating attempts:
1. `resolveJobForEvent(event.id)` — checks all four event-ID homes
2. **Same-day near-match** — same customer (or `ilike` name), same calendar day, still open →
   binds `calendar_event_id` onto it so the miss can't repeat. This is the "why did a second
   card appear" fix.
3. Genuinely untracked → `jobsApi.create` with both event-ID columns set, `tech_name` from
   the event, `assigned_to` resolved from `ASSIGNEES`

Disposition → status (`JobFinishSheet:150`):

| Tech picks | Disposition | Job status |
|---|---|---|
| ✅ Done — To Bill | `bill_it` | `to_bill` |
| 🔄 Return Visit | `return` | `return_pending` (+ `return_cards` row, reason required) |
| 📅 Still Scheduled | `in_progress` | `scheduled` |
| 📋 Estimates | `estimate` | `needs_estimate` |
| 📝 New / Notes | `blocked` | `blocked` — **this path is broken, see §7.13** |

Guards: a **future-dated event warns but does not block** (`eventInFuture` + `futureOk`) —
somebody finishing at 11pm for tomorrow's event is real, and so is testing. An **unlinked
customer never blocks** a tech in the field; the job stays flagged on the board and in JR's
alert panel until someone matches it.

Step 3 is wrapped in try/catch — the time entry is already saved and must not be lost to an
adopt failure.

### 4.5 BILLING — `/unbilled`

Reads `time_entries`, not job status. Three panes: unbilled visits, orphan groups (visits
with no job on the board), and fixed-fee jobs.

**Mark billed** (`Unbilled:560`):
1. `time_entries.update({billed, billed_at, invoice_ref}).in('id', ids)`
2. **Write-through** — for each affected job: query whether ANY unbilled, unarchived entry
   remains (matching on `job_id` OR either event-ID column). If none remain AND the job is
   `complete`/`to_bill` → `jobsApi.changeStatus(job, 'billed')`.
   Wrapped try/catch, non-fatal on purpose: *"the time entries ARE billed at this point.
   A failure here leaves a stale card, not lost money."*

Without step 2 the home screen counted 18 jobs owed while only 2 were true.

**Clear with a reason** (`Unbilled:520`) writes `archive_reason` as a **key**. Prose here is
what made 44 rows impossible to put on either side of the profitability ledger.

**Project hours are not "non-billable."** Fixed-fee work bills under the contract:
`billable = false, non_billable_reason = 'project hours'`, and it **stays visible** in Billing
until the project closes.

Invoice number is mandatory on billed — `00000` bypasses when none exists. `NC-ARCHIVED` is
history; never overwrite it.

### 4.6 NOTES → TASKS → JOBS

Sara's model (`OVERWATCH-STATE.md`, 2026-08-17): notes are "new" → notes can make tasks →
tasks get assigned → OR a "new" becomes a job and lands in `ready_to_schedule`.

```
notes (lane 'note', assigned_to NULL)          ← NewJobModal:351, Notes:229
   │  assign  (Notes:103 / People:167 / TaskStack:208)
   ▼
notes (lane 'todo', assigned_to SET)  = a TASK  ← NewJobModal:375, TicketSheet:174
   │  done
   ▼
notes (lane 'done', status 'archived', done_at, done_by)
```

Auto-generated tasks: `changeStatus` into `ready_to_schedule` or `return_pending` hands
Shana a task (`supabase.js:381`). *"A column is not an owner"* — Rick Ferreri sat in Ready for
seven weeks. Idempotent: bouncing a job in and out of Ready does not stack five tasks.

**The promotion path** (`changeStatus:305`): the note lane offers exactly two destinations —
make it a job, or done. So any move off a note that is not a closer IS the promotion, and
`changeStatus` sets `job_type = 'service'`. Before this, the row moved lanes and stayed a note
forever, so the card came back still offering "Make it a job".

### 4.7 RETURN VISITS

```
JobFinishSheet 'return' ──► time_entries (disposition 'return')
                       └─► return_cards (status 'pending_schedule', time_entry_id)
                       └─► jobs.status = 'return_pending'
                              └─► auto-task to Shana (notes)

Scheduler / LinkAudit ──► jobLinkingApi.linkReturnCard(card, job)
                              └─► return_cards.job_id
                              └─► DB TRIGGER propagates job_id to the time entry

Booked ──► returnCardsApi.markScheduled(new_event_id, new_calendar_id, scheduled_at)
```

Separately, `create_return_visit` (MCP, `api/sse.js:459`) and
`jobsApi.createLinkedJob` (`supabase.js:427`) make a **child job** with `parent_job_id` —
a different mechanism from `return_cards`. Both exist.

### 4.8 CUSTOMER RECORD

`CustomerHistory` (`/customers`) loads: customer row → jobs → `time_entries` (tagged +
suggested) → notes. `saveDetails` writes the whole edit form to `customers`.

Deduping: `createLoose` (§2.3) prevents new duplicates. `merged_into` retires existing ones.
`CustomerAudit` (`/audit`) reassigns orphan time entries to the right customer.

### 4.9 CALENDAR SYNC — one-way

`services/calendarSync.js` wraps the Google Calendar v3 API. Exports:
`createEventOnCalendar · archiveEvent · getLatestNote · buildEventTitle ·
buildEventDescription · getColorId · appendNoteToJobEvents · scheduleToTechCalendar ·
onJobComplete · scanForOrphans · fetchCalendarEvents · ignoreOrphan · ignoreAllOrphans ·
isOrphanIgnored · syncIgnoredOrphansFromSupabase`

**Google → Overwatch is one-way.** Edit an event in Google Calendar and `jobs.scheduled_date`
never updates. This causes false no-disposition flags.

A deleted Google event returns **HTTP 200 with `status:'cancelled'`**, not 404. Handle both.

Orphan scanning: `ORPHAN_SCAN_FROM = 2026-08-13`, `ORPHAN_SCAN_DEEP = 2026-06-01`. Everything
before Aug 13 was settled by migrations 041/042/045. Ignores are localStorage-primary with
`activity_log` as cross-device sync.

`onJobComplete()` is exported and **called from nowhere** — which is why 46 archived/dead/lost/
billed jobs still hold live event IDs whose events are still on tech calendars.
`releaseCalendar()` fixes this forward only.

### 4.10 ALERTS & STALENESS

`utils/alertEngine.js` — five queries:

| # | Source | Rule |
|---|---|---|
| 0a | `jobs` | finished with no `customer_id` |
| 0b | `jobs` | on the board, untouched 72h |
| 1 | `return_cards` | `pending_schedule` > 72h |
| 2 | `time_entries` | `disposition='estimate'`, `billed=false`, > 48h |
| 3 | `time_entries` | (billing follow-up) |

**Disposition deadline** (`utils/staleness.js:needsDisposition`): the scheduled day ends 6pm;
14 hours later — 8am next morning — a disposition is overdue. Weekends roll: a Friday visit is
not late until Monday 8am. Keyed on **status** (`scheduled`), not on notes — notes can be
written against an older visit, status cannot lie about this one.

### 4.11 SUPPORTING FLOWS

| Flow | Path |
|---|---|
| **Welcome email** | `api/welcome-draft.js`. Claim `welcome_email_sent_at` with `.is(null)` guard (double-click safe) → require `status='won' AND materials_invoice_sent AND materials_invoice_paid` → read `customers.email` (**never** the unpopulated `jobs.customer_email`) → reject if `merged_into` → Gmail draft → store `welcome_email_draft_id`. Every failure path calls `releaseClaim()`. |
| **SMS** | `api/send-sms.js` → Twilio REST. Auth = Supabase session Bearer OR `x-sms-secret`. CORS restricted to `SMS_ALLOWED_ORIGINS` — *"this endpoint spends money."* Shipped with no auth at all until 9.79.0. |
| **Push** | `services/pushNotifications.js` → Firebase FCM → `push_tokens` upsert on `token` |
| **P&L** | `PLUpload` parses XLSX → `pl_data` upsert per period → `PLDashboard` reads |
| **Feedback** | `HelpBot` → `feedbackApi.create` → `feedback` |
| **Short links** | `/j/:code` → `ShortLink` reads `jobs` + `techs` |
| **Weekly recap** | `/recap` counts `job_history` rows where `notes LIKE '📅 RECAP:%'` + `time_entries` + `jobs` |
| **Preview revert** | `/admin/preview` — the only place that **deletes** `jobs`, scoped to `created_by ILIKE '%PREVIEW%'` |

---

## 5. THE RESOLVERS — single sources of truth

Four modules exist specifically to end "the same question answered three different ways."

| Module | Question | Rule |
|---|---|---|
| `utils/jobResolve.js` | Which job does this calendar event belong to? | Checks `jobs.calendar_event_id` → `jobs.scheduled_event_id` → `job_assignments.calendar_event_id` → `jobs.tentative_event_id`, in priority order. **Do not add a fifth subset.** Missing the tentative case made the app hand you back your own hold as a one-tap duplicate. |
| `utils/visitsOwed.js` | Does this visit still owe a disposition? | Match on `time_entries.job_id = jobs.id` **OR** `calendar_event_id = jobs.calendar_event_id` **OR** `calendar_event_id = jobs.scheduled_event_id`. All three required — Jeanneret's two event IDs differ. `customer_id + day` is deliberately NOT a key: it silently suppressed second visits (one customer had six entries in one day). Cutoff at `LEGACY_HOURS_CUTOFF`. |
| `utils/lanes.js` | Where can this job go, and what is it called? | One definition of the five destinations + `requiresDisposition()`. |
| `services/schedule.js` | What is this job's scheduling state? | `scheduleOf(job)` → `{kind: 'booked'\|'held'\|'none', date, eventId, calendarId}` |

Plus `normalizeDisposition()` (`supabase.js:866`) — collapses legacy calendar tags, tech
free-text and the "17k synonyms" pile into six canonical values:
`bill_it · return · in_progress · estimate · skip · triage`. **Order matters**:
`BILLED|INVOICED` (→ `skip`) must be tested before `BILL` (→ `bill_it`).

---

## 6. WRITE-PATH OWNERSHIP — who is allowed to write what

| Field group | Sole legitimate writer | Enforced? |
|---|---|---|
| `status='scheduled'`, `scheduled_date`, `scheduled_event_id`, `scheduled_calendar_id` | `services/schedule.js` | By convention only |
| `tentative_date`, `tentative_event_id` | `services/schedule.js` **sets**; `jobsApi.changeStatus` **clears** | By convention |
| `jobs.status` (all other) | `jobsApi.changeStatus` | Bypassed by `api/sse.js:332` |
| `time_entries` insert | `timeEntriesApi.create` whitelist | Yes — non-whitelisted fields are dropped |
| `customers` insert | `customersApi.createLoose` | Bypassed by `customersApi.create` |
| `archive_reason` / `return_reason` | Any archive path — must be a **key** | No |
| `job_history` | `logHistory`, `addNote`, `logScheduleAction` | No |

`jobsApi.changeStatus` carries **the silent-no-op guard** (`supabase.js:343`): supabase-js
serializes with `JSON.stringify`, which drops `undefined` keys — so `changeStatus(id, undefined)`
sent a PATCH with no `status`, Postgres updated nothing, no error was raised, the toast said the
move worked, and a history row was written with a null destination. Every Sent/Won/Lost click
died there. It now throws.

Two of its `updates` keys used to name columns that do not exist on `jobs` — `scheduled_at`
(never existed) and `billed_at` (that column is on `time_entries`; the real one here is
`invoiced_at`). Postgres rejects the whole UPDATE on an unknown column, so **every** attempt to
move a job to `billed` threw — including Billing's write-through, where the throw was swallowed
by a try/catch marked "non-fatal on purpose". Second reason nothing ever left To Bill.

---

## 7. HAZARDS FOUND IN THE CURRENT CODE

Documented, not fixed — this pass is a map.

### Known and already tracked in `OVERWATCH-STATE.md`

1. **`JobFinishSheet:196`** — `ilike('customer_name', …)` on the same-day near-match. Structured
   meaning from free text. Guarded by same-day + still-open + customer-id-preferred, but the
   name path is still there.
2. **`normalizeDisposition()`** — regexes BILLED/RETURN/ESTIMATE/NC out of a string. Fine for
   legacy import, not for writes.
3. **`CustomerHistory:296` and `:312`, `NotesPanel:131`** — write `job_type: 'note'` / `'task'`
   into the **jobs** table, against the stated notes→tasks→jobs model. 90 such rows exist, all
   terminal, 3 at `status='billed'` with $0.00. Note that `NewJobModal` was already fixed to
   write these to `notes` instead (`:351`, `:375`) — these three sites were not.
4. **46 orphaned calendar events** — `onJobComplete()` is exported and never called.
5. **Google → Overwatch is one-way** — causes false no-disposition flags.

### Additional, from this pass

6. **`api/sse.js:332` bypasses `changeStatus`.** MCP `update_job_status` writes
   `status/updated_by/updated_at` directly. It skips: the no-op guard, the note→job promotion,
   the `tentative_*` clear, `completed_at`/`invoiced_at` stamping, and the auto-task to Shana.
   A status set through Claude does not behave like the same status set in the UI.
7. **`api/sse.js:417` `create_job` writes no `job_history` row.** `jobsApi.create` always logs
   one. Jobs created via MCP have no origin record.
8. **`api/sse.js` uses the anon key** (`sse.js:12`) with the key inline as a fallback literal.
   With RLS `USING (true)` on every table, that endpoint is a full read/write surface.
9. **Supabase URL and anon key are inline literals** in both `services/supabase.js:13-14` and
   `api/sse.js:11-12` as env fallbacks. They are in git.
10. **Job-number generation races.** `last job_number + 1` in three places
    (`supabase.js:427`, `sse.js:407`, `sse.js:468`). Two concurrent creates produce the same
    number. `p_number`/`s_number` use DB triggers and do not have this problem.
11. **`customersApi.create` (`supabase.js:176`) still exists** next to `createLoose` and does
    no dedupe at all — the original duplicate factory door, unlocked.
12. **`api/sse.js` `search_customers` filters `.eq('is_active', true)`** while every browser
    read filters `.is('merged_into', null)`. Different definitions of "a live customer" —
    MCP can hand back merged-away duplicates.
13. **The `blocked` disposition is broken end to end — the "📝 New / Notes" button in the
    field sheet.** Two independent defects on one path:

    - `TAG` (`JobFinishSheet:44`) has entries for `bill_it`, `return`, `in_progress` and
      `estimate` — **not `blocked`**. `finish()` builds
      `` const newTitle = `${base} ${TAG[disposition]}` `` (`:288`), so the title becomes
      literally `"Customer Name undefined"`. `patchTitle()` has no guard and runs **first**,
      so that hits Google Calendar and commits.
    - `writeTimeEntry('blocked')` then passes `disposition: 'blocked'` straight through
      `timeEntriesApi.create` into a column whose CHECK constraint allows only
      `bill_it|return|estimate|in_progress` (`supabase/migrations/001:36`). Postgres rejects
      the insert, `finish()` throws to the outer catch, and the tech sees
      *"Failed to save — try again."*

    Because the throw happens at step 2, `ensureJobForEvent()` at step 3 never runs — the job
    never reaches `blocked` status. Net effect: a tech taps "Couldn't do it", the customer's
    calendar event gets renamed with `undefined` on the end, no time entry is written, the job
    does not move, and the error invites them to try again — which re-appends nothing but
    re-fails.

    Caveat: the repo's migrations are not a guaranteed mirror of the live database (per
    `OVERWATCH-STATE.md`, SQL is often run directly in the Supabase editor), so the CHECK
    constraint may have been widened live. The `TAG` gap needs no such caveat — it is
    certain from the code.

14. **`normalizeDisposition()` can return values the column rejects.** It returns six values
    (`bill_it · return · in_progress · estimate · skip · triage`) into a column that accepts
    four. Safe only as long as its output is used for reading/classifying and never written
    back — which is the case today, but nothing enforces it.

---

## 8. QUICK REFERENCE — table → files

```
jobs              App BoardView OpsHome OwnerDashboard Scheduler TechCalendar TechWorkToday
                  Unbilled Projects People TaskStack CustomerAudit CustomerHistory LinkAudit
                  WeeklyRecap ShortLink PreviewChanges SoldWork GlobalSearch InboxBar JobDetail
                  JobFinishSheet TicketSheet NewJobModal alertEngine visitsOwed jobResolve
                  schedule.js supabase.js api/sse.js api/welcome-draft.js

time_entries      Unbilled CustomerAudit CustomerHistory WeeklyRecap Projects BoardView
                  CalendarTechDay FieldVisits GlobalSearch alertEngine visitsOwed supabase.js

customers         CustomerLookup CustomerPicker GlobalSearch JobDetail NewJobModal Notes
                  TaskStack Unbilled CustomerAudit CustomerHistory supabase.js api/sse.js
                  api/welcome-draft.js

notes             App TaskStack Notes People OpsHome BoardView CustomerHistory TicketSheet
                  NewJobModal supabase.js

job_history       BoardView WeeklyRecap supabase.js schedule.js api/sse.js

job_assignments   TechCalendar NewJobModal jobResolve supabase.js api/sse.js

techs             JobDetail BoardView ShortLink supabase.js api/sse.js

return_cards      alertEngine supabase.js

settings          App CalendarTechDay
estimates         SoldWork
activity_log      calendarSync
push_tokens       pushNotifications
pl_data           PLUpload PLDashboard
feedback          supabase.js (HelpBot)
```
