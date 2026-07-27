// ============================================
// ownership — who owns a job. ONE answer.
// ============================================
// There were two rules for "assigned to Shana" and they disagreed:
//   BoardView    → assigned_to, falling back to tech_name  → 22 cards
//   Workspace    → assigned_to only                        → 0 cards
// Same person, same data, same afternoon. Her workspace looked broken.
//
// Import from here. Do not write a third one.
//
// WHY tech_name IS A FALLBACK AND NOT A MISTAKE
//   `assigned_to` (migration 030) is the real column, but it is new and most
//   rows predate it. `tech_name` has been carrying this meaning informally for
//   months — it holds 'Shana' on 22 open jobs and 'Sara' on 4, and neither of
//   them is a field tech. People used it as a general assignee because nothing
//   else existed. Ignoring it throws away every assignment made before today.
//
//   An explicit `assigned_to` always beats a stale `tech_name`, so reassigning
//   a job actually moves it.

// The roster is PEOPLE, not techs. Office staff own plenty of work and were
// unrepresentable while the only ownership field pointed at the techs table.
export const ASSIGNEES = [
  { email: 'shanaparks@drhsecurityservices.com', name: 'Shana' },
  { email: 'jr@drhsecurityservices.com',          name: 'JR' },
  { email: 'austin@drhsecurityservices.com',      name: 'Austin' },
  { email: 'brian@drhsecurityservices.com',       name: 'Brian' },
  { email: 'trevor@drhsecurityservices.com',      name: 'Trevor' },
  { email: 'admin@jnbservice.com',                name: 'Sara' },
  { email: 'subs@drhsecurityservices.com',        name: 'Subs' },
];

export const NAME_BY_EMAIL  = Object.fromEntries(ASSIGNEES.map(a => [a.email, a.name]));
export const EMAIL_BY_NAME  = Object.fromEntries(ASSIGNEES.map(a => [a.name.toLowerCase(), a.email]));

// Normalise free-text tech_name to roster spelling. The data holds 'shana' and
// 'Shana', 'jr', 'Jr' and 'JR' — without this the filter chips silently drop a
// third of someone's cards.
export function canonicalName(raw) {
  const t = (raw || '').trim();
  if (!t) return null;
  const hit = ASSIGNEES.find(a => a.name.toLowerCase() === t.toLowerCase());
  return hit ? hit.name : t;
}

// THE rule. Returns a display name or null.
export function assigneeOf(job) {
  if (!job) return null;
  if (job.assigned_to) return NAME_BY_EMAIL[job.assigned_to] || job.assigned_to;
  return canonicalName(job.tech_name);
}

// Does this job belong to this person? Accepts either an email or a name.
export function ownsJob(job, emailOrName) {
  if (!job || !emailOrName) return false;
  const name = NAME_BY_EMAIL[emailOrName] || canonicalName(emailOrName);
  return assigneeOf(job) === name;
}

// Statuses that mean "finished or abandoned" — never surface these as someone's
// open work, however they're assigned.
export const CLOSED_STATUSES = ['billed', 'archived', 'dead', 'lost'];
