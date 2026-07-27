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

const GCAL = 'https://www.googleapis.com/calendar/v3';
const DAYS_AHEAD = 14;

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

          const busy = dayEvents.map(ev => ({
            start: new Date(ev.start?.dateTime || ev.start?.date),
            end: new Date(ev.end?.dateTime || ev.end?.date),
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
            freeHours, freeSlots, isWeekend,
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
    setSelectedTechId(techId);
    setSelectedDay(dayData);
    setSelectedSlot(slot);
    const defStart = new Date(slot.start);
    const defEnd = new Date(Math.min(slot.end.getTime(), slot.start.getTime() + 2 * 3600000));
    setStartTime(`${String(defStart.getHours()).padStart(2,'0')}:${String(defStart.getMinutes()).padStart(2,'0')}`);
    setEndTime(`${String(defEnd.getHours()).padStart(2,'0')}:${String(defEnd.getMinutes()).padStart(2,'0')}`);
  };

  const confirm = async () => {
    if (!selectedTechId || !selectedDay || !startTime || !endTime) return;
    const tech = validTechs.find(t => t.id === selectedTechId);
    if (!tech) return;

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
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
              {suggestion ? 'Or pick your own — tap a day to see available time slots.' : 'Tap a day to see available time slots.'}
            </div>
            {validTechs.map(tech => (
              <div key={tech.id} style={{ marginBottom: 16 }}>
                <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{tech.name}</div>
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

            <button onClick={confirm} disabled={!selectedSlot || saving}
              style={{
                width: '100%', background: selectedSlot ? '#00c8e8' : '#334155', border: 'none', borderRadius: 10,
                color: selectedSlot ? '#0f1729' : '#64748b', fontWeight: 700, padding: '13px', fontSize: 14,
                cursor: selectedSlot ? 'pointer' : 'default',
              }}>
              {saving ? 'Scheduling…' : selectedSlot ? `✅ Confirm — ${validTechs.find(t=>t.id===selectedTechId)?.name}, ${selectedDay?.day} ${selectedDay?.month} ${selectedDay?.dayNum}` : 'Pick a time slot above'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
