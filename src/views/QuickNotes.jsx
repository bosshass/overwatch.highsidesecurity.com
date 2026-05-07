// ============================================
// Quick Notes — Admin Notes / Sales & Acct / Shana calendars
// ============================================
// Events in these three calendars are quick captures.
// They can be: viewed, annotated, marked done, or promoted to a schedulable job.

import { useState, useEffect, useCallback } from 'react';
import { CALENDARS } from '../config/calendars.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

const SOURCES = [
  { id: CALENDARS.ADMIN_NOTES,      name: 'Admin Notes',   color: '#ec4899', emoji: '📝' },
  { id: CALENDARS.SALES_ACCOUNTING, name: 'Sales & Acct',  color: '#8b5cf6', emoji: '💼' },
  { id: CALENDARS.SHANA,            name: 'Shana',         color: '#f59e0b', emoji: '👤' },
];

const DONE_MARKER = '[DONE]';

function stripDone(t) { return (t || '').replace(/\s*\[DONE\]/gi, '').trim(); }

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.floor((today - new Date(d.toDateString())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff <= 6) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function FilterChip({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 20, flexShrink: 0, whiteSpace: 'nowrap',
      border: `1px solid ${active ? color : '#334155'}`,
      background: active ? `${color}20` : '#1e293b',
      color: active ? color : '#64748b',
      fontSize: 12, fontWeight: 600, cursor: 'pointer',
    }}>{children}</button>
  );
}

export default function QuickNotes({ accessToken, onBack }) {
  const [notes, setNotes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState('all');
  const [showDone, setShowDone]     = useState(false);
  const [expanded, setExpanded]     = useState(null);
  const [addingNote, setAddingNote] = useState(null);
  const [noteText, setNoteText]     = useState('');
  const [acting, setActing]         = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [cTitle, setCTitle]       = useState('');
  const [cCal, setCCal]           = useState(SOURCES[0].id);
  const [cNotes, setCNotes]       = useState('');
  const [cDate, setCDate]         = useState('');
  const [creating, setCreating]   = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const tMin = new Date(); tMin.setDate(tMin.getDate() - 90);
    const tMax = new Date(); tMax.setDate(tMax.getDate() + 60);
    const params = new URLSearchParams({
      timeMin: tMin.toISOString(), timeMax: tMax.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '200',
    });

    const results = await Promise.all(SOURCES.map(async src => {
      try {
        const res = await fetch(
          `${GCAL}/calendars/${encodeURIComponent(src.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.items || [])
          .filter(ev => ev.status !== 'cancelled' && ev.summary?.trim())
          .map(ev => ({
            id: ev.id,
            calendarId: src.id,
            calendarName: src.name,
            calendarColor: src.color,
            calendarEmoji: src.emoji,
            title: ev.summary || '',
            description: ev.description || '',
            start: ev.start?.dateTime || ev.start?.date || '',
            isDone: (ev.summary || '').toUpperCase().includes(DONE_MARKER),
          }));
      } catch { return []; }
    }));

    setNotes(
      results.flat().sort((a, b) => new Date(b.start) - new Date(a.start))
    );
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const patch = (note, updates) =>
    fetch(`${GCAL}/calendars/${encodeURIComponent(note.calendarId)}/events/${note.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

  const markDone = async (note) => {
    setActing(note.id);
    try {
      await patch(note, { summary: `${DONE_MARKER} ${stripDone(note.title)}` });
      setNotes(prev => prev.map(n =>
        n.id === note.id ? { ...n, isDone: true, title: `${DONE_MARKER} ${stripDone(note.title)}` } : n
      ));
      setExpanded(null);
    } catch (e) { alert('Error: ' + e.message); }
    setActing(null);
  };

  const saveNote = async (note) => {
    if (!noteText.trim()) return;
    setActing(note.id);
    const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const newDesc = note.description
      ? `${note.description}\n\n─── ${ts} ───\n${noteText.trim()}`
      : `─── ${ts} ───\n${noteText.trim()}`;
    try {
      await patch(note, { description: newDesc });
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, description: newDesc } : n));
      setNoteText('');
      setAddingNote(null);
    } catch (e) { alert('Error: ' + e.message); }
    setActing(null);
  };

  const makeJob = async (note) => {
    if (!window.confirm(`Move "${stripDone(note.title)}" to the scheduling queue?`)) return;
    setActing(note.id);
    try {
      const dateStr = note.start
        ? new Date(note.start).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      const isDateTime = note.start?.includes('T');
      await fetch(
        `${GCAL}/calendars/${encodeURIComponent(CALENDARS.TENTATIVELY_SCHEDULED)}/events`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: stripDone(note.title),
            description: note.description || '',
            start: isDateTime
              ? { dateTime: note.start, timeZone: 'America/Denver' }
              : { date: dateStr },
            end: isDateTime
              ? { dateTime: new Date(new Date(note.start).getTime() + 2 * 3600000).toISOString(), timeZone: 'America/Denver' }
              : { date: dateStr },
          }),
        }
      );
      // Archive the original
      await patch(note, { summary: `${DONE_MARKER} ${stripDone(note.title)}` });
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, isDone: true } : n));
      setExpanded(null);
    } catch (e) { alert('Error: ' + e.message); }
    setActing(null);
  };

  const createNote = async () => {
    if (!cTitle.trim()) return;
    setCreating(true);
    try {
      const dateStr = cDate || new Date().toISOString().split('T')[0];
      await fetch(
        `${GCAL}/calendars/${encodeURIComponent(cCal)}/events`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: cTitle.trim(),
            description: cNotes.trim() || '',
            start: { date: dateStr },
            end:   { date: dateStr },
          }),
        }
      );
      setCTitle(''); setCNotes(''); setCDate('');
      setShowCreate(false);
      await load();
    } catch (e) { alert('Error: ' + e.message); }
    setCreating(false);
  };

  const visible = notes.filter(n => {
    if (!showDone && n.isDone) return false;
    if (filter !== 'all' && n.calendarId !== filter) return false;
    return true;
  });

  const doneCount = notes.filter(n => n.isDone).length;

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 16px', borderBottom: '1px solid #1e293b',
        background: '#0f1729', position: 'sticky', top: 0, zIndex: 20
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>← Home</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16 }}>⚡ Quick Notes</span>
          <span style={{ background: '#1e293b', color: '#94a3b8', borderRadius: 8, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
            {visible.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {doneCount > 0 && (
            <button onClick={() => setShowDone(v => !v)} style={{
              background: 'none', border: '1px solid #334155', borderRadius: 6,
              color: showDone ? '#22c55e' : '#475569', padding: '4px 8px', fontSize: 11, cursor: 'pointer'
            }}>
              {showDone ? `✓ Hide Done` : `Done (${doneCount})`}
            </button>
          )}
          <button onClick={load} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer' }}>↺</button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', overflowX: 'auto', borderBottom: '1px solid #1e293b', WebkitOverflowScrolling: 'touch' }}>
        <FilterChip active={filter === 'all'} color="#94a3b8" onClick={() => setFilter('all')}>All</FilterChip>
        {SOURCES.map(s => (
          <FilterChip key={s.id} active={filter === s.id} color={s.color} onClick={() => setFilter(s.id)}>
            {s.emoji} {s.name}
          </FilterChip>
        ))}
      </div>

      {/* Notes list */}
      <div style={{ padding: '12px 16px 96px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ textAlign: 'center', padding: 48, color: '#475569' }}>Loading…</div>}

        {!loading && visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#334155', fontSize: 14 }}>
            No notes — tap <strong style={{ color: '#00c8e8' }}>+</strong> to create one
          </div>
        )}

        {visible.map(note => {
          const isExpanded  = expanded === note.id;
          const isAdding    = addingNote === note.id;
          const isBusy      = acting === note.id;
          const src         = SOURCES.find(s => s.id === note.calendarId);

          return (
            <div key={note.id} style={{
              background: '#1a1a2e', borderRadius: 12,
              borderLeft: `4px solid ${note.isDone ? '#1e293b' : note.calendarColor}`,
              opacity: note.isDone ? 0.55 : 1,
            }}>
              {/* Card header — always visible */}
              <div onClick={() => setExpanded(isExpanded ? null : note.id)} style={{ padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{
                        background: `${note.calendarColor}20`, color: note.calendarColor,
                        border: `1px solid ${note.calendarColor}40`, borderRadius: 5,
                        padding: '1px 7px', fontSize: 10, fontWeight: 700, flexShrink: 0
                      }}>
                        {note.calendarEmoji} {note.calendarName}
                      </span>
                      {note.isDone && (
                        <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700 }}>✓ DONE</span>
                      )}
                    </div>
                    <div style={{ color: note.isDone ? '#475569' : '#e2e8f0', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
                      {stripDone(note.title)}
                    </div>
                    <div style={{ color: '#475569', fontSize: 11, marginTop: 3 }}>{formatDate(note.start)}</div>
                    {!isExpanded && note.description && (
                      <div style={{ color: '#334155', fontSize: 12, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {note.description.split('\n')[0]}
                      </div>
                    )}
                  </div>
                  <span style={{ color: '#334155', fontSize: 14, flexShrink: 0, marginTop: 2 }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {/* Expanded body */}
              {isExpanded && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid #0f172a' }}>

                  {/* Existing description */}
                  {note.description && (
                    <div style={{
                      background: '#0f172a', borderRadius: 8, padding: '10px 12px',
                      margin: '12px 0 12px', whiteSpace: 'pre-wrap',
                      color: '#94a3b8', fontSize: 13, lineHeight: 1.6
                    }}>
                      {note.description}
                    </div>
                  )}

                  {/* Add-note textarea */}
                  {isAdding && (
                    <div style={{ marginBottom: 12 }}>
                      <textarea
                        autoFocus
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        placeholder="Add a note…"
                        rows={3}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          background: '#0f172a', border: '1px solid #334155',
                          borderRadius: 8, color: '#e2e8f0', fontSize: 13,
                          padding: 10, resize: 'vertical', fontFamily: 'inherit', outline: 'none'
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button
                          onClick={() => saveNote(note)}
                          disabled={isBusy || !noteText.trim()}
                          style={{ flex: 1, padding: 8, background: '#1e3a5f', border: '1px solid #3b82f660', borderRadius: 8, color: '#60a5fa', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                        >{isBusy ? '…' : 'Save Note'}</button>
                        <button
                          onClick={() => { setAddingNote(null); setNoteText(''); }}
                          style={{ padding: '8px 12px', background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#475569', fontSize: 12, cursor: 'pointer' }}
                        >Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  {!note.isDone && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => { setAddingNote(isAdding ? null : note.id); setNoteText(''); }}
                        style={{ flex: 1, padding: '9px 6px', minWidth: 80, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >✏️ Note</button>
                      <button
                        onClick={() => makeJob(note)}
                        disabled={isBusy}
                        style={{ flex: 1, padding: '9px 6px', minWidth: 80, background: '#0c2340', border: '1px solid #3b82f640', borderRadius: 8, color: '#60a5fa', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >{isBusy ? '…' : '📅 Make Job'}</button>
                      <button
                        onClick={() => markDone(note)}
                        disabled={isBusy}
                        style={{ flex: 1, padding: '9px 6px', minWidth: 80, background: '#052e16', border: '1px solid #22c55e40', borderRadius: 8, color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >{isBusy ? '…' : '✓ Done'}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating create button */}
      <button
        onClick={() => setShowCreate(true)}
        style={{
          position: 'fixed', bottom: 24, right: 20, zIndex: 50,
          width: 56, height: 56, borderRadius: '50%',
          background: '#00c8e8', border: 'none', color: '#000',
          fontSize: 28, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,200,232,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >+</button>

      {/* Create sheet */}
      {showCreate && (
        <div
          onClick={() => setShowCreate(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', borderRadius: '20px 20px 0 0', padding: '20px 20px 36px', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div style={{ width: 36, height: 4, background: '#334155', borderRadius: 2, margin: '0 auto 18px' }} />
            <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16, marginBottom: 18 }}>New Quick Note</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                autoFocus
                value={cTitle}
                onChange={e => setCTitle(e.target.value)}
                placeholder="What's this note about…"
                style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', fontSize: 14, padding: '12px 14px', outline: 'none', fontFamily: 'inherit' }}
              />

              <div>
                <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Calendar</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {SOURCES.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setCCal(s.id)}
                      style={{
                        flex: 1, padding: '10px 8px', borderRadius: 10,
                        border: `1px solid ${cCal === s.id ? s.color : '#334155'}`,
                        background: cCal === s.id ? `${s.color}20` : '#0f1729',
                        color: cCal === s.id ? s.color : '#64748b',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'center'
                      }}
                    >{s.emoji} {s.name}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Date (optional)</div>
                <input
                  type="date"
                  value={cDate}
                  onChange={e => setCDate(e.target.value)}
                  style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', fontSize: 14, padding: '10px 14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Notes</div>
                <textarea
                  value={cNotes}
                  onChange={e => setCNotes(e.target.value)}
                  placeholder="Details, context, follow-up needed…"
                  rows={4}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#0f1729', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', fontSize: 14, padding: '10px 14px', resize: 'none', fontFamily: 'inherit', outline: 'none' }}
                />
              </div>

              <button
                onClick={createNote}
                disabled={creating || !cTitle.trim()}
                style={{
                  padding: 14, borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700,
                  background: cTitle.trim() ? '#00c8e8' : '#1e293b',
                  color: cTitle.trim() ? '#000' : '#475569',
                  cursor: cTitle.trim() ? 'pointer' : 'not-allowed'
                }}
              >{creating ? 'Saving…' : 'Create Note'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
