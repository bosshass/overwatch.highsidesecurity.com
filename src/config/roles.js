// ============================================
// OVERWATCH V3 - User & Role Configuration
// ============================================
// Email → role + display config. Hardcoded.
// Roles: operator (Sara), owner (JR), office (Shana), tech (Austin/Trevor)

export const ROLES = {
  OPERATOR: 'operator',   // Sara — sees everything, billing, rogue detection
  OWNER:    'owner',       // JR — today's jobs, sales, all tech schedules, no billing
  OFFICE:   'office',      // Shana — scheduling, customer DB, task management
  TECH:     'tech',        // Austin, Trevor — their jobs, disposition actions
};

// Default view per role
export const ROLE_DEFAULT_VIEW = {
  [ROLES.OPERATOR]: 'operator',
  [ROLES.OWNER]:    'owner',
  [ROLES.OFFICE]:   'office',
  [ROLES.TECH]:     'field',
};

export const USER_CONFIG = {
  // DRH emails (legacy domain)
  'drhservicetech1@gmail.com':          { name: 'Austin', role: ROLES.TECH,     pin: '56174' },
  'austin@drhsecurityservices.com':     { name: 'Austin', role: ROLES.TECH,     pin: '56174' },
  'jr@drhsecurityservices.com':         { name: 'JR',     role: ROLES.OWNER,    pin: null },
  'info@drhsecurityservices.com':       { name: 'Sara',   role: ROLES.OPERATOR, pin: null },
  'shanaparks@drhsecurityservices.com': { name: 'Shana',  role: ROLES.OFFICE,   pin: null },
  'trevor@drhsecurityservices.com':     { name: 'Trevor', role: ROLES.TECH,     pin: '56174' },

  // Highside Security emails (new domain)
  'jr@highsidesecurity.com':            { name: 'JR',     role: ROLES.OWNER,    pin: null },
  'austin@highsidesecurity.com':        { name: 'Austin', role: ROLES.TECH,     pin: '56174' },
  'shana@highsidesecurity.com':         { name: 'Shana',  role: ROLES.OFFICE,   pin: null },
  'trevor@highsidesecurity.com':        { name: 'Trevor', role: ROLES.TECH,     pin: '56174' },

  // JNB / Operator
  'sara@jnbllc.com':                    { name: 'Sara',   role: ROLES.OPERATOR, pin: null },
  'admin@jnbservice.com':               { name: 'Sara',   role: ROLES.OPERATOR, pin: null },
};

export function getUserConfig(email) {
  const config = USER_CONFIG[email?.toLowerCase()];
  if (config) return config;
  return { name: email?.split('@')[0] || 'User', role: ROLES.TECH, pin: null };
}

export function getDefaultView(email) {
  const config = getUserConfig(email);
  return ROLE_DEFAULT_VIEW[config.role] || 'field';
}

export function requiresPin(email) {
  const config = getUserConfig(email);
  return config.pin !== null;
}
