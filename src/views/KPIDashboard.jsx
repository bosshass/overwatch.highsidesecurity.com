// ============================================
// KPI Dashboard — Jovelin
// ============================================
// READ ONLY. Writes nothing, creates no cards. Reads `jobs` + `job_history`.
//
// WHY THIS ISN'T A WALL OF AVERAGES:
// The board gets worked in bursts — ten cards triaged in one sitting enter and
// leave a status in the same minute, which floors the MEDIAN to zero. Meanwhile
// a handful of cards rot for 60+ days, which inflates the MEAN. So "avg 2.4 days
// in Ready" is simultaneously true and useless: it looks healthy while something
// sits at day 60 behind it.
//
// So: AGING (what is sitting right now) and P90 (the tail that hurts), not means.

import { useState, useEffect, useCallback } from 'react';
import { supabase, STATUS_INFO } from '../services/supabase.js';

const CLOSED = ['billed', 'archived', 'dead', 'lost', 'complete', 'to_bill', 'won'];

// tech_name is free text and JR is stored as 'JR', 'jr' and 'Jr'. Any metric
// grouped by assignee was silently splitting him into three people.
const normName = (n) => {
  if (!n || !String(n).trim()) return null;
  const t = String(n).trim();
  return t.toUpperCase() === 'JR' ? 'JR' : t.charAt(0).toUpperCase() + t.slice(1);
};

const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
const p90 = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
};
const med = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const d1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

export default function KPIDashboard({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [k, setK] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data: jobs, error: e1 } = await supabase
        .from('jobs').select('id, customer_name, status, tech_name, created_at').limit(5000);
      if (e1) throw e1;

      const { data: hist, error: e2 } = await supabase
        .from('job_history').select('job_id, from_status, to_status, changed_by, changed_at, notes')
        .order('changed_at', { ascending: true }).limit(20000);
      if (e2) throw e2;

      const now = new Date().toISOString();

      const lastNote = {};
      hist.forEach(h => { if (h.notes) lastNote[h.job_id] = h.changed_at; });

      const open = jobs.filter(j => !CLOSED.includes(j.status));
      const aged = open.map(j => ({
        ...j,
        silentDays: days(lastNote[j.id] || j.created_at, now),
        neverSpoken: !lastNote[j.id],
      })).sort((a, b) => b.silentDays - a.silentDays);

      const band = (lo, hi) => aged.filter(j => j.silentDays >= lo && (hi === null || j.silentDays < hi)).length;

      const byJob = {};
      hist.forEach(h => { (byJob[h.job_id] ||= []).push(h); });

      const dwell = {};
      Object.values(byJob).forEach(rows => {
        rows.forEach((h, i) => {
          if (!h.to_status) return;
          const next = rows[i + 1];
          if (!next) return;                 // still sitting — that's in aging, not here
          const d = days(h.changed_at, next.changed_at);
          if (d >= 0) (dwell[h.to_status] ||= []).push(d);
        });
      });

      const returnEvents = hist.filter(h => h.to_status === 'return_pending').length;
      const jobsWithReturn = new Set(hist.filter(h => h.to_status === 'return_pending').map(h => h.job_id)).size;
      const everScheduled = new Set(hist.filter(h => h.to_status === 'scheduled').map(h => h.job_id)).size;
      const returnRate = everScheduled ? (jobsWithReturn / everScheduled) * 100 : 0;

      const wonToSched = [];
      Object.values(byJob).forEach(rows => {
        const won = rows.find(h => h.to_status === 'won');
        if (!won) return;
        const sched = rows.find(h => h.to_status === 'scheduled' && new Date(h.changed_at) >= new Date(won.changed_at));
        if (sched) wonToSched.push(days(won.changed_at, sched.changed_at));
      });
      const wonNeverScheduled =
        new Set(hist.filter(h => h.to_status === 'won').map(h => h.job_id)).size - wonToSched.length;

      const movers = {};
      hist.filter(h => h.from_status && h.to_status).forEach(h => {
        const who = (h.changed_by || 'unknown').split('·')[0].split('@')[0].trim();
        movers[who] = (movers[who] || 0) + 1;
      });

      const loadBy = {};
      jobs.forEach(j => {
        const n = normName(j.tech_name) || '(unassigned)';
        loadBy[n] ||= { name: n, open: 0, silent: [] };
        if (!CLOSED.includes(j.status)) {
          loadBy[n].open++;
          loadBy[n].silent.push(days(lastNote[j.id] || j.created_at, now));
        }
      });

      // THE JR QUESTION. Not "how long does JR take" — he has never moved a
      // card in Jovelin. The real question is how long his cards sit, and
      // who ends up doing it instead.
      const jrIds = new Set(jobs.filter(j => normName(j.tech_name) === 'JR').map(j => j.id));
      const jrActions = hist.filter(h => (h.changed_by || '').toLowerCase().startsWith('jr@')).length;
      const jrOpen = aged.filter(j => jrIds.has(j.id));
      const jrMovedBy = {};
      hist.filter(h => jrIds.has(h.job_id) && h.from_status && h.to_status).forEach(h => {
        const who = (h.changed_by || 'unknown').split('·')[0].split('@')[0].trim();
        jrMovedBy[who] = (jrMovedBy[who] || 0) + 1;
      });

      setK({
        openTotal: open.length,
        bands: { d3: band(3, 7), d7: band(7, 14), d14: band(14, null) },
        neverSpoken: aged.filter(j => j.neverSpoken).length,
        worst: aged.slice(0, 8),
        dwell,
        returnEvents, jobsWithReturn, returnRate,
        wonToSched, wonNeverScheduled,
        moverRows: Object.entries(movers).sort((a, b) => b[1] - a[1]),
        assignees: Object.values(loadBy).filter(a => a.open > 0).sort((a, b) => b.open - a.open),
        jr: { actions: jrActions, open: jrOpen, movedBy: Object.entries(jrMovedBy).sort((a, b) => b[1] - a[1]) },
      });
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const page = { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', paddingBottom: 110 };
  const card = { background: '#1a1a2e', border: '1px solid #1e293b', borderRadius: 12, padding: 14, marginBottom: 12 };
  const h2 = { fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#94a3b8', marginBottom: 10 };
  const note = { fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginTop: 8 };

  if (loading) return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Crunching the numbers…</div>;
  if (err) return <div style={{ ...page, padding: 20 }}>Couldn’t load: {err}</div>;

  const Stat = ({ label, val, color, sub }) => (
    <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', flex: '1 1 120px', minWidth: 108 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || '#e2e8f0' }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={page}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a', borderBottom: '1px solid #1e293b', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#94a3b8', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>← Home</button>
        <span style={{ fontWeight: 700, fontSize: 16 }}>📊 KPIs</span>
        <button onClick={load} style={{ marginLeft: 'auto', background: '#1e293b', border: 'none', color: '#94a3b8', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>↻</button>
      </div>

      <div style={{ padding: 14, maxWidth: 900, margin: '0 auto' }}>

        <div style={card}>
          <div style={h2}>⏱ What is sitting silent right now</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Stat label="open" val={k.openTotal} />
            <Stat label="silent 3–7d" val={k.bands.d3} color="#eab308" />
            <Stat label="silent 7–14d" val={k.bands.d7} color="#f59e0b" />
            <Stat label="silent 14d+" val={k.bands.d14} color="#ef4444" />
            <Stat label="never spoken" val={k.neverSpoken} color="#ec4899" sub="no note, ever" />
          </div>
          <div style={note}>
            “Silent” = nobody has left a note. Not “nothing happened” — a card can be dragged
            across the board all week and still be silent.
          </div>
        </div>

        <div style={card}>
          <div style={h2}>🔥 Worst offenders</div>
          {k.worst.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Nothing rotting. Enjoy it.</div>}
          {k.worst.map(j => {
            const si = STATUS_INFO[j.status] || {};
            return (
              <a key={j.id} href={`/board?job=${j.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #1e293b', textDecoration: 'none' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: j.silentDays >= 14 ? '#ef4444' : '#f59e0b', width: 56 }}>{Math.round(j.silentDays)}d</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: '#f1f5f9', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.customer_name || 'Unnamed'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {si.icon} {si.label || j.status} · {normName(j.tech_name) || 'unassigned'}{j.neverSpoken ? ' · never spoken' : ''}
                  </div>
                </span>
                <span style={{ color: '#e8a33d', fontSize: 12 }}>open →</span>
              </a>
            );
          })}
        </div>

        <div style={card}>
          <div style={h2}>📦 How long a card sits in each column</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(4, 1fr)', gap: 6, fontSize: 12 }}>
            <div style={{ color: '#94a3b8', fontWeight: 700 }}>column</div>
            <div style={{ color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>n</div>
            <div style={{ color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>median</div>
            <div style={{ color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>p90</div>
            <div style={{ color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>worst</div>
            {Object.entries(k.dwell)
              .filter(([, arr]) => arr.length >= 5)
              .sort((a, b) => p90(b[1]) - p90(a[1]))
              .map(([status, arr]) => {
                const si = STATUS_INFO[status] || {};
                const worst = Math.max(...arr);
                return (
                  <div key={status} style={{ display: 'contents' }}>
                    <div style={{ color: si.color || '#e2e8f0', fontWeight: 600 }}>{si.icon} {si.label || status}</div>
                    <div style={{ textAlign: 'right', color: '#94a3b8' }}>{arr.length}</div>
                    <div style={{ textAlign: 'right', color: '#cbd5e1' }}>{d1(med(arr))}d</div>
                    <div style={{ textAlign: 'right', color: p90(arr) > 7 ? '#f59e0b' : '#cbd5e1', fontWeight: 700 }}>{d1(p90(arr))}d</div>
                    <div style={{ textAlign: 'right', color: worst > 30 ? '#ef4444' : '#94a3b8' }}>{Math.round(worst)}d</div>
                  </div>
                );
              })}
          </div>
          <div style={note}>
            <b>Read the p90, not the median.</b> The median is near zero because cards get moved
            in batches — ten triaged in one sitting enter and leave in the same minute. The p90
            is the tail that actually hurts you.
          </div>
        </div>

        <div style={card}>
          <div style={h2}>🔄 Returns</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Stat label="return events" val={k.returnEvents} color="#ec4899" />
            <Stat label="jobs needing a return" val={k.jobsWithReturn} color="#ec4899" />
            <Stat label="return rate" val={`${Math.round(k.returnRate)}%`} color={k.returnRate > 25 ? '#ef4444' : '#ec4899'} sub="of scheduled jobs" />
          </div>
          <div style={note}>Every return is a truck roll you didn’t bill for.</div>
        </div>

        <div style={card}>
          <div style={h2}>💰 Estimate won → on the calendar</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Stat label="median" val={`${d1(med(k.wonToSched))}d`} color="#22c55e" />
            <Stat label="p90" val={`${d1(p90(k.wonToSched))}d`} color={p90(k.wonToSched) > 14 ? '#ef4444' : '#f59e0b'} />
            <Stat label="won & scheduled" val={k.wonToSched.length} />
            <Stat label="won, NEVER scheduled" val={k.wonNeverScheduled} color={k.wonNeverScheduled > 0 ? '#ef4444' : '#22c55e'} sub="money on the table" />
          </div>
          <div style={note}>
            The last number is the one that matters — work the customer already said yes to that
            never made it onto a calendar.
          </div>
        </div>

        <div style={{ ...card, border: '2px solid #f59e0b' }}>
          <div style={h2}>👤 Cards assigned to JR</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <Stat label="open cards" val={k.jr.open.length} color="#f59e0b" />
            <Stat label="median silence" val={`${d1(med(k.jr.open.map(j => j.silentDays)))}d`} color="#f59e0b" />
            <Stat label="worst" val={`${Math.round(Math.max(0, ...k.jr.open.map(j => j.silentDays)))}d`} color="#ef4444" />
            <Stat label="cards JR has moved" val={k.jr.actions} color={k.jr.actions === 0 ? '#ef4444' : '#22c55e'} sub="ever, in Jovelin" />
          </div>
          {k.jr.actions === 0 && (
            <div style={{ background: '#78350f33', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#fbbf24', marginBottom: 8 }}>
              JR has never moved a card in Jovelin — not once. Every card assigned to him was
              eventually actioned by someone else, so “how long does JR take” has no answer.
              The question is who does it instead.
            </div>
          )}
          {k.jr.movedBy.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Who actually moves JR’s cards:</div>
              {k.jr.movedBy.map(([who, n]) => (
                <div key={who} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                  <span style={{ color: '#e2e8f0' }}>{who}</span>
                  <span style={{ color: '#94a3b8' }}>{n} moves</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div style={card}>
          <div style={h2}>🧑‍🔧 Open cards by assignee</div>
          {k.assignees.map(a => (
            <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #1e293b' }}>
              <span style={{ flex: 1, fontSize: 14, color: a.name === '(unassigned)' ? '#fbbf24' : '#e2e8f0', fontWeight: 600 }}>{a.name}</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>median silent {d1(med(a.silent))}d</span>
              <span style={{ fontSize: 18, fontWeight: 800, width: 34, textAlign: 'right' }}>{a.open}</span>
            </div>
          ))}
        </div>

        <div style={card}>
          <div style={h2}>✋ Who moves cards</div>
          {k.moverRows.map(([who, n]) => (
            <div key={who} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
              <span style={{ color: '#e2e8f0' }}>{who}</span>
              <span style={{ color: '#94a3b8' }}>{n}</span>
            </div>
          ))}
          <div style={note}>Status changes, all time. This is who is running the board.</div>
        </div>

        <div style={{ ...note, textAlign: 'center' }}>Read-only. This screen writes nothing and creates no cards.</div>
      </div>
    </div>
  );
}
