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
  TECH3:                 'c_a1f0d82804a6c67b6373fa1311eef3933dc600a66617eef2b1e42dbb0670b625@group.calendar.google.com',
  SALES_ACCOUNTING:      'c_aa764bfa5d492c689c26e3ed589df2804a04ee175db1b68d48217bd18883d178@group.calendar.google.com',
  COMPLETED:             'c_a095f8a75a8e3fb1bb4b0f3a2232962af3ab55f05a49ced1e4338abcc865d3e9@group.calendar.google.com',
  INSTALLATIONS:         'c_c84c0a24e2a7386cb519b21569fbb4b17a19214ce33744a63e06394f8c57339f@group.calendar.google.com',
  SHANA:                 'shanaparks@drhsecurityservices.com',
  SUBS:                  'c_ef1cf02ebba19919b78be38a9c5d2603ef52a838ac4bb37253fd69d718cdcb5c@group.calendar.google.com',
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
const BRIAN_EMAILS   = ['brian@drhsecurityservices.com'];
const SHANA_EMAILS   = ['shanaparks@drhsecurityservices.com'];
const TREVOR_EMAILS  = ['trevor@drhsecurityservices.com'];
const SUBS_EMAILS    = ['subs@drhsecurityservices.com'];

// All calendars — order determines display order in filter chips
export const SYNC_CALENDARS = [
  {
    id: CALENDARS.TENTATIVELY_SCHEDULED,
    name: 'Tentatively Scheduled',
    type: 'queue',
    // All techs + operators see the queue
    visibleTo: [...AUSTIN_EMAILS, ...JR_EMAILS, ...BRIAN_EMAILS, ...SHANA_EMAILS, ...TREVOR_EMAILS, ...SUBS_EMAILS],
  },
  {
    id: CALENDARS.AUSTIN,
    name: 'Austin',
    type: 'tech',
    // Austin sees his own + Brian's + Subs per the work-view rule
    visibleTo: AUSTIN_EMAILS,
  },
  {
    id: CALENDARS.JR,
    name: 'JR',
    type: 'tech',
    visibleTo: JR_EMAILS,
  },
  {
    id: CALENDARS.TECH3,
    name: 'Brian',
    type: 'tech',
    // Brian sees his own; Austin also sees Brian's per request
    visibleTo: [...BRIAN_EMAILS, ...AUSTIN_EMAILS],
  },
  {
    id: CALENDARS.SHANA,
    name: 'Shana',
    type: 'tech',
    visibleTo: SHANA_EMAILS,
  },
  {
    id: CALENDARS.SUBS,
    name: 'Subs',
    type: 'tech',
    // Subs sees own; Austin also sees Subs
    visibleTo: [...SUBS_EMAILS, ...AUSTIN_EMAILS],
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
    visibleTo: [...AUSTIN_EMAILS, ...JR_EMAILS, ...BRIAN_EMAILS, ...SHANA_EMAILS, ...TREVOR_EMAILS, ...SUBS_EMAILS],
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

// ── Work-view calendar list ──────────────────────────────────────────────────
// Returns an ordered list of { id, name } pairs to fetch in TechWorkToday's
// "today's work" view for a given user. This is the SOURCE OF TRUTH for which
// tech calendars appear in the Work To Do view per user.
//
// Rules (per product spec):
//   - Operators (info@, Sara, admin)  → Austin + JR + Brian (Tech3)
//   - Austin (restricted)             → Austin + Brian (Tech3) + Subs
//   - Brian (restricted)              → Brian (Tech3) only
//   - JR (restricted)                 → JR only
//   - Trevor (restricted)             → Installations only
//   - Subs (restricted)               → Subs only
//   - Shana (operator role)           → Austin + JR + Brian (same as operators)
//   - Anyone else                     → empty (caller should fall back to default)
export function getWorkViewCalendars(email) {
  if (!email) return [];
  const e = email.toLowerCase();
  const ALL_TECHS = [
    { id: CALENDARS.AUSTIN, name: 'Austin' },
    { id: CALENDARS.JR,     name: 'JR' },
    { id: CALENDARS.TECH3,  name: 'Brian' },
  ];

  if (OPERATOR_EMAILS.includes(e)) return ALL_TECHS;
  if (SHANA_EMAILS.includes(e))    return ALL_TECHS;

  if (AUSTIN_EMAILS.includes(e)) {
    return [
      { id: CALENDARS.AUSTIN, name: 'Austin' },
      { id: CALENDARS.TECH3,  name: 'Brian' },
      { id: CALENDARS.SUBS,   name: 'Subs' },
    ];
  }
  if (JR_EMAILS.includes(e))     return [{ id: CALENDARS.JR, name: 'JR' }];
  if (BRIAN_EMAILS.includes(e))  return [{ id: CALENDARS.TECH3, name: 'Brian' }];
  if (TREVOR_EMAILS.includes(e)) return [{ id: CALENDARS.INSTALLATIONS, name: 'Installations' }];
  if (SUBS_EMAILS.includes(e))   return [{ id: CALENDARS.SUBS, name: 'Subs' }];

  return [];
}

// ── Write-target map ─────────────────────────────────────────────────────────
// Maps logged-in user email → their personal calendar (for creating events)
export const TECH_CALENDAR_MAP = {
  'drhservicetech1@gmail.com':          CALENDARS.AUSTIN,
  'austin@drhsecurityservices.com':     CALENDARS.AUSTIN,
  'jr@drhsecurityservices.com':         CALENDARS.JR,
  'brian@drhsecurityservices.com':      CALENDARS.TECH3,
  'info@drhsecurityservices.com':       CALENDARS.SALES_ACCOUNTING,
  'sara@jnbllc.com':                    CALENDARS.SALES_ACCOUNTING,
  'admin@jnbservice.com':               CALENDARS.SALES_ACCOUNTING,
  'shanaparks@drhsecurityservices.com': CALENDARS.SHANA,
  'trevor@drhsecurityservices.com':     CALENDARS.INSTALLATIONS,
  'subs@drhsecurityservices.com':       CALENDARS.SUBS,
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
  'Brian':                '#3F51B5',
  'Shana':                '#F6BF26',
  'Trevor':               '#8E24AA',
  'Subs':                 '#EC4899',
  'Sales & Accounting':   '#039BE5',
};
