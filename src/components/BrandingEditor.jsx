// ============================================
// Jovelin — Branding editor (colours + logo)
// ============================================
// Reusable so the same editor can sit in Settings and inline on the A/R
// screen — there's no second implementation to drift.
//
// Logos go to the public 'branding' storage bucket. Public is deliberate:
// the estimate document a client opens has to be able to load the image
// without a Jovelin login, which a signed URL wouldn't survive.
import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useBranding, DEFAULT_BRANDING } from '../context/BrandingContext.jsx';

const BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787', GREEN = '#16a34a', RED = '#dc2626';
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB — plenty for a logo, and keeps client documents light

export default function BrandingEditor({ userEmail, compact = false }) {
  const { currentTenantId, currentTenant } = useTenant();
  const { primary_color, accent_color, logo_url, reloadBranding } = useBranding();

  const [primary, setPrimary] = useState(primary_color);
  const [accent, setAccent] = useState(accent_color);
  const [logo, setLogo] = useState(logo_url);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Re-sync when the tenant switches underneath us.
  useEffect(() => {
    setPrimary(primary_color); setAccent(accent_color); setLogo(logo_url); setDirty(false);
  }, [primary_color, accent_color, logo_url]);

  const uploadLogo = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg('That file isn\u2019t an image.'); return; }
    if (file.size > MAX_LOGO_BYTES) { setMsg('Logo must be under 2MB.'); return; }
    setBusy(true); setMsg('');
    try {
      // Tenant-scoped path, and the timestamp busts any CDN cache of a
      // previously uploaded logo at the same name.
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${currentTenantId}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('branding').upload(path, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data } = supabase.storage.from('branding').getPublicUrl(path);
      setLogo(data.publicUrl);
      setDirty(true);
      setMsg('Logo uploaded \u2014 save to apply it.');
    } catch (e) {
      setMsg('Could not upload: ' + (e.message || e));
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.from('tenant_branding').upsert({
      tenant_id: currentTenantId,
      primary_color: primary, accent_color: accent, logo_url: logo,
      updated_by: userEmail, updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' });
    setBusy(false);
    if (error) { setMsg('Could not save: ' + error.message); return; }
    setDirty(false);
    setMsg('Branding saved.');
    reloadBranding();
  };

  const resetToDefault = () => {
    setPrimary(DEFAULT_BRANDING.primary_color);
    setAccent(DEFAULT_BRANDING.accent_color);
    setLogo(null);
    setDirty(true);
  };

  const swatch = (label, value, onChange) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="color" value={value} onChange={e => { onChange(e.target.value); setDirty(true); }}
        style={{ width: 38, height: 30, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 2, cursor: 'pointer', background: '#fff' }} />
      <div>
        <div style={{ color: TEXT, fontSize: 12, fontWeight: 600 }}>{label}</div>
        <input value={value} onChange={e => { onChange(e.target.value); setDirty(true); }}
          style={{ width: 84, padding: '2px 5px', fontSize: 11, border: `1px solid ${BORDER}`, borderRadius: 5, fontFamily: 'ui-monospace, monospace' }} />
      </div>
    </div>
  );

  return (
    <div>
      {!compact && (
        <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
          Used across Jovelin for {currentTenant?.name}, and on the estimate documents their clients actually see.
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
        {swatch('Primary', primary, setPrimary)}
        {swatch('Accent', accent, setAccent)}
      </div>

      <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Logo</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{
          width: 96, height: 56, border: `1px dashed ${BORDER}`, borderRadius: 8, background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
        }}>
          {logo
            ? <img src={logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ color: SUBTEXT, fontSize: 10 }}>No logo</span>}
        </div>
        <div>
          <input type="file" accept="image/*" disabled={busy}
            onChange={e => uploadLogo(e.target.files?.[0])}
            style={{ fontSize: 12, color: SUBTEXT }} />
          <div style={{ color: SUBTEXT, fontSize: 10, marginTop: 4 }}>PNG or SVG on a transparent background works best. Under 2MB.</div>
          {logo && (
            <button onClick={() => { setLogo(null); setDirty(true); }}
              style={{ background: 'none', border: 'none', color: RED, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '4px 0 0' }}>
              Remove logo
            </button>
          )}
        </div>
      </div>

      {/* What a client actually sees, rendered with the values above. */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ background: primary, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {logo && <img src={logo} alt="" style={{ height: 22, maxWidth: 100, objectFit: 'contain' }} />}
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{currentTenant?.name || 'Your company'}</span>
        </div>
        <div style={{ background: '#fff', padding: '10px 14px', fontSize: 12, color: TEXT }}>
          Estimate #1042 <span style={{ color: accent, fontWeight: 700 }}>· Pending approval</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={save} disabled={!dirty || busy}
          style={{
            background: dirty ? primary : '#e5e9eb', color: dirty ? '#fff' : SUBTEXT,
            border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13,
            cursor: dirty && !busy ? 'pointer' : 'default',
          }}>
          {busy ? 'Saving…' : dirty ? 'Save branding' : 'Saved'}
        </button>
        {dirty && <span style={{ color: '#d97706', fontSize: 12, fontWeight: 600 }}>Unsaved changes</span>}
        <button onClick={resetToDefault}
          style={{ background: 'none', border: `1px solid ${BORDER}`, color: SUBTEXT, borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          Reset to default
        </button>
      </div>

      {msg && (
        <div style={{ color: msg.startsWith('Could not') || msg.includes('isn\u2019t') ? RED : GREEN, fontSize: 12, marginTop: 8 }}>{msg}</div>
      )}
    </div>
  );
}
