// ============================================
// OVERWATCH V3 - Tech View (Phase 1)
// ============================================
// Austin's daily driver. Mobile-first.
// Today | Week | History. Job cards with actions.
// Disposition: Complete / Return / Sales Opp / No Charge
// Deep link: /job/EVENT_ID lands here with full card open.

import { useState, useEffect, useCallback, useRef } from 'react';
import { SYNC_CALENDARS, ACTIVE_CALENDARS, TECH_CALENDARS, CALENDARS, getCalendarMeta, getTechCalendarId } from '../config/calendars.js';
import { fetchCalendarEvents, apiUpdate, apiMove, rewriteEvent } from '../services/calendarApi.js';
import { parseEvent, formatTitle, formatDescription, TAGS, getTagColor, ACTIVE_TAGS, BILLING_TAGS, SKIP_TAGS } from '../services/eventParser.js';
import { getUserConfig } from '../config/roles.js';

// ============================================
// MAIN COMPONENT
// ============================================
export default function TechView({ accessToken, userEmail, deepLinkEventId }) {
  const config = getUserConfig(userEmail);
  const techName = config.name;

  // State
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('today');           // today | week | history
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [dispositionLoading, setDispositionLoading] = useState(false);
  const [notesInput, setNotesInput] = useState('');
  const [customerHistory, setCustomerHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Which calendars does this user see in Field View?
  const myCalendarId = getTechCalendarId(userEmail);
  const isOperator = config.role === 'operator';

  // Operator sees all tech + queue + installations (NOT admin calendar — that's personal)
  // Techs see their own calendar + queue + installations
  const visibleCalendars = ACTIVE_CALENDARS.filter(c => {
    if (c.type === 'admin') return false; // Sara Tasks = personal stuff, never in field view
    if (isOperator) return true;          // Operator sees all field calendars
    return c.id === myCalendarId || c.type === 'queue' || c.type === 'installations';
  });

  // ---- FETCH EVENTS ----
  const loadEvents = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const daysBack = tab === 'history' ? 30 : 1;
      const daysForward = tab === 'today' ? 1 : tab === 'week' ? 7 : 30;
      const raw = await fetchCalendarEvents(accessToken, visibleCalendars, daysBack, daysForward);

      // Parse all events
      const parsed = raw.map(e => parseEvent(e)).filter(e => {
        // Skip personal/ignore tagged
        if (SKIP_TAGS.includes(e.tag)) return false;
        // Skip all-day events (usually holidays, etc)
        if (e.allDay) return false;
        return true;
      });

      setEvents(parsed);

      // If deep link, auto-open that event
      if (deepLinkEventId) {
        const target = parsed.find(e => e.id === deepLinkEventId);
        if (target) setSelectedEvent(target);
      }
    } catch (err) {
      setError(`Failed to load: ${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, tab, visibleCalendars, deepLinkEventId]);

  useEffect(() => { loadEvents(); }, [tab]);

  // ---- FILTER BY TAB ----
  const filteredEvents = (() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (tab === 'today') {
      return events.filter(e => {
        const eventDate = (e.start || '').slice(0, 10);
        return eventDate === todayStr;
      });
    }
    if (tab === 'week') {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return events.filter(e => {
        const d = new Date(e.start);
        return d >= new Date(todayStr) && d <= weekEnd;
      });
    }
    // history — show everything, most recent first
    return [...events].reverse();
  })();

  // Group today's events
  // Techs: my jobs vs service queue
  // Operator: all jobs grouped by tech calendar
  const myJobs = isOperator ? [] : filteredEvents.filter(e => e.calendarId === myCalendarId);
  const queueJobs = isOperator ? filteredEvents : filteredEvents.filter(e => e.calendarId !== myCalendarId);

  // ---- DISPOSITION ACTIONS ----
  const handleDisposition = useCallback(async (parsed, type) => {
    setDispositionLoading(true);
    try {
      const tagMap = {
        complete: TAGS.COMPLETE,
        return: TAGS.RETURN,
        sales: TAGS.ESTIMATE,
        nc: TAGS.NC,
      };
      const newTag = tagMap[type];
      if (!newTag) throw new Error(`Unknown disposition: ${type}`);

      // Build new title & description
      const updatedParsed = { ...parsed, tag: newTag };
      if (notesInput.trim()) {
        updatedParsed.notes = [...parsed.notes, `${new Date().toLocaleDateString()} ${techName}: ${notesInput.trim()}`];
      }

      const newTitle = formatTitle(updatedParsed, newTag);
      const newDesc = formatDescription(updatedParsed);

      // Update the event on its current calendar
      await rewriteEvent(accessToken, parsed.calendarId, parsed.id, {
        summary: newTitle,
        description: newDesc,
      });

      // Move to appropriate destination
      if (type === 'complete' || type === 'nc') {
        // Move to Completed calendar
        try {
          await apiMove(accessToken, parsed.calendarId, parsed.id, CALENDARS.COMPLETED);
        } catch (_) {
          // If move fails (permissions), that's ok — tag is still updated
        }
      }
      // Return + sales stay on current calendar with new tag — Sara handles routing

      setNotesInput('');
      setSelectedEvent(null);
      await loadEvents(true);
    } catch (err) {
      alert(`Disposition failed: ${err.message}`);
    } finally {
      setDispositionLoading(false);
    }
  }, [accessToken, notesInput, techName, loadEvents]);

  // ---- CUSTOMER HISTORY ----
  const loadCustomerHistory = useCallback(async (customerName) => {
    if (!customerName || customerName === '(No title)') return;
    setHistoryLoading(true);
    setCustomerHistory(null);

    try {
      // Search all calendars for this customer name (all time, 2 years back)
      const raw = await fetchCalendarEvents(accessToken, SYNC_CALENDARS, 730, 30);
      const matches = raw
        .map(e => parseEvent(e))
        .filter(e => {
          const name = e.customerName?.toLowerCase() || '';
          const search = customerName.toLowerCase();
          return name.includes(search) || search.includes(name);
        })
        .sort((a, b) => new Date(b.start) - new Date(a.start));

      setCustomerHistory(matches);
    } catch (err) {
      setCustomerHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [accessToken]);

  // ---- RENDER ----
  return (
    <div style={s.container}>
      {/* Pull to refresh indicator */}
      {refreshing && <div style={s.refreshBar}>Refreshing...</div>}

      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.greeting}>
            {getGreeting()}, {techName}
          </div>
          <div style={s.dateLabel}>{formatDate(new Date())}</div>
        </div>
        <button onClick={() => loadEvents(true)} style={s.refreshBtn}>↻</button>
      </div>

      {/* Tab Bar */}
      <div style={s.tabBar}>
        {[
          { key: 'today', label: 'Today', count: tab === 'today' ? myJobs.length : null },
          { key: 'week', label: 'Week' },
          { key: 'history', label: 'History' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              ...s.tabBtn,
              ...(tab === t.key ? s.tabActive : {}),
            }}
          >
            {t.label}
            {t.count != null && <span style={s.tabCount}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && <div style={s.errorBanner}>{error}</div>}

      {/* Loading */}
      {loading && (
        <div style={s.loadingContainer}>
          <div style={s.spinner} />
          <div style={s.loadingText}>Loading calendar...</div>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredEvents.length === 0 && (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>📋</div>
          <div style={s.emptyTitle}>
            {tab === 'today' ? 'No jobs today' : tab === 'week' ? 'Clear week ahead' : 'No recent history'}
          </div>
          <div style={s.emptySub}>Pull down to refresh</div>
        </div>
      )}

      {/* Job Cards */}
      {!loading && filteredEvents.length > 0 && (
        <div style={s.cardList}>
          {/* My Jobs section */}
          {tab === 'today' && myJobs.length > 0 && (
            <>
              <div style={s.sectionLabel}>MY JOBS ({myJobs.length})</div>
              {myJobs.map(e => (
                <JobCard key={`${e.calendarId}-${e.id}`} event={e} onSelect={setSelectedEvent} techName={techName} />
              ))}
            </>
          )}

          {/* Queue / Other section */}
          {tab === 'today' && queueJobs.length > 0 && (
            <>
              <div style={{ ...s.sectionLabel, marginTop: myJobs.length > 0 ? 20 : 0 }}>
                {isOperator ? `ALL JOBS (${queueJobs.length})` : `SERVICE QUEUE (${queueJobs.length})`}
              </div>
              {queueJobs.map(e => (
                <JobCard key={`${e.calendarId}-${e.id}`} event={e} onSelect={setSelectedEvent} techName={techName} isQueue />
              ))}
            </>
          )}

          {/* Week / History — flat list */}
          {tab !== 'today' && filteredEvents.map(e => (
            <JobCard key={`${e.calendarId}-${e.id}`} event={e} onSelect={setSelectedEvent} techName={techName} showDate />
          ))}
        </div>
      )}

      {/* ---- JOB DETAIL PANEL ---- */}
      {selectedEvent && (
        <JobDetail
          event={selectedEvent}
          techName={techName}
          notesInput={notesInput}
          onNotesChange={setNotesInput}
          dispositionLoading={dispositionLoading}
          onDisposition={handleDisposition}
          onClose={() => { setSelectedEvent(null); setCustomerHistory(null); setNotesInput(''); }}
          customerHistory={customerHistory}
          historyLoading={historyLoading}
          onLoadHistory={loadCustomerHistory}
        />
      )}
    </div>
  );
}

// ============================================
// JOB CARD (list item)
// ============================================
function JobCard({ event, onSelect, techName, isQueue, showDate }) {
  const timeStr = event.start ? new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const dateStr = event.start ? new Date(event.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const calMeta = getCalendarMeta(event.calendarId);

  return (
    <div onClick={() => onSelect(event)} style={s.card}>
      {/* Top row: time + tag */}
      <div style={s.cardTop}>
        <div style={s.cardTime}>
          {showDate && <span style={s.cardDate}>{dateStr} · </span>}
          {timeStr}
        </div>
        <div style={s.cardTags}>
          {event.tag && (
            <span style={{ ...s.tag, background: `${getTagColor(event.tag)}22`, color: getTagColor(event.tag), borderColor: `${getTagColor(event.tag)}44` }}>
              {event.tag}
            </span>
          )}
          {!event.isTagged && <span style={{ ...s.tag, background: '#cc111122', color: '#cc1111', borderColor: '#cc111144' }}>ROGUE</span>}
          {isQueue && <span style={{ ...s.tag, background: '#6633cc22', color: '#aa77ff', borderColor: '#6633cc44' }}>QUEUE</span>}
        </div>
      </div>

      {/* Customer name */}
      <div style={s.cardCustomer}>{event.customerName || '(No title)'}</div>

      {/* Address */}
      {event.address && (
        <div style={s.cardAddress}>📍 {event.address}</div>
      )}

      {/* Missing fields warning */}
      {event.missingFields.length > 0 && (
        <div style={s.cardMissing}>
          ⚠ Missing: {event.missingFields.join(', ')}
        </div>
      )}

      {/* Calendar indicator */}
      <div style={s.cardCalendar}>
        <span style={{ ...s.calDot, background: calMeta?.color || '#5a7a9a' }} />
        {event.calendarName}
      </div>
    </div>
  );
}

// ============================================
// JOB DETAIL (full screen panel)
// ============================================
function JobDetail({ event, techName, notesInput, onNotesChange, dispositionLoading, onDisposition, onClose, customerHistory, historyLoading, onLoadHistory }) {
  const [showHistory, setShowHistory] = useState(false);

  const timeStr = event.start ? new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const endStr = event.end ? new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const dateStr = event.start ? new Date(event.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

  return (
    <div style={s.detailOverlay}>
      <div style={s.detailPanel}>
        {/* Handle bar */}
        <div style={s.handleBar} />

        {/* Close */}
        <button onClick={onClose} style={s.detailClose}>✕</button>

        {/* Tag + Job Number */}
        <div style={s.detailTagRow}>
          {event.tag && (
            <span style={{ ...s.detailTag, background: `${getTagColor(event.tag)}22`, color: getTagColor(event.tag) }}>
              [{event.tag}{event.jobNumber ? ` #${event.jobNumber}` : ''}]
            </span>
          )}
          {!event.isTagged && (
            <span style={{ ...s.detailTag, background: '#cc111122', color: '#cc1111' }}>ROGUE EVENT</span>
          )}
          <span style={s.detailCalLabel}>{event.calendarName}</span>
        </div>

        {/* Customer Name */}
        <h2 style={s.detailCustomer}>{event.customerName || '(No title)'}</h2>

        {/* Time */}
        <div style={s.detailTime}>{dateStr} · {timeStr}{endStr ? ` – ${endStr}` : ''}</div>

        {/* ---- ACTION BUTTONS (phone + navigate) ---- */}
        <div style={s.actionRow}>
          {event.phone && (
            <a href={`tel:${event.phone.replace(/\D/g, '')}`} style={s.actionBtn}>
              <span style={s.actionIcon}>📞</span>
              <span style={s.actionLabel}>Call</span>
              <span style={s.actionSub}>{event.phone}</span>
            </a>
          )}
          {event.address && (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(event.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={s.actionBtn}
            >
              <span style={s.actionIcon}>🗺️</span>
              <span style={s.actionLabel}>Navigate</span>
              <span style={s.actionSub}>{event.address.slice(0, 30)}{event.address.length > 30 ? '...' : ''}</span>
            </a>
          )}
        </div>

        {/* ---- DETAILS GRID ---- */}
        <div style={s.detailGrid}>
          {event.issue && (
            <div style={s.detailField}>
              <div style={s.detailFieldLabel}>ISSUE</div>
              <div style={s.detailFieldValue}>{event.issue}</div>
            </div>
          )}
          {event.gateCode && (
            <div style={s.detailFieldSmall}>
              <div style={s.detailFieldLabel}>GATE CODE</div>
              <div style={s.detailFieldValueMono}>{event.gateCode}</div>
            </div>
          )}
          {event.panelPassword && (
            <div style={s.detailFieldSmall}>
              <div style={s.detailFieldLabel}>PANEL PASSWORD</div>
              <div style={s.detailFieldValueMono}>{event.panelPassword}</div>
            </div>
          )}
        </div>

        {/* ---- NOTES ---- */}
        {event.notes.length > 0 && (
          <div style={s.notesSection}>
            <div style={s.notesSectionTitle}>NOTES</div>
            {event.notes.map((note, i) => (
              <div key={i} style={s.noteItem}>{note}</div>
            ))}
          </div>
        )}

        {/* ---- CUSTOMER HISTORY ---- */}
        <div style={s.historySection}>
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory && !customerHistory) onLoadHistory(event.customerName);
            }}
            style={s.historyToggle}
          >
            {showHistory ? '▼' : '▶'} Customer History
            {customerHistory && <span style={s.historyCount}>({customerHistory.length})</span>}
          </button>

          {showHistory && (
            <div style={s.historyList}>
              {historyLoading && <div style={s.historyLoading}>Searching all calendars...</div>}
              {customerHistory && customerHistory.length === 0 && <div style={s.historyEmpty}>No previous visits found</div>}
              {customerHistory && customerHistory.map((h, i) => (
                <div key={i} style={s.historyItem}>
                  <span style={s.historyDate}>{h.start?.slice(0, 10)}</span>
                  <span style={s.historyCal}>{h.calendarName}</span>
                  {h.tag && <span style={{ ...s.historyTag, color: getTagColor(h.tag) }}>[{h.tag}]</span>}
                  <span style={s.historyNote}>{h.latestNote?.slice(0, 60) || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- COMPLETION NOTES ---- */}
        <div style={s.completionSection}>
          <div style={s.completionTitle}>COMPLETION NOTES</div>
          <textarea
            value={notesInput}
            onChange={e => onNotesChange(e.target.value)}
            placeholder="What did you do? Parts used? Issues found?"
            style={s.notesTextarea}
            rows={3}
          />
        </div>

        {/* ---- DISPOSITION BUTTONS ---- */}
        <div style={s.dispositionSection}>
          <div style={s.dispositionTitle}>MARK JOB AS:</div>
          <div style={s.dispositionGrid}>
            <button
              onClick={() => onDisposition(event, 'complete')}
              disabled={dispositionLoading}
              style={{ ...s.dispBtn, ...s.dispComplete }}
            >
              <span style={s.dispIcon}>✓</span>
              <span style={s.dispLabel}>Complete</span>
            </button>
            <button
              onClick={() => onDisposition(event, 'return')}
              disabled={dispositionLoading}
              style={{ ...s.dispBtn, ...s.dispReturn }}
            >
              <span style={s.dispIcon}>↩</span>
              <span style={s.dispLabel}>Return Needed</span>
            </button>
            <button
              onClick={() => onDisposition(event, 'sales')}
              disabled={dispositionLoading}
              style={{ ...s.dispBtn, ...s.dispSales }}
            >
              <span style={s.dispIcon}>$</span>
              <span style={s.dispLabel}>Sales Opp</span>
            </button>
            <button
              onClick={() => onDisposition(event, 'nc')}
              disabled={dispositionLoading}
              style={{ ...s.dispBtn, ...s.dispNC }}
            >
              <span style={s.dispIcon}>—</span>
              <span style={s.dispLabel}>No Charge</span>
            </button>
          </div>
          {dispositionLoading && <div style={s.dispLoading}>Updating calendar...</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================
// HELPERS
// ============================================
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ============================================
// STYLES
// ============================================
const s = {
  container: { maxWidth: 480, margin: '0 auto', padding: '0 0 100px', minHeight: '100vh' },

  // Refresh
  refreshBar: { textAlign: 'center', padding: 8, fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#4a90d9', background: 'rgba(74,144,217,0.08)', letterSpacing: 1 },

  // Header
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 16px 8px' },
  headerLeft: {},
  greeting: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, color: 'white', letterSpacing: 0.5 },
  dateLabel: { fontSize: 13, color: '#5a7a9a', marginTop: 2 },
  refreshBtn: { width: 40, height: 40, borderRadius: 10, border: '1px solid #1a3a6a', background: 'rgba(13,27,62,0.5)', color: '#4a90d9', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },

  // Tab bar
  tabBar: { display: 'flex', gap: 0, padding: '0 16px', marginBottom: 8, borderBottom: '1px solid #0d1b3e' },
  tabBtn: { flex: 1, padding: '10px 0', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5a7a9a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabActive: { borderBottomColor: '#4a90d9', color: 'white' },
  tabCount: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, background: 'rgba(74,144,217,0.2)', color: '#4a90d9', padding: '1px 6px', borderRadius: 8 },

  // Error
  errorBanner: { margin: '0 16px 8px', padding: '10px 14px', borderRadius: 8, background: 'rgba(204,17,17,0.1)', border: '1px solid #cc1111', fontSize: 13, color: '#ff4444' },

  // Loading
  loadingContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 60 },
  spinner: { width: 28, height: 28, border: '3px solid #1a3a6a', borderTopColor: '#4a90d9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  loadingText: { marginTop: 12, fontSize: 13, color: '#5a7a9a' },

  // Empty
  emptyState: { textAlign: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, color: 'white', letterSpacing: 1 },
  emptySub: { fontSize: 13, color: '#5a7a9a', marginTop: 4 },

  // Card list
  cardList: { padding: '0 12px' },
  sectionLabel: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 2, color: '#5a7a9a', padding: '12px 4px 6px', textTransform: 'uppercase' },

  // Job card
  card: {
    background: 'rgba(13,27,62,0.6)',
    border: '1px solid #1a2b8c',
    borderRadius: 12,
    padding: '14px 16px',
    marginBottom: 8,
    cursor: 'pointer',
    transition: 'border-color 0.15s, transform 0.15s',
    WebkitTapHighlightColor: 'transparent',
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTime: { fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: '#4a90d9' },
  cardDate: { color: '#5a7a9a' },
  cardTags: { display: 'flex', gap: 4 },
  tag: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid', letterSpacing: 0.5 },
  cardCustomer: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: 'white', letterSpacing: 0.5, lineHeight: 1.2 },
  cardAddress: { fontSize: 13, color: '#5a7a9a', marginTop: 4, lineHeight: 1.3 },
  cardMissing: { fontSize: 11, color: '#cc5500', marginTop: 4 },
  cardCalendar: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: '#5a7a9a' },
  calDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },

  // ---- DETAIL PANEL ----
  detailOverlay: { position: 'fixed', inset: 0, background: 'rgba(6,13,31,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  detailPanel: {
    background: '#0a1228',
    borderTop: '2px solid #1a2b8c',
    borderRadius: '20px 20px 0 0',
    width: '100%',
    maxWidth: 480,
    maxHeight: '92vh',
    overflowY: 'auto',
    padding: '8px 20px 32px',
    position: 'relative',
    WebkitOverflowScrolling: 'touch',
  },
  handleBar: { width: 40, height: 4, borderRadius: 2, background: '#1a3a6a', margin: '4px auto 16px' },
  detailClose: { position: 'absolute', top: 12, right: 16, background: 'none', border: '1px solid #1a3a6a', borderRadius: 8, color: '#5a7a9a', padding: '6px 10px', cursor: 'pointer', fontSize: 14 },

  // Tag row
  detailTagRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  detailTag: { fontFamily: "'Share Tech Mono', monospace", fontSize: 12, padding: '3px 8px', borderRadius: 4, letterSpacing: 0.5 },
  detailCalLabel: { fontSize: 12, color: '#5a7a9a', marginLeft: 'auto' },

  // Customer
  detailCustomer: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 28, color: 'white', letterSpacing: 1, lineHeight: 1.1, margin: '4px 0 4px' },
  detailTime: { fontSize: 13, color: '#5a7a9a', marginBottom: 16 },

  // Action buttons (call + navigate)
  actionRow: { display: 'flex', gap: 10, marginBottom: 16 },
  actionBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '14px 8px',
    borderRadius: 12,
    background: 'rgba(74,144,217,0.08)',
    border: '1px solid #1a3a6a',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
    WebkitTapHighlightColor: 'transparent',
  },
  actionIcon: { fontSize: 24, marginBottom: 4 },
  actionLabel: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: 'white', letterSpacing: 1, textTransform: 'uppercase' },
  actionSub: { fontSize: 11, color: '#5a7a9a', marginTop: 2, textAlign: 'center', wordBreak: 'break-word' },

  // Detail grid
  detailGrid: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  detailField: { background: 'rgba(13,27,62,0.5)', border: '1px solid #0d1b3e', borderRadius: 8, padding: '10px 14px' },
  detailFieldSmall: { background: 'rgba(13,27,62,0.5)', border: '1px solid #0d1b3e', borderRadius: 8, padding: '8px 14px' },
  detailFieldLabel: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#5a7a9a', textTransform: 'uppercase', marginBottom: 2 },
  detailFieldValue: { fontSize: 14, color: '#c8d8e8', lineHeight: 1.4 },
  detailFieldValueMono: { fontFamily: "'Share Tech Mono', monospace", fontSize: 18, color: '#ffcc44', letterSpacing: 2 },

  // Notes
  notesSection: { marginBottom: 16 },
  notesSectionTitle: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#5a7a9a', marginBottom: 6, textTransform: 'uppercase' },
  noteItem: { fontSize: 13, color: '#c8d8e8', padding: '6px 10px', borderLeft: '2px solid #1a3a6a', marginBottom: 4, lineHeight: 1.4 },

  // Customer history
  historySection: { marginBottom: 16 },
  historyToggle: { background: 'none', border: 'none', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: '#4a90d9', cursor: 'pointer', padding: '8px 0', letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 },
  historyCount: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#5a7a9a' },
  historyList: { marginTop: 6, maxHeight: 200, overflowY: 'auto' },
  historyLoading: { fontSize: 12, color: '#5a7a9a', padding: 8 },
  historyEmpty: { fontSize: 12, color: '#5a7a9a', padding: 8, fontStyle: 'italic' },
  historyItem: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12, borderBottom: '1px solid #0d1b3e', flexWrap: 'wrap' },
  historyDate: { fontFamily: "'Share Tech Mono', monospace", color: '#5a7a9a', flexShrink: 0, fontSize: 11 },
  historyCal: { color: '#5a7a9a', fontSize: 11 },
  historyTag: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10 },
  historyNote: { color: '#c8d8e8', fontSize: 11, flex: 1 },

  // Completion notes
  completionSection: { marginBottom: 16 },
  completionTitle: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#5a7a9a', marginBottom: 6, textTransform: 'uppercase' },
  notesTextarea: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #1a3a6a',
    background: 'rgba(13,27,62,0.5)',
    color: '#c8d8e8',
    fontSize: 14,
    fontFamily: "'Barlow', sans-serif",
    resize: 'vertical',
    outline: 'none',
    lineHeight: 1.5,
  },

  // Disposition
  dispositionSection: { marginBottom: 16 },
  dispositionTitle: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#5a7a9a', marginBottom: 8, textTransform: 'uppercase' },
  dispositionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  dispBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '14px 8px',
    borderRadius: 12,
    border: '2px solid',
    background: 'transparent',
    cursor: 'pointer',
    transition: 'all 0.15s',
    WebkitTapHighlightColor: 'transparent',
  },
  dispIcon: { fontSize: 22, marginBottom: 4, fontWeight: 700 },
  dispLabel: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  dispComplete: { borderColor: '#4caf50', color: '#4caf50' },
  dispReturn: { borderColor: '#cc5500', color: '#ff8844' },
  dispSales: { borderColor: '#f6bf26', color: '#f6bf26' },
  dispNC: { borderColor: '#5a7a9a', color: '#5a7a9a' },
  dispLoading: { textAlign: 'center', fontSize: 12, color: '#4a90d9', marginTop: 8, fontFamily: "'Share Tech Mono', monospace" },
};
