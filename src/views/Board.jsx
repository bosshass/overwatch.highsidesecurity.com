// ============================================
// Jovelin — Board
// ============================================
// Kanban over the tasks table — the SAME table Time/Work Today reads and
// writes to. A card added here with today's due_date shows up in Today,
// and a task/job added in Today shows up here — same data, two views.
// Four generic, tenant-agnostic columns: New, In Progress, Blocked,
// Complete. Any card with logged hours (time_entries.task_id) shows its
// total right on the card face.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useAssignableUsers, AssigneeSelect } from '../utils/useAssignableUsers.jsx';
import { apiFetch } from '../services/apiFetch.js';

const TEAL = '#0D4F5C', GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626';
const BG = '#f7f9fa', CARD = '#ffffff', BORDER = '#e5e9eb', TEXT = '#1c1c1e', SUBTEXT = '#6b7787';
const inputStyle = { width: '100%', padding: '9px 11px', fontSize: 14, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, boxSizing: 'border-box' };
const labelStyle = { fontSize: 11, fontWeight: 700, color: SUBTEXT, textTransform: 'uppercase', marginBottom: 4, display: 'block' };

const COLUMNS = [
  { key: 'new', label: 'New', color: '#64748b' },
  { key: 'in_progress', label: 'In Progress', color: TEAL },
  { key: 'blocked', label: 'Blocked', color: RED },
  { key: 'complete', label: 'Complete', color: GREEN },
];

const today = () => new Date().toISOString().slice(0, 10);
const fmtHrs = (mins) => `${(mins / 60).toFixed(1)}h`;
const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};
const encodeCustomer = (source, id) => `${source}:${id}`;
const decodeCustomer = (val) => { const i = val.indexOf(':'); return { source: val.slice(0, i), id: val.slice(i + 1) }; };

export default function Board() {
  const { currentTenantId, currentTenant } = useTenant();
  const [tasks, setTasks] = useState([]);
  const [hoursByTask, setHoursByTask] = useState({});
  const [loading, setLoading] = useState(true);
  const [qboCustomers, setQboCustomers] = useState([]);
  const [localCustomers, setLocalCustomers] = useState([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');

  const [addMode, setAddMode] = useState(null); // null | 'task' | 'job'
  const [taskTitle, setTaskTitle] = useState('');
  const [jobForm, setJobForm] = useState({ customer: '', title: '', scheduled_time: '', due_date: today(), assigned_to: '' });
  const [taskAssignee, setTaskAssignee] = useState('');
  const assignableUsers = useAssignableUsers(currentTenantId);

  const load = useCallback(async () => {
    if (!currentTenantId) return;
    setLoading(true);
    const { data: taskRows } = await supabase.from('tasks').select('*')
      .eq('tenant_id', currentTenantId).order('created_at', { ascending: false });
    const list = taskRows || [];
    setTasks(list);

    if (list.length) {
      const { data: entries } = await supabase.from('time_entries').select('task_id, total_minutes')
        .eq('tenant_id', currentTenantId).in('task_id', list.map(t => t.id));
      const sums = {};
      (entries || []).forEach(e => { if (e.task_id) sums[e.task_id] = (sums[e.task_id] || 0) + (e.total_minutes || 0); });
      setHoursByTask(sums);
    } else {
      setHoursByTask({});
    }
    setLoading(false);
  }, [currentTenantId]);

  const loadCustomers = useCallback(async () => {
    if (!currentTenantId) return;
    const [qboRes, localRes] = await Promise.all([
      apiFetch(`/api/qbo/lists?tenant_id=${currentTenantId}`).then(r => r.json()).catch(() => ({ customers: [] })),
      supabase.from('customers').select('id, name').eq('tenant_id', currentTenantId).is('merged_into', null).order('name'),
    ]);
    setQboCustomers(qboRes.customers || []);
    setLocalCustomers(localRes.data || []);
  }, [currentTenantId]);

  useEffect(() => { load(); loadCustomers(); }, [load, loadCustomers]);

  const [completingTask, setCompletingTask] = useState(null);
  const [completeHours, setCompleteHours] = useState('');

  const moveTask = async (task, newStatus) => {
    // Completing a card that has a customer needs hours captured first —
    // same rule as Today: billable work doesn't get marked done for free.
    if (newStatus === 'complete' && (task.qbo_customer_id || task.local_customer_id)) {
      setCompletingTask(task); setCompleteHours('');
      return;
    }
    await supabase.from('tasks').update({
      status: newStatus, completed_at: newStatus === 'complete' ? new Date().toISOString() : null,
    }).eq('id', task.id);
    load();
  };

  const confirmCompletion = async () => {
    const hrs = parseFloat(completeHours);
    if (!hrs || hrs <= 0) { alert('Enter hours worked to complete this job.'); return; }
    await supabase.from('time_entries').insert({
      tenant_id: currentTenantId, work_date: today(), total_minutes: Math.round(hrs * 60),
      qbo_customer_id: completingTask.qbo_customer_id || null,
      qbo_customer_name: completingTask.qbo_customer_id ? completingTask.qbo_customer_name : null,
      local_customer_id: completingTask.local_customer_id || null,
      task_id: completingTask.id, disposition: 'billable', notes: completingTask.title, billed: false,
    });
    await supabase.from('tasks').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', completingTask.id);
    setCompletingTask(null);
    load();
  };

  const addTaskCard = async () => {
    if (!taskTitle.trim()) return;
    // due_date matters: Today's view filters by it, so a card added here
    // without one would never show up there — this is the fix for that.
    await supabase.from('tasks').insert({
      tenant_id: currentTenantId, title: taskTitle.trim(), status: 'new',
      due_date: today(), assigned_to: taskAssignee || null,
    });
    setTaskAssignee('');
    setTaskTitle(''); setAddMode(null);
    load();
  };

  const addJobCard = async () => {
    if (!jobForm.customer) { alert('Pick a customer for this job.'); return; }
    if (!jobForm.title.trim()) { alert('Give the job a short description.'); return; }
    const { source, id } = decodeCustomer(jobForm.customer);
    const row = {
      tenant_id: currentTenantId, title: jobForm.title.trim(), status: 'new',
      due_date: jobForm.due_date || today(), scheduled_time: jobForm.scheduled_time || null,
      assigned_to: jobForm.assigned_to || null,
    };
    if (source === 'qbo') {
      const c = qboCustomers.find(x => x.id === id);
      row.qbo_customer_id = c?.id || null; row.qbo_customer_name = c?.name || null;
    } else {
      const c = localCustomers.find(x => x.id === id);
      row.local_customer_id = c?.id || null; row.qbo_customer_name = c?.name || null;
    }
    await supabase.from('tasks').insert(row);
    setJobForm({ customer: '', title: '', scheduled_time: '', due_date: today(), assigned_to: '' });
    setAddMode(null);
    load();
  };

  const addCustomer = async () => {
    if (!newCustomerName.trim()) return null;
    const { data, error } = await supabase.from('customers').insert({ tenant_id: currentTenantId, name: newCustomerName.trim() }).select().single();
    if (error) { alert('Could not add customer: ' + error.message); return null; }
    setNewCustomerName(''); setShowAddCustomer(false);
    await loadCustomers();
    return data;
  };

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 , flexWrap: 'wrap'}}>
            <h1 style={{ color: TEAL, fontSize: 24, fontWeight: 800, margin: 0 }}>Board</h1>
            <span style={{ color: SUBTEXT, fontSize: 14, fontWeight: 600 }}>{currentTenant?.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 , flexWrap: 'wrap'}}>
            <button onClick={() => setAddMode(addMode === 'task' ? null : 'task')} style={{ background: '#f3f4f6', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Task</button>
            <button onClick={() => setAddMode(addMode === 'job' ? null : 'job')} style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Job</button>
          </div>
        </div>
        <p style={{ color: SUBTEXT, fontSize: 13, marginBottom: 16 }}>Every task and job, wherever it stands — the same list Time/Work Today reads and writes to. Hours shown are logged time.</p>

        {addMode === 'task' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 , flexWrap: 'wrap'}}>
            <AssigneeSelect users={assignableUsers} value={taskAssignee} onChange={setTaskAssignee}
              style={{ ...inputStyle, flex: '0 0 150px' }} />
            <input autoFocus value={taskTitle} onChange={e => setTaskTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTaskCard()}
              placeholder="New task title…" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={addTaskCard} style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontWeight: 700, cursor: 'pointer' }}>Add</button>
          </div>
        )}

        {addMode === 'job' && (
          <div style={{ ...{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={labelStyle}>Customer</label>
                <select style={inputStyle} value={jobForm.customer} onChange={e => {
                  if (e.target.value === '__add__') { setShowAddCustomer(true); return; }
                  setJobForm(f => ({ ...f, customer: e.target.value }));
                }}>
                  <option value="">— choose —</option>
                  {qboCustomers.length > 0 && (
                    <optgroup label="From QuickBooks">
                      {qboCustomers.map(c => <option key={c.id} value={encodeCustomer('qbo', c.id)}>{c.name}</option>)}
                    </optgroup>
                  )}
                  {localCustomers.length > 0 && (
                    <optgroup label="Local (not in QuickBooks)">
                      {localCustomers.map(c => <option key={c.id} value={encodeCustomer('local', c.id)}>{c.name}</option>)}
                    </optgroup>
                  )}
                  <option value="__add__">+ Add a customer not in QuickBooks…</option>
                </select>
              </div>
              <div style={{ flex: '2 1 220px' }}>
                <label style={labelStyle}>What's the job?</label>
                <input style={inputStyle} value={jobForm.title} onChange={e => setJobForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Camera install" />
                <label style={labelStyle}>Assign to</label>
                <AssigneeSelect users={assignableUsers} value={jobForm.assigned_to}
                  onChange={v => setJobForm(f => ({ ...f, assigned_to: v }))} style={inputStyle} />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={labelStyle}>Due date</label>
                <input type="date" style={inputStyle} value={jobForm.due_date} onChange={e => setJobForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label style={labelStyle}>Scheduled time</label>
                <input type="time" style={inputStyle} value={jobForm.scheduled_time} onChange={e => setJobForm(f => ({ ...f, scheduled_time: e.target.value }))} />
              </div>
            </div>
            {showAddCustomer && (
              <div style={{ background: '#fff7ed', border: `1px solid #fde68a`, borderRadius: 8, padding: 10, marginTop: 10 }}>
                <div style={{ fontSize: 12, color: AMBER, marginBottom: 6, lineHeight: 1.4 }}>
                  If this customer already exists (or should exist) in QuickBooks Online, add them there first — they'll show up
                  here automatically. Only add one here if they're genuinely not tracked in QuickBooks.
                </div>
                <div style={{ display: 'flex', gap: 8 , flexWrap: 'wrap'}}>
                  <input autoFocus style={inputStyle} placeholder="Customer name" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} />
                  <button onClick={async () => { const c = await addCustomer(); if (c) setJobForm(f => ({ ...f, customer: encodeCustomer('local', c.id) })); }}
                    style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setShowAddCustomer(false)} style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '0 12px', cursor: 'pointer', color: SUBTEXT }}>✕</button>
                </div>
              </div>
            )}
            <button onClick={addJobCard} style={{ width: '100%', background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontWeight: 700, cursor: 'pointer', marginTop: 10 }}>Add Job</button>
          </div>
        )}

        {loading ? (
          <div style={{ color: SUBTEXT, fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 , flexWrap: 'wrap'}}>
            {COLUMNS.map(col => {
              const colTasks = tasks.filter(t => (t.status || 'new') === col.key);
              return (
                <div key={col.key} style={{ flex: '1 1 240px', minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 , flexWrap: 'wrap'}}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: col.color }} />
                    <span style={{ color: TEXT, fontWeight: 700, fontSize: 13 }}>{col.label}</span>
                    <span style={{ color: SUBTEXT, fontSize: 12 }}>{colTasks.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 , flexWrap: 'wrap'}}>
                    {colTasks.length === 0 && <div style={{ color: '#c2c8cc', fontSize: 12, fontStyle: 'italic' }}>empty</div>}
                    {colTasks.map(t => (
                      <div key={t.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 4 }}>{t.title}</div>
                        {t.qbo_customer_name && <div style={{ fontSize: 11, color: SUBTEXT, marginBottom: 4 }}>{t.qbo_customer_name}</div>}
                        <div style={{ fontSize: 10, marginBottom: 4, color: t.assigned_to ? TEAL : AMBER, fontWeight: 600 }}>
                          {t.assigned_to ? t.assigned_to.split('@')[0] : 'Unassigned'}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                          {t.due_date && <span style={{ fontSize: 10, color: SUBTEXT }}>{t.due_date === today() ? 'Today' : t.due_date}</span>}
                          {t.scheduled_time && <span style={{ fontSize: 10, color: TEAL, fontWeight: 700 }}>{fmtTime(t.scheduled_time)}</span>}
                          {hoursByTask[t.id] > 0 && (
                            <span style={{ fontSize: 10, color: '#fff', background: AMBER, borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>
                              {fmtHrs(hoursByTask[t.id])} logged
                            </span>
                          )}
                        </div>
                        <select value={t.status || 'new'} onChange={e => moveTask(t, e.target.value)}
                          style={{ width: '100%', fontSize: 11, padding: '4px 6px', border: `1px solid ${BORDER}`, borderRadius: 6, color: SUBTEXT, background: '#fafbfb' }}>
                          {COLUMNS.map(c => <option key={c.key} value={c.key}>Move to {c.label}</option>)}
                        </select>
                        {completingTask?.id === t.id && (
                          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 8, marginTop: 8 }}>
                            <div style={{ fontSize: 11, color: AMBER, marginBottom: 6 }}>Enter hours worked to complete:</div>
                            <div style={{ display: 'flex', gap: 6 , flexWrap: 'wrap'}}>
                              <input type="number" step="0.25" autoFocus style={{ ...inputStyle, flex: 1, padding: '6px 8px', fontSize: 12 }} placeholder="e.g. 2.5" value={completeHours} onChange={e => setCompleteHours(e.target.value)} />
                              <button onClick={confirmCompletion} style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 6, padding: '0 10px', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>Done</button>
                              <button onClick={() => setCompletingTask(null)} style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '0 8px', cursor: 'pointer', color: SUBTEXT, fontSize: 11 }}>✕</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
