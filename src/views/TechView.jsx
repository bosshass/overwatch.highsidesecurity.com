// ============================================
// OVERWATCH V3 — Tech View
// ============================================
// "Hey Austin 👊" + today's jobs + action buttons
// Start Job → Complete Job → 4 outcomes + notes
// Call, Navigate, History, New Job intake

import { useState, useEffect, useCallback } from 'react';
import { ACTIVE_CALENDARS, SYNC_CALENDARS, CALENDARS, getCalendarMeta, getTechCalendarId } from '../config/calendars.js';
import { fetchCalendarEvents, apiMove, rewriteEvent, createEvent } from '../services/calendarApi.js';
import { parseEvent, formatTitle, formatDescription, TAGS, getTagColor, SKIP_TAGS } from '../services/eventParser.js';
import { getUserConfig } from '../config/roles.js';

export default function TechView({ accessToken, userEmail, deepLinkEventId }) {
  const config = getUserConfig(userEmail);
  const techName = config.name;
  const isOperator = config.role === 'operator';
  const myCalendarId = getTechCalendarId(userEmail);

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('today');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showNewJob, setShowNewJob] = useState(false);

  // Visible calendars
  const visibleCalendars = ACTIVE_CALENDARS.filter(c => {
    if (c.type === 'admin') return false;
    if (isOperator) return true;
    return c.id === myCalendarId || c.type === 'queue' || c.type === 'installations';
  });

  // ---- LOAD ----
  const loadEvents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const daysBack = tab === 'history' ? 30 : 1;
      const daysForward = tab === 'today' ? 1 : tab === 'week' ? 7 : 30;
      const raw = await fetchCalendarEvents(accessToken, visibleCalendars, daysBack, daysForward);
      const parsed = raw.map(e => parseEvent(e)).filter(e => !SKIP_TAGS.includes(e.tag) && !e.allDay);
      setEvents(parsed);
      if (deepLinkEventId) {
        const target = parsed.find(e => e.id === deepLinkEventId);
        if (target) setSelectedEvent(target);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, tab, deepLinkEventId]);

  useEffect(() => { loadEvents(); }, [tab]);

  // ---- FILTER ----
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const filtered = (() => {
    if (tab === 'today') return events.filter(e => (e.start || '').slice(0, 10) === todayStr);
    if (tab === 'week') {
      const end = new Date(now); end.setDate(end.getDate() + 7);
      return events.filter(e => { const d = new Date(e.start); return d >= new Date(todayStr) && d <= end; });
    }
    return [...events].reverse();
  })();

  const myJobs = isOperator ? [] : filtered.filter(e => e.calendarId === myCalendarId);
  const otherJobs = isOperator ? filtered : filtered.filter(e => e.calendarId !== myCalendarId);

  // ---- GREETING ----
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={s.wrap}>
      {refreshing && <div style={s.refreshBar}>Refreshing...</div>}

      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.greet}>Hey {techName} 👊</div>
          <div style={s.dateLabel}>
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {tab === 'today' && ` · ${myJobs.length + otherJobs.length} job${(myJobs.length + otherJobs.length) !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div style={s.headerR}>
          <button onClick={() => setShowNewJob(true)} style={s.newJobBtn}>+ New</button>
          <button onClick={() => loadEvents(true)} style={s.refreshBtn}>↻</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {['today', 'week', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <div style={s.errBox}>{error}</div>}

      {loading && (
        <div style={s.center}>
          <div style={s.spinner} />
          <div style={s.loadText}>Loading calendar...</div>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={s.empty}>
          <div style={s.emptyIcon}>{tab === 'today' ? '☀️' : '📋'}</div>
          <div style={s.emptyTitle}>{tab === 'today' ? 'No jobs today' : tab === 'week' ? 'Clear week' : 'No history'}</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={s.list}>
          {!isOperator && myJobs.length > 0 && (
            <>
              <div style={s.sectionLabel}>MY JOBS ({myJobs.length})</div>
              {myJobs.map(e => <JobCard key={`${e.calendarId}-${e.id}`} event={e} onSelect={setSelectedEvent} showDate={tab !== 'today'} />)}
            </>
          )}
          {otherJobs.length > 0 && (
            <>
              <div style={{ ...s.sectionLabel, marginTop: myJobs.length > 0 ? 16 : 0 }}>
                {isOperator ? `ALL JOBS (${otherJobs.length})` : `SERVICE QUEUE (${otherJobs.length})`}
              </div>
              {otherJobs.map(e => <JobCard key={`${e.calendarId}-${e.id}`} event={e} onSelect={setSelectedEvent} showDate={tab !== 'today'} isQueue={!isOperator} />)}
            </>
          )}
        </div>
      )}

      {/* Detail Panel */}
      {selectedEvent && (
        <JobDetailPanel
          event={selectedEvent}
          accessToken={accessToken}
          techName={techName}
          onClose={() => setSelectedEvent(null)}
          onRefresh={() => { setSelectedEvent(null); loadEvents(true); }}
        />
      )}

      {/* New Job Modal */}
      {showNewJob && (
        <NewJobModal
          accessToken={accessToken}
          techName={techName}
          onClose={() => setShowNewJob(false)}
          onCreated={() => { setShowNewJob(false); loadEvents(true); }}
        />
      )}
    </div>
  );
}

// ============================================
// JOB CARD
// ============================================
function JobCard({ event, onSelect, showDate, isQueue }) {
  const time = event.start ? new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const date = event.start ? new Date(event.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const calMeta = getCalendarMeta(event.calendarId);

  return (
    <div onClick={() => onSelect(event)} style={s.card}>
      <div style={s.cardTop}>
        <div style={s.cardTime}>{showDate && <span style={{ color: '#5a7a9a' }}>{date} · </span>}{time}</div>
        <div style={s.cardTags}>
          {event.tag && <span style={{ ...s.badge, background: `${getTagColor(event.tag)}15`, color: getTagColor(event.tag), borderColor: `${getTagColor(event.tag)}33` }}>{event.tag}</span>}
          {!event.isTagged && <span style={{ ...s.badge, background: '#cc111115', color: '#cc1111', borderColor: '#cc111133' }}>ROGUE</span>}
          {isQueue && <span style={{ ...s.badge, background: '#7986CB15', color: '#7986CB', borderColor: '#7986CB33' }}>QUEUE</span>}
        </div>
      </div>
      {event.jobNumber && <div style={s.cardJobNum}>DRH-{event.jobNumber}</div>}
      <div style={s.cardCustomer}>{event.customerName || '(No title)'}</div>
      {event.address && <div style={s.cardAddr}>📍 {event.address}</div>}
      {event.issue && <div style={s.cardIssue}>{event.issue.slice(0, 60)}{event.issue.length > 60 ? '...' : ''}</div>}
      {event.missingFields.length > 0 && <div style={s.cardWarn}>⚠ Missing: {event.missingFields.join(', ')}</div>}
      <div style={s.cardCal}><span style={{ ...s.dot, background: calMeta?.color || '#5a7a9a' }} />{event.calendarName}</div>
    </div>
  );
}

// ============================================
// JOB DETAIL PANEL (bottom sheet)
// ============================================
function JobDetailPanel({ event, accessToken, techName, onClose, onRefresh }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [started, setStarted] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const time = event.start ? new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const endTime = event.end ? new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const dateStr = event.start ? new Date(event.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';

  // Start Job
  const handleStart = () => {
    setStarted(true);
    setStartTime(new Date());
  };

  // Complete Job — show outcome picker
  const handleShowComplete = () => setShowComplete(true);

  // Submit completion
  const handleComplete = async (outcome) => {
    setBusy(true);
    try {
      const tagMap = { done: TAGS.COMPLETE, return: TAGS.RETURN, parts: TAGS.RETURN, sales: TAGS.ESTIMATE };
      const newTag = tagMap[outcome] || TAGS.COMPLETE;
      const outcomeLabels = { done: 'Completed', return: 'Return needed', parts: 'Need parts — return', sales: 'Sales opportunity' };

      const updatedParsed = { ...event, tag: newTag };
      const allNotes = [...event.notes];
      if (startTime) allNotes.push(`${new Date().toLocaleDateString()} ${techName}: Started ${startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
      allNotes.push(`${new Date().toLocaleDateString()} ${techName}: ${outcomeLabels[outcome]}`);
      if (notes.trim()) allNotes.push(`${new Date().toLocaleDateString()} ${techName}: ${notes.trim()}`);
      updatedParsed.notes = allNotes;

      const newTitle = formatTitle(updatedParsed, newTag);
      const newDesc = formatDescription(updatedParsed);

      await rewriteEvent(accessToken, event.calendarId, event.id, { summary: newTitle, description: newDesc });

      if (outcome === 'done' || outcome === 'parts') {
        try { await apiMove(accessToken, event.calendarId, event.id, CALENDARS.COMPLETED); } catch (_) {}
      }

      onRefresh();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Customer history
  const loadHistory = async () => {
    if (!event.customerName || event.customerName === '(No title)') return;
    setHistoryLoading(true);
    try {
      const raw = await fetchCalendarEvents(accessToken, SYNC_CALENDARS, 730, 30);
      const matches = raw.map(e => parseEvent(e))
        .filter(e => {
          const n = e.customerName?.toLowerCase() || '';
          const q = event.customerName.toLowerCase();
          return n.includes(q) || q.includes(n);
        })
        .sort((a, b) => new Date(b.start) - new Date(a.start));
      setHistoryData(matches);
    } catch (_) { setHistoryData([]); }
    finally { setHistoryLoading(false); }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.panel} onClick={e => e.stopPropagation()}>
        <div style={s.handle} />
        <button onClick={onClose} style={s.closeBtn}>✕</button>

        {/* Tag + Job */}
        <div style={s.detailTagRow}>
          {event.tag && <span style={{ ...s.detailTag, background: `${getTagColor(event.tag)}18`, color: getTagColor(event.tag) }}>
            [{event.tag}{event.jobNumber ? ` #${event.jobNumber}` : ''}]
          </span>}
          {!event.isTagged && <span style={{ ...s.detailTag, background: '#cc111118', color: '#cc1111' }}>ROGUE</span>}
          <span style={s.detailCal}>{event.calendarName}</span>
        </div>

        <h2 style={s.detailName}>{event.customerName || '(No title)'}</h2>
        <div style={s.detailDate}>{dateStr} · {time}{endTime ? ` – ${endTime}` : ''}</div>

        {/* Quick Actions */}
        <div style={s.actions}>
          {event.phone && (
            <a href={`tel:${event.phone.replace(/\D/g, '')}`} style={s.actionBtn}>
              <span style={{ fontSize: 22 }}>📞</span>
              <span style={s.actionLabel}>Call</span>
              <span style={s.actionSub}>{event.phone}</span>
            </a>
          )}
          {event.address && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(event.address)}`} target="_blank" rel="noopener noreferrer" style={s.actionBtn}>
              <span style={{ fontSize: 22 }}>🗺️</span>
              <span style={s.actionLabel}>Navigate</span>
              <span style={s.actionSub}>{event.address.slice(0, 25)}{event.address.length > 25 ? '...' : ''}</span>
            </a>
          )}
        </div>

        {/* Fields */}
        <div style={s.fields}>
          {event.issue && <Field label="ISSUE" value={event.issue} />}
          <div style={{ display: 'flex', gap: 8 }}>
            {event.gateCode && <Field label="GATE CODE" value={event.gateCode} mono />}
            {event.panelPassword && <Field label="PANEL" value={event.panelPassword} mono />}
          </div>
        </div>

        {/* Existing Notes */}
        {event.notes.length > 0 && (
          <div style={s.notesBox}>
            <div style={s.fieldLabel}>NOTES</div>
            {event.notes.map((n, i) => <div key={i} style={s.noteItem}>{n}</div>)}
          </div>
        )}

        {/* Customer History */}
        <button onClick={() => { setShowHistory(!showHistory); if (!showHistory && !historyData) loadHistory(); }} style={s.historyBtn}>
          {showHistory ? '▼' : '▶'} Customer History {historyData && `(${historyData.length})`}
        </button>
        {showHistory && (
          <div style={s.historyBox}>
            {historyLoading && <div style={s.historyMsg}>Searching all calendars...</div>}
            {historyData?.length === 0 && <div style={s.historyMsg}>No previous visits</div>}
            {historyData?.map((h, i) => (
              <div key={i} style={s.historyItem}>
                <span style={s.historyDate}>{h.start?.slice(0, 10)}</span>
                <span style={{ color: getTagColor(h.tag), fontSize: 10 }}>{h.tag ? `[${h.tag}]` : ''}</span>
                <span style={{ color: '#5a7a9a', fontSize: 11 }}>{h.calendarName}</span>
              </div>
            ))}
          </div>
        )}

        {/* === JOB FLOW === */}
        {!showComplete ? (
          <div style={s.flowSection}>
            {/* Notes input */}
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes — what did you do? Parts used?" rows={3} style={s.textarea} />

            {/* Start / Complete buttons */}
            {!started ? (
              <button onClick={handleStart} style={s.startBtn} disabled={busy}>
                ▶ Start Job
              </button>
            ) : (
              <div>
                <div style={s.timerBadge}>
                  ⏱️ Started at {startTime?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
                <button onClick={handleShowComplete} style={s.completeBtn} disabled={busy}>
                  ✓ Complete Job
                </button>
              </div>
            )}
          </div>
        ) : (
          /* === COMPLETION MODAL === */
          <div style={s.completionBox}>
            <div style={s.completionTitle}>How'd it go?</div>
            <div style={s.completionGrid}>
              <button onClick={() => handleComplete('done')} disabled={busy} style={{ ...s.outcomeBtn, borderColor: '#4caf50', color: '#4caf50' }}>
                <span style={{ fontSize: 24 }}>✅</span>
                <span>All Done</span>
              </button>
              <button onClick={() => handleComplete('return')} disabled={busy} style={{ ...s.outcomeBtn, borderColor: '#ff8844', color: '#ff8844' }}>
                <span style={{ fontSize: 24 }}>🔄</span>
                <span>Return Needed</span>
              </button>
              <button onClick={() => handleComplete('parts')} disabled={busy} style={{ ...s.outcomeBtn, borderColor: '#4a90d9', color: '#4a90d9' }}>
                <span style={{ fontSize: 24 }}>📦</span>
                <span>Need Parts</span>
              </button>
              <button onClick={() => handleComplete('sales')} disabled={busy} style={{ ...s.outcomeBtn, borderColor: '#f6bf26', color: '#f6bf26' }}>
                <span style={{ fontSize: 24 }}>💰</span>
                <span>Sales Opp</span>
              </button>
            </div>
            <button onClick={() => setShowComplete(false)} style={s.backBtn}>← Back</button>
            {busy && <div style={s.busyText}>Updating calendar...</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// FIELD COMPONENT
// ============================================
function Field({ label, value, mono }) {
  return (
    <div style={s.field}>
      <div style={s.fieldLabel}>{label}</div>
      <div style={mono ? s.fieldValueMono : s.fieldValue}>{value}</div>
    </div>
  );
}

// ============================================
// NEW JOB MODAL
// ============================================
function NewJobModal({ accessToken, techName, onClose, onCreated }) {
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!customer.trim()) { alert('Customer name required'); return; }
    setBusy(true);
    try {
      const now = new Date();
      const endTime = new Date(now.getTime() + 2 * 3600000);
      const parsed = {
        customerName: customer.trim(),
        phone: phone.trim(),
        address: address.trim(),
        issue: issue.trim(),
        notes: [`${now.toLocaleDateString()} ${techName}: Created from field`],
        jobNumber: null, tag: TAGS.SERVICE, gateCode: '', panelPassword: '',
      };
      const title = formatTitle(parsed, TAGS.SERVICE);
      const desc = formatDescription(parsed);
      await createEvent(accessToken, CALENDARS.SERVICE_QUEUE, {
        title, description: desc, location: address.trim(),
        startTime: now.toISOString(), endTime: endTime.toISOString(),
      });
      onCreated();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.panel} onClick={e => e.stopPropagation()}>
        <div style={s.handle} />
        <button onClick={onClose} style={s.closeBtn}>✕</button>
        <h2 style={s.detailName}>New Job</h2>

        <div style={s.formGroup}>
          <label style={s.formLabel}>Customer Name *</label>
          <input value={customer} onChange={e => setCustomer(e.target.value)} style={s.formInput} placeholder="Smith, John" autoFocus />
        </div>
        <div style={s.formGroup}>
          <label style={s.formLabel}>Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} style={s.formInput} placeholder="303-555-1234" type="tel" />
        </div>
        <div style={s.formGroup}>
          <label style={s.formLabel}>Address</label>
          <input value={address} onChange={e => setAddress(e.target.value)} style={s.formInput} placeholder="123 Main St, Denver CO" />
        </div>
        <div style={s.formGroup}>
          <label style={s.formLabel}>Issue</label>
          <textarea value={issue} onChange={e => setIssue(e.target.value)} style={s.textarea} placeholder="Panel not responding, needs reset" rows={2} />
        </div>

        <button onClick={submit} disabled={busy} style={s.startBtn}>
          {busy ? 'Creating...' : '+ Create Job on Service Queue'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const s = {
  wrap: { maxWidth: 480, margin: '0 auto', padding: '0 0 100px' },
  refreshBar: { textAlign: 'center', padding: 6, fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#4a90d9', background: 'rgba(74,144,217,0.06)', letterSpacing: 1 },

  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 4px' },
  greet: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: 'white', letterSpacing: 0.5 },
  dateLabel: { fontSize: 13, color: '#5a7a9a', marginTop: 2 },
  headerR: { display: 'flex', gap: 8 },
  newJobBtn: { padding: '8px 14px', borderRadius: 8, border: '1px solid #4a90d9', background: 'rgba(74,144,217,0.1)', color: '#4a90d9', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: 8, border: '1px solid #1a3a6a', background: 'rgba(13,27,62,0.5)', color: '#4a90d9', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },

  tabs: { display: 'flex', padding: '0 16px', borderBottom: '1px solid #0d1b3e', marginBottom: 4 },
  tab: { flex: 1, padding: '8px 0', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5a7a9a', cursor: 'pointer', textAlign: 'center' },
  tabActive: { borderBottomColor: '#4a90d9', color: 'white' },

  errBox: { margin: '0 16px 8px', padding: 10, borderRadius: 8, background: 'rgba(204,17,17,0.1)', border: '1px solid #cc1111', fontSize: 13, color: '#ff4444' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 60 },
  spinner: { width: 28, height: 28, border: '3px solid #1a3a6a', borderTopColor: '#4a90d9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  loadText: { marginTop: 12, fontSize: 13, color: '#5a7a9a' },
  empty: { textAlign: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: 'white', letterSpacing: 1 },

  list: { padding: '0 12px' },
  sectionLabel: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 2, color: '#5a7a9a', padding: '10px 4px 4px', textTransform: 'uppercase' },

  // Card
  card: { background: 'rgba(13,27,62,0.6)', border: '1px solid #1a2b8c', borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTime: { fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: '#4a90d9' },
  cardTags: { display: 'flex', gap: 4 },
  badge: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, padding: '1px 5px', borderRadius: 3, border: '1px solid', letterSpacing: 0.5 },
  cardJobNum: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#5a7a9a', marginBottom: 2 },
  cardCustomer: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: 'white', letterSpacing: 0.5, lineHeight: 1.2 },
  cardAddr: { fontSize: 13, color: '#5a7a9a', marginTop: 3 },
  cardIssue: { fontSize: 12, color: '#7a9aba', marginTop: 2, fontStyle: 'italic' },
  cardWarn: { fontSize: 11, color: '#cc5500', marginTop: 3 },
  cardCal: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#5a7a9a' },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },

  // Panel
  overlay: { position: 'fixed', inset: 0, background: 'rgba(6,13,31,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  panel: { background: '#0a1228', borderTop: '2px solid #1a2b8c', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto', padding: '8px 20px 32px', position: 'relative', animation: 'slideUp 0.25s ease', WebkitOverflowScrolling: 'touch' },
  handle: { width: 40, height: 4, borderRadius: 2, background: '#1a3a6a', margin: '4px auto 16px' },
  closeBtn: { position: 'absolute', top: 12, right: 16, background: 'none', border: '1px solid #1a3a6a', borderRadius: 8, color: '#5a7a9a', padding: '6px 10px', cursor: 'pointer', fontSize: 14 },

  detailTagRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 },
  detailTag: { fontFamily: "'Share Tech Mono', monospace", fontSize: 12, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5 },
  detailCal: { fontSize: 12, color: '#5a7a9a', marginLeft: 'auto' },
  detailName: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 28, color: 'white', letterSpacing: 1, lineHeight: 1.1, margin: '4px 0' },
  detailDate: { fontSize: 13, color: '#5a7a9a', marginBottom: 14 },

  actions: { display: 'flex', gap: 10, marginBottom: 14 },
  actionBtn: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 8px', borderRadius: 12, background: 'rgba(74,144,217,0.06)', border: '1px solid #1a3a6a', textDecoration: 'none', cursor: 'pointer' },
  actionLabel: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: 'white', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  actionSub: { fontSize: 11, color: '#5a7a9a', marginTop: 1, textAlign: 'center', wordBreak: 'break-word' },

  fields: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  field: { background: 'rgba(13,27,62,0.5)', border: '1px solid #0d1b3e', borderRadius: 8, padding: '8px 12px', flex: 1 },
  fieldLabel: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#5a7a9a', textTransform: 'uppercase', marginBottom: 2 },
  fieldValue: { fontSize: 14, color: '#c8d8e8', lineHeight: 1.4 },
  fieldValueMono: { fontFamily: "'Share Tech Mono', monospace", fontSize: 18, color: '#ffcc44', letterSpacing: 2 },

  notesBox: { marginBottom: 12 },
  noteItem: { fontSize: 13, color: '#c8d8e8', padding: '5px 10px', borderLeft: '2px solid #1a3a6a', marginBottom: 3, lineHeight: 1.4 },

  historyBtn: { background: 'none', border: 'none', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: '#4a90d9', cursor: 'pointer', padding: '6px 0', letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 },
  historyBox: { maxHeight: 160, overflowY: 'auto', marginBottom: 12 },
  historyMsg: { fontSize: 12, color: '#5a7a9a', padding: 6 },
  historyItem: { display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12, borderBottom: '1px solid #0d1b3e' },
  historyDate: { fontFamily: "'Share Tech Mono', monospace", color: '#5a7a9a', fontSize: 11 },

  // Job flow
  flowSection: { marginTop: 16, borderTop: '1px solid #0d1b3e', paddingTop: 14 },
  textarea: { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #1a3a6a', background: 'rgba(13,27,62,0.5)', color: '#c8d8e8', fontSize: 14, fontFamily: "'Barlow', sans-serif", resize: 'vertical', outline: 'none', lineHeight: 1.5, marginBottom: 10 },

  startBtn: { width: '100%', padding: '14px', borderRadius: 12, border: '2px solid #4a90d9', background: 'rgba(74,144,217,0.08)', color: '#4a90d9', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' },
  timerBadge: { textAlign: 'center', padding: '8px', borderRadius: 8, background: 'rgba(76,175,80,0.08)', border: '1px solid #4caf5033', color: '#4caf50', fontFamily: "'Share Tech Mono', monospace", fontSize: 12, letterSpacing: 1, marginBottom: 8 },
  completeBtn: { width: '100%', padding: '14px', borderRadius: 12, border: '2px solid #4caf50', background: 'rgba(76,175,80,0.08)', color: '#4caf50', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' },

  // Completion
  completionBox: { marginTop: 16, borderTop: '1px solid #0d1b3e', paddingTop: 14, animation: 'fadeIn 0.2s ease' },
  completionTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: 'white', textAlign: 'center', marginBottom: 12, letterSpacing: 1 },
  completionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  outcomeBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '16px 8px', borderRadius: 12, border: '2px solid', background: 'transparent', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' },
  backBtn: { width: '100%', marginTop: 10, padding: '10px', borderRadius: 8, border: '1px solid #1a3a6a', background: 'transparent', color: '#5a7a9a', fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", textAlign: 'center' },
  busyText: { textAlign: 'center', fontSize: 12, color: '#4a90d9', marginTop: 8, fontFamily: "'Share Tech Mono', monospace" },

  // New Job form
  formGroup: { marginBottom: 12 },
  formLabel: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#5a7a9a', textTransform: 'uppercase', marginBottom: 4, display: 'block' },
  formInput: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #1a3a6a', background: 'rgba(13,27,62,0.5)', color: '#c8d8e8', fontSize: 15, fontFamily: "'Barlow', sans-serif", outline: 'none' },
};
