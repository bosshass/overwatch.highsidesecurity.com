// ============================================
// JUC-E V4 - NotesPanel Component
// ============================================
// Embeddable anywhere. Shows notes + quick add.
// Used in: JobDetail, JobCard expanded, everywhere.

import { useState, useEffect, useCallback } from 'react';
import { notesApi, jobsApi, STATUS_INFO } from '../services/supabase.js';
import { appendNoteToJobEvents } from '../services/calendarSync.js';

export default function NotesPanel({ jobId, userEmail, job = null, accessToken = null, compact = false, maxNotes = null }) {
  const [notes, setNotes] = useState([]);
  const [activity, setActivity] = useState([]);
  const [showActivity, setShowActivity] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [expanded, setExpanded] = useState(!compact);
  // What kind of entry this is when you hit save. 'note' = normal job note
  // (unchanged default behavior). 'response' = same job note, tagged so it
  // reads as a logged response rather than an internal note. 'customer_only'
  // = NOT tied to this job at all — a standalone customer-service touch
  // (a call, a question) with nothing to schedule. That creates its own
  // lightweight job_type:'note' row against the customer, so it never shows
  // up as work on the board, but the customer has a real record of the touch.
  const [noteType, setNoteType] = useState('note');
  const [savingCustomerNote, setSavingCustomerNote] = useState(false);

  const loadNotes = useCallback(async () => {
    if (!jobId) return;
    setIsLoading(true);
    try {
      const data = await notesApi.getAllForJob(jobId);
      // Merge-carried entries (from the Board's merge tool folding a duplicate
      // job's history in) are an audit trail, not something a tech needs
      // cluttering their note feed -- they're still in job_history in the
      // database if ever needed directly.
      // Merge-audit entries are history, not something a tech needs cluttering
      // their note feed. Two formats exist in the wild: the older Board-merge
      // carry-over ("↪ from merged job") and JobDetail's own merge tool
      // ("🔗 MERGED FROM JOB #…" / "[MERGED INTO JOB #…]"). All three, gone
      // from the feed; still in job_history in the database if ever needed.
      const isMergeNoise = (t) => {
        const s = t || '';
        return s.startsWith('↪ from merged job')
            || s.startsWith('🔗 MERGED FROM JOB')
            || s.startsWith('[MERGED INTO JOB');
      };

      // SYSTEM CHATTER. The app writes a history row every time anything is
      // assigned, emailed or moved. Those are an audit trail, not notes — and
      // burying "Technician needs one Elk Wifi Adapter" under four lines of
      // "Assigned to Shana" is how a real note gets missed. They stay in the
      // database and stay visible behind the Activity toggle; they just stop
      // competing with things a person actually wrote.
      const isSystemChatter = (t) => {
        const s = (t || '').trim();
        return /^Assigned to /i.test(s)
            || /^Assignment email sent/i.test(s)
            || /^Unassigned\b/i.test(s)
            || /^Status changed/i.test(s)
            || /^Moved (to|from) /i.test(s)
            || /^Reconciled —/i.test(s)
            || /^Billed( —|$)/i.test(s)
            || /^📌 TENTATIVELY assigned/i.test(s);
      };

      const clean = data.filter(n => !isMergeNoise(n.text));
      setNotes(clean.filter(n => !isSystemChatter(n.text)));
      setActivity(clean.filter(n => isSystemChatter(n.text)));
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
      if (noteType === 'customer_only') {
        // Not tied to THIS job — a standalone customer-service touch. Create
        // a lightweight note-type job against the customer so it has a real
        // home, but it's job_type:'note' so it never shows as work anywhere
        // (the board excludes note/task job_types from its columns).
        if (!job?.customer_id) {
          alert('This job has no linked customer, so there\'s nowhere to file a customer-only note. Add it as a regular note instead.');
          setIsSaving(false);
          return;
        }
        const created = await jobsApi.create({
          customer_id: job.customer_id,
          customer_name: job.customer_name,
          customer_address: job.customer_address || null,
          customer_phone: job.customer_phone || null,
          job_type: 'note',
          status: 'complete',
          issue: newNote.trim().slice(0, 200),
        }, userEmail);
        await notesApi.addNote(created.id, newNote.trim(), userEmail);
      } else {
        const text = noteType === 'response' ? `💬 Response: ${newNote.trim()}` : newNote.trim();
        await notesApi.addNote(jobId, text, userEmail);
        // Mirror the note onto the linked Google Calendar event(s). Non-fatal:
        // the note is already saved; a calendar failure must not block the UI.
        if (job && accessToken) {
          try { await appendNoteToJobEvents(accessToken, job, text, userEmail); }
          catch (e) { console.warn('Calendar note sync failed (non-fatal):', e); }
        }
      }
      setNewNote('');
      setNoteType('note');
      await loadNotes();
    } catch (e) {
      console.error('Note save error:', e);
      alert('Note failed to save: ' + (e.message || e));
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

  // Newest comment always on top — sort explicitly so nothing (e.g. the
  // completion-note entry) floats or sticks regardless of source.
  const ordered = [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const displayNotes = maxNotes ? ordered.slice(0, maxNotes) : ordered;

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
            style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '14px', cursor: 'pointer' }}
          >
            ×
          </button>
        )}
      </div>

      {/* Quick add */}
      {newNote.trim() && (
        <div style={{ display: 'flex', gap: '5px', marginBottom: '6px' }}>
          {[
            { v: 'note', label: '📝 Note' },
            { v: 'response', label: '💬 Response' },
            { v: 'customer_only', label: '🗒️ Customer note (no job)' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setNoteType(opt.v)}
              style={{
                fontSize: '11px', fontWeight: 700, padding: '5px 9px', borderRadius: '14px', cursor: 'pointer',
                border: `1px solid ${noteType === opt.v ? '#00c8e8' : '#334155'}`,
                background: noteType === opt.v ? '#00c8e820' : 'transparent',
                color: noteType === opt.v ? '#00c8e8' : '#94a3b8',
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
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
        <div style={{ color: '#cbd5e1', fontSize: '12px', textAlign: 'center', padding: '8px' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {displayNotes.map(note => (
            <div key={note.id} style={{
              background: '#0f1729', borderRadius: '8px', padding: '8px 10px',
              border: note.from_status !== note.to_status ? '1px solid #334155' : '1px solid transparent'
            }}>
              {/* Status change indicator */}
              {note.from_status && note.to_status && note.from_status !== note.to_status && (
                <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
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
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                      {formatAuthor(note.created_by)} · {formatTime(note.created_at)}
                    </span>
                    {note.editable && (
                      <button
                        onClick={() => { setEditingId(note.id); setEditText(note.text); }}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer' }}
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
            <div style={{ color: '#94a3b8', fontSize: '11px', textAlign: 'center', padding: '4px' }}>
              +{notes.length - maxNotes} more
            </div>
          )}

          {/* Audit trail, collapsed. Still here, just not shouting over notes. */}
          {activity.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowActivity(v => !v)}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px',
                         cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit' }}>
                {showActivity ? '▾' : '▸'} Activity ({activity.length})
              </button>
              {showActivity && activity.map(a => (
                <div key={a.id || a.text}
                  style={{ fontSize: '11px', color: '#64748b', padding: '4px 0 4px 10px',
                           borderLeft: '2px solid #1e293b', lineHeight: 1.4 }}>
                  {a.text}
                  <span style={{ opacity: 0.7 }}> · {formatTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
