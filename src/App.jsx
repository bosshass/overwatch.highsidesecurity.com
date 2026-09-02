// ============================================
// Overwatch - Main App (React Router)
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { CALENDARS, TECH_COLORS } from './config/calendars.js';
import { supabase } from './services/supabase.js';
import { emailsFor } from './utils/ownership.js';
import TechCalendar from './views/TechCalendar.jsx';
import OpsHome from './views/OpsHome.jsx';
import MyDay from './views/MyDay.jsx';
import TaskStack from './views/TaskStack.jsx';
// People.jsx is no longer routed — retired, not deleted. The file stays so its
// history and the assignment logic in it are still readable if any of this
// needs unwinding.
import OwnerDashboard from './views/OwnerDashboard.jsx';
import CommandCenter from './views/CommandCenter.jsx';
import TechWorkToday from './views/TechWorkToday.jsx';
import ReconcileView from './views/ReconcileView.jsx';
import PreviewChanges from './views/PreviewChanges.jsx';
import BoardView from './views/BoardView.jsx';
import Notes from './views/Notes.jsx';
import SoldWork from './views/SoldWork.jsx';
import Scheduler from './views/Scheduler.jsx';
import Projects from './views/Projects.jsx';
import NewJobModal from './components/NewJobModal.jsx';
import JobFinishSheet from './components/JobFinishSheet.jsx';
import LinkAudit from './views/LinkAudit.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import CustomerHistory from './views/CustomerHistory.jsx';
import CustomerAudit from './views/CustomerAudit.jsx';
import WeeklyRecap from './views/WeeklyRecap.jsx';
import Unbilled from './views/Unbilled.jsx';
import ShortLink from './views/ShortLink.jsx';
import { StuckAlertGate } from './components/StuckAlerts.jsx';
import { shouldShowGate } from './utils/alertEngine.js';
import { jobDeepLink, APP_BASE } from './config/appBase.js';
import SmsSetup from './views/SmsSetup.jsx';
import { APP_VERSION } from './version.js';

// APP_VERSION lives in src/version.js and version.json is generated from it.
// See that file for why.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';


// True when the URL is carrying a deep link (?cal=&job=, ?job=, ?customerId=).
// The default-view redirect must NEVER clobber one — the pathname of a deep
// link is still '/', which is exactly why it used to.
// The KPI dashboard names who is and isn't actioning work. That's a
// conversation Sara has deliberately — not a screen the team wanders into.
const KPI_EMAILS = ['sara@jnbllc.com', 'admin@jnbservice.com'];
function canSeeKPIs(email) {
  return KPI_EMAILS.includes((email || '').toLowerCase());
}

function hasDeepLink() {
  const p = new URLSearchParams(window.location.search);
  return p.has('cal') || p.has('job') || p.has('customerId');
}

const USER_CONFIG = {
  'drhservicetech1@gmail.com':       { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: 'work' },
  'austin@drhsecurityservices.com':   { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: 'work' },
  // ── JR has two logins ──────────────────────────────────────────────────
  // info@ was a SHARED login that prompted "who are you?" (Sara / JR / Shana).
  // It isn't shared — it's JR's. The identity prompt is gone; it just signs
  // him in as himself. Sara reaches the app on admin@jnbservice.com and
  // sara@jnbllc.com, Shana on shanaparks@, so nobody loses a way in.
  'info@drhsecurityservices.com':     { name: 'JR',     role: 'operator', defaultCalendar: 'JR', defaultView: 'board' , needsIdentity: true },
    // jr@ lands on HOME, not /work — he's the owner, and the tour we show him is
  // about My Tasks and the warning banner, both of which live there. NOTE his
  // role is still 'tech', so Admin Tools and the operator screens stay hidden
  // on this login. That is the unresolved question from earlier: info@ makes
  // him an operator, jr@ makes him a tech, and it's the same person.
  'jr@drhsecurityservices.com':       { name: 'JR',     role: 'tech',     defaultCalendar: 'JR', defaultView: 'my' },
  'brian@drhsecurityservices.com':    { name: 'Brian',  role: 'tech',     defaultCalendar: 'Brian', defaultView: 'work' },
  'sara@jnbllc.com':                  { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: 'board' },
  'shanaparks@drhsecurityservices.com': { name: 'Shana', role: 'operator', defaultCalendar: 'Shana', defaultView: 'board' },
  'admin@jnbservice.com':             { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: 'board' },
  // defaultCalendar was 'Installations' — the shared install queue — so Trevor
  // signed in and landed on everyone's work instead of his own day. Austin
  // lands on Austin; Trevor lands on Trevor. He still SEES Installations
  // (config/calendars.js gives him both), it is just no longer where he starts.
  'trevor@drhsecurityservices.com':    { name: 'Trevor', role: 'tech',     defaultCalendar: 'Trevor', defaultView: 'work' },
  'subs@drhsecurityservices.com':      { name: 'Subs',   role: 'tech',     defaultCalendar: 'Subs', defaultView: 'work' },
  'accounting@drhsecurityservices.com': { name: 'Accounting', role: 'operator', defaultCalendar: null, defaultView: 'board', superAdmin: true },
  // Sara on the DRH domain, as a TECH profile: her own calendar, My Day as the
  // landing, no board. She keeps admin@jnbservice.com and accounting@ for ops.
  // NOTE: an unknown email silently defaults to role 'tech' with no calendars
  // and no task ownership, so adding a login here is only ONE of the six lists
  // that have to agree — see the others changed alongside this.
  'sara@drhsecurityservices.com':     { name: 'Sara',   role: 'tech',     defaultCalendar: 'Sara', defaultView: 'my' },
};

// Identity options for shared logins like info@
const IDENTITY_OPTIONS = [
  { key: 'Sara', label: 'Sara', defaultCalendar: null, defaultView: 'board' },
  { key: 'JR', label: 'JR', defaultCalendar: null, defaultView: 'my' },
  { key: 'Shana', label: 'Shana', defaultCalendar: 'Shana', defaultView: 'board' },
];

const CALENDAR_OPTIONS = [
  { key: null, label: 'All Calendars' },
  { key: 'Austin', label: 'Austin' },
  { key: 'JR', label: 'JR' },
  { key: 'Brian', label: 'Brian' },
  { key: 'Sara', label: 'Sara' },
  { key: 'Shana', label: 'Shana' },
  { key: 'Trevor', label: 'Trevor' },
  { key: 'Subs', label: 'Subs' },
  { key: 'Service Queue', label: 'Service Queue' },
  { key: 'Installations', label: 'Installations' },
];

function getUserConfig(email) {
  return USER_CONFIG[email?.toLowerCase()] || { name: email?.split('@')[0] || 'User', role: 'tech', defaultCalendar: null, defaultView: null };
}

// ── VIEW AS (super admin) ───────────────────────────────────────────────
// accounting@ is the super admin: it can render any other user's view without
// having their password. This is a LENS, not a login.
//
// HARD RULE: view-as changes what you SEE. It never changes what gets WRITTEN.
// Every write still carries the real signed-in email, so job_history,
// time_entries.tech_email, and the audit trail stay truthful. If this ever
// starts stamping the impersonated user's address on writes, that is a bug —
// an accounting login silently authoring records as a field tech is exactly
// the thing an audit trail exists to prevent.
//
// sessionStorage, not localStorage: the lens dies with the tab. You cannot
// walk away and leave the app pretending to be someone else.
const VIEW_AS_KEY = 'ow_view_as';

// Everyone a super admin can look through. Derived from USER_CONFIG so adding
// a person to the app adds them here automatically. Deduped BY PERSON — JR has
// two logins (info@ and jr@) and Sara has two; the switcher lists humans, not
// mailboxes. Where a person has both an operator and a tech login, the operator
// one wins, since that's the fuller view.
const VIEW_AS_OPTIONS = Object.entries(USER_CONFIG)
  .filter(([, c]) => c.name)
  .reduce((acc, [email, c]) => {
    const existing = acc.find(o => o.name === c.name);
    if (!existing) acc.push({ email, name: c.name, role: c.role });
    else if (existing.role !== 'operator' && c.role === 'operator') {
      existing.email = email; existing.role = c.role;
    }
    return acc;
  }, [])
  .sort((a, b) => a.name.localeCompare(b.name));

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('tech');
  const [isLoading, setIsLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [defaultCalendar, setDefaultCalendar] = useState(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillLog, setBackfillLog] = useState([]);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [showIdentityPicker, setShowIdentityPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // Tour / Spotlight / BuildLog / HelpBot REMOVED 2026-08-20 at Sara's call:
  // the help layer teaches the OLD vocabulary and would be wrong the day the
  // stages change. It comes back once the core loop is right, not before.
  const [viewAs, setViewAs] = useState(() => {
    try { return sessionStorage.getItem(VIEW_AS_KEY) || null; } catch { return null; }
  });
  const [showAlertGate, setShowAlertGate] = useState(false);
  // Google session went stale. NOT a sign-out — the app stays put and the
  // user taps once to reconnect.
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [forceReload, setForceReload] = useState(false);
  // Set when reloading demonstrably did not help — the served bundle is stale.
  const [staleVersion, setStaleVersion] = useState(null);
  const [forceReloadSeconds, setForceReloadSeconds] = useState(20);

  // Deep link detection — ?cal=X&job=Y at root
  const urlParams = new URLSearchParams(location.search);
  const deepLinkCal = urlParams.get('cal');
  const deepLinkJob = urlParams.get('job');

  const runBackfill = async () => {
    const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
    const CALS = [
      { id: 'c_5d027121360fc0b02d470d2ad10e0be5924428877a0957110de3f71eaf922f0b@group.calendar.google.com', name: 'Tentatively Scheduled' },
      { id: 'drhservicetech1@gmail.com', name: 'Austin' },
      { id: 'do0i4f1jqbbakd72mpgpll9m6g@group.calendar.google.com', name: 'JR' },
      { id: 'shanaparks@drhsecurityservices.com', name: 'Shana' },
      { id: 'c_c84c0a24e2a7386cb519b21569fbb4b17a19214ce33744a63e06394f8c57339f@group.calendar.google.com', name: 'Installations' },
      { id: 'c_aa764bfa5d492c689c26e3ed589df2804a04ee175db1b68d48217bd18883d178@group.calendar.google.com', name: 'Sales & Accounting' },
    ];
    setBackfillRunning(true);
    setBackfillLog([]);
    const addLog = (msg, type='info') => setBackfillLog(prev => [...prev, { msg, type }]);
    const now = new Date();
    const timeMin = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    let patched = 0, skipped = 0, errors = 0;
    for (const cal of CALS) {
      addLog(`📅 ${cal.name}`, 'cal');
      try {
        const params = new URLSearchParams({ timeMin, timeMax: now.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
        const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) { const e = await res.json(); addLog(`  ⚠️ ${res.status}: ${e.error?.message}`, 'err'); errors++; continue; }
        const events = (await res.json()).items || [];
        addLog(`  ${events.length} events found`, 'dim');
        for (const event of events) {
          if (event.status === 'cancelled') continue;
          const desc = event.description || '';
          // THIS GUARD WAS INVERTED BY A DOMAIN THAT DOES NOT EXIST.
          // It read: skip if the description has an old juc-e-v2 link AND does
          // NOT have an overwatch.highsidesecurity.com one. That subdomain has
          // no DNS record and never has, so no description has ever contained
          // it — which made the condition "skip every event still carrying an
          // old link", i.e. precisely the events this backfill exists to
          // repair. It skipped its own work.
          //
          // The real question is whether the event already points at THIS
          // deployment, whatever that is today.
          if (desc.includes(APP_BASE)) { skipped++; continue; }
          const deepLink = jobDeepLink(cal.id, event.id);
          const stripped = desc.replace(/\n*🔗 OPEN IN OVERWATCH:.*$/s, '').replace(/\n*📱 Open in Overwatch:.*$/s, '').trimEnd();
          const newDesc = (stripped ? stripped + '\n\n' : '') + `📱 Open in Overwatch: ${deepLink}`;
          const pr = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events/${event.id}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: newDesc })
          });
          if (pr.ok) { addLog(`  ✅ ${event.summary || '(no title)'}`, 'ok'); patched++; }
          else { addLog(`  ❌ ${event.summary}`, 'err'); errors++; }
          await new Promise(r => setTimeout(r, 150));
        }
      } catch(e) { addLog(`  ❌ ${e.message}`, 'err'); errors++; }
    }
    addLog(`─────────────────────`, 'dim');
    addLog(`✅ Patched: ${patched}  ⏭ Skipped: ${skipped}  ❌ Errors: ${errors}`, 'info');
    setBackfillRunning(false);
  };

  // ── AUTH: Check stored session ──────────────────────────────────────────
  useEffect(() => {
    const storedVersion = localStorage.getItem('juce_v4_version');
    // The version is still recorded so UpdateBanner can spot a new deploy.
    // The changelog GATE is gone — see the removal note above.
    localStorage.setItem('juce_v4_version', APP_VERSION);

    const storedToken = localStorage.getItem('juce_v4_token');
    const storedEmail = localStorage.getItem('juce_v4_email');
    const storedExpiry = localStorage.getItem('juce_v4_expiry');

    if (storedToken && storedEmail && storedExpiry) {
      const expiry = new Date(storedExpiry);
      if (expiry > new Date()) {
        const config = getUserConfig(storedEmail);
        setAccessToken(storedToken);
        setUserEmail(storedEmail);
        setUserRole(config.role);
        setIsSignedIn(true);

        // Check if user needs to pick identity (shared login like info@)
        if (config.needsIdentity) {
          const savedIdentity = localStorage.getItem(`juce_identity_${storedEmail}`);
          if (savedIdentity) {
            const identity = IDENTITY_OPTIONS.find(i => i.key === savedIdentity);
            if (identity) {
              setUserName(identity.key);
              setDefaultCalendar(identity.defaultCalendar);
              if (identity.defaultView && window.location.pathname === '/' && !hasDeepLink()) {
                window.history.replaceState(null, '', `/${identity.defaultView}`);
              }
            } else {
              setShowIdentityPicker(true);
            }
          } else {
            setShowIdentityPicker(true);
          }
        } else {
          setUserName(config.name);

          const savedDefault = localStorage.getItem(`juce_default_cal_${storedEmail}`);
          if (savedDefault !== null) {
            setDefaultCalendar(savedDefault === 'null' ? null : savedDefault);
          } else {
            setDefaultCalendar(config.defaultCalendar);
            setShowSetup(true);
          }
          
          // Navigate to user's default view if at root — but NOT if the URL is
          // carrying a deep link. This line was silently eating every deep link.
          if (config.defaultView && window.location.pathname === '/' && !hasDeepLink()) {
            window.history.replaceState(null, '', `/${config.defaultView}`);
          }
        }
      } else {
        clearStorage();
      }
    }
    setIsLoading(false);
  }, []);

  // ── BOOT REPAIR: re-stamp a token expiry we cannot trust ────────────────
  // Anyone already signed in when this build lands still has the poisoned
  // juce_v4_token_expiry in localStorage — a timestamp from an old session
  // that the redirect never overwrote. Clearing it on sign-out fixes the NEXT
  // sign-in; it does nothing for the tab that is open right now, which would
  // read the stale value and raise the session gate over a perfectly good
  // token.
  //
  // So ask Google. tokeninfo returns the token's ACTUAL remaining life, which
  // is the one number nobody here has been able to state honestly: the
  // redirect invented 36 hours, silentRefresh assumed 3600s. If the token is
  // genuinely dead this 400s and the normal expiry path takes over — which is
  // the correct outcome, reached for a real reason instead of a stale string.
  useEffect(() => {
    if (!isSignedIn) return;
    const tok = localStorage.getItem('juce_v4_token');
    if (!tok) return;
    const exp = localStorage.getItem('juce_v4_token_expiry');
    // Only when it is missing or already lapsed — a live value is left alone.
    if (exp && new Date(exp).getTime() > Date.now()) return;
    let dead = false;
    (async () => {
      try {
        const res = await fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(tok)}`);
        if (!res.ok) return;                 // really expired — leave it alone
        const info = await res.json();
        const left = Number(info.expires_in);
        if (!dead && Number.isFinite(left) && left > 0) {
          localStorage.setItem('juce_v4_token_expiry',
            new Date(Date.now() + left * 1000).toISOString());
          setNeedsReconnect(false);
        }
      } catch { /* offline or blocked — the 401 path still covers us */ }
    })();
    return () => { dead = true; };
  }, [isSignedIn]);

  // ── LIVE VERSION POLL ────────────────────────────────────────────────────
  // The check above only ever runs once, on load — someone who has a tab
  // open for hours never gets caught by it, no matter how many versions ship
  // underneath them. This polls the real deployed version every 45s and
  // force-reloads EVERYONE still on an old build, with a full warning first.
  useEffect(() => {
    const checkForNewVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== APP_VERSION) {
          // LOOP GUARD. version.json is fetched no-store so it is always fresh,
          // but window.location.reload() does NOT bypass cache for the HTML or
          // the JS bundle. A stale bundle therefore reports the old APP_VERSION
          // on every reload, mismatches again, and reloads again — forever.
          // If we have already reloaded for this exact version and are STILL
          // behind, the cache is the problem and reloading cannot fix it. Stop
          // and let the user act instead of spinning.
          const tried = sessionStorage.getItem('juce_reload_for');
          if (tried === data.version) { setStaleVersion(data.version); return; }
          sessionStorage.setItem('juce_reload_for', data.version);
          setForceReload(true);
        } else if (data.version) {
          sessionStorage.removeItem('juce_reload_for');
        }
      } catch (e) { /* network hiccup, non-fatal, just try again next interval */ }
    };
    const interval = setInterval(checkForNewVersion, 45000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!forceReload) return;
    if (forceReloadSeconds <= 0) {
      // A plain reload() re-serves the cached bundle. Changing the URL forces
      // a genuinely new request, which is the whole point of reloading.
      const u = new URL(window.location.href);
      u.searchParams.set('v', Date.now().toString(36));
      window.location.replace(u.toString());
      return;
    }
    const t = setTimeout(() => setForceReloadSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [forceReload, forceReloadSeconds]);

  const clearStorage = () => {
    localStorage.removeItem('juce_v4_token');
    localStorage.removeItem('juce_v4_email');
    localStorage.removeItem('juce_v4_expiry');
    // THIS KEY WAS NEVER CLEARED, AND THAT IS THE SIGN-IN LOOP.
    // juce_v4_token_expiry is written ONLY by silentRefresh. Signing out left
    // it behind, and the OAuth redirect below never overwrote it — so a fresh
    // sign-in landed with a brand-new token and a token_expiry timestamp from
    // hours or days earlier. The "already dead on arrival" check runs
    // immediately on mount, read that stale past timestamp, decided the
    // session was gone, tried a silent refresh, and on a phone (where the GIS
    // popup is blocked outside a user gesture) failed — so "Your session
    // expired" appeared SECONDS after signing in successfully. Tapping
    // "Sign back in" ran the same failing refresh and fell through to the full
    // redirect, which is the account picker. Round and round.
    localStorage.removeItem('juce_v4_token_expiry');
  };

  // ── AUTH: Google Sign In ────────────────────────────────────────────────
  // `reauth` — this is a token renewal for somebody already signed in, not a
  // fresh login. The difference is the account picker: forcing
  // prompt=select_account on a renewal makes a user with several Google
  // accounts on the phone hand-pick theirs every single time the hour-long
  // token lapses. With login_hint and no prompt, Google round-trips the same
  // account silently and the user sees a flicker instead of a menu.
  const handleSignIn = useCallback(({ reauth = false } = {}) => {
    // Remember where the user was actually trying to go — e.g. a /board?job=...
    // deep link from an assign-to SMS/email — so sign-in can send them there
    // instead of unconditionally dropping them at '/' or their default view.
    const here = window.location.pathname + window.location.search;
    if (here && here !== '/') {
      sessionStorage.setItem('ow_post_login_path', here);
    }
    const known = localStorage.getItem('juce_v4_email') || '';
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', window.location.origin);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    if (reauth && known) {
      authUrl.searchParams.set('login_hint', known);
    } else {
      authUrl.searchParams.set('prompt', 'select_account');
    }
    window.location.href = authUrl.toString();
  }, []);

  // ── AUTH: Handle OAuth redirect ─────────────────────────────────────────
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');

      if (token) {
        // A deep link (e.g. /board?job=...) that required a fresh sign-in —
        // consume it now so it takes priority over the normal defaultView
        // redirect below. Left in place (not removed) only in the rare
        // needsIdentity-without-saved-identity branch, since that case has to
        // pause for an identity pick first and isn't wired to resume the
        // deep link automatically yet.
        const pendingPath = sessionStorage.getItem('ow_post_login_path');

        fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(data => {
            const email = data.email;
            // Session lasts 36 hours — token refresh happens silently
            const expiry = new Date(Date.now() + 36 * 60 * 60 * 1000);
            const config = getUserConfig(email);

            localStorage.setItem('juce_v4_token', token);
            localStorage.setItem('juce_v4_email', email);
            localStorage.setItem('juce_v4_expiry', expiry.toISOString());
            // AND THE TOKEN'S OWN LIFETIME, from Google's own expires_in in
            // the redirect fragment (3600s). This was never written here —
            // only silentRefresh wrote it — so after a fresh sign-in the
            // pre-emptive renewal read whatever was left over from a previous
            // session. Two keys, two meanings, and only one of them was being
            // kept honest:
            //   juce_v4_expiry       — how long we let somebody stay signed in
            //   juce_v4_token_expiry — when THIS Google token stops working
            const tokenLifeMs = (Number(params.get('expires_in')) || 3600) * 1000;
            localStorage.setItem('juce_v4_token_expiry',
              new Date(Date.now() + tokenLifeMs).toISOString());

            setAccessToken(token);
            setUserEmail(email);
            setUserRole(config.role);
            setIsSignedIn(true);

            // Check if user needs to pick identity (shared login like info@)
            if (config.needsIdentity) {
              const savedIdentity = localStorage.getItem(`juce_identity_${email}`);
              if (savedIdentity) {
                const identity = IDENTITY_OPTIONS.find(i => i.key === savedIdentity);
                if (identity) {
                  setUserName(identity.key);
                  setDefaultCalendar(identity.defaultCalendar);
                  sessionStorage.removeItem('ow_post_login_path');
                  const dest = pendingPath || (identity.defaultView ? `/${identity.defaultView}` : '/');
                  window.history.replaceState(null, '', dest);
                  if (dest !== '/') navigate(dest);
                } else {
                  setShowIdentityPicker(true);
                  window.history.replaceState(null, '', '/');
                }
              } else {
                setShowIdentityPicker(true);
                window.history.replaceState(null, '', '/');
              }
            } else {
              setUserName(config.name);
              
              const savedDefault = localStorage.getItem(`juce_default_cal_${email}`);
              if (savedDefault !== null) {
                setDefaultCalendar(savedDefault === 'null' ? null : savedDefault);
              } else {
                setDefaultCalendar(config.defaultCalendar);
                setShowSetup(true);
              }

              // Deep link takes priority over the normal default-view redirect.
              sessionStorage.removeItem('ow_post_login_path');
              const dest = pendingPath || (config.defaultView ? `/${config.defaultView}` : '/');
              window.history.replaceState(null, '', dest);
              if (dest !== '/') navigate(dest);
            }
          })
          .catch(err => console.error('Auth error:', err));
      }
    }
  }, []);

  const handleSignOut = useCallback(() => {
    clearStorage();
    setAccessToken(null);
    setUserEmail('');
    setUserName('');
    setIsSignedIn(false);
    navigate('/');
  }, [navigate]);


  // ── AUTH: Silent token refresh ────────────────────────────────────────
  // WHAT WAS HERE, AND WHY IT COULD NEVER WORK
  //   The old version opened a HIDDEN IFRAME pointed at
  //   accounts.google.com/o/oauth2/v2/auth with prompt=none. Google serves
  //   X-Frame-Options: DENY on that endpoint and has for years, so the iframe
  //   could not load, the 8s timeout always fired, and silentRefresh() always
  //   resolved false. The 401 handler then called handleSignOut().
  //
  //   Net effect: the moment the Google token died, whoever was using the app
  //   got thrown to the login screen mid-task. Every time. That is the "closes
  //   on its own and makes me log in again" everyone reported.
  //
  //   Google Identity Services does this properly, without an iframe.
  const tokenClientRef = useRef(null);
  const getTokenClient = useCallback(() => {
    if (tokenClientRef.current) return tokenClientRef.current;
    const g = window.google?.accounts?.oauth2;
    if (!g) return null;
    tokenClientRef.current = g.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      prompt: '',              // silent when Google still trusts the session
      callback: () => {},      // replaced per-call below
    });
    return tokenClientRef.current;
  }, []);

  // The GIS script in index.html is `async defer`, so window.google may not
  // exist yet when the first refresh fires on a cold load. getTokenClient()
  // returned null and the refresh reported failure instantly — a load-order
  // race being reported to the user as a dead session. Wait for it briefly.
  const waitForGis = useCallback(async (ms = 3000) => {
    const deadline = Date.now() + ms;
    while (!window.google?.accounts?.oauth2 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    return !!window.google?.accounts?.oauth2;
  }, []);

  const silentRefresh = useCallback(async () => {
    await waitForGis();
    return new Promise((resolve) => {
      const client = getTokenClient();
      if (!client) return resolve(false);
      const done = (ok) => { clearTimeout(timer); resolve(ok); };
      const timer = setTimeout(() => done(false), 10000);
      client.callback = (resp) => {
        if (resp?.access_token) {
          // Store the REAL lifetime Google gives us, not a made-up 36 hours.
          const lifeMs = (Number(resp.expires_in) || 3600) * 1000;
          localStorage.setItem('juce_v4_token', resp.access_token);
          localStorage.setItem('juce_v4_token_expiry', new Date(Date.now() + lifeMs).toISOString());
          setAccessToken(resp.access_token);
          done(true);
        } else done(false);
      };
      try { client.requestAccessToken({ prompt: '', login_hint: userEmail }); }
      catch { done(false); }
    });
  }, [getTokenClient, userEmail, waitForGis]);

  // ── AUTH: refresh BEFORE it breaks ────────────────────────────────────
  // Waiting for a 401 means the user always eats one failed action. Renew at
  // 80% of the token's real life instead, so nothing they do ever hits a dead
  // token in the first place.
  useEffect(() => {
    if (!isSignedIn) return;
    const tick = async () => {
      const exp = localStorage.getItem('juce_v4_token_expiry');
      if (!exp) return;
      const msLeft = new Date(exp).getTime() - Date.now();
      const life = 3600 * 1000;
      if (msLeft < life * 0.2) await silentRefresh();
    };
    tick();
    const iv = setInterval(tick, 4 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isSignedIn, silentRefresh]);

  // ── ALERT GATE: show for JR every 6 hours ──────────────────────────────
  useEffect(() => {
    if (!isSignedIn || !userEmail) return;
    if (userEmail.toLowerCase() === 'jr@drhsecurityservices.com') {
      if (shouldShowGate(userEmail)) {
        setShowAlertGate(true);
      }
    }
  }, [isSignedIn, userEmail]);

  // ── AUTH: Session expiry check (36hr) ───────────────────────────────────
  useEffect(() => {
    if (!isSignedIn) return;
    const check = () => {
      const expiry = localStorage.getItem('juce_v4_expiry');
      if (!expiry || new Date(expiry) <= new Date()) {
        // Was a hard handleSignOut(). Prompt instead — losing an operator's
        // in-progress work to a background timer is never the right trade.
        setNeedsReconnect(true);
      }
    };
    check();
    const interval = setInterval(check, 5 * 60 * 1000); // check every 5 min
    return () => clearInterval(interval);
  }, [isSignedIn, handleSignOut]);

  // ── IS THE SESSION ALREADY DEAD ON ARRIVAL? ─────────────────────────────
  // The 401 interceptor only fires once something FAILS, so a user returning to
  // a tab left open overnight got a fully rendered, fully dead app and found
  // out by losing a write. Check the stored expiry on load and every minute
  // after, and try a silent refresh before bothering anybody.
  useEffect(() => {
    if (!isSignedIn) return;
    let dead = false;
    const check = async () => {
      const exp = localStorage.getItem('juce_v4_token_expiry');
      if (!exp) return;
      // 60s of slack so we act just before it lapses, not just after.
      if (new Date(exp).getTime() - Date.now() > 60000) return;
      const ok = await silentRefresh();
      // A FAILED BACKGROUND REFRESH IS NOT PROOF THE SESSION IS DEAD.
      // silentRefresh goes through GIS requestAccessToken, which opens a
      // popup when it cannot complete silently — and a popup with no user
      // gesture behind it is blocked outright on mobile. So this failed
      // routinely on a phone for reasons that had nothing to do with the
      // token, and threw up a full-screen "session expired" over a session
      // that still worked.
      //
      // The 401 interceptor below is the honest signal: it fires when a real
      // request to Google actually came back unauthorised. That still raises
      // the gate. This one now only raises it once the token is properly
      // past its expiry AND the renewal failed — not merely inside the
      // 60-second renewal window.
      const reallyExpired = new Date(exp).getTime() <= Date.now();
      if (!ok && !dead && reallyExpired) setNeedsReconnect(true);
    };
    check();
    const t = setInterval(check, 60000);
    const onFocus = () => check();          // catches the overnight tab
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      dead = true;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [isSignedIn, silentRefresh]);

  // ── AUTH: 401 interceptor — try silent refresh before signing out ──────
  useEffect(() => {
    if (!isSignedIn) return;
    let refreshing = false;
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      if (res.status === 401 && !refreshing) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('googleapis.com')) {
          refreshing = true;
          const ok = await silentRefresh();
          refreshing = false;
          if (ok) {
            // Retry the failed request with new token
            const newToken = localStorage.getItem('juce_v4_token');
            const [input, init = {}] = args;
            const newInit = { ...init, headers: { ...init.headers, Authorization: `Bearer ${newToken}` } };
            return origFetch(input, newInit);
          } else {
            // WAS handleSignOut(). Blowing the session away on one failed
            // refresh is what threw people to the login screen mid-task and
            // lost whatever they were typing. Surface a banner instead: the
            // app stays exactly where it is and reconnecting is one tap.
            setNeedsReconnect(true);
          }
        }
      }
      return res;
    };
    return () => { window.fetch = origFetch; };
  }, [isSignedIn, silentRefresh, handleSignOut]);

  // ── ROLE CHECKS ─────────────────────────────────────────────────────────
  // RESTRICTED = a field tech. No board, no billing, no roll-ups, no calendar
  // filter row — just their own calendar and their own work. This is the list
  // that actually locks the app down; USER_CONFIG role 'tech' alone does not.
  const RESTRICTED_EMAILS = ['drhservicetech1@gmail.com', 'austin@drhsecurityservices.com', 'brian@drhsecurityservices.com', 'trevor@drhsecurityservices.com', 'subs@drhsecurityservices.com', 'sara@drhsecurityservices.com'];
  // THE ADDRESS EVERY SCREEN READS AS.
  // Declared HERE, above the role flags, because they use it. In 9.67.0 this
  // lived 85 lines further down: legal JavaScript, compiles clean, and dies the
  // moment the component runs — "Cannot access 'he' before initialization",
  // where 'he' is this after minification. A white screen, not a build error.
  //
  // Reads use this. WRITES keep using userEmail, which is what the amber banner
  // promises: "anything you save is recorded under your own name."
  const readAsEmail = viewAs || userEmail;

  const isRestricted = RESTRICTED_EMAILS.includes(readAsEmail?.toLowerCase());

  const isOperator = getUserConfig(readAsEmail).role === 'operator';

  // Super admin + the lens they're currently looking through.
  const isSuperAdmin = getUserConfig(userEmail).superAdmin === true;

  // FORCE THE GATE. Set this key and every shared-login device drops its saved
  // identity on next load, so JR and Shana get asked who they are — and told
  // to stop using the shared login — instead of silently continuing as the
  // mailbox. Bumped by accounting from Admin tools after the test pass.
  useEffect(() => {
    if (!isSignedIn || !userEmail) return;
    (async () => {
      try {
        const { data } = await supabase.from('settings')
          .select('value').eq('key', 'force_identity_after').maybeSingle();
        const stamp = data?.value?.at || data?.value;
        if (!stamp) return;
        const seen = localStorage.getItem('ow_identity_forced_at');
        if (seen === String(stamp)) return;
        localStorage.removeItem(`juce_identity_${userEmail}`);
        localStorage.setItem('ow_identity_forced_at', String(stamp));
        window.location.reload();
      } catch { /* never block the app on this */ }
    })();
  }, [isSignedIn, userEmail]);

  // Open tasks assigned to me, for the nav badge. Email told people a task had
  // landed; nothing in the app itself did, so anyone who does not live in that
  // mailbox found out whenever they next happened to look.
  const [taskCount, setTaskCount] = useState(0);
  useEffect(() => {
    if (!isSignedIn || !userEmail) return;
    let dead = false;
    const tick = async () => {
      try {
        const mine = emailsFor(userEmail);
        // Fetch the IDS, not a count, so today's skips can be subtracted.
        // The badge read straight from the database and skips live in
        // localStorage, so the two never talked: you could skip everything and
        // the 7 sat there all day telling you to look at work you had already
        // said "not now" to. That is how a badge gets ignored permanently —
        // and JR and Shana would have been the first to say so.
        const { data } = await supabase.from('notes')
          .select('id')
          .eq('status', 'open').neq('lane', 'done')
          .in('assigned_to', mine.length ? mine : ['__none__']);

        // UNREAD MESSAGES COUNT FOR EVERYBODY. Inbound texts are a shared
        // inbox, so the badge cannot key off assignment the way tasks do — a
        // client's unanswered question must nag the whole office, not only
        // whoever it happened to be routed to. Read state is what silences it,
        // and read is shared too: one person opening it clears it for all.
        const { data: unread } = await supabase.from('notes')
          .select('id')
          .eq('status', 'open')
          .is('read_at', null)
          .like('body', '📲 Text from%');

        let skipped = {};
        try {
          const raw = JSON.parse(localStorage.getItem('task_skips') || '{}');
          const today = new Date().toLocaleDateString('en-CA');
          // Day-scoped: yesterday's skips are dropped on read, so anything
          // still open comes back tomorrow morning. Skipping is "not now",
          // never "done".
          skipped = Object.fromEntries(Object.entries(raw).filter(([, d]) => d === today));
        } catch {}

        // Union by id — a message routed to you would otherwise be counted
        // twice, once as your task and once as an unread message.
        const ids = new Set([
          ...(data   || []).filter(n => !skipped[n.id]).map(n => n.id),
          ...(unread || []).map(n => n.id),
        ]);
        if (!dead) setTaskCount(ids.size);
      } catch { /* a badge is not worth an error */ }
    };
    tick();
    const t = setInterval(tick, 90000);   // cheap head-count, not a subscription
    // Skipping updates the badge immediately instead of up to 90s later.
    window.addEventListener('task-skips-changed', tick);
    return () => {
      dead = true;
      clearInterval(t);
      window.removeEventListener('task-skips-changed', tick);
    };
  }, [isSignedIn, userEmail, location.pathname]);
  const viewAsConfig = viewAs ? getUserConfig(viewAs) : null;

  // THE ADDRESS EVERY SCREEN SHOULD READ AS.
  // View-as swapped the NAME only, so /tasks, /board, /my and home all still
  // resolved from the signed-in address — which is why viewing as Shana and
  // viewing as JR looked identical. They were both just showing accounting@.
  //
  // Reads use this. WRITES keep using userEmail, which is what the amber
  // banner already promises: "anything you save is recorded under your own
  // name." Impersonation must never author on somebody else's behalf.
  // readAsEmail is declared ABOVE the role flags — see there.
  // effectiveName drives which VIEW renders. userEmail (unchanged) drives every write.
  const effectiveName = viewAsConfig?.name || userName;

  const applyViewAs = (email) => {
    if (email) sessionStorage.setItem(VIEW_AS_KEY, email);
    else sessionStorage.removeItem(VIEW_AS_KEY);
    setViewAs(email || null);
    // Land on the viewed user's home so the switch is immediately visible
    // instead of leaving them on a screen that person would never open.
    const dest = email ? (getUserConfig(email).defaultView || '') : '';
    navigate(`/${dest}`);
  };

  // ── LOADING ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1729' }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/overwatch-logo.png" alt="Overwatch" style={{ width: 84, height: 84, marginBottom: 16, borderRadius: 16 }} />
          <div style={{ color: '#00c8e8', fontSize: '14px' }}>Loading...</div>
        </div>
      </div>
    );
  }

  // ── FORCE RELOAD (new version detected while this tab was already open) ──
  // Highest priority in the whole app -- overrides everything, including the
  // changelog screen below, because staying on stale code is the actual risk
  // here (this is exactly what "code drift between deployed and live" looks
  // like from the user's side).
  if (forceReload) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: '#7f1d1d',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px', textAlign: 'center', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 'clamp(48px, 15vw, 72px)', marginBottom: 12 }}>🚨</div>
        <div style={{ fontSize: 'clamp(26px, 8vw, 40px)', fontWeight: 900, color: '#fff', marginBottom: 14, lineHeight: 1.15 }}>
          NEW VERSION AVAILABLE
        </div>
        <div style={{ fontSize: 'clamp(14px, 4.2vw, 18px)', color: '#fecaca', marginBottom: 28, maxWidth: 480 }}>
          Overwatch has updated. This tab is running an old version and needs to reload
          to stay in sync with everyone else.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#fff', color: '#7f1d1d', border: 'none', borderRadius: 14,
            padding: 'clamp(14px, 4vw, 18px) clamp(24px, 8vw, 40px)', fontSize: 'clamp(17px, 5vw, 22px)', fontWeight: 800, cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)', marginBottom: 20, width: '100%', maxWidth: 340,
          }}>
          🔄 Reload Now
        </button>
        <div style={{ fontSize: 'clamp(13px, 3.5vw, 15px)', color: '#fecaca' }}>
          Reloading automatically in <span style={{ fontWeight: 800, fontSize: 'clamp(16px, 4.5vw, 20px)', color: '#fff' }}>{forceReloadSeconds}</span>s…
        </div>
      </div>
    );
  }

  // ── LOGIN ───────────────────────────────────────────────────────────────
  if (!isSignedIn) {
    const teal = '#2bb3b3';
    const Reticle = ({ size, style }) => (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute', opacity: 0.28, pointerEvents: 'none', ...style }}>
        <circle cx="50" cy="50" r="47" fill="none" stroke={teal} strokeWidth="0.7" strokeDasharray="1 3.2" />
        <circle cx="50" cy="50" r="35" fill="none" stroke={teal} strokeWidth="0.6" />
        <circle cx="50" cy="50" r="31" fill="none" stroke={teal} strokeWidth="0.5" strokeDasharray="2 5" />
      </svg>
    );

    return (
      <div style={{
        // NOT `minHeight: '100vh', minHeight: '100dvh'`. That is the CSS
        // fallback pattern and it does NOT work in a JS object — a duplicate
        // key is just overwritten, so the vh half was dead code that only
        // produced a build warning. dvh is what actually applied, and it is
        // what we want: on mobile Safari 100vh includes the address bar and
        // pushes the bottom of the screen out of reach. A real fallback would
        // need a stylesheet, not this.
        minHeight: '100dvh',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: 'radial-gradient(120% 80% at 50% 0%, #0d1422 0%, #070a11 60%, #05070c 100%)',
        padding: 'calc(56px + env(safe-area-inset-top)) 28px calc(28px + env(safe-area-inset-bottom))',
        position: 'relative', overflow: 'hidden', textAlign: 'center',
      }}>
        {/* ambient reticles */}
        <Reticle size={210} style={{ top: 70, right: -60 }} />
        <Reticle size={150} style={{ top: 230, right: 30 }} />
        <Reticle size={190} style={{ bottom: 120, left: -70 }} />
        <Reticle size={120} style={{ bottom: 30, left: 30 }} />

        {/* logo */}
        <img src="/overwatch-logo.png" alt="Overwatch" style={{
          width: 190, height: 'auto', marginBottom: 26, zIndex: 1,
          filter: 'drop-shadow(0 14px 34px rgba(0,0,0,0.5))',
        }} />

        {/* wordmark */}
        <h1 style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 46, fontWeight: 800, color: '#fff', letterSpacing: 4,
          margin: 0, lineHeight: 1, zIndex: 1,
        }}>OVERWATCH</h1>
        <div style={{ width: 132, height: 3, background: teal, borderRadius: 2, margin: '18px 0 16px', zIndex: 1 }} />
        <p style={{ fontSize: 15, color: '#8b97a6', letterSpacing: 3, fontWeight: 600, margin: 0, zIndex: 1 }}>
          DRH SECURITY COMMAND CENTER
        </p>

        {/* shield */}
        <svg width="58" height="58" viewBox="0 0 24 24" fill="none" style={{ margin: '48px 0 26px', zIndex: 1 }}>
          <path d="M12 2.5l7 2.6v5.4c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V5.1l7-2.6z" stroke={teal} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8.8 12.2l2.2 2.2 4-4.4" stroke={teal} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 14px', zIndex: 1 }}>
          Smart Security. Real Clarity.
        </h2>
        <p style={{ fontSize: 16, color: '#aeb8c4', margin: 0, lineHeight: 1.55, maxWidth: 360, zIndex: 1 }}>
          Always sign in with Google.<br />
          One clean login for field, office, and owner visibility.
        </p>

        {/* push button toward the bottom */}
        <div style={{ flex: 1, minHeight: 28 }} />

        <button onClick={handleSignIn} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
          padding: '17px 24px', fontSize: 17, fontWeight: 700,
          background: '#fff', color: '#1B2A4A', border: 'none', borderRadius: 14,
          cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          width: '100%', maxWidth: 380, minHeight: 58, zIndex: 1,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <p style={{ marginTop: 22, color: '#6b7787', fontSize: 13, lineHeight: 1.5, zIndex: 1 }}>
          By continuing, you agree to the<br />
          <span style={{ color: teal }}>Terms of Service</span> and <span style={{ color: teal }}>Privacy Policy</span>.
        </p>
      </div>
    );
  }

  // ── DEEP LINK: ?cal=X&job=Y → JobFinishSheet ─────────────────────────
  if (deepLinkCal && deepLinkJob) {
    return (
      <DeepLinkFinish
        calendarId={deepLinkCal}
        eventId={deepLinkJob}
        accessToken={accessToken}
        userEmail={userEmail}
        userName={getUserConfig(userEmail).name}
        onDone={() => navigate('/')}
      />
    );
  }

  // ── VIEW SHELL (shared nav bar for full-screen views) ───────────────────
  const ViewShell = ({ children }) => (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, zIndex: 100, background: '#0f1729'
      }}>
        <button onClick={() => navigate('/')} style={{
          background: '#1e293b', border: 'none', borderRadius: 8,
          color: '#e2e8f0', fontSize: 14, fontWeight: 700,
          padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
        }}>← Home</button>
        <img src="/overwatch-logo.png" alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
        <span style={{ fontWeight: 700, color: '#00c8e8', fontSize: 14 }}>Overwatch</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>V{APP_VERSION}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {isSuperAdmin && (
            <select
              value={viewAs || ''}
              onChange={e => applyViewAs(e.target.value || null)}
              style={{ background: viewAs ? '#f59e0b' : '#1e293b', color: viewAs ? '#0f1729' : '#e2e8f0',
                       border: '1px solid #334155', borderRadius: 6, padding: '5px 8px',
                       fontSize: 11, fontWeight: viewAs ? 700 : 400, cursor: 'pointer' }}>
              <option value="">View as: me</option>
              {VIEW_AS_OPTIONS.map(o => (
                <option key={o.email} value={o.email}>{o.name} ({o.role})</option>
              ))}
            </select>
          )}
          <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700 }}>{userName}</span>

          {/* 🔗 BACKFILL REMOVED from the header 9.9.44. It kicked off a bulk
              data operation and sat one tap from every screen, next to the help
              button, labelled with nothing but a chain emoji. Nobody should be
              able to trigger a mass rewrite by mis-tapping. It is still
              reachable — see Admin Tools — just not by accident. */}

          
          <button onClick={handleSignOut}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
          >Out</button>
        </div>
      </div>
      {viewAs && (
        <div style={{ background: '#f59e0b', color: '#0f1729', padding: '7px 16px', fontSize: 12,
                      fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>
            Viewing as <b>{viewAsConfig?.name}</b> — their tasks, their board, their calendar.
            You are still signed in as {userEmail}, and anything you SAVE is recorded under
            your own name.
          </span>
          <button onClick={() => applyViewAs(null)}
            style={{ background: '#0f1729', color: '#f59e0b', border: 'none', borderRadius: 6,
                     padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Back to me
          </button>
        </div>
      )}
      <div style={{ paddingBottom: 70 }}>
        {children}
      </div>
    </div>
  );

  // ── ROUTE GUARDS ────────────────────────────────────────────────────────
  const OperatorOnly = ({ children }) => isOperator ? children : <Navigate to="/" replace />;

  // ── ROUTES ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Session went stale. This REPLACES the old behaviour of calling
          handleSignOut() out from under whoever was mid-task. The app stays
          exactly where it is; reconnecting is one tap and puts you back. */}
      {/* Reload happened and the bundle is STILL stale — the browser or CDN is
          serving cache we cannot shift from JS. Say so plainly and give the one
          instruction that actually works, instead of reloading in a circle. */}
      {staleVersion && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 4100,
                      background: '#7f1d1d', borderBottom: '1px solid #ef4444',
                      padding: '10px 14px', display: 'flex', alignItems: 'center',
                      gap: 12, fontFamily: 'Inter, system-ui, sans-serif' }}>
          <span style={{ color: '#fecaca', fontSize: 13, fontWeight: 700, flex: 1 }}>
            Version {staleVersion} is out but your browser keeps loading an old copy.
            Hold Shift and click reload (or Cmd+Shift+R) once.
          </span>
          <button onClick={() => { sessionStorage.removeItem('juce_reload_for'); setStaleVersion(null); }}
            style={{ background: 'transparent', border: '1px solid #fecaca', borderRadius: 8,
                     color: '#fecaca', fontWeight: 700, fontSize: 13, padding: '7px 14px',
                     cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* A DEAD SESSION MUST STOP THE APP, NOT ANNOUNCE ITSELF AND STEP ASIDE.
          This used to be a thin strip at the top of the page. Everything
          underneath stayed live, so you carried on tapping, every write failed
          silently, and the app looked broken rather than logged out. The strip
          also scrolls out of view on a phone the moment you touch anything.
          Now it blocks: nothing behind it is reachable until the session is
          back. Reads already on screen stay visible behind the scrim — the
          work is not lost, it just cannot be added to. */}
      {needsReconnect && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 5000,
                      background: 'rgba(3,7,18,0.86)', backdropFilter: 'blur(3px)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
          <div style={{ background: '#0f1b2e', border: '1px solid #f59e0b',
                        borderRadius: 16, padding: '26px 22px', maxWidth: 380,
                        width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
            <div style={{ color: '#fbbf24', fontSize: 18, fontWeight: 900, marginBottom: 8 }}>
              Your session expired
            </div>
            <div style={{ color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.55, marginBottom: 18 }}>
              Google signed you out, so Overwatch can't save anything right now.
              Nothing you've already done is lost — but don't keep working until
              you're back in, or it won't stick.
            </div>
            <button onClick={async () => {
                      const ok = await silentRefresh();
                      if (ok) setNeedsReconnect(false);
                      // reauth: same account, no picker. This button used to
                      // drop a user with six Google accounts on the phone into
                      // the account list every time.
                      else handleSignIn({ reauth: true });
                    }}
              style={{ width: '100%', background: '#f59e0b', border: 'none', borderRadius: 10,
                       color: '#08121f', fontWeight: 900, fontSize: 15,
                       padding: '13px 16px', cursor: 'pointer', fontFamily: 'inherit' }}>
              Sign back in
            </button>
            <button onClick={handleSignOut}
              style={{ width: '100%', marginTop: 9, background: 'transparent',
                       border: '1px solid #334155', borderRadius: 10, color: '#94a3b8',
                       fontWeight: 700, fontSize: 13, padding: '10px 16px',
                       cursor: 'pointer', fontFamily: 'inherit' }}>
              Sign out instead
            </button>
          </div>
        </div>
      )}
      <Routes>
        <Route path="/" element={
          <OpsHome userName={effectiveName} isOperator={isOperator} isSuperAdmin={isSuperAdmin} isRestricted={isRestricted} accessToken={accessToken} userEmail={readAsEmail} onNavigate={navigate} onSignOut={handleSignOut} onBackfill={() => { setShowBackfill(true); setBackfillLog([]); }} onSearch={() => setShowSearch(true)} />
        } />

        {/* /my — JR's landing. The visit prompt plus his assigned notes.
            Not operator-gated: everyone has assigned work, and the screen
            only ever shows what belongs to whoever is signed in. */}
        <Route path="/my" element={
          <ViewShell><MyDay userEmail={readAsEmail} userName={effectiveName} accessToken={accessToken} onNavigate={navigate} isOperator={isOperator} /></ViewShell>
        } />

        {/* /tasks — one card at a time, To Do / Doing / Done. Replaces
            sending people to People, which opens on a jobs list. */}
        <Route path="/tasks" element={
          <ViewShell><TaskStack userEmail={readAsEmail} userName={effectiveName} onNavigate={navigate} isOperator={isOperator} accessToken={accessToken} /></ViewShell>
        } />

        <Route path="/calendar" element={<ViewShell><TechCalendar accessToken={accessToken} userEmail={readAsEmail} defaultCalendar={defaultCalendar} isRestricted={isRestricted} isOperator={isOperator} userName={effectiveName} viewAs={viewAs} defaultTab={urlParams.get('tab') === 'utilization' ? 'tasks' : undefined} /></ViewShell>} />

        <Route path="/work" element={
          <TechWorkToday 
            accessToken={accessToken} 
            userEmail={userEmail} 
            userName={getUserConfig(userEmail).name} 
            onBack={() => navigate('/')} 
            showAllTechs={!isRestricted}
          />
        } />
        {/* Triage Queue REMOVED 9.9.30. Nothing linked to it, its scheduling
            path was one of the duplicate schedulers, and the board's Triage
            column already does this job. */}
        {/* /billing REMOVED 9.9.31. It counted job_assignments — dispatch
            records, i.e. who was SUPPOSED to show up — instead of time_entries,
            the hours actually logged. That is why it said 18 when 2 was true.
            /unbilled is the real billing screen. */}

        <Route path="/newjob" element={
          <div style={{ minHeight: '100vh', background: '#0f1729' }}>
            <NewJobModal accessToken={accessToken} userEmail={userEmail} onClose={() => navigate('/')} onCreated={() => navigate('/')} />
          </div>
        } />

        <Route path="/lifeline" element={
          <ViewShell>
            <div style={{ padding: 24, textAlign: 'center', marginTop: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔴</div>
              <div style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Lifeline</div>
              <div style={{ color: '#cbd5e1', fontSize: 14 }}>Coming soon.</div>
            </div>
          </ViewShell>
        } />

        {/* Operator-only */}
        <Route path="/command" element={<OperatorOnly><ViewShell><CommandCenter accessToken={accessToken} userEmail={userEmail} /></ViewShell></OperatorOnly>} />
        {/* People — one screen for who owns what. /workspace and /office both
            land here: My Tasks was always just People filtered to you, and
            OfficeHub was the same idea reading a table nobody filled in. */}
        {/* PEOPLE IS RETIRED. It was a roster of jobs-by-person, then a roster
            of tasks-by-person, and Tasks now does the second job better with a
            person filter for operators. "People" as a destination is gone —
            the thing you actually browse is CLIENTS. Old links land there. */}
        <Route path="/people" element={<Navigate to="/tasks" replace />} />
        <Route path="/people/:who" element={<Navigate to="/tasks" replace />} />
        <Route path="/office" element={<Navigate to="/tasks" replace />} />
        <Route path="/clients" element={<Navigate to="/customers" replace />} />
        <Route path="/dashboard" element={<OperatorOnly><ViewShell><OwnerDashboard accessToken={accessToken} userEmail={userEmail} userRole="operator" /></ViewShell></OperatorOnly>} />
        {/* THE BOARD IS OPERATORS ONLY. It was never gated — BoardView does not
            even receive isRestricted. Techs simply had no LINK to it, which is
            not the same as not being allowed in: anyone typing /board got the
            whole shop, every customer, every dollar figure. View-as Austin made
            that visible, but a tech on his own phone had the same access.
            OperatorOnly already existed and guards four other routes. */}
        <Route path="/board" element={<OperatorOnly><ViewShell><BoardView accessToken={accessToken} userEmail={readAsEmail} userName={effectiveName} onBack={() => navigate('/')} /></ViewShell></OperatorOnly>} />
        {/* Role-based workspaces. /workspace resolves to whoever is signed in
            — or, for a super admin using View as, to whoever they're viewing.
            userEmail stays the REAL signed-in address so writes are truthful. */}
        <Route path="/workspace" element={<Navigate to="/people" replace />} />
        <Route path="/workspace/:who" element={<Navigate to="/people" replace />} />
        {/* Notes are NOT jobs and deliberately have no board presence. */}
        <Route path="/notes" element={<ViewShell><Notes userEmail={userEmail} accessToken={accessToken} onBack={() => navigate('/tasks')} /></ViewShell>} />
        {/* Sold work. Accepted estimates with a balance live ONLY here until
            somebody creates a job from one or closes it out. An estimate is
            not a visit, and putting them on the board is how 36 QuickBooks
            imports became cards nobody could action. */}
        <Route path="/sold" element={<ViewShell><SoldWork userEmail={userEmail} onBack={() => navigate('/')} onOpenJob={() => navigate('/board')} /></ViewShell>} />
        <Route path="/scheduler" element={<ViewShell><Scheduler accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/projects" element={<OperatorOnly><ViewShell><Projects accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell></OperatorOnly>} />
        <Route path="/customers" element={<ViewShell><CustomerHistory onBack={() => navigate(urlParams.get('returnTo') || '/')} accessToken={accessToken} userEmail={userEmail} initialCustomerId={urlParams.get('customerId')} /></ViewShell>} />
        <Route path="/audit" element={<OperatorOnly><ViewShell><CustomerAudit onBack={() => navigate('/')} accessToken={accessToken} /></ViewShell></OperatorOnly>} />
        <Route path="/recap" element={<OperatorOnly><WeeklyRecap onBack={() => navigate('/')} userEmail={userEmail} /></OperatorOnly>} />
        <Route path="/j/:code" element={<ShortLink accessToken={accessToken} userEmail={userEmail} userRole={getUserConfig(userEmail).role} onUpdate={() => {}} />} />
        {/* Texting setup. Reachable by typing /sms — the status endpoint's own
            advice was "sign in and open this from Overwatch", which pointed at
            a screen that did not exist until now. */}
        <Route path="/sms" element={<OperatorOnly><ViewShell><SmsSetup accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} /></ViewShell></OperatorOnly>} />
        <Route path="/unbilled" element={<OperatorOnly><ViewShell><Unbilled onBack={() => navigate('/')} userEmail={userEmail} /></ViewShell></OperatorOnly>} />

        {/* Admin */}
        {/* /admin/gap REMOVED 9.10.2. Nothing linked to it, and its link tool
            fabricated FAKE calendar_event_ids (manual-<timestamp>) and set
            status='scheduled' by hand — inventing exactly the ghost bookings
            the rest of this build exists to kill. */}
        <Route path="/admin/reconcile" element={<OperatorOnly><ReconcileView accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} onOpenFinish={(calId, jobId) => navigate(`/?cal=${encodeURIComponent(calId)}&job=${encodeURIComponent(jobId)}`)} onOpenPreview={() => navigate('/admin/preview')} /></OperatorOnly>} />
        {/* LINK AUDIT — standing, both directions. ReconcileView was a one-time
            historical sweep and only looked calendar -> board. This runs on a
            rolling window and also catches live tickets with no calendar event
            at all (9 of 38 when this was written). */}
        <Route path="/admin/links" element={<OperatorOnly><LinkAudit accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} onOpenJob={(a) => { if (a?.mode === 'open' && a.jobId) navigate(`/board?job=${a.jobId}`); }} /></OperatorOnly>} />
        <Route path="/admin/preview" element={<OperatorOnly><PreviewChanges accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/admin/reconcile')} /></OperatorOnly>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global bottom nav — present on every screen, not just Home.
          Active tab reflects the REAL current path now, not a hardcoded guess. */}
      {isSignedIn && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'rgba(7,17,31,0.97)', borderTop:'1px solid #1d2f48', display:'flex', zIndex:150, backdropFilter:'blur(14px)', paddingBottom:'env(safe-area-inset-bottom)' }}>
          {[
            { icon:'⌂', label:'Home',  path:'/' },
            { icon:'✓', label:'Today', path:'/work' },
            // Hidden from techs. The route is gated now, so leaving the tab
            // there would just navigate them into a redirect — a door that
            // opens onto a wall is worse than no door.
            ...(isOperator ? [{ icon:'▤', label:'Board', path:'/board' }] : []),
            // TASKS, NOT PEOPLE. People opens on its Work tab — every job
            // assigned to you rendered as full paragraphs, with an Estimates
            // section. That is a roster for whoever is running the day, and it
            // is one tap from every screen in the app, so a tech tapping the
            // person icon expecting "my stuff" got a wall of text instead.
            // Operators still reach People from the board's "Who's stuck".
            { icon:'📋', label:'Tasks', path:'/tasks' },   // was ✓ — identical to Today's icon
            { icon:'🏠', label:'Clients', path:'/customers' },
            { icon:'📅', label:'Cal',  path:'/calendar' },
          ].map(t => {
            const active = t.path === '/' ? location.pathname === '/' : location.pathname.startsWith(t.path);
            return (
              <button key={t.path} onClick={() => navigate(t.path)}
                style={{ flex:1, padding:'10px 0 6px', background:'none', border:'none', color: active ? '#00c8e8' : '#8ea0b8', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                {/* TASKS CARRIES A COUNT AND SITS LARGER. It is the one tab
                    that has a number attached — everything else is a place, but
                    this is a pile that grows if nobody looks at it. */}
                <span style={{ fontSize: t.path === '/tasks' ? 25 : 20, position:'relative' }}>
                  {t.icon}
                  {t.path === '/tasks' && taskCount > 0 && (
                    <span style={{ position:'absolute', top:-3, right:-11, minWidth:16, height:16,
                                   borderRadius:9, background:'#ff4f5e', color:'#fff',
                                   fontSize:10, fontWeight:900, display:'flex',
                                   alignItems:'center', justifyContent:'center', padding:'0 4px' }}>
                      {taskCount > 9 ? '9+' : taskCount}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: t.path === '/tasks' ? 10.5 : 9.5,
                               fontWeight: t.path === '/tasks' ? 900 : 700,
                               whiteSpace:'nowrap' }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Global Search */}
      {showSearch && (
        <GlobalSearch onClose={() => setShowSearch(false)} onNavigate={navigate} />
      )}

      {/* JR Alert Gate */}
      {showAlertGate && (
        <StuckAlertGate
          accessToken={accessToken}
          userEmail={userEmail}
          onDismiss={() => setShowAlertGate(false)}
        />
      )}

      {/* Modals (render on top of any route) */}
      {showIdentityPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%' }}>
            {/* This gate decided whether JR could see his own tasks and said
                "Select your identity for this session", which reads as optional
                and explains nothing. He had four tasks he never saw. Now it
                says what it is for, and says the shared login is the problem
                rather than quietly working around it. */}
            <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>👋</div>
            <h2 style={{ color: '#e2e8f0', fontSize: '19px', fontWeight: 800, textAlign: 'center', margin: '0 0 6px 0' }}>
              Who are you?
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              You're signed in on <b style={{ color: '#cbd5e1' }}>{userEmail}</b> — a shared
              mailbox, so Overwatch can't tell who's holding the phone. Tap your name or
              your work won't show up.
            </p>

            <div style={{ background: '#2a1f08', border: '1px solid #f59e0b', borderRadius: 10,
                          padding: '11px 13px', marginBottom: 18 }}>
              <div style={{ color: '#fbbf24', fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>
                Please stop signing in this way
              </div>
              <div style={{ color: '#fcd9a0', fontSize: 12, lineHeight: 1.5 }}>
                Use your own <b>@drhsecurityservices.com</b> Google account. On the shared
                login your tasks, your jobs and your hours all get filed under the mailbox
                instead of under you — and this screen has to guess, on every device.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {IDENTITY_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => {
                    localStorage.setItem(`juce_identity_${userEmail}`, opt.key);
                    setUserName(opt.key);
                    setDefaultCalendar(opt.defaultCalendar);
                    setShowIdentityPicker(false);
                    // A deep link (e.g. /board?job=...) that triggered a fresh
                    // sign-in gets parked here until an identity is picked —
                    // this is the shared-login (info@) path JR actually uses,
                    // so resuming it here is what makes his text-message
                    // ticket links actually land on the right card.
                    const pendingPath = sessionStorage.getItem('ow_post_login_path');
                    sessionStorage.removeItem('ow_post_login_path');
                    const dest = pendingPath || (opt.defaultView ? `/${opt.defaultView}` : null);
                    if (dest) {
                      window.history.replaceState(null, '', dest);
                      navigate(dest);
                    }
                  }}
                  style={{
                    background: '#0f1729',
                    color: '#e2e8f0',
                    border: '1px solid #334155',
                    borderRadius: '12px',
                    padding: '16px 20px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSetup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%' }}>
            <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>🛡️</div>
            <h2 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', textAlign: 'center', margin: '0 0 4px 0' }}>Welcome, {userName}!</h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: '0 0 20px 0' }}>Pick your default calendar view for this device.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {CALENDAR_OPTIONS.map(opt => (
                <button key={opt.key || 'all'} onClick={() => setDefaultCalendar(opt.key)} style={{
                  background: defaultCalendar === opt.key ? '#00c8e820' : '#0f1729',
                  color: defaultCalendar === opt.key ? '#00c8e8' : '#94a3b8',
                  border: `1px solid ${defaultCalendar === opt.key ? '#00c8e8' : '#334155'}`,
                  borderRadius: '10px', padding: '12px 16px', fontSize: '14px',
                  fontWeight: defaultCalendar === opt.key ? '700' : '500', cursor: 'pointer', textAlign: 'left'
                }}>
                  {opt.key === null ? '📅 ' : ''}{opt.label}
                  {opt.key === defaultCalendar && defaultCalendar !== null && ' ✓'}
                  {opt.key === null && defaultCalendar === null && ' ✓'}
                </button>
              ))}
            </div>
            <button onClick={() => { localStorage.setItem(`juce_default_cal_${userEmail}`, defaultCalendar === null ? 'null' : defaultCalendar); setShowSetup(false); }}
              style={{ width: '100%', background: '#00c8e8', color: '#000', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}>
              Save & Go
            </button>
          </div>
        </div>
      )}

      {showBackfill && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '480px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ color: '#00c8e8', fontSize: '16px', fontWeight: '700', margin: 0 }}>🔗 Backfill Deep Links</h2>
              <button onClick={() => setShowBackfill(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ color: '#cbd5e1', fontSize: '12px', margin: '0 0 16px 0' }}>Patches "📱 Open in Overwatch" into all non-completed events from the last 60 days.</p>
            <button onClick={runBackfill} disabled={backfillRunning}
              style={{ background: backfillRunning ? '#334155' : '#00c8e8', color: backfillRunning ? '#64748b' : '#000', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: backfillRunning ? 'not-allowed' : 'pointer', marginBottom: '12px' }}>
              {backfillRunning ? 'Running...' : 'Run Backfill'}
            </button>
            <div style={{ flex: 1, overflowY: 'auto', background: '#0f1729', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8' }}>
              {backfillLog.length === 0 && <span style={{ color: '#94a3b8' }}>Log will appear here...</span>}
              {backfillLog.map((entry, i) => (
                <div key={i} style={{ color: entry.type === 'ok' ? '#22c55e' : entry.type === 'err' ? '#ef4444' : entry.type === 'cal' ? '#00c8e8' : entry.type === 'dim' ? '#475569' : '#e2e8f0' }}>{entry.msg}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* HelpBot removed 9.26.0 — the floating assistant bubble sat over the
          bottom-right of every screen, including on top of card actions. */}
    </>
  );
}

// ── HOME SCREEN ───────────────────────────────────────────────────────────
// Legacy HomeScreen REMOVED 9.9.30 — OpsHome replaced it and nothing had
// rendered this in months. ~120 lines of dead nav config that still listed
// screens which no longer exist.

// ── DEEP LINK FINISH ────────────────────────────────────────────────
// Tech opens "📱 Open in Overwatch" link from a calendar event description.
// We fetch the event from Google Calendar and hand it to JobFinishSheet.
// JobFinishSheet writes the time entry, return card if needed, and patches the title.
function DeepLinkFinish({ calendarId, eventId, accessToken, userEmail, userName, onDone }) {
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId || !eventId || !accessToken) return;
    fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        setEvent({
          id: data.id,
          title: data.summary || '(no title)',
          calendarId,
          start: data.start?.dateTime || data.start?.date,
          end: data.end?.dateTime || data.end?.date,
          description: data.description || '',
          location: data.location || '',
        });
      })
      .catch(e => setError(e.message || 'Could not load job'));
  }, [calendarId, eventId, accessToken]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ color: '#e2e8f0', fontSize: 16 }}>Could not load this job.</div>
        <div style={{ color: '#cbd5e1', fontSize: 13, textAlign: 'center' }}>{error}</div>
        <button onClick={onDone} style={{ marginTop: 12, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 20px', cursor: 'pointer' }}>
          Back to home
        </button>
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#cbd5e1', fontSize: 14 }}>Loading job…</div>
      </div>
    );
  }

  return (
    <JobFinishSheet
      event={event}
      accessToken={accessToken}
      userEmail={userEmail}
      userName={userName}
      mode="full"
      onFinished={onDone}
      onCancel={onDone}
    />
  );
}
