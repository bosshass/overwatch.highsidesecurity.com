// ============================================
// JUC-E — Job Completion Modal
// ============================================
// Three outcomes: Good To Go | Gotta Come Back | Potential Project
// Saves outcome + notes + materials to Google Calendar event description.
// No calendar moves — that is a separate decision.

import { useState } from 'react';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const STATUSES = [
  { key: 'done',    label: '✅ Good To Go',        sub: 'No return needed',                                        color: '#22c55e', bg: '#052e16', border: '#16a34a' },
  { key: 'return',  label: '🔄 Gotta Come Back',   sub: "Missing parts or materials — service job, not an upgrade", color: '#f59e0b', bg: '#1c1008', border: '#d97706' },
  { key: 'project', label: '📋 Potential Project',  sub: 'New equipment requested or system too outdated to service', color: '#a78bfa', bg: '#0f0a1e', border: '#7c3aed' },
];

function MaterialsTable({ rows, onChange }) {
  const update = (i, field, val) => onChange(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const addRow = () => onChange([...rows, { item: '', cost: '' }]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 28px', gap: 6, marginBottom: 4 }}>
        <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Item</div>
        <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Internal Cost</div>
        <div />
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 28px', gap: 6, marginBottom: 6 }}>
          <input value={row.item} onChange={e => update(i, 'item', e.target.value)} placeholder="e.g. Motion sensor"
            style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '8px 10px' }} />
          <input value={row.cost} onChange={e => update(i, 'cost', e.target.value)} placeholder="$0.00"
            style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '8px 10px' }} />
          <button onClick={() => removeRow(i)}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#64748b', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      ))}
      <button onClick={addRow}
        style={{ background: 'none', border: '1px dashed #334155', borderRadius: 8, color: '#64748b', fontSize: 12, padding: '7px 14px', cursor: 'pointer', width: '100%', marginTop: 2 }}>
        + Add item
      </button>
    </div>
  );
}

export default function JobCompleteModal({ event, accessToken, onClose, onSaved }) {
  const [status, setStatus]           = useState(null);
  const [notes, setNotes]             = useState('');
  const [whatNeeded, setWhatNeeded]   = useState('');
  const [projectNotes, setProjectNotes] = useState('');
  const [materials, setMaterials]     = useState([{ item: '', cost: '' }]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const selected = STATUSES.find(s => s.key === status);

  const handleSave = async () => {
    if (!status) return;
    setSaving(true);
    setError('');
    try {
      const usedMaterials = materials.filter(r => r.item.trim());
      const materialsBlock = usedMaterials.length
        ? '\nMaterials Used:\n' + usedMaterials.map(r => `  • ${r.item}${r.cost ? ' — ' + r.cost : ''}`).join('\n')
        : '';

      const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });

      let appendText = '';
      if (status === 'done')    appendText = `✅ GOOD TO GO — ${ts}\n${notes || 'No additional notes.'}${materialsBlock}`;
      if (status === 'return')  appendText = `🔄 GOTTA COME BACK — ${ts}\nWhat's needed: ${whatNeeded || 'Not specified'}${notes ? '\nNotes: ' + notes : ''}${materialsBlock}`;
      if (status === 'project') appendText = `📋 POTENTIAL PROJECT — ${ts}\n${projectNotes || 'No details provided.'}${notes ? '\nNotes: ' + notes : ''}${materialsBlock}`;

      // GET current description first — never overwrite existing data
      const getRes = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const current = await getRes.json();
      const updated = (current.description || '') + (current.description ? '\n\n' : '') + appendText;

      const patchRes = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: updated }) }
      );
      if (!patchRes.ok) { const err = await patchRes.json(); throw new Error(err.error?.message || 'Patch failed'); }

      onSaved(status);
    } catch (e) {
      setError('Could not save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { width: '100%', background: '#0f1729', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', fontSize: 13, padding: '10px 12px', resize: 'none', boxSizing: 'border-box' };
  const labelStyle = { color: '#94a3b8', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ color: '#e2e8f0', fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{event.summary}</div>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
              {event.start?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {!event.isAllDay && event.start && ` · ${event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
            </div>
            {event.location && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>📍 {event.location}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 22, cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        <div style={{ height: 1, background: '#334155', margin: '14px 0' }} />

        {/* Status picker */}
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>How did it go?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {STATUSES.map(s => (
            <button key={s.key} onClick={() => setStatus(s.key)} style={{
              background: status === s.key ? s.bg : '#0f1729',
              border: `2px solid ${status === s.key ? s.border : '#334155'}`,
              borderRadius: 12, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
            }}>
              <div style={{ color: status === s.key ? s.color : '#e2e8f0', fontSize: 14, fontWeight: 700 }}>{s.label}</div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{s.sub}</div>
            </button>
          ))}
        </div>

        {status === 'return' && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>What do you need to finish this?</label>
            <textarea value={whatNeeded} onChange={e => setWhatNeeded(e.target.value)} placeholder="Parts, tools, access codes..." rows={2} style={inputStyle} />
          </div>
        )}

        {status === 'project' && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>What is the customer requesting / what's outdated?</label>
            <textarea value={projectNotes} onChange={e => setProjectNotes(e.target.value)} placeholder="New panel, camera upgrade, system replacement..." rows={2} style={inputStyle} />
          </div>
        )}

        {status && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{status === 'done' ? 'Work performed (optional)' : 'Additional notes (optional)'}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="What did you do on site..." rows={3} style={inputStyle} />
          </div>
        )}

        {status && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Materials Used</div>
            <MaterialsTable rows={materials} onChange={setMaterials} />
          </div>
        )}

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <button onClick={handleSave} disabled={!status || saving} style={{
          width: '100%',
          background: !status || saving ? '#334155' : selected?.color,
          color: !status || saving ? '#64748b' : '#000',
          border: 'none', borderRadius: 12, padding: '16px', fontSize: 15, fontWeight: 700,
          cursor: !status || saving ? 'not-allowed' : 'pointer',
        }}>
          {saving ? 'Saving...' : status ? `Save — ${selected.label}` : 'Select an outcome above'}
        </button>

      </div>
    </div>
  );
}
