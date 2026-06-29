// ============================================
// SMS Test — send any text to any number
// ============================================
// Proves the Twilio pipe works end-to-end before wiring SMS into jobs.
// Route: /sms-test
// ============================================
import { useState } from 'react';

export default function SmsTest({ onBack }) {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('Test from Overwatch 👍');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ ok: true, text: `✅ Sent to ${data.to} (status: ${data.status})` });
      } else {
        setResult({ ok: false, text: `❌ ${data.error || 'Failed'}${data.detail ? ': ' + data.detail : ''}` });
      }
    } catch (e) {
      setResult({ ok: false, text: '❌ ' + e.message });
    } finally {
      setSending(false);
    }
  };

  const field = {
    width: '100%', padding: 12, borderRadius: 8, border: '1px solid #334155',
    background: '#0f172a', color: '#fff', fontSize: 15, boxSizing: 'border-box', marginBottom: 14,
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', padding: 20, color: '#e2e8f0' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#94a3b8', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, marginBottom: 20 }}>← Home</button>

        <h2 style={{ fontSize: 20, marginBottom: 4 }}>📱 SMS Test</h2>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>
          Send a text to any number to confirm Twilio is wired up. On a trial account, the number must be verified in Twilio first.
        </p>

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 6 }}>To (phone number)</label>
        <input value={to} onChange={e => setTo(e.target.value)} placeholder="+1 970 555 1234" style={field} />

        <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 6 }}>Message</label>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
          style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />

        <button onClick={send} disabled={sending || !to || !message}
          style={{ width: '100%', padding: 14, borderRadius: 8, border: 'none', background: (to && message) ? '#22c55e' : '#334155', color: '#fff', fontWeight: 700, fontSize: 15, cursor: (to && message) ? 'pointer' : 'not-allowed' }}>
          {sending ? 'Sending…' : 'Send Test Text'}
        </button>

        {result && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, fontSize: 13,
            background: result.ok ? '#052e16' : '#2a0a0a',
            border: `1px solid ${result.ok ? '#22c55e' : '#ef4444'}`,
            color: result.ok ? '#4ade80' : '#fca5a5' }}>
            {result.text}
          </div>
        )}
      </div>
    </div>
  );
}
