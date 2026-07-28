// ============================================
// Jovelin — Tasks Due Today + Log Time
// ============================================
// Sits inside Work Today, above the existing calendar-driven job list
// (untouched). Two kinds of today-items:
//   - Task: title only, optional customer, no scheduled time. Marking it
//     done just toggles status.
//   - Job: has a customer and a scheduled time. Marking it done prompts
//     for hours worked before it's allowed to complete — that hour
//     becomes a real time_entries row, linked back to the job.
//
// Customers are QBO's first — same /api/qbo/lists endpoint Estimates
// uses. But a tenant's real-world customer isn't always in QuickBooks
// yet, so there's a deliberate, clearly-labeled fallback: a customer
// stored locally in Jovelin's own `customers` table. Local customers are
// kept in a SEPARATE field (local_customer_id) from qbo_customer_id,
// never faked as a QBO id — job-costing math depends on qbo_customer_id
// only ever holding a real QBO id.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { useTenant } from '../context/TenantContext.jsx';
import { useAssignableUsers, AssigneeSelect } from '../utils/useAssignableUsers.jsx';
import { apiFetch } from '../services/apiFetch.js';

const GREEN = '#16a34a', AMBER = '#d97706', TEAL = '#0D4F5C', RED = '#dc2626';
const CARD = '#ffffff', BORDER = '#e5e7eb', TEXT = '#1B2A4A', SUBTEXT = '#6b7280';
const inputStyle = { width: '100%', padding: '10px 11px', fontSize: 14, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, boxSizing: 'border-box' };
const labelStyle = { fontSize: 11, fontWeight: 700, color: SUBTEXT, textTransform: 'uppercase', marginBottom: 4, display: 'block' };
const today = () => new Date().toISOString().slice(0, 10);
const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

// Encodes which customer table a selection came from into the <select> value,
// since a QBO id and a local uuid could theoretically collide otherwise.
const encodeCustomer = (source, id) => `${source}:${id}`;
const decodeCustomer = (val) => { const [source, ...rest] = val.split(':'); return { source, id: rest.join(':') }; };

export default function TodayTasksAndTime({ userEmail, date }) {
  const { currentTenantId } = useTenant();
  const viewDateStr = (date || new Date()).toISOString().slice(0, 10);
  const isToday = viewDateStr === new Date().toISOString().slice(0, 10);
  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [qboCustomers, setQboCustomers] = useState([]);
  const [localCustomers, setLocalCustomers] = useState([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [showLogTime, setShowLogTime] = useState(false);
  const [showAddJob, setShowAddJob] = useState(false);
  const [completingTask, setCompletingTask] = useState(null);
  const [completeHours, setCompleteHours] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customer: '', hours: '', notes: '', task_id: '' });
  const [jobForm, setJobForm] = useState({ customer: '', title: '', scheduled_time: '', assigned_to: '' });
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [showEveryone, setShowEveryone] = useState(false);
  const assignableUsers = useAssignableUsers(currentTenantId);
  const [entries, setEntries] = useState([]);

  // The screen used to only ever INSERT time entries and never read them
  // back — you'd log hours, the form would close, and nothing would appear.
  // No confirmation, no total, no way to spot a mistake. This loads what's
  // actually been logged for the day being viewed.
  const loadEntries = useCallback(async () => {
    if (!currentTenantId) return;
    const { data } = await supabase.from('time_entries')
      .select('id, total_minutes, notes, disposition, qbo_customer_name, billed, created_at')
      .eq('tenant_id', currentTenantId).eq('work_date', viewDateStr)
      .order('created_at', { ascending: false });
    setEntries(data || []);
  }, [currentTenantId, viewDateStr]);

  const deleteEntry = async (id) => {
    if (!window.confirm('Delete this time entry?')) return;
    await supabase.from('time_entries').delete().eq('id', id);
    loadEntries();
  };

  const loadTasks = useCallback(async () => {
    if (!currentTenantId) return;
    // Exactly-due-today tasks, PLUS anything incomplete from a past date —
    // an unfinished job doesn't vanish at midnight, it carries forward until
    // someone actually completes it.
    const { data } = await supabase.from('tasks').select('*')
      .eq('tenant_id', currentTenantId)
      .or(`due_date.eq.${viewDateStr},and(due_date.lt.${viewDateStr},status.neq.complete)`)
      .order('scheduled_time', { nullsFirst: false }).order('created_at');
    setTasks(data || []);
  }, [currentTenantId, viewDateStr]);

  const loadLocalCustomers = useCallback(async () => {
    if (!currentTenantId) return;
    const { data } = await supabase.from('customers').select('id, name')
      .eq('tenant_id', currentTenantId).is('merged_into', null).order('name');
    setLocalCustomers(data || []);
  }, [currentTenantId]);

  useEffect(() => {
    if (!currentTenantId) return;
    loadTasks();
    loadLocalCustomers();
    loadEntries();
    apiFetch(`/api/qbo/lists?tenant_id=${currentTenantId}`)
      .then(r => r.json()).then(d => setQboCustomers(d.customers || [])).catch(() => setQboCustomers([]));
  }, [currentTenantId, viewDateStr, loadTasks, loadLocalCustomers, loadEntries]);

  const addCustomer = async () => {
    if (!newCustomerName.trim()) return;
    const { data, error } = await supabase.from('customers').insert({ tenant_id: currentTenantId, name: newCustomerName.trim() }).select().single();
    if (error) { alert('Could not add customer: ' + error.message); return; }
    setNewCustomerName(''); setShowAddCustomer(false);
    await loadLocalCustomers();
    return data;
  };

  const addTask = async () => {
    if (!newTaskTitle.trim()) return;
    await supabase.from('tasks').insert({
      tenant_id: currentTenantId, title: newTaskTitle.trim(), due_date: viewDateStr,
      created_by: userEmail,
      // Default to whoever is adding it — the common case is putting
      // something on your own list, and an unassigned pile helps nobody.
      assigned_to: newTaskAssignee || userEmail,
    });
    setNewTaskTitle(''); setNewTaskAssignee('');
    loadTasks();
  };

  const addJob = async () => {
    if (!jobForm.customer) { alert('Pick a customer for this job.'); return; }
    if (!jobForm.title.trim()) { alert('Give the job a short description.'); return; }
    const { source, id } = decodeCustomer(jobForm.customer);
    const row = {
      tenant_id: currentTenantId, title: jobForm.title.trim(), due_date: viewDateStr,
      created_by: userEmail, scheduled_time: jobForm.scheduled_time || null,
      assigned_to: jobForm.assigned_to || userEmail,
    };
    if (source === 'qbo') {
      const c = qboCustomers.find(x => x.id === id);
      row.qbo_customer_id = c?.id || null; row.qbo_customer_name = c?.name || null;
    } else {
      const c = localCustomers.find(x => x.id === id);
      row.local_customer_id = c?.id || null; row.qbo_customer_name = c?.name || null; // name still shown on the card either way
    }
    await supabase.from('tasks').insert(row);
    setJobForm({ customer: '', title: '', scheduled_time: '', assigned_to: '' });
    setShowAddJob(false);
    loadTasks();
  };

  const toggleTask = async (task) => {
    if (task.status === 'complete') {
      await supabase.from('tasks').update({ status: 'new', completed_at: null }).eq('id', task.id);
      loadTasks();
      return;
    }
    if (task.qbo_customer_id || task.local_customer_id) {
      setCompletingTask(task);
      setCompleteHours('');
    } else {
      await supabase.from('tasks').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', task.id);
      loadTasks();
    }
  };

  const confirmCompletion = async () => {
    const hrs = parseFloat(completeHours);
    if (!hrs || hrs <= 0) { alert('Enter hours worked to complete this job.'); return; }
    setSaving(true);
    try {
      await supabase.from('time_entries').insert({
        tenant_id: currentTenantId, work_date: viewDateStr, total_minutes: Math.round(hrs * 60),
        qbo_customer_id: completingTask.qbo_customer_id || null,
        qbo_customer_name: completingTask.qbo_customer_id ? completingTask.qbo_customer_name : null,
        local_customer_id: completingTask.local_customer_id || null,
        task_id: completingTask.id, disposition: 'billable', notes: completingTask.title,
        logged_by: userEmail, tech_email: userEmail, billed: false,
      });
      await supabase.from('tasks').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', completingTask.id);
      setCompletingTask(null);
      loadTasks();
      loadEntries();
    } catch (e) {
      alert('Could not complete job: ' + e.message);
    }
    setSaving(false);
  };

  const logTime = async () => {
    const hrs = parseFloat(form.hours);
    if (!hrs || hrs <= 0) { alert('Enter hours worked.'); return; }
    setSaving(true);
    const row = {
      tenant_id: currentTenantId, work_date: viewDateStr, total_minutes: Math.round(hrs * 60),
      task_id: form.task_id || null, notes: form.notes || null, logged_by: userEmail, tech_email: userEmail, billed: false,
    };
    if (form.customer) {
      const { source, id } = decodeCustomer(form.customer);
      if (source === 'qbo') {
        const c = qboCustomers.find(x => x.id === id);
        row.qbo_customer_id = c?.id || null; row.qbo_customer_name = c?.name || null; row.disposition = 'billable';
      } else {
        const c = localCustomers.find(x => x.id === id);
        row.local_customer_id = c?.id || null; row.disposition = 'billable';
      }
    } else {
      row.disposition = 'internal';
    }
    try {
      await supabase.from('time_entries').insert(row);
      setForm({ customer: '', hours: '', notes: '', task_id: '' });
      setShowLogTime(false);
      loadEntries();
    } catch (e) {
      alert('Could not log time: ' + e.message);
    }
    setSaving(false);
  };

  const totalHours = entries.reduce((s, e) => s + (e.total_minutes || 0), 0) / 60;

  // Default to what's actually mine. Unassigned items are included rather
  // than hidden — everything created before assignment existed has no
  // assignee, and silently dropping it would look like data loss.
  const visibleTasks = showEveryone
    ? tasks
    : tasks.filter(t => !t.assigned_to || t.assigned_to.toLowerCase() === (userEmail || '').toLowerCase());
  const othersCount = tasks.length - visibleTasks.length;

  const CustomerSelect = ({ value, onChange, allowNone }) => (
    <>
      <select style={{ ...inputStyle, marginBottom: showAddCustomer ? 6 : 8 }} value={value} onChange={e => {
        if (e.target.value === '__add__') { setShowAddCustomer(true); return; }
        onChange(e.target.value);
      }}>
        {allowNone && <option value="">— No customer (internal time) —</option>}
        {!allowNone && <option value="">— choose —</option>}
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
      {showAddCustomer && (
        <div style={{ background: '#fff7ed', border: `1px solid #fde68a`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: AMBER, marginBottom: 6, lineHeight: 1.4 }}>
            If this customer already exists (or should exist) in QuickBooks Online, add them there first — they'll show up
            here automatically. Only add one here if they're genuinely not tracked in QuickBooks.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input autoFocus style={{ ...inputStyle, marginBottom: 0, flex: '1 1 160px' }} placeholder="Customer name" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} />
            <button onClick={async () => { const c = await addCustomer(); if (c) onChange(encodeCustomer('local', c.id)); }}
              style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}>Add</button>
            <button onClick={() => setShowAddCustomer(false)} style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '0 12px', cursor: 'pointer', color: SUBTEXT }}>✕</button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div style={{ padding: '0 16px 12px' }}>
      {/* Tasks & Jobs due today */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ color: TEAL, fontWeight: 700, fontSize: 13 }}>{isToday ? "Today" : "Tasks & Jobs"}</div>
          {(othersCount > 0 || showEveryone) && (
            <button onClick={() => setShowEveryone(v => !v)}
              style={{ background: 'none', border: 'none', color: TEAL, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {showEveryone ? 'Just mine' : `Everyone's (${othersCount} more)`}
            </button>
          )}
        </div>
        <div style={{ color: SUBTEXT, fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
          <b style={{ color: TEXT }}>Tasks</b> are simple to-dos — check them off, done.{' '}
          <b style={{ color: TEAL }}>Jobs</b> have a customer, and checking one off asks for hours worked first — that
          time is billable and flows to Billing.
        </div>
        {visibleTasks.length === 0 && (
          <div style={{ color: SUBTEXT, fontSize: 13, marginBottom: 8 }}>
            {tasks.length > 0
              ? `Nothing assigned to you${isToday ? ' today' : ' this day'} — ${tasks.length} for others.`
              : (isToday ? 'Nothing due today.' : 'Nothing due this day.')}
          </div>
        )}
        {visibleTasks.map(t => {
          const isJob = !!(t.qbo_customer_id || t.local_customer_id);
          return (
          <div key={t.id}>
            <div onClick={() => toggleTask(t)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', cursor: 'pointer',
              borderBottom: `1px solid ${BORDER}`, opacity: t.status === 'complete' ? 0.5 : 1,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 5, border: `2px solid ${t.status === 'complete' ? GREEN : BORDER}`,
                background: t.status === 'complete' ? GREEN : 'transparent', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13,
              }}>{t.status === 'complete' ? '✓' : ''}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {isJob && <span style={{ fontSize: 9, fontWeight: 700, color: TEAL, background: '#e8f0f2', padding: '1px 6px', borderRadius: 8, letterSpacing: 0.3 }}>JOB</span>}
                  <span style={{ fontSize: 13, color: TEXT, textDecoration: t.status === 'complete' ? 'line-through' : 'none' }}>{t.title}</span>
                </div>
                {t.qbo_customer_name && <div style={{ fontSize: 11, color: SUBTEXT }}>{t.qbo_customer_name}{t.local_customer_id ? ' (local)' : ''}</div>}
                {showEveryone && (
                  <div style={{ fontSize: 10, color: t.assigned_to ? TEAL : AMBER, fontWeight: 600 }}>
                    {t.assigned_to ? t.assigned_to.split('@')[0] : 'Unassigned'}
                  </div>
                )}
              </div>
              {t.due_date < viewDateStr && t.status !== 'complete' && (
                <span style={{ fontSize: 10, color: '#fff', background: RED, borderRadius: 10, padding: '1px 7px', fontWeight: 700, flexShrink: 0 }}>overdue</span>
              )}
              {t.scheduled_time && <span style={{ fontSize: 11, color: TEAL, fontWeight: 700, flexShrink: 0 }}>{fmtTime(t.scheduled_time)}</span>}
            </div>

            {completingTask?.id === t.id && (
              <div style={{ background: '#fffbeb', border: `1px solid #fde68a`, borderRadius: 8, padding: 10, margin: '6px 0' }}>
                <div style={{ fontSize: 12, color: AMBER, marginBottom: 6 }}>This job has a customer — enter hours worked to mark it complete:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="number" step="0.25" autoFocus style={{ ...inputStyle, flex: '1 1 100px' }} placeholder="e.g. 2.5" value={completeHours} onChange={e => setCompleteHours(e.target.value)} />
                  <button onClick={confirmCompletion} disabled={saving} style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}>Done</button>
                  <button onClick={() => setCompletingTask(null)} style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '0 12px', cursor: 'pointer', color: SUBTEXT }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );})}

        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, flex: '1 1 160px' }} placeholder={isToday ? "Add a task for today…" : "Add a task for this day…"} value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTask()} />
          <AssigneeSelect users={assignableUsers} value={newTaskAssignee} onChange={setNewTaskAssignee}
            style={{ ...inputStyle, flex: '0 0 130px' }} allowUnassigned={false} />
          <button onClick={addTask} style={{ background: '#f3f4f6', color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '0 14px', fontWeight: 700, cursor: 'pointer' }}>+ Task</button>
          <button onClick={() => setShowAddJob(v => !v)} style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '0 14px', fontWeight: 700, cursor: 'pointer' }}>+ Job</button>
        </div>

        {showAddJob && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
            <label style={labelStyle}>Customer</label>
            <CustomerSelect value={jobForm.customer} onChange={v => setJobForm(f => ({ ...f, customer: v }))} allowNone={false} />
            <label style={labelStyle}>What's the job?</label>
            <input style={{ ...inputStyle, marginBottom: 8 }} value={jobForm.title} onChange={e => setJobForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Camera install, back office" />
            <label style={labelStyle}>Assign to</label>
            <AssigneeSelect users={assignableUsers} value={jobForm.assigned_to}
              onChange={v => setJobForm(f => ({ ...f, assigned_to: v }))} style={{ ...inputStyle, marginBottom: 8 }} allowUnassigned={false} />
            <label style={labelStyle}>Scheduled time (optional)</label>
            <input type="time" style={{ ...inputStyle, marginBottom: 8 }} value={jobForm.scheduled_time} onChange={e => setJobForm(f => ({ ...f, scheduled_time: e.target.value }))} />
            <button onClick={addJob} style={{ width: '100%', background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontWeight: 700, cursor: 'pointer' }}>Add Job</button>
          </div>
        )}
      </div>

      {/* Log time (unattached to any job/task) */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: TEAL, fontWeight: 700, fontSize: 13 }}>
              {isToday ? 'Time Logged Today' : 'Time Logged'}
              {totalHours > 0 && <span style={{ color: GREEN, marginLeft: 8 }}>{totalHours.toFixed(2)} hrs</span>}
            </div>
            <div style={{ color: SUBTEXT, fontSize: 11 }}>Everything logged for this day — from completing a job above, or logged directly here.</div>
          </div>
          <button onClick={() => setShowLogTime(v => !v)} style={{ background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
            {showLogTime ? 'Cancel' : '+ Log hours'}
          </button>
        </div>

        {entries.length === 0 ? (
          <div style={{ color: SUBTEXT, fontSize: 12, marginTop: 8 }}>Nothing logged yet.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {entries.map(e => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 0', borderTop: `1px solid ${BORDER}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: TEXT }}>
                    {e.qbo_customer_name || (e.disposition === 'internal' ? 'Internal time' : 'No customer')}
                    {e.billed && <span style={{ fontSize: 9, fontWeight: 700, marginLeft: 6, padding: '1px 6px', borderRadius: 8, background: '#e6f4ea', color: GREEN }}>BILLED</span>}
                  </div>
                  {e.notes && <div style={{ fontSize: 11, color: SUBTEXT }}>{e.notes}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <b style={{ color: TEAL, fontSize: 13 }}>{(e.total_minutes / 60).toFixed(2)} hrs</b>
                  {!e.billed && (
                    <button onClick={() => deleteEntry(e.id)} title="Delete this entry"
                      style={{ background: 'none', border: 'none', color: SUBTEXT, fontSize: 15, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {showLogTime && (
          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Customer (optional)</label>
            <CustomerSelect value={form.customer} onChange={v => setForm(f => ({ ...f, customer: v }))} allowNone={true} />
            {!form.customer && (
              <div style={{ background: '#fff7ed', color: AMBER, fontSize: 12, padding: '6px 10px', borderRadius: 6, marginBottom: 8 }}>
                No customer selected — this time will be flagged internal, billable to the tenant itself.
              </div>
            )}
            <label style={labelStyle}>Hours</label>
            <input type="number" step="0.25" style={{ ...inputStyle, marginBottom: 8 }} value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} placeholder="e.g. 2.5" />
            <label style={labelStyle}>Notes</label>
            <input style={{ ...inputStyle, marginBottom: 10 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="What did you work on?" />
            <button onClick={logTime} disabled={saving} style={{ width: '100%', background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save Time Entry'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
