// ============================================
// Jovelin — Customer View
// ============================================
// One customer's estimates: mark one Approved (stamps accepted_at, then
// pushes it into QBO as a real Estimate — only fires once per estimate,
// only works for QBO-linked customers), download a client-safe copy, or
// open a pre-filled email to send it.
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useSignature } from '../utils/useSignature.js';
import { openGmailCompose } from '../utils/gmailCompose.js';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

function calcLine(l, defaultMarkup) {
  const qty = parseFloat(l.qty) || 0;
  const cost = parseFloat(l.contractor_unit_cost) || 0;
  const mk = (l.markup_pct === null || l.markup_pct === undefined) ? defaultMarkup : parseFloat(l.markup_pct) || 0;
  const ov = (l.override_unit_price === null || l.override_unit_price === undefined) ? null : parseFloat(l.override_unit_price);
  const price = ov !== null && isFinite(ov) ? ov : cost * (1 + mk / 100);
  return { qty, price, amount: qty * price };
}
function estimateTotal(est) {
  return (est.estimate_lines || []).reduce((s, l) => s + calcLine(l, est.default_markup_pct).amount, 0);
}

function openPrintable(est, customerName, tenantName) {
  const total = estimateTotal(est);
  const rows = (est.estimate_lines || []).map(l => {
    const c = calcLine(l, est.default_markup_pct);
    return `<tr><td style="padding:6px;font-weight:600">${l.item_name || ''}</td><td style="padding:6px">${l.description || ''}</td>
      <td style="padding:6px;text-align:right">${c.qty}</td><td style="padding:6px;text-align:right">${fmt(c.price)}</td>
      <td style="padding:6px;text-align:right">${fmt(c.amount)}</td></tr>`;
  }).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>${est.est_no}</title><style>
    body{font-family:Georgia,serif;color:#1c1c1e;margin:0;} .head{background:#0D4F5C;color:#fff;padding:24px 30px}
    .body{padding:24px 30px} table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#0D4F5C;color:#fff;padding:6px;text-align:left} .tot{background:#F4F1EB;color:#0D4F5C;font-weight:700;font-size:16px}
  </style></head><body>
    <div class="head"><div style="font-size:20px;font-weight:700">${tenantName}</div><div style="font-size:12px;opacity:.85">ESTIMATE ${est.est_no}</div></div>
    <div class="body">
      <div style="margin-bottom:14px"><b>Prepared for:</b> ${customerName}${est.project ? '<br>' + est.project : ''}</div>
      <table><thead><tr><th>Item</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div style="text-align:right;margin-top:14px"><span class="tot" style="padding:6px 14px;border-radius:6px">TOTAL: ${fmt(total)}</span></div>
      ${est.terms ? `<div style="margin-top:20px;font-size:11px;white-space:pre-wrap">${est.terms}</div>` : ''}
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

export default function CustomerView({ userEmail }) {
  const { currentTenantId, currentTenant } = useTenant();
  const signature = useSignature(userEmail);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const source = params.get('source');
  const id = params.get('id');
  const name = params.get('name') || 'Customer';
  const [estimates, setEstimates] = useState([]);
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [billedEstimateIds, setBilledEstimateIds] = useState(new Set());

  const load = useCallback(async () => {
    if (!currentTenantId || !id) return;
    setLoading(true);
    const col = source === 'qbo' ? 'qbo_customer_id' : 'local_customer_id';
    const { data } = await supabase.from('estimates')
      .select('*, estimate_lines(qty, contractor_unit_cost, markup_pct, override_unit_price, item_name, description)')
      .eq('tenant_id', currentTenantId).eq(col, id).order('created_at', { ascending: false });
    setEstimates(data || []);
    const estIds = (data || []).map(e => e.id);
    if (estIds.length) {
      const { data: reqs } = await supabase.from('billing_requests').select('estimate_id').in('estimate_id', estIds);
      setBilledEstimateIds(new Set((reqs || []).map(r => r.estimate_id)));
    }

    if (source === 'qbo') {
      const r = await apiFetch(`/api/qbo/lists?tenant_id=${currentTenantId}`).then(res => res.json()).catch(() => ({ customers: [] }));
      setEmail((r.customers || []).find(c => c.id === id)?.email || null);
    } else {
      const { data: c } = await supabase.from('customers').select('email').eq('id', id).single();
      setEmail(c?.email || null);
    }
    setLoading(false);
  }, [currentTenantId, source, id]);

  useEffect(() => { load(); }, [load]);

  const [approvingEst, setApprovingEst] = useState(null);
  const [invoiceAmount, setInvoiceAmount] = useState('');

  const startApprove = (est) => {
    setApprovingEst(est);
    setInvoiceAmount(estimateTotal(est).toFixed(2));
  };

  const markApproved = async () => {
    const est = approvingEst;
    const amt = parseFloat(invoiceAmount) || 0;
    setBusyId(est.id); setStatusMsg('');
    try {
      await supabase.from('estimates').update({
        status: 'accepted', accepted_at: est.accepted_at || new Date().toISOString(),
      }).eq('id', est.id);

      if (amt > 0) {
        await supabase.from('billing_requests').insert({
          tenant_id: currentTenantId, estimate_id: est.id,
          qbo_customer_id: est.qbo_customer_id || null, qbo_customer_name: est.qbo_customer_name || null,
          local_customer_id: est.local_customer_id || null, amount_requested: amt,
        });
      }

      if (source === 'qbo') {
        const r = await apiFetch('/api/qbo/push-estimate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: currentTenantId, estimate_id: est.id }),
        }).then(res => res.json());
        if (r.pushed) setStatusMsg(`${est.est_no}: approved, pushed to QuickBooks, and ${fmt(amt)} queued in Billing.`);
        else if (r.reason === 'already_synced') setStatusMsg(`${est.est_no}: approved (already in QuickBooks) — ${fmt(amt)} queued in Billing.`);
        else if (r.reason === 'no_lines' || r.reason === 'no_qbo_linked_lines') setStatusMsg(`${est.est_no}: approved locally — no QBO-linked line items to push. ${fmt(amt)} queued in Billing.`);
        else setStatusMsg(`${est.est_no}: approved locally, but QuickBooks push failed (${r.reason || r.error || 'unknown'}). ${fmt(amt)} queued in Billing.`);
      } else {
        setStatusMsg(`${est.est_no}: approved. (Local customer — not pushed to QuickBooks.) ${fmt(amt)} queued in Billing.`);
      }
      setApprovingEst(null);
      load();
    } catch (e) {
      setStatusMsg('Could not approve: ' + e.message);
    }
    setBusyId(null);
  };

  const sendToCustomer = (est) => {
    openGmailCompose({
      to: email,
      subject: `Estimate ${est.est_no} from ${currentTenant?.name || ''}`,
      body: `Hi,\n\nPlease find estimate ${est.est_no} for ${fmt(estimateTotal(est))}${est.project ? ' — ' + est.project : ''}.\n\n` +
        `(Download and attach the estimate PDF before sending — this doesn't attach the file automatically.)\n\nThanks,${signature || ''}`,
    });
  };

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <button onClick={() => navigate(-1)} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 10 }}>← Back</button>
        <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: '0 0 2px' }}>{name}</h1>
        <div style={{ color: SUBTEXT, fontSize: 13, marginBottom: 4 }}>{source === 'qbo' ? 'From QuickBooks' : 'Local customer'}{email ? ` · ${email}` : ''}</div>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 18 }}>{currentTenant?.name}</p>

        {statusMsg && <div style={{ background: '#e6f4ea', color: GREEN, borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{statusMsg}</div>}

        {loading ? (
          <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
        ) : estimates.length === 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, color: SUBTEXT, fontSize: 13 }}>No estimates for this customer yet.</div>
        ) : (
          estimates.map(est => (
            <div key={est.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 , flexWrap: 'wrap'}}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>{est.est_no} {est.project ? `— ${est.project}` : ''}</div>
                  <div style={{ fontSize: 12, color: SUBTEXT }}>{est.quote_date}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: TEAL, fontSize: 16 }}>{fmt(estimateTotal(est))}</div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize',
                    background: est.status === 'accepted' ? '#e6f4ea' : est.status === 'sent' ? '#e8f0f4' : '#f4f0e6',
                    color: est.status === 'accepted' ? GREEN : est.status === 'sent' ? TEAL : AMBER,
                  }}>{est.status}{est.qbo_estimate_id ? ' · in QBO' : ''}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {est.status !== 'accepted' && (
                  <button onClick={() => startApprove(est)} disabled={busyId === est.id}
                    style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                    {busyId === est.id ? 'Approving…' : '✓ Mark Approved'}
                  </button>
                )}
                {est.status === 'accepted' && !billedEstimateIds.has(est.id) && (
                  <button onClick={() => startApprove(est)} disabled={busyId === est.id}
                    style={{ background: AMBER, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                    ⚠ Queue for Billing
                  </button>
                )}
                <button onClick={() => openPrintable(est, name, currentTenant?.name || '')}
                  style={{ background: '#f3f4f6', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                  ⬇ Download
                </button>
                <button onClick={() => sendToCustomer(est)}
                  style={{ background: '#f3f4f6', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                  ✉ Send to Customer
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {approvingEst && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: CARD, borderRadius: 14, padding: 22, maxWidth: 360, width: '90%' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: TEXT, marginBottom: 4 }}>Approve {approvingEst.est_no}</div>
            <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 14 }}>How much of this estimate should be invoiced now? This queues a request in Billing.</div>
            <label style={{ fontSize: 11, fontWeight: 700, color: SUBTEXT, textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Amount to invoice</label>
            <input type="number" step="0.01" autoFocus value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', fontSize: 15, border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 14, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 , flexWrap: 'wrap'}}>
              <button onClick={markApproved} disabled={busyId === approvingEst.id}
                style={{ flex: 1, background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontWeight: 700, cursor: 'pointer' }}>
                {busyId === approvingEst.id ? 'Approving…' : 'Confirm & Approve'}
              </button>
              <button onClick={() => setApprovingEst(null)} style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '11px 16px', cursor: 'pointer', color: SUBTEXT }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
