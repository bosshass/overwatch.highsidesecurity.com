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
  { email: 'shanaparks@drhsecurityservices.com', name: 'Shana',  phone: '8087474948' },
  { email: 'jr@drhsecurityservices.com',          name: 'JR',    phone: '8088541757' },
  { email: 'austin@drhsecurityservices.com',      name: 'Austin', phone: null },
  { email: 'brian@drhsecurityservices.com',       name: 'Brian',  phone: null },
  { email: 'trevor@drhsecurityservices.com',      name: 'Trevor', phone: null },
  { email: 'admin@jnbservice.com',                name: 'Sara',   phone: '7207500063' },
  // ⚠ SAME NUMBER AS SARA, deliberately left in place rather than silently
  // changed. 7207500063 was on Subs and only on Subs; Sara asked for it to be
  // hers, and job records carry it as her on-site contact. Both rows keep it
  // until somebody says what Subs' real number is.
  //
  // The collision matters in exactly one place: an INBOUND text is matched by
  // number, so a duplicate would otherwise resolve to whichever row happened to
  // be found first. api/sms-inbound.js resolves it to Sara explicitly — see
  // STAFF_BY_PHONE there. Outbound is unaffected: that is keyed by email, and
  // the two rows have different emails.
  { email: 'subs@drhsecurityservices.com',        name: 'Subs',   phone: '7207500063' },
];
export const PHONE_BY_EMAIL = Object.fromEntries(
  ASSIGNEES.filter(a => a.phone).map(a => [a.email, a.phone])
);

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
  // Sara's DRH login resolves to the SAME person, not a new one. Aliasing
  // instead of adding a second ASSIGNEES row is what stops a second "Sara"
  // appearing in every picker and splitting her work across two identities —
  // exactly how Rick Ferreri ended up with three records.
  'sara@drhsecurityservices.com':       'admin@jnbservice.com',
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

  // ── READING FROM THE SHARED MAILBOX ──────────────────────────────────────
  // canonicalEmail depends on an identity PICKED IN localStorage ON THIS
  // DEVICE. If JR signs in at info@ and has never tapped his name on that
  // browser, canon is 'info@' and this returned ['info@'] alone — so a task
  // correctly filed under jr@ was invisible to him. Real row, right lane,
  // right status, and nothing on screen. Clearing his browser data did it too.
  //
  // WRITES must stay strict — filing something under the wrong colleague is
  // worse than filing it under the mailbox. But a READ can safely be generous:
  // the cost of showing JR a task addressed to the shared mailbox is nothing,
  // and the cost of hiding one addressed to him is a job nobody does.
  if (SHARED_LOGINS.includes(canon)) {
    const alsoMine = Object.entries(LOGIN_ALIASES)
      .filter(([alias]) => SHARED_LOGINS.includes(alias))
      .map(([, target]) => target);
    return [...new Set([canon, ...aliases, ...alsoMine, 'jr@drhsecurityservices.com'])];
  }

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
  // Once a job is SCHEDULED the tech standing at the door owns it.
  // assigned_to is a pre-scheduling idea and keeping it alive afterwards
  // meant a job could be assigned to one person and booked to another.
  if (job.status === 'scheduled' && job.tech_name) {
    return canonicalName(job.tech_name);
  }
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

// ── WHO GETS TO SAY A JOB WAS INVOICED ───────────────────────────────────────
// "They don't get to tell us how much they were invoicing — that's not for
// them to do."
//
// This is the billing side of the rule the finish sheet already obeys: a
// disposition is a DISPATCH signal, not a billing one. The tech says what
// happened; what it is worth and whether it went on an invoice is settled
// later, by the people who send invoices. The field having a $ field at all
// invites a number that then disagrees with QuickBooks, and once two numbers
// exist nobody can tell which is the invoice.
//
// IT WAS NOT GATED THAT WAY. JobDetail asked `isInfoUser`, meaning
// info@drhsecurityservices.com — written when that address was a shared office
// mailbox. IT IS JR'S LOGIN. So the one account the billing modal was opened
// for is a tech's, and every other operator marked jobs billed with NO amount
// at all by falling through to a plain status change.
//
// Named for the job, not the mailbox, so it cannot drift the same way again:
// accounting@ (who invoices) and Sara's logins. Deliberately NOT info@ (JR) and
// NOT shanaparks@ (scheduling). If Shana starts invoicing, add her here — one
// line, one place.
//
// THIS IS A UI CONVENTION, NOT A SECURITY BOUNDARY. Every table is RLS
// `USING (true)` and the anon key ships in the browser, so anyone who can sign
// in can still write these columns directly. It stops the accident and the
// wrong habit; it does not stop a determined person.
export const BILLING_EMAILS = [
  'accounting@drhsecurityservices.com',
  'admin@jnbservice.com',
  'sara@jnbllc.com',
  'sara@jnbservice.com',
];

export const canBill = (email) =>
  BILLING_EMAILS.includes(String(email || '').toLowerCase().trim());

// ── WHO GETS TO SEE BILLING FIELDS ───────────────────────────────────────────
// Invoice number, dollar amount, and tech attribution are visible to everyone
// who reviews or creates invoices — JR and the shared info@ mailbox included.
// "Seeing" is not the same as "stamping as billed": canBill is still the gate
// for the Mark Billed action; these fields are read/fill for review purposes.
//
// The distinction matters because info@ is JR's primary login. He needs to
// enter the invoice number and dollar amount; he is NOT the one who decides
// that the invoice went out.
export const BILLING_FIELD_EMAILS = [
  ...BILLING_EMAILS,
  'jr@drhsecurityservices.com',
  'info@drhsecurityservices.com',
];

export const canSeeBillingFields = (email) =>
  BILLING_FIELD_EMAILS.includes(String(email || '').toLowerCase().trim());
