# Jovelin

Multi-tenant field service platform. Forked from the Overwatch codebase with all
client-specific residue removed; QBO-native money; calendar-driven scheduling.

- DB: Supabase project `utljntxknxxwgiijbhqz` (schema: `supabase/migrations/001_initial_schema.sql`)
- Deploy: Vercel (SPA + serverless functions in `/api`)
- QBO app: "Bloodline" (Intuit, independent of Lifeline's app)
- QBO flow: `/api/qbo/connect` -> Intuit consent -> `/api/qbo/callback` -> tokens in `qbo_connections` (service-role only)

## Setup
1. `npm install`
2. Copy `.env.example` -> `.env`, fill Supabase keys + Bloodline dev Client ID/Secret
3. `npm run dev`

## Vercel env vars (required for QBO)
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENV`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Rules: every dollar comes from QBO. Hours never become dollars in-app.
