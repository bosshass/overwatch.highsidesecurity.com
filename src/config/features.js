// ============================================
// Feature flags
// ============================================
// Temporary de-scoping to focus on the core operational loop:
//   Office Creation -> Scheduling -> Tech Completion -> Billing
// Flip a flag back to `true` to re-enable a feature once the core loop is stable.

export const FEATURES = {
  HELPBOT: false,          // HelpBot AI assistant (global overlay)
  PL_UPLOAD: false,        // P&L xlsx upload + P&L dashboard
  ADMIN_GAP: false,        // Admin gap / reconciliation report
  DASHBOARDS: false,       // Owner dashboard + complex reporting
  ORPHAN_ADOPTION: false,  // Orphan calendar event detection / adoption
  PROJECT_GROUPING: false, // Project (P/S code) grouping view
};

export function isEnabled(flag) {
  return FEATURES[flag] === true;
}
