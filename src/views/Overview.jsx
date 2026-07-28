// ============================================
// Jovelin — Command Center
// ============================================
// Light, teal-accented dashboard. Every number here is real (QBO +
// Jovelin's own tables). Team presence, calendar schedule, and
// hours-by-category are NOT included — that data doesn't exist anywhere
// in the app yet, and this dashboard doesn't fake it.
//
// Open Jobs / job-costing detail (revenue, expenses, over/under per
// accepted estimate) lives one level deeper, on the Open Estimates
// click-through (/estimates-list) — not duplicated here. This screen
// just shows the count and links there.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, JOB_STATUS } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import IncomeExpenseChart from '../components/IncomeExpenseChart.jsx';
import { useUserRole } from '../context/UserRoleContext.jsx';
import { StatValue, Skeleton } from '../components/Skeleton.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', TEAL_LIGHT = '#0891b2', GREEN = '#16a34a', RED = '#dc2626', AMBER = '#d97706';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const CLOSED_STATUSES = [JOB_STATUS.BILLED, JOB_STATUS.LOST, JOB_STATUS.DEAD, JOB_STATUS.ARCHIVED];
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const cardStyle = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' };
const labelStyle = { color: SUBTEXT, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 };

function estimateTotal(est) {
  const defMk = parseFloat(est.default_markup_pct) || 0;
  return (est.estimate_lines || []).reduce((sum, l) => {
    const qty = parseFloat(l.qty) || 0;
    const cost = parseFloat(l.contractor_unit_cost) || 0;
    const mk = (l.markup_pct === null || l.markup_pct === undefined) ? defMk : parseFloat(l.markup_pct) || 0;
    const ov = (l.override_unit_price === null || l.override_unit_price === undefined) ? null : parseFloat(l.override_unit_price);
    const price = ov !== null && isFinite(ov) ? ov : cost * (1 + mk / 100);
    return sum + qty * price;
  }, 0);
}

const StatCard = ({ label, value, sub, color, onClick, loading }) => (
  <div onClick={onClick} style={{ ...cardStyle, flex: '1 1 160px', minWidth: 150, cursor: onClick ? 'pointer' : 'default' }}>
    <div style={labelStyle}>{label}</div>
    <div style={{ color: color || TEXT, fontSize: 24, fontWeight: 800, marginTop: 6 }}>
      <StatValue loading={loading} width={100} height={26}>{value}</StatValue>
    </div>
    {sub && (
      <div style={{ color: SUBTEXT, fontSize: 12, marginTop: 3 }}>
        <StatValue loading={loading} width={80} height={13}>{sub}</StatValue>
      </div>
    )}
  </div>
);

export default function Overview() {
  const { currentTenantId, currentTenant } = useTenant();
  const navigate = useNavigate();
  const [qbo, setQbo] = useState(null);
  const [qboLoading, setQboLoading] = useState(true);
  const [ops, setOps] = useState(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [jobCosting, setJobCosting] = useState(null);
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [upsell, setUpsell] = useState(null);
  const { tenantFeatures, bypassFeatureGates } = useUserRole();
  // A feature absent from the map is treated as enabled, matching
  // FeatureGate — a missing key means "not configured", not "not sold".
  const revenueEnabled = bypassFeatureGates || tenantFeatures?.revenue !== false;
  const [costingLoading, setCostingLoading] = useState(true);

  // Summary only — Revenue owns the per-customer breakdown and the
  // individual cost lines. Same COST_LIMIT so the two screens agree.
  const COST_LIMIT = 30;
  const costSummary = useMemo(() => {
    const expenses = jobCosting?.expenses || [];
    if (!expenses.length) return null;
    const recent = expenses.slice(0, COST_LIMIT); // endpoint returns newest-first
    const customerIds = new Set(recent.map(e => e.customerId));
    const totalBilled = (jobCosting?.invoices || [])
      .filter(inv => inv.customerId && customerIds.has(inv.customerId))
      .reduce((s, inv) => s + inv.amount, 0);
    return {
      costCount: recent.length,
      customerCount: customerIds.size,
      totalCost: recent.reduce((s, e) => s + e.amount, 0),
      totalBilled,
    };
  }, [jobCosting]);
  const [pipeline, setPipeline] = useState([]);
  const [openJobsCount, setOpenJobsCount] = useState(0);

  useEffect(() => {
    if (!currentTenantId) return;
    setQboLoading(true); setOpsLoading(true);

    // Sequential — each of these runs several QuickBooks queries, and
    // firing them together contributed to tripping Intuit's rate limit.
    // The headline summary lands first so the screen isn't blank while the
    // heavier chart and job-costing data follow.
    (async () => {
      try {
        setQbo(await apiFetch(`/api/qbo/summary?tenant_id=${currentTenantId}`).then(r => r.json()));
      } catch (e) {
        setQbo({ connected: false, error: 'Could not reach QBO summary endpoint' });
      }
      setQboLoading(false);

      setTrend(await apiFetch(`/api/qbo/monthly-trend?tenant_id=${currentTenantId}&months=6`)
        .then(r => r.json()).catch(() => null));
      setTrendLoading(false);

      setJobCosting(await apiFetch(`/api/qbo/job-costing?tenant_id=${currentTenantId}`)
        .then(r => r.json()).catch(() => null));
      setCostingLoading(false);
    })();

    (async () => {
      try {
        const [hoursRes, estRes, payRes, pipeRes, acceptedRes] = await Promise.all([
          supabase.from('time_entries').select('total_minutes').eq('tenant_id', currentTenantId).eq('billed', false).eq('archived', false),
          supabase.from('estimates').select('id, status').eq('tenant_id', currentTenantId),
          supabase.from('estimate_payments').select('direction, amount, estimates!inner(tenant_id)').eq('estimates.tenant_id', currentTenantId),
          supabase.from('estimates').select('id, est_no, project, status, qbo_customer_name, quote_date, default_markup_pct, estimate_lines(qty, contractor_unit_cost, markup_pct, override_unit_price)')
            .eq('tenant_id', currentTenantId).order('created_at', { ascending: false }).limit(6),
          supabase.from('estimates').select('id, qbo_customer_id, accepted_at, default_markup_pct, estimate_lines(qty, contractor_unit_cost, markup_pct, override_unit_price)')
            .eq('tenant_id', currentTenantId).eq('status', 'accepted'),
        ]);
        const unbilledMinutes = (hoursRes.data || []).reduce((s, t) => s + (t.total_minutes || 0), 0);
        const estimates = estRes.data || [];
        const payments = payRes.data || [];
        const paidIn = payments.filter(p => p.direction === 'in').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        const paidOut = payments.filter(p => p.direction === 'out').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        setOps({
          unbilledHours: Math.round((unbilledMinutes / 60) * 10) / 10,
          estimateCount: estimates.filter(e => e.status !== 'declined').length,
          estimatesAccepted: estimates.filter(e => e.status === 'accepted').length,
          paidIn, paidOut,
        });
        setPipeline(pipeRes.data || []);

        // Count-only here — full detail (hours, revenue, expenses, delta
        // vs QBO, over/under) lives on the Open Estimates click-through.
        const accepted = acceptedRes.data || [];
        setOpenJobsCount(accepted.length);
      } catch (e) {
        setOps({ error: String(e.message || e) });
      } finally {
        setOpsLoading(false);
      }
    })();
  }, [currentTenantId]);

  const agingTotal = qbo?.aging ? Object.values(qbo.aging).reduce((a, b) => a + b, 0) : 0;
  const agingBar = (label, val, color) => (
    <div key={label} style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 , flexWrap: 'wrap'}}>
        <span style={{ color: SUBTEXT }}>{label}</span><span style={{ color: TEXT, fontWeight: 700 }}>{fmt(val)}</span>
      </div>
      <div style={{ height: 6, background: '#eef1f2', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${agingTotal > 0 ? Math.min(100, (val / agingTotal) * 100) : 0}%`, height: '100%', background: color }} />
      </div>
    </div>
  );

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      {upsell && (
        <div onClick={() => setUpsell(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: CARD, borderRadius: 14, padding: 28, maxWidth: 380, textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>🔒</div>
            <div style={{ color: TEXT, fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{upsell} isn't included</div>
            <div style={{ color: SUBTEXT, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              The summary above is included, but the full {upsell} breakdown — A/R detail, expenses by account and
              customer profitability — isn't part of {currentTenant?.name}'s current plan.
              Contact JNB to add it.
            </div>
            <button onClick={() => setUpsell(null)}
              style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 , flexWrap: 'wrap'}}>
          <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: 0 }}>Command Center</h1>
          <span style={{ color: SUBTEXT, fontSize: 14, fontWeight: 600 }}>{currentTenant?.name}</span>
        </div>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 20 }}>Money from QuickBooks, operations from Jovelin — one screen.</p>

        {qboLoading || opsLoading ? (
          <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
        ) : qbo?.connected === false ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 28 }}>
            <div style={{ color: TEXT, fontSize: 14, marginBottom: 4 }}>{currentTenant?.name} isn't connected to QuickBooks yet.</div>
            <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 14 }}>Revenue, AR, and invoices need a QuickBooks connection for this tenant.</div>
            <a href={`/api/qbo/connect?tenant_id=${currentTenantId}`} style={{
              display: 'inline-block', background: TEAL, color: '#fff', fontWeight: 700,
              padding: '10px 22px', borderRadius: 10, textDecoration: 'none', fontSize: 14,
            }}>Connect QuickBooks</a>
          </div>
        ) : (
          <>
            {qbo?.needsReconnect ? (
              <div style={{ ...cardStyle, textAlign: 'center', padding: 24, marginBottom: 14 }}>
                <div style={{ color: TEXT, fontSize: 14, marginBottom: 4 }}>{currentTenant?.name}'s QuickBooks connection needs to be reconnected.</div>
                <div style={{ color: SUBTEXT, fontSize: 12, marginBottom: 14 }}>This usually means access was revoked in QuickBooks, or the connection expired from inactivity.</div>
                <a href={`/api/qbo/connect?tenant_id=${currentTenantId}`} style={{
                  display: 'inline-block', background: TEAL, color: '#fff', fontWeight: 700,
                  padding: '10px 22px', borderRadius: 10, textDecoration: 'none', fontSize: 14,
                }}>Reconnect QuickBooks</a>
              </div>
            ) : qbo?.error && (
              <div style={{ ...cardStyle, color: RED, fontSize: 13, marginBottom: 14 }}>
                QuickBooks connected, but the last data pull failed: {qbo.error}
              </div>
            )}
            {/* Stat row */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              <StatCard label="Invoiced (MTD)" value={fmt(qbo?.invoicedMTD)} color={TEAL} loading={qboLoading} onClick={() => navigate('/revenue')} />
              <StatCard label="Cash Collected (MTD)" value={fmt(qbo?.cashCollectedMTD)} color={GREEN} loading={qboLoading} onClick={() => navigate('/revenue')} />
              <StatCard label="Hours Tracked (Unbilled)" value={ops?.unbilledHours ?? '—'} />
              <StatCard label="Open Estimates" value={ops?.estimateCount ?? '—'} sub={fmt(pipeline.reduce((s, e) => s + estimateTotal(e), 0)) + ' (recent)'} onClick={() => navigate('/estimates')} />
              <StatCard label="Past Due" value={fmt(qbo?.pastDueTotal)} color={qbo?.pastDueTotal > 0 ? RED : GREEN} sub={`${qbo?.pastDueCount ?? 0} invoices`} loading={qboLoading} onClick={() => navigate('/revenue')} />
            </div>

            {/* Open Jobs — count only; full detail lives on Open Estimates */}
            <StatCard label="Open Jobs" value={openJobsCount} sub="Accepted, money left to convert — see Open Estimates for detail" onClick={() => navigate('/estimates')} />
            <div style={{ marginBottom: 20 }} />

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
              {/* Aging */}
              <div style={{ ...cardStyle, flex: '1 1 300px' }}>
                <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 12 }}>A/R Aging</div>
                {agingBar('Current', qbo?.aging?.current || 0, GREEN)}
                {agingBar('1–30 days', qbo?.aging?.d30 || 0, AMBER)}
                {agingBar('31–60 days', qbo?.aging?.d60 || 0, AMBER)}
                {agingBar('61–90 days', qbo?.aging?.d90 || 0, RED)}
                {agingBar('90+ days', qbo?.aging?.d90plus || 0, RED)}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}`, fontSize: 13 }}>
                  <span style={{ color: SUBTEXT }}>Total Outstanding</span><b style={{ color: TEAL }}>{fmt(qbo?.totalAR)}</b>
                </div>
              </div>

              {/* Estimate pipeline */}
              <div style={{ ...cardStyle, flex: '2 1 400px' }}>
                <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Estimate Pipeline</div>
                {pipeline.length === 0 && <div style={{ color: SUBTEXT, fontSize: 13 }}>No estimates yet.</div>}
                {pipeline.map(e => (
                  <div key={e.id} onClick={() => navigate(`/estimates/${e.id}?tab=rollup`)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 13, cursor: 'pointer' }}>
                    <div>
                      <div style={{ color: TEXT, fontWeight: 600 }}>{e.est_no} {e.qbo_customer_name ? `— ${e.qbo_customer_name}` : ''}</div>
                      <div style={{ color: SUBTEXT, fontSize: 11 }}>{e.project || ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 , flexWrap: 'wrap'}}>
                      <b style={{ color: TEAL }}>{fmt(estimateTotal(e))}</b>
                      <span style={{
                        background: e.status === 'accepted' ? '#e6f4ea' : e.status === 'sent' ? '#e8f0f4' : '#f4f0e6',
                        color: e.status === 'accepted' ? GREEN : e.status === 'sent' ? TEAL_LIGHT : AMBER,
                        fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, textTransform: 'capitalize',
                      }}>{e.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cash rollup from estimates module */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              <StatCard label="Paid In (Estimates)" value={fmt(ops?.paidIn)} color={GREEN} sub="via estimate payments" />
              <StatCard label="Paid Out (Contractors)" value={fmt(ops?.paidOut)} color={AMBER} />
            </div>

            {/* Income vs expenses — same chart as the Revenue landing, so the
                two screens can't drift apart. Clicking through goes there. */}
            {(trendLoading || trend?.series?.length > 0) && (
              <div onClick={() => revenueEnabled ? navigate('/revenue') : setUpsell('Revenue')}
                style={{ ...cardStyle, cursor: 'pointer', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: TEAL, fontWeight: 700, fontSize: 13 }}>
                      Income vs Expenses
                      {!revenueEnabled && (
                        <span style={{ fontSize: 9, fontWeight: 700, marginLeft: 6, padding: '2px 7px', borderRadius: 10, background: '#fff7ed', color: AMBER }}>
                          UPGRADE
                        </span>
                      )}
                    </div>
                    <div style={{ color: SUBTEXT, fontSize: 11 }}>Last 6 months — billed and collected against incurred and paid out.</div>
                  </div>
                  {!trendLoading && trend?.current && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Net This Month</div>
                      <div style={{ color: trend.current.invoiced - trend.current.incurred >= 0 ? GREEN : RED, fontSize: 20, fontWeight: 800 }}>
                        {fmt(trend.current.invoiced - trend.current.incurred)}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 12 }}>
                  {trendLoading
                    ? <div style={{ height: 160, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                        {[50, 100, 70, 120, 90, 60].map((h, i) => <Skeleton key={i} width="100%" height={h} />)}
                      </div>
                    : <IncomeExpenseChart series={trend.series} height={160} />}
                </div>
              </div>
            )}

            {/* Job costs vs what's been billed — summary only; Revenue has the
                per-customer breakdown and the individual cost lines. */}
            {costSummary && (
              <div onClick={() => navigate('/revenue')} style={{ ...cardStyle, cursor: 'pointer' }}>
                <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Recent Customer Costs vs Billed</div>
                <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12 }}>
                  Last {costSummary.costCount} costs tagged to a customer in QuickBooks, across {costSummary.customerCount} customer{costSummary.customerCount === 1 ? '' : 's'} — click for the breakdown.
                </div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Costs</div>
                    <div style={{ color: AMBER, fontSize: 22, fontWeight: 800 }}>{fmt(costSummary.totalCost)}</div>
                  </div>
                  <div>
                    <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Billed to Those Customers</div>
                    <div style={{ color: TEAL, fontSize: 22, fontWeight: 800 }}>{fmt(costSummary.totalBilled)}</div>
                  </div>
                  <div>
                    <div style={{ color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Net</div>
                    <div style={{ color: costSummary.totalBilled - costSummary.totalCost >= 0 ? GREEN : RED, fontSize: 22, fontWeight: 800 }}>
                      {fmt(costSummary.totalBilled - costSummary.totalCost)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
