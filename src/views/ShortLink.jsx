// ============================================
// ShortLink — /j/<8 chars> → the job, DIRECTLY
// ============================================
// A raw UUID link runs to 80+ characters and looks like malware in a text
// message; techs don't tap them. This resolves the first 8 hex characters of
// the job's UUID back to the full row.
//
// It matches on a PREFIX, so it verifies there's exactly one hit before
// opening anything. If two jobs ever shared a prefix (they won't within a tenant's
// scale, but the code shouldn't assume), it says so rather than guessing.
//
// v2: renders JobDetail DIRECTLY instead of navigate('/board?job=...') and
// hoping BoardView's separate effect catches the query param. That indirection
// was the actual bug — the resolve worked, but the hand-off to the board
// wasn't reliably reopening the card. Rendering the card here removes that
// failure surface entirely: one component, one job, no relay.

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import JobDetail from '../components/JobDetail.jsx';

export default function ShortLink({ accessToken, userEmail, userRole, onUpdate }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const [err, setErr] = useState('');
  const [jobId, setJobId] = useState(null);

  useEffect(() => {
    (async () => {
      const c = (code || '').toLowerCase().replace(/[^a-f0-9]/g, '');
      if (c.length < 6) { setErr('That link looks incomplete.'); return; }

      // Postgres won't LIKE a uuid, and PostgREST won't carry an `id::text`
      // cast through a filter — that produced "operator does not exist:
      // uuid ~~ unknown" and killed every /j/ link. Resolve the hex prefix as
      // a uuid RANGE instead; uuid supports >= / <= natively and the PK index
      // serves it. Short codes < 8 chars pad with 0 (low) and f (high).
      const lo = c.padEnd(8, '0');
      const hi = c.padEnd(8, 'f');
      const asUuid = (p, fill) => `${p}-${fill.repeat(4)}-${fill.repeat(4)}-${fill.repeat(4)}-${fill.repeat(12)}`;
      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_name')
        .gte('id', asUuid(lo, '0'))
        .lte('id', asUuid(hi, 'f'))
        .limit(2);

      if (error) { setErr(error.message); return; }
      if (!data || data.length === 0) { setErr('That job no longer exists.'); return; }
      if (data.length > 1) { setErr('That link is ambiguous — ask the office for a fresh one.'); return; }

      setJobId(data[0].id);
    })();
  }, [code]);

  if (jobId) {
    // Render the real card directly. Closing it goes to the board (with no
    // job param — there's nothing left to hand off, this WAS the destination).
    return (
      <JobDetail
        jobId={jobId}
        onClose={() => navigate('/board', { replace: true })}
        onUpdate={onUpdate}
        accessToken={accessToken}
        userEmail={userEmail}
        userRole={userRole}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      {err ? (
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{err}</div>
          <button onClick={() => navigate('/')}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer' }}>
            Go to Jovelin
          </button>
        </div>
      ) : (
        <div style={{ color: '#94a3b8' }}>Opening the job…</div>
      )}
    </div>
  );
}
