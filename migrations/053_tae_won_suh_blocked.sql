-- 053 — TAE WON SUH: a return that was never a return
--
-- The card sat in `return_pending`, scheduled 2026-08-06, with ZERO time
-- entries. Sara: "taw suh - JR never did notes no one was there, needs to bill
-- a trip. That's what the blocked option in the today or job dispo form was
-- meant for."
--
-- Nothing was started, so nothing needs returning to. A tech drove out and
-- could not get in. That is `blocked` — and the trip is chargeable.
--
-- APPLIED LIVE 2026-08-21. Backup table written first.

create table if not exists backup_053_tae_won_suh as
select * from jobs where id = '8bfbd411-496e-4e80-8269-ae32edd06504';

update jobs
set status = 'blocked',
    updated_by = 'admin@jnbservice.com',
    updated_at = now()
where id = '8bfbd411-496e-4e80-8269-ae32edd06504'
  and status = 'return_pending';

insert into job_history(job_id, from_status, to_status, changed_by, notes)
values ('8bfbd411-496e-4e80-8269-ae32edd06504', 'return_pending', 'blocked',
        'admin@jnbservice.com',
        'JR went out 8/6 and nobody was there. No notes were written and no work was done, so this was never a return — it was a trip. Set to blocked so the trip reaches billing.');

-- NO TIME ENTRY IS WRITTEN. time_entries is the only authoritative record of
-- hours, and JR never filed one. Inventing a row under his name — even a
-- zero-minute one — would put words in a tech's mouth in the one table the
-- money is read from. The card reaches Billing on its status alone: `blocked`
-- is now swept into the "Trip to bill" bucket with no entry required.
