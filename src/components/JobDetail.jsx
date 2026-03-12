// ============================================
// JUC-E V4 - JobDetail Component
// ============================================
// Full job detail with workflow actions.
// Status dropdown, notes (prominent), audit trail, parts.
// Time capture on completion. Archive restricted to operator.

import { useState, useEffect, useCallback } from 'react';
import { jobsApi, assignmentsApi, techsApi, notesApi, STATUS_INFO, JOB_STATUS, queries, supabase } from '../services/supabase.js';
import { JOB_TYPE_INFO, PRIORITY_INFO, getJobAge, getAgeUrgency, VALID_TRANSITIONS, ACTIONS, PRE_SCHEDULE_CHECKLIST, getChecklistState, getChecklistBlockers, INSTALL_TYPES } from '../utils/statusMachine.js';
import { notifyJobComplete, notifyStatusChange } from '../services/pushNotifications.js';
import NotesPanel from './NotesPanel.jsx';
import ScheduleModal from './ScheduleModal.jsx';
import InstallationApprovalModal from './InstallationApprovalModal.jsx';
import TimeCaptureModal from './TimeCaptureModal.jsx';

export default function JobDetail({ jobId, onClose, onUpdate, accessToken, userEmail, userRole }) {
  const [job, setJob] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);

  // Time capture state
  const [showTimeCapture, setShowTimeCapture] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [timeArrived, setTimeArrived] = useState('');
  const [timeDeparted, setTimeDeparted] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');

  // Schedule modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Installation approval modal state
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // Duplicate merge state
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [potentialDuplicates, setPotentialDuplicates] = useState([]);
  const [selectedMergeTarget, setSelectedMergeTarget] = useState(null);
  const [isMerging, setIsMerging] = useState(false);

  // Pending parts form state
  const [showPartsForm, setShowPartsForm] = useState(false);
  const [partsNeeded, setPartsNeeded] = useState('');
  const [partsOrderedBy, setPartsOrderedBy] = useState('');
  const [partsETA, setPartsETA] = useState('');

  // Pre-schedule checklist
  const [manualChecks, setManualChecks] = useState({});
  const [linkedCustomer, setLinkedCustomer] = useState(null);
  const [showChecklistWarning, setShowChecklistWarning] = useState(false);
  const [pendingScheduleAction, setPendingScheduleAction] = useState(null);

  const isOperator = userRole === 'operator';

  const loadJob = useCallback(async () => {
    if (!jobId) return;
    setIsLoading(true);
    try {
      const data = await jobsApi.getById(jobId);
      setJob(data);
      const assigns = await assignmentsApi.getForJob(jobId);
      setAssignments(assigns);
      // Load checklist overrides
      try {
        const saved = data.checklist_overrides ? (typeof data.checklist_overrides === 'string' ? JSON.parse(data.checklist_overrides) : data.checklist_overrides) : {};
        setManualChecks(saved);
      } catch { setManualChecks({}); }
      // Load linked customer for access info
      if (data.customer_id) {
        try {
          const { data: cust } = await supabase.from('customers').select('*').eq('id', data.customer_id).maybeSingle();
          setLinkedCustomer(cust);
        } catch { setLinkedCustomer(null); }
      } else { setLinkedCustomer(null); }
    } catch (e) {
      console.error('Job load error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadJob(); }, [loadJob]);

  // Find potential duplicates (same customer or similar address/name)
  const findPotentialDuplicates = async () => {
    if (!job) return;
    try {
      // Search ALL jobs, not just open ones — duplicates could be anywhere
      const { data: allJobsList, error } = await supabase
        .from('jobs')
        .select('*')
        .not('status', 'eq', 'archived')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      
      const matches = (allJobsList || []).filter(j => {
        if (j.id === job.id) return false; // Skip self
        
        // Match by customer_id if both have one
        if (job.customer_id && j.customer_id === job.customer_id) return true;
        
        // Match by customer name (case insensitive, trim whitespace)
        if (job.customer_name && j.customer_name) {
          const name1 = job.customer_name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
          const name2 = j.customer_name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
          // Skip generic names
          if (name1.length < 3 || name2.length < 3) { /* skip */ }
          else if (name1 === name2) return true;
          // Fuzzy: one contains the other
          else if (name1.length > 4 && name2.length > 4 && (name1.includes(name2) || name2.includes(name1))) return true;
        }
        
        // Match by similar address (first 15 chars, alphanumeric only)
        if (job.customer_address && j.customer_address) {
          const addr1 = job.customer_address.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
          const addr2 = j.customer_address.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
          if (addr1.length > 5 && addr1 === addr2) return true;
        }
        
        return false;
      });
      
      // Sort by created_at descending (newest first)
      matches.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setPotentialDuplicates(matches);
      setShowDuplicateModal(true);
    } catch (e) {
      console.error('Duplicate search error:', e);
      alert('Error searching for duplicates: ' + e.message);
    }
  };

  // Merge this job into target job
  const handleMerge = async () => {
    if (!selectedMergeTarget || isMerging) return;
    setIsMerging(true);
    try {
      const targetJob = potentialDuplicates.find(j => j.id === selectedMergeTarget);
      
      // Build merge note with original job info
      const mergeNote = [
        `🔗 MERGED FROM JOB #${job.job_number || job.id.slice(0,8)}`,
        `Customer: ${job.customer_name}`,
        `Issue: ${job.issue || 'N/A'}`,
        `Merged on: ${new Date().toLocaleDateString()}`
      ].join('\n');
      
      // Add merge note to target job
      await notesApi.addNote(selectedMergeTarget, mergeNote, userEmail);
      
      // Add note to current job that it was merged
      await notesApi.addNote(job.id, `[MERGED INTO JOB #${targetJob?.job_number || selectedMergeTarget.slice(0,8)}]`, userEmail);
      
      // Mark current job as archived
      await jobsApi.changeStatus(job.id, JOB_STATUS.ARCHIVED, userEmail, `Merged into job #${targetJob?.job_number || selectedMergeTarget.slice(0,8)}`);
      
      setShowDuplicateModal(false);
      onUpdate?.();
      onClose();
    } catch (e) {
      console.error('Merge error:', e);
      alert('Error merging jobs: ' + e.message);
    } finally {
      setIsMerging(false);
    }
  };

  // Handle Needs Parts with details
  const handleNeedsParts = async () => {
    if (!partsNeeded.trim()) return;
    setActionInProgress('parts');
    try {
      // Build parts note
      const partsNote = [
        `📦 PARTS NEEDED (${new Date().toLocaleDateString()})`,
        `Parts: ${partsNeeded.trim()}`,
        partsOrderedBy ? `Ordered by: ${partsOrderedBy}` : null,
        partsETA ? `ETA: ${partsETA}` : null
      ].filter(Boolean).join('\n');
      
      // Add note and change status
      await jobsApi.addNote(job.id, partsNote, userEmail);
      await jobsApi.changeStatus(job.id, JOB_STATUS.NEEDS_PARTS, userEmail, partsNote);
      
      setShowPartsForm(false);
      setPartsNeeded('');
      setPartsOrderedBy('');
      setPartsETA('');
      await loadJob();
      onUpdate?.();
    } catch (e) {
      console.error('Parts error:', e);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStatusChange = async (newStatus) => {
    // BILLING GATE: Block billing if no completion notes
    if (newStatus === JOB_STATUS.BILLED && !job.completion_notes?.trim()) {
      alert('⚠️ Cannot mark as Billed — completion notes are required.\n\nAdd notes describing what was done before billing.');
      return;
    }
    // INSTALLATION APPROVAL GATE: Block billing if install type not approved
    if (newStatus === JOB_STATUS.BILLED && INSTALL_TYPES.includes(job.job_type) && !job.manager_approved_by) {
      alert('⚠️ Cannot mark as Billed — installation requires manager approval first.\n\nUse the "Approve Installation" action before billing.');
      return;
    }
    if (actionInProgress) return;
    setActionInProgress(newStatus);
    try {
      await jobsApi.changeStatus(job.id, newStatus, userEmail, statusNote || null);
      setStatusNote('');
      setShowStatusPicker(false);
      await loadJob();
      onUpdate?.();
    } catch (e) {
      console.error('Status change error:', e);
    } finally {
      setActionInProgress(null);
    }
  };

  const toggleChecklistItem = async (itemId) => {
    const updated = { ...manualChecks, [itemId]: !manualChecks[itemId] };
    setManualChecks(updated);
    try {
      await jobsApi.update(job.id, { checklist_overrides: updated }, userEmail);
    } catch (e) { console.warn('Checklist save failed:', e); }
  };

  const attemptSchedule = () => {
    const checkState = getChecklistState(job, assignments, manualChecks);
    const blockers = getChecklistBlockers(checkState);
    if (blockers.length > 0) {
      setPendingScheduleAction(true);
      setShowChecklistWarning(true);
    } else {
      setShowScheduleModal(true);
    }
  };

  // Completion flow — captures time then changes status
  const startCompletion = (action) => {
    setPendingAction(action);
    // Pre-fill current time for arrived if blank
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    setTimeDeparted(`${hh}:${mm}`);
    setTimeArrived('');
    setCompletionNotes('');
    setShowTimeCapture(true);
  };

  const submitCompletion = async (completionData) => {
    if (!pendingAction) return;
    setActionInProgress(pendingAction.toStatus);
    try {
      // Build full timestamps from time inputs
      const today = new Date().toISOString().split('T')[0];
      const tArrived = completionData?.timeArrived || timeArrived;
      const tDeparted = completionData?.timeDeparted || timeDeparted;
      const notes = completionData?.completionNotes || completionNotes;
      const timeIn = tArrived ? `${today}T${tArrived}:00` : null;
      const timeOut = tDeparted ? `${today}T${tDeparted}:00` : null;

      // Mark the assignment complete with time if one exists
      const activeAssignment = assignments.find(a => !a.is_complete);
      if (activeAssignment) {
        await assignmentsApi.markComplete(
          activeAssignment.id, timeIn, timeOut, notes || null, null,
          completionData?.officeNotified ?? null
        );
      }

      // Build status change note — prefix with overrun info if applicable
      let statusNote = notes || null;
      if (completionData?.overrunData?.isOverrun) {
        const overrunPrefix = `⚠️ OVERRUN: Job ran ${completionData.overrunData.overrunHours}h over standard. ${completionData.officeNotified ? 'Office notified.' : ''}`;
        statusNote = overrunPrefix + (notes ? `\n\n${notes}` : '');
      }

      // Change job status
      await jobsApi.changeStatus(job.id, pendingAction.toStatus, userEmail, statusNote);

      // Send notification
      if (pendingAction.toStatus === JOB_STATUS.COMPLETED || pendingAction.toStatus === JOB_STATUS.ARCHIVED) {
        const techName = activeAssignment?.tech?.name || userName || 'Tech';
        notifyJobComplete(techName, job.customer_name);
      } else {
        notifyStatusChange(job.customer_name, STATUS_INFO[pendingAction.toStatus]?.label || pendingAction.toStatus);
      }

      // Auto-assign to JR when Pending Parts is selected
      if (pendingAction.toStatus === JOB_STATUS.NEEDS_PARTS) {
        try {
          const allTechs = await techsApi.getAll();
          const jr = allTechs.find(t => t.name?.toLowerCase() === 'jr');
          if (jr) {
            await assignmentsApi.create({ job_id: job.id, tech_id: jr.id, scheduled_for: null }, userEmail);
          }
        } catch (e) { console.error('Auto-assign to JR error:', e); }
      }

      setShowTimeCapture(false);
      setPendingAction(null);
      await loadJob();
      onUpdate?.();
    } catch (e) {
      console.error('Completion error:', e);
    } finally {
      setActionInProgress(null);
    }
  };

  // Installation approval handler
  const handleApproval = async (approvalData) => {
    try {
      await jobsApi.update(job.id, {
        manager_approved_by: approvalData.approvedBy,
        manager_approved_at: approvalData.approvedAt,
        manager_approval_notes: approvalData.approvalNotes
      }, userEmail);
      setShowApprovalModal(false);
      await loadJob();
      onUpdate?.();
    } catch (e) {
      console.error('Approval error:', e);
      alert('Error approving installation: ' + e.message);
    }
  };

  // Quick actions based on current status
  const getQuickActions = () => {
    if (!job) return [];
    const status = job.status;
    const actions = [];

    switch (status) {
      case JOB_STATUS.NEW:
        actions.push(ACTIONS.MARK_READY, ACTIONS.NEEDS_DETAILS, ACTIONS.COMPLETE_SALES, ACTIONS.MARK_DEAD);
        break;
      case JOB_STATUS.NEEDS_DETAILS:
        actions.push(ACTIONS.MARK_READY, ACTIONS.NEEDS_PARTS, ACTIONS.COMPLETE_SALES);
        break;
      case JOB_STATUS.NEEDS_PARTS:
        actions.push(ACTIONS.MATERIALS_IN);
        break;
      case JOB_STATUS.PENDING_DECISION:
        // Legacy — show ways out
        actions.push(ACTIONS.MARK_READY, ACTIONS.NEEDS_PARTS, ACTIONS.COMPLETE_SALES);
        break;
      case JOB_STATUS.READY_TO_SCHEDULE:
        actions.push(ACTIONS.SCHEDULE);
        break;
      case JOB_STATUS.SCHEDULED:
        // Completion actions handled separately with time capture
        break;
      case JOB_STATUS.COMPLETE:
        actions.push(ACTIONS.MARK_BILLED, ACTIONS.COMPLETE_RETURN);
        break;
      case JOB_STATUS.TO_BILL:
        // Installation types require manager approval before billing
        if (INSTALL_TYPES.includes(job.job_type) && !job.manager_approved_by) {
          if (isOperator) {
            actions.push({
              label: '✅ Approve Installation',
              action: () => setShowApprovalModal(true),
              color: '#22c55e'
            });
          }
          // After approval, MARK_BILLED becomes available (handled below)
        } else {
          actions.push(ACTIONS.MARK_BILLED);
        }
        break;
      case JOB_STATUS.NEEDS_ESTIMATE:
        actions.push(ACTIONS.SEND_ESTIMATE, ACTIONS.MARK_DEAD);
        break;
      case JOB_STATUS.ESTIMATE_SENT:
        actions.push(ACTIONS.MARK_WON, ACTIONS.MARK_LOST);
        break;
      case JOB_STATUS.WON:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MARK_READY);
        break;
      case JOB_STATUS.RETURN_PENDING:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MARK_READY);
        break;
      case JOB_STATUS.BILLED:
        // Archive only for operators
        if (isOperator) actions.push(ACTIONS.ARCHIVE);
        break;
      default:
        break;
    }
    return actions;
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleString('en-US', { 
      month: 'short', day: 'numeric', 
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: 'numeric', minute: '2-digit' 
    });
  };

  const formatTimeOnly = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  if (isLoading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <div style={{ color: '#64748b' }}>Loading...</div>
      </div>
    );
  }

  if (!job) return null;

  const typeInfo = JOB_TYPE_INFO[job.job_type] || JOB_TYPE_INFO.service;
  const statusInfo = STATUS_INFO[job.status] || {};
  const age = getJobAge(job.created_at);
  const ageInfo = getAgeUrgency(age);
  const quickActions = getQuickActions();
  const validNextStatuses = VALID_TRANSITIONS[job.status] || [];
  const isScheduled = job.status === JOB_STATUS.SCHEDULED;

  // Completion actions for scheduled jobs
  const completionActions = [
    ACTIONS.COMPLETE_FIXED,
    ACTIONS.COMPLETE_RETURN,
    ACTIONS.COMPLETE_SALES,
    ACTIONS.COMPLETE_PARTS,
    ACTIONS.COMPLETE_NC,
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200,
      overflowY: 'auto', paddingBottom: '100px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, background: '#0f1729', zIndex: 10
      }}>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer', padding: '4px 8px' }}
        >
          ← Back
        </button>
        {job.job_number && (
          <span style={{ color: '#475569', fontSize: '13px' }}>{job.job_number}</span>
        )}
      </div>

      <div style={{ padding: '16px' }}>
        {/* Customer name + age */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#e2e8f0', margin: 0 }}>
              {job.customer_name || 'Unknown Customer'}
            </h2>
            {job.job_number && (
              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>
                Job #{job.job_number}
              </div>
            )}
          </div>
          {age > 0 && (
            <span style={{ color: ageInfo.color, fontSize: '14px', fontWeight: '700', background: `${ageInfo.color}15`, padding: '2px 8px', borderRadius: '6px' }}>
              {age}d
            </span>
          )}
        </div>

        {/* Type badge — tap to change */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setShowTypePicker(!showTypePicker); setShowPriorityPicker(false); }}
              style={{
                background: typeInfo.color, color: '#fff', padding: '6px 14px',
                borderRadius: '6px', fontSize: '12px', fontWeight: '700', border: 'none', cursor: 'pointer'
              }}
            >
              {typeInfo.icon} {typeInfo.label} ▾
            </button>
            <button
              onClick={() => { setShowPriorityPicker(!showPriorityPicker); setShowTypePicker(false); }}
              style={{
                background: `${(PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).color}20`,
                color: (PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).color,
                padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                border: `1px solid ${(PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).color}40`,
                cursor: 'pointer'
              }}
            >
              {(PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).icon} {(PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).label} ▾
            </button>
            {/* Status pill */}
            <span style={{
              background: `${statusInfo.color}20`, color: statusInfo.color,
              padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
              border: `1px solid ${statusInfo.color}40`
            }}>
              {statusInfo.label}
            </span>
            {/* Installation approval badge */}
            {INSTALL_TYPES.includes(job.job_type) && job.status === 'to_bill' && (
              <span style={{
                background: job.manager_approved_by ? '#0c2d1e' : '#713f1215',
                color: job.manager_approved_by ? '#22c55e' : '#f59e0b',
                padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600',
                border: `1px solid ${job.manager_approved_by ? '#22c55e40' : '#f59e0b40'}`
              }}>
                {job.manager_approved_by ? '✅ Approved' : '⏳ Needs Approval'}
              </span>
            )}
          </div>
        </div>

        {/* Type picker dropdown */}
        {showTypePicker && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '8px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {Object.entries(JOB_TYPE_INFO).filter(([key]) => {
                return ['task', 'note'].includes(key) || key === job.job_type ||
                  ['service_res', 'service_com', 'return_trip', 'install', 'new_construction', 'subcontractor', 'government', 'estimate', 'sales'].includes(key);
              }).map(([key, info]) => (
                <button key={key} onClick={async () => {
                  const wasTaskOrNote = ['task', 'note'].includes(job.job_type);
                  const isBecomingJob = !['task', 'note'].includes(key);
                  const updates = { job_type: key, updated_by: userEmail };

                  // Converting task/note → real job: set status to NEW
                  if (wasTaskOrNote && isBecomingJob) {
                    updates.status = JOB_STATUS.NEW;
                    await jobsApi.logHistory(job.id, job.status, JOB_STATUS.NEW, userEmail, `Converted from ${job.job_type} to ${key}`);
                  }

                  await jobsApi.update(job.id, updates);
                  setShowTypePicker(false);
                  loadJob();
                  onUpdate?.();
                }} style={{
                  background: job.job_type === key ? info.color : `${info.color}20`,
                  color: job.job_type === key ? '#fff' : info.color,
                  border: 'none', borderRadius: '6px', padding: '8px 14px', cursor: 'pointer',
                  fontSize: '12px', fontWeight: '600'
                }}>
                  {info.icon} {info.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Priority picker dropdown */}
        {showPriorityPicker && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '8px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {Object.entries(PRIORITY_INFO).map(([key, info]) => (
                <button key={key} onClick={async () => {
                  await jobsApi.update(job.id, { priority: key, updated_by: userEmail });
                  setShowPriorityPicker(false);
                  loadJob();
                }} style={{
                  background: job.priority === key ? `${info.color}40` : `${info.color}15`,
                  color: info.color,
                  border: `1px solid ${info.color}40`, borderRadius: '6px', padding: '8px 14px',
                  cursor: 'pointer', fontSize: '12px', fontWeight: '600'
                }}>
                  {info.icon} {info.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Assignments / scheduling info — split into confirmed, tentative, and soft-assigned */}
        {assignments.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {/* Scheduled assignments with dates */}
            {assignments.filter(a => a.scheduled_for).map(a => {
              // Tentative = has a scheduled_for date but job status is NOT 'scheduled'
              const isTentative = job.status !== JOB_STATUS.SCHEDULED && !a.is_complete;
              const isConfirmed = job.status === JOB_STATUS.SCHEDULED || a.is_complete;
              return (
                <span key={a.id} style={{
                  background: a.is_complete ? '#0c2d1e' : isTentative ? '#f59e0b10' : '#1e293b',
                  padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
                  color: a.is_complete ? '#22c55e' : isTentative ? '#f59e0b' : '#00c8e8',
                  border: `1px solid ${a.is_complete ? '#22c55e30' : isTentative ? '#f59e0b40' : '#00c8e840'}`,
                  borderStyle: isTentative ? 'dashed' : 'solid'
                }}>
                  {a.is_complete ? '✅' : isTentative ? '📌' : '📅'} {a.tech?.name || '?'} · {formatDateTime(a.scheduled_for)}
                  {a.is_complete && ' ✓'}
                  {isTentative && ' (tentative)'}
                </span>
              );
            })}
            {/* Soft assignments — responsibility only, no date */}
            {assignments.filter(a => !a.scheduled_for && !a.is_complete).map(a => (
              <span key={a.id} style={{
                background: '#1e293b', padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
                color: '#f59e0b',
                border: '1px solid #f59e0b30'
              }}>
                👤 Assigned: {a.tech?.name || '?'}
              </span>
            ))}
          </div>
        )}

        {/* ========================================
            COMPLETION SECTION — SCHEDULED JOBS
            This is THE main thing techs interact with
            ======================================== */}
        {isScheduled && (
          <div style={{
            background: '#0c2d1e', border: '2px solid #22c55e40', borderRadius: '14px',
            padding: '16px', marginBottom: '16px'
          }}>
            <div style={{ color: '#22c55e', fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>
              ✅ How'd It Go?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {completionActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => startCompletion(action)}
                  disabled={actionInProgress !== null}
                  style={{
                    background: `${action.color}15`,
                    color: action.color,
                    border: `2px solid ${action.color}50`,
                    borderRadius: '12px',
                    padding: '14px 16px',
                    fontSize: '15px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* TIME CAPTURE MODAL (Enhanced with overrun detection) */}
        {showTimeCapture && pendingAction && (
          <TimeCaptureModal
            job={job}
            pendingAction={pendingAction}
            onSubmit={submitCompletion}
            onCancel={() => { setShowTimeCapture(false); setPendingAction(null); }}
            isSubmitting={actionInProgress !== null}
          />
        )}

        {/* Customer details + access info */}
        <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
          {job.customer_address && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: '#94a3b8', fontSize: '13px' }}>📍 {job.customer_address}</span>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(job.customer_address)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#00c8e8', fontSize: '12px', textDecoration: 'none' }}
              >
                Navigate →
              </a>
            </div>
          )}
          {job.customer_phone && (
            <div style={{ marginBottom: '6px' }}>
              <a href={`tel:${job.customer_phone}`} style={{ color: '#00c8e8', fontSize: '13px', textDecoration: 'none' }}>
                📞 {job.customer_phone}
              </a>
            </div>
          )}
          {(job.gate_code || linkedCustomer?.gate_code) && (
            <div style={{ color: '#f59e0b', fontSize: '13px', marginBottom: '4px', fontWeight: '600' }}>
              🚪 Gate: {job.gate_code || linkedCustomer?.gate_code}
            </div>
          )}
          {(job.panel_password || linkedCustomer?.panel_password) && (
            <div style={{ color: '#f59e0b', fontSize: '13px', fontWeight: '600' }}>
              🔐 Panel: {job.panel_password || linkedCustomer?.panel_password}
            </div>
          )}
          {linkedCustomer?.cms_account_id && (
            <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
              📡 CMS: {linkedCustomer.cms_account_id}
            </div>
          )}
          {linkedCustomer?.notes && (
            <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px', fontStyle: 'italic' }}>
              💬 {linkedCustomer.notes}
            </div>
          )}
        </div>

        {/* PRE-SCHEDULE CHECKLIST */}
        {['new', 'needs_details', 'needs_parts', 'pending_decision', 'pending_materials', 'ready_to_schedule', 'return_pending'].includes(job.status) && job.job_type !== 'note' && job.job_type !== 'task' && (() => {
          const checkState = getChecklistState(job, assignments, manualChecks);
          const blockers = getChecklistBlockers(checkState);
          const totalItems = PRE_SCHEDULE_CHECKLIST.length;
          const doneItems = totalItems - blockers.length;
          const allDone = blockers.length === 0;
          return (
            <div style={{
              background: allDone ? '#0c2d1e' : '#1e293b',
              border: `2px solid ${allDone ? '#22c55e40' : '#f59e0b40'}`,
              borderRadius: '14px', padding: '14px', marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ color: allDone ? '#22c55e' : '#f59e0b', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase' }}>
                  {allDone ? '✅ Ready to Schedule' : `📋 Pre-Schedule Checklist (${doneItems}/${totalItems})`}
                </div>
                {!allDone && (
                  <span style={{ color: '#f59e0b', fontSize: '11px' }}>
                    {blockers.length} remaining
                  </span>
                )}
              </div>
              {PRE_SCHEDULE_CHECKLIST.map(item => {
                const checked = checkState[item.id];
                const isAuto = item.auto;
                return (
                  <div
                    key={item.id}
                    onClick={isAuto ? undefined : () => toggleChecklistItem(item.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 4px', cursor: isAuto ? 'default' : 'pointer',
                      borderBottom: '1px solid #0f172a20'
                    }}
                  >
                    <div style={{
                      width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0,
                      background: checked ? '#22c55e' : '#334155',
                      border: `2px solid ${checked ? '#22c55e' : '#475569'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '13px', color: '#fff', transition: 'all 0.15s'
                    }}>
                      {checked ? '✓' : ''}
                    </div>
                    <span style={{
                      color: checked ? '#94a3b8' : '#e2e8f0',
                      fontSize: '13px',
                      textDecoration: checked ? 'line-through' : 'none',
                      opacity: checked ? 0.7 : 1
                    }}>
                      {item.label}
                      {isAuto && <span style={{ color: '#475569', fontSize: '10px', marginLeft: '6px' }}>auto</span>}
                    </span>
                  </div>
                );
              })}
              {JOB_TYPE_INFO[job.job_type]?.minutes && (
                <div style={{ color: '#64748b', fontSize: '11px', marginTop: '8px', textAlign: 'right' }}>
                  ⏱ Expected: {JOB_TYPE_INFO[job.job_type].minutes} min
                </div>
              )}
            </div>
          );
        })()}

        {/* Checklist Warning Modal */}
        {showChecklistWarning && (() => {
          const checkState = getChecklistState(job, assignments, manualChecks);
          const blockers = getChecklistBlockers(checkState);
          return (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 300,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
            }}>
              <div style={{
                background: '#1e293b', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '360px',
                borderTop: '4px solid #f59e0b'
              }}>
                <div style={{ fontSize: '18px', fontWeight: '700', color: '#f59e0b', marginBottom: '12px' }}>
                  ⚠️ Checklist Incomplete
                </div>
                <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>
                  {blockers.length} item{blockers.length > 1 ? 's' : ''} not checked off:
                </div>
                {blockers.map(item => (
                  <div key={item.id} style={{ color: '#e2e8f0', fontSize: '13px', padding: '6px 0', display: 'flex', gap: '8px' }}>
                    <span style={{ color: '#f59e0b' }}>○</span> {item.label}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                  <button onClick={() => setShowChecklistWarning(false)} style={{
                    flex: 1, background: '#334155', color: '#94a3b8', border: 'none',
                    borderRadius: '10px', padding: '14px', fontSize: '14px', cursor: 'pointer'
                  }}>Go Back</button>
                  <button onClick={() => {
                    setShowChecklistWarning(false);
                    setShowScheduleModal(true);
                  }} style={{
                    flex: 1, background: '#f59e0b', color: '#000', border: 'none',
                    borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer'
                  }}>Schedule Anyway</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Issue */}
        {job.issue && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '6px' }}>Issue</div>
            <div style={{ color: '#e2e8f0', fontSize: '14px', lineHeight: '1.5' }}>{job.issue}</div>
          </div>
        )}

        {/* Estimate amount */}
        {job.estimate_amount && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Estimate</div>
            <div style={{ color: '#22c55e', fontSize: '22px', fontWeight: '700' }}>
              ${parseFloat(job.estimate_amount).toLocaleString()}
            </div>
          </div>
        )}

        {/* Parts */}
        {job.parts_needed && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px', border: '1px solid #f59e0b30' }}>
            <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>📦 Parts Needed</div>
            <div style={{ color: '#e2e8f0', fontSize: '14px' }}>{job.parts_needed}</div>
          </div>
        )}

        {/* Time tracking from assignments */}
        {assignments.length > 0 && assignments.some(a => a.time_in || a.time_out || a.actual_hours || a.is_complete) && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>Time Log</div>
            {assignments.filter(a => a.time_in || a.time_out || a.actual_hours || a.is_complete).map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0f1729' }}>
                <div>
                  <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>{a.tech?.name || 'Unknown'}</span>
                  {a.time_in && <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>In: {formatTimeOnly(a.time_in)}</span>}
                  {a.time_out && <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>Out: {formatTimeOnly(a.time_out)}</span>}
                </div>
                <div>
                  {a.actual_hours ? (
                    <span style={{ color: '#00c8e8', fontSize: '13px', fontWeight: '700' }}>{a.actual_hours.toFixed(1)}h</span>
                  ) : a.is_complete ? (
                    <span style={{ color: '#22c55e', fontSize: '12px' }}>✓ Done</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* === NOTES (PROMINENT) === */}
        <div style={{ marginBottom: '16px' }}>
          <NotesPanel jobId={job.id} userEmail={userEmail} />
        </div>

        {/* Quick actions */}
        {quickActions.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => {
                    // Custom action callback (e.g., approve installation)
                    if (action.action) {
                      action.action();
                    // Intercept NEEDS_PARTS to show form
                    } else if (action.toStatus === JOB_STATUS.NEEDS_PARTS) {
                      setShowPartsForm(true);
                    // Intercept SCHEDULED to show checklist gate
                    } else if (action.toStatus === JOB_STATUS.SCHEDULED) {
                      attemptSchedule();
                    } else {
                      handleStatusChange(action.toStatus);
                    }
                  }}
                  disabled={actionInProgress !== null}
                  style={{
                    background: `${action.color}15`,
                    color: action.color,
                    border: `1px solid ${action.color}40`,
                    borderRadius: '10px',
                    padding: '12px 16px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textAlign: 'left',
                    opacity: actionInProgress === action.toStatus ? 0.5 : 1
                  }}
                >
                  {actionInProgress === action.toStatus ? 'Working...' : action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mark as Duplicate button */}
        <button
          onClick={findPotentialDuplicates}
          style={{
            background: '#6366f115', color: '#6366f1', border: '1px solid #6366f140',
            borderRadius: '10px', padding: '12px 16px', fontSize: '14px', fontWeight: '600',
            cursor: 'pointer', width: '100%', textAlign: 'center', marginBottom: '12px'
          }}
        >
          🔗 Mark as Duplicate / Merge
        </button>

        {/* Status picker (all valid transitions) — operator only for archive */}
        {!showStatusPicker ? (
          <button
            onClick={() => setShowStatusPicker(true)}
            style={{
              background: 'none', border: '1px solid #334155', borderRadius: '8px',
              color: '#64748b', padding: '10px 16px', fontSize: '13px', cursor: 'pointer',
              width: '100%', textAlign: 'center'
            }}
          >
            Change status manually...
          </button>
        ) : (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginTop: '8px' }}>
            <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>Move to:</div>
            <input
              value={statusNote}
              onChange={e => setStatusNote(e.target.value)}
              placeholder="Add note for this change (optional)"
              style={{
                width: '100%', background: '#0f1729', border: '1px solid #334155', borderRadius: '8px',
                color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', marginBottom: '8px',
                outline: 'none', boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {validNextStatuses
                .filter(s => s !== JOB_STATUS.ARCHIVED || isOperator)
                .map(s => {
                const info = STATUS_INFO[s];
                return (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    disabled={actionInProgress !== null}
                    style={{
                      background: `${info.color}15`, color: info.color,
                      border: `1px solid ${info.color}30`, borderRadius: '6px',
                      padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                      fontWeight: '500'
                    }}
                  >
                    {info.label}
                  </button>
                );
              })}
              <button
                onClick={() => setShowStatusPicker(false)}
                style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div style={{ marginTop: '20px', padding: '12px', background: '#1a2332', borderRadius: '8px' }}>
          <div style={{ color: '#475569', fontSize: '11px' }}>Created: {formatDateTime(job.created_at)}</div>
          {job.scheduled_at && <div style={{ color: '#475569', fontSize: '11px' }}>Scheduled: {formatDateTime(job.scheduled_at)}</div>}
          {job.completed_at && <div style={{ color: '#475569', fontSize: '11px' }}>Completed: {formatDateTime(job.completed_at)}</div>}
          {job.billed_at && <div style={{ color: '#475569', fontSize: '11px' }}>Billed: {formatDateTime(job.billed_at)}</div>}
          <div style={{ color: '#475569', fontSize: '11px' }}>Updated: {formatDateTime(job.updated_at)} by {job.updated_by?.split('@')[0]}</div>
        </div>
      </div>

      {/* Pending Parts Form Modal */}
      {showPartsForm && (
        <div style={{ 
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{ 
            background: '#1e293b', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ color: '#f59e0b', fontWeight: '700', fontSize: '16px' }}>📦 What parts are needed?</div>
              <button onClick={() => setShowPartsForm(false)} style={{ 
                background: 'none', border: 'none', color: '#64748b', fontSize: '24px', cursor: 'pointer' 
              }}>×</button>
            </div>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>Parts Needed *</label>
              <textarea
                value={partsNeeded}
                onChange={e => setPartsNeeded(e.target.value)}
                placeholder="e.g. 2x motion sensors, 1x panel battery, door contacts..."
                rows={3}
                autoFocus
                style={{
                  width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
                  color: '#e2e8f0', padding: '12px', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>Ordered by (optional)</label>
              <input
                value={partsOrderedBy}
                onChange={e => setPartsOrderedBy(e.target.value)}
                placeholder="JR, Austin, Amazon order #..."
                style={{
                  width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
                  color: '#e2e8f0', padding: '12px', fontSize: '14px', boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>Expected arrival (optional)</label>
              <input
                value={partsETA}
                onChange={e => setPartsETA(e.target.value)}
                placeholder="Tomorrow, Friday, 2-3 days..."
                style={{
                  width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px',
                  color: '#e2e8f0', padding: '12px', fontSize: '14px', boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowPartsForm(false)}
                style={{ 
                  flex: 1, padding: '12px', background: '#334155', color: '#e2e8f0',
                  border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer'
                }}
              >Cancel</button>
              <button 
                onClick={handleNeedsParts}
                disabled={!partsNeeded.trim() || actionInProgress === 'parts'}
                style={{ 
                  flex: 1, padding: '12px', 
                  background: partsNeeded.trim() ? '#f59e0b' : '#334155',
                  color: partsNeeded.trim() ? '#000' : '#64748b',
                  border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', 
                  cursor: partsNeeded.trim() ? 'pointer' : 'default'
                }}
              >{actionInProgress === 'parts' ? 'Saving...' : '📦 Mark Waiting on Parts'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Merge Modal */}
      {showDuplicateModal && (
        <div style={{ 
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{ 
            background: '#1e293b', borderRadius: '16px', width: '100%', maxWidth: '400px',
            maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column'
          }}>
            {/* Header */}
            <div style={{ padding: '16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>🔗 Merge Duplicate</div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Select job to merge this into</div>
              </div>
              <button onClick={() => setShowDuplicateModal(false)} style={{ 
                background: 'none', border: 'none', color: '#64748b', fontSize: '24px', cursor: 'pointer' 
              }}>×</button>
            </div>
            
            {/* Current job info */}
            <div style={{ padding: '12px 16px', background: '#0f172a', borderBottom: '1px solid #334155' }}>
              <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>THIS JOB (will be archived):</div>
              <div style={{ color: '#e2e8f0', fontWeight: '600' }}>{job.customer_name}</div>
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>{job.issue || 'No description'}</div>
            </div>
            
            {/* Potential matches */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              {potentialDuplicates.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '20px' }}>
                  No potential duplicates found for this customer.
                </div>
              ) : (
                <>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '12px' }}>
                    Found {potentialDuplicates.length} job(s) for this customer:
                  </div>
                  {potentialDuplicates.map(dupe => (
                    <div 
                      key={dupe.id}
                      onClick={() => setSelectedMergeTarget(dupe.id)}
                      style={{ 
                        background: selectedMergeTarget === dupe.id ? '#22c55e20' : '#0f172a',
                        border: selectedMergeTarget === dupe.id ? '2px solid #22c55e' : '1px solid #334155',
                        borderRadius: '10px', padding: '12px', marginBottom: '8px', cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '14px' }}>{dupe.customer_name}</div>
                          <div style={{ color: '#94a3b8', fontSize: '12px' }}>{dupe.issue || 'No description'}</div>
                        </div>
                        <span style={{ 
                          background: STATUS_INFO[dupe.status]?.color || '#64748b',
                          color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '600'
                        }}>
                          {STATUS_INFO[dupe.status]?.label || dupe.status}
                        </span>
                      </div>
                      <div style={{ color: '#64748b', fontSize: '11px', marginTop: '6px' }}>
                        #{dupe.job_number || dupe.id.slice(0,8)} · {new Date(dupe.created_at).toLocaleDateString()}
                        {dupe._tech_name && ` · ${dupe._tech_name}`}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            
            {/* Actions */}
            <div style={{ padding: '16px', borderTop: '1px solid #334155', display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowDuplicateModal(false)}
                style={{ 
                  flex: 1, padding: '12px', background: '#334155', color: '#e2e8f0',
                  border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer'
                }}
              >Cancel</button>
              <button 
                onClick={handleMerge}
                disabled={!selectedMergeTarget || isMerging}
                style={{ 
                  flex: 1, padding: '12px', 
                  background: selectedMergeTarget ? '#22c55e' : '#334155',
                  color: selectedMergeTarget ? '#fff' : '#64748b',
                  border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', 
                  cursor: selectedMergeTarget ? 'pointer' : 'default'
                }}
              >{isMerging ? 'Merging...' : 'Merge & Archive'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && job && (
        <ScheduleModal
          job={job}
          onClose={() => setShowScheduleModal(false)}
          onScheduled={() => {
            setShowScheduleModal(false);
            loadJob();
            onUpdate?.();
          }}
          userEmail={userEmail}
          userRole={userRole}
          accessToken={accessToken}
        />
      )}

      {/* Installation Approval Modal */}
      {showApprovalModal && job && (
        <InstallationApprovalModal
          job={job}
          assignments={assignments}
          onApprove={handleApproval}
          onCancel={() => setShowApprovalModal(false)}
          userEmail={userEmail}
          isSubmitting={actionInProgress !== null}
        />
      )}
    </div>
  );
}
