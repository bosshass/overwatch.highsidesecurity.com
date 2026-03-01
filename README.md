# OVERWATCH V3 — Phase 0: Data Migration

Field operations management for Highside Security.
Google Calendar is the single source of truth for scheduling.

## Phase 0 Deliverable

Migration tool that scans all DRH calendars, classifies events, and batch-rewrites them into V3 format.

### V3 Event Format

**Title:** `[TAG #1247] Customer Name`
**Tags:** `[SERVICE]` `[COMPLETE]` `[BILLED]` `[RETURN]` `[ESTIMATE]` `[NC]` `[DEAD]` `[PERSONAL]` `[IGNORE]`

**Description:**
```
CUSTOMER: Customer Name
PHONE: 303-555-1234
ADDRESS: 123 Main St, Denver CO
ISSUE: Panel not responding to commands
GATE: 1234
PANEL: 5678

--- NOTES ---
2026-03-01 Austin: Replaced main board, tested all zones

🔗 OPEN IN OVERWATCH: https://overwatch.highsidesecurity.com/job/EVENT_ID
⚡ Managed by OVERWATCH
```

## Setup

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Push to GitHub: `github.com/bosshass/overwatch-v3`
2. Connect to Vercel
3. Set env var: `VITE_GOOGLE_CLIENT_ID`
4. Deploy

**IMPORTANT:** Remove `dist/` folder before pushing. Vercel must rebuild fresh.

```bash
rm -rf dist && git add -A && git commit -m "deploy" && git push
```

## Project Structure

```
src/
├── App.jsx                  ← Auth shell (Google OAuth + PIN gate)
├── config/
│   ├── calendars.js         ← HARDCODED calendar IDs (from V2, proven)
│   └── roles.js             ← Email → role mapping
├── services/
│   ├── calendarApi.js       ← Google Calendar read/write (NO Supabase)
│   └── eventParser.js       ← THE contract: parse any event → structured object
└── views/
    └── MigrationTool.jsx    ← Phase 0 migration interface
```

## Hard Rules

1. Calendar = scheduling source of truth
2. Calendar IDs hardcoded in config. NEVER in a database.
3. Event title tags = status. Calendar placement = assignment.
4. eventParser.js is the contract. Everything else uses parsed objects.
5. Useful first, strict never.
