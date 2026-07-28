// ============================================
// Jovelin — Create a QBO Invoice from arbitrary lines, then verify it
// POST /api/qbo/push-custom-invoice
//   { tenant_id, qbo_customer_id, lines: [{ qbo_item_id, description, qty, rate }],
//     time_entry_ids?: [], memo? }
// ============================================
// Sibling of push-invoice.js, which builds from an estimate. This one
// takes lines assembled by hand — typically from unbilled time, with the
// product/service, description and rate adjusted before sending.
//
// Same two guarantees as the estimate path:
//   - Created via the API only. QBO's own "send" action is never called,
//     so nothing reaches the customer from QuickBooks.
//   - Immediately re-fetched by Id and the total compared against what
//     Jovelin calculated, rather than trusting the create response.
//
// If time_entry_ids are supplied and the invoice both creates AND
// verifies, those entries are marked billed and stamped with the invoice
// number — so the same hours can't be invoiced twice. That only happens
// after verification: a failed or mismatched push leaves them unbilled
// and available to try again.
import { getSupabase, getValidConnection, qboBaseUrl, invalidateCache, requiresApproval, enqueuePush, tenantIsActive } from './_client.js';
import { requireCaller } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { tenant_id, qbo_customer_id, lines, time_entry_ids, memo,
          requested_by, approved, customer_name } = req.body || {};
  if (!tenant_id || !qbo_customer_id) return res.status(400).json({ error: 'tenant_id and qbo_customer_id required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenant_id });
  if (!caller) return;
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'at least one line required' });

  const supabase = getSupabase();
  try {
    if (!(await tenantIsActive(supabase, tenant_id))) {
      return res.status(200).json({ pushed: false, reason: 'tenant_inactive' });
    }

    // Park it for review unless a super admin has already released it.
    if (!approved && await requiresApproval(supabase, tenant_id, requested_by)) {
      const total = (lines || []).reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0), 0);
      const id = await enqueuePush(supabase, {
        tenantId: tenant_id, kind: 'custom_invoice', requestedBy: requested_by,
        summary: `Invoice for ${customer_name || 'customer'} — $${total.toFixed(2)}, ${lines.length} line${lines.length === 1 ? '' : 's'}`,
        payload: { qbo_customer_id, lines, time_entry_ids, memo, customer_name },
      });
      return res.status(200).json({ queued: true, queueId: id });
    }

    const conn = await getValidConnection(supabase, tenant_id);
    if (!conn) return res.status(200).json({ pushed: false, reason: 'not_connected' });

    // QBO requires an ItemRef on every sales line — a line with no
    // product/service selected can't be created, so it's rejected here
    // with a clear reason rather than failing opaquely at Intuit.
    const missingItem = lines.find(l => !l.qbo_item_id);
    if (missingItem) {
      return res.status(200).json({ pushed: false, reason: 'line_missing_product', detail: missingItem.description || '(no description)' });
    }

    const qboLines = lines.map(l => {
      const qty = parseFloat(l.qty) || 0;
      const rate = parseFloat(l.rate) || 0;
      return {
        DetailType: 'SalesItemLineDetail',
        Amount: Math.round(qty * rate * 100) / 100,
        Description: l.description || undefined,
        SalesItemLineDetail: { ItemRef: { value: String(l.qbo_item_id) }, Qty: qty, UnitPrice: rate },
      };
    });
    const expectedTotal = Math.round(qboLines.reduce((s, l) => s + l.Amount, 0) * 100) / 100;

    const body = { CustomerRef: { value: String(qbo_customer_id) }, Line: qboLines };
    if (memo) body.CustomerMemo = { value: memo };

    const createRes = await fetch(`${qboBaseUrl()}/v3/company/${conn.realm_id}/invoice?minorversion=75`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json();
    if (!createRes.ok) return res.status(502).json({ pushed: false, error: JSON.stringify(createData) });

    const created = createData?.Invoice;
    if (!created?.Id) return res.status(502).json({ pushed: false, error: 'QuickBooks returned no invoice id' });

    // Round-trip confirmation — read it back by its own Id.
    const verifyRes = await fetch(`${qboBaseUrl()}/v3/company/${conn.realm_id}/invoice/${created.Id}?minorversion=75`, {
      headers: { Authorization: `Bearer ${conn.access_token}`, Accept: 'application/json' },
    });
    const verifyData = await verifyRes.json();
    const confirmed = verifyData?.Invoice;
    const confirmedTotal = parseFloat(confirmed?.TotalAmt) || 0;
    const matches = Math.abs(confirmedTotal - expectedTotal) < 0.01;

    // Only close out the hours once QuickBooks has confirmed the invoice.
    let markedBilled = 0;
    if (matches && Array.isArray(time_entry_ids) && time_entry_ids.length) {
      const { error: markErr, count } = await supabase.from('time_entries')
        .update({
          billed: true,
          billed_at: new Date().toISOString(),
          invoice_ref: confirmed?.DocNumber || String(created.Id),
        }, { count: 'exact' })
        .in('id', time_entry_ids).eq('tenant_id', tenant_id);
      if (!markErr) markedBilled = count || time_entry_ids.length;
    }

    await invalidateCache(supabase, tenant_id);

    return res.status(200).json({
      pushed: true,
      matches,
      invoiceId: created.Id,
      invoiceDocNumber: confirmed?.DocNumber || created.DocNumber || null,
      expectedTotal,
      confirmedTotal,
      markedBilled,
    });
  } catch (err) {
    return res.status(502).json({ pushed: false, error: String(err.message || err) });
  }
}
