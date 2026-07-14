// ============================================
// ShortLink — /j/<8 chars> → the job
// ============================================
// A raw UUID link runs to 80+ characters and looks like malware in a text
// message; techs don't tap them. This resolves the first 8 hex characters of
// the job's UUID back to the full row and hands off to the board.
//
// It matches on a PREFIX, so it verifies there's exactly one hit before
// opening anything. If two jobs ever shared a prefix (they won't at DRH's
// scale, but the code shouldn't assume), it says so rather than guessing.

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';

export default function ShortLink() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const c = (code || '').toLowerCase().replace(/[^a-f0-9]/g, '');
      if (c.length < 6) { setErr('That link looks incomplete.'); return; }

      // Postgres won't LIKE a uuid directly — cast it to text first.
      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_name')
        .filter('id::text', 'like', `${c}%`)
        .limit(2);

      if (error) { setErr(error.message); return; }
      if (!data || data.length === 0) { setErr('That job no longer exists.'); return; }
      if (data.length > 1) { setErr('That link is ambiguous — ask the office for a fresh one.'); return; }

      navigate(`/board?job=${data[0].id}`, { replace: true });
    })();
  }, [code, navigate]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      {err ? (
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{err}</div>
          <button onClick={() => navigate('/')}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer' }}>
            Go to Overwatch
          </button>
        </div>
      ) : (
        <div style={{ color: '#94a3b8' }}>Opening the job…</div>
      )}
    </div>
  );
}
