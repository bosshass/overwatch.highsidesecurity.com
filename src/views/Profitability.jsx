// ============================================
// Jovelin — Profitability by customer
// ============================================
// Answers a different question from Revenue. Revenue asks "what did we
// bill." This asks "which customers actually make us money" — invoiced
// revenue against costs tagged to that customer, with hours logged
// alongside so a job that looks profitable on paper but ate two weeks of
// labour is visible as such.
//
// Assembled from data that already exists rather than a new endpoint:
// job-costing supplies QuickBooks invoices and customer-tagged expenses,
// and time_entries supplies hours. Grouped by QuickBooks customer id,
// which is the only identifier all three share.
//
// IMPORTANT ABOUT WHAT'S COUNTED: only expenses TAGGED to a customer in
// QuickBooks appear here. Untagged costs are real spend but can't be
// attributed, so a customer with untagged expenses looks more profitable
// than they are. The banner says so, and links to where they get tagged.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const fmtExact = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const cardStyle = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' };

const PERIODS = [
  { key: 'mtd', label: 'Month to Date' },
  { key: 'qtd', label: 'Quarter to Date' },
  { key: 'ytd', label: 'Year to Date' },
  { key: 'all', label: 'All Time' },
];

function periodStart(key) {
  const now = new Date();
  if (key === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (key === 'qtd') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  if (key === 'ytd') return new Date(now.getFullYear(), 0, 1);
  return null; // all time
}

const SORTS = [
  { key: 'profit', label: 'Profit' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'margin', label: 'Margin %' },
  { key: 'hours', label: 'Hours' },
];

export default function Profitability({ onBack }) {
  const { currentTenantId, currentTenant } = useTenant();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('ytd');
  const [sortBy, setSortBy] = useState('profit');
  const [costing, setCosting] = useState(null);
  const [timeEntries, setTimeEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [nonce, setNonce] = useState(0);   // bump to force a refetch

  useEffect(() => {
    if (!currentTenantId) return;
    setLoading(true);
    // Sequential rather than parallel — job-costing runs three QuickBooks
    // queries and piling requests on is what trips Intuit's rate limit.
    (async () => {
      // nonce > 0 means the user pressed Refresh, so bypass the cache —
      // otherwise the button would just re-serve the same cached copy.
      const c = await apiFetch(`/api/qbo/job-costing?tenant_id=${currentTenantId}${nonce ? '&fresh=1' : ''}`)
        .then(r => r.json()).catch(() => null);
      const t = await supabase.from('time_entries')
        .select('qbo_customer_id, qbo_customer_name, total_minutes, work_date, disposition, logged_by, tech_email, notes')
        .eq('tenant_id', currentTenantId);
      setCosting(c);
      setTimeEntries(t?.data || []);
      setLoading(false);
    })();
  }, [currentTenantId, nonce]);

  const rows = useMemo(() => {
    if (!costing) return [];
    const start = periodStart(period);
    const inRange = (d) => !start || (d && new Date(d + 'T00:00:00') >= start);

    const byCustomer = {};
    const touch = (id, name) => {
      if (!byCustomer[id]) {
        byCustomer[id] = {
          customerId: id, customerName: name || 'Unknown customer',
          revenue: 0, cost: 0, minutes: 0,
          invoices: [], expenses: [], entries: [],
        };
      }
      if (name && byCustomer[id].customerName === 'Unknown customer') byCustomer[id].customerName = name;
      return byCustomer[id];
    };

    (costing.invoices || []).forEach(inv => {
      if (!inv.customerId || !inRange(inv.date)) return;
      const g = touch(inv.customerId, inv.customerName);
      g.revenue += inv.amount;
      g.invoices.push(inv);
    });

    (costing.expenses || []).forEach(ex => {
      if (!ex.customerId || !inRange(ex.date)) return;
      const g = touch(ex.customerId, ex.customerName);
      g.cost += ex.amount;
      g.expenses.push(ex);
    });

    timeEntries.forEach(te => {
      if (!te.qbo_customer_id || !inRange(te.work_date)) return;
      const g = touch(te.qbo_customer_id, te.qbo_customer_name);
      g.minutes += te.total_minutes || 0;
      g.entries.push(te);
    });

    const list = Object.values(byCustomer).map(g => {
      const profit = g.revenue - g.cost;
      return {
        ...g,
        hours: g.minutes / 60,
        profit,
        // Margin is meaningless without revenue — a customer with cost and
        // no invoices isn't "-100% margin", it's un-billed, so leave it null
        // rather than print a number that invites the wrong conclusion.
        margin: g.revenue > 0 ? (profit / g.revenue) * 100 : null,
      };
    });

    return list.sort((a, b) => {
      if (sortBy === 'margin') {
        if (a.margin === null) return 1;
        if (b.margin === null) return -1;
        return b.margin - a.margin;
      }
      if (sortBy === 'revenue') return b.revenue - a.revenue;
      if (sortBy === 'hours') return b.hours - a.hours;
      return b.profit - a.profit;
    });
  }, [costing, timeEntries, period, sortBy]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    revenue: t.revenue + r.revenue, cost: t.cost + r.cost, hours: t.hours + r.hours,
  }), { revenue: 0, cost: 0, hours: 0 }), [rows]);

  const totalProfit = totals.revenue - totals.cost;
  const totalMargin = totals.revenue > 0 ? (totalProfit / totals.revenue) * 100 : null;
  const effectiveRate = totals.hours > 0 ? totalProfit / totals.hours : null;

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          {onBack && (
            <button onClick={onBack} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: TEXT }}>
              ← Back
            </button>
          )}
          <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: 0 }}>Profitability</h1>
          <span style={{ color: SUBTEXT, fontSize: 14, fontWeight: 600 }}>{currentTenant?.name}</span>
          <button onClick={() => setNonce(n => n + 1)} disabled={loading} title="Re-pull from QuickBooks"
            style={{ marginLeft: 'auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: loading ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, color: TEAL }}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 16 }}>
          What each customer invoiced, what they cost, and the hours that went into them.
        </p>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{
              background: period === p.key ? TEAL : CARD, color: period === p.key ? '#fff' : TEXT,
              border: `1px solid ${period === p.key ? TEAL : BORDER}`, borderRadius: 20,
              padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>{p.label}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 28, color: SUBTEXT }}>Loading…</div>
        ) : costing?.error ? (
          // Without this the screen renders every figure as zero, which
          // reads as "this customer cost nothing" rather than "the data
          // never arrived" — a genuinely misleading way to fail.
          <div style={{ ...cardStyle, padding: 22 }}>
            <div style={{ color: RED, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Couldn't load from QuickBooks</div>
            <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 12 }}>
              These figures would otherwise show as zero, which isn't the same as costing nothing. {costing.error}
            </div>
            <button onClick={() => setNonce(n => n + 1)}
              style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, cursor: 'pointer' }}>
              Try again
            </button>
          </div>
        ) : costing?.connected === false ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 28, color: SUBTEXT }}>
            {currentTenant?.name} isn't connected to QuickBooks yet, so there's no revenue or cost data to work from.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ ...cardStyle, flex: '1 1 170px' }}>
                <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Revenue</div>
                <div style={{ color: TEAL, fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmt(totals.revenue)}</div>
              </div>
              <div style={{ ...cardStyle, flex: '1 1 170px' }}>
                <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Attributed Cost</div>
                <div style={{ color: AMBER, fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmt(totals.cost)}</div>
              </div>
              <div style={{ ...cardStyle, flex: '1 1 170px' }}>
                <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gross Profit</div>
                <div style={{ color: totalProfit >= 0 ? GREEN : RED, fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmt(totalProfit)}</div>
                <div style={{ color: SUBTEXT, fontSize: 11 }}>{totalMargin === null ? 'no revenue yet' : `${totalMargin.toFixed(1)}% margin`}</div>
              </div>
              <div style={{ ...cardStyle, flex: '1 1 170px' }}>
                <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Hours Logged</div>
                <div style={{ color: TEXT, fontSize: 26, fontWeight: 800, marginTop: 6 }}>{totals.hours.toFixed(1)}</div>
                <div style={{ color: SUBTEXT, fontSize: 11 }}>
                  {effectiveRate === null ? 'no hours logged' : `${fmtExact(effectiveRate)} profit per hour`}
                </div>
              </div>
            </div>

            <div style={{ background: '#fff7ed', border: `1px solid #fde68a`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
              Only costs tagged to a customer in QuickBooks are counted here. Anything untagged is real spend that can't be
              attributed, so those customers look better than they are.{' '}
              <span onClick={() => navigate('/revenue')} style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 700 }}>
                Tag costs under Revenue → Expenses
              </span>.
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ color: SUBTEXT, fontSize: 12 }}>Sort by</span>
              {SORTS.map(s => (
                <button key={s.key} onClick={() => setSortBy(s.key)} style={{
                  background: sortBy === s.key ? TEAL : 'none', color: sortBy === s.key ? '#fff' : TEAL,
                  border: `1px solid ${TEAL}`, borderRadius: 16, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>{s.label}</button>
              ))}
            </div>

            {rows.length === 0 ? (
              <div style={{ ...cardStyle, color: SUBTEXT, fontSize: 13 }}>
                Nothing to show for this period — no invoices, tagged costs, or hours against a QuickBooks customer.
              </div>
            ) : (
              <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                {rows.map((r, i) => {
                  const open = expanded === r.customerId;
                  return (
                    <div key={r.customerId} style={{ borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>
                      <div onClick={() => setExpanded(open ? null : r.customerId)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 18px', cursor: 'pointer' }}>
                        <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                          <div style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>
                            {open ? '▾' : '▸'} {r.customerName}
                          </div>
                          <div style={{ color: SUBTEXT, fontSize: 11 }}>
                            {r.invoices.length} invoice{r.invoices.length === 1 ? '' : 's'} · {r.expenses.length} cost{r.expenses.length === 1 ? '' : 's'} · {r.hours.toFixed(1)}h
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 18, flexShrink: 0, textAlign: 'right' }}>
                          <div>
                            <div style={{ color: SUBTEXT, fontSize: 10 }}>Revenue</div>
                            <div style={{ color: TEAL, fontWeight: 700, fontSize: 13 }}>{fmt(r.revenue)}</div>
                          </div>
                          <div>
                            <div style={{ color: SUBTEXT, fontSize: 10 }}>Cost</div>
                            <div style={{ color: AMBER, fontWeight: 700, fontSize: 13 }}>{fmt(r.cost)}</div>
                          </div>
                          <div>
                            <div style={{ color: SUBTEXT, fontSize: 10 }}>Profit</div>
                            <div style={{ color: r.profit >= 0 ? GREEN : RED, fontWeight: 800, fontSize: 13 }}>{fmt(r.profit)}</div>
                          </div>
                          <div style={{ minWidth: 52 }}>
                            <div style={{ color: SUBTEXT, fontSize: 10 }}>Margin</div>
                            <div style={{ color: r.margin === null ? SUBTEXT : r.margin >= 0 ? GREEN : RED, fontWeight: 700, fontSize: 13 }}>
                              {r.margin === null ? '—' : `${r.margin.toFixed(0)}%`}
                            </div>
                          </div>
                        </div>
                      </div>

                      {open && (
                        <div style={{ background: '#f7f9fa', padding: '12px 18px 16px' }}>
                          {r.margin === null && r.cost > 0 && (
                            <div style={{ color: RED, fontSize: 12, marginBottom: 10, fontWeight: 600 }}>
                              Costs against this customer with nothing invoiced yet.
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                              <div style={{ color: TEAL, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Invoices</div>
                              {r.invoices.length === 0 && <div style={{ color: SUBTEXT, fontSize: 12 }}>None in this period.</div>}
                              {r.invoices.slice(0, 12).map(inv => (
                                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0' }}>
                                  <span style={{ color: SUBTEXT }}>{inv.docNumber ? `#${inv.docNumber}` : inv.id} · {inv.date}</span>
                                  <b style={{ color: TEAL }}>{fmtExact(inv.amount)}</b>
                                </div>
                              ))}
                            </div>

                            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                              <div style={{ color: AMBER, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Costs</div>
                              {r.expenses.length === 0 && <div style={{ color: SUBTEXT, fontSize: 12 }}>None tagged in this period.</div>}
                              {r.expenses.slice(0, 12).map(ex => (
                                <div key={ex.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0' }}>
                                  <span style={{ color: SUBTEXT, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {ex.payee || ex.source} · {ex.date}
                                  </span>
                                  <b style={{ color: AMBER, flexShrink: 0 }}>{fmtExact(ex.amount)}</b>
                                </div>
                              ))}
                            </div>

                            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                              <div style={{ color: TEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Hours</div>
                              {r.entries.length === 0 && <div style={{ color: SUBTEXT, fontSize: 12 }}>None logged in this period.</div>}
                              {r.entries.slice(0, 12).map((te, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0' }}>
                                  <span style={{ color: SUBTEXT, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {te.logged_by || te.tech_email || 'Unknown'} · {te.work_date}
                                  </span>
                                  <b style={{ color: TEXT, flexShrink: 0 }}>{((te.total_minutes || 0) / 60).toFixed(2)}h</b>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
