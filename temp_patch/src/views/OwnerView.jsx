// Overwatch V3 - Owner View
// JR sees all calendars, pipeline counts, today's schedule across all techs
// No Supabase. Calendar is source of truth.

import { useState, useEffect, useCallback } from 'react';
import { SYNC_CALENDARS, TECH_COLORS } from '../config/calendars.js';
import { fetchAllCalendars } from '../services/calendarApi.js';
import { parseEvent, groupByCalendar, filterToday } from '../services/eventParser.js';

export default function OwnerView({ accessToken, userName }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCal, setSelectedCal] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [timeRange, setTimeRange] = useState('today'); // today | week | month

  const loadEvents = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);

      if (timeRange === 'today') end.setDate(end.getDate() + 1);
      else if (timeRange === 'week') end.setDate(end.getDate() + 7);
      else end.setMonth(end.getMonth() + 1);

      // Exclude admin calendar from owner view
      const ownerCalendars = SYNC_CALENDARS.filter(c => c.type !== 'admin');

      const raw = await fetchAllCalendars(accessToken, ownerCalendars, start, end);
      const parsed = raw.map(e => parseEvent(e, e._calendarName, e._calendarType));
      setEvents(parsed);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        setError('Session expired — sign out and back in');
      } else {
        setError('Failed to load calendars');
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, timeRange]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  useEffect(() => {
    const interval = setInterval(loadEvents, 120000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  const grouped = groupByCalendar(events);
  const todayEvents = filterToday(events);
  const filteredEvents = selectedCal ? events.filter(e => e.calendarName === selectedCal) : events;

  // Pipeline counts
  const pipeline = {};
  for (const ev of events) {
    const cal = ev.calendarName;
    pipeline[cal] = (pipeline[cal] || 0) + 1;
  }

  const formatTime = (d) => d?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) || '';
  const formatDate = (d) => d?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) || '';

  return (
    <div style={{ padding: '12px', maxWidth: '700px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '20px', fontWeight: '700', color: '#e2e8f0' }}>
          {getGreeting()}, {userName}
        </div>
        <div style={{ color: '#64748b', fontSize: '13px', marginTop: '2px' }}>
          {formatDate(new Date())} · {todayEvents.length} event{todayEvents.length !== 1 ? 's' : ''} today · {events.length} total
        </div>
      </div>

      {/* Time range toggle */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[
          { key: 'today', label: 'Today' },
          { key: 'week', label: 'This Week' },
          { key: 'month', label: 'This Month' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTimeRange(t.key); setSelectedCal(null); }}
            style={{
              padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
              border: 'none', cursor: 'pointer',
              background: timeRange === t.key ? '#00c8e8' : '#1e293b',
              color: timeRange === t.key ? '#000' : '#94a3b8',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Pipeline chips */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <button
          onClick={() => setSelectedCal(null)}
          style={{
            padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
            border: `1px solid ${!selectedCal ? '#00c8e8' : '#334155'}`,
            background: !selectedCal ? '#00c8e820' : 'transparent',
            color: !selectedCal ? '#00c8e8' : '#94a3b8', cursor: 'pointer',
          }}
        >All ({events.length})</button>
        {Object.entries(pipeline).sort((a, b) => b[1] - a[1]).map(([cal, count]) => {
          const color = TECH_COLORS[cal] || '#64748b';
          const active = selectedCal === cal;
          return (
            <button
              key={cal}
              onClick={() => setSelectedCal(active ? null : cal)}
              style={{
                padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
                border: `1px solid ${active ? color : '#334155'}`,
                background: active ? `${color}20` : 'transparent',
                color: active ? color : '#94a3b8', cursor: 'pointer',
              }}
            >{cal} ({count})</button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
          Loading calendars...
        </div>
      )}

      {error && (
        <div style={{ background: '#7f1d1d', borderRadius: '10px', padding: '16px', marginBottom: '12px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filteredEvents.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🛡️</div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#94a3b8' }}>
            No events {selectedCal ? `on ${selectedCal}` : ''} for this period
          </div>
        </div>
      )}

      {/* Event list */}
      {!loading && filteredEvents.map((ev, i) => {
        const color = TECH_COLORS[ev.calendarName] || '#64748b';
        const isExpanded = expanded === ev.id;
        const isOld = ev.ageDays > 14;

        return (
          <div
            key={ev.id || i}
            onClick={() => setExpanded(isExpanded ? null : ev.id)}
            style={{
              background: '#1e293b', borderRadius: '12px', padding: '14px 16px',
              marginBottom: '8px', cursor: 'pointer',
              borderLeft: `4px solid ${color}`,
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: isOld ? '#f87171' : '#e2e8f0', marginBottom: '3px' }}>
                  {ev.customerName}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {ev.start && !ev.isAllDay && (
                    <span style={{ color: '#00c8e8', fontSize: '12px', fontWeight: '600' }}>
                      {formatTime(ev.start)}
                    </span>
                  )}
                  {ev.isAllDay && <span style={{ color: '#f59e0b', fontSize: '11px' }}>All day</span>}
                  {timeRange !== 'today' && ev.start && (
                    <span style={{ color: '#64748b', fontSize: '11px' }}>{formatDate(ev.start)}</span>
                  )}
                  {ev.address && <span style={{ color: '#64748b', fontSize: '11px' }}>📍 {ev.address}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <span style={{
                  background: `${color}20`, color, padding: '2px 8px',
                  borderRadius: '6px', fontSize: '10px', fontWeight: '700',
                }}>{ev.calendarName}</span>
                {isOld && (
                  <span style={{ color: '#f87171', fontSize: '10px' }}>{ev.ageDays}d old ⚠️</span>
                )}
              </div>
            </div>

            {isExpanded && (
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #334155' }}>
                {ev.description && (
                  <div style={{ color: '#94a3b8', fontSize: '12px', whiteSpace: 'pre-wrap', marginBottom: '8px', lineHeight: '1.5' }}>
                    {ev.description}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#475569', fontSize: '11px' }}>Status: {ev.status}</span>
                  {ev.start && ev.end && (
                    <span style={{ color: '#475569', fontSize: '11px' }}>
                      · {formatTime(ev.start)} – {formatTime(ev.end)}
                    </span>
                  )}
                </div>
                {ev.address && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(ev.address)}`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'inline-block', marginTop: '8px', background: '#334155',
                      color: '#00c8e8', padding: '6px 12px', borderRadius: '8px',
                      fontSize: '11px', fontWeight: '600', textDecoration: 'none'
                    }}
                  >🗺️ Maps</a>
                )}
                {ev.htmlLink && (
                  <a
                    href={ev.htmlLink}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'inline-block', marginTop: '8px', marginLeft: '6px',
                      background: '#334155', color: '#94a3b8', padding: '6px 12px',
                      borderRadius: '8px', fontSize: '11px', textDecoration: 'none'
                    }}
                  >📅 GCal</a>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Refresh */}
      {!loading && (
        <button
          onClick={loadEvents}
          style={{
            width: '100%', padding: '12px', background: 'transparent',
            border: '1px solid #334155', borderRadius: '10px',
            color: '#64748b', fontSize: '13px', cursor: 'pointer', marginTop: '8px'
          }}
        >🔄 Refresh</button>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
