-- 058 — Trevor's Aug 27 entries land on the right cards, in his lane
--
-- All six of Trevor's entries saved and all six moved a card within half a
-- second. WHICH card, and where it landed, is what went wrong. Three separate
-- faults, all in the adopt-on-disposition path (src/components/JobFinishSheet.jsx):
--
--   1. THE ADOPT NEVER STAMPED THE TECH.
--      It read event.techName and nothing else, and only one caller
--      (TechWorkToday) fills that field in. So the three jobs it created on
--      8/27 came out with tech_name, assigned_to AND tech_assigned all null:
--        9fdb6993  Jenerette      90m  return   -> return_pending
--        6b932fd2  VRC TTC       270m  return   -> return_pending
--        280b20d1  TTC VRC         0m  bill_it  -> to_bill
--      They are on the board. They are in nobody's lane, so no screen that
--      groups by tech shows them to anyone.
--
--   2. THE HOURS NEVER GOT BACK TO THE CARD.
--      writeTimeEntry runs BEFORE the adopt and resolves the job by event id —
--      which, on an event with no card yet, can only come back null. The adopt
--      then creates the card and nothing tells the entry about it. Four of the
--      six entries carry job_id null, including the 4.5h VRC TTC visit.
--
--   3. THE SAME-DAY FALLBACK TOOK SOMEBODY ELSE'S CARD.
--      Trevor's ride-along copy of the 8/24 Nate Kvamme visit had no card of
--      its own. The fallback matcher (customer + day + still open) found
--      AUSTIN's card 213a4b19, wrote Trevor's event id onto its
--      calendar_event_id, and flipped it to return_pending — while Austin's own
--      3h entry on that job still reads in_progress. scheduled_event_id
--      (j76p3rmk…, Austin's real booking) is untouched and is still the true link.
--
-- The code fixes ship with this migration. This file repairs the six rows they
-- came from. It does NOT decide the two questions that belong to a person:
--   • whether VRC TTC (6b932fd2) and TTC VRC (280b20d1) are one job — see § 5
--   • whether the Kvamme job really needs a return visit — see § 3
--
-- NOT YET APPLIED. Review, then run inside a transaction.

begin;

create table if not exists backup_058_jobs as
  select id, customer_id, tech_assigned, tech_name, assigned_to,
         status, calendar_event_id, scheduled_event_id, scheduled_date, updated_by, updated_at
  from jobs
  where id in ('9fdb6993-5c07-46a4-9ec5-1deaeb46e7bc',
               '6b932fd2-a1fd-490c-a73d-b8ef55362e5c',
               '280b20d1-3127-4d0f-9bae-31bf66745ec2',
               '213a4b19-8ba8-4661-8f39-bef6f11fd118',
               '22eea734-9801-4a43-913f-ecdb4b69d254',
               'f7a548bc-5ffb-4e19-b52d-8f384d749922');

create table if not exists backup_058_time_entries as
  select id, job_id, customer_id from time_entries
  where id in ('e6afb110-39b2-484a-b50d-f2bb2f786365',
               '1ed8cf4e-eaa1-48a1-aa22-14ab48b031b7',
               '91808b69-1026-4f48-a735-c49854e4c128',
               '57705e27-d65d-4deb-8210-6d1638768c6f');

-- ── 1. The three adopted cards get their tech ───────────────────────────────
-- All three columns, because three screens read three different ones: the board
-- reads assigned_to (falling back to tech_name), the scheduler writes
-- tech_assigned, reports group by tech_name. Trevor is 0c3c11e9 in techs.
update jobs
set tech_name     = 'Trevor',
    assigned_to   = 'trevor@drhsecurityservices.com',
    tech_assigned = '0c3c11e9-fb06-40e3-9500-491282cf9c54',
    updated_by    = 'admin@jnbservice.com',
    updated_at    = now()
where id in ('9fdb6993-5c07-46a4-9ec5-1deaeb46e7bc',
             '6b932fd2-a1fd-490c-a73d-b8ef55362e5c',
             '280b20d1-3127-4d0f-9bae-31bf66745ec2');

-- QSC/Wendy's already carries tech_assigned = Trevor and tech_name = 'Trevor',
-- but assigned_to is null; Cafe Mexicali has none of the three even though its
-- job_assignments row names Trevor. Same one-column-of-three problem.
update jobs
set tech_name     = 'Trevor',
    assigned_to   = 'trevor@drhsecurityservices.com',
    tech_assigned = '0c3c11e9-fb06-40e3-9500-491282cf9c54',
    updated_by    = 'admin@jnbservice.com',
    updated_at    = now()
where id in ('f7a548bc-5ffb-4e19-b52d-8f384d749922',
             '22eea734-9801-4a43-913f-ecdb4b69d254');

-- ── 2. The four orphaned entries get their job ──────────────────────────────
update time_entries set job_id = '9fdb6993-5c07-46a4-9ec5-1deaeb46e7bc'
  where id = 'e6afb110-39b2-484a-b50d-f2bb2f786365';   -- Jenerette 8/24, 90m
update time_entries set job_id = '6b932fd2-a1fd-490c-a73d-b8ef55362e5c'
  where id = '1ed8cf4e-eaa1-48a1-aa22-14ab48b031b7';   -- VRC TTC 8/25, 270m
update time_entries set job_id = '280b20d1-3127-4d0f-9bae-31bf66745ec2'
  where id = '91808b69-1026-4f48-a735-c49854e4c128';   -- TTC VRC 8/27, 0m
-- The Kvamme hours DO belong on the Kvamme card — Trevor was there, it is the
-- same job. Only the STATUS move was wrong.
update time_entries set job_id = '213a4b19-8ba8-4661-8f39-bef6f11fd118'
  where id = '57705e27-d65d-4deb-8210-6d1638768c6f';   -- Nate Kvamme 8/24, 180m

-- ── 3. Give Austin's card back its own event id ─────────────────────────────
-- 3cq0esgp… is Trevor's ride-along copy; the fallback matcher wrote it here.
-- The real booking is scheduled_event_id = j76p3rmk…, which is untouched.
-- Set to null rather than to a guess: no history row records what (if anything)
-- was in this column before the overwrite, and null is the state the resolver
-- was actually in on 8/27 — it missed, which is why the fallback ran at all.
update jobs
set calendar_event_id = null,
    updated_by = 'admin@jnbservice.com',
    updated_at = now()
where id = '213a4b19-8ba8-4661-8f39-bef6f11fd118'
  and calendar_event_id = '3cq0esgp1usa5555t2ssanqt5s';

insert into job_history(job_id, from_status, to_status, changed_by, notes)
select id, status, status, 'admin@jnbservice.com',
       'Data repair 058: Trevor''s ride-along event id was written onto this card by the same-day fallback matcher on 8/27 and moved it to return_pending. Event id cleared; the real booking is still scheduled_event_id j76p3rmk. Trevor''s 3.0h stay attached to this job. WHETHER THIS CARD SHOULD BE IN return_pending IS A JUDGEMENT — Trevor found and texted the sensor list, Austin''s own entry on this job still reads in_progress.'
from jobs where id = '213a4b19-8ba8-4661-8f39-bef6f11fd118';

-- IF the card should go back to scheduled (Austin still has it open), uncomment.
-- Left commented on purpose: only the people who were there can say whether a
-- return visit is actually needed, and putting a card back in the wrong lane a
-- second time is the same mistake in the other direction.
-- update jobs set status = 'scheduled', updated_by = 'admin@jnbservice.com', updated_at = now()
--   where id = '213a4b19-8ba8-4661-8f39-bef6f11fd118' and status = 'return_pending';
-- insert into job_history(job_id, from_status, to_status, changed_by, notes)
--   values ('213a4b19-8ba8-4661-8f39-bef6f11fd118', 'return_pending', 'scheduled',
--           'admin@jnbservice.com', 'Data repair 058: undoing a lane move made by another tech''s calendar copy.');

-- ── 4. Cafe Mexicali can reconcile to its calendar event ────────────────────
-- Moved to to_bill correctly, but the card carries no event id at all, so
-- nothing can ever tie it back to the 8/27 event. The id is on its
-- job_assignments row; copy it onto the card.
update jobs j
set calendar_event_id = a.calendar_event_id,
    updated_by = 'admin@jnbservice.com',
    updated_at = now()
from job_assignments a
where a.job_id = j.id
  and j.id = '22eea734-9801-4a43-913f-ecdb4b69d254'
  and j.calendar_event_id is null
  and j.scheduled_event_id is null
  and a.calendar_event_id is not null;

-- ── 4b. QSC/Wendy's happened on 8/24, not 8/28 ─────────────────────────────
-- The only entry of the six that was wired correctly end to end, and its card
-- still says it is scheduled for a day AFTER the visit it is being billed for.
-- The event (c2kdlpm2…) starts 8/24 16:00 MDT, the entry logs 8/24, and the
-- card was moved to to_bill on 8/27 — a future scheduled_date on a to_bill card
-- is a date nothing will ever act on, and it reads as an open appointment on
-- every date-sorted screen. If 8/28 was a real follow-up somebody booked, do
-- not run this — make it a return card instead.
update jobs
set scheduled_date = '2026-08-24',
    updated_by = 'admin@jnbservice.com',
    updated_at = now()
where id = 'f7a548bc-5ffb-4e19-b52d-8f384d749922'
  and scheduled_date = '2026-08-28';

-- ── 5. NOT DONE HERE: the customers, and the VRC/TTC merge ──────────────────
-- Jenerette (9fdb6993), VRC TTC (6b932fd2) and TTC VRC (280b20d1) still have
-- customer_id null. There is no customer named Jenerette in the registry, and
-- "VRC TTC" matches four candidates:
--   0eaef436  Waste Management (TTC)
--   9ed99372  TTC SECUIRTY CONFRIMED
--   df121cf2  TTC Security - WM Colorado Springs MRF - SPO_2745
--   8313167b  [MERGED -> WAS001] Waste Management (TTC)
-- Picking one is a judgement with money attached, and merging 6b932fd2 (4.5h,
-- return_pending) into 280b20d1 (0h, to_bill) is a second one. Both belong on
-- the board's own link and merge tools, with the history in front of a person.
-- Linking is a keystroke to undo. Merging is not.

commit;
