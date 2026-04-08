// ============================================
// JUC-E V6 — Billing (Calendar-First Redesign)
// ============================================
// Only Billing.jsx touched. Queue untouched.
// Pulls from 5 calendars, parses [TAG] prefixes,
// sorts into Triage / Return / Estimate / Bill It.
// Bill It: enter $ amount → archive to Completed.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { CALENDARS } from '../config/calendars.js';
import { supabase } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// ── Calendars ───────────────────────────────────────────────
const BILLING_SOURCES = [
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Service Queue', color: '#ef4444', daysBack: 90 },
  { id: CALENDARS.ADMIN_NOTES,           name: 'Admin Notes',   color: '#ec4899', daysBack: 7 },
  { id: CALENDARS.AUSTIN,                name: 'Austin',        color: '#f97316', daysBack: 90 },
  { id: CALENDARS.JR,                    name: 'JR',            color: '#22c55e', daysBack: 90 },
  { id: 'c_1d703bd2dcba573a392e52a5c1f5073e481db374f09c6cbd91bc423da6645e73@group.calendar.google.com',
                                           name: 'Shana',        color: '#a855f7', daysBack: 90 },
];

// ── Tag parsing ─────────────────────────────────────────────
const TAG_MAP = [
  { re: /^\[(COMPLETE|COMPLETED|TO BILL)\]/i,                                    bucket: 'bill_it' },
  { re: /^\[(NO CHARGE|NC|NO-CHARGE)\]/i,                                       bucket: 'bill_it', nc: true },
  { re: /^\[(RETURN NEEDED|RETURN|RETURN TRIP)\]/i,                              bucket: 'return' },
  { re: /^\[(ESTIMATE NEEDED|ESTIMATE|ESTIMATE SENT|NEEDS ESTIMATE|SALES)\]/i,  bucket: 'estimate' },
  { re: /^\[(BILLED|IGNORED?|INVOICE)\]/i,                                     bucket: 'skip' },
  { re: /^\[(SCHEDULED)\]/i,                                                     bucket: 'skip' },
  { re: /^\[(INSTALL|INSTALLATION)\]/i,                                          bucket: 'bill_it' },
  { re: /^\[(SERVICE|QUEUE|NEEDS PARTS)\]/i,                                     bucket: 'triage' },
];

function parseEvent(ev, cal) {
  const summary = ev.summary || '(no title)';
  const tagMatch = summary.match(/^\[([^\]]+)\]\s*/);
  const rawTag = tagMatch ? tagMatch[1].toUpperCase() : null;
  const name = tagMatch
    ? summary.slice(tagMatch[0].length).split(' - ')[0].trim() || '(no title)'
    : summary.split(' - ')[0].trim();
  const eventDate = new Date(ev.start?.dateTime || ev.start?.date);
  const daysAgo = Math.floor((Date.now() - eventDate) / 86400000);
  const isAdmin = cal.name === 'Admin Notes';

  let bucket = 'triage';
  let isNC = false;

  if (rawTag) {
    const match = TAG_MAP.find(t => t.re.test(tagMatch[0]));
    if (match) { bucket = match.bucket; isNC = !!match.nc; }
  } else {
    if (isAdmin && daysAgo > 7) bucket = 'bill_it';
    if ((cal.id === CALENDARS.AUSTIN || cal.id === CALENDARS.JR) && eventDate > new Date()) bucket = 'skip';
  }

  return {
    id: ev.id, calendarId: cal.id, calendarName: cal.name, calendarColor: cal.color,
    summary, customerName: name, rawTag, bucket, isNC,
    location: ev.location || '',
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    description: ev.description || '',
    daysAgo,
  };
}

// ── Supabase lookup ─────────────────────────────────────────
async function lookupCustomers(names) {
  if (!names.length) return {};
  try {
    const { data } = await supabase.from('jobs')
      .select('customer_name, customer_phone, customer_address, gate_code, panel_password, id, job_number, status, invoice_number')
      .order('created_at', { ascending: false }).limit(500);
    if (!data) return {};
    const map = {};
    for (const n of names) {
      const norm = n.toLowerCase().trim();
      const hit = data.find(j => j.customer_name?.toLowerCase().trim() === norm);
      if (hit) map[n] = hit;
    }
    return map;
  } catch { return {}; }
}

// ── Buckets ─────────────────────────────────────────────────
const BUCKETS = [
  { key: 'triage',   label: 'Triage',   emoji: '🔍', color: '#ef4444' },
  { key: 'return',   label: 'Return',   emoji: '🔄', color: '#f59e0b' },
  { key: 'estimate', label: 'Estimate', emoji: '💰', color: '#06b6d4' },
  { key: 'bill_it',  label: 'Bill It',  emoji: '✅', color: '#22c55e' },
];

// ── Component ───────────────────────────────────────────────
export default function Billing({ accessToken, onBack }) {
  const [allItems, setAllItems] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState('triage');
  const [expanded, setExpanded] = useState(null);
  const [calFilters, setCalFilters] = useState({});
  const [sortDir, setSortDir] = useState('newest');
  const [acting, setActing] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Bill It modal
  const [billItem, setBillItem] = useState(null);
  const [billAmount, setBillAmount] = useState('');
  const [billInvoice, setBillInvoice] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const results = [];

    await Promise.all(BILLING_SOURCES.map(async (cal) => {
      try {
        const tMin = new Date(); tMin.setDate(tMin.getDate() - cal.daysBack);
        const tMax = new Date(); tMax.setDate(tMax.getDate() + 14);
        const params = new URLSearchParams({
          timeMin: tMin.toISOString(), timeMax: tMax.toISOString(),
          singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
        });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return;
        const data = await res.json();
        (data.items || []).forEach(ev => {
          if (ev.status === 'cancelled' || !ev.start) return;
          const parsed = parseEvent(ev, cal);
          if (parsed.bucket !== 'skip') results.push(parsed);
        });
      } catch (e) { console.warn(`Billing cal error ${cal.name}:`, e.message); }
    }));

    setAllItems(results);
    const filters = {};
    BILLING_SOURCES.forEach(c => { filters[c.name] = true; });
    setCalFilters(prev => {
      const m = { ...filters };
      Object.keys(prev).forEach(k => { if (k in m) m[k] = prev[k]; });
      return m;
    });

    const names = [...new Set(results.map(r => r.customerName).filter(Boolean))];
    setCustomers(await lookupCustomers(names));
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    return allItems
      .filter(i => i.bucket === bucket && calFilters[i.calendarName] !== false)
      .sort((a, b) => sortDir === 'newest' ? new Date(b.start) - new Date(a.start) : new Date(a.start) - new Date(b.start));
  }, [allItems, bucket, calFilters, sortDir]);

  const counts = useMemo(() => {
    const c = {};
    BUCKETS.forEach(b => { c[b.key] = allItems.filter(i => i.bucket === b.key && calFilters[i.calendarName] !== false).length; });
    return c;
  }, [allItems, calFilters]);

  // ── Actions ─────────────────────────────────────────────
  const patchTag = async (item, newTag) => {
    setActing(item.id);
    const newTitle = newTag ? `[${newTag}] ${item.customerName}` : item.customerName;
    await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calendarId)}/events/${item.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: newTitle }),
    });
    await load();
    setActing(null); setExpanded(null);
  };

  const confirmBill = async () => {
    if (!billItem || !billInvoice) return;
    setActing(billItem.id);
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });
    const amtNote = billAmount ? ` — $${parseFloat(billAmount).toFixed(2)}` : '';
    const appendDesc = `\n\n💰 BILLED — Invoice #${billInvoice}${amtNote} — ${ts}`;

    // Title: [INVOICE ####] Customer Name [COMPLETED]
    await fetch(`${GCAL}/calendars/${encodeURIComponent(billItem.calendarId)}/events/${billItem.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: `[INVOICE ${billInvoice}] ${billItem.customerName} [COMPLETED]`,
        description: (billItem.description || '') + appendDesc,
      }),
    });

    // Move to completed
    try {
      await fetch(`${GCAL}/calendars/${encodeURIComponent(billItem.calendarId)}/events/${billItem.id}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {}

    setBillItem(null); setBillAmount(''); setBillInvoice('');
    await load();
    setActing(null); setExpanded(null);
  };

  const archive = async (item) => {
    setActing(item.id);
    try {
      await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calendarId)}/events/${item.id}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {}
    await load();
    setActing(null); setExpanded(null);
  };

  const saveNote = async (item) => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });
    const newDesc = (item.description ? item.description + '\n\n' : '') + `📝 ${ts}: ${noteText.trim()}`;
    await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calendarId)}/events/${item.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: newDesc }),
    });
    setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, description: newDesc } : i));
    setNoteText(''); setSavingNote(false);
  };

  // ── Helpers ─────────────────────────────────────────────
  const fmtDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    const diff = Math.floor((new Date().setHours(0,0,0,0) - new Date(date).setHours(0,0,0,0)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff === -1) return 'Tomorrow';
    if (diff > 1 && diff <= 7) return `${diff}d ago`;
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  // ── Render ──────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f1729', zIndex: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>← Home</button>
        <div>
          <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 16 }}>💰 Billing</div>
          <div style={{ color: '#475569', fontSize: 11 }}>{loading ? 'Loading...' : `${allItems.filter(i => i.bucket !== 'skip').length} items across ${BILLING_SOURCES.length} calendars`}</div>
        </div>
        <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#64748b', padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>↻</button>
      </div>

      {/* Bucket tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', overflowX: 'auto', borderBottom: '1px solid #1e293b', position: 'sticky', top: 52, background: '#0f1729', zIndex: 15 }}>
        {BUCKETS.map(b => (
          <button key={b.key} onClick={() => { setBucket(b.key); setExpanded(null); }}
            style={{
              padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
              fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              background: bucket === b.key ? b.color + '22' : '#1e293b',
              color: bucket === b.key ? b.color : '#64748b',
              border: `1px solid ${bucket === b.key ? b.color : '#334155'}`,
            }}>
            {b.emoji} {b.label} ({counts[b.key]})
          </button>
        ))}
      </div>

      {/* Calendar filters + sort */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {BILLING_SOURCES.map(cal => (
          <button key={cal.name}
            onClick={() => setCalFilters(p => ({ ...p, [cal.name]: !p[cal.name] }))}
            style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: calFilters[cal.name] !== false ? cal.color + '22' : 'transparent',
              color: calFilters[cal.name] !== false ? cal.color : '#475569',
              border: `1px solid ${calFilters[cal.name] !== false ? cal.color + '66' : '#334155'}`,
              opacity: calFilters[cal.name] !== false ? 1 : 0.4,
            }}>
            {cal.name}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setSortDir(s => s === 'newest' ? 'oldest' : 'newest')}
          style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#64748b', padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>
          {sortDir === 'newest' ? '↓ Newest' : '↑ Oldest'}
        </button>
      </div>

      {/* Items */}
      <div style={{ padding: '8px 16px 100px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading from calendars...</div>}

        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{bucket === 'triage' ? '🎯' : '🎉'}</div>
            <div style={{ color: '#22c55e', fontSize: 18, fontWeight: 700 }}>
              {bucket === 'triage' ? 'Nothing to triage' : `${BUCKETS.find(b => b.key === bucket)?.label} is empty`}
            </div>
            <div style={{ color: '#475569', fontSize: 13, marginTop: 4 }}>All caught up</div>
          </div>
        )}

        {items.map(item => {
          const isOpen = expanded === item.id;
          const cust = customers[item.customerName];
          const isInJuce = !!cust;
          const isActing = acting === item.id;
          const cleanDesc = item.description.replace(/\n\nScheduled.*|📱.*|Open in JUC-E.*/g, '').trim();
          const lastNote = cleanDesc.split('\n').filter(Boolean).pop();

          return (
            <div key={`${item.calendarId}_${item.id}`} style={{
              background: '#1a1a2e', borderRadius: 12,
              borderLeft: `3px solid ${item.calendarColor}`,
              overflow: 'hidden', opacity: isActing ? 0.5 : 1,
            }}>
              {/* Tap to expand */}
              <div onClick={() => { setExpanded(isOpen ? null : item.id); setNoteText(''); }}
                style={{ padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <span style={{ background: item.calendarColor + '25', color: item.calendarColor, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', marginTop: 2 }}>
                    {item.calendarName}
                  </span>
                  {item.rawTag && (
                    <span style={{ background: '#334155', color: '#94a3b8', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>[{item.rawTag}]</span>
                  )}
                  {!isInJuce && (
                    <span style={{ background: '#7f1d1d33', color: '#fca5a5', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>NOT IN JUC-E</span>
                  )}
                  {item.isNC && (
                    <span style={{ background: '#374151', color: '#9ca3af', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>NO CHARGE</span>
                  )}
                  <span style={{ marginLeft: 'auto', color: '#334155', fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{item.customerName}</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{fmtDate(item.start)} · {fmtTime(item.start)}</div>
                {item.location && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>📍 {item.location}</div>}
                {cust?.customer_phone && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>📞 {cust.customer_phone}</div>}
                {!isOpen && lastNote && (
                  <div style={{ color: '#475569', fontSize: 11, marginTop: 6, borderTop: '1px solid #1e293b', paddingTop: 6, fontStyle: 'italic' }}>
                    {lastNote.slice(0, 100)}
                  </div>
                )}
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ padding: '0 14px 14px' }}>

                  {/* Supabase match */}
                  {cust && (
                    <div style={{ background: '#0f1729', borderRadius: 8, padding: 10, marginBottom: 10, border: '1px solid #1e293b' }}>
                      <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, marginBottom: 6 }}>JUC-E — {cust.job_number || 'No job #'}</div>
                      {cust.customer_phone && <div onClick={() => window.location.href = `tel:${cust.customer_phone}`} style={{ fontSize: 12, color: '#3b82f6', cursor: 'pointer', marginBottom: 3 }}>📞 {cust.customer_phone}</div>}
                      {cust.customer_address && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>📍 {cust.customer_address}</div>}
                      {cust.gate_code && <div style={{ fontSize: 12, color: '#94a3b8' }}>🚪 Gate: <strong>{cust.gate_code}</strong></div>}
                      {cust.panel_password && <div style={{ fontSize: 12, color: '#94a3b8' }}>🔐 Panel: <strong>{cust.panel_password}</strong></div>}
                      {cust.invoice_number && <div style={{ fontSize: 12, color: '#22c55e', marginTop: 4 }}>Invoice: #{cust.invoice_number}</div>}
                    </div>
                  )}

                  {/* Notes */}
                  {cleanDesc && (
                    <div style={{ background: '#0f1729', borderRadius: 8, padding: 10, marginBottom: 10, border: '1px solid #1e293b', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: 150, overflowY: 'auto' }}>
                      {cleanDesc}
                    </div>
                  )}

                  {/* Add note */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note..."
                      style={{ flex: 1, background: '#0f1729', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', fontSize: 12 }} />
                    <button onClick={() => saveNote(item)} disabled={savingNote || !noteText.trim()}
                      style={{ background: '#334155', border: 'none', borderRadius: 8, color: savingNote ? '#475569' : '#e2e8f0', padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {savingNote ? '...' : '📝'}
                    </button>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {bucket === 'triage' && (<>
                      <Btn color="#22c55e" disabled={isActing} onClick={() => patchTag(item, 'COMPLETE')}>✅ Bill It</Btn>
                      <Btn color="#f59e0b" disabled={isActing} onClick={() => patchTag(item, 'RETURN NEEDED')}>🔄 Return</Btn>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE NEEDED')}>💰 Estimate</Btn>
                      <Btn color="#6b7280" disabled={isActing} onClick={() => archive(item)}>✓ Done</Btn>
                    </>)}

                    {bucket === 'bill_it' && (<>
                      <Btn color="#a78bfa" disabled={isActing} onClick={() => { setBillItem(item); setBillAmount(''); setBillInvoice(''); }}>💰 Enter Invoice & Bill</Btn>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE NEEDED')}>📝 Estimate Needed</Btn>
                      <Btn color="#6b7280" disabled={isActing} onClick={() => archive(item)}>✓ NC / Archive</Btn>
                    </>)}

                    {bucket === 'return' && (<>
                      <Btn color="#22c55e" disabled={isActing} onClick={() => patchTag(item, 'COMPLETE')}>✅ Bill It</Btn>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE NEEDED')}>📝 Estimate Needed</Btn>
                      <Btn color="#6b7280" disabled={isActing} onClick={() => archive(item)}>✓ Done</Btn>
                    </>)}

                    {bucket === 'estimate' && (<>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE SENT')}>📤 Sent</Btn>
                      <Btn color="#22c55e" disabled={isActing} onClick={() => patchTag(item, 'COMPLETE')}>🎉 Won</Btn>
                      <Btn color="#6b7280" disabled={isActing} onClick={() => archive(item)}>❌ Lost</Btn>
                    </>)}

                    {item.location && (
                      <Btn color="#1e293b" onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(item.location)}`, '_blank')}>🗺️</Btn>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bill modal — enter amount */}
      {billItem && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setBillItem(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a2e', borderRadius: 16, width: '100%', maxWidth: 400, overflow: 'hidden' }}>
            <div style={{ padding: '20px 20px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>💰</div>
              <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{billItem.customerName}</div>
              <div style={{ color: '#64748b', fontSize: 12 }}>{fmtDate(billItem.start)} · {billItem.calendarName}</div>
            </div>
            <div style={{ padding: 20 }}>
              <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 6 }}>Invoice Number *</label>
              <input
                type="text"
                value={billInvoice}
                onChange={e => setBillInvoice(e.target.value)}
                placeholder="e.g. 1234"
                autoFocus
                style={{
                  width: '100%', padding: '14px',
                  background: '#0f1729', border: '2px solid #a78bfa',
                  borderRadius: 10, color: '#e2e8f0', fontSize: 18, fontWeight: 700,
                  outline: 'none', marginBottom: 12,
                }}
              />
              <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 6 }}>Amount (optional)</label>
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 18, fontWeight: 700 }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={billAmount}
                  onChange={e => setBillAmount(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: '100%', padding: '14px 14px 14px 32px',
                    background: '#0f1729', border: '1px solid #334155',
                    borderRadius: 10, color: '#e2e8f0', fontSize: 18, fontWeight: 700,
                    outline: 'none',
                  }}
                />
              </div>
              <div style={{ background: '#0f1729', borderRadius: 8, padding: 10, marginBottom: 16, border: '1px solid #1e293b', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                {billInvoice
                  ? <span>[INVOICE {billInvoice}] {billItem.customerName} [COMPLETED]</span>
                  : <span style={{ color: '#475569' }}>Enter invoice number above</span>}
              </div>
              <button onClick={confirmBill} disabled={!billInvoice || acting === billItem?.id}
                style={{
                  width: '100%', padding: 16, borderRadius: 10, border: 'none',
                  background: billInvoice ? '#22c55e' : '#334155',
                  color: billInvoice ? '#fff' : '#475569',
                  fontSize: 16, fontWeight: 700, cursor: billInvoice ? 'pointer' : 'not-allowed',
                }}>
                {acting === billItem?.id ? 'Processing...' : 'Bill → Completed'}
              </button>
              <button onClick={() => setBillItem(null)}
                style={{ width: '100%', marginTop: 8, padding: 12, background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#0f1729ee', borderTop: '1px solid #1e293b',
        padding: '8px 16px', display: 'flex', justifyContent: 'center',
        gap: 24, zIndex: 20, backdropFilter: 'blur(8px)',
      }}>
        {BUCKETS.map(b => (
          <div key={b.key} onClick={() => { setBucket(b.key); setExpanded(null); }}
            style={{ textAlign: 'center', cursor: 'pointer', opacity: bucket === b.key ? 1 : 0.4, transition: 'opacity 0.15s' }}>
            <div style={{ fontSize: 18 }}>{b.emoji}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: counts[b.key] > 0 ? b.color : '#475569' }}>{counts[b.key]}</div>
            <div style={{ fontSize: 9, color: '#64748b', letterSpacing: 0.5 }}>{b.label.toUpperCase()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Btn({ color, disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '9px 12px', background: color + '22', border: `1px solid ${color}66`,
      borderRadius: 8, color, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
      flex: '1 1 auto', minWidth: 70, textAlign: 'center', opacity: disabled ? 0.4 : 1,
    }}>
      {children}
    </button>
  );
}
