// ============================================
// Jovelin — Estimates
// ============================================
// Contractor cost -> markup -> client price, per line. Internal costs/margins
// are operator-visible only inside this view; the Client tab hides them.
// Customers and the products/services dropdown are NOT duplicated in
// Supabase — both are read live from the current tenant's own QuickBooks
// company. Supabase only stores the estimate/line/payment records
// themselves (the "task"-like operational data).
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../services/apiFetch.js';

const GOLD = '#e8a33d', GREEN = '#4ade80', RED = '#f87171';
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const today = () => new Date().toISOString().slice(0, 10);

function calcLine(l, defaultMarkup) {
  const qty = parseFloat(l.qty) || 0;
  const cost = parseFloat(l.contractor_unit_cost) || 0;
  const mk = (l.markup_pct === null || l.markup_pct === '') ? defaultMarkup : parseFloat(l.markup_pct) || 0;
  const ov = (l.override_unit_price === null || l.override_unit_price === '') ? null : parseFloat(l.override_unit_price);
  const price = ov !== null && isFinite(ov) ? ov : cost * (1 + mk / 100);
  const cTot = qty * cost, kTot = qty * price;
  return { qty, cost, mk, price, cTot, kTot, margin: kTot - cTot };
}

const inputStyle = {
  width: '100%', padding: '10px 12px', fontSize: 14, background: '#0f1729',
  border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', boxSizing: 'border-box',
};
const labelStyle = { fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' };

export default function Estimates({ onBack }) {
  const { currentTenantId, currentTenant } = useTenant();
  // Tenant branding for the client-facing document. Falls back to
  // Jovelin's teal when a tenant hasn't set anything.
  const { primary_color: brandPrimary, logo_url: brandLogo } = useBranding();
  const navigate = useNavigate();
  const { estimateId } = useParams();
  const [searchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [est, setEst] = useState(null);
  const [lines, setLines] = useState([]);
  const [payments, setPayments] = useState([]);
  const [qboCustomers, setQboCustomers] = useState([]);
  const [localCustomers, setLocalCustomers] = useState([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [qboItems, setQboItems] = useState([]);
  const [qboConnected, setQboConnected] = useState(null); // null = unknown yet, true/false once checked
  const [qboError, setQboError] = useState('');
  const [itemMarkups, setItemMarkups] = useState({});      // qbo_item_id -> default_markup_pct
  const [contractorMarkups, setContractorMarkups] = useState({}); // lowercase contractor_name -> default_markup_pct
  const [tab, setTab] = useState(searchParams.get('tab') === 'rollup' ? 'rollup' : 'build');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadLocalCustomers = useCallback(async (tenantId) => {
    const { data } = await supabase.from('customers').select('id, name').eq('tenant_id', tenantId).is('merged_into', null).order('name');
    setLocalCustomers(data || []);
  }, []);

  const loadQboLists = useCallback(async (tenantId) => {
    if (!tenantId) return;
    try {
      const r = await apiFetch(`/api/qbo/lists?tenant_id=${tenantId}`);
      const data = await r.json();
      setQboConnected(!!data.connected);
      setQboError(data.error || '');
      setQboCustomers(data.customers || []);
      setQboItems(data.items || []);
    } catch (e) {
      setQboConnected(false);
      setQboError(String(e.message || e));
    }
  }, []);

  // Persisted markup defaults — QBO owns the item list, but markup % is
  // Jovelin's own business rule layered on top, so it lives here.
  const loadMarkupDefaults = useCallback(async (tenantId) => {
    const [itemsRes, contractorsRes] = await Promise.all([
      supabase.from('catalog_items').select('qbo_item_id, default_markup_pct').eq('tenant_id', tenantId).not('qbo_item_id', 'is', null),
      supabase.from('contractor_markup_defaults').select('contractor_name, default_markup_pct').eq('tenant_id', tenantId),
    ]);
    const itemMap = {};
    (itemsRes.data || []).forEach(r => { itemMap[r.qbo_item_id] = parseFloat(r.default_markup_pct); });
    setItemMarkups(itemMap);
    const contractorMap = {};
    (contractorsRes.data || []).forEach(r => { contractorMap[r.contractor_name.toLowerCase()] = parseFloat(r.default_markup_pct); });
    setContractorMarkups(contractorMap);
  }, []);

  const loadList = useCallback(async (tenantId, selectId) => {
    const { data } = await supabase.from('estimates')
      .select('id, est_no, project, status, qbo_customer_name')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false });
    setList(data || []);
    return selectId || data?.[0]?.id || null;
  }, []);

  const openEstimate = useCallback(async (id) => {
    if (!id) return;
    const { data: e } = await supabase.from('estimates').select('*').eq('id', id).single();
    const { data: ls } = await supabase.from('estimate_lines').select('*').eq('estimate_id', id).order('position');
    const { data: ps } = await supabase.from('estimate_payments').select('*').eq('estimate_id', id).order('paid_on');
    // Lines that existed at the moment an estimate is already accepted are
    // locked — what the customer agreed to shouldn't quietly change later.
    // A line added in THIS session (after load) is never marked locked,
    // even on an accepted estimate, since it's clearly new scope.
    const lsMarked = (ls || []).map(l => ({ ...l, _locked: e?.status === 'accepted' }));
    setEst(e); setLines(lsMarked); setPayments(ps || []); setDirty(false);
  }, []);

  const createEstimate = useCallback(async (tenantId) => {
    const yr = new Date().getFullYear();
    const { data: lastRows } = await supabase.from('estimates').select('est_no')
      .eq('tenant_id', tenantId).like('est_no', `EST-${yr}-%`).order('est_no', { ascending: false }).limit(1);
    const n = lastRows?.[0] ? (parseInt(lastRows[0].est_no.slice(-3)) || 0) + 1 : 1;
    const { data, error } = await supabase.from('estimates').insert({
      tenant_id: tenantId, est_no: `EST-${yr}-${String(n).padStart(3, '0')}`, quote_date: today(),
    }).select().single();
    if (error) { alert(error.message); return; }
    await loadList(tenantId, data.id);
    navigate(`/estimates/${data.id}`, { replace: true });
    setTab('build');
  }, [loadList, navigate]);

  // Reload tenant-scoped lookups (QBO customers/items, markup defaults,
  // the switcher dropdown) whenever the tenant changes.
  useEffect(() => {
    if (!currentTenantId) return;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        await loadQboLists(currentTenantId);
        await loadLocalCustomers(currentTenantId);
        await loadMarkupDefaults(currentTenantId);
        await loadList(currentTenantId);
      } catch (e) {
        setLoadError(String(e.message || e));
      }
      setLoading(false);
    })();
  }, [currentTenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open whichever estimate the URL names. '/estimates/new' creates one on
  // the spot; the summary list is what sends people here in the first
  // place, so there's no auto-pick-the-most-recent fallback anymore.
  useEffect(() => {
    if (!currentTenantId || !estimateId) return;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        if (estimateId === 'new') await createEstimate(currentTenantId);
        else await openEstimate(estimateId);
      } catch (e) {
        setLoadError(String(e.message || e));
      }
      setLoading(false);
    })();
  }, [currentTenantId, estimateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = (() => {
    if (!est) return null;
    let c = 0, k = 0;
    lines.forEach(l => { const x = calcLine(l, est.default_markup_pct); c += x.cTot; k += x.kTot; });
    const tax = k * ((parseFloat(est.tax_rate) || 0) / 100);
    const contract = k + tax;
    const paidIn = payments.filter(p => p.direction === 'in').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const paidOut = payments.filter(p => p.direction === 'out').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    return { c, k, tax, contract, profit: k - c, paidIn, paidOut };
  })();

  const upEst = (patch) => { setEst(e => ({ ...e, ...patch })); setDirty(true); };
  const pickCustomer = (val) => {
    if (val === '__add__') { setShowAddCustomer(true); return; }
    if (!val) { upEst({ qbo_customer_id: null, qbo_customer_name: null, local_customer_id: null }); return; }
    const [source, id] = [val.slice(0, val.indexOf(':')), val.slice(val.indexOf(':') + 1)];
    if (source === 'qbo') {
      const c = qboCustomers.find(x => x.id === id);
      upEst({ qbo_customer_id: id, qbo_customer_name: c?.name || null, local_customer_id: null });
    } else {
      const c = localCustomers.find(x => x.id === id);
      upEst({ local_customer_id: id, qbo_customer_name: c?.name || null, qbo_customer_id: null });
    }
  };

  const addLocalCustomer = async () => {
    if (!newCustomerName.trim()) return;
    const { data, error } = await supabase.from('customers').insert({ tenant_id: currentTenantId, name: newCustomerName.trim() }).select().single();
    if (error) { alert('Could not add customer: ' + error.message); return; }
    setNewCustomerName(''); setShowAddCustomer(false);
    await loadLocalCustomers(currentTenantId);
    pickCustomer(`local:${data.id}`);
  };
  const upLine = (i, patch) => { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); setDirty(true); };
  const pickLineItem = (i, name) => {
    const match = qboItems.find(it => it.name === name);
    const savedMarkup = match ? itemMarkups[match.id] : undefined;
    upLine(i, {
      item_name: name, qbo_item_id: match?.id || null,
      contractor_unit_cost: match?.unitPrice ?? lines[i].contractor_unit_cost,
      markup_pct: savedMarkup !== undefined ? savedMarkup : lines[i].markup_pct,
    });
  };

  const saveItemMarkupDefault = async (line) => {
    if (!line.qbo_item_id) { alert('Pick a QuickBooks item on this line first.'); return; }
    const mk = line.markup_pct === null || line.markup_pct === '' ? est.default_markup_pct : line.markup_pct;
    await supabase.from('catalog_items').upsert({
      tenant_id: currentTenantId, qbo_item_id: line.qbo_item_id, name: line.item_name || line.qbo_item_id,
      default_markup_pct: parseFloat(mk) || 0, is_active: true,
    }, { onConflict: 'tenant_id,qbo_item_id' });
    setItemMarkups(m => ({ ...m, [line.qbo_item_id]: parseFloat(mk) || 0 }));
  };

  const saveContractorMarkupDefault = async () => {
    if (!est.contractor_name) { alert('Enter a contractor name first.'); return; }
    const mk = parseFloat(est.default_markup_pct) || 0;
    await supabase.from('contractor_markup_defaults').upsert({
      tenant_id: currentTenantId, contractor_name: est.contractor_name, default_markup_pct: mk, updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,contractor_name' });
    setContractorMarkups(m => ({ ...m, [est.contractor_name.toLowerCase()]: mk }));
  };

  const contractorSuggestion = est?.contractor_name ? contractorMarkups[est.contractor_name.toLowerCase()] : undefined;
  const applyContractorSuggestion = () => upEst({ default_markup_pct: contractorSuggestion });

  const [showApprovePrompt, setShowApprovePrompt] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [approving, setApproving] = useState(false);
  const [approveMsg, setApproveMsg] = useState('');

  const openApprovePrompt = () => {
    setInvoiceAmount((totals?.contract || 0).toFixed(2));
    setApproveMsg('');
    setShowApprovePrompt(true);
  };

  const approveEstimate = async () => {
    const amt = parseFloat(invoiceAmount) || 0;
    setApproving(true);
    try {
      const acceptedAt = est.accepted_at || new Date().toISOString();
      await supabase.from('estimates').update({ status: 'accepted', accepted_at: acceptedAt }).eq('id', est.id);

      if (amt > 0) {
        await supabase.from('billing_requests').insert({
          tenant_id: currentTenantId, estimate_id: est.id,
          qbo_customer_id: est.qbo_customer_id || null, qbo_customer_name: est.qbo_customer_name || null,
          local_customer_id: est.local_customer_id || null, amount_requested: amt,
        });
      }

      if (est.qbo_customer_id) {
        const r = await apiFetch('/api/qbo/push-estimate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: currentTenantId, estimate_id: est.id }),
        }).then(res => res.json());
        setApproveMsg(r.pushed ? `Approved, pushed to QuickBooks, and ${fmt(amt)} queued in Billing.`
          : `Approved — ${fmt(amt)} queued in Billing. (QuickBooks: ${r.reason || r.error || 'not pushed'}.)`);
      } else {
        setApproveMsg(`Approved. ${fmt(amt)} queued in Billing.`);
      }
      setEst(e => ({ ...e, status: 'accepted', accepted_at: acceptedAt }));
      setTimeout(() => setShowApprovePrompt(false), 1400);
    } catch (e) {
      setApproveMsg('Could not approve: ' + e.message);
    }
    setApproving(false);
  };

  const downloadEstimate = () => {
    const rows = lines.map(l => {
      const x = calcLine(l, est.default_markup_pct);
      return `<tr><td style="padding:6px;font-weight:600">${l.item_name || ''}</td><td style="padding:6px">${l.description || ''}</td>
        <td style="padding:6px;text-align:right">${x.qty}</td><td style="padding:6px;text-align:right">${fmt(x.price)}</td>
        <td style="padding:6px;text-align:right">${fmt(x.kTot)}</td></tr>`;
    }).join('');
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${est.est_no}</title><style>
      body{font-family:Georgia,serif;color:#1c1c1e;margin:0;} .head{background:#0D4F5C;color:#fff;padding:24px 30px}
      .body{padding:24px 30px} table{width:100%;border-collapse:collapse;font-size:13px}
      th{background:#0D4F5C;color:#fff;padding:6px;text-align:left} .tot{background:#F4F1EB;color:#0D4F5C;font-weight:700;font-size:16px}
    </style></head><body>
      <div class="head"><div style="font-size:20px;font-weight:700">${currentTenant?.name || ''}</div><div style="font-size:12px;opacity:.85">ESTIMATE ${est.est_no}</div></div>
      <div class="body">
        <div style="margin-bottom:14px"><b>Prepared for:</b> ${est.qbo_customer_name || 'No customer selected'}${est.project ? '<br>' + est.project : ''}</div>
        <table><thead><tr><th>Item</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div style="text-align:right;margin-top:14px"><span class="tot" style="padding:6px 14px;border-radius:6px">TOTAL: ${fmt(totals?.contract || 0)}</span></div>
        ${est.terms ? `<div style="margin-top:20px;font-size:11px;white-space:pre-wrap">${est.terms}</div>` : ''}
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };
  const addLine = () => { setLines(ls => [...ls, { id: crypto.randomUUID(), item_name: '', qbo_item_id: null, description: '', qty: 1, unit: 'ls', contractor_unit_cost: '', markup_pct: null, override_unit_price: null }]); setDirty(true); };
  const delLine = (i) => { setLines(ls => ls.filter((_, idx) => idx !== i)); setDirty(true); };
  const addPayment = (direction) => { setPayments(ps => [...ps, { id: crypto.randomUUID(), direction, paid_on: today(), ref: '', amount: '' }]); setDirty(true); };
  const upPayment = (i, patch) => { setPayments(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p)); setDirty(true); };
  const delPayment = (i) => { setPayments(ps => ps.filter((_, idx) => idx !== i)); setDirty(true); };

  const save = async () => {
    if (!est) return;
    setSaving(true);
    try {
      // Stamp accepted_at the first time status becomes 'accepted' — this date
      // is the anchor for job-costing (revenue/expenses are measured from here
      // forward, not from when the estimate was first drafted).
      const acceptedAt = (est.status === 'accepted' && !est.accepted_at) ? new Date().toISOString() : est.accepted_at || null;

      await supabase.from('estimates').update({
        est_no: est.est_no, status: est.status, project: est.project,
        contractor_name: est.contractor_name, contractor_ref: est.contractor_ref,
        quote_date: est.quote_date || null, terms: est.terms,
        default_markup_pct: parseFloat(est.default_markup_pct) || 0,
        tax_rate: parseFloat(est.tax_rate) || 0,
        qbo_customer_id: est.qbo_customer_id || null,
        qbo_customer_name: est.qbo_customer_name || null,
        local_customer_id: est.local_customer_id || null,
        accepted_at: acceptedAt,
      }).eq('id', est.id);

      await supabase.from('estimate_lines').delete().eq('estimate_id', est.id);
      if (lines.length) {
        await supabase.from('estimate_lines').insert(lines.map((l, i) => ({
          estimate_id: est.id, position: i, item_name: l.item_name || null, qbo_item_id: l.qbo_item_id || null,
          description: l.description || null, qty: parseFloat(l.qty) || 0, unit: l.unit || 'ls',
          contractor_unit_cost: l.contractor_unit_cost === '' ? null : parseFloat(l.contractor_unit_cost),
          markup_pct: l.markup_pct === '' || l.markup_pct === null ? null : parseFloat(l.markup_pct),
          override_unit_price: l.override_unit_price === '' || l.override_unit_price === null ? null : parseFloat(l.override_unit_price),
        })));
      }

      await supabase.from('estimate_payments').delete().eq('estimate_id', est.id);
      if (payments.length) {
        await supabase.from('estimate_payments').insert(payments.map(p => ({
          estimate_id: est.id, direction: p.direction, paid_on: p.paid_on || null,
          ref: p.ref || null, amount: parseFloat(p.amount) || 0,
        })));
      }
      setDirty(false);
      setEst(e => ({ ...e, accepted_at: acceptedAt }));
      await loadList(currentTenantId, est.id);
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: 24, color: '#94a3b8', background: '#0f1729', minHeight: '100vh' }}>Loading…</div>;
  if (loadError) return (
    <div style={{ padding: 24, background: '#0f1729', minHeight: '100vh' }}>
      <div style={{ background: '#1e293b', border: '1px solid #f87171', borderRadius: 12, padding: 20, color: '#f87171', maxWidth: 500 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Couldn't load estimates</div>
        <div style={{ fontSize: 13, color: '#cbd5e1' }}>{loadError}</div>
      </div>
    </div>
  );
  if (!est) return <div style={{ padding: 24, color: '#94a3b8', background: '#0f1729', minHeight: '100vh' }}>No estimate to show.</div>;

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', paddingBottom: 90 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={est.id} onChange={e => navigate(`/estimates/${e.target.value}`)} style={{ ...inputStyle, width: 'auto', flex: '1 1 200px' }}>
            {list.map(e => <option key={e.id} value={e.id}>{e.est_no} — {e.qbo_customer_name || e.project || '(no customer)'} [{e.status}]</option>)}
          </select>
          <button onClick={() => navigate('/estimates/new')} style={{ background: GOLD, color: '#1a1200', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ New</button>
          <span style={{ color: dirty ? GOLD : '#4ade80', fontSize: 12, fontWeight: 700 }}>{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
          <div style={{ flex: 1 }} />
          <button onClick={save} disabled={saving} style={{ background: '#1e293b', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Save</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 , flexWrap: 'wrap'}}>
          {[['build', '1 · Build'], ['client', '2 · Client Doc'], ['rollup', '3 · Rollup']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              background: tab === k ? GOLD : '#1e293b', color: tab === k ? '#1a1200' : '#94a3b8',
              border: 'none', borderRadius: 20, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {qboConnected === false && (
          <div style={{ background: '#1e293b', borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 16 }}>
            <div style={{ color: '#cbd5e1', fontSize: 14, marginBottom: 4 }}>{currentTenant?.name} isn't connected to QuickBooks yet.</div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>Customers and products/services come from QBO — connect it to use estimates for this tenant.</div>
            <a href={`/api/qbo/connect?tenant_id=${currentTenantId}`} style={{
              display: 'inline-block', background: GOLD, color: '#1a1200', fontWeight: 700,
              padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontSize: 14,
            }}>Connect QuickBooks</a>
          </div>
        )}
        {qboConnected && qboError && (
          <div style={{ background: '#1e293b', borderRadius: 14, padding: 14, color: RED, fontSize: 13, marginBottom: 16 }}>
            Connected, but couldn't load customers/items: {qboError}
          </div>
        )}

        {tab === 'build' && (
          <>
            <div style={{ background: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={labelStyle}>Estimate #</label>
                  <input style={inputStyle} value={est.est_no || ''} onChange={e => upEst({ est_no: e.target.value })} />
                </div>
                <div style={{ flex: '1 1 120px' }}>
                  <label style={labelStyle}>Date</label>
                  <input type="date" style={inputStyle} value={est.quote_date || ''} onChange={e => upEst({ quote_date: e.target.value })} />
                </div>
                <div style={{ flex: '1 1 120px' }}>
                  <label style={labelStyle}>Status</label>
                  {est.status === 'accepted' ? (
                    <div style={{ ...inputStyle, background: '#093843', color: GREEN, fontWeight: 700 }}>Accepted 🔒</div>
                  ) : (
                    <select style={inputStyle} value={est.status} onChange={e => upEst({ status: e.target.value })}>
                      {['draft', 'sent', 'declined'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              </div>
              {est.status !== 'accepted' && (
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
                  To accept this estimate, use "Mark Approved" on the customer's page — that's the only path that queues billing and pushes to QuickBooks correctly.
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Customer</label>
                <select style={inputStyle} value={est.qbo_customer_id ? `qbo:${est.qbo_customer_id}` : est.local_customer_id ? `local:${est.local_customer_id}` : ''} onChange={e => pickCustomer(e.target.value)}>
                  <option value="">— choose —</option>
                  {qboCustomers.length > 0 && (
                    <optgroup label="From QuickBooks">
                      {qboCustomers.map(c => <option key={c.id} value={`qbo:${c.id}`}>{c.name}</option>)}
                    </optgroup>
                  )}
                  {localCustomers.length > 0 && (
                    <optgroup label="Local (not in QuickBooks)">
                      {localCustomers.map(c => <option key={c.id} value={`local:${c.id}`}>{c.name}</option>)}
                    </optgroup>
                  )}
                  <option value="__add__">+ Add a customer not in QuickBooks…</option>
                </select>
                {(est.qbo_customer_id || est.local_customer_id) && (
                  <button onClick={() => navigate(`/customer?source=${est.qbo_customer_id ? 'qbo' : 'local'}&id=${est.qbo_customer_id || est.local_customer_id}&name=${encodeURIComponent(est.qbo_customer_name || '')}`)}
                    style={{ background: 'none', border: 'none', color: GOLD, fontSize: 11, cursor: 'pointer', padding: '5px 0 0', textAlign: 'left', fontWeight: 700 }}>
                    View customer's estimates, approve, download, or send →
                  </button>
                )}
                {showAddCustomer && (
                  <div style={{ background: '#3a2a0f', border: '1px solid #92400e', borderRadius: 8, padding: 10, marginTop: 6 }}>
                    <div style={{ fontSize: 12, color: GOLD, marginBottom: 6, lineHeight: 1.4 }}>
                      If this customer already exists (or should exist) in QuickBooks Online, add them there first — they'll
                      show up here automatically. Only add one here if they're genuinely not tracked in QuickBooks.
                    </div>
                    <div style={{ display: 'flex', gap: 8 , flexWrap: 'wrap'}}>
                      <input autoFocus style={inputStyle} placeholder="Customer name" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} />
                      <button onClick={addLocalCustomer} style={{ background: GOLD, color: '#1a1200', border: 'none', borderRadius: 8, padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}>Add</button>
                      <button onClick={() => setShowAddCustomer(false)} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '0 12px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Project</label>
                <input style={inputStyle} value={est.project || ''} onChange={e => upEst({ project: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={labelStyle}>Contractor</label>
                  <input style={inputStyle} value={est.contractor_name || ''} onChange={e => upEst({ contractor_name: e.target.value })} />
                  {contractorSuggestion !== undefined && contractorSuggestion !== parseFloat(est.default_markup_pct) && (
                    <button onClick={applyContractorSuggestion} style={{ background: 'none', border: 'none', color: GOLD, fontSize: 11, cursor: 'pointer', padding: '3px 0 0', textAlign: 'left' }}>
                      Saved default for {est.contractor_name}: {contractorSuggestion}% — apply
                    </button>
                  )}
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <label style={labelStyle}>Default markup %</label>
                  <input type="number" style={inputStyle} value={est.default_markup_pct ?? 25} onChange={e => upEst({ default_markup_pct: e.target.value })} />
                  <button onClick={saveContractorMarkupDefault} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 10, cursor: 'pointer', padding: '3px 0 0', textAlign: 'left' }}>
                    💾 save as default for this contractor
                  </button>
                </div>
                <div style={{ flex: '1 1 80px' }}>
                  <label style={labelStyle}>Tax %</label>
                  <input type="number" style={inputStyle} value={est.tax_rate ?? 0} onChange={e => upEst({ tax_rate: e.target.value })} />
                </div>
              </div>
            </div>

            {lines.map((l, i) => {
              const x = calcLine(l, est.default_markup_pct);
              const costPct = x.kTot > 0 ? Math.min(100, (x.cTot / x.kTot) * 100) : 0;
              const locked = !!l._locked;
              return (
                <div key={l.id} style={{ background: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10, opacity: locked ? 0.85 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 , flexWrap: 'wrap'}}>
                    <span style={{ background: '#0f1729', color: GOLD, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>Line {i + 1}</span>
                    {locked ? (
                      <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700 }}>🔒 Locked — estimate accepted</span>
                    ) : (
                      <button onClick={() => delLine(i)} style={{ background: 'none', border: 'none', color: RED, fontSize: 12, cursor: 'pointer' }}>Remove</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div style={{ flex: '1 1 180px' }}>
                      <label style={labelStyle}>Item (from QuickBooks)</label>
                      <input list="qbo-item-list" disabled={locked} style={inputStyle} value={l.item_name || ''} onChange={e => pickLineItem(i, e.target.value)} />
                    </div>
                    <div style={{ flex: '2 1 220px' }}>
                      <label style={labelStyle}>Description</label>
                      <input disabled={locked} style={inputStyle} value={l.description || ''} onChange={e => upLine(i, { description: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 70px' }}><label style={labelStyle}>Qty</label><input type="number" disabled={locked} style={inputStyle} value={l.qty} onChange={e => upLine(i, { qty: e.target.value })} /></div>
                    <div style={{ flex: '1 1 70px' }}><label style={labelStyle}>Unit</label><input disabled={locked} style={inputStyle} value={l.unit || ''} onChange={e => upLine(i, { unit: e.target.value })} /></div>
                    <div style={{ flex: '1 1 110px' }}><label style={labelStyle}>Contractor cost</label><input type="number" disabled={locked} style={inputStyle} value={l.contractor_unit_cost ?? ''} onChange={e => upLine(i, { contractor_unit_cost: e.target.value })} /></div>
                    <div style={{ flex: '1 1 90px' }}>
                      <label style={labelStyle}>Markup %</label>
                      <input type="number" disabled={locked} style={inputStyle} placeholder={`${est.default_markup_pct ?? 25}`} value={l.markup_pct ?? ''} onChange={e => upLine(i, { markup_pct: e.target.value })} />
                      {l.qbo_item_id && !locked && (
                        <button onClick={() => saveItemMarkupDefault(l)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 10, cursor: 'pointer', padding: '3px 0 0', textAlign: 'left' }}>
                          💾 save for this item
                        </button>
                      )}
                    </div>
                    <div style={{ flex: '1 1 110px' }}><label style={labelStyle}>Override price</label><input type="number" disabled={locked} style={inputStyle} value={l.override_unit_price ?? ''} onChange={e => upLine(i, { override_unit_price: e.target.value })} /></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 13 , flexWrap: 'wrap'}}>
                    <span style={{ color: '#94a3b8' }}>Client {fmt(x.price)}{l.unit ? ` / ${l.unit}` : ''}</span>
                    <b style={{ color: GOLD }}>{fmt(x.kTot)}</b>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, overflow: 'hidden', display: 'flex', background: '#0f1729', marginTop: 6 }}>
                    <div style={{ width: `${costPct}%`, background: GOLD }} />
                    <div style={{ flex: 1, background: x.margin >= 0 ? GREEN : RED }} />
                  </div>
                </div>
              );
            })}
            <datalist id="qbo-item-list">{qboItems.map(it => <option key={it.id} value={it.name} />)}</datalist>
            <button onClick={addLine} style={{ width: '100%', border: `2px dashed ${GOLD}`, background: 'rgba(232,163,61,0.06)', color: GOLD, borderRadius: 12, padding: 14, fontWeight: 700, cursor: 'pointer' }}>+ Add line</button>

            {totals && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, padding: '12px 16px', background: '#093843', borderRadius: 12, fontSize: 14 , flexWrap: 'wrap'}}>
                <span>Contractor <b>{fmt(totals.c)}</b></span>
                <span>Client <b>{fmt(totals.k)}</b></span>
                <span style={{ color: totals.profit >= 0 ? GREEN : RED }}>Profit <b>{fmt(totals.profit)}</b></span>
              </div>
            )}
          </>
        )}

        {tab === 'client' && (
          <>
            <button onClick={downloadEstimate} style={{ background: GOLD, color: '#1a1200', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>
              ⬇ Download / Print
            </button>
          <div style={{ background: '#fff', color: '#1c1c1e', borderRadius: 14, overflow: 'hidden', fontFamily: 'Georgia, serif' }}>
            <div style={{ background: brandPrimary, color: '#fff', padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>ESTIMATE</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{est.est_no} · {est.quote_date}</div>
              </div>
              {brandLogo
                ? <img src={brandLogo} alt="" style={{ height: 38, maxWidth: 180, objectFit: 'contain' }} />
                : <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.9 }}>{currentTenant?.name}</div>}
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 14, fontSize: 13 }}>
                <b>Prepared for:</b> {est.qbo_customer_name || <span style={{ color: RED }}>No customer selected — pick one on the Build tab before sending</span>}<br />
                {est.project}
              </div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: brandPrimary, color: '#fff' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>Item</th><th style={{ padding: 6, textAlign: 'left' }}>Description</th>
                  <th style={{ padding: 6 }}>Qty</th><th style={{ padding: 6 }}>Price</th><th style={{ padding: 6 }}>Amount</th>
                </tr></thead>
                <tbody>
                  {lines.filter(l => l.item_name || l.description).map(l => {
                    const x = calcLine(l, est.default_markup_pct);
                    return <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 6 }}>{l.item_name}</td><td style={{ padding: 6 }}>{l.description}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{x.qty}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{fmt(x.price)}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{fmt(x.kTot)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
              {totals && (
                <div style={{ textAlign: 'right', marginTop: 14, fontSize: 14 }}>
                  <div>Subtotal: {fmt(totals.k)}</div>
                  <div>Tax: {fmt(totals.tax)}</div>
                  <div style={{ fontWeight: 700, color: '#0D4F5C', fontSize: 16 }}>TOTAL: {fmt(totals.contract)}</div>
                </div>
              )}
              {est.terms && <div style={{ marginTop: 16, fontSize: 11, whiteSpace: 'pre-wrap', color: '#333' }}>{est.terms}</div>}
            </div>
          </div>
          </>
        )}

        {tab === 'rollup' && totals && (
          <>
            {est.status === 'accepted' ? (
              <button onClick={() => navigate(`/billing?invoiceEstimate=${est.id}`)} style={{
                width: '100%', background: GOLD, color: '#1a1200', border: 'none', borderRadius: 10,
                padding: '12px', fontWeight: 700, cursor: 'pointer', fontSize: 14, marginBottom: 14,
              }}>
                🧾 Create Invoice →
              </button>
            ) : (
              <button onClick={openApprovePrompt} style={{
                width: '100%', background: GREEN, color: '#fff', border: 'none', borderRadius: 10,
                padding: '12px', fontWeight: 700, cursor: 'pointer', fontSize: 14, marginBottom: 14,
              }}>
                ✓ Mark Approved
              </button>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {[['Contract', fmt(totals.contract), GOLD], ['Contractor Cost', fmt(totals.c), '#94a3b8'],
                ['Profit', fmt(totals.profit), totals.profit >= 0 ? GREEN : RED]].map(([label, val, color]) => (
                <div key={label} style={{ flex: '1 1 140px', background: '#1e293b', borderRadius: 14, padding: 14 }}>
                  <div style={labelStyle}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
                </div>
              ))}
            </div>
            {[['in', 'Customer Payments (in)'], ['out', 'Contractor Payments (out)']].map(([dir, title]) => (
              <div key={dir} style={{ background: '#1e293b', borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <div style={{ color: GOLD, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
                {payments.filter(p => p.direction === dir).map(p => {
                  const idx = payments.indexOf(p);
                  return (
                    <div key={p.id} style={{ display: 'flex', gap: 6, marginBottom: 6 , flexWrap: 'wrap'}}>
                      <input type="date" style={{ ...inputStyle, flex: '0 0 130px' }} value={p.paid_on || ''} onChange={e => upPayment(idx, { paid_on: e.target.value })} />
                      <input style={inputStyle} placeholder="ref" value={p.ref || ''} onChange={e => upPayment(idx, { ref: e.target.value })} />
                      <input type="number" style={{ ...inputStyle, flex: '0 0 100px' }} placeholder="$" value={p.amount ?? ''} onChange={e => upPayment(idx, { amount: e.target.value })} />
                      <button onClick={() => delPayment(idx)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer' }}>✕</button>
                    </div>
                  );
                })}
                <button onClick={() => addPayment(dir)} style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Add payment</button>
              </div>
            ))}
            {totals.paidOut > totals.c + 0.01 && (
              <div style={{ background: '#3a1414', border: '1px solid #7f1d1d', borderRadius: 10, padding: '10px 14px', marginBottom: 10, color: '#fca5a5', fontSize: 13 }}>
                ⚠ Paid out ({fmt(totals.paidOut)}) is more than the contractor cost budgeted in Build ({fmt(totals.c)}) — this contractor was paid {fmt(totals.paidOut - totals.c)} over what was planned.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px', background: '#1e293b', borderRadius: 14, padding: 14 }}>
                <div style={labelStyle}>Paid In</div><div style={{ fontSize: 18, fontWeight: 800, color: GREEN }}>{fmt(totals.paidIn)}</div>
              </div>
              <div style={{ flex: '1 1 140px', background: '#1e293b', borderRadius: 14, padding: 14 }}>
                <div style={labelStyle}>Paid Out</div><div style={{ fontSize: 18, fontWeight: 800, color: GOLD }}>{fmt(totals.paidOut)}</div>
              </div>
              <div style={{ flex: '1 1 140px', background: '#1e293b', borderRadius: 14, padding: 14 }}>
                <div style={labelStyle}>Outstanding</div><div style={{ fontSize: 18, fontWeight: 800 }}>{fmt(totals.contract - totals.paidIn)}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {showApprovePrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#1e293b', borderRadius: 14, padding: 22, maxWidth: 360, width: '100%' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0', marginBottom: 4 }}>Approve {est.est_no}</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 14 }}>How much should be invoiced now? This queues a request in Billing.</div>
            <label style={labelStyle}>Amount to invoice</label>
            <input type="number" step="0.01" autoFocus value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} style={{ ...inputStyle, marginBottom: 14, fontSize: 16 }} />
            {approveMsg && <div style={{ color: approveMsg.startsWith('Could not') ? RED : GREEN, fontSize: 12, marginBottom: 10 }}>{approveMsg}</div>}
            <div style={{ display: 'flex', gap: 8 , flexWrap: 'wrap'}}>
              <button onClick={approveEstimate} disabled={approving} style={{ flex: 1, background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, cursor: 'pointer' }}>
                {approving ? 'Approving…' : 'Confirm & Approve'}
              </button>
              <button onClick={() => setShowApprovePrompt(false)} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '11px 16px', cursor: 'pointer', color: '#94a3b8' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
