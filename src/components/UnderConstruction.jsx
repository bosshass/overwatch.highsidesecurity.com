// Drape over any not-yet-finished feature so the team sees "Under Construction"
// instead of something half-working. Purely visual: it does NOT disable anything
// underneath (pointerEvents none), so taps still pass through. Wrap content:
//   <UnderConstruction><TheFeature /></UnderConstruction>
// or use <UnderConstruction.Badge /> for a small inline ribbon.

export default function UnderConstruction({ children, label = 'Under Construction', sub = 'Coming soon', compact = false }) {
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
        borderRadius: 12, overflow: 'hidden',
        background:
          'repeating-linear-gradient(45deg, rgba(245,158,11,0.10) 0 14px, rgba(15,23,42,0.55) 14px 28px)',
        backdropFilter: 'blur(1px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid rgba(245,158,11,0.45)',
      }}>
        <div style={{
          background: '#1a1200', border: '1px solid #f59e0b',
          borderRadius: 10, padding: compact ? '6px 12px' : '10px 18px',
          textAlign: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          <div style={{ color: '#f59e0b', fontWeight: 800, fontSize: compact ? 12 : 14, letterSpacing: 0.3 }}>
            🚧 {label}
          </div>
          {!compact && sub && (
            <div style={{ color: '#fbbf24', fontSize: 11, marginTop: 2, opacity: 0.85 }}>{sub}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small inline ribbon for tabs/buttons where a full overlay is too much.
UnderConstruction.Badge = function Badge({ label = 'Under Construction' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: '#1a1200', border: '1px solid #f59e0b',
      color: '#f59e0b', fontSize: 10, fontWeight: 800,
      borderRadius: 6, padding: '2px 8px', letterSpacing: 0.3,
    }}>🚧 {label}</span>
  );
};
