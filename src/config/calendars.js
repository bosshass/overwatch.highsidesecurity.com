// ============================================
// JUC-E V3 - Hardcoded Calendar Configuration
// ============================================
// These are the DRH Security Google Calendar IDs.
// DO NOT pull these from Supabase. They live here.

export const CALENDARS = {
  SERVICE_QUEUE: 'de3d433f5c6c6a85f5474648e005cac43529d5bed542b74675a37a30cf0ece91@group.calendar.google.com',
  DRH_TECH_1: 'drhservicetech1@gmail.com',                    // Austin
  JR_APPOINTMENT: 'do0i4f1jqbbakd72mpgpll9m6g@group.calendar.google.com',
  SARA_TASKS: 'info@drhsecurityservices.com',
  SALES_ACCOUNTING: 'c_aa764bfa5d492c689c26e3ed589df2804a04ee175db1b68d48217bd18883d178@group.calendar.google.com',
  COMPLETED: 'c_a095f8a75a8e3fb1bb4b0f3a2232962af3ab55f05a49ced1e4338abcc865d3e9@group.calendar.google.com',
  INSTALLATIONS: 'c_c84c0a24e2a7386cb519b21569fbb4b17a19214ce33744a63e06394f8c57339f@group.calendar.google.com',
  SHANA: 'shanaparks@drhsecurityservices.com',
};

// All calendars to scan during sync (read operations)
export const SYNC_CALENDARS = [
  { id: CALENDARS.SERVICE_QUEUE,    name: 'Service Queue',     type: 'queue' },
  { id: CALENDARS.DRH_TECH_1,      name: 'Austin',            type: 'tech' },
  { id: CALENDARS.JR_APPOINTMENT,   name: 'JR',               type: 'tech' },
  { id: CALENDARS.SARA_TASKS,       name: 'Sara',             type: 'admin' },
  { id: CALENDARS.SALES_ACCOUNTING, name: 'Sales & Accounting', type: 'sales' },
  { id: CALENDARS.COMPLETED,        name: 'Completed',         type: 'completed' },
  { id: CALENDARS.INSTALLATIONS,    name: 'Installations',     type: 'installations' },
  { id: CALENDARS.SHANA,             name: 'Shana',             type: 'tech' },
];

// Map tech emails to their calendar IDs (for write operations - scheduling to a tech's calendar)
export const TECH_CALENDAR_MAP = {
  'drhservicetech1@gmail.com': CALENDARS.DRH_TECH_1,
  'austin@drhsecurityservices.com': CALENDARS.DRH_TECH_1,
  'jr@drhsecurityservices.com': CALENDARS.JR_APPOINTMENT,
  'info@drhsecurityservices.com': CALENDARS.SARA_TASKS,
  'sara@jnbllc.com': CALENDARS.SARA_TASKS,
  'shanaparks@drhsecurityservices.com': CALENDARS.SHANA,
};

// Get calendar ID for a tech (by email or by Supabase tech record)
export function getTechCalendarId(techOrEmail) {
  if (typeof techOrEmail === 'string') {
    return TECH_CALENDAR_MAP[techOrEmail.toLowerCase()] || null;
  }
  // If it's a tech object, try email first, then fall back to DB value
  if (techOrEmail?.email) {
    return TECH_CALENDAR_MAP[techOrEmail.email.toLowerCase()] || techOrEmail.calendar_id || null;
  }
  return null;
}

// ============================================
// Tech colors — matched to Google Calendar
// ============================================
// Source of truth. Import this everywhere, don't define locally.
export const TECH_COLORS = {
  'Austin':  '#F4511E',  // Google orange (DRH Tech 1)
  'JR':      '#0B8043',  // Google green (JR Appointments)
  'Shana':   '#F6BF26',  // Google gold/banana (Shana Parks)
  'Trevor':  '#8E24AA',  // Google purple (Tech 2 Trevor)
  'Sara':    '#039BE5',  // Google cyan (Sales and Accounting)
};
