// ============================================
// Overwatch V3 - DRH Security Field Dashboard
// ============================================
// Calendar-only. No Supabase. No database.
// Reads from Google Calendar, displays jobs.
// Roles: operator (Sara), owner (JR), tech (Austin/Trevor)

import { useState, useEffect, useCallback } from 'react';
import { getUserConfig } from './config/roles.js';
import TechView from './views/TechView.jsx';
import OwnerView from './views/OwnerView.jsx';

const APP_VERSION = '3.1.0';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar.readonly';

export default function App() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('tech');
  const [defaultCalendar, setDefaultCalendar] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState('default'); // default | calendar | owner

  // Check stored session
  useEffect(() => {
    const storedToken = localStorage.getItem('ow_v3_token');
    const storedEmail = localStorage.getItem('ow_v3_email');
    const storedExpiry = localStorage.getItem('ow_v3_expiry');

    if (storedToken && storedEmail && storedExpiry) {
      const expiry = new Date(storedExpiry);
      if (expiry > new Date()) {
        const config = getUserConfig(storedEmail);
        setAccessToken(storedToken);
        setUserEmail(storedEmail);
        setUserName(config.name);
        setUserRole(config.role);
        setDefaultCalendar(config.defaultCalendar);
        setIsSignedIn(true);
      } else {
        clearStorage();
      }
    }
    setIsLoading(false);
  }, []);

  const clearStorage = () => {
    localStorage.removeItem('ow_v3_token');
    localStorage.removeItem('ow_v3_email');
    localStorage.removeItem('ow_v3_expiry');
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

            localStorage.setItem('ow_v3_token', token);
            localStorage.setItem('ow_v3_email', email);
            localStorage.setItem('ow_v3_expiry', expiry.toISOString());

            setAccessToken(token);
            setUserEmail(email);
            setUserName(config.name);
            setUserRole(config.role);
            setDefaultCalendar(config.defaultCalendar);
            setIsSignedIn(true);
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
  }, []);

  // Loading
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

  // Login
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
          <p style={{ fontSize: '16px', color: '#00c8e8' }}>Overwatch V3</p>
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
        <p style={{ marginTop: '24px', color: '#666', fontSize: '12px' }}>v{APP_VERSION}</p>
      </div>
    );
  }

  // Determine which view to show
  const isOperator = userRole === 'operator';
  const isOwner = userRole === 'owner';
  const showOwnerView = activeView === 'owner' || (activeView === 'default' && (isOwner || isOperator));
  const showTechView = activeView === 'calendar' || (activeView === 'default' && userRole === 'tech');
  const hasViewToggle = isOperator || isOwner; // Can switch between views

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: hasViewToggle ? '70px' : '20px' }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, zIndex: 100, background: '#0f1729'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🛡️</span>
          <span style={{ fontWeight: '700', color: '#00c8e8', fontSize: '14px' }}>Overwatch</span>
          <span style={{ color: '#475569', fontSize: '11px' }}>V3</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#94a3b8', fontSize: '13px' }}>{userName}</span>
          <button
            onClick={handleSignOut}
            style={{
              background: 'none', border: '1px solid #334155', borderRadius: '6px',
              color: '#94a3b8', padding: '4px 10px', fontSize: '11px', cursor: 'pointer'
            }}
          >Out</button>
        </div>
      </div>

      {/* Date header */}
      <div style={{ padding: '12px 16px 0', fontSize: '15px', fontWeight: '600', color: '#94a3b8' }}>
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>

      {/* Active view */}
      {showOwnerView && <OwnerView accessToken={accessToken} userName={userName} />}
      {showTechView && <TechView accessToken={accessToken} userEmail={userEmail} defaultCalendar={defaultCalendar} userName={userName} />}

      {/* Bottom nav — only for operator/owner */}
      {hasViewToggle && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          display: 'flex', justifyContent: 'space-around',
          background: '#0a0f1e', borderTop: '1px solid #1e293b',
          padding: '6px 0 calc(6px + env(safe-area-inset-bottom, 0px))',
          zIndex: 100
        }}>
          {[
            { key: 'calendar', label: '📅', name: 'Calendar' },
            { key: 'owner', label: '📊', name: 'Dashboard' },
          ].map(v => {
            const isActive = (v.key === 'owner' && showOwnerView) || (v.key === 'calendar' && showTechView);
            return (
              <button
                key={v.key}
                onClick={() => setActiveView(v.key)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: isActive ? '#3b82f6' : '#64748b',
                  fontSize: '20px', padding: '4px 20px',
                }}
              >
                <span>{v.label}</span>
                <span style={{ fontSize: '10px', fontWeight: isActive ? '700' : '400' }}>{v.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
