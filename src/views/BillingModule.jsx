// ============================================
// Jovelin — Billing
// ============================================
// Two feeds, both real:
//   1. Invoice Requests — created when an estimate is marked Approved
//      (CustomerView prompts for how much of it to invoice now). Each
//      one is a reminder: go create this invoice for this amount, for
//      this customer, then mark it done here.
//   2. Unbilled Time — every unbilled time entry, from anywhere (Today,
//      Board, job completion). Select any number of them and batch them
//      onto an invoice reference, or mark them reviewed — non-billable
//      (write-off) or fixed-fee (tracked for margin, not billed hourly).
// '+ Create Invoice' on an accepted estimate's Rollup tab lands here with
// an invoice modal already open: Download a client-safe PDF, or push a
// real (unsent) invoice into QuickBooks — creating it never triggers
// QBO's own send action, and right after creating it, Jovelin re-fetches
// that exact invoice from QBO to confirm it exists and the dollar total
// actually matches, rather than just trusting the create call blindly.
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import ARChase from '../components/ARChase.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtHrs = (mins) => `${((mins || 0) / 60).toFixed(2)}h`;

const DISPOSITION_LABELS = {
  billable: { label: 'Billable', color: TEAL, bg: '#e8f0f4' },
  internal: { label: 'Internal', color: SUBTEXT, bg: '#f1f3f4' },
  reviewed_non_billable: { label: 'Reviewed · Non-Billable', color: RED, bg: '#fdecea' },
  reviewed_fixed_fee: { label: 'Reviewed · Fixed Fee', color: AMBER, bg: '#fff7ed' },
};

export default function BillingModule({ userEmail }) {
  const { currentTenantId, currentTenant } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [invoiceEst, setInvoiceEst] = useState(null);
  const [invoiceResult, setInvoiceResult] = useState(null);
  const [invoicing, setInvoicing] = useState(false);
  const [requests, setRequests] = useState([]);
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [invoiceRef, setInvoiceRef] = useState('');

  const [items, setItems] = useState([]);          // QBO products/services
  const [builder, setBuilder] = useState(null);    // { customerId, customerName, lines[], entryIds[] }
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  // Filters are applied to what's already loaded rather than re-queried,
  // apart from the date range which bounds the fetch itself — a tenant's
  // full history isn't worth pulling to show one month.
  const [filters, setFilters] = useState({ user: '', customer: '', disposition: '', from: '', to: '', includeBilled: false });
  const patchFilter = (p) => setFilters(f => ({ ...f, ...p }));

  // Whoever actually appears in the data, rather than a hardcoded roster —
  // so the list stays right as people come and go.
  const knownUsers = [...new Set(entries.map(e => e.logged_by || e.tech_email).filter(Boolean))].sort();
  const knownCustomers = [...new Set(entries.map(e => e.qbo_customer_name).filter(Boolean))].sort();

  const visibleEntries = entries.filter(e => {
    const who = e.logged_by || e.tech_email || '';
    if (filters.user && who !== filters.user) return false;
    if (filters.customer && (e.qbo_customer_name || '') !== filters.customer) return false;
    // Entries written before disposition existed have none — treat those as
    // billable, which is what they were, rather than hiding them from every
    // filtered view.
    if (filters.disposition && (e.disposition || 'billable') !== filters.disposition) return false;
    return true;
  });

  const exportCsv = () => {
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Quote anything containing a delimiter, quote or newline, and double
      // any embedded quotes — otherwise a note with a comma shifts columns.
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Logged By', 'Customer', 'Notes', 'Hours', 'Disposition', 'Billed', 'Invoice Ref'];
    const rows = visibleEntries.map(e => [
      e.work_date,
      e.logged_by || e.tech_email || '',
      e.qbo_customer_name || (e.local_customer_id ? 'Local customer' : ''),
      e.notes || '',
      ((e.total_minutes || 0) / 60).toFixed(2),
      e.disposition || '',
      e.billed ? 'Yes' : 'No',
      e.invoice_ref || '',
    ].map(esc).join(','));

    const csv = [header.join(','), ...rows].join('\r\n');
    // BOM so Excel opens UTF-8 correctly instead of mangling accents.
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${(currentTenant?.name || 'tenant').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-time-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Turns the selected time entries into editable invoice lines. Hours
  // become quantity, notes become the description, and the rate is left
  // blank on purpose — Jovelin has no opinion about billing rates, so it
  // asks rather than inventing one. All entries must belong to the same
  // QuickBooks customer, since an invoice can only address one.
  const openBuilder = () => {
    // visibleEntries, not entries — otherwise selecting rows and then
    // narrowing the filter would quietly invoice hours that are no longer
    // on screen.
    const chosen = visibleEntries.filter(e => selected[e.id]);
    if (!chosen.length) return;
    const customerIds = [...new Set(chosen.map(e => e.qbo_customer_id).filter(Boolean))];
    if (customerIds.length === 0) {
      alert('None of the selected entries has a QuickBooks customer, so they can\u2019t be invoiced there. Assign one first.');
      return;
    }
    if (customerIds.length > 1) {
      alert('Those entries span more than one customer. An invoice can only bill one, so select entries for a single customer.');
      return;
    }
    const first = chosen.find(e => e.qbo_customer_id);
    setPushResult(null);
    setBuilder({
      customerId: first.qbo_customer_id,
      customerName: first.qbo_customer_name || 'Customer',
      entryIds: chosen.map(e => e.id),
      memo: '',
      lines: chosen.map(e => ({
        key: e.id,
        qbo_item_id: '',
        description: e.notes || 'Labor',
        qty: Number(((e.total_minutes || 0) / 60).toFixed(2)),
        rate: '',
      })),
    });
  };

  const updateLine = (key, patch) =>
    setBuilder(b => ({ ...b, lines: b.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) }));

  const addLine = () =>
    setBuilder(b => ({ ...b, lines: [...b.lines, { key: `new-${Date.now()}`, qbo_item_id: '', description: '', qty: 1, rate: '' }] }));

  const removeLine = (key) =>
    setBuilder(b => ({ ...b, lines: b.lines.filter(l => l.key !== key) }));

  const builderTotal = (builder?.lines || [])
    .reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0), 0);

  const pushBuiltInvoice = async () => {
    setPushing(true); setPushResult(null);
    try {
      const r = await apiFetch('/api/qbo/push-custom-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: currentTenantId,
          requested_by: userEmail,
          customer_name: builder.customerName,
          qbo_customer_id: builder.customerId,
          memo: builder.memo || undefined,
          time_entry_ids: builder.entryIds,
          lines: builder.lines.map(l => ({
            qbo_item_id: l.qbo_item_id, description: l.description,
            qty: parseFloat(l.qty) || 0, rate: parseFloat(l.rate) || 0,
          })),
        }),
      }).then(res => res.json());
      setPushResult(r);
      if (r.pushed && r.matches) { setSelected({}); load(); }
    } catch (e) {
      setPushResult({ pushed: false, error: e.message });
    }
    setPushing(false);
  };

  const printBuiltInvoice = () => {
    const rows = builder.lines.map(l => {
      const amt = (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0);
      const item = items.find(i => String(i.id) === String(l.qbo_item_id));
      return `<tr><td>${item?.name || ''}</td><td>${l.description || ''}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${fmt(l.rate)}</td><td style="text-align:right">${fmt(amt)}</td></tr>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Invoice — ${builder.customerName}</title>
      <style>body{font-family:Georgia,serif;padding:32px;color:#1c1c1e}
      h1{color:${TEAL};margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
      th{background:${TEAL};color:#fff;padding:7px;text-align:left}td{padding:7px;border-bottom:1px solid #eee}
      .tot{text-align:right;font-size:18px;font-weight:700;margin-top:14px}</style></head><body>
      <h1>INVOICE</h1><div>${currentTenant?.name || ''}</div>
      <div style="margin-top:12px"><b>Bill to:</b> ${builder.customerName}</div>
      ${builder.memo ? `<div style="margin-top:6px">${builder.memo}</div>` : ''}
      <table><thead><tr><th>Product/Service</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="tot">Total: ${fmt(builderTotal)}</div>
      </body></html>`);
    w.document.close();
    w.print();
  };

  useEffect(() => {
    if (!currentTenantId) return;
    apiFetch(`/api/qbo/lists?tenant_id=${currentTenantId}`)
      .then(r => r.json()).then(d => setItems(d.items || [])).catch(() => setItems([]));
  }, [currentTenantId]);

  const load = useCallback(async () => {
    if (!currentTenantId) return;
    setLoading(true);
    const [reqRes, entRes] = await Promise.all([
      supabase.from('billing_requests').select('*').eq('tenant_id', currentTenantId).eq('status', 'pending').order('created_at', { ascending: false }),
      (() => {
        let q = supabase.from('time_entries').select('*').eq('tenant_id', currentTenantId);
        if (!filters.includeBilled) q = q.eq('billed', false);
        if (filters.from) q = q.gte('work_date', filters.from);
        if (filters.to) q = q.lte('work_date', filters.to);
        return q.order('work_date', { ascending: false });
      })(),
    ]);
    setRequests(reqRes.data || []);
    setEntries(entRes.data || []);
    setLoading(false);
  }, [currentTenantId, filters.includeBilled, filters.from, filters.to]);

  useEffect(() => { load(); }, [load]);

  // Auto-open the invoice modal if we arrived via ?invoiceEstimate=<id>
  useEffect(() => {
    const estId = searchParams.get('invoiceEstimate');
    if (!estId || !currentTenantId) return;
    (async () => {
      const { data } = await supabase.from('estimates')
        .select('*, estimate_lines(qty, contractor_unit_cost, markup_pct, override_unit_price, item_name, description)')
        .eq('id', estId).single();
      if (data) { setInvoiceEst(data); setInvoiceResult(null); }
    })();
  }, [searchParams, currentTenantId]);

  const closeInvoiceModal = () => {
    setInvoiceEst(null); setInvoiceResult(null);
    searchParams.delete('invoiceEstimate'); setSearchParams(searchParams, { replace: true });
  };

  const downloadInvoice = (est) => {
    const lines = est.estimate_lines || [];
    const defMk = parseFloat(est.default_markup_pct) || 0;
    const rows = lines.map(l => {
      const qty = parseFloat(l.qty) || 0, cost = parseFloat(l.contractor_unit_cost) || 0;
      const mk = (l.markup_pct === null || l.markup_pct === undefined) ? defMk : parseFloat(l.markup_pct) || 0;
      const ov = (l.override_unit_price === null || l.override_unit_price === undefined) ? null : parseFloat(l.override_unit_price);
      const price = ov !== null && isFinite(ov) ? ov : cost * (1 + mk / 100);
      return { qty, price, amount: qty * price, item: l.item_name || '', desc: l.description || '' };
    });
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const rowsHtml = rows.map(r => `<tr><td style="padding:6px;font-weight:600">${r.item}</td><td style="padding:6px">${r.desc}</td>
      <td style="padding:6px;text-align:right">${r.qty}</td><td style="padding:6px;text-align:right">${fmt(r.price)}</td>
      <td style="padding:6px;text-align:right">${fmt(r.amount)}</td></tr>`).join('');
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Invoice ${est.est_no}</title><style>
      body{font-family:Georgia,serif;color:#1c1c1e;margin:0;} .head{background:#0D4F5C;color:#fff;padding:24px 30px}
      .body{padding:24px 30px} table{width:100%;border-collapse:collapse;font-size:13px}
      th{background:#0D4F5C;color:#fff;padding:6px;text-align:left} .tot{background:#F4F1EB;color:#0D4F5C;font-weight:700;font-size:16px}
    </style></head><body>
      <div class="head"><div style="font-size:20px;font-weight:700">${currentTenant?.name || ''}</div><div style="font-size:12px;opacity:.85">INVOICE — ${est.est_no}</div></div>
      <div class="body">
        <div style="margin-bottom:14px"><b>Bill to:</b> ${est.qbo_customer_name || 'No customer'}${est.project ? '<br>' + est.project : ''}</div>
        <table><thead><tr><th>Item</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        <div style="text-align:right;margin-top:14px"><span class="tot" style="padding:6px 14px;border-radius:6px">TOTAL: ${fmt(total)}</span></div>
      </div>
    </body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => win.print(), 300);
  };

  const pushInvoiceToQbo = async (est) => {
    setInvoicing(true); setInvoiceResult(null);
    try {
      const r = await apiFetch('/api/qbo/push-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: currentTenantId, estimate_id: est.id }),
      }).then(res => res.json());
      setInvoiceResult(r);
      if (r.pushed && r.matches) load();
    } catch (e) {
      setInvoiceResult({ pushed: false, error: String(e.message || e) });
    }
    setInvoicing(false);
  };

  const markInvoiced = async (req) => {
    await supabase.from('billing_requests').update({ status: 'invoiced', invoiced_at: new Date().toISOString() }).eq('id', req.id);
    load();
  };

  const setDisposition = async (entry, disposition) => {
    await supabase.from('time_entries').update({ disposition }).eq('id', entry.id);
    load();
  };

  const toggleSelect = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  // Both scoped to what's visible, so the count and hours shown always
  // describe exactly what an action would operate on.
  const selectedIds = visibleEntries.filter(e => selected[e.id]).map(e => e.id);
  const selectedMinutes = visibleEntries.filter(e => selected[e.id]).reduce((s, e) => s + (e.total_minutes || 0), 0);

  const createInvoiceFromSelected = async () => {
    if (selectedIds.length === 0) return;
    const ref = invoiceRef.trim() || `BATCH-${Date.now()}`;
    await supabase.from('time_entries').update({ billed: true, billed_at: new Date().toISOString(), invoice_ref: ref }).in('id', selectedIds);
    setSelected({}); setInvoiceRef('');
    load();
  };

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 , flexWrap: 'wrap'}}>
          <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: 0 }}>Billing</h1>
          <span style={{ color: SUBTEXT, fontSize: 14, fontWeight: 600 }}>{currentTenant?.name}</span>
        </div>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 20 }}>
          Invoice requests from approved estimates, and every unbilled hour, from anywhere. Creating the actual
          invoice in QuickBooks is still a manual step — this tracks and queues it.
        </p>

        {loading ? (
          <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {/* A/R first — money already owed outranks money not yet billed. */}
            <ARChase userEmail={userEmail} />

            {/* Invoice Requests */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 20 }}>
              <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Invoice Requests</div>
              {requests.length === 0 && <div style={{ color: SUBTEXT, fontSize: 13 }}>Nothing pending. These appear when an estimate is marked Approved.</div>}
              {requests.map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: TEXT }}>{r.qbo_customer_name || 'Customer'}</div>
                    <div style={{ fontSize: 11, color: SUBTEXT }}>Requested {new Date(r.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 , flexWrap: 'wrap'}}>
                    <b style={{ color: TEAL, fontSize: 15 }}>{fmt(r.amount_requested)}</b>
                    <button onClick={() => markInvoiced(r)} style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                      Mark Invoiced
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Unbilled Time */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ color: TEAL, fontWeight: 700, fontSize: 13 }}>
                  {filters.includeBilled ? 'Time Entries' : 'Unbilled Time'}
                  <span style={{ color: SUBTEXT, fontWeight: 400 }}> · {visibleEntries.length} shown · {fmtHrs(visibleEntries.reduce((s, e) => s + (e.total_minutes || 0), 0))}</span>
                </div>
                <button onClick={exportCsv} disabled={!visibleEntries.length}
                  style={{ background: 'none', border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: visibleEntries.length ? 'pointer' : 'default' }}>
                  Export CSV
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 10, background: '#f7f9fa', borderRadius: 10 }}>
                <select value={filters.user} onChange={e => patchFilter({ user: e.target.value })}
                  style={{ flex: '1 1 150px', padding: '7px 9px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff' }}>
                  <option value="">All people</option>
                  {knownUsers.map(u => <option key={u} value={u}>{u}</option>)}
                </select>

                <select value={filters.customer} onChange={e => patchFilter({ customer: e.target.value })}
                  style={{ flex: '1 1 150px', padding: '7px 9px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff' }}>
                  <option value="">All customers</option>
                  {knownCustomers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <select value={filters.disposition} onChange={e => patchFilter({ disposition: e.target.value })}
                  style={{ flex: '1 1 150px', padding: '7px 9px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff' }}>
                  <option value="">All dispositions</option>
                  {Object.entries(DISPOSITION_LABELS).map(([key, d]) => (
                    <option key={key} value={key}>{d.label}</option>
                  ))}
                </select>

                <input type="date" value={filters.from} onChange={e => patchFilter({ from: e.target.value })} title="From date"
                  style={{ flex: '1 1 120px', padding: '7px 9px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 8 }} />
                <input type="date" value={filters.to} onChange={e => patchFilter({ to: e.target.value })} title="To date"
                  style={{ flex: '1 1 120px', padding: '7px 9px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 8 }} />

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT, cursor: 'pointer', flexShrink: 0 }}>
                  <input type="checkbox" checked={filters.includeBilled} onChange={e => patchFilter({ includeBilled: e.target.checked })} />
                  Include billed
                </label>

                {(filters.user || filters.customer || filters.disposition || filters.from || filters.to || filters.includeBilled) && (
                  <button onClick={() => setFilters({ user: '', customer: '', disposition: '', from: '', to: '', includeBilled: false })}
                    style={{ background: 'none', border: 'none', color: SUBTEXT, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    Clear
                  </button>
                )}
              </div>
              {entries.length === 0 && <div style={{ color: SUBTEXT, fontSize: 13 }}>No unbilled time.</div>}
              {visibleEntries.map(e => {
                const d = DISPOSITION_LABELS[e.disposition] || DISPOSITION_LABELS.billable;
                return (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <input type="checkbox" checked={!!selected[e.id]} onChange={() => toggleSelect(e.id)} style={{ width: 16, height: 16, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{e.qbo_customer_name || (e.local_customer_id ? 'Local customer' : 'No customer')}</div>
                      <div style={{ fontSize: 11, color: SUBTEXT }}>
                        {e.work_date}{e.notes ? ` · ${e.notes}` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: TEAL, fontWeight: 600 }}>
                        {e.logged_by || e.tech_email || 'Unknown — no logger recorded'}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: d.bg, color: d.color, flexShrink: 0 }}>{d.label}</span>
                    <b style={{ color: AMBER, fontSize: 13, flexShrink: 0, minWidth: 50, textAlign: 'right' }}>{fmtHrs(e.total_minutes)}</b>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 , flexWrap: 'wrap'}}>
                      <button onClick={() => setDisposition(e, 'reviewed_non_billable')} title="Reviewed — non-billable"
                        style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, cursor: 'pointer', color: RED }}>Non-Billable</button>
                      <button onClick={() => setDisposition(e, 'reviewed_fixed_fee')} title="Reviewed — fixed fee hours"
                        style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, cursor: 'pointer', color: AMBER }}>Fixed Fee</button>
                    </div>
                  </div>
                );
              })}

              {selectedIds.length > 0 && (
                <div style={{ marginTop: 14, padding: 12, background: '#f7f9fa', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: TEXT }}>{selectedIds.length} selected · {fmtHrs(selectedMinutes)} total</span>
                  <input placeholder="Invoice # (optional)" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)}
                    style={{ padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12, flex: '1 1 140px' }} />
                  <button onClick={openBuilder} style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                    Build Invoice
                  </button>
                  <button onClick={createInvoiceFromSelected} title="Just record these as billed, without creating anything in QuickBooks"
                    style={{ background: 'none', color: SUBTEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                    Mark as Invoiced
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {builder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, padding: 16, overflowY: 'auto' }}>
          <div style={{ background: CARD, borderRadius: 14, padding: 22, maxWidth: 860, width: '100%', margin: '24px 0' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: TEXT }}>Build Invoice</div>
            <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 14 }}>
              {builder.customerName} · {builder.entryIds.length} time {builder.entryIds.length === 1 ? 'entry' : 'entries'}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
                <thead>
                  <tr style={{ color: SUBTEXT, textAlign: 'left' }}>
                    <th style={{ padding: '6px 4px', fontWeight: 700 }}>Product / Service</th>
                    <th style={{ padding: '6px 4px', fontWeight: 700 }}>Description</th>
                    <th style={{ padding: '6px 4px', fontWeight: 700, width: 70 }}>Qty</th>
                    <th style={{ padding: '6px 4px', fontWeight: 700, width: 90 }}>Rate</th>
                    <th style={{ padding: '6px 4px', fontWeight: 700, width: 90, textAlign: 'right' }}>Amount</th>
                    <th style={{ width: 28 }} />
                  </tr>
                </thead>
                <tbody>
                  {builder.lines.map(l => {
                    const amt = (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0);
                    return (
                      <tr key={l.key} style={{ borderTop: `1px solid ${BORDER}` }}>
                        <td style={{ padding: '6px 4px' }}>
                          <select value={l.qbo_item_id} onChange={e => {
                            const item = items.find(i => String(i.id) === e.target.value);
                            // Adopt the item's QuickBooks price as a starting
                            // rate, but only when one hasn't been typed yet.
                            updateLine(l.key, {
                              qbo_item_id: e.target.value,
                              rate: l.rate === '' && item?.unitPrice ? item.unitPrice : l.rate,
                            });
                          }} style={{ width: '100%', padding: '6px', fontSize: 12, border: `1px solid ${l.qbo_item_id ? BORDER : AMBER}`, borderRadius: 6 }}>
                            <option value="">— pick —</option>
                            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <input value={l.description} onChange={e => updateLine(l.key, { description: e.target.value })}
                            style={{ width: '100%', padding: '6px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6 }} />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <input type="number" step="0.25" value={l.qty} onChange={e => updateLine(l.key, { qty: e.target.value })}
                            style={{ width: '100%', padding: '6px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6 }} />
                        </td>
                        <td style={{ padding: '6px 4px' }}>
                          <input type="number" step="0.01" placeholder="0.00" value={l.rate} onChange={e => updateLine(l.key, { rate: e.target.value })}
                            style={{ width: '100%', padding: '6px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6 }} />
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, color: TEXT }}>{fmt(amt)}</td>
                        <td style={{ padding: '6px 4px' }}>
                          <button onClick={() => removeLine(l.key)} title="Remove line"
                            style={{ background: 'none', border: 'none', color: SUBTEXT, cursor: 'pointer', fontSize: 15 }}>&#10005;</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button onClick={addLine} style={{ background: 'none', border: `1px dashed ${BORDER}`, color: TEAL, borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer', marginTop: 10 }}>
              + Add line
            </button>

            <div style={{ marginTop: 12 }}>
              <input placeholder="Memo shown on the invoice (optional)" value={builder.memo}
                onChange={e => setBuilder(b => ({ ...b, memo: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 8, boxSizing: 'border-box' }} />
            </div>

            <div style={{ textAlign: 'right', fontSize: 18, fontWeight: 800, color: TEAL, margin: '12px 0' }}>
              Total {fmt(builderTotal)}
            </div>

            {pushResult && (
              <div style={{
                background: pushResult.queued ? '#fff7ed' : (pushResult.pushed && pushResult.matches ? '#e6f4ea' : '#fdecea'),
                borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 13,
                color: pushResult.queued ? AMBER : (pushResult.pushed && pushResult.matches ? GREEN : RED),
              }}>
                {pushResult.queued
                  ? '\u23f3 Sent for review \u2014 nothing has reached QuickBooks yet. It appears in Admin, and the hours stay unbilled until it\u2019s approved.'
                  : pushResult.pushed
                  ? (pushResult.matches
                      ? `\u2713 Invoice ${pushResult.invoiceDocNumber ? '#' + pushResult.invoiceDocNumber : ''} created in QuickBooks and confirmed at ${fmt(pushResult.confirmedTotal)}. ${pushResult.markedBilled} time ${pushResult.markedBilled === 1 ? 'entry' : 'entries'} marked billed.`
                      : `\u26a0 Created, but QuickBooks confirms ${fmt(pushResult.confirmedTotal)} against an expected ${fmt(pushResult.expectedTotal)}. The hours were left unbilled \u2014 check it in QuickBooks.`)
                  : pushResult.reason === 'line_missing_product'
                    ? `Every line needs a product/service before QuickBooks will accept it \u2014 missing on: ${pushResult.detail}`
                    : `Couldn't create the invoice: ${pushResult.error || pushResult.reason || 'unknown error'}`}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={printBuiltInvoice} style={{ flex: '1 1 150px', background: '#f3f4f6', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '11px', fontWeight: 700, cursor: 'pointer' }}>
                Download / Print
              </button>
              <button onClick={pushBuiltInvoice} disabled={pushing || !builderTotal}
                style={{ flex: '1 1 200px', background: builderTotal ? TEAL : '#e5e9eb', color: builderTotal ? '#fff' : SUBTEXT, border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, cursor: builderTotal && !pushing ? 'pointer' : 'default' }}>
                {pushing ? 'Copying to QuickBooks…' : 'Copy to QuickBooks Online'}
              </button>
              <button onClick={() => { setBuilder(null); setPushResult(null); }}
                style={{ flex: '0 1 100px', background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '11px', cursor: 'pointer', color: SUBTEXT, fontWeight: 700 }}>
                Close
              </button>
            </div>

            <div style={{ color: SUBTEXT, fontSize: 11, marginTop: 10 }}>
              The invoice is created in QuickBooks unsent — nothing goes to the customer from there. Hours are only marked
              billed once QuickBooks confirms the total, so a failed push leaves them available to retry.
            </div>
          </div>
        </div>
      )}

      {invoiceEst && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: CARD, borderRadius: 14, padding: 22, maxWidth: 420, width: '100%' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: TEXT, marginBottom: 2 }}>Create Invoice</div>
            <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 16 }}>{invoiceEst.est_no} — {invoiceEst.qbo_customer_name || 'No customer'}</div>

            {!invoiceResult && (
              <>
                <button onClick={() => downloadInvoice(invoiceEst)} style={{ width: '100%', background: '#f3f4f6', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '11px', fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                  ⬇ Download PDF
                </button>
                <button onClick={() => pushInvoiceToQbo(invoiceEst)} disabled={invoicing} style={{ width: '100%', background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                  {invoicing ? 'Pushing to QuickBooks…' : '📤 Push to QuickBooks Online'}
                </button>
                <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 8 }}>
                  Creates the invoice in QuickBooks only — it stays unsent there. Sending to the customer, if at all, happens from Jovelin.
                </div>
              </>
            )}

            {invoiceResult && (
              <div style={{ background: invoiceResult.pushed && invoiceResult.matches ? '#e6f4ea' : '#fdecea', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                {invoiceResult.pushed ? (
                  invoiceResult.matches ? (
                    <div style={{ color: GREEN, fontSize: 13 }}>
                      ✓ Invoice {invoiceResult.invoiceDocNumber ? `#${invoiceResult.invoiceDocNumber}` : ''} created and confirmed in QuickBooks — {fmt(invoiceResult.confirmedTotal)} matches.
                    </div>
                  ) : (
                    <div style={{ color: RED, fontSize: 13 }}>
                      ⚠ Invoice {invoiceResult.invoiceDocNumber ? `#${invoiceResult.invoiceDocNumber}` : ''} was created, but the confirmed QuickBooks total ({fmt(invoiceResult.confirmedTotal)}) doesn't match what Jovelin expected ({fmt(invoiceResult.expectedTotal)}). Check it directly in QuickBooks.
                    </div>
                  )
                ) : (
                  <div style={{ color: RED, fontSize: 13 }}>
                    Couldn't push to QuickBooks: {invoiceResult.reason || invoiceResult.error || 'unknown error'}
                  </div>
                )}
              </div>
            )}

            <button onClick={closeInvoiceModal} style={{ width: '100%', background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px', cursor: 'pointer', color: SUBTEXT, fontWeight: 700 }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
