// ============================================
// Jovelin - Main App (React Router)
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { CALENDARS, TECH_COLORS, SYNC_CALENDARS } from './config/calendars.js';
import { supabase } from './services/supabase.js';
import { TermsPage, PrivacyPage } from './pages/PublicLegal.jsx';
import { TenantProvider, TenantSwitcher } from './context/TenantContext.jsx';
import { BrandingProvider } from './context/BrandingContext.jsx';
import { UserRoleProvider, useUserRole } from './context/UserRoleContext.jsx';
import FeatureGate from './components/FeatureGate.jsx';
import Settings from './views/Settings.jsx';
import Profitability from './views/Profitability.jsx';
import AdminConsole from './views/AdminConsole.jsx';
import RevokedOverlay from './components/RevokedOverlay.jsx';
import TechCalendar from './views/TechCalendar.jsx';
import OfficeHub from './views/OfficeHub.jsx';
import OpsHome from './views/OpsHome.jsx';
import ThingsToDo from './views/ThingsToDo.jsx';
import OwnerDashboard from './views/OwnerDashboard.jsx';
import CommandCenter from './views/CommandCenter.jsx';
import Estimates from './views/Estimates.jsx';
import Overview from './views/Overview.jsx';
import Revenue from './views/Revenue.jsx';
import Board from './views/Board.jsx';
import CustomerView from './views/CustomerView.jsx';
import EstimatesList from './views/EstimatesList.jsx';
import BillingModule from './views/BillingModule.jsx';
import SidebarLayout from './components/SidebarLayout.jsx';
import Queue from './views/Queue.jsx';
import Billing from './views/Billing.jsx';
import TechWorkToday from './views/TechWorkToday.jsx';
import AdminGap from './views/AdminGap.jsx';
import ReconcileView from './views/ReconcileView.jsx';
import PreviewChanges from './views/PreviewChanges.jsx';
import BoardView from './views/BoardView.jsx';
import Scheduler from './views/Scheduler.jsx';
import SmsTest from './views/SmsTest.jsx';
import Projects from './views/Projects.jsx';
import NewJobModal from './components/NewJobModal.jsx';
import JobFinishSheet from './components/JobFinishSheet.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import QuickNotes from './views/QuickNotes.jsx';
import CustomerHistory from './views/CustomerHistory.jsx';
import CustomerAudit from './views/CustomerAudit.jsx';
import KPIDashboard from './views/KPIDashboard.jsx';
import Unbilled from './views/Unbilled.jsx';
import ShortLink from './views/ShortLink.jsx';
import { StuckAlertGate } from './components/StuckAlerts.jsx';
import { shouldShowGate } from './utils/alertEngine.js';
import BuildLog from './components/BuildLog.jsx';
import { jobDeepLink } from './config/appBase.js';
import { apiFetch } from './services/apiFetch.js';

// Injected at build time by vite.config.js — unique per deploy. It used to
// be a hardcoded '0.1.0' matching a hardcoded version.json, which meant the
// new-version check below could never detect a mismatch and never fired, so
// everyone silently sat on stale bundles until they manually hard-refreshed.
const APP_VERSION = __BUILD_ID__;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
// Two-stage auth: sign-in uses light, non-sensitive scopes only (no Google
// "unverified app" gate, no scary consent screen). Calendar/Gmail scopes are
// requested separately, later, only when someone actually opts in to sync.
const IDENTITY_SCOPES = 'openid email profile';
const CALENDAR_SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const SCOPES = IDENTITY_SCOPES; // kept for any stray references


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

// Roles come from env, not code. VITE_OPERATOR_EMAILS = comma list of operator
// logins; everyone else signs in as a tech. Per-tenant tech identity lives in
// the techs table (name, email, calendar_id) — nothing is hardcoded here.
const OPERATOR_SET = (import.meta.env.VITE_OPERATOR_EMAILS || 'sara@jnbllc.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const USER_CONFIG = Object.fromEntries(
  OPERATOR_SET.map(e => [e, { name: e.split('@')[0], role: 'operator', defaultCalendar: null, defaultView: null }])
);

// Whether this email is allowed into Jovelin AT ALL.
//
// getUserConfig() below hands any unrecognised address a default
// { role: 'tech' } object rather than rejecting it, which meant every
// Google account on the internet could sign in and — with no user_roles
// row — was treated as an unrestricted legacy operator: full navigation
// and the client picker listing every tenant. That was fine when this was
// a single-company app where anyone signing in was staff. It is not fine
// now.
//
// Allowed means one of exactly two things:
//   1. On the legacy operator list (VITE_OPERATOR_EMAILS) — the DRH team
//   2. Has a live, non-revoked row in user_roles — invited through Settings
// Everything else is rejected at sign-in.
// Checked SERVER-side via /api/check-access rather than querying
// user_roles from here. That query only works today because user_roles is
// still readable by the anon key; once tenant-scoped RLS lands, an
// anonymous read returns nothing — and because this check has to run
// before a session exists, every user would look unauthorised and the app
// would lock itself out entirely. The endpoint uses the service role, so
// the front door stays independent of RLS.
async function isAllowedEmail(email) {
  const e = (email || '').toLowerCase();
  if (!e) return false;
  if (OPERATOR_SET.includes(e)) return true; // legacy team, no round trip needed
  try {
    const r = await apiFetch('/api/check-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e }),
    }).then(res => res.json());
    return !!r.allowed;
  } catch (err) {
    // Fail CLOSED. An outage must not become an open door.
    return false;
  }
}

// Identity options for shared logins like info@
function getUserConfig(email) {
  return USER_CONFIG[email?.toLowerCase()] || { name: email?.split('@')[0] || 'User', role: 'tech', defaultCalendar: null, defaultView: null };
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('tech');
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileNav, setIsMobileNav] = useState(typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobileNav(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Email/password auth (Supabase Auth) — parallel to Google sign-in ────
  const [authView, setAuthView] = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authIsPasswordSession, setAuthIsPasswordSession] = useState(false);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const [accessDeniedEmail, setAccessDeniedEmail] = useState(null);
  // Distinct from access-denied: the account IS authorised, but no
  // Supabase session could be established, so the server can't verify it.
  const [sessionFailedEmail, setSessionFailedEmail] = useState(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordSetupError, setPasswordSetupError] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);
  const [defaultCalendar, setDefaultCalendar] = useState(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillLog, setBackfillLog] = useState([]);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAlertGate, setShowAlertGate] = useState(false);
  const [showBuildLog, setShowBuildLog] = useState(false);
  const [forceReload, setForceReload] = useState(false);
  const [forceReloadSeconds, setForceReloadSeconds] = useState(20);

  // Deep link detection — ?cal=X&job=Y at root
  const urlParams = new URLSearchParams(location.search);
  const deepLinkCal = urlParams.get('cal');
  const deepLinkJob = urlParams.get('job');

  const runBackfill = async () => {
    const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
    // Backfill targets come from the env-configured calendar set.
    const CALS = SYNC_CALENDARS.filter(c => c.id).map(c => ({ id: c.id, name: c.name }));
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
          if (desc.includes('juc-e-v2.vercel.app')) { skipped++; continue; }
          const deepLink = jobDeepLink(cal.id, event.id);
          const stripped = desc.replace(/\n*🔗 OPEN IN OVERWATCH:.*$/s, '').replace(/\n*📱 Open in Jovelin:.*$/s, '').trimEnd();
          const newDesc = (stripped ? stripped + '\n\n' : '') + `📱 Open in Jovelin: ${deepLink}`;
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
    if (storedVersion && storedVersion !== APP_VERSION) {
      // New build — show the changelog as an overlay, but DO NOT skip the
      // session + identity restore below. Falling through keeps the user signed
      // in and routed correctly underneath (fixes info@ -> JR identity not
      // firing on version bumps).
      setShowBuildLog(true);
    }
    localStorage.setItem('juce_v4_version', APP_VERSION);

    const storedToken = localStorage.getItem('juce_v4_token');
    const storedEmail = localStorage.getItem('juce_v4_email');
    const storedExpiry = localStorage.getItem('juce_v4_expiry');

    // Restore logic, unchanged — but now only reachable once Google has
    // confirmed the token actually belongs to this email.
    const applyRestoredSession = (email) => {
      const config = getUserConfig(email);
      setAccessToken(storedToken);
      setUserEmail(email);
      setUserRole(config.role);
      setIsSignedIn(true);

      // Identity ("who are you?") and default-calendar pickers were both
      // Overwatch onboarding — a shared-login concept and a Tech 1-6 /
      // Subs / Service Queue calendar chooser, neither of which means
      // anything in Jovelin. Removed; the name comes straight from config.
      setUserName(config.name);
      {
        const savedDefault = localStorage.getItem(`juce_default_cal_${email}`);
        if (savedDefault !== null) setDefaultCalendar(savedDefault === 'null' ? null : savedDefault);
        else setDefaultCalendar(config.defaultCalendar);

        // Navigate to user's default view if at root — but NOT if the URL is
        // carrying a deep link. This line was silently eating every deep link.
        if (config.defaultView && window.location.pathname === '/' && !hasDeepLink()) {
          window.history.replaceState(null, '', `/${config.defaultView}`);
        }
      }
    };

    if (storedToken && storedEmail && storedExpiry) {
      const expiry = new Date(storedExpiry);
      if (expiry > new Date()) {
        // SECURITY: all three of these values live in localStorage and are
        // fully under the control of whoever is sitting at the browser.
        // Their mere presence, plus a future-dated expiry string, used to be
        // enough to be signed in — so anyone could paste three lines into
        // devtools and become any user, including an operator. The token is
        // now verified against Google itself, and the address Google returns
        // must match the one the browser is claiming (otherwise a valid
        // token could be paired with someone else's email to inherit their
        // access). Anything that doesn't check out clears the stored session
        // instead of honouring it.
        (async () => {
          let verifiedEmail = null;
          try {
            const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${storedToken}` },
            });
            if (res.ok) {
              const info = await res.json();
              if (info?.email) verifiedEmail = info.email;
            }
          } catch (e) { /* network failure — treated as unverified */ }

          if (!verifiedEmail || verifiedEmail.toLowerCase() !== storedEmail.toLowerCase()) {
            clearStorage();
          } else if (!(await isAllowedEmail(verifiedEmail))) {
            // Access can be revoked after a session was issued — re-checked
            // on every restore, not just at first sign-in.
            await supabase.auth.signOut().catch(() => {});
            clearStorage();
            setAccessDeniedEmail(verifiedEmail);
          } else {
            applyRestoredSession(verifiedEmail);
          }
          setIsLoading(false);
        })();
        return;
      }
      clearStorage();
    }
    setIsLoading(false);
  }, []);

  // ── AUTH: Supabase session restore (email/password) ─────────────────────
  useEffect(() => {
    let unsub = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (session?.user?.email) {
        const email = session.user.email;
        // Confirmed Supabase behavior (github.com/supabase/supabase/issues/45210):
        // invite and recovery links establish a fully authenticated, PERSISTENT
        // session the moment they're clicked — reacting to the one-time
        // PASSWORD_RECOVERY event alone isn't a real gate, since a fresh tab
        // opened later just finds a valid session and signs in directly,
        // password never set. This checks a flag Jovelin owns instead, on
        // every single session load, not just that one transient event.
        const { data: roleRow } = await supabase.from('user_roles').select('password_set_at').eq('email', email.toLowerCase()).maybeSingle();
        if (roleRow && !roleRow.password_set_at) {
          setUserEmail(email);
          setNeedsPasswordSetup(true);
          setIsLoading(false);
          return;
        }
        const config = getUserConfig(email);
        setUserEmail(email);
        setUserRole(config.role);
        setUserName(config.name);
        setIsSignedIn(true);
        setAuthIsPasswordSession(true);
      }
      const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === 'SIGNED_OUT') return; // handled explicitly by handleSignOut
        // Fires when someone lands via an invite or password-reset link.
        // Supabase's own link DOES establish a real session automatically
        // (that's normal) — but the person still needs to actually set a
        // real password before using the app, which nothing here checked
        // for before. Block entry into the app until they do.
        if (event === 'PASSWORD_RECOVERY') {
          setNeedsPasswordSetup(true);
          if (newSession?.user?.email) setUserEmail(newSession.user.email);
          return;
        }
        if (newSession?.user?.email && authIsPasswordSession) {
          setUserEmail(newSession.user.email);
        }
      });
      unsub = sub?.subscription;
    })();
    return () => unsub?.unsubscribe?.();
  }, []);

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
          setForceReload(true);
        }
      } catch (e) { /* network hiccup, non-fatal, just try again next interval */ }
    };
    if (!import.meta.env.PROD) return; // dev serves a placeholder version.json — don't loop
    const interval = setInterval(checkForNewVersion, 45000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!forceReload) return;
    if (forceReloadSeconds <= 0) { window.location.reload(); return; }
    const t = setTimeout(() => setForceReloadSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [forceReload, forceReloadSeconds]);

  const clearStorage = () => {
    localStorage.removeItem('juce_v4_token');
    localStorage.removeItem('juce_v4_email');
    localStorage.removeItem('juce_v4_expiry');
  };

  // ── AUTH: Google Sign In ────────────────────────────────────────────────
  // Supabase verifies the nonce by hashing what it receives and comparing.
  // So Google must be given the SHA-256 hex of the nonce, while
  // signInWithIdToken is given the raw value. Sending the same string to
  // both fails validation silently.
  const makeNonce = useCallback(async () => {
    const raw = crypto.randomUUID();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hashed = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { raw, hashed };
  }, []);

  const handleSignIn = useCallback(() => {
    // Remember where the user was actually trying to go — e.g. a /board?job=...
    // deep link from an assign-to SMS/email — so sign-in can send them there
    // instead of unconditionally dropping them at '/' or their default view.
    const here = window.location.pathname + window.location.search;
    if (here && here !== '/') {
      sessionStorage.setItem('ow_post_login_path', here);
    }
    sessionStorage.setItem('jovelin_auth_stage', 'identity');
    // A one-time nonce, echoed back inside the id_token, is what stops a
    // token minted for some other site being replayed here.
    makeNonce().then(({ raw, hashed }) => {
    sessionStorage.setItem('jovelin_oidc_nonce', raw);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', window.location.origin);
    // 'id_token token' (OpenID Connect) instead of plain 'token': the access
    // token still drives Calendar and userinfo exactly as before, and the
    // id_token is the verifiable proof of identity Supabase needs to issue
    // a session. Without a Supabase session there is no auth.uid() and no
    // RLS policy can tell who is asking.
    authUrl.searchParams.set('response_type', 'id_token token');
    authUrl.searchParams.set('scope', IDENTITY_SCOPES);
    authUrl.searchParams.set('nonce', hashed); // hashed to Google, raw to Supabase
    authUrl.searchParams.set('prompt', 'select_account');
    window.location.href = authUrl.toString();
    });
  }, [makeNonce]);

  // ── AUTH: Connect Google Calendar (opt-in, asked for after sign-in) ─────
  // Separate request for the sensitive scopes. Anyone can sign in without
  // ever seeing this; it only fires when someone deliberately clicks Connect.
  const handleConnectCalendar = useCallback(() => {
    sessionStorage.setItem('jovelin_auth_stage', 'calendar');
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', window.location.origin);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', CALENDAR_SCOPES);
    authUrl.searchParams.set('prompt', 'consent');
    window.location.href = authUrl.toString();
  }, []);

  // ── AUTH: Handle OAuth redirect ─────────────────────────────────────────
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      const idToken = params.get('id_token');

      if (token) {
        // Establish a real Supabase session from the Google id_token. This
        // used to be fire-and-forget: if the exchange failed, sign-in went
        // ahead anyway and the person ended up inside the app with NO
        // Supabase session, so every request they made went out as `anon`.
        // That was survivable only while the server trusted anyone. It no
        // longer does — /api/qbo/* requires a verifiable identity — so a
        // failed exchange now has to stop sign-in rather than produce an
        // account that silently can't load anything.
        const sessionReady = idToken
          ? (async () => {
              const nonce = sessionStorage.getItem('jovelin_oidc_nonce');
              sessionStorage.removeItem('jovelin_oidc_nonce');
              try {
                const { error } = await supabase.auth.signInWithIdToken({
                  provider: 'google', token: idToken, nonce: nonce || undefined,
                });
                if (error) console.warn('[jovelin] Supabase session not established:', error.message);
                return !error;
              } catch (e) {
                console.warn('[jovelin] Supabase session error:', e?.message || e);
                return false;
              }
            })()
          : Promise.resolve(false);

        // A deep link (e.g. /board?job=...) that required a fresh sign-in —
        // consume it now so it takes priority over the normal defaultView
        // redirect below. Left in place (not removed) only in the rare
        // needsIdentity-without-saved-identity branch, since that case has to
        // pause for an identity pick first and isn't wired to resume the
        // deep link automatically yet.
        const pendingPath = sessionStorage.getItem('ow_post_login_path');

        const authStage = sessionStorage.getItem('jovelin_auth_stage') || 'identity';
        sessionStorage.removeItem('jovelin_auth_stage');

        fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(async data => {
            const email = data.email;

            // Gate: unknown accounts are turned away here rather than
            // being handed a default role and full navigation.
            if (!(await isAllowedEmail(email))) {
              await supabase.auth.signOut().catch(() => {});
              clearStorage();
              setAccessDeniedEmail(email);
              window.history.replaceState(null, '', '/');
              setIsLoading(false);
              return;
            }

            // No Supabase session means no identity the server can verify,
            // which means every screen that reads QuickBooks would come
            // back 401. Fail here, visibly, instead of handing over a
            // half-working app.
            if (!(await sessionReady)) {
              await supabase.auth.signOut().catch(() => {});
              clearStorage();
              setSessionFailedEmail(email);
              window.history.replaceState(null, '', '/');
              setIsLoading(false);
              return;
            }
            // Session lasts 36 hours — token refresh happens silently
            const expiry = new Date(Date.now() + 36 * 60 * 60 * 1000);
            const config = getUserConfig(email);

            localStorage.setItem('juce_v4_token', token);
            localStorage.setItem('juce_v4_email', email);
            localStorage.setItem('juce_v4_expiry', expiry.toISOString());

            setAccessToken(token);
            setUserEmail(email);
            setUserRole(config.role);
            setIsSignedIn(true);

            // Calendar-connect upgrade: someone who was already signed in
            // just granted the sensitive scopes. Swap in the broader token
            // and stop. (Still reachable deliberately from the header for
            // DRH; what's gone is the unsolicited prompt on sign-in.)
            if (authStage === 'calendar') {
              localStorage.setItem('jovelin_calendar_connected', 'true');
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
              return;
            }

            // Identity and default-calendar pickers removed — both were
            // Overwatch onboarding (shared-login "who are you?", and a
            // Tech 1-6 / Subs / Service Queue calendar chooser).
            setUserName(config.name);

            const savedDefault = localStorage.getItem(`juce_default_cal_${email}`);
            setDefaultCalendar(savedDefault !== null
              ? (savedDefault === 'null' ? null : savedDefault)
              : config.defaultCalendar);

            // Deep link takes priority over the normal default-view redirect.
            sessionStorage.removeItem('ow_post_login_path');
            const dest = pendingPath || (config.defaultView ? `/${config.defaultView}` : '/');
            window.history.replaceState(null, '', dest);
            if (dest !== '/') navigate(dest);
          })
          .catch(err => console.error('Auth error:', err));
      }
    }
  }, []);

  const handleSignOut = useCallback(() => {
    if (authIsPasswordSession) {
      supabase.auth.signOut();
      setAuthIsPasswordSession(false);
    }
    clearStorage();
    setAccessToken(null);
    setUserEmail('');
    setUserName('');
    setIsSignedIn(false);
    navigate('/');
  }, [navigate, authIsPasswordSession]);

  // ── AUTH: Email/password sign-in ─────────────────────────────────────────
  const handlePasswordSignIn = useCallback(async (email, password) => {
    setAuthError(''); setAuthMessage(''); setAuthLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    const user = data?.user;
    if (!user?.email) { setAuthError('Sign-in failed — no user returned.'); return; }
    if (!(await isAllowedEmail(user.email))) {
      await supabase.auth.signOut().catch(() => {});
      setAuthError('This account does not have access to Jovelin.');
      return;
    }
    const config = getUserConfig(user.email);
    setUserEmail(user.email);
    setUserRole(config.role);
    setUserName(config.name);
    setIsSignedIn(true);
    setAuthIsPasswordSession(true);
  }, []);

  // ── AUTH: Email/password sign-up ─────────────────────────────────────────
  const handlePasswordSignUp = useCallback(async (email, password) => {
    setAuthError(''); setAuthMessage(''); setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    // Supabase Auth defaults to requiring email confirmation before a session
    // is issued. If a session comes back immediately, confirmation is off
    // (or already satisfied) — sign the person straight in either way.
    if (data?.session?.user?.email) {
      const email2 = data.session.user.email;
      const config = getUserConfig(email2);
      setUserEmail(email2);
      setUserRole(config.role);
      setUserName(config.name);
      setIsSignedIn(true);
      setAuthIsPasswordSession(true);
    } else {
      setAuthMessage('Account created — check your email to confirm, then sign in.');
      setAuthView('signin');
    }
  }, []);

  // ── AUTH: Forgot password ────────────────────────────────────────────────
  const handleForgotPassword = useCallback(async (email) => {
    setAuthError(''); setAuthMessage(''); setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    setAuthMessage('Check your email for a password reset link.');
  }, []);

  const handleBuildLogDismiss = useCallback(() => {
    // Just acknowledge the changelog. Keep the session and identity intact so
    // the user (especially info@ -> JR) stays signed in and on their routed
    // screen instead of being bounced to a re-login as anonymous info@.
    localStorage.setItem('juce_v4_version', APP_VERSION);
    setShowBuildLog(false);
  }, []);

  // ── AUTH: Silent token refresh ────────────────────────────────────────
  // Google tokens expire after ~1hr. Session lasts 36hrs.
  // On 401, silently get a new token via hidden iframe.
  // If silent auth fails, THEN sign out.
  const silentRefresh = useCallback(() => {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', window.location.origin);
      authUrl.searchParams.set('response_type', 'token');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('prompt', 'none'); // silent — no user interaction
      authUrl.searchParams.set('login_hint', userEmail);

      const timeout = setTimeout(() => {
        try { document.body.removeChild(iframe); } catch {}
        resolve(false);
      }, 8000);

      const onMessage = () => {
        try {
          const hash = iframe.contentWindow?.location?.hash;
          if (hash?.includes('access_token')) {
            const params = new URLSearchParams(hash.substring(1));
            const newToken = params.get('access_token');
            if (newToken) {
              localStorage.setItem('juce_v4_token', newToken);
              setAccessToken(newToken);
              clearTimeout(timeout);
              try { document.body.removeChild(iframe); } catch {}
              resolve(true);
              return;
            }
          }
        } catch {} // cross-origin — expected during redirect
      };

      iframe.addEventListener('load', onMessage);
      document.body.appendChild(iframe);
      iframe.src = authUrl.toString();
    });
  }, [userEmail]);

  // ── ALERT GATE: show for JR every 6 hours ──────────────────────────────
  useEffect(() => {
    if (!isSignedIn || !userEmail) return;
    const gated = (import.meta.env.VITE_ALERT_GATE_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (gated.includes(userEmail.toLowerCase()) && shouldShowGate(userEmail)) {
      setShowAlertGate(true);
    }
  }, [isSignedIn, userEmail]);

  // ── AUTH: Session expiry check (36hr) ───────────────────────────────────
  useEffect(() => {
    if (!isSignedIn) return;
    const check = () => {
      const expiry = localStorage.getItem('juce_v4_expiry');
      if (!expiry || new Date(expiry) <= new Date()) {
        handleSignOut(); // 36 hours up — full sign out
      }
    };
    check();
    const interval = setInterval(check, 5 * 60 * 1000); // check every 5 min
    return () => clearInterval(interval);
  }, [isSignedIn, handleSignOut]);

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
            handleSignOut();
          }
        }
      }
      return res;
    };
    return () => { window.fetch = origFetch; };
  }, [isSignedIn, silentRefresh, handleSignOut]);

  // ── ROLE CHECKS ─────────────────────────────────────────────────────────
  const RESTRICTED_EMAILS = (import.meta.env.VITE_RESTRICTED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isRestricted = RESTRICTED_EMAILS.includes(userEmail?.toLowerCase());
  const isOperator = getUserConfig(userEmail).role === 'operator';

  // ── LOADING ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1729' }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/favicon-192x192.png" alt="Jovelin" style={{ width: 84, height: 84, marginBottom: 16, borderRadius: 16 }} />
          <div style={{ color: '#e8a33d', fontSize: '14px' }}>Loading...</div>
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
          Jovelin has updated. This tab is running an old version and needs to reload
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

  // ── BUILD LOG ───────────────────────────────────────────────────────────
  if (showBuildLog) {
    return <BuildLog onDismiss={handleBuildLogDismiss} />;
  }

  // ── PUBLIC PAGES (no auth required, checked before anything else) ────────
  // Needs to be reachable while completely signed out — an Intuit reviewer,
  // or a prospective client, isn't going to have a Jovelin login.
  if (typeof window !== 'undefined' && window.location.pathname === '/terms') return <TermsPage />;
  if (typeof window !== 'undefined' && window.location.pathname === '/privacy') return <PrivacyPage />;

  // ── FORCED PASSWORD SETUP (invite / recovery links) ──────────────────────
  // Takes priority over everything else — a real session exists (Supabase's
  // link did that), but no real password has been set yet.
  if (needsPasswordSetup) {
    const setPassword = async () => {
      if (newPasswordInput.length < 8) { setPasswordSetupError('Password must be at least 8 characters.'); return; }
      setSettingPassword(true); setPasswordSetupError('');
      const { data: sessionData, error } = await supabase.auth.updateUser({ password: newPasswordInput });
      setSettingPassword(false);
      if (error) { setPasswordSetupError(error.message); return; }
      // The real gate — this is what makes the check on every future
      // session load pass. Without this, they'd hit the same screen again
      // next time they sign in, even with a real password now set.
      const email = sessionData?.user?.email;
      if (email) await supabase.from('user_roles').update({ password_set_at: new Date().toISOString() }).eq('email', email.toLowerCase());
      setNeedsPasswordSetup(false);
      setNewPasswordInput('');
      setAuthIsPasswordSession(true);
      setIsSignedIn(true);
    };
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#1e293b', borderRadius: 14, padding: 28, maxWidth: 360, width: '100%' }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Welcome to Jovelin</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 18 }}>Set a password to finish setting up your account.</div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>New password</label>
          <input type="password" autoFocus value={newPasswordInput} onChange={e => setNewPasswordInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setPassword()}
            style={{ width: '100%', padding: '10px 12px', fontSize: 15, background: '#0f1729', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', boxSizing: 'border-box', marginBottom: 12 }} />
          {passwordSetupError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{passwordSetupError}</div>}
          <button onClick={setPassword} disabled={settingPassword} style={{ width: '100%', background: '#e8a33d', color: '#1a1200', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, cursor: 'pointer' }}>
            {settingPassword ? 'Setting…' : 'Set Password & Continue'}
          </button>
        </div>
      </div>
    );
  }

  // ── SESSION COULD NOT BE ESTABLISHED ────────────────────────────────────
  // Authorised account, but the Google id_token never became a Supabase
  // session. Signing them in anyway would produce an app where every
  // financial screen returns 401 with no explanation.
  if (sessionFailedEmail) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#1e293b', borderRadius: 14, padding: 32, maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Couldn't finish signing in</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>
            <b style={{ color: '#cbd5e1' }}>{sessionFailedEmail}</b> is authorised, but a secure session couldn't be created.
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
            Try again. If it keeps happening, sign in with your email and password instead, and tell Sara.
          </div>
          <button onClick={() => { setSessionFailedEmail(null); window.location.href = '/'; }}
            style={{ background: '#0D4F5C', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── ACCESS DENIED ───────────────────────────────────────────────────────
  // A real Google account that simply isn't authorised for this app.
  if (accessDeniedEmail) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#1e293b', borderRadius: 14, padding: 32, maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>No access to Jovelin</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>
            <b style={{ color: '#cbd5e1' }}>{accessDeniedEmail}</b> hasn't been given access.
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
            If you have another account, sign in with that one. Otherwise ask your administrator for an invite.
          </div>
          <button onClick={() => { setAccessDeniedEmail(null); window.location.href = '/'; }}
            style={{ background: '#0D4F5C', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, cursor: 'pointer' }}>
            Try a different account
          </button>
        </div>
      </div>
    );
  }

  // ── LOGIN ───────────────────────────────────────────────────────────────
  if (!isSignedIn) {
    const gold = '#e8a33d'; // Jovelin's signature accent — deliberately NOT Overwatch's gold/cyan
    const Reticle = ({ size, style }) => (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute', opacity: 0.28, pointerEvents: 'none', ...style }}>
        <circle cx="50" cy="50" r="47" fill="none" stroke={gold} strokeWidth="0.7" strokeDasharray="1 3.2" />
        <circle cx="50" cy="50" r="35" fill="none" stroke={gold} strokeWidth="0.6" />
        <circle cx="50" cy="50" r="31" fill="none" stroke={gold} strokeWidth="0.5" strokeDasharray="2 5" />
      </svg>
    );

    return (
      <div style={{
        minHeight: '100vh', minHeight: '100dvh',
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
        <img src="/favicon-192x192.png" alt="Jovelin" style={{
          width: 190, height: 'auto', marginBottom: 26, zIndex: 1,
          filter: 'drop-shadow(0 14px 34px rgba(0,0,0,0.5))',
        }} />

        {/* wordmark */}
        <h1 style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 46, fontWeight: 800, color: '#fff', letterSpacing: 4,
          margin: 0, lineHeight: 1, zIndex: 1,
        }}>JOVELIN</h1>
        <div style={{ width: 132, height: 3, background: gold, borderRadius: 2, margin: '18px 0 16px', zIndex: 1 }} />
        <p style={{ fontSize: 15, color: '#8b97a6', letterSpacing: 3, fontWeight: 600, margin: 0, zIndex: 1 }}>
          FIELD OPERATIONS COMMAND CENTER
        </p>

        {/* shield */}
        <svg width="58" height="58" viewBox="0 0 24 24" fill="none" style={{ margin: '48px 0 26px', zIndex: 1 }}>
          <path d="M12 2.5l7 2.6v5.4c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V5.1l7-2.6z" stroke={gold} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8.8 12.2l2.2 2.2 4-4.4" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 14px', zIndex: 1 }}>
          Smart Security. Real Clarity.
        </h2>
        <p style={{ fontSize: 15, color: '#aeb8c4', margin: '0 0 26px', lineHeight: 1.5, zIndex: 1 }}>
          {authView === 'signup' ? 'Create your account to get started.'
            : authView === 'forgot' ? 'Enter your email and we\'ll send a reset link.'
            : 'Sign in to get started.'}
        </p>

        {/* push form toward the bottom */}
        <div style={{ flex: 1, minHeight: 12 }} />

        <div style={{ width: '100%', maxWidth: 380, zIndex: 1, textAlign: 'left' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</label>
          <input
            type="email" autoComplete="email" value={authEmail}
            onChange={e => setAuthEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: '100%', padding: '14px 16px', fontSize: 15,
              background: 'rgba(255,255,255,0.04)', border: '1px solid #2a3550', borderRadius: 12,
              color: '#fff', marginBottom: 14, boxSizing: 'border-box',
            }}
          />

          {authView !== 'forgot' && (
            <>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>Password</label>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  type={showAuthPassword ? 'text' : 'password'}
                  autoComplete={authView === 'signup' ? 'new-password' : 'current-password'}
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  placeholder="Enter your password"
                  style={{
                    width: '100%', padding: '14px 52px 14px 16px', fontSize: 15,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid #2a3550', borderRadius: 12,
                    color: '#fff', boxSizing: 'border-box',
                  }}
                />
                <button type="button" onClick={() => setShowAuthPassword(v => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#8b97a6', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                >{showAuthPassword ? 'HIDE' : 'SHOW'}</button>
              </div>
            </>
          )}

          {authView === 'signin' && (
            <div style={{ textAlign: 'right', marginBottom: 14 }}>
              <button type="button" onClick={() => { setAuthView('forgot'); setAuthError(''); setAuthMessage(''); }}
                style={{ background: 'none', border: 'none', color: gold, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >Forgot password?</button>
            </div>
          )}

          {authError && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12, lineHeight: 1.4 }}>{authError}</div>}
          {authMessage && <div style={{ color: '#4ade80', fontSize: 13, marginBottom: 12, lineHeight: 1.4 }}>{authMessage}</div>}

          <button
            disabled={authLoading || !authEmail || (authView !== 'forgot' && !authPassword)}
            onClick={() => {
              if (authView === 'signin') handlePasswordSignIn(authEmail, authPassword);
              else if (authView === 'signup') handlePasswordSignUp(authEmail, authPassword);
              else handleForgotPassword(authEmail);
            }}
            style={{
              width: '100%', padding: '16px', fontSize: 16, fontWeight: 700,
              background: gold, color: '#1a1200', border: 'none', borderRadius: 14,
              cursor: 'pointer', marginBottom: 18,
              opacity: (authLoading || !authEmail || (authView !== 'forgot' && !authPassword)) ? 0.55 : 1,
            }}
          >
            {authLoading ? 'Please wait…' : authView === 'signin' ? 'Sign In' : authView === 'signup' ? 'Create Account' : 'Send Reset Link'}
          </button>

          {authView !== 'forgot' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 0 16px' }}>
              <div style={{ flex: 1, height: 1, background: '#2a3550' }} />
              <span style={{ color: '#6b7787', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: '#2a3550' }} />
            </div>
          )}

          {authView !== 'forgot' && (
            <button onClick={handleSignIn} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
              padding: '15px 24px', fontSize: 16, fontWeight: 700,
              background: '#fff', color: '#1B2A4A', border: 'none', borderRadius: 14,
              cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              width: '100%', minHeight: 54,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          )}

          <p style={{ marginTop: 18, fontSize: 14, color: '#8b97a6', textAlign: 'center' }}>
            {authView === 'signin' && (
              <>New here?{' '}
                <button onClick={() => { setAuthView('signup'); setAuthError(''); setAuthMessage(''); }}
                  style={{ background: 'none', border: 'none', color: gold, fontWeight: 700, cursor: 'pointer', fontSize: 14, padding: 0 }}
                >Create an account</button>
              </>
            )}
            {authView === 'signup' && (
              <>Already have an account?{' '}
                <button onClick={() => { setAuthView('signin'); setAuthError(''); setAuthMessage(''); }}
                  style={{ background: 'none', border: 'none', color: gold, fontWeight: 700, cursor: 'pointer', fontSize: 14, padding: 0 }}
                >Sign in</button>
              </>
            )}
            {authView === 'forgot' && (
              <button onClick={() => { setAuthView('signin'); setAuthError(''); setAuthMessage(''); }}
                style={{ background: 'none', border: 'none', color: gold, fontWeight: 700, cursor: 'pointer', fontSize: 14, padding: 0 }}
              >← Back to sign in</button>
            )}
          </p>
        </div>

        <p style={{ marginTop: 20, color: '#6b7787', fontSize: 12, lineHeight: 1.5, zIndex: 1, textAlign: 'center' }}>
          By continuing, you agree to the<br />
          <span style={{ color: gold }}>Terms of Service</span> and <span style={{ color: gold }}>Privacy Policy</span>.
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
        <img src="/favicon-192x192.png" alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
        <span style={{ fontWeight: 700, color: '#e8a33d', fontSize: 14 }}>Jovelin</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>V{APP_VERSION}</span>
        <TenantSwitcher />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{userName}</span>
          {isOperator && (
            <button onClick={() => { setShowBackfill(true); setBackfillLog([]); }}
              style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#f59e0b', padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
            >🔗</button>
          )}
          {localStorage.getItem('jovelin_calendar_connected') !== 'true' && (
            <button onClick={handleConnectCalendar} title="Connect Google Calendar"
              style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
            >📅</button>
          )}
          <button onClick={handleSignOut}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
          >Out</button>
        </div>
      </div>
      <div style={{ paddingBottom: 70 }}>
        {children}
      </div>
    </div>
  );

  // ── ROUTE GUARDS ────────────────────────────────────────────────────────
  // isOperator only knows about the old hardcoded VITE_OPERATOR_EMAILS list —
  // it has no idea tenant_admin/super_admin (the newer, DB-backed role
  // system) exist. Without this, any tenant_admin invited through Settings
  // fails this check and gets sent to '/', which redirects straight back
  // into another OperatorOnly-gated route (/overview) — an actual infinite
  // loop, confirmed as the cause of a real blank-screen report. Redirecting
  // failures to /work (not /) also matters: tenant_user is the one role
  // that's SUPPOSED to fail this check, and /work is the one place they're
  // guaranteed access to, so this can't loop for them either.
  // Every Overwatch-era screen (dashboards, scheduler, dispatch, KPI, the
  // admin tools) predates multi-tenancy entirely: no tenant filtering, and
  // DRH staff names and data baked straight in. They were sitting behind
  // OperatorOnly, which now admits tenant_admin — meaning a tenant admin at
  // any client could navigate to /dashboard or /kpi and be looking at DRH.
  // Locked to super_admin rather than deleted, since they're still useful
  // to Sara and deleting them is a decision to make deliberately, not as a
  // side effect of a security fix.
  const SuperAdminOnly = ({ children }) => {
    const { isSuperAdmin } = useUserRole();
    // isOperator comes from the old VITE_OPERATOR_EMAILS list — DRH's own
    // team. They're the people this data actually belongs to, so they keep
    // access; what's being blocked is a tenant_admin at some other client
    // reaching DRH's screens, and no tenant_admin is on that list.
    return (isSuperAdmin || isOperator) ? children : <Navigate to="/overview" replace />;
  };

  const OperatorOnly = ({ children }) => {
    const { isSuperAdmin, isStaff, roleRow } = useUserRole();
    // Staff belong here: working inside clients is the entire job.
    const hasAccess = isOperator || isSuperAdmin || isStaff || roleRow?.role === 'tenant_admin';
    return hasAccess ? children : <Navigate to="/work" replace />;
  };

  // The admin console approves writes to clients' live books, so it is
  // strictly super_admin — deliberately NOT sharing SuperAdminOnly's
  // allowance for legacy VITE_OPERATOR_EMAILS accounts. That list exists
  // to keep DRH's own team on DRH's old screens; it was never meant to
  // confer authority over other clients' accounting.
  // Admin is now where cross-tenant people choose which client to work in,
  // so staff need in. What they can DO there is gated inside the console
  // itself — the approval queue and anything that changes a client stay
  // super-admin only.
  const AdminOnly = ({ children }) => {
    const { worksAcrossTenants } = useUserRole();
    return worksAcrossTenants ? children : <Navigate to="/overview" replace />;
  };

  // ── ROUTES ──────────────────────────────────────────────────────────────
  return (
    <UserRoleProvider userEmail={userEmail}>
    <TenantProvider>
    <BrandingProvider>
    <>
      <RevokedOverlay onSignOut={handleSignOut} />
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />

        <Route path="/calendar" element={<SuperAdminOnly><ViewShell><TechCalendar accessToken={accessToken} userEmail={userEmail} defaultCalendar={defaultCalendar} isRestricted={isRestricted} isOperator={isOperator} userName={getUserConfig(userEmail).name} /></ViewShell></SuperAdminOnly>} />

        <Route path="/work" element={
          <SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}>
            <TechWorkToday 
              accessToken={accessToken} 
              userEmail={userEmail} 
              userName={getUserConfig(userEmail).name} 
              onBack={() => navigate('/')} 
              showAllTechs={!isRestricted}
            />
          </SidebarLayout>
        } />

        <Route path="/queue" element={<SuperAdminOnly><Queue accessToken={accessToken} onBack={() => navigate('/')} onOpenCustomer={(customerId) => navigate(`/customers?customerId=${encodeURIComponent(customerId)}&returnTo=${encodeURIComponent('/queue')}`)} /></SuperAdminOnly>} />
        <Route path="/billing" element={<OperatorOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="billing"><BillingModule userEmail={userEmail} /></FeatureGate></SidebarLayout></OperatorOnly>} />
        <Route path="/billing-legacy" element={<SuperAdminOnly><Billing accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} /></SuperAdminOnly>} />
        <Route path="/todos" element={<SuperAdminOnly><ThingsToDo accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} /></SuperAdminOnly>} />

        <Route path="/newjob" element={
          <SuperAdminOnly><div style={{ minHeight: '100vh', background: '#0f1729' }}>
            <NewJobModal accessToken={accessToken} userEmail={userEmail} onClose={() => navigate('/')} onCreated={() => navigate('/')} />
          </div></SuperAdminOnly>
        } />

        <Route path="/lifeline" element={
          <SuperAdminOnly><ViewShell>
            <div style={{ padding: 24, textAlign: 'center', marginTop: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔴</div>
              <div style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Lifeline</div>
              <div style={{ color: '#cbd5e1', fontSize: 14 }}>Coming soon.</div>
            </div>
          </ViewShell></SuperAdminOnly>
        } />

        {/* Operator-only */}
        <Route path="/command" element={<SuperAdminOnly><OperatorOnly><ViewShell><CommandCenter accessToken={accessToken} userEmail={userEmail} /></ViewShell></OperatorOnly></SuperAdminOnly>} />
        <Route path="/estimates" element={<OperatorOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="estimates"><EstimatesList /></FeatureGate></SidebarLayout></OperatorOnly>} />
        <Route path="/estimates/:estimateId" element={<OperatorOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="estimates"><Estimates onBack={() => navigate('/estimates')} /></FeatureGate></SidebarLayout></OperatorOnly>} />
        <Route path="/settings" element={<SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="__settings_tenant_user_block"><Settings userEmail={userEmail} /></FeatureGate></SidebarLayout>} />
        <Route path="/customer" element={<OperatorOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><CustomerView userEmail={userEmail} /></SidebarLayout></OperatorOnly>} />
        <Route path="/overview" element={<OperatorOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="overview"><Overview /></FeatureGate></SidebarLayout></OperatorOnly>} />
        <Route path="/admin" element={<AdminOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><AdminConsole userEmail={userEmail} /></SidebarLayout></AdminOnly>} />
        <Route path="/profitability" element={<OperatorOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="profitability"><Profitability onBack={() => navigate('/overview')} /></FeatureGate></SidebarLayout></OperatorOnly>} />
        <Route path="/revenue" element={<OperatorOnly><SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="revenue"><Revenue userEmail={userEmail} onBack={() => navigate('/overview')} /></FeatureGate></SidebarLayout></OperatorOnly>} />
        <Route path="/office" element={<SuperAdminOnly><OperatorOnly><ViewShell><OfficeHub accessToken={accessToken} userEmail={userEmail} userRole="operator" /></ViewShell></OperatorOnly></SuperAdminOnly>} />
        <Route path="/dashboard" element={<SuperAdminOnly><OperatorOnly><ViewShell><OwnerDashboard accessToken={accessToken} userEmail={userEmail} userRole="operator" /></ViewShell></OperatorOnly></SuperAdminOnly>} />
        <Route path="/board" element={<SidebarLayout userName={getUserConfig(userEmail).name} onSignOut={handleSignOut}><FeatureGate featureKey="board"><Board /></FeatureGate></SidebarLayout>} />
        <Route path="/dispatch" element={<SuperAdminOnly><ViewShell><BoardView accessToken={accessToken} userEmail={userEmail} userName={userName} onBack={() => navigate('/')} /></ViewShell></SuperAdminOnly>} />
        <Route path="/scheduler" element={<SuperAdminOnly><ViewShell><Scheduler accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell></SuperAdminOnly>} />
        <Route path="/sms-test" element={<SuperAdminOnly><SmsTest onBack={() => navigate('/')} /></SuperAdminOnly>} />
        <Route path="/projects" element={<SuperAdminOnly><OperatorOnly><ViewShell><Projects accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell></OperatorOnly></SuperAdminOnly>} />
        <Route path="/quicknotes" element={<SuperAdminOnly><QuickNotes accessToken={accessToken} onBack={() => navigate('/')} /></SuperAdminOnly>} />
        <Route path="/customers" element={<SuperAdminOnly><ViewShell><CustomerHistory onBack={() => navigate(urlParams.get('returnTo') || '/')} accessToken={accessToken} userEmail={userEmail} initialCustomerId={urlParams.get('customerId')} /></ViewShell></SuperAdminOnly>} />
        <Route path="/audit" element={<SuperAdminOnly><OperatorOnly><ViewShell><CustomerAudit onBack={() => navigate('/')} accessToken={accessToken} /></ViewShell></OperatorOnly></SuperAdminOnly>} />
        <Route path="/kpi" element={
          <SuperAdminOnly>
            {canSeeKPIs(userEmail)
              ? <ViewShell><KPIDashboard onBack={() => navigate('/')} /></ViewShell>
              : <Navigate to="/" replace />}
          </SuperAdminOnly>
        } />
        <Route path="/j/:code" element={<SuperAdminOnly><ShortLink accessToken={accessToken} userEmail={userEmail} userRole={getUserConfig(userEmail).role} onUpdate={() => {}} /></SuperAdminOnly>} />
        <Route path="/unbilled" element={<SuperAdminOnly><OperatorOnly><ViewShell><Unbilled onBack={() => navigate('/')} userEmail={userEmail} /></ViewShell></OperatorOnly></SuperAdminOnly>} />

        {/* Admin */}
        <Route path="/admin/gap" element={<SuperAdminOnly><OperatorOnly><AdminGap onBack={() => navigate('/')} /></OperatorOnly></SuperAdminOnly>} />
        <Route path="/admin/reconcile" element={<SuperAdminOnly><OperatorOnly><ReconcileView accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} onOpenFinish={(calId, jobId) => navigate(`/?cal=${encodeURIComponent(calId)}&job=${encodeURIComponent(jobId)}`)} onOpenPreview={() => navigate('/admin/preview')} /></OperatorOnly></SuperAdminOnly>} />
        <Route path="/admin/preview" element={<SuperAdminOnly><OperatorOnly><PreviewChanges accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/admin/reconcile')} /></OperatorOnly></SuperAdminOnly>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global bottom nav — present on every screen, not just Home.
          Active tab reflects the REAL current path now, not a hardcoded guess. */}
      {isSignedIn && isMobileNav && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'rgba(7,17,31,0.97)', borderTop:'1px solid #1d2f48', display:'flex', zIndex:150, backdropFilter:'blur(14px)', paddingBottom:'env(safe-area-inset-bottom)' }}>
          {[
            { icon:'🗂️', label:'Board', path:'/board' },
            { icon:'📊', label:'Command', path:'/overview' },
            { icon:'🧾', label:'Estimates', path:'/estimates' },
            { icon:'⏱️', label:'Time', path:'/work' },
            { icon:'💵', label:'Billing', path:'/billing' },
            { icon:'💰', label:'Revenue', path:'/revenue' },
            { icon:'📈', label:'Profit', path:'/profitability' },
          ].map(t => {
            const active = t.path === '/' ? location.pathname === '/' : location.pathname.startsWith(t.path);
            return (
              <button key={t.path} onClick={() => navigate(t.path)}
                style={{ flex:1, minWidth:0, padding:'10px 0 6px', background:'none', border:'none', color: active ? '#e8a33d' : '#8ea0b8', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                <span style={{ fontSize:20 }}>{t.icon}</span>
                <span style={{ fontSize:10, fontWeight:700, whiteSpace:'nowrap' }}>{t.label}</span>
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



      {showBackfill && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '480px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ color: '#e8a33d', fontSize: '16px', fontWeight: '700', margin: 0 }}>🔗 Backfill Deep Links</h2>
              <button onClick={() => setShowBackfill(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ color: '#cbd5e1', fontSize: '12px', margin: '0 0 16px 0' }}>Patches "📱 Open in Jovelin" into all non-completed events from the last 60 days.</p>
            <button onClick={runBackfill} disabled={backfillRunning}
              style={{ background: backfillRunning ? '#334155' : '#e8a33d', color: backfillRunning ? '#64748b' : '#000', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: backfillRunning ? 'not-allowed' : 'pointer', marginBottom: '12px' }}>
              {backfillRunning ? 'Running...' : 'Run Backfill'}
            </button>
            <div style={{ flex: 1, overflowY: 'auto', background: '#0f1729', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8' }}>
              {backfillLog.length === 0 && <span style={{ color: '#94a3b8' }}>Log will appear here...</span>}
              {backfillLog.map((entry, i) => (
                <div key={i} style={{ color: entry.type === 'ok' ? '#22c55e' : entry.type === 'err' ? '#ef4444' : entry.type === 'cal' ? '#e8a33d' : entry.type === 'dim' ? '#475569' : '#e2e8f0' }}>{entry.msg}</div>
              ))}
            </div>
          </div>
        </div>
      )}

    </>
    </BrandingProvider>
    </TenantProvider>
    </UserRoleProvider>
  );
}

// ── HOME SCREEN ───────────────────────────────────────────────────────────
function HomeScreen({ userName, userEmail, isOperator, isRestricted, onNavigate, onSignOut, onBackfill, onSearch }) {
  const techButtons = [
    { path: '/work',    emoji: '📋', label: 'Work To Do Now',  sub: "Today's jobs — log notes + complete",  color: '#22c55e', dark: '#052e16', border: '#16a34a' },
    { path: '/newjob',  emoji: '➕', label: 'New Job',         sub: 'Capture a call or new work',          color: '#e8a33d', dark: '#001a1f', border: '#0891b2' },
  ];
  const operatorButtons = [
    { path: '/work',       emoji: '📋', label: 'Work To Do Now',  sub: "Today's jobs — log notes + complete",    color: '#22c55e', dark: '#052e16', border: '#16a34a' },
    { path: '/board',      emoji: '🗂️', label: 'Board',           sub: 'Projects · Service · Returns · Blocked', color: '#f59e0b', dark: '#2d1a00', border: '#d97706' },
    { path: '/projects',   emoji: '🔨', label: 'Projects',        sub: 'P-numbered jobs — budget vs hours',      color: '#22c55e', dark: '#052e16', border: '#16a34a' },
    { path: '/quicknotes', emoji: '⚡', label: 'Quick Notes',     sub: 'Admin · Sales · Shana — capture & act',  color: '#e8a33d', dark: '#001a1f', border: '#0891b2' },
    { path: '/unbilled',   emoji: '💵', label: 'Unbilled',        sub: "Every unbilled hour and material, by customer", color: '#4ade80', dark: '#052e16', border: '#22c55e' },
    { path: '/calendar',   emoji: '📅', label: 'Calendar',        sub: "See every tech · every job · right now",  color: '#60a5fa', dark: '#172554', border: '#3b82f6' },
    { path: '/dashboard',  emoji: '📊', label: 'Dashboard',       sub: 'The big picture — at a glance',           color: '#c084fc', dark: '#2e1065', border: '#a855f7' },
  ];
  // KPIs tile only appears for Sara — same gate as the route.
  const visibleOperatorButtons = canSeeKPIs(userEmail)
    ? [...operatorButtons, { path: '/kpi', emoji: '📊', label: 'KPIs', sub: "Aging, returns, who is actually moving cards", color: '#f472b6', dark: '#500724', border: '#ec4899' }]
    : operatorButtons;
  const buttons = isRestricted ? techButtons : visibleOperatorButtons;
  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid #1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/favicon-192x192.png" alt="" style={{ width: 30, height: 30, borderRadius: 7 }} />
          <span style={{ fontWeight: 700, color: '#e8a33d', fontSize: 16 }}>Jovelin</span>
          <span style={{ color: '#94a3b8', fontSize: 11 }}>V{APP_VERSION}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{userName}</span>
          {isOperator && (
            <button onClick={onBackfill}
              style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#f59e0b', padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
            >🔗</button>
          )}
          <button onClick={onSignOut}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
          >Out</button>
        </div>
      </div>

      <div style={{ padding: '20px 20px 8px', textAlign: 'center' }}>
        <div style={{ color: '#cbd5e1', fontSize: 13 }}>Good to see you,</div>
        <div style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, marginTop: 4 }}>{userName}</div>
      </div>

      <div style={{ padding: '0 20px 12px' }}>
        <button onClick={onSearch} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
          padding: '12px 16px', cursor: 'pointer', textAlign: 'left'
        }}>
          <span style={{ fontSize: 16 }}>🔍</span>
          <span style={{ color: '#94a3b8', fontSize: 14 }}>Search customers, jobs, materials…</span>
        </button>
      </div>

      <div style={{ padding: '8px 20px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {buttons.map(({ path, emoji, label, sub, color, dark, border }) => (
          <button key={path} onClick={() => onNavigate(path)} style={{
            background: dark, border: `1px solid ${border}`,
            borderRadius: 16, padding: '22px 20px',
            textAlign: 'left', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 18,
          }}>
            <span style={{ fontSize: 36 }}>{emoji}</span>
            <div>
              <div style={{ color, fontSize: 18, fontWeight: 700 }}>{label}</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>{sub}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: border, fontSize: 20 }}>›</span>
          </button>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {(isRestricted ? [
            { path: '/calendar', label: '📅 Calendar' },
          ] : [
            { path: '/unbilled', label: '💵 Unbilled' },
            { path: '/newjob',  label: '➕ New Job' },
          ]).map(({ path, label }) => (
            <button key={path} onClick={() => onNavigate(path)} style={{
              flex: 1, background: '#1e293b', border: '1px solid #334155',
              borderRadius: 10, padding: '10px 8px', color: '#94a3b8',
              fontSize: 12, fontWeight: 600, cursor: 'pointer'
            }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── DEEP LINK FINISH ────────────────────────────────────────────────
// Tech opens "📱 Open in Jovelin" link from a calendar event description.
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
