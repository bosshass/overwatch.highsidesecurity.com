// ============================================
// Unbilled — hours and materials, by customer
// ============================================
// WHY THIS EXISTS
//   The finish sheet writes every visit to `time_entries` (310 rows, 728 hours).
//   The old Billing screen read hours from `job_assignments.actual_hours` — a
//   table with 18 rows in it. Two different tables. Billing has never once
//   looked at the one the techs actually fill in. 315 hours and 62 visits
//   carrying materials were invisible.
//
// WHAT THIS DOES
//   Groups every UNBILLED time entry BY CUSTOMER, not by job. That's the whole
//   point: Nordic goes visit → return → return → estimate → won, and each of
//   those wrote its own time_entries row. When you finally bill, you need all
//   of them in front of you — the two earlier trips AND the materials — not
//   whichever single job happens to be in the To Bill column.
//
//   Tick the visits going on the invoice, drop in the invoice ref, mark billed.
//   That stamps billed / billed_at / invoice_ref on those rows and they leave
//   the queue. The `billed` flag already existed; nothing was ever using it.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, jobsApi, STATUS_INFO } from '../services/supabase.js';
import { unbilledBucket as bucketOf } from '../utils/jobResolve.js';
import { canBill } from '../utils/ownership.js';
import ProjectPanel from '../components/ProjectPanel.jsx';
import ArchiveModal from '../components/ArchiveModal.jsx';
import { reasonLabel, isNotReal } from '../config/archiveReasons.js';


// ── BUCKETS ──────────────────────────────────────────────────────────
// The old screen showed every unbilled hour as if you could invoice it. You
// can't. Of ~150 unbilled hours only ~12 are actually invoiceable — the rest
// are waiting on a return, sat on a job somebody marked DEAD, or belong to no
// job at all. Showing them together wastes your time and hides the real
// problem, so an hour now goes in the bucket that says what has to happen next.
export const BUCKETS = [
  { key: 'ready',    label: '✅ Ready to bill',        color: '#22c55e',
    blurb: 'The work is done and the job is closed out. Invoice these.' },
  { key: 'project',  label: '📐 Project hours',        color: '#8b5cf6',
    blurb: 'Covered by a fixed-fee contract. These hours are real cost against the project and are NOT invoiced separately — but they stay visible here until the project closes, so the cost never disappears.' },
  { key: 'sales',    label: '💬 Sales / pre-sale',     color: '#0ea5e9',
    blurb: 'Estimates and sales calls. Time spent winning the work, not delivering it. Never invoiceable.' },
  { key: 'absorbed', label: '🧾 Absorbed cost',        color: '#64748b',
    blurb: 'Warranty, goodwill, duplicate or contract work already archived with a reason. Real cost with zero revenue — kept visible so profitability stays honest.' },
  { key: 'return',   label: '🔄 Waiting on a return',  color: '#ec4899',
    blurb: 'You CANNOT bill these until someone goes back. The customer is waiting, and every day this sits is a day of unbilled work AND a day of bad service.' },
  { key: 'progress', label: '🚧 Still in progress',    color: '#3b82f6',
    blurb: 'Scheduled, estimating, or mid-job. Not billable yet — nothing to do here.' },
  { key: 'dead',     label: '⚠️ Worked, then killed',  color: '#f59e0b',
    blurb: 'A tech spent these hours and the job was later marked dead, lost or archived. Somebody has to DECIDE: bill it anyway, or archive it as cost DRH absorbed. Right now it is just sitting there.' },
  { key: 'nojob',    label: '🔗 No job on the board',  color: '#94a3b8',
    blurb: 'Work with no job attached. Make a ticket to chase it, or — if it was already invoiced in QuickBooks — mark it billed straight from here without creating one.' },
  { key: 'trip',     label: '🚫 Trip to bill',         color: '#b91c1c',
    blurb: 'The tech went out and could not do the work — nobody there, no access, wrong parts. Nothing was fixed, so this is NOT finished work, but the trip happened and it is chargeable. Invoice the trip, then decide whether it needs rebooking.' },
  { key: 'nodispo',  label: '⏳ Nobody closed it out',  color: '#eab308',
    blurb: 'The visit date passed more than 30 days ago and no tech ever said what happened — no hours, no disposition, nothing. After a month nobody remembers. Decide now: bill it, write it off, or rebook it.' },
  { key: 'nohours',  label: '⏱ To bill, no hours',    color: '#f97316',
    blurb: 'The job is marked To Bill but nobody logged time against it. It shows as done on the board and is invisible on an invoice. Either the hours were never clocked, or it should not be in To Bill. Open it and decide.' },
  { key: 'mismatch', label: '❓ Job says billed',      color: '#a855f7',
    blurb: 'The job is marked billed but this time entry never was. A reconciliation gap — check whether it made the invoice.' },
];
export const BUCKET_BY_KEY = Object.fromEntries(BUCKETS.map(b => [b.key, b]));


const daysSince = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;

// A single visit longer than this is almost certainly a tech who never clocked
// out. Flag it — don't silently put it on an invoice.
const SUSPICIOUS_HOURS = 12;

const hrs = (mins) => (mins || 0) / 60;
const fmtH = (h) => `${(Math.round(h * 10) / 10).toFixed(1)}h`;
const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';


// ── PROJECTS, IN HOURS ───────────────────────────────────────────────────────
// This was FixedFeeProjects: six money fields (contract, rate per hour,
// materials cost, materials billed, billed to date) and a bar drawn from
// hours × rate against contract minus materials. A P&L rebuilt by hand in a
// field-service app, next to a real one in QuickBooks that disagreed with it.
//
// "Overwatch is NOT going to do accounting. Overwatch gets a budget of hours
//  available, and all the hours logged to it, and a delta."
//
// So it shows the three numbers Overwatch is genuinely the source of truth
// for, and hands the two decisions that are billing's to ProjectPanel —
// progress invoiced, and complete. No dollars anywhere.
function FixedFeeProjects({ userEmail }) {
  const [rows, setRows] = useState(null);
  const [used, setUsed] = useState({});

  // Anyone who can open Billing can SEE this. The stamps inside ProjectPanel
  // are gated on canBill; the readout is not, because "are we over on hours"
  // is a question the person running the work needs answered too.
  const load = useCallback(async () => {
    const { data: js } = await supabase.from('jobs')
      .select('id, customer_name, status, is_fixed_fee, job_type, hours_budget, estimated_hours, is_complete, completed_at, progress_invoice_count, progress_invoiced_at')
      .or('is_fixed_fee.eq.true,job_type.eq.project')
      .not('status', 'in', '(dead,archived,lost)')
      // CLOSED MEANS GONE FROM HERE. "It needs to completely go away in the
      // billing view once I close it out." A finished project rendered at 70%
      // opacity is still a row to read past every time this screen opens, and
      // there are more of those every month. It stays on the customer record,
      // which is where a settled project belongs.
      .or('is_complete.is.null,is_complete.eq.false')
      .limit(200);
    const list = js || [];
    setRows(list);
    if (list.length) {
      const { data: te } = await supabase.from('time_entries')
        .select('job_id, total_minutes, archived')
        .in('job_id', list.map(j => j.id)).limit(3000);
      const m = {};
      (te || []).filter(e => !e.archived).forEach(e => {
        m[e.job_id] = (m[e.job_id] || 0) + (e.total_minutes || 0);
      });
      setUsed(m);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (rows === null || rows.length === 0) return null;

  const live = rows;

  return (
    <div style={{ margin: '0 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.09em',
                       textTransform: 'uppercase', color: '#8ea0b8' }}>
          Projects — hours
        </span>
        <span style={{ background: '#8b5cf622', color: '#a78bfa', fontSize: 11,
                       fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
          {live.length}
        </span>
      </div>

      {rows.map(j => (
        <ProjectPanel key={j.id} job={j} loggedMinutes={used[j.id] || 0}
          userEmail={userEmail} onChanged={load} />
      ))}
    </div>
  );
}

export default function Unbilled({ onBack, userEmail }) {
  // ── TECH FILTER ─────────────────────────────────────────────────────
  // Driven by ?tech= so the calendar can hand off directly: tapping a tech's
  // utilisation column lands here already scoped to their unbilled work,
  // still grouped by customer and still in the same buckets. Billing by
  // customer is the right unit — Nordic's three visits belong on one invoice
  // — so the tech is a filter over that grouping, never a regrouping.
  const [searchParams, setSearchParams] = useSearchParams();
  const techFilter = searchParams.get('tech') || '';
  const clearTech = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('tech');
    setSearchParams(next, { replace: true });
  };

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [groups, setGroups] = useState([]);
  const [openKey, setOpenKey] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [invoiceRef, setInvoiceRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [archiving, setArchiving] = useState(false);
  // When a "clear" action opens the modal, this holds what to clear. The modal
  // is the ONLY route out of Billing that is not an invoice, so it is the only
  // place the absorbed-vs-never-happened distinction can be captured — and
  // after the fact nobody remembers. See config/archiveReasons.js.
  const [clearTarget, setClearTarget] = useState(null);
  // "They don't get to tell us how much they were invoicing." Everyone who can
  // open this screen can read it and can CLEAR a row with a reason — that is
  // bookkeeping hygiene. Only billing can assert that an invoice went out.
  const mayBill = canBill(userEmail);
  // "I show Jeanneret as a client in my to bill — I want to select the time
  // entry and merge it into the job." Two things that had no control anywhere
  // in the app: attaching loose hours to a card, and saying that a job's hours
  // are covered by a fixed price rather than invoiced by the hour.
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeJobs, setMergeJobs] = useState(null);   // null = loading
  const [mergeQ, setMergeQ] = useState('');
  const [newProj, setNewProj] = useState(null);   // {name, hours} while typing

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data: entries, error } = await supabase
        .from('time_entries')
        .select('id, customer_id, customer_name_raw, event_title, event_start, tech_name, total_minutes, disposition, notes, materials, billed, billed_at, invoice_ref, archived, archive_reason, billable, non_billable_reason, resolved_at, resolution_reason, job_id, calendar_event_id')
        .or('billed.is.null,billed.eq.false')
        // resolved_at is the ONE switch that takes a visit off this screen for
        // good. 193 pre-July entries were closed out in migration 042; without
        // this filter every one of them still reported as unbilled work.
        .is('resolved_at', null)
        // .gt('total_minutes', 0) REMOVED — it dropped every visit with no
        // clocked time straight out of the result set, with nothing on any
        // screen to say so. A job could read "To Bill" on the board and simply
        // not exist in Billing. Zero-hour work now surfaces in its own bucket.
        .order('event_start', { ascending: true });
      if (error) throw error;

      // The job's STATUS is what decides whether an hour can actually be
      // invoiced. Most time entries have a null job_id and link through
      // calendar_event_id instead, so we resolve both ways.
      const { data: jobRows } = await supabase
        .from('jobs')
        // scheduled_date joins the select for the 30-day no-disposition sweep
        // below. Without it every job reads as undated and nothing can age.
        // is_fixed_fee joins the select so unbilledBucket can tell that a job's
        // hours are cost against an agreed price rather than an invoice line.
        // Without it every fixed-fee hour reads as ready to bill.
        .select('id, status, calendar_event_id, customer_name, customer_id, updated_at, scheduled_date, is_fixed_fee, estimate_amount')
        .limit(5000);
      const jobById = {}, jobByEvent = {};
      (jobRows || []).forEach(j => {
        jobById[j.id] = j;
        if (j.calendar_event_id) jobByEvent[j.calendar_event_id] = j;
      });
      const jobFor = (e) => jobById[e.job_id] || jobByEvent[e.calendar_event_id] || null;

      const ids = [...new Set((entries || []).map(e => e.customer_id).filter(Boolean))];
      let cust = {};
      if (ids.length) {
        const { data: cs } = await supabase.from('customers').select('id, name, short_code').in('id', ids);
        (cs || []).forEach(c => { cust[c.id] = c; });
      }

      // Filter BEFORE grouping so the customer totals on screen are the totals
      // for this tech, not a whole-shop number with some rows hidden under it.
      const scoped = techFilter
        ? (entries || []).filter(e => (e.tech_name || '').toLowerCase() === techFilter.toLowerCase())
        : (entries || []);

      // ── TEST DATA LEAVES. ────────────────────────────────────────────
      // A not_real entry — test, duplicate, data mistake — never happened, so
      // there is nothing for this screen to be a queue OF. It is dropped
      // outright rather than bucketed, because a bucket is still a row to read
      // past and these accumulate forever.
      //
      // Absorbed and sales entries are NOT dropped: those are real hours DRH
      // ate, and hiding them is how a customer who costs money starts looking
      // profitable.
      const notReal = (e) => e.archived && isNotReal(e.archive_reason);
      // Jobs whose ONLY hours are not-real must not then reappear in the
      // no-hours sweep below as "marked done, nobody logged time" — the time
      // WAS logged and then correctly disowned. Same rule CustomerHistory uses.
      const realByJob = {};
      (entries || []).forEach(e => {
        if (!e.job_id) return;
        realByJob[e.job_id] = (realByJob[e.job_id] || 0) + (notReal(e) ? 0 : 1);
      });
      const allTestJobs = new Set(Object.entries(realByJob)
        .filter(([, n]) => n === 0).map(([id]) => id));

      const byCustomer = {};
      scoped.filter(e => !notReal(e)).forEach(e0 => {
        const job = jobFor(e0);
        // Zero clocked minutes is its own problem, not a 'ready to bill'.
        const b0 = bucketOf(job, e0);
        // The zero-minutes downgrade applies to work that claims to be
        // FINISHED. A blocked trip is not finished and is expected to carry
        // almost no clocked time, so it keeps its own bucket.
        const e = { ...e0, _job: job,
                    _bucket: (b0 === 'ready' && !(e0.total_minutes > 0)) ? 'nohours' : b0 };
        // Group on the customer UUID where we have one. Where we don't, the
        // entry is ORPHANED — it still needs billing, but it also needs a
        // client attached, and we say so instead of quietly merging it in.
        const key = `${e._bucket}::${e.customer_id || `orphan:${e.customer_name_raw || 'unknown'}`}`;
        byCustomer[key] ||= {
          key,
          bucket: e._bucket,
          job: e._job,
          customerId: e.customer_id || null,
          name: cust[e.customer_id]?.name || e.customer_name_raw || 'Unknown',
          shortCode: cust[e.customer_id]?.short_code || null,
          orphan: !e.customer_id,
          visits: [],
        };
        byCustomer[key].visits.push(e);
      });

      // ── Jobs that are marked done and have NO time entry pointing at them.
      // Nothing in this screen ever looked for these, because it only ever
      // walked time_entries. A ticket dispositioned "Bill it" from the audit
      // writes a job status and no hours, so it sat on the board as To Bill and
      // did not exist here. That is the ticket "floating in space."
      // The entries query above only returns UNBILLED time. So a job whose hours
      // were already invoiced has no rows here and looked like it had no hours
      // at all — Womack, Temple and BG Longmont were landing in this bucket
      // when they are simply done and paid. Ask the database which jobs have
      // ANY time against them, billed or not, before calling one empty.
      const { data: everBilled } = await supabase
        .from('time_entries').select('job_id, calendar_event_id')
        .not('billed', 'is', false)
        .limit(5000);
      const hasAnyTime = new Set();
      (everBilled || []).forEach(t => {
        if (t.job_id) hasAnyTime.add(t.job_id);
        if (t.calendar_event_id && jobByEvent[t.calendar_event_id])
          hasAnyTime.add(jobByEvent[t.calendar_event_id].id);
      });

      const seenJobIds = new Set((entries || []).map(e => e.job_id).filter(Boolean));
      allTestJobs.forEach(id => seenJobIds.add(id));
      (entries || []).forEach(e => { const j = jobFor(e); if (j) seenJobIds.add(j.id); });
      // A job with NO time entry has no tech on it, so it cannot belong to any
      // one person's column. Under a tech filter it would be noise attributed
      // to someone who may never have been there — leave it to the unfiltered
      // view, which is where it gets chased.
      // `blocked` joins complete/to_bill here. A wasted trip is chargeable the
      // day it happens, and it will usually have NO time entry at all — the
      // tech turned around. Waiting for the 30-day sweep below to notice it
      // would mean a month of a billable trip being invisible, which is the
      // exact failure the blocked option was added to prevent.
      const NOHOURS_STATUSES = ['complete', 'to_bill', 'blocked'];
      (techFilter ? [] : (jobRows || []))
        .filter(j => NOHOURS_STATUSES.includes(j.status)
                  && !seenJobIds.has(j.id) && !hasAnyTime.has(j.id))
        .forEach(j => {
          const key = `nohours::job:${j.id}`;
          byCustomer[key] = {
            key,
            // A blocked card is a trip, not a hole in the data.
            bucket: j.status === 'blocked' ? 'trip' : 'nohours',
            job: j, customerId: null,
            name: j.customer_name || 'Unknown', shortCode: null,
            orphan: false, noEntries: true, visits: [],
          };
        });

      // ── NOBODY EVER CLOSED IT OUT ────────────────────────────────────
      // Sara's rule: "greater than 30 days old, flag as no dispo, push to
      // billing." A visit date that passed a month ago with NO time entry and
      // NO disposition is not work in progress — it is a decision nobody made,
      // and after thirty days nobody remembers enough to make it well. It has
      // to stop being invisible and land in front of whoever invoices.
      //
      // THIRTY DAYS, not seven: a card whose date slipped by a week is usually
      // just a tech who has not written it up yet, and flagging those would
      // bury the real ones. A month is past every honest explanation.
      //
      // Deliberately NOT limited to to_bill/complete like the sweep above.
      // The cards this is for are stuck in `scheduled` and `return_pending` —
      // lanes that say the work is still coming — which is exactly why nothing
      // has ever surfaced them.
      const NODISPO_DAYS = 30;
      const nodispoFloor = new Date(Date.now() - NODISPO_DAYS * 86400000);
      const NODISPO_SKIP = ['dead', 'archived', 'lost', 'billed', 'complete',
                            'new', 'needs_estimate', 'estimate_sent', 'won'];
      (techFilter ? [] : (jobRows || []))
        .filter(j => !NODISPO_SKIP.includes(j.status)
                  && j.scheduled_date && new Date(j.scheduled_date) < nodispoFloor
                  && !seenJobIds.has(j.id) && !hasAnyTime.has(j.id)
                  && !byCustomer[`nohours::job:${j.id}`]
                  && j.status !== 'blocked')
        .forEach(j => {
          const key = `nodispo::job:${j.id}`;
          byCustomer[key] = {
            key, bucket: 'nodispo', job: j, customerId: null,
            name: j.customer_name || 'Unknown', shortCode: null,
            orphan: false, noEntries: true, visits: [],
            staleDays: Math.floor((Date.now() - new Date(j.scheduled_date).getTime()) / 86400000),
          };
        });

      const list = Object.values(byCustomer).map(g => ({
        ...g,
        waitingDays: g.bucket === 'return' ? daysSince(g.visits[0]?.event_start) : 0,
        hours: g.visits.reduce((s, v) => s + hrs(v.total_minutes), 0),
        materialVisits: g.visits.filter(v => v.materials && v.materials.trim()).length,
        suspicious: g.visits.filter(v => hrs(v.total_minutes) > SUSPICIOUS_HOURS).length,
        oldest: g.visits[0]?.event_start,
      })).sort((a, b) => b.hours - a.hours);

      setGroups(list);
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
  }, [techFilter]);

  useEffect(() => { load(); }, [load]);

  // ?tab=project lands here straight from the Project hours tile on Home, so
  // the tile is a real door rather than a number you then have to go looking
  // for. Any bucket key works; an unknown one falls back to Ready.
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState(
    BUCKETS.some(b => b.key === urlTab) ? urlTab : 'ready');

  const byBucket = useMemo(() => {
    const m = {};
    BUCKETS.forEach(b => { m[b.key] = { hours: 0, visits: 0, groups: [] }; });
    groups.forEach(g => {
      const b = m[g.bucket];
      if (!b) return;
      b.hours += g.hours;
      b.visits += g.visits.length;
      b.groups.push(g);
    });
    // Returns sorted by what they're COSTING you: hours held x days waiting.
    // The most expensive, longest-ignored return is always at the top.
    m.return.groups.sort((a, b) => (b.hours * (b.waitingDays + 1)) - (a.hours * (a.waitingDays + 1)));
    return m;
  }, [groups]);

  const shown = useMemo(() => {
    const inTab = byBucket[tab]?.groups || [];
    const q = search.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter(g =>
      g.name.toLowerCase().includes(q) || (g.shortCode || '').toLowerCase().includes(q));
  }, [byBucket, tab, search]);

  const toggle = (id) => setPicked(p => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const pickAll = (g) => setPicked(p => {
    const n = new Set(p);
    const all = g.visits.every(v => n.has(v.id));
    g.visits.forEach(v => all ? n.delete(v.id) : n.add(v.id));
    return n;
  });

  // ── EVERY HOUR THIS CLIENT HAS ─────────────────────────────────────
  // "I should be able to grab all the hours of the client."
  // pickAll above only reaches ONE group, and a customer's unbilled time is
  // split across buckets by design — ready, waiting on a return, no job,
  // project. Ticking them one bucket at a time is how you miss the two that
  // were sitting under a different heading, which is exactly what a project
  // is meant to gather up.
  //
  // Matched on customer_id where there is one, and on the displayed name where
  // there is not — an orphaned entry has no id, and those are usually the very
  // rows that need collecting.
  const pickAllForClient = (g) => setPicked(p => {
    const n = new Set(p);
    const mine = groups.filter(x => g.customerId
      ? x.customerId === g.customerId
      : (x.name || '').toLowerCase() === (g.name || '').toLowerCase());
    const rows = mine.flatMap(x => x.visits || []);
    const all = rows.length > 0 && rows.every(v => n.has(v.id));
    rows.forEach(v => all ? n.delete(v.id) : n.add(v.id));
    return n;
  });

  // How many hours are sitting under this client's name in total, so the
  // button can say what it is about to grab rather than being a leap.
  const clientTotal = (g) => {
    const mine = groups.filter(x => g.customerId
      ? x.customerId === g.customerId
      : (x.name || '').toLowerCase() === (g.name || '').toLowerCase());
    const rows = mine.flatMap(x => x.visits || []);
    return { visits: rows.length, hours: rows.reduce((t, v) => t + hrs(v.total_minutes), 0), groups: mine.length };
  };

  // Everything currently ticked, across every customer
  const sel = useMemo(() => {
    const rows = groups.flatMap(g => g.visits.filter(v => picked.has(v.id)).map(v => ({ ...v, _g: g })));
    return {
      rows,
      hours: rows.reduce((s, v) => s + hrs(v.total_minutes), 0),
      materials: rows.filter(v => v.materials && v.materials.trim()).map(v => v.materials.trim()),
    };
  }, [groups, picked]);

  // Close out a job that is marked done but carries no time. Writes through
  // jobsApi.changeStatus so it lands in job_history and is auditable — the same
  // path every other status move uses.
  const closeNoHours = async (g, target) => {
    if (!g.job?.id) return;
    // /unbilled is OperatorOnly, and operators include JR. Reaching the
    // billing screen is not the same as being the person who invoices, so the
    // one irreversible-looking action on it asks separately.
    if (target === 'billed' && !mayBill) return;
    const label = target === 'billed' ? 'billed' : 'cleared';
    // Clearing needs a reason, not a confirm box. "Not billable" collapsed a
    // warranty callback and a test entry into one string.
    if (target !== 'billed') { setClearTarget({ kind: 'job', group: g }); return; }
    if (!window.confirm(`Mark ${g.name} as ${label}?\n\nNo hours are attached, so nothing goes on an invoice. This only moves the card off the board.`)) return;
    setSaving(true);
    try {
      await jobsApi.changeStatus(g.job.id, target, userEmail,
        target === 'billed'
          ? 'Marked billed from Billing — invoiced outside Overwatch, no hours logged'
          : 'Cleared from Billing — no hours logged, not billable');
      setToast(`${g.name} ${label}`);
      setTimeout(() => setToast(''), 2600);
      await load();
    } catch (e) { setToast('Could not update: ' + (e.message || e)); }
    setSaving(false);
  };

  // ORPHANED HOURS — no job on the board.
  // This bucket used to be pure diagnosis: it named the problem and offered no
  // way out, so the only route for hours you had ALREADY invoiced in QuickBooks
  // was to create a ticket you did not want purely to close them. 16 of the 20
  // billable entries sitting here on 2026-08-06 were in exactly that state,
  // including both Jeanneret days.
  //
  // Marking billed here stamps the time entries and nothing else — there is no
  // job to write through to, which is the whole point. Clearing archives with a
  // reason rather than deleting, so the hours stay auditable.
  const closeOrphan = async (g, target) => {
    const ids = g.visits.map(v => v.id).filter(Boolean);
    if (!ids.length) return;
    if (target === 'billed' && !mayBill) return;
    const n = ids.length;
    if (target !== 'billed') { setClearTarget({ kind: 'orphan', group: g }); return; }
    const msg = `Mark ${n} visit${n > 1 ? 's' : ''} (${fmtH(g.hours)}) for ${g.name} as billed?\n\nNo ticket is created. Use this when the work was already invoiced in QuickBooks.`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      const patch = target === 'billed'
        ? { billed: true, billed_at: new Date().toISOString(), invoice_ref: invoiceRef.trim() || null }
        : { archived: true, archived_at: new Date().toISOString(), archived_by: userEmail,
            archive_reason: 'Cleared from Billing — no job on the board, not billable' };
      const { error } = await supabase.from('time_entries').update(patch).in('id', ids);
      if (error) throw error;
      setToast(`${g.name} — ${n} visit${n > 1 ? 's' : ''} ${target === 'billed' ? 'billed' : 'cleared'}`);
      setTimeout(() => setToast(''), 2600);
      await load();
    } catch (e) { setToast('Could not update: ' + (e.message || e)); }
    setSaving(false);
  };

  // ── FIXED FEE: these hours are cost, not an invoice line ─────────────
  // `billable = false` is read in three places and was written in NONE — zero
  // of 74 entries carry it, so the Project hours bucket has always been empty
  // while fixed-fee work sat in Ready to bill. This is the switch that was
  // missing.
  //
  // It marks the JOB fixed-fee as well as the entries. The flag belongs on the
  // job — that is where the agreed price lives, and it is what makes every
  // FUTURE hour on the same job derive correctly without anyone ticking it.
  // Flagging only the entries would leave the next visit reading as billable
  // and put somebody back here doing this again.
  const markFixedFee = async () => {
    if (!sel.rows.length) return;
    const n = sel.rows.length;
    if (!window.confirm(
      `Mark ${n} visit${n > 1 ? 's' : ''} (${fmtH(sel.hours)}) as fixed-fee project hours?\n\n` +
      `They stay visible as COST — they just stop reading as something to invoice ` +
      `by the hour. The job is flagged fixed-fee so later visits follow automatically.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('time_entries').update({
        billable: false,
        non_billable_reason: 'Fixed fee — covered by the agreed price',
      }).in('id', sel.rows.map(r => r.id));
      if (error) throw error;

      const jobIds = [...new Set(sel.rows.map(r => r.job_id || r._g?.job?.id).filter(Boolean))];
      if (jobIds.length) {
        // is_fixed_fee is not a status, so it does not go through
        // changeStatus — but it IS a decision about money, so it says who made
        // it rather than changing silently.
        await supabase.from('jobs')
          .update({ is_fixed_fee: true, updated_by: userEmail }).in('id', jobIds);
        for (const jid of jobIds) {
          await jobsApi.logHistory(jid, null, null, userEmail,
            'Marked fixed fee — hours are cost against the agreed price, not invoiced by the hour')
            .catch(() => {});
        }
      }
      setToast(`${n} visit${n > 1 ? 's' : ''} — fixed fee`);
      setTimeout(() => setToast(''), 2600);
      setPicked(new Set());
      await load();
    } catch (e) { setToast('Could not update: ' + (e.message || e)); }
    setSaving(false);
  };

  // ── MAKE THE PROJECT THAT SHOULD HAVE EXISTED ────────────────────────
  // "The only thing I should be able to create is a fixed-fee project. If one
  //  doesn't exist, however, since there's hours that should not be marked as
  //  billed, I should be able to grab all the hours of the client, create a new
  //  job and set the budget."
  //
  // Yes — and this is the piece that was missing. Merge could only point hours
  // at a card that ALREADY EXISTED, and the only other way out of this screen
  // was "mark billed", which is the wrong answer for hours covered by a price
  // nobody has written down yet. So the hours sat here looking invoiceable with
  // no honest action available.
  //
  // One action does the whole thing, because doing it in three steps is how it
  // gets left half done:
  //   1. create the project — fixed fee, with the budget typed here
  //   2. point every selected entry at it
  //   3. mark those hours as cost against the price, not invoice lines
  //
  // Status `ready_to_schedule`: a project that already has hours has more days
  // coming, and that is the lane where somebody books them. Not `new` — this is
  // not an unread note — and not `scheduled`, which would claim a date nobody
  // has picked.
  const createProject = async (name, budgetHours) => {
    if (!sel.rows.length) return;
    const clean = String(name || '').trim();
    if (!clean) { setToast('The project needs a name.'); return; }
    const budget = budgetHours === '' || budgetHours == null ? null : Number(budgetHours);
    if (budget != null && (!isFinite(budget) || budget < 0)) { setToast('Budget has to be a number of hours.'); return; }
    setSaving(true);
    try {
      const custId = sel.rows.map(r => r.customer_id || r._g?.customerId).find(Boolean) || null;
      const loggedH = sel.hours;
      const created = await jobsApi.create({
        customer_name: clean,
        customer_id: custId || undefined,
        job_type: 'project',
        is_fixed_fee: true,
        status: 'ready_to_schedule',
        hours_budget: budget ?? undefined,
        issue: `Project — ${budget ? `${budget}h budget` : 'budget not set'}. Opened from Billing to hold ${fmtH(loggedH)} already logged.`,
      }, userEmail);
      if (!created?.id) throw new Error('Project not created');

      const patch = { job_id: created.id, billable: false,
                      non_billable_reason: 'Fixed fee — covered by the agreed price' };
      if (custId) patch.customer_id = custId;
      const { error } = await supabase.from('time_entries')
        .update(patch).in('id', sel.rows.map(r => r.id));
      if (error) throw error;

      await jobsApi.logHistory(created.id, null, null, userEmail,
        `Project opened from Billing holding ${sel.rows.length} visit${sel.rows.length === 1 ? '' : 's'} (${fmtH(loggedH)})${budget ? ` against a ${budget}h budget` : ' — no budget set yet'}`)
        .catch(() => {});

      setToast(`${clean} — project created with ${fmtH(loggedH)} on it`);
      setTimeout(() => setToast(''), 3200);
      setMergeOpen(false);
      setPicked(new Set());
      await load();
    } catch (e) { setToast('Could not create the project: ' + (e.message || e)); }
    setSaving(false);
  };

  // ── MERGE LOOSE HOURS ONTO A JOB ─────────────────────────────────────
  // 163 unarchived entries have no job_id. They show up here under whatever
  // name the calendar event carried, next to the real card for the same
  // customer, and there was no way to put them together — the only routes
  // offered were "make a ticket" (a second card) or "mark billed" (hides it).
  const openMerge = async (g) => {
    setMergeOpen(g);
    setMergeJobs(null);
    setMergeQ('');
    setNewProj(null);
    // Their OPEN jobs first — that is the answer nine times out of ten. The
    // search box below covers the tenth.
    const { data } = await supabase.from('jobs')
      .select('id, customer_name, customer_id, status, scheduled_date, is_fixed_fee, estimate_amount')
      .not('status', 'in', '(dead,lost,archived)')
      .order('scheduled_date', { ascending: false })
      .limit(600);
    setMergeJobs(data || []);
  };

  const doMerge = async (job) => {
    const g = mergeOpen;
    const ids = (g?.visits || []).map(v => v.id).filter(Boolean);
    if (!ids.length || !job?.id) return;
    setSaving(true);
    try {
      const patch = { job_id: job.id };
      // The customer comes along. A loose entry usually has customer_name_raw
      // and no customer_id, which is half of why it was loose.
      if (job.customer_id) patch.customer_id = job.customer_id;
      const { error } = await supabase.from('time_entries').update(patch).in('id', ids);
      if (error) throw error;
      await jobsApi.logHistory(job.id, null, null, userEmail,
        `Merged ${ids.length} loose time ${ids.length === 1 ? 'entry' : 'entries'} (${fmtH(g.hours)}) onto this job from Billing`)
        .catch(() => {});
      setToast(`${ids.length} visit${ids.length > 1 ? 's' : ''} merged into ${job.customer_name}`);
      setTimeout(() => setToast(''), 2600);
      setMergeOpen(false);
      setPicked(new Set());
      await load();
    } catch (e) { setToast('Could not merge: ' + (e.message || e)); }
    setSaving(false);
  };

  // Clearing with a reason. `archive_reason` stores the KEY (warranty,
  // goodwill, sales_call...) not a sentence, so isRealCost() can classify it
  // later. Writing prose here is what made 44 rows unclassifiable.
  const doClearWithReason = async (reason) => {
    const t = clearTarget;
    if (!t) return;
    setSaving(true);
    try {
      if (t.kind === 'orphan') {
        const ids = t.group.visits.map(v => v.id).filter(Boolean);
        const { error } = await supabase.from('time_entries').update({
          archived: true, archived_at: new Date().toISOString(),
          archived_by: userEmail, archive_reason: reason,
        }).in('id', ids);
        if (error) throw error;
      } else {
        await jobsApi.changeStatus(t.group.job.id, 'archived', userEmail,
          `Cleared from Billing — ${reasonLabel(reason)}`);
        const ids = (t.group.visits || []).map(v => v.id).filter(Boolean);
        if (ids.length) {
          await supabase.from('time_entries').update({
            archived: true, archived_at: new Date().toISOString(),
            archived_by: userEmail, archive_reason: reason,
          }).in('id', ids);
        }
      }
      setToast(`${t.group.name} — ${reasonLabel(reason)}`);
      setTimeout(() => setToast(''), 2600);
      setClearTarget(null);
      await load();
    } catch (e) { setToast('Could not update: ' + (e.message || e)); }
    setSaving(false);
  };

  const markBilled = async () => {
    if (!mayBill) return;
    if (!sel.rows.length) return;
    const n = sel.rows.length;
    if (!window.confirm(`Mark ${n} visit${n > 1 ? 's' : ''} (${fmtH(sel.hours)}) as billed?\n\nThey will leave this queue. This does not create an invoice — do that in QuickBooks.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('time_entries')
        .update({
          billed: true,
          billed_at: new Date().toISOString(),
          invoice_ref: invoiceRef.trim() || null,
        })
        .in('id', sel.rows.map(r => r.id));
      if (error) throw error;
      // ── Write-through to the job card ────────────────────────────
      // Marking time billed used to touch time_entries ONLY. The job stayed in
      // to_bill forever, so the home screen counted 18 jobs owed while only 2
      // hours were genuinely unbilled — 13 of those jobs were already paid.
      // Two switches, nobody flipping both.
      //
      // Now: for each job these entries belong to, if NOTHING unbilled is left
      // on it, the job moves to billed. If any unbilled time remains (partial
      // invoice, a second visit not yet billed) the card stays put — it is
      // still genuinely owed. changeStatus writes job_history, so it's auditable.
      try {
        // WAS: sel.rows.map(r => r.job_id) — and 320 of 357 time entries have a
        // NULL job_id, because they link to their job through calendar_event_id
        // instead. So this list came back empty on ~90% of invoices and the
        // write-through below never ran: the hours were marked billed and the
        // job card stayed in To Bill permanently. That is why Temple, Womack
        // and Shelton sit on the board as unbilled work that was already paid.
        //
        // `_job` is the job this screen already resolved for the row (jobFor(),
        // which checks job_id AND calendar_event_id). Use it.
        const jobIds = [...new Set(sel.rows.map(r => r.job_id || r._job?.id).filter(Boolean))];
        for (const jobId of jobIds) {
          // Anything still owed on this job, found the SAME two ways.
          const evIds = [...new Set(sel.rows
            .filter(r => (r.job_id || r._job?.id) === jobId)
            .map(r => r._job?.calendar_event_id || r.calendar_event_id)
            .filter(Boolean))];
          const orParts = [`job_id.eq.${jobId}`,
            ...evIds.map(e => `calendar_event_id.eq.${e}`)];
          const { data: left } = await supabase
            .from('time_entries').select('id')
            .or(orParts.join(','))
            .not('billed', 'is', true)
            .or('archived.is.null,archived.eq.false')
            .limit(1);
          if (left && left.length) continue; // still owed — leave the card alone

          const { data: jobRow } = await supabase
            .from('jobs').select('status').eq('id', jobId).maybeSingle();
          if (jobRow && ['complete', 'to_bill'].includes(jobRow.status)) {
            await jobsApi.changeStatus(
              jobId, 'billed', userEmail,
              invoiceRef.trim() ? `Billed — invoice ${invoiceRef.trim()}` : 'Billed from Unbilled queue'
            );
          }
        }
      } catch (e) {
        // Non-fatal on purpose: the time entries ARE billed at this point.
        // A failure here leaves a stale card, not lost money.
        console.warn('job status write-through failed', e);
      }

      setToast(`${n} visit${n > 1 ? 's' : ''} marked billed ✓`);
      setPicked(new Set());
      setInvoiceRef('');
      await load();
      setTimeout(() => setToast(''), 3500);
    } catch (e) {
      alert('Could not mark billed: ' + (e.message || e));
    }
    setSaving(false);
  };

  // Move every job whose last live visit just went away to a terminal status.
  //
  // WHICH terminal status is decided by the reason's CLASS, and the two are
  // genuinely different facts:
  //
  //   not_real (test / duplicate / mistake) -> 'dead'
  //       No truck rolled. Calling this 'complete' would assert work was done.
  //   everything else (absorbed / sales)    -> 'complete'
  //       The work happened and DRH ate it. That is finished, not cancelled.
  //
  // Deliberately NOT 'archived': that status is frozen — kept so existing rows
  // stay readable, never written again (DECISIONS.md). doClearWithReason above
  // still writes it and is a separate cleanup.
  const settleJobsFor = async (rows, reason) => {
    // RESOLVE THE JOB THE SAME TWO WAYS markBilled DOES. 320 of 357 time
    // entries have a NULL job_id and reach their job through
    // calendar_event_id instead, so keying on job_id alone would find nothing
    // on ~90% of rows and this write-through would quietly never run — the
    // identical failure markBilled was fixed for. `_job` is the job this
    // screen already resolved for the row.
    const jobIds = [...new Set(rows.map(r => r.job_id || r._job?.id).filter(Boolean))];
    if (!jobIds.length) return 0;
    const target = isNotReal(reason) ? 'dead' : 'complete';

    // WRITING OFF THE HOURS IS NOT THE SAME AS THERE BEING NOTHING LEFT TO DO.
    // A job in return_pending owes a second visit; one in estimate_sent is
    // waiting on the customer to answer. Neither obligation is carried by the
    // time already logged, so absorbing those hours as warranty must NOT close
    // the card — that would quietly delete a return somebody is expecting.
    // (Three live jobs sit in exactly that shape today.) Only statuses whose
    // remaining obligation IS the billing may settle this way.
    //
    // not_real is the exception and settles from anywhere: test, duplicate and
    // data-mistake rows describe work that never happened, so whatever lane
    // the card is sitting in, it is sitting there on the strength of a fiction.
    const SETTLEABLE = ['to_bill', 'scheduled', 'complete'];

    let n = 0;
    for (const id of jobIds) {
      const cur = rows.find(r => (r.job_id || r._job?.id) === id)?._job?.status;
      if (!isNotReal(reason) && cur && !SETTLEABLE.includes(cur)) continue;
      // Anything still owed on this job, found BOTH ways, after the archive
      // above has landed.
      const evIds = [...new Set(rows
        .filter(r => (r.job_id || r._job?.id) === id)
        .map(r => r._job?.calendar_event_id || r.calendar_event_id)
        .filter(Boolean))];
      const orParts = [`job_id.eq.${id}`, ...evIds.map(e => `calendar_event_id.eq.${e}`)];
      const { data: left } = await supabase
        .from('time_entries').select('id')
        .or(orParts.join(','))
        .not('billed', 'is', true)
        .not('archived', 'is', true)
        .limit(1);
      if (left && left.length) continue;   // still genuinely owed — leave it
      try {
        await jobsApi.changeStatus(id, target, userEmail,
          `All time written off — ${reasonLabel(reason)}`);
        n++;
      } catch (e) {
        // Never unwind the archive because the status move failed; the hours
        // are the record and they are already correct.
        console.warn('settleJobsFor: status move failed', id, e?.message || e);
      }
    }
    return n;
  };

  // Archive — the REASON matters more than the act. See config/archiveReasons.js:
  // "test" and "warranty" both leave the billing queue, but one never happened
  // and the other is real cost DRH absorbed. Collapsing them would silently
  // make unprofitable customers look profitable. So the class is captured here.
  const doArchive = async (reason) => {
    try {
      const rows = sel.rows;
      const { error } = await supabase
        .from('time_entries')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userEmail || null,
          archive_reason: reason,
        })
        .in('id', rows.map(r => r.id));
      if (error) throw error;

      // ── WRITE-THROUGH TO THE JOB CARD ─────────────────────────────────
      // THIS TOUCHED time_entries ONLY. Exactly the bug markBilled above was
      // fixed for — two switches, nobody flipping both — and the archive path
      // never got the same treatment. A visit marked "Test entry" left the
      // billing queue while its job sat in to_bill, so the customer record
      // still listed it under OPEN WORK: a job with no hours, no revenue and
      // nothing left to do, presented as outstanding work.
      //
      // A job settles only when NOTHING live is left on it. Partial archives
      // (one of three visits written off) leave the job where it is, because
      // the rest still has to be billed.
      const settled = await settleJobsFor(rows, reason);

      setToast(`${rows.length} visit(s) archived — not billed`
        + (settled ? ` · ${settled} job${settled === 1 ? '' : 's'} closed out` : ''));
      setPicked(new Set());
      setArchiving(false);
      await load();
      setTimeout(() => setToast(''), 3500);
    } catch (e) {
      alert('Could not archive: ' + (e.message || e) + '\n\nIf this says the column does not exist, run migration 023 first.');
      setArchiving(false);
    }
  };

  const page = { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', paddingBottom: 160 };
  const card = { background: '#1a1a2e', border: '1px solid #1e293b', borderRadius: 12, padding: 12, marginBottom: 10 };

  if (loading) return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading unbilled work…</div>;
  if (err) return <div style={{ ...page, padding: 20 }}>Couldn’t load: {err}</div>;

  return (
    <div style={page}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a', borderBottom: '1px solid #1e293b', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#94a3b8', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>← Home</button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>💵 Billing</span>
          <button onClick={load} style={{ marginLeft: 'auto', background: '#1e293b', border: 'none', color: '#94a3b8', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>↻</button>
        </div>
        {/* Scoped from the calendar. Says whose work this is and gets out of
            the way — the buckets underneath are untouched, so an hour still
            only appears as billable when it actually is. */}
        {techFilter && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9,
                        background: '#132033', border: '1px solid #2b3f5c',
                        borderRadius: 9, padding: '7px 11px' }}>
            <span style={{ fontSize: 13, color: '#e2e8f0' }}>
              Showing <b>{techFilter}</b> only
            </span>
            <button onClick={clearTech}
              style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #334155',
                       borderRadius: 7, color: '#94a3b8', fontSize: 12, fontWeight: 700,
                       padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
              Show everyone
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {/* ── AN EMPTY BUCKET IS NOT A DOOR ────────────────────────────────
              Eleven tabs, six of them reading 0.0h · 0. Every one was added for
              a real case and none was ever taken away when the case emptied, so
              the screen grew a row of tabs that answer "nothing" and pushed the
              five that matter off the edge on a laptop.
              "We have got to get better about not just building and building
               and not removing when it stops being used."
              A bucket with nothing in it is noise. It comes back the moment
              something lands in it — nothing is deleted, it just stops taking
              up a tab. Ready to bill always shows: it is where the screen opens
              and an empty one is the answer you want to see. The bucket you are
              standing in stays visible too, so clearing the last row out of a
              tab does not yank it from under you. */}
          {BUCKETS.filter(b => {
            const d = byBucket[b.key] || { visits: 0 };
            return d.visits > 0 || b.key === 'ready' || b.key === tab;
          }).map(b => {
            const d = byBucket[b.key] || { hours: 0, visits: 0 };
            const on = tab === b.key;
            return (
              <button key={b.key} onClick={() => { setTab(b.key); setPicked(new Set()); setOpenKey(null); }}
                style={{ background: on ? `${b.color}22` : '#1e293b', border: `1px solid ${on ? b.color : 'transparent'}`,
                  borderRadius: 9, padding: '7px 11px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 11, color: on ? b.color : '#94a3b8', fontWeight: 600 }}>{b.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: on ? b.color : '#e2e8f0' }}>
                  {fmtH(d.hours)} <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>· {d.visits}</span>
                </div>
              </button>
            );
          })}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="find a customer…"
            style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#fff', fontSize: 13, width: 170, flexShrink: 0 }} />
        </div>
      </div>

      {toast && (
        <div style={{ background: '#166534', color: '#dcfce7', padding: '10px 14px', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>{toast}</div>
      )}

      <div style={{ padding: 14, maxWidth: 900, margin: '0 auto' }}>
        <div style={{ ...card, background: `${BUCKET_BY_KEY[tab].color}12`, border: `1px solid ${BUCKET_BY_KEY[tab].color}44` }}>
          <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.55 }}>{BUCKET_BY_KEY[tab].blurb}</div>
        </div>

        {/* THE PROJECTS THEMSELVES LIVE BEHIND THIS TAB.
            They used to sit permanently at the top of Billing, above every
            bucket, whether you were looking for them or not. "The projects
            thing in billing is displayed on clicking Project Hours" — so it
            is: the tile on Home opens ?tab=project and lands here, and the
            hours listed underneath are the same hours, grouped by client. */}
        {tab === 'project' && <FixedFeeProjects userEmail={userEmail} />}

        {shown.length === 0 && (
          <div style={{ ...card, textAlign: 'center', color: '#94a3b8' }}>
            {tab === 'project' ? 'No unbilled project hours. The projects above still show where each one stands.'
                               : 'Nothing in here. Good.'}
          </div>
        )}

        {shown.map(g => {
          const open = openKey === g.key;
          const allPicked = g.visits.length > 0 && g.visits.every(v => picked.has(v.id));
          return (
            <div key={g.key} style={{ ...card, borderColor: g.orphan ? '#f59e0b' : '#1e293b' }}>
              <div onClick={() => setOpenKey(open ? null : g.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <span style={{ color: '#64748b', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.name} {g.shortCode && <span style={{ color: '#00c8e8', fontSize: 12, fontWeight: 700 }}>{g.shortCode}</span>}
                  </div>
                  {g.bucket === 'return' && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ec4899', marginTop: 2 }}>
                      Customer waiting {g.waitingDays} day{g.waitingDays === 1 ? '' : 's'} · {fmtH(g.hours)} of work you cannot invoice until someone goes back
                    </div>
                  )}
                  {g.noEntries && (
                    <div style={{ fontSize: 12.5, color: '#fdba74', marginTop: 3, lineHeight: 1.5 }}>
                      Marked done, but nobody logged time against it. There is nothing to put on an invoice.
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {g.noEntries
                      ? 'no time logged'
                      : `${g.visits.length} visit${g.visits.length > 1 ? 's' : ''} · since ${fmtD(g.oldest)}`}
                    {!g.noEntries && g.materialVisits > 0 && <span style={{ color: '#f59e0b' }}> · {g.materialVisits} with materials</span>}
                    {g.suspicious > 0 && <span style={{ color: '#ef4444' }}> · ⚠️ {g.suspicious} over {SUSPICIOUS_HOURS}h — check it</span>}
                  </div>
                  {g.orphan && (
                    <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 2 }}>
                      ⚠️ Not linked to a client — link it before you invoice
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 19, fontWeight: 800, color: '#22c55e', whiteSpace: 'nowrap' }}>{fmtH(g.hours)}</span>
              </div>

              {/* A job with no time has nothing to tick, so the checkbox flow is a
                  dead end — "Select all visits" selects nothing and the invoice
                  button stays dead. What it needs is a DECISION, so offer the
                  three that actually exist. */}
              {/* Orphaned hours: no job to tick through, so offer the decisions
                  that actually exist instead of a dead-end explanation. */}
              {open && !g.noEntries && g.bucket === 'nojob' && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 10,
                              display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {/* FIRST, because it is the right answer far more often than
                      making a second card. These hours usually belong to a job
                      that is already on the board — that is exactly what
                      "Jeanneret shows as a client in my To Bill" is. */}
                  <button onClick={() => openMerge(g)} disabled={saving}
                    style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff',
                             fontSize: 13, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    🔗 Merge into a job
                  </button>
                  <button onClick={() => window.open('/board', '_self')}
                    style={{ background: 'transparent', border: '1px solid #1d4ed8', borderRadius: 8, color: '#93c5fd',
                             fontSize: 13, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Make a new ticket instead
                  </button>
                  {mayBill && (
                  <button onClick={() => closeOrphan(g, 'billed')} disabled={saving}
                    style={{ background: 'transparent', border: '1px solid #22c55e', borderRadius: 8,
                             color: '#22c55e', fontSize: 13, fontWeight: 700, padding: '9px 14px',
                             cursor: 'pointer', fontFamily: 'inherit' }}>
                    Invoiced elsewhere — mark billed
                  </button>)}
                  <button onClick={() => closeOrphan(g, 'archived')} disabled={saving}
                    style={{ background: 'transparent', border: '1px solid #64748b', borderRadius: 8,
                             color: '#94a3b8', fontSize: 13, fontWeight: 700, padding: '9px 14px',
                             cursor: 'pointer', fontFamily: 'inherit' }}>
                    Not billable — pick a reason
                  </button>
                  <div style={{ flexBasis: '100%', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                    Marking billed stamps these hours only — no ticket is created, and the
                    invoice ref above is applied if you filled it in. Clearing archives them;
                    nothing is deleted.
                  </div>
                </div>
              )}

              {open && g.noEntries && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 10,
                              display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button onClick={() => window.open(`/board?job=${g.job.id}`, '_self')}
                    style={{ background: '#1d4ed8', border: 'none', borderRadius: 8, color: '#fff',
                             fontSize: 13, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Open the ticket
                  </button>
                  {mayBill && (
                  <button onClick={() => closeNoHours(g, 'billed')} disabled={saving}
                    style={{ background: 'transparent', border: '1px solid #22c55e', borderRadius: 8,
                             color: '#22c55e', fontSize: 13, fontWeight: 700, padding: '9px 14px',
                             cursor: 'pointer', fontFamily: 'inherit' }}>
                    Invoiced elsewhere — mark billed
                  </button>)}
                  <button onClick={() => closeNoHours(g, 'archived')} disabled={saving}
                    style={{ background: 'transparent', border: '1px solid #64748b', borderRadius: 8,
                             color: '#94a3b8', fontSize: 13, fontWeight: 700, padding: '9px 14px',
                             cursor: 'pointer', fontFamily: 'inherit' }}>
                    Not billable — pick a reason
                  </button>
                  <div style={{ flexBasis: '100%', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                    If the work really happened and the hours were never entered, open the
                    ticket and log the visit — that is the only route that puts it on an invoice.
                  </div>
                </div>
              )}

              {open && !g.noEntries && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
                    <button onClick={() => pickAll(g)}
                      style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
                      {allPicked ? 'Deselect all' : 'Select all visits'}
                    </button>
                    {/* "Grab all the hours of the client." A customer's unbilled
                        time is split across buckets by design, so ticking one
                        group at a time is how you miss the two sitting under a
                        different heading — which are usually the ones a project
                        is meant to gather up. Only shown when there ARE others. */}
                    {(() => {
                      const t = clientTotal(g);
                      if (t.groups < 2) return null;
                      return (
                        <button onClick={() => pickAllForClient(g)}
                          style={{ background: 'none', border: '1px solid #7c3aed', borderRadius: 6, color: '#c4b5fd', fontSize: 12, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Grab all {t.visits} of {g.name}'s hours ({fmtH(t.hours)})
                        </button>
                      );
                    })()}
                  </div>

                  {g.visits.map(v => {
                    const h = hrs(v.total_minutes);
                    const on = picked.has(v.id);
                    const sus = h > SUSPICIOUS_HOURS;
                    return (
                      <div key={v.id} onClick={() => toggle(v.id)}
                        style={{ display: 'flex', gap: 10, padding: '8px 9px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                          background: on ? '#0e293f' : '#0f172a', border: `1px solid ${on ? '#00c8e8' : sus ? '#ef4444' : '#1e293b'}` }}>
                        <span style={{ color: on ? '#00c8e8' : '#475569', fontSize: 15 }}>{on ? '☑' : '☐'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>
                            {fmtD(v.event_start)} · {v.tech_name || 'unknown tech'}
                            {v.disposition && <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {v.disposition.replace('_', ' ')}</span>}
                          </div>
                          {v.event_title && <div style={{ fontSize: 12, color: '#94a3b8' }}>{v.event_title}</div>}
                          {v.notes && <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 3, whiteSpace: 'pre-wrap' }}>{v.notes}</div>}
                          {v.materials && v.materials.trim() && (
                            <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 3, background: '#78350f33', borderRadius: 5, padding: '4px 7px' }}>
                              🔧 {v.materials.trim()}
                            </div>
                          )}
                          {sus && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 3 }}>⚠️ {fmtH(h)} on one visit — somebody probably never clocked out</div>}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: sus ? '#ef4444' : '#22c55e', whiteSpace: 'nowrap' }}>{fmtH(h)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {clearTarget && (
        <ArchiveModal
          count={clearTarget.kind === 'orphan' ? (clearTarget.group.visits || []).length : 1}
          hours={fmtH(clearTarget.group.hours || 0)}
          onCancel={() => setClearTarget(null)}
          onConfirm={doClearWithReason}
        />
      )}

      {/* ── MERGE PICKER ───────────────────────────────────────────────
          Which card do these hours belong to. Their own customer's open jobs
          float to the top, because that is nearly always the answer; the box
          searches everything else. Each row says enough to tell two cards for
          the same customer apart — the status, the date, and whether it is
          fixed fee, which changes what happens to the hours the moment they
          land. */}
      {mergeOpen && (
        <div onClick={() => setMergeOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 60,
                   display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '18px 18px 0 0',
                     width: '100%', maxWidth: 620, maxHeight: '82vh', display: 'flex',
                     flexDirection: 'column', padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#e2e8f0' }}>
              Merge {mergeOpen.visits?.length || 0} visit{(mergeOpen.visits?.length || 0) === 1 ? '' : 's'} · {fmtH(mergeOpen.hours)}
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', margin: '3px 0 10px' }}>
              from <b style={{ color: '#cbd5e1' }}>{mergeOpen.name}</b> — pick the job these hours belong to.
              Nothing is deleted; the entries just point at the card.
            </div>
            {/* THE PROJECT THAT DOESN'T EXIST YET, FIRST.
                If it existed you would be picking it below. The reason these
                hours are still sitting in Billing is usually that nothing was
                ever opened to hold them. */}
            {newProj == null ? (
              <button onClick={() => setNewProj({ name: mergeOpen.name === 'Unknown' ? '' : (mergeOpen.name || ''), hours: '' })}
                style={{ background: '#7c3aed', border: 'none', borderRadius: 10, color: '#fff',
                         fontSize: 13.5, fontWeight: 800, padding: '11px 14px', cursor: 'pointer',
                         fontFamily: 'inherit', marginBottom: 10, textAlign: 'left' }}>
                📐 New fixed-fee project from these hours
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#ddd6fe', marginTop: 2 }}>
                  Opens the project, puts these hours on it, and stops them reading as invoiceable.
                </span>
              </button>
            ) : (
              <div style={{ background: '#1a1533', border: '1px solid #7c3aed', borderRadius: 12,
                            padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 900, color: '#c4b5fd', marginBottom: 8 }}>
                  📐 New fixed-fee project
                </div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 3 }}>
                  Project name
                </label>
                <input value={newProj.name} autoFocus
                  onChange={e => setNewProj(v => ({ ...v, name: e.target.value }))}
                  placeholder="Client or project name"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9,
                           border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0',
                           fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 9 }} />
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 3 }}>
                  Hours budget — what it was sold with
                </label>
                <input type="number" step="0.5" min="0" value={newProj.hours}
                  onChange={e => setNewProj(v => ({ ...v, hours: e.target.value }))}
                  placeholder="e.g. 40"
                  style={{ width: 130, boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9,
                           border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0',
                           fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
                <div style={{ fontSize: 11.5, color: '#8ea0b8', marginTop: 7, lineHeight: 1.5 }}>
                  {fmtH(mergeOpen.hours)} across {mergeOpen.visits?.length || 0} visit{(mergeOpen.visits?.length || 0) === 1 ? '' : 's'} goes on it.
                  {newProj.hours ? ` Delta starts at ${(Number(newProj.hours) - mergeOpen.hours).toFixed(1)}h.` :
                    ' Leave the budget blank and set it later — the delta just waits.'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => createProject(newProj.name, newProj.hours)} disabled={saving}
                    style={{ background: '#22d16f', border: 'none', borderRadius: 9, color: '#04130a',
                             fontSize: 13, fontWeight: 800, padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {saving ? 'Creating…' : 'Create the project'}
                  </button>
                  <button onClick={() => setNewProj(null)}
                    style={{ background: 'none', border: '1px solid #334155', borderRadius: 9, color: '#94a3b8',
                             fontSize: 13, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <input value={mergeQ} onChange={e => setMergeQ(e.target.value)}
              placeholder="…or search for a job that already exists"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
                       border: '1px solid #334155', background: '#0b1220', color: '#e2e8f0',
                       fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 10 }} />
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {mergeJobs == null && (
                <div style={{ color: '#64748b', fontSize: 13, padding: '18px 0', textAlign: 'center' }}>Loading jobs…</div>
              )}
              {mergeJobs && (() => {
                const needle = mergeQ.trim().toLowerCase();
                const mine = (j) => (mergeOpen.name || '').toLowerCase().slice(0, 8) &&
                  (j.customer_name || '').toLowerCase().includes((mergeOpen.name || '').toLowerCase().slice(0, 8));
                const rows = mergeJobs
                  .filter(j => !needle || (j.customer_name || '').toLowerCase().includes(needle))
                  .sort((a, b) => (mine(b) - mine(a)))
                  .slice(0, 60);
                if (!rows.length) return (
                  <div style={{ color: '#64748b', fontSize: 13, padding: '18px 0', textAlign: 'center' }}>No job matches that.</div>
                );
                return rows.map(j => (
                  <button key={j.id} onClick={() => doMerge(j)} disabled={saving}
                    style={{ textAlign: 'left', background: mine(j) ? '#172554' : '#111f34',
                             border: `1px solid ${mine(j) ? '#3b82f6' : '#1e293b'}`, borderRadius: 10,
                             padding: '10px 12px', cursor: 'pointer', color: '#e2e8f0', fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{j.customer_name || 'Unnamed'}</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                      {(STATUS_INFO[j.status]?.label || j.status)}
                      {j.scheduled_date ? ` · ${new Date(j.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                      {j.is_fixed_fee ? ' · 📐 fixed fee — these hours become cost' : ''}
                    </div>
                  </button>
                ));
              })()}
            </div>
            <button onClick={() => setMergeOpen(false)}
              style={{ marginTop: 10, background: 'none', border: '1px solid #334155', color: '#94a3b8',
                       borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 700,
                       cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          </div>
        </div>
      )}

      {archiving && (
        <ArchiveModal
          count={sel.rows.length}
          hours={fmtH(sel.hours)}
          onCancel={() => setArchiving(false)}
          onConfirm={doArchive}
        />
      )}

      {/* Selection bar — everything ticked, across every customer */}
      {sel.rows.length > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 64, background: '#1a1a2e', borderTop: '2px solid #22c55e', padding: '12px 14px', zIndex: 20 }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#22c55e' }}>
                {sel.rows.length} visit{sel.rows.length > 1 ? 's' : ''} · {fmtH(sel.hours)}
              </span>
              {mayBill && (
              <input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="invoice # (optional)"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#fff', fontSize: 13, width: 150 }} />)}
              <button onClick={() => setPicked(new Set())}
                style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>Clear</button>
              <button onClick={() => setArchiving(true)} disabled={saving}
                title="Junk / test data. Leaves the queue WITHOUT being marked billed."
                style={{ background: 'none', border: '1px solid #64748b', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                🗑️ Archive — pick a reason
              </button>
              {/* NOT gated on canBill. Saying how a job was SOLD is not the
                  same as saying an invoice went out — it is the scoping fact
                  that decides whether these hours could ever be an invoice
                  line at all, and it is the person running the job who knows
                  it. Nothing here claims anything was invoiced. */}
              {/* "I want to SELECT the time entry and merge it into the job."
                  The merge button on the no-job bucket only reaches hours the
                  screen already knows are orphaned. An entry can also resolve
                  to a job through its calendar event while carrying a null
                  job_id — it looks attached and is not — so the same action
                  has to work on anything you can tick. */}
              <button onClick={() => openMerge({
                        name: sel.rows.length === 1 ? (sel.rows[0]._g?.name || 'this visit') : `${sel.rows.length} selected visits`,
                        visits: sel.rows, hours: sel.hours })}
                disabled={saving}
                title="Point these hours at the job they belong to."
                style={{ background: 'none', border: '1px solid #7c3aed', color: '#c4b5fd', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                🔗 Merge into a job
              </button>
              <button onClick={markFixedFee} disabled={saving}
                title="These hours are cost against an agreed price, not billed by the hour."
                style={{ background: 'none', border: '1px solid #8b5cf6', color: '#c4b5fd', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                📐 Fixed fee — not by the hour
              </button>
              {/* Reading the queue, selecting rows, and archiving junk with a
                  reason are all fine for anyone who can open this screen.
                  Asserting that an invoice went out is not. */}
              {mayBill ? (
              <button onClick={markBilled} disabled={saving}
                style={{ marginLeft: 'auto', background: '#22c55e', border: 'none', color: '#052e16', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving…' : 'Mark billed'}
              </button>
              ) : (
              <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#94a3b8', fontWeight: 700 }}>
                Billing marks these invoiced
              </span>
              )}
            </div>
            {sel.materials.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#fbbf24', background: '#78350f33', borderRadius: 6, padding: '6px 9px' }}>
                🔧 <b>Materials on this invoice:</b> {sel.materials.join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
