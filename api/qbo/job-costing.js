// ============================================
// Jovelin — QBO job-costing data (invoices + expenses, by customer)
// GET /api/qbo/job-costing?tenant_id=...
// Bulk fetch — ALL invoices and ALL customer-tagged costs for the tenant's
// QBO company, once. The frontend does the per-estimate math (filtering by
// customer + date range) locally instead of firing one QBO query per
// accepted estimate, which would not scale.
// ============================================
import { getSupabase, getValidConnection, qboQuery, logQboError, withCache } from './_client.js';
import { requireCaller } from '../_auth.js';

// Pulls customer-tagged expense lines out of a Purchase or Bill. In BOTH
// entities the customer/project association lives on the LINE
// (AccountBasedExpenseLineDetail.CustomerRef or ItemBasedExpenseLineDetail
// .CustomerRef), never on the header — a single transaction can span
// several customers. Header-level EntityRef/VendorRef is the PAYEE, which
// is who the money went to, not what job it belongs to.
function extractCustomerLines(txn, { source, payeeName }) {
  const out = [];
  (txn.Line || []).forEach(line => {
    const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail;
    const custRef = detail?.CustomerRef;
    if (!custRef?.value) return;
    out.push({
      id: `${txn.Id}-${line.Id || out.length}`,
      customerId: String(custRef.value),
      customerName: custRef.name || null,
      date: txn.TxnDate,
      amount: parseFloat(line.Amount) || 0,
      source,
      payee: payeeName || null,
      memo: line.Description || null,
      billableStatus: detail?.BillableStatus || null,
    });
  });
  return out;
}

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
    if (!conn) return res.status(200).json({ connected: false, invoices: [], expenses: [] });

    const fresh = req.query.fresh === '1';
    const cached = await withCache(supabase, tenantId, 'job-costing', 300, async () => {
    const [invResp, purchaseResp, billResp] = await Promise.all([
      qboQuery(conn.realm_id, conn.access_token, 'SELECT Id, DocNumber, CustomerRef, TxnDate, TotalAmt FROM Invoice MAXRESULTS 1000'),
      // SELECT * rather than naming columns. QuickBooks does not reliably
      // populate nested line detail — AccountBasedExpenseLineDetail and the
      // CustomerRef inside it — when specific columns are selected, even
      // when Line is one of them. Naming columns here meant every
      // customer-tagged cost was invisible to job costing and
      // profitability, while expense-lines (which already used SELECT *)
      // showed the very same expenses correctly.
      qboQuery(conn.realm_id, conn.access_token, 'SELECT * FROM Purchase ORDER BY TxnDate DESC MAXRESULTS 1000'),
      qboQuery(conn.realm_id, conn.access_token, 'SELECT * FROM Bill ORDER BY TxnDate DESC MAXRESULTS 1000'),
    ]);

    const invoices = (invResp.Invoice || []).map(i => ({
      id: i.Id,
      docNumber: i.DocNumber || null,
      customerId: i.CustomerRef?.value ? String(i.CustomerRef.value) : null,
      customerName: i.CustomerRef?.name || null,
      date: i.TxnDate,
      amount: parseFloat(i.TotalAmt) || 0,
    }));

    // Previously this read Purchase.EntityRef and only kept rows where the
    // PAYEE happened to be a Customer — which misses the normal case
    // entirely (paying a vendor for work done on a customer's job) and
    // wrongly counted the rare case of paying a customer directly. Both
    // Purchase and Bill now go through the same line-level extraction.
    const purchases = (purchaseResp.Purchase || []).flatMap(p =>
      extractCustomerLines(p, { source: 'Expense', payeeName: p.EntityRef?.name })
    );
    const bills = (billResp.Bill || []).flatMap(b =>
      extractCustomerLines(b, { source: 'Bill', payeeName: b.VendorRef?.name })
    );

    const expenses = [...purchases, ...bills].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      return { connected: true, invoices, expenses };
    }, { fresh });
    return res.status(200).json(cached);
  } catch (err) {
    await logQboError(supabase, { tenantId, endpoint: '/api/qbo/job-costing', error: err, statusCode: 502 });
    if (err.needsReconnect) return res.status(200).json({ connected: true, needsReconnect: true, error: String(err.message || err) });
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
