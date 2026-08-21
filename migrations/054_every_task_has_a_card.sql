-- 054 — every open task has a parent card on the board
--
-- "All of the notes right now I need to show up on the board. Tasks are born
-- from notes cards — all of the stuff with the tasks should have a parent note
-- in the board."
--
-- A note is a thought. Assigning it to somebody makes it a TASK: work a person
-- now owes. Two creation paths wrote tasks with NO job_id — NewJobModal's task
-- form and the assign button in /notes — so the work lived in one person's
-- stack and nowhere else: not on the board, not on the customer, not findable
-- by anyone who did not already know to look.
--
-- Found 2026-08-21, of 33 open tasks:
--   8  had no card at all
--   4  pointed at an ARCHIVED card (a parent closed while its task is open)
--   1  pointed at a card killed by a merge — the merge tool moved job_history
--      and the calendar event and left notes.job_id on the corpse
--
-- Inbound texts are excluded throughout. The webhook assigns every reply to
-- whoever sent the outgoing message, which looks exactly like a task to any
-- rule keyed on assigned_to — a client's "yes that works" must not manufacture
-- a card on the board.
--
-- APPLIED LIVE 2026-08-21. Backups written first. The code fix that stops this
-- recurring is notesApi.ensureBoardCard(), called from both creation paths and
-- from the handoff in Tasks; the merge tool now repoints notes as well.

create table if not exists backup_054_notes as
  select * from notes where status='open' and assigned_to is not null and body not like '📲 Text from%';
create table if not exists backup_054_jobs as
  select * from jobs where id in ('a2060b7a-e071-4e48-9c67-a36c43a1e186','96d685d9-e22d-442c-afd0-d83d4369f54c',
    '89364e2e-df31-4d1d-b0d0-1d0c13c0459d','bc6593e0-8ada-4ab6-8f4a-d89bb662da3c','da9fc153-4e06-4127-9ae1-337e108be23a');

do $$
declare n record; jid uuid; cname text;
begin
  -- 1) The task whose parent was merged away follows its parent. Not a guess:
  --    both sides carry the merge in job_history (da9fc153 -> ee64b68a).
  update notes set job_id = 'ee64b68a-da98-41d5-acef-07ff4d2336f9'
   where id = '311ad1fc-9fff-477a-b361-b3a696c3fa7c' and job_id = 'da9fc153-4e06-4127-9ae1-337e108be23a';

  -- 2) A parent cannot be archived while its task is still open. Revive it to
  --    the New/Notes lane rather than closing the task: the work is real, and
  --    somebody archived the card without noticing what it carried.
  for n in
    select distinct j.id, j.status
    from notes t join jobs j on j.id = t.job_id
    where t.status='open' and t.assigned_to is not null
      and t.body not like '📲 Text from%'
      and j.status in ('archived','dead')
  loop
    update jobs set status='new', updated_by='admin@jnbservice.com', updated_at=now() where id=n.id;
    insert into job_history(job_id, from_status, to_status, changed_by, notes)
    values (n.id, n.status, 'new', 'admin@jnbservice.com',
            'Back on the board — an open task still points at this card. A parent cannot be closed while the work it carries is open.');
  end loop;

  -- 3) Tasks with no card at all get one. job_type 'note', status 'new' — not
  --    a job (nobody drives to it), but a thing on the board with a customer,
  --    a history and a URL. 'Internal' where there is no customer: a gift
  --    basket is still work, it is just not about anybody.
  for n in
    select t.id, t.body, t.customer_id, t.assigned_to, t.assigned_by, t.author_email
    from notes t
    where t.status='open' and t.assigned_to is not null and t.job_id is null
      and t.body not like '📲 Text from%'
  loop
    select c.name into cname from customers c where c.id = n.customer_id;
    insert into jobs (customer_name, customer_id, job_type, status, issue, assigned_to, created_by, updated_by)
    values (coalesce(cname,'Internal'), n.customer_id, 'note', 'new',
            left(regexp_replace(n.body, E'\\s+', ' ', 'g'), 500),
            n.assigned_to, coalesce(n.assigned_by, n.author_email, 'admin@jnbservice.com'),
            'admin@jnbservice.com')
    returning id into jid;
    insert into job_history(job_id, from_status, to_status, changed_by, notes)
    values (jid, null, 'new', 'admin@jnbservice.com', 'Card created for a task that had none — every task has a parent on the board');
    update notes set job_id = jid where id = n.id;
  end loop;
end $$;

-- Verified after running: 33 open tasks, 0 with no card, 0 whose parent is
-- archived or dead.
