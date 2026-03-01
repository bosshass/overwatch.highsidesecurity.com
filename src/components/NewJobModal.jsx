// ============================================
// JUC-E V4 - NewJobModal
// ============================================
// + button → pick Job or Task
// TASK = super simple: what + who
// JOB  = customer search, type, assign, expandable details

import { useState, useEffect, useCallback } from 'react';
import { jobsApi, customersApi, assignmentsApi, techsApi, JOB_STATUS } from '../services/supabase.js';
import { JOB_TYPE_INFO, JOB_TYPE_PICKER, PRIORITY_INFO } from '../utils/statusMachine.js';

export default function NewJobModal({ onClose, onCreated, userEmail, prefill = null }) {
  const [mode, setMode] = useState(prefill ? 'job' : null); // null = picker, 'job', 'task'
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState(prefill?.customerName || '');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(!prefill?.customerName);
  const [isSaving, setIsSaving] = useState(false);
  const [techs, setTechs] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [showMore, setShowMore] = useState(false);

  useEffect(() => { techsApi.getAll().then(setTechs).catch(() => {}); }, []);

  const [form, setForm] = useState({
    customer_name: prefill?.customerName || '',
    customer_address: prefill?.address || '',
    customer_phone: '',
    job_type: prefill?.jobType || 'service_res',
    priority: 'normal',
    issue: prefill?.issue || '',
    gate_code: '',
    panel_password: '',
    cms_account_id: ''
  });

  // Task-only state
  const [taskForm, setTaskForm] = useState({ title: '', assignedTo: '' });

  // Quick Note state
  const [noteForm, setNoteForm] = useState({ content: '', customerName: '', assignedTo: '' });

  const searchCustomers = useCallback(async (q) => {
    if (!q || q.length < 2) { setCustomers([]); return; }
    try { setCustomers(await customersApi.search(q)); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchCustomers]);

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setForm(f => ({
      ...f,
      customer_name: customer.name,
      customer_address: customer.address || '',
      customer_phone: customer.phone || '',
      gate_code: customer.gate_code || '',
      panel_password: customer.panel_password || '',
      cms_account_id: customer.cms_account_id || ''
    }));
    setShowCustomerSearch(false);
    setSearchQuery(customer.name);
  };

  // Submit Quick Note (creates a job with note type that can be assigned later)
  const handleSubmitNote = async () => {
    if (!noteForm.content.trim()) return;
    setIsSaving(true);
    try {
      const job = await jobsApi.create({
        customer_name: noteForm.customerName.trim() || '📌 Quick Note',
        customer_address: '',
        customer_phone: '',
        job_type: 'note',
        priority: 'normal',
        issue: noteForm.content.trim(),
        notes: `[QUICK NOTE - ${new Date().toLocaleString()}]\n${noteForm.content.trim()}`,
        status: JOB_STATUS.NEW
      }, userEmail);
      if (noteForm.assignedTo && job?.id) {
        // Soft assign — creates assignment but doesn't change status to SCHEDULED
        // Job stays NEW so it goes through proper scheduling flow
        await assignmentsApi.create({ job_id: job.id, tech_id: noteForm.assignedTo, scheduled_for: null }, userEmail);
      }
      onClose();
      try { onCreated?.(job); } catch (_) {}
    } catch (e) {
      console.error('Create note error:', e);
      alert('Error saving note: ' + e.message);
      setIsSaving(false);
    }
  };

  // Submit JOB
  const handleSubmitJob = async () => {
    if (!form.customer_name.trim()) return;
    setIsSaving(true);
    try {
      let customerId = selectedCustomer?.id;
      if (!customerId && form.customer_name.trim()) {
        const newCustomer = await customersApi.create({
          name: form.customer_name.trim(),
          address: form.customer_address,
          phone: form.customer_phone,
          gate_code: form.gate_code,
          panel_password: form.panel_password,
          cms_account_id: form.cms_account_id,
          is_active: true
        });
        customerId = newCustomer.id;
      }
      const job = await jobsApi.create({
        customer_id: customerId,
        customer_name: form.customer_name.trim(),
        customer_address: form.customer_address,
        customer_phone: form.customer_phone,
        job_type: form.job_type,
        priority: form.priority,
        issue: form.issue,
        gate_code: form.gate_code,
        panel_password: form.panel_password,
        cms_account_id: form.cms_account_id,
        status: JOB_STATUS.NEW
      }, userEmail);
      if (assignedTo && job?.id) {
        // Soft assign — creates assignment but doesn't change status to SCHEDULED
        // Job stays NEW so it goes through proper scheduling flow via ScheduleModal
        await assignmentsApi.create({ job_id: job.id, tech_id: assignedTo, scheduled_for: null }, userEmail);
      }
      onClose();
      try { onCreated?.(job); } catch (_) {}
    } catch (e) {
      console.error('Create job error:', e);
      alert('Error creating job: ' + e.message);
      setIsSaving(false);
    }
  };

  // Submit TASK
  const handleSubmitTask = async () => {
    if (!taskForm.title.trim()) return;
    setIsSaving(true);
    try {
      const job = await jobsApi.create({
        customer_name: '📝 Task',
        customer_address: '',
        customer_phone: '',
        job_type: 'task',
        priority: 'normal',
        issue: taskForm.title.trim(),
        status: JOB_STATUS.NEW
      }, userEmail);
      if (taskForm.assignedTo && job?.id) {
        // Soft assign — creates assignment but doesn't change status to SCHEDULED
        await assignmentsApi.create({ job_id: job.id, tech_id: taskForm.assignedTo, scheduled_for: null }, userEmail);
      }
      onClose();
      try { onCreated?.(job); } catch (_) {}
    } catch (e) {
      console.error('Create task error:', e);
      alert('Error creating task: ' + e.message);
      setIsSaving(false);
    }
  };

  const fieldStyle = {
    width: '100%', background: '#0f1729', border: '1px solid #334155', borderRadius: '8px',
    color: '#e2e8f0', padding: '10px 12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
  };
  const labelStyle = { color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '4px' };

  // ========== MODE PICKER ==========
  if (!mode) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
      }}>
        <div style={{ background: '#0f1729', borderRadius: '20px', padding: '28px 24px', width: '100%', maxWidth: '340px', border: '1px solid #1e293b' }}>
          <h2 style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '800', margin: '0 0 6px 0', textAlign: 'center' }}>
            What are you adding?
          </h2>
          <p style={{ color: '#475569', fontSize: '13px', textAlign: 'center', margin: '0 0 24px 0' }}>
            Jobs track customer work. Tasks are to-dos. Notes are quick captures.
          </p>

          <button
            onClick={() => setMode('note')}
            style={{
              width: '100%', background: '#22c55e20', border: '1px solid #22c55e50', borderRadius: '14px',
              padding: '18px 16px', cursor: 'pointer', marginBottom: '10px', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: '14px'
            }}
          >
            <span style={{ fontSize: '28px' }}>📌</span>
            <div>
              <div style={{ color: '#22c55e', fontSize: '16px', fontWeight: '700' }}>Quick Note</div>
              <div style={{ color: '#64748b', fontSize: '12px' }}>Capture now, assign later</div>
            </div>
          </button>

          <button
            onClick={() => setMode('job')}
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: '14px',
              padding: '18px 16px', cursor: 'pointer', marginBottom: '10px', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: '14px'
            }}
          >
            <span style={{ fontSize: '28px' }}>🔧</span>
            <div>
              <div style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: '700' }}>Job</div>
              <div style={{ color: '#64748b', fontSize: '12px' }}>Customer, type, priority, details</div>
            </div>
          </button>

          <button
            onClick={() => setMode('task')}
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: '14px',
              padding: '18px 16px', cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: '14px'
            }}
          >
            <span style={{ fontSize: '28px' }}>📝</span>
            <div>
              <div style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: '700' }}>Task</div>
              <div style={{ color: '#64748b', fontSize: '12px' }}>Quick — what + who</div>
            </div>
          </button>

          <button onClick={onClose} style={{
            width: '100%', background: 'none', border: 'none', color: '#475569',
            fontSize: '14px', cursor: 'pointer', marginTop: '16px', padding: '8px'
          }}>Cancel</button>
        </div>
      </div>
    );
  }

  // ========== QUICK NOTE MODE ==========
  if (mode === 'note') {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
      }}>
        <div style={{ background: '#0f1729', borderRadius: '20px', padding: '24px 20px', width: '100%', maxWidth: '380px', border: '1px solid #22c55e50' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}>← Back</button>
            <span style={{ color: '#22c55e', fontWeight: '700', fontSize: '16px' }}>📌 Quick Note</span>
            <div style={{ width: '40px' }} />
          </div>

          {/* Note content */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>What do you need to capture?</label>
            <textarea
              value={noteForm.content}
              onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Customer called about issue, need to follow up on estimate, parts arrived..."
              rows={4}
              autoFocus
              style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit', fontSize: '15px' }}
            />
          </div>

          {/* Customer (optional) */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Customer (optional)</label>
            <input
              value={noteForm.customerName}
              onChange={e => setNoteForm(f => ({ ...f, customerName: e.target.value }))}
              placeholder="Search or type customer name..."
              style={fieldStyle}
            />
          </div>

          {/* Assign (optional) */}
          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Assign to (optional)</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setNoteForm(f => ({ ...f, assignedTo: '' }))}
                style={{
                  background: !noteForm.assignedTo ? '#22c55e20' : '#1e293b',
                  color: !noteForm.assignedTo ? '#22c55e' : '#64748b',
                  border: `1px solid ${!noteForm.assignedTo ? '#22c55e' : '#334155'}`,
                  borderRadius: '8px', padding: '10px 14px', fontSize: '14px', cursor: 'pointer', fontWeight: '600'
                }}
              >Unassigned</button>
              {techs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setNoteForm(f => ({ ...f, assignedTo: t.id }))}
                  style={{
                    background: noteForm.assignedTo === t.id ? '#22c55e20' : '#1e293b',
                    color: noteForm.assignedTo === t.id ? '#22c55e' : '#94a3b8',
                    border: `1px solid ${noteForm.assignedTo === t.id ? '#22c55e' : '#334155'}`,
                    borderRadius: '8px', padding: '10px 14px', fontSize: '14px', cursor: 'pointer', fontWeight: '600'
                  }}
                >{t.name}</button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmitNote}
            disabled={!noteForm.content.trim() || isSaving}
            style={{
              width: '100%', padding: '14px', borderRadius: '12px', border: 'none', fontSize: '15px',
              fontWeight: '700', cursor: noteForm.content.trim() ? 'pointer' : 'default',
              background: noteForm.content.trim() ? '#22c55e' : '#334155',
              color: noteForm.content.trim() ? '#fff' : '#64748b'
            }}
          >{isSaving ? 'Saving...' : '✓ Save Note'}</button>
          
          <div style={{ color: '#64748b', fontSize: '11px', textAlign: 'center', marginTop: '12px' }}>
            Quick notes become jobs you can assign to customers later
          </div>
        </div>
      </div>
    );
  }

  // ========== TASK MODE (hella simple) ==========
  if (mode === 'task') {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
      }}>
        <div style={{ background: '#0f1729', borderRadius: '20px', padding: '24px 20px', width: '100%', maxWidth: '380px', border: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}>← Back</button>
            <span style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>📝 Quick Task</span>
            <div style={{ width: '40px' }} />
          </div>

          {/* What */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>What needs to happen?</label>
            <textarea
              value={taskForm.title}
              onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Order parts for Johnson, Call Vinyard about estimate..."
              rows={2}
              autoFocus
              style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit', fontSize: '15px' }}
            />
          </div>

          {/* Who */}
          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Assign to</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setTaskForm(f => ({ ...f, assignedTo: '' }))}
                style={{
                  background: !taskForm.assignedTo ? '#00c8e820' : '#1e293b',
                  color: !taskForm.assignedTo ? '#00c8e8' : '#64748b',
                  border: `1px solid ${!taskForm.assignedTo ? '#00c8e8' : '#334155'}`,
                  borderRadius: '8px', padding: '10px 14px', fontSize: '14px', cursor: 'pointer', fontWeight: '600'
                }}
              >Nobody</button>
              {techs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTaskForm(f => ({ ...f, assignedTo: t.id }))}
                  style={{
                    background: taskForm.assignedTo === t.id ? '#00c8e820' : '#1e293b',
                    color: taskForm.assignedTo === t.id ? '#00c8e8' : '#94a3b8',
                    border: `1px solid ${taskForm.assignedTo === t.id ? '#00c8e8' : '#334155'}`,
                    borderRadius: '8px', padding: '10px 14px', fontSize: '14px', cursor: 'pointer', fontWeight: '600'
                  }}
                >{t.name}</button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmitTask}
            disabled={!taskForm.title.trim() || isSaving}
            style={{
              width: '100%', padding: '14px', borderRadius: '12px', border: 'none', fontSize: '15px',
              fontWeight: '700', cursor: taskForm.title.trim() ? 'pointer' : 'default',
              background: taskForm.title.trim() ? '#22c55e' : '#334155',
              color: taskForm.title.trim() ? '#fff' : '#64748b'
            }}
          >{isSaving ? 'Creating...' : 'Create Task'}</button>
        </div>
      </div>
    );
  }

  // ========== JOB MODE (slimmed, expandable details) ==========
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200,
      overflowY: 'auto', paddingBottom: '100px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, background: '#0f1729', zIndex: 10
      }}>
        <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer' }}>
          ← Back
        </button>
        <span style={{ color: '#e2e8f0', fontWeight: '600' }}>🔧 New Job</span>
        <button
          onClick={handleSubmitJob}
          disabled={!form.customer_name.trim() || isSaving}
          style={{
            background: form.customer_name.trim() ? '#00c8e8' : '#334155',
            color: form.customer_name.trim() ? '#000' : '#64748b',
            border: 'none', borderRadius: '8px', padding: '8px 16px',
            fontSize: '14px', fontWeight: '600', cursor: form.customer_name.trim() ? 'pointer' : 'default'
          }}
        >
          {isSaving ? 'Creating...' : 'Create'}
        </button>
      </div>

      <div style={{ padding: '16px' }}>
        {/* Customer search */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Customer *</label>
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowCustomerSearch(true); setSelectedCustomer(null); setForm(f => ({ ...f, customer_name: e.target.value })); }}
            placeholder="Search or type new customer name..."
            autoFocus
            style={fieldStyle}
          />
          {showCustomerSearch && customers.length > 0 && (
            <div style={{ background: '#1e293b', borderRadius: '8px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto', border: '1px solid #334155' }}>
              {customers.map(c => (
                <div
                  key={c.id}
                  onClick={() => selectCustomer(c)}
                  style={{
                    padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #0f1729',
                    background: selectedCustomer?.id === c.id ? '#00c8e815' : 'transparent'
                  }}
                >
                  <div style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '500' }}>{c.name}</div>
                  {c.address && <div style={{ color: '#64748b', fontSize: '12px' }}>{c.address}</div>}
                </div>
              ))}
            </div>
          )}
          {showCustomerSearch && searchQuery.length >= 2 && customers.length === 0 && (
            <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px', padding: '8px' }}>
              No match — will create new customer.
            </div>
          )}
        </div>

        {/* Issue — right after customer */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Issue / Description</label>
          <textarea value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} placeholder="What's the job?" rows={2} style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {/* Phone — visible by default */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Phone</label>
          <input value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} placeholder="(303) 555-0000" style={fieldStyle} />
        </div>

        {/* Type */}
        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Type</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {JOB_TYPE_PICKER.map(key => {
              const info = JOB_TYPE_INFO[key];
              return (
              <button
                key={key}
                onClick={() => setForm(f => ({ ...f, job_type: key }))}
                style={{
                  background: form.job_type === key ? info.color : '#1e293b',
                  color: form.job_type === key ? '#fff' : '#94a3b8',
                  border: `1px solid ${form.job_type === key ? info.color : '#334155'}`,
                  borderRadius: '8px', padding: '8px 12px', fontSize: '12px',
                  cursor: 'pointer', fontWeight: '600'
                }}
              >
                {info.icon} {info.label}
              </button>
              );
            })}
          </div>
        </div>

        {/* Assign To */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Assign To</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setAssignedTo('')}
              style={{
                background: !assignedTo ? '#00c8e820' : '#1e293b',
                color: !assignedTo ? '#00c8e8' : '#64748b',
                border: `1px solid ${!assignedTo ? '#00c8e8' : '#334155'}`,
                borderRadius: '8px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer'
              }}
            >Unassigned</button>
            {techs.map(t => (
              <button
                key={t.id}
                onClick={() => setAssignedTo(t.id)}
                style={{
                  background: assignedTo === t.id ? '#00c8e820' : '#1e293b',
                  color: assignedTo === t.id ? '#00c8e8' : '#94a3b8',
                  border: `1px solid ${assignedTo === t.id ? '#00c8e8' : '#334155'}`,
                  borderRadius: '8px', padding: '8px 12px', fontSize: '12px',
                  cursor: 'pointer', fontWeight: '600'
                }}
              >{t.name}</button>
            ))}
          </div>
        </div>

        {/* Expandable: Priority + Address + Access Codes */}
        <button
          onClick={() => setShowMore(!showMore)}
          style={{
            width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
            padding: '12px', color: '#64748b', fontSize: '13px', cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'
          }}
        >
          <span>{showMore ? '▾' : '▸'} More Details — Priority, Address, Access Codes</span>
          {(form.priority !== 'normal' || form.gate_code || form.panel_password) && (
            <span style={{ color: '#f59e0b', fontSize: '11px' }}>●</span>
          )}
        </button>

        {showMore && (
          <div style={{ background: '#1e293b15', borderRadius: '10px', padding: '12px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Priority */}
            <div>
              <label style={labelStyle}>Priority</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {Object.entries(PRIORITY_INFO).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => setForm(f => ({ ...f, priority: key }))}
                    style={{
                      background: form.priority === key ? `${info.color}30` : '#0f1729',
                      color: form.priority === key ? info.color : '#64748b',
                      border: `1px solid ${form.priority === key ? info.color : '#334155'}`,
                      borderRadius: '8px', padding: '7px 12px', fontSize: '12px', cursor: 'pointer'
                    }}
                  >
                    {info.icon} {info.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Address */}
            <div>
              <label style={labelStyle}>Address</label>
              <input value={form.customer_address} onChange={e => setForm(f => ({ ...f, customer_address: e.target.value }))} placeholder="123 Main St" style={fieldStyle} />
            </div>

            {/* Access codes */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Gate Code</label>
                <input value={form.gate_code} onChange={e => setForm(f => ({ ...f, gate_code: e.target.value }))} placeholder="#1234" style={fieldStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Panel Password</label>
                <input value={form.panel_password} onChange={e => setForm(f => ({ ...f, panel_password: e.target.value }))} placeholder="****" style={fieldStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>CMS Account ID</label>
              <input value={form.cms_account_id} onChange={e => setForm(f => ({ ...f, cms_account_id: e.target.value }))} placeholder="DRH-0090" style={fieldStyle} />
            </div>
          </div>
        )}
        
        {/* Sticky bottom Create button */}
        <div style={{ 
          position: 'sticky', bottom: 0, background: '#0f1729', 
          padding: '16px 0', borderTop: '1px solid #1e293b', marginTop: '20px'
        }}>
          <button
            onClick={handleSubmitJob}
            disabled={!form.customer_name.trim() || isSaving}
            style={{
              width: '100%', padding: '16px', fontSize: '16px', fontWeight: '700',
              background: form.customer_name.trim() ? '#22c55e' : '#334155',
              color: form.customer_name.trim() ? '#fff' : '#64748b',
              border: 'none', borderRadius: '12px', cursor: form.customer_name.trim() ? 'pointer' : 'default'
            }}
          >
            {isSaving ? 'Creating...' : '✓ Create Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
