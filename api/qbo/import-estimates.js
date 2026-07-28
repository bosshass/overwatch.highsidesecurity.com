// ============================================
// Jovelin — Import estimates FROM QuickBooks
// POST /api/qbo/import-estimates  { tenant_id }
// ============================================
// Pulls QBO Estimates (with their line items) into Jovelin's own estimates
// / estimate_lines tables, so a newly-onboarded client's existing work is
// visible and sendable here rather than stranded in QuickBooks.
//
// DELIBERATE STATUS FILTER: only QBO TxnStatus 'Pending' and 'Accepted' are
// imported. 'Rejected' is never brought in, and 'Closed' is skipped too —
// neither is live work, and importing them would clutter the pipeline.
//
// WHAT'S MISSING BY DESIGN: QBO estimates carry a client-facing price but no
// contractor cost, so contractor_unit_cost / markup_pct come in NULL. The
// client price lands in override_unit_price, which is exactly how a
// Jovelin line with no cost basis is already meant to work — totals and the
// client doc are correct, only the margin half of the Rollup is blank.
//
// IDEMPOTENT: matched on (tenant_id, qbo_estimate_id), which carries a
// unique index. Re-running only refreshes status on estimates already here
// — it never rewrites lines, so any contractor cost entered by hand after
// an import survives re-importing.
import { getSupabase, getValidConnection, qboQuery, logQboError } from './_client.js';
import { requireCaller } from '../_auth.js';

// QBO TxnStatus -> Jovelin status. Anything not listed here is skipped.
const STATUS_MAP = { Pending: 'sent', Accepted: 'accepted' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const tenantId = req.body?.tenant_id;
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenantId });
  if (!caller) return;

  const supabase = getSupabase();
  try {
    const conn = await getValidConnection(supabase, tenantId);
    if (!conn) return res.status(200).json({ connected: false, imported: 0, updated: 0, skipped: 0 });

    const resp = await qboQuery(conn.realm_id, conn.access_token, 'SELECT * FROM Estimate MAXRESULTS 1000');
    const qboEstimates = resp.Estimate || [];

    // What's already here, so this can tell insert from update.
    const { data: existing } = await supabase.from('estimates')
      .select('id, qbo_estimate_id, status').eq('tenant_id', tenantId).not('qbo_estimate_id', 'is', null);
    const existingByQboId = {};
    (existing || []).forEach(e => { existingByQboId[e.qbo_estimate_id] = e; });

    let imported = 0, updated = 0, skipped = 0;
    const errors = [];

    for (const q of qboEstimates) {
      const mappedStatus = STATUS_MAP[q.TxnStatus];
      if (!mappedStatus) { skipped++; continue; } // Rejected, Closed, anything else

      const qboId = String(q.Id);
      const already = existingByQboId[qboId];

      if (already) {
        // Only refresh status — never touch lines, so hand-entered
        // contractor cost isn't destroyed by a re-import. Also never
        // downgrade an accepted estimate: 'accepted' is permanent in
        // Jovelin and carries billing consequences.
        if (already.status !== mappedStatus && already.status !== 'accepted') {
          const patch = { status: mappedStatus, updated_at: new Date().toISOString() };
          if (mappedStatus === 'accepted') patch.accepted_at = q.MetaData?.LastUpdatedTime || new Date().toISOString();
          const { error } = await supabase.from('estimates').update(patch).eq('id', already.id);
          if (error) errors.push(`${qboId}: ${error.message}`); else updated++;
        }
        continue;
      }

      const row = {
        tenant_id: tenantId,
        est_no: q.DocNumber ? String(q.DocNumber) : `QBO-${qboId}`,
        status: mappedStatus,
        qbo_estimate_id: qboId,
        qbo_customer_id: q.CustomerRef?.value ? String(q.CustomerRef.value) : null,
        qbo_customer_name: q.CustomerRef?.name || null,
        quote_date: q.TxnDate || null,
        // CustomerMemo is the customer-facing message on the estimate — in
        // practice usually long boilerplate ("CLIENT SATISFACTION
        // COMMITMENT!..."), not a project name. It belongs in terms, which
        // is what it actually is. Nothing in a QBO estimate maps cleanly to
        // Jovelin's short "project" label, so that's left empty rather than
        // stuffed with a paragraph that wrecks every row in the list.
        project: null,
        terms: q.CustomerMemo?.value || null,
        tax_rate: 0,
        default_markup_pct: 0,
        created_by: 'quickbooks-import',
      };
      if (mappedStatus === 'accepted') row.accepted_at = q.MetaData?.LastUpdatedTime || new Date().toISOString();

      const { data: inserted, error: insErr } = await supabase.from('estimates').insert(row).select('id').single();
      if (insErr || !inserted) { errors.push(`${qboId}: ${insErr?.message || 'insert failed'}`); continue; }

      // Line items. SubTotal / Discount / Tax lines are QBO presentation
      // artifacts, not real line items — skipped so totals aren't doubled.
      const lines = (q.Line || [])
        .filter(l => l.DetailType === 'SalesItemLineDetail' || l.DetailType === 'DescriptionOnly')
        .map((l, i) => {
          const d = l.SalesItemLineDetail || {};
          const qty = d.Qty != null ? Number(d.Qty) : 1;
          // Prefer the explicit unit price; fall back to Amount/Qty when QBO
          // omits UnitPrice (it does for some line shapes).
          const unitPrice = d.UnitPrice != null
            ? Number(d.UnitPrice)
            : (l.Amount != null && qty ? Number(l.Amount) / qty : 0);
          return {
            estimate_id: inserted.id,
            position: i,
            item_name: d.ItemRef?.name || null,
            description: l.Description || null,
            qty,
            qbo_item_id: d.ItemRef?.value ? String(d.ItemRef.value) : null,
            override_unit_price: unitPrice,   // client-facing price from QBO
            contractor_unit_cost: null,       // not present in QBO — by design
            markup_pct: null,
          };
        });

      if (lines.length) {
        const { error: lineErr } = await supabase.from('estimate_lines').insert(lines);
        if (lineErr) errors.push(`${qboId} lines: ${lineErr.message}`);
      }
      imported++;
    }

    return res.status(200).json({ connected: true, imported, updated, skipped, errors: errors.slice(0, 5) });
  } catch (err) {
    await logQboError(supabase, { tenantId, endpoint: '/api/qbo/import-estimates', error: err, statusCode: 502 });
    if (err.needsReconnect) return res.status(200).json({ connected: true, needsReconnect: true, error: String(err.message || err) });
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
