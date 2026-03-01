// ============================================
// JUC-E V4 - OfficeHub View
// ============================================
// Three tabs: Board | Customers | Billing
// Board = kanban columns by status group
// Customers = SEPARATE MODEL — search + list + job history
// Billing = to-bill queue, estimates, pending

import { useState, useEffect, useCallback } from 'react';
import { queries, jobsApi, customersApi, assignmentsApi, techsApi, JOB_STATUS, STATUS_INFO } from '../services/supabase.js';
import { JOB_TYPE_INFO, getJobAge, getAgeUrgency, STATUS_GROUPS } from '../utils/statusMachine.js';
import { TECH_COLORS } from '../config/calendars.js';
import { scheduleToTechCalendar } from '../services/calendarSync.js';
import { notifyJobAssigned } from '../services/pushNotifications.js';
import usePullToRefresh from '../utils/usePullToRefresh.jsx';
import JobCard from '../components/JobCard.jsx';
import JobDetail from '../components/JobDetail.jsx';
import NewJobModal from '../components/NewJobModal.jsx';
import NotesPanel from '../components/NotesPanel.jsx';

// Blocked statuses for the bottom section
const BLOCKED_STATUSES = [JOB_STATUS.NEEDS_PARTS, JOB_STATUS.PENDING_MATERIALS, JOB_STATUS.RETURN_PENDING];
// Billing statuses
const BILLING_STATUSES = [JOB_STATUS.TO_BILL, JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT, JOB_STATUS.WON];

export default function OfficeHub({ accessToken, userEmail, userRole }) {
  const [activeTab, setActiveTab] = useState('board');
  const [allJobs, setAllJobs] = useState([]);
  const [allTechs, setAllTechs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [jobCounts, setJobCounts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerJobs, setCustomerJobs] = useState([]);
  const [customerNotes, setCustomerNotes] = useState([]);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState({});
  const [newCustomerNote, setNewCustomerNote] = useState('');
  const [activeLane, setActiveLane] = useState('unassigned'); // mobile: which lane is showing
  const [billingTab, setBillingTab] = useState('to_bill');
  const [statusFilter, setStatusFilter] = useState(null); // null = all, or 'new'|'waiting'|'scheduled'|'toBill'
  const [viewMode, setViewMode] = useState('line'); // 'line' or 'card'
  const [boardView, setBoardView] = useState('kanban'); // 'lanes' | 'kanban' | 'calendar'
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0); // 0 = this week
  
  // Search and sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('age'); // age, date, name

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'board' || activeTab === 'billing') {
        const [jobs, techs] = await Promise.all([
          queries.getAllOpenJobsWithTech(),
          techsApi.getAll()
        ]);
        setAllJobs(jobs);
        setAllTechs(techs);
      }
      if (activeTab === 'customers') {
        if (customerSearch.length >= 2) {
          const results = await customersApi.search(customerSearch);
          setCustomers(results);
        } else {
          const all = await customersApi.getAll();
          setCustomers(all);
        }
        const counts = await customersApi.getJobCounts();
        setJobCounts(counts);
      }
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, customerSearch]);

  useEffect(() => { loadData(); }, [loadData]);
  const { PullIndicator } = usePullToRefresh(loadData);

  // Customer detail view
  const openCustomer = async (customer) => {
    setSelectedCustomer(customer);
    setCustomerForm({ ...customer });
    setIsEditingCustomer(false);
    try {
      const [jobs, notes] = await Promise.all([
        customersApi.getJobs(customer.id),
        customersApi.getAllNotes(customer.id)
      ]);
      setCustomerJobs(jobs);
      setCustomerNotes(notes);
    } catch (e) { console.error(e); }
  };

  const saveCustomer = async () => {
    try {
      const updated = await customersApi.update(selectedCustomer.id, {
        name: customerForm.name,
        address: customerForm.address,
        phone: customerForm.phone,
        email: customerForm.email,
        gate_code: customerForm.gate_code,
        panel_password: customerForm.panel_password,
        cms_account_id: customerForm.cms_account_id,
        notes: customerForm.notes
      });
      setSelectedCustomer(updated);
      setIsEditingCustomer(false);
      loadData();
    } catch (e) { console.error(e); }
  };

  const createCustomer = async () => {
    try {
      const created = await customersApi.create({
        name: customerForm.name || '',
        address: customerForm.address || '',
        phone: customerForm.phone || '',
        email: customerForm.email || '',
        gate_code: customerForm.gate_code || '',
        panel_password: customerForm.panel_password || '',
        cms_account_id: customerForm.cms_account_id || '',
        notes: customerForm.notes || '',
        is_active: true
      });
      setShowAddCustomer(false);
      openCustomer(created);
      loadData();
    } catch (e) { console.error(e); }
  };

  const addCustomerNote = async () => {
    if (!newCustomerNote.trim()) return;
    try {
      await customersApi.addNote(selectedCustomer.id, newCustomerNote.trim(), userEmail);
      setNewCustomerNote('');
      const notes = await customersApi.getAllNotes(selectedCustomer.id);
      setCustomerNotes(notes);
    } catch (e) { console.error(e); }
  };

  const fieldStyle = {
    width: '100%', background: '#0f1729', border: '1px solid #334155', borderRadius: '8px',
    color: '#e2e8f0', padding: '10px 12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
  };
  const labelStyle = { color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '4px' };

  // Board data - group by tech
  const unassignedJobs = allJobs.filter(j => !j._tech_name && !BILLING_STATUSES.includes(j.status) && !BLOCKED_STATUSES.includes(j.status));
  const blockedJobs = allJobs.filter(j => BLOCKED_STATUSES.includes(j.status));
  const techLanes = allTechs.map(t => ({
    tech: t,
    jobs: allJobs.filter(j => j._tech_name === t.name && !BILLING_STATUSES.includes(j.status))
  }));

  // Quick assign handler
  const quickAssign = async (job, techId) => {
    try {
      // Create tomorrow 9am default schedule
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      const assignment = await assignmentsApi.create({
        job_id: job.id,
        tech_id: techId,
        scheduled_for: tomorrow.toISOString(),
      }, userEmail);
      await jobsApi.update(job.id, { status: JOB_STATUS.SCHEDULED });

      // Push to Google Calendar
      if (accessToken) {
        try {
          const tech = allTechs.find(t => t.id === techId);
          if (tech) {
            notifyJobAssigned(tech.name, job.customer_name, tomorrow.toISOString());
            const calEvent = await scheduleToTechCalendar(accessToken, job, tech, tomorrow);
            if (calEvent?.id && assignment?.id) {
              await assignmentsApi.update(assignment.id, { calendar_event_id: calEvent.id });
            }
          }
        } catch (calErr) {
          console.error('Calendar sync failed:', calErr);
          alert('⚠️ Job assigned in JUC-E but Google Calendar sync failed: ' + calErr.message);
        }
      } else {
        console.warn('No Google access token — skipping calendar push');
      }

      loadData();
    } catch (e) { console.error('Assign error:', e); alert('Error scheduling: ' + e.message); }
  };

  // Status pills
  const statusCounts = {
    new: allJobs.filter(j => j.status === JOB_STATUS.NEW).length,
    waiting: blockedJobs.length,
    scheduled: allJobs.filter(j => j.status === JOB_STATUS.SCHEDULED).length,
    toBill: allJobs.filter(j => j.status === JOB_STATUS.TO_BILL).length,
  };

  // Status filter mapping
  const STATUS_FILTER_MAP = {
    new: [JOB_STATUS.NEW],
    waiting: BLOCKED_STATUSES,
    scheduled: [JOB_STATUS.SCHEDULED],
    toBill: [JOB_STATUS.TO_BILL],
  };

  // Apply status filter to a job list
  const applyStatusFilter = (jobs) => {
    if (!statusFilter) return jobs;
    const allowed = STATUS_FILTER_MAP[statusFilter];
    return jobs.filter(j => allowed.includes(j.status));
  };

  // Search filter
  const searchJobs = (jobs) => {
    if (!searchQuery.trim()) return jobs;
    const q = searchQuery.toLowerCase();
    return jobs.filter(j => 
      j.customer_name?.toLowerCase().includes(q) ||
      j.customer_address?.toLowerCase().includes(q) ||
      j.job_number?.toLowerCase().includes(q) ||
      j.issue?.toLowerCase().includes(q)
    );
  };

  // Sort helper
  const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
  const sortJobs = (jobs) => {
    return [...jobs].sort((a, b) => {
      if (sortBy === 'name') return (a.customer_name || '').localeCompare(b.customer_name || '');
      if (sortBy === 'date') return new Date(b.created_at) - new Date(a.created_at);
      if (sortBy === 'priority') {
        const pa = PRIORITY_ORDER[a.priority] ?? 2;
        const pb = PRIORITY_ORDER[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return new Date(a.created_at) - new Date(b.created_at); // same priority → oldest first
      }
      // Default: age (oldest first = most urgent)
      return new Date(a.created_at) - new Date(b.created_at);
    });
  };

  // Apply both search and sort
  const filterAndSort = (jobs) => sortJobs(searchJobs(applyStatusFilter(jobs)));

  // Mobile lane list
  const allLanes = [
    { key: 'unassigned', label: 'Unassigned', color: '#e94560', count: applyStatusFilter(unassignedJobs).length },
    ...allTechs.map(t => ({ key: t.id, label: t.name, color: TECH_COLORS[t.name] || '#6b7280', count: applyStatusFilter(techLanes.find(l => l.tech.id === t.id)?.jobs || []).length }))
  ];

  // Billing data
  const billingQueues = {
    to_bill: allJobs.filter(j => j.status === JOB_STATUS.TO_BILL),
    estimates: allJobs.filter(j => j.status === JOB_STATUS.NEEDS_ESTIMATE),
    pending: allJobs.filter(j => j.status === JOB_STATUS.ESTIMATE_SENT),
    won: allJobs.filter(j => j.status === JOB_STATUS.WON),
  };
  const missingNotes = billingQueues.to_bill.filter(j => !j.completion_notes?.trim());

  // Kanban columns by status group
  const KANBAN_COLUMNS = [
    { key: 'intake', label: '🆕 Intake', color: '#ef4444', statuses: [JOB_STATUS.NEW, JOB_STATUS.NEEDS_DETAILS] },
    { key: 'ready', label: '✅ Ready', color: '#22c55e', statuses: [JOB_STATUS.READY_TO_SCHEDULE, JOB_STATUS.RETURN_PENDING] },
    { key: 'scheduled', label: '📅 Scheduled', color: '#3b82f6', statuses: [JOB_STATUS.SCHEDULED] },
    { key: 'blocked', label: '⏳ Blocked', color: '#f59e0b', statuses: [JOB_STATUS.NEEDS_PARTS, JOB_STATUS.PENDING_MATERIALS, JOB_STATUS.PENDING_DECISION] },
    { key: 'complete', label: '✓ Done', color: '#10b981', statuses: [JOB_STATUS.COMPLETE] },
  ];

  // Calendar helpers
  const getWeekDays = (offset) => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1 + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  };

  const weekDays = getWeekDays(calendarWeekOffset);
  const scheduledJobs = allJobs.filter(j => j._scheduled_for);
  const CALENDAR_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

  const getJobsForDayHour = (day, hour) => {
    return scheduledJobs.filter(j => {
      const d = new Date(j._scheduled_for);
      return d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate() &&
        d.getHours() === hour;
    });
  };

  const getJobsForDay = (day) => {
    return scheduledJobs.filter(j => {
      const d = new Date(j._scheduled_for);
      return d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate();
    });
  };

  const isToday = (d) => {
    const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  };

  // Job card for kanban (compact, with priority border + type badge)
  const KanbanCard = ({ job, showAssign }) => {
    const age = getJobAge(job);
    const urgency = getAgeUrgency(job);
    const typeInfo = JOB_TYPE_INFO[job.type] || {};
    const priorityColors = { URGENT: '#e74c3c', HIGH: '#f39c12', NORMAL: '#27ae60', LOW: '#3498db' };
    const borderColor = priorityColors[job.priority] || '#334155';

    return (
      <div
        onClick={() => setSelectedJobId(job.id)}
        style={{
          background: '#1a1a2e', borderRadius: '8px', padding: '12px', marginBottom: '8px',
          cursor: 'pointer', borderLeft: `4px solid ${borderColor}`,
          transition: 'transform 0.15s', position: 'relative'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', color: '#e2e8f0', flex: 1 }}>
            {job.customer_name || 'Unknown'}
          </div>
          {job.job_number && (
            <span style={{ color: '#00c8e8', fontSize: '11px', fontWeight: '600', flexShrink: 0 }}>{job.job_number}</span>
          )}
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', lineHeight: '1.3' }}>
          {job.issue || 'No description'}
        </div>
        {/* Scheduled date/time */}
        {job._scheduled_for && (
          <div style={{ color: '#3b82f6', fontSize: '11px', fontWeight: '600', marginBottom: '6px' }}>
            📅 {new Date(job._scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} @ {new Date(job._scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            {job._tech_name && <span style={{ color: '#94a3b8', fontWeight: '400' }}> · {job._tech_name}</span>}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
          <span style={{
            padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
            textTransform: 'uppercase', color: '#fff',
            background: typeInfo.color || '#6b7280'
          }}>
            {job.type || 'Service'}
          </span>
          <span style={{ color: urgency === 'critical' ? '#ef4444' : urgency === 'warning' ? '#f59e0b' : '#64748b' }}>
            {age}
          </span>
        </div>
        {/* Quick assign buttons for unassigned */}
        {showAssign && allTechs.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
            {allTechs.map(t => (
              <button
                key={t.id}
                onClick={(e) => { e.stopPropagation(); quickAssign(job, t.id); }}
                style={{
                  flex: 1, padding: '6px', border: 'none', borderRadius: '4px', fontSize: '11px',
                  fontWeight: 600, cursor: 'pointer', color: '#fff',
                  background: TECH_COLORS[t.name] || '#6b7280'
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Compact line item
  const LineItem = ({ job, showAssign }) => {
    const age = getJobAge(job);
    const urgency = getAgeUrgency(job);
    const statusInfo = STATUS_INFO[job.status] || {};
    const typeInfo = JOB_TYPE_INFO[job.type] || {};
    const priorityColors = { URGENT: '#e74c3c', HIGH: '#f39c12', NORMAL: '#27ae60', LOW: '#3498db' };

    return (
      <div
        onClick={() => setSelectedJobId(job.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
          background: '#1a1a2e', borderRadius: '8px', marginBottom: '4px',
          cursor: 'pointer', borderLeft: `3px solid ${priorityColors[job.priority] || '#334155'}`
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {job.customer_name || 'Unknown'}
            </span>
            {job.job_number && (
              <span style={{ color: '#00c8e8', fontSize: '10px', fontWeight: '600', flexShrink: 0 }}>{job.job_number}</span>
            )}
          </div>
          <div style={{ color: '#64748b', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {job.issue || 'No description'}
          </div>
          {job._scheduled_for && (
            <div style={{ color: '#3b82f6', fontSize: '10px', fontWeight: '600', marginTop: '2px' }}>
              📅 {new Date(job._scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} @ {new Date(job._scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
        <span style={{
          padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 700,
          color: statusInfo.color || '#94a3b8', background: `${statusInfo.color || '#94a3b8'}15`,
          whiteSpace: 'nowrap', flexShrink: 0
        }}>
          {statusInfo.label || job.status}
        </span>
        <span style={{
          padding: '2px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 600,
          color: '#fff', background: typeInfo.color || '#6b7280',
          whiteSpace: 'nowrap', flexShrink: 0
        }}>
          {job.type || 'SVC'}
        </span>
        <span style={{
          color: urgency === 'critical' ? '#ef4444' : urgency === 'warning' ? '#f59e0b' : '#475569',
          fontSize: '11px', fontWeight: 600, minWidth: '24px', textAlign: 'right', flexShrink: 0
        }}>
          {age}
        </span>
        {showAssign && allTechs.length > 0 && (
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
            {allTechs.map(t => (
              <button
                key={t.id}
                onClick={(e) => { e.stopPropagation(); quickAssign(job, t.id); }}
                style={{
                  width: '24px', height: '24px', border: 'none', borderRadius: '4px', fontSize: '9px',
                  fontWeight: 700, cursor: 'pointer', color: '#fff', padding: 0,
                  background: TECH_COLORS[t.name] || '#6b7280'
                }}
                title={t.name}
              >
                {t.name.charAt(0)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Render job based on view mode
  const RenderJob = ({ job, showAssign }) => {
    return viewMode === 'card'
      ? <KanbanCard job={job} showAssign={showAssign} />
      : <LineItem job={job} showAssign={showAssign} />;
  };

  return (
    <div>
      <PullIndicator />

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: '0', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: '49px', background: '#0f1729', zIndex: 50
      }}>
        {[
          { key: 'board', label: 'Board' },
          { key: 'customers', label: 'Customers' },
          { key: 'billing', label: 'Billing' }
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1, padding: '12px', background: 'none', border: 'none',
              color: activeTab === t.key ? '#00c8e8' : '#64748b',
              fontSize: '14px', fontWeight: activeTab === t.key ? '700' : '400',
              cursor: 'pointer',
              borderBottom: activeTab === t.key ? '2px solid #00c8e8' : '2px solid transparent'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading...</div>
      ) : (
        <div style={{ padding: '12px' }}>
          {/* ===== BOARD TAB (Kanban by Tech) ===== */}
          {activeTab === 'board' && (
            <>
              {/* Search bar */}
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="🔍 Search customers, addresses, issues..."
                  style={{
                    width: '100%', padding: '12px 16px', fontSize: '14px',
                    background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
                    color: '#e2e8f0', outline: 'none', boxSizing: 'border-box'
                  }}
                />
              </div>
              
              {/* View switcher: Lanes | Board | Calendar */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', background: '#16213e', borderRadius: '10px', padding: '3px' }}>
                {[
                  { key: 'kanban', label: '▦ Board' },
                  { key: 'calendar', label: '📅 Calendar' },
                  { key: 'lanes', label: '👤 Techs' },
                ].map(v => (
                  <button key={v.key} onClick={() => setBoardView(v.key)} style={{
                    flex: 1, padding: '10px', border: 'none', borderRadius: '8px',
                    background: boardView === v.key ? '#334155' : 'transparent',
                    color: boardView === v.key ? '#00c8e8' : '#64748b',
                    fontSize: '13px', fontWeight: boardView === v.key ? 700 : 500,
                    cursor: 'pointer'
                  }}>{v.label}</button>
                ))}
              </div>
              
              {/* ===== KANBAN BOARD VIEW ===== */}
              {boardView === 'kanban' && (
                <>
                  {/* Status pills */}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    {KANBAN_COLUMNS.map(col => {
                      const count = searchJobs(allJobs.filter(j => col.statuses.includes(j.status))).length;
                      return (
                        <div key={col.key} style={{
                          padding: '6px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 600,
                          background: `${col.color}15`, color: col.color, whiteSpace: 'nowrap',
                          display: 'flex', alignItems: 'center', gap: '6px'
                        }}>
                          {col.label} <span style={{ background: col.color, color: '#fff', padding: '1px 7px', borderRadius: '10px', fontSize: '11px' }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Horizontal scrolling kanban */}
                  <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '16px', minHeight: '60vh' }}>
                    {KANBAN_COLUMNS.map(col => {
                      const colJobs = searchJobs(allJobs.filter(j => col.statuses.includes(j.status)));
                      return (
                        <div key={col.key} style={{ minWidth: '260px', maxWidth: '300px', flex: '0 0 260px' }}>
                          {/* Column header */}
                          <div style={{
                            background: `${col.color}20`, borderRadius: '10px 10px 0 0', padding: '10px 12px',
                            borderBottom: `2px solid ${col.color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                          }}>
                            <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 700 }}>{col.label}</span>
                            <span style={{ background: col.color, color: '#fff', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>{colJobs.length}</span>
                          </div>
                          {/* Column body */}
                          <div style={{ background: '#0f172a', borderRadius: '0 0 10px 10px', padding: '8px', minHeight: '200px' }}>
                            {colJobs.length > 0 ? colJobs.map(job => {
                              const statusInfo = STATUS_INFO[job.status] || {};
                              const typeInfo = JOB_TYPE_INFO[job.type] || {};
                              const age = getJobAge(job);
                              const urgency = getAgeUrgency(age);
                              return (
                                <div key={job.id} onClick={() => setSelectedJobId(job.id)} style={{
                                  background: '#1a1a2e', borderRadius: '8px', padding: '10px', marginBottom: '6px',
                                  cursor: 'pointer', borderLeft: `3px solid ${col.color}`,
                                  transition: 'background 0.15s'
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3px' }}>
                                    <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600, flex: 1 }}>{job.customer_name || 'Unknown'}</span>
                                    {job.job_number && <span style={{ color: '#00c8e8', fontSize: '10px', fontWeight: 600 }}>{job.job_number}</span>}
                                  </div>
                                  <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '6px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                    {job.issue || 'No description'}
                                  </div>
                                  {job._scheduled_for && (
                                    <div style={{ color: '#3b82f6', fontSize: '10px', fontWeight: 600, marginBottom: '4px' }}>
                                      📅 {new Date(job._scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} @ {new Date(job._scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                      <span style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 600, color: '#fff', background: typeInfo.color || '#6b7280' }}>
                                        {typeInfo.label || job.type || 'SVC'}
                                      </span>
                                      {job._tech_name && (
                                        <span style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 600, color: '#fff', background: TECH_COLORS[job._tech_name] || '#6b7280' }}>
                                          {job._tech_name}
                                        </span>
                                      )}
                                    </div>
                                    <span style={{ color: urgency.color, fontSize: '10px', fontWeight: 600 }}>{age > 0 ? `${age}d` : 'Today'}</span>
                                  </div>
                                </div>
                              );
                            }) : (
                              <div style={{ textAlign: 'center', padding: '20px', color: '#475569', fontSize: '12px' }}>Empty</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ===== CALENDAR VIEW ===== */}
              {boardView === 'calendar' && (
                <>
                  {/* Week navigation */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <button onClick={() => setCalendarWeekOffset(o => o - 1)} style={{
                      background: '#1e293b', border: 'none', borderRadius: '8px', color: '#e2e8f0',
                      padding: '8px 14px', fontSize: '14px', cursor: 'pointer'
                    }}>◀</button>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: '#e2e8f0', fontSize: '15px', fontWeight: 700 }}>
                        {weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      {calendarWeekOffset !== 0 && (
                        <button onClick={() => setCalendarWeekOffset(0)} style={{
                          background: 'none', border: 'none', color: '#00c8e8', fontSize: '11px', cursor: 'pointer', padding: '2px'
                        }}>← Today</button>
                      )}
                    </div>
                    <button onClick={() => setCalendarWeekOffset(o => o + 1)} style={{
                      background: '#1e293b', border: 'none', borderRadius: '8px', color: '#e2e8f0',
                      padding: '8px 14px', fontSize: '14px', cursor: 'pointer'
                    }}>▶</button>
                  </div>

                  {/* Summary: jobs per day */}
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', overflowX: 'auto' }}>
                    {weekDays.map((day, i) => {
                      const dayJobs = getJobsForDay(day);
                      const today = isToday(day);
                      return (
                        <div key={i} style={{
                          flex: 1, minWidth: '44px', textAlign: 'center', padding: '8px 4px',
                          background: today ? '#00c8e815' : '#1e293b', borderRadius: '8px',
                          border: today ? '1px solid #00c8e8' : '1px solid transparent'
                        }}>
                          <div style={{ color: today ? '#00c8e8' : '#94a3b8', fontSize: '10px', fontWeight: 600 }}>
                            {day.toLocaleDateString('en-US', { weekday: 'short' })}
                          </div>
                          <div style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: 700 }}>{day.getDate()}</div>
                          <div style={{
                            color: dayJobs.length > 0 ? '#22c55e' : '#475569', fontSize: '11px', fontWeight: 600
                          }}>{dayJobs.length}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Time grid */}
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '50px repeat(7, 1fr)', minWidth: '700px' }}>
                      {/* Day headers */}
                      <div style={{ padding: '6px', color: '#475569', fontSize: '10px' }}></div>
                      {weekDays.map((day, i) => (
                        <div key={i} style={{
                          padding: '6px', textAlign: 'center', fontSize: '11px', fontWeight: 600,
                          color: isToday(day) ? '#00c8e8' : '#94a3b8',
                          borderBottom: '1px solid #1e293b'
                        }}>
                          {day.toLocaleDateString('en-US', { weekday: 'short' })} {day.getDate()}
                        </div>
                      ))}

                      {/* Hour rows */}
                      {CALENDAR_HOURS.map(hour => (
                        <>
                          <div key={`h${hour}`} style={{
                            padding: '4px 6px', color: '#475569', fontSize: '10px', fontWeight: 600,
                            borderTop: '1px solid #1e293b15', textAlign: 'right', minHeight: '50px',
                            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end'
                          }}>
                            {hour > 12 ? `${hour - 12}p` : hour === 12 ? '12p' : `${hour}a`}
                          </div>
                          {weekDays.map((day, di) => {
                            const jobs = getJobsForDayHour(day, hour);
                            return (
                              <div key={`${hour}-${di}`} style={{
                                borderTop: '1px solid #1e293b30', borderLeft: '1px solid #1e293b15',
                                minHeight: '50px', padding: '2px',
                                background: isToday(day) ? '#00c8e805' : 'transparent'
                              }}>
                                {jobs.map(job => (
                                  <div key={job.id} onClick={() => setSelectedJobId(job.id)} style={{
                                    background: TECH_COLORS[job._tech_name] || '#3b82f6',
                                    borderRadius: '4px', padding: '3px 5px', marginBottom: '2px',
                                    cursor: 'pointer', fontSize: '10px', color: '#fff', fontWeight: 600,
                                    lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                  }}>
                                    <div>{job.customer_name || '?'}</div>
                                    {job._tech_name && <div style={{ opacity: 0.8, fontSize: '9px', fontWeight: 400 }}>{job._tech_name}</div>}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </>
                      ))}
                    </div>
                  </div>

                  {/* Unscheduled jobs */}
                  {(() => {
                    const unscheduled = allJobs.filter(j => !j._scheduled_for && j.status === JOB_STATUS.SCHEDULED);
                    if (unscheduled.length === 0) return null;
                    return (
                      <div style={{ marginTop: '16px' }}>
                        <div style={{ color: '#f59e0b', fontSize: '12px', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase' }}>
                          ⚠️ Scheduled but no date/time ({unscheduled.length})
                        </div>
                        {unscheduled.map(j => (
                          <div key={j.id} onClick={() => setSelectedJobId(j.id)} style={{
                            background: '#1a1a2e', borderRadius: '6px', padding: '8px 10px', marginBottom: '4px',
                            cursor: 'pointer', borderLeft: '3px solid #f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                          }}>
                            <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>{j.customer_name}</span>
                            {j._tech_name && <span style={{ color: TECH_COLORS[j._tech_name] || '#94a3b8', fontSize: '11px' }}>{j._tech_name}</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* ===== TECH LANES VIEW (original) ===== */}
              {boardView === 'lanes' && (<>
              
              {/* Status pills + sort + view toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
                {[
                  { key: 'new', label: 'New', count: statusCounts.new, color: '#e94560' },
                  { key: 'waiting', label: 'Waiting', count: statusCounts.waiting, color: '#f39c12' },
                  { key: 'scheduled', label: 'Scheduled', count: statusCounts.scheduled, color: '#27ae60' },
                  { key: 'toBill', label: 'To Bill', count: statusCounts.toBill, color: '#9b59b6' },
                ].map(p => (
                  <button key={p.key} onClick={() => setStatusFilter(statusFilter === p.key ? null : p.key)} style={{
                    background: statusFilter === p.key ? `${p.color}25` : '#16213e',
                    padding: '8px 14px', borderRadius: '20px', fontSize: '13px',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    border: statusFilter === p.key ? `1.5px solid ${p.color}` : '1.5px solid transparent',
                    color: '#e2e8f0', cursor: 'pointer'
                  }}>
                    {p.label}
                    <span style={{
                      background: p.color, padding: '2px 8px', borderRadius: '10px', fontWeight: 700, fontSize: '12px'
                    }}>{p.count}</span>
                  </button>
                ))}
                </div>
                {/* Sort dropdown */}
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  style={{
                    background: '#16213e', border: '1px solid #334155', borderRadius: '8px',
                    color: '#e2e8f0', padding: '8px 12px', fontSize: '12px', cursor: 'pointer'
                  }}
                >
                  <option value="age">Oldest First</option>
                  <option value="date">Newest First</option>
                  <option value="priority">Priority</option>
                  <option value="name">Name A-Z</option>
                </select>
                {/* View toggle */}
                <div style={{ display: 'flex', gap: '2px', background: '#16213e', borderRadius: '8px', padding: '2px', flexShrink: 0 }}>
                  <button onClick={() => setViewMode('line')} style={{
                    background: viewMode === 'line' ? '#334155' : 'transparent', border: 'none', borderRadius: '6px',
                    padding: '6px 8px', cursor: 'pointer', color: viewMode === 'line' ? '#00c8e8' : '#64748b', fontSize: '14px'
                  }} title="Line view">☰</button>
                  <button onClick={() => setViewMode('card')} style={{
                    background: viewMode === 'card' ? '#334155' : 'transparent', border: 'none', borderRadius: '6px',
                    padding: '6px 8px', cursor: 'pointer', color: viewMode === 'card' ? '#00c8e8' : '#64748b', fontSize: '14px'
                  }} title="Card view">▦</button>
                </div>
              </div>

              {/* Lane selector + lane content - hide when filtering waiting */}
              {statusFilter !== 'waiting' && (<>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                {allLanes.map(lane => (
                  <button
                    key={lane.key}
                    onClick={() => setActiveLane(lane.key)}
                    style={{
                      background: activeLane === lane.key ? lane.color : '#16213e',
                      color: '#fff', border: 'none', borderRadius: '8px',
                      padding: '10px 14px', fontSize: '13px', fontWeight: 600,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: '6px',
                      opacity: activeLane === lane.key ? 1 : 0.7
                    }}
                  >
                    {lane.label}
                    <span style={{
                      background: activeLane === lane.key ? 'rgba(255,255,255,0.3)' : '#0f3460',
                      padding: '2px 8px', borderRadius: '10px', fontSize: '11px'
                    }}>{lane.count}</span>
                  </button>
                ))}
              </div>

              {/* Active lane content */}
              <div style={{ minHeight: '200px' }}>
                {activeLane === 'unassigned' ? (
                  (() => {
                    const filtered = filterAndSort(unassignedJobs);
                    return filtered.length > 0 ? (
                      filtered.map(j => <RenderJob key={j.id} job={j} showAssign />)
                    ) : (
                      <div style={{ textAlign: 'center', padding: '30px', color: '#475569' }}>
                        {searchQuery ? 'No matching jobs' : statusFilter ? 'No matching jobs' : 'All jobs assigned'}
                      </div>
                    );
                  })()
                ) : (
                  (() => {
                    const lane = techLanes.find(l => l.tech.id === activeLane);
                    if (!lane) return <div style={{ textAlign: 'center', padding: '30px', color: '#475569' }}>No tech found</div>;
                    const filtered = filterAndSort(lane.jobs);
                    return filtered.length > 0 ? (
                      filtered.map(j => <RenderJob key={j.id} job={j} showAssign />)
                    ) : (
                      <div style={{ textAlign: 'center', padding: '30px', color: '#475569' }}>
                        {searchQuery ? 'No matching jobs' : statusFilter ? 'No matching jobs' : `Nothing assigned to ${lane.tech.name}`}
                      </div>
                    );
                  })()
                )}
              </div>
              </>)}

              {/* Blocked / Waiting section */}
              {searchJobs(blockedJobs).length > 0 && (!statusFilter || statusFilter === 'waiting') && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{
                    color: '#f39c12', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase',
                    marginBottom: '12px', padding: '10px 0', borderTop: '1px solid #1e293b'
                  }}>
                    BLOCKED / WAITING ({searchJobs(blockedJobs).length})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                    {/* Group by status */}
                    {[
                      { status: JOB_STATUS.NEEDS_PARTS, label: 'Waiting on Parts', icon: '📦' },
                      { status: JOB_STATUS.PENDING_MATERIALS, label: 'Waiting on Materials', icon: '🔧' },
                      { status: JOB_STATUS.RETURN_PENDING, label: 'Return Pending', icon: '🔄' },
                      { status: JOB_STATUS.PENDING_DECISION, label: 'Legacy — Needs Triage', icon: '⚠️' },
                    ].map(group => {
                      const items = searchJobs(blockedJobs).filter(j => j.status === group.status);
                      if (items.length === 0) return null;
                      return (
                        <div key={group.status} style={{ background: '#16213e', borderRadius: '12px', padding: '12px' }}>
                          <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f59e0b', marginBottom: '8px' }}>
                            {group.icon} {group.label}
                          </h3>
                          {items.map(j => (
                            <div
                              key={j.id}
                              onClick={() => setSelectedJobId(j.id)}
                              style={{ padding: '8px 0', borderTop: '1px solid #0f3460', cursor: 'pointer' }}
                            >
                              <div style={{ fontWeight: 600, fontSize: '13px', color: '#e2e8f0' }}>{j.customer_name}</div>
                              <div style={{ fontSize: '12px', color: '#64748b' }}>
                                {j.issue || 'No details'}
                                {j._tech_name && <span> · assigned to {j._tech_name}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </>)}
            </>
          )}

          {/* ===== CUSTOMERS TAB ===== */}
          {activeTab === 'customers' && !selectedCustomer && !showAddCustomer && (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  placeholder="Search by name, phone, address, CMS..."
                  style={{
                    flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
                    color: '#e2e8f0', padding: '12px 14px', fontSize: '14px', outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
                <button
                  onClick={() => { setCustomerForm({}); setShowAddCustomer(true); }}
                  style={{
                    background: '#22c55e', color: '#fff', border: 'none', borderRadius: '10px',
                    padding: '0 16px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >+ Add</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {customers.map(c => (
                  <div
                    key={c.id}
                    onClick={() => openCustomer(c)}
                    style={{
                      background: '#1e293b', borderRadius: '10px', padding: '12px',
                      cursor: 'pointer', border: '1px solid #ffffff08'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: '#e2e8f0', fontSize: '15px', fontWeight: '600' }}>{c.name}</div>
                        {c.address && <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>{c.address}</div>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {jobCounts[c.id] && (
                          <span style={{ color: '#00c8e8', fontSize: '13px', fontWeight: '600' }}>
                            {jobCounts[c.id]} task{jobCounts[c.id] > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {c.phone && <div style={{ color: '#475569', fontSize: '12px', marginTop: '2px' }}>📞 {c.phone}</div>}
                    {c.cms_account_id && <div style={{ color: '#475569', fontSize: '11px', marginTop: '2px' }}>CMS: {c.cms_account_id}</div>}
                  </div>
                ))}
                {customers.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '30px', color: '#475569' }}>
                    {customerSearch.length >= 2 ? 'No customers found' : 'Loading customers...'}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ===== ADD CUSTOMER FORM ===== */}
          {activeTab === 'customers' && showAddCustomer && (
            <div>
              <button onClick={() => setShowAddCustomer(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer', marginBottom: '12px' }}>
                ← Cancel
              </button>
              <h3 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', margin: '0 0 16px 0' }}>New Customer</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div><label style={labelStyle}>Name *</label><input value={customerForm.name || ''} onChange={e => setCustomerForm(f => ({ ...f, name: e.target.value }))} placeholder="Customer name" style={fieldStyle} /></div>
                <div><label style={labelStyle}>Address</label><input value={customerForm.address || ''} onChange={e => setCustomerForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St" style={fieldStyle} /></div>
                <div><label style={labelStyle}>Phone</label><input value={customerForm.phone || ''} onChange={e => setCustomerForm(f => ({ ...f, phone: e.target.value }))} placeholder="(303) 555-0000" style={fieldStyle} /></div>
                <div><label style={labelStyle}>Email</label><input value={customerForm.email || ''} onChange={e => setCustomerForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" style={fieldStyle} /></div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}><label style={labelStyle}>Gate Code</label><input value={customerForm.gate_code || ''} onChange={e => setCustomerForm(f => ({ ...f, gate_code: e.target.value }))} placeholder="#1234" style={fieldStyle} /></div>
                  <div style={{ flex: 1 }}><label style={labelStyle}>Panel Password</label><input value={customerForm.panel_password || ''} onChange={e => setCustomerForm(f => ({ ...f, panel_password: e.target.value }))} placeholder="****" style={fieldStyle} /></div>
                </div>
                <div><label style={labelStyle}>CMS Account ID</label><input value={customerForm.cms_account_id || ''} onChange={e => setCustomerForm(f => ({ ...f, cms_account_id: e.target.value }))} placeholder="DRH-0090" style={fieldStyle} /></div>
                <div><label style={labelStyle}>Notes</label><textarea value={customerForm.notes || ''} onChange={e => setCustomerForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes about this customer..." rows={3} style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} /></div>
                <button onClick={createCustomer} disabled={!customerForm.name?.trim()} style={{
                  background: customerForm.name?.trim() ? '#00c8e8' : '#334155', color: customerForm.name?.trim() ? '#000' : '#64748b',
                  border: 'none', borderRadius: '10px', padding: '14px', fontSize: '15px', fontWeight: '700', cursor: customerForm.name?.trim() ? 'pointer' : 'default', marginTop: '8px'
                }}>Create Customer</button>
              </div>
            </div>
          )}

          {/* Customer detail */}
          {activeTab === 'customers' && selectedCustomer && (
            <div>
              <button onClick={() => setSelectedCustomer(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer', marginBottom: '12px' }}>
                ← Back to customers
              </button>

              <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <h3 style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '700', margin: 0 }}>
                    {selectedCustomer.name}
                  </h3>
                  <button
                    onClick={() => { setIsEditingCustomer(!isEditingCustomer); setCustomerForm({ ...selectedCustomer }); }}
                    style={{
                      background: isEditingCustomer ? '#ef444420' : '#1e293b', color: isEditingCustomer ? '#ef4444' : '#00c8e8',
                      border: `1px solid ${isEditingCustomer ? '#ef444440' : '#334155'}`, borderRadius: '8px',
                      padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer'
                    }}
                  >{isEditingCustomer ? 'Cancel' : '✏️ Edit'}</button>
                </div>

                {isEditingCustomer ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div><label style={labelStyle}>Name</label><input value={customerForm.name || ''} onChange={e => setCustomerForm(f => ({ ...f, name: e.target.value }))} style={fieldStyle} /></div>
                    <div><label style={labelStyle}>Address</label><input value={customerForm.address || ''} onChange={e => setCustomerForm(f => ({ ...f, address: e.target.value }))} style={fieldStyle} /></div>
                    <div><label style={labelStyle}>Phone</label><input value={customerForm.phone || ''} onChange={e => setCustomerForm(f => ({ ...f, phone: e.target.value }))} style={fieldStyle} /></div>
                    <div><label style={labelStyle}>Email</label><input value={customerForm.email || ''} onChange={e => setCustomerForm(f => ({ ...f, email: e.target.value }))} style={fieldStyle} /></div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div style={{ flex: 1 }}><label style={labelStyle}>Gate Code</label><input value={customerForm.gate_code || ''} onChange={e => setCustomerForm(f => ({ ...f, gate_code: e.target.value }))} style={fieldStyle} /></div>
                      <div style={{ flex: 1 }}><label style={labelStyle}>Panel Password</label><input value={customerForm.panel_password || ''} onChange={e => setCustomerForm(f => ({ ...f, panel_password: e.target.value }))} style={fieldStyle} /></div>
                    </div>
                    <div><label style={labelStyle}>CMS Account ID</label><input value={customerForm.cms_account_id || ''} onChange={e => setCustomerForm(f => ({ ...f, cms_account_id: e.target.value }))} style={fieldStyle} /></div>
                    <div><label style={labelStyle}>Customer Notes</label><textarea value={customerForm.notes || ''} onChange={e => setCustomerForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} /></div>
                    <button onClick={saveCustomer} style={{
                      background: '#00c8e8', color: '#000', border: 'none', borderRadius: '8px',
                      padding: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', marginTop: '4px'
                    }}>Save Changes</button>
                  </div>
                ) : (
                  <>
                    {selectedCustomer.address && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ color: '#94a3b8', fontSize: '13px' }}>📍 {selectedCustomer.address}</span>
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(selectedCustomer.address)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#00c8e8', fontSize: '12px', textDecoration: 'none' }}>Navigate →</a>
                      </div>
                    )}
                    {selectedCustomer.phone && (
                      <a href={`tel:${selectedCustomer.phone}`} style={{ color: '#00c8e8', fontSize: '13px', textDecoration: 'none', display: 'block', marginBottom: '4px' }}>📞 {selectedCustomer.phone}</a>
                    )}
                    {selectedCustomer.email && <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>✉️ {selectedCustomer.email}</div>}
                    {selectedCustomer.gate_code && <div style={{ color: '#64748b', fontSize: '12px' }}>🚪 Gate: {selectedCustomer.gate_code}</div>}
                    {selectedCustomer.panel_password && <div style={{ color: '#64748b', fontSize: '12px' }}>🔐 Panel: {selectedCustomer.panel_password}</div>}
                    {selectedCustomer.cms_account_id && <div style={{ color: '#64748b', fontSize: '12px' }}>CMS: {selectedCustomer.cms_account_id}</div>}
                    {selectedCustomer.notes && <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '8px', padding: '8px', background: '#0f1729', borderRadius: '6px' }}>📝 {selectedCustomer.notes}</div>}
                  </>
                )}
              </div>

              {/* Notes section */}
              <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px' }}>
                  Notes ({customerNotes.length})
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input
                    value={newCustomerNote}
                    onChange={e => setNewCustomerNote(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustomerNote()}
                    placeholder="Add a note..."
                    style={{ ...fieldStyle, flex: 1 }}
                  />
                  <button onClick={addCustomerNote} style={{
                    background: '#00c8e8', color: '#000', border: 'none', borderRadius: '8px',
                    padding: '0 16px', fontSize: '18px', fontWeight: '700', cursor: 'pointer'
                  }}>+</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
                  {customerNotes.map(n => (
                    <div key={n.id} style={{ background: '#0f1729', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ color: '#e2e8f0', fontSize: '13px' }}>{n.notes}</div>
                      <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px', display: 'flex', gap: '8px' }}>
                        <span>{n.changed_by?.split('@')[0] || 'Unknown'}</span>
                        <span>·</span>
                        <span>{new Date(n.changed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {n.from_status && <span>· {n.from_status} → {n.to_status}</span>}
                        {n.job_number && <span style={{ color: '#00c8e8' }}>· {n.job_number}</span>}
                      </div>
                    </div>
                  ))}
                  {customerNotes.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '12px', color: '#475569', fontSize: '13px' }}>No notes yet</div>
                  )}
                </div>
              </div>

              <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>
                Task History ({customerJobs.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {customerJobs.map(j => (
                  <JobCard key={j.id} job={j} onClick={() => setSelectedJobId(j.id)} />
                ))}
                {customerJobs.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#475569' }}>No tasks for this customer</div>
                )}
              </div>
            </div>
          )}

          {/* ===== BILLING TAB ===== */}
          {activeTab === 'billing' && (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ color: '#8b5cf6', fontSize: '24px', fontWeight: '700' }}>{billingQueues.to_bill.length}</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>To Bill</div>
                </div>
                <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ color: '#f59e0b', fontSize: '24px', fontWeight: '700' }}>{billingQueues.estimates.length}</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Need Estimates</div>
                </div>
                <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ color: '#06b6d4', fontSize: '24px', fontWeight: '700' }}>{billingQueues.pending.length}</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Estimates Pending</div>
                </div>
                <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ color: '#22c55e', fontSize: '24px', fontWeight: '700' }}>{billingQueues.won.length}</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Won</div>
                </div>
              </div>

              {/* Missing notes warning */}
              {missingNotes.length > 0 && (
                <div style={{
                  background: '#f59e0b15', border: '1px solid #f59e0b30', borderRadius: '10px',
                  padding: '10px 12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                  <span style={{ fontSize: '16px' }}>⚠️</span>
                  <span style={{ color: '#f59e0b', fontSize: '13px' }}>
                    {missingNotes.length} task{missingNotes.length > 1 ? 's' : ''} in "To Bill" missing completion notes
                  </span>
                </div>
              )}

              {/* Billing queue selector */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto' }}>
                {[
                  { key: 'to_bill', label: 'To Bill', count: billingQueues.to_bill.length },
                  { key: 'estimates', label: 'Estimates', count: billingQueues.estimates.length },
                  { key: 'pending', label: 'Pending', count: billingQueues.pending.length },
                  { key: 'won', label: 'Won', count: billingQueues.won.length },
                ].map(q => (
                  <button
                    key={q.key}
                    onClick={() => setBillingTab(q.key)}
                    style={{
                      background: billingTab === q.key ? '#1e293b' : 'transparent',
                      color: billingTab === q.key ? '#e2e8f0' : '#64748b',
                      border: `1px solid ${billingTab === q.key ? '#334155' : 'transparent'}`,
                      borderRadius: '8px', padding: '8px 12px', fontSize: '12px',
                      cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: '500'
                    }}
                  >
                    {q.label} ({q.count})
                  </button>
                ))}
              </div>

              {/* Billing queue items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {billingQueues[billingTab]?.map(j => (
                  <div key={j.id}>
                    <JobCard job={j} onClick={() => setSelectedJobId(j.id)} />
                    {/* Missing notes indicator */}
                    {billingTab === 'to_bill' && !j.completion_notes?.trim() && (
                      <div style={{ color: '#f59e0b', fontSize: '11px', padding: '4px 8px' }}>
                        ⚠️ Missing completion notes — can't bill without details
                      </div>
                    )}
                  </div>
                ))}
                {(billingQueues[billingTab]?.length || 0) === 0 && (
                  <div style={{ textAlign: 'center', padding: '30px', color: '#475569' }}>
                    Nothing in this queue
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowNewJob(true)}
        style={{
          position: 'fixed', bottom: '80px', left: '16px', zIndex: 90,
          width: '52px', height: '52px', borderRadius: '50%',
          background: '#22c55e', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '26px', color: '#fff',
          boxShadow: '0 4px 15px rgba(34,197,94,0.3)'
        }}
      >
        +
      </button>

      {/* Modals */}
      {selectedJobId && (
        <JobDetail
          jobId={selectedJobId}
          onClose={() => setSelectedJobId(null)}
          onUpdate={loadData}
          accessToken={accessToken}
          userEmail={userEmail}
          userRole={userRole}
        />
      )}

      {showNewJob && (
        <NewJobModal
          onClose={() => setShowNewJob(false)}
          onCreated={() => loadData()}
          userEmail={userEmail}
        />
      )}
    </div>
  );
}
