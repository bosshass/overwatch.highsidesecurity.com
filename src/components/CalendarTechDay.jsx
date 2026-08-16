// ============================================
// CalendarTechDay — one day, one column per tech.
// ============================================
// The week grid put every tech into a single day column and told them apart by
// border colour. Two events at the same hour got identical `left` and full
// column width, so the second one rendered underneath the first and could not
// be seen at all. Work that is on the calendar and invisible on the screen is
// worse than work that was never booked.
//
// This is Google Calendar's resource layout: the day across the top, a column
// per person, and overlapping events inside a column split it between them.
// Nothing hides.
//
// The reason to land here rather than on the week grid is utilisation. When a
// column IS a person, a half-empty column reads as spare capacity without
// anyone having to compute anything — which is the question DRH is actually
// asking with one field tech at $80k.
//
// Three numbers per person, not one: CAPACITY (what they have), BOOKED (what
// the calendar committed them to), and LOGGED (what actually became a time
// entry). Booked alone is a promise. The distance between booked and logged is
// the leak — a three-hour event that produced no time entry is three hours that
// will never reach an invoice, and it looks identical to a full day until you
// put the two bars next to each other.
//
// Time entries join on calendar_event_id, which is populated on 100% of rows,
// so no name-matching heuristic decides whose hours these are.
//
// Capacity is per-person and stored in `settings` (key/value, already exists —
// no migration). Eight hours is only the default; a sub who works four and a
// tech who works ten are both real, and measuring both against 8 makes one
// look lazy and the other look heroic.
// ============================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../services/supabase.js';

const CAP_KEY = 'calendar_capacity';
const DEFAULT_CAP = 8;
// Utilisation measures PEOPLE. Tentatively Scheduled, Installations, Service
// Queue, Sales & Accounting and Completed are buckets, not techs — measuring
// them against a 40h week is meaningless and it padded the shop total to 80h.
// Brian is is_active=false and Shana does not carry billable field hours.
const FIELD_TECHS = ['JR', 'Austin', 'Trevor', 'Subs'];

// SUBS ARE NOT SALARIED. There is no fixed number of hours you are paying for,
// so a default capacity of 8/day invented 40h of shop capacity every week and
// inflated the header total — "40 of 70" was Austin's real 30 plus Subs'
// imaginary 40. Their booked hours still show; only the denominator goes.
const NO_CAPACITY = new Set(['Subs']);

const WORKDAYS = 5;   // weekly capacity = daily x this. A holiday week is wrong
                      // by one day and nobody has been misled about anything
                      // important; making it a second setting to maintain is a
                      // worse trade.

const HOUR_PX = 56;      // Google sits near this. 50 was too tight to read a
                         // 30-minute block, which is most of a service call.
const GUTTER  = 46;

const fmtHour = h => h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`;
const hoursOf = e => Math.max((new Date(e.end) - new Date(e.start)) / 3600000, 0);

// ── OVERLAP LAYOUT ──────────────────────────────────────────────────────────
// Sweep the day's events in start order, break them into clusters that touch,
// then hand each event the first free sub-column in its cluster. Every event in
// a cluster is the same width, so a three-way overlap is three visible thirds
// rather than one card with two hidden behind it.
function layout(events) {
  const sorted = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
  const out = [];
  let cluster = [], clusterEnd = null;

  const flush = () => {
    if (!cluster.length) return;
    const cols = [];
    for (const e of cluster) {
      let slot = cols.findIndex(end => new Date(e.start) >= end);
      if (slot === -1) { slot = cols.length; cols.push(new Date(e.end)); }
      else cols[slot] = new Date(e.end);
      e._slot = slot;
    }
    for (const e of cluster) { e._of = cols.length; out.push(e); }
    cluster = []; clusterEnd = null;
  };

  for (const e of sorted) {
    if (clusterEnd && new Date(e.start) >= clusterEnd) flush();
    cluster.push(e);
    const end = new Date(e.end);
    clusterEnd = clusterEnd && clusterEnd > end ? clusterEnd : end;
  }
  flush();
  return out;
}

// ── WEEK GRID ───────────────────────────────────────────────────────────────
// Seven day columns, every selected calendar's events inside them, coloured by
// whose they are. This is what "show me the week" means to somebody looking at
// a schedule — not seven copies of the per-tech utilisation bars.
function WeekGrid({ weekDates, events, calendars, colors, onOpenEvent, logged, now }) {
  const names = new Set(calendars.map(c => c.name));
  const perDay = weekDates.map(d => layout(events.filter(e => {
    if (e.isAllDay || !names.has(e.calendarName)) return false;
    const a = new Date(e.start);
    return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth()
        && a.getDate() === d.getDate();
  })));

  const all = perDay.flat();
  const from = all.length ? Math.max(0, Math.min(...all.map(e => new Date(e.start).getHours()), 7) - 1) : 7;
  const to   = all.length ? Math.min(24, Math.max(...all.map(e => Math.ceil(new Date(e.end).getHours() + new Date(e.end).getMinutes() / 60)), 18) + 1) : 18;
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const isToday = d => new Date().toDateString() === d.toDateString();

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `${GUTTER}px repeat(7, 1fr)`,
                    borderBottom: '1px solid #1e293b', position: 'sticky', top: 0,
                    background: '#0f1729', zIndex: 5 }}>
        <div />
        {weekDates.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', padding: '7px 0 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b' }}>
              {d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
            </div>
            <div style={{ fontSize: 15, fontWeight: 900, marginTop: 2,
                          color: isToday(d) ? '#04121f' : '#e2e8f0',
                          background: isToday(d) ? '#4b8dff' : 'transparent',
                          borderRadius: 7, display: 'inline-block', padding: '1px 7px' }}>
              {d.getDate()}
            </div>
          </div>
        ))}
      </div>

      <div style={{ position: 'relative', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        {hours.map(h => (
          <div key={h} style={{ display: 'grid', gridTemplateColumns: `${GUTTER}px repeat(7, 1fr)`,
                                height: HOUR_PX, borderTop: '1px solid #1e293b' }}>
            <div style={{ fontSize: 10.5, color: '#64748b', textAlign: 'right',
                          paddingRight: 7, marginTop: -6, fontWeight: 600 }}>{fmtHour(h)}</div>
            {weekDates.map((_, i) => <div key={i} style={{ borderLeft: '1px solid #1e293b' }} />)}
          </div>
        ))}

        {perDay.map((evs, di) => evs.map(e => {
          const s2 = new Date(e.start), en = new Date(e.end);
          const top = ((s2.getHours() + s2.getMinutes() / 60) - from) * HOUR_PX;
          const height = Math.max(((en.getHours() + en.getMinutes() / 60) - (s2.getHours() + s2.getMinutes() / 60)) * HOUR_PX - 2, 20);
          const colW = `((100% - ${GUTTER}px) / 7)`;
          const subW = `(${colW} / ${e._of || 1})`;
          const left = `calc(${GUTTER}px + ${di} * ${colW} + ${e._slot || 0} * ${subW} + 2px)`;
          const color = e.color || colors[e.calendarName] || '#6b7280';
          // COMPLETED IS NOT A PROBLEM. Events land on the Completed calendar
          // AFTER the work is billed and closed out, so they are past by
          // definition and carry no time entry — which meant every one of them
          // lit up with the red "no hours" outline. An alarm firing on the one
          // category that is genuinely finished.
          const done = e.calendarName === 'Completed';
          const noHours = !done && !logged[e.id] && en < now;
          return (
            <div key={`${di}-${e.id}`} onClick={() => onOpenEvent?.(e)}
              title={`${e.calendarName} · ${e.summary}`}
              style={{ position: 'absolute', top, left, width: `calc(${subW} - 4px)`, height,
                       background: done ? '#0e1626' : '#16233a',
                       borderLeft: `3px solid ${done ? '#33455f' : color}`,
                       border: `1px solid ${noHours ? '#ff4f5e88' : done ? '#1d2f48' : color + '55'}`,
                       borderRadius: 6, padding: '2px 4px', cursor: 'pointer',
                       overflow: 'hidden', zIndex: 2, opacity: done ? 0.65 : 1 }}>
              {/* Done work recedes. It still shows — that IS the record of
                  visits made and calls run — but it should sit behind the week
                  you still have to work, not compete with it. */}
              <div style={{ color: done ? '#64748b' : color, fontSize: 8.5,
                            fontWeight: 900, lineHeight: 1.1 }}>
                {done ? '✓ done' : e.calendarName}
              </div>
              <div style={{ color: '#e2e8f0', fontSize: 9.5, fontWeight: 700, lineHeight: 1.15,
                            overflow: 'hidden' }}>
                {e.summary || '(untitled)'}
              </div>
            </div>
          );
        }))}
      </div>
    </div>
  );
}

export default function CalendarTechDay({
  date, events = [], calendars = [], onOpenEvent, colors = {}, onNavigate,
  weekDates = null,        // when present, the Week toggle is available
  showUtilization = false, // utilisation lives in the Tasks tab, not on the calendar
  onRangeChange,           // so the header arrows know whether to step a day or a week
  onStepWeek,              // utilisation has no header of its own — see below
  onStepDay,               // ditto for the day view
}) {
  // DAY vs WEEK are two different questions and they want two different
  // pictures. Day answers WHERE things sit — a grid you place work on. Week
  // answers WHETHER THE WEEK IS FULL, and drawing 7 x N columns of time grid
  // to answer that gives you 35 unreadable slivers on a phone.
  //
  // So Week is not a bigger grid. It is the utilisation table: capacity,
  // booked, logged per person for the whole week, with a per-day strip.
  //
  // Weekly is also the honest unit. Austin at 6 billable hours a day reads as
  // a failure on the day he drove to Cheyenne and back, and reads correctly
  // across five days.
  const [range, setRange] = useState('week');   // land on the week — the day is
                                               // a drill-down, not the question
  const [caps, setCaps]       = useState({});
  const [editCap, setEditCap] = useState(false);
  const [savingCap, setSaving] = useState(false);
  const [now, setNow]         = useState(new Date());
  const [logged, setLogged]   = useState({});   // calendar_event_id -> { hrs, billed, billable }

  // The now-line only means anything while you are looking at it.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', CAP_KEY).maybeSingle();
      if (data?.value) { try { setCaps(typeof data.value === 'string' ? JSON.parse(data.value) : data.value); } catch { /* keep defaults */ } }
    })();
  }, []);

  const saveCaps = useCallback(async (next) => {
    setCaps(next); setSaving(true);
    const { error } = await supabase.from('settings')
      .upsert({ key: CAP_KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setSaving(false);
    if (error) console.warn('capacity save failed:', error.message);
  }, []);

  const capFor = name =>
    NO_CAPACITY.has(name) ? 0 : Number(caps?.[name] ?? caps?.default ?? DEFAULT_CAP);

  // What actually got logged against the events on screen. Joined on
  // calendar_event_id — exact, and it survives a tech being renamed.
  const dayEventIds = useMemo(
    () => events.filter(e => !e.isAllDay && e.id).map(e => e.id),
    [events]);

  useEffect(() => {
    if (!dayEventIds.length) { setLogged({}); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('calendar_event_id, total_minutes, billed, billable')
        .in('calendar_event_id', dayEventIds.slice(0, 300))
        .eq('archived', false);
      if (cancelled || error) { if (error) console.warn('time_entries load:', error.message); return; }
      const map = {};
      for (const t of data || []) {
        const k = t.calendar_event_id;
        const m = map[k] || (map[k] = { hrs: 0, billed: 0, nonBillable: 0 });
        const h = (t.total_minutes || 0) / 60;
        m.hrs += h;
        if (t.billed) m.billed += h;
        if (t.billable === false) m.nonBillable += h;
      }
      setLogged(map);
    })();
    return () => { cancelled = true; };
  }, [dayEventIds.join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sameDay = useCallback((d) => {
    const a = new Date(d);
    return a.getFullYear() === date.getFullYear()
        && a.getMonth() === date.getMonth()
        && a.getDate() === date.getDate();
  }, [date]);

  // Per-column events, already laid out.
  const columns = useMemo(() => calendars.map(cal => {
    const mine = events.filter(e =>
      !e.isAllDay && e.calendarName === cal.name && sameDay(e.start));
    const booked = mine.reduce((s, e) => s + hoursOf(e), 0);
    const log    = mine.reduce((acc, e) => {
      const t = logged[e.id];
      if (t) { acc.hrs += t.hrs; acc.billed += t.billed; }
      else if (new Date(e.end) < now) acc.missing += hoursOf(e);   // only PAST work can be missing hours
      return acc;
    }, { hrs: 0, billed: 0, missing: 0 });
    return { cal, events: layout(mine), booked, ...log, cap: capFor(cal.name) };
  }), [calendars, events, sameDay, caps, logged, now]);

  // The visible window follows the work. A fixed 6am–8pm spends half the screen
  // on hours nothing ever happens in.
  const [from, to] = useMemo(() => {
    const all = columns.flatMap(c => c.events);
    if (!all.length) return [7, 18];
    const lo = Math.min(...all.map(e => new Date(e.start).getHours()));
    const hi = Math.max(...all.map(e => Math.ceil(
      new Date(e.end).getHours() + new Date(e.end).getMinutes() / 60)));
    return [Math.max(0, Math.min(lo, 7) - 1), Math.min(24, Math.max(hi, 18) + 1)];
  }, [columns]);

  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const isToday = sameDay(new Date());
  const nowTop  = ((now.getHours() + now.getMinutes() / 60) - from) * HOUR_PX;

  // WEEK ROLL-UP. Same three numbers, wider window. Reuses the per-day maths
  // rather than a second implementation that can disagree with the first.
  const weekCols = useMemo(() => {
    if (!weekDates?.length) return [];
    // Hard-filtered here rather than relying on the calendar checkboxes: those
    // are remembered per user in localStorage, so an old selection kept ten
    // rows on screen long after the default changed.
    // Same trap as the calendar filter: a one-calendar user has none of the
    // four field names, so this emptied and the panel drew nothing.
    const field = calendars.length <= 2
      ? calendars
      : calendars.filter(c => FIELD_TECHS.includes(c.name));
    // If none of the four are present — a tech looking at their own calendar —
    // measure whoever IS here rather than rendering an empty panel.
    return (field.length ? field : calendars).map(cal => {
      const perDay = weekDates.map(d => {
        const mine = events.filter(e => {
          if (e.isAllDay || e.calendarName !== cal.name) return false;
          const a = new Date(e.start);
          return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth()
              && a.getDate() === d.getDate();
        });
        const booked = mine.reduce((s, e) => s + hoursOf(e), 0);
        // NEVER LOGGED ONLY APPLIES TO THE PAST.
        // This counted any booked hour with no time entry as missing, with no
        // check on whether the work had happened yet — so a week that had not
        // started read "39.0h never logged" for hours nobody could possibly
        // have logged. Only an event that has already ENDED can be missing its
        // hours; anything still ahead is simply booked.
        const log = mine.reduce((acc, e) => {
          const t = logged[e.id];
          if (t) acc.hrs += t.hrs;
          else if (new Date(e.end) < now) acc.missing += hoursOf(e);
          return acc;
        }, { hrs: 0, missing: 0 });
        return { date: d, booked, ...log,
                 titles: mine.map(e => (e.summary || '').split('—')[0].trim()).filter(Boolean) };
      });
      // CAPACITY IS ONLY THE DAYS THAT HAVE HAPPENED.
      // This was daily x 5 flat, so on a Wednesday three days of booked hours
      // were divided by a whole week — a tech who is completely full through
      // Wednesday read as 60% and looked like he was coasting. The week is not
      // over; the denominator said it was.
      //
      // Past and future weeks still use all five: a finished week should be
      // judged on the whole thing, and a week you are planning has all of it
      // left to fill.
      //
      // Weekends count in BOOKED but never in capacity. A Saturday call is real
      // hours and it should push the number ABOVE 100% — that is overtime, and
      // it is worth seeing, not worth hiding by quietly widening the week.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const weekHasToday = weekDates.some(d => {
        const x = new Date(d); x.setHours(0, 0, 0, 0);
        return x.getTime() === today.getTime();
      });
      const countedDays = weekDates.filter(d => {
        const dow = d.getDay();
        if (dow === 0 || dow === 6) return false;         // Mon-Fri is the work week
        if (!weekHasToday) return true;                    // past or future week: all five
        const x = new Date(d); x.setHours(0, 0, 0, 0);
        return x.getTime() <= today.getTime();             // this week: only days that exist yet
      });
      const cap = capFor(cal.name) * (countedDays.length || WORKDAYS);
      return {
        cal, perDay, cap, countedDays: countedDays.length, weekHasToday,
        booked: perDay.reduce((s, d) => s + d.booked, 0),
        hrs: perDay.reduce((s, d) => s + d.hrs, 0),
        missing: perDay.reduce((s, d) => s + d.missing, 0),
      };
    });
  }, [calendars, events, weekDates, caps, logged, now]);

  // The shop line has to sum the SAME set the rows below it show. It was
  // summing every column — hence "21.0 of 80h" with ten calendars counted as
  // ten people.
  const totalSrc = showUtilization && range === 'week' ? weekCols : columns;
  const totalBooked  = totalSrc.reduce((s, c) => s + c.booked, 0);
  const totalCap     = totalSrc.reduce((s, c) => s + c.cap, 0);
  const totalLogged  = totalSrc.reduce((s, c) => s + c.hrs, 0);
  const totalMissing = totalSrc.reduce((s, c) => s + c.missing, 0);

  return (
    <div>
      {/* ── UTILISATION ROW ─────────────────────────────────────────────── */}
      {/* WHICH WEEK. The panel showed percentages with no dates on them, so
          there was no way to tell this week from next. */}
      {/* WEEK NAV LIVES HERE. The arrows are in the Calendar tab's header, which
          does not render on the Utilization tab — so you could read a week and
          never leave it. Last week is the one that matters: this week is half
          unhappened, and you cannot judge anybody on it. */}
      {/* DAY NAV. The week buttons only moved weeks, so in Day mode you were
          stuck on whatever day the calendar tab happened to be on. */}
      {showUtilization && range === 'day' && onStepDay && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 9, alignItems: 'center' }}>
          <button onClick={() => onStepDay(-1)}
            style={{ padding: '9px 15px', borderRadius: 9, cursor: 'pointer',
                     background: 'transparent', border: '1px solid #263a55',
                     color: '#8ea0b8', fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 13.5, fontWeight: 800 }}>
            {date?.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
          <button onClick={() => onStepDay(1)}
            style={{ padding: '9px 15px', borderRadius: 9, cursor: 'pointer',
                     background: 'transparent', border: '1px solid #263a55',
                     color: '#8ea0b8', fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>›</button>
        </div>
      )}

      {showUtilization && range === 'week' && weekDates?.length > 0 && onStepWeek && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 9 }}>
          <button onClick={() => onStepWeek(-1)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer',
                     background: 'transparent', border: '1px solid #263a55',
                     color: '#8ea0b8', fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>
            ‹ Last week
          </button>
          <button onClick={() => onStepWeek(0)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer',
                     background: 'transparent', border: '1px solid #263a55',
                     color: '#8ea0b8', fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>
            This week
          </button>
          <button onClick={() => onStepWeek(1)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer',
                     background: 'transparent', border: '1px solid #263a55',
                     color: '#8ea0b8', fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>
            Next ›
          </button>
        </div>
      )}

      {showUtilization && weekDates?.length > 0 && (
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#8ea0b8', marginBottom: 7 }}>
          {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' – '}
          {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {(() => {
            const t = new Date(); t.setHours(0,0,0,0);
            const a = new Date(weekDates[0]); a.setHours(0,0,0,0);
            const b = new Date(weekDates[6]); b.setHours(0,0,0,0);
            if (t >= a && t <= b) return '  ·  this week';
            return t < a ? '  ·  upcoming' : '  ·  past';
          })()}
        </div>
      )}

      {showUtilization && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 8, padding: '0 2px' }}>
        <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
          <b style={{ color: '#e2e8f0', fontSize: 15 }}>
            {totalCap ? Math.round((totalBooked / totalCap) * 100) : 0}%
          </b>{' '}
          booked · {totalBooked.toFixed(1)} of {totalCap}h
          {' · '}
          <span style={{ color: totalMissing > 0.25 ? '#ff4f5e' : '#22d16f' }}>
            {totalLogged.toFixed(1)}h logged
            {totalMissing > 0.25 && ` · ${totalMissing.toFixed(1)}h unlogged`}
          </span>
        </div>
        <button onClick={() => setEditCap(v => !v)}
          style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 8,
                   color: '#94a3b8', fontSize: 12, fontWeight: 700, padding: '5px 11px',
                   cursor: 'pointer', fontFamily: 'inherit' }}>
          {editCap ? 'Done' : 'Capacity'}
        </button>
      </div>}

      {/* WEEK WITHOUT UTILISATION = the actual week calendar: one column per
          day, all selected techs' events in it, colour-coded. The utilisation
          table lives in the Tasks tab now — the calendar is for seeing where
          work sits, not for grading anybody. */}
      {!showUtilization && range === 'week' && weekDates?.length > 0 && (
        <WeekGrid weekDates={weekDates} events={events} calendars={calendars}
          colors={colors} onOpenEvent={onOpenEvent} logged={logged} now={now} />
      )}

      {weekDates?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[['day','Day'],['week','This week']].map(([k, label]) => (
            <button key={k} onClick={() => { setRange(k); onRangeChange?.(k); }}
              style={{ flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer',
                       background: range === k ? '#4b8dff' : 'transparent',
                       border: `1px solid ${range === k ? '#4b8dff' : '#263a55'}`,
                       color: range === k ? '#04121f' : '#8ea0b8',
                       fontSize: 13, fontWeight: 800, fontFamily: 'inherit' }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {showUtilization && range === 'week' && (
        <div style={{ marginBottom: 14 }}>
          {weekCols.map(({ cal, perDay, cap, booked, hrs, missing, countedDays, weekHasToday }) => {
            const pct  = cap ? Math.min(booked / cap, 1) : 0;
            const over = cap && booked > cap;
            const tone = over ? '#ff4f5e' : pct >= 0.75 ? '#22d16f' : pct >= 0.4 ? '#ffb020' : '#475569';
            return (
              <div key={cal.name}
                style={{ background: '#111f34', border: '1px solid #1d2f48', borderRadius: 13,
                         padding: '13px 15px', marginBottom: 9 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 9 }}>
                  <span style={{ fontSize: 15, fontWeight: 900 }}>{cal.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: tone }}>
                    {/* No denominator for people you do not pay by the week —
                        "0.0 / 40h" implied Subs owed you 40 hours. */}
                    {cap > 0
                      ? `${booked.toFixed(1)} / ${cap}h booked`
                      : `${booked.toFixed(1)}h booked · no set capacity`}
                  </span>
                  {/* Say what the denominator IS. "21 of 30" and "21 of 18"
                      are different stories and the number alone cannot tell
                      them apart. */}
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {weekHasToday
                      ? `${countedDays} day${countedDays === 1 ? '' : 's'} in so far`
                      : 'full week'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800,
                                 color: missing > 0.25 ? '#ff4f5e' : '#64748b' }}>
                    {missing > 0.25
                      ? `${missing.toFixed(1)}h never logged`
                      : hrs > 0 && !weekHasToday && weekDates[0] > new Date()
                        // Nothing stops the finish sheet writing hours against a
                        // FUTURE event, so a week that has not happened can carry
                        // logged time. Say so rather than letting it read as work
                        // already done.
                        ? `${hrs.toFixed(1)}h logged early`
                        : `${hrs.toFixed(1)}h logged`}
                  </span>
                </div>

                {/* WHAT THE HOURS ARE. "40 of 40" told you a number and nothing
                    about what filled it, so a week that looks full on this
                    screen and empty on the calendar had no explanation. */}
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(() => {
                    const names = perDay.flatMap(d => d.titles || []);
                    return names.length ? names.slice(0, 4).join(' · ') + (names.length > 4 ? ` +${names.length - 4}` : '')
                                        : 'nothing booked';
                  })()}
                </div>
                <div style={{ display: 'none' }}>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: '#1e293b', overflow: 'hidden' }}>
                  <div style={{ width: `${pct * 100}%`, height: '100%', background: tone }} />
                </div>
                {/* Per-day strip — a week that is 60% full because one day was
                    empty is a different problem from one that is evenly thin. */}
                <div style={{ display: 'flex', gap: 4, marginTop: 9 }}>
                  {perDay.map((d, i) => {
                    const weekend = d.date.getDay() === 0 || d.date.getDay() === 6;
                    // A weekend bar is not a gap in the week — it is a day
                    // nobody was expected to work. Dimmed unless something is
                    // actually booked on it, in which case it is worth seeing.
                    const dayCap = capFor(cal.name);
                    const p = dayCap ? Math.min(d.booked / dayCap, 1) : 0;
                    return (
                      <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ height: 26, borderRadius: 4,
                                      background: weekend ? '#080f1c' : '#0b1220',
                                      display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
                          <div style={{ width: '100%', height: `${p * 100}%`,
                                        background: d.missing > 0.25 ? '#ff4f5e' : tone }} />
                        </div>
                        <div style={{ fontSize: 9, marginTop: 3,
                                      color: weekend && !d.booked ? '#33455f' : '#64748b' }}>
                          {d.date.toLocaleDateString('en-US', { weekday: 'narrow' })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showUtilization && editCap && (
        <div style={{ background: '#111f34', border: '1px solid #263a55', borderRadius: 12,
                      padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 9 }}>
            Billable hours available per day{savingCap ? ' · saving…' : ''}
          </div>
          {/* PEOPLE, NOT CALENDARS. This iterated the calendar list, so it
              offered a billable-hours figure for "Tentatively Scheduled" and
              "Completed" — status buckets nobody works — while omitting JR and
              Trevor, who are the two that matter. A capacity belongs to a
              person you pay, not to a lane on a calendar. */}
          {FIELD_TECHS.filter(n => !NO_CAPACITY.has(n)).map(n => ({ name: n })).map(cal => (
            <div key={cal.name}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: 13.5, color: '#e2e8f0' }}>{cal.name}</span>
              <input type="number" min="0" max="24" step="0.5" value={capFor(cal.name)}
                onChange={e => saveCaps({ ...caps, [cal.name]: Number(e.target.value) })}
                style={{ width: 70, padding: '6px 9px', borderRadius: 8, background: '#0b1220',
                         border: '1px solid #334155', color: '#e2e8f0', fontSize: 13,
                         fontFamily: 'inherit', textAlign: 'right' }} />
            </div>
          ))}
        </div>
      )}

      {/* ── COLUMN HEADERS: name, hours, utilisation bar ─────────────────── */}
      {range === 'day' && <div style={{ display: 'grid', gridTemplateColumns: `${GUTTER}px repeat(${columns.length}, 1fr)`,
                    borderBottom: '1px solid #1e293b', position: 'sticky', top: 0,
                    background: '#0f1729', zIndex: 5 }}>
        <div />
        {columns.map(({ cal, booked, cap, hrs, missing }) => {
          const pct  = cap ? Math.min(booked / cap, 1) : 0;
          const over = cap && booked > cap;
          const tone = over ? '#ff4f5e' : pct >= 0.75 ? '#22d16f' : pct >= 0.4 ? '#ffb020' : '#475569';
          // The second bar is drawn against BOOKED, not capacity. The question
          // it answers is "did the work you were sent to do come back as
          // hours", and measuring that against capacity would hide a fully
          // logged half-day behind a short bar.
          const logPct = booked ? Math.min(hrs / booked, 1) : 0;
          return (
            <div key={cal.name} style={{ padding: '7px 6px 8px', textAlign: 'center', minWidth: 0 }}>
              {/* Straight through to Billing, scoped to this person. The
                  buckets there are unchanged — hours still only read as
                  billable when they actually are, and project hours still
                  show as budget burn rather than invoiceable work. */}
              <div onClick={() => onNavigate?.(`/unbilled?tech=${encodeURIComponent(cal.name)}`)}
                style={{ fontSize: 11.5, fontWeight: 800, color: '#e2e8f0', cursor: 'pointer',
                         overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cal.name}
              </div>
              <div style={{ fontSize: 10.5, color: tone, fontWeight: 700, margin: '2px 0 4px' }}>
                {booked.toFixed(1)}/{cap}h
              </div>
              <div style={{ height: 4, borderRadius: 3, background: '#1e293b', overflow: 'hidden' }}>
                <div style={{ width: `${pct * 100}%`, height: '100%', background: tone }} />
              </div>
              {booked > 0 && (
                <>
                  <div style={{ height: 4, borderRadius: 3, background: '#1e293b',
                                overflow: 'hidden', marginTop: 3 }}>
                    <div style={{ width: `${logPct * 100}%`, height: '100%',
                                  background: missing > 0.25 ? '#ff4f5e' : '#4b8dff' }} />
                  </div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 3,
                                color: missing > 0.25 ? '#ff4f5e' : '#64748b' }}>
                    {missing > 0.25 ? `${missing.toFixed(1)}h missing` : `${hrs.toFixed(1)}h logged`}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>}

      {/* ── GRID ─────────────────────────────────────────────────────────── */}
      {range === 'day' && <div style={{ position: 'relative', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        {hours.map(h => (
          <div key={h} style={{ display: 'grid',
                                gridTemplateColumns: `${GUTTER}px repeat(${columns.length}, 1fr)`,
                                height: HOUR_PX, borderTop: '1px solid #1e293b' }}>
            <div style={{ fontSize: 10.5, color: '#64748b', textAlign: 'right',
                          paddingRight: 7, marginTop: -6, fontWeight: 600 }}>
              {fmtHour(h)}
            </div>
            {columns.map(c => (
              <div key={c.cal.name} style={{ borderLeft: '1px solid #1e293b' }} />
            ))}
          </div>
        ))}

        {/* Now line — only on today, and above the blocks so it is never buried. */}
        {isToday && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && (
          <div style={{ position: 'absolute', top: nowTop, left: GUTTER - 4, right: 0,
                        height: 2, background: '#ff4f5e', zIndex: 6, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: 0, top: -4, width: 9, height: 9,
                          borderRadius: '50%', background: '#ff4f5e' }} />
          </div>
        )}

        {/* Event blocks */}
        {columns.map(({ cal, events: evs }, ci) => evs.map(e => {
          const s = new Date(e.start), en = new Date(e.end);
          const startH = s.getHours() + s.getMinutes() / 60;
          const endH   = en.getHours() + en.getMinutes() / 60;
          const top    = (startH - from) * HOUR_PX;
          const height = Math.max((endH - startH) * HOUR_PX - 2, 22);
          const colW   = `((100% - ${GUTTER}px) / ${columns.length})`;
          const subW   = `(${colW} / ${e._of || 1})`;
          const left   = `calc(${GUTTER}px + ${ci} * ${colW} + ${e._slot || 0} * ${subW} + 2px)`;
          const color  = e.color || colors[cal.name] || '#6b7280';
          const tight  = height < 42;

          return (
            <div key={`${cal.name}-${e.id}`} onClick={() => onOpenEvent?.(e)}
              title={`${e.summary} · ${s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              style={{ position: 'absolute', top, left,
                       width: `calc(${subW} - 4px)`, height,
                       background: '#16233a', borderLeft: `3px solid ${color}`,
                       border: `1px solid ${color}55`, borderRadius: 7,
                       padding: tight ? '2px 5px' : '5px 7px', cursor: 'pointer',
                       overflow: 'hidden', zIndex: 2 }}>
              <div style={{ color: '#e2e8f0', fontSize: tight ? 10 : 12, fontWeight: 700,
                            lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: tight ? 'nowrap' : 'normal' }}>
                {e.summary || '(untitled)'}
              </div>
              {!tight && (
                <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 2 }}>
                  {s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {/* No time entry against this event. Marked on the block
                      itself so it is actionable where it sits, not just a
                      number in the header. */}
                  {!logged[e.id] && en < now && (
                    <span style={{ color: '#ff4f5e', fontWeight: 800 }}> · no hours</span>
                  )}
                </div>
              )}
            </div>
          );
        }))}
      </div>}

      {range === 'day' && !columns.some(c => c.events.length) && (
        <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13, padding: '22px 0' }}>
          Nothing booked this day.
        </div>
      )}
    </div>
  );
}
