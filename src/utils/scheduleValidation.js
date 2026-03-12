// ============================================
// JUC-E V4 - Schedule Validation Utilities
// ============================================
// Implements SOP scheduling rules

import { INSTALL_TYPES } from './statusMachine.js';

/**
 * Check if a date is a Monday
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if Monday
 */
export function isMonday(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.getDay() === 1;
}

/**
 * Validate scheduling per SOP rules
 * @param {Object} job - Job object with job_type
 * @param {Date|string} scheduledDate - Proposed schedule date
 * @param {string} userRole - User role (operator can override)
 * @returns {Object} Validation result with isValid, canOverride, and message
 */
export function validateSchedule(job, scheduledDate, userRole = 'tech') {
  const date = typeof scheduledDate === 'string' ? new Date(scheduledDate) : scheduledDate;
  const isInstall = INSTALL_TYPES.includes(job.job_type);
  const isOperator = userRole === 'operator';

  // SOP Rule: No Installs on Monday
  if (isInstall && isMonday(date)) {
    return {
      isValid: false,
      canOverride: isOperator,
      rule: 'no_monday_installs',
      severity: 'warning',
      message: '⚠️ Company Policy: No installations on Mondays',
      explanation: 'Per SOP, installations should be scheduled Tuesday through Friday. This allows Monday for service calls, returns, and planning.',
      action: isOperator 
        ? 'You can override this policy as an operator if needed.'
        : 'Please select a different day (Tuesday-Friday recommended).'
    };
  }

  // Future rules can be added here:
  // - Check tech availability
  // - Check for scheduling conflicts
  // - Validate travel time between jobs
  // - Check if customer has overdue invoices

  return {
    isValid: true,
    canOverride: false,
    rule: null,
    severity: 'none',
    message: 'Schedule is valid',
    explanation: null,
    action: null
  };
}

/**
 * Get recommended schedule dates for a job
 * @param {Object} job - Job object
 * @param {Date} startDate - Start searching from this date (default: today)
 * @param {number} count - Number of recommendations to return
 * @returns {Array} Array of recommended dates with reasons
 */
export function getRecommendedDates(job, startDate = new Date(), count = 5) {
  const recommendations = [];
  const isInstall = INSTALL_TYPES.includes(job.job_type);
  let currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  while (recommendations.length < count) {
    const dayOfWeek = currentDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isMon = dayOfWeek === 1;

    // Skip weekends
    if (isWeekend) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    // For installs, skip Mondays
    if (isInstall && isMon) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const reason = isMon && !isInstall 
      ? 'Good for service calls and returns'
      : 'Available for scheduling';

    recommendations.push({
      date: new Date(currentDate),
      dateString: currentDate.toISOString().split('T')[0],
      dayName: dayNames[dayOfWeek],
      reason,
      isToday: currentDate.toDateString() === new Date().toDateString(),
      isTomorrow: currentDate.toDateString() === new Date(Date.now() + 86400000).toDateString()
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return recommendations;
}

/**
 * Format validation message for display
 * @param {Object} validation - Result from validateSchedule()
 * @returns {string} Formatted message
 */
export function formatValidationMessage(validation) {
  if (validation.isValid) {
    return '✅ Schedule is valid';
  }

  let message = validation.message;
  if (validation.explanation) {
    message += '\n\n' + validation.explanation;
  }
  if (validation.action) {
    message += '\n\n' + validation.action;
  }

  return message;
}
