// Overwatch V3 - Role Config
// operator = Sara (sees everything)
// owner = JR (owner dashboard + calendar)
// tech = Austin, Trevor (field calendar only)

export const USER_CONFIG = {
  'drhservicetech1@gmail.com':         { name: 'Austin',  role: 'tech',     defaultCalendar: 'Austin' },
  'austin@drhsecurityservices.com':     { name: 'Austin',  role: 'tech',     defaultCalendar: 'Austin' },
  'jr@drhsecurityservices.com':         { name: 'JR',      role: 'owner',    defaultCalendar: null },
  'info@drhsecurityservices.com':       { name: 'Sara',    role: 'operator', defaultCalendar: null },
  'sara@jnbllc.com':                    { name: 'Sara',    role: 'operator', defaultCalendar: null },
  'admin@jnbservice.com':               { name: 'Sara',    role: 'operator', defaultCalendar: null },
  'trevor@drhsecurityservices.com':     { name: 'Trevor',  role: 'tech',     defaultCalendar: 'Installations' },
};

export function getUserConfig(email) {
  return USER_CONFIG[email?.toLowerCase()] || { name: email?.split('@')[0] || 'User', role: 'tech', defaultCalendar: null };
}

export const TECH_COLORS = {
  'Austin':  '#F4511E',
  'JR':      '#0B8043',
  'Shana':   '#F6BF26',
  'Trevor':  '#8E24AA',
  'Sara':    '#039BE5',
  'Service Queue': '#7986CB',
  'Installations': '#8E24AA',
  'Completed': '#616161',
};
