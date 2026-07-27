// ============================================
// Workspace — the owner's board, not the company's
// ============================================
// THE FIRST VERSION WAS WRONG and this comment exists so it doesn't regress.
// v1 rendered `jobs` rows straight into To Do / Doing / Done, which made the
// lanes a renamed copy of job.status. Consequences: Shana couldn't move
// anything without changing the job, "Done" showed the whole company's billing
// pipeline instead of her finished work, and the screen was just the board
// wearing a different hat.
//
// THE MODEL NOW
//   To Do — a FEED, read from jobs. Work where she is the next action: ready
//           to schedule, return needed, estimate won, parts landed, plus
//           anything assigned to her. Plus her own open notes. Tapping a job
//           opens THAT TICKET, it does not move it.
//   Doing — HERS. Nothing lands here automatically. She pulls things in.
//   Done  — HER finished notes and HER scheduled items. Not billing.
//
// THE RULE: a card in Doing may POINT AT a job (`notes.job_id`) but moving it
// NEVER writes to that job. A job sits in ready_to_schedule whether or not she
// is working it, because the board is the company's view and this is hers.
// If a future change makes a lane move update jobs.status, that is the bug.
//
// Tentative scheduling records HER intent against the Tent calendar — which
// stays the source of truth. It does not dispatch a tech or schedule a job.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { shortCode } from '../config/appBase.js';
import { CALENDARS } from '../config/calendars.js';
import NewJobModal from '../components/NewJobModal.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';
const BG = '#0f1729', SURFACE = '#1e293b', LINE = '#334155';
const TEXT = '#e2e8f0', MUTED = '#94a3b8', ACCENT = '#00c8e8';

// A job only reaches her To Do two ways: it is ASSIGNED to her, or she pulled
// it in herself. Status alone is not enough. Showing every ready/return/parts
// job in the company was the same mistake as v1 in a smaller costume — her
// column filled with work that was never hers and she stopped trusting it.
// Statuses that are finished or dead never surface even when assigned.
const DEAD_STATUSES = ['billed', 'archived', 'dead', 'lost'];

const STATUS_LABEL = {
  ready_to_schedule: 'Ready to schedule', return_pending: 'Return needed',
  won: 'Estimate won', needs_parts: 'Needs parts', pending_materials: 'Parts ordered',
  scheduled: 'Scheduled', complete: 'Complete', to_bill: 'To bill', billed: 'Billed',
  new: 'New', blocked: 'Blocked', needs_estimate: 'Needs estimate', estimate_sent: 'Estimate sent',
};
const STATUS_COLOR = {
  ready_to_schedule: '#22c55e', return_pending: '#8b5cf6', won: '#22c55e',
  needs_parts: '#f97316', pending_materials: '#f97316', scheduled: '#3b82f6',
};

const WORKSPACES = {
  shana: { title: 'Shana', subtitle: 'Scheduling', email: 'shanaparks@drhsecurityservices.com' },
  sara:  { title: 'Sara',  subtitle: 'Oversight',  email: 'admin@jnbservice.com' },
  jr:    { title: 'JR',    subtitle: 'Rollup',     email: 'jr@drhsecurityservices.com' },
};

const fmtDay = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  : '';

// ── Tentative schedule picker ────────────────────────────────────────
// Reads the Tent calendar so she can attach an event she's already pencilled
// in. If there isn't one yet she can just set a date — the intent is the point,
// and the calendar entry can catch up.
function TentPicker({ item, accessToken, onClose, onSave, saving }) {
  const [events, setEvents] = useState(null);
  const [date, setDate] = useState(item.scheduled_for ? item.scheduled_for.slice(0, 10) : '');
  const [eventId, setEventId] = useState(item.calendar_event_id || null);

  useEffect(() => {
    if (!accessToken) { setEvents([]); return; }
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 45);
    const params = new URLSearchParams({
      timeMin: from.toISOString(), timeMax: to.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '150',
    });
    fetch(`${GCAL}/calendars/${encodeURIComponent(CALENDARS.TENTATIVELY_SCHEDULED)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then(d => setEvents((d.items || []).filter(e => e.status !== 'cancelled')))
      .catch(() => setEvents([]));
  }, [accessToken]);

  const chosen = (events || []).find(e => e.id === eventId);

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1200,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: SURFACE, borderRadius: 14, padding: 20, width: '100%', maxWidth: 460 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Tentatively scheduled</div>
        <div style={{ color: MUTED, fontSize: 12, marginTop: 3, marginBottom: 14, lineHeight: 1.4 }}>
          Records that you've pencilled this in. It does not schedule the job or book
          a tech — the Tent calendar stays the source of truth.
        </div>

        <div style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Date</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '9px 12px', color: TEXT, fontSize: 13, outline: 'none' }} />

        <div style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, margin: '14px 0 5px' }}>
          Link a Tent calendar event (optional)
        </div>
        {events === null ? (
          <div style={{ color: MUTED, fontSize: 12 }}>Loading Tent calendar…</div>
        ) : events.length === 0 ? (
          <div style={{ color: MUTED, fontSize: 12 }}>Nothing on the Tent calendar in the next 45 days.</div>
        ) : (
          <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${LINE}`, borderRadius: 8 }}>
            {events.map(ev => (
              <div key={ev.id} onClick={() => setEventId(eventId === ev.id ? null : ev.id)}
                style={{ padding: '8px 11px', fontSize: 12, cursor: 'pointer', borderBottom: `1px solid ${BG}`,
                         background: eventId === ev.id ? `${ACCENT}22` : 'transparent',
                         color: eventId === ev.id ? ACCENT : TEXT }}>
                {ev.summary || '(untitled)'}
                <span style={{ color: MUTED, marginLeft: 6, fontSize: 10 }}>
                  {fmtDay(ev.start?.dateTime || ev.start?.date)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button disabled={saving || (!date && !eventId)}
            onClick={() => onSave({
              tentative: true,
              scheduled_for: date
                ? new Date(`${date}T12:00:00`).toISOString()
                : (chosen ? new Date(chosen.start?.dateTime || chosen.start?.date).toISOString() : null),
              calendar_event_id: eventId,
              calendar_id: eventId ? CALENDARS.TENTATIVELY_SCHEDULED : null,
            })}
            style={{ flex: 1, background: (date || eventId) ? ACCENT : '#1a2537',
                     color: (date || eventId) ? '#0f1729' : MUTED, border: 'none', borderRadius: 8,
                     padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? '…' : 'Save'}
          </button>
          {item.tentative && (
            <button disabled={saving}
              onClick={() => onSave({ tentative: false, scheduled_for: null, calendar_event_id: null, calendar_id: null })}
              style={{ background: 'transparent', color: MUTED, border: `1px solid ${LINE}`,
                       borderRadius: 8, padding: '11px 14px', fontSize: 12, cursor: 'pointer' }}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Workspace({ accessToken, userEmail, userName }) {
  const navigate = useNavigate();
  const { who } = useParams();
  const key = (who || userName || '').toLowerCase();
  const config = WORKSPACES[key] || WORKSPACES.shana;
  const owner = config.email;

  const [items, setItems] = useState([]);   // her notes — the real workspace
  const [feed, setFeed] = useState([]);     // jobs needing office action
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showNewJob, setShowNewJob] = useState(false);
  const [tentFor, setTentFor] = useState(null);
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: notes }, { data: jobs }] = await Promise.all([
        supabase.from('notes').select('*')
          .eq('author_email', owner)
          .order('created_at', { ascending: true }).limit(500),
        supabase.from('jobs')
          .select('id, customer_name, issue, status, assigned_to, tech_name, created_at, scheduled_date')
          .eq('assigned_to', owner)
          .not('status', 'in', `(${DEAD_STATUSES.join(',')})`)
          .order('created_at', { ascending: true }).limit(500),
      ]);
      setItems(notes || []);
      setFeed(jobs || []);
    } catch (e) { console.error('workspace load', e); }
    setLoading(false);
  }, [owner]);

  useEffect(() => { load(); }, [load]);

  // A job she has already pulled in shouldn't also sit in the feed.
  const pulledJobIds = useMemo(
    () => new Set(items.filter(i => i.job_id && i.lane !== 'todo').map(i => i.job_id)),
    [items]
  );

  const q = query.trim().toLowerCase();
  const matches = (text) => !q || (text || '').toLowerCase().includes(q);

  const todoFeed  = feed.filter(j => !pulledJobIds.has(j.id))
                        .filter(j => matches(`${j.customer_name} ${j.issue} ${j.tech_name}`));
  const todoNotes = items.filter(i => i.lane === 'todo'  && matches(i.body));
  const doing     = items.filter(i => i.lane === 'doing' && matches(i.body));
  const done      = items.filter(i => i.lane === 'done'  && matches(i.body));

  // ── Mutations. None of these touch `jobs`. That is the whole point. ──
  const pullIn = async (job) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('notes').insert([{
        body: `${job.customer_name || 'Job'}${job.issue ? ` — ${job.issue}` : ''}`,
        author_email: owner, job_id: job.id, lane: 'doing', status: 'open',
      }]);
      if (error) throw error;
      await load(); say('Moved to Doing ✓');
    } catch (e) { say('Could not move: ' + (e.message || e)); }
    setSaving(false);
  };

  const moveLane = async (item, lane) => {
    setSaving(true);
    try {
      const patch = { lane };
      if (lane === 'done') {
        patch.status = 'archived';
        patch.archived_at = new Date().toISOString();
        patch.archived_by = userEmail || null;
      } else {
        patch.status = 'open';
        patch.archived_at = null;
      }
      const { error } = await supabase.from('notes').update(patch).eq('id', item.id);
      if (error) throw error;
      await load();
    } catch (e) { say('Could not move: ' + (e.message || e)); }
    setSaving(false);
  };

  const saveTent = async (patch) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('notes').update(patch).eq('id', tentFor.id);
      if (error) throw error;
      setTentFor(null); await load();
      say(patch.tentative ? 'Pencilled in ✓' : 'Cleared ✓');
    } catch (e) { say('Could not save: ' + (e.message || e)); }
    setSaving(false);
  };

  const Lane = ({ label, hint, color, count, children }) => (
    <div style={{ background: SURFACE, borderRadius: 12, padding: 12, minHeight: 120 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color }}>{label}</div>
        <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{count}</div>
      </div>
      <div style={{ fontSize: 11, color: MUTED, margin: '3px 0 10px' }}>{hint}</div>
      {count === 0
        ? <div style={{ color: MUTED, fontSize: 12, padding: '18px 0', textAlign: 'center' }}>
            {loading ? 'Loading…' : 'Nothing here.'}
          </div>
        : children}
    </div>
  );

  const Card = ({ children, accent }) => (
    <div style={{ background: BG, border: `1px solid ${LINE}`,
                  borderLeft: `3px solid ${accent || LINE}`, borderRadius: 10,
                  padding: 10, marginBottom: 8 }}>{children}</div>
  );

  const MoveBar = ({ item, lanes }) => (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {lanes.map(([lane, label]) => (
        <button key={lane} onClick={() => moveLane(item, lane)} disabled={saving}
          style={{ flex: 1, background: 'transparent', color: MUTED, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '5px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, paddingBottom: 60 }}>
      <div style={{ padding: '16px 16px 10px', borderBottom: `1px solid ${LINE}`,
                    position: 'sticky', top: 0, background: BG, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{config.title}'s workspace</div>
            <div style={{ color: MUTED, fontSize: 12 }}>{config.subtitle}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => navigate('/notes')}
              style={{ background: SURFACE, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 8,
                       padding: '9px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>📝 Notes</button>
            <button onClick={() => setShowNewJob(true)}
              style={{ background: ACCENT, color: '#0f1729', border: 'none', borderRadius: 8,
                       padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ New</button>
            <button onClick={load} disabled={loading}
              style={{ background: SURFACE, border: 'none', color: MUTED, borderRadius: 8,
                       padding: '9px 13px', fontSize: 14, cursor: 'pointer' }}>{loading ? '…' : '↻'}</button>
          </div>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter…"
          style={{ width: '100%', boxSizing: 'border-box', background: SURFACE, border: `1px solid ${LINE}`,
                   borderRadius: 8, padding: '9px 12px', color: TEXT, fontSize: 13, outline: 'none' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, padding: 16 }}>

        {/* ── TO DO — a feed. Read-only against the board. ── */}
        <Lane label="To Do" hint="Assigned to you, plus your own notes"
          color="#f59e0b" count={todoFeed.length + todoNotes.length}>
          {todoNotes.map(n => (
            <Card key={n.id} accent={ACCENT}>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <MoveBar item={n} lanes={[['doing', '→ Doing'], ['done', '✓ Done']]} />
            </Card>
          ))}
          {todoFeed.map(j => (
            <Card key={j.id} accent={STATUS_COLOR[j.status] || LINE}>
              <div onClick={() => navigate(`/j/${shortCode(j.id)}`)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{j.customer_name || 'Unnamed'}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', padding: '3px 7px', borderRadius: 20,
                                background: `${STATUS_COLOR[j.status] || LINE}22`, color: STATUS_COLOR[j.status] || MUTED }}>
                    {STATUS_LABEL[j.status] || j.status}
                  </div>
                </div>
                {j.issue && (
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                    {j.issue.length > 100 ? j.issue.slice(0, 98).trimEnd() + '…' : j.issue}
                  </div>
                )}
              </div>
              <button onClick={() => pullIn(j)} disabled={saving}
                style={{ marginTop: 8, width: '100%', background: 'transparent', color: ACCENT,
                         border: `1px solid ${ACCENT}55`, borderRadius: 8, padding: '6px 0',
                         fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                → I'm working this
              </button>
            </Card>
          ))}
        </Lane>

        {/* ── DOING — hers alone ── */}
        <Lane label="Doing" hint="Only what you put here" color="#3b82f6" count={doing.length}>
          {doing.map(n => (
            <Card key={n.id} accent="#3b82f6">
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>
                {n.tentative && (
                  <span style={{ background: '#f59e0b22', color: '#f59e0b', borderRadius: 20,
                                 padding: '3px 9px', fontSize: 10, fontWeight: 700 }}>
                    ✏️ Tent {fmtDay(n.scheduled_for)}
                  </span>
                )}
                {n.calendar_event_id && <span style={{ color: MUTED, fontSize: 10 }}>🔗 calendar linked</span>}
                {n.job_id && (
                  <button onClick={() => navigate(`/j/${shortCode(n.job_id)}`)}
                    style={{ background: 'none', border: 'none', color: ACCENT, fontSize: 10, cursor: 'pointer', padding: 0 }}>
                    open ticket →
                  </button>
                )}
              </div>
              <button onClick={() => setTentFor(n)}
                style={{ marginTop: 8, width: '100%', background: 'transparent', color: '#f59e0b',
                         border: '1px solid #f59e0b55', borderRadius: 8, padding: '6px 0',
                         fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {n.tentative ? 'Change tentative date' : '✏️ Tentatively schedule'}
              </button>
              <MoveBar item={n} lanes={[['todo', '← To Do'], ['done', '✓ Done']]} />
            </Card>
          ))}
        </Lane>

        {/* ── DONE — her finished work only ── */}
        <Lane label="Done" hint="Your finished notes and scheduled items" color="#22c55e" count={done.length}>
          {done.slice().reverse().map(n => (
            <Card key={n.id} accent="#22c55e">
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7 }}>
                {n.tentative && n.scheduled_for && (
                  <span style={{ color: MUTED, fontSize: 10 }}>📅 {fmtDay(n.scheduled_for)}</span>
                )}
                <span style={{ color: MUTED, fontSize: 10 }}>{fmtDay(n.archived_at || n.updated_at)}</span>
                {n.job_id && (
                  <button onClick={() => navigate(`/j/${shortCode(n.job_id)}`)}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: ACCENT,
                             fontSize: 10, cursor: 'pointer', padding: 0 }}>
                    open ticket →
                  </button>
                )}
              </div>
              <MoveBar item={n} lanes={[['doing', '↩ Reopen']]} />
            </Card>
          ))}
        </Lane>
      </div>

      {tentFor && (
        <TentPicker item={tentFor} accessToken={accessToken} saving={saving}
          onClose={() => setTentFor(null)} onSave={saveTent} />
      )}

      {showNewJob && (
        <NewJobModal accessToken={accessToken} userEmail={userEmail}
          onClose={() => setShowNewJob(false)}
          onCreated={() => { setShowNewJob(false); load(); say('Job created ✓'); }} />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                      background: '#22c55e', color: '#0f1729', padding: '10px 18px', borderRadius: 20,
                      fontSize: 13, fontWeight: 700, zIndex: 2000 }}>{toast}</div>
      )}
    </div>
  );
}
