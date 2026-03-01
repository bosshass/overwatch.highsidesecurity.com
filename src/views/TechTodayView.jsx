// ============================================
// Overwatch V3 - TechTodayView
// ============================================
// TODAY'S JOBS ONLY. Big buttons. Works with gloves.
// Austin & JR see this by default.
// Philosophy: "Useful first, strict never"
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { assignmentsApi, jobsApi, JOB_STATUS, techsApi, supabase } from '../services/supabase.js';
import usePullToRefresh from '../utils/usePullToRefresh.jsx';

// ============================================
// HELPERS
// ============================================

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function getJobTypeLabel(job) {
  if (job.job_type === 'installation') return { label: 'INSTALL', color: '#14b8a6', bg: '#14b8a620' };
  if (job.job_type === 'service') return { label: 'SERVICE', color: '#3b82f6', bg: '#3b82f620' };
  if (job.job_type === 'inspection') return { label: 'INSPECT', color: '#a855f7', bg: '#a855f720' };
  if (job.job_type === 'sales') return { label: 'SALES', color: '#f59e0b', bg: '#f59e0b20' };
  return { label: 'JOB', color: '#64748b', bg: '#64748b20' };
}

// ============================================
// CLOCK IN/OUT MODAL
// ============================================

function ClockModal({ job, assignment, mode, onClose, onSave }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(notes);
      onClose();
    } catch (e) {
      console.error('Clock save error:', e);
      alert('Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
    }}>
      <div style={{
        background: '#1e293b', borderRadius: '20px 20px 0 0', padding: '28px 24px 40px',
        width: '100%', maxWidth: '480px'
      }}>
        <div style={{ fontSize: '28px', fontWeight: '800', color: '#e2e8f0', marginBottom: '4px' }}>
          {mode === 'in' ? '🟢 Clock In' : '🔴 Clock Out'}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '20px' }}>
          {job.customer_name} — {timeStr}
        </div>

        {mode === 'out' && assignment?.time_in && (
          <div style={{
            background: '#0f1729', borderRadius: '12px', padding: '12px 16px',
            marginBottom: '16px', color: '#94a3b8', fontSize: '13px'
          }}>
            Clocked in at {formatTime(assignment.time_in)}
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
            {mode === 'out' ? 'Completion Notes (optional)' : 'Notes (optional)'}
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={mode === 'out' ? 'What was done? Any issues?' : 'Anything to note?'}
            rows={3}
            style={{
              width: '100%', background: '#0f1729', border: '2px solid #334155',
              borderRadius: '12px', color: '#e2e8f0', padding: '12px',
              fontSize: '16px', outline: 'none', resize: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, background: '#334155', color: '#94a3b8', border: 'none',
              borderRadius: '14px', padding: '18px', fontSize: '16px', fontWeight: '600',
              cursor: 'pointer', minHeight: '56px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, background: mode === 'in' ? '#22c55e' : '#ef4444',
              color: '#fff', border: 'none', borderRadius: '14px', padding: '18px',
              fontSize: '17px', fontWeight: '800', cursor: saving ? 'not-allowed' : 'pointer',
              minHeight: '56px', opacity: saving ? 0.7 : 1
            }}
          >
            {saving ? 'Saving...' : (mode === 'in' ? 'Clock In Now' : 'Complete Job')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// JOB CARD (big, touch-friendly)
// ============================================

function TechJobCard({ job, assignment, onClockIn, onClockOut, onNavigate, onCall }) {
  const typeInfo = getJobTypeLabel(job);
  const isClockedIn = assignment?.time_in && !assignment?.is_complete;
  const isComplete = assignment?.is_complete;

  // Elapsed time if clocked in
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!isClockedIn) return;
    const update = () => {
      const diff = Date.now() - new Date(assignment.time_in).getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [isClockedIn, assignment?.time_in]);

  const scheduledTime = assignment?.scheduled_for ? formatTime(assignment.scheduled_for) : null;
  const phone = job.customer_phone;
  const address = job.customer_address;

  return (
    <div style={{
      background: isComplete ? '#0f1729' : '#1e293b',
      borderRadius: '16px',
      border: `2px solid ${isComplete ? '#1e293b' : isClockedIn ? '#22c55e' : '#334155'}`,
      padding: '20px',
      marginBottom: '12px',
      opacity: isComplete ? 0.6 : 1,
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Active indicator */}
      {isClockedIn && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: 'linear-gradient(90deg, #22c55e, #00c8e8)',
          borderRadius: '16px 16px 0 0'
        }} />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{
              background: typeInfo.bg, color: typeInfo.color,
              fontSize: '11px', fontWeight: '700', padding: '3px 8px',
              borderRadius: '6px', letterSpacing: '0.05em'
            }}>
              {typeInfo.label}
            </span>
            {job.job_number && (
              <span style={{ color: '#475569', fontSize: '12px', fontFamily: 'monospace' }}>
                {job.job_number}
              </span>
            )}
            {scheduledTime && (
              <span style={{ color: '#64748b', fontSize: '12px' }}>
                @ {scheduledTime}
              </span>
            )}
          </div>
          <div style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', lineHeight: '1.2' }}>
            {job.customer_name}
          </div>
          {address && (
            <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '2px' }}>
              📍 {address}
            </div>
          )}
        </div>

        {/* Status badge */}
        <div style={{ textAlign: 'right' }}>
          {isComplete ? (
            <span style={{ color: '#22c55e', fontSize: '20px' }}>✓</span>
          ) : isClockedIn ? (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#22c55e', fontSize: '12px', fontWeight: '700' }}>ON SITE</div>
              <div style={{ color: '#22c55e', fontSize: '14px', fontWeight: '800' }}>{elapsed}</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Issue description */}
      {job.issue && (
        <div style={{
          background: '#0f1729', borderRadius: '10px', padding: '10px 12px',
          color: '#94a3b8', fontSize: '14px', lineHeight: '1.4', marginBottom: '14px'
        }}>
          {job.issue}
        </div>
      )}

      {/* Completion notes if done */}
      {isComplete && assignment?.completion_notes && (
        <div style={{
          background: '#22c55e15', border: '1px solid #22c55e40',
          borderRadius: '10px', padding: '10px 12px',
          color: '#86efac', fontSize: '13px', marginBottom: '14px'
        }}>
          ✓ {assignment.completion_notes}
        </div>
      )}

      {/* Action buttons */}
      {!isComplete && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {/* Call button */}
          {phone && (
            <button
              onClick={() => onCall(phone)}
              style={{
                flex: '1 1 auto', minWidth: '80px',
                background: '#1e3a5f', color: '#60a5fa',
                border: '2px solid #1e40af', borderRadius: '12px',
                padding: '14px 8px', fontSize: '15px', fontWeight: '700',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', minHeight: '52px'
              }}
            >
              📞 Call
            </button>
          )}

          {/* Navigate button */}
          {address && (
            <button
              onClick={() => onNavigate(address)}
              style={{
                flex: '1 1 auto', minWidth: '80px',
                background: '#1a3a2a', color: '#4ade80',
                border: '2px solid #166534', borderRadius: '12px',
                padding: '14px 8px', fontSize: '15px', fontWeight: '700',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', minHeight: '52px'
              }}
            >
              🗺️ Nav
            </button>
          )}

          {/* Clock In / Clock Out */}
          {!isClockedIn ? (
            <button
              onClick={() => onClockIn(job, assignment)}
              style={{
                flex: '2 1 auto', minWidth: '120px',
                background: '#22c55e', color: '#fff',
                border: 'none', borderRadius: '12px',
                padding: '14px 16px', fontSize: '16px', fontWeight: '800',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '8px', minHeight: '52px'
              }}
            >
              ▶ Start
            </button>
          ) : (
            <button
              onClick={() => onClockOut(job, assignment)}
              style={{
                flex: '2 1 auto', minWidth: '120px',
                background: '#ef4444', color: '#fff',
                border: 'none', borderRadius: '12px',
                padding: '14px 16px', fontSize: '16px', fontWeight: '800',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '8px', minHeight: '52px'
              }}
            >
              ■ Done
            </button>
          )}
        </div>
      )}

      {/* Complete time */}
      {isComplete && assignment?.time_out && (
        <div style={{ color: '#475569', fontSize: '12px', marginTop: '8px' }}>
          Completed at {formatTime(assignment.time_out)}
          {assignment.actual_hours && ` · ${assignment.actual_hours.toFixed(1)}h`}
        </div>
      )}
    </div>
  );
}

// ============================================
// EMPTY STATE
// ============================================

function EmptyState({ userName }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
      <div style={{ fontSize: '56px', marginBottom: '16px' }}>🛡️</div>
      <div style={{ color: '#e2e8f0', fontSize: '22px', fontWeight: '700', marginBottom: '8px' }}>
        {greeting}, {userName}!
      </div>
      <div style={{ color: '#64748b', fontSize: '15px', lineHeight: '1.5' }}>
        No jobs scheduled for today.
        <br />
        Check in with the office if you're expecting work.
      </div>
    </div>
  );
}

// ============================================
// MAIN VIEW
// ============================================

export default function TechTodayView({ accessToken, userEmail, userName }) {
  const [jobs, setJobs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [techId, setTechId] = useState(null);
  const [clockModal, setClockModal] = useState(null); // { job, assignment, mode }
  const [tab, setTab] = useState('today'); // today | upcoming

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get tech record
      const tech = await techsApi.getByEmail(userEmail);
      if (!tech) {
        setIsLoading(false);
        return;
      }
      setTechId(tech.id);

      // Get today's assignments
      const { start, end } = getTodayRange();
      const todayAssignments = await assignmentsApi.getTechSchedule(tech.id, start, end);
      setJobs(todayAssignments);

      // Also get active assignments (clocked in but not complete)
      const { data: activeAssignments } = await supabase
        .from('job_assignments')
        .select('*')
        .eq('tech_id', tech.id)
        .not('time_in', 'is', null)
        .eq('is_complete', false);

      setAssignments(activeAssignments || []);
    } catch (e) {
      console.error('TechTodayView load error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [userEmail]);

  useEffect(() => { loadData(); }, [loadData]);
  const { PullIndicator } = usePullToRefresh(loadData);

  // Get assignment for a job
  const getAssignment = (job) => {
    // The job from getTechSchedule already has assignment fields merged in
    if (job.assignment_id) return job;
    return assignments.find(a => a.job_id === job.id) || null;
  };

  const handleClockIn = (job, assignment) => {
    setClockModal({ job, assignment, mode: 'in' });
  };

  const handleClockOut = (job, assignment) => {
    setClockModal({ job, assignment, mode: 'out' });
  };

  const handleClockSave = async (notes) => {
    const { job, assignment, mode } = clockModal;
    const assignmentId = assignment?.assignment_id || assignment?.id;

    if (mode === 'in') {
      // Clock in: set time_in
      await supabase
        .from('job_assignments')
        .update({ time_in: new Date().toISOString() })
        .eq('id', assignmentId);
    } else {
      // Clock out: complete the assignment
      const timeOut = new Date().toISOString();
      const timeIn = assignment?.time_in;
      const actualHours = timeIn ? (new Date(timeOut) - new Date(timeIn)) / (1000 * 60 * 60) : null;

      await supabase
        .from('job_assignments')
        .update({
          time_out: timeOut,
          actual_hours: actualHours,
          is_complete: true,
          completion_notes: notes || null
        })
        .eq('id', assignmentId);

      // Update job status to complete
      await supabase
        .from('jobs')
        .update({ status: JOB_STATUS.COMPLETE, completed_at: timeOut, updated_by: userEmail })
        .eq('id', job.job_id || job.id);
    }

    await loadData();
  };

  const handleNavigate = (address) => {
    const encoded = encodeURIComponent(address);
    // Try Google Maps first, fall back to Apple Maps
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.open(`maps://maps.apple.com/?daddr=${encoded}`, '_blank');
    } else {
      window.open(`https://maps.google.com/maps?daddr=${encoded}`, '_blank');
    }
  };

  const handleCall = (phone) => {
    window.location.href = `tel:${phone.replace(/\D/g, '')}`;
  };

  // Sort: active (clocked in) first, then by scheduled time, complete last
  const sortedJobs = [...jobs].sort((a, b) => {
    const aAssign = getAssignment(a);
    const bAssign = getAssignment(b);
    const aActive = aAssign?.time_in && !aAssign?.is_complete;
    const bActive = bAssign?.time_in && !bAssign?.is_complete;
    const aComplete = aAssign?.is_complete;
    const bComplete = bAssign?.is_complete;

    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    if (!aComplete && bComplete) return -1;
    if (aComplete && !bComplete) return 1;

    const aTime = aAssign?.scheduled_for || a.scheduled_for || '';
    const bTime = bAssign?.scheduled_for || b.scheduled_for || '';
    return aTime.localeCompare(bTime);
  });

  const completedCount = sortedJobs.filter(j => getAssignment(j)?.is_complete).length;
  const totalCount = sortedJobs.length;

  if (isLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
        <PullIndicator />
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
        Loading your jobs...
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 12px 20px' }}>
      <PullIndicator />

      {/* Date header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '800' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        {totalCount > 0 && (
          <div style={{ color: '#64748b', fontSize: '13px', marginTop: '2px' }}>
            {completedCount}/{totalCount} jobs complete
          </div>
        )}
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div style={{
          height: '4px', background: '#1e293b', borderRadius: '4px',
          marginBottom: '20px', overflow: 'hidden'
        }}>
          <div style={{
            height: '100%', background: '#22c55e',
            width: `${(completedCount / totalCount) * 100}%`,
            borderRadius: '4px', transition: 'width 0.5s ease'
          }} />
        </div>
      )}

      {/* Jobs */}
      {sortedJobs.length === 0 ? (
        <EmptyState userName={userName} />
      ) : (
        sortedJobs.map((job) => {
          const assignment = getAssignment(job);
          return (
            <TechJobCard
              key={job.assignment_id || job.id}
              job={job}
              assignment={assignment}
              onClockIn={handleClockIn}
              onClockOut={handleClockOut}
              onNavigate={handleNavigate}
              onCall={handleCall}
            />
          );
        })
      )}

      {/* Clock modal */}
      {clockModal && (
        <ClockModal
          job={clockModal.job}
          assignment={clockModal.assignment}
          mode={clockModal.mode}
          onClose={() => setClockModal(null)}
          onSave={handleClockSave}
        />
      )}
    </div>
  );
}
