// ============================================
// Jovelin — Revenue
// ============================================
// The revenue portion of a P&L: Invoiced and Cash Collected for a toggleable
// period (MTD / Last Month / QTD / YTD), vs. the identical calendar range
// one year earlier. Below that, three cross-referenced lists for the
// current period:
//   - Estimates quoted in this period (clickable -> the editor)
//   - Invoices actually in QuickBooks for this period
//   - Time logged in this period for any customer who ALSO shows up in
//     either list above — time against a customer with no estimate or
//     invoice this period isn't shown here, since it's not part of this
//     period's revenue story.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useSignature } from '../utils/useSignature.js';
import { gmailComposeUrl } from '../utils/gmailCompose.js';
import IncomeExpenseChart from '../components/IncomeExpenseChart.jsx';
import BrandingEditor from '../components/BrandingEditor.jsx';
import { StatValue, Skeleton } from '../components/Skeleton.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtHrs = (mins) => `${((mins || 0) / 60).toFixed(1)}h`;

const PERIODS = [
  { key: 'mtd', label: 'Month to Date' },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'qtd', label: 'Quarter to Date' },
  { key: 'ytd', label: 'Year to Date' },
];

const cardStyle = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px' };
const sectionStyle = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 14 };

function ChangeBadge({ pct }) {
  if (pct === null || pct === undefined) return <span style={{ color: SUBTEXT, fontSize: 12 }}>No prior-year data</span>;
  const up = pct >= 0;
  return <span style={{ color: up ? GREEN : RED, fontSize: 13, fontWeight: 700 }}>{up ? '▲' : '▼'} {Math.abs(pct)}% vs prior year</span>;
}

function estimateTotal(est) {
  const defMk = parseFloat(est.default_markup_pct) || 0;
  return (est.estimate_lines || []).reduce((s, l) => {
    const qty = parseFloat(l.qty) || 0, cost = parseFloat(l.contractor_unit_cost) || 0;
    const mk = (l.markup_pct === null || l.markup_pct === undefined) ? defMk : parseFloat(l.markup_pct) || 0;
    const ov = (l.override_unit_price === null || l.override_unit_price === undefined) ? null : parseFloat(l.override_unit_price);
    const price = ov !== null && isFinite(ov) ? ov : cost * (1 + mk / 100);
    return s + qty * price;
  }, 0);
}


export default function Revenue({ onBack, userEmail }) {
  const { currentTenantId, currentTenant } = useTenant();
  const signature = useSignature(userEmail);
  const navigate = useNavigate();
  const [period, setPeriod] = useState('mtd');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [estimates, setEstimates] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [pastDueInvoices, setPastDueInvoices] = useState([]);
  const [customerEmails, setCustomerEmails] = useState({});
  const [jobCosting, setJobCosting] = useState(null);
  const [linkDebug, setLinkDebug] = useState(null);
  const [expandedCustomer, setExpandedCustomer] = useState(null);
  const [taggingKey, setTaggingKey] = useState(null);   // which row's picker is open
  const [tagSaving, setTagSaving] = useState(false);
  const [tagMsg, setTagMsg] = useState('');
  const [qboCustomers, setQboCustomers] = useState([]);
  const [trend, setTrend] = useState(null);
  // Explicit per-source loading flags. A null payload can't be used as the
  // signal, because "loaded and empty" is a real state that must render as
  // zero rather than as a spinner forever.
  const [trendLoading, setTrendLoading] = useState(true);
  const [costingLoading, setCostingLoading] = useState(true);
  const [expenseLinesLoading, setExpenseLinesLoading] = useState(true);
  // Landing by default; 'ar' and 'expenses' are the two drill-downs. The
  // screen previously stacked everything at once, which is what made it
  // unreadable.
  const [section, setSection] = useState(null);

  const [sigDraft, setSigDraft] = useState(null);   // null until edited here
  const [sigSaved, setSigSaved] = useState(true);
  const [showBranding, setShowBranding] = useState(false);

  const effectiveSignature = sigDraft !== null ? sigDraft : signature;

  const saveSignature = async () => {
    const { error } = await supabase.from('user_signatures').upsert(
      { email: userEmail.toLowerCase(), signature: sigDraft ?? '', updated_at: new Date().toISOString() },
      { onConflict: 'email' }
    );
    if (error) { alert('Could not save signature: ' + error.message); return; }
    setSigSaved(true);
  };
  const [expenseLines, setExpenseLines] = useState(null);
  const [openAccount, setOpenAccount] = useState(null); // drill into one P&L account

  // Re-pulls the grouped view and keeps the open account in sync, so a
  // line that was just tagged or ignored updates in place rather than
  // needing a full reload.
  const refreshExpenseLines = async () => {
    try {
      const fresh = await apiFetch(`/api/qbo/expense-lines?tenant_id=${currentTenantId}&period=${period}`).then(r => r.json());
      setExpenseLines(fresh);
      setOpenAccount(prev => prev ? (fresh.accounts || []).find(a => a.accountId === prev.accountId) || null : null);
    } catch (e) { /* leave the current view in place */ }
  };

  const ignoreCost = async (cost) => {
    setTagMsg('');
    try {
      const r = await apiFetch('/api/qbo/ignore-cost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: currentTenantId, cost_key: cost.key, ignored_by: userEmail }),
      }).then(res => res.json());
      if (r.error) { setTagMsg(r.error); return; }
      refreshExpenseLines();
    } catch (e) {
      setTagMsg('Could not ignore that cost: ' + e.message);
    }
  };

  const tagCost = async (cost, customerId) => {
    const customer = qboCustomers.find(c => String(c.id) === String(customerId));
    setTagSaving(true); setTagMsg('');
    try {
      const r = await apiFetch('/api/qbo/tag-cost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: currentTenantId, txnType: cost.txnType, txnId: cost.txnId,
          lineId: cost.lineId, customerId, customerName: customer?.name,
          requested_by: userEmail, payee: cost.payee, amount: cost.amount,
        }),
      }).then(res => res.json());
      if (r.queued) {
        setTagMsg('Sent for review — nothing has changed in QuickBooks yet. It\u2019s waiting in Admin.');
        setTaggingKey(null); setTagSaving(false); return;
      }
      if (!r.tagged) { setTagMsg(r.error || 'Could not tag that cost.'); setTagSaving(false); return; }
      setTagMsg(`Tagged to ${r.customerName || 'customer'} in QuickBooks.`);
      setTaggingKey(null);
      refreshExpenseLines();
    } catch (e) {
      setTagMsg('Could not tag that cost: ' + e.message);
    }
    setTagSaving(false);
  };

  // The N most recent customer-tagged costs, grouped by customer, with each
  // customer's total invoiced revenue alongside. Revenue is that customer's
  // FULL invoiced total, not just the window the costs fall in — the point
  // is "have we billed enough to cover what this customer is costing us,"
  // which a date-clipped revenue number would answer misleadingly.
  // The landing is always "this month" regardless of the period toggle,
  // which now only governs the detail lists inside Expenses.
  const thisMonth = trend?.current || { invoiced: 0, collected: 0, incurred: 0, paid: 0 };
  const pastDueTotal = pastDueInvoices.reduce((s, i) => s + (i.balance || 0), 0);

  const COST_LIMIT = 30;
  const costVsRevenue = useMemo(() => {
    const expenses = jobCosting?.expenses || [];
    if (!expenses.length) return null;
    const recent = expenses.slice(0, COST_LIMIT); // endpoint returns newest-first

    const billedByCustomer = {};
    (jobCosting?.invoices || []).forEach(inv => {
      if (!inv.customerId) return;
      billedByCustomer[inv.customerId] = (billedByCustomer[inv.customerId] || 0) + inv.amount;
    });

    const byCustomer = {};
    recent.forEach(e => {
      if (!byCustomer[e.customerId]) {
        byCustomer[e.customerId] = {
          customerId: e.customerId,
          customerName: e.customerName,
          cost: 0,
          billed: billedByCustomer[e.customerId] || 0,
          items: [],
        };
      }
      byCustomer[e.customerId].cost += e.amount;
      byCustomer[e.customerId].items.push(e);
    });

    const groups = Object.values(byCustomer)
      .sort((a, b) => (b.items[0]?.date || '').localeCompare(a.items[0]?.date || ''));

    return {
      groups,
      costCount: recent.length,
      totalCost: recent.reduce((s, e) => s + e.amount, 0),
      totalBilled: groups.reduce((s, g) => s + g.billed, 0),
    };
  }, [jobCosting]);

  useEffect(() => {
    if (!currentTenantId) return;
    // Sequential, not Promise.all. Each of these runs several QuickBooks
    // queries of its own, and firing them together was enough to trip
    // Intuit's rate limit on a busy company — the whole screen would then
    // fail at once. Slower to fill in, but it actually loads.
    (async () => {
      const get = (url, fallback) => apiFetch(url).then(r => r.json()).catch(() => fallback);

      const summary = await get(`/api/qbo/summary?tenant_id=${currentTenantId}`, {});
      setPastDueInvoices(summary.pastDueInvoices || []);
      setLinkDebug(summary.linkDebug || null);

      const lists = await get(`/api/qbo/lists?tenant_id=${currentTenantId}`, { customers: [] });
      const emailMap = {};
      (lists.customers || []).forEach(c => { emailMap[c.id] = c.email; });
      setCustomerEmails(emailMap);
      setQboCustomers(lists.customers || []);

      setTrend(await get(`/api/qbo/monthly-trend?tenant_id=${currentTenantId}&months=6`, null));
      setTrendLoading(false);

      setJobCosting(await get(`/api/qbo/job-costing?tenant_id=${currentTenantId}`, null));
      setCostingLoading(false);
    })();
  }, [currentTenantId]);

  useEffect(() => {
    if (!currentTenantId) return;
    setExpenseLinesLoading(true);
    apiFetch(`/api/qbo/expense-lines?tenant_id=${currentTenantId}&period=${period}`)
      .then(r => r.json()).then(setExpenseLines)
      .catch(() => setExpenseLines(null))
      .finally(() => setExpenseLinesLoading(false));
  }, [currentTenantId, period]);

  useEffect(() => {
    if (!currentTenantId) return;
    setLoading(true);
    apiFetch(`/api/qbo/revenue?tenant_id=${currentTenantId}&period=${period}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ connected: false, error: 'Could not reach revenue endpoint' }))
      .finally(() => setLoading(false));
  }, [currentTenantId, period]);

  useEffect(() => {
    if (!currentTenantId || !data?.range) return;
    setDetailLoading(true);
    (async () => {
      const [estRes, teRes] = await Promise.all([
        supabase.from('estimates')
          .select('id, est_no, project, status, qbo_customer_id, local_customer_id, qbo_customer_name, quote_date, default_markup_pct, estimate_lines(qty, contractor_unit_cost, markup_pct, override_unit_price)')
          .eq('tenant_id', currentTenantId).gte('quote_date', data.range.start).lte('quote_date', data.range.end),
        supabase.from('time_entries')
          .select('id, qbo_customer_id, local_customer_id, qbo_customer_name, total_minutes, work_date, notes, disposition')
          .eq('tenant_id', currentTenantId).gte('work_date', data.range.start).lte('work_date', data.range.end),
      ]);
      setEstimates(estRes.data || []);
      setTimeEntries(teRes.data || []);
      setDetailLoading(false);
    })();
  }, [currentTenantId, data?.range]);

  // Customers with an estimate or invoice THIS period — time against anyone
  // else isn't part of this period's revenue story, so it's left out.
  const activeCustomerIds = new Set([
    ...(data?.invoices || []).map(i => i.customerId).filter(Boolean),
    ...estimates.map(e => e.qbo_customer_id).filter(Boolean),
  ]);
  const activeLocalCustomerIds = new Set(estimates.map(e => e.local_customer_id).filter(Boolean));
  const relevantTime = timeEntries.filter(t =>
    (t.qbo_customer_id && activeCustomerIds.has(t.qbo_customer_id)) ||
    (t.local_customer_id && activeLocalCustomerIds.has(t.local_customer_id))
  );

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 , flexWrap: 'wrap'}}>
          <button onClick={() => section ? setSection(null) : onBack?.()}
            style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: TEXT }}>
            ← {section ? 'Revenue' : 'Back'}
          </button>
          <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: 0 }}>
            {section === 'expenses' ? 'Expenses' : 'Revenue'}
          </h1>
          <span style={{ color: SUBTEXT, fontSize: 14, fontWeight: 600 }}>{currentTenant?.name}</span>
        </div>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 18 }}>
          {section === 'expenses'
            ? 'What jobs are costing, and costs still missing a customer.'
            : 'This month at a glance.'}
        </p>

        {/* The period toggle only applies to the detail lists, which live
            inside the sections — the landing is always this month. */}
        {section === 'expenses' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} style={{
                background: period === p.key ? TEAL : CARD, color: period === p.key ? '#fff' : TEXT,
                border: `1px solid ${period === p.key ? TEAL : BORDER}`, borderRadius: 20,
                padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>{p.label}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
        ) : data?.connected === false ? (
          <div style={{ ...cardStyle, textAlign: 'center' }}>
            <div style={{ color: TEXT, fontSize: 14 }}>{currentTenant?.name} isn't connected to QuickBooks yet.</div>
          </div>
        ) : data?.error ? (
          <div style={{ ...cardStyle, color: RED, fontSize: 13 }}>Couldn't load revenue: {data.error}</div>
        ) : (
          <>
            {/* ── LANDING ─────────────────────────────────────────── */}
            {!section && (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                  <div style={{ ...cardStyle, flex: '1 1 240px' }}>
                    <div style={{ color: SUBTEXT, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Revenue Earned — This Month</div>
                    <div style={{ color: TEAL, fontSize: 32, fontWeight: 800, margin: '8px 0 4px' }}>
                      <StatValue loading={trendLoading} width={130} height={34}>{fmt(thisMonth.invoiced)}</StatValue>
                    </div>
                    <div style={{ color: SUBTEXT, fontSize: 12 }}>
                      <StatValue loading={trendLoading} width={90} height={14}>{fmt(thisMonth.collected)} collected</StatValue>
                    </div>
                  </div>
                  <div style={{ ...cardStyle, flex: '1 1 240px' }}>
                    <div style={{ color: SUBTEXT, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Expenses Incurred — This Month</div>
                    <div style={{ color: AMBER, fontSize: 32, fontWeight: 800, margin: '8px 0 4px' }}>
                      <StatValue loading={trendLoading} width={130} height={34}>{fmt(thisMonth.incurred)}</StatValue>
                    </div>
                    <div style={{ color: SUBTEXT, fontSize: 12 }}>
                      <StatValue loading={trendLoading} width={140} height={14}>
                        {fmt(thisMonth.paid)} cash out
                        {thisMonth.paid > thisMonth.incurred ? ' (incl. older bills)' : ''}
                      </StatValue>
                    </div>
                  </div>
                  <div style={{ ...cardStyle, flex: '1 1 200px' }}>
                    <div style={{ color: SUBTEXT, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Net This Month</div>
                    <div style={{ color: thisMonth.invoiced - thisMonth.incurred >= 0 ? GREEN : RED, fontSize: 32, fontWeight: 800, margin: '8px 0 4px' }}>
                      <StatValue loading={trendLoading} width={130} height={34}>{fmt(thisMonth.invoiced - thisMonth.incurred)}</StatValue>
                    </div>
                    <div style={{ color: SUBTEXT, fontSize: 12 }}>invoiced less expenses</div>
                  </div>
                </div>

                {(trendLoading || trend?.series?.length > 0) && (
                  <div style={{ ...cardStyle, marginBottom: 16 }}>
                    <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Income vs Expenses</div>
                    <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12 }}>
                      Last 6 months. <b>Billed to us</b> is cost incurred that month; <b>cash out</b> is money that
                      actually left, including payments against bills from earlier months — so the two rarely match.
                    </div>
                    {trendLoading
                      ? <div style={{ height: 200, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '0 4px' }}>
                          {/* Bars of differing heights so this reads as a chart
                              arriving, not as data showing every month at zero. */}
                          {[60, 120, 90, 150, 110, 80].map((h, i) => <Skeleton key={i} width="100%" height={h} />)}
                        </div>
                      : <IncomeExpenseChart series={trend.series} height={200} />}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {/* Chasing an unpaid invoice is collections, not reporting, so
                      the detail lives in Billing. This stays as a headline
                      figure with a route to where the work happens. */}
                  <div onClick={() => navigate('/billing')} style={{ ...cardStyle, flex: '1 1 260px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ color: RED, fontWeight: 700, fontSize: 14 }}>Accounts Receivable</div>
                      <span style={{ color: SUBTEXT, fontSize: 18 }}>›</span>
                    </div>
                    <div style={{ color: RED, fontSize: 26, fontWeight: 800, margin: '6px 0 2px' }}>
                      <StatValue loading={loading} width={110} height={28}>{fmt(pastDueTotal)}</StatValue>
                    </div>
                    <div style={{ color: SUBTEXT, fontSize: 12 }}>
                      <StatValue loading={loading} width={150} height={14}>
                        {pastDueInvoices.length} past due · chase in Billing
                      </StatValue>
                    </div>
                  </div>

                  <div onClick={() => setSection('expenses')} style={{ ...cardStyle, flex: '1 1 260px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ color: AMBER, fontWeight: 700, fontSize: 14 }}>Expenses</div>
                      <span style={{ color: SUBTEXT, fontSize: 18 }}>›</span>
                    </div>
                    <div style={{ color: AMBER, fontSize: 26, fontWeight: 800, margin: '6px 0 2px' }}>
                      <StatValue loading={trendLoading} width={110} height={28}>{fmt(thisMonth.incurred)}</StatValue>
                    </div>
                    <div style={{ color: SUBTEXT, fontSize: 12 }}>
                      <StatValue loading={expenseLinesLoading} width={140} height={14}>
                        {expenseLines?.totalUntagged > 0 ? `${expenseLines.totalUntagged} with no customer` : 'all costs tagged to a customer'}
                      </StatValue>
                    </div>
                  </div>
                </div>
              </>
            )}

            {section === 'expenses' && costVsRevenue && costVsRevenue.groups.length > 0 && (
              <div style={sectionStyle}>
                <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Customer Costs vs Billed Revenue</div>
                <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12 }}>
                  The {costVsRevenue.costCount} most recent costs tagged to a customer in QuickBooks (bills and expenses),
                  grouped by customer, against everything invoiced to those same customers. Costs with no customer tag in
                  QuickBooks aren't attributable to a job, so they're not counted here.
                </div>

                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${BORDER}` }}>
                  <div>
                    <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Costs Shown</div>
                    <div style={{ color: AMBER, fontSize: 20, fontWeight: 800 }}>{fmt(costVsRevenue.totalCost)}</div>
                  </div>
                  <div>
                    <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Billed to Those Customers</div>
                    <div style={{ color: TEAL, fontSize: 20, fontWeight: 800 }}>{fmt(costVsRevenue.totalBilled)}</div>
                  </div>
                  <div>
                    <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Net</div>
                    <div style={{ color: costVsRevenue.totalBilled - costVsRevenue.totalCost >= 0 ? GREEN : RED, fontSize: 20, fontWeight: 800 }}>
                      {fmt(costVsRevenue.totalBilled - costVsRevenue.totalCost)}
                    </div>
                  </div>
                </div>

                {costVsRevenue.groups.map(g => {
                  const net = g.billed - g.cost;
                  const open = expandedCustomer === g.customerId;
                  return (
                    <div key={g.customerId} style={{ borderBottom: `1px solid ${BORDER}`, padding: '8px 0' }}>
                      <div onClick={() => setExpandedCustomer(open ? null : g.customerId)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: TEXT, fontWeight: 600, fontSize: 13 }}>
                            {open ? '▾' : '▸'} {g.customerName || 'Unknown customer'}
                          </div>
                          <div style={{ color: SUBTEXT, fontSize: 11 }}>
                            {g.items.length} cost{g.items.length === 1 ? '' : 's'} · most recent {g.items[0]?.date || '—'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 16, flexShrink: 0, textAlign: 'right' }}>
                          <div>
                            <div style={{ color: SUBTEXT, fontSize: 10 }}>Cost</div>
                            <div style={{ color: AMBER, fontWeight: 700, fontSize: 13 }}>{fmt(g.cost)}</div>
                          </div>
                          <div>
                            <div style={{ color: SUBTEXT, fontSize: 10 }}>Billed</div>
                            <div style={{ color: TEAL, fontWeight: 700, fontSize: 13 }}>{fmt(g.billed)}</div>
                          </div>
                          <div>
                            <div style={{ color: SUBTEXT, fontSize: 10 }}>Net</div>
                            <div style={{ color: net >= 0 ? GREEN : RED, fontWeight: 800, fontSize: 13 }}>{fmt(net)}</div>
                          </div>
                        </div>
                      </div>

                      {open && (
                        <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: `2px solid ${BORDER}` }}>
                          {g.items.map(it => (
                            <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '5px 0', fontSize: 12 }}>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ color: TEXT }}>{it.payee || 'No payee'}</span>
                                <span style={{
                                  fontSize: 9, fontWeight: 700, marginLeft: 6, padding: '1px 6px', borderRadius: 8,
                                  background: it.source === 'Bill' ? '#eef2ff' : '#fef3c7',
                                  color: it.source === 'Bill' ? '#3730a3' : '#92400e',
                                }}>{it.source}</span>
                                {it.memo && <div style={{ color: SUBTEXT, fontSize: 11 }}>{it.memo}</div>}
                              </div>
                              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                                <div style={{ color: AMBER, fontWeight: 700 }}>{fmt(it.amount)}</div>
                                <div style={{ color: SUBTEXT, fontSize: 10 }}>{it.date}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {section === 'expenses' && expenseLines?.accounts?.length > 0 && (
              <div style={sectionStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <div style={{ color: TEAL, fontWeight: 700, fontSize: 13 }}>
                    {openAccount ? openAccount.accountName : `Expenses by Account — ${expenseLines.rangeLabel}`}
                  </div>
                  <div style={{ color: AMBER, fontWeight: 800, fontSize: 15 }}>
                    {fmt(openAccount ? openAccount.total : expenseLines.grandTotal)}
                  </div>
                </div>

                {!openAccount ? (
                  <>
                    <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12 }}>
                      Grouped the way your P&L reads, biggest first. Click an account for its transactions.
                      {expenseLines.totalUntagged > 0 && ` ${expenseLines.totalUntagged} line${expenseLines.totalUntagged === 1 ? '' : 's'} not yet assigned to a customer.`}
                    </div>
                    {expenseLines.accounts.map(a => (
                      <div key={a.accountId} onClick={() => setOpenAccount(a)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: TEXT, fontWeight: 600, fontSize: 13 }}>{a.accountName}</div>
                          <div style={{ color: SUBTEXT, fontSize: 11 }}>
                            {a.lineCount} transaction{a.lineCount === 1 ? '' : 's'}
                            {a.untaggedCount > 0 && (
                              <span style={{ color: AMBER }}> · {a.untaggedCount} without a customer</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <b style={{ color: TEXT, fontSize: 14 }}>{fmt(a.total)}</b>
                          <span style={{ color: SUBTEXT, fontSize: 16 }}>&rsaquo;</span>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <button onClick={() => { setOpenAccount(null); setTaggingKey(null); }}
                      style={{ background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: '0 0 10px' }}>
                      &lsaquo; All accounts
                    </button>
                    <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 10 }}>
                      Every transaction in this account for the period. Ones without a customer are marked — assigning
                      writes back to QuickBooks, ignoring only hides the prompt here.
                    </div>

                    {tagMsg && (
                      <div style={{
                        background: tagMsg.startsWith('Tagged') ? '#e6f4ea' : tagMsg.startsWith('Sent for review') ? '#fff7ed' : '#fdecea',
                        color: tagMsg.startsWith('Tagged') ? GREEN : tagMsg.startsWith('Sent for review') ? AMBER : RED,
                        borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10,
                      }}>{tagMsg}</div>
                    )}

                    {openAccount.lines.map(c => {
                      const needsCustomer = !c.customerId && !c.ignored;
                      return (
                        <div key={c.key} style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ color: TEXT, fontWeight: 600, fontSize: 13 }}>
                                {c.payee || 'No payee'}
                                <span style={{
                                  fontSize: 9, fontWeight: 700, marginLeft: 6, padding: '1px 6px', borderRadius: 8,
                                  background: c.txnType === 'Bill' ? '#eef2ff' : '#fef3c7',
                                  color: c.txnType === 'Bill' ? '#3730a3' : '#92400e',
                                }}>{c.txnType}</span>
                              </div>
                              <div style={{ fontSize: 11 }}>
                                {c.customerId ? (
                                  <span style={{ color: TEAL, fontWeight: 600 }}>{c.customerName || 'Customer'}</span>
                                ) : c.ignored ? (
                                  <span style={{ color: SUBTEXT }}>No customer · ignored</span>
                                ) : (
                                  <span style={{ color: AMBER }}>No customer yet</span>
                                )}
                                <span style={{ color: SUBTEXT }}>{c.memo ? ` · ${c.memo}` : ''} · {c.date}</span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                              <b style={{ color: TEXT, fontSize: 13 }}>{fmt(c.amount)}</b>
                              {needsCustomer && taggingKey !== c.key && (
                                <>
                                  <button onClick={() => { setTaggingKey(c.key); setTagMsg(''); }}
                                    style={{ background: 'none', border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                    Assign
                                  </button>
                                  <button onClick={() => ignoreCost(c)} title="Hide the prompt — nothing is sent to QuickBooks"
                                    style={{ background: 'none', border: `1px solid ${BORDER}`, color: SUBTEXT, borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                    Ignore
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {taggingKey === c.key && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                              <select autoFocus disabled={tagSaving} defaultValue=""
                                onChange={e => { if (e.target.value) tagCost(c, e.target.value); }}
                                style={{ flex: '1 1 200px', padding: '8px 10px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', color: TEXT }}>
                                <option value="">{tagSaving ? 'Saving to QuickBooks…' : '— pick a customer —'}</option>
                                {qboCustomers.map(cust => <option key={cust.id} value={cust.id}>{cust.name}</option>)}
                              </select>
                              <button onClick={() => setTaggingKey(null)} disabled={tagSaving}
                                style={{ background: 'none', border: `1px solid ${BORDER}`, color: SUBTEXT, borderRadius: 8, padding: '0 12px', cursor: 'pointer' }}>&#10005;</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {section === 'expenses' && (detailLoading ? (
              <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading detail…</div>
            ) : (
              <>
                {/* Estimates quoted this period */}
                <div style={sectionStyle}>
                  <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Estimates ({PERIODS.find(p => p.key === period)?.label})</div>
                  {estimates.length === 0 && <div style={{ color: SUBTEXT, fontSize: 13 }}>No estimates quoted in this period.</div>}
                  {estimates.map(e => (
                    <div key={e.id} onClick={() => navigate(`/estimates/${e.id}?tab=rollup`)} style={{
                      display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${BORDER}`,
                      fontSize: 13, cursor: 'pointer',
                    }}>
                      <span style={{ color: TEXT }}>{e.est_no} {e.qbo_customer_name ? `— ${e.qbo_customer_name}` : ''} <span style={{ color: SUBTEXT, fontSize: 11 }}>· {e.status}</span></span>
                      <b style={{ color: TEAL }}>{fmt(estimateTotal(e))}</b>
                    </div>
                  ))}
                </div>

                {/* Invoices this period, from QBO */}
                <div style={sectionStyle}>
                  <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Invoices ({PERIODS.find(p => p.key === period)?.label})</div>
                  {(data.invoices || []).length === 0 && <div style={{ color: SUBTEXT, fontSize: 13 }}>No invoices in this period.</div>}
                  {(data.invoices || []).map(inv => (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 13 }}>
                      <span style={{ color: TEXT }}>{inv.docNumber ? `#${inv.docNumber} ` : ''}{inv.customerName || 'Unknown customer'} <span style={{ color: SUBTEXT, fontSize: 11 }}>· {inv.date}</span></span>
                      <b style={{ color: TEAL }}>{fmt(inv.amount)}</b>
                    </div>
                  ))}
                </div>

                {/* Time logged for customers with an estimate or invoice this period */}
                <div style={sectionStyle}>
                  <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Time Logged (same customers)</div>
                  <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 10 }}>Only hours logged for a customer who also has an estimate or invoice above.</div>
                  {relevantTime.length === 0 && <div style={{ color: SUBTEXT, fontSize: 13 }}>No matching time entries in this period.</div>}
                  {relevantTime.map(t => (
                    <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 13 }}>
                      <span style={{ color: TEXT }}>{t.qbo_customer_name || 'Customer'} <span style={{ color: SUBTEXT, fontSize: 11 }}>· {t.work_date}{t.notes ? ` · ${t.notes}` : ''}</span></span>
                      <b style={{ color: AMBER }}>{fmtHrs(t.total_minutes)}</b>
                    </div>
                  ))}
                </div>
              </>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
