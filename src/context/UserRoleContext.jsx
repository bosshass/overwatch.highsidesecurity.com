// ============================================
// Jovelin — User role
// ============================================
// Looks up the signed-in user's row in user_roles by email. No row at all
// means "legacy" — an existing operator/tech account from before this
// system existed — treated as full access, same as today, so this never
// silently locks out anyone already using the app.
import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';

const UserRoleContext = createContext(null);

export function UserRoleProvider({ userEmail, children }) {
  const [roleRow, setRoleRow] = useState(undefined); // undefined = loading, null = no row (legacy/full access)
  const [tenantFeatures, setTenantFeatures] = useState(null);

  useEffect(() => {
    if (!userEmail) return;
    (async () => {
      const { data } = await supabase.from('user_roles').select('*').eq('email', userEmail.toLowerCase()).maybeSingle();
      setRoleRow(data || null);
    })();
  }, [userEmail]);

  useEffect(() => {
    if (!roleRow?.tenant_id) { setTenantFeatures(null); return; }
    (async () => {
      const { data } = await supabase.from('tenant_features').select('features').eq('tenant_id', roleRow.tenant_id).maybeSingle();
      setTenantFeatures(data?.features || null);
    })();
  }, [roleRow?.tenant_id]);

  const isSuperAdmin = roleRow?.role === 'super_admin';
  // Staff work across every client — billing, A/R, estimates — but own
  // none of it. They cannot create or deactivate clients, cannot change
  // what a client's plan includes, and cannot approve their own writes to
  // a client's QuickBooks. That last one is the point of the role: doing
  // the work and authorising it are separate hands.
  const isStaff = roleRow?.role === 'staff';
  const isTenantUser = roleRow?.role === 'tenant_user'; // the restricted, Time-only tier

  // Anyone who operates across clients has no single tenant to be pinned
  // to. For everyone else the tenant on their row is a hard boundary.
  const worksAcrossTenants = isSuperAdmin || isStaff;
  const restrictedToTenantId = worksAcrossTenants ? null : roleRow?.tenant_id;

  // Staff do the work on a client's behalf, so a client's own plan
  // shouldn't stop them — but they can never grant themselves anything a
  // client hasn't bought, because they can't change plans at all.
  const bypassFeatureGates = worksAcrossTenants;

  // Who may invite people. Staff can add admins and users to any client;
  // a tenant_admin can only add users to their own.
  const canInviteUsers = isSuperAdmin || isStaff || roleRow?.role === 'tenant_admin';
  // Creating and deactivating clients, changing plans, and approving
  // QuickBooks writes stay with the super admin alone.
  const canManageTenants = isSuperAdmin;
  const canApprovePushes = isSuperAdmin;
  // A row that exists but is revoked is BLOCKED — this is deliberately
  // different from no row at all (which means legacy/full access, for
  // accounts that predate this system). Removing access must not
  // accidentally look identical to "never had a restriction."
  const isRevoked = !!roleRow?.revoked_at;

  return (
    <UserRoleContext.Provider value={{
      roleRow, isSuperAdmin, isStaff, isTenantUser, worksAcrossTenants,
      restrictedToTenantId, tenantFeatures, isRevoked,
      bypassFeatureGates, canInviteUsers, canManageTenants, canApprovePushes,
    }}>
      {children}
    </UserRoleContext.Provider>
  );
}

export function useUserRole() {
  const ctx = useContext(UserRoleContext);
  if (!ctx) throw new Error('useUserRole() must be used inside <UserRoleProvider>');
  return ctx;
}
