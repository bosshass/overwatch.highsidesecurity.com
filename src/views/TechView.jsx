// Overwatch V3 - Tech View
// Field techs see their assigned jobs from Google Calendar
// No Supabase. Calendar is source of truth.

import { useState, useEffect, useCallback } from 'react';
import { SYNC_CALENDARS, TECH_COLORS } from '../config/calendars.js';
import { fetchAllCalendars } from '../services/calendarApi.js';
import { parseEvent, filterToday } from '../services/eventParser.js';

export default function TechView({ accessToken, userEmail, defaultCalendar, userName }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('today'); // today | week
  const [expanded, setExpanded] = useState(null);

  const loadEvents = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      // Filter calendars — tech sees only their calendar + service queue
      const techCalendars = SYNC_CALENDARS.filter(c => {
        if (defaultCalendar && c.name === defaultCalendar) return true;
        if (c.type === 'queue') return true;
        return false;
      });

      const raw = await fetchAllCalendars(accessToken, techCalendars, weekStart, weekEnd);
      const parsed = raw.map(e => parseEvent(e, e._calendarName, e._calendarType));
      setEvents(parsed);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        setError('Session expired — sign out and back in');
      } else {
        setError('Failed to load calendar');
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, defaultCalendar]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(loadEvents, 120000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  const todayEvents = filterToday(events);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const formatTime = (d) => {
    if (!d) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatDate = (d) => {
    if (!d) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const displayEvents = tab === 'today' ? todayEvents : events;

  return (
    <div style={{ padding: '12px', maxWidth: '600px', margin: '0 auto' }}>
      {/* Greeting */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '20px', fontWeight: '700', color: '#e2e8f0' }}>
          {getGreeting()}, {userName}
        </div>
        <div style={{ color: '#64748b', fontSize: '13px', marginTop: '2px' }}>
          {formatDate(new Date())} · {todayEvents.length} job{todayEvents.length !== 1 ? 's' : ''} today
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #334155', marginBottom: '16px' }}>
        {[
          { key: 'today', label: `📋 Today (${todayEvents.length})` },
          { key: 'week', label: `📅 This Week (${events.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '10px', background: tab === t.key ? '#00c8e815' : 'transparent',
              border: 'none', color: tab === t.key ? '#00c8e8' : '#64748b',
              fontSize: '13px', fontWeight: tab === t.key ? '700' : '400', cursor: 'pointer',
              borderBottom: tab === t.key ? '2px solid #00c8e8' : '2px solid transparent',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
          Loading calendar...
        </div>
      )}

      {error && (
        <div style={{ background: '#7f1d1d', borderRadius: '10px', padding: '16px', marginBottom: '12px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && displayEvents.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🛡️</div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#94a3b8', marginBottom: '4px' }}>
            {tab === 'today' ? 'No jobs scheduled for today' : 'No jobs this week'}
          </div>
          <div style={{ fontSize: '13px' }}>Check in with the office if you're expecting work.</div>
        </div>
      )}

      {/* Job Cards */}
      {!loading && displayEvents.map((ev, i) => {
        const isToday = ev.start && ev.start >= today && ev.start < new Date(today.getTime() + 86400000);
        const color = TECH_COLORS[ev.calendarName] || '#64748b';
        const isExpanded = expanded === ev.id;

        return (
          <div
            key={ev.id || i}
            onClick={() => setExpanded(isExpanded ? null : ev.id)}
            style={{
              background: '#1e293b', borderRadius: '12px', padding: '14px 16px',
              marginBottom: '10px', cursor: 'pointer',
              borderLeft: `4px solid ${color}`,
              opacity: !isToday && tab === 'week' ? 0.7 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#e2e8f0', marginBottom: '4px' }}>
                  {ev.customerName}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {ev.start && !ev.isAllDay && (
                    <span style={{ color: '#00c8e8', fontSize: '13px', fontWeight: '600' }}>
                      {formatTime(ev.start)}
                    </span>
                  )}
                  {ev.isAllDay && (
                    <span style={{ color: '#f59e0b', fontSize: '12px' }}>All day</span>
                  )}
                  {tab === 'week' && ev.start && (
                    <span style={{ color: '#64748b', fontSize: '12px' }}>{formatDate(ev.start)}</span>
                  )}
                </div>
              </div>
              <div style={{
                background: `${color}20`, color: color, padding: '3px 8px',
                borderRadius: '6px', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap'
              }}>
                {ev.calendarName}
              </div>
            </div>

            {/* Address */}
            {ev.address && (
              <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '6px' }}>
                📍 {ev.address}
              </div>
            )}

            {/* Expanded details */}
            {isExpanded && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #334155' }}>
                {ev.description && (
                  <div style={{ color: '#94a3b8', fontSize: '12px', whiteSpace: 'pre-wrap', marginBottom: '8px', lineHeight: '1.5' }}>
                    {ev.description}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#475569', fontSize: '11px' }}>Status: {ev.status}</span>
                  {ev.ageDays > 0 && <span style={{ color: '#475569', fontSize: '11px' }}>· {ev.ageDays}d old</span>}
                </div>
                {ev.address && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(ev.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'inline-block', marginTop: '8px', background: '#334155',
                      color: '#00c8e8', padding: '8px 14px', borderRadius: '8px',
                      fontSize: '12px', fontWeight: '600', textDecoration: 'none'
                    }}
                  >
                    🗺️ Open in Maps
                  </a>
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
        >
          🔄 Refresh
        </button>
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
