/**
 * Salary Calculation Configuration
 * 
 * This file contains configurable constants for salary calculations.
 * Modify these values to match your organization's policies.
 */

// Work hours configuration
export const WORK_HOURS_CONFIG = {
  // Standard hours per work day
  HOURS_PER_DAY: 8,
  
  // Standard days per month for salary calculation
  DAYS_PER_MONTH: 30,
  
  // Alternative: Use actual working days per month
  // DAYS_PER_MONTH: 22, // 22 working days
};

// Leave policy configuration
export const LEAVE_POLICY = {
  // Paid leave types (no deduction)
  PAID_LEAVE_TYPES: ['特休', '年假', '婚假', '喪假', '產假', '陪產假'],
  
  // Sick leave types
  SICK_LEAVE_TYPES: ['病假', '生理假'],
  
  // Sick leave pay rate (0.5 = 50% pay, 1.0 = full pay)
  SICK_LEAVE_PAY_RATE: 0.5,
  
  // Personal leave types (unpaid)
  UNPAID_LEAVE_TYPES: ['事假', '無薪假'],
};

// Overtime configuration
export const OVERTIME_CONFIG = {
  WEEKDAY_FIRST_2_HOURS: 4 / 3,
  WEEKDAY_AFTER_2_HOURS: 5 / 3,
  REST_DAY_FIRST_2_HOURS: 4 / 3,
  REST_DAY_HOURS_3_TO_8: 5 / 3,
  REST_DAY_HOURS_9_TO_12: 8 / 3,
  HOLIDAY_WITHIN_8_HOURS: 1,
};

export function calculateTaiwanOvertimeAmount(hours, hourlyRate, dayType = 'workday') {
  const duration = Math.max(Number(hours) || 0, 0);
  const rate = Math.max(Number(hourlyRate) || 0, 0);
  const segments = [];
  const addSegment = (segmentHours, multiplier, label) => {
    if (segmentHours <= 0) return;
    segments.push({
      hours: segmentHours,
      multiplier,
      label,
      amount: segmentHours * rate * multiplier,
    });
  };

  if (dayType === 'national_holiday') {
    if (duration > 0) addSegment(8, OVERTIME_CONFIG.HOLIDAY_WITHIN_8_HOURS, '國定假日8小時內加發一日工資');
    const excess = Math.max(duration - 8, 0);
    addSegment(Math.min(excess, 2), OVERTIME_CONFIG.WEEKDAY_FIRST_2_HOURS, '國定假日超過8小時之前2小時');
    addSegment(Math.min(Math.max(excess - 2, 0), 2), OVERTIME_CONFIG.WEEKDAY_AFTER_2_HOURS, '國定假日超過10小時之後2小時');
  } else if (dayType === 'rest_day') {
    addSegment(Math.min(duration, 2), OVERTIME_CONFIG.REST_DAY_FIRST_2_HOURS, '休息日前2小時');
    addSegment(Math.min(Math.max(duration - 2, 0), 6), OVERTIME_CONFIG.REST_DAY_HOURS_3_TO_8, '休息日第3至8小時');
    addSegment(Math.min(Math.max(duration - 8, 0), 4), OVERTIME_CONFIG.REST_DAY_HOURS_9_TO_12, '休息日第9至12小時');
  } else {
    addSegment(Math.min(duration, 2), OVERTIME_CONFIG.WEEKDAY_FIRST_2_HOURS, '平日前2小時');
    addSegment(Math.min(Math.max(duration - 2, 0), 2), OVERTIME_CONFIG.WEEKDAY_AFTER_2_HOURS, '平日第3至4小時');
  }

  return {
    amount: Math.round(segments.reduce((total, segment) => total + segment.amount, 0)),
    segments: segments.map((segment) => ({ ...segment, amount: Math.round(segment.amount) })),
  };
}

// Overtime form names to recognize
export const OVERTIME_FORM_NAMES = ['加班', '加班申請', '加班單'];

// Overtime approval field names
export const OVERTIME_FIELDS = {
  hours: ['hours', '加班時數', '時數'],
  date: ['date', '加班日期', '日期'],
  reason: ['reason', '加班原因', '原因'],
};

/**
 * Convert salary to hourly rate
 * @param {number} salaryAmount - The salary amount
 * @param {string} salaryType - '月薪', '日薪', or '時薪'
 * @returns {number} - Hourly rate
 */
export function convertToHourlyRate(salaryAmount, salaryType) {
  if (salaryType === '時薪') {
    return salaryAmount || 0;
  } else if (salaryType === '日薪') {
    return (salaryAmount || 0) / WORK_HOURS_CONFIG.HOURS_PER_DAY;
  } else { // 月薪
    return (salaryAmount || 0) / WORK_HOURS_CONFIG.DAYS_PER_MONTH / WORK_HOURS_CONFIG.HOURS_PER_DAY;
  }
}

/**
 * Convert salary to daily rate
 * @param {number} salaryAmount - The salary amount
 * @param {string} salaryType - '月薪', '日薪', or '時薪'
 * @returns {number} - Daily rate
 */
export function convertToDailyRate(salaryAmount, salaryType) {
  if (salaryType === '日薪') {
    return salaryAmount || 0;
  } else if (salaryType === '時薪') {
    return (salaryAmount || 0) * WORK_HOURS_CONFIG.HOURS_PER_DAY;
  } else { // 月薪
    return (salaryAmount || 0) / WORK_HOURS_CONFIG.DAYS_PER_MONTH;
  }
}

export default {
  WORK_HOURS_CONFIG,
  LEAVE_POLICY,
  OVERTIME_CONFIG,
  OVERTIME_FORM_NAMES,
  OVERTIME_FIELDS,
  convertToHourlyRate,
  convertToDailyRate,
  calculateTaiwanOvertimeAmount,
};
