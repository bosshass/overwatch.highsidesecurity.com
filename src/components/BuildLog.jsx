// ============================================
// BuildLog — New version changelog modal
// ============================================
// Shows when APP_VERSION changes.
// User must tap "Got it" before the app clears
// their session and forces re-login.
// Add new builds to the top of BUILDS array.
// ============================================

export const BUILDS = [
  {
    version: '9.4.0',
    date: '2026-07-13',
    label: 'Finish-a-job screen rebuilt around the tech',
    changes: [
      'SCOPE OF WORK is now the first thing you see on a job — full text, no more "Show more". What you are walking into should never be hidden behind a link',
      'How did it end? moved ABOVE the notes — pick the outcome first, then write. It used to sit buried under Notes and Materials',
      'One "Finish job" button commits your choice, instead of four buttons that were both the choice and the submit',
      'The button tells you exactly what is missing (pick an outcome / add notes / add a return reason) instead of just sitting there dead',
      'The Calendar tab and Today now open the exact same finish form — the Calendar was showing an older version of it',
    ],
  },
  {
    version: '9.3.7',
    date: '2026-07-13',
    label: 'Scheduler timezone fix, reschedule, real email sends',
    changes: [
      'FIXED: scheduling put events on the wrong day/timezone — the app was sending Google a UTC timestamp, which Google then ignored the timezone on. Now sends real Denver wall-clock time. Affects every screen that creates a calendar event, not just the Scheduler',
      'Jobs already scheduled can now be RESCHEDULED from the Board — pick a new tech/time and the old calendar event is deleted instead of left behind as a ghost booking',
      'The ✉️ Email button on an assignment now actually SENDS the email (through your Google login) and confirms it with a green "Email sent" — it used to just open your mail app and hope',
      'Every sent assignment email is logged as a note on the job',
      'NOTE: you must sign out and back in once to grant Google send permission',
    ],
  },
  {
    version: '9.3.6',
    date: '2026-07-09',
    label: 'Event Audit: Done now always checks the calendar',
    changes: [
      'Selecting Done in Event Audit now always checks that the calendar event moved to Completed — previously this only happened as a side effect of a separate confirm action, so it usually never fired',
      'If the move fails for any reason, you now get a visible alert telling you to check it manually, instead of a silent console warning',
    ],
  },
  {
    version: '9.3.5',
    date: '2026-07-09',
    label: 'Reconcile sweep now covers July too',
    changes: [
      'Admin > Reconcile was hard-capped to only look at June 2026 — now sweeps through today automatically (and stays current every day going forward, no more manual date bumps)',
      'Catches the backlog of "Bill it"/"Billed"/"Complete" jobs stranded off the Completed calendar from the calendar_id bug that was active through July',
    ],
  },
  {
    version: '9.3.4',
    date: '2026-07-09',
    label: 'Fixed silently broken calendar sync (missing column)',
    changes: [
      'jobs.calendar_id never existed as a real column — the merge tool\'s "move to Completed calendar" step and the Visual Scheduler\'s Queue-sync tagging were silently no-op\'ing this whole time',
      'Both now derive the correct calendar from the job\'s assigned tech instead',
    ],
  },
  {
    version: '9.3.3',
    date: '2026-07-09',
    label: 'View Client link on job cards + photo links',
    changes: [
      'Job cards (Board detail + disposition screen) now show a "View Full Client History" link when a customer is attached',
      'Added a Photos field (Google Drive link) on disposition and new job creation — paste a share link, it saves into the notes automatically',
    ],
  },
  {
    version: '9.3.2',
    date: '2026-07-09',
    label: 'Billed/dead/lost jobs now visible under Done',
    changes: [
      'Customer Lookup\'s Done section now shows everything terminal — billed, dead, lost, archived — not just archived. Billed and dead jobs were previously invisible everywhere in a customer\'s history',
      'Each Done item shows its real outcome (Billed/Dead/Lost/Archived) instead of a flat generic "Done" label',
    ],
  },
  {
    version: '9.3.1',
    date: '2026-07-09',
    label: 'Global search no longer shows dead/billed jobs',
    changes: [
      'Search results now exclude dead, billed, archived, and lost jobs — was showing every job regardless of status, cluttering results with dead ends',
      'Status chip now shows real color/icon instead of a flat gray label',
    ],
  },
  {
    version: '9.3.0',
    date: '2026-07-09',
    label: 'Estimate Needed jobs now route to Estimates only',
    changes: [
      'Fixed: a job marked "Estimate Needed" was showing in both Triage AND Estimates on desktop (double-counted), and was missing from Estimates entirely on mobile',
      'Now shows only in the Estimates lane, on both desktop and mobile',
    ],
  },
  {
    version: '9.2.9',
    date: '2026-07-09',
    label: 'Bottom nav now shows on every screen',
    changes: [
      'Home/Today/Board/Clients/Cal nav bar used to only exist on the Home screen — now it\'s global, present everywhere, so you never have to navigate all the way back to Home just to switch areas',
      'Active tab now correctly reflects the real screen you\'re on instead of always highlighting Home',
      'Board: mobile now shows lanes as a stacked, tap-to-expand accordion instead of horizontal scroll',
    ],
  },
  {
    version: '9.2.8',
    date: '2026-07-09',
    label: 'Force-reload screen now scales properly on mobile',
    changes: [
      'The big red "new version" screen now uses fluid sizing — looks equally massive and clean on a phone as it does on desktop, no more fixed pixel sizes',
      'Reload Now button is now full-width on mobile for an easy thumb tap',
    ],
  },
  {
    version: '9.2.7',
    date: '2026-07-09',
    label: 'Fixed stale version number in header',
    changes: [
      'The version shown in the header was hardcoded to "V9.0" and never updated across any version bump — now shows the real live version automatically, every time',
    ],
  },
  {
    version: '9.2.6',
    date: '2026-07-09',
    label: 'Triage Queue customers now open the real Clients screen',
    changes: [
      'Searching a customer in Triage Queue now takes you to the actual Clients screen — full history, notes, tasks, new jobs, editable details',
      'Hitting Back returns you to Triage Queue, not Home',
    ],
  },
  {
    version: '9.2.5',
    date: '2026-07-09',
    label: 'Everyone now gets kicked to new versions automatically',
    changes: [
      'Every open tab now checks for a new version every 45 seconds — previously an already-open tab never noticed a new deploy until someone manually refreshed',
      'When a new version is detected, a big red full-screen warning appears with a Reload Now button, and auto-reloads after 20 seconds either way',
    ],
  },
  {
    version: '9.2.4',
    date: '2026-07-09',
    label: 'Renamed Queue to Triage Queue',
    changes: [
      'Renamed on the landing page tile and the screen\'s own header, for clarity',
    ],
  },
  {
    version: '9.2.3',
    date: '2026-07-09',
    label: 'Fixed invisible text in customer search + details panel',
    changes: [
      'Several inputs/buttons in customer search and the details panel had no explicit background/text color, leaving them exposed to OS/browser dark-mode form styling — could make text unreadable depending on your system setting',
      'All affected elements now use fixed colors that no longer shift based on light/dark mode',
    ],
  },
  {
    version: '9.2.2',
    date: '2026-07-09',
    label: 'Scheduling from the Board now clears it from Queue too',
    changes: [
      'The new Visual Scheduler now tags a job\'s original calendar event as [SCHEDULED] when booked, so it correctly disappears from Queue\'s Triage and Schedule tabs instead of sitting there stale',
    ],
  },
  {
    version: '9.2.1',
    date: '2026-07-09',
    label: 'Queue is now on the home screen',
    changes: [
      'Added a Queue tile to the landing page — Returns, parts, and scheduling, one tap from Home instead of typing the URL',
    ],
  },
  {
    version: '9.2.0',
    date: '2026-07-09',
    label: 'Visual Scheduler on the Board',
    changes: [
      'Scheduling a job from the Board now shows real tech availability — a color-graded 14-day grid (green=wide open, yellow=partial, red=tight/full), tap a day, tap a free slot, confirm',
      'Works for any tech with a calendar configured, not just Austin/JR',
      'Replaces the old plain date/time form entirely',
    ],
  },
  {
    version: '9.1.6',
    date: '2026-07-09',
    label: 'Hours no longer required to finish a job',
    changes: [
      'Work To Do Today: only notes are required to finish a visit — hours are optional',
      'Hours still save normally if entered; the sheet just no longer blocks on them being blank',
    ],
  },
  {
    version: '9.1.5',
    date: '2026-07-09',
    label: 'Customer link no longer lost on scheduling + cleaner notes',
    changes: [
      'Scheduling a job (from the Board, Reschedule, Return, or Office Hub) now stamps the customer ID onto the new calendar event — fixes having to re-search for a customer that was already known',
      'Merge-carried history entries are hidden from the notes feed by default — full history still lives in the database if ever needed',
    ],
  },
  {
    version: '9.1.4',
    date: '2026-07-09',
    label: 'Board status gaps fixed + full send-back-to-board options',
    changes: [
      'Board and dashboard stats now include Blocked, Won, and Pending Decision jobs — these were real statuses that were never being fetched, so jobs sitting there were invisible everywhere',
      '"Send back to board" from a To Bill card now offers every real status (Won, Lost, Needs Estimate, Pending Decision, and more), auto-generated so future statuses are never missing again',
    ],
  },
  {
    version: '9.1.3',
    date: '2026-07-09',
    label: 'Customer details now editable + QuickBooks ID field',
    changes: [
      'Edit details button on Customer Lookup: address, phone, gate code, key location',
      'Added QuickBooks customer ID/name fields — fill in when known, leave blank otherwise',
      'CS# and system/monitoring fields stay read-only to protect the dedup matching',
    ],
  },
  {
    version: '9.1.2',
    date: '2026-07-09',
    label: 'Customer Lookup shows stored details',
    changes: [
      'Selecting a customer now shows a details card: address, phone, system/monitoring info, alula username, gate code/key location',
      'Notes stay separate, further down — this is just the stored record fields',
    ],
  },
  {
    version: '9.1.1',
    date: '2026-07-09',
    label: 'Merged/duplicate customers hidden from search (corrected)',
    changes: [
      'Customer search now uses a dedicated merged_into flag to hide consolidated duplicates',
      'Removed an incorrect is_active filter from customer search that was hiding ~41% of real, non-monitored customers from every tech search — this was very likely the root cause driving repeated duplicate-customer creation',
    ],
  },
  {
    version: '9.1.0',
    date: '2026-07-08',
    label: 'Customer lookup fix — one source of truth',
    changes: [
      'Event Audit, Customer Lookup, and field notes now all read from the same customer list — fixes empty/broken customer search',
      'Assigning a customer to an event now links it permanently, so it always shows back in that customer history',
      'Removed the old duplicate customer lookup that was causing events to not show up under the right client',
    ],
  },
  {
    version: '9.0.0',
    date: '2026-06-29',
    label: 'Customer Cockpit + Real Field Notes',
    changes: [
      // — Customer cockpit —
      'The customer screen is now a workspace, not just a lookup — pull up a customer and act right there',
      'Add a note to a customer in one tap — it stays on their account whether or not it ever turns into a job',
      'Create a task and assign it to a person — it lands in their queue to act on',
      'Start a new job straight from the customer screen — already filled in with their info',
      'Everything you create is stamped to the customer automatically, so it can never split across different name spellings',
      // — Real field notes on the card —
      "Job cards now show the tech's REAL notes — pulled from wherever they were saved, with duplicates cleaned up (no more just \"disposition from Work Today\")",
      'Dispositioning a job now writes the actual field notes onto the card, not just a status stamp',
      // — Scheduling —
      "Scheduling now shows each tech's actual Google Calendar — see who's busy before you book, for the whole team (not just Austin and JR)",
    ],
  },
  {
    version: '8.2.0',
    date: '2026-06-29',
    label: 'Customer Lookup + Field Visits',
    changes: [
      // — Customer Lookup (rebuilt) —
      'Customer Lookup rebuilt — search a customer and see EVERY calendar visit in one place: date, time, tech, disposition, hours, materials, and the full notes',
      'Scattered name spellings now pull together — one customer is no longer split across "Jerry Allen Construction" and "ALLEN, JERRY/MARILYN"',
      'Visits that were never tagged show up under the matching customer with a one-tap "Assign" button',
      'Opening a customer from search now opens THAT customer (it used to jump to your last search)',
      // — Event Audit —
      'New Event Audit screen — work through calendar events and assign each one to the right customer account',
      // — Board card —
      "Job cards now show the FIELD VISIT — the tech's real notes, materials, hours, and disposition, right on the card (not just \"disposition from Work Today\")",
      // — Behind the scenes —
      'Dispositioning a job now tags the customer account automatically when it can match — less manual cleanup',
    ],
  },
  {
    version: '8.1.0',
    date: '2026-06-26',
    label: 'Overwatch — Full Release',
    changes: [
      // — Home & Board foundation (8.0) —
      'New home screen — command cards, live job counts, one-tap navigation',
      'Board runs on Supabase as the single source of truth — no more Google Calendar guesswork',
      'Board lanes: Triage · Blocked · Ready · Returns · Scheduled · Estimates · To Bill',
      'Tap a customer to link them; create a customer right on the job if missing',
      'Merge / duplicate tool — mark a job dead and point it at the survivor',
      'Scheduling stamps the calendar event back to the job, keeping them linked',
      'Jobs keep their real dates — no more everything showing as "today"',
      // — Board power-ups (8.1) —
      'Edit a job title — tap the name to rename it',
      'Move any job any direction — statuses are no longer one-way',
      'Add a note to any job, right from the job detail',
      'New "Blocked" status with its own red lane',
      'Assign a job to a team member (or type a name) — with a notification',
      'Cards show their CURRENT status as the bold tag, with the next step as a small "move →" chip',
      // — Billing (8.1) —
      'Billing rebuilt as a pipeline: Estimate Needed → Estimate Sent → Won, plus To Bill',
      'Notes stay visible on every billing card until it is marked billed',
      'Triage & Return removed from Billing — those live on the Board',
      // — Calendar capture (8.1) —
      'Appointments booked directly on Google Calendar are now captured — dispositioning one adopts it into a tracked job',
    ],
  },
  {
    version: '8.0.0',
    date: '2026-06-25',
    label: 'NakedPM Board + Command Home',
    changes: [
      'New home screen — command cards, live job counts, one-tap nav',
      'Board rebuilt on Supabase as sole source of truth — no Google Calendar reads',
      'Single-column mobile board with tab switching (Triage / Ready / Returns / Scheduled / Estimates / To Bill)',
      'Status moves fire immediately — no mandatory note gate',
      'UUID linker inline — search or create customer directly on a job',
      'Merge/duplicate tool — mark a job dead and link to the survivor',
      'Scheduler stamps calendar_event_id back to the job row — closing the GCal bridge',
      'Original job dates preserved — no more everything showing as "today"',
      'FAB for quick new job from home screen',
      'Bottom tab nav: Home / Today / Board / Cal',
    ],
  },
];

export const CURRENT_BUILD = BUILDS[0];

const C = {
  bg:    '#07111f',
  panel: '#101d31',
  card:  '#111f34',
  line:  '#1d2f48',
  line2: '#263a55',
  text:  '#edf4ff',
  muted: '#8ea0b8',
  green: '#22d16f',
  amber: '#ffb020',
};

export default function BuildLog({ onDismiss }) {
  const b = CURRENT_BUILD;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(3,7,18,0.97)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: `linear-gradient(180deg,#14243b,${C.panel})`,
        border: `1px solid ${C.line2}`,
        borderRadius: 20,
        padding: '28px 24px 24px',
        width: '100%',
        maxWidth: 460,
        maxHeight: '88vh',
        overflowY: 'auto',
      }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:20 }}>
          <div style={{ width:46, height:46, borderRadius:14, background:'#0b1526', border:`1px solid #314563`, display:'grid', placeItems:'center', fontSize:24, flexShrink:0 }}>
            🚀
          </div>
          <div>
            <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>
              New build deployed
            </div>
            <div style={{ fontSize:22, fontWeight:900, color:C.text, lineHeight:1.2 }}>
              Overwatch {b.version}
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
              {b.label} · {b.date}
            </div>
          </div>
        </div>

        <div style={{ borderTop:`1px solid ${C.line2}`, marginBottom:18 }} />

        {/* Changelog */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:12 }}>
            What's new
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {b.changes.map((change, i) => (
              <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                <span style={{ color:C.green, fontSize:14, marginTop:1, flexShrink:0 }}>✓</span>
                <span style={{ fontSize:13, color:'#b1bfd0', lineHeight:1.5 }}>{change}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Re-auth warning */}
        <div style={{ background:'#1a1a2e', border:`1px solid ${C.amber}55`, borderRadius:12, padding:'12px 14px', marginBottom:20, display:'flex', gap:10, alignItems:'flex-start' }}>
          <span style={{ fontSize:16, flexShrink:0 }}>⚠</span>
          <span style={{ fontSize:12, color:'#e8c97a', lineHeight:1.5 }}>
            New builds force a fresh session. You'll need to sign in again — this is intentional.
          </span>
        </div>

        <button onClick={onDismiss}
          style={{ width:'100%', padding:'15px 0', borderRadius:14, border:'none', background:C.green, color:'#04130a', fontWeight:900, fontSize:16, cursor:'pointer', letterSpacing:'-0.01em' }}>
          Got it — sign me in
        </button>

        {/* Build history */}
        {BUILDS.length > 1 && (
          <div style={{ marginTop:20, paddingTop:16, borderTop:`1px solid ${C.line}` }}>
            <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>
              Previous builds
            </div>
            {BUILDS.slice(1).map(prev => (
              <div key={prev.version} style={{ fontSize:12, color:'#4a5f7a', marginBottom:6, display:'flex', gap:8 }}>
                <span style={{ color:C.muted, fontWeight:700 }}>v{prev.version}</span>
                <span>{prev.label}</span>
                <span style={{ color:'#2d3f58' }}>{prev.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
