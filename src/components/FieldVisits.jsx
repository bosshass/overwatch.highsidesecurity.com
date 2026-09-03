// ============================================
// Overwatch — FieldVisits (real notes on the board card)
// ============================================
// Tech notes live in THREE places in this app:
//   1. time_entries.notes  — written when a tech dispositions on Work Today
//   2. job.issue (📝 lines) — appended/imported field notes (often duplicated)
//   3. job_history          — only status stubs ("Assigned to X", "Job created")
// The card's NotesPanel reads #3, so it shows actions, not notes. This pulls the
// real notes from #1 and #2, de-duplicates them, and shows them on the card.

import { dispo } from '../utils/billing.js';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { reasonLabel, reasonColor, isRealCost } from '../config/archiveReasons.js';

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function hoursFromMin(min) {
  if (min == null) return null;
  const h = Number(min) / 60;
  return isFinite(h) ? `${h.toFixed(1)}h` : null;
}

// Pull 📝-tagged notes out of the issue field. Splits on the 📝 marker, dedupes
// exact repeats (the data has them), and parses an optional "[date tech]" header.
function parseIssueNotes(issue) {
  if (!issue || issue.indexOf('📝') === -1) return [];
  const chunks = issue.split('📝').slice(1);
  const seen = new Set();
  const out = [];
  for (const raw of chunks) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;          // drop exact duplicates
    seen.add(key);
    const m = text.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    out.push(m ? { meta: m[1].trim(), body: m[2].trim() } : { meta: null, body: text });
  }
  return out;
}
const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const FIELDS =
  'id, event_title, event_start, tech_name, total_minutes, disposition, billed, billed_at, materials, notes, photos, customer_name_raw, calendar_event_id, customer_id, created_at, archived, archived_at, archived_by, archive_reason';

// ONE VISIT, NOT THREE. Each card carries a disposition chip, tech, date,
// hours, materials and the note body, so three of them is most of a phone
// screen — and they sat between the actions and the notes box, pushing both
// off the bottom. The newest visit is the one that explains the card's current
// state; the rest are history and open on demand.
const PREVIEW = 1;

export default function FieldVisits({ job }) {
  const [entries, setEntries] = useState([]);
  // The client's OTHER visits — never mixed into this job's list.
  const [others, setOthers] = useState([]);
  // Return card details keyed by time_entry_id. JobFinishSheet writes the next-visit
  // plan into return_cards (reason, materials_needed, estimated_time) — without an
  // explicit fetch here those fields are invisible when viewing the ticket.
  const [returnCardMap, setReturnCardMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setShowAll(false); setOthers([]);
      // THIS JOB'S OWN VISITS, kept strictly separate from the client's others.
      //
      // The old version matched ONE column — job.calendar_event_id — and then
      // fell back to every entry for the customer. Both halves were wrong:
      //
      //   • A calendar event id lives in THREE columns (see utils/jobResolve.js),
      //     and the scheduler writes `scheduled_event_id`. 30 live jobs have a
      //     scheduled_event_id and NO calendar_event_id, so the match never
      //     fired for any of them.
      //   • Those 30 then fell through to the customer query, which returns the
      //     client's ENTIRE history. The card showed somebody else's visit as
      //     though it were this job's — and it is about to sit at the top of
      //     the card, directly under the issue, where being wrong is worst.
      //
      // Primary = job_id or any of the three event ids. The client's other
      // visits are still available, but labelled as such and behind the toggle.
      const byId = {};
      const otherById = {};
      try {
        const eventIds = [job?.calendar_event_id, job?.scheduled_event_id, job?.tentative_event_id]
          .filter(Boolean);
        if (job?.id) {
          const r = await supabase.from('time_entries').select(FIELDS).eq('job_id', job.id);
          if (!r.error) for (const row of (r.data || [])) byId[row.id] = row;
        }
        if (eventIds.length) {
          const r = await supabase.from('time_entries').select(FIELDS).in('calendar_event_id', eventIds);
          if (!r.error) for (const row of (r.data || [])) byId[row.id] = row;
        }
        if (job?.customer_id) {
          const r = await supabase.from('time_entries').select(FIELDS).eq('customer_id', job.customer_id).limit(100);
          if (!r.error) for (const row of (r.data || [])) if (!byId[row.id]) otherById[row.id] = row;
        }
      } catch { /* leave what we have */ }
      // Fetch return_cards so next-visit plan (reason, materials, est. time) is
      // visible on the ticket. Keyed by time_entry_id — the link JobFinishSheet writes.
      const rcMap = {};
      try {
        const returnIds = Object.values(byId)
          .filter(e => e.disposition === 'return')
          .map(e => e.id);
        if (returnIds.length) {
          const { data: rcs } = await supabase
            .from('return_cards')
            .select('time_entry_id, reason, materials_needed, estimated_time')
            .in('time_entry_id', returnIds);
          for (const rc of (rcs || [])) rcMap[rc.time_entry_id] = rc;
        }
      } catch { /* show what we have */ }
      const bydate = (a, b) => new Date(b.event_start || b.created_at) - new Date(a.event_start || a.created_at);
      if (!cancelled) {
        setEntries(Object.values(byId).sort(bydate));
        setOthers(Object.values(otherById).sort(bydate));
        setReturnCardMap(rcMap);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [job?.id, job?.calendar_event_id, job?.scheduled_event_id, job?.tentative_event_id, job?.customer_id]);

  // 📝 notes from the issue field, minus any that duplicate a visit's note text.
  const issueNotes = useMemo(() => {
    const parsed = parseIssueNotes(job?.issue);
    const visitNoteSet = new Set(entries.map(e => norm(e.notes)).filter(Boolean));
    return parsed.filter(n => !visitNoteSet.has(norm(n.body)));
  }, [job?.issue, entries]);

    // A visit that produced only PHOTOS is still evidence of the visit — it was
  // being filtered out entirely, so a tech who documented the job with pictures
  // and typed nothing left no trace on the ticket.
  const visitsWithNotes = useMemo(
    () => entries.filter(e => e.notes || e.materials || (e.photos && e.photos.length) || returnCardMap[e.id]),
    [entries, returnCardMap]);
  const total = visitsWithNotes.length + issueNotes.length;

  const otherWithNotes = others.filter(e => e.notes || e.materials || (e.photos && e.photos.length));
  const shownVisits = showAll ? visitsWithNotes : visitsWithNotes.slice(0, PREVIEW);
  const shownIssue  = showAll ? issueNotes : issueNotes.slice(0, Math.max(0, PREVIEW - shownVisits.length));

  if (loading) return null;
  if (total === 0 && otherWithNotes.length === 0) return null;

  const wrap   = { marginBottom: 16 };
  const header = { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 };
  const card   = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };

  return (
    <div style={wrap}>
      {/* Reads as the answer to the box directly above it: the issue asks what
          we are doing, this says what happened. */}
      <div style={header}>
        <span>📝 What happened on site</span>
        <span style={{ color: '#94a3b8', fontWeight: 600 }}>({total})</span>
      </div>

      {/* notes captured on Work Today (time_entries) */}
      {shownVisits.map(e => {
        // A DISPOSITION IS WHAT THE TECH DECIDED. IT IS NOT THE CURRENT STATE.
        // "Bill it" means "this should be invoiced" — and 169 of the 186
        // bill_it entries HAVE been invoiced. Showing the disposition forever
        // meant finished, paid work still shouted Bill it, which is exactly
        // the stale-tag noise the calendar titles used to carry.
        //
        // Once it is billed, that is the fact worth showing.
        const d = e.billed
          ? { label: 'Billed', color: '#64748b', icon: '✓' }
          : dispo(e.disposition);
        return (
          <div key={e.id} style={{ ...card, opacity: e.archived ? 0.78 : 1, borderColor: e.archived ? (isRealCost(e.archive_reason) ? '#f59e0b55' : '#47556955') : '#1e293b' }}>
            {e.archived && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                background: `${reasonColor(e.archive_reason)}1a`, border: `1px solid ${reasonColor(e.archive_reason)}55`,
                borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: reasonColor(e.archive_reason) }}>
                  🗑️ NOT BILLED — {reasonLabel(e.archive_reason).toUpperCase()}
                </span>
                {isRealCost(e.archive_reason) && (
                  <span style={{ fontSize: 11, color: '#fbbf24' }}>· DRH absorbed this cost</span>
                )}
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {e.archived_by ? `· ${String(e.archived_by).split('@')[0]}` : ''}
                  {e.archived_at ? ` · ${new Date(e.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                </span>
              </div>
            )}
            {e.event_title && <div style={{ fontWeight: 700, fontSize: 13.5, color: '#e2e8f0', marginBottom: 6 }}>{e.event_title}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', marginBottom: (e.materials || e.notes) ? 8 : 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${d.color}20`, color: d.color, border: `1px solid ${d.color}40` }}>{d.label}</span>
              {e.tech_name && <span>👷 {e.tech_name}</span>}
              {e.event_start && <span>📅 {fmtDateTime(e.event_start)}</span>}
              {hoursFromMin(e.total_minutes) && <span>⏱ {hoursFromMin(e.total_minutes)}</span>}
            </div>
            {e.materials && <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 4 }}>🔧 {e.materials}</div>}
            {e.notes && <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{e.notes}</div>}
            {/* Return card — next-visit plan. Written into return_cards by JobFinishSheet
                (reason = what to do, materials_needed, estimated_time). These fields live
                outside time_entries so a separate fetch is needed — see returnCardMap above. */}
            {returnCardMap[e.id] && (() => {
              const rc = returnCardMap[e.id];
              if (!rc.reason && !rc.materials_needed && !rc.estimated_time) return null;
              return (
                <div style={{ marginTop: 8, background: 'rgba(249,115,22,0.08)',
                              border: '1px solid rgba(249,115,22,0.3)',
                              borderLeft: '3px solid #fb923c', borderRadius: 8,
                              padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#fb923c',
                                textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 }}>
                    🔄 Next visit
                  </div>
                  {rc.reason          && <div style={{ fontSize: 12, color: '#fed7aa', marginBottom: 3 }}>{rc.reason}</div>}
                  {rc.materials_needed && <div style={{ fontSize: 12, color: '#fbbf24' }}>🔧 {rc.materials_needed}</div>}
                  {rc.estimated_time   && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>⏱ {rc.estimated_time}</div>}
                </div>
              );
            })()}
            {/* Job photos. Uploaded from the finish sheet, and until now visible
                nowhere in the app — the files were in Storage with nothing
                pointing at them. Tap opens the full size in a new tab. */}
            {e.photos && e.photos.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {e.photos.map((url, pi) => (
                  <a key={pi} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`Visit photo ${pi + 1}`}
                      style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 8,
                               border: '1px solid #334155', display: 'block' }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* 📝 notes recovered from the issue field */}
      {shownIssue.map((n, idx) => (
        <div key={`issue-${idx}`} style={card}>
          {n.meta && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>👷 {n.meta}</div>
          )}
          <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{n.body}</div>
        </div>
      ))}

      {/* The toggle also has to appear when this job has ONE note but the
          client has others, or the section below is unreachable. */}
      {(total > PREVIEW || otherWithNotes.length > 0) && (
        <button onClick={() => setShowAll(v => !v)} style={{ background: 'none', border: 'none', color: '#00c8e8', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '2px 0', textDecoration: 'underline' }}>
          {showAll
            ? 'Show less'
            : total > PREVIEW
              ? `View all ${total} notes →`
              : `Show this client's other visits (${otherWithNotes.length}) →`}
        </button>
      )}

      {/* THE CLIENT'S OTHER VISITS — named as such, and never above this job's
          own. These used to be merged straight into the list, so on a card
          whose event id the old query missed, another job's visit appeared as
          if it belonged here. Shown only when the reader asks for everything. */}
      {showAll && otherWithNotes.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
          <div style={{ ...header, marginBottom: 8 }}>
            <span>🗂 Other visits for this client</span>
            <span style={{ color: '#94a3b8', fontWeight: 600 }}>({otherWithNotes.length})</span>
          </div>
          {otherWithNotes.slice(0, 10).map(e => (
            <div key={`other-${e.id}`} style={{ ...card, opacity: 0.75 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 5 }}>
                {[e.tech_name, fmtDateTime(e.event_start || e.created_at), hoursFromMin(e.total_minutes)]
                  .filter(Boolean).join(' · ')}
              </div>
              {e.event_title && (
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 4 }}>{e.event_title}</div>
              )}
              {e.notes && (
                <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{e.notes}</div>
              )}
            </div>
          ))}
          {otherWithNotes.length > 10 && (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              …and {otherWithNotes.length - 10} more. The full history is on the client record.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
