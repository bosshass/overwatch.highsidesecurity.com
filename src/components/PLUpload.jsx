import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';

export default function PLUpload({ onDataParsed, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [debug, setDebug] = useState(null);

  const parseQBOExcel = useCallback((workbook) => {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    // Debug: show first 10 rows
    setDebug({ rowCount: raw.length, sample: raw.slice(0, 10) });

    // Find header row (contains month columns like "Jan 2026" or date ranges)
    let headerRowIdx = -1;
    let periods = [];
    
    for (let i = 0; i < Math.min(10, raw.length); i++) {
      const row = raw[i];
      // Look for row with month/date patterns in columns 1+
      const hasDateCols = row.slice(1).some(cell => 
        cell && /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}|^\w+\s+\d+-\d+/.test(String(cell))
      );
      if (hasDateCols) {
        headerRowIdx = i;
        // Extract period names (skip first col which is label, skip last "Total" col)
        periods = row.slice(1).filter(c => c && !/^Total$/i.test(String(c))).map(String);
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error('Could not find header row with date columns');
    }

    // Parse data rows
    const data = {
      periods,
      income: { total: [], categories: {} },
      cogs: { total: [], categories: {} },
      grossProfit: [],
      expenses: { total: [], categories: {} },
      netOperatingIncome: [],
      netIncome: []
    };

    let currentSection = null; // 'income', 'cogs', 'expenses'
    
    for (let i = headerRowIdx + 1; i < raw.length; i++) {
      const row = raw[i];
      const label = String(row[0] || '').trim();
      const values = row.slice(1, 1 + periods.length).map(v => {
        if (v === '' || v === null || v === undefined) return 0;
        const num = parseFloat(String(v).replace(/[,$]/g, ''));
        return isNaN(num) ? 0 : num;
      });

      if (!label) continue;

      // Section detection
      if (/^Income$/i.test(label)) { currentSection = 'income'; continue; }
      if (/^Cost of Goods Sold$/i.test(label)) { currentSection = 'cogs'; continue; }
      if (/^Expenses$/i.test(label)) { currentSection = 'expenses'; continue; }
      if (/^Other Income$/i.test(label)) { currentSection = null; continue; }

      // Totals
      if (/^Total for Income$/i.test(label)) {
        data.income.total = values;
        currentSection = null;
        continue;
      }
      if (/^Total for Cost of Goods Sold$/i.test(label)) {
        data.cogs.total = values;
        currentSection = null;
        continue;
      }
      if (/^Gross Profit$/i.test(label)) {
        data.grossProfit = values;
        continue;
      }
      if (/^Total for Expenses$/i.test(label)) {
        data.expenses.total = values;
        currentSection = null;
        continue;
      }
      if (/^Net Operating Income$/i.test(label)) {
        data.netOperatingIncome = values;
        continue;
      }
      if (/^Net Income$/i.test(label)) {
        data.netIncome = values;
        continue;
      }

      // Skip "Total for X" sub-category lines
      if (/^Total for /i.test(label)) continue;

      // Add to current section categories
      if (currentSection && values.some(v => v !== 0)) {
        const section = currentSection === 'income' ? data.income :
                       currentSection === 'cogs' ? data.cogs : data.expenses;
        section.categories[label] = values;
      }
    }

    return data;
  }, []);

  const handleFile = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    
    setFile(f);
    setError(null);
    setDebug(null);
    setPreview(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const parsed = parseQBOExcel(workbook);
        setPreview(parsed);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsArrayBuffer(f);
  }, [parseQBOExcel]);

  const handleConfirm = () => {
    if (preview && onDataParsed) {
      onDataParsed(preview);
      onClose?.();
    }
  };

  return (
    <div style={{ padding: 24, background: '#1e1e1e', borderRadius: 8, maxWidth: 600 }}>
      <h3 style={{ color: '#fff', marginBottom: 16 }}>Upload P&L from QuickBooks</h3>
      
      <input 
        type="file" 
        accept=".xlsx,.xls,.csv"
        onChange={handleFile}
        style={{ marginBottom: 16 }}
      />

      {error && (
        <div style={{ color: '#ff6b6b', background: '#3a2020', padding: 12, borderRadius: 4, marginBottom: 16 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {debug && (
        <div style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
          <div>Rows found: {debug.rowCount}</div>
          <div>Sample: {JSON.stringify(debug.sample?.slice(0,3))}</div>
        </div>
      )}

      {preview && (
        <div style={{ color: '#4ade80', marginBottom: 16 }}>
          <div>✓ Parsed {preview.periods.length} periods: {preview.periods.join(', ')}</div>
          <div>✓ Income categories: {Object.keys(preview.income.categories).length}</div>
          <div>✓ COGS categories: {Object.keys(preview.cogs.categories).length}</div>
          <div>✓ Expense categories: {Object.keys(preview.expenses.categories).length}</div>
          {preview.netIncome.length > 0 && (
            <div>✓ Net Income: {preview.netIncome.map(n => '$' + n.toLocaleString()).join(', ')}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <button 
          onClick={handleConfirm}
          disabled={!preview}
          style={{ 
            padding: '8px 16px', 
            background: preview ? '#3b82f6' : '#444',
            color: '#fff', 
            border: 'none', 
            borderRadius: 4,
            cursor: preview ? 'pointer' : 'not-allowed'
          }}
        >
          Confirm Import
        </button>
        <button 
          onClick={onClose}
          style={{ padding: '8px 16px', background: '#333', color: '#fff', border: 'none', borderRadius: 4 }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
