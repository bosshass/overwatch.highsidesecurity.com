// ============================================
// OVERWATCH V3 - Migration Tool (Phase 0)
// ============================================
// Sara's one-time tool to migrate historical events to V3 format.
// Scans all calendars → classifies → previews → batch rewrites.

import { useState, useCallback } from 'react';
import { SYNC_CALENDARS, ACTIVE_CALENDARS } from '../config/calendars.js';
import { fetchAllHistorical, rewriteEvent } from '../services/calendarApi.js';
import { parseEvent, classifyEvents, generateV3Rewrite, formatTitle, formatDescription, TAGS, getTagColor, getFormatColor, getFormatLabel } from '../services/eventParser.js';

// Only scan calendars that hold ACTIVE work — skip archive calendars
const SCANNABLE_CALENDARS = SYNC_CALENDARS.filter(c => !['completed', 'sales'].includes(c.type));

// Default: 90 days back
function get90DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

export default function MigrationTool({ accessToken, userEmail }) {
  // Scan config
  const [startDate, setStartDate] = useState(get90DaysAgo);
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedCalendars, setSelectedCalendars] = useState(SCANNABLE_CALENDARS.map(c => c.id));

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [rawEvents, setRawEvents] = useState([]);
  const [classified, setClassified] = useState(null);

  // Browse state
  const [activeTab, setActiveTab] = useState('summary');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [previewTag, setPreviewTag] = useState(TAGS.SERVICE);

  // Rewrite state
  const [rewriting, setRewriting] = useState(false);
  const [rewriteResults, setRewriteResults] = useState(null);
  const [rewriteTarget, setRewriteTarget] = useState('v2'); // which category to rewrite

  // ---- SCAN ----
  const runScan = useCallback(async () => {
    setScanning(true);
    setProgress({ calendar: 'Starting...', index: 0, total: SCANNABLE_CALENDARS.length, events: 0 });
    setClassified(null);
    setRawEvents([]);
    setActiveTab('summary');

    try {
      const calendars = SCANNABLE_CALENDARS.filter(c => selectedCalendars.includes(c.id));
      const timeMin = new Date(startDate + 'T00:00:00');
      const timeMax = new Date(endDate + 'T23:59:59');

      const events = await fetchAllHistorical(accessToken, calendars, timeMin, timeMax, (p) => {
        setProgress(p);
      });

      setRawEvents(events);
      const result = classifyEvents(events);
      setClassified(result);
      setActiveTab('summary');
    } catch (err) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [accessToken, startDate, endDate, selectedCalendars]);

  // ---- BATCH REWRITE ----
  const runRewrite = useCallback(async () => {
    if (!classified) return;
    const events = classified[rewriteTarget] || [];
    if (events.length === 0) return;

    const confirm = window.confirm(
      `Rewrite ${events.length} ${rewriteTarget} events to V3 format?\n\nThis will update event titles and descriptions on Google Calendar. This cannot be undone.`
    );
    if (!confirm) return;

    setRewriting(true);
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < events.length; i++) {
      const parsed = events[i];
      try {
        const { summary, description } = generateV3Rewrite(parsed, { tag: previewTag });
        await rewriteEvent(accessToken, parsed.calendarId, parsed.id, { summary, description });
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ event: parsed.rawSummary, error: err.message });
      }

      // Progress update every 5 events
      if (i % 5 === 0) {
        setProgress({ calendar: `Rewriting ${rewriteTarget}...`, index: i, total: events.length, events: results.success });
      }

      // Rate limit: 100ms between writes
      await new Promise(r => setTimeout(r, 100));
    }

    setRewriteResults(results);
    setRewriting(false);
    setProgress(null);
  }, [accessToken, classified, rewriteTarget, previewTag]);

  // ---- EXPORT REPORT ----
  const exportReport = useCallback(() => {
    if (!classified) return;

    // CSV — opens in Sheets/Excel
    const csvRows = [
      ['Date', 'Calendar', 'Title', 'Format', 'Tag', 'Customer', 'Phone', 'Address', 'Issue', 'Missing Fields'].join(','),
    ];

    const escCsv = (val) => {
      const s = String(val || '').replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    for (const cat of ['v3', 'v2', 'rogue', 'personal']) {
      for (const e of (classified[cat] || [])) {
        csvRows.push([
          e.start?.slice(0, 10) || '',
          e.calendarName,
          e.rawSummary,
          cat.toUpperCase(),
          e.tag || '',
          e.customerName,
          e.phone,
          e.address,
          e.issue,
          e.missingFields.join('; '),
        ].map(escCsv).join(','));
      }
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ow_migration_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [classified]);

  // ---- CALENDAR TOGGLE ----
  const toggleCalendar = (calId) => {
    setSelectedCalendars(prev =>
      prev.includes(calId) ? prev.filter(id => id !== calId) : [...prev, calId]
    );
  };

  // ---- RENDER ----
  return (
    <div style={s.container}>
      {/* HEADER */}
      <div style={s.hero}>
        <div style={s.eyebrow}>PHASE 0</div>
        <h1 style={s.h1}>DATA MIGRATION</h1>
        <p style={s.heroSub}>
          Scan all calendars. Classify events. Preview V3 format. Batch rewrite.
        </p>
      </div>

      {/* CONFIG PANEL */}
      <div style={s.panel}>
        <div style={s.panelHeader}>
          <div style={s.panelBar('#4a90d9')} />
          <h2 style={s.h2}>Scan Configuration</h2>
        </div>

        {/* Date Range */}
        <div style={s.row}>
          <div style={s.field}>
            <label style={s.label}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={s.input} />
          </div>
          <div style={s.field}>
            <label style={s.label}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={s.input} />
          </div>
        </div>

        {/* Calendar Selection */}
        <div style={{ marginTop: 16 }}>
          <label style={s.label}>Calendars to Scan</label>
          <div style={s.calGrid}>
            {SCANNABLE_CALENDARS.map(cal => (
              <button
                key={cal.id}
                onClick={() => toggleCalendar(cal.id)}
                style={{
                  ...s.calChip,
                  background: selectedCalendars.includes(cal.id) ? `${cal.color}22` : 'transparent',
                  borderColor: selectedCalendars.includes(cal.id) ? cal.color : '#1a3a6a',
                  color: selectedCalendars.includes(cal.id) ? cal.color : '#5a7a9a',
                }}
              >
                {cal.name}
              </button>
            ))}
          </div>
        </div>

        {/* Scan Button */}
        <button onClick={runScan} disabled={scanning} style={{ ...s.btnAction, marginTop: 20, opacity: scanning ? 0.5 : 1 }}>
          {scanning ? '⏳ Scanning...' : '🔍 SCAN CALENDARS'}
        </button>

        {/* Progress */}
        {progress && (
          <div style={s.progressBar}>
            <div style={s.progressText}>
              {progress.calendar} — {progress.events} events found
            </div>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${((progress.index + 1) / progress.total) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* RESULTS */}
      {classified && (
        <>
          {/* Summary Cards */}
          <div style={s.panel}>
            <div style={s.panelHeader}>
              <div style={s.panelBar('#4caf50')} />
              <h2 style={s.h2}>Scan Results</h2>
              <span style={s.badge}>{classified.total} events</span>
            </div>

            <div style={s.statsGrid}>
              <StatCard label="V3 Tagged" count={classified.v3.length} color="#4caf50" sub="Already formatted" />
              <StatCard label="V2 Legacy" count={classified.v2.length} color="#4a90d9" sub="Has JUC-E markers, needs tags" />
              <StatCard label="Rogue" count={classified.rogue.length} color="#cc1111" sub="No tags, no markers" />
              <StatCard label="Personal" count={classified.personal.length} color="#6633cc" sub="[PERSONAL] or [IGNORE]" />
              <StatCard label="Empty" count={classified.cancelled.length} color="#444" sub="Cancelled or blank" />
            </div>

            {/* Tabs */}
            <div style={s.tabs}>
              {['summary', 'v3', 'v2', 'rogue', 'personal'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    ...s.tab,
                    borderColor: activeTab === tab ? '#4a90d9' : 'transparent',
                    color: activeTab === tab ? 'white' : '#5a7a9a',
                  }}
                >
                  {tab === 'summary' ? 'Summary' : `${tab.toUpperCase()} (${classified[tab]?.length || 0})`}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'summary' ? (
              <div style={s.summaryContent}>
                <p style={s.summaryText}>
                  <strong style={{ color: '#4caf50' }}>{classified.v3.length}</strong> events already in V3 format.{' '}
                  <strong style={{ color: '#4a90d9' }}>{classified.v2.length}</strong> V2 events need tag prefixes added.{' '}
                  <strong style={{ color: '#cc1111' }}>{classified.rogue.length}</strong> rogue events need classification.
                </p>

                {/* Missing fields breakdown */}
                {(() => {
                  const allParsed = [...classified.v2, ...classified.rogue];
                  const missingPhone = allParsed.filter(e => e.missingFields.includes('phone')).length;
                  const missingAddr = allParsed.filter(e => e.missingFields.includes('address')).length;
                  const missingIssue = allParsed.filter(e => e.missingFields.includes('issue')).length;
                  return (
                    <div style={s.missingGrid}>
                      <div style={s.missingItem}>
                        <span style={s.missingCount}>{missingPhone}</span>
                        <span style={s.missingLabel}>Missing phone</span>
                      </div>
                      <div style={s.missingItem}>
                        <span style={s.missingCount}>{missingAddr}</span>
                        <span style={s.missingLabel}>Missing address</span>
                      </div>
                      <div style={s.missingItem}>
                        <span style={s.missingCount}>{missingIssue}</span>
                        <span style={s.missingLabel}>Missing issue</span>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={exportReport} style={s.btnGhost}>📄 Export Report</button>
                </div>
              </div>
            ) : (
              <EventList
                events={classified[activeTab] || []}
                onSelect={setSelectedEvent}
                selected={selectedEvent}
              />
            )}
          </div>

          {/* REWRITE PANEL */}
          {(classified.v2.length > 0 || classified.rogue.length > 0) && (
            <div style={s.panel}>
              <div style={s.panelHeader}>
                <div style={s.panelBar('#cc5500')} />
                <h2 style={s.h2}>Batch Rewrite</h2>
              </div>

              <div style={s.row}>
                <div style={s.field}>
                  <label style={s.label}>Category to rewrite</label>
                  <select value={rewriteTarget} onChange={e => setRewriteTarget(e.target.value)} style={s.input}>
                    <option value="v2">V2 Legacy ({classified.v2.length})</option>
                    <option value="rogue">Rogue ({classified.rogue.length})</option>
                  </select>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Default tag for untagged</label>
                  <select value={previewTag} onChange={e => setPreviewTag(e.target.value)} style={s.input}>
                    {Object.values(TAGS).map(t => (
                      <option key={t} value={t}>[{t}]</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview */}
              {classified[rewriteTarget]?.length > 0 && (
                <div style={s.previewBox}>
                  <div style={s.previewLabel}>Preview (first event)</div>
                  {(() => {
                    const first = classified[rewriteTarget][0];
                    const rewrite = generateV3Rewrite(first, { tag: previewTag });
                    return (
                      <div style={s.previewGrid}>
                        <div>
                          <div style={s.previewSub}>BEFORE</div>
                          <div style={s.previewTitle}>{first.rawSummary}</div>
                          <pre style={s.previewDesc}>{first.rawDescription.slice(0, 200) || '(empty)'}</pre>
                        </div>
                        <div style={s.previewArrow}>→</div>
                        <div>
                          <div style={s.previewSub}>AFTER</div>
                          <div style={s.previewTitle}>{rewrite.summary}</div>
                          <pre style={s.previewDesc}>{rewrite.description.slice(0, 200)}</pre>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <button
                onClick={runRewrite}
                disabled={rewriting}
                style={{ ...s.btnDanger, marginTop: 16, opacity: rewriting ? 0.5 : 1 }}
              >
                {rewriting ? '⏳ Rewriting...' : `⚡ REWRITE ${classified[rewriteTarget]?.length || 0} EVENTS`}
              </button>

              {rewriteResults && (
                <div style={s.resultsBox}>
                  ✅ {rewriteResults.success} rewritten
                  {rewriteResults.failed > 0 && <span style={{ color: '#cc1111' }}> · ❌ {rewriteResults.failed} failed</span>}
                  {rewriteResults.errors.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      {rewriteResults.errors.slice(0, 5).map((e, i) => (
                        <div key={i} style={{ color: '#cc1111' }}>• {e.event}: {e.error}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* EVENT DETAIL PANEL */}
          {selectedEvent && (
            <EventDetail
              parsed={selectedEvent}
              previewTag={previewTag}
              onClose={() => setSelectedEvent(null)}
              onRewrite={async (tag) => {
                try {
                  const { summary, description } = generateV3Rewrite(selectedEvent, { tag });
                  await rewriteEvent(accessToken, selectedEvent.calendarId, selectedEvent.id, { summary, description });
                  alert('Event rewritten to V3 format!');
                  setSelectedEvent(null);
                } catch (err) {
                  alert(`Rewrite failed: ${err.message}`);
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function StatCard({ label, count, color, sub }) {
  return (
    <div style={{ ...s.statCard, borderColor: count > 0 ? color : '#1a2b8c' }}>
      <div style={{ ...s.statCount, color }}>{count}</div>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statSub}>{sub}</div>
    </div>
  );
}

function EventList({ events, onSelect, selected }) {
  if (events.length === 0) return <div style={s.empty}>No events in this category.</div>;

  // Group by calendar
  const byCalendar = {};
  for (const e of events) {
    const key = e.calendarName || 'Unknown';
    if (!byCalendar[key]) byCalendar[key] = [];
    byCalendar[key].push(e);
  }

  return (
    <div style={s.eventList}>
      {Object.entries(byCalendar).map(([calName, calEvents]) => (
        <div key={calName}>
          <div style={s.calHeader}>{calName} ({calEvents.length})</div>
          {calEvents.slice(0, 50).map(e => (
            <div
              key={`${e.calendarId}-${e.id}`}
              onClick={() => onSelect(e)}
              style={{
                ...s.eventRow,
                borderColor: selected?.id === e.id ? '#4a90d9' : '#0d1b3e',
                background: selected?.id === e.id ? 'rgba(74,144,217,0.08)' : 'transparent',
              }}
            >
              <div style={s.eventDate}>{e.start?.slice(0, 10) || '—'}</div>
              <div style={s.eventTitle}>{e.rawSummary}</div>
              <div style={s.eventMeta}>
                {e.tag && <span style={{ ...s.eventTag, background: `${getTagColor(e.tag)}22`, color: getTagColor(e.tag) }}>[{e.tag}]</span>}
                {e.missingFields.length > 0 && (
                  <span style={s.eventMissing}>⚠ {e.missingFields.join(', ')}</span>
                )}
              </div>
            </div>
          ))}
          {calEvents.length > 50 && (
            <div style={s.moreLabel}>+ {calEvents.length - 50} more...</div>
          )}
        </div>
      ))}
    </div>
  );
}

function EventDetail({ parsed, previewTag, onClose, onRewrite }) {
  const [tag, setTag] = useState(previewTag);
  const rewrite = generateV3Rewrite(parsed, { tag });

  return (
    <div style={s.detailOverlay} onClick={onClose}>
      <div style={s.detailCard} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={s.detailTitle}>Event Detail</h3>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>

        {/* Current */}
        <div style={s.detailSection}>
          <div style={s.detailSectionTitle}>CURRENT</div>
          <div style={s.detailRow}><span style={s.detailKey}>Title:</span> {parsed.rawSummary}</div>
          <div style={s.detailRow}><span style={s.detailKey}>Calendar:</span> {parsed.calendarName}</div>
          <div style={s.detailRow}><span style={s.detailKey}>Date:</span> {parsed.start?.slice(0, 10)}</div>
          <div style={s.detailRow}><span style={s.detailKey}>Format:</span> <span style={{ color: getFormatColor(parsed.format) }}>{getFormatLabel(parsed.format)}</span></div>
          {parsed.tag && <div style={s.detailRow}><span style={s.detailKey}>Tag:</span> [{parsed.tag}]</div>}
        </div>

        {/* Parsed fields */}
        <div style={s.detailSection}>
          <div style={s.detailSectionTitle}>PARSED FIELDS</div>
          <div style={s.detailRow}><span style={s.detailKey}>Customer:</span> {parsed.customerName || <span style={s.missing}>missing</span>}</div>
          <div style={s.detailRow}><span style={s.detailKey}>Phone:</span> {parsed.phone || <span style={s.missing}>missing</span>}</div>
          <div style={s.detailRow}><span style={s.detailKey}>Address:</span> {parsed.address || <span style={s.missing}>missing</span>}</div>
          <div style={s.detailRow}><span style={s.detailKey}>Issue:</span> {parsed.issue || <span style={s.missing}>missing</span>}</div>
          {parsed.gateCode && <div style={s.detailRow}><span style={s.detailKey}>Gate:</span> {parsed.gateCode}</div>}
          {parsed.panelPassword && <div style={s.detailRow}><span style={s.detailKey}>Panel:</span> {parsed.panelPassword}</div>}
          {parsed.latestNote && <div style={s.detailRow}><span style={s.detailKey}>Note:</span> {parsed.latestNote}</div>}
        </div>

        {/* V3 Preview */}
        <div style={s.detailSection}>
          <div style={s.detailSectionTitle}>V3 REWRITE PREVIEW</div>
          <div style={{ marginBottom: 8 }}>
            <label style={s.label}>Tag: </label>
            <select value={tag} onChange={e => setTag(e.target.value)} style={{ ...s.input, width: 'auto', display: 'inline-block' }}>
              {Object.values(TAGS).map(t => <option key={t} value={t}>[{t}]</option>)}
            </select>
          </div>
          <div style={s.previewBox}>
            <div style={s.previewTitle}>{rewrite.summary}</div>
            <pre style={{ ...s.previewDesc, maxHeight: 200 }}>{rewrite.description}</pre>
          </div>
        </div>

        <button onClick={() => onRewrite(tag)} style={s.btnDanger}>
          ⚡ Rewrite This Event to V3
        </button>
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const s = {
  container: { maxWidth: 1100, margin: '0 auto', padding: '0 16px 80px' },

  // Hero
  hero: { textAlign: 'center', padding: '40px 0 24px' },
  eyebrow: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 3, color: '#4a90d9', border: '1px solid #1a3a6a', borderRadius: 20, padding: '3px 14px', display: 'inline-block', marginBottom: 12 },
  h1: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 'clamp(28px, 5vw, 48px)', letterSpacing: 2, color: 'white', textTransform: 'uppercase', lineHeight: 1 },
  heroSub: { color: '#5a7a9a', fontSize: 14, marginTop: 8 },

  // Panel
  panel: { background: 'rgba(13,27,62,0.5)', border: '1px solid #1a2b8c', borderRadius: 12, padding: '20px 24px', marginBottom: 16 },
  panelHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
  panelBar: (color) => ({ width: 4, height: 24, borderRadius: 2, background: color, flexShrink: 0 }),
  h2: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: 2, textTransform: 'uppercase', color: 'white' },
  badge: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(74,144,217,0.12)', border: '1px solid #1a3a6a', color: '#4a90d9', marginLeft: 'auto' },

  // Form
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 140 },
  label: { display: 'block', fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 1, color: '#5a7a9a', marginBottom: 4, textTransform: 'uppercase' },
  input: { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #1a3a6a', background: '#0d1b3e', color: '#c8d8e8', fontSize: 14, fontFamily: "'Barlow', sans-serif", outline: 'none' },

  // Calendar chips
  calGrid: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  calChip: { padding: '4px 12px', borderRadius: 6, border: '1px solid', fontSize: 12, fontFamily: "'Share Tech Mono', monospace", cursor: 'pointer', background: 'none', letterSpacing: 0.5 },

  // Buttons
  btnAction: { width: '100%', padding: '12px', borderRadius: 8, border: '2px solid #4a90d9', background: 'rgba(74,144,217,0.12)', color: '#4a90d9', fontSize: 14, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' },
  btnDanger: { width: '100%', padding: '12px', borderRadius: 8, border: '2px solid #cc5500', background: 'rgba(204,85,0,0.12)', color: '#ff8844', fontSize: 14, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' },
  btnGhost: { padding: '8px 16px', borderRadius: 6, border: '1px solid #1a3a6a', background: 'transparent', color: '#5a7a9a', fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },

  // Progress
  progressBar: { marginTop: 12 },
  progressText: { fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: '#5a7a9a', marginBottom: 4 },
  progressTrack: { width: '100%', height: 4, background: '#0d1b3e', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#4a90d9', borderRadius: 2, transition: 'width 0.3s ease' },

  // Stats
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 },
  statCard: { background: 'rgba(8,15,32,0.8)', border: '1px solid #1a2b8c', borderRadius: 8, padding: '12px 16px', textAlign: 'center' },
  statCount: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 32, lineHeight: 1 },
  statLabel: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 1, color: 'white', textTransform: 'uppercase', marginTop: 4 },
  statSub: { fontSize: 11, color: '#5a7a9a', marginTop: 2 },

  // Tabs
  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid #1a2b8c', marginBottom: 12 },
  tab: { padding: '8px 14px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 12, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', color: '#5a7a9a' },

  // Summary
  summaryContent: { padding: '8px 0' },
  summaryText: { fontSize: 14, color: '#c8d8e8', lineHeight: 1.6, marginBottom: 16 },
  missingGrid: { display: 'flex', gap: 16, marginTop: 8 },
  missingItem: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  missingCount: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 24, color: '#cc5500' },
  missingLabel: { fontSize: 11, color: '#5a7a9a' },

  // Event list
  eventList: { maxHeight: 500, overflowY: 'auto' },
  calHeader: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, color: '#4a90d9', textTransform: 'uppercase', padding: '8px 0 4px', borderBottom: '1px solid #0d1b3e' },
  eventRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', transition: 'all 0.15s ease' },
  eventDate: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#5a7a9a', flexShrink: 0, width: 80 },
  eventTitle: { fontSize: 13, color: '#c8d8e8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  eventMeta: { display: 'flex', gap: 6, flexShrink: 0 },
  eventTag: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, padding: '2px 6px', borderRadius: 3 },
  eventMissing: { fontSize: 10, color: '#cc5500' },
  moreLabel: { fontSize: 12, color: '#5a7a9a', padding: '8px', fontStyle: 'italic' },
  empty: { padding: 20, textAlign: 'center', color: '#5a7a9a', fontSize: 14 },

  // Preview
  previewBox: { background: '#060d1f', border: '1px solid #1a2b8c', borderRadius: 8, padding: 16, marginTop: 8 },
  previewLabel: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#5a7a9a', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  previewGrid: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'start' },
  previewArrow: { color: '#cc5500', fontSize: 24, fontWeight: 700, alignSelf: 'center' },
  previewSub: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: '#5a7a9a', letterSpacing: 1, marginBottom: 4 },
  previewTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: 'white', marginBottom: 4 },
  previewDesc: { fontSize: 11, color: '#5a7a9a', fontFamily: "'Share Tech Mono', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4, margin: 0, overflow: 'auto', maxHeight: 120 },

  // Results
  resultsBox: { marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(74,175,80,0.08)', border: '1px solid #2a7a2a', fontSize: 13, color: '#4caf50' },

  // Detail overlay
  detailOverlay: { position: 'fixed', inset: 0, background: 'rgba(6,13,31,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  detailCard: { background: '#0d1b3e', border: '1px solid #1a2b8c', borderRadius: 12, padding: 24, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' },
  detailTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: 2, color: 'white', textTransform: 'uppercase' },
  closeBtn: { background: 'none', border: '1px solid #1a3a6a', borderRadius: 6, color: '#5a7a9a', padding: '4px 10px', cursor: 'pointer', fontSize: 16 },
  detailSection: { marginBottom: 16, padding: 12, background: 'rgba(8,15,32,0.8)', borderRadius: 8, border: '1px solid #0d1b3e' },
  detailSectionTitle: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#4a90d9', marginBottom: 8, textTransform: 'uppercase' },
  detailRow: { fontSize: 13, color: '#c8d8e8', marginBottom: 4, lineHeight: 1.5 },
  detailKey: { color: '#5a7a9a', marginRight: 4 },
  missing: { color: '#cc5500', fontStyle: 'italic', fontSize: 12 },
};
