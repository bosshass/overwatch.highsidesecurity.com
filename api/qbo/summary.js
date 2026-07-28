// ============================================
// Jovelin — QBO financial summary (for Command Center)
// GET /api/qbo/summary?tenant_id=...
// ============================================
import { getSupabase, getValidConnection, qboQuery, qboBaseUrl, logQboError } from './_client.js';
import { requireCaller } from '../_auth.js';

function daysOverdue(dueDate) {
  if (!dueDate) return 0;
  const diff = (Date.now() - new Date(dueDate).getTime()) / 86400000;
  return Math.floor(diff);
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
    if (!conn) return res.status(200).json({ connected: false });

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const monthStartStr = monthStart.toISOString().slice(0, 10);

    const [companyResp, openInvResp, paidThisMonthResp, paymentResp] = await Promise.all([
      qboQuery(conn.realm_id, conn.access_token, 'SELECT * FROM CompanyInfo'),
      qboQuery(conn.realm_id, conn.access_token, "SELECT Id, DocNumber, Balance, TotalAmt, CustomerRef, DueDate, TxnDate FROM Invoice WHERE Balance > '0' MAXRESULTS 1000"),
      qboQuery(conn.realm_id, conn.access_token, `SELECT Id, TotalAmt, TxnDate FROM Invoice WHERE TxnDate >= '${monthStartStr}' MAXRESULTS 1000`),
      qboQuery(conn.realm_id, conn.access_token, `SELECT Id, TotalAmt, TxnDate, CustomerRef FROM Payment WHERE TxnDate >= '${monthStartStr}' ORDERBY TxnDate DESC MAXRESULTS 10`),
    ]);

    const company = companyResp.CompanyInfo?.[0];
    const openInvoices = openInvResp.Invoice || [];
    const invoicedThisMonth = paidThisMonthResp.Invoice || [];
    const payments = paymentResp.Payment || [];

    const totalAR = openInvoices.reduce((s, inv) => s + (parseFloat(inv.Balance) || 0), 0);
    const pastDue = openInvoices.filter(inv => daysOverdue(inv.DueDate) > 0);
    const pastDueTotal = pastDue.reduce((s, inv) => s + (parseFloat(inv.Balance) || 0), 0);

    // The public "view/pay this invoice" link — the same one QuickBooks
    // emails to customers, requiring no QBO login. It's only returned when
    // an invoice is fetched individually with include=invoiceLink; it does
    // NOT come back on a bulk query, so each past-due invoice needs its own
    // read. Capped and batched to stay clear of Intuit's rate limit, and
    // any individual failure just yields a null link rather than taking the
    // whole A/R screen down.
    // Each link costs its own API read, so this is opt-in via ?links=1 and
    // only the A/R screen asks. Loading Revenue used to spend ~60 calls on
    // links nobody was looking at, which is what pushed a tenant into
    // Intuit's throttle. Batches are small and spaced for the same reason.
    const wantLinks = req.query.links === '1';
    const LINK_CAP = 40;
    const BATCH = 5;
    const sortedPastDue = pastDue
      .map(inv => ({
        id: inv.Id, docNumber: inv.DocNumber, customerId: inv.CustomerRef?.value || null,
        customerName: inv.CustomerRef?.name || null, balance: parseFloat(inv.Balance) || 0,
        dueDate: inv.DueDate, daysOverdue: daysOverdue(inv.DueDate), invoiceLink: null,
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Intuit's own docs and community posts disagree on the casing of this
    // field ('invoiceLink' vs 'InvoiceLink'), so accept either rather than
    // bet on one. linkDebug records what actually came back when no link is
    // found — field names only, never values — so a missing link can be
    // diagnosed from the response instead of guessed at.
    let linkDebug = null;
    const fetchLink = async (inv) => {
      try {
        const url = `${qboBaseUrl()}/v3/company/${conn.realm_id}/invoice/${inv.id}?minorversion=75&include=invoiceLink`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${conn.access_token}`, Accept: 'application/json' } });
        if (!r.ok) {
          if (!linkDebug) linkDebug = { status: r.status, note: 'invoice read failed' };
          return inv;
        }
        const d = await r.json();
        const invoiceObj = d?.Invoice || {};
        const link = invoiceObj.invoiceLink || invoiceObj.InvoiceLink || null;
        if (!link && !linkDebug) {
          linkDebug = {
            status: r.status,
            note: 'read succeeded but no link field present',
            fieldsReturned: Object.keys(invoiceObj).sort(),
          };
        }
        return { ...inv, invoiceLink: link };
      } catch (e) {
        if (!linkDebug) linkDebug = { note: 'exception', message: String(e?.message || e) };
        return inv;
      }
    };

    let pastDueWithLinks = sortedPastDue;
    if (wantLinks) {
      const withLinks = [];
      for (let i = 0; i < sortedPastDue.length && i < LINK_CAP; i += BATCH) {
        withLinks.push(...await Promise.all(sortedPastDue.slice(i, i + BATCH).map(fetchLink)));
        if (i + BATCH < Math.min(sortedPastDue.length, LINK_CAP)) await new Promise(r => setTimeout(r, 120));
      }
      withLinks.push(...sortedPastDue.slice(withLinks.length));
      pastDueWithLinks = withLinks;
    }

    // Aging buckets, by days past due
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    openInvoices.forEach(inv => {
      const bal = parseFloat(inv.Balance) || 0;
      const days = daysOverdue(inv.DueDate);
      if (days <= 0) buckets.current += bal;
      else if (days <= 30) buckets.d30 += bal;
      else if (days <= 60) buckets.d60 += bal;
      else if (days <= 90) buckets.d90 += bal;
      else buckets.d90plus += bal;
    });

    const invoicedTotal = invoicedThisMonth.reduce((s, inv) => s + (parseFloat(inv.TotalAmt) || 0), 0);
    const cashCollectedMTD = payments.reduce((s, p) => s + (parseFloat(p.TotalAmt) || 0), 0);

    return res.status(200).json({
      connected: true,
      environment: process.env.QBO_ENV || 'sandbox',
      companyName: company?.CompanyName || null,
      totalAR: Math.round(totalAR * 100) / 100,
      openInvoiceCount: openInvoices.length,
      pastDueTotal: Math.round(pastDueTotal * 100) / 100,
      pastDueCount: pastDue.length,
      cashCollectedMTD: Math.round(cashCollectedMTD * 100) / 100,
      invoicedMTD: Math.round(invoicedTotal * 100) / 100,
      aging: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      recentPayments: payments.map(p => ({
        id: p.Id, amount: parseFloat(p.TotalAmt) || 0, date: p.TxnDate, customer: p.CustomerRef?.name || null,
      })),
      pastDueInvoices: pastDueWithLinks,
      linkDebug, // null once links resolve; populated when they don't
    });
  } catch (err) {
    await logQboError(supabase, { tenantId, endpoint: '/api/qbo/summary', error: err, statusCode: 502 });
    if (err.needsReconnect) return res.status(200).json({ connected: true, needsReconnect: true, error: String(err.message || err) });
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
