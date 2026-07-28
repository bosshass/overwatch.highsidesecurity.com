// ============================================
// Jovelin — User login audit info
// POST /api/admin-user-info  { emails: [...] }
// Supabase Auth tracks last_sign_in_at itself, but only the admin API can
// read it — this is why Settings can't just query it directly from the
// frontend. Returns per-email: whether an auth account exists at all,
// and when they last signed in (null = invited but never logged in).
// ============================================
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { emails } = req.body || {};
  if (!Array.isArray(emails) || !emails.length) return res.status(400).json({ error: 'emails array required' });

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // listUsers doesn't filter by email server-side, so page through and
    // match locally. Fine at this scale; would need real pagination past
    // a few thousand total users.
    const wanted = new Set(emails.map(e => e.toLowerCase()));
    const result = {};
    let page = 1;
    while (wanted.size > Object.keys(result).length) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        const email = (u.email || '').toLowerCase();
        if (wanted.has(email)) {
          result[email] = { exists: true, lastSignInAt: u.last_sign_in_at || null, createdAt: u.created_at };
        }
      }
      if (data.users.length < 200) break; // last page
      page++;
      if (page > 25) break; // hard safety stop
    }
    for (const email of wanted) {
      if (!result[email]) result[email] = { exists: false, lastSignInAt: null, createdAt: null };
    }
    return res.status(200).json({ users: result });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
}
