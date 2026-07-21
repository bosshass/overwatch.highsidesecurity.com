# 9.9.8 — phone fallback, merge-noise cleanup, note-type picker

## 1. Phone number missing
job.customer_phone was the ONLY source shown, and it's often empty even when
the linked customer record has one. Now falls back to linkedCustomer.phone
in both places phone renders (execution view + admin view).

## 2. "Merged from" clutter — two sources, both fixed
a) Customer info box: linkedCustomer.notes sometimes IS raw merge-audit text
   left over from the dedup effort ("MERGED FROM CS123…" on ~341 rows). Added
   isMergeAuditText() and hide it there — CMS id still shows, real notes still
   show, just not audit-trail text.
b) Note thread (NotesPanel): already filtered ONE merge format
   ("↪ from merged job") but not the one JobDetail's own merge tool actually
   writes ("🔗 MERGED FROM JOB #…" / "[MERGED INTO JOB #…]"). Now filters all
   three. Nothing is deleted — still in job_history if ever needed directly.

## 3. Note-type picker (the new thing)
Add-a-note now shows 3 pills once you start typing:
  📝 Note                    — unchanged default: a job_history entry on THIS job
  💬 Response                — same job note, prefixed "💬 Response:" so it
                                reads as a logged customer response, not an
                                internal note
  🗒️ Customer note (no job)  — for a touch that ISN'T tied to any job (a call,
                                a question, nothing to schedule). Creates a
                                lightweight job_type:'note' row against the
                                customer and puts the note there. job_type
                                'note' is excluded from board columns, so it
                                never shows as work — the customer just has a
                                real record of the interaction.

Note: "Customer note" needs job.customer_id to exist. If this job has no
linked customer, it says so and asks you to use a regular note instead.

## Files (3, no migration)
- src/components/JobDetail.jsx   (phone fallback + merge-audit suppression)
- src/components/NotesPanel.jsx  (merge filter widened + note-type picker)
- src/App.jsx + public/version.json -> 9.9.8, synced

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.8-notes-and-phone.zip -d .
git add -A
git commit -m "9.9.8 phone fallback, merge-audit cleanup, note-type picker"
git push
