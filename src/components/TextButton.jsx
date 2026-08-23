// ============================================
// TextButton — texting, wherever a phone number is
// ============================================
// The composer went in first, and it went in BURIED: inside a job card, under
// a task, beside a Phone row. Sara's verdict was exact — "no one is going to
// see what you have in there." A capability nobody can find is a capability
// nobody has.
//
// So this is the whole feature as ONE drop-in control. Put it next to any
// phone number in any screen and texting exists there:
//
//   <TextButton to={c.phone} name={c.name} accessToken={t}
//               logTo={{ customerId: c.id, userEmail }} />
//
// It renders a visible button, opens the composer in a sheet over the screen,
// and disappears entirely when there is no number — so it can be dropped in
// unconditionally without every caller writing the same guard.
//
// `internal` carries through to SmsComposer, which is where the rule that
// matters lives: staff messages may contain an Overwatch link, client messages
// may never.

import { useState } from 'react';
import { isSendable, formatPhone } from '../services/sms.js';
import SmsComposer from './SmsComposer.jsx';

// ── MORE THAN ONE NUMBER ──────────────────────────────────────────────────
// `customers.phone` is a free-text field and people put more than one number in
// it: "(661) 619-9088 Mobile:(661) 619-9088". Sending to the whole string fails,
// and picking the first one silently is how a text meant for a mobile goes to a
// disconnected landline.
//
// This pulls every 10-digit number out of a string. It reads a FORMAT, not a
// meaning — the digits are the number, there is nothing to infer. It is not the
// deleted description-scraper, which guessed which number in a paragraph of
// prose was the customer's and would hand a tech a gate code.
//
// NAMES ARE NOT INFERRED. Only site_contact_phone arrives with a name attached
// to it, because somebody typed that name next to that number on purpose.
// Numbers pulled out of a shared field are shown as digits and nothing else —
// labelling the second one "mobile" because the word appeared nearby is exactly
// the guess that is not allowed here.
function splitNumbers(raw) {
  const out = [];
  const seen = new Set();
  const matches = String(raw || '').match(/\+?\d[\d\s().-]{8,}\d/g) || [];
  for (const m of matches) {
    const digits = m.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (digits.length !== 10 || seen.has(digits)) continue;
    seen.add(digits);
    out.push(m.trim());
  }
  return out;
}

// Build the candidate list a Text button offers. Named entries first — those
// are the ones a person vouched for.
export function textTargets({ named = [], pools = [] } = {}) {
  const out = [];
  const seen = new Set();
  const push = (phone, name) => {
    if (!phone || !isSendable(phone)) return;
    const key = String(phone).replace(/\D/g, '').slice(-10);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ phone, name: name || null });
  };
  named.forEach(n => push(n?.phone, n?.name));
  pools.forEach(raw => splitNumbers(raw).forEach(p => push(p, null)));
  return out;
}

export default function TextButton({
  to,
  // Optional [{ phone, name }] — when it holds more than one, the button asks
  // WHICH number before it opens the composer. One entry behaves exactly as a
  // plain `to` always has.
  targets = null,
  name,
  accessToken,
  internal = false,
  draft = '',
  templates = null,
  logTo = null,
  label = null,        // override the button text
  size = 'md',         // 'sm' for dense rows, 'md' elsewhere
  style = {},
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(null);

  const list = (targets && targets.length ? targets : (to ? [{ phone: to, name: name || null }] : []))
    .filter(t => t.phone && isSendable(t.phone));

  // No number, no button. The alternative — a disabled control on every row
  // that lacks a phone — is visual noise on exactly the rows that can do
  // nothing about it.
  if (list.length === 0) return null;

  // One number is not a choice. Straight to the composer, as it has always been.
  const only    = list.length === 1 ? list[0] : null;
  const chosen  = only || pick;
  const sendTo  = chosen?.phone || null;
  const sendName = chosen?.name || (only ? name : null);

  const small = size === 'sm';

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setPick(null); setOpen(true); }}
        title={list.length > 1 ? 'Text — choose a number' : `Text ${sendName || formatPhone(sendTo)}`}
        style={{
          background: '#9b6cff', border: 'none', borderRadius: 999,
          color: '#08121f', fontWeight: 800, cursor: 'pointer',
          fontFamily: 'inherit', whiteSpace: 'nowrap',
          fontSize: small ? 11.5 : 13,
          padding: small ? '4px 10px' : '7px 14px',
          ...style,
        }}>
        {label || (small || list.length > 1 ? '📱 Text' : `📱 Text ${name || ''}`.trim())}
      </button>

      {/* A SHEET, NOT AN INLINE PANEL. Inline was how this ended up invisible
          in the first place — it only existed if you had already scrolled to
          the right row of the right card. A sheet puts the message in front of
          whoever pressed the button, from any screen, at any scroll position. */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 6000,
                   background: 'rgba(3,7,18,0.72)', backdropFilter: 'blur(2px)',
                   display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#111827', borderTop: '1px solid #9b6cff66',
                     borderRadius: '16px 16px 0 0', padding: '16px 15px 26px',
                     width: '100%', maxWidth: 560, maxHeight: '88vh',
                     overflowY: 'auto',
                     fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 900 }}>
                {chosen
                  ? `Text ${sendName || formatPhone(sendTo)}`
                  : 'Which number?'}
              </div>
              <button onClick={() => setOpen(false)}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none',
                         color: '#94a3b8', fontSize: 24, lineHeight: 1, cursor: 'pointer',
                         fontFamily: 'inherit', padding: '0 4px' }}>
                ×
              </button>
            </div>

            {/* THE NUMBER COMES FIRST. A name shows only where a person put one
                against that number — the on-site contact. Everything else is
                digits out of a shared field, and inventing a label for those is
                the guess this app does not make. */}
            {!chosen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {list.map(t => (
                  <button key={t.phone} onClick={() => setPick(t)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                             gap: 2, width: '100%', textAlign: 'left', cursor: 'pointer',
                             background: '#0b1220', border: '1px solid #334155', borderRadius: 12,
                             padding: '12px 14px', fontFamily: 'inherit', color: '#e2e8f0' }}>
                    <span style={{ fontSize: 16, fontWeight: 800 }}>{formatPhone(t.phone)}</span>
                    {t.name && (
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#9b6cff' }}>{t.name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {chosen && (
              <>
                {!only && (
                  <button onClick={() => setPick(null)}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8',
                             fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                             padding: 0, marginBottom: 8 }}>
                    ← a different number
                  </button>
                )}
                <SmsComposer
                  to={sendTo} name={sendName} internal={internal}
                  draft={draft} templates={templates}
                  accessToken={accessToken} logTo={logTo}
                  onSent={() => setTimeout(() => setOpen(false), 2400)}
                  onCancel={() => setOpen(false)}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// The four things anybody actually texts a customer, ready to drop into
// `templates`. Kept here rather than in each screen so the wording — and the
// reply instructions the whole flow depends on — stay identical everywhere.
//
// `when` takes a Date or an ISO datetime and renders day AND time, because
// "Tuesday" is not an appointment. jobs.scheduled_date is a DATE with no time
// in it; the real time lives on the Google Calendar event, so callers that
// have the event pass its start and callers that only have the job pass the
// date and get a day-only message.
export function clientTemplates({ when = null, scheduledDate = null } = {}) {
  const SIGN = 'DRH Security Services';
  const OPTOUT = 'Reply STOP to opt out.';

  let slot = '';        // "Tuesday, August 25 at 9:00 AM"
  let dayOnly = '';     // "Tuesday, August 25"
  const raw = when || (scheduledDate ? `${scheduledDate}T12:00:00` : null);
  if (raw) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (!isNaN(d)) {
      dayOnly = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      // Only claim a time when one was actually given. A date-only value was
      // parsed at noon to keep it on the right calendar day, and printing
      // "at 12:00 PM" would invent an appointment nobody made.
      slot = when ? `${dayOnly} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : dayOnly;
    }
  }

  // YES / NO, then STOP. A confirmation that only offers "reply STOP" gives the
  // customer no way to say the one thing you need to hear — that the time does
  // not work. NO does not reschedule anything automatically: it lands in the
  // shared inbox and a person calls them. Saying so is what stops somebody
  // texting NO and then waiting for a system that was never going to answer.
  const confirmBody = slot
    ? `${SIGN}: confirming your appointment ${slot}. Reply YES to confirm or NO if that time does not work and we will call you to reschedule. ${OPTOUT}`
    : `${SIGN}: we are scheduling your visit and will confirm a day and time shortly. ${OPTOUT}`;

  return [
    { label: 'On the way',
      text: `${SIGN}: our technician is on the way to you now. ${OPTOUT}` },
    { label: 'Confirm visit', text: confirmBody },
    { label: 'Running late',
      text: `${SIGN}: our technician is running behind and will be with you as soon as possible. Sorry for the wait. ${OPTOUT}` },
    { label: 'Blank', text: `${SIGN}: ` },
  ];
}
