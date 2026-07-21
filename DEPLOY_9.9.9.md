# 9.9.9 — strip the intake-form boilerplate out of every description

## The problem
The Service/Urgent intake template ("Name: / Phone: / On-Site Contact: /
Contact Phone: / CMS #: / Access: ☐.../ Scope of Work:") gets copied verbatim
into job.issue / the calendar event description whenever a job comes from
that intake flow. Most of it duplicates fields already shown elsewhere on the
card (name, phone, CMS id); the rest is unfilled placeholder scaffolding.
It was showing up as noise in SIX separate places across three files.

## The fix
One shared helper, stripIntakeTemplate() in utils/statusMachine.js — regex-
matches the fixed header (all fields optional except Name/Phone/Scope of
Work) and returns only whatever real content was written after "Scope of
Work:". Tested against your exact pasted example — correctly reduces to just
"Beeping panel, unsure why. Spoke with Marie at front desk."

Wired into every place that shows issue/description text:
- JobDetail.jsx    — both Issue boxes (execution + admin view)
- BoardView.jsx    — expanded card's Issue box + the 2-line card preview
- Queue.jsx        — triage card expanded description, job.issue line, and
                     the 100-char truncated preview

If a job's ENTIRE issue was just the unfilled template with nothing after
"Scope of Work:", the box now doesn't render at all (rather than showing an
empty shell) — same as how these blocks already hide when there's no issue.

## Files (5, no migration)
- src/utils/statusMachine.js   (new helper)
- src/components/JobDetail.jsx
- src/views/BoardView.jsx
- src/views/Queue.jsx
- src/App.jsx + public/version.json -> 9.9.9, synced

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.9-strip-intake-template.zip -d .
git add -A
git commit -m "9.9.9 strip intake-form boilerplate from every issue/description display"
git push
