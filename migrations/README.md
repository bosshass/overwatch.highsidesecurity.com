# migrations/

SQL run against the V9 Supabase project (`wolhqelloeypafmmvapn`).
Kept in the repo so they survive a new chat session — these previously existed
only as chat attachments, which meant one closed tab from being lost.

Run in the Supabase SQL editor with **"No limit"** set. Paste the whole file.

---

## STATUS

| File | Ran | What it does |
|---|---|---|
| `038_pre_july_closeout.sql` | **NO — superseded** | Closed 3 pre-July jobs. Replaced by 042's entry-level close-out. Kept for history. Do not run. |
| `039_v3_structures.sql` | **NO** | Creates six tables V9 lacks. See below. |
| `040_events_import_columns.sql` | **NO** | Prepares `customer_history` + `stg_events` for the 896-row Events_Final import. Depends on 039. |
| `041_purge_test_data.sql` | **YES** 2026-08-13 | Deleted 47 QA time entries (107.9h). |
| `041b_repair_rollback.sql` | **YES** | Rebuilt the two customer rows 041 deleted without backing up, so the rollback works. |
| `041_ROLLBACK.sql` | not needed | Undoes 041. Still valid. |
| `042_resolution_and_pre_july_closeout.sql` | **YES** | Added `billable`/`resolved_at`/etc; resolved 193 pre-July entries; marked 17 rows `project hours`. |
| `042_ROLLBACK.sql` | not needed | Undoes 042 by clearing the new columns. |
| `041_pre_july_time_entry_closeout.sql` | **NO — superseded** | Early draft that set `billed = true`. Rejected: it asserts an invoice went out. Kept as a record of why. Do not run. |

**Backup tables from 041/042/044/045 must not be dropped.** They are the only
undo. `time_entries_backup_041_test`, `customers_backup_041_test`,
`time_entries_relink_041`, `time_entries_backup_042`, `time_entries_backup_044`,
`jobs_backup_045_test`, `notes_backup_045_test`,
`time_entries_backup_045_test`, `job_history_backup_045_test`.

---

## 039 — what it is, and why it hasn't run

Six tables that exist in V3 and not in V9. Each one is a place data currently
has nowhere to go, so it ends up crammed into free text:

| Table | The problem it solves |
|---|---|
| `tasks` | Errands become **jobs**. "Battery Plus cr123 for David", "PREPARE FOR CHRIS HARE INSTALL" — on the board with junk statuses because the only button was "Create job & link". |
| `monitoring_accounts` | One `cs_number` per customer. **Acertara has two** (EL3552 $10.45, 6910938 $20.07) so V9 made it three customer rows. Same root cause as the 346-vs-257 monitoring reconciliation. |
| `job_materials` | `jobs.materials_used` is **empty on all 456 rows**. Materials live in note text as "1ea Battery" — not something you can price. |
| `parts_orders` | `parts_ordered`/`parts_received` are booleans, so a job can only ever have one order. |
| `estimates` | Pulls `qbo_estimate_*` off the `jobs` god-table. |
| `customer_history` | Reference-only historical events. Where the pre-July mess belongs instead of `jobs`. |

**It is purely additive** — creates tables, adds nullable columns. Nothing is
dropped or rewritten. Safe to run whenever.

**Why it hasn't:** it creates six EMPTY tables. Zero risk, zero benefit until
app code writes to them, and that is real work per table. Running it now just
adds unused schema.

**One fix already applied** (2026-08-17): `monitoring_accounts` was transcribed
straight from V3, and **V3 has no QuickBooks linkage at all**. Added
`qbo_customer_id`, `qbo_customer_name`, `monthly_rate` — without those it could
not answer "which QBO customer does EL3552 bill to", which is the entire
Acertara problem.

**If you run only one piece of 039, make it `monitoring_accounts`.** It stands
alone, it fixes Acertara, and it unblocks the 102 monitored customers with no
`qbo_customer_id`.

**040 depends on 039** — it extends `customer_history`, which 039 creates.

---

## Conventions

- Idempotent: `create table if not exists`, `add column if not exists`
- `updated_by = 'descriptive-slug-YYYY-MM-DD'` on every direct SQL update
- Back up before deleting; `alter table ... enable row level security` on the
  backup so it isn't reachable from the browser
- Guard destructive runs: fail loudly if the backup table already exists, and
  assert the expected row count before deleting
- Large inserts truncate in the Supabase editor — split into ~100-row files
