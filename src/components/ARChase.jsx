// ============================================
// Jovelin — Accounts Receivable / chase
// ============================================
// Lives under Billing rather than Revenue. Chasing an unpaid invoice is a
// collections job, not a reporting one — Revenue answers "what did we
// earn", this answers "who owes us and what are we doing about it".
//
// Self-contained on purpose: it owns its own fetching and template state
// so it can sit anywhere without the host screen having to carry A/R
// concerns it otherwise has nothing to do with.
import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useSignature } from '../utils/useSignature.js';
import { gmailComposeUrl } from '../utils/gmailCompose.js';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

const DEFAULT_AR_SUBJECT = 'Invoice {invoice_no} — past due';
const DEFAULT_AR_BODY =
`Hi {customer},

Just following up on invoice {invoice_no} for {amount}, which was due {due_date} ({days_overdue} days past due).

You can view and pay it here:
{invoice_link}

Could you let me know the status, or if there's anything holding up payment?

Thanks,{signature}`;

// Plain token replacement — no expression evaluation, so a template can't
// do anything surprising.
function renderTemplate(text, inv, signature) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const out = (text || '')
    .replace(/\{customer\}/g, inv.customerName || 'there')
    .replace(/\{invoice_no\}/g, inv.docNumber ? `#${inv.docNumber}` : '')
    .replace(/\{amount\}/g, money.format(inv.balance || 0))
    .replace(/\{due_date\}/g, inv.dueDate ? new Date(inv.dueDate + 'T00:00:00').toLocaleDateString() : '')
    .replace(/\{days_overdue\}/g, String(inv.daysOverdue ?? ''))
    .replace(/\{invoice_link\}/g, inv.invoiceLink || '')
    .replace(/\{signature\}/g, signature || '');
  // Drop the offer line entirely when QuickBooks returned no pay link,
  // rather than leaving "You can view and pay it here:" pointing at nothing.
  return inv.invoiceLink ? out : out.replace(/You can view and pay it here:\s*\n+/g, '');
}

export default function ARChase({ userEmail }) {
  const { currentTenantId, currentTenant } = useTenant();
  const signature = useSignature(userEmail);

  const [invoices, setInvoices] = useState([]);
  const [emails, setEmails] = useState({});
  const [loading, setLoading] = useState(true);
  const [linkDebug, setLinkDebug] = useState(null);

  const [subject, setSubject] = useState(DEFAULT_AR_SUBJECT);
  const [body, setBody] = useState(DEFAULT_AR_BODY);
  const [saved, setSaved] = useState(true);
  const [showTemplate, setShowTemplate] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);

  useEffect(() => {
    if (!currentTenantId) return;
    setLoading(true);
    (async () => {
      const get = (u, f) => apiFetch(u).then(r => r.json()).catch(() => f);
      // links=1 because this screen is the reason the links exist; every
      // one costs a separate QuickBooks read, so nowhere else asks for them.
      const summary = await get(`/api/qbo/summary?tenant_id=${currentTenantId}&links=1`, {});
      setInvoices(summary.pastDueInvoices || []);
      setLinkDebug(summary.linkDebug || null);

      const lists = await get(`/api/qbo/lists?tenant_id=${currentTenantId}`, { customers: [] });
      const map = {};
      (lists.customers || []).forEach(c => { map[c.id] = c.email; });
      setEmails(map);
      setLoading(false);
    })();
  }, [currentTenantId]);

  useEffect(() => {
    if (!currentTenantId) return;
    supabase.from('ar_templates').select('subject, body').eq('tenant_id', currentTenantId).maybeSingle()
      .then(({ data }) => {
        if (data) { setSubject(data.subject || DEFAULT_AR_SUBJECT); setBody(data.body || DEFAULT_AR_BODY); }
      })
      .catch(() => { /* defaults are fine */ });
  }, [currentTenantId]);

  const saveTemplate = async () => {
    const { error } = await supabase.from('ar_templates').upsert({
      tenant_id: currentTenantId, subject, body,
      updated_by: userEmail, updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' });
    if (error) { alert('Could not save the template: ' + error.message); return; }
    setSaved(true);
  };

  const total = invoices.reduce((s, i) => s + (i.balance || 0), 0);
  const sample = invoices[Math.min(previewIdx, Math.max(invoices.length - 1, 0))];

  const label = { color: SUBTEXT, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 };
  const input = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 8, boxSizing: 'border-box' };

  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ color: RED, fontWeight: 700, fontSize: 13 }}>
          Accounts Receivable {!loading && `— ${invoices.length} past due`}
        </div>
        <div style={{ color: RED, fontWeight: 800, fontSize: 16 }}>{loading ? '' : fmt(total)}</div>
      </div>
      <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 10 }}>
        Every open invoice past its due date. Chase opens a Gmail draft for you to review and send — nothing sends
        automatically, and every customer gets the same message regardless of how overdue they are.
      </div>

      {loading ? (
        <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
      ) : invoices.length === 0 ? (
        <div style={{ color: GREEN, fontSize: 13 }}>Nothing past due.</div>
      ) : (
        <>
          <div style={{ background: '#f7f9fa', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ color: TEAL, fontWeight: 700, fontSize: 12 }}>Chase Email</div>
              <button onClick={() => setShowTemplate(v => !v)}
                style={{ background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {showTemplate ? 'Hide' : 'Preview & edit'}
              </button>
            </div>

            {showTemplate && sample && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ color: SUBTEXT, fontSize: 11 }}>Previewing against</span>
                  <select value={previewIdx} onChange={e => setPreviewIdx(Number(e.target.value))}
                    style={{ padding: '5px 8px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6, background: '#fff', color: TEXT }}>
                    {invoices.map((iv, i) => (
                      <option key={iv.id} value={i}>
                        {iv.customerName || 'Unknown'} {iv.docNumber ? `· #${iv.docNumber}` : ''} · {fmt(iv.balance)}
                      </option>
                    ))}
                  </select>
                </div>

                <label style={label}>Subject</label>
                <input value={subject} onChange={e => { setSubject(e.target.value); setSaved(false); }}
                  style={{ ...input, margin: '4px 0 10px' }} />

                <label style={label}>Message</label>
                <textarea value={body} onChange={e => { setBody(e.target.value); setSaved(false); }} rows={10}
                  style={{ ...input, margin: '4px 0 6px', fontFamily: 'inherit', resize: 'vertical' }} />

                <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 10 }}>
                  Placeholders: <code>{'{customer}'}</code> <code>{'{invoice_no}'}</code> <code>{'{amount}'}</code>{' '}
                  <code>{'{due_date}'}</code> <code>{'{days_overdue}'}</code> <code>{'{invoice_link}'}</code>{' '}
                  <code>{'{signature}'}</code>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                  <button onClick={saveTemplate} disabled={saved}
                    style={{ background: saved ? '#e5e9eb' : TEAL, color: saved ? SUBTEXT : '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 12, cursor: saved ? 'default' : 'pointer' }}>
                    {saved ? 'Saved' : 'Save template'}
                  </button>
                  {!saved && <span style={{ color: AMBER, fontSize: 11, fontWeight: 600 }}>Unsaved changes</span>}
                </div>

                <div style={{ ...label, marginBottom: 4 }}>Preview</div>
                <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ color: TEXT, fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                    {renderTemplate(subject, sample, signature)}
                  </div>
                  <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 2 }}>
                    From: <b style={{ color: TEXT }}>{userEmail || 'your Gmail account'}</b>
                  </div>
                  <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 8 }}>
                    To: {emails[sample.customerId] || 'no email on file in QuickBooks'}
                  </div>
                  <div style={{ color: TEXT, fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {renderTemplate(body, sample, signature)}
                  </div>
                  {!sample.invoiceLink && (
                    <div style={{ color: AMBER, fontSize: 11, marginTop: 8 }}>
                      QuickBooks didn't return a pay link for this invoice — the line offering it is dropped automatically.
                      {linkDebug && (
                        <div style={{ color: SUBTEXT, fontSize: 10, marginTop: 6, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
                          {linkDebug.note}{linkDebug.status ? ` (HTTP ${linkDebug.status})` : ''}
                          {linkDebug.fieldsReturned && <><br />Fields returned: {linkDebug.fieldsReturned.join(', ')}</>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {invoices.map(inv => {
            const email = emails[inv.customerId];
            return (
              <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 13, gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: TEXT, fontWeight: 600 }}>
                    {inv.customerName || 'Unknown customer'} {inv.docNumber ? `· #${inv.docNumber}` : ''}
                  </div>
                  <div style={{ color: RED, fontSize: 11 }}>{inv.daysOverdue}d overdue · due {inv.dueDate}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <b style={{ color: TEAL }}>{fmt(inv.balance)}</b>
                  <a href={gmailComposeUrl({
                        to: email,
                        subject: renderTemplate(subject, inv, signature),
                        body: renderTemplate(body, inv, signature),
                      })}
                    target="_blank" rel="noopener noreferrer"
                    style={{ background: RED, color: '#fff', fontWeight: 700, fontSize: 12, padding: '6px 12px', borderRadius: 8, textDecoration: 'none' }}>
                    Chase
                  </a>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
