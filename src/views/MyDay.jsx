// ============================================
// MyDay — the first screen, and for JR the only one he has to read.
// ============================================
// JR signs in on info@, whose defaultView was 'board'. DidYouGo renders inside
// OpsHome, which info@ never landed on — so the prompt built to recover his
// undispositioned visits was mounted on a screen he did not open. It has been
// asking nobody.
//
// This is that prompt plus his assigned work, on the route he actually lands
// on, with the four answers he ever gives:
//
//   Did it            → done, off the stack
//   Working on it     → doing, stays visible
//   Answer & hand off → his reply appended, reassigned, gone from his list
//   Block time        → an event on his calendar, note carries the link
//
// A TASK IS A NOTE WITH A PERSON ON IT. `assigned_to` null means it is still
// just a note and belongs to the board, not to anybody's morning. That rule
// is already in People.jsx (`n.assigned_to ? 'Task' : 'Note'`) — this reads
// the same field the pill writes, so nothing new decides what a task is.
//
// READS USE emailsFor(). JR has written notes as info@ and as jr@ for months.
// Querying one address loses the other half, which is the exact bug that made
// My Tasks look empty when it was not.
// ============================================

import { useState, useEffect, useCallback } from 'react';
import DidYouGo from '../components/DidYouGo.jsx';
import { supabase } from '../services/supabase.js';
import { ASSIGNEES, emailsFor, canonicalEmail, NAME_BY_EMAIL } from '../utils/ownership.js';
import { createEventOnCalendar } from '../services/calendarSync.js';
import { TECH_CALENDAR_MAP, CALENDARS } from '../config/calendars.js';

const C = {
  bg:     '#07111f',
  panel:  '#101d31',
  card:   '#111f34',
  line:   '#1d2f48',
  line2:  '#263a55',
  text:   '#edf4ff',
  muted:  '#8ea0b8',
  green:  '#22d16f',
  blue:   '#4b8dff',
  amber:  '#ffb020',
  purple: '#9b6cff',
};

// One tap covers most of it. "Later today" is deliberately absent — if it were
// happening later today it would not need a calendar block.
const WHEN_PRESETS = [
  { key: 'tomorrow_am', label: 'Tomorrow AM', days: 1, hour: 8 },
  { key: 'tomorrow_pm', label: 'Tomorrow PM', days: 1, hour: 13 },
  { key: 'friday',      label: 'End of week', days: null, hour: 9 },
];

const atHour = (days, hour) => {
  const d = new Date();
  if (days == null) {
    // Next Friday, or today if it is Friday and still morning.
    const delta = (5 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (delta === 0 && d.getHours() >= 9 ? 7 : delta));
  } else {
    d.setDate(d.getDate() + days);
  }
  d.setHours(hour, 0, 0, 0);
  return d;
};

const ageDays = (iso) => iso
  ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  : null;

export default function MyDay({ userEmail, userName, accessToken, onNavigate }) {
  const [tasks, setTasks]   = useState(null);
  const [busy, setBusy]     = useState(null);   // note id being written
  const [open, setOpen]     = useState(null);   // note id with a panel open
  const [mode, setMode]     = useState(null);   // 'answer' | 'when'
  const [answer, setAnswer] = useState('');
  const [toWhom, setToWhom] = useState('');

  const me = canonicalEmail(userEmail);
  const myCalendar = TECH_CALENDAR_MAP[me] || CALENDARS.JR;

  const load = useCallback(async () => {
    const mine = emailsFor(userEmail);
    if (!mine.length) { setTasks([]); return; }

    // Open work only. `done_at` and lane both carry "finished" depending on
    // which screen closed it, so neither alone is trustworthy.
    const { data, error } = await supabase
      .from('notes')
      .select('id, body, lane, status, assigned_to, customer_id, job_id, created_at, updated_at, scheduled_for, calendar_event_id')
      .in('assigned_to', mine)
      .is('done_at', null)
      .neq('lane', 'done')
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) { console.warn('MyDay load failed:', error.message); setTasks([]); return; }
    setTasks(data || []);
  }, [userEmail]);

  useEffect(() => { load(); }, [load]);

  const closePanel = () => { setOpen(null); setMode(null); setAnswer(''); setToWhom(''); };

  // ── Did it ────────────────────────────────────────────────────────────
  const markDone = async (note) => {
    setBusy(note.id);
    const { error } = await supabase.from('notes').update({
      lane: 'done', status: 'closed',
      done_at: new Date().toISOString(), done_by: me,
      updated_at: new Date().toISOString(),
    }).eq('id', note.id);
    setBusy(null);
    if (error) return alert('Could not save: ' + error.message);
    setTasks(t => t.filter(x => x.id !== note.id));
  };

  // ── Working on it ─────────────────────────────────────────────────────
  // Stays on the stack. The point is that somebody watching the board can see
  // it moved without JR having to say so twice.
  const markDoing = async (note) => {
    setBusy(note.id);
    const { error } = await supabase.from('notes').update({
      lane: 'doing', updated_at: new Date().toISOString(),
    }).eq('id', note.id);
    setBusy(null);
    if (error) return alert('Could not save: ' + error.message);
    setTasks(t => t.map(x => x.id === note.id ? { ...x, lane: 'doing' } : x));
  };

  // ── Answer & hand off ─────────────────────────────────────────────────
  // The answer is appended to the body rather than stored in a new column:
  // every screen that already renders a note renders the reply for free, and
  // the handoff needs no schema behind it.
  const answerAndReassign = async (note) => {
    const text = answer.trim();
    if (!text) return;
    setBusy(note.id);
    const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const who   = NAME_BY_EMAIL[me] || userName || me;
    const body  = `${note.body || ''}\n\n— ${who}, ${stamp}: ${text}`.trim();

    const patch = { body, updated_at: new Date().toISOString() };
    // Handing off moves ownership. Keeping it assigned to JR as well is how a
    // thing ends up with two owners who each think the other has it.
    if (toWhom) { patch.assigned_to = toWhom; patch.lane = 'todo'; }

    const { error } = await supabase.from('notes').update(patch).eq('id', note.id);
    setBusy(null);
    if (error) return alert('Could not save: ' + error.message);

    closePanel();
    // Reassigned → leaves his list. Answered without reassigning → it stays,
    // because answering a question is not the same as finishing the job.
    if (toWhom) setTasks(t => t.filter(x => x.id !== note.id));
    else setTasks(t => t.map(x => x.id === note.id ? { ...x, body } : x));
  };

  // ── Block time ────────────────────────────────────────────────────────
  const blockTime = async (note, start) => {
    if (!accessToken) return alert('Not signed in to Google — reload and try again.');
    setBusy(note.id);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const label = (note.body || 'Task').replace(/\s+/g, ' ').slice(0, 60);
    try {
      const created = await createEventOnCalendar(accessToken, myCalendar, {
        title: label,
        description: note.body || '',
        startTime: start,
        endTime: end,
      });
      const { error } = await supabase.from('notes').update({
        scheduled_for: start.toISOString(),
        calendar_event_id: created?.id || null,
        calendar_id: myCalendar,
        lane: 'doing',
        updated_at: new Date().toISOString(),
      }).eq('id', note.id);
      if (error) throw error;
      closePanel();
      setTasks(t => t.map(x => x.id === note.id
        ? { ...x, scheduled_for: start.toISOString(), lane: 'doing' } : x));
    } catch (e) {
      alert('Could not block time: ' + e.message);
    } finally {
      setBusy(null);
    }
  };

  const Btn = ({ onClick, children, tone = 'ghost', disabled, flex = 1 }) => {
    const tones = {
      go:    { bg: C.green,  fg: '#052e16', bd: C.green },
      doing: { bg: 'transparent', fg: C.blue,   bd: C.blue + '66' },
      ghost: { bg: 'transparent', fg: C.muted,  bd: C.line2 },
    };
    const t = tones[tone];
    return (
      <button onClick={onClick} disabled={disabled}
        style={{ flex, padding: '11px 10px', borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
                 background: t.bg, border: `1px solid ${t.bd}`, color: t.fg,
                 fontSize: 13.5, fontWeight: 800, fontFamily: 'inherit',
                 opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' }}>
        {children}
      </button>
    );
  };

  const doing = (tasks || []).filter(t => t.lane === 'doing').length;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, paddingBottom: 60 }}>
      <div style={{ padding: '18px 16px 0' }}>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.3 }}>
          {userName ? `Morning, ${userName}` : 'Your day'}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
          {tasks == null ? 'Loading…'
            : tasks.length === 0 ? 'Nothing assigned to you.'
            : `${tasks.length} task${tasks.length === 1 ? '' : 's'}${doing ? ` · ${doing} in progress` : ''}`}
        </div>
      </div>

      {/* The visit prompt comes FIRST. Hours that never became a time entry
          are the only thing on this screen that is actively losing money. */}
      <div style={{ padding: '16px 16px 0' }}>
        <DidYouGo userEmail={userEmail} userName={userName} />
      </div>

      <div style={{ padding: '4px 16px 0' }}>
        {tasks != null && tasks.length > 0 && (
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: C.muted, margin: '10px 0 10px' }}>
            Assigned to you
          </div>
        )}

        {(tasks || []).map(note => {
          const age  = ageDays(note.created_at);
          const isOn = open === note.id;
          return (
            <div key={note.id}
              style={{ background: C.card, border: `1px solid ${note.lane === 'doing' ? C.blue + '55' : C.line}`,
                       borderRadius: 16, padding: '14px 15px', marginBottom: 11 }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                {note.lane === 'doing' && (
                  <span style={{ fontSize: 10, fontWeight: 900, color: C.blue,
                                 border: `1px solid ${C.blue}55`, borderRadius: 5, padding: '2px 6px' }}>
                    IN PROGRESS
                  </span>
                )}
                {note.scheduled_for && (
                  <span style={{ fontSize: 10.5, color: C.purple }}>
                    📅 {new Date(note.scheduled_for).toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric' })}
                  </span>
                )}
                {age != null && age >= 7 && !note.scheduled_for && (
                  <span style={{ fontSize: 10.5, color: age >= 21 ? '#ff4f5e' : C.amber }}>
                    {age} days old
                  </span>
                )}
              </div>

              <div style={{ fontSize: 15, lineHeight: 1.45, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                {note.body || '(no detail)'}
              </div>

              {!isOn && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <Btn tone="go" flex={2} disabled={busy === note.id}
                    onClick={() => markDone(note)}>
                    {busy === note.id ? '…' : 'Did it'}
                  </Btn>
                  {note.lane !== 'doing' && (
                    <Btn tone="doing" disabled={busy === note.id}
                      onClick={() => markDoing(note)}>On it</Btn>
                  )}
                  <Btn onClick={() => { setOpen(note.id); setMode('answer'); }}>Answer</Btn>
                  <Btn onClick={() => { setOpen(note.id); setMode('when'); }}>Block time</Btn>
                </div>
              )}

              {isOn && mode === 'answer' && (
                <div>
                  <textarea value={answer} onChange={e => setAnswer(e.target.value)}
                    rows={3} autoFocus placeholder="Here's the answer…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                             borderRadius: 9, border: `1px solid ${C.line2}`, background: '#0b1220',
                             color: C.text, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
                  <div style={{ fontSize: 12, color: C.muted, margin: '11px 0 7px' }}>
                    Hand it to someone? (optional)
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ASSIGNEES.filter(a => a.email !== me).map(a => (
                      <button key={a.email} onClick={() => setToWhom(toWhom === a.email ? '' : a.email)}
                        style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                                 background: toWhom === a.email ? C.purple : 'transparent',
                                 border: `1px solid ${toWhom === a.email ? C.purple : C.line2}`,
                                 color: toWhom === a.email ? '#0b0618' : C.muted,
                                 fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>
                        {a.name}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 7, marginTop: 13 }}>
                    <Btn tone="go" flex={2} disabled={busy === note.id || !answer.trim()}
                      onClick={() => answerAndReassign(note)}>
                      {busy === note.id ? 'Saving…' : toWhom ? 'Send it over' : 'Save answer'}
                    </Btn>
                    <Btn onClick={closePanel}>Cancel</Btn>
                  </div>
                </div>
              )}

              {isOn && mode === 'when' && (
                <div>
                  <div style={{ fontSize: 13.5, marginBottom: 9 }}>When do you want it?</div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {WHEN_PRESETS.map(p => (
                      <Btn key={p.key} disabled={busy === note.id}
                        onClick={() => blockTime(note, atHour(p.days, p.hour))}>
                        {p.label}
                      </Btn>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
                    <Btn onClick={closePanel}>Cancel</Btn>
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 9 }}>
                    One hour on your calendar. Change the length in Google if you need to.
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {tasks != null && tasks.length === 0 && (
          <div style={{ color: C.muted, fontSize: 13.5, padding: '26px 0', textAlign: 'center' }}>
            Nothing assigned to you right now.
          </div>
        )}

        {/* See all — the roster screen, where the pills live and where anything
            not assigned to him still sits. */}
        <button onClick={() => onNavigate?.('/people')}
          style={{ width: '100%', marginTop: 8, padding: '13px 0', borderRadius: 12,
                   background: 'transparent', border: `1px solid ${C.line2}`, color: C.text,
                   fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          See all tasks &rsaquo;
        </button>
        <button onClick={() => onNavigate?.('/board')}
          style={{ width: '100%', marginTop: 9, padding: '13px 0', borderRadius: 12,
                   background: 'transparent', border: 'none', color: C.muted,
                   fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Open the board
        </button>
      </div>
    </div>
  );
}
