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

// ── ONE PERSON, SEVERAL LOGINS ───────────────────────────────────────────────
// JR signs in as info@ (the shared mailbox) but his ROSTER email is jr@.
// Sara has admin@jnbservice.com, sara@jnbservice.com and
// accounting@drhsecurityservices.com. Notes were written with whatever Google
// account was signed in, and My Tasks queried the ROSTER address — so JR wrote
// a note as info@, My Tasks looked for jr@, and the note was simply never
// found. Same reason a hand-off "didn't work": the job moved, the card didn't.
//
// Every alias resolves to one canonical person. Writes use the canonical
// address; reads accept ALL of them, so notes already stored under an alias
// surface instead of staying lost.
// info@ is deliberately NOT here. It is a SHARED mailbox with an identity
// picker (Sara / JR / Shana) — see IDENTITY_OPTIONS in App.jsx. Aliasing it to
// one person meant Sara, signed in on info@ and having picked "Sara", filed a
// note that landed in JR's list. A shared login resolves to whoever is ACTING,
// not to a fixed owner. See SHARED_LOGINS below.
export const LOGIN_ALIASES = {
  'accounting@drhsecurityservices.com': 'admin@jnbservice.com',
  'sara@jnbservice.com':                'admin@jnbservice.com',
  'sara@jnbllc.com':                    'admin@jnbservice.com',
  'drhservicetech1@gmail.com':          'austin@drhsecurityservices.com',
};

// Mailboxes more than one person signs into. Who they ARE is whichever identity
// they picked at sign-in, stored by App.jsx as juce_identity_<login>.
export const SHARED_LOGINS = ['info@drhsecurityservices.com'];

// Any login address -> the one roster address for the human ACTING right now.
export function canonicalEmail(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  if (SHARED_LOGINS.includes(e)) {
    try {
      const picked = localStorage.getItem(`juce_identity_${email}`);
      const hit = picked && EMAIL_BY_NAME[picked.toLowerCase()];
      if (hit) return hit;
    } catch { /* no storage — fall through */ }
    // Nobody picked yet. Return the shared address rather than guessing a
    // person: a note filed under "info@" is findable; one filed under the
    // wrong colleague is not.
    return e;
  }
  return LOGIN_ALIASES[e] || e;
}

// Every address this person might have authored something under. Use for READS.
export function emailsFor(email) {
  const canon = canonicalEmail(email);
  if (!canon) return [];
  const aliases = Object.entries(LOGIN_ALIASES)
    .filter(([, target]) => target === canon).map(([alias]) => alias);
  // Anyone who works the shared mailbox also sees what was filed under it —
  // including everything written before this fix, when info@ was aliased to JR.
  const shared = SHARED_LOGINS.filter(sl => sl !== canon);
  return [...new Set([canon, ...aliases, ...shared])];
}

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
//
// FIVE PLACES CLAIMED TO ANSWER THIS. In precedence order:
//   1. assigned_to      migration 030, the real column. An explicit choice.
//   2. tech_name        free text, months of informal use, most of the data.
//   3. _tech_name       hydrated from job_assignments (18 rows). OfficeHub read
//                       ONLY this, so it showed nearly every job unassigned and
//                       every tech lane empty — the table is essentially unused.
// Anything past 1 is legacy. Reassigning writes assigned_to, which outranks the
// rest, so a fresh assignment always moves the job.
export function assigneeOf(job) {
  if (!job) return null;
  if (job.assigned_to) {
    const canon = canonicalEmail(job.assigned_to);
    return NAME_BY_EMAIL[canon] || NAME_BY_EMAIL[job.assigned_to] || job.assigned_to;
  }
  return canonicalName(job.tech_name) || canonicalName(job._tech_name);
}

// Is anyone on the hook for this? The one test for "unassigned".
export const isAssigned = (job) => !!assigneeOf(job);

// KPIDashboard grew its own normName() because ownership.js didn't exist yet;
// it split 'JR'/'jr'/'Jr' into three people in every metric. Same rule, one
// name, so the numbers and the board agree about who did what.
export { canonicalName as normName };

// Does this job belong to this person? Accepts either an email or a name.
export function ownsJob(job, emailOrName) {
  if (!job || !emailOrName) return false;
  const name = NAME_BY_EMAIL[emailOrName] || canonicalName(emailOrName);
  return assigneeOf(job) === name;
}

// Statuses that mean "finished or abandoned" — never surface these as someone's
// open work, however they're assigned.
export const CLOSED_STATUSES = ['billed', 'archived', 'dead', 'lost'];
