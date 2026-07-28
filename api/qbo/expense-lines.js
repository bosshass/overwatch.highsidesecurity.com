// ============================================
// Jovelin — Expense lines grouped by P&L account
// GET /api/qbo/expense-lines?tenant_id=...&period=mtd|lastmonth|qtd|ytd
// ============================================
// Every expense line for the period, grouped the way a P&L reads it —
// Contractors, Meals, Payroll, and so on — rather than as one flat list.
//
// Deliberately returns BOTH tagged and untagged lines. Showing only the
// untagged ones (the earlier behaviour) meant you could never see an
// account in full, or tell whether "3 with no customer" was 3 out of 4 or
// 3 out of 400. Missing-customer is surfaced as a count per account and a
// flag per line, not by hiding everything else.
//
// Only accounts QuickBooks itself classifies as 'Expense' are included,
// which is what keeps transfers and credit card payments out — they post
// to Bank / Credit Card / liability accounts.
import { getSupabase, getValidConnection, qboQuery, logQboError, withCache } from './_client.js';
import { requireCaller } from '../_auth.js';

const toISODate = (d) => d.toISOString().slice(0, 10);

function getPeriodRange(period, now = new Date()) {
  const year = now.getFullYear(), month = now.getMonth();
  if (period === 'lastmonth') return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0), label: 'Last Month' };
  if (period === 'qtd') return { start: new Date(year, Math.floor(month / 3) * 3, 1), end: now, label: 'Quarter to Date' };
  if (period === 'ytd') return { start: new Date(year, 0, 1), end: now, label: 'Year to Date' };
  return { start: new Date(year, month, 1), end: now, label: 'Month to Date' };
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
    if (!conn) return res.status(200).json({ connected: false, accounts: [] });

    const range = getPeriodRange(period);
    const startStr = toISODate(range.start), endStr = toISODate(range.end);
    const dateFilter = `WHERE TxnDate >= '${startStr}' AND TxnDate <= '${endStr}'`;

    const fresh = req.query.fresh === '1';
    const cached = await withCache(supabase, tenantId, `expense-lines:${period}`, 300, async () => {
    const [acctResp, purchaseResp, billResp] = await Promise.all([
      qboQuery(conn.realm_id, conn.access_token, 'SELECT Id, Name, Classification, AccountType FROM Account MAXRESULTS 1000'),
      qboQuery(conn.realm_id, conn.access_token, `SELECT * FROM Purchase ${dateFilter} ORDER BY TxnDate DESC MAXRESULTS 1000`),
      qboQuery(conn.realm_id, conn.access_token, `SELECT * FROM Bill ${dateFilter} ORDER BY TxnDate DESC MAXRESULTS 1000`),
    ]);

    const acctById = {};
    (acctResp.Account || []).forEach(a => {
      acctById[a.Id] = { id: a.Id, name: a.Name, classification: a.Classification, type: a.AccountType };
    });

    const lines = [];
    const collect = (txn, { txnType, payeeName }) => {
      (txn.Line || []).forEach((line, idx) => {
        const acctDetail = line.AccountBasedExpenseLineDetail;
        const itemDetail = line.ItemBasedExpenseLineDetail;
        const detail = acctDetail || itemDetail;
        if (!detail) return;

        // Account-based lines must post to an Expense-classified account.
        // Item-based lines are purchases of goods/services and are grouped
        // under the item name, since QBO doesn't expose their expense
        // account on the line itself.
        let accountId, accountName;
        if (acctDetail) {
          const acct = acctById[acctDetail.AccountRef?.value];
          if (!acct || acct.classification !== 'Expense') return;
          accountId = acct.id;
          accountName = acct.name;
        } else {
          accountId = `item:${itemDetail.ItemRef?.value || 'unknown'}`;
          accountName = itemDetail.ItemRef?.name || 'Items';
        }

        const amount = parseFloat(line.Amount) || 0;
        if (!amount) return;

        lines.push({
          key: `${txnType}:${txn.Id}:${line.Id || idx}`,
          txnType,
          txnId: String(txn.Id),
          lineId: line.Id != null ? String(line.Id) : null,
          accountId, accountName,
          date: txn.TxnDate,
          amount,
          payee: payeeName || null,
          memo: line.Description || null,
          customerId: detail.CustomerRef?.value ? String(detail.CustomerRef.value) : null,
          customerName: detail.CustomerRef?.name || null,
          billableStatus: detail.BillableStatus || null,
        });
      });
    };

    (purchaseResp.Purchase || []).forEach(p => collect(p, { txnType: 'Purchase', payeeName: p.EntityRef?.name }));
    (billResp.Bill || []).forEach(b => collect(b, { txnType: 'Bill', payeeName: b.VendorRef?.name }));

    // Ignored lines still count toward the account total — they're real
    // spend — but aren't nagged about as missing a customer.
    const { data: ignoredRows } = await supabase.from('ignored_costs')
      .select('cost_key').eq('tenant_id', tenantId);
    const ignored = new Set((ignoredRows || []).map(r => r.cost_key));

    const byAccount = {};
    lines.forEach(l => {
      if (!byAccount[l.accountId]) {
        byAccount[l.accountId] = {
          accountId: l.accountId, accountName: l.accountName,
          total: 0, lineCount: 0, untaggedCount: 0, untaggedAmount: 0, lines: [],
        };
      }
      const g = byAccount[l.accountId];
      const isIgnored = ignored.has(l.key);
      g.total += l.amount;
      g.lineCount += 1;
      if (!l.customerId && !isIgnored) { g.untaggedCount += 1; g.untaggedAmount += l.amount; }
      g.lines.push({ ...l, ignored: isIgnored });
    });

    const accounts = Object.values(byAccount)
      .map(g => ({ ...g, lines: g.lines.sort((a, b) => (b.date || '').localeCompare(a.date || '')) }))
      .sort((a, b) => b.total - a.total); // biggest spend first, like a P&L

      return {
        connected: true,
        period, rangeLabel: range.label, start: startStr, end: endStr,
        accounts,
        grandTotal: lines.reduce((s, l) => s + l.amount, 0),
        totalUntagged: accounts.reduce((s, a) => s + a.untaggedCount, 0),
      };
    }, { fresh });
    return res.status(200).json(cached);
  } catch (err) {
    await logQboError(supabase, { tenantId, endpoint: '/api/qbo/expense-lines', error: err, statusCode: 502 });
    if (err.needsReconnect) return res.status(200).json({ connected: true, needsReconnect: true, error: String(err.message || err) });
    return res.status(502).json({ connected: true, error: String(err.message || err) });
  }
}
