// ============================================================================
// SoldWork.jsx — what we sold and haven't delivered.
//
// $84,781 of accepted estimates carry a balance, and eleven of the seventeen
// have no job behind them at all. Goodell alone is $10,142 across three
// estimates that never reached a board, so nobody scheduled them, so nobody
// worked them, so nobody billed them. That is the shape of the summer:
// the work was sold and then quietly forgotten.
//
// This is the only place those live until somebody acts on one. Two ways out:
//
//   Create a job  — it becomes real work, with the contract already on it.
//   Close         — no longer active, with a reason, and it stops appearing.
//
// Deliberately NOT on the board. An estimate is not a visit; putting it there
// was how 36 QuickBooks imports ended up as cards nobody could action.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';

const C = {
  bg: '#0b1220', raised: '#0f172a', line: '#1e293b',
  text: '#e2e8f0', muted: '#64748b', cyan: '#38bdf8',
  green: '#22c55e', amber: '#f59e0b', purple: '#a78bfa', red: '#ef4444',
};

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const daysSince = (d) => {
  if (!d) return 0;
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  return Math.round((Date.now() - new Date(y, m - 1, dd).getTime()) / 86400000);
};

const CLOSE_REASONS = [
  'Work is finished — nothing left to bill',
  'Customer walked away',
  'Superseded by another estimate',
  'Written off',
  'Duplicate',
];

export default function SoldWork({ userEmail, onBack, onOpenJob }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [closing, setClosing] = useState(null);
  const [reason, setReason] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('estimates')
      .select('*, customers(short_code, name), jobs(id, status, scheduled_date)')
      .order('remaining_amount', { ascending: false });
    if (error) setErr(error.message);
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Only sold work with money still on it. An estimate billed to zero is
  // finished, whatever its status says.
  const open = rows.filter(r => !r.closed_at && Number(r.remaining_amount) > 1);
  const closed = rows.filter(r => r.closed_at);

  const totalSold = open.reduce((n, r) => n + Number(r.amount || 0), 0);
  const totalInv = open.reduce((n, r) => n + Number(r.invoiced_amount || 0), 0);
  const totalRem = open.reduce((n, r) => n + Number(r.remaining_amount || 0), 0);
  const noJob = open.filter(r => !r.job_id);

  const createJob = async (r) => {
    if (!r.customer_id) { setErr('No customer on this estimate — link it first.'); return; }
    setBusy(r.id);
    const { data: job, error } = await supabase.from('jobs').insert({
      customer_id: r.customer_id,
      customer_name: r.customers?.name || r.qbo_customer_name,
      job_type: 'service',
      status: 'ready_to_schedule',
      priority: 'normal',
      issue: `Accepted estimate ${r.est_no} (${fmtDate(r.quote_date)}).`,
      estimate_amount: Number(r.amount) || null,
      invoiced_amount: Number(r.invoiced_amount) || null,
      qbo_estimate_ref: r.est_no,
      created_by: userEmail || 'soldwork',
    }).select().single();

    if (error) { setBusy(null); setErr(error.message); return; }
    await supabase.from('estimates').update({ job_id: job.id }).eq('id', r.id);
    setBusy(null);
    load();
    onOpenJob?.(job);
  };

  const closeOut = async () => {
    if (!closing || !reason) return;
    setBusy(closing.id);
    const { error } = await supabase.from('estimates').update({
      closed_at: new Date().toISOString(),
      closed_by: userEmail || null,
      closed_reason: reason,
    }).eq('id', closing.id);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setClosing(null); setReason('');
    load();
  };

  const Row = ({ r, dim }) => {
    const age = daysSince(r.quote_date);
    const pct = Number(r.amount) > 0
      ? Math.round((Number(r.invoiced_amount) / Number(r.amount)) * 100) : 0;
    return (
      <div style={{
        background: C.raised, border: `1px solid ${C.line}`,
        borderLeft: `3px solid ${r.job_id ? C.green : (age > 60 ? C.red : C.amber)}`,
        borderRadius: 11, padding: '13px 15px', marginBottom: 8, opacity: dim ? 0.5 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
            {r.customers?.name || r.qbo_customer_name}
          </span>
          <span style={{ fontSize: 11.5, color: C.muted }}>est {r.est_no}</span>
          <span style={{ fontSize: 11.5, color: age > 60 ? C.red : C.muted }}>
            {fmtDate(r.quote_date)} &middot; {age}d
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 17, fontWeight: 800, color: C.text }}>
            {money(r.remaining_amount)}
          </span>
        </div>

        <div style={{ height: 5, borderRadius: 3, background: C.line, margin: '10px 0 7px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: C.green }} />
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.muted }}>
          <span>sold <b style={{ color: C.text }}>{money(r.amount)}</b></span>
          <span>invoiced <b style={{ color: C.text }}>{money(r.invoiced_amount)}</b> &middot; {pct}%</span>
          {r.job_id
            ? <span style={{ color: C.green, fontWeight: 700 }}>on the board &middot; {r.jobs?.status}</span>
            : <span style={{ color: C.amber, fontWeight: 700 }}>no job</span>}
        </div>

        {r.closed_at && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 7 }}>
            Closed {fmtDate(r.closed_at)} &mdash; {r.closed_reason}
          </div>
        )}

        {!dim && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {r.job_id ? (
              <button onClick={() => onOpenJob?.(r.jobs)}
                style={{ flex: 2, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                         background: 'transparent', border: `1px solid ${C.green}`, color: C.green,
                         fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                Open the job
              </button>
            ) : (
              <button onClick={() => createJob(r)} disabled={busy === r.id}
                style={{ flex: 2, padding: '9px 0', borderRadius: 8, border: 'none',
                         background: C.cyan, color: '#0b1220', fontSize: 13, fontWeight: 800,
                         cursor: 'pointer', fontFamily: 'inherit' }}>
                {busy === r.id ? 'Creating…' : 'Create a job'}
              </button>
            )}
            <button onClick={() => { setClosing(r); setReason(''); }}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                       background: 'transparent', border: `1px solid ${C.line}`, color: C.muted,
                       fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
              Close
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ background: C.bg, minHeight: '100dvh', color: C.text, paddingBottom: 90,
                  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif' }}>

      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.line}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                    position: 'sticky', top: 0, background: C.bg, zIndex: 60 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.muted,
                                            fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>
            &larr; Home
          </button>
        )}
        <span style={{ fontSize: 17, fontWeight: 800 }}>Sold work</span>
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', gap: 9, marginBottom: 16, flexWrap: 'wrap' }}>
          {[['Remaining', money(totalRem), C.amber],
            ['Sold', money(totalSold), C.text],
            ['Invoiced', money(totalInv), C.green],
            ['No job yet', String(noJob.length), noJob.length ? C.red : C.muted]].map(([l, v, col]) => (
            <div key={l} style={{ flex: '1 0 40%', background: C.raised, border: `1px solid ${C.line}`,
                                  borderRadius: 11, padding: '12px 14px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: col }}>{v}</div>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{l}</div>
            </div>
          ))}
        </div>

        {err && (
          <div style={{ background: '#450a0a', color: '#fca5a5', borderRadius: 9,
                        padding: '9px 12px', fontSize: 12.5, marginBottom: 12 }}>{err}</div>
        )}

        {loading && <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>}

        {!loading && open.length === 0 && (
          <div style={{ color: C.muted, fontSize: 13.5, padding: '20px 0' }}>
            Nothing sold and undelivered. Everything accepted is either billed out or closed.
          </div>
        )}

        {open.map(r => <Row key={r.id} r={r} />)}

        {closed.length > 0 && (
          <>
            <button onClick={() => setShowClosed(v => !v)}
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12,
                       textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer',
                       fontFamily: 'inherit', padding: '16px 0 8px' }}>
              {showClosed ? '▾' : '▸'} Closed ({closed.length})
            </button>
            {showClosed && closed.map(r => <Row key={r.id} r={r} dim />)}
          </>
        )}
      </div>

      {/* Closing needs a reason. "Closed" with no why is how $173,855 of
          QuickBooks estimates became unreadable. */}
      {closing && (
        <div onClick={() => setClosing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,16,0.82)', zIndex: 970,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.raised, border: `1px solid ${C.line}`, borderRadius: 14,
                     padding: 20, width: '100%', maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              Close {closing.customers?.name || closing.qbo_customer_name}
            </div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, marginBottom: 15 }}>
              est {closing.est_no} &middot; {money(closing.remaining_amount)} still on it
            </div>

            {CLOSE_REASONS.map(x => (
              <button key={x} onClick={() => setReason(x)}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 7,
                         padding: '11px 13px', borderRadius: 9, cursor: 'pointer',
                         background: reason === x ? C.cyan : 'transparent',
                         border: `1px solid ${reason === x ? C.cyan : C.line}`,
                         color: reason === x ? '#0b1220' : C.text,
                         fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit' }}>
                {x}
              </button>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setClosing(null)}
                style={{ flex: 1, padding: '11px 0', borderRadius: 9, background: 'transparent',
                         border: `1px solid ${C.line}`, color: C.muted, fontSize: 13,
                         fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={closeOut} disabled={!reason || busy === closing.id}
                style={{ flex: 2, padding: '11px 0', borderRadius: 9, border: 'none',
                         background: reason ? C.red : C.line,
                         color: reason ? '#fff' : C.muted,
                         fontSize: 13.5, fontWeight: 800,
                         cursor: reason ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {busy === closing.id ? 'Closing…' : 'Close it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
