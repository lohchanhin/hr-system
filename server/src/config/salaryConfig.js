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

// 特休的各種名稱：舊資料與手動輸入的「特休」，以及字典項目（C12）的「特休假」。
// 特休相關的判斷（薪資不扣款、特休報表）都用這個常數，兩種名稱視為同一種假。
export const ANNUAL_LEAVE_TYPES = ['特休', '特休假'];

// 假別薪資對照表：全系統唯一的來源，請假扣款與薪資報表的有薪/無薪判斷都查這張表。
// payRate：1 = 全薪（不扣款）、0.5 = 半薪（扣一半）、0 = 無薪（全額扣款）。
// names 放字典項目（C12）與舊資料常見的假別名稱，比對時忽略空白與全半形差異；
// 假別名稱只要包含表內某個名稱（例如「特休假（上午）」）也算，同時符合多個時取最長的名稱。
// 表內查不到的假別一律視為無薪（與先前行為相同，寧可多扣再補發，也不會多發薪水）。
// 客戶要調整某個假別的給薪方式，直接改這張表即可，不需要動其他程式。
export const LEAVE_TYPE_PAY_TABLE = [
  {
    category: 'paid',
    payRate: 1,
    names: [
      ...ANNUAL_LEAVE_TYPES, '年假', '休假', '補休', '公假', '公傷假', '公傷病假', '職災假',
      '婚假', '喪假', '產假', '分娩假', '流產假', '陪產假', '產檢假', '陪產檢假', '陪產檢及陪產假', '原民假',
    ],
  },
  { category: 'sick', payRate: 0.5, names: ['病假', '生理假'] },
  { category: 'unpaid', payRate: 0, names: ['事假', '無薪假', '無薪休假', '家庭照顧假', '留職停薪', '育嬰留職停薪'] },
];

function leaveNamesOf(category) {
  return LEAVE_TYPE_PAY_TABLE.filter((rule) => rule.category === category).flatMap((rule) => rule.names);
}

// Leave policy configuration（由上面的對照表整理出來，舊程式仍可直接讀這些清單）
export const LEAVE_POLICY = {
  // Paid leave types (no deduction)
  PAID_LEAVE_TYPES: leaveNamesOf('paid'),

  // Sick leave types
  SICK_LEAVE_TYPES: leaveNamesOf('sick'),

  // Sick leave pay rate (0.5 = 50% pay, 1.0 = full pay)
  SICK_LEAVE_PAY_RATE: LEAVE_TYPE_PAY_TABLE.find((rule) => rule.category === 'sick').payRate,

  // Personal leave types (unpaid)
  UNPAID_LEAVE_TYPES: leaveNamesOf('unpaid'),
};

function normalizeLeaveName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s()[\]]/g, '');
}

/**
 * 依假別名稱查給薪方式：{ category: 'paid' | 'sick' | 'unpaid', payRate, matchedName, known }。
 * 完全相同的名稱優先，其次取「包含」的最長名稱；查不到時 known 為 false，視為無薪。
 */
export function resolveLeavePay(leaveTypeName) {
  const key = normalizeLeaveName(leaveTypeName);
  const unknown = { category: 'unpaid', payRate: 0, matchedName: null, known: false };
  if (!key) return unknown;
  let best = null;
  for (const rule of LEAVE_TYPE_PAY_TABLE) {
    for (const name of rule.names) {
      const normalized = normalizeLeaveName(name);
      if (!normalized) continue;
      if (key === normalized) return { category: rule.category, payRate: rule.payRate, matchedName: name, known: true };
      if (key.includes(normalized) && (!best || normalized.length > best.length)) {
        best = { length: normalized.length, rule, name };
      }
    }
  }
  return best
    ? { category: best.rule.category, payRate: best.rule.payRate, matchedName: best.name, known: true }
    : unknown;
}

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

// 獎金申請表單：只有這些名稱的表單會被當成獎金（預設範本「獎金申請」），薪資不會去讀其他表單的數字欄位
export const BONUS_FORM_NAMES = ['獎金申請'];

// 獎金申請表單的欄位標籤（form_data 以欄位 ID 為鍵，要先依標籤找到欄位）
export const BONUS_FIELDS = {
  amount: ['金額', '獎金金額', 'amount'],
  type: ['獎金類型', '類型', 'bonusType'],
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
  ANNUAL_LEAVE_TYPES,
  LEAVE_POLICY,
  LEAVE_TYPE_PAY_TABLE,
  resolveLeavePay,
  OVERTIME_CONFIG,
  OVERTIME_FORM_NAMES,
  OVERTIME_FIELDS,
  BONUS_FORM_NAMES,
  BONUS_FIELDS,
  convertToHourlyRate,
  convertToDailyRate,
  calculateTaiwanOvertimeAmount,
};
