// ============================================
// Jovelin — "you are inside a client's data" warning
// ============================================
// Only shown to people who move between clients — super admins and staff.
// A tenant_admin or tenant_user has exactly one client and no way to be in
// the wrong one, so warning them would be noise that trains everyone to
// ignore the banner.
//
// Two layers, because a passive banner alone gets tuned out:
//   1. A persistent bar naming the client, always visible.
//   2. A one-time acknowledgement the first time you actually type or
//      change something in that client, in that session. It fires on
//      first input rather than on arrival, so it lands at the moment the
//      mistake would actually be made.
import { useState, useEffect, useRef } from 'react';
import { useTenant } from '../context/TenantContext.jsx';
import { useUserRole } from '../context/UserRoleContext.jsx';

const ACK_PREFIX = 'jovelin_ack_tenant_';

export default function TenantContextWarning() {
  const { currentTenant, currentTenantId } = useTenant();
  const { worksAcrossTenants } = useUserRole();
  const [needsAck, setNeedsAck] = useState(false);
  const armed = useRef(false);

  useEffect(() => {
    if (!worksAcrossTenants || !currentTenantId) return;

    // Session-scoped on purpose: acknowledging once shouldn't silence the
    // check forever, but re-asking on every keystroke would be unusable.
    const key = ACK_PREFIX + currentTenantId;
    if (sessionStorage.getItem(key)) return;

    armed.current = true;

    const onFirstEdit = (e) => {
      if (!armed.current) return;
      const el = e.target;
      if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      // Read-only and disabled fields aren't edits.
      if (el.readOnly || el.disabled) return;
      armed.current = false;
      setNeedsAck(true);
    };

    // Capture phase so this runs before a field's own handler.
    document.addEventListener('input', onFirstEdit, true);
    document.addEventListener('change', onFirstEdit, true);
    return () => {
      document.removeEventListener('input', onFirstEdit, true);
      document.removeEventListener('change', onFirstEdit, true);
    };
  }, [worksAcrossTenants, currentTenantId]);

  if (!worksAcrossTenants || !currentTenant) return null;

  const acknowledge = () => {
    sessionStorage.setItem(ACK_PREFIX + currentTenantId, '1');
    setNeedsAck(false);
  };

  return (
    <>
      {/* Persistent bar. Deliberately not dismissible — the whole point is
          that it's present at the moment of entering something. */}
      <div style={{
        background: '#7c2d12', color: '#fed7aa', padding: '7px 16px',
        fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
        flexWrap: 'wrap', borderBottom: '1px solid #c2410c',
      }}>
        <span style={{ fontSize: 13 }}>⚠</span>
        <span>
          You're working inside <b style={{ color: '#fff' }}>{currentTenant.name}</b>. Anything you enter is saved to
          their data.
        </span>
      </div>

      {needsAck && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, maxWidth: 420, textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
            <div style={{ color: '#1c1c1e', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>
              You're entering data for {currentTenant.name}
            </div>
            <div style={{ color: '#6b7787', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              You work across several clients, so it's worth confirming this is the right one before you continue.
              Everything you enter here belongs to <b style={{ color: '#1c1c1e' }}>{currentTenant.name}</b>.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={acknowledge}
                style={{ background: '#0D4F5C', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 22px', fontWeight: 700, cursor: 'pointer' }}>
                Yes, continue
              </button>
              <button onClick={() => { window.location.href = '/admin'; }}
                style={{ background: 'none', color: '#6b7787', border: '1px solid #e5e9eb', borderRadius: 8, padding: '11px 18px', fontWeight: 700, cursor: 'pointer' }}>
                Switch client
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
