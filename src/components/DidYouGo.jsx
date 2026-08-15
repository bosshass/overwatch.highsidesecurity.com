// ============================================================================
// DidYouGo.jsx — three taps, and the day stops being a hole.
//
// Nine of JR's visits in three weeks produced no time entry. Not because he
// skipped them — he went — but because dispositioning is more work than a
// text, so the text wins and the hours never reach an invoice. At roughly
// $125/hr that is about $5,000 sitting in nobody's memory.
//
// So this asks the shortest possible question, on the screen he already opens:
//
//   "You were at TAE WON SUH on Thursday. Did you go?"
//        [ Yes ] [ No ]
//
// Yes  -> how long, one tap from a row of common answers, then done.
// No   -> why, four buttons, then done.
//
// Either way it writes a time_entry, which is the only thing that turns a day
// into money. Nothing here asks for a customer, a job, a disposition or a
// note — every one of those is already known or can wait.
//
// WHO SEES IT: office logins only (info@ and jr@). Austin dispositions his own
// work at 100%; putting a nag in front of him would be punishing the person
// who is already doing it right.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { DISPOSITIONS } from '../utils/billing.js';

// The people this is for. Austin is deliberately absent.
const ASKS = ['info@drhsecurityservices.com', 'jr@drhsecurityservices.com'];

// Hours a service call actually takes, so the common case is one tap.
const QUICK_HOURS = [0.5, 1, 1.5, 2, 3, 4, 6, 8];

const NOT_REASONS = [
  { key: 'rescheduled', label: 'Rescheduled',      note: 'Rescheduled — did not go.' },
  { key: 'cancelled',   label: 'They cancelled',   note: 'Customer cancelled.' },
  { key: 'no_access',   label: "Couldn't get in",  note: 'No access on arrival.' },
  { key: 'someone_else',label: 'Someone else went',note: 'Covered by another tech.' },
];

// ── SKIP THAT STICKS ────────────────────────────────────────────────────────
// "Skip for now" only advanced an index, so every reload put the same visit
// back at the front. A prompt that ignores being dismissed gets dismissed
// permanently — by the person closing the app.
//
// A skip is good until tomorrow, not forever. The visit is still money that
// never reached an invoice; it deserves to be asked again, just not four times
// in one morning. Stored per browser rather than in a table: skipping is a
// scratch preference, and giving it a schema means migrating it later.
const SKIP_KEY = 'didyougo_skips';
const todayStr = () => new Date().toLocaleDateString('en-CA');

const readSkips = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SKIP_KEY) || '{}');
    const today = todayStr();
    // Yesterday's skips are dropped on read, so the store never grows.
    return Object.fromEntries(Object.entries(raw).filter(([, d]) => d === today));
  } catch { return {}; }
};

const clearSkips = () => { try { localStorage.removeItem(SKIP_KEY); } catch { /* nothing to clear */ } };
const skipCount = () => Object.keys(readSkips()).length;

const addSkip = (jobId) => {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify({ ...readSkips(), [jobId]: todayStr() }));
  } catch { /* no storage — skip stays session-only, which is the old behaviour */ }
};

const dayName = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const days = Math.round((new Date().setHours(0,0,0,0) - dt.getTime()) / 86400000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `on ${dt.toLocaleDateString('en-US', { weekday: 'long' })}`;
  return `on ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};

export default function DidYouGo({ userEmail, userName, onDone }) {
  const [queue, setQueue] = useState([]);
  const [i, setI] = useState(0);
  const [asking, setAsking] = useState(null);   // null | 'hours' | 'finish' | 'why'
  const [busy, setBusy] = useState(false);
  // Hours alone are not a record. A visit with no note cannot be invoiced —
  // nobody can write a line item from "3h" — and with no disposition it does
  // not know whether it is billable, a return, or mid-job. Both are asked
  // for, and neither is optional, on the yes path only.
  const [mins, setMins] = useState(0);
  const [note, setNote] = useState('');
  const [dispoKey, setDispoKey] = useState('bill_it');

  const mine = ASKS.includes((userEmail || '').toLowerCase());

  const load = useCallback(async () => {
    if (!mine) return;

    // A visit that was scheduled, has passed, and produced no hours.
    //
    // THREE THINGS HAVE TO BE TRUE, and each one is here because asking without
    // it produces a question nobody can answer:
    //
    //   customer_id      — "did you go?" about a row with no customer is
    //                      unanswerable, and the entry it would write could
    //                      never be invoiced to anyone.
    //   calendar_event_id — somebody actually booked this. A job with a date
    //                      typed on it and no event was never on anyone's
    //                      calendar, so nobody was told to go.
    //   at least 24h old  — today's work is not late. Asking at 4pm about a
    //                      9am visit that is still running is noise, and noise
    //                      is how a prompt like this gets ignored.
    //
    // Ten days back at the far end: past that a person is guessing, and a
    // guess in time_entries is worse than a gap.
    const since = new Date(); since.setDate(since.getDate() - 10);
    const sinceStr = since.toISOString().slice(0, 10);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 1);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, customer_id, customer_name, scheduled_date, tech_name, issue, calendar_event_id, calendar_id')
      .gte('scheduled_date', sinceStr)
      .lte('scheduled_date', cutoffStr)
      .not('customer_id', 'is', null)
      .not('calendar_event_id', 'is', null)
      .in('status', ['scheduled', 'ready_to_schedule', 'return_pending', 'new'])
      .order('scheduled_date', { ascending: true })
      .limit(40);

    if (!jobs?.length) { setQueue([]); return; }

    // Drop anything that already has hours against it — by job, and by
    // customer-and-day, because 171 entries have no job_id and asking about a
    // visit somebody already logged is how you teach people to ignore this.
    const ids = jobs.map(j => j.id);
    const custs = [...new Set(jobs.map(j => j.customer_id).filter(Boolean))];
    const { data: entries } = await supabase
      .from('time_entries')
      .select('job_id, customer_id, event_start')
      .or(`job_id.in.(${ids.join(',')}),customer_id.in.(${custs.join(',')})`)
      .limit(500);

    const byJob = new Set((entries || []).map(e => e.job_id).filter(Boolean));
    const byDay = new Set((entries || [])
      .filter(e => e.customer_id && e.event_start)
      .map(e => `${e.customer_id}|${String(e.event_start).slice(0, 10)}`));

    const skipped = readSkips();

    setQueue(jobs.filter(j =>
      !byJob.has(j.id) &&
      !byDay.has(`${j.customer_id}|${j.scheduled_date}`) &&
      !skipped[j.id]
    ));
    setI(0);
  }, [mine]);

  useEffect(() => { load(); }, [load]);

  const job = queue[i];
  const next = () => { setAsking(null); setI(n => n + 1); };

  const write = async (minutes, noteText, disposition) => {
    if (!job || busy) return;
    setBusy(true);
    const start = new Date(`${job.scheduled_date}T09:00:00`);
    const { error } = await supabase.from('time_entries').insert({
      customer_id:       job.customer_id,
      customer_name_raw: job.customer_name || '',
      job_id:            job.id,
      tech_name:         job.tech_name || userName || null,
      tech_email:        userEmail,
      total_minutes:     minutes,
      event_start:       start.toISOString(),
      event_title:       job.customer_name || 'Visit',
      calendar_event_id: job.calendar_event_id || `didyougo-${job.id}`,
      calendar_id:       job.calendar_id || 'didyougo',
      entry_method:      'manual',
      disposition:       disposition || (minutes > 0 ? 'bill_it' : 'in_progress'),
      notes:             noteText,
      billed:            false,
      archived:          minutes > 0 ? false : true,
      archive_reason:    minutes > 0 ? null : 'did not go',
    });
    setBusy(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    setMins(0); setNote(''); setDispoKey('bill_it');
    next();
  };

  // EMPTY QUEUE IS NOT ALWAYS EMPTY. Skipping removed items from the queue and
  // this returned null, so skipping everything made the whole card vanish with
  // no way back until tomorrow. A skip the user cannot undo is a delete.
  if (!mine) return null;
  if (!job) {
    const n = skipCount();
    if (!n) return null;
    return (
      <div style={{ background: '#111f34', border: '1px solid #263a55', borderRadius: 14,
                    padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: '#8ea0b8' }}>
          {n} visit{n === 1 ? '' : 's'} skipped today
        </span>
        <button onClick={() => { clearSkips(); load(); }}
          style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #263a55',
                   borderRadius: 8, color: '#4b8dff', fontSize: 12.5, fontWeight: 800,
                   padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Bring them back
        </button>
      </div>
    );
  }

  const remaining = queue.length - i;

  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b', borderLeft: '4px solid #f59e0b',
      borderRadius: 14, padding: '16px 18px', marginBottom: 16, color: '#e2e8f0',
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
                    color: '#f59e0b', marginBottom: 8 }}>
        {remaining > 1 ? `${remaining} days to close out` : 'One day to close out'}
      </div>

      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.35, marginBottom: 3 }}>
        You were at {job.customer_name || 'a customer'} {dayName(job.scheduled_date)}.
      </div>
      {job.issue && (
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14, lineHeight: 1.45 }}>
          {String(job.issue).replace(/\s+/g, ' ').slice(0, 110)}
        </div>
      )}

      {asking === null && (
        <>
          <div style={{ fontSize: 15, marginBottom: 10 }}>Did you go?</div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button onClick={() => setAsking('hours')}
              style={{ flex: 2, padding: '13px 0', borderRadius: 10, border: 'none',
                       background: '#22c55e', color: '#052e16', fontSize: 16, fontWeight: 800,
                       cursor: 'pointer', fontFamily: 'inherit' }}>
              Yes
            </button>
            <button onClick={() => setAsking('why')}
              style={{ flex: 1, padding: '13px 0', borderRadius: 10, cursor: 'pointer',
                       background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
                       fontSize: 16, fontWeight: 700, fontFamily: 'inherit' }}>
              No
            </button>
          </div>
          <button onClick={() => { addSkip(job.id); next(); }}
            style={{ marginTop: 10, background: 'none', border: 'none', color: '#475569',
                     fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            Skip — ask me tomorrow
          </button>
        </>
      )}

      {asking === 'hours' && (
        <>
          <div style={{ fontSize: 15, marginBottom: 10 }}>How long were you there?</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {QUICK_HOURS.map(h => (
              <button key={h} disabled={busy}
                onClick={() => { setMins(Math.round(h * 60)); setAsking('finish'); }}
                style={{ flex: '1 0 20%', padding: '13px 0', borderRadius: 10, cursor: 'pointer',
                         background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                         fontSize: 16, fontWeight: 800, fontFamily: 'inherit' }}>
                {h}h
              </button>
            ))}
          </div>
          <button onClick={() => setAsking(null)}
            style={{ marginTop: 10, background: 'none', border: 'none', color: '#475569',
                     fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            Back
          </button>
        </>
      )}

      {asking === 'finish' && (
        <>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>
            {mins / 60} {mins === 60 ? 'hour' : 'hours'} on site.
            {' '}
            <button onClick={() => setAsking('hours')}
              style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: 13,
                       cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>change</button>
          </div>

          <div style={{ fontSize: 15, marginBottom: 8 }}>What did you do?</div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Swapped the keypad, tested comms, all good."
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9,
                     border: `1px solid ${note.trim().length >= 3 ? '#334155' : '#7f1d1d'}`,
                     background: '#0b1220', color: '#e2e8f0', fontSize: 14,
                     fontFamily: 'inherit', resize: 'vertical' }} />

          <div style={{ fontSize: 15, margin: '14px 0 8px' }}>Where does it go?</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {Object.values(DISPOSITIONS).map(d => {
              const on = dispoKey === d.key;
              return (
                <button key={d.key} onClick={() => setDispoKey(d.key)}
                  title={d.means}
                  style={{ flex: '1 0 45%', padding: '11px 8px', borderRadius: 9, cursor: 'pointer',
                           background: on ? d.color : 'transparent',
                           border: `1px solid ${on ? d.color : '#334155'}`,
                           color: on ? '#08131f' : '#94a3b8',
                           fontSize: 13.5, fontWeight: 800, fontFamily: 'inherit' }}>
                  {d.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
            {DISPOSITIONS[dispoKey]?.means}
          </div>

          <button
            disabled={busy || note.trim().length < 3}
            onClick={() => write(mins, note.trim(), dispoKey)}
            style={{ width: '100%', marginTop: 14, padding: '13px 0', borderRadius: 10, border: 'none',
                     background: note.trim().length >= 3 ? '#22c55e' : '#1e293b',
                     color: note.trim().length >= 3 ? '#052e16' : '#475569',
                     fontSize: 16, fontWeight: 800,
                     cursor: note.trim().length >= 3 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            {busy ? 'Saving…' : 'Done'}
          </button>
          <button onClick={() => setAsking(null)}
            style={{ marginTop: 10, background: 'none', border: 'none', color: '#475569',
                     fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            Back
          </button>
        </>
      )}

      {asking === 'why' && (
        <>
          <div style={{ fontSize: 15, marginBottom: 10 }}>What happened?</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {NOT_REASONS.map(r => (
              <button key={r.key} disabled={busy}
                onClick={() => write(0, r.note, 'in_progress')}
                style={{ flex: '1 0 45%', padding: '13px 8px', borderRadius: 10, cursor: 'pointer',
                         background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                         fontSize: 14, fontWeight: 700, fontFamily: 'inherit' }}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => setAsking(null)}
            style={{ marginTop: 10, background: 'none', border: 'none', color: '#475569',
                     fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            Back
          </button>
        </>
      )}
    </div>
  );
}
