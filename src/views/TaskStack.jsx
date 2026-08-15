// ============================================
// TaskStack — tasks one at a time, the way the visit prompt works.
// ============================================
// "See all tasks" sent JR to People, which opens on the Work tab: seven jobs
// rendered as dense paragraphs with an Estimates section. That is an operator's
// list. A tech reading it on a phone has to parse five hundred words before he
// finds a decision he can make, so he makes none.
//
// One card, one decision, a count that goes down. Same shape as DidYouGo,
// because that is the interaction that already works here.
//
// ── THE MODEL ───────────────────────────────────────────────────────────────
// A note is a note until somebody pins a person to it. Then it is a TASK:
//
//   To Do   assigned, untouched               assignee acts
//   Doing   picked up                         assignee acts
//   Done    assignee finished                 ASSIGNER acts
//   Closed  assigner confirmed                nobody
//
// Done is deliberately NOT the end. When JR marks a parts order done, the
// person who asked for the parts has to confirm they arrived — or turn it into
// a job to install them. A task that closes itself the moment the doer says so
// is how "ordered" becomes "we assumed it showed up."
//
// lane='done' + status='open' IS that pending state. Only status='closed'
// is finished, and both columns already existed.
//
// assigned_by is how the card finds its way home. Older rows have null and
// fall back to author_email — usually the same person, and better than
// stranding a finished task with nobody to return it to.
// ============================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, STATUS_INFO } from '../services/supabase.js';
import { ASSIGNEES, emailsFor, canonicalEmail, NAME_BY_EMAIL } from '../utils/ownership.js';

const C = {
  bg: '#07111f', card: '#111f34', line: '#1d2f48', line2: '#263a55',
  text: '#edf4ff', muted: '#8ea0b8', green: '#22d16f', blue: '#4b8dff',
  amber: '#ffb020', red: '#ff4f5e', purple: '#9b6cff',
};

const TABS = [
  { key: 'todo',  label: 'To Do' },
  { key: 'doing', label: 'Doing' },
  { key: 'done',  label: 'Done'  },
];

const ageDays = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

export default function TaskStack({ userEmail, userName, onNavigate, embedded = false, isOperator = false }) {
  const [rows, setRows]   = useState(null);
  const [loose, setLoose] = useState(0);   // notes nobody owns
  const [q, setQ]         = useState('');   // client filter
  // WHOSE STACK. People was the only screen that could answer "what does Shana
  // owe" and it is being retired, so that question moves here. Operators only —
  // a tech has no business reading somebody else's list, and for them this
  // never renders.
  const [who, setWho]     = useState('me');
  const [tab, setTab]     = useState('todo');
  const [busy, setBusy]   = useState(null);
  const [panel, setPanel] = useState(null);   // {id, mode}
  const [answer, setAnswer] = useState('');
  const [toWhom, setToWhom] = useState('');

  const me = canonicalEmail(userEmail);
  const mine = useMemo(() => emailsFor(userEmail).map(e => e.toLowerCase()), [userEmail]);

  // LET SLEEPING DOGS LIE.
  // An open note from a year ago is not a task somebody forgot — it is a row
  // nobody ever closed. Resurrecting it into a live stack buries the four
  // things that actually matter today under archaeology, and the person then
  // stops reading the stack at all. Anything still moving is recent; anything
  // older than this floor stays where it is, visible on the board, unclosed
  // and unbothered.
  const FLOOR_DAYS = 90;

  const load = useCallback(async () => {
    const floor = new Date(Date.now() - FLOOR_DAYS * 86400000).toISOString();
    // Two populations: what is assigned TO me, and what I assigned that has
    // come back finished. One query — the second set is small and filtering in
    // memory keeps the counts on the tabs honest.
    const { data, error } = await supabase
      .from('notes')
      .select('id, body, lane, status, assigned_to, assigned_by, handoff_to, author_email, done_at, done_by, customer_id, job_id, created_at, scheduled_for')
      .eq('status', 'open')
      .not('assigned_to', 'is', null)
      .gte('created_at', floor)
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) { console.warn('TaskStack load:', error.message); setRows([]); return; }
    const list = data || [];

    // A task card has to read like the job card it came from — customer at the
    // top, status underneath. A bare paragraph of body text gives no idea WHO
    // it is about, which is the first thing anyone needs to know.
    const custIds = [...new Set(list.map(n => n.customer_id).filter(Boolean))];
    const jobIds  = [...new Set(list.map(n => n.job_id).filter(Boolean))];
    const [cRes, jRes] = await Promise.all([
      custIds.length ? supabase.from('customers').select('id, name').in('id', custIds) : { data: [] },
      jobIds.length  ? supabase.from('jobs').select('id, customer_name, status').in('id', jobIds) : { data: [] },
    ]);
    const cById = Object.fromEntries((cRes.data || []).map(c => [c.id, c]));
    const jById = Object.fromEntries((jRes.data || []).map(j => [j.id, j]));

    // Notes with no owner are not tasks and never appear above — but /notes is
    // linked from nowhere in the app, so a note filed with the + button went
    // somewhere nobody could navigate to. Counting them here puts the door
    // where somebody looking for work is already standing.
    const { count } = await supabase
      .from('notes').select('id', { count: 'exact', head: true })
      .eq('status', 'open').is('assigned_to', null);
    setLoose(count || 0);

    setRows(list.map(n => {
      const j = n.job_id ? jById[n.job_id] : null;
      return {
        ...n,
        _customer: cById[n.customer_id]?.name || j?.customer_name || null,
        _jobStatus: j?.status || null,
      };
    }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const viewing = who === 'me'
    ? mine
    : [String(who).toLowerCase()];

  const isMine    = n => viewing.includes((n.assigned_to || '').toLowerCase());
  const iAssigned = n => viewing.includes((n.assigned_by || n.author_email || '').toLowerCase());

  const buckets = useMemo(() => {
    const all = rows || [];
    return {
      todo:  all.filter(n => isMine(n) && n.lane !== 'doing' && n.lane !== 'done'),
      doing: all.filter(n => isMine(n) && n.lane === 'doing'),
      // Done = finished work waiting on ME as the assigner. A task I finished
      // myself sits with whoever asked, not here.
      done:  all.filter(n => n.lane === 'done' && iAssigned(n) && !isMine(n)),
    };
  }, [rows, mine, who]);

  // CLIENT SEARCH. Tasks carry a customer now, so the stack can be narrowed to
  // one — "what do I owe Raintree" is a question people ask constantly and the
  // only previous answer was scrolling. Matches the customer OR the body, since
  // half of these are typed before a customer is attached.
  const list = useMemo(() => {
    const all = buckets[tab] || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(n =>
      (n._customer || '').toLowerCase().includes(needle) ||
      (n.body || '').toLowerCase().includes(needle));
  }, [buckets, tab, q]);

  const patch = async (n, fields, remove = true) => {
    setBusy(n.id);
    const { error } = await supabase.from('notes')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', n.id);
    setBusy(null);
    if (error) return alert('Could not save: ' + error.message);
    setRows(prev => remove ? prev.filter(x => x.id !== n.id)
                           : prev.map(x => x.id === n.id ? { ...x, ...fields } : x));
    setPanel(null); setAnswer(''); setToWhom('');
  };

  // Assignee finished. Two different things can happen, and which one is
  // right depends on why the task existed.
  //
  //   handoff_to set  -> the work MOVES ON. Nobody is verifying; the next pair
  //                      of hands takes it. Accounting fixes Henke's autopay,
  //                      Shana rings the customer. Lands in their To Do as a
  //                      fresh task, with the chain recorded in the body so
  //                      they can see who did what before them.
  //
  //   no handoff      -> back to the ASSIGNER to confirm. "I asked for parts,
  //                      tell me they arrived."
  const markDone = (n) => {
    const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const meName = NAME_BY_EMAIL[me] || userName || me;
    if (n.handoff_to) {
      return patch(n, {
        assigned_to: n.handoff_to,
        assigned_by: me,
        handoff_to: null,          // the chain is one link; a new one gets set deliberately
        lane: 'todo',
        done_at: null, done_by: null,
        body: `${n.body || ''}\n\n— ${meName} finished their part, ${stamp}. Over to you.`.trim(),
      });
    }
    return patch(n, { lane: 'done', done_at: new Date().toISOString(), done_by: me });
  };

  const markDoing = n => patch(n, { lane: 'doing' }, false);

  // Assigner confirms. This is the only thing that actually closes a task.
  const confirmClosed = n => patch(n, { status: 'closed' });

  // Assigner sends it back — it was not actually finished.
  const sendBack = n => patch(n, { lane: 'doing', done_at: null, done_by: null });

  const answerAndHand = async (n) => {
    const text = answer.trim();
    if (!text) return;
    const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const who = NAME_BY_EMAIL[me] || userName || me;
    const body = `${n.body || ''}\n\n— ${who}, ${stamp}: ${text}`.trim();
    const fields = { body };
    if (toWhom) { fields.assigned_to = toWhom; fields.assigned_by = me; fields.lane = 'todo'; }
    await patch(n, fields, !!toWhom);
  };

  const Btn = ({ onClick, children, tone = 'ghost', disabled, flex = 1 }) => {
    const t = { go:    { bg: C.green, fg: '#052e16', bd: C.green },
                warn:  { bg: 'transparent', fg: C.amber, bd: C.amber + '66' },
                doing: { bg: 'transparent', fg: C.blue,  bd: C.blue + '66' },
                ghost: { bg: 'transparent', fg: C.muted, bd: C.line2 } }[tone];
    return (
      <button onClick={onClick} disabled={disabled}
        style={{ flex, padding: '12px 10px', borderRadius: 10, background: t.bg,
                 border: `1px solid ${t.bd}`, color: t.fg, fontSize: 14, fontWeight: 800,
                 fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
                 opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' }}>
        {children}
      </button>
    );
  };

  return (
    <div style={{ background: embedded ? 'transparent' : C.bg, minHeight: embedded ? 0 : '100vh', color: C.text, paddingBottom: embedded ? 0 : 70 }}>
      {!embedded && (
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ fontSize: 21, fontWeight: 900 }}>Tasks</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
            {rows == null ? 'Loading…' : `${buckets.todo.length} to do · ${buckets.doing.length} doing${buckets.done.length ? ` · ${buckets.done.length} back to you` : ''}`}
          </div>
        </div>
      )}

      {isOperator && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2,
                      padding: embedded ? '2px 0 6px' : '10px 16px 4px' }}>
          {[{ email: 'me', name: 'Me' }, ...ASSIGNEES].map(a => {
            const on = who === a.email;
            return (
              <button key={a.email} onClick={() => setWho(a.email)}
                style={{ padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
                         whiteSpace: 'nowrap', background: on ? C.blue : 'transparent',
                         border: `1px solid ${on ? C.blue : C.line2}`,
                         color: on ? '#04121f' : C.muted,
                         fontSize: 12.5, fontWeight: 800, fontFamily: 'inherit' }}>
                {a.name}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ padding: embedded ? '4px 0 0' : '10px 16px 0' }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Filter by client or text…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                   borderRadius: 10, border: `1px solid ${C.line2}`, background: '#0b1220',
                   color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
      </div>

      <div style={{ display: 'flex', gap: 7, padding: embedded ? '8px 0 4px' : '10px 16px 4px' }}>
        {TABS.map(t => {
          const n = buckets[t.key].length;
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setPanel(null); }}
              style={{ flex: 1, padding: '10px 6px', borderRadius: 10, cursor: 'pointer',
                       background: on ? C.blue : 'transparent',
                       border: `1px solid ${on ? C.blue : C.line2}`,
                       color: on ? '#04121f' : C.muted, fontSize: 13, fontWeight: 800,
                       fontFamily: 'inherit' }}>
              {t.label}{n ? ` ${n}` : ''}
            </button>
          );
        })}
      </div>

      <div style={{ padding: embedded ? '10px 0 0' : '10px 16px 0' }}>
        {rows != null && list.length === 0 && (
          <div style={{ textAlign: 'center', color: C.muted, fontSize: 13.5, padding: '34px 0' }}>
            {tab === 'done' ? 'Nothing waiting on you.' : 'Nothing here.'}
          </div>
        )}

        {list.map(n => {
          const age  = ageDays(n.created_at);
          const open = panel?.id === n.id;
          const back = tab === 'done';
          return (
            <div key={n.id}
              style={{ background: C.card, borderRadius: 16, padding: '15px 16px', marginBottom: 12,
                       border: `1px solid ${back ? C.purple + '66' : n.lane === 'doing' ? C.blue + '55' : C.line}` }}>

              {/* CUSTOMER FIRST — same as the job card. A paragraph of body
                  text with no name on it tells you nothing about who it is for,
                  which is the first thing anybody needs. */}
              <div style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.2, marginBottom: 6 }}>
                {n._customer || 'No customer'}
              </div>

              <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                {/* The JOB's status, carried onto the task. "Ed Rupert — Needs
                    Estimate" is the whole context in five words. */}
                {/* ARCHIVED/DEAD JOBS DO NOT GET A CHIP. Five of the seven
                    live tasks point at a job that has since been archived, so
                    this stamped "Archived" across work somebody still owes.
                    The task's own state is what matters; the job's status is
                    only context when the job is still going. */}
                {n._jobStatus && !['archived','dead','lost','billed'].includes(n._jobStatus)
                  && STATUS_INFO[n._jobStatus] && (
                  <span style={{ fontSize: 12, fontWeight: 900, padding: '4px 10px', borderRadius: 7,
                                 color: STATUS_INFO[n._jobStatus].color,
                                 background: `${STATUS_INFO[n._jobStatus].color}1a`,
                                 border: `1px solid ${STATUS_INFO[n._jobStatus].color}66` }}>
                    {STATUS_INFO[n._jobStatus].icon} {STATUS_INFO[n._jobStatus].label}
                  </span>
                )}
                {back && (
                  <span style={{ fontSize: 11, fontWeight: 900, color: C.purple,
                                 border: `1px solid ${C.purple}55`, borderRadius: 6, padding: '4px 9px' }}>
                    {NAME_BY_EMAIL[canonicalEmail(n.done_by || '')] || 'They'} SAYS DONE
                  </span>
                )}
                {n.lane === 'doing' && !back && (
                  <span style={{ fontSize: 11, fontWeight: 900, color: C.blue,
                                 border: `1px solid ${C.blue}55`, borderRadius: 6, padding: '4px 9px' }}>
                    WORKING ON IT
                  </span>
                )}
                {/* Say where it goes next BEFORE they press the button, not
                    after. Otherwise "Did it" looks like it closes the thing. */}
                {n.handoff_to && !back && (
                  <span style={{ fontSize: 11, fontWeight: 900, color: C.amber,
                                 border: `1px solid ${C.amber}55`, borderRadius: 6, padding: '4px 9px' }}>
                    THEN → {NAME_BY_EMAIL[canonicalEmail(n.handoff_to)] || n.handoff_to}
                  </span>
                )}
              </div>

              {/* WHO ASKED, AND WHEN. Big, because "who is waiting on me and
                  how long have they been waiting" is the thing that decides
                  whether this gets done today. */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginBottom: 11,
                            paddingBottom: 11, borderBottom: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
                  {NAME_BY_EMAIL[canonicalEmail(n.assigned_by || n.author_email || '')] || 'Someone'}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700,
                               color: age >= 21 ? C.red : age >= 7 ? C.amber : C.muted }}>
                  {new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {age > 0 ? ` · ${age}d` : ' · today'}
                </span>
              </div>

              <div style={{ fontSize: 15.5, lineHeight: 1.45, marginBottom: 13, whiteSpace: 'pre-wrap' }}>
                {n.body || '(no detail)'}
              </div>

              {/* Tasks spawned from a job carry job_id. This is how Sara gets
                  from "JR says the estimate is written" to the board card she
                  has to move to Estimate Sent, without going looking for it. */}
              {n.job_id && (
                <button onClick={() => onNavigate?.(`/board?job=${n.job_id}`)}
                  style={{ background: 'transparent', border: `1px solid ${C.line2}`,
                           borderRadius: 8, color: C.blue, fontSize: 12.5, fontWeight: 800,
                           padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit',
                           marginBottom: 12 }}>
                  Open the job &rsaquo;
                </button>
              )}

              {!open && back && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <Btn tone="go" flex={2} disabled={busy === n.id}
                    onClick={() => confirmClosed(n)}>Confirm complete</Btn>
                  <Btn tone="warn" disabled={busy === n.id}
                    onClick={() => sendBack(n)}>Not done</Btn>
                </div>
              )}

              {!open && !back && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <Btn tone="go" flex={2} disabled={busy === n.id}
                    onClick={() => markDone(n)}>
                    {busy === n.id ? '…'
                      : n.handoff_to
                        ? `Done → ${NAME_BY_EMAIL[canonicalEmail(n.handoff_to)] || 'next'}`
                        : 'Did it'}
                  </Btn>
                  {n.lane !== 'doing' && (
                    <Btn tone="doing" disabled={busy === n.id}
                      onClick={() => markDoing(n)}>On it</Btn>
                  )}
                  <Btn onClick={() => setPanel({ id: n.id, mode: 'answer' })}>Answer</Btn>
                </div>
              )}

              {open && (
                <div>
                  <textarea value={answer} onChange={e => setAnswer(e.target.value)}
                    rows={3} autoFocus placeholder="Here's the answer…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                             borderRadius: 9, border: `1px solid ${C.line2}`, background: '#0b1220',
                             color: C.text, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
                  <div style={{ fontSize: 12, color: C.muted, margin: '11px 0 7px' }}>Hand it to someone?</div>
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
                    <Btn tone="go" flex={2} disabled={busy === n.id || !answer.trim()}
                      onClick={() => answerAndHand(n)}>
                      {toWhom ? 'Send it over' : 'Save answer'}
                    </Btn>
                    <Btn onClick={() => { setPanel(null); setAnswer(''); setToWhom(''); }}>Cancel</Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {loose > 0 && (
          <button onClick={() => onNavigate?.('/notes')}
            style={{ width: '100%', marginTop: 4, padding: '12px 14px', borderRadius: 12,
                     background: 'transparent', border: `1px dashed ${C.line2}`, color: C.muted,
                     fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                     textAlign: 'left' }}>
            {loose} note{loose === 1 ? '' : 's'} nobody owns &rsaquo;
          </button>
        )}

        {!embedded && (
          <button onClick={() => onNavigate?.('/board')}
            style={{ width: '100%', marginTop: 6, padding: '13px 0', borderRadius: 12,
                     background: 'transparent', border: 'none', color: C.muted,
                     fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Open the board
          </button>
        )}
      </div>
    </div>
  );
}
