// ============================================
// Jovelin — QBO estimate reconciliation data
// GET /api/qbo/estimates-check?tenant_id=...
// Bulk-fetches every QBO Estimate's total for the tenant, once, so the
// frontend can compare each Jovelin estimate that has a qbo_estimate_id
// against what QuickBooks actually has on file — instead of one QBO call
// per estimate.
// ============================================
import { getSupabase, getValidConnection, qboQuery } from './_client.js';
import { requireCaller } from '../_auth.js';

export default async function handler(req, res) {
  const tenantId = req.query.tenant_id;
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenantId });
  if (!caller) return;

  const supabase = getSupabase();
  try {
    const conn = await getValidConnection(supabase, tenantId);
    if (!conn) return res.status(200).json({ connected: false, estimates: {} });

    // TxnStatus comes back too now, so the list and Rollup can show what
    // QuickBooks currently says about an estimate — not just whether the
    // totals agree.
    const resp = await qboQuery(conn.realm_id, conn.access_token, 'SELECT Id, TotalAmt, TxnStatus FROM Estimate MAXRESULTS 1000');
    const estimates = {};
    (resp.Estimate || []).forEach(e => {
      estimates[e.Id] = { total: parseFloat(e.TotalAmt) || 0, status: e.TxnStatus || null };
    });

    return res.status(200).json({ connected: true, estimates });
  } catch (err) {
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
