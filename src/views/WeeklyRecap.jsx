// ============================================
// WeeklyRecap — the numbers, plus somewhere to put the story
// ============================================
// Sara's ask: "how many events completed, how many locations visited" as real
// numbers, next to the human version — Vineyard was tense but JR held the
// scope, Jeff Godell landed, Mark Anderson was Austin's first bid-to-complete
// win. The app can only ever supply the first part honestly. The numbers
// below are computed from real rows (time_entries — the same table Event
// Audit and Billing already treat as the source of truth for "did work
// actually happen"), not guessed or inferred.
//
// Scheduled/Rescheduled counts are NEW as of this build — schedule.js didn't
// log who booked or rebooked anything before tonight, so there was no way to
// answer "how many did Shana schedule" for any week before this one. Past
// weeks will show 0 for those two numbers, honestly, with a note saying why.
// From here on they're real.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { weekHours, weekScheduled } from '../utils/weekHours.js';
import { supabase, notesApi } from '../services/supabase.js';

const C = {
  bg: '#0b1220', panel: '#131c2e', line: '#243244', text: '#e7edf5',
  muted: '#8fa1b8', accent: '#00c8e8', green: '#22c55e', amber: '#f59e0b', purple: '#a855f7',
};

// Monday-start week containing `d`.
function mondayOf(d) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0);
  return x;
}
function fmt(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

export default function WeeklyRecap({ userEmail, onBack }) {
  const navigate = useNavigate();
  // ── IT OPENS ON THIS WEEK ────────────────────────────────────────────
  // It used to default to LAST full week, on the reasoning that a recap read
  // on a Wednesday is half a week and looks thin. Wrong question: the screen is
  // not a report you publish on Friday, it is the thing you check to see where
  // the week is going while you can still do something about it. Half a week is
  // exactly what you want to see on Wednesday.
  //
  // "It needs to take the user to this week until Sunday, then Monday it will
  //  flow to next week and be empty." That is what this does on its own —
  //  mondayOf(today) rolls at midnight on Monday, and the new week starts
  //  empty because nothing has been logged in it yet. An empty Monday is
  //  correct, not a bug.
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

  // ── NO PAGING BACK INTO NOTHING ──────────────────────────────────────
  // "This just started — no history before [then] should NOT display."
  // Paging back through empty weeks makes the screen look broken and makes
  // anyone reading it wonder whether THIS week is empty for the same reason.
  //
  // The floor is the first week that actually has a time entry, read from the
  // data rather than typed here, so it can never disagree with what loads.
  // Change HISTORY_FLOOR below to pin it to a fixed date instead.
  const HISTORY_FLOOR = null;   // e.g. new Date('2026-07-06') to hard-stop there
  const [earliest, setEarliest] = useState(null);
  useEffect(() => {
    let dead = false;
    supabase.from('time_entries').select('event_start')
      .not('event_start', 'is', null).order('event_start', { ascending: true }).limit(1)
      .then(({ data }) => {
        if (dead || !data?.[0]) return;
        setEarliest(mondayOf(new Date(data[0].event_start)));
      });
    return () => { dead = true; };
  }, []);
  const floorWeek = HISTORY_FLOOR ? mondayOf(HISTORY_FLOOR) : earliest;
  const atFloor = !!floorWeek && weekStart <= floorWeek;

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [scheduleActions, setScheduleActions] = useState([]);
  const [focusText, setFocusText] = useState('');
  const [noteDrafts, setNoteDrafts] = useState({});
  const [savingNoteFor, setSavingNoteFor] = useState(null);
  const [savedNoteFor, setSavedNoteFor] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const startIso = weekStart.toISOString();
      const endIso = weekEnd.toISOString();

      const [{ data: te }, { data: jobs }, { data: hist }] = await Promise.all([
        supabase.from('time_entries')
          .select('id, customer_id, customer_name_raw, event_title, event_start, tech_name, disposition, total_minutes, job_id, archived')
          .gte('event_start', startIso).lt('event_start', endIso)
          .order('event_start', { ascending: true }).limit(1000),
        supabase.from('jobs').select('id, job_type, customer_name, invoiced_amount, estimate_amount'),
        // The recap markers logged by schedule.js — job_history rows with the
        // "📅 RECAP:" prefix. Nothing before this build has these; that's
        // expected, not a bug.
        supabase.from('job_history')
          .select('id, job_id, changed_by, changed_at, notes')
          .gte('changed_at', startIso).lt('changed_at', endIso)
          .ilike('notes', '📅 RECAP:%')
          .limit(1000),
      ]);

      const jobById = Object.fromEntries((jobs || []).map(j => [j.id, j]));
      const live = (te || []).filter(e => !e.archived);
      setEntries(live.map(e => ({ ...e, job: jobById[e.job_id] || null })));
      setScheduleActions(hist || []);

      // THE FIXED-FEE MONEY BLOCK IS GONE.
      // It read estimate_amount, invoiced_amount and a derived $/hr into
      // `contractRows` — and nothing has RENDERED contractRows since 9.78.0,
      // when the panel moved to Billing. A money query feeding a variable no
      // screen displays, kept alive through six versions.
      //
      // It would go anyway: "Overwatch is NOT going to do accounting."
      // Projects are budget / logged / delta, and the roll-up below is hours.
    } catch (e) { console.error('recap load', e); }
    setLoading(false);
  }, [weekStart]);  

  useEffect(() => { load(); }, [load]);

  // ── THE HOURS ROLL-UP ────────────────────────────────────────────────
  // Same function the home tiles use, so the recap and the tiles can never
  // report a different week. weekStart is already a Monday, and weekBounds of
  // a Monday returns that Monday — so paging back a week rolls this up too.
  const [wk, setWk] = useState(null);
  const [sched, setSched] = useState(null);
  useEffect(() => {
    let dead = false;
    weekHours(weekStart).then(r => { if (!dead) setWk(r); }).catch(() => {});
    weekScheduled(weekStart).then(r => { if (!dead) setSched(r); }).catch(() => {});
    return () => { dead = true; };
  }, [weekStart]);

  // ── The real numbers ─────────────────────────────────────────────────
  // COMPLETE WORK — anything the tech flagged To Bill. The word "completed"
  // was doing two jobs: it is not complete in the money sense (that is
  // is_complete, and billing says so), it is complete in the DOING sense.
  const completed = entries.filter(e => e.disposition === 'bill_it');
  // RETURNS — anything flagged as a return. Work that happened and cannot be
  // invoiced until somebody goes back, which is the number that says whether a
  // busy week actually produced anything.
  const returns = entries.filter(e => e.disposition === 'return');
  // CUSTOMERS — unique customers seen. Keyed on customer_id first (most stable),
  // then customer_name_raw. We deliberately exclude bare event_title entries —
  // those are unlinked calendar events with no customer attached, and counting
  // every event title as a "customer" was inflating the number wildly (30 last
  // week was mostly calendar noise, not 30 real clients).
  const customerKeys = new Set(entries.map(e =>
    e.customer_id || (e.customer_name_raw || '').trim().toLowerCase()
  ).filter(Boolean));
  const sumH = (rows) => Math.round((rows.reduce((t, e) => t + (e.total_minutes || 0), 0) / 60) * 10) / 10;

  // CUSTOMER DRILL-DOWN — group entries by customer for the week view.
  // Reuses already-loaded `entries`; no second query.
  const [customerDrillOpen, setCustomerDrillOpen] = useState(false);
  const customerGroups = useMemo(() => {
    const groups = {};
    entries.forEach(e => {
      const key = e.customer_id || (e.customer_name_raw || '').trim().toLowerCase();
      if (!key) return; // skip unlinked entries (no customer attached)
      const name = e.job?.customer_name || e.customer_name_raw || e.event_title || String(key);
      if (!groups[key]) groups[key] = { key, name, jobId: e.job_id, entries: [] };
      // Prefer the job_id from a job-linked entry if we have one
      if (e.job_id && !groups[key].jobId) groups[key].jobId = e.job_id;
      groups[key].entries.push(e);
    });
    return Object.values(groups).sort((a, b) => sumH(b.entries) - sumH(a.entries));
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // INVOICED THIS WEEK — sum invoiced_amount for unique jobs that have
  // bill_it entries during the week. "Invoiced" here means the dollars
  // the job carries, not that the invoice was sent precisely this week —
  // it answers "what's the dollar value of the work we completed?"
  const invoicedJobIds = [...new Set(completed.map(e => e.job_id).filter(Boolean))];
  const invoicedTotal = invoicedJobIds.reduce((sum, jid) => {
    const j = entries.find(e => e.job_id === jid)?.job;
    return sum + (Number(j?.invoiced_amount) || 0);
  }, 0);
  const fmtDollars = (n) => n > 0
    ? '$' + Math.round(n).toLocaleString('en-US')
    : null;
  // SERVICE CALLS IS GONE. It guessed — job_type 'service' OR no job at all —
  // and "no job at all" is not a service call, it is an unlinked entry. There
  // is no service-call flag today, so the card was counting a thing that does
  // not exist. Nothing replaces it until something actually marks it.

  const byPerson = (verb) => {
    const counts = {};
    scheduleActions
      .filter(h => h.notes?.includes(`RECAP: ${verb}`))
      .forEach(h => { const who = h.changed_by || 'unknown'; counts[who] = (counts[who] || 0) + 1; });
    return counts;
  };
  const scheduledBy = byPerson('Scheduled');
  const rescheduledBy = byPerson('Rescheduled');
  const heldBy = byPerson('Held');
  const hasAnyScheduleData = scheduleActions.length > 0;

  const saveNote = async (jobId) => {
    const text = (noteDrafts[jobId] || '').trim();
    if (!text || !jobId) return;
    setSavingNoteFor(jobId);
    try {
      await notesApi.addNote(jobId, `📝 Weekly recap note: ${text}`, userEmail || 'recap');
      setSavedNoteFor(m => ({ ...m, [jobId]: true }));
    } catch (e) { alert('Could not save note: ' + (e.message || e)); }
    setSavingNoteFor(null);
  };

  const copyRecap = () => {
    const lines = [];
    lines.push(`Weekly Recap — ${fmt(weekStart)} to ${fmt(new Date(weekEnd - 86400000))}`);
    lines.push('');
    const invoicedStr = fmtDollars(invoicedTotal);
    lines.push(`✅ ${completed.length} complete work  ·  🔄 ${returns.length} returns  ·  📍 ${customerKeys.size} customers${invoicedStr ? `  ·  💰 ${invoicedStr} invoiced` : ''}`);
    if (wk) lines.push(`⏱ ${wk.total}h logged — ${wk.project}h project · ${wk.returns}h return · ${wk.billable}h to bill · ${wk.other}h in progress`);
    if (hasAnyScheduleData) {
      const fmtCounts = (obj) => Object.entries(obj).map(([k, v]) => `${k.split('@')[0]}: ${v}`).join(', ') || '—';
      lines.push(`📅 Scheduled — ${fmtCounts(scheduledBy)}`);
      lines.push(`🔁 Rescheduled — ${fmtCounts(rescheduledBy)}`);
    }
    lines.push('');
    if (completed.length) {
      lines.push('Completed this week:');
      completed.forEach(e => lines.push(`  • ${e.job?.customer_name || e.customer_name_raw || e.event_title || 'Unnamed'} (${e.tech_name || 'no tech'})`));
      lines.push('');
    }
    if (focusText.trim()) {
      lines.push('This week\'s focus:');
      lines.push(focusText.trim());
    }
    navigator.clipboard?.writeText(lines.join('\n'));
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 0, background: C.bg, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: C.muted, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>← Home</button>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Weekly Recap</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => { if (!atFloor) setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; }); }}
            disabled={atFloor}
            title={atFloor ? 'Nothing was logged before this week' : ''}
            style={{ background: 'none', border: `1px solid ${C.line}`, color: atFloor ? '#3a4658' : C.text, borderRadius: 8, padding: '6px 12px', cursor: atFloor ? 'default' : 'pointer' }}>←</button>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(weekStart)} – {fmt(new Date(weekEnd - 86400000))}</div>
          <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
            disabled={weekEnd > new Date()}
            style={{ background: 'none', border: `1px solid ${C.line}`, color: weekEnd > new Date() ? '#3a4658' : C.text, borderRadius: 8, padding: '6px 12px', cursor: weekEnd > new Date() ? 'default' : 'pointer' }}>→</button>
          <button onClick={() => navigate('/projects')}
            style={{ marginLeft: 'auto', background: C.panel, border: `1px solid ${C.line}`, color: C.text, fontWeight: 700, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>
            📊 Projects
          </button>
          <button onClick={copyRecap}
            style={{ background: C.accent, border: 'none', color: '#08121f', fontWeight: 800, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>
            📋 Copy recap
          </button>
        </div>
      </div>

      <div style={{ padding: 18, maxWidth: 760, margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 60 }}>Loading…</div>
        ) : (
          <>
            {/* ── The real numbers ── */}
            {/* THE CARDS ARE DOORS, not read-outs.
                "Return hours — just the number and the hours sum, and it's
                clickable, so you see the UI you made." Each card counts
                something on this screen and opens the Billing bucket that
                holds it, so the number and the list behind it can never be two
                different answers. Customers opens the client list. */}
            <div style={{ display: 'grid', gap: 10, marginBottom: 16,
                          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              {[
                { n: completed.length, h: sumH(completed), label: 'complete work', color: C.green,
                  to: '/unbilled?tab=ready' },
                { n: returns.length, h: sumH(returns), label: 'return hours', color: '#ec4899',
                  to: '/unbilled?tab=return' },
                { n: customerKeys.size, label: 'customers', color: customerDrillOpen ? '#fff' : C.accent,
                  bg: customerDrillOpen ? C.accent : undefined,
                  onTap: () => setCustomerDrillOpen(v => !v) },
                { n: wk ? `${wk.project}h` : '—', label: 'project hours', color: '#8b5cf6',
                  to: '/unbilled?tab=project' },
                { n: sched ? sched.booked : '—', label: 'scheduled',
                  sub: sched ? `${sched.logged} of ${sched.booked} submitted` : null,
                  color: sched && sched.missing ? C.amber : C.muted, to: '/calendar' },
                { n: fmtDollars(invoicedTotal) || '—', label: 'invoiced', color: C.green,
                  to: '/unbilled?tab=ready' },
              ].map((s, i) => (
                <button key={i} onClick={() => s.onTap ? s.onTap() : s.to && navigate(s.to)}
                  style={{ background: s.bg || C.panel, border: `1px solid ${s.bg ? s.bg : C.line}`, borderRadius: 14,
                           padding: '16px 14px', textAlign: 'center', cursor: (s.to || s.onTap) ? 'pointer' : 'default',
                           color: C.text, fontFamily: 'inherit' }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: s.color }}>{s.n}</div>
                  <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 }}>{s.label}</div>
                  {s.h != null && (
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: s.color, marginTop: 3 }}>{s.h}h</div>
                  )}
                  {s.sub && (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{s.sub}</div>
                  )}
                </button>
              ))}
            </div>

            {/* ── CUSTOMER WEEK VIEW ─────────────────────────────────────────
                Clicking "customers" opens this panel instead of navigating away.
                Same data as the cards above — no second query — just grouped
                by customer and sorted by total hours. Entries are read-only
                (this is a history view, not billing). Each customer name links
                to the job board card so you can navigate into it. */}
            {customerDrillOpen && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>
                    Customers this week — {customerGroups.length}
                  </span>
                  <button onClick={() => setCustomerDrillOpen(false)}
                    style={{ background: 'none', border: `1px solid ${C.line}`, color: C.muted,
                             borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
                    ✕ Close
                  </button>
                </div>
                {customerGroups.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.muted }}>No customer-linked entries this week.</div>
                ) : customerGroups.map(g => {
                  const gh = sumH(g.entries);
                  return (
                    <div key={g.key}
                      style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12,
                               padding: '12px 14px', marginBottom: 8 }}>
                      {/* Customer header — name links to job if one exists */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                        <button
                          onClick={() => g.jobId ? navigate(`/board?job=${g.jobId}`) : null}
                          style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
                                   fontSize: 14, fontWeight: 800,
                                   color: g.jobId ? C.accent : C.text,
                                   cursor: g.jobId ? 'pointer' : 'default',
                                   textAlign: 'left' }}>
                          {g.name}
                        </button>
                        <span style={{ fontSize: 12, color: C.muted, flexShrink: 0, marginLeft: 10 }}>
                          {gh}h
                        </span>
                      </div>
                      {/* Entry rows */}
                      {g.entries.map(e => {
                        const mins = e.total_minutes || 0;
                        const hrs = Math.round(mins / 60 * 10) / 10;
                        const disp = e.billed
                          ? { text: 'Billed',      color: C.muted }
                          : e.disposition === 'bill_it'
                            ? { text: 'To Bill',   color: C.green }
                            : e.disposition === 'return'
                              ? { text: 'Return',  color: '#ec4899' }
                              : { text: 'In Progress', color: C.amber };
                        const dateStr = e.event_start
                          ? new Date(e.event_start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                          : '—';
                        return (
                          <div key={e.id}
                            style={{ display: 'flex', gap: 8, alignItems: 'center',
                                     fontSize: 12, color: C.muted, padding: '5px 0',
                                     borderTop: `1px solid ${C.line}` }}>
                            <span style={{ flex: '0 0 90px', color: '#64748b' }}>{dateStr}</span>
                            <span style={{ flex: 1 }}>{e.tech_name || '—'}</span>
                            <span style={{ fontWeight: 700, color: C.text }}>{hrs}h</span>
                            <span style={{ fontWeight: 700, color: disp.color, flex: '0 0 80px', textAlign: 'right' }}>{disp.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Scheduled / rescheduled by person ── */}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Scheduled &amp; rescheduled</div>
              {!hasAnyScheduleData ? (
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                  No tracking exists for weeks before this build — booking actions weren't
                  logged by person until now. This will be real starting with the current week.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  {Object.entries(scheduledBy).map(([who, n]) => (
                    <div key={'s' + who}><b style={{ color: C.accent }}>{who.split('@')[0]}</b> scheduled <b>{n}</b> job{n > 1 ? 's' : ''}</div>
                  ))}
                  {Object.entries(rescheduledBy).map(([who, n]) => (
                    <div key={'r' + who}><b style={{ color: C.amber }}>{who.split('@')[0]}</b> rescheduled <b>{n}</b> job{n > 1 ? 's' : ''}</div>
                  ))}
                  {Object.entries(heldBy).map(([who, n]) => (
                    <div key={'h' + who}><b style={{ color: C.purple }}>{who.split('@')[0]}</b> held <b>{n}</b> slot{n > 1 ? 's' : ''}</div>
                  ))}
                </div>
              )}
            </div>

            {/* ── HOURS, THIS WEEK ─────────────────────────────────────
                Counts the hours behind the visit cards above and says what
                state each hour is in. Every logged hour lands in exactly one
                bucket — the contract outranks the disposition, so a project
                hour marked bill_it still shows as "project / covered."

                BUCKET MEANING (honest labels):
                  Ready to invoice  — tech said bill it, nobody has sent the invoice yet
                  Already invoiced  — time_entry.billed=true (invoice was sent)
                  Return visit      — can't invoice; going back
                  Project / covered — fixed-fee or project job; this is COST, not revenue
                  On open jobs      — hours logged on a job that's still in progress;
                                      tech hasn't said bill_it or return yet because
                                      the work isn't finished. These move once the job
                                      closes — not a billing action item today. */}
            {wk && wk.total > 0 && (
              <div style={{ background: C.panel, border: `1px solid ${C.line}`,
                            borderRadius: 14, padding: '13px 15px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.08em',
                                 textTransform: 'uppercase', color: C.muted }}>Hours logged this week</span>
                  <span style={{ fontSize: 20, fontWeight: 900 }}>{wk.total}h</span>
                  <span style={{ fontSize: 11.5, color: C.muted }}>
                    across {wk.visits} visit{wk.visits === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {[
                    { n: wk.billable, label: 'ready to invoice', c: C.green },
                    { n: wk.returns,  label: 'return visit',     c: '#ec4899' },
                    { n: wk.project,  label: 'project / covered',c: '#8b5cf6' },
                    { n: wk.other,    label: 'on open jobs',     c: C.amber },
                    { n: wk.settled,  label: 'already invoiced', c: C.muted },
                  ].filter(x => x.n > 0).map(x => (
                    <div key={x.label}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: x.c }}>{x.n}h</div>
                      <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase',
                                    letterSpacing: '.04em', lineHeight: 1.3 }}>{x.label}</div>
                    </div>
                  ))}
                </div>
                {wk.other > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
                    "On open jobs" = hours logged on jobs not yet closed — tech is still working.
                    These move to "ready to invoice" or "return" when the job is resolved.
                  </div>
                )}
                {wk.unlinked > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${C.line}`,
                                fontSize: 12, color: C.amber, fontWeight: 700 }}>
                    ⚠️ {wk.unlinkedHours}h across {wk.unlinked} visit{wk.unlinked === 1 ? '' : 's'} has no job attached — it can't reach an invoice or a project
                  </div>
                )}
              </div>
            )}

            {/* Fixed fee moved to Billing (9.78.0). This is a look-back
                screen; a project you are still entering numbers against and
                still deciding how to invoice belongs where the billing
                happens. ── */}

            {/* ── Completed jobs — pick some to add the human story to ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                Complete work this week ({completed.length})
              </div>
              {completed.length === 0 ? (
                <div style={{ fontSize: 12, color: C.muted }}>Nothing marked done this week.</div>
              ) : completed.map(e => (
                <div key={e.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{e.job?.customer_name || e.customer_name_raw || e.event_title || 'Unnamed'}</div>
                    <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{e.tech_name || 'no tech'}</div>
                  </div>
                  {e.job_id && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      <input value={noteDrafts[e.job_id] || ''} onChange={ev => setNoteDrafts(m => ({ ...m, [e.job_id]: ev.target.value }))}
                        placeholder="Add the story — client happy? first win? tight scope call?"
                        style={{ flex: 1, background: '#0f1729', border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 12, outline: 'none' }} />
                      <button onClick={() => saveNote(e.job_id)} disabled={savingNoteFor === e.job_id || !noteDrafts[e.job_id]?.trim()}
                        style={{ background: savedNoteFor[e.job_id] ? '#22c55e33' : '#1e293b', border: `1px solid ${C.line}`, color: savedNoteFor[e.job_id] ? C.green : C.muted,
                                 borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {savedNoteFor[e.job_id] ? 'Saved ✓' : savingNoteFor === e.job_id ? '…' : 'Save to job'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── This week's focus — freeform, not persisted ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>This week's focus</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                Not saved anywhere yet — write it, then hit Copy recap at the top before you leave this page.
              </div>
              <textarea value={focusText} onChange={e => setFocusText(e.target.value)} rows={4}
                placeholder="x, y, z…"
                style={{ width: '100%', boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, color: C.text, padding: '10px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
