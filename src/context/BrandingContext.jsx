// ============================================
// Jovelin — Tenant branding (colours + logo)
// ============================================
// One place that knows a tenant's brand, so the app chrome, the estimate
// document a client actually receives, and later invoices all agree
// rather than each hardcoding teal.
//
// Falls back to Jovelin's own palette when a tenant hasn't set anything,
// so nothing ever renders unstyled or half-branded.
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { useTenant } from './TenantContext.jsx';

export const DEFAULT_BRANDING = {
  primary_color: '#0D4F5C',
  accent_color: '#d97706',
  logo_url: null,
};

const BrandingContext = createContext(DEFAULT_BRANDING);

export function BrandingProvider({ children }) {
  const { currentTenantId } = useTenant();
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentTenantId) { setBranding(DEFAULT_BRANDING); setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await supabase.from('tenant_branding')
        .select('primary_color, accent_color, logo_url').eq('tenant_id', currentTenantId).maybeSingle();
      setBranding({
        primary_color: data?.primary_color || DEFAULT_BRANDING.primary_color,
        accent_color: data?.accent_color || DEFAULT_BRANDING.accent_color,
        logo_url: data?.logo_url || null,
      });
    } catch (e) {
      setBranding(DEFAULT_BRANDING);
    }
    setLoading(false);
  }, [currentTenantId]);

  useEffect(() => { load(); }, [load]);

  return (
    <BrandingContext.Provider value={{ ...branding, loading, reloadBranding: load }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
