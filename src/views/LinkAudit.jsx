// ============================================================================
// LinkAudit — the calendar and the board must agree, both directions.
// ============================================================================
// THE RULE (Sara's): every event on a tech calendar has a matching ticket in
// Overwatch, and every live ticket has a matching calendar event. When one
// side has something the other doesn't, that is not a silent condition to be
// worked around — it gets flagged and answered.
//
// WHY THIS EXISTS. Two failures, both real, both found the same evening:
//
//   • Shepard Construction, 19 Aug, "Day 2 of 2 of a multi-day job" — a real
//     event on Austin's calendar with NO job row anywhere. He was booked to
//     work a day that Overwatch did not know existed, so there was nothing to
//     disposition against and the hours had nowhere to land.
//
//   • 9 of 38 live jobs carry no calendar event id at all. They sit on the
//     board looking scheduled while no tech has been told to go.
//
// ReconcileView already did one direction of this as a one-time historical
// sweep (SWEEP_FROM June 1, operator-only, /admin/reconcile). It was right.
// It just wasn't standing, and it only looked calendar -> board. This does
// both directions, continuously, over a rolling window.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never auto-creates a job from an event
// or an event from a job. Every fix here is a human answering "what is this?"
// — because the alternative is inventing records to satisfy an invariant, and
// a wrong job row is worse than a flagged gap. The whole reason the data got
// into this state is code that papered over gaps instead of surfacing them.

import { useState, useEffect, useCallback } from 'react';
import { supabase, jobsApi, JOB_STATUS } from '../services/supabase.js';
import { CALENDARS } from '../config/calendars.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// Calendars where a real visit lives. Completed and Sales are excluded: an
// event there is finished business, not an unmatched booking.
const WATCHED = [
  { id: CALENDARS.AUSTIN,        name: 'Austin' },
  { id: CALENDARS.JR,            name: 'JR' },
  { id: CALENDARS.SUBS,          name: 'Subs' },
  { id: CALENDARS.INSTALLATIONS, name: 'Installations' },
  { id: CALENDARS.RETURN_VISITS, name: 'Returns' },
].filter(c => c.id);

// Titles that mean the visit is already closed out, even if it never moved to
// the Completed calendar — the move-to-Completed bug stranded a lot of these.
const DONE_TAGS = /\[\s*(BILL ?IT|BILLED|INVOICED?|COMPLETE[D]?|DONE|PAID|NC|NO ?CHARGE)\s*\]/i;

const LIVE_STATUSES = [
  JOB_STATUS.SCHEDULED,
  JOB_STATUS.RETURN_PENDING,
  JOB_STATUS.READY_TO_SCHEDULE,
  JOB_STATUS.TO_BILL,
].filter(Boolean);

function fmt(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export default function LinkAudit({ accessToken, userEmail, onBack, onOpenJob }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [orphanEvents, setOrphanEvents] = useState([]);   // calendar -> no ticket
  const [unscheduled, setUnscheduled] = useState([]);      // ticket -> no event
  const [days, setDays] = useState(14);
  const [busyId, setBusyId] = useState(null);

  const run = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const since = new Date(); since.setDate(since.getDate() - days);
      const until = new Date(); until.setDate(until.getDate() + days);

      // ── Side A: every job that could be on a calendar ──────────────
      const { data: jobs, error: jErr } = await supabase
        .from('jobs')
        .select('id, customer_name, customer_id, status, scheduled_date, tech_name, calendar_event_id, scheduled_event_id, calendar_id, scheduled_calendar_id')
        .in('status', LIVE_STATUSES)
        .limit(500);
      if (jErr) throw jErr;

      // Every event id the board knows about, from BOTH columns. Checking only
      // one is how Jeanneret looked unmatched — its calendar_event_id and its
      // scheduled_event_id are different values and only one of them was real.
      const known = new Set();
      (jobs || []).forEach(j => {
        if (j.calendar_event_id) known.add(j.calendar_event_id);
        if (j.scheduled_event_id) known.add(j.scheduled_event_id);
      });

      // ── Side B: what is actually on the calendars ─────────────────
      const found = [];
      if (accessToken) {
        for (const cal of WATCHED) {
          const url = `${GCAL}/calendars/${encodeURIComponent(cal.id)}/events`
            + `?timeMin=${since.toISOString()}&timeMax=${until.toISOString()}`
            + `&singleEvents=true&orderBy=startTime&maxResults=250`;
          const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!r.ok) continue;                       // one bad calendar must not kill the sweep
          const body = await r.json();
          (body.items || []).forEach(ev => {
            if (ev.status === 'cancelled') return;
            if (DONE_TAGS.test(ev.summary || '')) return;
            if (known.has(ev.id)) return;
            found.push({
              id: ev.id,
              calendarId: cal.id,
              techName: cal.name,
              title: ev.summary || '(no title)',
              start: ev.start?.dateTime || ev.start?.date || null,
              location: ev.location || null,
              // The intake block stamps CUSTOMER_ID into the description. When
              // present it is the strongest hint about what this event is —
              // and when it disagrees with the title, that mismatch is itself
              // the bug worth seeing. Shepard's 18 Aug event was titled
              // "Jeanerette" while carrying Shepard's customer id.
              customerId: (ev.description || '').match(/CUSTOMER_ID:\s*([0-9a-f-]{36})/i)?.[1] || null,
            });
          });
        }
      }

      // ── Side C: live tickets with nothing on any calendar ─────────
      const noEvent = (jobs || []).filter(j =>
        !j.calendar_event_id && !j.scheduled_event_id
      );

      setOrphanEvents(found);
      setUnscheduled(noEvent);
    } catch (e) {
      setErr(e?.message || String(e));
    }
    setLoading(false);
  }, [accessToken, days]);

  useEffect(() => { run(); }, [run]);

  // Attach an orphan event to an existing job. This is the ONLY write this
  // screen performs, it is always a human decision, and it never invents a
  // job — you pick one that already exists.
  const linkTo = async (ev, jobId) => {
    setBusyId(ev.id);
    try {
      await jobsApi.update(jobId, {
        calendar_event_id: ev.id,
        calendar_id: ev.calendarId,
      }, userEmail);
      await run();
    } catch (e) {
      alert('Link failed: ' + (e?.message || e));
    }
    setBusyId(null);
  };

  const S = {
    wrap:  { padding: 16, color: '#e2e8f0', fontFamily: 'inherit' },
    card:  { background: '#101d31', border: '1px solid #1d2f48', borderRadius: 14,
             padding: 14, marginBottom: 10 },
    h:     { fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
             marginBottom: 10 },
    btn:   { background: 'transparent', border: '1px solid #334155', borderRadius: 8,
             color: '#4b8dff', fontSize: 12.5, fontWeight: 800, padding: '6px 12px',
             cursor: 'pointer', fontFamily: 'inherit' },
  };

  return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={onBack} style={S.btn}>← Back</button>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Link audit</div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          style={{ marginLeft: 'auto', background: '#0b1220', color: '#e2e8f0',
                   border: '1px solid #334155', borderRadius: 8, padding: '6px 10px',
                   fontFamily: 'inherit', fontSize: 13 }}>
          <option value={7}>±7 days</option>
          <option value={14}>±14 days</option>
          <option value={30}>±30 days</option>
        </select>
      </div>

      {loading && <div style={{ color: '#8ea0b8' }}>Checking both sides…</div>}
      {err && <div style={{ color: '#f87171', marginBottom: 12 }}>{err}</div>}
      {!accessToken && !loading && (
        <div style={{ ...S.card, borderLeft: '4px solid #f59e0b' }}>
          No Google token on this session — only the board side was checked.
          Sign in again to sweep the calendars.
        </div>
      )}

      {!loading && (
        <>
          {/* ── ON THE CALENDAR, NOT ON THE BOARD ──────────────────── */}
          <div style={{ ...S.h, color: '#f59e0b' }}>
            On a calendar, no ticket in Overwatch — {orphanEvents.length}
          </div>
          {orphanEvents.length === 0 && (
            <div style={{ ...S.card, color: '#8ea0b8' }}>Nothing unmatched. Both sides agree.</div>
          )}
          {orphanEvents.map(ev => (
            <div key={ev.id} style={{ ...S.card, borderLeft: '4px solid #f59e0b' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{ev.title}</div>
              <div style={{ fontSize: 12.5, color: '#8ea0b8', marginTop: 3 }}>
                {ev.techName} · {fmt(ev.start)}{ev.location ? ` · ${ev.location}` : ''}
              </div>
              {ev.customerId && (
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                  Event carries CUSTOMER_ID {ev.customerId.slice(0, 8)}… — check this matches the title
                  before linking. They have disagreed before.
                </div>
              )}
              <div style={{ marginTop: 9, fontSize: 13, color: '#cbd5e1' }}>
                This exists on the calendar. What is it?
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button style={S.btn} disabled={busyId === ev.id}
                  onClick={() => onOpenJob?.({ mode: 'link', event: ev, onPick: (id) => linkTo(ev, id) })}>
                  Link to an existing ticket
                </button>
                <a href={`https://www.google.com/calendar/event?eid=${btoa(`${ev.id} ${ev.calendarId}`).replace(/=+$/, '')}`}
                   target="_blank" rel="noreferrer" style={{ ...S.btn, textDecoration: 'none', display: 'inline-block' }}>
                  Open on calendar
                </a>
              </div>
            </div>
          ))}

          {/* ── ON THE BOARD, NOT ON ANY CALENDAR ──────────────────── */}
          <div style={{ ...S.h, color: '#38bdf8', marginTop: 22 }}>
            On the board, no calendar event — {unscheduled.length}
          </div>
          {unscheduled.length === 0 && (
            <div style={{ ...S.card, color: '#8ea0b8' }}>Every live ticket is on a calendar.</div>
          )}
          {unscheduled.map(j => (
            <div key={j.id} style={{ ...S.card, borderLeft: '4px solid #38bdf8' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{j.customer_name}</div>
              <div style={{ fontSize: 12.5, color: '#8ea0b8', marginTop: 3 }}>
                {j.status} · {j.tech_name || 'unassigned'}
                {j.scheduled_date ? ` · says ${fmt(j.scheduled_date)}` : ' · no date'}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 7 }}>
                {j.scheduled_date
                  ? 'This has a date but no calendar event, so no tech has actually been told to go — and there is nothing to disposition against afterwards.'
                  : 'Not scheduled anywhere.'}
              </div>
              <button style={{ ...S.btn, marginTop: 8 }} onClick={() => onOpenJob?.({ mode: 'open', jobId: j.id })}>
                Open ticket
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
