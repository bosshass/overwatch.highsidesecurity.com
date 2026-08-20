// ============================================
// SmsComposer — the ONE text-message box in Overwatch
// ============================================
// TicketSheet grew a bespoke composer for texting the person who owns a task.
// Texting a CLIENT is the same mechanics under a different set of rules, and
// copying the box would have meant two places to fix a Twilio error message,
// two segment counters, and two chances for one of them to quietly send
// something it should not. So it lives here once.
//
// THE RULE THAT MATTERS: `internal`.
//   Staff messages carry a short link into Overwatch so the recipient can open
//   the card. A CLIENT must never receive one — it is an internal app, the link
//   exposes a job id, and it invites a customer to tap into something not meant
//   for them. Client drafts carry opt-out language instead, which is what A2P
//   registration expects of business messaging.
//
// Sends are logged as an archived note wherever a job or customer is known, so
// the message is part of the record rather than something that happened only on
// somebody's phone.

import { useState } from 'react';
import { supabase } from '../services/supabase.js';
import { sendSms, formatPhone, isSendable } from '../services/sms.js';

const C = {
  panel: '#0f1729', line: '#334155', muted: '#94a3b8',
  accent: '#9b6cff', accentDim: '#9b6cff66', ok: '#4ade80', warn: '#f59e0b',
};

// Segments are billed per 160 characters — but a message containing anything
// outside plain ASCII (an emoji, a curly quote, an en dash) is sent as Unicode
// and drops to 70 per segment. Showing 160 when the real answer is 70
// understates the bill by more than half, so the encoding is checked rather
// than assumed. Plain-ASCII is a slightly conservative stand-in for the full
// GSM-7 set; erring toward "this will cost more" is the right direction.
export function segmentsOf(text) {
  const s = String(text || '');
  const unicode = /[^\x00-\x7F]/.test(s);
  const per = unicode ? 70 : 160;
  return { count: Math.max(1, Math.ceil(s.length / per)), per, unicode };
}

export default function SmsComposer({
  to,                       // phone, any format
  name,                     // who it is going to, for the labels
  accessToken,
  draft = '',
  internal = false,         // true = staff. false = a client: no app links.
  logTo = null,             // { jobId, customerId, userEmail } — optional
  onSent = null,
  onCancel = null,
  templates = null,         // [{ label, text }] — optional quick fills
}) {
  const [body, setBody]       = useState(draft);
  const [sending, setSending] = useState(false);
  const [msg, setMsg]         = useState('');

  const phone = formatPhone(to);
  const seg   = segmentsOf(body);

  // A client draft containing an Overwatch link is a mistake, not a style
  // choice, so it is caught here rather than trusted to whoever wrote the
  // draft — including a person editing the box by hand.
  const leaksLink = !internal && /https?:\/\/[^\s]*(overwatch|\/j\/|\/board)/i.test(body);

  const send = async () => {
    if (!isSendable(phone)) { setMsg('⚠ That number does not look sendable.'); return; }
    setSending(true); setMsg('');
    const r = await sendSms({ to: phone, message: body, accessToken });
    setSending(false);
    if (!r.ok) {
      setMsg(`⚠ ${r.error || 'Could not send'}${r.detail ? ` — ${r.detail}` : ''}`);
      return;
    }
    setMsg(`Sent ✓ ${r.status || 'queued'}${r.from ? ` · from ${r.from}` : ''}`);
    if (logTo?.jobId || logTo?.customerId) {
      try {
        await supabase.from('notes').insert({
          // The NUMBER is in the body on purpose. A reply arrives knowing only
          // the phone it came from, and it has to find whoever sent the
          // outgoing message so it can be handed back to them. Without this
          // there is nothing to match on, and the reply lands unassigned —
          // which is exactly how the first replies became invisible.
          body: `📱 Texted ${name || phone} (${phone}): ${body.split('\n')[0]}`,
          job_id: logTo.jobId || null,
          customer_id: logTo.customerId || null,
          author_email: logTo.userEmail || null,
          lane: 'note',
          status: 'archived',
          // A text TO A CLIENT belongs on their record — it is a real touch and
          // the next person to open that customer needs to see it happened. An
          // internal nudge does not.
          on_customer_record: !internal,
          archived_at: new Date().toISOString(),
          archived_by: logTo.userEmail || null,
        });
      } catch (e) { console.warn('SMS log failed (non-fatal):', e?.message || e); }
    }
    onSent?.(r);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>
        To {name || 'them'} at {phone}
        {!isSendable(phone) && ' — that number does not look sendable'}
      </div>

      {templates?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 7 }}>
          {templates.map(t => (
            <button key={t.label} type="button" onClick={() => setBody(t.text)}
              style={{ background: 'transparent', border: `1px solid ${C.line}`,
                       borderRadius: 999, padding: '5px 11px', color: C.muted,
                       fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                       fontFamily: 'inherit' }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
        placeholder={internal ? 'What do they need to know?' : 'Write to the client…'}
        style={{ width: '100%', boxSizing: 'border-box', background: C.panel,
                 border: `1px solid ${leaksLink ? C.warn : C.accentDim}`, borderRadius: 8,
                 color: '#e2e8f0', padding: '9px 11px', fontSize: 13.5, lineHeight: 1.45,
                 fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />

      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
        {body.length} chars {'·'} {seg.count} segment{seg.count === 1 ? '' : 's'}
        {seg.unicode && ' · emoji or smart punctuation, so 70 chars per segment'}
      </div>

      {leaksLink && (
        <div style={{ fontSize: 11.5, color: C.warn, marginTop: 5 }}>
          {'⚠'} That looks like an Overwatch link. Clients should not get one {'—'} take it out.
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
        <button onClick={send}
          disabled={sending || !body.trim() || !isSendable(phone) || leaksLink}
          style={{ flex: 2, background: C.accent, border: 'none', borderRadius: 8,
                   padding: '9px 0', color: '#08121f', fontSize: 13, fontWeight: 800,
                   cursor: sending ? 'default' : 'pointer', fontFamily: 'inherit',
                   opacity: (sending || !body.trim() || leaksLink) ? 0.55 : 1 }}>
          {sending ? 'Sending…' : 'Send text'}
        </button>
        {onCancel && (
          <button onClick={onCancel}
            style={{ flex: 1, background: 'transparent', border: `1px solid ${C.line}`,
                     borderRadius: 8, padding: '9px 0', color: C.muted, fontSize: 13,
                     fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        )}
      </div>

      {msg && (
        <div style={{ fontSize: 12, marginTop: 7,
                      color: msg.startsWith('⚠') ? C.warn : C.ok }}>
          {msg}
        </div>
      )}
    </div>
  );
}
