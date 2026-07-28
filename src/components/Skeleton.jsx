// ============================================
// Jovelin — Loading placeholders
// ============================================
// Financial screens must never print $0 while they're still waiting on
// data. "$0 revenue this month" and "we haven't heard back from
// QuickBooks yet" look identical, and the first one is a decision-changing
// claim. These render an obviously-unresolved placeholder instead.
//
// Sequential loading (added to stay under Intuit's rate limit) makes this
// worse, not better: one card can hold a real figure while its neighbour
// is still empty, which reads as a genuine comparison.

const SHIMMER_KEYFRAMES = `
@keyframes jovelin-shimmer {
  0%   { opacity: 0.45; }
  50%  { opacity: 0.85; }
  100% { opacity: 0.45; }
}`;

// Injected once rather than per instance.
if (typeof document !== 'undefined' && !document.getElementById('jovelin-shimmer-style')) {
  const el = document.createElement('style');
  el.id = 'jovelin-shimmer-style';
  el.textContent = SHIMMER_KEYFRAMES;
  document.head.appendChild(el);
}

export function Skeleton({ width = 90, height = 28, style = {} }) {
  return (
    <span
      aria-busy="true"
      aria-label="Loading"
      style={{
        display: 'inline-block', width, height, borderRadius: 6,
        background: 'linear-gradient(90deg, #e5e9eb, #eef1f3, #e5e9eb)',
        animation: 'jovelin-shimmer 1.4s ease-in-out infinite',
        verticalAlign: 'middle', ...style,
      }}
    />
  );
}

// Shows a placeholder while loading, otherwise the formatted value.
// Deliberately takes the loading flag rather than inferring it from a
// falsy value — zero is a legitimate answer and has to be able to render.
export function StatValue({ loading, children, width = 110, height = 30, style = {} }) {
  if (loading) return <Skeleton width={width} height={height} style={style} />;
  return <>{children}</>;
}

export default Skeleton;
