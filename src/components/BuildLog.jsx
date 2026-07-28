// ============================================
// BuildLog — New version changelog modal
// ============================================
// Shows when APP_VERSION changes.
// User must tap "Got it" before the app clears
// their session and forces re-login.
// Add new builds to the top of BUILDS array.
// ============================================

export const BUILDS = [
  {
    version: '0.2.0',
    date: '2026-07-26',
    label: 'QuickBooks live, and a security pass',
    changes: [
      'QuickBooks Online is live on production credentials — real company data, not the sandbox. Each tenant connects its own company, and can be reconnected at any time from Settings',
      'Estimates import from QuickBooks with their line items and current status. Pending and accepted only; rejected and closed are never pulled in. Imported estimates can be sent to a customer like any other',
      'Costs vs revenue by customer on Revenue and Command Center, and a list of expenses booked with no customer — assign one and it writes straight back to QuickBooks',
      'AR Chase: overdue invoices with a one-click Gmail draft, using the signature you set in Settings',
      'Time screen now shows the hours you have actually logged, with a running total — previously they were saved and never displayed',
      'Security: sign-in no longer trusts unverified browser storage, and legacy screens are locked to their owners',
    ],
  },
];

export const CURRENT_BUILD = BUILDS[0];

const C = {
  bg:    '#07111f',
  panel: '#101d31',
  card:  '#111f34',
  line:  '#1d2f48',
  line2: '#263a55',
  text:  '#edf4ff',
  muted: '#8ea0b8',
  green: '#22d16f',
  amber: '#ffb020',
};

export default function BuildLog({ onDismiss }) {
  const b = CURRENT_BUILD;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(3,7,18,0.97)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: `linear-gradient(180deg,#14243b,${C.panel})`,
        border: `1px solid ${C.line2}`,
        borderRadius: 20,
        padding: '28px 24px 24px',
        width: '100%',
        maxWidth: 460,
        maxHeight: '88vh',
        overflowY: 'auto',
      }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:20 }}>
          <div style={{ width:46, height:46, borderRadius:14, background:'#0b1526', border:`1px solid #314563`, display:'grid', placeItems:'center', fontSize:24, flexShrink:0 }}>
            🚀
          </div>
          <div>
            <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>
              New build deployed
            </div>
            <div style={{ fontSize:22, fontWeight:900, color:C.text, lineHeight:1.2 }}>
              Jovelin {b.version}
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
              {b.label} · {b.date}
            </div>
          </div>
        </div>

        <div style={{ borderTop:`1px solid ${C.line2}`, marginBottom:18 }} />

        {/* Changelog */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:12 }}>
            What's new
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {b.changes.map((change, i) => (
              <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                <span style={{ color:C.green, fontSize:14, marginTop:1, flexShrink:0 }}>✓</span>
                <span style={{ fontSize:13, color:'#b1bfd0', lineHeight:1.5 }}>{change}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Re-auth warning */}
        <div style={{ background:'#1a1a2e', border:`1px solid ${C.amber}55`, borderRadius:12, padding:'12px 14px', marginBottom:20, display:'flex', gap:10, alignItems:'flex-start' }}>
          <span style={{ fontSize:16, flexShrink:0 }}>⚠</span>
          <span style={{ fontSize:12, color:'#e8c97a', lineHeight:1.5 }}>
            New builds force a fresh session. You'll need to sign in again — this is intentional.
          </span>
        </div>

        <button onClick={onDismiss}
          style={{ width:'100%', padding:'15px 0', borderRadius:14, border:'none', background:C.green, color:'#04130a', fontWeight:900, fontSize:16, cursor:'pointer', letterSpacing:'-0.01em' }}>
          Got it — sign me in
        </button>

        {/* Build history */}
        {BUILDS.length > 1 && (
          <div style={{ marginTop:20, paddingTop:16, borderTop:`1px solid ${C.line}` }}>
            <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>
              Previous builds
            </div>
            {BUILDS.slice(1).map(prev => (
              <div key={prev.version} style={{ fontSize:12, color:'#4a5f7a', marginBottom:6, display:'flex', gap:8 }}>
                <span style={{ color:C.muted, fontWeight:700 }}>v{prev.version}</span>
                <span>{prev.label}</span>
                <span style={{ color:'#2d3f58' }}>{prev.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
