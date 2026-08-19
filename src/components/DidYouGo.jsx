// ============================================================================
// DidYouGo.jsx — the prompt, not the form.
//
// Nine of JR's visits in three weeks produced no time entry. Not because he
// skipped them — he went — but because dispositioning is more work than a
// text, so the text wins and the hours never reach an invoice. At roughly
// $125/hr that is about $5,000 sitting in nobody's memory.
//
// WHAT CHANGED (2026-08-18). This file used to own a second, parallel way to
// record a visit: its own queue rule, its own supabase insert, its own idea of
// what a disposition meant. That produced entries the rest of the app could not
// see. Specifically it wrote:
//
//   • calendar_event_id: `didyougo-${job.id}`  — a synthetic id matching no
//     real calendar event, so every downstream join dropped the row silently
//   • calendar_id: 'didyougo'                  — likewise
//   • event_start: hardcoded 09:00             — not when the visit happened
//   • no time_in / time_out, no photos, no materials, no calendar tag
//   • archived: true + archive_reason 'did not go' for a no-show, which put
//     rows in the hours table whose only purpose was to be filtered back out
//
// Meanwhile JobFinishSheet — the canonical sheet — wrote all of those fields
// correctly. Same action, two forms, two shapes of truth. A visit closed here
// looked unclosed everywhere else.
//
// So this is now a QUEUE and a LAUNCHER. It decides who to ask (visitsOwed)
// and hands the chosen job to JobFinishSheet, which is the only thing in the
// app that writes a time entry. No insert lives in this file any more.
//
// "Didn't go" is not a special case either. It is the 'return' disposition
// with zero minutes: the work is still owed, somebody has to go back, and the
// sheet already writes the return_card, flips the job to return_pending, tags
// the calendar [RETURN] and REQUIRES a reason. That is exactly the behaviour
// wanted — mandatory note, lands on the board, schedulable — and it already
// existed. It did not need reinventing here.
//
// SKIP IS GONE. Every prompt now exits through a disposition. A skip that
// suppressed the card taught people the card was optional, and the visit went
// back to being invisible — which is the whole problem this was built for.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { visitsOwed } from '../utils/visitsOwed.js';
import { canonicalEmail, NAME_BY_EMAIL } from '../utils/ownership.js';

// WHO GETS ASKED WHETHER THEY WENT.
// This was info@ and jr@ ONLY, which meant the prompt built to catch visits
// that never became hours had never once asked AUSTIN — 160 time entries and
// 324 logged hours, the tech doing most of the field work. Trevor was missing
// too.
//
// That also reframes what the data was saying: the nine undispositioned past
// visits that all looked like JR's were all JR's BECAUSE HE WAS THE ONLY TECH
// BEING ASKED. Austin's would never have surfaced through this path at all.
//
// Subs deliberately left off — sub hours are somebody else's invoice and that
// flow has not been worked out yet.
export const ASKS = [
  'info@drhsecurityservices.com',
  'jr@drhsecurityservices.com',
  'austin@drhsecurityservices.com',
  'drhservicetech1@gmail.com',        // Austin's actual sign-in
  'trevor@drhsecurityservices.com',
  'admin@jnbservice.com',
  'sara@jnbllc.com',
  'sara@drhsecurityservices.com',
];

function dayName(d) {
  if (!d) return 'recently';
  const dt = new Date(`${String(d).slice(0, 10)}T12:00:00`);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const age = (Date.now() - dt.getTime()) / 86400000;
  if (age < 2) return 'yesterday';
  if (age < 7) return `on ${days[dt.getDay()]}`;
  return `on ${dt.getMonth() + 1}/${dt.getDate()}`;
}

/**
 * @param {string}   userEmail
 * @param {string}   userName
 * @param {function} onOpenSheet  (job) => void — parent renders JobFinishSheet.
 *                                Kept as a callback rather than rendering the
 *                                sheet here so there is ONE mount point per
 *                                screen; two sheets fighting over the same
 *                                event is its own bug.
 */
export default function DidYouGo({ userEmail, userName, onOpenSheet }) {
  const [queue, setQueue] = useState([]);
  const [i, setI] = useState(0);
  const [loading, setLoading] = useState(true);

  const email = canonicalEmail(userEmail) || userEmail;
  const mine = ASKS.includes(String(email || '').toLowerCase());

  const load = useCallback(async () => {
    if (!mine) { setQueue([]); setLoading(false); return; }
    setLoading(true);
    try {
      // Whose visits to ask about. An operator login (info@, admin@) sees
      // everyone's; a tech sees only his own. NAME_BY_EMAIL is the same map
      // the ownership filters use, so the name here matches jobs.tech_name.
      const who = NAME_BY_EMAIL[String(email).toLowerCase()];
      const rows = await visitsOwed({ techNames: who ? [who] : null });
      setQueue(rows);
      setI(0);
    } catch (e) {
      console.warn('DidYouGo queue failed:', e?.message || e);
      setQueue([]);
    }
    setLoading(false);
  }, [mine, email]);

  useEffect(() => { load(); }, [load]);

  if (!mine || loading) return null;

  const job = queue[i];
  if (!job) return null;

  const remaining = queue.length - i;

  return (
    <div style={{
      background: '#101d31', border: '1px solid #1d2f48', borderLeft: '4px solid #f59e0b',
      borderRadius: 16, padding: '16px 18px', marginBottom: 14, color: '#edf4ff',
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
                    color: '#f59e0b', marginBottom: 8 }}>
        {remaining > 1 ? `${remaining} visits to close out` : 'One visit to close out'}
      </div>

      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.35, marginBottom: 3 }}>
        You were at {job.customer_name || 'a customer'} {dayName(job.scheduled_date)}.
      </div>
      {job.issue && (
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14, lineHeight: 1.45 }}>
          {String(job.issue).replace(/\s+/g, ' ').slice(0, 110)}
        </div>
      )}

      {/* ONE BUTTON. It opens the same sheet the tech uses everywhere else, so
          "close out from the nag" and "close out from the calendar" are the
          same three taps producing the same row. Didn't go? Pick Return in the
          sheet with 0:00 on the clock — the work is still owed and that is
          what return_pending means. */}
      <button
        onClick={() => onOpenSheet?.(job)}
        style={{ width: '100%', padding: '15px 0', borderRadius: 12, border: 'none',
                 background: '#22c55e', color: '#052e16', fontSize: 16, fontWeight: 800,
                 cursor: 'pointer', fontFamily: 'inherit' }}>
        Close it out
      </button>

      {remaining > 1 && (
        <button
          onClick={() => setI(n => n + 1)}
          style={{ width: '100%', marginTop: 8, padding: '10px 0', borderRadius: 10,
                   background: 'transparent', border: '1px solid #263a55', color: '#8ea0b8',
                   fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Show me the next one
        </button>
      )}
      {/* Deliberately NOT a skip. This moves through the queue; it does not
          suppress anything. Reload and the visit is still owed, because it is. */}
    </div>
  );
}
