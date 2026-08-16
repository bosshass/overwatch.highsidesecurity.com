// ============================================
// THE version. One place.
// ============================================
// App.jsx used to declare APP_VERSION and public/version.json was edited by
// hand alongside it. They drifted — the repo shipped with version.json at
// 9.17.3 and the bundle at 9.17.2 — and because the live version poll
// force-reloads on any mismatch, the app reloaded itself every 45 seconds
// forever. Nothing could break the loop, because the two numbers could never
// agree no matter how many times it reloaded.
//
// version.json is now GENERATED from this file by scripts/sync-version.mjs,
// which runs on every build. Bump it here and nowhere else.
export const APP_VERSION = '9.63.0';
