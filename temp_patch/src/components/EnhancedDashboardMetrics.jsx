// ============================================
// JUC-E V4 - Enhanced Dashboard Metrics
// ============================================
// Adds new SOP compliance and workflow health metrics

import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';

export default function EnhancedDashboardMetrics({ onNavigate }) {
  const [metrics, setMetrics] = useState({
    installationsPendingApproval: 0,
    jobsWithOverruns: 0,
    jobsNeedingFollowup: 0,
    satisfactionRate: 0,
    reviewConversionRate: 0,
    avgOverrunMinutes: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      // Load installations pending approval
      const { data: pendingApprovals } = await supabase
        .from('installations_pending_approval')
        .select('*', { count: 'exact', head: true });

      // Load overrun stats
      const { data: overrunStats } = await supabase
        .from('overrun_stats')
        .select('*')
        .single();

      // Load jobs needing follow-up
      const { data: needingFollowup } = await supabase
        .from('jobs_needing_followup')
        .select('*', { count: 'exact', head: true });

      // Load satisfaction metrics
      const { data: satisfactionMetrics } = await supabase
        .from('satisfaction_metrics')
        .select('*')
        .single();

      setMetrics({
        installationsPendingApproval: pendingApprovals?.count || 0,
        jobsWithOverruns: overrunStats?.total_overruns || 0,
        jobsNeedingFollowup: needingFollowup?.count || 0,
        satisfactionRate: satisfactionMetrics?.satisfaction_rate || 0,
        reviewConversionRate: satisfactionMetrics?.review_conversion_rate || 0,
        avgOverrunMinutes: overrunStats?.avg_overrun_minutes || 0
      });
    } catch (e) {
      console.error('Error loading enhanced metrics:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ color: '#64748b', fontSize: '14px' }}>
        Loading enhanced metrics...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* SOP Compliance Section */}
      <div>
        <h3 style={{ 
          fontSize: '16px', 
          fontWeight: '700', 
          color: '#e2e8f0', 
          marginBottom: '12px' 
        }}>
          📋 SOP Compliance
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {/* Installations Pending Approval */}
          <div
            onClick={() => onNavigate?.('installations-pending-approval')}
            style={{
              background: metrics.installationsPendingApproval > 0 ? '#713f1215' : '#0c2d1e',
              border: `2px solid ${metrics.installationsPendingApproval > 0 ? '#f59e0b40' : '#22c55e40'}`,
              borderRadius: '12px',
              padding: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ 
              fontSize: '28px', 
              fontWeight: '700', 
              color: metrics.installationsPendingApproval > 0 ? '#f59e0b' : '#22c55e',
              marginBottom: '4px'
            }}>
              {metrics.installationsPendingApproval}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>
              Installations Awaiting Approval
            </div>
            {metrics.installationsPendingApproval > 0 && (
              <div style={{ color: '#f59e0b', fontSize: '11px' }}>
                ⚠️ Manager approval required
              </div>
            )}
          </div>

          {/* Jobs Needing Follow-up */}
          <div
            onClick={() => onNavigate?.('jobs-needing-followup')}
            style={{
              background: metrics.jobsNeedingFollowup > 5 ? '#713f1215' : '#0c2d1e',
              border: `2px solid ${metrics.jobsNeedingFollowup > 5 ? '#f59e0b40' : '#22c55e40'}`,
              borderRadius: '12px',
              padding: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ 
              fontSize: '28px', 
              fontWeight: '700', 
              color: metrics.jobsNeedingFollowup > 5 ? '#f59e0b' : '#22c55e',
              marginBottom: '4px'
            }}>
              {metrics.jobsNeedingFollowup}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>
              Jobs Need Satisfaction Email
            </div>
            {metrics.jobsNeedingFollowup > 5 && (
              <div style={{ color: '#f59e0b', fontSize: '11px' }}>
                ⚠️ Follow-up overdue
              </div>
            )}
          </div>

          {/* Jobs with Overruns */}
          <div
            onClick={() => onNavigate?.('job-overruns')}
            style={{
              background: metrics.jobsWithOverruns > 10 ? '#7c2d1215' : '#0f1729',
              border: `2px solid ${metrics.jobsWithOverruns > 10 ? '#dc262640' : '#334155'}`,
              borderRadius: '12px',
              padding: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ 
              fontSize: '28px', 
              fontWeight: '700', 
              color: metrics.jobsWithOverruns > 10 ? '#dc2626' : '#64748b',
              marginBottom: '4px'
            }}>
              {metrics.jobsWithOverruns}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>
              Jobs with Overruns (30 days)
            </div>
            {metrics.avgOverrunMinutes > 0 && (
              <div style={{ color: '#64748b', fontSize: '11px' }}>
                Avg: +{Math.round(metrics.avgOverrunMinutes)} min
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Customer Satisfaction Section */}
      <div>
        <h3 style={{ 
          fontSize: '16px', 
          fontWeight: '700', 
          color: '#e2e8f0', 
          marginBottom: '12px' 
        }}>
          😊 Customer Satisfaction
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {/* Satisfaction Rate */}
          <div style={{
            background: '#0c2d1e',
            border: '2px solid #22c55e40',
            borderRadius: '12px',
            padding: '16px'
          }}>
            <div style={{ 
              fontSize: '28px', 
              fontWeight: '700', 
              color: '#22c55e',
              marginBottom: '4px'
            }}>
              {metrics.satisfactionRate.toFixed(1)}%
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px' }}>
              Customer Satisfaction Rate
            </div>
            <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>
              Last 90 days
            </div>
          </div>

          {/* Review Conversion Rate */}
          <div style={{
            background: '#0f1729',
            border: '2px solid #3b82f640',
            borderRadius: '12px',
            padding: '16px'
          }}>
            <div style={{ 
              fontSize: '28px', 
              fontWeight: '700', 
              color: '#3b82f6',
              marginBottom: '4px'
            }}>
              {metrics.reviewConversionRate.toFixed(1)}%
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px' }}>
              Review Conversion Rate
            </div>
            <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>
              Requested → Received
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 style={{ 
          fontSize: '16px', 
          fontWeight: '700', 
          color: '#e2e8f0', 
          marginBottom: '12px' 
        }}>
          ⚡ Quick Actions
        </h3>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {metrics.installationsPendingApproval > 0 && (
            <button
              onClick={() => onNavigate?.('installations-pending-approval')}
              style={{
                background: '#f59e0b',
                color: '#000',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              ✅ Review {metrics.installationsPendingApproval} Installation{metrics.installationsPendingApproval !== 1 ? 's' : ''}
            </button>
          )}
          
          {metrics.jobsNeedingFollowup > 0 && (
            <button
              onClick={() => onNavigate?.('jobs-needing-followup')}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              📧 Send {metrics.jobsNeedingFollowup} Follow-up{metrics.jobsNeedingFollowup !== 1 ? 's' : ''}
            </button>
          )}
          
          <button
            onClick={() => onNavigate?.('overrun-analysis')}
            style={{
              background: '#334155',
              color: '#94a3b8',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            📊 View Overrun Analysis
          </button>
        </div>
      </div>
    </div>
  );
}
