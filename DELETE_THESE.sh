#!/bin/sh
# Screens People replaces, plus the ones with nothing behind them.
# Run from the repo root AFTER unzipping 9.16.0.
git rm -f src/views/Workspace.jsx      # My Tasks -> now the People tab
git rm -f src/views/OfficeHub.jsx      # 1476 lines; read an empty table
git rm -f src/views/ThingsToDo.jsx     # localStorage only, always empty
git rm -f src/views/QuickNotes.jsx     # your call: retire
git rm -f src/views/KPIDashboard.jsx   # superseded by Capacity
git rm -f src/views/SmsTest.jsx        # test harness
