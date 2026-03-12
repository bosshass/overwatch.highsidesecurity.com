// ============================================
// JUC-E V4 - Enhanced Time Capture Modal
// ============================================
// Adds overrun detection and office notification per SOP

import { useState, useEffect } from 'react';
import { detectOverrun, getOverrunSeverity, formatOverrunMessage, requiresOfficeNotification } from '../utils/overrunDetection.js';

export default function TimeCaptureModal({ 
  job, 
  pendingAction, 
  onSubmit, 
  onCancel, 
  isSubmitting 
}) {
  const [timeArrived, setTimeArrived] = useState('');
  const [timeDeparted, setTimeDeparted] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [officeNotified, setOfficeNotified] = useState(false);
  const [overrunData, setOverrunData] = useState(null);

  // Pre-fill departed time with current time
  useEffect(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    setTimeDeparted(`${hh}:${mm}`);
  }, []);

  // Detect overrun whenever times change
  useEffect(() => {
    if (timeArrived && timeDeparted) {
      const data = detectOverrun(job.job_type, timeArrived, timeDeparted);
      setOverrunData(data);
    } else {
      setOverrunData(null);
    }
  }, [timeArrived, timeDeparted, job.job_type]);

  const handleSubmit = () => {
    // Validate office notification if required
    if (overrunData && requiresOfficeNotification(overrunData) && !officeNotified) {
      alert('⚠️ This job significantly exceeded the time standard.\n\nPer company policy, you must notify the office before submitting.\n\nCheck the "Office Notified" box to proceed.');
      return;
    }

    // Validate notes for overruns
    if (overrunData?.isOverrun && (!completionNotes || completionNotes.trim().length < 10)) {
      alert('⚠️ Please add notes explaining why this job ran over the expected time.');
      return;
    }

    onSubmit({
      timeArrived,
      timeDeparted,
      completionNotes,
      overrunData,
      officeNotified: overrunData?.isOverrun ? officeNotified : null
    });
  };

  const severity = overrunData ? getOverrunSeverity(overrunData.overrunMinutes) : null;
  const needsNotification = overrunData && requiresOfficeNotification(overrunData);

  return (
    <div style={{
      position: 'fixed', 
      inset: 0, 
      background: 'rgba(0,0,0,0.9)', 
      zIndex: 300,
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      padding: '20px'
    }}>
      <div style={{
        background: '#1e293b', 
        borderRadius: '16px', 
        padding: '24px', 
        width: '100%', 
        maxWidth: '400px',
        borderTop: `4px solid ${pendingAction.color}`
      }}>
        {/* Header */}
        <div style={{ 
          fontSize: '18px', 
          fontWeight: '700', 
          color: '#e2e8f0', 
          marginBottom: '4px' 
        }}>
          {pendingAction.label}
        </div>
        <div style={{ 
          color: '#64748b', 
          fontSize: '13px', 
          marginBottom: '20px' 
        }}>
          {job.customer_name}
        </div>

        {/* Time Inputs */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ 
            color: '#94a3b8', 
            fontSize: '12px', 
            fontWeight: '600', 
            display: 'block', 
            marginBottom: '6px' 
          }}>
            🕐 Arrived
          </label>
          <input
            type="time"
            value={timeArrived}
            onChange={e => setTimeArrived(e.target.value)}
            style={{
              width: '100%', 
              background: '#0f1729', 
              border: '1px solid #334155', 
              borderRadius: '10px',
              color: '#e2e8f0', 
              padding: '12px', 
              fontSize: '16px', 
              outline: 'none', 
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ 
            color: '#94a3b8', 
            fontSize: '12px', 
            fontWeight: '600', 
            display: 'block', 
            marginBottom: '6px' 
          }}>
            🕐 Departed
          </label>
          <input
            type="time"
            value={timeDeparted}
            onChange={e => setTimeDeparted(e.target.value)}
            style={{
              width: '100%', 
              background: '#0f1729', 
              border: '1px solid #334155', 
              borderRadius: '10px',
              color: '#e2e8f0', 
              padding: '12px', 
              fontSize: '16px', 
              outline: 'none', 
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Calculated Hours with Overrun Detection */}
        {overrunData && overrunData.actualMinutes !== null && (
          <div style={{
            background: overrunData.isOverrun ? `${severity.color}15` : '#0c2d1e',
            border: `2px solid ${overrunData.isOverrun ? severity.color : '#22c55e'}40`,
            borderRadius: '10px',
            padding: '12px',
            marginBottom: '16px'
          }}>
            <div style={{ 
              color: overrunData.isOverrun ? severity.color : '#22c55e',
              fontSize: '14px', 
              fontWeight: '600', 
              marginBottom: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>⏱️ {overrunData.actualHours} hours</span>
              {overrunData.hasStandard && (
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  (std: {overrunData.expectedHours}h)
                </span>
              )}
            </div>
            {overrunData.isOverrun && (
              <div style={{ 
                color: severity.color, 
                fontSize: '12px', 
                marginTop: '4px' 
              }}>
                {severity.message}
              </div>
            )}
          </div>
        )}

        {/* Office Notification Checkbox (if needed) */}
        {needsNotification && (
          <div style={{
            background: '#7c2d1215',
            border: '2px solid #dc262640',
            borderRadius: '10px',
            padding: '12px',
            marginBottom: '16px'
          }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              color: '#dc2626',
              fontSize: '13px',
              fontWeight: '600'
            }}>
              <input
                type="checkbox"
                checked={officeNotified}
                onChange={e => setOfficeNotified(e.target.checked)}
                style={{ 
                  marginRight: '8px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              <span>
                📞 Office notified about overrun (required by SOP)
              </span>
            </label>
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ 
            color: '#94a3b8', 
            fontSize: '12px', 
            fontWeight: '600', 
            display: 'block', 
            marginBottom: '6px' 
          }}>
            📝 Notes {overrunData?.isOverrun && <span style={{ color: '#dc2626' }}>(required for overruns)</span>}
          </label>
          <textarea
            value={completionNotes}
            onChange={e => setCompletionNotes(e.target.value)}
            placeholder={overrunData?.isOverrun ? "Explain why this job ran over the expected time..." : "Quick summary of the job..."}
            rows={overrunData?.isOverrun ? 4 : 3}
            style={{
              width: '100%', 
              background: '#0f1729', 
              border: `1px solid ${overrunData?.isOverrun ? '#dc262660' : '#334155'}`, 
              borderRadius: '10px',
              color: '#e2e8f0', 
              padding: '12px', 
              fontSize: '14px', 
              outline: 'none',
              resize: 'none', 
              boxSizing: 'border-box', 
              fontFamily: 'inherit'
            }}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              flex: 1, 
              background: '#334155', 
              color: '#94a3b8', 
              border: 'none',
              borderRadius: '10px', 
              padding: '14px', 
              fontSize: '14px', 
              cursor: 'pointer',
              opacity: isSubmitting ? 0.5 : 1
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{
              flex: 2, 
              background: pendingAction.color, 
              color: '#000', 
              border: 'none',
              borderRadius: '10px', 
              padding: '14px', 
              fontSize: '15px', 
              fontWeight: '700',
              cursor: 'pointer', 
              opacity: isSubmitting ? 0.5 : 1
            }}
          >
            {isSubmitting ? 'Saving...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
