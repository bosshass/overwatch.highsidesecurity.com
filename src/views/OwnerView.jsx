// ============================================
// OVERWATCH V3 — Owner View (JR's Dashboard)
// ============================================
// Section 1: Needs Attention (stale jobs, red alert)
// Section 2: Metrics (open, to-bill, overdue, pipeline)
// Section 3: Today's Schedule (grouped by tech)
// Section 4: Pipeline (estimates pending)
// All from Google Calendar — zero Supabase.

import { useState, useEffect, useCallback } from 'react';
import { ACTIVE_CALENDARS, SYNC_CALENDARS, CALENDARS, TECH_CALENDARS, getCalendarMeta, TECH_COLORS } from '../config/calendars.js';
import { fetchCalendarEvents } from '../services/calendarApi.js';
import { parseEvent, TAGS, ACTIVE_TAGS, BILLING_TAGS, SKIP_TAGS, getTagColor } from '../services/eventParser.js';

export default function OwnerView({ accessToken, userEmail }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      // Pull active calendars: 30 days back, 7 days forward
      const fieldCals = ACTIVE_CALENDARS.filter(c => c.type !== 'admin');
      const raw = await fetchCalendarEvents(accessToken, fieldCals, 30, 7);
      const completedCals = SYNC_CALENDARS.filter(c => c.type === 'completed');
      const completedRaw = await fetchCalendarEvents(accessToken, completedCals, 14, 1);

      const allParsed = raw.map(e => parseEvent(e)).filter(e => !e.allDay && !SKIP_TAGS.includes(e.tag));
      const completedParsed = completedRaw.map(e => parseEvent(e)).filter(e => !e.allDay);

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);

      // === NEEDS ATTENTION ===
      // Active jobs with no update in 7+ days
      const needsAttention = allParsed.filter(e => {
        if (!ACTIVE_TAGS.includes(e.tag) && e.tag !== TAGS.RETURN) return false;
        const updated = new Date(e._raw?.updated || e.start);
        const daysSince = Math.floor((now - updated) / (1000 * 60 * 60 * 24));
        return daysSince >= 7;
      }).map(e => {
        const updated = new Date(e._raw?.updated || e.start);
        const daysSince = Math.floor((now - updated) / (1000 * 60 * 60 * 24));
        return { ...e, daysSince };
      }).sort((a, b) => b.daysSince - a.daysSince);

      // === METRICS ===
      const openJobs = allParsed.filter(e => ACTIVE_TAGS.includes(e.tag) || e.tag === TAGS.RETURN).length;
      const toBill = completedParsed.filter(e => e.tag === TAGS.COMPLETE).length
        + allParsed.filter(e => e.tag === TAGS.COMPLETE).length;
      const estimates = allParsed.filter(e => e.tag === TAGS.ESTIMATE);
      const overdue = needsAttention.length;

      // === TODAY'S SCHEDULE ===
      const todayEvents = allParsed.filter(e => (e.start || '').slice(0, 10) === todayStr);
      const byTech = {};
      for (const e of todayEvents) {
        const calMeta = getCalendarMeta(e.calendarId);
        const techName = calMeta?.name || 'Unassigned';
        if (!byTech[techName]) byTech[techName] = { events: [], color: calMeta?.color || '#5a7a9a' };
        byTech[techName].events.push(e);
      }

      // === UPCOMING (next 7 days) ===
      const upcoming = allParsed.filter(e => {
        const d = (e.start || '').slice(0, 10);
        return d > todayStr && ACTIVE_TAGS.includes(e.tag);
      });

      setData({ needsAttention, openJobs, toBill, estimates, overdue, byTech, todayEvents, upcoming });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => { loadData(); }, []);

  // === RENDER ===
  if (loading) return (
    <div style={s.center}>
      <div style={s.spinner} />
      <div style={s.loadText}>Loading dashboard...</div>
    </div>
  );

  if (error) return <div style={s.errBox}>{error}</div>;
  if (!data) return null;

  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={s.container}>
      {refreshing && <div style={s.refreshBar}>Refreshing...</div>}

      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.greeting}>Dashboard</div>
          <div style={s.dateStr}>{todayStr}</div>
        </div>
        <button onClick={() => loadData(true)} style={s.refreshBtn}>↻</button>
      </div>

      {/* === NEEDS ATTENTION === */}
      {data.needsAttention.length > 0 && (
        <div style={s.alertSection}>
          <div style={s.alertHeader}>
            <span style={s.alertDot} />
            NEEDS ATTENTION — {data.needsAttention.length} stale job{data.needsAttention.length > 1 ? 's' : ''}
          </div>
          {data.needsAttention.slice(0, 5).map(e => (
            <div key={`${e.calendarId}-${e.id}`} style={s.alertCard}>
              <div style={s.alertLeft}>
                <div style={s.alertCustomer}>{e.customerName}</div>
                <div style={s.alertMeta}>
                  {e.tag && <span style={{ color: getTagColor(e.tag) }}>[{e.tag}]</span>}
                  <span> · {e.calendarName}</span>
                  {e.issue && <span> · {e.issue.slice(0, 40)}</span>}
                </div>
              </div>
              <div style={s.alertDays}>
                <div style={s.alertDaysNum}>{e.daysSince}</div>
                <div style={s.alertDaysLabel}>days</div>
              </div>
            </div>
          ))}
          {data.needsAttention.length > 5 && (
            <div style={s.alertMore}>+{data.needsAttention.length - 5} more</div>
          )}
        </div>
      )}

      {/* === METRICS === */}
      <div style={s.metricsGrid}>
        <MetricCard label="Open Jobs" value={data.openJobs} color="#4a90d9" />
        <MetricCard label="To Bill" value={data.toBill} color="#4caf50" />
        <MetricCard label="Estimates" value={data.estimates.length} color="#f6bf26" />
        <MetricCard label="Overdue" value={data.overdue} color={data.overdue > 0 ? '#ff4444' : '#5a7a9a'} />
      </div>

      {/* === TODAY'S SCHEDULE === */}
      <div style={s.section}>
        <div style={s.sectionTitle}>TODAY'S SCHEDULE</div>
        {Object.keys(data.byTech).length === 0 && (
          <div style={s.emptyText}>No jobs scheduled today</div>
        )}
        {Object.entries(data.byTech).map(([techName, techData]) => (
          <div key={techName} style={s.techGroup}>
            <div style={s.techHeader}>
              <span style={{ ...s.techDot, background: techData.color }} />
              <span style={s.techName}>{techName}</span>
              <span style={s.techCount}>{techData.events.length} job{techData.events.length > 1 ? 's' : ''}</span>
            </div>
            {techData.events.map(e => (
              <div key={`${e.calendarId}-${e.id}`} style={s.scheduleCard}>
                <div style={s.schedTime}>
                  {e.start ? new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
                </div>
                <div style={s.schedInfo}>
                  <div style={s.schedCustomer}>{e.customerName}</div>
                  <div style={s.schedDetail}>
                    {e.tag && <span style={{ ...s.schedTag, color: getTagColor(e.tag), borderColor: `${getTagColor(e.tag)}44`, background: `${getTagColor(e.tag)}11` }}>{e.tag}</span>}
                    {e.address && <span style={s.schedAddr}>📍 {e.address.slice(0, 35)}{e.address.length > 35 ? '...' : ''}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* === PIPELINE (Estimates) === */}
      {data.estimates.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>PIPELINE — ESTIMATES</div>
          {data.estimates.map(e => (
            <div key={`${e.calendarId}-${e.id}`} style={s.pipeCard}>
              <div style={s.pipeCustomer}>{e.customerName}</div>
              <div style={s.pipeMeta}>
                {e.calendarName} · {e.start ? new Date(e.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                {e.issue && ` · ${e.issue.slice(0, 50)}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === UPCOMING === */}
      {data.upcoming.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>UPCOMING — NEXT 7 DAYS</div>
          {data.upcoming.slice(0, 10).map(e => (
            <div key={`${e.calendarId}-${e.id}`} style={s.scheduleCard}>
              <div style={s.schedTime}>
                {e.start ? new Date(e.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
              </div>
              <div style={s.schedInfo}>
                <div style={s.schedCustomer}>{e.customerName}</div>
                <div style={s.schedDetail}>
                  <span style={{ ...s.schedTag, color: getTagColor(e.tag), borderColor: `${getTagColor(e.tag)}44`, background: `${getTagColor(e.tag)}11` }}>{e.tag}</span>
                  <span style={s.schedAddr}>{e.calendarName}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 80 }} />
    </div>
  );
}

// ============================================
// METRIC CARD
// ============================================
function MetricCard({ label, value, color }) {
  return (
    <div style={s.metricCard}>
      <div style={{ ...s.metricValue, color }}>{value}</div>
      <div style={s.metricLabel}>{label}</div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const s = {
  container: { maxWidth: 680, margin: '0 auto', padding: '0 16px' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' },
  spinner: { width: 28, height: 28, border: '3px solid #1a3a6a', borderTopColor: '#4a90d9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  loadText: { marginTop: 12, fontSize: 13, color: '#5a7a9a' },
  errBox: { margin: 20, padding: 16, borderRadius: 10, background: 'rgba(204,17,17,0.1)', border: '1px solid #cc1111', color: '#ff4444', fontSize: 14 },
  refreshBar: { textAlign: 'center', padding: 6, fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#4a90d9', background: 'rgba(74,144,217,0.06)', letterSpacing: 1 },

  // Header
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0 12px' },
  greeting: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 28, color: 'white', letterSpacing: 1 },
  dateStr: { fontSize: 13, color: '#5a7a9a', marginTop: 2 },
  refreshBtn: { width: 40, height: 40, borderRadius: 10, border: '1px solid #1a3a6a', background: 'rgba(13,27,62,0.5)', color: '#4a90d9', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },

  // Alert section
  alertSection: { background: 'rgba(204,17,17,0.06)', border: '1px solid rgba(204,17,17,0.25)', borderRadius: 14, padding: 16, marginBottom: 16 },
  alertHeader: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 2, color: '#ff4444', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, textTransform: 'uppercase' },
  alertDot: { width: 8, height: 8, borderRadius: '50%', background: '#ff4444', animation: 'pulse 2s ease-in-out infinite', flexShrink: 0 },
  alertCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(6,13,31,0.6)', borderRadius: 10, marginBottom: 6, border: '1px solid rgba(204,17,17,0.12)' },
  alertLeft: { flex: 1 },
  alertCustomer: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: 'white', letterSpacing: 0.5 },
  alertMeta: { fontSize: 12, color: '#5a7a9a', marginTop: 2 },
  alertDays: { textAlign: 'center', marginLeft: 12 },
  alertDaysNum: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 28, color: '#ff4444', lineHeight: 1 },
  alertDaysLabel: { fontSize: 9, color: '#ff4444', letterSpacing: 1, textTransform: 'uppercase' },
  alertMore: { fontSize: 12, color: '#5a7a9a', textAlign: 'center', paddingTop: 4 },

  // Metrics
  metricsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 },
  metricCard: { background: 'rgba(13,27,62,0.6)', border: '1px solid #1a2b8c', borderRadius: 12, padding: '16px 14px', textAlign: 'center' },
  metricValue: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 36, lineHeight: 1 },
  metricLabel: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, letterSpacing: 2, color: '#5a7a9a', marginTop: 4, textTransform: 'uppercase' },

  // Section
  section: { marginBottom: 20 },
  sectionTitle: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, letterSpacing: 2.5, color: '#5a7a9a', padding: '8px 0', borderBottom: '1px solid #0d1b3e', marginBottom: 10, textTransform: 'uppercase' },
  emptyText: { fontSize: 14, color: '#3a5a7a', padding: '20px 0', textAlign: 'center', fontStyle: 'italic' },

  // Tech group
  techGroup: { marginBottom: 16 },
  techHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '4px 0' },
  techDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  techName: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: 'white', letterSpacing: 1 },
  techCount: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#5a7a9a', marginLeft: 'auto' },

  // Schedule card
  scheduleCard: { display: 'flex', gap: 12, padding: '10px 12px', background: 'rgba(13,27,62,0.4)', borderRadius: 10, marginBottom: 4, border: '1px solid #0d1b3e' },
  schedTime: { fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: '#4a90d9', minWidth: 70, paddingTop: 2 },
  schedInfo: { flex: 1 },
  schedCustomer: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: 'white', letterSpacing: 0.3 },
  schedDetail: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' },
  schedTag: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, padding: '1px 5px', borderRadius: 3, border: '1px solid', letterSpacing: 0.5 },
  schedAddr: { fontSize: 12, color: '#5a7a9a' },

  // Pipeline
  pipeCard: { padding: '10px 12px', background: 'rgba(13,27,62,0.4)', borderRadius: 10, marginBottom: 4, border: '1px solid #0d1b3e', borderLeft: '3px solid #f6bf26' },
  pipeCustomer: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: 'white' },
  pipeMeta: { fontSize: 12, color: '#5a7a9a', marginTop: 2 },
};
