// ============================================
// JUC-E V4 - Roles Config (Simplified)
// ============================================
// V4 doesn't gate views by role. Everyone gets all 3 views.
// This file exists for display names and future permissions.

export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  TECH: 'tech',
  WORKER: 'worker'
};

// Email → role mapping (for future permissions)
export const USER_ROLES = {
  'jr@drhsecurityservices.com': ROLES.OWNER,
  'info@drhsecurityservices.com': ROLES.ADMIN,
  'sara@jnbllc.com': ROLES.ADMIN,
  'shanaparks@drhsecurityservices.com': ROLES.ADMIN,
  'drhservicetech1@gmail.com': ROLES.TECH,
  'austin@drhsecurityservices.com': ROLES.TECH,
};

export const DISPLAY_NAMES = {
  'drhservicetech1@gmail.com': 'Austin',
  'austin@drhsecurityservices.com': 'Austin',
  'jr@drhsecurityservices.com': 'JR',
  'info@drhsecurityservices.com': 'Sara',
  'sara@jnbllc.com': 'Sara',
  'shanaparks@drhsecurityservices.com': 'Shana',
};

export function getUserRole(email) {
  return USER_ROLES[email?.toLowerCase()] || ROLES.WORKER;
}

export function getDisplayName(email) {
  return DISPLAY_NAMES[email?.toLowerCase()] || email?.split('@')[0] || 'User';
}
