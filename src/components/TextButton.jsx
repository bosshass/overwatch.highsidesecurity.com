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

export default function TextButton({
  to,
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

  // No number, no button. The alternative — a disabled control on every row
  // that lacks a phone — is visual noise on exactly the rows that can do
  // nothing about it.
  if (!to || !isSendable(to)) return null;

  const small = size === 'sm';

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={`Text ${name || formatPhone(to)}`}
        style={{
          background: '#9b6cff', border: 'none', borderRadius: 999,
          color: '#08121f', fontWeight: 800, cursor: 'pointer',
          fontFamily: 'inherit', whiteSpace: 'nowrap',
          fontSize: small ? 11.5 : 13,
          padding: small ? '4px 10px' : '7px 14px',
          ...style,
        }}>
        {label || (small ? '📱 Text' : `📱 Text ${name || ''}`.trim())}
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
                Text {name || formatPhone(to)}
              </div>
              <button onClick={() => setOpen(false)}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none',
                         color: '#94a3b8', fontSize: 24, lineHeight: 1, cursor: 'pointer',
                         fontFamily: 'inherit', padding: '0 4px' }}>
                ×
              </button>
            </div>
            <SmsComposer
              to={to} name={name} internal={internal}
              draft={draft} templates={templates}
              accessToken={accessToken} logTo={logTo}
              onSent={() => setTimeout(() => setOpen(false), 2400)}
              onCancel={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

// The four things anybody actually texts a customer, ready to drop into
// `templates`. Kept here rather than in each screen so the wording — and the
// opt-out line A2P registration expects — stays identical everywhere.
export function clientTemplates({ scheduledDate = null } = {}) {
  const SIGN = 'DRH Security Services';
  const OPTOUT = 'Reply STOP to opt out.';
  let when = '';
  if (scheduledDate) {
    const d = new Date(`${scheduledDate}T12:00:00`);
    if (!isNaN(d)) when = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  return [
    { label: 'On the way',
      text: `${SIGN}: our technician is on the way to you now. ${OPTOUT}` },
    { label: 'Confirm visit',
      text: when
        ? `${SIGN}: confirming your appointment on ${when}. Reply to let us know if that still works. ${OPTOUT}`
        : `${SIGN}: we are getting your visit scheduled and will confirm a time shortly. ${OPTOUT}` },
    { label: 'Running late',
      text: `${SIGN}: our technician is running behind and will be with you as soon as possible. Sorry for the wait. ${OPTOUT}` },
    { label: 'Blank', text: `${SIGN}: ` },
  ];
}
