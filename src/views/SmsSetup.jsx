// ============================================
// Overwatch — messaging setup screen
// ============================================
// /api/sms-status has always been able to do the check that matters: call
// Twilio with the stored credentials and prove they work. It needs a Google
// token to do it, and typing the URL into a browser tab does not send one — so
// its own advice, "sign in and open this from Overwatch", pointed at a screen
// that did not exist. This is that screen.
//
// It also sends a REAL TEXT, because every check above it is inference. The
// credentials can authenticate, the sender can exist, the webhook can be right,
// and the message can still fail at the carrier — a new toll-free number that
// has not finished verification returns error 30032 asynchronously, after
// Twilio has already accepted the message. Nothing short of sending finds that.

import { useState, useEffect, useCallback } from 'react';
import { sendSms, formatPhone, isSendable } from '../services/sms.js';

const C = {
  bg: '#0f172a', panel: '#17161f', panel2: '#1e1c2a', line: '#2e2b3c',
  text: '#e2e8f0', muted: '#94a3b8', accent: '#9b6cff',
  ok: '#4ade80', warn: '#f59e0b', bad: '#f87171',
};

const Dot = ({ on }) => (
  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 999,
                 background: on ? C.ok : C.bad, marginRight: 8, flexShrink: 0 }} />
);

export default function SmsSetup({ accessToken, userEmail, onBack }) {
  const [data, setData]       = useState(null);
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(true);

  const [testTo, setTestTo]   = useState('');
  const [testMsg, setTestMsg] = useState('Overwatch test — if you got this, texting works.');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/sms-status', {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        cache: 'no-store',
      });
      setData(await r.json());
    } catch (e) {
      setErr(e?.message || 'Could not reach the status endpoint.');
    }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setSending(true); setResult(null);
    const r = await sendSms({ to: testTo, message: testMsg, accessToken });
    setSending(false);
    setResult(r);
  };

  const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12,
                 padding: 14, marginBottom: 12 };
  const h = { fontSize: 11, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase',
              color: C.muted, marginBottom: 10 };

  const t = data?.twilio;
  const credOk = t?.credentials === 'ok';

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
                  fontFamily: 'Inter, system-ui, sans-serif', padding: '16px 14px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {onBack && (
          <button onClick={onBack}
            style={{ background: 'transparent', border: `1px solid ${C.line}`, borderRadius: 8,
                     color: C.muted, padding: '6px 11px', fontSize: 13, fontWeight: 700,
                     cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
        )}
        <div style={{ fontSize: 19, fontWeight: 900 }}>Texting setup</div>
        <button onClick={load} disabled={loading}
          style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.line}`,
                   borderRadius: 8, color: C.accent, padding: '6px 11px', fontSize: 13,
                   fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {loading ? '…' : 'Re-check'}
        </button>
      </div>

      {err && <div style={{ ...card, borderColor: C.bad, color: C.bad }}>{err}</div>}

      {data && (
        <>
          {/* ── The headline. One word. ─────────────────────────────── */}
          <div style={{ ...card,
                        borderColor: data.ready && credOk ? C.ok : C.warn,
                        background: data.ready && credOk ? '#12271c' : '#2c2116' }}>
            <div style={{ fontSize: 22, fontWeight: 900,
                          color: data.ready && credOk ? C.ok : C.warn }}>
              {data.ready && credOk ? 'Ready to send' : data.ready ? 'Configured — credentials unverified' : 'Not ready'}
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
              {data.signedInAs
                ? `Checked against Twilio as ${data.signedInAs}.`
                : 'Not signed in to Google here, so the credentials were not tested against Twilio.'}
            </div>
          </div>

          {/* ── Anything actually wrong, in words ───────────────────── */}
          {data.blocking?.length > 0 && (
            <div style={{ ...card, borderColor: C.warn }}>
              <div style={{ ...h, color: C.warn }}>Fix these</div>
              {data.blocking.map((b, i) => (
                <div key={i} style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 8,
                                      color: '#fcd9a6' }}>• {b}</div>
              ))}
            </div>
          )}

          {/* ── Twilio itself ───────────────────────────────────────── */}
          <div style={card}>
            <div style={h}>Twilio</div>
            {!t || t.credentials === 'not checked' ? (
              <div style={{ fontSize: 13, color: C.muted }}>
                Not tested. Reload this page while signed in.
              </div>
            ) : t.credentials === 'REJECTED' ? (
              <div style={{ fontSize: 13.5, color: C.bad }}>
                Twilio refused these credentials ({t.status}). {t.detail}
              </div>
            ) : t.credentials === 'ok' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 14, marginBottom: 6 }}>
                  <Dot on /> Credentials work — account <b style={{ marginLeft: 5 }}>{t.account || '—'}</b>
                  {t.accountStatus && t.accountStatus !== 'active' && (
                    <span style={{ color: C.warn, marginLeft: 6 }}>({t.accountStatus})</span>
                  )}
                </div>
                {t.sender && (
                  <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>
                    Sends via <b style={{ color: C.text }}>{t.sender.via}</b>
                    {t.sender.number ? ` · ${t.sender.number}` : ''}
                    {t.sender.numbers?.length ? ` · ${t.sender.numbers.join(', ')}` : ''}
                  </div>
                )}
                {/* The ambiguity the Twilio console will not resolve for you. */}
                {t.inbound && (
                  <div style={{ fontSize: 13, color: C.muted, borderTop: `1px solid ${C.line}`,
                                paddingTop: 8, marginTop: 8 }}>
                    Replies are handled by <b style={{ color: C.text }}>{t.inbound.decidedBy}</b>
                    {t.inbound.serviceName ? ` (service: ${t.inbound.serviceName})` : ''}
                    {t.inbound.serviceInboundUrl && (
                      <div style={{ marginTop: 4, wordBreak: 'break-all', fontSize: 12 }}>
                        Service URL: {t.inbound.serviceInboundUrl}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: C.muted }}>{t.detail}</div>
            )}
          </div>

          {/* ── Variables ───────────────────────────────────────────── */}
          <div style={card}>
            <div style={h}>Environment</div>
            {Object.entries(data.config || {}).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', fontSize: 12.5,
                                    padding: '3px 0', fontFamily: 'ui-monospace, monospace' }}>
                <Dot on={v} />
                <span style={{ color: v ? C.text : C.muted }}>{k}</span>
              </div>
            ))}
          </div>

          {/* ── The webhook string, copyable ────────────────────────── */}
          <div style={card}>
            <div style={h}>Twilio webhook</div>
            <div style={{ fontSize: 12.5, fontFamily: 'ui-monospace, monospace',
                          background: C.panel2, borderRadius: 8, padding: '9px 11px',
                          wordBreak: 'break-all', marginBottom: 8 }}>
              {data.webhook?.setThisInTwilio}
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText(data.webhook?.setThisInTwilio || '')}
              style={{ background: 'transparent', border: `1px solid ${C.accent}66`,
                       borderRadius: 8, color: C.accent, padding: '7px 13px', fontSize: 12.5,
                       fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
              Copy
            </button>
          </div>
        </>
      )}

      {/* ── THE ONLY CHECK THAT IS NOT INFERENCE ────────────────────── */}
      <div style={{ ...card, borderColor: `${C.accent}66` }}>
        <div style={{ ...h, color: C.accent }}>Send a real text</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 9, lineHeight: 1.5 }}>
          Everything above is inference. A new toll-free number can pass every
          check and still fail at the carrier — Twilio accepts the message, then
          fails it asynchronously with error 30032 if verification has not
          finished. Only sending finds that.
        </div>
        <input value={testTo} onChange={e => setTestTo(e.target.value)}
          placeholder="Your mobile number" inputMode="tel"
          style={{ width: '100%', boxSizing: 'border-box', background: C.panel2,
                   border: `1px solid ${C.line}`, borderRadius: 8, color: C.text,
                   padding: '10px 12px', fontSize: 14, marginBottom: 8,
                   fontFamily: 'inherit', outline: 'none' }} />
        <textarea value={testMsg} onChange={e => setTestMsg(e.target.value)} rows={3}
          style={{ width: '100%', boxSizing: 'border-box', background: C.panel2,
                   border: `1px solid ${C.line}`, borderRadius: 8, color: C.text,
                   padding: '10px 12px', fontSize: 14, resize: 'vertical',
                   fontFamily: 'inherit', outline: 'none' }} />
        <div style={{ fontSize: 11, color: C.muted, margin: '5px 0 9px' }}>
          {testTo ? `Will dial ${formatPhone(testTo)}` : 'Digits only is fine — +1 is added.'}
        </div>
        <button onClick={send} disabled={sending || !isSendable(testTo) || !testMsg.trim()}
          style={{ width: '100%', background: C.accent, border: 'none', borderRadius: 10,
                   padding: '12px 0', color: '#08121f', fontSize: 15, fontWeight: 900,
                   cursor: sending ? 'default' : 'pointer', fontFamily: 'inherit',
                   opacity: (sending || !isSendable(testTo)) ? 0.55 : 1 }}>
          {sending ? 'Sending…' : 'Send test text'}
        </button>

        {result && (
          <div style={{ marginTop: 11, fontSize: 13, lineHeight: 1.55,
                        color: result.ok ? C.ok : C.bad }}>
            {result.ok ? (
              <>
                Accepted by Twilio · status <b>{result.status}</b>
                {result.from ? <> · from <b>{result.from}</b></> : null}
                <div style={{ color: C.muted, marginTop: 5 }}>
                  Accepted is not delivered. If it does not arrive, look for error
                  30032 in the Twilio message log — that is toll-free verification
                  still propagating, not the app.
                </div>
              </>
            ) : (
              <>
                {result.error}
                {result.detail ? <div style={{ marginTop: 4 }}>{result.detail}</div> : null}
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: C.muted, textAlign: 'center' }}>
        Signed in as {userEmail || '—'}
      </div>
    </div>
  );
}
