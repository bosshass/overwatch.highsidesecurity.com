import { useState, useEffect, useRef } from 'react';
import { jobLinkingApi } from '../services/supabase.js';

// Props:
//   returnCard   — return_card being linked (pass null when linking a calendar event)
//   skipDbLink   — if true, skip the linkReturnCard DB call (caller handles persistence)
//   onCreateNew  — optional callback(customerName) shown as "Create New Project" at bottom
//   onLink(jobId, jobLabel) — called on confirm
//   onClose()


const STATUS_LABELS = {
  estimate_sent: 'Estimate Out',
  won:           'Won',
  ready_to_schedule: 'Ready',
  scheduled:     'Scheduled',
  needs_parts:   'Needs Parts',
  pending_materials: 'Pending Materials',
  pending_decision: 'Pending Decision',
  to_bill:       'To Bill',
  complete:      'Complete',
};

const STATUS_COLORS = {
  estimate_sent:     '#f59e0b',
  won:               '#22c55e',
  ready_to_schedule: '#22c55e',
  scheduled:         '#3b82f6',
  needs_parts:       '#ef4444',
  pending_materials: '#f97316',
  pending_decision:  '#a855f7',
  to_bill:           '#8b5cf6',
  complete:          '#10b981',
};

// Operator-only modal: search for a P- or S- job and link a return card to it.
// Props:
//   returnCard  — the return_card object being linked
//   onLink(jobId, jobLabel) — called when operator confirms selection
//   onClose() — called to dismiss without linking
export default function JobSearchModal({ returnCard, skipDbLink, onCreateNew, onLink, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Pre-populate search with customer name from the return card
    const initial = returnCard?.customer_name_raw || '';
    setQuery(initial);
    if (inputRef.current) inputRef.current.focus();
  }, [returnCard]);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const doSearch = async (q) => {
    setLoading(true);
    setError(null);
    try {
      const data = await jobLinkingApi.search(q);
      setResults(data);
    } catch (e) {
      setError('Search failed');
    }
    setLoading(false);
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setLinking(true);
    setError(null);
    try {
      if (!skipDbLink && returnCard?.id) {
        await jobLinkingApi.linkReturnCard(returnCard.id, selected.id);
      }
      const label = selected.p_number || selected.s_number;
      onLink(selected.id, label);
    } catch (e) {
      setError('Link failed: ' + e.message);
      setLinking(false);
    }
  };

  const handleCreateNew = async () => {
    const name = query.trim() || returnCard?.customer_name_raw || 'New Project';
    setLinking(true);
    setError(null);
    try {
      const job = await jobLinkingApi.createProjectJob(name);
      if (!skipDbLink && returnCard?.id) {
        await jobLinkingApi.linkReturnCard(returnCard.id, job.id);
      }
      onLink(job.id, job.p_number);
    } catch (e) {
      setError('Create failed: ' + e.message);
      setLinking(false);
    }
  };

  const projects = results.filter(j => j.p_number);
  const serviceCalls = results.filter(j => j.s_number && !j.p_number);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9000, padding: 16,
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 12, padding: 24,
        width: '100%', maxWidth: 480, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Link to Job</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {returnCard?.customer_name_raw || 'Return card'} · {returnCard?.reason || ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Search input */}
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null); }}
          placeholder="Search by customer name, P-001, S-001…"
          style={{
            background: '#0f172a', border: '1px solid #334155',
            borderRadius: 8, padding: '10px 14px',
            color: '#fff', fontSize: 14, outline: 'none', width: '100%',
            boxSizing: 'border-box',
          }}
        />

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 20, fontSize: 13 }}>Searching…</div>
          )}

          {!loading && results.length === 0 && query.length > 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 20, fontSize: 13 }}>
              No jobs found. Check that the estimate was sent (to get a P-number) or the job was scheduled (S-number).
            </div>
          )}

          {projects.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Projects (P-)
              </div>
              {projects.map(job => (
                <JobRow key={job.id} job={job} selected={selected?.id === job.id} onSelect={setSelected} />
              ))}
            </div>
          )}

          {serviceCalls.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Service Calls (S-)
              </div>
              {serviceCalls.map(job => (
                <JobRow key={job.id} job={job} selected={selected?.id === job.id} onSelect={setSelected} />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '10px 0', background: '#334155', border: 'none',
                borderRadius: 8, color: '#fff', fontSize: 14, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selected || linking}
              style={{
                flex: 2, padding: '10px 0',
                background: selected ? '#3b82f6' : '#1e3a5f',
                border: 'none', borderRadius: 8, color: '#fff',
                fontSize: 14, fontWeight: 600,
                cursor: selected ? 'pointer' : 'not-allowed',
                opacity: linking ? 0.7 : 1,
              }}
            >
              {linking ? 'Linking…' : selected ? `Link to ${selected.p_number || selected.s_number}` : 'Select a job'}
            </button>
          </div>
          <button
            onClick={handleCreateNew}
            disabled={linking}
            style={{
              width: '100%', padding: '10px 0',
              background: 'none', border: '1px dashed #3b82f6',
              borderRadius: 8, color: '#60a5fa',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: linking ? 0.7 : 1,
            }}
          >
            {linking ? 'Creating…' : `+ Create new project${query.trim() ? ` — "${query.trim()}"` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, selected, onSelect }) {
  const num = job.p_number || job.s_number;
  const isProject = !!job.p_number;
  const statusLabel = STATUS_LABELS[job.status] || job.status;
  const statusColor = STATUS_COLORS[job.status] || '#64748b';

  return (
    <div
      onClick={() => onSelect(job)}
      style={{
        background: selected ? '#1e3a5f' : '#0f172a',
        border: `1px solid ${selected ? '#3b82f6' : '#334155'}`,
        borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
        marginBottom: 4, transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: isProject ? '#1d4ed8' : '#4338ca',
            color: '#fff', fontSize: 11, fontWeight: 700,
            padding: '2px 7px', borderRadius: 4,
          }}>
            {num}
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>
            {job.customer_name}
          </span>
        </div>
        <span style={{
          fontSize: 11, color: statusColor,
          background: statusColor + '22', padding: '2px 6px', borderRadius: 4,
        }}>
          {statusLabel}
        </span>
      </div>
      {job.issue && (
        <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {job.issue}
        </div>
      )}
      {job.customer_address && (
        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
          {job.customer_address}
        </div>
      )}
    </div>
  );
}
