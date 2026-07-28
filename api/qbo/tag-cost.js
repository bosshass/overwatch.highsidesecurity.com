// ============================================
// Jovelin — Tag ONE expense line with a customer, in QuickBooks
// POST /api/qbo/tag-cost
//   { tenant_id, txnType: 'Purchase'|'Bill', txnId, lineId, customerId, customerName }
// ============================================
// Writes to the client's real books, so it's deliberately narrow: it sets
// CustomerRef on exactly one line and changes nothing else.
//
// HOW THE WRITE IS KEPT SAFE:
// QuickBooks has no "patch one field on one line" operation. A sparse
// update that touches Line still replaces the ENTIRE Line array, and a
// full update clears any field you omit — either way, a careless write
// silently destroys data. So this does a read-modify-write: fetch the
// whole transaction, mutate only the target line's CustomerRef, and send
// back the object exactly as QuickBooks returned it. Everything not
// deliberately changed is byte-for-byte what was already there.
//
// The read happens immediately before the write so SyncToken is current;
// a stale token makes QuickBooks reject the update rather than clobber a
// concurrent edit, which is the behaviour we want.
//
// BillableStatus is deliberately left alone. Setting a customer and
// silently flipping an expense to Billable would change what the client
// gets invoiced for — a much bigger decision than the one being made here.
import { getSupabase, getValidConnection, qboBaseUrl, logQboError, invalidateCache, requiresApproval, enqueuePush, tenantIsActive } from './_client.js';
import { requireCaller } from '../_auth.js';

const ENTITY_PATH = { Purchase: 'purchase', Bill: 'bill' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { tenant_id: tenantId, txnType, txnId, lineId, customerId, customerName,
          requested_by, approved, payee, amount } = req.body || {};

  if (!tenantId || !txnType || !txnId || !customerId) {
    return res.status(400).json({ error: 'tenant_id, txnType, txnId and customerId are required' });
  }
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenantId });
  if (!caller) return;
  const entityPath = ENTITY_PATH[txnType];
  if (!entityPath) return res.status(400).json({ error: `Unsupported txnType: ${txnType}` });

  const supabase = getSupabase();
  try {
    if (!(await tenantIsActive(supabase, tenantId))) {
      return res.status(403).json({ error: 'This client is deactivated — nothing can be written to their QuickBooks.' });
    }

    if (!approved && await requiresApproval(supabase, tenantId, requested_by)) {
      const id = await enqueuePush(supabase, {
        tenantId, kind: 'cost_tag', requestedBy: requested_by,
        summary: `Tag ${payee || txnType} ${amount ? '$' + Number(amount).toFixed(2) : ''} to ${customerName || 'customer'}`,
        payload: { txnType, txnId, lineId, customerId, customerName },
      });
      return res.status(200).json({ queued: true, queueId: id });
    }

    const conn = await getValidConnection(supabase, tenantId);
    if (!conn) return res.status(400).json({ error: 'This tenant has no QuickBooks connection.' });

    const base = `${qboBaseUrl()}/v3/company/${conn.realm_id}`;
    const authHeaders = {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // 1. Read the whole transaction, fresh.
    const readRes = await fetch(`${base}/${entityPath}/${txnId}?minorversion=65`, { headers: authHeaders });
    const readData = await readRes.json();
    if (!readRes.ok) return res.status(502).json({ error: `Couldn't read ${txnType} ${txnId}: ${JSON.stringify(readData)}` });

    const txn = readData[txnType];
    if (!txn) return res.status(404).json({ error: `${txnType} ${txnId} not found in QuickBooks.` });

    // 2. Locate the one line, and mutate only its CustomerRef.
    let matched = false;
    let alreadyTagged = false;
    const newLines = (txn.Line || []).map((line, idx) => {
      const thisLineId = line.Id != null ? String(line.Id) : String(idx);
      if (thisLineId !== String(lineId)) return line;

      const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail;
      if (!detail) return line;

      // Don't quietly reassign a cost someone already attributed to a job.
      if (detail.CustomerRef?.value) { alreadyTagged = true; return line; }

      matched = true;
      const detailKey = line.AccountBasedExpenseLineDetail ? 'AccountBasedExpenseLineDetail' : 'ItemBasedExpenseLineDetail';
      return {
        ...line,
        [detailKey]: { ...detail, CustomerRef: { value: String(customerId), name: customerName || undefined } },
      };
    });

    if (alreadyTagged) {
      return res.status(409).json({ error: 'That line already has a customer in QuickBooks — refresh to see the current state.' });
    }
    if (!matched) {
      return res.status(404).json({ error: `Line ${lineId} not found on ${txnType} ${txnId}, or it isn't an expense line.` });
    }

    // 3. Write the object back exactly as read, with only that one change.
    const writeRes = await fetch(`${base}/${entityPath}?minorversion=65`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...txn, Line: newLines }),
    });
    const writeData = await writeRes.json();
    if (!writeRes.ok) return res.status(502).json({ error: `QuickBooks rejected the update: ${JSON.stringify(writeData)}` });

    // 4. Confirm from QuickBooks' own response that the tag actually stuck,
    //    rather than reporting success just because the call returned 200.
    const saved = writeData[txnType];
    const savedLine = (saved?.Line || []).find(l => String(l.Id) === String(lineId));
    const savedDetail = savedLine?.AccountBasedExpenseLineDetail || savedLine?.ItemBasedExpenseLineDetail;
    const confirmedId = savedDetail?.CustomerRef?.value;

    if (String(confirmedId) !== String(customerId)) {
      return res.status(502).json({
        error: 'QuickBooks accepted the update but the customer did not stick — nothing was changed on your end. Please check the transaction in QuickBooks.',
      });
    }

    // The tag changes job costing, profitability and the expense list, so
    // their cached copies are dropped rather than left stale for the TTL.
    await invalidateCache(supabase, tenantId);

    return res.status(200).json({
      tagged: true,
      txnType, txnId, lineId,
      customerId: String(confirmedId),
      customerName: savedDetail?.CustomerRef?.name || customerName || null,
    });
  } catch (err) {
    await logQboError(supabase, { tenantId, endpoint: '/api/qbo/tag-cost', error: err, statusCode: 502 });
    if (err.needsReconnect) return res.status(200).json({ needsReconnect: true, error: String(err.message || err) });
    return res.status(502).json({ error: String(err.message || err) });
  }
}
