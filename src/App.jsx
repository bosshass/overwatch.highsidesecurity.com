// ============================================
// Overwatch - Main App (React Router)
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { CALENDARS, TECH_COLORS } from './config/calendars.js';
import TechCalendar from './views/TechCalendar.jsx';
import OfficeHub from './views/OfficeHub.jsx';
import ThingsToDo from './views/ThingsToDo.jsx';
import JobStatus from './views/JobStatus.jsx';
import OwnerDashboard from './views/OwnerDashboard.jsx';
import CommandCenter from './views/CommandCenter.jsx';
import Queue from './views/Queue.jsx';
import Billing from './views/Billing.jsx';
import TechWorkToday from './views/TechWorkToday.jsx';
import AdminGap from './views/AdminGap.jsx';
import BoardView from './views/BoardView.jsx';
import Scheduler from './views/Scheduler.jsx';
import NewJobModal from './components/NewJobModal.jsx';
import CompletionModal from './components/CompletionModal.jsx';
import HelpBot from './components/HelpBot.jsx';
import QuickGuide from './components/QuickGuide.jsx';
import NotificationBell from './components/NotificationBell.jsx';

const APP_VERSION = '6.1.0';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly';

const USER_CONFIG = {
  'drhservicetech1@gmail.com':       { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: null },
  'austin@drhsecurityservices.com':   { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: null },
  'jr@drhsecurityservices.com':       { name: 'JR',     role: 'tech',     defaultCalendar: 'JR', defaultView: null },
  'info@drhsecurityservices.com':     { name: null,     role: 'operator', defaultCalendar: null, defaultView: null, needsIdentity: true },
  'sara@jnbllc.com':                  { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: null },
  'shanaparks@drhsecurityservices.com': { name: 'Shana', role: 'operator', defaultCalendar: 'Shana', defaultView: 'board' },
  'admin@jnbservice.com':             { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: null },
  'trevor@drhsecurityservices.com':    { name: 'Trevor', role: 'tech',     defaultCalendar: 'Installations', defaultView: null },
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
  { key: 'Sara', label: 'Sara' },
  { key: 'Shana', label: 'Shana' },
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
      localStorage.removeItem('juce_v4_token');
      localStorage.removeItem('juce_v4_email');
      localStorage.removeItem('juce_v4_expiry');
      localStorage.removeItem('juce_v4_view');
      localStorage.setItem('juce_v4_version', APP_VERSION);
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
  const RESTRICTED_EMAILS = ['drhservicetech1@gmail.com', 'austin@drhsecurityservices.com', 'trevor@drhsecurityservices.com'];
  const isRestricted = RESTRICTED_EMAILS.includes(userEmail?.toLowerCase());
  const isOperator = getUserConfig(userEmail).role === 'operator';

  // ── LOADING ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1729' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛡️</div>
          <div style={{ color: '#00c8e8', fontSize: '14px' }}>Loading...</div>
        </div>
      </div>
    );
  }

  // ── LOGIN ───────────────────────────────────────────────────────────────
  if (!isSignedIn) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f1729 0%, #1a2332 100%)', padding: '20px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: '64px', marginBottom: '20px' }}>🛡️</div>
          <h1 style={{ fontSize: '28px', marginBottom: '8px', color: '#fff' }}>DRH Security</h1>
          <p style={{ fontSize: '16px', color: '#00c8e8' }}>Overwatch</p>
        </div>
        <button onClick={handleSignIn} style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '16px 32px', fontSize: '16px', fontWeight: '600',
          background: 'white', color: '#333', border: 'none',
          borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
        <p style={{ marginTop: '24px', color: '#666', fontSize: '12px' }}>v{APP_VERSION}</p>
      </div>
    );
  }

  // ── DEEP LINK: ?cal=X&job=Y → Completion Modal ─────────────────────────
  if (deepLinkCal && deepLinkJob) {
    return (
      <CompletionModal
        calendarId={deepLinkCal}
        eventId={deepLinkJob}
        accessToken={accessToken}
        userEmail={userEmail}
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
        <span style={{ fontSize: 18 }}>🛡️</span>
        <span style={{ fontWeight: 700, color: '#00c8e8', fontSize: 14 }}>Overwatch</span>
        <span style={{ color: '#475569', fontSize: 11 }}>V6</span>
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
          <HomeScreen userName={userName} isOperator={isOperator} isRestricted={isRestricted} onNavigate={navigate} onSignOut={handleSignOut} onBackfill={() => { setShowBackfill(true); setBackfillLog([]); }} />
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
        <Route path="/jobs" element={<JobStatus onBack={() => navigate('/')} />} />

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
        <Route path="/board" element={<ViewShell><BoardView accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/scheduler" element={<ViewShell><Scheduler accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell>} />

        {/* Admin */}
        <Route path="/admin/gap" element={<OperatorOnly><AdminGap onBack={() => navigate('/')} /></OperatorOnly>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

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
function HomeScreen({ userName, isOperator, isRestricted, onNavigate, onSignOut, onBackfill }) {
  const allButtons = [
    { path: '/work',    emoji: '📋', label: 'Work To Do Now',  sub: "Today's jobs — log notes + complete",  color: '#22c55e', dark: '#052e16', border: '#16a34a', techVisible: true },
    { path: '/board',   emoji: '🗂️', label: 'Board',           sub: 'Projects · Service · Returns · Blocked', color: '#f59e0b', dark: '#2d1a00', border: '#d97706', techVisible: false },
    { path: '/billing', emoji: '💰', label: 'Billing',         sub: 'Ready to invoice',                    color: '#a78bfa', dark: '#1e0a3c', border: '#7c3aed', techVisible: false },
    { path: '/newjob',  emoji: '➕', label: 'New Job',         sub: 'Capture a call or new work',          color: '#00c8e8', dark: '#001a1f', border: '#0891b2', techVisible: true },
  ];
  const buttons = isRestricted ? allButtons.filter(b => b.techVisible) : allButtons;
  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid #1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22 }}>🛡️</span>
          <span style={{ fontWeight: 700, color: '#00c8e8', fontSize: 16 }}>Overwatch</span>
          <span style={{ color: '#475569', fontSize: 11 }}>V6</span>
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

      <div style={{ padding: '32px 20px 16px', textAlign: 'center' }}>
        <div style={{ color: '#64748b', fontSize: 13 }}>Good to see you,</div>
        <div style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 700, marginTop: 4 }}>{userName}</div>
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
          {[
            { path: '/calendar', label: '📅 Calendar' },
            ...(isOperator ? [{ path: '/dashboard', label: '📊 Dashboard' }] : []),
          ].map(({ path, label }) => (
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
