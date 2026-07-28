// ============================================
// Jovelin — Monthly income vs expenses trend
// GET /api/qbo/monthly-trend?tenant_id=...&months=6
// ============================================
// Four series per month, deliberately separating accrual from cash so the
// chart shows both what was billed/owed and what actually moved:
//
//   invoiced  — Invoices raised            (income issued)
//   collected — Payments received          (income paid)
//   incurred  — Bills entered + Purchases  (expenses issued/accrued)
//   paid      — Purchases + BillPayments   (expenses actually paid out)
//
// Purchases (cash/card expenses) count in BOTH expense series on purpose:
// they're incurred and paid in the same moment, which is exactly what a
// card swipe is. Bills are incurred when entered and paid later via
// BillPayment, so they land in different months — which is the whole
// point of showing the two lines separately.
import { getSupabase, getValidConnection, qboQuery, logQboError, withCache } from './_client.js';
import { requireCaller } from '../_auth.js';

const monthKey = (d) => (d || '').slice(0, 7); // 'YYYY-MM'

export default async function handler(req, res) {
  const tenantId = req.query.tenant_id;
  const months = Math.min(parseInt(req.query.months) || 6, 24);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
  // Gate: an endpoint that answers with service-role data must know who
  // is asking. Unauthenticated callers and anyone reaching outside their
  // own client are turned away before a single QuickBooks call is made.
  const caller = await requireCaller(req, res, { tenantId: tenantId });
  if (!caller) return;

  const supabase = getSupabase();
  try {
    const conn = await getValidConnection(supabase, tenantId);
    if (!conn) return res.status(200).json({ connected: false, series: [] });

    // Start of the month, `months - 1` months back — so a 6-month request
    // covers the current month plus the five before it.
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const startStr = start.toISOString().slice(0, 10);

    const q = (entity) =>
      qboQuery(conn.realm_id, conn.access_token,
        `SELECT Id, TxnDate, TotalAmt FROM ${entity} WHERE TxnDate >= '${startStr}' ORDER BY TxnDate DESC MAXRESULTS 1000`);

    const fresh = req.query.fresh === '1';
    const cached = await withCache(supabase, tenantId, `monthly-trend:${months}`, 900, async () => {
    const [invResp, payResp, billResp, purchResp, billPayResp] = await Promise.all([
      q('Invoice'), q('Payment'), q('Bill'), q('Purchase'), q('BillPayment'),
    ]);

    // Pre-seed every month in range so gaps render as zero rather than
    // silently collapsing the axis.
    const buckets = {};
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      buckets[d.toISOString().slice(0, 7)] = { month: d.toISOString().slice(0, 7), invoiced: 0, collected: 0, incurred: 0, paid: 0 };
    }

    const add = (rows, entity, fields) => {
      (rows?.[entity] || []).forEach(r => {
        const k = monthKey(r.TxnDate);
        if (!buckets[k]) return; // outside the window
        const amt = parseFloat(r.TotalAmt) || 0;
        fields.forEach(f => { buckets[k][f] += amt; });
      });
    };

    add(invResp, 'Invoice', ['invoiced']);
    add(payResp, 'Payment', ['collected']);
    add(billResp, 'Bill', ['incurred']);
    add(purchResp, 'Purchase', ['incurred', 'paid']); // incurred and paid same moment
    add(billPayResp, 'BillPayment', ['paid']);

    const series = Object.values(buckets)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({
        ...m,
        invoiced: Math.round(m.invoiced * 100) / 100,
        collected: Math.round(m.collected * 100) / 100,
        incurred: Math.round(m.incurred * 100) / 100,
        paid: Math.round(m.paid * 100) / 100,
      }));

    const current = series[series.length - 1] || null;

      return { connected: true, series, current };
    }, { fresh });
    return res.status(200).json(cached);
  } catch (err) {
    await logQboError(supabase, { tenantId, endpoint: '/api/qbo/monthly-trend', error: err, statusCode: 502 });
    if (err.needsReconnect) return res.status(200).json({ connected: true, needsReconnect: true, error: String(err.message || err) });
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
