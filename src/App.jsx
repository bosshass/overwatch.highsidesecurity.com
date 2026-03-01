// ============================================
// OVERWATCH V3 — App Shell
// ============================================
import { useState, useEffect, useCallback } from 'react';
import { getUserConfig, getDefaultView, requiresPin, ROLES } from './config/roles.js';
import OwnerView from './views/OwnerView.jsx';
import TechView from './views/TechView.jsx';
import MigrationTool from './views/MigrationTool.jsx';

const APP_VERSION = '3.2.0';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar';

function getDeepLinkEventId() {
  const match = window.location.pathname.match(/^\/job\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ============================================
// PIN GATE
// ============================================
function PinGate({ userName, expectedPin, onUnlock, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const submit = () => {
    if (pin === expectedPin) { onUnlock(); }
    else { setError('Wrong PIN'); setPin(''); setShake(true); setTimeout(() => setShake(false), 500); }
  };

  return (
    <div style={st.loginWrap}>
      <div style={st.loginInner}>
        <div style={st.lockIcon}>🔐</div>
        <div style={st.loginBrand}>OVERWATCH</div>
        <div style={st.loginSub}>Enter PIN, {userName}</div>
        <input type="password" inputMode="numeric" maxLength={5} value={pin} autoFocus
          onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ ...st.pinInput, ...(shake ? { animation: 'shake 0.3s ease' } : {}) }}
          placeholder="• • • • •"
        />
        {error && <div style={st.errText}>{error}</div>}
        <button onClick={submit} style={st.btnPrimary}>Unlock</button>
        <button onClick={onCancel} style={st.btnGhost}>Not you? Sign out</button>
      </div>
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

  useEffect(() => {
    const stored = sessionStorage.getItem('ow_session');
    if (stored) {
      try {
        const s = JSON.parse(stored);
        if (s.storedAt && Date.now() - s.storedAt < 55 * 60 * 1000) {
          setUser(s);
          if (!requiresPin(s.email)) setPinUnlocked(true);
          setCurrentView(deepLinkEventId ? 'field' : getDefaultView(s.email));
        }
      } catch (_) {}
    }
    setLoading(false);
  }, []);

  const handleLogin = useCallback(() => {
    if (!GOOGLE_CLIENT_ID) { setError('Missing VITE_GOOGLE_CLIENT_ID'); return; }
    const client = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: SCOPES,
      callback: async (resp) => {
        if (resp.error) { setError(`OAuth: ${resp.error}`); return; }
        try {
          const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${resp.access_token}` },
          }).then(r => r.json());
          const session = { email: info.email, name: info.name, picture: info.picture, accessToken: resp.access_token, storedAt: Date.now() };
          sessionStorage.setItem('ow_session', JSON.stringify(session));
          setUser(session);
          if (!requiresPin(info.email)) setPinUnlocked(true);
          setCurrentView(deepLinkEventId ? 'field' : getDefaultView(info.email));
        } catch (e) { setError(`Login failed: ${e.message}`); }
      },
    });
    client?.requestAccessToken();
  }, [deepLinkEventId]);

  const handleLogout = () => {
    sessionStorage.removeItem('ow_session');
    setUser(null); setPinUnlocked(false); setCurrentView(null);
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
  };

  useEffect(() => {
    if (document.getElementById('gis-script')) return;
    const s = document.createElement('script'); s.id = 'gis-script';
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    document.body.appendChild(s);
  }, []);

  // ---- LOADING ----
  if (loading) return <div style={st.loginWrap}><div style={st.spinner} /></div>;

  // ---- LOGIN ----
  if (!user) {
    return (
      <div style={st.loginWrap}>
        {/* Animated background grid */}
        <div style={st.gridBg} />
        <div style={st.scanline} />
        <div style={st.loginInner}>
          <div style={st.owBadge}>OW</div>
          <div style={st.loginBrand}>OVERWATCH</div>
          <div style={st.loginTagline}>Highside Security — Field Operations</div>
          <div style={st.versionTag}>{APP_VERSION}</div>
          {error && <div style={st.errBanner}>{error}</div>}
          <button onClick={handleLogin} style={st.googleBtn}>
            <svg width="18" height="18" viewBox="0 0 48 48" style={{ marginRight: 10 }}>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>
        </div>
        {/* Corner brackets */}
        <div style={{ ...st.corner, top: 24, left: 24, borderTop: '2px solid #4a90d9', borderLeft: '2px solid #4a90d9' }} />
        <div style={{ ...st.corner, top: 24, right: 24, borderTop: '2px solid #4a90d9', borderRight: '2px solid #4a90d9' }} />
        <div style={{ ...st.corner, bottom: 24, left: 24, borderBottom: '2px solid #4a90d9', borderLeft: '2px solid #4a90d9' }} />
        <div style={{ ...st.corner, bottom: 24, right: 24, borderBottom: '2px solid #4a90d9', borderRight: '2px solid #4a90d9' }} />
      </div>
    );
  }

  // ---- PIN GATE ----
  const config = getUserConfig(user.email);
  if (requiresPin(user.email) && !pinUnlocked) {
    return <PinGate userName={config.name} expectedPin={config.pin} onUnlock={() => setPinUnlocked(true)} onCancel={handleLogout} />;
  }

  // ---- RESOLVE VIEW ----
  const view = currentView || 'field';
  const isOperator = config.role === ROLES.OPERATOR;
  const isOwner = config.role === ROLES.OWNER;

  const viewOptions = isOperator
    ? [
        { key: 'owner', label: 'Owner', icon: '📊' },
        { key: 'field', label: 'Field', icon: '🔧' },
        { key: 'migration', label: 'Data', icon: '📦' },
      ]
    : isOwner
    ? [
        { key: 'owner', label: 'Dashboard', icon: '📊' },
        { key: 'field', label: 'Field', icon: '🔧' },
      ]
    : null; // Techs get no switcher

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={st.nav}>
        <div style={st.navL}>
          <div style={st.navBadge}>OW</div>
          <div>
            <div style={st.navBrand}>OVERWATCH</div>
            <div style={st.navRole}>{config.name.toUpperCase()} · {view === 'owner' ? 'DASHBOARD' : view === 'field' ? 'FIELD OPS' : view === 'migration' ? 'DATA TOOLS' : 'OVERWATCH'}</div>
          </div>
        </div>
        <div style={st.navR}>
          <span style={st.navVer}>{APP_VERSION}</span>
          <button onClick={handleLogout} style={st.navOut}>Sign out</button>
        </div>
      </nav>

      {/* View Switcher */}
      {viewOptions && (
        <div style={st.switcher}>
          {viewOptions.map(v => (
            <button key={v.key} onClick={() => setCurrentView(v.key)}
              style={{ ...st.swBtn, ...(view === v.key ? st.swActive : {}) }}>
              <span>{v.icon}</span> {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Views */}
      <div style={{ marginTop: viewOptions ? 92 : 56 }}>
        {view === 'owner' && <OwnerView accessToken={user.accessToken} userEmail={user.email} />}
        {view === 'field' && <TechView accessToken={user.accessToken} userEmail={user.email} deepLinkEventId={deepLinkEventId} />}
        {view === 'migration' && <MigrationTool accessToken={user.accessToken} userEmail={user.email} />}
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================
const st = {
  // Login
  loginWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', position: 'relative', overflow: 'hidden', background: '#060d1f' },
  loginInner: { textAlign: 'center', zIndex: 10, padding: 40 },
  gridBg: { position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(74,144,217,0.06) 1px, transparent 0)', backgroundSize: '40px 40px', zIndex: 1 },
  scanline: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(74,144,217,0.15), transparent)', zIndex: 2, animation: 'scanDown 6s linear infinite' },
  corner: { position: 'absolute', width: 48, height: 48, zIndex: 5, pointerEvents: 'none' },
  owBadge: { width: 72, height: 72, borderRadius: 16, background: 'linear-gradient(135deg, #0d1b3e, #1a2b8c)', border: '2px solid #4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 28, color: 'white', margin: '0 auto 20px', letterSpacing: 3, boxShadow: '0 0 40px rgba(74,144,217,0.2)' },
  loginBrand: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 'clamp(36px, 8vw, 52px)', letterSpacing: 8, color: 'white', lineHeight: 1 },
  loginTagline: { fontSize: 14, color: '#5a7a9a', marginTop: 6, letterSpacing: 2 },
  versionTag: { fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#3a5a7a', marginTop: 6, letterSpacing: 3, marginBottom: 36 },
  googleBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'white', color: '#333', border: 'none', borderRadius: 10,
    padding: '14px 36px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
    fontFamily: "'Barlow', sans-serif", transition: 'transform 0.1s, box-shadow 0.2s',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
  },
  errBanner: { background: 'rgba(204,17,17,0.12)', border: '1px solid #cc1111', borderRadius: 8, padding: '8px 16px', fontSize: 13, color: '#ff4444', marginBottom: 16 },

  // PIN
  lockIcon: { fontSize: 48, marginBottom: 12 },
  loginSub: { fontSize: 15, color: '#5a7a9a', marginBottom: 24, letterSpacing: 1 },
  pinInput: { width: 200, textAlign: 'center', fontSize: 28, letterSpacing: 12, padding: '14px', borderRadius: 10, border: '2px solid #1a3a6a', background: '#0a1228', color: 'white', outline: 'none', marginBottom: 12, fontFamily: "'Share Tech Mono', monospace", display: 'block', margin: '0 auto 12px' },
  errText: { fontSize: 13, color: '#ff4444', marginBottom: 8 },
  btnPrimary: { display: 'block', width: 200, margin: '0 auto 8px', padding: '12px', borderRadius: 10, border: 'none', background: '#4a90d9', color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },
  btnGhost: { display: 'block', width: 200, margin: '0 auto', padding: '10px', borderRadius: 8, border: '1px solid #1a3a6a', background: 'transparent', color: '#5a7a9a', fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },

  // Nav
  nav: { position: 'fixed', top: 0, left: 0, right: 0, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'rgba(6,13,31,0.97)', borderBottom: '1px solid #1a2b8c', backdropFilter: 'blur(12px)', zIndex: 100 },
  navL: { display: 'flex', alignItems: 'center', gap: 10 },
  navBadge: { width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg, #0d1b3e, #1a2b8c)', border: '1.5px solid #4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 12, color: 'white', letterSpacing: 1 },
  navBrand: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: 3, color: 'white' },
  navRole: { fontFamily: "'Share Tech Mono', monospace", fontSize: 9, letterSpacing: 1.5, color: '#4a90d9' },
  navR: { display: 'flex', alignItems: 'center', gap: 12 },
  navVer: { fontFamily: "'Share Tech Mono', monospace", fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(74,144,217,0.1)', border: '1px solid #1a3a6a', color: '#4a90d9' },
  navOut: { fontSize: 12, color: '#5a7a9a', background: 'none', border: '1px solid #1a3a6a', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: "'Barlow', sans-serif" },

  // Switcher
  switcher: { position: 'fixed', top: 56, left: 0, right: 0, height: 36, display: 'flex', background: 'rgba(6,13,31,0.95)', borderBottom: '1px solid #0d1b3e', zIndex: 99, padding: '0 16px' },
  swBtn: { flex: 1, background: 'none', border: 'none', borderBottom: '2px solid transparent', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5a7a9a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  swActive: { borderBottomColor: '#4a90d9', color: '#4a90d9' },

  spinner: { width: 32, height: 32, border: '3px solid #1a3a6a', borderTopColor: '#4a90d9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};

if (typeof document !== 'undefined' && !document.getElementById('ow-css')) {
  const css = document.createElement('style'); css.id = 'ow-css';
  css.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
    @keyframes scanDown { 0% { top: -2px; } 100% { top: 100vh; } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
    input, textarea, select { font-size: 16px !important; }
    body { margin: 0; background: #060d1f; color: #c8d8e8; font-family: 'Barlow', sans-serif; -webkit-font-smoothing: antialiased; }
  `;
  document.head.appendChild(css);
}
