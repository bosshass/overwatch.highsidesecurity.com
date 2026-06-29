// ============================================
// Overwatch - Main App (React Router)
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { CALENDARS, TECH_COLORS } from './config/calendars.js';
import TechCalendar from './views/TechCalendar.jsx';
import OfficeHub from './views/OfficeHub.jsx';
import OpsHome from './views/OpsHome.jsx';
import ThingsToDo from './views/ThingsToDo.jsx';
import OwnerDashboard from './views/OwnerDashboard.jsx';
import CommandCenter from './views/CommandCenter.jsx';
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
import HelpBot from './components/HelpBot.jsx';
import QuickGuide from './components/QuickGuide.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import QuickNotes from './views/QuickNotes.jsx';
import CustomerHistory from './views/CustomerHistory.jsx';
import CustomerAudit from './views/CustomerAudit.jsx';
import { StuckAlertGate } from './components/StuckAlerts.jsx';
import { shouldShowGate } from './utils/alertEngine.js';
import BuildLog from './components/BuildLog.jsx';

const APP_VERSION = '8.2.0';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly';

const USER_CONFIG = {
  'drhservicetech1@gmail.com':       { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: null },
  'austin@drhsecurityservices.com':   { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: null },
  'jr@drhsecurityservices.com':       { name: 'JR',     role: 'tech',     defaultCalendar: 'JR', defaultView: null },
  'brian@drhsecurityservices.com':    { name: 'Brian',  role: 'tech',     defaultCalendar: 'Brian', defaultView: null },
  'info@drhsecurityservices.com':     { name: null,     role: 'operator', defaultCalendar: null, defaultView: null, needsIdentity: true },
  'sara@jnbllc.com':                  { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: null },
  'shanaparks@drhsecurityservices.com': { name: 'Shana', role: 'operator', defaultCalendar: 'Shana', defaultView: 'board' },
  'admin@jnbservice.com':             { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: null },
  'trevor@drhsecurityservices.com':    { name: 'Trevor', role: 'tech',     defaultCalendar: 'Installations', defaultView: null },
  'subs@drhsecurityservices.com':      { name: 'Subs',   role: 'tech',     defaultCalendar: 'Subs', defaultView: null },
  'accounting@drhsecurityservices.com': { name: 'Accounting', role: 'operator', defaultCalendar: null, defaultView: 'billing' },
};

// Identity options for shared logins like info@
const IDENTITY_OPTIONS = [
  { key: 'Sara', label: 'Sara', defaultCalendar: null, defaultView: null },
  { key: 'JR', label: 'JR', defaultCalendar: 'JR', defaultView: 'dashboard' },
  { key: 'Shana', label: 'Shana', defaultCalendar: 'Shana', defaultView: 'board' },
];

const CALENDAR_OPTIONS = [
  { key: null, label: 'All Calendars' },
  { key: 'Austin', label: 'Austin' },
  { key: 'JR', label: 'JR' },
  { key: 'Brian', label: 'Brian' },
  { key: 'Sara', label: 'Sara' },
  { key: 'Shana', label: 'Shana' },
  { key: 'Subs', label: 'Subs' },
  { key: 'Service Queue', label: 'Service Queue' },
  { key: 'Installations', label: 'Installations' },
];

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
  const [showSetup, setShowSetup] = useState(false);
  const [defaultCalendar, setDefaultCalendar] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillLog, setBackfillLog] = useState([]);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [showIdentityPicker, setShowIdentityPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAlertGate, setShowAlertGate] = useState(false);
  const [showBuildLog, setShowBuildLog] = useState(false);

  // Deep link detection — ?cal=X&job=Y at root
  const urlParams = new URLSearchParams(location.search);
  const deepLinkCal = urlParams.get('cal');
  const deepLinkJob = urlParams.get('job');

  const runBackfill = async () => {
    const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
    const JUCE_BASE = 'https://juc-e-v2.vercel.app';
    const CALS = [
      { id: 'de3d433f5c6c6a85f5474648e005cac43529d5bed542b74675a37a30cf0ece91@group.calendar.google.com', name: 'Tentatively Scheduled' },
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
          if (desc.includes('juc-e-v2.vercel.app') && !desc.includes('overwatch.highsidesecurity.com')) { skipped++; continue; }
          const deepLink = `${JUCE_BASE}/?cal=${encodeURIComponent(cal.id)}&job=${encodeURIComponent(event.id)}`;
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
    if (storedVersion && storedVersion !== APP_VERSION) {
      // New build detected — show changelog, clear session only after user taps "Got it"
      setShowBuildLog(true);
      setIsLoading(false);
      return;
    }
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
              if (identity.defaultView && window.location.pathname === '/') {
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
          
          // Navigate to user's default view if at root
          if (config.defaultView && window.location.pathname === '/') {
            window.history.replaceState(null, '', `/${config.defaultView}`);
          }
        }
      } else {
        clearStorage();
      }
    }
    setIsLoading(false);
  }, []);

  const clearStorage = () => {
    localStorage.removeItem('juce_v4_token');
    localStorage.removeItem('juce_v4_email');
    localStorage.removeItem('juce_v4_expiry');
  };

  // ── AUTH: Google Sign In ────────────────────────────────────────────────
  const handleSignIn = useCallback(() => {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', window.location.origin);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('prompt', 'select_account');
    window.location.href = authUrl.toString();
  }, []);

  // ── AUTH: Handle OAuth redirect ─────────────────────────────────────────
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');

      if (token) {
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
                  if (identity.defaultView) {
                    window.history.replaceState(null, '', `/${identity.defaultView}`);
                    navigate(`/${identity.defaultView}`);
                  } else {
                    window.history.replaceState(null, '', '/');
                  }
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

              const guideKey = `juce_guide_${email}`;
              if (!localStorage.getItem(guideKey)) {
                localStorage.setItem(guideKey, 'seen');
                setShowGuide(true);
              }

              // Navigate to user's default view if set
              if (config.defaultView) {
                window.history.replaceState(null, '', `/${config.defaultView}`);
                navigate(`/${config.defaultView}`);
              } else {
                window.history.replaceState(null, '', '/');
              }
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

  const handleBuildLogDismiss = useCallback(() => {
    localStorage.removeItem('juce_v4_token');
    localStorage.removeItem('juce_v4_email');
    localStorage.removeItem('juce_v4_expiry');
    localStorage.removeItem('juce_v4_view');
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
  const RESTRICTED_EMAILS = ['drhservicetech1@gmail.com', 'austin@drhsecurityservices.com', 'brian@drhsecurityservices.com', 'trevor@drhsecurityservices.com', 'subs@drhsecurityservices.com'];
  const isRestricted = RESTRICTED_EMAILS.includes(userEmail?.toLowerCase());
  const isOperator = getUserConfig(userEmail).role === 'operator';

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

  // ── BUILD LOG ───────────────────────────────────────────────────────────
  if (showBuildLog) {
    return <BuildLog onDismiss={handleBuildLogDismiss} />;
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
        <span style={{ color: '#475569', fontSize: 11 }}>V8.2</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{userName}</span>
          {isOperator && (
            <button onClick={() => { setShowBackfill(true); setBackfillLog([]); }}
              style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#f59e0b', padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
            >🔗</button>
          )}
          <button onClick={() => setShowGuide(true)}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#00c8e8', padding: '4px 8px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >?</button>
          <button onClick={handleSignOut}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
          >Out</button>
        </div>
      </div>
      {children}
    </div>
  );

  // ── ROUTE GUARDS ────────────────────────────────────────────────────────
  const OperatorOnly = ({ children }) => isOperator ? children : <Navigate to="/" replace />;

  // ── ROUTES ──────────────────────────────────────────────────────────────
  return (
    <>
      <Routes>
        <Route path="/" element={
          <OpsHome userName={userName} isOperator={isOperator} isRestricted={isRestricted} accessToken={accessToken} userEmail={userEmail} onNavigate={navigate} onSignOut={handleSignOut} onBackfill={() => { setShowBackfill(true); setBackfillLog([]); }} onSearch={() => setShowSearch(true)} />
        } />

        <Route path="/calendar" element={<ViewShell><TechCalendar accessToken={accessToken} userEmail={userEmail} defaultCalendar={defaultCalendar} isRestricted={isRestricted} isOperator={isOperator} userName={getUserConfig(userEmail).name} /></ViewShell>} />

        <Route path="/work" element={
          <TechWorkToday 
            accessToken={accessToken} 
            userEmail={userEmail} 
            userName={getUserConfig(userEmail).name} 
            onBack={() => navigate('/')} 
            showAllTechs={!isRestricted}
          />
        } />

        <Route path="/queue" element={<Queue accessToken={accessToken} onBack={() => navigate('/')} />} />
        <Route path="/billing" element={<Billing accessToken={accessToken} onBack={() => navigate('/')} />} />
        <Route path="/todos" element={<ThingsToDo accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} />} />

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
              <div style={{ color: '#64748b', fontSize: 14 }}>Coming soon.</div>
            </div>
          </ViewShell>
        } />

        {/* Operator-only */}
        <Route path="/command" element={<OperatorOnly><ViewShell><CommandCenter accessToken={accessToken} userEmail={userEmail} /></ViewShell></OperatorOnly>} />
        <Route path="/office" element={<OperatorOnly><ViewShell><OfficeHub accessToken={accessToken} userEmail={userEmail} userRole="operator" /></ViewShell></OperatorOnly>} />
        <Route path="/dashboard" element={<OperatorOnly><ViewShell><OwnerDashboard accessToken={accessToken} userEmail={userEmail} userRole="operator" /></ViewShell></OperatorOnly>} />
        <Route path="/board" element={<ViewShell><BoardView accessToken={accessToken} userEmail={userEmail} userName={userName} onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/scheduler" element={<ViewShell><Scheduler accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/sms-test" element={<SmsTest onBack={() => navigate('/')} />} />
        <Route path="/projects" element={<OperatorOnly><ViewShell><Projects accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell></OperatorOnly>} />
        <Route path="/quicknotes" element={<QuickNotes accessToken={accessToken} onBack={() => navigate('/')} />} />
        <Route path="/customers" element={<ViewShell><CustomerHistory onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/audit" element={<OperatorOnly><ViewShell><CustomerAudit onBack={() => navigate('/')} /></ViewShell></OperatorOnly>} />

        {/* Admin */}
        <Route path="/admin/gap" element={<OperatorOnly><AdminGap onBack={() => navigate('/')} /></OperatorOnly>} />
        <Route path="/admin/reconcile" element={<OperatorOnly><ReconcileView accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} onOpenFinish={(calId, jobId) => navigate(`/?cal=${encodeURIComponent(calId)}&job=${encodeURIComponent(jobId)}`)} onOpenPreview={() => navigate('/admin/preview')} /></OperatorOnly>} />
        <Route path="/admin/preview" element={<OperatorOnly><PreviewChanges accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/admin/reconcile')} /></OperatorOnly>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

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
            <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>👋</div>
            <h2 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', textAlign: 'center', margin: '0 0 4px 0' }}>Who are you?</h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: '0 0 20px 0' }}>Select your identity for this session</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {IDENTITY_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => {
                    localStorage.setItem(`juce_identity_${userEmail}`, opt.key);
                    setUserName(opt.key);
                    setDefaultCalendar(opt.defaultCalendar);
                    setShowIdentityPicker(false);
                    if (opt.defaultView) {
                      navigate(`/${opt.defaultView}`);
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
            <p style={{ color: '#64748b', fontSize: '12px', margin: '0 0 16px 0' }}>Patches "📱 Open in Overwatch" into all non-completed events from the last 60 days.</p>
            <button onClick={runBackfill} disabled={backfillRunning}
              style={{ background: backfillRunning ? '#334155' : '#00c8e8', color: backfillRunning ? '#64748b' : '#000', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: backfillRunning ? 'not-allowed' : 'pointer', marginBottom: '12px' }}>
              {backfillRunning ? 'Running...' : 'Run Backfill'}
            </button>
            <div style={{ flex: 1, overflowY: 'auto', background: '#0f1729', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8' }}>
              {backfillLog.length === 0 && <span style={{ color: '#475569' }}>Log will appear here...</span>}
              {backfillLog.map((entry, i) => (
                <div key={i} style={{ color: entry.type === 'ok' ? '#22c55e' : entry.type === 'err' ? '#ef4444' : entry.type === 'cal' ? '#00c8e8' : entry.type === 'dim' ? '#475569' : '#e2e8f0' }}>{entry.msg}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <HelpBot userEmail={userEmail} currentView={location.pathname} userName={getUserConfig(userEmail).name} userRole={getUserConfig(userEmail).role} />
      {showGuide && <QuickGuide onClose={() => setShowGuide(false)} />}
    </>
  );
}

// ── HOME SCREEN ───────────────────────────────────────────────────────────
function HomeScreen({ userName, isOperator, isRestricted, onNavigate, onSignOut, onBackfill, onSearch }) {
  const techButtons = [
    { path: '/work',    emoji: '📋', label: 'Work To Do Now',  sub: "Today's jobs — log notes + complete",  color: '#22c55e', dark: '#052e16', border: '#16a34a' },
    { path: '/newjob',  emoji: '➕', label: 'New Job',         sub: 'Capture a call or new work',          color: '#00c8e8', dark: '#001a1f', border: '#0891b2' },
  ];
  const operatorButtons = [
    { path: '/work',       emoji: '📋', label: 'Work To Do Now',  sub: "Today's jobs — log notes + complete",    color: '#22c55e', dark: '#052e16', border: '#16a34a' },
    { path: '/board',      emoji: '🗂️', label: 'Board',           sub: 'Projects · Service · Returns · Blocked', color: '#f59e0b', dark: '#2d1a00', border: '#d97706' },
    { path: '/projects',   emoji: '🔨', label: 'Projects',        sub: 'P-numbered jobs — budget vs hours',      color: '#22c55e', dark: '#052e16', border: '#16a34a' },
    { path: '/quicknotes', emoji: '⚡', label: 'Quick Notes',     sub: 'Admin · Sales · Shana — capture & act',  color: '#00c8e8', dark: '#001a1f', border: '#0891b2' },
    { path: '/calendar',   emoji: '📅', label: 'Calendar',        sub: "See every tech · every job · right now",  color: '#60a5fa', dark: '#172554', border: '#3b82f6' },
    { path: '/dashboard',  emoji: '📊', label: 'Dashboard',       sub: 'The big picture — at a glance',           color: '#c084fc', dark: '#2e1065', border: '#a855f7' },
  ];
  const buttons = isRestricted ? techButtons : operatorButtons;
  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid #1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/overwatch-logo.png" alt="" style={{ width: 30, height: 30, borderRadius: 7 }} />
          <span style={{ fontWeight: 700, color: '#00c8e8', fontSize: 16 }}>Overwatch</span>
          <span style={{ color: '#475569', fontSize: 11 }}>V8.2</span>
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
        <div style={{ color: '#64748b', fontSize: 13 }}>Good to see you,</div>
        <div style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, marginTop: 4 }}>{userName}</div>
      </div>

      <div style={{ padding: '0 20px 12px' }}>
        <button onClick={onSearch} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
          padding: '12px 16px', cursor: 'pointer', textAlign: 'left'
        }}>
          <span style={{ fontSize: 16 }}>🔍</span>
          <span style={{ color: '#475569', fontSize: 14 }}>Search customers, jobs, materials…</span>
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
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{sub}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: border, fontSize: 20 }}>›</span>
          </button>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {(isRestricted ? [
            { path: '/calendar', label: '📅 Calendar' },
          ] : [
            { path: '/billing', label: '💰 Billing' },
            { path: '/newjob',  label: '➕ New Job' },
          ]).map(({ path, label }) => (
            <button key={path} onClick={() => onNavigate(path)} style={{
              flex: 1, background: '#1e293b', border: '1px solid #334155',
              borderRadius: 10, padding: '10px 8px', color: '#475569',
              fontSize: 12, fontWeight: 600, cursor: 'pointer'
            }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
        <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center' }}>{error}</div>
        <button onClick={onDone} style={{ marginTop: 12, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 20px', cursor: 'pointer' }}>
          Back to home
        </button>
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading job…</div>
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
