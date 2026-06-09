// ============================================
// JUC-E — Job Status Board
// ============================================
// 3 columns: Day of Status | Sales | Bill It
// Reads from juce_job_status localStorage
// Written to by CompletionModal

import { useState, useEffect, useCallback } from 'react';

const STATUS_KEY = 'juce_job_status';

const STATUS_COLORS = {
  'COMPLETED': { color: '#22c55e', dark: '#052e16', border: '#16a34a', emoji: '✅' },
  'RETURN':    { color: '#f59e0b', dark: '#2d1a00', border: '#d97706', emoji: '🔄' },
  'SALES OPP': { color: '#a78bfa', dark: '#1a0533', border: '#7c3aed', emoji: '💰' },
};

const SALES_STAGES = [
  { key: 'estimate_needed',  label: 'ESTIMATE NEEDED',  color: '#ef4444', emoji: '📋' },
  { key: 'estimate_pending', label: 'ESTIMATE PENDING', color: '#f59e0b', emoji: '⏳' },
  { key: 'won',              label: 'WON — READY TO BILL', color: '#22c55e', emoji: '🏆' },
];

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export default function JobStatus({ onBack }) {
  const [items, setItems] = useState([]);

  const load = useCallback(() => {
    try { setItems(JSON.parse(localStorage.getItem(STATUS_KEY) || '[]')); }
    catch { setItems([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = (updated) => {
    localStorage.setItem(STATUS_KEY, JSON.stringify(updated));
    setItems(updated);
  };

  const update = (id, changes) => save(items.map(i => i.id === id ? { ...i, ...changes } : i));
  const remove = (id) => save(items.filter(i => i.id !== id));

  // Move to Sales column
  const pushToSales = (item) => update(item.id, { inSales: true, salesStage: 'estimate_needed' });
  const setSalesStage = (item, stage) => update(item.id, { salesStage: stage });

  // Move to Bill It
  const pushToBill = (item) => update(item.id, { inBill: true, inSales: false });
  const markBilled = (item) => {
    const stripped = item.title.replace(/^\[.*?\]\s*/, '').trim();
    update(item.id, {
      billed: true,
      billedAt: new Date().toISOString(),
      billedTitle: `$$💵 BILLED — ${stripped}`,
    });
  };

  // Columns
  const dayOf  = items.filter(i => !i.inSales && !i.inBill);
  const sales  = items.filter(i => i.inSales  && !i.inBill);
  const bill   = items.filter(i => i.inBill);

  // ── Cards ─────────────────────────────────────────────────────────────
  const DayOfCard = ({ item }) => {
    const s = STATUS_COLORS[item.status] || { color: '#64748b', dark: '#1e293b', border: '#334155', emoji: '?' };
    return (
      <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 10, borderLeft: `4px solid ${s.color}` }}>
        {/* Title */}
        <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 800, marginBottom: 10, lineHeight: 1.3 }}>
          {item.title}
        </div>
        {/* BIG STATUS BADGE */}
        <div style={{
          background: s.dark, border: `2px solid ${s.border}`, borderRadius: 10,
          padding: '12px 16px', marginBottom: 10, textAlign: 'center'
        }}>
          <div style={{ fontSize: 28 }}>{s.emoji}</div>
          <div style={{ color: s.color, fontSize: 18, fontWeight: 900, letterSpacing: 1 }}>{item.status}</div>
        </div>
        {/* Meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
          {item.start && <div style={{ color: '#3b82f6', fontSize: 11, fontWeight: 600 }}>📅 {formatDate(item.start)}</div>}
          {item.location && <div style={{ color: '#64748b', fontSize: 11 }}>📍 {item.location}</div>}
          {item.notes && <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>📝 {item.notes}</div>}
          <div style={{ color: '#334155', fontSize: 10 }}>Submitted {formatDate(item.created_at)}</div>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          {item.status === 'SALES OPP' && (
            <button onClick={() => pushToSales(item)} style={{
              flex: 1, padding: '8px', background: '#1a0533', border: '1px solid #7c3aed60',
              borderRadius: 8, color: '#a78bfa', fontSize: 11, fontWeight: 700, cursor: 'pointer'
            }}>💰 Move to Sales</button>
          )}
          <button onClick={() => pushToBill(item)} style={{
            flex: 1, padding: '8px', background: '#0a2d1f', border: '1px solid #16a34a60',
            borderRadius: 8, color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer'
          }}>💵 Bill It</button>
          <button onClick={() => remove(item.id)} style={{
            padding: '8px 10px', background: 'none', border: '1px solid #1e293b',
            borderRadius: 8, color: '#334155', fontSize: 11, cursor: 'pointer'
          }}>🗑</button>
        </div>
      </div>
    );
  };

  const SalesCard = ({ item }) => {
    const stage = SALES_STAGES.find(s => s.key === item.salesStage) || SALES_STAGES[0];
    return (
      <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 10, borderLeft: '4px solid #a78bfa' }}>
        <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 800, marginBottom: 10, lineHeight: 1.3 }}>
          {item.title}
        </div>
        {/* BIG SALES STAGE */}
        <div style={{ marginBottom: 10 }}>
          {SALES_STAGES.map(s => (
            <button key={s.key} onClick={() => setSalesStage(item, s.key)} style={{
              display: 'block', width: '100%', padding: '12px 16px', marginBottom: 6,
              borderRadius: 10, border: `2px solid ${item.salesStage === s.key ? s.color : '#1e293b'}`,
              background: item.salesStage === s.key ? `${s.color}25` : '#0f172a',
              cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>{s.emoji}</span>
              <span style={{ color: item.salesStage === s.key ? s.color : '#475569', fontSize: 13, fontWeight: 800 }}>
                {s.label}
              </span>
            </button>
          ))}
        </div>
        {item.notes && <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 10, lineHeight: 1.4 }}>📝 {item.notes}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => pushToBill(item)} style={{
            flex: 1, padding: '8px', background: '#0a2d1f', border: '1px solid #16a34a60',
            borderRadius: 8, color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer'
          }}>💵 Move to Bill It</button>
          <button onClick={() => remove(item.id)} style={{
            padding: '8px 10px', background: 'none', border: '1px solid #1e293b',
            borderRadius: 8, color: '#334155', fontSize: 11, cursor: 'pointer'
          }}>🗑</button>
        </div>
      </div>
    );
  };

  const BillCard = ({ item }) => (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 10, borderLeft: `4px solid ${item.billed ? '#22c55e' : '#f59e0b'}` }}>
      {item.billed ? (
        <>
          <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 6 }}>💵💵</div>
          <div style={{ color: '#22c55e', fontSize: 14, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>BILLED</div>
          <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700, textAlign: 'center', marginBottom: 6 }}>{item.title}</div>
          <div style={{ color: '#334155', fontSize: 10, textAlign: 'center' }}>Billed {formatDate(item.billedAt)}</div>
        </>
      ) : (
        <>
          <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 800, marginBottom: 6, lineHeight: 1.3 }}>{item.title}</div>
          {item.notes && <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 10, lineHeight: 1.4 }}>📝 {item.notes}</div>}
          {/* BIG BILL STATUS */}
          <div style={{
            padding: '14px', borderRadius: 10, border: '2px dashed #f59e0b60',
            background: '#2d1a0010', textAlign: 'center', marginBottom: 10
          }}>
            <div style={{ fontSize: 24 }}>💵</div>
            <div style={{ color: '#f59e0b', fontSize: 14, fontWeight: 800 }}>NOT BILLED</div>
          </div>
          <button onClick={() => markBilled(item)} style={{
            width: '100%', padding: '12px', background: '#052e16', border: '2px solid #22c55e',
            borderRadius: 10, color: '#22c55e', fontSize: 14, fontWeight: 900, cursor: 'pointer'
          }}>
            💵💵 MARK AS BILLED ✓
          </button>
        </>
      )}
      <button onClick={() => remove(item.id)} style={{
        display: 'block', width: '100%', marginTop: 8,
        padding: '6px', background: 'none', border: '1px solid #1e293b',
        borderRadius: 8, color: '#334155', fontSize: 10, cursor: 'pointer'
      }}>Remove</button>
    </div>
  );

  const COLS = [
    { key: 'dayof',  label: '📍 Day of Status', color: '#00c8e8', items: dayOf,  Card: DayOfCard },
    { key: 'sales',  label: '💰 Sales',          color: '#a78bfa', items: sales,  Card: SalesCard },
    { key: 'bill',   label: '💵 Bill It',         color: '#22c55e', items: bill,   Card: BillCard  },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1729', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #1e293b', background: '#0f1729', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>← Home</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16 }}>📊 Job Status</span>
          <span style={{ background: '#00c8e8', color: '#000', padding: '1px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>{items.length}</span>
        </div>
        <button onClick={load} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 13, cursor: 'pointer' }}>↺</button>
      </div>

      {/* 3-column board */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 12, padding: 12, WebkitOverflowScrolling: 'touch' }}>
        {COLS.map(col => (
          <div key={col.key} style={{ minWidth: 290, maxWidth: 330, flex: '0 0 290px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: `${col.color}20`, borderRadius: '10px 10px 0 0', padding: '10px 14px', borderBottom: `2px solid ${col.color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700 }}>{col.label}</span>
              <span style={{ background: col.color, color: '#000', padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{col.items.length}</span>
            </div>
            <div style={{ background: '#0f172a', borderRadius: '0 0 10px 10px', flex: 1, overflowY: 'auto', padding: 8 }}>
              {col.items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#334155', fontSize: 12 }}>Empty</div>
              ) : (
                col.items.map(item => <col.Card key={item.id} item={item} />)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
