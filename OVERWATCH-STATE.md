# OVERWATCH — STATE

Paste this at the start of a new conversation, with the repo zip.
Last updated: 2026-08-17 · v9.76.0 + lint gate fix

---

## WHO / WHAT

**Sara Hass** — owner/operator, DRH Security Services (Colorado). Sole developer.
Overwatch is field ops for DRH. Direct, terse, often voice-dictated (names get
mangled: "Shana" → "China"). Wants decisions made, not questions asked. No
padding, no pep talk.

**Team:** JR (field tech, Ubiquiti, `info@drhsecurityservices.com` — SHARED
mailbox, six people sign in on it) · Shana (scheduler, `shanaparks@`) ·
Austin (field tech, `drhservicetech1@gmail.com`) · Trevor · Sara.
**Brian was removed** and keeps resurfacing across the codebase.

**Repos:** `bosshass/overwatch.highsidesecurity.com` (V9, live) ·
`bosshass/overwatch-v3` (V3 rebuild) · `bosshass/highsideweb` (public site) ·
`bosshass/jovelin` (multi-tenant platform — DIFFERENT APP, don't confuse them)

**Supabase:** V9 `wolhqelloeypafmmvapn` · V3 `wppwofsbwymzaeyapwhs`

---

## THE ONE RULE

**Never derive structured meaning from free text.**

This is the disease the whole codebase has been recovering from. Bracket tags
parsed out of calendar titles, customers matched by name substring, dispositions
regex'd out of strings. It billed an hour to BG Automotive because a title said
"Loveland". It picked HUANG, DAVID out of twelve Davids from the word "David".

`utils/fuzzyMatch.js` was DELETED. Do not rebuild it in any form.

**Still live, known, not yet fixed:**
- `JobFinishSheet.jsx:196` — `ilike('customer_name', ...)` on unlinked events
- `services/supabase.js` — `normalizeDisposition()` regexes BILLED/RETURN/
  ESTIMATE/NC out of a string. May be fine for legacy import, not for writes.

---

## HOW TO SHIP (this matters more than it sounds)

**NEVER send whole-file zips.** A zip built on a stale snapshot silently deleted
`fmtLocalDate` from `lanes.js` and broke production. Later zips overwrote 15–20
files at a time, most unchanged — each one a chance to revert a fix nobody
notices for weeks.

**Send a Python patch script instead.** It finds an exact anchor string and edits
around it. If the anchor is missing it prints MISS and writes NOTHING to that
file. It cannot delete a function it has never seen.

**Always `npm run verify`, never `npm run build`.**
`verify` = `lint:quick && build`. The lint gate is `no-undef` only, and exists
because Vite compiles dead references that crash on render. `gap is not defined`
and a TDZ crash both reached production because only `build` was run. Expect
**0 errors, 5 warnings** — the warnings are stubbed-rule directives and are fine.

**Deploy loop:** patch script → `npm run verify` → `git add -A` → commit → push.
Vercel auto-builds from `main`.

**Version:** `src/version.js` is the only source. `scripts/sync-version.mjs`
generates `public/version.json` on prebuild. Don't edit version.json by hand.

---

## DOMAIN RULES SARA HAS SET

**Disposition deadline.** The scheduled day ends 6pm. Fourteen hours later —
8am next morning — a disposition is overdue. Weekends roll: a Friday visit is
not late until Monday 8am. Keyed on STATUS (`scheduled`), not on notes: notes
can be written against an older visit, status cannot lie about this one.
See `utils/staleness.js` → `needsDisposition()`.

**Clearing needs a reason.** A New/Note or quick task clears in one tap — nobody
promised anything. Once it is Ready to Schedule / Scheduled / Return / Done /
To Bill / Won it is a COMMITMENT, and clearing it is a money decision that must
be classified when it happens. `utils/lanes.js` → `requiresDisposition()`.
Reason is stored as a KEY (`warranty`, `goodwill`, `sales_call`) never prose —
`isRealCost()` can classify a key, not a sentence.

**Billing reads the ENTRY, not the job status.** Precedence: `resolved_at` →
`billed`/`invoice_ref` → `billable` → `archived` → `disposition` → job status.
Reading job.status first put 164 already-invoiced visits in "To bill" forever.

**Project hours ≠ non-billable.** Fixed-fee work bills under the contract. It is
`billable = false, non_billable_reason = 'project hours'` and it STAYS VISIBLE
in Billing until the project closes. Never call it "not billable" in the UI.

**Invoice number is mandatory on billed.** Use `00000` to bypass when none
exists. `NC-ARCHIVED` is history — keep it, never overwrite it.

**Notes → tasks → jobs.** Sara's model, stated 2026-08-17:
notes are "new" → notes can make tasks → tasks get assigned → OR a "new" becomes
a job and lands in `ready_to_schedule`. That is the whole thing.
**Currently violated:** `CustomerHistory.jsx:296/312` and `NotesPanel.jsx:131`
write `job_type: 'note'` / `'task'` into the **jobs** table. 90 such rows exist,
all terminal, 3 of them `status='billed'` at $0.00.

---

## SCHEMA TRAPS (learned the hard way)

- **`jobs` vs `job_assignments` write paths.** Scheduling writes go to
  `job_assignments.calendar_event_id`. `jobs.calendar_event_id` is the intake
  link. Merging them severs time-entry joins.
- **`time_entries.job_id` is largely null** — most link only via
  `calendar_event_id`. Billing write-throughs assuming `job_id` do nothing.
- **Deleted Google Calendar events return HTTP 200 with `status:'cancelled'`**,
  not 404. Handle both plus cancelled.
- **RLS on with zero policies = table invisible to the browser.** New tables via
  the Supabase UI have RLS on by default.
- **`scheduled_date` is a DATE.** `new Date('2026-08-07')` is UTC midnight =
  the previous evening in Denver. Always parse by parts.
- **Large SQL inserts truncate** in the Supabase editor. Split ~100 rows.
- **Audit trail:** `updated_by = 'descriptive-slug-YYYY-MM-DD'` on direct SQL.

---

## DATA WORK DONE (2026-08-13, all reversible)

- **041** — 47 test time entries deleted (107.9h). Backups:
  `time_entries_backup_041_test`, `customers_backup_041_test`,
  `time_entries_relink_041`. Rollback script exists.
- **042** — 193 pre-July entries got `resolved_at`. 17 rows marked
  `project hours`. Backup: `time_entries_backup_042`. Money fields untouched.
- **044** — 16 duplicate entries marked superseded.
- **045** — 29 test jobs, 15 test notes, 109 job_history rows deleted.
- Boys & Girls Club Loveland relinked from BG AUTOMOTIVE to `BOY058`.

`time_entries`: 333 → 286 rows, 661.7h → 553.8h.
Real invoiceable work: **6 rows / 7.1h**.

**Do not drop any `%041%` / `%042%` / `%044%` / `%045%` backup table.**

---

## OPEN, NOT URGENT

- **46 orphaned calendar events** — terminal jobs still holding
  `scheduled_event_id`. `releaseCalendar()` fixes forward only; the existing 46
  need a one-off sweep with a Google token.
- **Google → Overwatch is one-way.** Edit an event in Calendar and
  `jobs.scheduled_date` never updates. Causes false no-disposition flags.
- **`BuildLog` is at 9.11.13** — ~50 releases undocumented.
- **Bundle is 1,411 kB** (was 1,344 at 9.27). No code splitting.
- **Migration 039** written, unrun — creates `tasks`, `customer_history`,
  `estimates`, `parts_orders`, `job_materials`, `monitoring_accounts`.
  `monitoring_accounts` needs `qbo_customer_id` + `monthly_rate` added before
  running; V3 has no QBO linkage at all.
- **Acertara** — one customer, three V9 rows. `EL3552` at $10.45/mo has no QBO
  link. Part of a wider **102 monitored customers with no `qbo_customer_id`**.
- **CMS alert emails** — existed in the old JUC-E app, never ported.
  `gmail.readonly` is still in `SCOPES` as the only trace.

---

## PACE WARNING

48 versions shipped 2026-08-13 → 08-16, none with `npm run verify`. A TDZ crash
reached production and needed a revert cycle. Home was rebuilt four times.
Nothing is broken — but "the app feels worse" was churn, not damage.

**Ask what specific tap feels wrong before changing anything.**
