# 9.9.7 — the real bug: jobsApi.getById() has always 400'd

## The actual root cause (found via 9.9.6's visible error)
jobsApi.getById() did:
  select(`*, assignments:job_assignments(*, tech:techs(*))`)

PostgREST embeds a related table like that ONLY if a real foreign key exists
between the two tables. There is no FK from job_assignments -> jobs in this
schema, so this exact query has been returning:

  400 Bad Request
  PGRST200: Could not find a relationship between 'jobs' and 'job_assignments'
            in the schema cache

...for EVERY caller of jobsApi.getById(), the whole time — not something any
of tonight's changes caused. It only became visible now because 9.9.6 made
failures show an error instead of a silent blank screen, and 9.9.5's direct
JobDetail render was the first path that actually surfaced it clearly in the
console.

## The fix
Removed the broken embed. jobsApi.getById() now does a plain select('*').
Nothing lost: every real caller (JobDetail included) already fetches
assignments SEPARATELY via assignmentsApi.getForJob(id) right after calling
getById — the embed was redundant even when it worked in theory.

## Files (2, no migration)
- src/services/supabase.js  (jobsApi.getById fixed)
- src/App.jsx + public/version.json -> 9.9.7, synced

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.7-getbyid-fix.zip -d .
git add -A
git commit -m "9.9.7 fix jobsApi.getById — remove broken job_assignments embed"
git push

Test: tap the same /j/319311eb link. The card should open for real this time.
