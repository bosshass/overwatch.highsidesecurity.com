// ============================================
// Overwatch — Customer History
// ============================================
// - Searches by name AND address
// - State stays sticky when viewing a job and going back
// - Catches customer_id-linked AND name-typed jobs

import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { customersApi, supabase } from '../services/supabase.js';

// ── helpers ──────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
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
  return names[email?.toLowerCase()] || email?.split('@')[0] || 'Unknown';
}

const STATUS_COLORS = {
  new: '#64748b', needs_details: '#f59e0b', ready_to_schedule: '#3b82f6',
  scheduled: '#00c8e8', completed: '#22c55e', complete: '#22c55e',
  billed: '#8b5cf6', to_bill: '#8b5cf6', archived: '#475569',
  blocked: '#ef4444', needs_parts: '#f97316', return_pending: '#f97316',
  won: '#22c55e', lost: '#ef4444', dead: '#334155',
};

function safeKeyword(str) {
  if (!str) return null;
  const words = str.trim().split(/\s+/).filter(w => w.length >= 4);
  return (words[0] || str.trim()).replace(/[%,()*']/g, '');
}

// ── data fetching ────────────────────────────────────────────

async function searchCustomers(q) {
  const safe = q.replace(/[%,()*']/g, ' ').trim();
  if (safe.length < 2) return { linked: [], nameOnly: [] };

  // 1. Linked customers (customers table) — by name, phone, address
  let linked = [];
  try {
    linked = await customersApi.search(q);
  } catch (_) {}

  // 2. Name-only jobs (no customer_id) — by name OR address
  let nameOnly = [];
  try {
    const { data } = await supabase
      .from('jobs')
      .select('customer_name, customer_id, customer_phone, customer_address')
      .is('customer_id', null)
      .or(`customer_name.ilike.%${safe}%,customer_address.ilike.%${safe}%`)
      .order('customer_name')
      .limit(200);

    const seen = new Set();
    const linkedNames = new Set(linked.map(c => c.name?.toLowerCase().trim()));
    nameOnly = (data || []).filter(j => {
      const key = j.customer_name?.toLowerCase().trim();
      if (!key || seen.has(key) || linkedNames.has(key)) return false;
      seen.add(key);
      return true;
    }).map(j => ({
      id: null,
      name: j.customer_name,
      phone: j.customer_phone,
      address: j.customer_address,
      _nameOnly: true,
    }));
  } catch (_) {}

  return { linked, nameOnly };
}

async function loadAllJobsForCustomer(customer) {
  const nameKw = safeKeyword(customer.name);
  const seen = new Set();
  const allJobs = [];

  const merge = (rows) => {
    for (const j of (rows || [])) {
      if (!seen.has(j.id)) { seen.add(j.id); allJobs.push(j); }
    }
  };

  // Query 1: by customer_id
  if (customer.id) {
    const { data } = await supabase.from('jobs').select('*')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false }).limit(200);
    merge(data);
  }

  // Query 2: by name keyword
  if (nameKw) {
    const { data } = await supabase.from('jobs').select('*')
      .ilike('customer_name', `%${nameKw}%`)
      .order('created_at', { ascending: false }).limit(200);
    merge(data);
  }

  // Query 3: by address keyword (first number+word from address)
  if (customer.address) {
    const addrWord = customer.address.trim().split(/\s+/).find(w => w.length >= 4 && !/^\d+$/.test(w));
    if (addrWord) {
      const { data } = await supabase.from('jobs').select('*')
        .ilike('customer_address', `%${addrWord}%`)
        .order('created_at', { ascending: false }).limit(100);
      merge(data);
    }
  }

  return allJobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function loadJobNotes(jobId) {
  const notes = [];

  const { data: history } = await supabase
    .from('job_history')
    .select('id, notes, changed_at, changed_by, from_status, to_status')
    .eq('job_id', jobId)
    .not('notes', 'is', null)
    .order('changed_at', { ascending: false });

  for (const h of (history || [])) {
    if (h.notes?.trim()) {
      notes.push({
        id: h.id,
        text: h.notes,
        created_at: h.changed_at,
        created_by: h.changed_by,
        from_status: h.from_status,
        to_status: h.to_status,
      });
    }
  }

  notes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return notes;
}

async function loadFullHistory(customer) {
  const jobs = await loadAllJobsForCustomer(customer);
  return Promise.all(jobs.map(async job => ({
    ...job,
    notes: await loadJobNotes(job.id),
  })));
}

// ── component ────────────────────────────────────────────────

// Sticky state — persists across back navigation within the same session
let _stickyQuery = '';
let _stickyResults = [];
let _stickySelected = null;
let _stickyJobs = [];

export default function CustomerHistory({ onBack }) {
  const location = useLocation();
  const [query, setQuery]       = useState(_stickyQuery);
  const [results, setResults]   = useState(_stickyResults);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(_stickySelected);
  const [jobs, setJobs]         = useState(_stickyJobs);
  const [loading, setLoading]   = useState(false);
  const debounceRef = useRef(null);

  // Sync sticky state on every change
  useEffect(() => { _stickyQuery = query; }, [query]);
  useEffect(() => { _stickyResults = results; }, [results]);
  useEffect(() => { _stickySelected = selected; }, [selected]);
  useEffect(() => { _stickyJobs = jobs; }, [jobs]);

  // Auto-search from GlobalSearch ?name= param
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nameParam = params.get('name');
    if (nameParam && nameParam.length >= 2 && !_stickySelected) {
      setQuery(nameParam);
      runSearch(nameParam);
    }
  }, [location.search]);

  const runSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const { linked, nameOnly } = await searchCustomers(q);
      setResults([...linked, ...nameOnly]);
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
    setLoading(true);
    try {
      const jobData = await loadFullHistory(customer);
      setJobs(jobData);
    } catch (_) {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    _stickySelected = null;
    setJobs([]);
    _stickyJobs = [];
    // Keep query + results so search stays sticky
  };

  const handleBack = () => {
    if (selected) { clearSelection(); }
    else {
      // Full reset on leaving the screen
      _stickyQuery = ''; _stickyResults = []; _stickySelected = null; _stickyJobs = [];
      onBack();
    }
  };

  const totalNotes = jobs.reduce((sum, j) => sum + (j.notes?.length || 0), 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: 100 }}>

      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: '12px', position: 'sticky', top: 0, background: '#0f1729', zIndex: 10 }}>
        <button onClick={handleBack}
          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '16px', cursor: 'pointer', padding: '4px 0' }}>←</button>
        <div style={{ fontSize: '16px', fontWeight: '700', color: '#e2e8f0' }}>
          {selected ? selected.name : '👤 Customer History'}
        </div>
      </div>

      <div style={{ padding: '16px' }}>

        {/* ── SEARCH ── */}
        {!selected && (
          <>
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <input
                autoFocus
                value={query}
                onChange={handleInput}
                placeholder="Name, phone, or address..."
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
                      {c._nameOnly
                        ? <span style={{ fontSize: '10px', color: '#64748b', background: '#334155', padding: '2px 6px', borderRadius: '4px' }}>NO ID</span>
                        : c.drh_id
                          ? <span style={{ fontSize: '11px', color: '#00c8e8' }}>{c.drh_id}</span>
                          : null}
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

        {/* ── CUSTOMER HEADER ── */}
        {selected && !loading && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                {selected.drh_id && (
                  <div style={{ color: '#00c8e8', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>{selected.drh_id}</div>
                )}
                {selected._nameOnly && (
                  <div style={{ color: '#f59e0b', fontSize: '11px', marginBottom: '4px' }}>⚠️ No customer ID</div>
                )}
                <div style={{ color: '#64748b', fontSize: '13px' }}>
                  {selected.phone && <div>📞 {selected.phone}</div>}
                  {selected.address && <div>📍 {selected.address}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '20px', textAlign: 'center' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '22px', fontWeight: '800' }}>{jobs.length}</div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Jobs</div>
                </div>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '22px', fontWeight: '800' }}>{totalNotes}</div>
                  <div style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase' }}>Notes</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '60px 0', fontSize: '14px' }}>
            Loading history...
          </div>
        )}

        {!loading && selected && jobs.length === 0 && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '14px' }}>
            No jobs found for this customer.
          </div>
        )}

        {/* ── JOB + NOTE THREAD ── */}
        {!loading && jobs.map((job) => {
          const statusColor = STATUS_COLORS[job.status] || '#475569';
          return (
            <div key={job.id} style={{ marginBottom: '20px' }}>
              <div style={{
                background: '#1e293b', borderRadius: '12px 12px 0 0',
                padding: '14px 16px', borderLeft: `3px solid ${statusColor}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#e2e8f0' }}>
                      {job.issue || job.job_type?.replace(/_/g, ' ') || 'Job'}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {job.job_number && <span style={{ color: '#38bdf8', fontSize: '11px' }}>{job.job_number}</span>}
                      {(job.tech_name || job.tech_assigned) && (
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>👷 {job.tech_name || job.tech_assigned}</span>
                      )}
                      {job.scheduled_for && (
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                          📅 {new Date(job.scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {job.actual_hours > 0 && (
                        <span style={{ color: '#00c8e8', fontSize: '11px' }}>⏱ {Number(job.actual_hours).toFixed(1)}h</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{
                      background: `${statusColor}20`, color: statusColor,
                      padding: '2px 8px', borderRadius: '4px', fontSize: '10px',
                      fontWeight: '600', border: `1px solid ${statusColor}40`
                    }}>
                      {job.status?.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px' }}>
                      {fmtDate(job.created_at)}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{
                background: '#0f172a', borderRadius: '0 0 12px 12px',
                border: '1px solid #1e293b', borderTop: 'none'
              }}>
                {job.notes?.length > 0 ? job.notes.map((note, ni) => (
                  <div key={note.id} style={{
                    padding: '12px 16px',
                    borderBottom: ni < job.notes.length - 1 ? '1px solid #1a2540' : 'none',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                      <span style={{ color: '#00c8e8', fontSize: '12px', fontWeight: '700' }}>
                        {resolveAuthor(note.created_by)}
                      </span>
                      <span style={{ color: '#475569', fontSize: '11px' }}>
                        {fmtDateTime(note.created_at)}
                      </span>
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                      {note.text}
                    </div>
                    {note.from_status && note.to_status && note.from_status !== note.to_status && (
                      <div style={{ color: '#334155', fontSize: '10px', marginTop: '4px' }}>
                        {note.from_status.replace(/_/g, ' ')} → {note.to_status.replace(/_/g, ' ')}
                      </div>
                    )}
                  </div>
                )) : (
                  <div style={{ padding: '10px 16px' }}>
                    <span style={{ color: '#334155', fontSize: '12px', fontStyle: 'italic' }}>No notes</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// cache bust Mon Jun 29 11:29:32 MDT 2026
