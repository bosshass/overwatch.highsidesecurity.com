// ============================================
// Jovelin — Open Estimates (QBO reconciliation + job costing)
// ============================================
// Every estimate for the tenant, each flagged against QuickBooks:
//   - Not in QBO yet / Matches QuickBooks / Mismatch (estimate total vs
//     what QBO actually has on file for the pushed Estimate)
// Accepted estimates with a QBO customer additionally expand to show
// job-costing detail — hours logged, revenue earned, expenses, and a
// SEPARATE delta check: expenses recorded in Jovelin (estimate_payments,
// direction='out') vs. expenses QuickBooks actually shows for that
// customer. If those two don't agree, that's flagged too — it usually
// means a payment was logged in Jovelin that was never entered into
// QuickBooks (or vice versa).
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626', SUBTEXT2 = '#94a3b8';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtHrs = (n) => `${(n || 0).toFixed(1)}h`;
const labelStyle = { color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 };

function calcLine(l, defaultMarkup) {
  const qty = parseFloat(l.qty) || 0;
  const cost = parseFloat(l.contractor_unit_cost) || 0;
  const mk = (l.markup_pct === null || l.markup_pct === undefined) ? defaultMarkup : parseFloat(l.markup_pct) || 0;
  const ov = (l.override_unit_price === null || l.override_unit_price === undefined) ? null : parseFloat(l.override_unit_price);
  const price = ov !== null && isFinite(ov) ? ov : cost * (1 + mk / 100);
  return qty * price;
}
function estimateTotal(est) {
  return (est.estimate_lines || []).reduce((s, l) => s + calcLine(l, est.default_markup_pct), 0);
}

export default function EstimatesList() {
  const { currentTenantId, currentTenant } = useTenant();
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState([]);
  const [qboEstimateTotals, setQboEstimateTotals] = useState({});
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [jobCosting, setJobCosting] = useState(null);
  const [paymentsByEstimate, setPaymentsByEstimate] = useState({});
  const [qboConnected, setQboConnected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unbilledJobs, setUnbilledJobs] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  useEffect(() => {
    if (!currentTenantId) return;
    setLoading(true);
    Promise.all([
      supabase.from('estimates')
        .select('id, est_no, project, status, qbo_customer_id, qbo_customer_name, qbo_estimate_id, accepted_at, job_id, default_markup_pct, quote_date, estimate_lines(qty, contractor_unit_cost, markup_pct, override_unit_price)')
        .eq('tenant_id', currentTenantId).order('created_at', { ascending: false }),
      apiFetch(`/api/qbo/estimates-check?tenant_id=${currentTenantId}`).then(r => r.json()).catch(() => ({ connected: false, estimates: {} })),
      apiFetch(`/api/qbo/job-costing?tenant_id=${currentTenantId}`).then(r => r.json()).catch(() => ({ connected: false, invoices: [], expenses: [] })),
      supabase.from('estimate_payments').select('estimate_id, direction, amount, estimates!inner(tenant_id)').eq('estimates.tenant_id', currentTenantId).eq('direction', 'out'),
    ]).then(([estRes, checkRes, costingRes, payRes]) => {
      setEstimates(estRes.data || []);
      setQboEstimateTotals(checkRes.estimates || {});
      setQboConnected(checkRes.connected);
      setJobCosting(costingRes);
      const byEst = {};
      (payRes.data || []).forEach(p => { byEst[p.estimate_id] = (byEst[p.estimate_id] || 0) + (parseFloat(p.amount) || 0); });
      setPaymentsByEstimate(byEst);
    }).finally(() => setLoading(false));

    // Jobs created via Board/Time (tasks with a customer) are open until
    // billed too — not just accepted estimates. Billing itself isn't built
    // yet, so this just makes sure the unbilled hours are visible, not lost.
    (async () => {
      const { data: jobs } = await supabase.from('tasks')
        .select('id, title, qbo_customer_name, status')
        .eq('tenant_id', currentTenantId)
        .or('qbo_customer_id.not.is.null,local_customer_id.not.is.null');
      if (!jobs?.length) { setUnbilledJobs([]); return; }
      const { data: entries } = await supabase.from('time_entries')
        .select('task_id, total_minutes, billed').eq('tenant_id', currentTenantId).eq('billed', false).in('task_id', jobs.map(j => j.id));
      const hoursByJob = {};
      (entries || []).forEach(e => { if (e.task_id) hoursByJob[e.task_id] = (hoursByJob[e.task_id] || 0) + (e.total_minutes || 0); });
      setUnbilledJobs(jobs.filter(j => hoursByJob[j.id] > 0).map(j => ({ ...j, unbilledMinutes: hoursByJob[j.id] })));
    })();
  }, [currentTenantId]);

  const matchInfo = (est) => {
    if (!est.qbo_estimate_id) return { label: 'Not in QuickBooks', color: SUBTEXT2, bg: '#f1f3f4' };
    const rec = qboEstimateTotals[est.qbo_estimate_id];
    if (rec === undefined) return { label: 'QBO record not found', color: RED, bg: '#fdecea' };
    const matches = Math.abs(estimateTotal(est) - rec.total) < 0.01;
    return matches
      ? { label: 'Matches QuickBooks', color: GREEN, bg: '#e6f4ea' }
      : { label: `Mismatch — QBO shows ${fmt(rec.total)}`, color: RED, bg: '#fdecea' };
  };

  // What QuickBooks itself currently says the estimate's status is —
  // separate from Jovelin's own status field, which can drift.
  const qboStatus = (est) => {
    if (!est.qbo_estimate_id) return null;
    return qboEstimateTotals[est.qbo_estimate_id]?.status || null;
  };

  const runImport = async () => {
    setImporting(true); setImportMsg('');
    try {
      const r = await apiFetch('/api/qbo/import-estimates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: currentTenantId }),
      }).then(res => res.json());
      if (r.error) { setImportMsg(r.error); setImporting(false); return; }
      const bits = [];
      if (r.imported) bits.push(`${r.imported} imported`);
      if (r.updated) bits.push(`${r.updated} status updated`);
      if (r.skipped) bits.push(`${r.skipped} skipped (rejected/closed)`);
      setImportMsg(bits.length ? bits.join(' · ') : 'Nothing new to import.');
      if (r.imported || r.updated) setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setImportMsg('Import failed: ' + e.message);
    }
    setImporting(false);
  };

  const isOpenJob = (est) => est.status === 'accepted' && est.qbo_customer_id;

  const toggleExpand = useCallback(async (est) => {
    if (expandedId === est.id) { setExpandedId(null); setExpandedDetail(null); return; }
    setExpandedId(est.id); setExpandedLoading(true); setExpandedDetail(null);
    try {
      const since = est.accepted_at ? new Date(est.accepted_at) : null;
      const invoicedSinceAccepted = (jobCosting?.invoices || [])
        .filter(inv => inv.customerId === est.qbo_customer_id && (!since || new Date(inv.date) >= since))
        .reduce((s, inv) => s + inv.amount, 0);
      const qboExpenses = (jobCosting?.expenses || [])
        .filter(e => e.customerId === est.qbo_customer_id && (!since || new Date(e.date) >= since))
        .reduce((s, e) => s + e.amount, 0);
      const jovelinExpenses = paymentsByEstimate[est.id] || 0;
      const expenseDelta = Math.abs(qboExpenses - jovelinExpenses) > 0.01;

      let hoursLogged = null;
      if (est.job_id) {
        const { data } = await supabase.from('time_entries').select('total_minutes').eq('job_id', est.job_id);
        hoursLogged = Math.round(((data || []).reduce((s, t) => s + (t.total_minutes || 0), 0) / 60) * 10) / 10;
      }
      setExpandedDetail({
        hoursLogged, revenueEarned: invoicedSinceAccepted, qboExpenses, jovelinExpenses, expenseDelta,
        overUnder: invoicedSinceAccepted - qboExpenses,
        remaining: estimateTotal(est) - invoicedSinceAccepted,
      });
    } finally {
      setExpandedLoading(false);
    }
  }, [expandedId, jobCosting, paymentsByEstimate]);

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 , flexWrap: 'wrap'}}>
            <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: 0 }}>Estimates</h1>
            <span style={{ color: SUBTEXT, fontSize: 14, fontWeight: 600 }}>{currentTenant?.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {qboConnected && (
              <button onClick={runImport} disabled={importing}
                style={{ background: 'none', color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                {importing ? 'Importing…' : 'Import from QuickBooks'}
              </button>
            )}
            <button onClick={() => navigate('/estimates/new')} style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ New</button>
          </div>
        </div>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 18 }}>
          Estimates built here, plus any imported from QuickBooks. Importing brings in pending
          and accepted estimates with their line items — rejected and closed ones are never
          pulled in. Imported estimates have no contractor cost (QuickBooks doesn't store one),
          so their margin figures stay blank until you fill them in. Accepted ones expand to
          show job costing: hours, revenue, expenses, and whether Jovelin's recorded payments
          agree with what QuickBooks shows.
        </p>
        {importMsg && (
          <div style={{ background: '#e6f4ea', color: GREEN, borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>{importMsg}</div>
        )}
        {qboConnected === false && (
          <div style={{ background: '#fff7ed', color: AMBER, borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 14 }}>
            {currentTenant?.name} isn't connected to QuickBooks — showing Jovelin's own records only, no reconciliation possible yet.
          </div>
        )}

        {loading ? (
          <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
        ) : estimates.length === 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, fontSize: 13 }}>
            <div style={{ color: TEXT, fontWeight: 600, marginBottom: 4 }}>No estimates yet for {currentTenant?.name}.</div>
            <div style={{ color: SUBTEXT, lineHeight: 1.5 }}>
              If this client already has estimates in QuickBooks, hit <b>Import from QuickBooks</b> above to pull
              in their pending and accepted ones with line items. Or hit <b>+ New</b> to build one here.
            </div>
          </div>
        ) : (
          estimates.filter(est => est.status !== 'declined').map(est => {
            const m = matchInfo(est);
            const openJob = isOpenJob(est);
            return (
              <div key={est.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 10 }}>
                <div onClick={() => navigate(`/estimates/${est.id}?tab=rollup`)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 , flexWrap: 'wrap'}}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>{est.est_no} {est.qbo_customer_name ? `— ${est.qbo_customer_name}` : ''}</div>
                      <div style={{ fontSize: 12, color: SUBTEXT }}>{est.project || ''} {est.quote_date ? `· ${est.quote_date}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 800, color: TEAL, fontSize: 15 }}>{fmt(estimateTotal(est))}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'capitalize', color: SUBTEXT }}>{est.status}</span>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: m.bg, color: m.color }}>{m.label}</span>
                    {qboStatus(est) && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#eef2ff', color: '#3730a3' }}>
                        QuickBooks: {qboStatus(est)}
                      </span>
                    )}
                  </div>
                </div>

                {openJob && (
                  <button onClick={(e) => { e.stopPropagation(); toggleExpand(est); }} style={{ background: 'none', border: 'none', color: TEAL, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '8px 0 0' }}>
                    {expandedId === est.id ? '▾ Hide job costing' : '▸ Show job costing'}
                  </button>
                )}

                {expandedId === est.id && (
                  <div style={{ background: '#f7f9fa', borderRadius: 10, padding: 14, marginTop: 10, fontSize: 13 }}>
                    {expandedLoading ? (
                      <div style={{ color: SUBTEXT }}>Loading job detail…</div>
                    ) : expandedDetail && (
                      <>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
                          <div><div style={labelStyle}>Hours Logged</div><div style={{ fontWeight: 700, color: expandedDetail.hoursLogged === null ? SUBTEXT : TEXT }}>{expandedDetail.hoursLogged === null ? 'No linked job' : fmtHrs(expandedDetail.hoursLogged)}</div></div>
                          <div><div style={labelStyle}>Revenue Earned</div><div style={{ fontWeight: 700, color: TEAL }}>{fmt(expandedDetail.revenueEarned)}</div></div>
                          <div><div style={labelStyle}>Remaining to Convert</div><div style={{ fontWeight: 700, color: TEXT }}>{fmt(expandedDetail.remaining)}</div></div>
                          <div><div style={labelStyle}>Over / Under</div><div style={{ fontWeight: 700, color: expandedDetail.overUnder >= 0 ? GREEN : RED }}>{fmt(expandedDetail.overUnder)}</div></div>
                        </div>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                          <div><div style={labelStyle}>Expenses (QuickBooks)</div><div style={{ fontWeight: 700, color: AMBER }}>{fmt(expandedDetail.qboExpenses)}</div></div>
                          <div><div style={labelStyle}>Recorded in Jovelin</div><div style={{ fontWeight: 700, color: AMBER }}>{fmt(expandedDetail.jovelinExpenses)}</div></div>
                          {expandedDetail.expenseDelta ? (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#fdecea', color: RED }}>
                              ⚠ Delta — Jovelin and QuickBooks expenses don't match
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#e6f4ea', color: GREEN }}>
                              ✓ Expenses agree
                            </span>
                          )}
                        </div>
                        <div style={{ color: SUBTEXT, fontSize: 11, marginTop: 10 }}>
                          Since accepted {est.accepted_at ? new Date(est.accepted_at).toLocaleDateString() : '(no acceptance date on file)'}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {estimates.some(e => e.status === 'declined') && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: SUBTEXT, fontWeight: 700, fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Declined</div>
            {estimates.filter(e => e.status === 'declined').map(est => (
              <div key={est.id} onClick={() => navigate(`/estimates/${est.id}`)} style={{
                background: '#f7f7f7', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 16px', marginBottom: 8,
                display: 'flex', justifyContent: 'space-between', cursor: 'pointer', opacity: 0.7,
              }}>
                <span style={{ fontSize: 13, color: TEXT }}>{est.est_no} {est.qbo_customer_name ? `— ${est.qbo_customer_name}` : ''}</span>
                <span style={{ fontSize: 13, color: SUBTEXT }}>{fmt(estimateTotal(est))}</span>
              </div>
            ))}
          </div>
        )}

        {unbilledJobs.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Board & Time Jobs — Unbilled</div>
            <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 10 }}>
              Not tied to an estimate. Open until billed — Billing isn't built yet, so this just keeps the hours visible.
            </div>
            {unbilledJobs.map(j => (
              <div key={j.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: TEXT }}>{j.title}</div>
                  {j.qbo_customer_name && <div style={{ fontSize: 11, color: SUBTEXT }}>{j.qbo_customer_name}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: AMBER, fontSize: 13 }}>{((j.unbilledMinutes || 0) / 60).toFixed(1)}h</div>
                  <span style={{ fontSize: 10, color: SUBTEXT, textTransform: 'capitalize' }}>{j.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
