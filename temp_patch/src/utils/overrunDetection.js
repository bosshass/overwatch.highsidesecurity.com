// ============================================
// JUC-E V4 - Overrun Detection Utility
// ============================================
// Implements SOP requirement: "If work exceeds allotted time, tech must contact office"

import { JOB_TYPE_INFO } from './statusMachine.js';

/**
 * Calculate if a job has exceeded its expected duration
 * @param {string} jobType - The job type (e.g., 'service_res', 'service_com')
 * @param {string} timeArrived - Time arrived in HH:MM format
 * @param {string} timeDeparted - Time departed in HH:MM format
 * @returns {Object} Overrun analysis with isOverrun, actualMinutes, expectedMinutes, overrunMinutes
 */
export function detectOverrun(jobType, timeArrived, timeDeparted) {
  // Get expected duration for this job type
  const typeInfo = JOB_TYPE_INFO[jobType];
  const expectedMinutes = typeInfo?.minutes;

  // If no standard defined (e.g., installs), no overrun check
  if (!expectedMinutes) {
    return {
      isOverrun: false,
      actualMinutes: null,
      expectedMinutes: null,
      overrunMinutes: 0,
      hasStandard: false
    };
  }

  // Calculate actual duration
  if (!timeArrived || !timeDeparted) {
    return {
      isOverrun: false,
      actualMinutes: null,
      expectedMinutes,
      overrunMinutes: 0,
      hasStandard: true
    };
  }

  const [arriveHour, arriveMin] = timeArrived.split(':').map(Number);
  const [departHour, departMin] = timeDeparted.split(':').map(Number);
  
  const actualMinutes = (departHour * 60 + departMin) - (arriveHour * 60 + arriveMin);
  
  // Handle negative duration (crossed midnight or invalid input)
  if (actualMinutes < 0) {
    return {
      isOverrun: false,
      actualMinutes: null,
      expectedMinutes,
      overrunMinutes: 0,
      hasStandard: true,
      error: 'Invalid time range'
    };
  }

  const overrunMinutes = actualMinutes - expectedMinutes;
  const isOverrun = overrunMinutes > 15; // 15 minute grace period

  return {
    isOverrun,
    actualMinutes,
    expectedMinutes,
    overrunMinutes,
    hasStandard: true,
    actualHours: (actualMinutes / 60).toFixed(1),
    expectedHours: (expectedMinutes / 60).toFixed(1),
    overrunHours: (overrunMinutes / 60).toFixed(1)
  };
}

/**
 * Get severity level for overrun
 * @param {number} overrunMinutes - Minutes over expected duration
 * @returns {Object} Severity info with level, color, and message
 */
export function getOverrunSeverity(overrunMinutes) {
  if (overrunMinutes <= 15) {
    return {
      level: 'none',
      color: '#22c55e',
      message: 'Within expected time'
    };
  } else if (overrunMinutes <= 30) {
    return {
      level: 'minor',
      color: '#eab308',
      message: 'Slightly over expected time'
    };
  } else if (overrunMinutes <= 60) {
    return {
      level: 'moderate',
      color: '#f59e0b',
      message: 'Significantly over expected time'
    };
  } else {
    return {
      level: 'major',
      color: '#dc2626',
      message: 'Major overrun - office notification required'
    };
  }
}

/**
 * Format overrun message for display
 * @param {Object} overrunData - Result from detectOverrun()
 * @returns {string} Human-readable overrun message
 */
export function formatOverrunMessage(overrunData) {
  if (!overrunData.hasStandard) {
    return 'No time standard for this job type';
  }
  
  if (!overrunData.isOverrun) {
    return `On time (${overrunData.actualHours}h of ${overrunData.expectedHours}h standard)`;
  }

  const severity = getOverrunSeverity(overrunData.overrunMinutes);
  return `⚠️ ${severity.message}: ${overrunData.actualHours}h vs ${overrunData.expectedHours}h standard (+${overrunData.overrunHours}h over)`;
}

/**
 * Check if office notification is required for this overrun
 * @param {Object} overrunData - Result from detectOverrun()
 * @returns {boolean} True if office should be notified per SOP
 */
export function requiresOfficeNotification(overrunData) {
  // SOP: "If work is expected to exceed the allotted time, the technician must contact the office"
  return overrunData.isOverrun && overrunData.overrunMinutes > 30;
}
