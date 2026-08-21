-- 055 — a project is a budget of hours, not a dollar figure
--
-- "Overwatch is NOT going to do accounting. Overwatch gets a budget of hours
--  available and all the hours logged to it and a delta. The billing person
--  gets to say when it is progress invoiced — no dollars — and then when it is
--  complete. That's it."
--
-- WHAT THIS REPLACES
-- The fixed-fee panel asked for six money fields — contract, rate per hour,
-- materials cost, materials billed, billed to date — and drew a progress bar
-- from hours x rate against contract minus materials. A P&L rebuilt by hand in
-- a field-service app, sitting next to a real one in QuickBooks that would
-- disagree with it within a week. Every figure typed there was a second version
-- of a number that already existed somewhere authoritative.
--
-- Three numbers survive, and they are the three Overwatch is genuinely the
-- source of truth for:
--     BUDGET   hours the job was sold with
--     LOGGED   hours in time_entries against it
--     DELTA    budget - logged
--
-- and two stamps that carry NO amount:
--     progress_invoiced   billing says an invoice went out. Not how much.
--                         Repeatable — a long project bills several times, and
--                         the count is what says so.
--     is_complete         billing says it is settled. This is the close-out.
--
-- NOTHING IS DROPPED. estimate_amount, hourly_rate, materials_cost,
-- materials_invoiced and invoiced_amount keep their data and stay readable —
-- the money is simply no longer asked for, shown, or written by the app. A
-- column with history in it is not deleted on the strength of a UI decision.
--
-- APPLIED LIVE 2026-08-21. Backup written first.

create table if not exists backup_055_jobs as select id, is_complete, completed_at from jobs;

alter table jobs
  add column if not exists progress_invoiced_at   timestamptz,
  add column if not exists progress_invoiced_by   text,
  add column if not exists progress_invoice_count integer not null default 0,
  add column if not exists completed_by           text,
  add column if not exists hours_budget           numeric;

comment on column jobs.hours_budget is
  'Hours the project was sold with. Overwatch tracks hours, not money: budget, logged, delta. Seeded from estimated_hours.';
comment on column jobs.progress_invoiced_at is
  'When billing last said a progress invoice went out. NO AMOUNT - Overwatch does not do accounting.';

-- Seed the budget from the hours figure that already existed. Five jobs carry
-- one; the rest read as "no budget yet" until somebody scopes them, which is
-- honest rather than inventing a number from a contract price and a rate.
update jobs set hours_budget = estimated_hours
 where hours_budget is null and estimated_hours is not null and estimated_hours > 0;
