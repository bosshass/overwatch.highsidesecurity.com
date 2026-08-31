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

const GCAL = 'https://www.googleapis.com/calendar/v3';

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
  const [notes, setNotes]               = useState('');
  const [materials, setMaterials]       = useState('');
  // photoLink was state with no input rendered anywhere — a tech was meant to
  // upload a picture somewhere else, copy the URL and paste it into a box that
  // did not exist. Real upload instead: camera to Supabase Storage, attached
  // to the visit, free.
  const [photos, setPhotos]             = useState([]);
  const [uploading, setUploading]       = useState(false);
  const [photoErr, setPhotoErr]         = useState('');
  const [timeEntry, setTimeEntry]       = useState(emptyTimeEntry());
  const [linkedCustomer, setLinkedCust] = useState(prefillCustomer);
  const [returnReason, setReturnReason] = useState('');
  const [returnExpanded, setRetExp]     = useState(false);
  const [acting, setActing]             = useState(false);
  const [error, setError]               = useState('');
  // v9.4.0: disposition is now a SELECTION made up top (before notes), and a
  // single "Finish job" button commits it. Previously the 4 disposition
  // buttons were buried under Notes+Materials and doubled as the submit,
  // so the tech had to scroll past everything to say what happened.
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

  const eventDate     = event?.start ? new Date(event.start) : new Date();
  const timeValid     = isValidTimeEntry(timeEntry, eventDate);
  const notesValid    = notes.trim().length >= 3;   // required: no blank completions
  // Linking a customer is no longer a hard gate — that association should
  // already exist upstream (calendar sync / registry match), and forcing
  // the tech to do it manually every single time was pure friction. It's
  // still shown and still gets saved when present; it just can't block
  // finishing a job anymore.
  const canFinish     = notesValid && !acting;

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
  const appendFieldNotes = async () => {
    const body = {};

    const noteText = notes.trim();
    const matText  = materials.trim();
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
      const histNote = notes.trim()
        ? `${DISPO_LABEL[disposition] || disposition}: ${notes.trim()}`
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
          const histNote = notes.trim()
            ? `${DISPO_LABEL[disposition] || disposition}: ${notes.trim()}`
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
      issue:             notes.trim() || base || '',
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
      notes:              notes.trim() || null,
      photos:             photos.length ? photos : null,

      materials:          materials.trim() || null,
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
  const finish = async (disposition, extra = {}) => {
    if (!canFinish || !event) return;
    setActing(true);
    setError('');
    try {
      const base = cleanTitle(event.title);
      await appendFieldNotes();
      const entry = await writeTimeEntry(disposition);

      // Adopt-on-disposition: ensure a jobs row exists for THIS event and
      // move it to the right status — for every disposition, not just estimate.
      // This captures appointments booked directly on Google Calendar.
      try {
        await ensureJobForEvent(disposition);
      } catch (err) {
        console.warn('adopt-on-disposition failed (time entry still saved):', err);
      }

      if (disposition === 'return') {
        await returnCardsApi.create({
          customer_id:          linkedCustomer?.id || null,
          customer_name_raw:    linkedCustomer?.name || base || null,
          original_event_id:    event.id,
          original_calendar_id: event.calendarId,
          original_event_title: event.title,
          original_location:    event.location || null,
          flagged_by_email:     userEmail || null,
          flagged_by_name:      event.techName || userName || null,
          reason:               extra.reason || null,
          time_entry_id:        entry?.id || null,
        });
      }

      // No second argument any more — the title is unchanged, so there is
      // nothing for the caller to swap in. See appendFieldNotes().
      onFinished?.(disposition);
    } catch (e) {
      console.error(`${disposition} failed:`, e);
      setError(e.message || 'Failed to save — try again.');
      setActing(false);
    }
  };

  // Single commit path. In 'bill-only' mode the disposition is forced.
  const effectiveDispo = mode === 'full' ? selectedDispo : 'bill_it';
  const needsReason    = effectiveDispo === 'return';
  const reasonOk       = !needsReason || returnReason.trim().length > 0;
  // YOU CANNOT SAY WHAT HAPPENED AT A VISIT THAT HAS NOT HAPPENED.
  // Nothing checked the date, so an event on next Monday could be dispositioned
  // "Bill it" today — which writes billable hours against work nobody has done
  // and puts them in front of accounting as ready to invoice. That is how
  // KING TECH TEST ended up with 6 hours logged on a future Monday and another
  // row at 0.0h marked bill_it.
  //
  // A WARNING, NOT A BLOCK. Somebody finishing a job at 11pm whose event was
  // logged for tomorrow morning is a real case, and so is testing. It just has
  // to be deliberate.
  const eventInFuture = event?.start && new Date(event.start) > new Date();
  const [futureOk, setFutureOk] = useState(false);
  const readyToFinish  = canFinish && !!effectiveDispo && reasonOk
                         && (!eventInFuture || futureOk);

  const handleFinish = () => {
    if (!effectiveDispo) { setError('Pick how the job ended first.'); return; }
    if (needsReason && !returnReason.trim()) {
      setError('Add a reason for the return visit.');
      return;
    }
    finish(effectiveDispo, needsReason ? { reason: returnReason.trim() } : {});
  };

  if (!event) return null;

  // ── Scope of work — what the tech is walking into ──────────────────
  // Pulled straight off the calendar event description, stripped of the
  // machine noise (deep link, CUSTOMER_ID stamp) and of previously-appended
  // field notes (📝 lines). Shown IN FULL — no "Show more" truncation. This
  // is the single most important thing on the screen and it used to be
  // collapsed behind a link.
  const eventScope = (event.description || '')
    .replace(/📱.*|Open in (JUC-E|Overwatch).*/g, '')
    .replace(/CUSTOMER_ID:\s*[A-Za-z0-9\-_]+\s*/g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('📝'))
    .join('\n')
    .trim();
  // jobs.issue WINS. It is the live answer to "what are we doing here" and it
  // is what the office typed on the card. The event description is a snapshot
  // of it and can be stale, empty, or hand-edited — so it is the fallback,
  // never the source.
  const issueText = (linkedJob?.issue || '').trim();
  const scope     = issueText || eventScope;
  // Show the calendar block too when it says something the issue does not —
  // gate codes and access notes often live only there.
  const extraFromEvent = issueText && eventScope && eventScope !== issueText ? eventScope : '';

  // Same five destinations as the board and My Tasks, in the words a tech
  // would use. The labels used to be this sheet's own invention — "Needs
  // estimate" here, "Estimates" on the board, "Won" in the mover — so the same
  // move had three names depending on which screen you were standing in.
  // `means` is the question the tech is actually answering.
  const DISPOS = [
    { key: 'bill_it',     label: '✅ Done — To Bill',     accent: '#166534', tint: '#f0fdf4',
      means: 'Finished. Hours go to Billing.' },
    { key: 'return',      label: '🔄 Return Visit',       accent: '#d97706', tint: '#fffbeb',
      means: 'Work started — I have to come back. Asks why.' },
    { key: 'in_progress', label: '📅 Still Scheduled',    accent: '#1d4ed8', tint: '#eff6ff',
      means: 'Multi-day job. Not finished, still booked.' },
    { key: 'estimate',    label: '📋 Estimates',          accent: '#7e22ce', tint: '#faf5ff',
      means: 'Scope changed — this needs pricing.' },
    // THE LABEL WAS "📝 New / Notes" — a board lane, not an outcome.
    // A tech scanning five buttons reads the LABELS; `means` is small print
    // underneath. Nobody hunting for "I drove out and nobody was there" is
    // going to pick "New / Notes", and nobody ever did: zero rows in 307 time
    // entries since it shipped. The button existed and the option did not.
    //
    // Named for what happened, and the billing consequence is on the face of
    // it, because that is the part a tech would otherwise assume is lost.
    { key: 'blocked',     label: "🚫 Couldn't do it",     accent: '#b91c1c', tint: '#fef2f2',
      means: 'Nobody there, no access, wrong parts. The trip still bills.' },
  ];

  // ── The actual form content (customer + time + notes + materials + buttons) ──
  const formContent = (
    <>
      {/* CUSTOMER — always at the top.
          When no customer is linked, CustomerLookup shows a yellow search panel
          so the tech can pick one before doing anything else. When linked, it
          shows a green card with the customer's name, phone, recent visits and a
          "Change customer" button. The old separate "not linked" warning banner
          is gone — the CustomerLookup panel itself communicates both states. */}
      <CustomerLookup
        event={event}
        accessToken={accessToken}
        value={linkedCustomer}
        onChange={setLinkedCust}
      />
      {/* View full history — only shown when customer is known */}
      {linkedCustomer?.id && (
        <button
          onClick={() => navigate(`/customers?customerId=${linkedCustomer.id}`)}
          style={{
            display: 'block', width: '100%', textAlign: 'center',
            padding: '8px 0', marginTop: -8, marginBottom: 12,
            background: 'none', border: 'none',
            color: '#16a34a', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          View full client history →
        </button>
      )}

      {/* WHO TO ASK FOR. On-site contact and access, from migration 047. These
          were three lines of prose inside `issue` until 9.82.0, so a tech
          hunting for a phone number had to read a form skeleton to find it —
          and on most cards it wasn't filled in at all. Rendered only when
          somebody actually recorded something. */}
      {(linkedJob?.site_contact_name || linkedJob?.site_contact_phone ||
        linkedJob?.access_permission === true || linkedJob?.access_permission === false) && (
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:12,
                      padding:'10px 12px', marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#1e40af', textTransform:'uppercase',
                        letterSpacing:0.5, marginBottom:6 }}>
            👤 On site
          </div>
          {linkedJob.site_contact_name && (
            <div style={{ fontSize:14, color:'#1e3a8a', fontWeight:600 }}>{linkedJob.site_contact_name}</div>
          )}
          {linkedJob.site_contact_phone && (
            <a href={`tel:${String(linkedJob.site_contact_phone).replace(/[^0-9+]/g, '')}`}
               style={{ fontSize:14, color:'#2563eb', fontWeight:700, textDecoration:'none' }}>
              📱 {linkedJob.site_contact_phone}
            </a>
          )}
          {linkedJob.access_permission === true && (
            <div style={{ fontSize:13, color:'#166534', marginTop:4 }}>🔓 May enter without the client present</div>
          )}
          {linkedJob.access_permission === false && (
            <div style={{ fontSize:13, color:'#b45309', marginTop:4 }}>🔒 Client must be present</div>
          )}

          {/* THE TEXT BUTTONS BELONG HERE MOST OF ALL. This sheet is what a
              tech has open while standing at the door — running late, can't get
              in, nobody home. Until now the only way to text from Overwatch was
              a control buried in the office-side job card, which a tech in the
              field never opens. A tel: link was the whole toolkit.
              Both numbers get a button because they are two different people. */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
            <TextButton
              to={linkedJob.site_contact_phone}
              name={linkedJob.site_contact_name || 'on-site contact'}
              accessToken={accessToken}
              templates={clientTemplates({ when: event?.start, scheduledDate: linkedJob.scheduled_date })}
              logTo={{ jobId: linkedJob.id, customerId: linkedJob.customer_id, userEmail }}
            />
            <TextButton
              to={linkedJob.customer_phone}
              name={linkedJob.customer_name || 'the client'}
              accessToken={accessToken}
              templates={clientTemplates({ when: event?.start, scheduledDate: linkedJob.scheduled_date })}
              logTo={{ jobId: linkedJob.id, customerId: linkedJob.customer_id, userEmail }}
            />
          </div>
        </div>
      )}

      {/* AND WHEN THERE IS NO ON-SITE CONTACT, the client's number still has to
          be reachable. The block above only renders when site contact or access
          was recorded, which is most jobs — so without this the tech has a
          phone number on the card and no way to text it. */}
      {!(linkedJob?.site_contact_name || linkedJob?.site_contact_phone ||
         linkedJob?.access_permission === true || linkedJob?.access_permission === false)
        && linkedJob?.customer_phone && (
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                      background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:12,
                      padding:'10px 12px', marginBottom:12 }}>
          <a href={`tel:${String(linkedJob.customer_phone).replace(/[^0-9+]/g, '')}`}
             style={{ fontSize:14, color:'#2563eb', fontWeight:700, textDecoration:'none' }}>
            📞 {linkedJob.customer_phone}
          </a>
          <TextButton
            to={linkedJob.customer_phone}
            name={linkedJob.customer_name || 'the client'}
            accessToken={accessToken}
            templates={clientTemplates({ when: event?.start, scheduledDate: linkedJob.scheduled_date })}
            logTo={{ jobId: linkedJob.id, customerId: linkedJob.customer_id, userEmail }}
            style={{ marginLeft: 'auto' }}
          />
        </div>
      )}

      {/* WHAT WAS ALREADY SAID. Prior notes on this job — office notes, status
          history and earlier field notes, all via notesApi.getAllForJob. Until
          now these were readable in exactly one screen, so a tech walked in
          without the last three things anybody wrote about the job. Newest
          first, capped at four so it informs without burying the form. */}
      {jobNotes.length > 0 && (
        <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12,
                      padding:'10px 12px', marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase',
                        letterSpacing:0.5, marginBottom:6 }}>
            🗒 History {jobNotes.length > 4 ? `(latest 4 of ${jobNotes.length})` : ''}
          </div>
          {jobNotes.slice(0, 4).map(n => (
            <div key={n.id} style={{ fontSize:13, color:'#334155', lineHeight:1.45,
                                     paddingBottom:6, marginBottom:6,
                                     borderBottom:'1px solid #eef2f6' }}>
              <div style={{ fontSize:10.5, color:'#94a3b8', fontWeight:700 }}>
                {n.created_by || 'Someone'}
                {n.created_at ? ` · ${new Date(n.created_at).toLocaleDateString('en-US',
                  { month:'short', day:'numeric' })}` : ''}
                {n.to_status ? ` · ${n.to_status}` : ''}
              </div>
              <div style={{ whiteSpace:'pre-wrap' }}>{String(n.text || '').slice(0, 240)}</div>
            </div>
          ))}
        </div>
      )}

      {/* SCOPE OF WORK — the hero. Full text, no truncation, no "Show more". */}
      {scope && (
        <div style={scopeBox}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
            📋 Scope of work
          </div>
          <div style={{ fontSize: 14, color: '#1e3a8a', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {scope}
          </div>
          {/* Access details and gate codes often live only on the calendar
              event, so show that block too when it says something the issue
              does not. */}
          {extraFromEvent && (
            <div style={{ fontSize: 12.5, color: '#3b5aa0', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                          marginTop: 8, paddingTop: 8, borderTop: '1px solid #bfdbfe' }}>
              {extraFromEvent}
            </div>
          )}
        </div>
      )}

      {/* HOW DID IT END — moved ABOVE notes. Pick first, then write. */}
      {mode === 'full' && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: selectedDispo ? '#16a34a' : '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            How did it end? {selectedDispo ? '✓' : '— required'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 10 }}>
            {DISPOS.map(d => {
              const on = selectedDispo === d.key;
              return (
                <button key={d.key}
                  onClick={() => { setSelectedDispo(d.key); setError(''); if (d.key !== 'return') setReturnReason(''); }}
                  style={{
                    padding: '13px 8px', borderRadius: 12, cursor: 'pointer',
                    background: on ? d.tint : '#ffffff',
                    border: on ? `2px solid ${d.accent}` : '1.5px solid #e5e7eb',
                    color: on ? d.accent : '#475569',
                    fontSize: 14, fontWeight: on ? 800 : 600, textAlign: 'left',
                  }}>
                  <span style={{ display: 'block' }}>{d.label}</span>
                  {/* The question the tech is answering, in their words. A label
                      alone made them guess which button meant "couldn't get in". */}
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 500,
                                 color: on ? d.accent : '#94a3b8', marginTop: 3, lineHeight: 1.3 }}>
                    {d.means}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Return reason — only when Return is the pick */}
          {needsReason && (
            <div style={{ background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 12, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Why is a return visit needed?
              </div>
              <textarea
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                placeholder="Missing part, customer not home, needs follow-up…"
                autoFocus
                style={{
                  width: '100%', padding: 8, fontSize: 15, color: '#1B2A4A',
                  background: '#ffffff', border: '1px solid #fcd34d', borderRadius: 8,
                  resize: 'none', height: 54, boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />
            </div>
          )}
        </>
      )}

      {/* Notes (required — blocks finish until filled) */}
      <div style={{ fontSize: 11, fontWeight: 700, color: notesValid ? '#16a34a' : '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        📝 Notes — required {notesValid ? '✓' : ''}
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="What was done / what's needed — required to finish"
        style={{ ...textareaStyle, background: notesValid ? '#f9fafb' : '#fef2f2', border: `1.5px solid ${notesValid ? '#e5e7eb' : '#fca5a5'}` }}
      />

      {/* Photos — TWO doors, because there are two real cases.
          A single input with capture="environment" jumped straight to the rear
          camera and gave no way to attach a picture already on the phone: a
          shot taken before the sheet was open, something the customer sent, a
          screenshot of a panel code. That is a common case and it was
          unreachable.
          Dropping `capture` entirely would fix it and break the other one — a
          tech standing in front of the panel would get a file browser instead
          of a camera. So: two buttons, one input each, same handler.
          The pictures go with the visit, so they are still findable when the
          invoice is queried in November. */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 6px' }}>
        📷 Photos {photos.length ? `(${photos.length})` : ''}
      </div>

      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
          {photos.map((u, i) => (
            <div key={u} style={{ position: 'relative' }}>
              <img src={u} alt="" style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <button
                onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                aria-label="Remove photo"
                style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11,
                         border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 800,
                         lineHeight: '20px', cursor: 'pointer', padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <label
          style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 10,
                   border: '1.5px dashed #93c5fd', background: '#eff6ff', color: '#2563eb',
                   fontSize: 14, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Uploading…' : '📷 Take photo'}
          {/* capture= keeps the one-tap path to the rear camera for a tech
              standing in front of the work. */}
          <input type="file" accept="image/*" capture="environment" multiple
            disabled={uploading}
            onChange={e => { addPhotos(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }} />
        </label>

        <label
          style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 10,
                   border: '1.5px dashed #93c5fd', background: '#eff6ff', color: '#2563eb',
                   fontSize: 14, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Uploading…' : '🖼 Choose photo'}
          {/* NO capture attribute — this is what opens the phone's library and
              file browser, for a picture that already exists. */}
          <input type="file" accept="image/*" multiple
            disabled={uploading}
            onChange={e => { addPhotos(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }} />
        </label>
      </div>

      {photoErr && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: -8, marginBottom: 12 }}>{photoErr}</div>
      )}

      {/* Materials */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        🔧 Materials
      </div>
      <textarea
        value={materials}
        onChange={e => setMaterials(e.target.value)}
        placeholder="Parts, supplies, equipment used or needed..."
        style={{ ...textareaStyle, background: '#fffbeb', border: '1px solid #fcd34d', height: 56 }}
      />

      {/* Time entry */}
      <TimeEntryBlock
        value={timeEntry}
        onChange={setTimeEntry}
        eventDate={eventDate}
        required={false}
      />

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

      {/* Single commit button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        <button onClick={handleFinish} disabled={!readyToFinish} style={btnFinish(readyToFinish)}>
          {acting ? 'Saving…'
            : !effectiveDispo ? 'Pick an outcome above'
            : eventInFuture && !futureOk ? "This visit hasn't happened yet"
            : !notesValid ? 'Add notes to finish'
            : needsReason && !reasonOk ? 'Add a return reason'
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
const btnFinish = (on) => ({
  padding: 16, background: on ? '#1B2A4A' : '#cbd5e1', border: 'none',
  borderRadius: 12, color: '#ffffff', fontSize: 16, fontWeight: 800,
  cursor: on ? 'pointer' : 'not-allowed',
});
