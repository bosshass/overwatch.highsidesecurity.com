// ============================================
// Jovelin — Review a queued QuickBooks write
// POST /api/admin/review-push  { queue_id, action: 'approve'|'reject', reviewer, note? }
// ============================================
// Nothing in qbo_push_queue has touched QuickBooks. Approving is what
// finally sends it; rejecting closes it out having sent nothing.
//
// Approval re-dispatches to the same push endpoint the request originally
// came from, with approved: true to clear the gate. That's deliberate over
// duplicating the push logic here — the invoice built on approval is
// produced by exactly the same code path, and its verification round-trip,
// as one pushed directly. Two implementations would eventually disagree,
// and the one guarding a client's books is the wrong place for that.
import { createClient } from '@supabase/supabase-js';

const ENDPOINT_FOR_KIND = {
  custom_invoice: '/api/qbo/push-custom-invoice',
  invoice_from_estimate: '/api/qbo/push-invoice',
  cost_tag: '/api/qbo/tag-cost',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { queue_id, action, reviewer, note } = req.body || {};
  if (!queue_id || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'queue_id and action (approve|reject) required' });
  }

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // WHO is asking, verified against the database — not taken on trust
    // from the request body. Hiding the queue in the UI is not a control:
    // this endpoint releases writes into clients' live accounting, so
    // anyone able to POST to it could approve their own pushes, which is
    // precisely what the staff role exists to prevent. Staff do the work;
    // a super admin authorises it.
    const email = String(reviewer || '').toLowerCase().trim();
    if (!email) return res.status(403).json({ error: 'Reviewer not identified.' });

    const { data: who, error: whoErr } = await supabase.from('user_roles')
      .select('role').eq('email', email).is('revoked_at', null).maybeSingle();

    // Fails closed: an unreadable role is not permission to approve.
    if (whoErr || who?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can approve or reject a QuickBooks write.' });
    }

    const { data: item, error } = await supabase.from('qbo_push_queue')
      .select('*').eq('id', queue_id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!item) return res.status(404).json({ error: 'That request no longer exists.' });

    // Guards against two reviewers acting on the same item, and against a
    // double-click sending an invoice to QuickBooks twice.
    if (item.status !== 'pending') {
      return res.status(409).json({ error: `Already ${item.status} — nothing further was sent.` });
    }

    if (action === 'reject') {
      await supabase.from('qbo_push_queue').update({
        status: 'rejected', reviewed_by: reviewer || null,
        reviewed_at: new Date().toISOString(), review_note: note || null,
      }).eq('id', queue_id);
      return res.status(200).json({ rejected: true });
    }

    const endpoint = ENDPOINT_FOR_KIND[item.kind];
    if (!endpoint) return res.status(400).json({ error: `Unknown request type: ${item.kind}` });

    const base = `https://${req.headers.host}`;
    const pushRes = await fetch(base + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...item.payload, tenant_id: item.tenant_id, approved: true }),
    });
    const result = await pushRes.json();

    const succeeded = !!(result.pushed || result.tagged);
    await supabase.from('qbo_push_queue').update({
      status: succeeded ? 'pushed' : 'failed',
      reviewed_by: reviewer || null,
      reviewed_at: new Date().toISOString(),
      review_note: note || null,
      result,
    }).eq('id', queue_id);

    return res.status(200).json({ approved: true, succeeded, result });
  } catch (err) {
    // Left pending rather than marked failed — an exception here says
    // nothing about whether QuickBooks received it, and a stuck pending
    // item is safer than one wrongly recorded as sent or not sent.
    return res.status(502).json({ error: String(err.message || err) });
  }
}
