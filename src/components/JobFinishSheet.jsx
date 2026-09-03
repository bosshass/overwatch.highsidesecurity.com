// ============================================
// JobFinishSheet — canonical "tech finishes a job" UI
// ============================================
// One bottom sheet, five dispositions:
//   • bill_it      — done, hours go to Billing
//   • return       — must go back (also writes a return_card)
//   • in_progress  — multi-day work, stays open
//   • estimate     — sales handoff
//   • blocked      — couldn't do it: no access, wrong parts, turned away
//
// It does NOT tag the calendar title. Status lives in the database.
//
// REPLACES (deleted): CompletionModal.jsx, JobCompleteModal.jsx, TimeCaptureModal.jsx
//
// Required gates: valid time entry + notes. Return also requires a reason.
// (Linked customer used to be a hard gate — dropped because that association
// should already exist upstream; it's still captured when present, just not
// a blocker.)
// Writes ONE row to time_entries; for 'return' also writes ONE row to return_cards.
// Appends the tech's field notes to the calendar event DESCRIPTION. Never the title.
//
// Props:
//   event           { id, title, calendarId, start, end, description, location, techName }
//   accessToken     Google OAuth bearer (required to PATCH calendar)
//   userEmail       signed-in user's email (becomes time_entry.tech_email)
//   userName        signed-in user's display name (fallback for tech_name)
//   prefillCustomer optional pre-linked customer (skips the lookup if provided)
//   onFinished      called after a successful disposition: (disposition) => void
//   onCancel        called when the user dismisses the sheet
//   mode            optional; 'full' (default) shows all 4 buttons. 'bill-only' shows only Bill It.
//   inline          optional; when true, renders JUST the form (no overlay, no header) for use
//                   inside an existing sheet (e.g. TechWorkToday's rich detail sheet).

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { timeEntriesApi, returnCardsApi, jobsApi, notesApi, supabase, JOB_STATUS } from '../services/supabase.js';
import { resolveJobForEvent } from '../utils/jobResolve.js';
import TextButton, { clientTemplates } from './TextButton.jsx';
import TimeEntryBlock, { emptyTimeEntry, isValidTimeEntry, timeEntryToPayload } from './TimeEntryBlock.jsx';
import CustomerLookup from './CustomerLookup.jsx';
import { dispo, DISPO_KEYS } from '../utils/billing.js';
import { uploadPhoto } from '../services/photos.js';
import { ASSIGNEES } from '../utils/ownership.js';
import { htmlToText } from '../utils/statusMachine.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// ── Color tokens — one source of truth per disposition ──────────────
// Values from the Overwatch color system (artifact c2fb7e69).
const DISPO_COLORS = {
  bill_it:     { color: '#4ade80', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)' },
  return:      { color: '#fb923c', bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.25)' },
  estimate:    { color: '#c084fc', bg: 'rgba(168,85,247,0.08)', border: 'rgba(168,85,247,0.25)' },
  in_progress: { color: '#38bdf8', bg: 'rgba(14,165,233,0.08)',  border: 'rgba(14,165,233,0.25)' },
  blocked:     { color: '#fb7185', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)' },
};

// Strip LEGACY bracket tags out of a title so the bare customer name is left for
// matching. Overwatch no longer writes these, but years of events still carry them.
function cleanTitle(title) {
  return (title || '').replace(/\s*\[.*?\]/g, '').trim();
}

export default function JobFinishSheet({
  event,
  accessToken,
  userEmail,
  userName,
  prefillCustomer = null,
  onFinished,
  onCancel,
  mode = 'full',
  inline = false,
}) {
  const navigate = useNavigate();
  // ── Panel-specific field state ─────────────────────────────────────
  // Each disposition owns its own fields. No shared "notes" state — what
  // goes into time_entries.notes is assembled per-dispo by assembleNotes().
  const [billNotes,       setBillNotes]       = useState('');   // Bill It — billing notes (required)
  const [returnBillNotes, setReturnBillNotes] = useState('');   // Return — billing notes for THIS visit (required)
  const [returnWhat,      setReturnWhat]      = useState('');   // Return — what to do next visit
  const [returnMaterials, setReturnMaterials] = useState('');   // Return — materials needed (→ return_cards.materials_needed)
  const [returnEstTime,   setReturnEstTime]   = useState('');   // Return — estimated time (→ return_cards.estimated_time)
  const [estimateWhat,    setEstimateWhat]    = useState('');   // Estimate — what needs estimating
  const [estimateMats,    setEstimateMats]    = useState('');   // Estimate — materials
  const [inProgressWhat,  setInProgressWhat]  = useState('');  // In Progress — what's happening next
  const [blockedWhy,      setBlockedWhy]      = useState('');   // Blocked — why couldn't it be done (required)
  const [blockedNext,     setBlockedNext]     = useState('');   // Blocked — what's next

  const [photos, setPhotos]             = useState([]);
  const [uploading, setUploading]       = useState(false);
  const [photoErr, setPhotoErr]         = useState('');
  const [timeEntry, setTimeEntry]       = useState(emptyTimeEntry());
  const [linkedCustomer, setLinkedCust] = useState(prefillCustomer);
  const [acting, setActing]             = useState(false);
  const [error, setError]               = useState('');
  const [selectedDispo, setSelectedDispo] = useState(null);

  // ── THE JOB BEHIND THIS EVENT ──────────────────────────────────────
  // The sheet used to know NOTHING about the card. "Scope of work" was built
  // only from the Google event description — a COPY of the issue, snapshotted
  // into the calendar at the moment of booking. So the tech saw nothing
  // whenever the description was stale or absent:
  //   • the event was booked directly on Google, so nothing ever wrote a
  //     description
  //   • the issue was typed or edited AFTER the booking
  //   • somebody edited the event by hand and lost the block
  //
  // The issue lives in jobs.issue. Read it from there. resolveJobForEvent
  // already checks all four event-id homes, and the sheet already calls it at
  // submit time — this just does it on OPEN, when the tech actually needs it.
  const [linkedJob, setLinkedJob]   = useState(null);
  const [jobNotes, setJobNotes]     = useState([]);
  useEffect(() => {
    let dead = false;
    if (!event?.id) { setLinkedJob(null); setJobNotes([]); return undefined; }
    (async () => {
      try {
        const j = await resolveJobForEvent(event.id, {
          select: 'id, issue, status, scheduled_date, customer_id, customer_name, customer_phone, customer_address, site_contact_name, site_contact_phone, access_permission',
        });
        if (dead) return;
        setLinkedJob(j || null);
        // Auto-populate the customer from the resolved job so the "not linked"
        // warning doesn't fire on cards that ARE properly linked. The tech
        // should not see a red alarm for a job the system already knows the
        // customer for. prefillCustomer (passed by a parent) takes precedence
        // if it was already set — don't overwrite a deliberate selection.
        if (j?.customer_id && j?.customer_name && !prefillCustomer) {
          setLinkedCust({ id: j.customer_id, name: j.customer_name });
        }
        if (!j?.id) return;
        // Notes were readable in exactly one place. notesApi.getAllForJob
        // merges job_history, completion notes and prior field notes — the
        // tech should see what was already said about this job before adding
        // to it.
        try {
          const n = await notesApi.getAllForJob(j.id);
          if (!dead) setJobNotes(n || []);
        } catch (e) { console.warn('job notes lookup failed:', e?.message || e); }
      } catch (e) {
        console.warn('job lookup failed (sheet still usable):', e?.message || e);
      }
    })();
    return () => { dead = true; };
  }, [event?.id]);

  // If the parent passes a different prefill customer mid-life, follow it.
  useEffect(() => { if (prefillCustomer) setLinkedCust(prefillCustomer); }, [prefillCustomer]);

  const eventDate = event?.start ? new Date(event.start) : new Date();
  const timeValid = isValidTimeEntry(timeEntry, eventDate);

  // ── assembleNotes — builds time_entries.notes from panel fields ────
  const assembleNotes = (dispo) => {
    switch (dispo) {
      case 'bill_it':     return billNotes.trim() || null;
      case 'return': {
        const parts = [
          returnBillNotes.trim() && `This visit: ${returnBillNotes.trim()}`,
          returnWhat.trim()      && `Next visit: ${returnWhat.trim()}`,
          returnMaterials.trim() && `Materials: ${returnMaterials.trim()}`,
          returnEstTime.trim()   && `Est. time: ${returnEstTime.trim()}`,
        ].filter(Boolean);
        return parts.join('\n') || null;
      }
      case 'estimate': {
        const parts = [estimateWhat.trim(), estimateMats.trim() && `Materials: ${estimateMats.trim()}`].filter(Boolean);
        return parts.join('\n') || null;
      }
      case 'in_progress': return inProgressWhat.trim() || null;
      case 'blocked': {
        const parts = [];
        if (blockedWhy.trim())  parts.push(`Why: ${blockedWhy.trim()}`);
        if (blockedNext.trim()) parts.push(`Next: ${blockedNext.trim()}`);
        return parts.join('\n') || null;
      }
      default: return null;
    }
  };

  // ── getDispoText — what gets appended to GCal description ─────────
  const getDispoText = (dispo) => {
    switch (dispo) {
      case 'bill_it':     return { noteText: billNotes.trim(),       matText: '' };
      case 'return': {
        const noteParts = [
          returnBillNotes.trim(),
          returnWhat.trim() && `Next: ${returnWhat.trim()}`,
        ].filter(Boolean);
        return { noteText: noteParts.join(' | '), matText: returnMaterials.trim() };
      }
      case 'estimate':    return { noteText: estimateWhat.trim(),    matText: estimateMats.trim() };
      case 'in_progress': return { noteText: inProgressWhat.trim(),  matText: '' };
      case 'blocked': {
        const parts = [];
        if (blockedWhy.trim())  parts.push(`Why: ${blockedWhy.trim()}`);
        if (blockedNext.trim()) parts.push(`Next: ${blockedNext.trim()}`);
        return { noteText: parts.join(' | '), matText: '' };
      }
      default: return { noteText: '', matText: '' };
    }
  };

  // canFinish: just "not already submitting" — per-panel validation
  // is handled by panelValid() and gates readyToFinish, not canFinish.
  const canFinish = !acting;

  // ── Calendar PATCH ────────────────────────────────────────────────
  // APPENDS the tech's notes/materials to the event DESCRIPTION so the worker's
  // notes live on the calendar — not just in Overwatch. Append-only: never
  // overwrites the existing description.
  //
  // THE TITLE IS NEVER TOUCHED. Overwatch used to stamp [BILL IT] / [RETURN] /
  // [IN PROGRESS] / [ESTIMATE] onto the summary. That is the writing half of the
  // rule against deriving structured meaning from free text: a tag written into
  // a title is a string somebody then has to parse back out, and the parsers
  // drifted the moment a fifth disposition was added — TAG had no `blocked`
  // entry, so the title became "Customer Name undefined" and committed to
  // Google before the failing insert even ran.
  //
  // Status lives in the database. A calendar title is for a human to recognise
  // the appointment. Sara, 2026-08-20: "we are not to update calendar events
  // with [name] to reflect status in the app."
  const appendFieldNotes = async (noteText = '', matText = '') => {
    const body = {};

    if (noteText || matText) {
      const stamp = new Date()
        .toLocaleString('en-US', {
          timeZone: 'America/Denver',
          month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
        })
        .replace(',', '').replace(' AM', 'a').replace(' PM', 'p');
      const who = event.techName || userName || 'Tech';
      const parts = [];
      if (noteText) parts.push(noteText);
      if (matText)  parts.push(`Materials: ${matText}`);
      const line = `📝 [${stamp} ${who}] ${parts.join(' — ')}`;

      // Read the event's CURRENT description straight from Google so we never
      // clobber the customer-info block (which CustomerLookup owns) — append only.
      let current = event.description || '';
      try {
        const getUrl = `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`;
        const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (getRes.ok) {
          const live = await getRes.json();
          current = live.description || '';
        }
      } catch { /* fall back to the passed-in description */ }

      body.description = current ? `${current}\n${line}` : line;
    }

    // Nothing to say — no note, no materials. Do not PATCH an empty body.
    if (!Object.keys(body).length) return;

    const url = `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Calendar patch failed: ${res.status}`);
  };

  // ── Adopt-on-disposition (Option C) ───────────────────────────────
  // Every disposition must land on a real jobs row. If this calendar event
  // was booked outside Overwatch (no jobs row), adopt it now: create the row
  // from the event and stamp calendar_event_id. Dedupe on calendar_event_id
  // so we never make a ghost. Returns the job id.
  const DISPOSITION_STATUS = {
    bill_it:     JOB_STATUS.TO_BILL,
    estimate:    JOB_STATUS.NEEDS_ESTIMATE,
    in_progress: JOB_STATUS.SCHEDULED,   // stays open / active
    return:      JOB_STATUS.RETURN_PENDING,
    // "Couldn't do it" — no access, wrong parts, customer turned the tech away.
    // Previously there was no button for this, so techs picked "In progress"
    // and the job sat in Scheduled looking like it was still happening.
    blocked:     JOB_STATUS.BLOCKED,
  };
  // was a private label map — a fourth copy. utils/billing.js owns this.
  const DISPO_LABEL = Object.fromEntries(DISPO_KEYS.map(k => [k, dispo(k).label]));
  const ensureJobForEvent = async (disposition) => {
    const base = cleanTitle(event.title);
    const target = DISPOSITION_STATUS[disposition] || JOB_STATUS.SCHEDULED;
    // ONE resolver, shared with Unbilled and the home tile. See utils/jobResolve.
    //
    // PREFER THE JOB WE ALREADY FOUND ON OPEN. The sheet resolves the card when
    // it mounts (see linkedJob) to show the issue and history. Resolving a
    // SECOND time here meant two lookups against a moving database: anything
    // that changed the row in between — a status move on the board, another
    // tech dispositioning the same visit, a customer link being fixed — could
    // make the second lookup miss where the first one hit, and a miss here goes
    // on to CREATE A CARD. Same event, two cards.
    //
    // If the sheet already knows the job, that is the answer. Only fall back to
    // a fresh resolve when it does not.
    const existing = linkedJob?.id ? linkedJob : await resolveJobForEvent(event.id);

    if (existing) {
      // Already tracked — move it to the disposition's status AND put the
      // tech's real field notes on the card (job_history), not just a stub.
      const assembled = assembleNotes(disposition);
      const histNote = assembled
        ? `${DISPO_LABEL[disposition] || disposition}: ${assembled}`
        : `${disposition} disposition from Work Today`;
      await jobsApi.changeStatus(existing.id, target, userEmail, histNote);
      return existing.id;
    }
    // LAST CHANCE before we manufacture a duplicate. An event that was moved
    // between calendars, or recreated by hand, gets a brand-new Google id — so
    // the id lookups above all miss even though the job is sitting right there
    // on the board. Match on the same customer, same day, still-open, before
    // creating anything. This is the "why did a second card appear" bug.
    if (event.start) {
      try {
        const day = new Date(event.start);
        const from = new Date(day); from.setHours(0, 0, 0, 0);
        const to   = new Date(day); to.setHours(23, 59, 59, 999);
        let q = supabase.from('jobs').select('id, status')
          .gte('scheduled_date', from.toISOString())
          .lte('scheduled_date', to.toISOString())
          .not('status', 'in', '(billed,archived,dead,lost)')
          .limit(1);
        q = linkedCustomer?.id
          ? q.eq('customer_id', linkedCustomer.id)
          : q.ilike('customer_name', `%${(base || '').slice(0, 24)}%`);
        const { data: near } = await q;
        if (near && near[0]) {
          // Found it. Bind this event id on so the miss can't repeat, then
          // move it — do NOT create a second row.
          await supabase.from('jobs')
            .update({ calendar_event_id: event.id }).eq('id', near[0].id);
          const assembled2 = assembleNotes(disposition);
          const histNote = assembled2
            ? `${DISPO_LABEL[disposition] || disposition}: ${assembled2}`
            : `${disposition} disposition from Work Today`;
          await jobsApi.changeStatus(near[0].id, target, userEmail, histNote);
          return near[0].id;
        }
      } catch (e) { console.warn('ensureJobForEvent: same-day match failed', e); }
    }

    // Genuinely untracked — adopt the calendar event into a new jobs row.
    const created = await jobsApi.create({
      customer_name:     linkedCustomer?.name || base,
      customer_id:       linkedCustomer?.id || undefined,
      status:            target,
      issue:             assembleNotes(disposition) || base || '',
      customer_address:  event.location || '',
      scheduled_date:    event.start ? new Date(event.start).toISOString() : undefined,
      calendar_event_id: event.id,
      scheduled_event_id: event.id,   // both, so the next lookup cannot miss
      // The event knows whose calendar it came from — the adopt just never
      // carried it, so every adopted job landed with no tech on it. That is
      // how Chris Hare's second install day became an unowned job: a machine
      // made it, and machines were not filling this in.
      // Use the signed-in user as the tech — whoever is logged in is the one
      // doing the work. The calendar event id already ties this job to the right
      // event; we don't need to infer the tech from the calendar owner.
      tech_name: userName || undefined,
      assigned_to: userEmail || undefined,
    }, `${userEmail} · adopted from calendar`);
    return created?.id || null;
  };

  // ── Supabase write — every disposition routes through this ────────
  const writeTimeEntry = async (disposition) => {
    const payload = timeEntryToPayload(timeEntry, eventDate);
    // Resolve the job for THIS event and stamp it on the entry. Without this
    // the row lands with a null job_id and nothing on the board can find it —
    // which is how 62% of entries ended up unlinked. resolveJobForEvent checks
    // calendar_event_id, scheduled_event_id AND job_assignments, so it catches
    // the Jeanneret case where the two event ids differ.
    // Same rule as ensureJobForEvent: use the job the sheet already resolved
    // on open. A third independent lookup was a third chance to disagree.
    let jobId = linkedJob?.id || null;
    if (!jobId) {
      try {
        const linked = await resolveJobForEvent(event.id);
        jobId = linked?.id || linked?.job_id || null;
      } catch (e) {
        console.warn('job resolve failed, writing entry unlinked:', e?.message || e);
      }
    }
    return timeEntriesApi.create({
      job_id:             jobId,
      // Fall back to the CARD's customer. The sheet only had whatever the tech
      // picked, so a visit on a properly-linked job still wrote customer_id
      // null whenever the tech skipped the picker — and an unlinked entry is
      // what sends hours to the wrong customer or to nobody.
      customer_id:        linkedCustomer?.id || linkedJob?.customer_id || null,
      customer_name_raw:  linkedCustomer?.name || linkedJob?.customer_name || cleanTitle(event.title) || null,
      calendar_event_id:  event.id,
      calendar_id:        event.calendarId,
      event_title:        event.title,
      event_start:        event.start ? new Date(event.start).toISOString() : null,
      tech_email:         userEmail || null,
      // Signed-in user is always the tech. The calendar event id carries "what
      // job"; the session carries "who did it". No ASSIGNEES lookup needed.
      tech_name:          userName || null,
      time_in:            payload.time_in,
      time_out:           payload.time_out,
      total_minutes:      payload.total_minutes,
      entry_method:       payload.entry_method,
      disposition,
      notes:     assembleNotes(disposition) || null,
      photos:    photos.length ? photos : null,
      materials: disposition === 'return'   ? returnMaterials.trim() || null
               : disposition === 'estimate' ? estimateMats.trim() || null
               : null,
    });
  };

  const addPhotos = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true); setPhotoErr('');
    for (const f of files) {
      const r = await uploadPhoto(f, { customerCode: linkedCustomer?.short_code || 'misc' });
      if (r.ok) setPhotos(prev => [...prev, r.url]);
      else setPhotoErr(r.error || 'Upload failed');
    }
    setUploading(false);
  };

  // ── Disposition handlers ──────────────────────────────────────────
  const finish = async (disposition) => {
    if (!canFinish || !event) return;
    setActing(true);
    setError('');
    // Track whether time entry landed so the error message can tell the
    // tech exactly what did and did not make it — "time entry saved ✓ but
    // board card not updated" is far more useful than a generic failure.
    let entrySaved = false;
    try {
      const base = cleanTitle(event.title);
      const { noteText, matText } = getDispoText(disposition);
      await appendFieldNotes(noteText, matText);
      const entry = await writeTimeEntry(disposition);
      entrySaved = true;

      // Write the return card BEFORE updating the board so it is always
      // persisted even when the board update fails. original_event_date
      // carries WHEN the visit actually was (e.g. last Friday) — without it
      // the scheduler only has created_at (today) and sorts accordingly.
      if (disposition === 'return') {
        await returnCardsApi.create({
          customer_id:          linkedCustomer?.id || null,
          customer_name_raw:    linkedCustomer?.name || base || null,
          original_event_id:    event.id,
          original_calendar_id: event.calendarId,
          original_event_title: event.title,
          original_location:    event.location || null,
          original_event_date:  event.start ? new Date(event.start).toISOString() : null,
          flagged_by_email:     userEmail || null,
          flagged_by_name:      event.techName || userName || null,
          reason:               returnWhat.trim() || null,
          materials_needed:     returnMaterials.trim() || null,
          estimated_time:       returnEstTime.trim() || null,
          time_entry_id:        entry?.id || null,
        });
      }

      // Adopt-on-disposition: ensure a jobs row exists for THIS event and
      // move it to the right status — for every disposition, not just estimate.
      // This captures appointments booked directly on Google Calendar.
      //
      // NOT wrapped in its own try/catch. The previous inner catch silently
      // swallowed every failure here, so the tech closed the sheet thinking
      // everything worked while the board card was never updated. Errors now
      // surface as "Time entry saved ✓ — board card not updated" instead of
      // disappearing.
      const ensuredJobId = await ensureJobForEvent(disposition);

      // ── Writeback: link the time entry to the job ──────────────────
      // writeTimeEntry runs BEFORE ensureJobForEvent so hours are never lost
      // even when the board update fails. The downside is that on the adopt
      // path (no pre-existing job), writeTimeEntry has nothing to resolve and
      // the entry lands with job_id = null. Patch it now that we have the id.
      if (entry?.id && ensuredJobId && !entry.job_id) {
        try {
          await supabase
            .from('time_entries')
            .update({ job_id: ensuredJobId })
            .eq('id', entry.id);
        } catch (patchErr) {
          // Non-fatal — the entry is saved, the job is saved. They're just
          // not linked yet. Office can reconcile via the Unbilled view.
          console.warn('job_id writeback failed', patchErr);
        }
      }

      // Pass event.id as the second argument so callers (e.g. TechWorkToday)
      // can update local state by event id rather than relying on a closure
      // over `selected` that may be stale by the time the async finish() resolves.
      onFinished?.(disposition, event.id);
    } catch (e) {
      console.error(`${disposition} failed:`, e);
      setError(
        entrySaved
          ? `Time entry saved ✓ — board card not updated: ${e.message || 'unknown error'}. ` +
            `Your entry is in Unbilled. Let the office know so they can update the board.`
          : (e.message || 'Failed to save — try again.')
      );
      setActing(false);
    }
  };

  // Single commit path. In 'bill-only' mode the disposition is forced.
  const effectiveDispo = mode === 'full' ? selectedDispo : 'bill_it';

  // Per-panel required-field check. Bill It needs billing notes; Blocked needs a reason.
  // All other panels are optional — the dispo selection itself is the commitment.
  const panelValid = () => {
    if (!effectiveDispo) return false;
    if (effectiveDispo === 'bill_it') return billNotes.trim().length >= 3;
    if (effectiveDispo === 'return')  return returnBillNotes.trim().length >= 3;
    if (effectiveDispo === 'blocked') return blockedWhy.trim().length >= 3;
    return true;
  };

  // YOU CANNOT SAY WHAT HAPPENED AT A VISIT THAT HAS NOT HAPPENED.
  // A WARNING, NOT A BLOCK — testing and late logging are real cases.
  const eventInFuture = event?.start && new Date(event.start) > new Date();
  const [futureOk, setFutureOk] = useState(false);
  const readyToFinish = canFinish && !!effectiveDispo && panelValid()
                        && (!eventInFuture || futureOk);

  const handleFinish = () => {
    if (!effectiveDispo) { setError('Pick how the job ended first.'); return; }
    if (effectiveDispo === 'bill_it' && billNotes.trim().length < 3) {
      setError('Add billing notes to finish.'); return;
    }
    if (effectiveDispo === 'blocked' && blockedWhy.trim().length < 3) {
      setError("Add what happened — why couldn't it be done?"); return;
    }
    finish(effectiveDispo);
  };

  if (!event) return null;

  // ── Scope of work — what the tech is walking into ──────────────────
  // Pulled straight off the calendar event description, stripped of the
  // machine noise (deep link, CUSTOMER_ID stamp) and of previously-appended
  // field notes (📝 lines). Shown IN FULL — no "Show more" truncation. This
  // is the single most important thing on the screen and it used to be
  // collapsed behind a link.
  const eventScope = htmlToText(event.description || '')
    .replace(/📱.*|Open in (JUC-E|Overwatch).*/g, '')
    .replace(/CUSTOMER_ID:\s*[A-Za-z0-9\-_]+\s*/g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('📝'))
    .join('\n')
    .trim();
  // jobs.issue WINS. It is the live answer to "what are we doing here" and it
  // is what the office typed on the card. The event description is a snapshot
  // of it and can be stale, empty, or hand-edited — so it is the fallback,
  // never the source. Also run through htmlToText in case it was populated by
  // pasting from Google Calendar before this fix landed.
  const issueText = htmlToText((linkedJob?.issue || '').trim());
  const scope     = issueText || eventScope;
  // extraFromEvent REMOVED. Access codes and gate info now live in structured
  // DB fields shown in the "👤 On site" block above. The GCal description also
  // contains the issue text + Latest Note appends, so showing it here duplicated
  // both the scope and the History section.
  const extraFromEvent = '';

  // Same five destinations as the board and My Tasks, in the words a tech
  // would use. The labels used to be this sheet's own invention — "Needs
  // estimate" here, "Estimates" on the board, "Won" in the mover — so the same
  // move had three names depending on which screen you were standing in.
  // `means` is the question the tech is actually answering.
  const DISPOS = [
    { key: 'bill_it',     label: '✅ Done — To Bill',   means: 'Finished. Hours go to Billing.' },
    { key: 'return',      label: '🔄 Return Visit',     means: 'Work started — I have to come back.' },
    { key: 'in_progress', label: '📅 Still Scheduled',  means: 'Multi-day job. Not finished, still booked.' },
    { key: 'estimate',    label: '📋 Estimates',        means: 'Scope changed — this needs pricing.' },
    { key: 'blocked',     label: "🚫 Couldn't do it",   means: 'Nobody there, no access, wrong parts. The trip still bills.' },
  ];

  // True when the event's calendar date differs from the local calendar date
  // today — i.e. the tech is logging against a past (or future) visit.
  const visitDateIsToday = eventDate.toDateString() === new Date().toDateString();

  // ── The actual form content ────────────────────────────────────────
  // Layout order: customer → navigate/call/text → issue → notes →
  //   photos → hours → how did it end → submit
  const formContent = (
    <>
      {/* VISIT DATE — shown whenever the event is NOT today */}
      {!visitDateIsToday && (
        <div style={{ background: '#f0f9ff', border: '1.5px solid #38bdf8', borderRadius: 12,
                      padding: '10px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0c4a6e' }}>
              Logging against:{' '}
              {eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            <div style={{ fontSize: 12, color: '#0369a1', marginTop: 1 }}>
              Not today — this will be saved with the original visit date.
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER */}
      <CustomerLookup event={event} accessToken={accessToken} value={linkedCustomer} onChange={setLinkedCust} />
      {linkedCustomer?.id && (
        <button onClick={() => navigate(`/customers?customerId=${linkedCustomer.id}`)}
          style={{ display: 'block', width: '100%', textAlign: 'center', padding: '6px 0',
                   marginTop: -6, marginBottom: 10, background: 'none', border: 'none',
                   color: '#16a34a', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                   textDecoration: 'underline' }}>
          View full client history →
        </button>
      )}

      {/* NAVIGATE / CALL / TEXT — three big action buttons.
          Only in standalone mode; inline callers (TechWorkToday) show their own nav buttons
          in the card header so we don't duplicate them here.
          Navigate uses event.location (available immediately).
          Call / Text use linkedJob phone (loads async, appear once ready). */}
      {!inline && (() => {
        const rawPhone = linkedJob?.site_contact_phone || linkedJob?.customer_phone || '';
        const phone    = rawPhone.replace(/[^0-9+]/g, '');
        const hasNav   = !!event?.location;
        const hasPhone = !!phone;
        if (!hasNav && !hasPhone) return null;
        const cols = hasNav && hasPhone ? '1.4fr 1fr 1fr' : hasNav ? '1fr' : '1fr 1fr';
        const btnBase = {
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 3, padding: '16px 10px', borderRadius: 14,
          textDecoration: 'none', border: 'none', cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        };
        const contactName = linkedJob?.site_contact_name || linkedJob?.customer_name || 'Client';
        return (
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, marginBottom: 14 }}>
            {hasNav && (
              <a href={'https://maps.google.com/?q=' + encodeURIComponent(event.location)}
                target="_blank" rel="noopener noreferrer"
                style={{ ...btnBase, background: '#1e3a8a', color: '#fff' }}>
                <span style={{ fontSize: 20 }}>🗺️</span>
                <span style={{ fontSize: 15, fontWeight: 800 }}>Navigate</span>
                <span style={{ fontSize: 10, opacity: 0.8 }}>Get directions</span>
              </a>
            )}
            {hasPhone && (
              <a href={'tel:' + phone} style={{ ...btnBase, background: '#16a34a', color: '#fff' }}>
                <span style={{ fontSize: 20 }}>📞</span>
                <span style={{ fontSize: 15, fontWeight: 800 }}>Call</span>
                <span style={{ fontSize: 10, opacity: 0.8 }}>{contactName}</span>
              </a>
            )}
            {hasPhone && (
              <a href={'sms:' + phone} style={{ ...btnBase, background: '#2563eb', color: '#fff' }}>
                <span style={{ fontSize: 20 }}>💬</span>
                <span style={{ fontSize: 15, fontWeight: 800 }}>Text</span>
                <span style={{ fontSize: 10, opacity: 0.8 }}>Send a message</span>
              </a>
            )}
          </div>
        );
      })()}

      {/* ACCESS — compact chip when recorded */}
      {(linkedJob?.access_permission === true || linkedJob?.access_permission === false) && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                      borderRadius: 20, marginBottom: 10,
                      background: linkedJob.access_permission ? '#f0fdf4' : '#fffbeb',
                      border: `1px solid ${linkedJob.access_permission ? '#bbf7d0' : '#fde68a'}`,
                      fontSize: 12, fontWeight: 700,
                      color: linkedJob.access_permission ? '#166534' : '#92400e' }}>
          {linkedJob.access_permission ? '🔓 May enter without client' : '🔒 Client must be present'}
          {linkedJob.site_contact_name && (
            <span style={{ fontWeight: 500 }}> — {linkedJob.site_contact_name}</span>
          )}
        </div>
      )}

      {/* ISSUE — the hero. What the tech is walking into, from jobs.issue. */}
      {scope && (
        <div style={scopeBox}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase',
                        letterSpacing: 0.5, marginBottom: 5 }}>
            📋 Issue
          </div>
          <div style={{ fontSize: 14, color: '#1e3a8a', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {scope}
          </div>
        </div>
      )}

      {/* NOTES — "what happened on this visit"
          Shown BEFORE the outcome picker so the tech fills it in first.
          Routes to the correct per-dispo state variable so assembleNotes /
          panelValid / handleFinish are completely unchanged. */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
                         letterSpacing: 0.5 }}>
            📝 Notes
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {!effectiveDispo
              ? 'pick an outcome below, then add your notes'
              : effectiveDispo === 'bill_it'
              ? 'What happened? Appended to calendar + shown in board history.'
              : effectiveDispo === 'return'
              ? 'What happened on this visit?'
              : effectiveDispo === 'estimate'
              ? 'What are we bidding and why?'
              : effectiveDispo === 'blocked'
              ? "What happened — why couldn't it be done?"
              : 'Where are things at? What happens next?'}
          </span>
        </div>
        <textarea
          value={
            effectiveDispo === 'bill_it'       ? billNotes
            : effectiveDispo === 'return'      ? returnBillNotes
            : effectiveDispo === 'estimate'    ? estimateWhat
            : effectiveDispo === 'blocked'     ? blockedWhy
            : effectiveDispo === 'in_progress' ? inProgressWhat
            : ''
          }
          onChange={e => {
            if      (effectiveDispo === 'bill_it')      setBillNotes(e.target.value);
            else if (effectiveDispo === 'return')       setReturnBillNotes(e.target.value);
            else if (effectiveDispo === 'estimate')     setEstimateWhat(e.target.value);
            else if (effectiveDispo === 'blocked')      setBlockedWhy(e.target.value);
            else if (effectiveDispo === 'in_progress')  setInProgressWhat(e.target.value);
          }}
          disabled={!effectiveDispo}
          placeholder={effectiveDispo
            ? 'What happened on this visit…'
            : 'Pick an outcome below first'}
          rows={3}
          style={{
            width: '100%', padding: '12px 14px', boxSizing: 'border-box',
            border: `1.5px solid ${effectiveDispo ? '#d1d5db' : '#e5e7eb'}`,
            borderRadius: 12, background: effectiveDispo ? '#fff' : '#f8fafc',
            fontSize: 15, color: '#1B2A4A', fontFamily: 'inherit',
            resize: 'vertical', outline: 'none',
            opacity: effectiveDispo ? 1 : 0.55,
          }}
        />
      </div>

      {/* PHOTOS */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase',
                    letterSpacing: 0.5, marginBottom: 6 }}>
        📷 Photos {photos.length ? `(${photos.length})` : ''}
      </div>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
          {photos.map((u, i) => (
            <div key={u} style={{ position: 'relative' }}>
              <img src={u} alt="" style={{ width: 74, height: 74, objectFit: 'cover',
                                           borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                aria-label="Remove photo"
                style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22,
                         borderRadius: 11, border: 'none', background: '#dc2626', color: '#fff',
                         fontSize: 13, fontWeight: 800, lineHeight: '20px', cursor: 'pointer', padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <label style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 10,
                        border: '1.5px dashed #93c5fd', background: '#eff6ff', color: '#2563eb',
                        fontSize: 14, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Uploading…' : '📷 Take photo'}
          <input type="file" accept="image/*" capture="environment" multiple disabled={uploading}
            onChange={e => { addPhotos(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }} />
        </label>
        <label style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 10,
                        border: '1.5px dashed #93c5fd', background: '#eff6ff', color: '#2563eb',
                        fontSize: 14, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Uploading…' : '🖼 Choose photo'}
          <input type="file" accept="image/*" multiple disabled={uploading}
            onChange={e => { addPhotos(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }} />
        </label>
      </div>
      {photoErr && (
        <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>{photoErr}</div>
      )}

      {/* HOURS — no clock in/out */}
      <TimeEntryBlock value={timeEntry} onChange={setTimeEntry} eventDate={eventDate}
        required={false} hideClock />

      {/* HOW DID IT END — 2 primary, 2 secondary, 1 tertiary */}
      {mode === 'full' && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700,
                        color: selectedDispo ? '#16a34a' : '#64748b',
                        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            How did it end? {selectedDispo ? '✓' : '— required'}
          </div>

          {/* PRIMARY: Done and Return */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {[
              { key: 'bill_it', emoji: '✅', label: 'Done — Bill It',  sub: 'Finished. Hours go to billing.' },
              { key: 'return',  emoji: '🔄', label: 'Return Visit',    sub: 'Work started — have to come back.' },
            ].map(d => {
              const on = selectedDispo === d.key;
              const dc = DISPO_COLORS[d.key];
              return (
                <button key={d.key}
                  onClick={() => { setSelectedDispo(on ? null : d.key); setError(''); }}
                  style={{ padding: '14px 10px', borderRadius: 12, cursor: 'pointer',
                           textAlign: 'center', fontFamily: 'inherit',
                           background: on ? dc.color : dc.bg, color: on ? '#fff' : dc.color,
                           border: on ? `2px solid ${dc.color}` : `2px solid ${dc.border}` }}>
                  <div style={{ fontSize: 22 }}>{d.emoji}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3 }}>{d.label}</div>
                  <div style={{ fontSize: 11, opacity: on ? 0.85 : 0.75, marginTop: 3, lineHeight: 1.3 }}>{d.sub}</div>
                </button>
              );
            })}
          </div>

          {/* Return details — inline below the button */}
          {selectedDispo === 'return' && (
            <div style={{ background: 'rgba(249,115,22,0.06)',
                          border: '1.5px solid rgba(249,115,22,0.3)',
                          borderRadius: 12, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#ea580c',
                            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                Return details
              </div>
              <div style={{ fontSize: 12, color: '#9a3412', fontWeight: 700, marginBottom: 4 }}>
                What are we doing when we come back?
              </div>
              <textarea value={returnWhat} onChange={e => setReturnWhat(e.target.value)}
                placeholder="What needs to happen on the return visit…" rows={2}
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                         border: '1px solid rgba(249,115,22,0.35)', borderRadius: 10, background: '#fff',
                         fontSize: 14, color: '#1B2A4A', fontFamily: 'inherit',
                         resize: 'vertical', outline: 'none', marginBottom: 10 }} />
              <div style={{ fontSize: 12, color: '#9a3412', fontWeight: 700, marginBottom: 4 }}>
                Need to buy anything?
              </div>
              <input value={returnMaterials} onChange={e => setReturnMaterials(e.target.value)}
                placeholder="Parts, materials — or leave blank"
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                         border: '1px solid rgba(249,115,22,0.35)', borderRadius: 10, background: '#fff',
                         fontSize: 14, color: '#1B2A4A', fontFamily: 'inherit',
                         outline: 'none', marginBottom: 10 }} />
              <div style={{ fontSize: 12, color: '#9a3412', fontWeight: 700, marginBottom: 4 }}>
                How long should we plan on-site?
              </div>
              <input value={returnEstTime} onChange={e => setReturnEstTime(e.target.value)}
                placeholder="e.g. 2h, half day"
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                         border: '1px solid rgba(249,115,22,0.35)', borderRadius: 10, background: '#fff',
                         fontSize: 14, color: '#1B2A4A', fontFamily: 'inherit', outline: 'none' }} />
            </div>
          )}

          {/* SECONDARY: Estimate and Can't Complete */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {[
              { key: 'estimate', emoji: '📋', label: 'Estimate',       sub: 'Scope changed — needs pricing.' },
              { key: 'blocked',  emoji: '🚫', label: "Can't Complete", sub: 'No access / wrong parts. Trip bills.' },
            ].map(d => {
              const on = selectedDispo === d.key;
              const dc = DISPO_COLORS[d.key];
              return (
                <button key={d.key}
                  onClick={() => { setSelectedDispo(on ? null : d.key); setError(''); }}
                  style={{ padding: '11px 10px', borderRadius: 12, cursor: 'pointer',
                           textAlign: 'center', fontFamily: 'inherit',
                           background: on ? dc.color : dc.bg, color: on ? '#fff' : dc.color,
                           border: on ? `2px solid ${dc.color}` : `2px solid ${dc.border}` }}>
                  <div style={{ fontSize: 18 }}>{d.emoji}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>{d.label}</div>
                  <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2, lineHeight: 1.3 }}>{d.sub}</div>
                </button>
              );
            })}
          </div>

          {/* Estimate extra: materials to bid */}
          {selectedDispo === 'estimate' && (
            <div style={{ background: 'rgba(168,85,247,0.05)',
                          border: '1.5px solid rgba(168,85,247,0.25)',
                          borderRadius: 12, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700, marginBottom: 4 }}>
                Materials to bid out
              </div>
              <textarea value={estimateMats} onChange={e => setEstimateMats(e.target.value)}
                placeholder="Parts, equipment, subcontractors…" rows={2}
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                         border: '1px solid rgba(168,85,247,0.3)', borderRadius: 10, background: '#fff',
                         fontSize: 14, color: '#1B2A4A', fontFamily: 'inherit',
                         resize: 'vertical', outline: 'none' }} />
            </div>
          )}

          {/* Blocked extra: optional "what happens next" */}
          {selectedDispo === 'blocked' && (
            <div style={{ background: 'rgba(239,68,68,0.05)',
                          border: '1.5px solid rgba(239,68,68,0.2)',
                          borderRadius: 12, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700, marginBottom: 4 }}>
                What happens next? (optional)
              </div>
              <input value={blockedNext} onChange={e => setBlockedNext(e.target.value)}
                placeholder="Reschedule, waiting on parts, customer will call…"
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                         border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, background: '#fff',
                         fontSize: 14, color: '#1B2A4A', fontFamily: 'inherit', outline: 'none' }} />
            </div>
          )}

          {/* TERTIARY: Still Scheduled — quiet, multi-day work */}
          {(() => {
            const on = selectedDispo === 'in_progress';
            const dc = DISPO_COLORS['in_progress'];
            return (
              <>
                <button
                  onClick={() => { setSelectedDispo(on ? null : 'in_progress'); setError(''); }}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                           textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                           fontFamily: 'inherit',
                           background: on ? dc.bg : 'rgba(100,116,139,0.04)',
                           border: on ? `1.5px solid ${dc.border}` : '1.5px solid rgba(100,116,139,0.12)',
                           color: on ? dc.color : '#94a3b8', marginBottom: on ? 8 : 4 }}>
                  <span style={{ fontSize: 16 }}>📅</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Still Scheduled</div>
                    <div style={{ fontSize: 11 }}>Multi-day job — not finished, still booked.</div>
                  </div>
                </button>
                {on && (
                  <textarea value={inProgressWhat} onChange={e => setInProgressWhat(e.target.value)}
                    placeholder="Where are things at? What happens on the next day?"
                    rows={2}
                    style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                             border: `1px solid ${dc.border}`, borderRadius: 10, background: '#fff',
                             fontSize: 14, color: '#1B2A4A', fontFamily: 'inherit',
                             resize: 'vertical', outline: 'none', marginBottom: 8 }} />
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* FUTURE EVENT WARNING */}
      {eventInFuture && !futureOk && (
        <div style={{ background:'#2a1f08', border:'1px solid #f59e0b', borderRadius:10,
                      padding:'12px 14px', marginBottom:10 }}>
          <div style={{ color:'#fbbf24', fontSize:13.5, fontWeight:800, marginBottom:5 }}>
            This visit hasn't happened yet
          </div>
          <div style={{ color:'#fcd9a0', fontSize:12.5, lineHeight:1.45, marginBottom:10 }}>
            It's scheduled for {new Date(event.start).toLocaleDateString('en-US',
              { weekday:'long', month:'short', day:'numeric' })}. Closing it out now writes
            hours against work nobody has done yet.
          </div>
          <button onClick={() => setFutureOk(true)}
            style={{ background:'transparent', border:'1px solid #f59e0b', borderRadius:8,
                     color:'#fbbf24', fontSize:12.5, fontWeight:800, padding:'8px 14px',
                     cursor:'pointer', fontFamily:'inherit' }}>
            I know — let me close it anyway
          </button>
        </div>
      )}

      {error && <div style={errorBox}>{error}</div>}

      {/* SUBMIT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        <button onClick={handleFinish} disabled={!readyToFinish}
          style={{
            padding: 16, width: '100%', border: 'none', borderRadius: 12,
            background: readyToFinish
              ? (effectiveDispo ? DISPO_COLORS[effectiveDispo].color : '#1B2A4A')
              : '#cbd5e1',
            color: readyToFinish ? '#080f1e' : '#94a3b8',
            fontSize: 16, fontWeight: 800,
            cursor: readyToFinish ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}>
          {acting ? 'Saving…'
            : !effectiveDispo ? 'Pick an outcome above'
            : eventInFuture && !futureOk ? "This visit hasn't happened yet"
            : effectiveDispo === 'bill_it' && billNotes.trim().length < 3 ? 'Add notes to finish'
            : effectiveDispo === 'return' && returnBillNotes.trim().length < 3 ? 'Add notes to finish'
            : effectiveDispo === 'blocked' && blockedWhy.trim().length < 3 ? 'Add notes to finish'
            : 'Finish job'}
        </button>
        <button onClick={onCancel} style={btnCancel}>Cancel</button>
      </div>
    </>
  );

  // Inline mode — caller (e.g. TechWorkToday) provides its own overlay/sheet/header.
  if (inline) return formContent;

  // Standalone mode — render the full overlaid bottom sheet with a basic header.
  return (
    <div style={overlay} onClick={onCancel}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ color: '#1B2A4A', fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
              {cleanTitle(event.title) || '(untitled job)'}
            </div>
            {event.start && (
              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                {new Date(event.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}
                {new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
            )}
            {event.location && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>📍 {event.location}</div>}
          </div>
          <button onClick={onCancel} style={closeBtn}>×</button>
        </div>

        <div style={hr} />

        {formContent}
      </div>
    </div>
  );
}

// ── ReturnButtonWithReason ────────────────────────────────────────
// Inline-expands a reason field before firing onConfirm, since
// every return_card needs a reason to be useful in the Scheduler/Board view.
function ReturnButtonWithReason({ canFinish, acting, expanded, setExpanded, reason, setReason, onConfirm }) {
  const ready = canFinish && reason.trim().length > 0;

  if (!expanded) {
    return (
      <button
        onClick={() => canFinish && setExpanded(true)}
        disabled={!canFinish}
        style={btnReturnCollapsed(canFinish)}
      >
        🔄 Return Visit
      </button>
    );
  }

  return (
    <div style={{ background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Why is a return visit needed?
      </div>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Missing part, customer not home, needs follow-up…"
        autoFocus
        style={{
          width: '100%', padding: 8, fontSize: 13, color: '#1B2A4A',
          background: '#ffffff', border: '1px solid #fcd34d', borderRadius: 8,
          resize: 'none', height: 50, marginBottom: 8, boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setExpanded(false)} style={{ flex: 1, padding: 8, background: 'none', border: '1px solid #fcd34d', borderRadius: 8, color: '#92400e', fontSize: 12, cursor: 'pointer' }}>
          Back
        </button>
        <button onClick={onConfirm} disabled={!ready} style={{
          flex: 2, padding: 8,
          background: ready ? '#d97706' : '#fde68a',
          border: 'none', borderRadius: 8,
          color: ready ? '#ffffff' : '#92400e',
          fontSize: 13, fontWeight: 700,
          cursor: ready ? 'pointer' : 'not-allowed',
        }}>
          {acting ? 'Saving…' : 'Confirm Return'}
        </button>
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 41, 0.75)',
  zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
};
const sheet = {
  background: '#ffffff', borderRadius: '20px 20px 0 0',
  padding: '20px 18px calc(28px + env(safe-area-inset-bottom))', width: '100%', maxWidth: 480,
  // dvh only — a duplicate JS key is overwritten, not a CSS fallback.
  maxHeight: '92dvh', overflowY: 'auto',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.2)',
};
const hr = { height: 1, background: '#e5e7eb', margin: '12px 0' };
const closeBtn = {
  background: 'none', border: 'none', color: '#9ca3af',
  fontSize: 28, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
};
const textareaStyle = {
  width: '100%', padding: 12,
  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12,
  color: '#1B2A4A', fontSize: 16, resize: 'none', height: 72,
  marginBottom: 10, boxSizing: 'border-box', fontFamily: 'inherit',
};
const hintBox = {
  padding: '10px 12px', background: '#fffbeb', border: '1px solid #fcd34d',
  borderRadius: 12, fontSize: 13, color: '#92400e', textAlign: 'center', marginBottom: 4,
};
const errorBox = {
  padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 12, fontSize: 13, color: '#b91c1c', marginBottom: 4,
};
const btnInProgress = (on) => ({
  padding: 15, background: on ? '#ecfeff' : '#f1f5f9',
  border: `1.5px solid ${on ? '#67e8f9' : '#cbd5e1'}`, borderRadius: 12,
  color: on ? '#155e75' : '#94a3b8', fontSize: 16, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnReturnCollapsed = (on) => ({
  padding: 15, background: on ? '#fffbeb' : '#f1f5f9',
  border: `1.5px solid ${on ? '#fbbf24' : '#cbd5e1'}`, borderRadius: 12,
  color: on ? '#92400e' : '#94a3b8', fontSize: 16, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnEstimate = (on) => ({
  padding: 15, background: on ? '#f5f3ff' : '#f1f5f9',
  border: `1.5px solid ${on ? '#c4b5fd' : '#cbd5e1'}`, borderRadius: 12,
  color: on ? '#5b21b6' : '#94a3b8', fontSize: 16, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnBillIt = (on) => ({
  padding: 16, background: on ? '#1B2A4A' : '#cbd5e1', border: 'none',
  borderRadius: 12, color: '#ffffff', fontSize: 16, fontWeight: 800,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnCancel = {
  padding: 13, background: 'none', border: '1px solid #e5e7eb',
  borderRadius: 12, color: '#9ca3af', fontSize: 15, cursor: 'pointer',
};

const scopeBox = {
  background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12,
  padding: '10px 12px', marginBottom: 12,
};
// (btnFinish is superseded by inline dispo-color style on the submit button)

// ── Panel textarea base style ─────────────────────────────────────
const panelTextarea = {
  width: '100%', padding: 10,
  background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8,
  color: '#1B2A4A', fontSize: 15, resize: 'none', height: 68,
  marginBottom: 8, boxSizing: 'border-box', fontFamily: 'inherit',
};

// ── Disposition panels ────────────────────────────────────────────
// Each panel receives `colors` from DISPO_COLORS[dispo] and owns its
// own fields. The parent holds the state and passes onChange callbacks.

function BillItPanel({ value, onChange, colors }) {
  const valid = value.trim().length >= 3;
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`,
                  borderLeft: `4px solid ${colors.color}`, borderRadius: 10,
                  padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.color,
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Billing notes — required
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="What was done — required to finish"
        autoFocus
        style={{ ...panelTextarea, border: `1px solid ${valid ? '#e5e7eb' : '#fca5a5'}`,
                 background: valid ? '#fff' : '#fef2f2' }}
      />
    </div>
  );
}

function ReturnPanel({ billNotes, onBillNotes, what, onWhat, materials, onMaterials, estTime, onEstTime, colors }) {
  // A return trip bills for the time on site AND needs a plan for the next trip.
  // Both sections are required: billing notes say what was done (for the invoice);
  // next-visit fields say what's still owed (for the scheduler).
  const billValid = (billNotes || '').trim().length >= 3;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* ── BILLING — what was done on THIS trip ────────────────── */}
      <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
                    borderLeft: '4px solid #4ade80', borderRadius: 10,
                    padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80',
                      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Billing notes — required
        </div>
        <textarea
          value={billNotes}
          onChange={e => onBillNotes(e.target.value)}
          placeholder="What was done this visit — required to finish"
          autoFocus
          style={{ ...panelTextarea, border: `1px solid ${billValid ? '#e5e7eb' : '#fca5a5'}`,
                   background: billValid ? '#fff' : '#fef2f2' }}
        />
      </div>
      {/* ── NEXT VISIT — what needs to happen on the return trip ─── */}
      <div style={{ background: colors.bg, border: `1px solid ${colors.border}`,
                    borderLeft: `4px solid ${colors.color}`, borderRadius: 10,
                    padding: '12px 14px', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.color,
                      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Next visit
        </div>
        <textarea
          value={what}
          onChange={e => onWhat(e.target.value)}
          placeholder="What to do next visit…"
          style={panelTextarea}
        />
        <textarea
          value={materials}
          onChange={e => onMaterials(e.target.value)}
          placeholder="Materials needed…"
          style={{ ...panelTextarea, height: 50 }}
        />
        <input
          type="text"
          value={estTime}
          onChange={e => onEstTime(e.target.value)}
          placeholder="Estimated time (e.g. 2 hours)"
          style={{ width: '100%', padding: '8px 10px', fontSize: 14, color: '#1B2A4A',
                   background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                   boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
      </div>
    </div>
  );
}

function EstimatePanel({ what, onWhat, materials, onMaterials, colors }) {
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`,
                  borderLeft: `4px solid ${colors.color}`, borderRadius: 10,
                  padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.color,
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Estimate details
      </div>
      <textarea
        value={what}
        onChange={e => onWhat(e.target.value)}
        placeholder="What needs estimating?"
        autoFocus
        style={panelTextarea}
      />
      <textarea
        value={materials}
        onChange={e => onMaterials(e.target.value)}
        placeholder="Materials…"
        style={{ ...panelTextarea, height: 50 }}
      />
    </div>
  );
}

function InProgressPanel({ value, onChange, colors }) {
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`,
                  borderLeft: `4px solid ${colors.color}`, borderRadius: 10,
                  padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.color,
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        What's happening next?
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="What's the plan for the next visit?"
        autoFocus
        style={panelTextarea}
      />
    </div>
  );
}

function BlockedPanel({ why, onWhy, next, onNext, colors }) {
  const valid = why.trim().length >= 3;
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`,
                  borderLeft: `4px solid ${colors.color}`, borderRadius: 10,
                  padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.color,
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        What happened? — required
      </div>
      <textarea
        value={why}
        onChange={e => onWhy(e.target.value)}
        placeholder="Nobody there, no access, wrong parts…"
        autoFocus
        style={{ ...panelTextarea, border: `1px solid ${valid ? '#e5e7eb' : '#fca5a5'}`,
                 background: valid ? '#fff' : '#fef2f2' }}
      />
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.color, marginBottom: 4 }}>
        What's next? <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
      </div>
      <textarea
        value={next}
        onChange={e => onNext(e.target.value)}
        placeholder="What needs to happen before this can be rescheduled?"
        style={{ ...panelTextarea, height: 50 }}
      />
    </div>
  );
}
