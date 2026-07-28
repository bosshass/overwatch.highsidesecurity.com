// ============================================
// Jovelin — Income vs Expenses chart
// ============================================
// Hand-rolled SVG rather than pulling in a charting library: the bundle is
// already ~1.5MB and recharts would add several hundred KB for one grouped
// bar chart. Also renders identically in both places it's used (Revenue
// landing, and the Command Center tile) with no theming layer.
//
// Four bars per month — invoiced / collected against incurred / paid — so
// accrual and cash are visible side by side rather than netted together.

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const SUBTEXT = '#6b7787', BORDER = '#e5e9eb';

const SERIES = [
  { key: 'invoiced',  label: 'Invoiced',  color: TEAL },
  { key: 'collected', label: 'Collected', color: GREEN },
  // 'Expenses' vs 'Paid Out' reads as a contradiction when the second is
  // larger. Naming the accounting basis is what makes the gap make sense:
  // bills are incurred when entered and paid later, so a month spent
  // clearing older payables shows more cash out than new cost.
  { key: 'incurred',  label: 'Billed to us',  color: AMBER },
  { key: 'paid',      label: 'Cash out',      color: RED },
];

const shortMonth = (ym) => {
  const [y, m] = (ym || '').split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
};

const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (a >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
};

export default function IncomeExpenseChart({ series, height = 200, showLegend = true }) {
  if (!series?.length) return null;

  const max = Math.max(
    1, // never divide by zero on an all-empty company
    ...series.flatMap(m => SERIES.map(s => m[s.key] || 0))
  );

  const W = 100;                       // viewBox units — scales to any container
  const groupW = W / series.length;
  const barW = (groupW * 0.72) / SERIES.length;
  const pad = (groupW - barW * SERIES.length) / 2;

  return (
    <div>
      <svg viewBox={`0 0 ${W} 46`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        {/* baseline */}
        <line x1="0" y1="40" x2={W} y2="40" stroke={BORDER} strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        {series.map((m, gi) => (
          <g key={m.month}>
            {SERIES.map((s, si) => {
              const v = m[s.key] || 0;
              const h = (v / max) * 38;
              return (
                <rect
                  key={s.key}
                  x={gi * groupW + pad + si * barW}
                  y={40 - h}
                  width={barW * 0.82}
                  height={Math.max(h, v > 0 ? 0.4 : 0)}
                  fill={s.color}
                  rx="0.3"
                >
                  <title>{`${shortMonth(m.month)} · ${s.label}: ${compact(v)}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>

      {/* Month labels sit outside the SVG so preserveAspectRatio="none"
          doesn't stretch the text horizontally. */}
      <div style={{ display: 'flex', marginTop: 4 }}>
        {series.map(m => (
          <div key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: SUBTEXT }}>
            {shortMonth(m.month)}
          </div>
        ))}
      </div>

      {showLegend && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, justifyContent: 'center' }}>
          {SERIES.map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: SUBTEXT }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
