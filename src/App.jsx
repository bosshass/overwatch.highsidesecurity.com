// ============================================
// OVERWATCH V3 - App Shell
// ============================================
// Phase 0: Migration Tool (operator only)
// Phase 1: Tech View (field techs) + role routing

import { useState, useEffect, useCallback } from 'react';
import { getUserConfig, getDefaultView, requiresPin, ROLES } from './config/roles.js';
import MigrationTool from './views/MigrationTool.jsx';
import TechView from './views/TechView.jsx';

const APP_VERSION = '3.1.0-phase1';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly';

// ============================================
// DEEP LINK PARSING
// ============================================
function getDeepLinkEventId() {
  const path = window.location.pathname;
  const match = path.match(/^\/job\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ============================================
// PIN GATE
// ============================================
function PinGate({ userName, expectedPin, onUnlock, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    if (pin === expectedPin) {
      onUnlock();
    } else {
      setError('Wrong PIN');
      setPin('');
    }
  };

  return (
    <div style={styles.pinOverlay}>
      <div style={styles.pinCard}>
        <div style={styles.pinTitle}>🔐 PIN Required</div>
        <div style={styles.pinSub}>Welcome back, {userName}</div>
        <input
          type="password"
          inputMode="numeric"
          maxLength={5}
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Enter PIN"
          autoFocus
          style={styles.pinInput}
        />
        {error && <div style={styles.pinError}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={submit} style={styles.btnPrimary}>Unlock</button>
          <button onClick={onCancel} style={styles.btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// VIEW SWITCHER (for operator — can access all views)
// ============================================
function ViewSwitcher({ currentView, onSwitch, role }) {
  if (role !== ROLES.OPERATOR) return null;

  const views = [
    { key: 'field', label: 'Field', icon: '🔧' },
    { key: 'migration', label: 'Migration', icon: '📦' },
  ];

  return (
    <div style={styles.switcherBar}>
      {views.map(v => (
        <button
          key={v.key}
          onClick={() => onSwitch(v.key)}
          style={{
            ...styles.switcherBtn,
            ...(currentView === v.key ? styles.switcherActive : {}),
          }}
        >
          {v.icon} {v.label}
        </button>
      ))}
    </div>
  );
}

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const [user, setUser] = useState(null);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentView, setCurrentView] = useState(null);

  const deepLinkEventId = getDeepLinkEventId();

  // Check for existing session on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('ow_session');
    if (stored) {
      try {
        const session = JSON.parse(stored);
        if (session.storedAt && Date.now() - session.storedAt < 55 * 60 * 1000) {
          setUser(session);
          if (!requiresPin(session.email)) setPinUnlocked(true);
          const defaultView = getDefaultView(session.email);
          setCurrentView(deepLinkEventId ? 'field' : defaultView);
        }
      } catch (_) {}
    }
    setLoading(false);
  }, []);

  // Google OAuth
  const handleLogin = useCallback(() => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Missing VITE_GOOGLE_CLIENT_ID');
      return;
    }

    const client = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: async (response) => {
        if (response.error) {
          setError(`OAuth error: ${response.error}`);
          return;
        }
        try {
          const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${response.access_token}` },
          }).then(r => r.json());

          const session = {
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            accessToken: response.access_token,
            storedAt: Date.now(),
          };

          sessionStorage.setItem('ow_session', JSON.stringify(session));
          setUser(session);
          if (!requiresPin(userInfo.email)) setPinUnlocked(true);
          const defaultView = getDefaultView(userInfo.email);
          setCurrentView(deepLinkEventId ? 'field' : defaultView);
        } catch (err) {
          setError(`Login failed: ${err.message}`);
        }
      },
    });
    client?.requestAccessToken();
  }, [deepLinkEventId]);

  const handleLogout = () => {
    sessionStorage.removeItem('ow_session');
    setUser(null);
    setPinUnlocked(false);
    setCurrentView(null);
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
  };

  // Load GIS script
  useEffect(() => {
    if (document.getElementById('gis-script')) return;
    const script = document.createElement('script');
    script.id = 'gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  // ---- LOADING ----
  if (loading) return <div style={styles.center}><div style={styles.spinner} /></div>;

  // ---- LOGIN SCREEN ----
  if (!user) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginCard}>
          <div style={styles.loginLogo}>OW</div>
          <div style={styles.loginTitle}>OVERWATCH</div>
          <div style={styles.loginSub}>Highside Security — Field Operations</div>
          <div style={styles.loginVersion}>{APP_VERSION}</div>
          {error && <div style={styles.loginError}>{error}</div>}
          <button onClick={handleLogin} style={styles.loginBtn}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // ---- PIN GATE ----
  const config = getUserConfig(user.email);
  if (requiresPin(user.email) && !pinUnlocked) {
    return (
      <PinGate
        userName={config.name}
        expectedPin={config.pin}
        onUnlock={() => setPinUnlocked(true)}
        onCancel={handleLogout}
      />
    );
  }

  // ---- RESOLVE VIEW ----
  const resolvedView = (() => {
    if (currentView === 'field') return 'field';
    if (currentView === 'migration') return 'migration';
    if (config.role === ROLES.TECH) return 'field';
    if (config.role === ROLES.OPERATOR) return 'field';
    if (config.role === ROLES.OWNER) return 'field';
    if (config.role === ROLES.OFFICE) return 'field';
    return 'field';
  })();

  const viewLabels = {
    field: 'FIELD VIEW',
    migration: 'MIGRATION TOOL',
    operator: 'OPERATOR BOARD',
    owner: 'OWNER VIEW',
  };

  // ---- MAIN APP ----
  return (
    <div>
      <nav style={styles.nav}>
        <div style={styles.navLeft}>
          <div style={styles.navLogo}>OW</div>
          <div>
            <div style={styles.navTitle}>OVERWATCH</div>
            <div style={styles.navSub}>{viewLabels[resolvedView] || 'OVERWATCH'}</div>
          </div>
        </div>
        <div style={styles.navRight}>
          <span style={styles.navUser}>{config.name}</span>
          <span style={styles.navBadge}>{APP_VERSION}</span>
          <button onClick={handleLogout} style={styles.navLogout}>Logout</button>
        </div>
      </nav>

      <div style={{ marginTop: 56 }}>
        <ViewSwitcher currentView={resolvedView} onSwitch={setCurrentView} role={config.role} />

        {resolvedView === 'field' && (
          <TechView
            accessToken={user.accessToken}
            userEmail={user.email}
            deepLinkEventId={deepLinkEventId}
          />
        )}
        {resolvedView === 'migration' && (
          <MigrationTool
            accessToken={user.accessToken}
            userEmail={user.email}
          />
        )}
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const styles = {
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' },
  spinner: { width: 32, height: 32, border: '3px solid #1a3a6a', borderTopColor: '#4a90d9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },

  loginContainer: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 },
  loginCard: { textAlign: 'center', maxWidth: 360 },
  loginLogo: { width: 64, height: 64, borderRadius: 12, background: 'linear-gradient(135deg, #0d1b3e, #1a2b8c)', border: '2px solid #4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 24, color: 'white', margin: '0 auto 16px', letterSpacing: 2 },
  loginTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 36, letterSpacing: 3, color: 'white' },
  loginSub: { fontSize: 13, color: '#5a7a9a', marginBottom: 8 },
  loginVersion: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#3a5a7a', marginBottom: 32 },
  loginError: { background: 'rgba(204,17,17,0.15)', border: '1px solid #cc1111', borderRadius: 8, padding: '8px 16px', fontSize: 13, color: '#ff4444', marginBottom: 16 },
  loginBtn: { background: 'white', color: '#333', border: 'none', borderRadius: 8, padding: '12px 32px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },

  pinOverlay: { position: 'fixed', inset: 0, background: 'rgba(6,13,31,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  pinCard: { textAlign: 'center', padding: 32 },
  pinTitle: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  pinSub: { fontSize: 13, color: '#5a7a9a', marginBottom: 24 },
  pinInput: { width: 200, textAlign: 'center', fontSize: 24, letterSpacing: 8, padding: '12px 16px', borderRadius: 8, border: '2px solid #1a3a6a', background: '#0d1b3e', color: 'white', outline: 'none', marginBottom: 8, fontFamily: "'Share Tech Mono', monospace" },
  pinError: { fontSize: 13, color: '#cc1111', marginBottom: 8 },
  btnPrimary: { flex: 1, padding: '10px 24px', borderRadius: 8, border: 'none', background: '#4a90d9', color: 'white', fontWeight: 600, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },
  btnGhost: { flex: 1, padding: '10px 24px', borderRadius: 8, border: '1px solid #1a3a6a', background: 'transparent', color: '#5a7a9a', cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },

  nav: { position: 'fixed', top: 0, left: 0, right: 0, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'rgba(6,13,31,0.95)', borderBottom: '1px solid #1a2b8c', backdropFilter: 'blur(8px)', zIndex: 100 },
  navLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  navLogo: { width: 34, height: 34, borderRadius: 6, background: 'linear-gradient(135deg, #0d1b3e, #1a2b8c)', border: '1.5px solid #4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 13, color: 'white', letterSpacing: 1 },
  navTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: 2, color: 'white' },
  navSub: { fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1, color: '#4a90d9' },
  navRight: { display: 'flex', alignItems: 'center', gap: 12 },
  navUser: { fontSize: 13, color: '#c8d8e8' },
  navBadge: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(74,144,217,0.12)', border: '1px solid #1a3a6a', color: '#4a90d9' },
  navLogout: { fontSize: 12, color: '#5a7a9a', background: 'none', border: '1px solid #1a3a6a', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },

  switcherBar: { display: 'flex', gap: 0, padding: '0 16px', background: 'rgba(6,13,31,0.8)', borderBottom: '1px solid #0d1b3e' },
  switcherBtn: { flex: 1, padding: '8px 0', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#5a7a9a', cursor: 'pointer', textAlign: 'center' },
  switcherActive: { borderBottomColor: '#4a90d9', color: '#4a90d9' },
};

if (typeof document !== 'undefined' && !document.getElementById('ow-styles')) {
  const style = document.createElement('style');
  style.id = 'ow-styles';
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    * { -webkit-tap-highlight-color: transparent; }
    input, textarea, select { font-size: 16px !important; }
  `;
  document.head.appendChild(style);
}
