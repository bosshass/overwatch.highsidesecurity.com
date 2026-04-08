// ============================================
// JUC-E V4 - PLUpload Component
// ============================================
// Parses QBO P&L xlsx files and saves to Supabase
// Extracts: Labor Rev, Materials Rev, Labor Exp, Materials Exp, Other Exp

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../services/supabase.js';

// Line item patterns to find in the QBO export
const PATTERNS = {
  // Revenue
  laborRevenue: [
    'Total for 4000 Hourly Services',
    'Total for 5000 Monitoring Income', 
    'Service/Fee Income'
  ],
  materialsRevenue: ['Sales of Product Income'],
  
  // Expenses
  subcontractors: ['5010 Subcontractors'],
  payroll: ['Total for 7990 Payroll Expenses'],
  totalCOGS: ['Total for Cost of Goods Sold'],
  totalExpenses: ['Total for Expenses']
};

// Parse a single value, handling NaN/null
const parseNum = (val) => {
  if (val === null || val === undefined || val === '' || isNaN(val)) return 0;
  return parseFloat(val) || 0;
};

// Find a row by pattern and return its values
const findRow = (rows, patterns) => {
  for (const pattern of patterns) {
    const row = rows.find(r => r[0] && typeof r[0] === 'string' && 
      r[0].trim().toLowerCase() === pattern.toLowerCase());
    if (row) return row;
  }
  return null;
};

// Extract week/month periods from header row
const parsePeriodHeaders = (headerRow) => {
  const periods = [];
  for (let i = 1; i < headerRow.length; i++) {
    const cell = headerRow[i];
    if (!cell || cell === 'Total' || cell === 'CURRENT' || String(cell).includes('(PY)')) continue;
    
    // Parse date ranges like "Feb 1 - Feb 8 2026" or "January 2026"
    const str = String(cell);
    
    // Check for week range: "Feb 1 - Feb 8 2026"
    const weekMatch = str.match(/(\w+)\s+(\d+)\s*-\s*(\w+)?\s*(\d+),?\s*(\d{4})/i);
    if (weekMatch) {
      const [_, startMonth, startDay, endMonth, endDay, year] = weekMatch;
      periods.push({
        index: i,
        label: str,
        type: 'week',
        year: parseInt(year)
      });
      continue;
    }
    
    // Check for month: "January 2026"
    const monthMatch = str.match(/^(\w+)\s+(\d{4})$/i);
    if (monthMatch) {
      periods.push({
        index: i,
        label: str,
        type: 'month',
        year: parseInt(monthMatch[2])
      });
    }
  }
  return periods;
};

// Parse dates from period label
const parsePeriodDates = (label, year) => {
  const months = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11,
    'january': 0, 'february': 1, 'march': 2, 'april': 3, 'june': 5,
    'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
  };
  
  // Week range: "Feb 1 - Feb 8 2026" or "Jan 26 - Feb 1 2026"
  const weekMatch = label.match(/(\w+)\s+(\d+)\s*-\s*(\w+)\s+(\d+),?\s*(\d{4})/i);
  if (weekMatch) {
    const [_, sm, sd, em, ed, y] = weekMatch;
    const startMonth = months[sm.toLowerCase()] ?? 0;
    const endMonth = months[em.toLowerCase()] ?? startMonth;
    return {
      start: new Date(parseInt(y), startMonth, parseInt(sd)),
      end: new Date(parseInt(y), endMonth, parseInt(ed))
    };
  }
  
  // Month: "January 2026"
  const monthMatch = label.match(/^(\w+)\s+(\d{4})$/i);
  if (monthMatch) {
    const m = months[monthMatch[1].toLowerCase()] ?? 0;
    const y = parseInt(monthMatch[2]);
    return {
      start: new Date(y, m, 1),
      end: new Date(y, m + 1, 0) // Last day of month
    };
  }
  
  return { start: new Date(), end: new Date() };
};

// Main parser function
export const parseQBOFile = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        // Find header row (contains date ranges)
        let headerRowIdx = rows.findIndex(r => 
          r.some(c => c && String(c).match(/\d{4}/))
        );
        if (headerRowIdx < 0) headerRowIdx = 4; // Default
        
        const headerRow = rows[headerRowIdx];
        const periods = parsePeriodHeaders(headerRow);
        
        // Find all the key rows
        const laborRevRows = PATTERNS.laborRevenue.map(p => findRow(rows, [p])).filter(Boolean);
        const matRevRow = findRow(rows, PATTERNS.materialsRevenue);
        const subRow = findRow(rows, PATTERNS.subcontractors);
        const payrollRow = findRow(rows, PATTERNS.payroll);
        const cogsRow = findRow(rows, PATTERNS.totalCOGS);
        const expRow = findRow(rows, PATTERNS.totalExpenses);
        
        // Extract data for each period
        const results = periods.map(period => {
          const idx = period.index;
          
          // Labor Revenue = sum of all labor rev rows
          const laborRev = laborRevRows.reduce((sum, row) => sum + parseNum(row[idx]), 0);
          
          // Materials Revenue
          const matRev = matRevRow ? parseNum(matRevRow[idx]) : 0;
          
          // Labor Expense = Subcontractors + Payroll
          const subExp = subRow ? parseNum(subRow[idx]) : 0;
          const payExp = payrollRow ? parseNum(payrollRow[idx]) : 0;
          const laborExp = subExp + payExp;
          
          // Materials Expense = COGS - Subcontractors
          const cogsTotal = cogsRow ? parseNum(cogsRow[idx]) : 0;
          const matExp = cogsTotal - subExp;
          
          // Other Expenses
          const otherExp = expRow ? parseNum(expRow[idx]) : 0;
          
          // Totals
          const totalRev = laborRev + matRev;
          const totalExp = laborExp + matExp + otherExp;
          const net = totalRev - totalExp;
          
          const dates = parsePeriodDates(period.label, period.year);
          
          return {
            period_type: period.type,
            period_label: period.label,
            period_start: dates.start.toISOString().split('T')[0],
            period_end: dates.end.toISOString().split('T')[0],
            year: period.year,
            month: dates.start.getMonth() + 1,
            week_number: Math.ceil(dates.start.getDate() / 7),
            
            labor_revenue: laborRev,
            materials_revenue: matRev,
            total_revenue: totalRev,
            
            labor_expense: laborExp,
            materials_expense: matExp,
            other_expense: otherExp,
            total_expense: totalExp,
            
            net_amount: net,
            
            source_file: file.name
          };
        });
        
        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

// Save parsed data to Supabase
export const savePLData = async (records, userEmail) => {
  const results = [];
  
  for (const record of records) {
    // Upsert based on period
    const { data, error } = await supabase
      .from('pl_data')
      .upsert({
        ...record,
        uploaded_by: userEmail
      }, {
        onConflict: 'period_type,period_start,period_end,year'
      })
      .select();
    
    if (error) {
      console.error('Save error:', error);
      results.push({ success: false, error: error.message, record });
    } else {
      results.push({ success: true, data });
    }
  }
  
  return results;
};

// Component
export default function PLUpload({ userEmail, onUploadComplete }) {
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);

  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setError(null);
    setDebugInfo(null);
    setIsUploading(true);
    
    try {
      const parsed = await parseQBOFile(selectedFile);
      console.log('Parsed P&L data:', parsed);
      
      if (!parsed || parsed.length === 0) {
        setError('No periods found in file. Make sure the file has date headers like "Jan 1 - Jan 7, 2026" or "January 2026".');
        setDebugInfo('The parser could not find any valid date columns in your file. Check that your QBO export has the correct format.');
        setPreview(null);
      } else {
        setPreview(parsed);
        setDebugInfo(`Found ${parsed.length} period(s): ${parsed.map(p => p.period_label).join(', ')}`);
      }
    } catch (err) {
      console.error('Parse error:', err);
      setError('Failed to parse file: ' + err.message);
      setDebugInfo(err.stack || 'No stack trace available');
      setPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = async () => {
    if (!preview || !preview.length) return;
    
    setIsUploading(true);
    setError(null);
    
    try {
      const results = await savePLData(preview, userEmail);
      const failures = results.filter(r => !r.success);
      
      if (failures.length > 0) {
        setError(`${failures.length} record(s) failed to save: ${failures.map(f => f.error).join(', ')}`);
        console.error('Save failures:', failures);
      } else {
        setPreview(null);
        setFile(null);
        setDebugInfo(null);
        onUploadComplete?.();
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError('Upload failed: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const formatCurrency = (val) => {
    if (!val && val !== 0) return '-';
    return val < 0 ? `($${Math.abs(val).toLocaleString()})` : `$${val.toLocaleString()}`;
  };

  return (
    <div style={{ padding: '16px' }}>
      {/* Upload button */}
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        background: '#3b82f6', color: '#fff', padding: '10px 16px',
        borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600'
      }}>
        📤 {file ? 'Change File' : 'Upload QBO P&L'}
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </label>

      {file && (
        <span style={{ marginLeft: '12px', color: '#94a3b8', fontSize: '13px' }}>
          {file.name}
        </span>
      )}

      {error && (
        <div style={{ marginTop: '12px', color: '#ef4444', fontSize: '13px' }}>
          ⚠️ {error}
        </div>
      )}

      {debugInfo && (
        <div style={{ marginTop: '8px', color: '#64748b', fontSize: '11px', background: '#0f172a', padding: '8px', borderRadius: '6px' }}>
          ℹ️ {debugInfo}
        </div>
      )}

      {isUploading && (
        <div style={{ marginTop: '12px', color: '#94a3b8', fontSize: '13px' }}>
          Processing...
        </div>
      )}

      {/* Preview */}
      {preview && preview.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
            PREVIEW ({preview.length} periods)
          </div>
          
          <div style={{ background: '#0f172a', borderRadius: '8px', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  <th style={{ padding: '8px', textAlign: 'left', color: '#64748b' }}>Period</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>Labor Rev</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>Mat Rev</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>Labor Exp</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>Mat Exp</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>Other</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px', color: '#e2e8f0' }}>{row.period_label}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#22c55e' }}>{formatCurrency(row.labor_revenue)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#22c55e' }}>{formatCurrency(row.materials_revenue)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#ef4444' }}>{formatCurrency(row.labor_expense)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#ef4444' }}>{formatCurrency(row.materials_expense)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#f59e0b' }}>{formatCurrency(row.other_expense)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: row.net_amount >= 0 ? '#00c8e8' : '#ef4444', fontWeight: '600' }}>
                      {formatCurrency(row.net_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button
              onClick={handleUpload}
              disabled={isUploading}
              style={{
                background: '#22c55e', color: '#fff', border: 'none',
                padding: '10px 20px', borderRadius: '8px', fontSize: '14px',
                fontWeight: '600', cursor: 'pointer'
              }}
            >
              ✓ Save {preview.length} Period(s)
            </button>
            <button
              onClick={() => { setPreview(null); setFile(null); }}
              style={{
                background: '#334155', color: '#94a3b8', border: 'none',
                padding: '10px 20px', borderRadius: '8px', fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
