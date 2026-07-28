// ============================================
// JOVELIN — Calendar Configuration
// ============================================
// Per-tenant Google Calendar wiring. All IDs come from environment
// variables so no tenant's calendars are ever baked into the code.
// Leave unset to run with calendar features inert.

const envList = (v) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);

export const CALENDARS = {
  TENTATIVELY_SCHEDULED: import.meta.env.VITE_CAL_QUEUE || '',
  RETURN_VISITS:         import.meta.env.VITE_CAL_RETURNS || '',
  ADMIN_NOTES:           import.meta.env.VITE_CAL_ADMIN || '',
  AUSTIN:                import.meta.env.VITE_CAL_TECH1 || '',
  JR:                    import.meta.env.VITE_CAL_TECH2 || '',
  TECH3:                 import.meta.env.VITE_CAL_TECH3 || '',
  SALES_ACCOUNTING:      import.meta.env.VITE_CAL_SALES || '',
  COMPLETED:             import.meta.env.VITE_CAL_COMPLETED || '',
  INSTALLATIONS:         import.meta.env.VITE_CAL_INSTALLS || '',
  SHANA:                 import.meta.env.VITE_CAL_TECH4 || '',
  SUBS:                  import.meta.env.VITE_CAL_SUBS || '',
};

CALENDARS.DRH_TECH_1     = CALENDARS.AUSTIN;
CALENDARS.JR_APPOINTMENT = CALENDARS.JR;
CALENDARS.SARA_TASKS     = CALENDARS.ADMIN_NOTES;
CALENDARS.SERVICE_QUEUE  = CALENDARS.TENTATIVELY_SCHEDULED;

const OPERATOR_EMAILS = envList(import.meta.env.VITE_OPERATOR_EMAILS);

const AUSTIN_EMAILS  = envList(import.meta.env.VITE_TECH1_EMAILS);
const JR_EMAILS      = envList(import.meta.env.VITE_TECH2_EMAILS);
const BRIAN_EMAILS   = envList(import.meta.env.VITE_TECH3_EMAILS);
const SHANA_EMAILS   = envList(import.meta.env.VITE_TECH4_EMAILS);
const TREVOR_EMAILS  = envList(import.meta.env.VITE_TECH5_EMAILS);
const SUBS_EMAILS    = envList(import.meta.env.VITE_SUBS_EMAILS);

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
    name: 'Tech 1',
    type: 'tech',
    // Austin sees his own + Brian's + Subs per the work-view rule
    visibleTo: AUSTIN_EMAILS,
  },
  {
    id: CALENDARS.JR,
    name: 'Tech 2',
    type: 'tech',
    visibleTo: JR_EMAILS,
  },
  {
    id: CALENDARS.TECH3,
    name: 'Tech 3',
    type: 'tech',
    // Brian sees his own; Austin also sees Brian's per request
    visibleTo: [...BRIAN_EMAILS, ...AUSTIN_EMAILS],
  },
  {
    id: CALENDARS.SHANA,
    name: 'Tech 4',
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
//   - Operators (info@, Sara, admin)  → Austin + JR + Brian (Tech3) + Subs
//   - Austin (restricted)             → Austin + Brian (Tech3) + Subs
//   - Brian (restricted)              → Brian (Tech3) only
//   - JR (restricted)                 → JR only
//   - Trevor (restricted)             → Installations only
//   - Subs (restricted)               → Subs only
//   - Shana (operator role)           → Austin + JR + Brian + Subs (same as operators)
//   - Anyone else                     → empty (caller should fall back to default)
export function getWorkViewCalendars(email) {
  if (!email) return [];
  const e = email.toLowerCase();
  const ALL_TECHS = [
    { id: CALENDARS.AUSTIN, name: 'Tech 1' },
    { id: CALENDARS.JR,     name: 'Tech 2' },
    { id: CALENDARS.TECH3,  name: 'Tech 3' },
    { id: CALENDARS.SUBS,   name: 'Subs' },
  ];

  if (OPERATOR_EMAILS.includes(e)) return ALL_TECHS;
  if (SHANA_EMAILS.includes(e))    return ALL_TECHS;

  if (AUSTIN_EMAILS.includes(e)) {
    return [
      { id: CALENDARS.AUSTIN, name: 'Tech 1' },
      { id: CALENDARS.TECH3,  name: 'Tech 3' },
      { id: CALENDARS.SUBS,   name: 'Subs' },
    ];
  }
  if (JR_EMAILS.includes(e))     return [{ id: CALENDARS.JR, name: 'Tech 2' }];
  if (BRIAN_EMAILS.includes(e))  return [{ id: CALENDARS.TECH3, name: 'Tech 3' }];
  if (TREVOR_EMAILS.includes(e)) return [{ id: CALENDARS.INSTALLATIONS, name: 'Installations' }];
  if (SUBS_EMAILS.includes(e))   return [{ id: CALENDARS.SUBS, name: 'Subs' }];

  return [];
}

// ── Write-target map ─────────────────────────────────────────────────────────
// Maps logged-in user email → their personal calendar (for creating events)
// Per-tenant: techs.calendar_id in the DB is the write target. This map only
// carries operator overrides supplied via env (email:CAL_KEY pairs).
export const TECH_CALENDAR_MAP = Object.fromEntries(
  envList(import.meta.env.VITE_TECH_CALENDAR_MAP).map(pair => {
    const [email, key] = pair.split(':');
    return [String(email || '').toLowerCase(), CALENDARS[key] || ''];
  })
);

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
  'Tech 1':               '#F4511E',
  'Tech 2':               '#0B8043',
  'Tech 3':               '#3F51B5',
  'Tech 4':               '#F6BF26',
  'Installations':        '#8E24AA',
  'Subs':                 '#EC4899',
  'Sales & Accounting':   '#039BE5',
};
