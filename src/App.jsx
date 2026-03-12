// ============================================
// Overwatch V3 - Main App
// ============================================
// Role-based views. Owner sees Dashboard first.
// Techs see Today's Jobs first.
// "Useful first, strict never"
// ============================================

import { useState, useEffect, useCallback } from 'react';
import TechCalendar from './views/TechCalendar.jsx';
import TechTodayView from './views/TechTodayView.jsx';
import OfficeHub from './views/OfficeHub.jsx';
import OwnerDashboard from './views/OwnerDashboard.jsx';
import HelpBot from './components/HelpBot.jsx';
import QuickGuide from './components/QuickGuide.jsx';
import NotificationBell from './components/NotificationBell.jsx';

// ============================================
// VERSION — bump to force re-login for all users
// ============================================
const APP_VERSION = '3.0.0';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly';

// ============================================
// USER CONFIG
// ============================================
// role: 'owner' | 'tech' | 'operator'
// defaultView: what they see when they open the app
// ============================================

const USER_CONFIG = {
  // Owner / JR
  'jr@drhsecurityservices.com':         { name: 'JR',     role: 'owner',    defaultView: 'dashboard', defaultCalendar: null },

  // Field Techs
  'austin@drhsecurityservices.com':     { name: 'Austin', role: 'tech',     defaultView: 'today',     defaultCalendar: 'Austin' },
  'drhservicetech1@gmail.com':          { name: 'Austin', role: 'tech',     defaultView: 'today',     defaultCalendar: 'Austin' },

  // Legacy / fallback
  'info@drhsecurityservices.com':       { name: 'Office', role: 'operator', defaultView: 'calendar',  defaultCalendar: null },
  'sara@jnbllc.com':                    { name: 'Sara',   role: 'operator', defaultView: 'calendar',  defaultCalendar: null },
  'admin@jnbservice.com':               { name: 'Sara',   role: 'operator', defaultView: 'calendar',  defaultCalendar: null },
  'trevor@drhsecurityservices.com':     { name: 'Trevor', role: 'tech',     defaultView: 'today',     defaultCalendar: 'Installations' },
};

function getUserConfig(email) {
  return USER_CONFIG[email?.toLowerCase()] || {
    name: email?.split('@')[0] || 'User',
    role: 'tech',
    defaultView: 'today',
    defaultCalendar: null
  };
}

// ============================================
// CALENDAR OPTIONS
// ============================================
const CALENDAR_OPTIONS = [
  { key: null, label: 'All Calendars' },
  { key: 'Austin', label: 'Austin' },
  { key: 'JR', label: 'JR' },
  { key: 'Service Queue', label: 'Service Queue' },
  { key: 'Installations', label: 'Installations' },
];

// ============================================
// PIN GATE MODAL
// ============================================
const PRESET_PINS = {
  'austin@drhsecurityservices.com': '56174',
  'drhservicetech1@gmail.com': '56174',
  'trevor@drhsecurityservices.com': '56174',
};

function PinModal({ userEmail, onUnlock, onCancel }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('check');
  const pinKey = `overwatch_pin_${userEmail}`;
  const presetPin = PRESET_PINS[userEmail?.toLowerCase()];

  useEffect(() => {
    if (presetPin) {
      setPhase('enter');
    } else {
      const stored = localStorage.getItem(pinKey);
      setPhase(stored ? 'enter' : 'create');
    }
  }, [pinKey, presetPin]);

  const handleSubmit = () => {
    if (phase === 'create') {
      if (pin.length < 4) { setError('PIN must be at least 4 digits'); return; }
      if (!/^\d+$/.test(pin)) { setError('Numbers only'); return; }
      setPhase('confirm');
      setConfirmPin('');
      setError('');
      return;
    }
    if (phase === 'confirm') {
      if (confirmPin !== pin) { setError("PINs don't match — try again"); setPhase('create'); setPin(''); setConfirmPin(''); return; }
      localStorage.setItem(pinKey, pin);
      onUnlock();
      return;
    }
    if (phase === 'enter') {
      const correctPin = presetPin || localStorage.getItem(pinKey);
      if (pin === correctPin) { onUnlock(); return; }
      setError('Wrong PIN');
      setPin('');
    }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleSubmit(); };
  const titles = { create: '🔒 Set Your PIN', confirm: '🔒 Confirm PIN', enter: '🔒 Enter PIN' };
  const placeholders = { create: 'Choose a 4+ digit PIN', confirm: 'Confirm your PIN', enter: 'Enter PIN' };

  if (phase === 'check') return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#1e293b', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '320px', textAlign: 'center' }}>
        <div style={{ fontSize: '24px', fontWeight: '700', color: '#e2e8f0', marginBottom: '8px' }}>{titles[phase]}</div>
        <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '24px' }}>
          {phase === 'create' && 'This PIN protects Office & Dashboard.'}
          {phase === 'confirm' && 'Type it again to confirm.'}
          {phase === 'enter' && 'PIN required to access this area.'}
        </p>

        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          autoFocus
          value={phase === 'confirm' ? confirmPin : pin}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, '');
            if (phase === 'confirm') setConfirmPin(v);
            else setPin(v);
            setError('');
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholders[phase]}
          style={{
            width: '100%', background: '#0f1729', border: `2px solid ${error ? '#ef4444' : '#334155'}`,
            borderRadius: '12px', color: '#e2e8f0', padding: '16px', fontSize: '24px',
            textAlign: 'center', letterSpacing: '8px', outline: 'none', boxSizing: 'border-box'
          }}
        />

        {error && <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button onClick={onCancel} style={{
            flex: 1, background: '#334155', color: '#94a3b8', border: 'none',
            borderRadius: '10px', padding: '14px', fontSize: '14px', cursor: 'pointer'
          }}>Cancel</button>
          <button onClick={handleSubmit} style={{
            flex: 1, background: '#00c8e8', color: '#000', border: 'none',
            borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer'
          }}>{phase === 'enter' ? 'Unlock' : phase === 'confirm' ? 'Confirm' : 'Next'}</button>
        </div>

        {phase === 'enter' && !presetPin && (
          <button onClick={() => {
            if (window.confirm("Reset your PIN? You'll need to set a new one.")) {
              localStorage.removeItem(pinKey);
              setPhase('create');
              setPin('');
              setError('');
            }
          }} style={{ background: 'none', border: 'none', color: '#475569', fontSize: '12px', marginTop: '16px', cursor: 'pointer' }}>
            Forgot PIN? Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================
// MAIN APP
// ============================================

export default function App() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [activeView, setActiveView] = useState('today');
  const [isLoading, setIsLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [defaultCalendar, setDefaultCalendar] = useState(null);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [pinTarget, setPinTarget] = useState(null);

  // Android back button navigation
  useEffect(() => {
    window.history.replaceState({ view: 'today' }, '');
    const handlePopState = (e) => {
      const state = e.state;
      if (state?.view) {
        setActiveView(state.view);
      } else {
        window.history.pushState({ view: activeView }, '');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check stored session
  useEffect(() => {
    const storedVersion = localStorage.getItem('overwatch_version');
    if (storedVersion && storedVersion !== APP_VERSION) {
      localStorage.removeItem('overwatch_token');
      localStorage.removeItem('overwatch_email');
      localStorage.removeItem('overwatch_expiry');
      localStorage.removeItem('overwatch_view');
      localStorage.removeItem('juce_v4_token');
      localStorage.removeItem('juce_v4_email');
      localStorage.removeItem('juce_v4_expiry');
      localStorage.setItem('overwatch_version', APP_VERSION);
      setIsLoading(false);
      return;
    }
    localStorage.setItem('overwatch_version', APP_VERSION);

    // Try overwatch keys first, fall back to juce keys for existing sessions
    const storedToken = localStorage.getItem('overwatch_token') || localStorage.getItem('juce_v4_token');
    const storedEmail = localStorage.getItem('overwatch_email') || localStorage.getItem('juce_v4_email');
    const storedExpiry = localStorage.getItem('overwatch_expiry') || localStorage.getItem('juce_v4_expiry');
    const storedView = localStorage.getItem('overwatch_view');

    if (storedToken && storedEmail && storedExpiry) {
      const expiry = new Date(storedExpiry);
      if (expiry > new Date()) {
        const config = getUserConfig(storedEmail);
        setAccessToken(storedToken);
        setUserEmail(storedEmail);
        setUserName(config.name);
        setIsSignedIn(true);

        const savedDefault = localStorage.getItem(`overwatch_default_cal_${storedEmail}`);
        if (savedDefault !== null) {
          setDefaultCalendar(savedDefault === 'null' ? null : savedDefault);
        } else {
          setDefaultCalendar(config.defaultCalendar);
          if (config.role === 'tech') setShowSetup(true);
        }

        // Restore last view, or use role default
        setActiveView(storedView || config.defaultView || 'today');
      } else {
        clearStorage();
      }
    }
    setIsLoading(false);
  }, []);

  const clearStorage = () => {
    localStorage.removeItem('overwatch_token');
    localStorage.removeItem('overwatch_email');
    localStorage.removeItem('overwatch_expiry');
    localStorage.removeItem('overwatch_view');
  };

  // Google Sign In
  const handleSignIn = useCallback(() => {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', window.location.origin);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('prompt', 'select_account');
    window.location.href = authUrl.toString();
  }, []);

  // Handle OAuth redirect
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      const expiresIn = parseInt(params.get('expires_in') || '3600');

      if (token) {
        fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(data => {
            const email = data.email;
            const expiry = new Date(Date.now() + expiresIn * 1000);
            const config = getUserConfig(email);

            localStorage.setItem('overwatch_token', token);
            localStorage.setItem('overwatch_email', email);
            localStorage.setItem('overwatch_expiry', expiry.toISOString());

            setAccessToken(token);
            setUserEmail(email);
            setUserName(config.name);
            setIsSignedIn(true);

            const savedDefault = localStorage.getItem(`overwatch_default_cal_${email}`);
            if (savedDefault !== null) {
              setDefaultCalendar(savedDefault === 'null' ? null : savedDefault);
            } else {
              setDefaultCalendar(config.defaultCalendar);
              if (config.role === 'tech') setShowSetup(true);
            }

            const guideKey = `overwatch_guide_${email}`;
            if (!localStorage.getItem(guideKey)) {
              localStorage.setItem(guideKey, 'seen');
              setShowGuide(true);
            }

            const defaultView = config.defaultView || 'today';
            setActiveView(defaultView);
            localStorage.setItem('overwatch_view', defaultView);

            window.history.replaceState(null, '', window.location.pathname);
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
    setPinUnlocked(false);
  }, []);

  // Role checks
  const config = getUserConfig(userEmail);
  const isOwner = config.role === 'owner';
  const isOperator = config.role === 'operator';
  const isTech = config.role === 'tech';

  const switchView = (view) => {
    // Techs can't access office or dashboard
    if ((view === 'office' || view === 'dashboard') && isTech) return;

    // Owners and operators skip PIN
    if (isOwner || isOperator) {
      setActiveView(view);
      localStorage.setItem('overwatch_view', view);
      window.history.pushState({ view }, '');
      return;
    }

    // Others need PIN for office/dashboard
    if ((view === 'office' || view === 'dashboard') && !pinUnlocked) {
      setPinTarget(view);
      setShowPinModal(true);
      return;
    }

    setActiveView(view);
    localStorage.setItem('overwatch_view', view);
    window.history.pushState({ view }, '');
  };

  // ============================================
  // LOADING
  // ============================================
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

  // ============================================
  // LOGIN SCREEN
  // ============================================
  if (!isSignedIn) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f1729 0%, #1a2332 100%)',
        padding: '20px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: '64px', marginBottom: '20px' }}>🛡️</div>
          <h1 style={{ fontSize: '32px', marginBottom: '4px', color: '#fff', fontWeight: '800' }}>Overwatch</h1>
          <p style={{ fontSize: '14px', color: '#00c8e8', marginBottom: '4px' }}>DRH Security</p>
          <p style={{ fontSize: '12px', color: '#475569' }}>v{APP_VERSION}</p>
        </div>

        <button
          onClick={handleSignIn}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '16px 32px', fontSize: '16px', fontWeight: '600',
            background: 'white', color: '#333', border: 'none',
            borderRadius: '12px', cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  // ============================================
  // NAV ITEMS — role-based
  // ============================================
  const navItems = [];

  if (isTech) {
    navItems.push({ key: 'today', label: '📋', name: 'Today' });
    navItems.push({ key: 'calendar', label: '📅', name: 'Calendar' });
  }

  if (isOwner) {
    navItems.push({ key: 'dashboard', label: '📊', name: 'Dashboard' });
    navItems.push({ key: 'today', label: '📋', name: 'Jobs' });
    navItems.push({ key: 'calendar', label: '📅', name: 'Calendar' });
    navItems.push({ key: 'office', label: '🏢', name: 'Office' });
  }

  if (isOperator) {
    navItems.push({ key: 'calendar', label: '📅', name: 'Calendar' });
    navItems.push({ key: 'office', label: '🏢', name: 'Office' });
    navItems.push({ key: 'dashboard', label: '📊', name: 'Dashboard' });
    navItems.push({ key: 'today', label: '📋', name: 'Jobs' });
  }

  // ============================================
  // MAIN APP RENDER
  // ============================================
  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: '70px' }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, zIndex: 100, background: '#0f1729'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🛡️</span>
          <span style={{ fontWeight: '800', color: '#00c8e8', fontSize: '15px' }}>Overwatch</span>
          <span style={{ color: '#334155', fontSize: '11px' }}>V3</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#94a3b8', fontSize: '13px' }}>{userName}</span>
          <NotificationBell userEmail={userEmail} />
          <button
            onClick={() => setShowGuide(true)}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: '6px', color: '#00c8e8', padding: '4px 8px', fontSize: '13px', cursor: 'pointer', fontWeight: '700' }}
          >
            ?
          </button>
          <button
            onClick={handleSignOut}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: '6px', color: '#94a3b8', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
          >
            Out
          </button>
        </div>
      </div>

      {/* Active view */}
      {activeView === 'today' && (
        <TechTodayView
          accessToken={accessToken}
          userEmail={userEmail}
          userName={userName}
        />
      )}
      {activeView === 'calendar' && (
        <TechCalendar
          accessToken={accessToken}
          userEmail={userEmail}
          defaultCalendar={defaultCalendar}
          pinUnlocked={pinUnlocked || isOwner || isOperator}
          onRequestPin={() => setShowPinModal(true)}
          isRestricted={isTech}
          isOperator={isOperator || isOwner}
          userName={userName}
        />
      )}
      {activeView === 'office' && (
        <OfficeHub
          accessToken={accessToken}
          userEmail={userEmail}
          userRole={isOwner || isOperator ? 'operator' : 'tech'}
        />
      )}
      {activeView === 'dashboard' && (
        <OwnerDashboard
          accessToken={accessToken}
          userEmail={userEmail}
          userRole={isOwner || isOperator ? 'operator' : 'tech'}
        />
      )}

      {/* PIN Modal */}
      {showPinModal && (
        <PinModal
          userEmail={userEmail}
          onUnlock={() => {
            setPinUnlocked(true);
            setShowPinModal(false);
            if (pinTarget) {
              setActiveView(pinTarget);
              localStorage.setItem('overwatch_view', pinTarget);
              setPinTarget(null);
            }
          }}
          onCancel={() => { setShowPinModal(false); setPinTarget(null); }}
        />
      )}

      {/* First-time calendar setup (techs only) */}
      {showSetup && isTech && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%' }}>
            <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>🛡️</div>
            <h2 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', textAlign: 'center', margin: '0 0 4px 0' }}>
              Welcome, {userName}!
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: '0 0 20px 0' }}>
              Pick your default calendar view.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {CALENDAR_OPTIONS.map(opt => (
                <button
                  key={opt.key || 'all'}
                  onClick={() => setDefaultCalendar(opt.key)}
                  style={{
                    background: defaultCalendar === opt.key ? '#00c8e820' : '#0f1729',
                    color: defaultCalendar === opt.key ? '#00c8e8' : '#94a3b8',
                    border: `1px solid ${defaultCalendar === opt.key ? '#00c8e8' : '#334155'}`,
                    borderRadius: '10px', padding: '12px 16px', fontSize: '14px',
                    fontWeight: defaultCalendar === opt.key ? '700' : '500',
                    cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  {opt.label}
                  {opt.key === defaultCalendar && ' ✓'}
                  {opt.key === null && defaultCalendar === null && ' ✓'}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                localStorage.setItem(`overwatch_default_cal_${userEmail}`, defaultCalendar === null ? 'null' : defaultCalendar);
                setShowSetup(false);
              }}
              style={{
                width: '100%', background: '#00c8e8', color: '#000', border: 'none',
                borderRadius: '10px', padding: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer'
              }}
            >
              Save & Go
            </button>
          </div>
        </div>
      )}

      {/* Help Bot */}
      <HelpBot
        userEmail={userEmail}
        currentView={activeView}
        userName={userName}
        userRole={config.role}
      />
      {showGuide && <QuickGuide onClose={() => setShowGuide(false)} />}

      {/* Bottom nav */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', justifyContent: 'space-around',
        background: '#0f1729', borderTop: '1px solid #1e293b',
        padding: '8px 0 calc(8px + env(safe-area-inset-bottom, 0px))',
        zIndex: 100
      }}>
        {navItems.map(({ key, label, name }) => (
          <button
            key={key}
            onClick={() => switchView(key)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeView === key ? '#00c8e8' : '#64748b',
              fontSize: activeView === key ? '22px' : '20px',
              padding: '4px 16px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>{label}</span>
            <span style={{ fontSize: '10px', fontWeight: activeView === key ? '700' : '400' }}>{name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
