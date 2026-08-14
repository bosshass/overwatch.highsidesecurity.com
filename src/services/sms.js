// ============================================================================
// sms.js — the ONLY place the app calls the SMS endpoint.
//
// api/send-sms.js has been sitting complete and unreachable: Twilio wired,
// Messaging Service or From number, CORS handled — and nothing in src/ ever
// called it. The endpoint was never the problem. The button was missing.
//
// One writer, one place to audit. A "text the customer" control anywhere in
// the app calls sendSms() from here; it does not fetch /api/send-sms directly.
// ============================================================================

const ENDPOINT = '/api/send-sms';

// Kept in sync with toE164() in api/send-sms.js. Duplicated on purpose: the UI
// wants to show the operator what will actually be dialed BEFORE they hit send,
// and the server should not be the only thing that validates its own input.
export function formatPhone(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('+')) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return s;
}

export function isSendable(raw) {
  return /^\+\d{10,15}$/.test(formatPhone(raw));
}

// Returns whatever the endpoint returns. Never throws on a Twilio refusal —
// a rejected message is data the operator needs to see, not a crash.
export async function sendSms({ to, message }) {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: formatPhone(to), message }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      return { ok: false, error: data?.error || `Endpoint returned ${r.status}`, detail: data?.detail };
    }
    return { ok: true, ...(data || {}) };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}
