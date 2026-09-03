# Overwatch — Build Plan
Sept 2026 · v1.0  
Artifact: https://claude.ai/code/artifact/b83863f1-bf1b-493f-af95-9a936cb25957

Four sequential builds. Same DB architecture throughout — UI face changes only.

**Sequence:** BUILD 1: Today View → BUILD 2: Dispo Sheet → BUILD 3: Board Lanes → BUILD 4: History + FieldVisits

---

## Migrations — run before any build that depends on them

| File | Table | Change | Safety | Required by |
|---|---|---|---|---|
| `035_return_cards_next_visit.sql` | `return_cards` | `ADD COLUMN IF NOT EXISTS materials_needed TEXT`<br>`ADD COLUMN IF NOT EXISTS estimated_time TEXT`<br>Both nullable. No existing data touched. | SAFE | Build 2 |
| `036_jobs_blocked_status.sql` | `jobs` | Add `'blocked'` to the `jobs.status` CHECK constraint if not already present. Requires verifying the current constraint first — may already include it. | VERIFY FIRST | Build 3 |

---

## BUILD 1 — Today View (no migration)
**File:** `src/views/TechWorkToday.jsx`

### Changes
- **Phone number** — wrap in `<a href="tel:{phone}">` for one-tap call. Add `<a href="sms:{phone}">` text link alongside. Currently plain text (line 506).
- **Customer name** — link to `/customers?customerId={job.customer_id}` so the tech can pull full history without searching.
- **Navigate to** — maps deep link from the job address: `https://maps.google.com/?q={encodeURIComponent(address)}`. Open in new tab / native maps on mobile.
- **Issue text preview** — default to `ev.description` (GCal event description). Already fetched, no extra DB call. Truncate at ~80 chars. If empty or just address/phone lines, show nothing. Do NOT fall back to `time_entries.notes` — that is billing context, not visit context.
- **In Progress flag** — Bill It, Return, and Estimate already display correctly in Today. The only new addition is **In Progress**. Add it using the same pattern as the existing Return Needed flag. No query overhaul needed.

### Notes
- In Progress flag only — the existing Today rendering already handles Bill It, Return, and Estimate. The only new flag to add is In Progress. Scope is minimal: find where the flag chip is rendered for Return Needed and add an In Progress branch alongside it.
- SMS vs Twilio — the `sms:` link is a native device link. Opens the tech's own Messages app with the number pre-filled. Completely separate from Twilio — no API call.

### Sidebar
- **JR Workflow:** ✓ Unaffected — Build 1 makes no writes.
- **Calendar → Dispo flow:** ✓ Unaffected — calendar link still opens `JobFinishSheet`.
- **DB Writes:** None. Read-only view changes only.
- **Rollback:** Safe — no schema changes. Revert commit, done.

---

## BUILD 2 — Dispo Sheet (requires migration 035)
**Files:** `src/components/JobFinishSheet.jsx`, `supabase/migrations/035_return_cards_next_visit.sql`

### Validation
- **Relax `canFinish`** — current: `notes.trim().length >= 3 && !acting`. New: `!!effectiveDispo && !acting`. Disposition tap is the only required action. Every other field is optional.

### Dispo Panels — clean switch pattern
- **Architecture** — five sub-components (`BillItPanel`, `ReturnPanel`, `EstimatePanel`, `InProgressPanel`, `BlockedPanel`) rendered via an object map keyed by `effectiveDispo`. No scattered conditionals. Each panel takes `onChange` callbacks, owns its own field state.
- **Bill It panel** — single optional text field: billing notes. No required fields.
- **Return panel** — "What to do next visit" (renames current reason field), Materials needed (new — `return_cards.materials_needed`), Estimated time (new — `return_cards.estimated_time`). All optional.
- **Estimate panel** — "What needs estimating?" + optional materials. Writes to `time_entries.notes` via `assembleNotes()`.
- **In Progress panel** — "What's happening next?" text field. On submit: written into GCal event description via `appendFieldNotes()` with Overwatch deep link appended. Writes to `time_entries.notes` via `assembleNotes()`. No lane move — job stays Scheduled.
- **Blocked panel** — "Why couldn't it be done?" + "What's next?" Writes to `time_entries.notes` via `assembleNotes()`. Sets `jobs.status = 'blocked'`.
- **`assembleNotes(disposition)`** — helper builds the `time_entries.notes` string from dispo-specific fields. Old direct `notes` state removed from top-level. Same DB column, new format going forward.

### Risks / Overwrites
- **notes format change** — existing `time_entries.notes` rows contain raw tech text. New rows will contain structured text from `assembleNotes()`. Mixed formats going forward. Low impact today — document for future reporting.
- **canFinish relaxation** — irreversible workflow change. Techs can now submit with zero text. If you want some dispos to still require a field (e.g. Blocked requires "Why?"), that's a per-panel minimum, not a global gate. **Decide before build ships.**
- **GCal description append (In Progress)** — `appendFieldNotes()` is additive (appends, never overwrites). Safe. Calendar event titles are NEVER touched.
- **migration 035 must run first** — if `return_cards.materials_needed` doesn't exist when the Return panel submits, the insert fails hard. Deploy migration before deploying the component.

### Sidebar
- **JR Workflow:** ✓ Unaffected — still writes a `time_entries` row per event. JR's check is row existence — dispo type doesn't matter.
- **Calendar → Dispo flow:** ✓ Unaffected — calendar link still opens `JobFinishSheet`.
- **DB Writes:** Same tables. New columns on `return_cards` only (via migration 035).
- **Rollback:** Revert component commit. Migration columns are nullable — no harm if the component reverts and columns remain.

---

## BUILD 3 — Board Lanes (may require migration 036)
**Files:** `src/views/BoardView.jsx`, `src/components/BoardCard.jsx`, `supabase/migrations/036_jobs_blocked_status.sql`

*Note: Blocked column was added to BoardView in PR #33. Verify the status CHECK constraint before any write of `blocked` status.*

### Lane Architecture
- **Lane order** — New → Return Needed → Scheduled → Estimates → Blocked. Left-to-right: intake → return queue → active → exception.
- **New lane** — `jobs.status = 'new'`. Slate color. No change from today's behavior.
- **Return Needed lane** — `jobs.status = 'return_pending'`. Orange. Previously a flag inside Scheduled — now its own lane. Scheduler sees all return-pending jobs in one place.
- **Scheduled lane** — `jobs.status = 'scheduled'`. Blue. In Progress flag still surfaces here (not a lane move — just a chip on the card).
- **Estimates lane** — `jobs.status = 'needs_estimate'`. Purple. No change from today.
- **Blocked lane** — `jobs.status = 'blocked'`. Red. "Why couldn't it be done?" and "What's next?" fields shown at center focus on the card.

### Board Card Priority
- **Return Needed cards** — "What to do next visit" + materials + est. time shown FIRST. Not billing notes.
- **Blocked cards** — "Why?" + "What's next?" shown FIRST at center focus. Blocked reason is the most important thing the scheduler sees.
- **Lane header colors** — apply semantic colors from the color system to each lane header (slate, orange, blue, purple, red).

### Risk — jobs.status CHECK constraint
- **Verify before coding** — run `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname LIKE '%jobs_status%'` to confirm whether `'blocked'` is already in the constraint. If not, migration 036 must run before any write of `blocked` status.
- Return Needed was a *flag* in the Scheduled lane. Moving it to its own lane means cards that were in Scheduled with a return flag now belong in the Return Needed lane. Verify the board query doesn't leave them stranded.

### Sidebar
- **JR Workflow:** ✓ Unaffected — board is a read view of `jobs.status`.
- **Depends on:** Build 2 must ship first — Blocked dispo needs to write `jobs.status = 'blocked'` before the Blocked lane has cards in it.
- **DB Writes:** No new writes from the board itself.

---

## BUILD 4 — Customer History + FieldVisits Cleanup (no migration)
**Files:** `src/views/CustomerHistory.jsx`, `src/components/FieldVisits.jsx`

### CustomerHistory.jsx
- **Strikethrough fix (line 473)** — currently applies to ALL done items including service jobs. Change condition to only apply to `job_type IN ('note', 'task')`. Service job completions should not show struck-through text.
- **Internal Notes section** — fold `job_type = 'note'` and `job_type = 'task'` rows into a flat "Internal Notes" section with To Do / Done sub-groups. Removes them from the main job timeline where they add noise alongside service visits.

### FieldVisits.jsx
- **"Show this client's other visits"** — currently an inline toggle that expands visits within the component. Change to a navigation link: `navigate('/customers?customerId={job.customer_id}')`. Scheduler gets full customer history in the dedicated view instead of a cramped inline list.

### Behavior Changes (heads-up before shipping)
- FieldVisits inline expansion disappears — replaced with navigation. Low risk — the customer history view is richer anyway.
- Internal Notes section is a new UI grouping — notes/tasks that appeared in the main timeline will move. Worth a heads-up to office staff.

### Sidebar
- **DB Writes:** None. Read-only view changes.
- **Depends on:** None. Build 4 is independent — can ship in any order relative to Builds 1–3.
- **Rollback:** Safe. No schema changes. Revert commit.

---

## Risk Register

| Location | Item | Severity |
|---|---|---|
| `jobs.status` CHECK constraint | Verify `'blocked'` is in the constraint before Build 3. If not, migration 036 must deploy first. | HIGH — VERIFY FIRST |
| `canFinish` validation | Decide per-panel minimums before Build 2 ships. Which dispos (if any) require a field? | MED — DECIDE FIRST |
| In Progress flag placement | Build 1 only adds In Progress to the existing flag system. Find Return Needed chip in TechWorkToday and add In Progress alongside it. Scope is one render branch. | LOW — MINIMAL |
| `time_entries.notes` format | After Build 2, new rows use structured text from `assembleNotes()`. Old rows have raw text. Mixed formats. | LOW — DOCUMENT |
| Return Needed lane migration | Cards with `status = 'return_pending'` should appear in the new lane automatically. Verify board query after Build 3 deploy. | LOW — VERIFY AFTER |

---

## Locked Decisions

- **Task badge color:** teal (`#5eead4`) — NOT purple. Purple is Estimates exclusively.
- **`appendFieldNotes()`** extends to all 5 dispositions.
- **`canFinish` → per-panel minimums:** Bill It + Blocked have required fields; others optional.
- **Issue preview:** `ev.description` only, never `time_entries.notes`.
- **Calendar event titles:** NEVER touched. Only descriptions may be appended, append-only.

---

## Companion Artifacts

- 🗺️ Dispo Map: https://claude.ai/code/artifact/046493c8-352e-4d18-b6dc-39dca5572e47
- 🎨 Color System: https://claude.ai/code/artifact/c2fb7e69-f149-453a-96d2-8a3b1a7d5197
- 🃏 Board Card Mockup: https://claude.ai/code/artifact/28de5b0b-8eab-4376-accc-310a19802228
