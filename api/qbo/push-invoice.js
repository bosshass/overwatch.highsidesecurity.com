// ============================================
// Jovelin — Create a QBO Invoice from an estimate, then verify it
// POST /api/qbo/push-invoice  { tenant_id, estimate_id }
// Creates the invoice via API only — this never calls QBO's own "send"
// action, so nothing goes to the customer from QuickBooks. It's staged
// in QBO as a normal unsent invoice; sending (if at all) happens through
// Jovelin's own Download/Send actions, same as estimates.
// Immediately after creating, re-fetches that exact invoice from QBO by
// its own Id and compares TotalAmt against what Jovelin calculated —
// a real round-trip confirmation, not just trusting the POST response.
// ============================================
import { getSupabase, getValidConnection, qboBaseUrl, invalidateCache, requiresApproval, enqueuePush, tenantIsActive } from './_client.js';
import { requireCaller } from '../_auth.js';

function calcLinePrice(l, defaultMarkup) {
  const qty = parseFloat(l.qty) || 0;
  const cost = parseFloat(l.contractor_unit_cost) || 0;
  const mk = (l.markup_pct === null || l.markup_pct === undefined) ? defaultMarkup : parseFloat(l.markup_pct) || 0;
  const ov = (l.override_unit_price === null || l.override_unit_price === undefined) ? null : parseFloat(l.override_unit_price);
  const price = ov !== null && isFinite(ov) ? ov : cost * (1 + mk / 100);
  return { qty, price, amount: Math.round(qty * price * 100) / 100 };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { tenant_id, estimate_id, requested_by, approved } = req.body || {};
  if (!tenant_id || !estimate_id) return res.status(400).json({ error: 'tenant_id and estimate_id required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenant_id });
  if (!caller) return;

  const supabase = getSupabase();
  try {
    if (!(await tenantIsActive(supabase, tenant_id))) {
      return res.status(200).json({ pushed: false, reason: 'tenant_inactive' });
    }

    if (!approved && await requiresApproval(supabase, tenant_id, requested_by)) {
      const { data: e } = await supabase.from('estimates')
        .select('est_no, qbo_customer_name').eq('id', estimate_id).maybeSingle();
      const id = await enqueuePush(supabase, {
        tenantId: tenant_id, kind: 'invoice_from_estimate', requestedBy: requested_by,
        summary: `Invoice from estimate ${e?.est_no || estimate_id} — ${e?.qbo_customer_name || 'customer'}`,
        payload: { estimate_id },
      });
      return res.status(200).json({ queued: true, queueId: id });
    }

    const conn = await getValidConnection(supabase, tenant_id);
    if (!conn) return res.status(200).json({ pushed: false, reason: 'not_connected' });

    const { data: est, error: estErr } = await supabase.from('estimates').select('*').eq('id', estimate_id).single();
    if (estErr) throw new Error(estErr.message);
    if (!est.qbo_customer_id) return res.status(200).json({ pushed: false, reason: 'no_qbo_customer' });

    const { data: lines, error: linesErr } = await supabase.from('estimate_lines').select('*').eq('estimate_id', estimate_id).order('position');
    if (linesErr) throw new Error(linesErr.message);
    const qboLines = (lines || []).filter(l => l.qbo_item_id).map(l => {
      const { qty, price, amount } = calcLinePrice(l, est.default_markup_pct);
      return {
        DetailType: 'SalesItemLineDetail',
        Amount: amount,
        Description: l.description || l.item_name || undefined,
        SalesItemLineDetail: { ItemRef: { value: l.qbo_item_id }, Qty: qty, UnitPrice: price },
      };
    });
    if (!qboLines.length) return res.status(200).json({ pushed: false, reason: 'no_qbo_linked_lines' });

    const expectedTotal = Math.round(qboLines.reduce((s, l) => s + l.Amount, 0) * 100) / 100;

    // Create — a plain POST, no send action attached. Stays unsent in QBO.
    const createUrl = `${qboBaseUrl()}/v3/company/${conn.realm_id}/invoice?minorversion=65`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ CustomerRef: { value: est.qbo_customer_id }, Line: qboLines }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) return res.status(502).json({ pushed: false, error: JSON.stringify(createData) });

    const invoiceId = createData.Invoice?.Id;
    const invoiceDocNumber = createData.Invoice?.DocNumber;

    // Verify — a fresh GET, not just trusting the create response.
    const getUrl = `${qboBaseUrl()}/v3/company/${conn.realm_id}/invoice/${invoiceId}?minorversion=65`;
    const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${conn.access_token}`, Accept: 'application/json' } });
    const getData = await getRes.json();
    const confirmedTotal = parseFloat(getData.Invoice?.TotalAmt);
    const matches = getRes.ok && Math.abs(confirmedTotal - expectedTotal) < 0.01;

    await invalidateCache(supabase, tenant_id);

    return res.status(200).json({
      pushed: true,
      invoiceId,
      invoiceDocNumber,
      expectedTotal,
      confirmedTotal: getRes.ok ? confirmedTotal : null,
      matches,
      confirmError: getRes.ok ? null : JSON.stringify(getData),
    });
  } catch (err) {
    return res.status(502).json({ pushed: false, error: String(err.message || err) });
  }
}
