import React from 'react';

export default function PLDashboard({ data }) {
  if (!data) return null;

  const formatCurrency = (n) => {
    if (n === 0) return '-';
    return n < 0 ? `($${Math.abs(n).toLocaleString()})` : `$${n.toLocaleString()}`;
  };

  const lastIdx = data.periods.length - 1;
  const latestPeriod = data.periods[lastIdx] || 'Current';

  // Get latest values
  const latestIncome = data.income.total[lastIdx] || 0;
  const latestCOGS = data.cogs.total[lastIdx] || 0;
  const latestGross = data.grossProfit[lastIdx] || 0;
  const latestExpenses = data.expenses.total[lastIdx] || 0;
  const latestNet = data.netIncome[lastIdx] || 0;

  const grossMargin = latestIncome > 0 ? ((latestGross / latestIncome) * 100).toFixed(1) : 0;
  const netMargin = latestIncome > 0 ? ((latestNet / latestIncome) * 100).toFixed(1) : 0;

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ color: '#fff', marginBottom: 20 }}>P&L Summary — {latestPeriod}</h2>
      
      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <MetricCard label="Revenue" value={formatCurrency(latestIncome)} color="#4ade80" />
        <MetricCard label="COGS" value={formatCurrency(latestCOGS)} color="#f87171" />
        <MetricCard label="Gross Profit" value={formatCurrency(latestGross)} subtext={`${grossMargin}% margin`} color="#60a5fa" />
        <MetricCard label="Expenses" value={formatCurrency(latestExpenses)} color="#fbbf24" />
        <MetricCard label="Net Income" value={formatCurrency(latestNet)} subtext={`${netMargin}% margin`} color={latestNet >= 0 ? '#4ade80' : '#f87171'} />
      </div>

      {/* Period Comparison Table */}
      <div style={{ background: '#252525', borderRadius: 8, padding: 16, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#fff', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #444' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Category</th>
              {data.periods.map(p => <th key={p} style={{ textAlign: 'right', padding: 8 }}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: '#2a2a2a' }}>
              <td style={{ padding: 8, fontWeight: 600 }}>Total Income</td>
              {data.income.total.map((v, i) => <td key={i} style={{ textAlign: 'right', padding: 8, color: '#4ade80' }}>{formatCurrency(v)}</td>)}
            </tr>
            <tr>
              <td style={{ padding: 8, fontWeight: 600 }}>COGS</td>
              {data.cogs.total.map((v, i) => <td key={i} style={{ textAlign: 'right', padding: 8, color: '#f87171' }}>{formatCurrency(v)}</td>)}
            </tr>
            <tr style={{ background: '#2a2a2a' }}>
              <td style={{ padding: 8, fontWeight: 600 }}>Gross Profit</td>
              {data.grossProfit.map((v, i) => <td key={i} style={{ textAlign: 'right', padding: 8, color: '#60a5fa' }}>{formatCurrency(v)}</td>)}
            </tr>
            <tr>
              <td style={{ padding: 8, fontWeight: 600 }}>Expenses</td>
              {data.expenses.total.map((v, i) => <td key={i} style={{ textAlign: 'right', padding: 8, color: '#fbbf24' }}>{formatCurrency(v)}</td>)}
            </tr>
            <tr style={{ background: '#1e3a2f', fontWeight: 700 }}>
              <td style={{ padding: 8 }}>Net Income</td>
              {data.netIncome.map((v, i) => <td key={i} style={{ textAlign: 'right', padding: 8, color: v >= 0 ? '#4ade80' : '#f87171' }}>{formatCurrency(v)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Top Expense Categories */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ color: '#888', marginBottom: 12 }}>Top Expenses ({latestPeriod})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(data.expenses.categories)
            .map(([name, vals]) => ({ name, value: vals[lastIdx] || 0 }))
            .filter(e => e.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 8)
            .map(exp => (
              <div key={exp.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#252525', borderRadius: 4 }}>
                <span style={{ color: '#ccc' }}>{exp.name}</span>
                <span style={{ color: '#fbbf24' }}>{formatCurrency(exp.value)}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, subtext, color }) {
  return (
    <div style={{ background: '#252525', borderRadius: 8, padding: 16, borderLeft: `3px solid ${color}` }}>
      <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 24, fontWeight: 700 }}>{value}</div>
      {subtext && <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>{subtext}</div>}
    </div>
  );
}
