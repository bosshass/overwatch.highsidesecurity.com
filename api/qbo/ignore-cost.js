// ============================================
// Jovelin — Ignore / un-ignore an untagged cost
// POST /api/qbo/ignore-cost   { tenant_id, cost_key, ignored_by, undo? }
// ============================================
// Purely a Jovelin-side dismissal. NOTHING is sent to QuickBooks — the
// transaction there is left exactly as it is, untouched and still
// untagged. This only stops the cost occupying one of the 30 slots in
// the untagged list, so the ones that DO need a customer stay visible.
//
// Kept as its own endpoint rather than a direct table write from the
// browser so ignoring and un-ignoring behave identically and the reason
// this never reaches QuickBooks is documented in one place.
import { getSupabase, invalidateCache } from './_client.js';
import { requireCaller } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { tenant_id: tenantId, cost_key: costKey, ignored_by: ignoredBy, undo } = req.body || {};
  if (!tenantId || !costKey) return res.status(400).json({ error: 'tenant_id and cost_key are required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenantId });
  if (!caller) return;

  const supabase = getSupabase();
  try {
    if (undo) {
      const { error } = await supabase.from('ignored_costs')
        .delete().eq('tenant_id', tenantId).eq('cost_key', costKey);
      if (error) return res.status(500).json({ error: error.message });
      await invalidateCache(supabase, tenantId);
      return res.status(200).json({ ignored: false });
    }

    // onConflict so ignoring something twice is a no-op rather than an error.
    const { error } = await supabase.from('ignored_costs')
      .upsert({ tenant_id: tenantId, cost_key: costKey, ignored_by: ignoredBy || null },
              { onConflict: 'tenant_id,cost_key' });
    if (error) return res.status(500).json({ error: error.message });
    await invalidateCache(supabase, tenantId);
    return res.status(200).json({ ignored: true });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
