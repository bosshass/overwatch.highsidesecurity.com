// ============================================
// JUC-E V4 - NotesPanel Component
// ============================================
// Embeddable anywhere. Shows notes + quick add.
// Used in: JobDetail, JobCard expanded, everywhere.

import { useState, useEffect, useCallback } from 'react';
import { notesApi, STATUS_INFO } from '../services/supabase.js';
import { appendNoteToJobEvents } from '../services/calendarSync.js';

export default function NotesPanel({ jobId, userEmail, job = null, accessToken = null, compact = false, maxNotes = null }) {
  const [notes, setNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [expanded, setExpanded] = useState(!compact);

  const loadNotes = useCallback(async () => {
    if (!jobId) return;
    setIsLoading(true);
    try {
      const data = await notesApi.getAllForJob(jobId);
      setNotes(data);
    } catch (e) {
      console.error('Notes load error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const handleAddNote = async () => {
    if (!newNote.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await notesApi.addNote(jobId, newNote.trim(), userEmail);
      // Mirror the note onto the linked Google Calendar event(s). Non-fatal:
      // the note is already saved; a calendar failure must not block the UI.
      if (job && accessToken) {
        try { await appendNoteToJobEvents(accessToken, job, newNote.trim(), userEmail); }
        catch (e) { console.warn('Calendar note sync failed (non-fatal):', e); }
      }
      setNewNote('');
      await loadNotes();
    } catch (e) {
      console.error('Note save error:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditSave = async (note) => {
    if (!editText.trim()) return;
    try {
      if (note.source === 'completion') {
        await notesApi.editCompletionNotes(jobId, editText.trim(), userEmail);
      } else {
        await notesApi.editHistoryNote(note.id, editText.trim());
      }
      setEditingId(null);
      await loadNotes();
    } catch (e) {
      console.error('Edit save error:', e);
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  };

  const formatAuthor = (email) => {
    if (!email) return '';
    const names = {
      'drhservicetech1@gmail.com': 'Austin',
      'austin@drhsecurityservices.com': 'Austin',
      'jr@drhsecurityservices.com': 'JR',
      'info@drhsecurityservices.com': 'Sara',
      'sara@jnbllc.com': 'Sara',
      'shanaparks@drhsecurityservices.com': 'Shana',
    };
    return names[email?.toLowerCase()] || email.split('@')[0];
  };

  const displayNotes = maxNotes ? notes.slice(0, maxNotes) : notes;

  // Compact mode: just show note count + quick add
  if (compact && !expanded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: 'none', border: '1px solid #334155', borderRadius: '6px',
            color: notes.length > 0 ? '#00c8e8' : '#64748b',
            padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}
        >
          📝 {notes.length > 0 ? `${notes.length} note${notes.length > 1 ? 's' : ''}` : 'Add note'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: '#1a2332', borderRadius: '10px', padding: '12px', border: '1px solid #1e293b' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Notes ({notes.length})
        </span>
        {compact && (
          <button
            onClick={() => setExpanded(false)}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '14px', cursor: 'pointer' }}
          >
            ×
          </button>
        )}
      </div>

      {/* Quick add */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: notes.length > 0 ? '10px' : '0' }}>
        <input
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddNote()}
          placeholder="Add a note..."
          style={{
            flex: 1, background: '#0f1729', border: '1px solid #334155', borderRadius: '8px',
            color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', outline: 'none'
          }}
        />
        <button
          onClick={handleAddNote}
          disabled={!newNote.trim() || isSaving}
          style={{
            background: newNote.trim() ? '#00c8e8' : '#334155',
            color: newNote.trim() ? '#000' : '#64748b',
            border: 'none', borderRadius: '8px', padding: '8px 14px',
            fontSize: '13px', fontWeight: '600', cursor: newNote.trim() ? 'pointer' : 'default',
            opacity: isSaving ? 0.5 : 1
          }}
        >
          {isSaving ? '...' : '+'}
        </button>
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', padding: '8px' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {displayNotes.map(note => (
            <div key={note.id} style={{
              background: '#0f1729', borderRadius: '8px', padding: '8px 10px',
              border: note.from_status !== note.to_status ? '1px solid #334155' : '1px solid transparent'
            }}>
              {/* Status change indicator */}
              {note.from_status && note.to_status && note.from_status !== note.to_status && (
                <div style={{ fontSize: '10px', color: '#475569', marginBottom: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{ color: STATUS_INFO[note.from_status]?.color }}>{STATUS_INFO[note.from_status]?.label}</span>
                  <span>→</span>
                  <span style={{ color: STATUS_INFO[note.to_status]?.color }}>{STATUS_INFO[note.to_status]?.label}</span>
                </div>
              )}

              {editingId === note.id ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleEditSave(note)}
                    style={{
                      flex: 1, background: '#1a2332', border: '1px solid #00c8e8', borderRadius: '6px',
                      color: '#e2e8f0', padding: '6px 8px', fontSize: '12px', outline: 'none'
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => handleEditSave(note)}
                    style={{ background: '#00c8e8', color: '#000', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: '600' }}
                  >✓</button>
                  <button
                    onClick={() => setEditingId(null)}
                    style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                  >×</button>
                </div>
              ) : (
                <>
                  <div style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: '1.4' }}>{note.text}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    <span style={{ color: '#475569', fontSize: '11px' }}>
                      {formatAuthor(note.created_by)} · {formatTime(note.created_at)}
                    </span>
                    {note.editable && (
                      <button
                        onClick={() => { setEditingId(note.id); setEditText(note.text); }}
                        style={{ background: 'none', border: 'none', color: '#475569', fontSize: '11px', cursor: 'pointer' }}
                      >
                        edit
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
          {maxNotes && notes.length > maxNotes && (
            <div style={{ color: '#475569', fontSize: '11px', textAlign: 'center', padding: '4px' }}>
              +{notes.length - maxNotes} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
