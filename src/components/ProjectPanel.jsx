// ============================================
// ProjectPanel — a project in hours, and only in hours.
// ============================================
// "Overwatch is NOT going to do accounting. Overwatch gets a budget of hours
//  available, and all the hours logged to it, and a delta. The billing person
//  gets to say when it is progress invoiced — NO DOLLARS — and then when it is
//  complete. That's it."
//
// WHAT THIS REPLACES
// The fixed-fee panel asked for six money fields — contract, rate per hour,
// materials cost, materials billed, billed to date — and drew a bar out of
// hours × rate against contract minus materials. That is a P&L, rebuilt by
// hand, in a field-service app, next to a real one in QuickBooks that
// disagrees with it. Every number typed here was a second version of a number
// that already existed somewhere authoritative.
//
// Three numbers survive, and they are the three Overwatch is actually the
// source of truth for:
//
//   BUDGET   hours the job was sold with        — someone scoped it
//   LOGGED   hours techs have put against it    — time_entries, the only
//                                                 authoritative record of hours
//   DELTA    budget − logged                    — the whole question
//
// A negative delta is the thing worth knowing before an invoice goes out, and
// no dollar figure is needed to see it.
//
// TWO STAMPS, NO AMOUNTS
//   Progress invoiced — billing says an invoice went out. Not how much.
//                       Repeatable: a long project bills several times, and
//                       the count is what says so.
//   Complete          — billing says the work is settled. This is the close-out.
//
// Both are gated on canBill for the same reason the Billed status is: the
// field does not get to say what has been invoiced. Setting the BUDGET is not
// gated — that is scoping, decided when the job was sold, and the person
// running the work is who knows it.

import { useState, useRef } from 'react';
import { supabase, jobsApi, JOB_STATUS } from '../services/supabase.js';
import { canBill } from '../utils/ownership.js';

const C = {
  card: '#111f34', line: '#1d2f48', line2: '#263a55',
  text: '#edf4ff', muted: '#8ea0b8',
  under: '#22d16f', over: '#ff4f5e', budget: '#8b5cf6',
  stamp: '#38bdf8', done: '#64748b', amber: '#f59e0b', teal: '#5eead4',
};

const fmt$ = (n) => {
  const v = Number(n) || 0;
  return v >= 1000
    ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
    : `$${v.toLocaleString()}`;
};

const hrs = (n) => {
  const v = Number(n) || 0;
  // Two decimals on hours reads as an invoice line. One is enough to see a
  // budget slipping, and rounds the way people say it out loud.
  return `${v.toFixed(1)}h`;
};

const shortDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
};

export default function ProjectPanel({ job, loggedMinutes = 0, userEmail, onChanged, compact = false }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');

  // Dollar field overrides — kept locally until blur, then saved
  const [dollarOverrides, setDollarOverrides] = useState({});

  if (!job) return null;

  const mayBill = canBill(userEmail);
  // hours_budget is the new home. estimated_hours is where the number lived
  // before and is still populated on older rows, so read through to it rather
  // than showing "no budget" for a project that has one.
  const budget = Number(job.hours_budget ?? job.estimated_hours) || 0;
  const logged = (Number(loggedMinutes) || 0) / 60;
  const delta = budget - logged;
  const over = budget > 0 && delta < 0;
  const pct = budget > 0 ? Math.min(100, (logged / budget) * 100) : 0;
  const invoiced = Number(job.progress_invoice_count) || 0;
  const complete = job.is_complete === true;

  // Dollar fields — live values from overrides or DB
  const contractVal  = dollarOverrides.estimate_amount  !== undefined ? dollarOverrides.estimate_amount  : (Number(job.estimate_amount)  || null);
  const invoicedVal  = dollarOverrides.invoiced_amount  !== undefined ? dollarOverrides.invoiced_amount  : (Number(job.invoiced_amount)  || null);
  const remainingVal = dollarOverrides.remaining_amount !== undefined ? dollarOverrides.remaining_amount
    : (Number(job.remaining_amount) || (contractVal != null && invoicedVal != null ? contractVal - invoicedVal : null));

  const saveDollar = async (field, raw) => {
    const num = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return;
    setDollarOverrides(prev => ({ ...prev, [field]: num }));
    setBusy(true);
    try {
      // Also recalculate remaining when contract or invoiced changes
      const updates = { [field]: num, updated_by: userEmail };
      if (field === 'estimate_amount' || field === 'invoiced_amount') {
        const newContract = field === 'estimate_amount' ? num : contractVal;
        const newInvoiced = field === 'invoiced_amount' ? num : invoicedVal;
        if (newContract != null && newInvoiced != null) {
          updates.remaining_amount = newContract - newInvoiced;
          setDollarOverrides(prev => ({ ...prev, remaining_amount: newContract - newInvoiced }));
        }
      }
      const { error } = await supabase.from('jobs').update(updates).eq('id', job.id);
      if (error) throw error;
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const saveBudget = async () => {
    const v = draft.trim() === '' ? null : Number(draft);
    if (v !== null && (!isFinite(v) || v < 0)) { setErr('Hours has to be a number.'); return; }
    setBusy(true); setErr('');
    try {
      const { error } = await supabase.from('jobs')
        .update({ hours_budget: v, updated_by: userEmail }).eq('id', job.id);
      if (error) throw error;
      await jobsApi.logHistory(job.id, null, null, userEmail,
        v == null ? 'Hours budget cleared' : `Hours budget set to ${v}h`).catch(() => {});
      setEditing(false);
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  // A progress invoice is an EVENT, not a state — a long project has several.
  // Storing a count plus the latest date says "billed three times, last on the
  // 14th" without a second table, and without ever asking for an amount.
  const stampProgress = async () => {
    if (!mayBill) return;
    if (!window.confirm(
      `Record a progress invoice for ${job.customer_name || 'this project'}?\n\n` +
      `No amount is stored — Overwatch does not do accounting. This only says ` +
      `an invoice went out today, and who said so.`)) return;
    setBusy(true); setErr('');
    try {
      const { error } = await supabase.from('jobs').update({
        progress_invoiced_at: new Date().toISOString(),
        progress_invoiced_by: userEmail,
        progress_invoice_count: invoiced + 1,
        updated_by: userEmail,
      }).eq('id', job.id);
      if (error) throw error;
      await jobsApi.logHistory(job.id, null, null, userEmail,
        `Progress invoice #${invoiced + 1} recorded — ${hrs(logged)} logged against ${budget ? hrs(budget) : 'no budget'}`)
        .catch(() => {});
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  // CLOSE IT OUT. "When it is complete — that's it."
  // Two writes, deliberately: the flag says the money side is settled, and the
  // status move takes the card off the active board. Doing only the first
  // leaves a finished project sitting in a work lane forever, which is the
  // half-done state the whole closed ≠ complete rule exists to keep honest.
  const markComplete = async () => {
    if (!mayBill) return;
    const warn = over
      ? `\n\n⚠ This is ${hrs(Math.abs(delta))} OVER its ${hrs(budget)} budget.`
      : '';
    if (!window.confirm(
      `Close out ${job.customer_name || 'this project'}?${warn}\n\n` +
      `${hrs(logged)} logged${budget ? ` against ${hrs(budget)}` : ''}.\n\n` +
      `It leaves the board and leaves Billing — its hours too. It stays on the ` +
      `customer's record, where you can re-open it.`)) return;
    setBusy(true); setErr('');
    try {
      const { error } = await supabase.from('jobs').update({
        is_complete: true,
        completed_at: new Date().toISOString(),
        completed_by: userEmail,
        updated_by: userEmail,
      }).eq('id', job.id);
      if (error) throw error;
      // ── WHICH STATUS A CLOSED PROJECT TAKES ───────────────────────────
      // This wrote `complete`, and the comment above it claimed that took the
      // card off the board. IT DOES NOT. `complete` is in BoardView's ACTIVE
      // list and BILLING_LANE covers ['complete','to_bill'] — so closing a
      // project OUT would have moved it INTO the Done — To Bill lane. The
      // opposite of gone, and it would have grown the same To Bill column that
      // is already eleven cards, seven of them with no hours.
      //
      // `billed` is the status that actually leaves the board, and it is the
      // honest one here: BILLED_LANE's own definition is "nothing further owed
      // on it," which is precisely what closing out a project says. The money
      // meaning lives in is_complete / completed_at / completed_by, written
      // above; this is the lane, and only canBill can reach it either way.
      if (job.status !== 'billed') {
        await jobsApi.changeStatus(job.id, 'billed', userEmail,
          `Project closed out — ${hrs(logged)} logged${budget ? ` against a ${hrs(budget)} budget` : ''}${over ? `, ${hrs(Math.abs(delta))} over` : ''}`);
      }
      // ── IT HAS TO COMPLETELY GO AWAY ──────────────────────────────────
      // "It needs to completely go away in the billing view once I close it
      //  out." Flagging the job is not enough: its HOURS are separate rows,
      //  and Billing reads time_entries. A closed project whose visits still
      //  sit in the queue is the same job asking to be dealt with twice.
      //
      // resolved_at is the one switch that takes a visit off that screen for
      // good — the same mechanism migration 042 used to settle 193 pre-July
      // entries. Not `billed`: these were never invoiced by the hour, and
      // stamping them billed would put a lie in the row to tidy a screen.
      try {
        const { error: tErr } = await supabase.from('time_entries').update({
          resolved_at: new Date().toISOString(),
          resolution_reason: 'Project closed out — covered by the agreed price',
        }).eq('job_id', job.id).is('resolved_at', null);
        if (tErr) console.warn('project hours not settled:', tErr.message);
      } catch (e) { console.warn('project hours not settled:', e?.message || e); }
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const reopen = async () => {
    if (!mayBill) return;
    setBusy(true); setErr('');
    try {
      const { error } = await supabase.from('jobs')
        .update({ is_complete: false, updated_by: userEmail }).eq('id', job.id);
      if (error) throw error;
      // Re-opening puts the hours back in the queue. A close-out that cannot be
      // undone cleanly is one people stop using.
      await supabase.from('time_entries')
        .update({ resolved_at: null, resolution_reason: null })
        .eq('job_id', job.id)
        .eq('resolution_reason', 'Project closed out — covered by the agreed price');
      // Put the CARD back as well. Clearing is_complete alone left it sitting
      // in `billed`, off the board, so "re-open" re-opened nothing anyone
      // could see. Back to to_bill — work that happened and is not settled.
      if (job.status === 'billed') {
        await jobsApi.changeStatus(job.id, JOB_STATUS.TO_BILL, userEmail,
          'Project re-opened — not settled after all');
      } else {
        await jobsApi.logHistory(job.id, null, null, userEmail, 'Project re-opened — not settled after all').catch(() => {});
      }
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };

  const Btn = ({ onClick, tone, children, title }) => (
    <button onClick={onClick} disabled={busy} title={title}
      style={{ background: 'transparent', border: `1px solid ${tone}`, color: tone,
               borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 800,
               cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  );


  return (
    <div style={{ background: C.card, border: `1px solid ${complete ? C.line : C.line2}`,
                  borderRadius: 14, padding: compact ? '11px 13px' : '14px 15px',
                  marginBottom: 10, opacity: complete ? 0.72 : 1 }}>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.08em',
                       textTransform: 'uppercase', color: C.budget }}>
          📐 Project
        </span>
        <span style={{ fontSize: compact ? 14 : 15, fontWeight: 800, flex: 1, minWidth: 0, color: C.text }}>
          {job.customer_name || 'Project'}
        </span>
        {complete && (
          <span style={{ fontSize: 11, fontWeight: 900, color: C.done,
                         border: `1px solid ${C.done}`, borderRadius: 999, padding: '2px 9px' }}>
            ✓ COMPLETE
          </span>
        )}
      </div>

      {/* THE THREE NUMBERS. Nothing else, because nothing else is ours. */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: '.06em' }}>BUDGET</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: budget ? C.text : C.muted }}>
            {budget ? hrs(budget) : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: '.06em' }}>LOGGED</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{hrs(logged)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: '.06em' }}>DELTA</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: !budget ? C.muted : over ? C.over : C.under }}>
            {budget ? `${delta >= 0 ? '' : '−'}${hrs(Math.abs(delta))}` : '—'}
          </div>
        </div>
      </div>

      {/* One bar, one message: how much of the budget is gone. Red past the
          end. A project with no budget gets no bar rather than a fake one. */}
      {budget > 0 && (
        <div style={{ marginTop: 10, height: 10, borderRadius: 5, overflow: 'hidden', background: '#0b1628' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: over ? C.over : C.budget }} />
        </div>
      )}
      {budget <= 0 && (
        <div style={{ marginTop: 9, fontSize: 12, color: C.muted }}>
          No hours budget yet — set one and the delta starts working.
        </div>
      )}

      {/* ── Dollar section: contract value / invoiced to date / remaining ── */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <DollarField
            label="Contract value"
            value={contractVal}
            onSave={v => saveDollar('estimate_amount', v)}
            color={C.text}
            disabled={!mayBill && contractVal != null}
          />
          <DollarField
            label="Invoiced to date"
            value={invoicedVal}
            onSave={v => saveDollar('invoiced_amount', v)}
            color={C.stamp}
            disabled={!mayBill}
          />
          <div>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: '.06em' }}>REMAINING</div>
            <div style={{ fontSize: 17, fontWeight: 900,
              color: remainingVal == null ? C.muted : remainingVal <= 0 ? C.under : C.amber }}>
              {remainingVal != null ? fmt$(remainingVal) : '—'}
            </div>
          </div>
        </div>
        {contractVal != null && invoicedVal != null && (
          <div style={{ marginTop: 7, height: 6, borderRadius: 3, overflow: 'hidden', background: '#0b1628' }}>
            <div style={{
              width: `${Math.min(100, Math.round((invoicedVal / contractVal) * 100))}%`,
              height: '100%',
              background: invoicedVal >= contractVal ? C.under : C.teal,
              transition: 'width 0.4s'
            }} />
          </div>
        )}
      </div>

      {/* What billing has said so far. Dates and counts. */}
      {(invoiced > 0 || complete) && (
        <div style={{ marginTop: 9, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
          {invoiced > 0 && (
            <span style={{ color: C.stamp }}>
              🧾 {invoiced} progress invoice{invoiced === 1 ? '' : 's'}
              {job.progress_invoiced_at ? ` · last ${shortDate(job.progress_invoiced_at)}` : ''}
            </span>
          )}
          {complete && (
            <span style={{ color: C.done }}>
              ✓ closed out {shortDate(job.completed_at)}
            </span>
          )}
        </div>
      )}

      {err && <div style={{ marginTop: 8, fontSize: 12, color: C.over }}>{err}</div>}

      <div style={{ marginTop: 11, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {!editing && (
          <Btn onClick={() => { setDraft(budget ? String(budget) : ''); setEditing(true); }} tone={C.muted}>
            {budget ? 'Change budget' : 'Set hours budget'}
          </Btn>
        )}
        {/* Billing's two calls, and only billing's. Hidden rather than
            disabled: a greyed button a tech can never press is a nag. */}
        {mayBill && !complete && (
          <Btn onClick={stampProgress} tone={C.stamp}
            title="Says an invoice went out. Not how much.">
            🧾 Progress invoiced
          </Btn>
        )}
        {mayBill && !complete && (
          <Btn onClick={markComplete} tone={C.under} title="Settled. Takes it off the board.">
            ✓ Close it out
          </Btn>
        )}
        {mayBill && complete && (
          <Btn onClick={reopen} tone={C.muted}>Re-open</Btn>
        )}
      </div>

      {editing && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}`,
                      display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Hours sold</label>
          <input type="number" step="0.5" min="0" autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="e.g. 24"
            style={{ width: 110, background: '#0f1729', border: `1px solid ${C.line2}`,
                     borderRadius: 8, color: C.text, padding: '8px 10px', fontSize: 14,
                     fontFamily: 'inherit', outline: 'none' }} />
          <Btn onClick={saveBudget} tone={C.under}>{busy ? 'Saving…' : 'Save'}</Btn>
          <Btn onClick={() => { setEditing(false); setErr(''); }} tone={C.muted}>Cancel</Btn>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INLINE-EDITABLE DOLLAR FIELD
// ─────────────────────────────────────────────────────────────────────────────
function DollarField({ label, value, onSave, color, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const inputRef              = useRef(null);

  function startEdit(e) {
    e.stopPropagation();
    if (disabled) return;
    setDraft(value != null ? String(value) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }
  function commit() {
    setEditing(false);
    const num = parseFloat(draft.replace(/[^0-9.]/g, ''));
    if (!isNaN(num)) onSave(num);
  }
  return (
    <div onClick={editing ? undefined : startEdit}
      style={{ cursor: disabled ? 'default' : 'text', minWidth: 80 }}>
      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: '.06em' }}>
        {label.toUpperCase()}
      </div>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          onClick={e => e.stopPropagation()}
          style={{ width: 90, background: '#0f1729', border: `1px solid ${C.teal}`, borderRadius: 5,
                   color: C.teal, padding: '2px 6px', fontSize: 14, fontWeight: 800,
                   outline: 'none', fontFamily: 'inherit' }}
        />
      ) : (
        <div style={{ fontSize: 17, fontWeight: 900, color: value != null ? color : C.muted,
                      fontVariantNumeric: 'tabular-nums' }}>
          {value != null
            ? fmt$(value)
            : disabled
              ? '—'
              : <span style={{ fontSize: 12, color: '#475569' }}>tap to set</span>}
        </div>
      )}
    </div>
  );
}
