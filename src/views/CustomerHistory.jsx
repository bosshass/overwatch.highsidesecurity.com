// ============================================
// Overwatch — Customer History
// ============================================
// Search any customer (linked or name-only).
// Shows every job + every note, all time, in one thread.

import { useState, useCallback, useRef } from 'react';
import { customersApi, notesApi, supabase } from '../services/supabase.js';

// ── helpers ──────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function resolveAuthor(email) {
  if (!email) return 'Office';
  const names = {
    'drhservicetech1@gmail.com': 'Austin',
    'austin@drhsecurityservices.com': 'Austin',
    'jr@drhsecurityservices.com': 'JR',
    'brian@drhsecurityservices.com': 'Brian',
    'trevor@drhsecurityservices.com': 'Trevor',
    'subs@drhsecurityservices.com': 'Subs',
    'info@drhsecurityservices.com': 'Sara',
    'sara@jnbllc.com': 'Sara',
    'admin@jnbservice.com': 'Sara',
    'shanaparks@drhsecurityservices.com': 'Shana',
  };
  return names[email.toLowerCase()] || email.split('@')[0];
}

const STATUS_COLORS = {
  new: '#64748b', needs_details: '#f59e0b', ready_to_schedule: '#3b82f6',
  scheduled: '#00c8e8', completed: '#22c55e', billed: '#8b5cf6',
  archived: '#475569', blocked: '#ef4444', needs_parts: '#f97316',
  return_pending: '#f97316', complete: '#22c55e', to_bill: '#8b5cf6',
};

// Search jobs by customer_name for no-ID jobs
async function searchJobsByName(query) {
  if (!query || query.length < 2) return [];
  const safe = query.replace(/[%,()*]/g, ' ').trim().split(' ').filter(w => w.length >= 2).sort((a, b) => b.length - a.length)[0] || query;
  const { data, error } = await supabase
    .from('jobs')
    .select('customer_name, customer_id, customer_phone, customer_address')
    .ilike('customer_name', `%${safe}%`)
    .is('customer_id', null)
    .order('customer_name')
    .limit(100);
  if (error) return [];
  // Dedupe by customer_name
  const seen = new Set();
  return (data || []).filter(j => {
    if (seen.has(j.customer_name?.toLowerCase())) return false;
    seen.add(j.customer_name?.toLowerCase());
    return true;
  }).map(j => ({
    id: null,
    name: j.customer_name,
    phone: j.customer_phone,
    address: j.customer_address,
    _nameOnly: true,
  }));
}

// Get all jobs + notes for a linked customer (by customer_id)
async function loadLinkedHistory(customerId) {
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, job_number, status, job_type, issue, created_at, customer_name')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error || !jobs?.length) return [];
  return loadNotesForJobs(jobs);
}

// Get all jobs + notes for name-only customer (no customer_id)
async function loadNameHistory(name) {
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, job_number, status, job_type, issue, created_at, customer_name')
    .ilike('customer_name', name)
    .is('customer_id', null)
    .order('created_at', { ascending: false });
  if (error || !jobs?.length) return [];
  return loadNotesForJobs(jobs);
}

async function loadNotesForJobs(jobs) {
  const results = [];
  for (const job of jobs) {
    let notes = [];
    try {
      notes = await notesApi.getAllForJob(job.id);
    } catch (_) {}
    results.push({ ...job, notes });
  }
  return results;
}

// ── component ────────────────────────────────────────────────

export default function CustomerHistory({ onBack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]); // merged: linked customers + name-only
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null); // { id, name, phone, address, drh_id, _nameOnly }
  const [jobs, setJobs] = useState([]); // [{ ...job, notes: [] }]
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  const runSearch = useCallback(async (q) => {
    setQuery(q);
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const [linked, nameOnly] = await Promise.all([
        customersApi.search(q),
        searchJobsByName(q),
      ]);
      // Merge: linked customers first, then name-only (deduped by name)
      const linkedNames = new Set(linked.map(c => c.name?.toLowerCase()));
      const filtered = nameOnly.filter(n => !linkedNames.has(n.name?.toLowerCase()));
      setResults([...linked, ...filtered]);
    } catch (_) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 300);
  };

  const selectCustomer = async (customer) => {
    setSelected(customer);
    setResults([]);
    setQuery('');
    setLoading(true);
    try {
      const jobData = customer._nameOnly
        ? await loadNameHistory(customer.name)
        : await loadLinkedHistory(customer.id);
      setJobs(jobData);
    } catch (_) {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    setJobs([]);
    setQuery('');
    setResults([]);
  };

  const totalNotes = jobs.reduce((sum, j) => sum + (j.notes?.length || 0), 0);
  const totalJobs = jobs.length;

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: 80 }}>

      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: '12px', position: 'sticky', top: 0, background: '#0f1729', zIndex: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '16px', cursor: 'pointer', padding: '4px 0' }}>←</button>
        <div style={{ fontSize: '16px', fontWeight: '700', color: '#e2e8f0' }}>👤 Customer History</div>
      </div>

      <div style={{ padding: '16px' }}>

        {/* Search bar */}
        {!selected && (
          <>
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <input
                autoFocus
                value={query}
                onChange={handleInput}
                placeholder="Search by name, phone, or address..."
                style={{
                  width: '100%', background: '#1e293b', border: '1px solid #334155',
                  borderRadius: '12px', color: '#e2e8f0', padding: '14px 16px',
                  fontSize: '16px', outline: 'none', boxSizing: 'border-box',
                }}
              />
              {searching && (
                <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '12px' }}>
                  Searching...
                </div>
              )}
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div style={{ background: '#1e293b', borderRadius: '12px', overflow: 'hidden', border: '1px solid #334155' }}>
                {results.map((c, i) => (
                  <button key={c.id || c.name} onClick={() => selectCustomer(c)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '14px 16px', background: 'none', border: 'none',
                      borderBottom: i < results.length - 1 ? '1px solid #334155' : 'none',
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '15px', fontWeight: '600', color: '#e2e8f0' }}>{c.name}</div>
                      {c._nameOnly ? (
                        <span style={{ fontSize: '10px', color: '#64748b', background: '#334155', padding: '2px 6px', borderRadius: '4px' }}>NO ID</span>
                      ) : c.drh_id ? (
                        <span style={{ fontSize: '11px', color: '#00c8e8' }}>{c.drh_id}</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      {c.phone && <span>📞 {c.phone}</span>}
                      {c.phone && c.address && <span> · </span>}
                      {c.address && <span>📍 {c.address?.split(',')[0]}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {query.length >= 2 && !searching && results.length === 0 && (
              <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '14px' }}>
                No customers found for "{query}"
              </div>
            )}
          </>
        )}

        {/* Selected customer header */}
        {selected && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#e2e8f0', textTransform: 'uppercase' }}>
                  {selected.name}
                </div>
                {selected.drh_id && (
                  <div style={{ color: '#00c8e8', fontSize: '13px', fontWeight: '600', marginTop: '2px' }}>{selected.drh_id}</div>
                )}
                {selected._nameOnly && (
                  <div style={{ color: '#f59e0b', fontSize: '11px', marginTop: '2px' }}>⚠️ No customer ID — matched by name</div>
                )}
                <div style={{ color: '#64748b', fontSize: '13px', marginTop: '6px' }}>
                  {selected.phone && <div>📞 {selected.phone}</div>}
                  {selected.address && <div>📍 {selected.address}</div>}
                </div>
              </div>
              <button onClick={clearSelection}
                style={{ background: 'none', border: '1px solid #334155', borderRadius: '8px', color: '#64748b', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>
                ← Back
              </button>
            </div>

            {!loading && (
              <div style={{ display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #334155' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '700' }}>{totalJobs}</div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Jobs</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '700' }}>{totalNotes}</div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Notes</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>
            Loading history...
          </div>
        )}

        {/* Job + note history */}
        {!loading && selected && jobs.length === 0 && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '14px' }}>
            No jobs found for this customer.
          </div>
        )}

        {!loading && jobs.map((job) => {
          const statusColor = STATUS_COLORS[job.status] || '#475569';
          return (
            <div key={job.id} style={{ marginBottom: '16px' }}>
              {/* Job header */}
              <div style={{ background: '#1e293b', borderRadius: '12px 12px 0 0', padding: '12px 16px', borderLeft: `3px solid ${statusColor}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#e2e8f0' }}>
                      {job.issue || job.job_type || 'Job'}
                    </div>
                    {job.job_number && (
                      <div style={{ color: '#38bdf8', fontSize: '11px', marginTop: '1px' }}>{job.job_number}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ background: `${statusColor}20`, color: statusColor, padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '600', border: `1px solid ${statusColor}40` }}>
                      {job.status?.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <div style={{ color: '#475569', fontSize: '11px', marginTop: '3px' }}>{fmtDate(job.created_at)}</div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {job.notes?.length > 0 ? (
                <div style={{ background: '#0f172a', borderRadius: '0 0 12px 12px', border: '1px solid #1e293b', borderTop: 'none' }}>
                  {job.notes.map((note, ni) => (
                    <div key={note.id} style={{
                      padding: '12px 16px',
                      borderBottom: ni < job.notes.length - 1 ? '1px solid #1e293b' : 'none',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ color: '#00c8e8', fontSize: '11px', fontWeight: '600' }}>
                          {resolveAuthor(note.created_by)}
                        </span>
                        <span style={{ color: '#475569', fontSize: '11px' }}>
                          {fmtDateTime(note.created_at)}
                        </span>
                      </div>
                      <div style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                        {note.text}
                      </div>
                      {(note.from_status || note.to_status) && (
                        <div style={{ color: '#475569', fontSize: '10px', marginTop: '4px' }}>
                          {note.from_status?.replace(/_/g, ' ')} → {note.to_status?.replace(/_/g, ' ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: '#0f172a', borderRadius: '0 0 12px 12px', border: '1px solid #1e293b', borderTop: 'none', padding: '10px 16px' }}>
                  <span style={{ color: '#334155', fontSize: '12px', fontStyle: 'italic' }}>No notes on this job</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
