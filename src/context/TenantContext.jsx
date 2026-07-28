// ============================================
// Jovelin — Tenant context
// ============================================
// Single source of truth for "which client are we working in right now."
// Persisted to localStorage so it survives a refresh. Any view that needs
// to scope data to a tenant (Estimates, Overview, eventually Board/jobs)
// reads currentTenantId from here instead of hardcoding one.
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { useUserRole } from './UserRoleContext.jsx';

const STORAGE_KEY = 'jovelin_tenant_id';
const TenantContext = createContext(null);

export function TenantProvider({ children }) {
  const { restrictedToTenantId, isSuperAdmin } = useUserRole();
  const [tenants, setTenants] = useState([]);
  const [currentTenantId, setCurrentTenantIdState] = useState(() => localStorage.getItem(STORAGE_KEY) || null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('tenants')
      .select('id, name, slug, deactivated_at, is_internal').order('created_at');
    // Deactivated clients vanish from the picker for normal users. The
    // super admin keeps seeing them, otherwise reactivating would be
    // impossible from inside the app.
    const list = (data || []).filter(t => isSuperAdmin || !t.deactivated_at);
    setTenants(list);
    setCurrentTenantIdState(prev => {
      // A tenant_admin or tenant_user is locked to their own tenant, full
      // stop — not a default that can be switched away from via the
      // picker, localStorage, or anything else client-side.
      if (restrictedToTenantId) return restrictedToTenantId;
      // If the selected client has just been deactivated it's no longer in
      // the list, so fall through to the first available one rather than
      // sitting on an id that resolves to nothing.
      if (prev && list.some(t => t.id === prev)) return prev;
      const fallback = list[0]?.id || null;
      if (fallback) localStorage.setItem(STORAGE_KEY, fallback);
      return fallback;
    });
    setLoading(false);
  }, [restrictedToTenantId, isSuperAdmin]);

  useEffect(() => { load(); }, [load]);

  const setCurrentTenantId = useCallback((id) => {
    if (restrictedToTenantId) return; // locked — the switcher is hidden for these roles anyway
    localStorage.setItem(STORAGE_KEY, id);
    setCurrentTenantIdState(id);
  }, [restrictedToTenantId]);

  const currentTenant = tenants.find(t => t.id === currentTenantId) || null;

  return (
    <TenantContext.Provider value={{ tenants, currentTenantId, currentTenant, setCurrentTenantId, loading, reload: load }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant() must be used inside <TenantProvider>');
  return ctx;
}

// Compact dropdown for the ViewShell header.
export function TenantSwitcher() {
  const { tenants, currentTenantId, setCurrentTenantId, loading } = useTenant();
  if (loading || tenants.length === 0) return null;
  return (
    <select
      value={currentTenantId || ''}
      onChange={e => setCurrentTenantId(e.target.value)}
      style={{
        background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155',
        borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}
    >
      {tenants.map(t => (
        <option key={t.id} value={t.id}>{t.name}{t.deactivated_at ? ' (inactive)' : ''}</option>
      ))}
    </select>
  );
}
