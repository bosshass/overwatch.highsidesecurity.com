// ============================================
// Jovelin — QBO revenue by period, with PY comparison + invoice detail
// GET /api/qbo/revenue?tenant_id=...&period=mtd|lastmonth|qtd|ytd
// The revenue slice of a P&L: Invoiced and Cash Collected totals (current
// vs. the identical calendar range one year earlier), PLUS the actual
// invoice list for the current period — customer, amount, date — so the
// frontend can cross-reference against estimates and time entries by
// customer, not just show a lump sum.
// ============================================
import { getSupabase, getValidConnection, qboQuery, withCache } from './_client.js';
import { requireCaller } from '../_auth.js';

function toISODate(d) { return d.toISOString().slice(0, 10); }

function getPeriodRange(period, now = new Date()) {
  const year = now.getFullYear(), month = now.getMonth();
  if (period === 'lastmonth') {
    return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0), label: 'Last Month' };
  }
  if (period === 'qtd') {
    const qStartMonth = Math.floor(month / 3) * 3;
    return { start: new Date(year, qStartMonth, 1), end: now, label: 'Quarter to Date' };
  }
  if (period === 'ytd') {
    return { start: new Date(year, 0, 1), end: now, label: 'Year to Date' };
  }
  return { start: new Date(year, month, 1), end: now, label: 'Month to Date' }; // mtd default
}

function priorYear({ start, end }) {
  const pStart = new Date(start); pStart.setFullYear(start.getFullYear() - 1);
  const pEnd = new Date(end); pEnd.setFullYear(end.getFullYear() - 1);
  return { start: pStart, end: pEnd };
}

async function sumForRange(realmId, accessToken, range) {
  const startStr = toISODate(range.start), endStr = toISODate(range.end);
  const [invResp, payResp] = await Promise.all([
    qboQuery(realmId, accessToken, `SELECT TotalAmt FROM Invoice WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}' MAXRESULTS 1000`),
    qboQuery(realmId, accessToken, `SELECT TotalAmt FROM Payment WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}' MAXRESULTS 1000`),
  ]);
  const invoiced = (invResp.Invoice || []).reduce((s, i) => s + (parseFloat(i.TotalAmt) || 0), 0);
  const cashCollected = (payResp.Payment || []).reduce((s, p) => s + (parseFloat(p.TotalAmt) || 0), 0);
  return { invoiced: Math.round(invoiced * 100) / 100, cashCollected: Math.round(cashCollected * 100) / 100 };
}

export default async function handler(req, res) {
  const tenantId = req.query.tenant_id;
  const period = req.query.period || 'mtd';
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenantId });
  if (!caller) return;

  const supabase = getSupabase();
  try {
    const conn = await getValidConnection(supabase, tenantId);
    if (!conn) return res.status(200).json({ connected: false });

    const range = getPeriodRange(period);
    const pyRange = priorYear(range);
    const startStr = toISODate(range.start), endStr = toISODate(range.end);

    const [current, prior, invDetailResp] = await Promise.all([
      sumForRange(conn.realm_id, conn.access_token, range),
      sumForRange(conn.realm_id, conn.access_token, pyRange),
      qboQuery(conn.realm_id, conn.access_token, `SELECT Id, DocNumber, CustomerRef, TotalAmt, TxnDate FROM Invoice WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}' MAXRESULTS 1000`),
    ]);

    const invoices = (invDetailResp.Invoice || []).map(i => ({
      id: i.Id, docNumber: i.DocNumber, customerId: i.CustomerRef?.value || null, customerName: i.CustomerRef?.name || null,
      amount: parseFloat(i.TotalAmt) || 0, date: i.TxnDate,
    }));

    const pctChange = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null);

    return res.status(200).json({
      connected: true,
      period,
      label: range.label,
      range: { start: startStr, end: endStr },
      priorYearRange: { start: toISODate(pyRange.start), end: toISODate(pyRange.end) },
      current,
      priorYear: prior,
      change: {
        invoiced: pctChange(current.invoiced, prior.invoiced),
        cashCollected: pctChange(current.cashCollected, prior.cashCollected),
      },
      invoices,
    });
  } catch (err) {
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
