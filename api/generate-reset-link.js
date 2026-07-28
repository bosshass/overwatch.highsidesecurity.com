// ============================================
// Jovelin — Generate a password-reset link
// POST /api/generate-reset-link  { email }
// Same idea as invite-user: generateLink({ type: 'recovery' }) hands back
// the real, working reset link without Supabase sending anything itself.
// The admin gets it back and opens a Gmail draft with it — same pattern
// as everywhere else, review-and-send, not automated.
// ============================================
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const siteUrl = process.env.SITE_URL || 'https://jovelin.vercel.app';

  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery', email, options: { redirectTo: siteUrl },
    });
    if (error) return res.status(502).json({ error: error.message });

    const actionLink = data?.properties?.action_link || data?.action_link || null;
    if (!actionLink) return res.status(502).json({ error: 'No reset link came back — check Supabase project settings.' });

    return res.status(200).json({ actionLink });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
}
