// ============================================
// P&L Upload - Parses QBO xlsx, saves to Supabase
// ============================================
import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import * as XLSX from 'xlsx';

export default function PLUpload({ userEmail, onUploadComplete }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const parseQBOExcel = useCallback((workbook) => {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Find header row with date columns
    // Patterns: "Jan 2026", "Jan 1-4 2026", "Jan 26 - Feb 1 2026", "Mar 1-1 2026"
    let headerRowIdx = -1;
    let periodCols = [];
    
    const datePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\d\-]+\d{4}$/i;
    
    for (let i = 0; i < Math.min(10, raw.length); i++) {
      const row = raw[i];
      const matches = [];
      for (let c = 1; c < row.length; c++) {
        const cell = String(row[c] || '').trim();
        if (datePattern.test(cell)) {
          matches.push({ col: c, label: cell });
        }
      }
      if (matches.length >= 2) {
        headerRowIdx = i;
        periodCols = matches;
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error('No periods found in file. Make sure the file has date headers like "Jan 1 - Jan 7, 2026" or "January 2026".');
    }

    // Parse period info from labels
    const periods = periodCols.map(p => {
      const label = p.label;
      // Extract year
      const yearMatch = label.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      
      // Extract month
      const monthMatch = label.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
      const monthNames = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const month = monthMatch ? monthNames[monthMatch[1].toLowerCase()] : 1;
      
      // Determine period type (week vs month)
      const isWeek = /\d+\s*-\s*\d+/.test(label) || /\d+\s*-\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(label);
      
      return {
        col: p.col,
        label,
        year,
        month,
        period_type: isWeek ? 'week' : 'month',
        period_start: `${year}-${String(month).padStart(2, '0')}-01`,
        period_end: `${year}-${String(month).padStart(2, '0')}-28`
      };
    });

    // Parse data rows - find key totals
    const result = { periods: [], rows: [] };
    
    const getValue = (row, colIdx) => {
      const v = row[colIdx];
      if (v === '' || v === null || v === undefined || v === '-') return 0;
      const num = parseFloat(String(v).replace(/[,$]/g, ''));
      return isNaN(num) ? 0 : num;
    };

    let totalIncome = new Array(periods.length).fill(0);
    let totalCOGS = new Array(periods.length).fill(0);
    let grossProfit = new Array(periods.length).fill(0);
    let totalExpenses = new Array(periods.length).fill(0);
    let netIncome = new Array(periods.length).fill(0);

    for (let i = headerRowIdx + 1; i < raw.length; i++) {
      const row = raw[i];
      const label = String(row[0] || '').trim();
      
      if (/^Total for Income$/i.test(label)) {
        totalIncome = periods.map(p => getValue(row, p.col));
      }
      if (/^Total for Cost of Goods Sold$/i.test(label)) {
        totalCOGS = periods.map(p => getValue(row, p.col));
      }
      if (/^Gross Profit$/i.test(label)) {
        grossProfit = periods.map(p => getValue(row, p.col));
      }
      if (/^Total for Expenses$/i.test(label)) {
        totalExpenses = periods.map(p => getValue(row, p.col));
      }
      if (/^Net Income$/i.test(label)) {
        netIncome = periods.map(p => getValue(row, p.col));
      }
    }

    // Build records for Supabase
    result.periods = periods.map((p, i) => ({
      period_type: p.period_type,
      period_label: p.label,
      period_start: p.period_start,
      period_end: p.period_end,
      year: p.year,
      month: p.month,
      week_number: i + 1,
      total_revenue: totalIncome[i],
      labor_revenue: totalIncome[i] - (totalCOGS[i] > 0 ? totalCOGS[i] * 0.3 : 0), // estimate
      materials_revenue: totalCOGS[i] > 0 ? totalCOGS[i] * 0.3 : 0,
      total_expense: totalCOGS[i] + totalExpenses[i],
      labor_expense: totalExpenses[i] * 0.4,
      materials_expense: totalCOGS[i],
      other_expense: totalExpenses[i] * 0.6,
      net_amount: netIncome[i],
      source_file: file?.name || 'upload',
      uploaded_by: userEmail
    }));

    return result;
  }, [file, userEmail]);

  const handleFile = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    
    setFile(f);
    setError(null);
    setPreview(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const arr = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(arr, { type: 'array' });
        const parsed = parseQBOExcel(workbook);
        setPreview(parsed);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsArrayBuffer(f);
  }, [parseQBOExcel]);

  const handleSave = async () => {
    if (!preview?.periods?.length) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      // Upsert each period (update if exists, insert if new)
      for (const period of preview.periods) {
        const { error: upsertError } = await supabase
          .from('pl_data')
          .upsert(period, { 
            onConflict: 'period_type,period_start,period_end,year',
            ignoreDuplicates: false 
          });
        
        if (upsertError) throw upsertError;
      }
      
      onUploadComplete?.();
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const fmt = (n) => n < 0 ? `($${Math.abs(n).toLocaleString()})` : `$${n.toLocaleString()}`;

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '12px' }}>
        <input 
          type="file" 
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          style={{ fontSize: '12px' }}
        />
      </div>

      {file && (
        <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>
          {file.name}
        </div>
      )}

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '12px' }}>
          ⚠️ {error}
          <div style={{ color: '#f87171', fontSize: '11px', marginTop: '4px' }}>
            The parser could not find any valid date columns in your file. Check that your QBO export has the correct format.
          </div>
        </div>
      )}

      {preview && preview.periods.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>
            ✓ Found {preview.periods.length} periods
          </div>
          
          {/* Preview table */}
          <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ background: '#1e293b' }}>
                  <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8' }}>Period</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>Revenue</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>Expenses</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {preview.periods.slice(0, 6).map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px', color: '#e2e8f0' }}>{p.period_label}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#4ade80' }}>{fmt(p.total_revenue)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#f87171' }}>{fmt(p.total_expense)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: p.net_amount >= 0 ? '#4ade80' : '#f87171' }}>{fmt(p.net_amount)}</td>
                  </tr>
                ))}
                {preview.periods.length > 6 && (
                  <tr><td colSpan={4} style={{ padding: '8px', color: '#64748b', textAlign: 'center' }}>...and {preview.periods.length - 6} more</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              background: isSaving ? '#334155' : '#3b82f6', color: '#fff',
              border: 'none', borderRadius: '6px', padding: '8px 16px',
              fontSize: '12px', fontWeight: '600', cursor: isSaving ? 'not-allowed' : 'pointer'
            }}
          >
            {isSaving ? 'Saving...' : 'Save to Dashboard'}
          </button>
        </div>
      )}
    </div>
  );
}
