// ============================================
// Visual Scheduler — pick a tech + time by seeing real availability
// ============================================
// Drop-in replacement for SchedulerModal.jsx: same props (job, techs,
// accessToken, onScheduled, onClose), so swapping it in BoardView is a
// one-line change. Internally shows the color-graded 14-day grid (green =
// wide open, yellow = partial, red = tight, dark red = full) per tech --
// tap a day, tap a free slot, confirm. Unlike Queue.jsx's original version
// (calendar-only, hardcoded to Austin/JR, tags everything [RETURN]), this:
//   - works for any tech passed in (not hardcoded names)
//   - actually updates the job's status/scheduled_date/tech in Supabase
//   - uses the shared buildEventDescription/createEventOnCalendar from
//     calendarSync.js, so the CUSTOMER_ID stamp + deep link + real notes
//     carry over correctly (the fix from earlier tonight)

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { buildEventTitle, buildEventDescription, getLatestNote, createEventOnCalendar } from '../services/calendarSync.js';
import { CALENDARS } from '../config/calendars.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';
// Six weeks, not two. Two weeks couldn't hold a job that needed a slot in
// September, which is exactly the conversation Shana was having about a key fob.
const DAYS_AHEAD = 42;

// LOCAL date string (YYYY-MM-DD) — never toISOString(), which is UTC and
// rolls to the wrong day after ~6pm Denver time. This was the root cause
// of events landing on the wrong day / wrong timezone.
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
// Parse "YYYY-MM-DD" as LOCAL midnight (new Date("YYYY-MM-DD") parses as UTC — wrong).
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Which local day does a calendar event fall on? All-day events carry a bare
// date string — use it directly (parsing it would shift a day).
function eventLocalDay(ev) {
  if (ev.start?.date && !ev.start?.dateTime) return ev.start.date;
  return localDateStr(new Date(ev.start?.dateTime));
}
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

function colorFor(freeHours, isWeekend) {
  if (isWeekend) return '#1e293b';
  if (freeHours <= 0) return '#dc2626';       // Full
  if (freeHours < 2) return '#ef4444';        // Tight
  if (freeHours < 5) return '#eab308';        // Partial
  return '#22c55e';                            // Wide open
}

function labelFor(freeHours, isWeekend) {
  if (isWeekend) return '';
  if (freeHours <= 0) return 'Full';
  if (freeHours < 2) return 'Tight';
  if (freeHours < 5) return 'Partial';
  return 'Wide open';
}

export default function VisualSchedulerModal({ job, techs, accessToken, onClose, onScheduled }) {
  const [availability, setAvailability] = useState({}); // techId -> [{date, day, dayNum, month, freeHours, freeSlots, isWeekend}]
  const [loading, setLoading] = useState(true);
  const [selectedTechId, setSelectedTechId] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null); // { techId, dayData }
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [holdStart, setHoldStart] = useState('09:00');
  const [holdEnd, setHoldEnd]     = useState('17:00');
  // Which tech's calendar is OPEN. Every tech's six-week grid used to render
  // stacked — six people × 42 days is a wall of squares you have to scroll past
  // to reach the buttons. Pick a person, then see their calendar.
  const [openTech, setOpenTech] = useState(null);

  const validTechs = (techs || []).filter(t => t.calendar_id);

  const loadAvailability = useCallback(async () => {
    if (!accessToken || validTechs.length === 0) { setLoading(false); return; }
    setLoading(true);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const endDate = new Date(today); endDate.setDate(endDate.getDate() + DAYS_AHEAD);
    const result = {};

    await Promise.all(validTechs.map(async (tech) => {
      result[tech.id] = [];
      try {
        const params = new URLSearchParams({
          timeMin: today.toISOString(), timeMax: endDate.toISOString(),
          singleEvents: 'true', orderBy: 'startTime', maxResults: '150',
        });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(tech.calendar_id)}/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = res.ok ? await res.json() : { items: [] };
        const items = (data.items || []).filter(ev => ev.status !== 'cancelled');

        for (let d = 0; d < DAYS_AHEAD; d++) {
          const day = new Date(today); day.setDate(day.getDate() + d);
          const dayStr = localDateStr(day);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          const dayEvents = items.filter(ev => eventLocalDay(ev) === dayStr);

          const workStart = new Date(day); workStart.setHours(WORK_START_HOUR, 0, 0, 0);
          const workEnd = new Date(day); workEnd.setHours(WORK_END_HOUR, 0, 0, 0);

          // Titles were being thrown away here and only the arithmetic kept —
          // so the grid could say "3h free" without ever showing WHAT the other
          // five hours were. You can't judge whether to bump something you
          // can't see.
          const busy = dayEvents.map(ev => ({
            start: new Date(ev.start?.dateTime || ev.start?.date),
            end: new Date(ev.end?.dateTime || ev.end?.date),
            title: ev.summary || '(untitled)',
            allDay: !ev.start?.dateTime,
            eventId: ev.id,
          })).sort((a, b) => a.start - b.start);

          let bookedHours = 0;
          const freeSlots = [];
          let cursor = workStart;
          busy.forEach(b => {
            bookedHours += Math.max(0, (b.end - b.start) / 3600000);
            if (b.start > cursor) {
              const dur = (b.start - cursor) / 3600000;
              if (dur >= 0.5) freeSlots.push({ start: new Date(cursor), end: new Date(b.start), hours: dur });
            }
            if (b.end > cursor) cursor = new Date(b.end);
          });
          if (cursor < workEnd) {
            const dur = (workEnd - cursor) / 3600000;
            if (dur >= 0.5) freeSlots.push({ start: new Date(cursor), end: new Date(workEnd), hours: dur });
          }
          const freeHours = Math.max(0, WORK_END_HOUR - WORK_START_HOUR - bookedHours);

          result[tech.id].push({
            date: dayStr,
            day: day.toLocaleDateString('en-US', { weekday: 'short' }),
            dayNum: day.getDate(),
            month: day.toLocaleDateString('en-US', { month: 'short' }),
            freeHours, freeSlots, isWeekend, busy,
          });
        }
      } catch (e) { console.warn('Availability fetch failed for', tech.name, e.message); }
    }));

    setAvailability(result);
    setLoading(false);
  }, [accessToken, JSON.stringify(validTechs.map(t => t.id))]);

  useEffect(() => { loadAvailability(); }, [loadAvailability]);

  // ── Suggested slot ────────────────────────────────────────────────
  // No new API calls — this reads the SAME availability grid already loaded
  // above and picks the best (tech, day, slot) against three existing rules:
  //   1. Enough room. Needs `estimated_hours` (fallback 4h) of contiguous free time.
  //   2. Monday-install policy. Installs get scheduled Mondays; applied BEFORE
  //      slot selection, not as an after-the-fact correction.
  //   3. Soonest wins, then whoever has the most room left that day (so we
  //      don't wedge a job into a tech's last open hour).
  // The suggestion never books anything. "Use this" pre-fills the manual
  // picker below, exactly as if Shana had tapped the day and slot herself.
  const isInstall = /install/i.test(`${job.job_type || ''} ${job.issue || ''}`);
  const needHours = Number(job.estimated_hours) > 0 ? Number(job.estimated_hours) : 4;

  const suggestion = useMemo(() => {
    let best = null;
    validTechs.forEach(tech => {
      (availability[tech.id] || []).forEach(d => {
        if (d.isWeekend) return;
        if (isInstall && d.day !== 'Mon') return;
        const slot = d.freeSlots.filter(s => s.hours >= needHours).sort((a, b) => b.hours - a.hours)[0];
        if (!slot) return;
        const cand = { tech, day: d, slot };
        if (!best) { best = cand; return; }
        if (d.date < best.day.date) { best = cand; return; }
        if (d.date === best.day.date && d.freeHours > best.day.freeHours) best = cand;
      });
    });
    return best;
  }, [availability, isInstall, needHours, JSON.stringify(validTechs.map(t => t.id))]);

  const pickSlot = (techId, dayData, slot) => {
    // Picking a slot pre-fills the hold hours as well, so holding "that gap"
    // is one tap rather than retyping times you already chose.
    if (slot?.start && slot?.end) {
      const two = n => String(n).padStart(2, '0');
      setHoldStart(`${two(slot.start.getHours())}:${two(slot.start.getMinutes())}`);
      setHoldEnd(`${two(slot.end.getHours())}:${two(slot.end.getMinutes())}`);
    }
    setSelectedTechId(techId);
    // Always carry techId — the event list resolves the tech name from it.
    setSelectedDay({ ...dayData, techId });
    setSelectedSlot(slot);
    const defStart = new Date(slot.start);
    const defEnd = new Date(Math.min(slot.end.getTime(), slot.start.getTime() + 2 * 3600000));
    setStartTime(`${String(defStart.getHours()).padStart(2,'0')}:${String(defStart.getMinutes()).padStart(2,'0')}`);
    setEndTime(`${String(defEnd.getHours()).padStart(2,'0')}:${String(defEnd.getMinutes()).padStart(2,'0')}`);
  };

  // What's still missing, in the order the user fills it in. Drives both the
  // disabled state and the hint text.
  const missing = !selectedTechId ? 'Pick a tech'
                : !selectedDay    ? 'Pick a day'
                : (!holdStart || !holdEnd) ? 'Set a time range'
                : null;

  // ── Hold tentatively ────────────────────────────────────────────────
  // Same grid, same free-hours colours, different commitment. Previously this
  // lived in a separate TentPicker with a bare date box and no day view — so
  // "schedule" meant two different things depending on which button you found,
  // and the tentative one threw away the availability picture entirely.
  //
  // A hold books NOTHING on a tech's calendar. It writes a "Holding <customer>"
  // event to the Tent calendar (the team's existing convention) and stamps
  // jobs.tentative_date so the board can show it in its own column.
  // ── Link an event that already exists ───────────────────────────────
  // The other legitimate way a job becomes scheduled: somebody already put it
  // on a calendar by hand. Forcing them to re-book it would create a duplicate
  // event, which is the same disease as the 12 orphans on the home screen —
  // work on a calendar with no job behind it, or now, two events for one job.
  const linkExisting = async (ev, cal) => {
    setSaving(true); setErr('');
    try {
      const start = new Date(ev.start?.dateTime || ev.start?.date);
      const { error } = await supabase.from('jobs').update({
        status: 'scheduled',
        scheduled_date: localDateStr(start),
        scheduled_event_id: ev.id,
        scheduled_calendar_id: cal.id,
        tech_name: cal.name || null,
        tentative_date: null,
        tentative_event_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;
      onScheduled();
    } catch (e) { setErr(e.message || 'Could not link'); }
    setSaving(false);
  };

  const holdTentative = async () => {
    if (!selectedDay) { setErr('Pick a day to hold'); return; }
    setSaving(true); setErr('');
    try {
      const [hsH, hsM] = (holdStart || '09:00').split(':').map(Number);
      const [heH, heM] = (holdEnd || '17:00').split(':').map(Number);
      const start = parseLocalDate(selectedDay.date); start.setHours(hsH, hsM, 0, 0);
      const end   = parseLocalDate(selectedDay.date); end.setHours(heH, heM, 0, 0);
      if (end <= start) { setErr('Hold end must be after the start'); setSaving(false); return; }

      let eventId = null;
      try {
        const created = await createEventOnCalendar(accessToken, CALENDARS.TENTATIVELY_SCHEDULED, {
          title: `Holding ${job.customer_name || 'job'}`,
          description: `Tentative hold placed in Overwatch. No tech booked.`,
          location: job.customer_address || '',
          startTime: start, endTime: end,
        });
        if (created?.id) eventId = created.id;
      } catch (e) { console.warn('Tent event create failed (non-fatal)', e); }

      const { error } = await supabase.from('jobs').update({
        tentative_date: start.toISOString(),
        tentative_event_id: eventId,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;

      onScheduled();
    } catch (e) { setErr(e.message || 'Could not hold'); }
    setSaving(false);
  };

  const confirm = async () => {
    // This used to be a bare `return`. Pick a tech, pick a day, forget the time
    // slot, and the button did NOTHING — no error, no toast, no disabled state.
    // Shana lost a Rick Ferreri booking to it and reasonably concluded the app
    // was broken. Silence is the worst possible failure mode for a save button.
    if (missing) { setErr(missing); return; }
    if (!selectedTechId) { setErr('Pick a tech before booking'); return; }
    const tech = validTechs.find(t => t.id === selectedTechId);
    if (!tech) return;

    // Times come from the one time-range control in the decide panel now.
    const [sh, sm] = (holdStart || startTime || '09:00').split(':').map(Number);
    const [eh, em] = (holdEnd || endTime || '17:00').split(':').map(Number);
    // parseLocalDate: "YYYY-MM-DD" as LOCAL midnight, not UTC — this was
    // the wrong-day bug.
    const start = parseLocalDate(selectedDay.date); start.setHours(sh, sm, 0, 0);
    const end = parseLocalDate(selectedDay.date); end.setHours(eh, em, 0, 0);
    if (end <= start) { setErr('End time must be after start time'); return; }

    setSaving(true); setErr('');
    try {
      const { error: dbErr } = await supabase.from('jobs').update({
        status: 'scheduled',
        scheduled_date: selectedDay.date,
        tech_assigned: tech.id,
        tech_name: tech.name || '',
        // A real booking supersedes the pencil mark. Leaving both would show a
        // card that is scheduled AND tentatively held, which reads as a conflict.
        tentative_date: null,
        tentative_event_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (dbErr) throw dbErr;

      // RESCHEDULE: if a previous scheduling created a tech-calendar event,
      // delete it first so we don't leave a ghost booking behind.
      if (job.scheduled_event_id && job.scheduled_calendar_id) {
        try {
          await fetch(
            `${GCAL}/calendars/${encodeURIComponent(job.scheduled_calendar_id)}/events/${encodeURIComponent(job.scheduled_event_id)}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch (e) { console.warn('Old scheduled event delete failed (non-fatal):', e.message); }
      }

      const latestNote = await getLatestNote(job.id);
      const created = await createEventOnCalendar(accessToken, tech.calendar_id, {
        title: buildEventTitle(job),
        description: buildEventDescription(job, latestNote),
        location: job.customer_address,
        startTime: start,
        endTime: end,
      });

      // Remember which event we created so this job can be RESCHEDULED later.
      // Separate try — if the columns don't exist yet (migration 021 not run),
      // scheduling still succeeds, we just can't clean up on reschedule.
      if (created?.id) {
        const { error: memErr } = await supabase.from('jobs').update({
          scheduled_event_id: created.id,
          scheduled_calendar_id: tech.calendar_id,
        }).eq('id', job.id);
        if (memErr) console.warn('Could not store scheduled event id (run migration 021):', memErr.message);
      }

      // Tag the job's ORIGINAL source event (if any) as [SCHEDULED] --
      // this is the same tag Queue.jsx's own exclusion list already checks
      // for, so this job correctly disappears from Queue's Triage and
      // Schedule tabs instead of sitting there stale while a second,
      // duplicate event now exists on the tech's calendar.
      if (job.calendar_event_id && job.calendar_id) {
        try {
          const evRes = await fetch(
            `${GCAL}/calendars/${encodeURIComponent(job.calendar_id)}/events/${encodeURIComponent(job.calendar_event_id)}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (evRes.ok) {
            const original = await evRes.json();
            if (!/\[SCHEDULED\]/i.test(original.summary || '')) {
              await fetch(
                `${GCAL}/calendars/${encodeURIComponent(job.calendar_id)}/events/${encodeURIComponent(job.calendar_event_id)}`,
                {
                  method: 'PATCH',
                  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ summary: `[SCHEDULED] ${original.summary || ''}` }),
                }
              );
            }
          }
        } catch (e) { console.warn('Could not tag original event as scheduled (non-fatal):', e.message); }
      }

      onScheduled();
    } catch (e) { setErr(e.message || 'Failed to schedule'); }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#1e293b', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 640, padding: '20px 20px 32px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ color: '#fff', fontSize: 17, fontWeight: 700 }}>📅 Schedule</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>{job.customer_name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: 30 }}>Loading availability…</div>
        ) : validTechs.length === 0 ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: 30 }}>No techs with a calendar configured.</div>
        ) : (
          <>
            {suggestion && (
              <div style={{ background: '#0f172a', border: '1px solid #00c8e855', borderRadius: 12, padding: 12, marginBottom: 14 }}>
                <div style={{ color: '#00c8e8', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Suggested slot
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>
                      {suggestion.tech.name} — {suggestion.day.day} {suggestion.day.month} {suggestion.day.dayNum}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                      {suggestion.slot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – {suggestion.slot.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {' · '}{suggestion.day.freeHours.toFixed(0)}h open that day
                      {isInstall && ' · install → Monday'}
                    </div>
                  </div>
                  <button
                    onClick={() => pickSlot(suggestion.tech.id, { ...suggestion.day, techId: suggestion.tech.id }, suggestion.slot)}
                    style={{ background: '#00c8e8', color: '#0f1729', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    Use this
                  </button>
                </div>
              </div>
            )}

            <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 10 }}>
              {suggestion ? 'Or pick someone else — tap a name to open their calendar.' : 'Tap a name to open their calendar.'}
            </div>

            {/* WHO FIRST. Each row summarises the next day they have real room,
                so choosing doesn't require reading six grids. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {validTechs.map(tech => {
                const days = availability[tech.id] || [];
                const next = days.find(d => !d.isWeekend && d.freeHours >= 4);
                const isOpen = openTech === tech.id;
                return (
                  <button key={tech.id}
                    onClick={() => { setOpenTech(isOpen ? null : tech.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                             background: isOpen ? '#132741' : '#0f172a',
                             border: `1px solid ${isOpen ? '#00c8e8' : '#243a56'}`,
                             borderRadius: 10, padding: '11px 13px', cursor: 'pointer',
                             color: '#e2e8f0', fontFamily: 'inherit' }}>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{tech.name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#8497b0', marginTop: 2 }}>
                        {next
                          ? `next clear day ${next.day} ${next.month} ${next.dayNum} · ${next.freeHours.toFixed(0)}h`
                          : 'nothing clear in the next 6 weeks'}
                      </span>
                    </span>
                    <span style={{ color: '#4a5f7a', fontSize: 16 }}>{isOpen ? '▾' : '›'}</span>
                  </button>
                );
              })}
            </div>

            {validTechs.filter(t => t.id === openTech).map(tech => (
              <div key={tech.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                  {(availability[tech.id] || []).map(d => (
                    <button
                      key={d.date}
                      disabled={d.isWeekend}
                      onClick={() => setSelectedDay(prev => prev?.date === d.date && prev?.techId === tech.id ? null : { ...d, techId: tech.id })}
                      style={{
                        background: colorFor(d.freeHours, d.isWeekend), border: 'none', borderRadius: 8,
                        padding: '8px 4px', cursor: d.isWeekend ? 'default' : 'pointer',
                        opacity: d.isWeekend ? 0.35 : 1, color: '#fff', textAlign: 'center',
                        outline: selectedDay?.date === d.date && selectedDay?.techId === tech.id ? '2px solid #00c8e8' : 'none',
                      }}>
                      <div style={{ fontSize: 10, opacity: 0.85 }}>{d.day}</div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{d.dayNum}</div>
                      {!d.isWeekend && <div style={{ fontSize: 9 }}>{d.freeHours.toFixed(0)}h</div>}
                    </button>
                  ))}
                </div>

                {selectedDay?.techId === tech.id && (
                  <div style={{ marginTop: 8, background: '#0f172a', borderRadius: 8, padding: 10 }}>
                    <div style={{ color: '#cbd5e1', fontSize: 11, marginBottom: 6 }}>
                      {selectedDay.day} {selectedDay.month} {selectedDay.dayNum} — {labelFor(selectedDay.freeHours, false)}
                    </div>
                    {selectedDay.freeSlots.length === 0 ? (
                      <div style={{ color: '#cbd5e1', fontSize: 12 }}>No open slots this day.</div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {selectedDay.freeSlots.map((slot, i) => (
                          <button key={i} onClick={() => pickSlot(tech.id, selectedDay, slot)}
                            style={{
                              background: selectedSlot === slot ? '#00c8e8' : '#1e293b',
                              color: selectedSlot === slot ? '#0f1729' : '#e2e8f0',
                              border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                            }}>
                            {slot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – {slot.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ({slot.hours.toFixed(1)}h)
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 6, marginBottom: 14, fontSize: 11, color: '#94a3b8' }}>
              <span>🟢 Wide open</span><span>🟡 Partial</span><span>🔴 Tight</span><span style={{ opacity: 0.7 }}>⬛ Full</span>
            </div>

            {selectedSlot && (
              <div style={{ background: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ color: '#cbd5e1', fontSize: 11, marginBottom: 6 }}>Confirm time</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 13 }} />
                  <span style={{ color: '#cbd5e1' }}>to</span>
                  <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                    style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 13 }} />
                </div>
              </div>
            )}

            {err && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10 }}>{err}</div>}

            {/* Hold — available as soon as a DAY is picked, because a hold is a
                day-level commitment. It doesn't need a tech or a slot. */}
            {/* WHAT'S ALREADY ON THAT DAY. The grid gave a free-hours number and
                nothing else, so you could see "3h free" without ever seeing what
                the other five hours were — and you can't decide whether to bump
                something you can't read. */}
            {selectedDay && (selectedDay.busy || []).length > 0 && (
              <div style={{ background: '#0f1729', border: '1px solid #2a3f5c', borderRadius: 10,
                            padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#8497b0', textTransform: 'uppercase',
                              letterSpacing: 0.5, marginBottom: 6 }}>
                  Already on {validTechs.find(t => t.id === selectedDay.techId)?.name}'s calendar
                </div>
                {(selectedDay.busy || []).map((b, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0' }}>
                    <span style={{ color: '#64748b', minWidth: 96, flexShrink: 0 }}>
                      {b.allDay ? 'all day' :
                        `${b.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}–${b.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                    </span>
                    <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis',
                                   whiteSpace: 'nowrap' }}>{b.title}</span>
                  </div>
                ))}
              </div>
            )}

            {/* LINK, don't duplicate. If one of the events already on that day
                IS this job, say so instead of booking a second one. */}
            {selectedDay && (selectedDay.busy || []).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#8497b0', textTransform: 'uppercase',
                              letterSpacing: 0.5, marginBottom: 6 }}>
                  Already booked by hand? Link it instead of making a second event
                </div>
                {(selectedDay.busy || []).map((b, i) => b.eventId ? (
                  <button key={i} disabled={saving}
                    onClick={() => linkExisting(
                      { id: b.eventId, start: { dateTime: b.start.toISOString() } },
                      { id: validTechs.find(t => t.id === selectedDay.techId)?.calendar_id,
                        name: validTechs.find(t => t.id === selectedDay.techId)?.name })}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                             border: '1px solid #2a3f5c', borderRadius: 8, color: '#cbd5e1',
                             padding: '7px 10px', fontSize: 12, cursor: 'pointer', marginBottom: 5 }}>
                    🔗 This job is “{b.title}”
                  </button>
                ) : null)}
              </div>
            )}

            {/* ── DECIDE ────────────────────────────────────────────────
                One panel, one summary line, two clearly different outcomes.
                Before this, Hold and Confirm were separate blocks with their
                own headings and time inputs, and it wasn't obvious that one
                books a person and the other doesn't. */}
            {selectedDay && (
              <div style={{ background: '#0f172a', border: '1px solid #243a56', borderRadius: 12,
                            padding: 14, marginTop: 4 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>
                  {validTechs.find(t => t.id === selectedDay.techId)?.name} · {selectedDay.day} {selectedDay.month} {selectedDay.dayNum}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 14px' }}>
                  <input type="time" value={holdStart} onChange={e => setHoldStart(e.target.value)}
                    style={{ flex: 1, background: '#0b1420', border: '1px solid #2a3f5c', borderRadius: 8,
                             color: '#e2e8f0', padding: '9px 10px', fontSize: 14, outline: 'none' }} />
                  <span style={{ color: '#64748b', fontSize: 12 }}>to</span>
                  <input type="time" value={holdEnd} onChange={e => setHoldEnd(e.target.value)}
                    style={{ flex: 1, background: '#0b1420', border: '1px solid #2a3f5c', borderRadius: 8,
                             color: '#e2e8f0', padding: '9px 10px', fontSize: 14, outline: 'none' }} />
                </div>

                {err && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10 }}>{err}</div>}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button onClick={holdTentative} disabled={saving}
                    style={{ background: 'transparent', border: '1px solid #f59e0b',
                             borderRadius: 10, color: '#f59e0b', padding: '12px 8px', cursor: 'pointer' }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>✏️ Hold it</span>
                    <span style={{ display: 'block', fontSize: 10, opacity: 0.85, marginTop: 3, lineHeight: 1.3 }}>
                      Pencilled in.<br />Nobody is booked.
                    </span>
                  </button>

                  <button onClick={confirm} disabled={saving || (!selectedTechId || !selectedDay)}
                    style={{ background: '#00c8e8', border: 'none', borderRadius: 10,
                             color: '#08121f', padding: '12px 8px', cursor: 'pointer' }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>✅ Book it</span>
                    <span style={{ display: 'block', fontSize: 10, opacity: 0.8, marginTop: 3, lineHeight: 1.3 }}>
                      Goes on {validTechs.find(t => t.id === selectedDay.techId)?.name}'s<br />calendar now.
                    </span>
                  </button>
                </div>

                {saving && (
                  <div style={{ color: '#8497b0', fontSize: 12, textAlign: 'center', marginTop: 10 }}>Working…</div>
                )}
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
}
