// ============================================================
// Event Audit — assign every calendar event (time_entry) since
// Jan 1 to a customer from the Registry (Column A code, e.g. DUR001).
//
// This is the single source of association: it writes ONLY
// time_entries.registry_id. DRH-name and project_ref are ignored
// here on purpose. Notes / disposition / materials shown for context.
// ============================================================

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../services/supabase.js';

const SINCE = '2026-01-01';

const DISPO = {
  bill_it:     { label: 'Bill it',     color: '#22c55e' },
  return:      { label: 'Return',      color: '#f59e0b' },
  estimate:    { label: 'Estimate',    color: '#06b6d4' },
  in_progress: { label: 'In progress', color: '#3b82f6' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function hrs(mins) {
  if (!mins) return null;
  return (mins / 60).toFixed(1) + 'h';
}

function Chip({ color, children }) {
  return (
    <span style={{
      background: `${color}20`, color, border: `1px solid ${color}40`,
      borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

// ── Searchable customer picker (handles 380+ accounts) ───────────
function CustomerPicker({ registry, onPick, onClose }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? registry.filter(c =>
          (c.name || '').toLowerCase().includes(s) ||
          (c.code || '').toLowerCase().includes(s) ||
          (c.address || '').toLowerCase().includes(s) ||
          (c.cs_legacy || '').toLowerCase().includes(s))
      : registry;
    return list.slice(0, 40);
  }, [q, registry]);

  return (
    <div style={{ marginTop: 10, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name, code, address…"
          style={{
            flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            color: '#e2e8f0', fontSize: 14, padding: '8px 10px', outline: 'none', fontFamily: 'inherit',
          }}
        />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {matches.length === 0 && (
          <div style={{ color: '#475569', fontSize: 13, padding: 12, textAlign: 'center' }}>No match for "{q}"</div>
        )}
        {matches.map(c => (
          <div key={c.code} onClick={() => onPick(c)} style={{
            padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: '#1a1a2e', border: '1px solid #1e293b',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: '#00c8e8', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.code}</span>
            </div>
            {c.address && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{c.address}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CustomerAudit({ onBack }) {
  const [registry, setRegistry] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [openId, setOpenId] = useState(null);     // which card's picker is open
  const [savingId, setSavingId] = useState(null);

  const byCode = useMemo(() => {
    const m = {};
    for (const c of registry) m[c.code] = c;
    return m;
  }, [registry]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true); setErr(null);
    try {
      const [{ data: reg, error: e1 }, { data: ev, error: e2 }] = await Promise.all([
        supabase.from('customer_registry').select('code, name, cs_legacy, address').order('name'),
        supabase.from('time_entries')
          .select('id, event_title, event_start, created_at, tech_name, total_minutes, disposition, materials, notes, customer_name_raw, registry_id, project_ref')
          .gte('created_at', SINCE)
          .limit(2000),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setRegistry(reg || []);
      const sorted = (ev || []).sort((a, b) =>
        new Date(b.event_start || b.created_at) - new Date(a.event_start || a.created_at));
      setEvents(sorted);
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
  }

  async function assign(entryId, code) {
    setSavingId(entryId);
    try {
      const { error } = await supabase.from('time_entries').update({ registry_id: code }).eq('id', entryId);
      if (error) throw error;
      setEvents(prev => prev.map(e => e.id === entryId ? { ...e, registry_id: code } : e));
      setOpenId(null);
    } catch (e) {
      alert('Could not save: ' + (e.message || e));
    }
    setSavingId(null);
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return events.filter(e => {
      if (unassignedOnly && e.registry_id) return false;
      if (!s) return true;
      const cust = byCode[e.registry_id];
      return (
        (e.event_title || '').toLowerCase().includes(s) ||
        (e.customer_name_raw || '').toLowerCase().includes(s) ||
        (e.notes || '').toLowerCase().includes(s) ||
        (e.materials || '').toLowerCase().includes(s) ||
        (e.tech_name || '').toLowerCase().includes(s) ||
        (cust?.name || '').toLowerCase().includes(s) ||
        (e.registry_id || '').toLowerCase().includes(s)
      );
    });
  }, [events, search, unassignedOnly, byCode]);

  const assignedCount = events.filter(e => e.registry_id).length;
  const total = events.length;

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 16, cursor: 'pointer', padding: '4px 0' }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🔎 Event Audit</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            <span style={{ color: '#22c55e', fontWeight: 700 }}>{assignedCount}</span> / {total} assigned
          </div>
        </div>

        {/* progress bar */}
        <div style={{ height: 4, background: '#1e293b', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: total ? `${(assignedCount / total) * 100}%` : '0%', background: '#22c55e' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter events by title, note, tech, customer…"
            style={{
              flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
              color: '#e2e8f0', fontSize: 14, padding: '9px 12px', outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button onClick={() => setUnassignedOnly(v => !v)} style={{
            background: unassignedOnly ? '#00c8e820' : '#1e293b',
            border: `1px solid ${unassignedOnly ? '#00c8e8' : '#334155'}`,
            color: unassignedOnly ? '#00c8e8' : '#64748b',
            borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {unassignedOnly ? 'Unassigned only' : 'All events'}
          </button>
        </div>
        <div style={{ color: '#475569', fontSize: 11, marginTop: 6 }}>Events since Jan 1, 2026</div>
      </div>

      {/* Body */}
      <div style={{ padding: 14 }}>
        {loading && <div style={{ textAlign: 'center', color: '#64748b', padding: 60, fontSize: 14 }}>Loading events…</div>}

        {err && (
          <div style={{ background: '#ef444420', border: '1px solid #ef444440', color: '#fca5a5', borderRadius: 10, padding: 14, fontSize: 13 }}>
            {err}
          </div>
        )}

        {!loading && !err && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#334155', padding: 60, fontSize: 14 }}>
            {unassignedOnly ? 'Nothing left to assign 🎉' : 'No events match.'}
          </div>
        )}

        {!loading && !err && filtered.map(e => {
          const d = DISPO[e.disposition] || { label: e.disposition, color: '#64748b' };
          const cust = byCode[e.registry_id];
          const isOpen = openId === e.id;
          return (
            <div key={e.id} style={{ background: '#1a1a2e', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>
                    {e.event_title || e.customer_name_raw || '(untitled event)'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip color={d.color}>{d.label}</Chip>
                    {e.tech_name && <span style={{ color: '#64748b', fontSize: 11 }}>👷 {e.tech_name}</span>}
                    <span style={{ color: '#64748b', fontSize: 11 }}>📅 {fmtDate(e.event_start || e.created_at)}</span>
                    {hrs(e.total_minutes) && <span style={{ color: '#00c8e8', fontSize: 11 }}>⏱ {hrs(e.total_minutes)}</span>}
                  </div>
                </div>
              </div>

              {e.materials && (
                <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>🔧 {e.materials}</div>
              )}
              {e.notes && (
                <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.notes}</div>
              )}

              {/* assignment row */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e293b' }}>
                {cust ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700, marginRight: 6 }}>✓ {e.registry_id}</span>
                      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{cust.name}</span>
                    </div>
                    <button onClick={() => setOpenId(isOpen ? null : e.id)} style={{
                      background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#64748b',
                      padding: '5px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0,
                    }}>Change</button>
                  </div>
                ) : (
                  <button onClick={() => setOpenId(isOpen ? null : e.id)} disabled={savingId === e.id} style={{
                    width: '100%', background: '#00c8e820', border: '1px solid #00c8e8', borderRadius: 8,
                    color: '#00c8e8', padding: '9px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>
                    {savingId === e.id ? 'Saving…' : '+ Assign customer'}
                  </button>
                )}

                {isOpen && (
                  <CustomerPicker
                    registry={registry}
                    onPick={c => assign(e.id, c.code)}
                    onClose={() => setOpenId(null)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
