// ============================================
// Jovelin — Revoked access overlay
// ============================================
// A fixed, full-screen block shown if the signed-in user's role row has
// been revoked. Deliberately an overlay rather than restructuring routing —
// it sits on top of everything and blocks all interaction underneath,
// without risking a large refactor of App.jsx's existing route tree.
import { useUserRole } from '../context/UserRoleContext.jsx';

export default function RevokedOverlay({ onSignOut }) {
  const { isRevoked } = useUserRole();
  if (!isRevoked) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999, background: '#0f1729',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ background: '#1e293b', borderRadius: 14, padding: 32, maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Your access has been removed</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>Contact your administrator if you believe this is a mistake.</div>
        <button onClick={onSignOut} style={{ background: '#0D4F5C', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, cursor: 'pointer' }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
