// ============================================
// MessagesView — shared SMS inbox, own route (/messages)
// ============================================
// Inbound texts arrive as notes with body "📲 Text from {who} ({+1…}):\n{text}".
// Outbound sends are logged by SmsComposer as "📱 Texted {who} ({+1…}):\n{first line}".
// Both live in the notes table. This view shows the shared inbound inbox, and
// "View thread" fetches both directions for a given phone number so the operator
// can see what they already sent before replying.
//
// Notification signal: dispatches 'task-skips-changed' after markRead so the
// nav badge in App.jsx refreshes immediately.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { canonicalEmail, NAME_BY_EMAIL } from '../utils/ownership.js';
import TextButton from '../components/TextButton.jsx';

const C = {
  bg: '#07111f', panel: '#2b3038', line: '#1d2f48', line2: '#454c57',
  text: '#edf4ff', muted: '#8ea0b8',
  teal: '#14b8a6', markBlue: '#3b82f6',
  inBubble: '#1e232a',    // inbound message bubble
  outBubble: '#1e3a5f',   // outbound message bubble (blue-tinted, clearly different)
  green: '#22d16f', amber: '#ffb020',
};

// Regex patterns shared by load() and openThread()
const INBOUND_RE  = /^📲 Text from (.+?) \((\+?[0-9]+)\):\n?([\s\S]*)$/;
const OUTBOUND_RE = /^📱 Texted (.+?) \((\+?[0-9]+)\):\n?([\s\S]*)$/;

function parseInbound(body) {
  const m = String(body || '').match(INBOUND_RE);
  if (!m) return null;
  const text = m[3].trim();
  const bare = text.toLowerCase().replace(/[^a-z]/g, '');
  const answer = ['yes','y','yep','yeah','confirm','confirmed','ok','okay'].includes(bare) ? 'yes'
               : ['no','n','nope','cant','cannot','reschedule'].includes(bare) ? 'no'
               : null;
  return { who: m[1].trim(), phone: m[2], text, answer };
}

export default function MessagesView({ userEmail, accessToken }) {
  const [rows,   setRows]   = useState(null);
  const [thread, setThread] = useState(null);  // { phone, who, messages[] } | null
  const [busy,   setBusy]   = useState(null);
  const me = canonicalEmail(userEmail);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('notes')
      .select('id, body, assigned_to, customer_id, job_id, created_at, read_at, read_by')
      .like('body', '📲 Text from%')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { console.warn('MessagesView load:', error.message); setRows([]); return; }
    setRows((data || []).map(n => ({ ...n, _msg: parseInbound(n.body) })).filter(n => n._msg));
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (n) => {
    setBusy(n.id);
    try {
      await supabase.from('notes')
        .update({ read_at: new Date().toISOString(), read_by: me })
        .eq('id', n.id);
      setRows(prev => prev.map(r =>
        r.id === n.id ? { ...r, read_at: new Date().toISOString(), read_by: me } : r));
      // Refresh the nav badge immediately.
      window.dispatchEvent(new Event('task-skips-changed'));
    } catch (e) { console.warn('markRead failed', e?.message); }
    setBusy(null);
  };

  // Pull every note (inbound or outbound) that mentions this phone number,
  // then classify each and show them in chronological order as a conversation.
  // jobId/customerId come from the inbound note that was clicked so the reply
  // button can associate the logged outbound note with the right record.
  const openThread = async (phone, who, jobId, customerId) => {
    setThread({ phone, who, messages: null, jobId: jobId || null, customerId: customerId || null });  // null = loading
    const { data } = await supabase
      .from('notes')
      .select('id, body, created_at, author_email, assigned_to')
      .like('body', `%${phone}%`)
      .order('created_at', { ascending: true })
      .limit(300);

    const messages = (data || []).flatMap(n => {
      const inb = INBOUND_RE.exec(n.body);
      if (inb) return [{ id: n.id, dir: 'in',  who: inb[1].trim(),  text: inb[3].trim(),  at: n.created_at }];
      const out = OUTBOUND_RE.exec(n.body);
      if (out) return [{ id: n.id, dir: 'out', who: out[1].trim(),  text: out[3].trim(),  at: n.created_at, author: n.author_email }];
      return [];
    });
    setThread(prev => ({ ...prev, messages }));
  };

  const fmtTime = iso => new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  // ── THREAD VIEW ─────────────────────────────────────────────────────────────
  if (thread) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 100,
                    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', color: C.text }}>
        {/* Thread header */}
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.line}`,
                      display: 'flex', alignItems: 'center', gap: 12,
                      position: 'sticky', top: 0, background: C.bg, zIndex: 5 }}>
          <button onClick={() => setThread(null)}
            style={{ background: 'none', border: 'none', color: C.muted,
                     fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}>←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{thread.who}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{thread.phone}</div>
          </div>
          <TextButton
            to={thread.phone} name={thread.who} accessToken={accessToken}
            label="↩ Reply"
            logTo={{ jobId: thread.jobId, customerId: thread.customerId, userEmail }}
          />
        </div>

        {/* Conversation bubbles */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {thread.messages === null && (
            <div style={{ color: C.muted, textAlign: 'center', padding: 32 }}>Loading…</div>
          )}
          {thread.messages?.length === 0 && (
            <div style={{ color: C.muted, textAlign: 'center', padding: 32 }}>No messages found.</div>
          )}
          {(thread.messages || []).map(msg => (
            <div key={msg.id}
              style={{ display: 'flex', flexDirection: 'column',
                       alignItems: msg.dir === 'out' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '80%',
                background: msg.dir === 'out' ? C.outBubble : C.inBubble,
                borderRadius: msg.dir === 'out' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                padding: '10px 14px', fontSize: 15, lineHeight: 1.5,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                border: `1px solid ${msg.dir === 'out' ? '#2d5a8e' : C.line2}`,
              }}>
                {msg.text || '(no text)'}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3, padding: '0 4px' }}>
                {msg.dir === 'out' ? `You · ${fmtTime(msg.at)}` : fmtTime(msg.at)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── INBOX LIST ───────────────────────────────────────────────────────────────
  const unread = (rows || []).filter(n => !n.read_at).length;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 100,
                  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', color: C.text }}>
      <div style={{ padding: '16px 18px 14px' }}>
        <div style={{ fontSize: 21, fontWeight: 900 }}>Messages</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
          {rows == null
            ? 'Loading…'
            : `${rows.length} message${rows.length === 1 ? '' : 's'}${unread ? ` · ${unread} unread` : ' · all read'}`}
        </div>
      </div>

      <div style={{ padding: '0 18px' }}>
        {rows != null && rows.length === 0 && (
          <div style={{ textAlign: 'center', color: C.muted, fontSize: 13.5, padding: '34px 0' }}>
            No messages yet.
          </div>
        )}

        {(rows || []).map(n => {
          const msg = n._msg;
          return (
            <div key={n.id}
              style={{ background: C.panel, borderRadius: '6px 16px 16px 6px',
                       padding: '15px 16px', marginBottom: 12,
                       border: `1px solid ${C.line2}`,
                       borderLeft: `${n.read_at ? 3 : 6}px solid ${n.read_at ? C.line2 : C.teal}`,
                       opacity: n.read_at ? 0.72 : 1 }}>

              {/* Teal banner — visually distinct from task cards at a glance */}
              <div style={{ background: C.teal, color: '#04211e',
                            margin: '-15px -16px 11px', padding: '7px 16px',
                            borderRadius: '0 12px 0 0',
                            fontSize: 11.5, fontWeight: 900, letterSpacing: '.09em' }}>
                💬 TEXT MESSAGE
              </div>

              {/* Sender + confirm/reschedule signal */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                            flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.2 }}>
                  {msg.who}
                </span>
                {msg.answer && (
                  <span style={{ fontSize: 11, fontWeight: 900, color: '#08121f',
                                 background: msg.answer === 'yes' ? C.green : C.amber,
                                 borderRadius: 5, padding: '3px 8px', letterSpacing: '.06em' }}>
                    {msg.answer === 'yes' ? '✅ CONFIRMED' : '⚠ NEEDS RESCHEDULE'}
                  </span>
                )}
              </div>
              {msg.answer === 'no' && (
                <div style={{ fontSize: 13, color: C.amber, fontWeight: 700, marginBottom: 7 }}>
                  They cannot make the time. Call them — nothing reschedules on its own.
                </div>
              )}

              {/* Phone · who answers */}
              <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 9 }}>
                {msg.phone}
                {n.assigned_to && (
                  <> · <b style={{ color: C.text }}>
                    {NAME_BY_EMAIL[canonicalEmail(n.assigned_to)] || n.assigned_to} answers
                  </b></>
                )}
              </div>

              {/* Their words */}
              <div style={{ background: C.inBubble, borderRadius: 10, padding: '12px 14px',
                            fontSize: 16.5, lineHeight: 1.5, marginBottom: 11, color: '#eef2f7',
                            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {msg.text || '(no text)'}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
                            marginBottom: 8 }}>
                <TextButton
                  to={msg.phone} name={msg.who} accessToken={accessToken}
                  label={`↩ Reply to ${msg.who}`}
                  logTo={{ jobId: n.job_id, customerId: n.customer_id, userEmail }}
                />
                {/* VIEW THREAD — shows the full back-and-forth with this contact,
                    including what we sent, so the operator sees the whole conversation
                    before deciding what to say next. */}
                <button onClick={() => openThread(msg.phone, msg.who, n.job_id, n.customer_id)}
                  style={{ background: 'transparent', border: `1px solid ${C.teal}77`,
                           borderRadius: 999, color: C.teal, fontSize: 12.5, fontWeight: 800,
                           padding: '7px 13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  View thread
                </button>
                {n.read_at ? (
                  <span style={{ fontSize: 11.5, color: C.muted }}>
                    ✓ read{n.read_by ? ` by ${NAME_BY_EMAIL[canonicalEmail(n.read_by)] || n.read_by}` : ''}
                  </span>
                ) : (
                  <button onClick={() => markRead(n)} disabled={busy === n.id}
                    style={{ background: C.markBlue, border: 'none', borderRadius: 999,
                             color: '#fff', fontSize: 12.5, fontWeight: 800,
                             padding: '7px 15px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {busy === n.id ? '…' : 'Mark read'}
                  </button>
                )}
              </div>

              <div style={{ fontSize: 11.5, color: C.muted }}>
                {fmtTime(n.created_at)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
