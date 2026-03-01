// ============================================
// OVERWATCH V3 - Hardcoded Calendar Configuration
// ============================================
// These are the DRH / Highside Security Google Calendar IDs.
// HARDCODED. NEVER in a database table. NEVER.
// Source of truth since V2. Do not touch unless a calendar is added/removed.

export const CALENDARS = {
  SERVICE_QUEUE:    'de3d433f5c6c6a85f5474648e005cac43529d5bed542b74675a37a30cf0ece91@group.calendar.google.com',
  DRH_TECH_1:      'drhservicetech1@gmail.com',                    // Austin
  JR_APPOINTMENT:  'do0i4f1jqbbakd72mpgpll9m6g@group.calendar.google.com',
  SARA_TASKS:      'info@drhsecurityservices.com',
  SALES:           'c_aa764bfa5d492c689c26e3ed589df2804a04ee175db1b68d48217bd18883d178@group.calendar.google.com',
  COMPLETED:       'c_a095f8a75a8e3fb1bb4b0f3a2232962af3ab55f05a49ced1e4338abcc865d3e9@group.calendar.google.com',
  INSTALLATIONS:   'c_c84c0a24e2a7386cb519b21569fbb4b17a19214ce33744a63e06394f8c57339f@group.calendar.google.com',
  SHANA:           'shanaparks@drhsecurityservices.com',
};

// All calendars to scan (read operations)
// type controls how the app treats events from this calendar
export const SYNC_CALENDARS = [
  { id: CALENDARS.SERVICE_QUEUE,   name: 'Service Queue',      type: 'queue',         color: '#7986CB' },
  { id: CALENDARS.DRH_TECH_1,     name: 'Austin',             type: 'tech',          color: '#F4511E' },
  { id: CALENDARS.JR_APPOINTMENT,  name: 'JR',                type: 'tech',          color: '#0B8043' },
  { id: CALENDARS.SHANA,           name: 'Shana',             type: 'tech',          color: '#F6BF26' },
  { id: CALENDARS.INSTALLATIONS,   name: 'Installations',     type: 'installations', color: '#8E24AA' },
  { id: CALENDARS.SARA_TASKS,      name: 'Sara',              type: 'admin',         color: '#039BE5' },
  { id: CALENDARS.SALES,           name: 'Sales & Accounting', type: 'sales',        color: '#D50000' },
  { id: CALENDARS.COMPLETED,       name: 'Completed',          type: 'completed',    color: '#616161' },
];

// Which calendars hold active work (for operator board, tech views)
export const ACTIVE_CALENDARS = SYNC_CALENDARS.filter(c =>
  !['completed', 'sales'].includes(c.type)
);

// Tech calendars only (for scheduling destination picker)
export const TECH_CALENDARS = SYNC_CALENDARS.filter(c => c.type === 'tech');

// Map tech emails → their calendar IDs (for write operations)
export const TECH_CALENDAR_MAP = {
  'drhservicetech1@gmail.com':        CALENDARS.DRH_TECH_1,
  'austin@drhsecurityservices.com':   CALENDARS.DRH_TECH_1,
  'austin@highsidesecurity.com':      CALENDARS.DRH_TECH_1,
  'jr@drhsecurityservices.com':       CALENDARS.JR_APPOINTMENT,
  'jr@highsidesecurity.com':          CALENDARS.JR_APPOINTMENT,
  'info@drhsecurityservices.com':     CALENDARS.SARA_TASKS,
  'sara@jnbllc.com':                  CALENDARS.SARA_TASKS,
  'shanaparks@drhsecurityservices.com': CALENDARS.SHANA,
  'shana@highsidesecurity.com':       CALENDARS.SHANA,
};

export function getTechCalendarId(emailOrName) {
  if (typeof emailOrName === 'string') {
    // Try direct email lookup
    const byEmail = TECH_CALENDAR_MAP[emailOrName.toLowerCase()];
    if (byEmail) return byEmail;
    // Try by name
    const cal = TECH_CALENDARS.find(c => c.name.toLowerCase() === emailOrName.toLowerCase());
    return cal?.id || null;
  }
  return null;
}

export function getCalendarMeta(calendarId) {
  return SYNC_CALENDARS.find(c => c.id === calendarId) || null;
}

// Tech colors — matched to Google Calendar colors
export const TECH_COLORS = {
  'Austin':  '#F4511E',
  'JR':      '#0B8043',
  'Shana':   '#F6BF26',
  'Trevor':  '#8E24AA',
  'Sara':    '#039BE5',
};
