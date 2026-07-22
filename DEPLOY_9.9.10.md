# 9.9.10 — phone number parsing + schedule directly from New

## 1. Phone number parsing
"(800) 787-0545 , Mobile:(970) 282-6985" was going straight into ONE tel:
link as a raw string — the dialer tried to parse the whole garbage string,
including the word "Mobile," and misbehaved.

Added parsePhoneNumbers() — pulls out each real 10-digit number separately,
with its label if one precedes it (e.g. "Mobile:"). Each number now renders
as its own row with its own clean tel: link. Single-number customers are
unaffected — same single row as before.

## 2. Schedule directly from New (no detour through Ready to Schedule)
getQuickActions() only offered Schedule once a job reached READY_TO_SCHEDULE
— from New/Needs Details/Needs Parts/Pending Decision you had to click
"Mark Ready" first, THEN schedule on the next render. Added ACTIONS.SCHEDULE
directly to all of those statuses.

This is safe because ScheduleModal doesn't care what the prior status was —
it just runs jobsApi.changeStatus(job.id, SCHEDULED, ...) once you confirm a
tech/date/time, same as it always has for Ready/Won/Return-pending. So this
reuses the exact same modal, the exact same "Schedule Anyway" checklist
override, and the exact same landing-in-the-Scheduled-lane behavior — it's
now just reachable from more starting statuses. Nothing new to test beyond
"does the button show up," since the underlying scheduling flow is unchanged.

## Files (3, no migration)
- src/components/JobDetail.jsx  (both phone blocks, getQuickActions cases)
- src/utils/statusMachine.js    (parsePhoneNumbers helper)
- src/App.jsx + public/version.json -> 9.9.10, synced

## Deploy
cd ~/code/overwatch.highsidesecurity.com
unzip -o ~/Downloads/overwatch-9.9.10-phone-and-schedule.zip -d .
git add -A
git commit -m "9.9.10 fix phone parsing + schedule available directly from New"
git push
