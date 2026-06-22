// ============================================
// Overwatch — OpsHome (live operations triage)
// ============================================
// Drop-in replacement for the static HomeScreen launcher in App.jsx.
// Reads existing Supabase APIs + Google Calendar — no schema changes.
//
// Surfaces, top to bottom:
//   0. Open jobs — past calendar events with NO disposition tag (tap → finish it)
//   1. Returns flagged but NOT scheduled  (return_cards + jobs.return_pending)
//   2. Estimate pipeline — needs_estimate → estimate_sent → won → pending_materials,
//      with one-tap advance buttons. Runs on jobs.status (QBO-independent).
//   3. Done — not billed                  (jobs.to_bill)
//
// Wire it up in App.jsx — NOTE the two extra props (accessToken, userEmail):
//   import OpsHome from './views/OpsHome.jsx';
//   <Route path="/" element={
//     <OpsHome userName={userName} isOperator={isOperator} isRestricted={isRestricted}
//              accessToken={accessToken} userEmail={userEmail}
//              onNavigate={navigate} onSignOut={handleSignOut}
//              onBackfill={() => { setShowBackfill(true); setBackfillLog([]); }}
//              onSearch={() => setShowSearch(true)} />
//   } />
// Tapping an "Open job" routes to /?cal=X&job=Y — App.jsx's existing deep-link
// branch catches it and opens JobFinishSheet. Advance buttons call
// jobsApi.changeStatus, which already enforces legal transitions + logs history.

import { useState, useEffect, useCallback } from 'react';
import { returnCardsApi, jobsApi, JOB_STATUS } from '../services/supabase.js';
import { getJobAge, getAgeUrgency } from '../utils/statusMachine.js';
import { getWorkViewCalendars } from '../config/calendars.js';
import { fetchCalendarEvents } from '../services/calendarApi.js';

const NAVY = '#0f1729';
const TEAL = '#00c8e8';
const STALE_LOOKBACK_DAYS = 3;

const CLOSED_TAGS = [
  '[BILL IT]', '[RETURN]', '[IN PROGRESS]', '[ESTIMATE]',
  '[BILLED]', '[TO BILL]', '[INVOICED]', '[INVOICE]', '[COMPLETED]', '[COMPLETE]', '[DONE]',
  '[RETURN NEEDED]', '[NEEDS ESTIMATE]', '[NC]', '[NO CHARGE]',
  '[IGNORE]', '[IGNORED]', '[PTO]', '[OFF]', '[CANCELLED]', '[CANCELED]', '[HOLIDAY]',
];

function daysAgo(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}
function isClosed(title) {
  const up = (title || '').toUpperCase();
  return CLOSED_TAGS.some(t => up.includes(t));
}
function timeLabel(start) {
  if (!start) return '';
  const d = new Date(start);
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = daysAgo(start);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

// ── SCAN: past, timed, undispositioned events across the user's calendars ─────
function useStaleEvents(accessToken, userEmail) {
  const [state, setState] = useState({ loading: true, items: [] });
  const load = useCallback(async () => {
    if (!accessToken || !userEmail) { setState({ loading: false, items: [] }); return; }
    setState(s => ({ ...s, loading: true }));
    try {
      const cals = getWorkViewCalendars(userEmail);
      if (!cals.length) { setState({ loading: false, items: [] }); return; }
      const now = new Date();
      const since = new Date(now.getTime() - STALE_LOOKBACK_DAYS * 86400000);
      const batches = await Promise.all(cals.map(async (cal) => {
        const events = await fetchCalendarEvents(accessToken, cal.id, since, now).catch(() => []);
        return events.map(ev => ({ ...ev, _calName: cal.name, _calId: cal.id }));
      }));
      const seen = new Set();
      const items = [];
      for (const ev of batches.flat()) {
        if (ev.status === 'cancelled') continue;
        if (!ev.start?.dateTime) continue;
        const end = ev.end?.dateTime || ev.end?.date;
        if (!end || new Date(end) >= now) continue;
        if (isClosed(ev.summary)) continue;
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        items.push({
          key: ev.id, calId: ev._calId, calName: ev._calName,
          title: (ev.summary || '(no title)').replace(/\s*\[.*?\]\s*$/, ''),
          start: ev.start.dateTime, when: timeLabel(ev.start.dateTime), location: ev.location || '',
        });
      }
      items.sort((a, b) => new Date(b.start) - new Date(a.start));
      setState({ loading: false, items });
    } catch { setState({ loading: false, items: [] }); }
  }, [accessToken, userEmail]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// ── Returns + to-bill (Supabase) ─────────────────────────────────────────────
function useTriage() {
  const [state, setState] = useState({ loading: true, returns: [], toBill: [] });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const [cards, returnJobs, toBillJobs] = await Promise.all([
        returnCardsApi.getPending().catch(() => []),
        jobsApi.getByStatus([JOB_STATUS.RETURN_PENDING]).catch(() => []),
        jobsApi.getByStatus([JOB_STATUS.TO_BILL]).catch(() => []),
      ]);
      const returns = [
        ...cards.map(c => ({ key: `card:${c.id}`, title: c.original_event_title || c.customers?.name || c.customer_name_raw || 'Return', sub: c.reason || 'Flagged for return', age: daysAgo(c.created_at), source: 'flagged' })),
        ...returnJobs.map(j => ({ key: `job:${j.id}`, title: j.customer_name || j.job_number || 'Return', sub: j.issue || `${j.job_number} — return pending`, age: getJobAge(j.created_at), source: 'job' })),
      ].sort((a, b) => b.age - a.age);
      const toBill = toBillJobs.map(j => ({ key: `bill:${j.id}`, title: j.customer_name || j.job_number || 'Job', amount: j.estimate_amount || j.invoiced_amount || null, age: getJobAge(j.created_at) })).sort((a, b) => b.age - a.age);
      setState({ loading: false, returns, toBill });
    } catch { setState({ loading: false, returns: [], toBill: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// ── Estimate pipeline (Supabase, status-driven) ──────────────────────────────
const STAGE_ORDER = ['needs', 'sent', 'won', 'parts'];
const STAGE = {
  needs: { label: 'Needs estimate', color: '#f59e0b', actions: [{ label: 'Mark sent →', to: JOB_STATUS.ESTIMATE_SENT }] },
  sent:  { label: 'Sent',           color: '#06b6d4', actions: [{ label: 'Won', to: JOB_STATUS.WON }, { label: 'Lost', to: JOB_STATUS.LOST, ghost: true }] },
  won:   { label: 'Won',            color: '#22c55e', actions: [{ label: 'Needs parts', to: JOB_STATUS.PENDING_MATERIALS, ghost: true }, { label: 'Ready →', to: JOB_STATUS.READY_TO_SCHEDULE }] },
  parts: { label: 'Waiting on parts', color: '#f59e0b', actions: [{ label: 'Parts in → Ready', to: JOB_STATUS.READY_TO_SCHEDULE }] },
};
const STATUS_TO_STAGE = {
  [JOB_STATUS.NEEDS_ESTIMATE]: 'needs',
  [JOB_STATUS.ESTIMATE_SENT]: 'sent',
  [JOB_STATUS.WON]: 'won',
  [JOB_STATUS.PENDING_MATERIALS]: 'parts',
};

function useEstimates() {
  const [state, setState] = useState({ loading: true, items: [] });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const rows = await jobsApi.getByStatus([
        JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT, JOB_STATUS.WON, JOB_STATUS.PENDING_MATERIALS,
      ]).catch(() => []);
      const items = rows.map(j => ({
        id: j.id,
        stage: STATUS_TO_STAGE[j.status],
        title: j.customer_name || j.job_number || 'Estimate',
        sub: j.issue || (j.estimate_amount ? `$${Number(j.estimate_amount).toLocaleString()}` : 'No detail'),
        age: getJobAge(j.created_at),
      })).filter(x => x.stage);
      items.sort((a, b) => (STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)) || (b.age - a.age));
      setState({ loading: false, items });
    } catch { setState({ loading: false, items: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// ── Estimate pipeline card (div, not a button — holds its own action buttons) ─
function EstimatePipeline({ items, loading, onAdvance, busyId }) {
  const counts = STAGE_ORDER.map(s => ({ s, n: items.filter(i => i.stage === s).length }));
  const total = items.length;

  return (
    <div style={{ background: total ? '#0c1322' : '#0d1a14', border: `1.5px solid ${total ? '#f59e0b' : '#16351f'}`, borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px 6px' }}>
        <span style={{ fontSize: 30 }}>📐</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: total ? '#f59e0b' : '#22c55e', fontSize: 16, fontWeight: 800 }}>Estimate pipeline</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 3, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '2px 7px' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: '#f59e0b' }} />
            <span style={{ color: '#94a3b8', fontSize: 11 }}>QBO sync offline — tracked here, advance manually</span>
          </div>
        </div>
        <span style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, color: total ? '#f59e0b' : '#22c55e', minWidth: 44, textAlign: 'right' }}>{total}</span>
      </div>

      {/* stage count strip */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 14px 12px' }}>
        {counts.map(({ s, n }) => (
          <div key={s} style={{ flex: 1, textAlign: 'center', background: '#0f1729', border: `1px solid ${n ? STAGE[s].color : '#1e293b'}`, borderRadius: 8, padding: '6px 4px' }}>
            <div style={{ color: n ? STAGE[s].color : '#475569', fontSize: 18, fontWeight: 800 }}>{n}</div>
            <div style={{ color: '#64748b', fontSize: 10 }}>{STAGE[s].label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '0 14px 14px', color: '#475569', fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div style={{ padding: '0 16px 16px', color: '#64748b', fontSize: 12 }}>No estimates in flight.</div>
      ) : (
        <div>
          {items.slice(0, 8).map(it => {
            const st = STAGE[it.stage];
            const busy = busyId === it.id;
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid #1e293b' }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: st.color, flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={rowTitle}>{it.title}</div>
                  <div style={rowSub}>{st.label} · {it.age === 0 ? 'today' : `${it.age}d`}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {st.actions.map(a => (
                    <button key={a.to} disabled={busy} onClick={() => onAdvance(it.id, a.to)} style={{
                      background: a.ghost ? 'transparent' : st.color,
                      color: a.ghost ? '#94a3b8' : '#06121f',
                      border: a.ghost ? '1px solid #334155' : 'none',
                      borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 700,
                      cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, whiteSpace: 'nowrap',
                    }}>{busy ? '…' : a.label}</button>
                  ))}
                </div>
              </div>
            );
          })}
          {total > 8 && <div style={{ padding: '10px 14px', borderTop: '1px solid #1e293b', color: '#f59e0b', fontSize: 13, fontWeight: 700 }}>+ {total - 8} more in pipeline</div>}
        </div>
      )}
    </div>
  );
}

function Row({ title, sub, age, badge }) {
  const u = getAgeUrgency(age);
  return (
    <div style={rowStyle}>
      <span style={{ width: 8, height: 8, borderRadius: 8, background: u.color, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={rowTitle}>{title}</div>
        {sub && <div style={rowSub}>{sub}</div>}
      </div>
      {badge}
      <span style={{ color: u.color, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{age === 0 ? 'today' : `${age}d`}</span>
    </div>
  );
}

function OpenJobRow({ item, onOpen }) {
  return (
    <div onClick={(e) => { e.stopPropagation(); onOpen(item); }} style={{ ...rowStyle, cursor: 'pointer' }}>
      <span style={{ width: 8, height: 8, borderRadius: 8, background: '#ef4444', flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={rowTitle}>{item.title}</div>
        <div style={rowSub}>{item.calName}{item.location ? ` · ${item.location}` : ''}</div>
      </div>
      <span style={{ color: '#f87171', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{item.when}</span>
      <span style={{ color: '#ef4444', fontSize: 18, flexShrink: 0 }}>›</span>
    </div>
  );
}

function TriageCard({ emoji, label, count, accent, items, emptyLabel, onOpen, render, hint }) {
  const hot = count > 0;
  return (
    <button onClick={onOpen} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: hot ? '#0c1322' : '#0d1a14', border: `1.5px solid ${hot ? accent : '#16351f'}`, borderRadius: 16, padding: 0, overflow: 'hidden', boxShadow: hot ? `0 0 0 1px ${accent}22, 0 8px 24px rgba(0,0,0,0.3)` : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px 14px' }}>
        <span style={{ fontSize: 30 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: hot ? accent : '#22c55e', fontSize: 16, fontWeight: 800 }}>{label}</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{hot ? (hint || 'Tap to clear the queue') : emptyLabel}</div>
        </div>
        <span style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, color: hot ? accent : '#22c55e', minWidth: 44, textAlign: 'right' }}>{count}</span>
      </div>
      {hot && (
        <div onClick={(e) => e.stopPropagation()}>
          {items.slice(0, 5).map(render)}
          {count > 5 && <div onClick={onOpen} style={{ padding: '10px 14px', borderTop: '1px solid #1e293b', color: accent, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ {count - 5} more →</div>}
        </div>
      )}
    </button>
  );
}

export default function OpsHome({ userName, isOperator, isRestricted, accessToken, userEmail, onNavigate, onSignOut, onBackfill, onSearch }) {
  const stale = useStaleEvents(accessToken, userEmail);
  const triage = useTriage();
  const estimates = useEstimates();
  const [busyId, setBusyId] = useState(null);

  const openJob = useCallback((item) => {
    onNavigate(`/?cal=${encodeURIComponent(item.calId)}&job=${encodeURIComponent(item.key)}`);
  }, [onNavigate]);

  const advance = useCallback(async (id, toStatus) => {
    setBusyId(id);
    try { await jobsApi.changeStatus(id, toStatus, userEmail); await estimates.reload(); }
    catch (e) { console.error('advance failed', e); }
    finally { setBusyId(null); }
  }, [userEmail, estimates]);

  const refreshAll = useCallback(() => { stale.reload(); triage.reload(); estimates.reload(); }, [stale, triage, estimates]);

  if (isRestricted) return <LeanLauncher userName={userName} onNavigate={onNavigate} onSignOut={onSignOut} />;

  const launchers = [
    { path: '/work',      emoji: '📋', label: 'Work To Do Now', sub: "Today's jobs — log + complete", color: '#22c55e' },
    { path: '/board',     emoji: '🗂️', label: 'Board',          sub: 'Service · Returns · Blocked',   color: '#f59e0b' },
    { path: '/calendar',  emoji: '📅', label: 'Calendar',       sub: 'Every tech, every job',          color: '#60a5fa' },
    { path: '/dashboard', emoji: '📊', label: 'Dashboard',      sub: 'The big picture',                color: '#c084fc' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: NAVY, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/overwatch-logo.png" alt="" style={{ width: 30, height: 30, borderRadius: 7 }} />
          <span style={{ fontWeight: 700, color: TEAL, fontSize: 16 }}>Overwatch</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={refreshAll} title="Refresh" style={iconBtn}>↻</button>
          {isOperator && onBackfill && <button onClick={onBackfill} style={{ ...iconBtn, color: '#f59e0b' }}>🔗</button>}
          <button onClick={onSignOut} style={{ ...iconBtn, padding: '4px 10px' }}>Out</button>
        </div>
      </div>

      <div style={{ padding: '18px 20px 6px' }}>
        <div style={{ color: '#64748b', fontSize: 13 }}>Good to see you,</div>
        <div style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 800 }}>{userName}</div>
      </div>

      <div style={{ padding: '0 20px 10px' }}>
        <button onClick={onSearch} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ fontSize: 16 }}>🔍</span>
          <span style={{ color: '#475569', fontSize: 14 }}>Search customers, jobs, materials…</span>
        </button>
      </div>

      <div style={{ padding: '6px 20px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 0 — OPEN JOBS */}
        {stale.loading ? (
          <div style={skel} />
        ) : (
          <TriageCard emoji="⏰" label="Open jobs — finish these" accent="#ef4444" count={stale.items.length} items={stale.items}
            hint="Past appointments never closed out — tap one to finish" emptyLabel="Every past appointment is closed out"
            onOpen={() => onNavigate('/work')} render={(it) => <OpenJobRow key={it.key} item={it} onOpen={openJob} />} />
        )}

        {/* 1 — RETURNS */}
        {triage.loading ? <div style={skel} /> : (
          <TriageCard emoji="🔄" label="Returns to schedule" accent="#ec4899" count={triage.returns.length} items={triage.returns}
            emptyLabel="No returns waiting — loop is closed" onOpen={() => onNavigate('/scheduler')}
            render={(r) => <Row key={r.key} title={r.title} sub={r.sub} age={r.age}
              badge={<span style={{ fontSize: 10, fontWeight: 700, color: r.source === 'flagged' ? '#ec4899' : '#f59e0b', border: `1px solid ${r.source === 'flagged' ? '#ec4899' : '#f59e0b'}`, borderRadius: 5, padding: '1px 5px' }}>{r.source === 'flagged' ? 'FLAGGED' : 'JOB'}</span>} />} />
        )}

        {/* 2 — ESTIMATE PIPELINE */}
        <EstimatePipeline items={estimates.items} loading={estimates.loading} onAdvance={advance} busyId={busyId} />

        {/* 3 — DONE, NOT BILLED */}
        {triage.loading ? <div style={skel} /> : (
          <TriageCard emoji="💵" label="Done — not billed" accent="#8b5cf6" count={triage.toBill.length} items={triage.toBill}
            emptyLabel="Everything completed is billed" onOpen={() => onNavigate('/billing')}
            render={(b) => <Row key={b.key} title={b.title} age={b.age}
              badge={b.amount ? <span style={{ color: '#8b5cf6', fontSize: 12, fontWeight: 700 }}>${Number(b.amount).toLocaleString()}</span> : null} />} />
        )}
      </div>

      <div style={{ padding: '12px 20px 32px' }}>
        <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', margin: '4px 2px 10px' }}>Go to</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {launchers.map(({ path, emoji, label, sub, color }) => (
            <button key={path} onClick={() => onNavigate(path)} style={{ background: '#0c1322', border: '1px solid #1e293b', borderRadius: 14, padding: '14px', textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ fontSize: 22 }}>{emoji}</div>
              <div style={{ color, fontSize: 14, fontWeight: 700, marginTop: 6 }}>{label}</div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 1 }}>{sub}</div>
            </button>
          ))}
        </div>
        <button onClick={() => onNavigate('/newjob')} style={{ width: '100%', marginTop: 12, background: TEAL, color: '#001018', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>➕  New Job</button>
      </div>
    </div>
  );
}

function LeanLauncher({ userName, onNavigate, onSignOut }) {
  const btns = [
    { path: '/work',   emoji: '📋', label: 'Work To Do Now', sub: "Today's jobs — log notes + complete", color: '#22c55e', dark: '#052e16', border: '#16a34a' },
    { path: '/newjob', emoji: '➕', label: 'New Job',        sub: 'Capture a call or new work',          color: TEAL,      dark: '#001a1f', border: '#0891b2' },
  ];
  return (
    <div style={{ minHeight: '100vh', background: NAVY, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/overwatch-logo.png" alt="" style={{ width: 30, height: 30, borderRadius: 7 }} />
          <span style={{ fontWeight: 700, color: TEAL, fontSize: 16 }}>Overwatch</span>
        </div>
        <button onClick={onSignOut} style={{ ...iconBtn, padding: '4px 10px' }}>Out</button>
      </div>
      <div style={{ padding: '20px 20px 8px', textAlign: 'center' }}>
        <div style={{ color: '#64748b', fontSize: 13 }}>Good to see you,</div>
        <div style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, marginTop: 4 }}>{userName}</div>
      </div>
      <div style={{ padding: '8px 20px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {btns.map(({ path, emoji, label, sub, color, dark, border }) => (
          <button key={path} onClick={() => onNavigate(path)} style={{ background: dark, border: `1px solid ${border}`, borderRadius: 16, padding: '22px 20px', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 18 }}>
            <span style={{ fontSize: 36 }}>{emoji}</span>
            <div>
              <div style={{ color, fontSize: 18, fontWeight: 700 }}>{label}</div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{sub}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: border, fontSize: 20 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const iconBtn = { background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 8px', fontSize: 13, cursor: 'pointer' };
const skel = { height: 86, borderRadius: 16, background: '#0c1322', border: '1px solid #1e293b', opacity: 0.6 };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: '1px solid #1e293b' };
const rowTitle = { color: '#e2e8f0', fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const rowSub = { color: '#64748b', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
