// ============================================
// Jovelin — Sidebar layout
// ============================================
// Left-hand nav for the "built out" features (Command Center, Estimates,
// Time, Revenue), replacing the old top header entirely for these screens.
// Client picker lives here now, with a show/hide toggle — full visibility
// rules wait on the real permissions system; this is just the on/off
// switch ahead of that.
import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTenant, TenantSwitcher } from '../context/TenantContext.jsx';
import { useUserRole } from '../context/UserRoleContext.jsx';
import TenantContextWarning from './TenantContextWarning.jsx';

const NAVY = '#0f1729', NAVY_LIGHT = '#16233a', GOLD = '#e8a33d', TEXT_DIM = '#94a3b8';

const FULL_NAV_ITEMS = [
  { path: '/board', label: 'Board', icon: '🗂️' },
  { path: '/overview', label: 'Command Center', icon: '📊' },
  { path: '/estimates', label: 'Estimates', icon: '🧾' },
  { path: '/work', label: 'Time', icon: '⏱️' },
  { path: '/billing', label: 'Billing', icon: '💵' },
  { path: '/revenue', label: 'Revenue', icon: '💰' },
  { path: '/profitability', label: 'Profit', icon: '📈' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];
// Tenant users (max 2 per tenant, added by the tenant itself) are
// permanently restricted to Time only — no Settings, no path to grant
// themselves or anyone else more access from inside the app.
const RESTRICTED_NAV_ITEMS = [
  { path: '/work', label: 'Time', icon: '⏱️' },
];

export default function SidebarLayout({ children, userName, onSignOut }) {
  const navigate = useNavigate();
  const { currentTenant, currentTenantId } = useTenant();
  const { isTenantUser, isSuperAdmin, isStaff, worksAcrossTenants } = useUserRole();
  // On JNB's own tenant everyone below super admin sees Time and nothing
  // else — same restricted list the tenant_user tier already uses.
  const internalLocked = !!currentTenant?.is_internal && !isSuperAdmin;
  const showPicker = localStorage.getItem('jovelin_show_tenant_picker') !== 'false';
  // Admin sits above the tenants, so it only appears for the one role
  // that operates across them.
  const NAV_ITEMS = (isTenantUser || internalLocked)
    ? RESTRICTED_NAV_ITEMS
    // Admin is where cross-tenant people choose which client to work in, so
    // both roles that operate across clients need it — staff see a reduced
    // version without the approval queue.
    : (worksAcrossTenants ? [{ path: '/admin', label: 'Admin', icon: '🛡️' }, ...FULL_NAV_ITEMS] : FULL_NAV_ITEMS);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const togglePicker = () => {
    localStorage.setItem('jovelin_show_tenant_picker', showPicker ? 'false' : 'true');
    window.location.reload(); // simplest way to re-read the flag everywhere for now
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar — desktop/tablet only. On mobile the global bottom nav
          (same destinations, kept in sync in App.jsx) takes over instead;
          rendering both at once is what was cramming the screenshot.

          alignSelf: flex-start stops the flex container stretching this to
          the full content height, which would leave sticky nothing to do.
          overflowY: auto keeps a long nav usable on a short window. */}
      {!isMobile && (
      <div style={{
        width: 220, flexShrink: 0, background: NAVY, display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh', overflowY: 'auto',
      }}>
        <div onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 16px', cursor: 'pointer' }}>
          <img src="/favicon-192x192.png" alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>Jovelin</span>
        </div>

        {/* The client picker used to live here. Switching client from a
            dropdown while standing inside another client's books is exactly
            how data ends up in the wrong place, so choosing a client is now
            a deliberate act in Admin. What stays here is a read-only label
            of where you currently are. */}
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ color: TEXT_DIM, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Current Client</div>
          <div style={{
            background: worksAcrossTenants ? '#7c2d12' : NAVY_LIGHT,
            border: `1px solid ${worksAcrossTenants ? '#c2410c' : NAVY_LIGHT}`,
            borderRadius: 8, padding: '7px 10px',
          }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{currentTenant?.name || '—'}</div>
            {worksAcrossTenants && (
              <div
                onClick={() => navigate('/admin')}
                style={{ color: '#fed7aa', fontSize: 10, marginTop: 2, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Switch client in Admin
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, padding: '4px 10px' }}>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
              marginBottom: 2, textDecoration: 'none', fontSize: 13, fontWeight: 600,
              color: isActive ? '#fff' : TEXT_DIM,
              background: isActive ? NAVY_LIGHT : 'transparent',
              borderLeft: isActive ? `3px solid ${GOLD}` : '3px solid transparent',
            })}>
              <span style={{ fontSize: 15 }}>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </div>

        <button onClick={togglePicker} style={{
          background: 'none', border: 'none', color: TEXT_DIM, fontSize: 11, cursor: 'pointer',
          padding: '8px 16px', textAlign: 'left',
        }}>
          {showPicker ? 'Hide' : 'Show'} client picker
        </button>

        <a href={`https://mail.google.com/mail/u/0/?${new URLSearchParams({ view: 'cm', fs: '1', to: 'support@jnbllc.com', su: `Jovelin support — ${currentTenant?.name || ''}`, body: `User: ${userName}\nTenant: ${currentTenant?.name || ''}\n\nDescribe the issue:\n` }).toString()}`}
          target="_blank" rel="noopener noreferrer"
          style={{ display: 'block', color: TEXT_DIM, fontSize: 11, padding: '2px 16px 8px', textDecoration: 'none' }}>
          Contact Support
        </a>

        <div style={{ borderTop: `1px solid ${NAVY_LIGHT}`, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{userName}</div>
            <div style={{ color: TEXT_DIM, fontSize: 11 }}>{currentTenant?.name || ''}</div>
          </div>
          <button onClick={onSignOut} style={{ background: 'none', border: `1px solid ${NAVY_LIGHT}`, borderRadius: 6, color: TEXT_DIM, padding: '5px 9px', fontSize: 11, cursor: 'pointer' }}>Out</button>
        </div>
      </div>
      )}

      {/* Content.

          key={currentTenantId} is load-bearing, not cosmetic. Screens hold
          their data in state and refetch when the tenant changes — but the
          PREVIOUS tenant's figures stay rendered until the new ones arrive,
          and if a fetch fails or is slow they stay indefinitely. That means
          one client's financials displayed under another client's name,
          which is a disclosure problem regardless of the database being
          correctly partitioned.

          Keying on the tenant makes React discard and rebuild the whole
          subtree on every switch, so there is no state left to be stale.
          Doing it here rather than clearing state inside each view means it
          also covers screens added later, which per-view discipline
          reliably wouldn't. */}
      <div key={currentTenantId || 'no-tenant'} style={{ flex: 1, minWidth: 0, paddingBottom: isMobile ? 64 : 0 }}>
        <TenantContextWarning />
        {children}
      </div>
    </div>
  );
}
