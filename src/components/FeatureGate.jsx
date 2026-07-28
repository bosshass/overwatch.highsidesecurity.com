// ============================================
// Jovelin — Feature gate
// ============================================
// Wraps a route. If the current tenant has this feature turned off, shows
// the upgrade message instead of the real screen — the nav item itself
// still shows (per spec: "things that aren't selected will display"), it's
// only the actual content that's intercepted.
import { useUserRole } from '../context/UserRoleContext.jsx';
import { useTenant } from '../context/TenantContext.jsx';
import { Navigate } from 'react-router-dom';

const TEAL = '#0D4F5C', AMBER = '#d97706';

export default function FeatureGate({ featureKey, children }) {
  const { tenantFeatures, isTenantUser, bypassFeatureGates, isSuperAdmin } = useUserRole();
  const { currentTenant } = useTenant();
  // Tenant users are Time-only, full stop — this is a real route block, not
  // just a hidden nav link, since typing the URL directly would otherwise
  // bypass a nav-only restriction entirely.
  if (isTenantUser) return <Navigate to="/work" replace />;

  // JNB's own books are not a client account. Staff work across every
  // client, so without this they walk into JNB's revenue, profit and
  // billing exactly the way they walk into a client's. Time stays open —
  // /work carries no FeatureGate — so they can still log hours here.
  // A route block, not a hidden nav link: typing the URL gets you nothing.
  if (currentTenant?.is_internal && !isSuperAdmin) return <Navigate to="/work" replace />;

  // Staff and super admins work on a client's behalf, so a client's plan
  // doesn't limit them. They can't grant themselves anything either —
  // changing a plan stays with the super admin.
  if (bypassFeatureGates) return children;

  const enabled = tenantFeatures ? tenantFeatures[featureKey] !== false : true; // no row yet = full access
  if (enabled) return children;

  return (
    <div style={{ background: '#f7f9fa', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', border: `1px solid #e5e9eb`, borderRadius: 14, padding: 28, maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
        <div style={{ color: TEAL, fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Not included in your plan</div>
        <div style={{ color: AMBER, fontWeight: 600, fontSize: 14 }}>Call JNB for more information or to upgrade.</div>
      </div>
    </div>
  );
}
