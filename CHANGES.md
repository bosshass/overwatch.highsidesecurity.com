# Overwatch Cleanup — Consolidate Job-Finish Flows

**Date:** May 7, 2026
**Branch suggestion:** `cleanup/job-finish-consolidation`

## Why

Four different "tech finishes a job" modals existed, each with different behavior. Three of them wrote data nothing downstream read (graveyards). This change consolidates the calendar-driven flow into one canonical component.

## What changed

### NEW

- `src/components/JobFinishSheet.jsx` — single canonical "tech finishes a job" component. Two render modes (`inline` for embedding inside a richer parent sheet, standalone for direct opening). Writes time_entries + return_cards. Patches calendar title with new canonical tags.

### MODIFIED

| File | Change |
|---|---|
| `src/views/TechWorkToday.jsx` | Replaced ~210 lines of inline finish handlers + duplicate `ReturnButtonWithReason` with `<JobFinishSheet inline>`. `getTab()` now recognizes new `[BILL IT]` tag (still parses legacy `[COMPLETED]`/`[TO BILL]` for backward compat). |
| `src/App.jsx` | Replaced `CompletionModal` with new `DeepLinkFinish` wrapper that fetches the event then renders `JobFinishSheet`. Dropped `/jobs` route + `JobStatus` import. |
| `src/views/TechCalendar.jsx` | Replaced `JobCompleteModal` with `JobFinishSheet`. |
| `src/components/JobDetail.jsx` | Removed `TimeCaptureModal` import and overrun-detection branch from `submitCompletion()`. Replaced with new local `InlineTimeGate` component (~110 lines appended at bottom of file). Same fields (time arrived / departed / notes) minus overrun detection. |
| `src/views/Billing.jsx` | Added `BILL IT` to bill_it bucket regex in `TAG_MAP`. |
| `src/views/Queue.jsx` | Added `[BILL IT]` to `SKIP_PREFIXES` and `DONE_TAGS`. |
| `src/views/BoardView.jsx` | Added `[BILL IT]` to `DONE_TAGS`. |
| `src/views/Scheduler.jsx` | Added `[BILL IT]` to `DONE_TAGS`. |
| `src/components/GlobalSearch.jsx` | Job result clicks now navigate to `/board` (was `/jobs` — route removed). |

### DELETED (drop these from the repo)

```
src/components/CompletionModal.jsx
src/components/JobCompleteModal.jsx
src/components/TimeCaptureModal.jsx
src/views/JobStatus.jsx
src/utils/overrunDetection.js
```

## Canonical tag wording (going forward)

| Disposition | Tag suffix on calendar event title |
|---|---|
| Bill It | `[BILL IT]` |
| Return | `[RETURN]` |
| In Progress | `[IN PROGRESS]` |
| Estimate | `[ESTIMATE]` |

Existing calendar events tagged with legacy values (`[COMPLETED]`, `[TO BILL]`, `[RETURN NEEDED]`, `[ESTIMATE NEEDED]`, etc.) will continue to parse correctly — every parser keeps the legacy synonyms as accepted input. Only NEW finishes will write the canonical tags.

## Apply this in your repo

1. Unzip into the project root, replacing the existing `src/` directory:
   ```bash
   cd ~/overwatch.highsidesecurity.com-main
   rm -rf src
   unzip -o /path/to/overwatch_cleanup_src.zip
   ```

2. Confirm the deletes happened (the unzip won't remove old files; the zip just has the current canonical state):
   ```bash
   git status
   # Should show: deleted CompletionModal.jsx, JobCompleteModal.jsx, TimeCaptureModal.jsx, JobStatus.jsx, overrunDetection.js
   # Should show: new file JobFinishSheet.jsx
   # Should show: modified App.jsx, JobDetail.jsx, GlobalSearch.jsx, TechWorkToday.jsx, TechCalendar.jsx, Billing.jsx, Queue.jsx, BoardView.jsx, Scheduler.jsx
   ```

3. Build locally to verify:
   ```bash
   npm run build
   ```

4. If clean, push:
   ```bash
   git add -A
   git commit -m "Consolidate job-finish flows into JobFinishSheet; drop dead modals"
   git push
   ```

5. Vercel will auto-deploy. Smoke test:
   - Tech opens a job in `/work` → bottom sheet → finish flow works (Bill It, Return, In Progress, Estimate buttons all wired).
   - Open a calendar event "📱 Open in Overwatch" deep link → JobFinishSheet renders → finish saves.
   - Open a job from `/calendar` → click into it → finish modal works.
   - Open a Supabase job from `/dashboard` → status change with time gate works (this is the JobDetail path, separate from the calendar flow).

## Net code change

- **+650 lines** added (mostly the new JobFinishSheet + InlineTimeGate inside JobDetail)
- **−1,015 lines** deleted (5 dead files + duplicate handlers in TechWorkToday)
- **Net: −365 lines**

## What was deliberately NOT changed

- **`JobDetail.jsx` still uses its own time-gate** (now inline, not external). This is intentional — `JobDetail` operates on the Supabase `jobs` table with the legacy status machine (`jobsApi.changeStatus`, `assignmentsApi.markComplete`), which is a fundamentally different data path than the calendar+time_entries flow. Whether to retire that architecture entirely is a separate product decision worth its own conversation.
- **Other `/board` swimlane wording** — column labels still use words like "Approved Estimates" etc. Those are display-only labels, not parser inputs, and were out of scope for this cleanup.
- **README.md** — still says "No Supabase. No database." which is wrong, but didn't touch in this PR. Fix on the next pass.
