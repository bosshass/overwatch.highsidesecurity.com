// ============================================
// JUC-E V4 - PLDashboard Component
// ============================================
// Displays P&L data in 3 views:
// 1. This Month by Week (vs PY)
// 2. YTD by Month
// 3. YTD by Week

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import PLUpload from './PLUpload.jsx';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
                'July', 'August', 'September', 'October', 'November', 'December'];

export default function PLDashboard({ userEmail }) {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState('month'); // 'month' | 'ytd-month' | 'ytd-week'
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [showUpload, setShowUpload] = useState(false);
  const [availablePeriods, setAvailablePeriods] = useState([]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get all data for selected year
      const { data: records, error } = await supabase
        .from('pl_data')
        .select('*')
        .gte('year', selectedYear - 1) // Include prior year for comparison
        .lte('year', selectedYear)
        .order('period_start', { ascending: true });
      
      if (error) throw error;
      setData(records || []);
      
      // Build available periods for dropdown
      const periods = new Set();
      (records || []).forEach(r => {
        if (r.year === selectedYear) {
          periods.add(`${MONTHS[r.month]} ${r.year}`);
        }
      });
      setAvailablePeriods(Array.from(periods));
      
    } catch (e) {
      console.error('Load P&L error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => { loadData(); }, [loadData]);

  const formatCurrency = (val, compact = false) => {
    if (val === null || val === undefined) return '-';
    if (compact && Math.abs(val) >= 1000) {
      const k = val / 1000;
      return val < 0 ? `($${Math.abs(k).toFixed(1)}k)` : `$${k.toFixed(1)}k`;
    }
    return val < 0 ? `($${Math.abs(val).toLocaleString()})` : `$${val.toLocaleString()}`;
  };

  const formatDiff = (current, prior) => {
    if (prior === null || prior === undefined || prior === 0) return '-';
    const diff = current - prior;
    const pct = ((diff / Math.abs(prior)) * 100).toFixed(0);
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${formatCurrency(diff, true)} (${sign}${pct}%)`;
  };

  // Filter data for current view
  const getViewData = () => {
    const currentYearData = data.filter(d => d.year === selectedYear);
    const priorYearData = data.filter(d => d.year === selectedYear - 1);
    
    if (view === 'month') {
      // This month by week
      const weeks = currentYearData.filter(d => d.period_type === 'week' && d.month === selectedMonth);
      return weeks.map(w => {
        // Find matching PY week (same week number in same month)
        const pyWeek = priorYearData.find(p => 
          p.period_type === 'week' && p.month === selectedMonth && p.week_number === w.week_number
        );
        return { ...w, py: pyWeek };
      });
    }
    
    if (view === 'ytd-month') {
      // YTD by month
      const months = currentYearData.filter(d => d.period_type === 'month');
      return months.map(m => {
        const pyMonth = priorYearData.find(p => p.period_type === 'month' && p.month === m.month);
        return { ...m, py: pyMonth };
      });
    }
    
    if (view === 'ytd-week') {
      // YTD all weeks
      const weeks = currentYearData.filter(d => d.period_type === 'week');
      return weeks.map(w => {
        const pyWeek = priorYearData.find(p => 
          p.period_type === 'week' && p.month === w.month && p.week_number === w.week_number
        );
        return { ...w, py: pyWeek };
      });
    }
    
    return [];
  };

  const viewData = getViewData();
  
  // Calculate totals
  const totals = viewData.reduce((acc, row) => ({
    labor_revenue: acc.labor_revenue + (row.labor_revenue || 0),
    materials_revenue: acc.materials_revenue + (row.materials_revenue || 0),
    total_revenue: acc.total_revenue + (row.total_revenue || 0),
    labor_expense: acc.labor_expense + (row.labor_expense || 0),
    materials_expense: acc.materials_expense + (row.materials_expense || 0),
    other_expense: acc.other_expense + (row.other_expense || 0),
    total_expense: acc.total_expense + (row.total_expense || 0),
    net_amount: acc.net_amount + (row.net_amount || 0),
    py_labor_revenue: acc.py_labor_revenue + (row.py?.labor_revenue || 0),
    py_materials_revenue: acc.py_materials_revenue + (row.py?.materials_revenue || 0),
    py_total_revenue: acc.py_total_revenue + (row.py?.total_revenue || 0),
    py_labor_expense: acc.py_labor_expense + (row.py?.labor_expense || 0),
    py_materials_expense: acc.py_materials_expense + (row.py?.materials_expense || 0),
    py_other_expense: acc.py_other_expense + (row.py?.other_expense || 0),
    py_total_expense: acc.py_total_expense + (row.py?.total_expense || 0),
    py_net_amount: acc.py_net_amount + (row.py?.net_amount || 0),
  }), {
    labor_revenue: 0, materials_revenue: 0, total_revenue: 0,
    labor_expense: 0, materials_expense: 0, other_expense: 0, total_expense: 0, net_amount: 0,
    py_labor_revenue: 0, py_materials_revenue: 0, py_total_revenue: 0,
    py_labor_expense: 0, py_materials_expense: 0, py_other_expense: 0, py_total_expense: 0, py_net_amount: 0
  });

  const viewTitles = {
    'month': `${MONTHS[selectedMonth]} ${selectedYear} by Week`,
    'ytd-month': `${selectedYear} YTD by Month`,
    'ytd-week': `${selectedYear} YTD by Week`
  };

  return (
    <div style={{ background: '#0f172a', borderRadius: '12px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>📊 P&L</span>
          
          {/* View tabs */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { key: 'month', label: 'Month' },
              { key: 'ytd-month', label: 'YTD' },
              { key: 'ytd-week', label: 'Weeks' }
            ].map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                style={{
                  padding: '4px 10px', borderRadius: '6px', border: 'none',
                  background: view === v.key ? '#3b82f6' : '#1e293b',
                  color: view === v.key ? '#fff' : '#64748b',
                  fontSize: '11px', fontWeight: '600', cursor: 'pointer'
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Month selector (only for month view) */}
          {view === 'month' && (
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(parseInt(e.target.value))}
              style={{
                background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
                color: '#e2e8f0', padding: '4px 8px', fontSize: '12px'
              }}
            >
              {MONTHS.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          )}
          
          {/* Year selector */}
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(parseInt(e.target.value))}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
              color: '#e2e8f0', padding: '4px 8px', fontSize: '12px'
            }}
          >
            {[2026, 2025, 2024].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          
          {/* Upload button */}
          <button
            onClick={() => loadData()}
            style={{
              background: '#1e293b', color: '#00c8e8',
              border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px',
              fontSize: '11px', fontWeight: '600', cursor: 'pointer'
            }}
          >
            🔄 Refresh
          </button>
          <button
            onClick={() => setShowUpload(!showUpload)}
            style={{
              background: showUpload ? '#334155' : '#3b82f6', color: '#fff',
              border: 'none', borderRadius: '6px', padding: '4px 10px',
              fontSize: '11px', fontWeight: '600', cursor: 'pointer'
            }}
          >
            {showUpload ? '✕' : '📤 Upload'}
          </button>
        </div>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div style={{ borderBottom: '1px solid #1e293b' }}>
          <PLUpload 
            userEmail={userEmail} 
            onUploadComplete={() => { setShowUpload(false); loadData(); }} 
          />
        </div>
      )}

      {/* Title */}
      <div style={{ padding: '12px 16px 8px', color: '#94a3b8', fontSize: '13px', fontWeight: '600' }}>
        {viewTitles[view]}
      </div>

      {/* Data table */}
      {isLoading ? (
        <div style={{ padding: '20px', color: '#64748b', textAlign: 'center' }}>Loading...</div>
      ) : viewData.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ color: '#64748b', marginBottom: '8px' }}>
            No data for {viewTitles[view]}.
          </div>
          <div style={{ color: '#475569', fontSize: '12px', marginBottom: '12px' }}>
            {data.length > 0 
              ? `Found ${data.length} record(s) in database — try different month/year filter above.`
              : 'No P&L data uploaded yet. Click 📤 Upload to import a QBO P&L export (.xlsx).'}
          </div>
          {data.length === 0 && (
            <button
              onClick={() => setShowUpload(true)}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: '8px', padding: '10px 20px', fontSize: '14px',
                fontWeight: '600', cursor: 'pointer'
              }}
            >
              📤 Upload QBO P&L Report
            </button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '700px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #334155' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: '600' }}>Week Of</th>
                <th colSpan="3" style={{ padding: '8px', textAlign: 'center', color: '#22c55e', fontWeight: '600', borderLeft: '1px solid #334155' }}>REVENUE</th>
                <th colSpan="4" style={{ padding: '8px', textAlign: 'center', color: '#ef4444', fontWeight: '600', borderLeft: '1px solid #334155' }}>EXPENSES</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', color: '#00c8e8', fontWeight: '600', borderLeft: '1px solid #334155' }}>+/-</th>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <th style={{ padding: '4px 12px', textAlign: 'left', color: '#475569', fontSize: '10px' }}></th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#475569', fontSize: '10px', borderLeft: '1px solid #334155' }}>Labor</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#475569', fontSize: '10px' }}>Materials</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#475569', fontSize: '10px' }}>Total</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#475569', fontSize: '10px', borderLeft: '1px solid #334155' }}>Labor</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#475569', fontSize: '10px' }}>Materials</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#475569', fontSize: '10px' }}>Other</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#475569', fontSize: '10px' }}>Total</th>
                <th style={{ padding: '4px 12px', textAlign: 'right', color: '#475569', fontSize: '10px', borderLeft: '1px solid #334155' }}></th>
              </tr>
            </thead>
            <tbody>
              {viewData.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 12px', color: '#e2e8f0', fontWeight: '500' }}>
                    {row.period_label}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#22c55e', borderLeft: '1px solid #1e293b' }}>
                    {formatCurrency(row.labor_revenue)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#22c55e' }}>
                    {formatCurrency(row.materials_revenue)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#22c55e', fontWeight: '600' }}>
                    {formatCurrency(row.total_revenue)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#ef4444', borderLeft: '1px solid #1e293b' }}>
                    {formatCurrency(row.labor_expense)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#ef4444' }}>
                    {formatCurrency(row.materials_expense)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#f59e0b' }}>
                    {formatCurrency(row.other_expense)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#ef4444', fontWeight: '600' }}>
                    {formatCurrency(row.total_expense)}
                  </td>
                  <td style={{ 
                    padding: '10px 12px', textAlign: 'right', fontWeight: '700', borderLeft: '1px solid #1e293b',
                    color: row.net_amount >= 0 ? '#00c8e8' : '#ef4444'
                  }}>
                    {formatCurrency(row.net_amount)}
                  </td>
                </tr>
              ))}
              
              {/* Totals row */}
              <tr style={{ background: '#1e293b', borderTop: '2px solid #334155' }}>
                <td style={{ padding: '10px 12px', color: '#e2e8f0', fontWeight: '700' }}>TOTAL</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#22c55e', fontWeight: '700', borderLeft: '1px solid #334155' }}>
                  {formatCurrency(totals.labor_revenue)}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#22c55e', fontWeight: '700' }}>
                  {formatCurrency(totals.materials_revenue)}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#22c55e', fontWeight: '700' }}>
                  {formatCurrency(totals.total_revenue)}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#ef4444', fontWeight: '700', borderLeft: '1px solid #334155' }}>
                  {formatCurrency(totals.labor_expense)}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#ef4444', fontWeight: '700' }}>
                  {formatCurrency(totals.materials_expense)}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#f59e0b', fontWeight: '700' }}>
                  {formatCurrency(totals.other_expense)}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', color: '#ef4444', fontWeight: '700' }}>
                  {formatCurrency(totals.total_expense)}
                </td>
                <td style={{ 
                  padding: '10px 12px', textAlign: 'right', fontWeight: '700', borderLeft: '1px solid #334155',
                  color: totals.net_amount >= 0 ? '#00c8e8' : '#ef4444'
                }}>
                  {formatCurrency(totals.net_amount)}
                </td>
              </tr>
              
              {/* vs PY row */}
              <tr style={{ background: '#0f172a' }}>
                <td style={{ padding: '8px 12px', color: '#64748b', fontSize: '11px' }}>vs PY</td>
                <td style={{ padding: '8px', textAlign: 'right', fontSize: '10px', borderLeft: '1px solid #1e293b',
                  color: totals.labor_revenue >= totals.py_labor_revenue ? '#22c55e' : '#ef4444' }}>
                  {formatDiff(totals.labor_revenue, totals.py_labor_revenue)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontSize: '10px',
                  color: totals.materials_revenue >= totals.py_materials_revenue ? '#22c55e' : '#ef4444' }}>
                  {formatDiff(totals.materials_revenue, totals.py_materials_revenue)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontSize: '10px',
                  color: totals.total_revenue >= totals.py_total_revenue ? '#22c55e' : '#ef4444' }}>
                  {formatDiff(totals.total_revenue, totals.py_total_revenue)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontSize: '10px', borderLeft: '1px solid #1e293b',
                  color: totals.labor_expense <= totals.py_labor_expense ? '#22c55e' : '#ef4444' }}>
                  {formatDiff(totals.labor_expense, totals.py_labor_expense)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontSize: '10px',
                  color: totals.materials_expense <= totals.py_materials_expense ? '#22c55e' : '#ef4444' }}>
                  {formatDiff(totals.materials_expense, totals.py_materials_expense)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontSize: '10px',
                  color: totals.other_expense <= totals.py_other_expense ? '#22c55e' : '#ef4444' }}>
                  {formatDiff(totals.other_expense, totals.py_other_expense)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontSize: '10px',
                  color: totals.total_expense <= totals.py_total_expense ? '#22c55e' : '#ef4444' }}>
                  {formatDiff(totals.total_expense, totals.py_total_expense)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '10px', fontWeight: '600', borderLeft: '1px solid #1e293b',
                  color: totals.net_amount >= totals.py_net_amount ? '#00c8e8' : '#ef4444' }}>
                  {formatDiff(totals.net_amount, totals.py_net_amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
