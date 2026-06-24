// ============================================
// Overwatch — Billing (Unified Inbox)
// ============================================
// Everything flows here. Calendar events + Supabase time_entries.
// Billing team decides: Billed / Return / Estimate / Archive.
//
// Data sources:
//   Calendar scan → triage (untagged), return, estimate items
//   Supabase time_entries → enriched items with tech time data
//   Both sources merge. When a time_entry exists for a calendar event,
//   the item shows enriched data (tech, hours, notes, customer link).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { CALENDARS } from '../config/calendars.js';
import { supabase, timeEntriesApi, normalizeDisposition } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// ── Calendars to scan ────────────────────────────────────────
const BILLING_SOURCES = [
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Service Queue',  color: '#ef4444', daysBack: 90 },
  { id: CALENDARS.AUSTIN,                name: 'Austin',         color: '#f97316', daysBack: 90 },
  { id: CALENDARS.JR,                    name: 'JR',             color: '#22c55e', daysBack: 90 },
  { id: CALENDARS.INSTALLATIONS,         name: 'Installations',  color: '#3b82f6', daysBack: 90 },
];

// ── Tag parsing ──────────────────────────────────────────────
// Accept canonical tags ([BILL IT] / [RETURN] / [IN PROGRESS] / [ESTIMATE]) as well as
// legacy synonyms ([COMPLETED], [TO BILL], [RETURN NEEDED], etc.) so existing calendar
// events from before the tag-cleanup still parse correctly.
const TAG_MAP = [
  { re: /^\[(BILL IT|COMPLETE|COMPLETED|TO BILL)\]/i,                            bucket: 'bill_it' },
  { re: /^\[(NO CHARGE|NC|NO-CHARGE)\]/i,                                       bucket: 'bill_it', nc: true },
  { re: /^\[(RETURN NEEDED|RETURN|RETURN TRIP)\]/i,                              bucket: 'return' },
  { re: /^\[(ESTIMATE NEEDED|ESTIMATE|ESTIMATE SENT|NEEDS ESTIMATE|SALES)\]/i,  bucket: 'estimate' },
  { re: /^\[(BILLED|IGNORED?|INVOICE)\]/i,                                     bucket: 'skip' },
  { re: /^\[(SCHEDULED)\]/i,                                                     bucket: 'skip' },
  { re: /^\[(INSTALL|INSTALLATION)\]/i,                                          bucket: 'bill_it' },
  { re: /^\[(SERVICE|QUEUE|NEEDS PARTS)\]/i,                                     bucket: 'triage' },
  { re: /^\[(IN PROGRESS)\]/i,                                                   bucket: 'skip' },
];

function parseEvent(ev, cal) {
  const summary = ev.summary || '(no title)';
  const firstTagMatch = summary.match(/^\[([^\]]+)\]\s*/);
  const rawTag = firstTagMatch ? firstTagMatch[1].toUpperCase() : null;

  let cleanName = summary;
  while (cleanName.match(/^\[([^\]]+)\]\s*/)) {
    cleanName = cleanName.replace(/^\[([^\]]+)\]\s*/, '');
  }
  const name = cleanName.split(' - ')[0].trim() || '(no title)';

  const eventDate = new Date(ev.start?.dateTime || ev.start?.date);
  const daysAgo = Math.floor((Date.now() - eventDate) / 86400000);
  const isAdmin = cal.name === 'Admin Notes';

  let bucket = 'triage';
  let isNC = false;

  if (rawTag) {
    const match = TAG_MAP.find(t => t.re.test(firstTagMatch[0]));
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
    _supabase: false,
    _timeEntry: null,
    _allTimeEntries: null,
  };
}

// ── Supabase customer lookup (for calendar-only items) ───────
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

// ── Buckets ──────────────────────────────────────────────────
const BUCKETS = [
  { key: 'triage',   label: 'Triage',   emoji: '🔍', color: '#ef4444' },
  { key: 'return',   label: 'Return',   emoji: '🔄', color: '#f59e0b' },
  { key: 'estimate', label: 'Estimate', emoji: '💰', color: '#06b6d4' },
  { key: 'bill_it',  label: 'Bill It',  emoji: '✅', color: '#22c55e' },
];

// ── Project ref helpers ──────────────────────────────────────
// Accepts [P-NNN], [S-NNN], or [PROJ-NNN]. Returns canonical "PREFIX-NNN".
function extractCalProjectRef(title) {
  const mP = (title || '').match(/\[P-(\d+)\]/i);
  if (mP) return `P-${mP[1]}`;
  const mS = (title || '').match(/\[S-(\d+)\]/i);
  if (mS) return `S-${mS[1]}`;
  const mProj = (title || '').match(/\[PROJ-(\d+)\]/i);
  return mProj ? `PROJ-${mProj[1]}` : null;
}

// ── Format helpers ───────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const diff = Math.floor((new Date().setHours(0,0,0,0) - new Date(date).setHours(0,0,0,0)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  if (diff > 1 && diff <= 7) return `${diff}d ago`;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; }
function fmtMinutes(min) {
  if (!min) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function fmtClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Component ────────────────────────────────────────────────
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

  // Project tagging
  const [projectInput, setProjectInput] = useState('');
  const [projectOptions, setProjectOptions] = useState([]);
  const [savingProject, setSavingProject] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);

    // ── 1. Calendar scan ──────────────────────────────────────
    const calResults = [];
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
          if (parsed.bucket !== 'skip') calResults.push(parsed);
        });
      } catch (e) { console.warn(`Billing cal error ${cal.name}:`, e.message); }
    }));

    // ── 2. Supabase time_entries (all unbilled) ───────────────
    let timeEntries = [];
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*, customers(id, name, phone, address, drh_id)')
        .eq('billed', false)
        .order('created_at', { ascending: false });
      if (!error && data) timeEntries = data;
    } catch (e) { console.warn('Supabase time_entries error:', e.message); }

    // ── 3. Merge ──────────────────────────────────────────────
    // Group time_entries by calendar_event_id
    const teByEventId = {};
    for (const te of timeEntries) {
      if (te.calendar_event_id) {
        if (!teByEventId[te.calendar_event_id]) teByEventId[te.calendar_event_id] = [];
        teByEventId[te.calendar_event_id].push(te);
      }
    }

    // Enrich calendar items with matching time entries
    const enrichedCalItems = calResults.map(item => {
      const entries = teByEventId[item.id] || [];
      if (entries.length > 0) {
        const latest = entries[0];
        return {
          ...item,
          _supabase: true,
          _timeEntry: latest,
          _allTimeEntries: entries,
          // Supabase disposition overrides calendar tag bucket
          bucket: dispositionToBucket(latest.disposition),
        };
      }
      return item;
    });

    // Find orphan time_entries (event not in calendar scan window)
    const calEventIds = new Set(calResults.map(r => r.id));
    const orphanEntries = timeEntries.filter(te =>
      te.calendar_event_id && !calEventIds.has(te.calendar_event_id)
    );

    const orphanItems = orphanEntries.map(te => ({
      id: te.id,
      calendarId: te.calendar_id || '',
      calendarName: te.tech_name || 'Tech',
      calendarColor: techColor(te.tech_name),
      summary: te.event_title || te.customer_name_raw || '(unknown)',
      customerName: te.customers?.name || te.customer_name_raw || '(unknown)',
      rawTag: null,
      bucket: dispositionToBucket(te.disposition),
      isNC: false,
      location: te.customers?.address || '',
      start: te.event_start || te.created_at,
      end: null,
      description: te.notes || '',
      daysAgo: Math.floor((Date.now() - new Date(te.event_start || te.created_at)) / 86400000),
      _supabase: true,
      _timeEntry: te,
      _allTimeEntries: [te],
      _isOrphan: true,
    }));

    // Deduplicate
    const enrichedTeIds = new Set(
      enrichedCalItems.filter(i => i._timeEntry).map(i => i._timeEntry.id)
    );
    const dedupedOrphans = orphanItems.filter(o => !enrichedTeIds.has(o._timeEntry.id));

    setAllItems([...enrichedCalItems, ...dedupedOrphans]);

    // Calendar filter chips
    const filters = {};
    BILLING_SOURCES.forEach(c => { filters[c.name] = true; });
    filters['Time Entries'] = true;
    setCalFilters(prev => {
      const m = { ...filters };
      Object.keys(prev).forEach(k => { if (k in m) m[k] = prev[k]; });
      return m;
    });

    const calOnlyNames = enrichedCalItems.filter(i => !i._supabase).map(r => r.customerName).filter(Boolean);
    setCustomers(await lookupCustomers([...new Set(calOnlyNames)]));
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    return allItems
      .filter(i => {
        if (i.bucket !== bucket) return false;
        if (i._isOrphan) return calFilters['Time Entries'] !== false;
        if (i.calendarName && calFilters[i.calendarName] === false) return false;
        return true;
      })
      .sort((a, b) => sortDir === 'newest' ? new Date(b.start) - new Date(a.start) : new Date(a.start) - new Date(b.start));
  }, [allItems, bucket, calFilters, sortDir]);

  const counts = useMemo(() => {
    const c = {};
    BUCKETS.forEach(b => {
      c[b.key] = allItems.filter(i => {
        if (i.bucket !== b.key) return false;
        if (i._isOrphan) return calFilters['Time Entries'] !== false;
        if (i.calendarName && calFilters[i.calendarName] === false) return false;
        return true;
      }).length;
    });
    return c;
  }, [allItems, calFilters]);

  // ── Adoption gap ──────────────────────────────────────────────
  // Calendar-tagged work that a tech NEVER logged in the app (no time entry).
  // This is the number that explains why Billing and the time-entry screens
  // disagree — it's the work escaping Overwatch. Surface it, don't bury it.
  // Scope: June 1 fwd in full + May's still-actionable items. Pre-May = dust.
  // (The actionable-bucket filter already excludes anything completed/billed,
  //  so "May, not completed" is handled by the bucket check; the floor drops
  //  everything older than May 1 so the number stays chase-able, not historical.)
  const REPAIR_FLOOR = useMemo(() => new Date('2026-05-01T00:00:00'), []);
  const untrackedCount = useMemo(() =>
    allItems.filter(i =>
      i._supabase === false &&
      (i.bucket === 'bill_it' || i.bucket === 'return' || i.bucket === 'estimate') &&
      i.start && new Date(i.start) >= REPAIR_FLOOR
    ).length
  , [allItems, REPAIR_FLOOR]);

  // ── Actions ────────────────────────────────────────────────
  const patchTag = async (item, newTag) => {
    setActing(item.id);
    const calId = item.calendarId;
    const evId = item._timeEntry?.calendar_event_id || item.id;
    // Patch calendar title
    if (calId && evId && !item._isOrphan) {
      const newTitle = newTag ? `[${newTag}] ${item.customerName}` : item.customerName;
      try {
        await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${evId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: newTitle }),
        });
      } catch (e) { console.warn('Calendar patch failed:', e.message); }
    }
    // Update Supabase disposition
    if (item._timeEntry) {
      const newDisp = tagToDisposition(newTag);
      if (newDisp) {
        try { await timeEntriesApi.update(item._timeEntry.id, { disposition: newDisp }); }
        catch (e) { console.warn('Supabase update failed:', e.message); }
      }
    }
    await load();
    setActing(null); setExpanded(null);
  };

  const confirmBill = async () => {
    if (!billItem || !billInvoice) return;
    setActing(billItem.id);
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });
    const amtNote = billAmount ? ` — $${parseFloat(billAmount).toFixed(2)}` : '';
    const ref = billInvoice.trim();

    // Mark ALL time entries for this event as billed
    if (billItem._allTimeEntries?.length) {
      for (const te of billItem._allTimeEntries) {
        try { await timeEntriesApi.markBilled(te.id, ref); } catch {}
      }
    } else if (billItem._timeEntry) {
      try { await timeEntriesApi.markBilled(billItem._timeEntry.id, ref); } catch {}
    }

    // Patch + move calendar event
    const calId = billItem.calendarId;
    const evId = billItem._timeEntry?.calendar_event_id || billItem.id;
    if (calId && evId) {
      try {
        await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${evId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: `[INVOICE ${ref}] ${billItem.customerName} [COMPLETED]`,
            description: (billItem.description || '') + `\n\n💰 BILLED — Invoice #${ref}${amtNote} — ${ts}`,
          }),
        });
      } catch {}
      try {
        await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${evId}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
          { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      } catch {}
    }

    setBillItem(null); setBillAmount(''); setBillInvoice('');
    await load();
    setActing(null); setExpanded(null);
  };

  const archive = async (item) => {
    setActing(item.id);
    if (item._timeEntry) {
      try { await timeEntriesApi.markBilled(item._timeEntry.id, 'NC-ARCHIVED'); } catch {}
    }
    const calId = item.calendarId;
    const evId = item._timeEntry?.calendar_event_id || item.id;
    if (calId && evId && !item._isOrphan) {
      try {
        await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${evId}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
          { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      } catch {}
    }
    await load();
    setActing(null); setExpanded(null);
  };

  const saveNote = async (item) => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });
    const append = `\n\n📝 ${ts}: ${noteText.trim()}`;
    const calId = item.calendarId;
    const evId = item._timeEntry?.calendar_event_id || item.id;
    if (calId && evId && !item._isOrphan) {
      const newDesc = (item.description || '') + append;
      try {
        await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${evId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDesc }),
        });
        setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, description: newDesc } : i));
      } catch {}
    }
    if (item._timeEntry) {
      const newNotes = (item._timeEntry.notes || '') + `\n${ts}: ${noteText.trim()}`;
      try { await timeEntriesApi.update(item._timeEntry.id, { notes: newNotes }); } catch {}
    }
    setNoteText(''); setSavingNote(false);
  };

  // ── Project tagging ────────────────────────────────────────
  // Load the list of project refs already in use (jobs + time entries)
  // so the input can suggest them via a datalist.
  useEffect(() => { (async () => {
    try {
      const [{ data: jobRows }, { data: teRows }] = await Promise.all([
        supabase.from('jobs').select('p_number').not('p_number', 'is', null),
        supabase.from('time_entries').select('project_ref').not('project_ref', 'is', null),
      ]);
      const set = new Set();
      for (const j of (jobRows || [])) if (j.p_number) set.add(j.p_number);
      for (const t of (teRows || [])) if (t.project_ref) set.add(t.project_ref);
      setProjectOptions([...set].sort());
    } catch { /* options are a convenience; ignore failures */ }
  })(); }, []);

  // Normalize "7" → "P-007", "p-7" → "P-007", "PROJ-6" → "PROJ-006"; pass others through trimmed/upper.
  const normalizeRef = (raw) => {
    const v = (raw || '').trim().toUpperCase();
    if (!v) return '';
    if (/^\d+$/.test(v)) return `P-${v.padStart(3, '0')}`;
    const m = v.match(/^(P|S|PROJ)-?(\d+)$/);
    if (m) return `${m[1]}-${m[2].padStart(3, '0')}`;
    return v;
  };

  const tagProject = async (item, rawRef) => {
    const ref = normalizeRef(rawRef);
    if (!ref) return;
    setSavingProject(true);
    // Write project_ref onto the stored time entry/entries
    const ids = item._allTimeEntries?.length
      ? item._allTimeEntries.map(te => te.id)
      : (item._timeEntry ? [item._timeEntry.id] : []);
    for (const id of ids) {
      try { await timeEntriesApi.update(id, { project_ref: ref }); } catch (e) { console.warn('project_ref write failed:', e.message); }
    }
    // Also stamp the calendar title so scheduled events associate and future entries inherit the tag
    const calId = item.calendarId;
    const evId = item._timeEntry?.calendar_event_id || item.id;
    if (calId && evId && !item._isOrphan) {
      const stripped = (item.summary || '').replace(/\[(P|S|PROJ)-\d+\]\s*/gi, '').trim();
      const newTitle = `[${ref}] ${stripped}`;
      try {
        await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${evId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: newTitle }),
        });
      } catch (e) { console.warn('Calendar tag patch failed:', e.message); }
    }
    setProjectInput('');
    setProjectOptions(prev => prev.includes(ref) ? prev : [...prev, ref].sort());
    await load();
    setSavingProject(false);
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', overflowX: 'hidden' }}>

      {/* Sticky header + tabs */}
      <div style={{ position: 'sticky', top: 0, background: '#0f1729', zIndex: 20 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
          <button onClick={onBack} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>← Home</button>
          <div>
            <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 16 }}>💰 Billing</div>
            <div style={{ color: '#475569', fontSize: 11 }}>{loading ? 'Loading...' : `${allItems.length} items · Calendar + Supabase`}</div>
            {!loading && untrackedCount > 0 && (
              <div style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700, marginTop: 2 }}>
                ⚠️ {untrackedCount} tagged on calendar, never logged in app
              </div>
            )}
          </div>
          <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#64748b', padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>↻</button>
        </div>

        {/* Bucket tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 16px', overflowX: 'auto', borderBottom: '1px solid #1e293b' }}>
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
      </div>{/* end sticky header+tabs wrapper */}

      {/* Filters + sort */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[...BILLING_SOURCES, { name: 'Time Entries', color: '#3b82f6' }].map(cal => (
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
        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading calendars + time entries...</div>}

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
          const te = item._timeEntry;
          const hasTimeData = !!te;
          const isActing = acting === item.id;
          const cleanDesc = item.description.replace(/\n\nScheduled.*|📱.*|Open in JUC-E.*|CUSTOMER_ID:\s*[A-Za-z0-9\-_]+/g, '').trim();
          const lastNote = cleanDesc.split('\n').filter(Boolean).pop();
          const custData = te?.customers || cust;

          return (
            <div key={`${item.calendarId}_${item.id}`} style={{
              background: '#1a1a2e', borderRadius: 12,
              borderLeft: `3px solid ${item.calendarColor}`,
              overflow: 'hidden', opacity: isActing ? 0.5 : 1,
            }}>
              {/* Card header — tap to expand */}
              <div onClick={() => { setExpanded(isOpen ? null : item.id); setNoteText(''); }}
                style={{ padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ background: item.calendarColor + '25', color: item.calendarColor, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                    {item.calendarName}
                  </span>
                  {item.rawTag && (
                    <span style={{ background: '#334155', color: '#94a3b8', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>[{item.rawTag}]</span>
                  )}
                  {hasTimeData && (
                    <span style={{ background: '#1e40af33', color: '#60a5fa', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                      ⏱ {fmtMinutes(te.total_minutes)} · {te.tech_name || 'Tech'}
                    </span>
                  )}
                  {!hasTimeData && (
                    <span style={{ background: '#7f1d1d33', color: '#fca5a5', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>NO TIME ENTRY</span>
                  )}
                  {item.isNC && (
                    <span style={{ background: '#374151', color: '#9ca3af', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>NO CHARGE</span>
                  )}
                  <span style={{ marginLeft: 'auto', color: '#334155', fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>{item.customerName}</span>
                  {(() => {
                    const ref = (hasTimeData && te.project_ref) || extractCalProjectRef(item.summary);
                    return ref ? (
                      <span style={{ background: '#1e3a5f', color: '#60a5fa', border: '1px solid #3b82f640', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                        🏷️ {ref}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div style={{ color: '#64748b', fontSize: 11 }}>
                  {fmtDate(item.start)} · {fmtTime(item.start)}
                  {hasTimeData && te.disposition && (
                    <span style={{ marginLeft: 8, color: dispositionColor(te.disposition), fontWeight: 600 }}>
                      {dispositionLabel(te.disposition)}
                    </span>
                  )}
                </div>
                {item.location && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>📍 {item.location}</div>}
                {(custData?.phone || custData?.customer_phone) && (
                  <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>📞 {custData.phone || custData.customer_phone}</div>
                )}
                {!isOpen && lastNote && (
                  <div style={{ color: '#475569', fontSize: 11, marginTop: 6, borderTop: '1px solid #1e293b', paddingTop: 6, fontStyle: 'italic' }}>
                    {lastNote.slice(0, 100)}
                  </div>
                )}
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div style={{ padding: '0 14px 14px' }}>

                  {/* Time entry block */}
                  {hasTimeData && (
                    <div style={{ background: '#0c1a3d', borderRadius: 8, padding: 10, marginBottom: 10, border: '1px solid #1e3a5f' }}>
                      <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Time Entry — {te.tech_name || te.tech_email || 'Tech'}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase' }}>In</div>
                          <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{fmtClock(te.time_in) || '—'}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase' }}>Out</div>
                          <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{fmtClock(te.time_out) || '—'}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase' }}>Total</div>
                          <div style={{ fontSize: 13, color: '#60a5fa', fontWeight: 700 }}>{fmtMinutes(te.total_minutes)}</div>
                        </div>
                      </div>
                      {te.materials && (
                        <div style={{ fontSize: 12, color: '#f59e0b', borderTop: '1px solid #1e3a5f', paddingTop: 6, whiteSpace: 'pre-wrap' }}>
                          🔧 {te.materials}
                        </div>
                      )}
                      {te.notes && (
                        <div style={{ fontSize: 12, color: '#94a3b8', borderTop: '1px solid #1e3a5f', paddingTop: 6, whiteSpace: 'pre-wrap' }}>
                          {te.notes}
                        </div>
                      )}
                      {te.entry_method && (
                        <div style={{ fontSize: 9, color: '#475569', marginTop: 4 }}>
                          Entry: {te.entry_method} · Disposition: {te.disposition} · {new Date(te.created_at).toLocaleDateString()}
                        </div>
                      )}
                      {item._allTimeEntries?.length > 1 && (
                        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #1e3a5f' }}>
                          <div style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700, marginBottom: 4 }}>
                            {item._allTimeEntries.length} TIME ENTRIES
                          </div>
                          {item._allTimeEntries.map((entry, idx) => (
                            <div key={entry.id} style={{ fontSize: 11, color: '#94a3b8', padding: '2px 0' }}>
                              {entry.tech_name || 'Tech'} · {fmtMinutes(entry.total_minutes)} · {entry.disposition}
                              {idx === 0 && <span style={{ color: '#475569' }}> (latest)</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Customer data (from Supabase customers join or legacy jobs lookup) */}
                  {custData && (
                    <div style={{ background: '#0f1729', borderRadius: 8, padding: 10, marginBottom: 10, border: '1px solid #1e293b' }}>
                      <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, marginBottom: 6 }}>
                        Customer {custData.drh_id ? `· ${custData.drh_id}` : ''} {custData.job_number ? `· Job #${custData.job_number}` : ''}
                      </div>
                      {(custData.phone || custData.customer_phone) && (
                        <div onClick={() => window.location.href = `tel:${custData.phone || custData.customer_phone}`}
                          style={{ fontSize: 12, color: '#3b82f6', cursor: 'pointer', marginBottom: 3 }}>
                          📞 {custData.phone || custData.customer_phone}
                        </div>
                      )}
                      {(custData.address || custData.customer_address) && (
                        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>📍 {custData.address || custData.customer_address}</div>
                      )}
                      {custData.gate_code && <div style={{ fontSize: 12, color: '#94a3b8' }}>🚪 Gate: <strong>{custData.gate_code}</strong></div>}
                      {custData.panel_password && <div style={{ fontSize: 12, color: '#94a3b8' }}>🔐 Panel: <strong>{custData.panel_password}</strong></div>}
                      {custData.invoice_number && <div style={{ fontSize: 12, color: '#22c55e', marginTop: 4 }}>Prior Invoice: #{custData.invoice_number}</div>}
                    </div>
                  )}

                  {/* Event description / notes */}
                  {cleanDesc && (
                    <div style={{ background: '#0f1729', borderRadius: 8, padding: 10, marginBottom: 10, border: '1px solid #1e293b', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: 150, overflowY: 'auto' }}>
                      {cleanDesc}
                    </div>
                  )}

                  {/* Tag to a project */}
                  {(() => {
                    const currentRef = (hasTimeData && te.project_ref) || extractCalProjectRef(item.summary) || '';
                    return (
                      <div style={{ background: '#0f1729', borderRadius: 8, padding: 10, marginBottom: 10, border: '1px solid #1e293b' }}>
                        <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          🏷️ Project {currentRef && <span style={{ color: '#94a3b8', fontWeight: 600 }}>· currently {currentRef}</span>}
                        </div>
                        {!hasTimeData && (
                          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>No time entry yet — this tags the calendar event so logged time will roll up.</div>
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            list="ow-project-refs"
                            value={isOpen ? projectInput : ''}
                            onChange={e => setProjectInput(e.target.value)}
                            placeholder={currentRef ? `Reassign (e.g. ${currentRef})` : 'P-007, S-004, PROJ-006…'}
                            style={{ flex: 1, background: '#0f1729', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', fontSize: 12 }} />
                          <button
                            onClick={() => tagProject(item, projectInput)}
                            disabled={savingProject || !projectInput.trim()}
                            style={{ background: '#1d4ed8', border: 'none', borderRadius: 8, color: savingProject || !projectInput.trim() ? '#64748b' : '#fff', padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {savingProject ? '…' : 'Tag'}
                          </button>
                        </div>
                        <datalist id="ow-project-refs">
                          {projectOptions.map(ref => <option key={ref} value={ref} />)}
                        </datalist>
                      </div>
                    );
                  })()}

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
                      <Btn color="#22c55e" disabled={isActing} onClick={() => patchTag(item, 'COMPLETED')}>✅ Bill It</Btn>
                      <Btn color="#f59e0b" disabled={isActing} onClick={() => patchTag(item, 'RETURN NEEDED')}>🔄 Return</Btn>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE NEEDED')}>💰 Estimate</Btn>
                      <Btn color="#6b7280" disabled={isActing} onClick={() => archive(item)}>✓ Done</Btn>
                    </>)}

                    {bucket === 'bill_it' && (<>
                      <Btn color="#a78bfa" disabled={isActing} onClick={() => { setBillItem(item); setBillAmount(''); setBillInvoice(''); }}>💰 Enter Invoice & Bill</Btn>
                      <Btn color="#f59e0b" disabled={isActing} onClick={() => patchTag(item, 'RETURN NEEDED')}>🔄 Return</Btn>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE NEEDED')}>📝 Estimate</Btn>
                      <Btn color="#6b7280" disabled={isActing} onClick={() => archive(item)}>✓ NC / Archive</Btn>
                    </>)}

                    {bucket === 'return' && (<>
                      <Btn color="#22c55e" disabled={isActing} onClick={() => patchTag(item, 'COMPLETED')}>✅ Bill It</Btn>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE NEEDED')}>📝 Estimate</Btn>
                      <Btn color="#6b7280" disabled={isActing} onClick={() => archive(item)}>✓ Done</Btn>
                    </>)}

                    {bucket === 'estimate' && (<>
                      <Btn color="#06b6d4" disabled={isActing} onClick={() => patchTag(item, 'ESTIMATE SENT')}>📤 Sent</Btn>
                      <Btn color="#22c55e" disabled={isActing} onClick={() => patchTag(item, 'COMPLETED')}>🎉 Won</Btn>
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

      {/* Bill modal */}
      {billItem && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setBillItem(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a2e', borderRadius: 16, width: '100%', maxWidth: 400, overflow: 'hidden' }}>
            <div style={{ padding: '20px 20px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>💰</div>
              <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{billItem.customerName}</div>
              <div style={{ color: '#64748b', fontSize: 12 }}>{fmtDate(billItem.start)} · {billItem.calendarName}</div>
            </div>

            {/* Time entry summary in bill modal */}
            {billItem._timeEntry && (
              <div style={{ margin: '12px 20px 0', background: '#0c1a3d', borderRadius: 8, padding: 10, border: '1px solid #1e3a5f' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>
                  <span>Tech: <strong style={{ color: '#e2e8f0' }}>{billItem._timeEntry.tech_name || '—'}</strong></span>
                  <span>Time: <strong style={{ color: '#60a5fa' }}>{fmtMinutes(billItem._timeEntry.total_minutes)}</strong></span>
                </div>
                {billItem._timeEntry.time_in && (
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {fmtClock(billItem._timeEntry.time_in)} → {fmtClock(billItem._timeEntry.time_out)}
                  </div>
                )}
                {billItem._timeEntry.notes && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, borderTop: '1px solid #1e3a5f', paddingTop: 4 }}>
                    {billItem._timeEntry.notes}
                  </div>
                )}
              </div>
            )}

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
                  outline: 'none', marginBottom: 12, boxSizing: 'border-box',
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
                    outline: 'none', boxSizing: 'border-box',
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

// ── Helpers ──────────────────────────────────────────────────

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

function dispositionToBucket(disposition) {
  switch (disposition) {
    case 'bill_it':     return 'bill_it';
    case 'return':      return 'return';
    case 'estimate':    return 'estimate';
    case 'in_progress': return 'triage';
    default: {
      // Any legacy / stray disposition string collapses through the one shared map.
      const norm = normalizeDisposition(disposition);
      return (norm === 'in_progress' || norm === 'skip') ? 'triage' : norm;
    }
  }
}

function tagToDisposition(tag) {
  if (!tag) return null;
  const t = tag.toUpperCase();
  if (t.includes('COMPLETE') || t.includes('TO BILL'))     return 'bill_it';
  if (t.includes('RETURN'))                                 return 'return';
  if (t.includes('ESTIMATE'))                               return 'estimate';
  return null;
}

function dispositionLabel(d) {
  switch (d) {
    case 'bill_it':     return 'Bill It';
    case 'return':      return 'Return';
    case 'estimate':    return 'Estimate';
    case 'in_progress': return 'In Progress';
    default:            return d;
  }
}

function dispositionColor(d) {
  switch (d) {
    case 'bill_it':     return '#22c55e';
    case 'return':      return '#f59e0b';
    case 'estimate':    return '#06b6d4';
    case 'in_progress': return '#818cf8';
    default:            return '#64748b';
  }
}

function techColor(name) {
  if (!name) return '#64748b';
  const n = name.toLowerCase();
  if (n.includes('austin'))  return '#f97316';
  if (n.includes('jr'))      return '#22c55e';
  if (n.includes('brian'))   return '#3F51B5';
  if (n.includes('shana'))   return '#a855f7';
  if (n.includes('trevor'))  return '#8E24AA';
  return '#64748b';
}
