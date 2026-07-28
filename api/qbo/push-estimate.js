// ============================================
// Jovelin — Push a Jovelin estimate into QBO as a real Estimate
// POST /api/qbo/push-estimate  { tenant_id, estimate_id }
// Fires once, when an estimate is marked Approved. Requires a QBO-linked
// customer (qbo_customer_id) — local-only customers have no QBO CustomerRef
// to attach an Estimate to, so this is skipped for those, not faked.
// Create-only for v1: if the estimate already has a qbo_estimate_id, this
// refuses rather than risk a bad update against a stale SyncToken.
// ============================================
import { getSupabase, getValidConnection, qboBaseUrl } from './_client.js';
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
  const { tenant_id, estimate_id } = req.body || {};
  if (!tenant_id || !estimate_id) return res.status(400).json({ error: 'tenant_id and estimate_id required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenant_id });
  if (!caller) return;

  const supabase = getSupabase();
  try {
    const conn = await getValidConnection(supabase, tenant_id);
    if (!conn) return res.status(200).json({ pushed: false, reason: 'not_connected' });

    const { data: est, error: estErr } = await supabase.from('estimates').select('*').eq('id', estimate_id).single();
    if (estErr) throw new Error(estErr.message);
    if (!est.qbo_customer_id) return res.status(200).json({ pushed: false, reason: 'no_qbo_customer' });
    if (est.qbo_estimate_id) return res.status(200).json({ pushed: false, reason: 'already_synced', qbo_estimate_id: est.qbo_estimate_id });

    const { data: lines, error: linesErr } = await supabase.from('estimate_lines').select('*').eq('estimate_id', estimate_id).order('position');
    if (linesErr) throw new Error(linesErr.message);
    if (!lines?.length) return res.status(200).json({ pushed: false, reason: 'no_lines' });

    const qboLines = lines.filter(l => l.qbo_item_id).map(l => {
      const { qty, price, amount } = calcLinePrice(l, est.default_markup_pct);
      return {
        DetailType: 'SalesItemLineDetail',
        Amount: amount,
        Description: l.description || l.item_name || undefined,
        SalesItemLineDetail: { ItemRef: { value: l.qbo_item_id }, Qty: qty, UnitPrice: price },
      };
    });
    if (!qboLines.length) return res.status(200).json({ pushed: false, reason: 'no_qbo_linked_lines' });

    const payload = { CustomerRef: { value: est.qbo_customer_id }, Line: qboLines };
    const url = `${qboBaseUrl()}/v3/company/${conn.realm_id}/estimate?minorversion=65`;
    const qboRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await qboRes.json();
    if (!qboRes.ok) return res.status(502).json({ pushed: false, error: JSON.stringify(data) });

    const qboEstimateId = data.Estimate?.Id;
    await supabase.from('estimates').update({ qbo_estimate_id: qboEstimateId }).eq('id', estimate_id);
    return res.status(200).json({ pushed: true, qbo_estimate_id: qboEstimateId });
  } catch (err) {
    return res.status(502).json({ pushed: false, error: String(err.message || err) });
  }
}
