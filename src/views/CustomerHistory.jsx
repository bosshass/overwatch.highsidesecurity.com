// ============================================
// Overwatch — Customer Lookup (registry-driven)
// ============================================
// Source of truth = customer_registry (master accounts) + time_entries (calendar events).
// Flow: search a master account -> see EVERY calendar event tagged to it
//       (registry_id), with date, time, tech, disposition, hours, materials, notes.
// Also surfaces look-alike events that share the customer's name but were never
// tagged, so the fragmented raw names ("Jerry Allen Construction", "ALLEN, JERRY/MARILYN")
// can be pulled into the one master account with a single tap.
// No module-level sticky state -> opening a customer always opens THAT customer.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase.js';

// ── helpers ──────────────────────────────────────────────────
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
function hoursFromMin(min) {
  if (min == null) return null;
  const h = Number(min) / 60;
  if (!isFinite(h)) return null;
  return `${h.toFixed(1)}h`;
}

const DISPO = {
  bill_it:     { label: 'Bill it',     color: '#22c55e' },
  return:      { label: 'Return',      color: '#f97316' },
  estimate:    { label: 'Estimate',    color: '#3b82f6' },
  in_progress: { label: 'In progress', color: '#00c8e8' },
};
function dispo(d) {
  return DISPO[d] || { label: (d || '—').replace(/_/g, ' '), color: '#64748b' };
}

// Distinctive name tokens, for finding un-tagged look-alikes.
const STOP = new Set([
  'construction', 'security', 'residence', 'services', 'service', 'company',
  'llc', 'inc', 'the', 'and', 'drh', 'group', 'systems', 'install', 'call',
]);
function nameTokens(name) {
  return Array.from(new Set(
    (name || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !STOP.has(w))
  ));
}

const TIME_FIELDS =
  'id, event_title, event_start, tech_name, total_minutes, disposition, materials, notes, customer_name_raw, registry_id';

// ── component ────────────────────────────────────────────────
export default function CustomerHistory({ onBack }) {
  const location = useLocation();

  const [registry, setRegistry]   = useState([]);
  const [query, setQuery]         = useState('');
  const [selected, setSelected]   = useState(null);
  const [tagged, setTagged]       = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [err, setErr]             = useState('');

  // load the master account list once
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('customer_registry')
        .select('code, name, cs_legacy, address')
        .order('name');
      if (error) setErr(error.message);
      else setRegistry(data || []);
    })();
  }, []);

  // pre-fill the search box if arrived via ?name=
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('name');
    if (p && p.length >= 2) setQuery(p);
  }, [location.search]);

  const matches = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return registry.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.code || '').toLowerCase().includes(s) ||
      (c.cs_legacy || '').toLowerCase().includes(s) ||
      (c.address || '').toLowerCase().includes(s)
    ).slice(0, 40);
  }, [query, registry]);

  const loadEvents = useCallback(async (customer) => {
    setLoading(true); setErr('');
    try {
      // 1) everything already tagged to this master account
      const tg = await supabase
        .from('time_entries')
        .select(TIME_FIELDS)
        .eq('registry_id', customer.code)
        .order('event_start', { ascending: false });
      if (tg.error) throw tg.error;

      // 2) un-tagged look-alikes that share the customer's name
      let sg = [];
      const tokens = nameTokens(customer.name);
      if (tokens.length) {
        const orStr = tokens.map(t => `customer_name_raw.ilike.%${t}%`).join(',');
        const r = await supabase
          .from('time_entries')
          .select(TIME_FIELDS)
          .is('registry_id', null)
          .or(orStr)
          .order('event_start', { ascending: false })
          .limit(100);
        if (!r.error) sg = r.data || [];
      }
      setTagged(tg.data || []);
      setSuggested(sg);
    } catch (e) {
      setErr(e.message || 'Failed to load events');
      setTagged([]); setSuggested([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const pick = (customer) => { setSelected(customer); loadEvents(customer); };

  const assign = async (entryId, code) => {
    const { error } = await supabase
      .from('time_entries').update({ registry_id: code }).eq('id', entryId);
    if (error) { setErr(error.message); return; }
    // move it from suggested -> tagged locally
    setSuggested(prev => {
      const hit = prev.find(e => e.id === entryId);
      if (hit) setTagged(t => [{ ...hit, registry_id: code }, ...t]);
      return prev.filter(e => e.id !== entryId);
    });
  };

  const goBack = () => {
    if (selected) { setSelected(null); setTagged([]); setSuggested([]); setErr(''); }
    else if (onBack) onBack();
  };

  // ── styles ──
  const page = { minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: 100 };
  const bar  = { position: 'sticky', top: 0, zIndex: 10, background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '12px 14px' };
  const back = { background: 'none', border: 'none', color: '#64748b', fontSize: 16, cursor: 'pointer', padding: '4px 0' };
  const input = { width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', padding: '12px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box' };
  const card = { background: '#1a1a2e', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 12 };

  const Chip = ({ d }) => {
    const { label, color } = dispo(d);
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${color}20`, color, border: `1px solid ${color}40` }}>{label}</span>;
  };

  const EventCard = ({ e, showAssign }) => (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{e.event_title || e.customer_name_raw || 'Event'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
        <Chip d={e.disposition} />
        {e.tech_name && <span>👷 {e.tech_name}</span>}
        {e.event_start && <span>📅 {fmtDateTime(e.event_start)}</span>}
        {hoursFromMin(e.total_minutes) && <span>⏱ {hoursFromMin(e.total_minutes)}</span>}
      </div>
      {e.materials && <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 4 }}>🔧 {e.materials}</div>}
      {e.notes && <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{e.notes}</div>}
      {showAssign && (
        <button onClick={() => assign(e.id, selected.code)} style={{ marginTop: 10, width: '100%', background: '#00c8e820', border: '1px solid #00c8e8', borderRadius: 8, color: '#00c8e8', padding: '8px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Assign to {selected.name}
        </button>
      )}
    </div>
  );

  return (
    <div style={page}>
      <div style={bar}>
        <button onClick={goBack} style={back}>←</button>
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
          {selected ? selected.name : 'Customer Lookup'}
        </div>
        {selected && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            <span style={{ color: '#00c8e8', fontWeight: 700 }}>{selected.code}</span>
            {selected.cs_legacy && <span> · CS# {selected.cs_legacy}</span>}
            {selected.address && <span> · {selected.address}</span>}
          </div>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {err && <div style={{ background: '#ef444420', border: '1px solid #ef444440', color: '#fca5a5', borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {/* search mode */}
        {!selected && (
          <>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search a customer — name, code, CS#, address…"
              style={input}
            />
            {query.trim() && matches.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 14 }}>
                No master account matches “{query.trim()}”. (Customer lookup searches the registry.)
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              {matches.map(c => (
                <button key={c.code} onClick={() => pick(c)} style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                    <span style={{ color: '#00c8e8', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.code}</span>
                  </div>
                  {c.address && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>📍 {c.address}</div>}
                </button>
              ))}
            </div>
          </>
        )}

        {/* customer detail mode */}
        {selected && (
          <>
            {loading && <div style={{ color: '#64748b', fontSize: 13 }}>Loading events…</div>}

            {!loading && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 10px' }}>
                  Calendar events ({tagged.length})
                </div>
                {tagged.length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                    Nothing tagged to this account yet. Any look-alikes below can be assigned with one tap.
                  </div>
                )}
                {tagged.map(e => <EventCard key={e.id} e={e} />)}

                {suggested.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 10px' }}>
                      Possible matches — not yet assigned ({suggested.length})
                    </div>
                    {suggested.map(e => <EventCard key={e.id} e={e} showAssign />)}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
