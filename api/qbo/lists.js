// ============================================
// Jovelin — QBO customers + items (products/services)
// GET /api/qbo/lists?tenant_id=...
// This IS the source of truth for "who's the customer" and "what's the
// dropdown of products/services" — QBO, not a duplicated Supabase table.
// ============================================
import { getSupabase, getValidConnection, qboQuery, withCache } from './_client.js';
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
    if (!conn) return res.status(200).json({ connected: false, customers: [], items: [] });

    const fresh = req.query.fresh === '1';
    const cached = await withCache(supabase, tenantId, 'lists', 900, async () => {
    const [custResp, itemResp] = await Promise.all([
      qboQuery(conn.realm_id, conn.access_token, "SELECT Id, DisplayName, PrimaryEmailAddr FROM Customer WHERE Active = true MAXRESULTS 1000"),
      qboQuery(conn.realm_id, conn.access_token, "SELECT Id, Name, UnitPrice, Type FROM Item WHERE Active = true MAXRESULTS 1000"),
    ]);

    const customers = (custResp.Customer || []).map(c => ({ id: c.Id, name: c.DisplayName, email: c.PrimaryEmailAddr?.Address || null }));
    const items = (itemResp.Item || [])
      .filter(i => i.Type !== 'Category') // categories aren't selectable line items
      .map(i => ({ id: i.Id, name: i.Name, unitPrice: i.UnitPrice ?? null }));

      return { connected: true, customers, items };
    }, { fresh });
    return res.status(200).json(cached);
  } catch (err) {
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
