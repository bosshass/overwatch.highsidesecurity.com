// ============================================
// JUC-E — Hardcoded Calendar Configuration
// ============================================
// Source of truth for all calendar IDs and visibility.
// DO NOT pull from Supabase. Lives here only.

export const CALENDARS = {
  TENTATIVELY_SCHEDULED: 'de3d433f5c6c6a85f5474648e005cac43529d5bed542b74675a37a30cf0ece91@group.calendar.google.com',
  ADMIN_NOTES:           'fff001b042126a6179ac3abe30b1b7928a6f6170227a290d5f24fd0ec2ffa0c9@group.calendar.google.com',
  AUSTIN:                'drhservicetech1@gmail.com',
  JR:                    'do0i4f1jqbbakd72mpgpll9m6g@group.calendar.google.com',
  SALES_ACCOUNTING:      'c_aa764bfa5d492c689c26e3ed589df2804a04ee175db1b68d48217bd18883d178@group.calendar.google.com',
  COMPLETED:             'c_a095f8a75a8e3fb1bb4b0f3a2232962af3ab55f05a49ced1e4338abcc865d3e9@group.calendar.google.com',
  INSTALLATIONS:         'c_c84c0a24e2a7386cb519b21569fbb4b17a19214ce33744a63e06394f8c57339f@group.calendar.google.com',
  SHANA:                 'shanaparks@drhsecurityservices.com',
};

// ── Visibility ───────────────────────────────────────────────────────────────
// visibleTo: null  = operators only (Sara)
// visibleTo: [...] = those specific user emails + operators always
const OPERATOR_EMAILS = [
  'info@drhsecurityservices.com',
  'sara@jnbllc.com',
  'admin@jnbservice.com',
];

const AUSTIN_EMAILS  = ['drhservicetech1@gmail.com', 'austin@drhsecurityservices.com'];
const JR_EMAILS      = ['jr@drhsecurityservices.com'];
const SHANA_EMAILS   = ['shanaparks@drhsecurityservices.com'];
const TREVOR_EMAILS  = ['trevor@drhsecurityservices.com'];

// All calendars — order determines display order in filter chips
export const SYNC_CALENDARS = [
  {
    id: CALENDARS.TENTATIVELY_SCHEDULED,
    name: 'Tentatively Scheduled',
    type: 'queue',
    // All techs + operators see the queue
    visibleTo: [...AUSTIN_EMAILS, ...JR_EMAILS, ...SHANA_EMAILS, ...TREVOR_EMAILS],
  },
  {
    id: CALENDARS.AUSTIN,
    name: 'Austin',
    type: 'tech',
    visibleTo: AUSTIN_EMAILS,
  },
  {
    id: CALENDARS.JR,
    name: 'JR',
    type: 'tech',
    visibleTo: JR_EMAILS,
  },
  {
    id: CALENDARS.SHANA,
    name: 'Shana',
    type: 'tech',
    visibleTo: SHANA_EMAILS,
  },
  {
    id: CALENDARS.INSTALLATIONS,
    name: 'Installations',
    type: 'installations',
    visibleTo: TREVOR_EMAILS,
  },
  {
    id: CALENDARS.SALES_ACCOUNTING,
    name: 'Sales & Accounting',
    type: 'sales',
    visibleTo: null, // operators only
  },
  {
    id: CALENDARS.COMPLETED,
    name: 'Completed',
    type: 'completed',
    // Everyone sees completed
    visibleTo: [...AUSTIN_EMAILS, ...JR_EMAILS, ...SHANA_EMAILS, ...TREVOR_EMAILS],
  },
];

// ── Visibility helper ────────────────────────────────────────────────────────
// Returns the subset of SYNC_CALENDARS a given user is allowed to see.
export function getVisibleCalendars(email) {
  if (!email) return [];
  const e = email.toLowerCase();
  const isOperator = OPERATOR_EMAILS.includes(e);
  if (isOperator) return SYNC_CALENDARS; // operators see everything
  return SYNC_CALENDARS.filter(cal =>
    cal.visibleTo && cal.visibleTo.map(x => x.toLowerCase()).includes(e)
  );
}

// ── Write-target map ─────────────────────────────────────────────────────────
// Maps logged-in user email → their personal calendar (for creating events)
export const TECH_CALENDAR_MAP = {
  'drhservicetech1@gmail.com':          CALENDARS.AUSTIN,
  'austin@drhsecurityservices.com':     CALENDARS.AUSTIN,
  'jr@drhsecurityservices.com':         CALENDARS.JR,
  'info@drhsecurityservices.com':       CALENDARS.SALES_ACCOUNTING,
  'sara@jnbllc.com':                    CALENDARS.SALES_ACCOUNTING,
  'admin@jnbservice.com':               CALENDARS.SALES_ACCOUNTING,
  'shanaparks@drhsecurityservices.com': CALENDARS.SHANA,
  'trevor@drhsecurityservices.com':     CALENDARS.INSTALLATIONS,
};

export function getTechCalendarId(techOrEmail) {
  if (typeof techOrEmail === 'string') {
    return TECH_CALENDAR_MAP[techOrEmail.toLowerCase()] || null;
  }
  if (techOrEmail?.email) {
    return TECH_CALENDAR_MAP[techOrEmail.email.toLowerCase()] || techOrEmail.calendar_id || null;
  }
  return null;
}

// ── Tech colors ──────────────────────────────────────────────────────────────
export const TECH_COLORS = {
  'Austin':               '#F4511E',
  'JR':                   '#0B8043',
  'Shana':                '#F6BF26',
  'Trevor':               '#8E24AA',
  'Sales & Accounting':   '#039BE5',
};
