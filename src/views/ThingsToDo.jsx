// ============================================
// JUC-E — Things To Do Board
// ============================================
// 3 columns: Need to Do | In Progress | Past Due
// Items come from juce_things_to_do in localStorage
// Assign → deletes from Google Calendar
// Mark Ready → creates in TENTATIVELY_SCHEDULED → shows in board Ready column

import { useState, useEffect, useCallback } from 'react';
import { techsApi } from '../services/supabase.js';
import { TECH_COLORS, CALENDARS } from '../config/calendars.js';

const STORAGE_KEY = 'juce_things_to_do';

const isOverdue = (item) => {
  const now = new Date();
  // Condition 1: original event date has passed
  if (item.date) {
    const eventDate = new Date(item.date);
    eventDate.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (eventDate < today) return true;
  }
  // Condition 2: sitting in Things To Do for 3+ days
  if (item.created_at) {
    const cutoff = new Date(new Date(item.created_at).getTime() + 3 * 24 * 60 * 60 * 1000);
    if (now > cutoff) return true;
  }
  return false;
};

const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const formatAdded = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ThingsToDo({ accessToken, userEmail, onBack }) {
  const [items, setItems] = useState([]);
  const [techs, setTechs] = useState([]);
  const [working, setWorking] = useState(null); // item id being actioned
  const [assignPicker, setAssignPicker] = useState(null); // item id showing assign picker

  const load = useCallback(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      setItems(raw);
    } catch { setItems([]); }
  }, []);

  const save = (updated) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setItems(updated);
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => { techsApi.getAll().then(setTechs).catch(() => {}); }, []);

  // Assign to tech → delete from Google Calendar if not already deleted
  const assignItem = async (item, techName) => {
    setWorking(item.id);
    setAssignPicker(null);

    let deletedFromCal = item.deletedFromCal || false;
    if (!deletedFromCal && item.sourceCalendarId && item.sourceEventId && accessToken) {
      try {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(item.sourceCalendarId)}/events/${item.sourceEventId}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
        );
        deletedFromCal = true;
      } catch (e) { console.warn('Delete from GCal failed:', e); }
    }

    const updated = items.map(i =>
      i.id === item.id
        ? { ...i, assignedTo: techName, deletedFromCal, status: 'inprogress' }
        : i
    );
    save(updated);
    setWorking(null);
  };

  // Unassign → does NOT restore to calendar
  const unassignItem = (item) => {
    const updated = items.map(i =>
      i.id === item.id ? { ...i, assignedTo: null, status: 'todo' } : i
    );
    save(updated);
  };

  // Mark Ready → creates in TENTATIVELY_SCHEDULED (no deep link) → shows in board 1 Ready column
  const markReady = async (item) => {
    setWorking(item.id);
    if (accessToken) {
      try {
        const startDate = item.date
          ? new Date(item.date).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDARS.TENTATIVELY_SCHEDULED)}/events`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary: item.title,
              location: item.location || '',
              description: item.description || '',
              start: item.date?.includes('T')
                ? { dateTime: item.date, timeZone: 'America/Denver' }
                : { date: startDate },
              end: item.date?.includes('T')
                ? { dateTime: new Date(new Date(item.date).getTime() + 2 * 60 * 60 * 1000).toISOString(), timeZone: 'America/Denver' }
                : { date: startDate },
            })
          }
        );
      } catch (e) { console.warn('Create in TENTATIVELY_SCHEDULED failed:', e); }
    }
    const updated = items.filter(i => i.id !== item.id);
    save(updated);
    setWorking(null);
  };

  // Remove entirely
  const removeItem = (item) => {
    const updated = items.filter(i => i.id !== item.id);
    save(updated);
  };

  // Sort into columns
  const overdue    = items.filter(i => isOverdue(i));
  const inProgress = items.filter(i => !isOverdue(i) && i.assignedTo);
  const needToDo   = items.filter(i => !isOverdue(i) && !i.assignedTo);

  const COLS = [
    { key: 'todo',       label: '📋 Need to Do',  color: '#3b82f6', items: needToDo   },
    { key: 'inprogress', label: '⚡ In Progress',  color: '#f59e0b', items: inProgress },
    { key: 'pastdue',    label: '🔴 Past Due',     color: '#ef4444', items: overdue    },
  ];

  const Card = ({ item }) => {
    const techColor = item.assignedTo ? (TECH_COLORS[item.assignedTo] || '#64748b') : null;
    const overdue = isOverdue(item);
    const isWorking = working === item.id;
    const showPicker = assignPicker === item.id;

    return (
      <div style={{
        background: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 10,
        borderLeft: `4px solid ${overdue ? '#ef4444' : techColor || '#334155'}`,
        opacity: isWorking ? 0.6 : 1, position: 'relative'
      }}>
        {/* Title */}
        <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>
          {item.title}
        </div>

        {/* ASSIGNED TO — highly visible */}
        {item.assignedTo ? (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${techColor}25`, border: `1px solid ${techColor}60`,
            borderRadius: 8, padding: '5px 10px', marginBottom: 8
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: techColor }} />
            <span style={{ color: techColor, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {item.assignedTo}
            </span>
          </div>
        ) : (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#334155', border: '1px solid #475569',
            borderRadius: 8, padding: '5px 10px', marginBottom: 8
          }}>
            <span style={{ color: '#64748b', fontSize: 12, fontWeight: 600 }}>⚠ UNASSIGNED</span>
          </div>
        )}

        {/* Meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
          {item.date && (
            <div style={{ color: overdue ? '#ef4444' : '#3b82f6', fontSize: 11, fontWeight: 600 }}>
              📅 {formatDate(item.date)}{overdue ? ' — OVERDUE' : ''}
            </div>
          )}
          {item.location && (
            <div style={{ color: '#64748b', fontSize: 11 }}>📍 {item.location}</div>
          )}
          {item.calendarName && (
            <div style={{ color: '#475569', fontSize: 11 }}>From: {item.calendarName}</div>
          )}
          <div style={{ color: '#334155', fontSize: 10 }}>Added {formatAdded(item.created_at)}</div>
        </div>

        {/* Assign picker */}
        {showPicker && (
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8, fontWeight: 600 }}>ASSIGN TO</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {techs.map(t => (
                <button key={t.id} onClick={() => assignItem(item, t.name)} style={{
                  padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: TECH_COLORS[t.name] || '#475569', color: '#fff',
                  fontSize: 12, fontWeight: 700
                }}>{t.name}</button>
              ))}
            </div>
            <button onClick={() => setAssignPicker(null)} style={{ marginTop: 8, background: 'none', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!item.assignedTo && (
            <button onClick={() => setAssignPicker(showPicker ? null : item.id)} style={{
              flex: 1, padding: '8px', background: '#1e3a5f', border: '1px solid #3b82f660',
              borderRadius: 8, color: '#3b82f6', fontSize: 11, fontWeight: 700, cursor: 'pointer'
            }}>👤 Assign</button>
          )}
          {item.assignedTo && (
            <button onClick={() => unassignItem(item)} style={{
              padding: '8px 10px', background: '#1e293b', border: '1px solid #334155',
              borderRadius: 8, color: '#64748b', fontSize: 11, cursor: 'pointer'
            }}>✕ Unassign</button>
          )}
          <button onClick={() => markReady(item)} disabled={isWorking} style={{
            flex: 1, padding: '8px', background: '#22c55e20', border: '1px solid #22c55e40',
            borderRadius: 8, color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer'
          }}>
            {isWorking ? '…' : '→ Mark Ready'}
          </button>
          <button onClick={() => removeItem(item)} style={{
            padding: '8px 10px', background: 'none', border: '1px solid #334155',
            borderRadius: 8, color: '#475569', fontSize: 11, cursor: 'pointer'
          }}>🗑</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1729', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #1e293b', background: '#0f1729', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>← Home</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16 }}>✅ Things To Do</span>
          <span style={{ background: '#f59e0b', color: '#000', padding: '1px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>{items.length}</span>
        </div>
        <button onClick={load} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 13, cursor: 'pointer' }}>↺</button>
      </div>

      {/* 3-column board */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 12, padding: 12, WebkitOverflowScrolling: 'touch' }}>
        {COLS.map(col => (
          <div key={col.key} style={{ minWidth: 280, maxWidth: 320, flex: '0 0 280px', display: 'flex', flexDirection: 'column' }}>
            {/* Column header */}
            <div style={{ background: `${col.color}20`, borderRadius: '10px 10px 0 0', padding: '10px 14px', borderBottom: `2px solid ${col.color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700 }}>{col.label}</span>
              <span style={{ background: col.color, color: '#fff', padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                {col.items.length}
              </span>
            </div>
            {/* Column body */}
            <div style={{ background: '#0f172a', borderRadius: '0 0 10px 10px', flex: 1, overflowY: 'auto', padding: 8 }}>
              {col.items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#334155', fontSize: 12 }}>
                  {col.key === 'todo' ? 'Nothing to do 🎉' : col.key === 'inprogress' ? 'Nothing in progress' : 'Nothing overdue ✓'}
                </div>
              ) : (
                col.items.map(item => <Card key={item.id} item={item} />)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
