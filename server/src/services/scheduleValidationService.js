import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import { leaveDaysFromCalendar, loadApprovedLeaveCalendar, loadApprovedLeaveIntervals } from './approvedLeaveCalendarService.js';
import { buildRosterLeaveCheck } from './leaveCoverageService.js';
import { isNonWorkShift } from './shiftSemanticService.js';

/**
 * 取得指定月份的所有天數
 * @param {string} month - YYYY-MM 格式
 * @returns {Array<string>} 日期陣列 (YYYY-MM-DD 格式)
 */
function getMonthDays(month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const days = [];
  const pointer = new Date(start);

  while (pointer < end) {
    days.push(pointer.toISOString().slice(0, 10));
    pointer.setUTCDate(pointer.getUTCDate() + 1);
  }
  
  return days;
}

/**
 * 月份的範圍 [月初, 下個月月初)，以 UTC 午夜表示（與班表日期同一種表示）
 * @param {string} month - YYYY-MM 格式
 * @returns {{ start: Date, end: Date }}
 */
function getMonthRange(month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

/**
 * 這個月的核准請假：所有要檢查的員工一起讀，每種資料最多讀一次（每個請假表單一個查詢），不會每位員工各查一次。
 *  - 日曆（哪幾天有核准請假）：第一次用到時一次讀完所有員工。
 *  - 時間區間（有時分的假有沒有涵蓋班次）：要到有員工真的在請假日排了上班班別才讀，同樣一次讀完所有員工。
 * 讀取失敗時每位員工的處理與原本相同：日曆讀不到當成沒有請假日；時間區間讀不到時，請假日排了上班就算衝突。
 * @param {Array} employeeIds - 要檢查的員工 ID
 * @param {Date} monthStart - 月份開始日期
 * @param {Date} monthEnd - 月份結束日期
 */
function createMonthLeaveSource(employeeIds, monthStart, monthEnd) {
  const range = { employeeIds, start: monthStart, end: monthEnd };
  let calendarLoad = null;
  let intervalsLoad = null;
  return {
    /** 員工在這個月的批准請假日期集合 (YYYY-MM-DD 格式) */
    async leaveDaysOf(employeeId) {
      if (!calendarLoad) calendarLoad = Promise.resolve().then(() => loadApprovedLeaveCalendar(range));
      try {
        return leaveDaysFromCalendar(await calendarLoad, employeeId);
      } catch (err) {
        console.error(`Error fetching leave days for employee ${employeeId}:`, err);
      }
      return new Set();
    },
    /** 員工在這個月的核准請假時間區間（loadApprovedLeaveIntervals 的格式）；讀取失敗時丟出錯誤 */
    async intervalsOf(employeeId) {
      if (!intervalsLoad) intervalsLoad = Promise.resolve().then(() => loadApprovedLeaveIntervals(range));
      const loaded = await intervalsLoad;
      return loaded?.get?.(String(employeeId)) || [];
    },
  };
}

/**
 * 請假日當中，真的被排上「被請假擋住的上班班別」的日期。
 * 只請幾小時的假沒涵蓋整個班次不算衝突（與排班、國定假日休假紀錄同一個判斷：leaveCoverageService）；
 * 班別設定裡找不到的班別、或讀不到請假時間，維持原本整天的判斷（請假日排了上班就算衝突）。
 * @param {string} employeeId - 員工ID
 * @param {Array<string>} days - 請假日且有上班列的日期 (YYYY-MM-DD)
 * @param {Map<string, Object|null>} workShiftByDay - 上班列的日期 -> 班別（找不到班別為 null）
 * @param {Object} leaveSource - createMonthLeaveSource 的結果（整個月、所有員工共用，不在這裡另外查詢）
 * @returns {Promise<Array<string>>} 衝突日期
 */
async function findBlockedWorkDays(employeeId, days, workShiftByDay, leaveSource) {
  if (!days.length) return [];
  let intervals;
  try {
    intervals = await leaveSource.intervalsOf(employeeId);
  } catch (err) {
    console.error(`Error fetching leave intervals for employee ${employeeId}:`, err);
    return days;
  }
  const check = buildRosterLeaveCheck(intervals);
  return days.filter((day) => check.blocks(day, workShiftByDay.get(day) || null));
}

/**
 * 載入班別設定（班別 id -> 班別），用來判斷排班列是否為不用上班的班別。
 * 載入失敗時回傳空表：所有排班列都當成上班班別，維持最嚴格的檢查。
 */
async function loadShiftMap() {
  try {
    const query = AttendanceSetting.findOne();
    const setting = query && typeof query.lean === 'function' ? await query.lean() : await query;
    return new Map((setting?.shifts || [])
      .filter((shift) => shift?._id)
      .map((shift) => [String(shift._id), shift]));
  } catch (err) {
    console.error('Error loading shifts for schedule completeness check:', err);
    return new Map();
  }
}

/**
 * 檢查單個員工的排班完整性
 * @param {Object} employee - 員工資料
 * @param {string} month - YYYY-MM 格式
 * @param {Map<string, Object>} shiftMap - 班別 id -> 班別
 * @param {Object|null} leaveSource - 整個月、所有員工共用的核准請假（createMonthLeaveSource）；
 *   沒有傳入時（單獨檢查一位員工）只讀這位員工的請假，同樣每種資料最多讀一次
 * @returns {Promise<Object>} 檢查結果
 */
async function validateEmployeeSchedule(employee, month, shiftMap = new Map(), leaveSource = null) {
  const monthDays = getMonthDays(month);
  const totalDays = monthDays.length;

  const { start: monthStart, end: monthEnd } = getMonthRange(month);
  const leave = leaveSource || createMonthLeaveSource([employee._id], monthStart, monthEnd);

  // 取得該員工的排班記錄
  const schedules = await ShiftSchedule.find({
    employee: employee._id,
    date: { $gte: monthStart, $lt: monthEnd },
  }).lean();
  
  // 只要有排班列（含休息日、例假、國定假日、請假班別）就算那天已排班
  const scheduledDays = new Set(
    schedules.map(s => new Date(s.date).toISOString().slice(0, 10))
  );
  // 不用上班的班別（休/例/國/請假）排在核准請假日不算衝突，只有上班班別才算（日期 -> 班別，找不到班別為 null）
  const workShiftByDay = new Map(
    schedules
      .filter((s) => {
        const shift = shiftMap.get(String(s.shiftId));
        return !(shift && isNonWorkShift(shift));
      })
      .map((s) => [new Date(s.date).toISOString().slice(0, 10), shiftMap.get(String(s.shiftId)) || null])
  );
  
  // 取得批准的請假天數
  const leaveDays = await leave.leaveDaysOf(employee._id);
  
  // 計算應排班天數 = 總天數 - 請假天數
  const requiredDays = totalDays - leaveDays.size;
  const actualScheduledDays = scheduledDays.size;
  
  // 檢查是否有請假日被排上班：只請幾小時的假、沒有涵蓋整個班次的不算衝突
  const conflictDays = await findBlockedWorkDays(
    employee._id,
    [...leaveDays].filter((day) => workShiftByDay.has(day)),
    workShiftByDay,
    leave,
  );
  
  // 找出缺少的排班日
  const missingDays = [];
  monthDays.forEach(day => {
    if (!scheduledDays.has(day) && !leaveDays.has(day)) {
      missingDays.push(day);
    }
  });
  
  const isComplete = missingDays.length === 0 && conflictDays.length === 0;
  
  return {
    employeeId: employee._id.toString(),
    employeeName: employee.name,
    role: employee.role,
    requiresScheduling: employee.requiresScheduling !== false, // 預設為 true
    totalDays,
    leaveDays: leaveDays.size,
    requiredDays,
    actualScheduledDays,
    missingDays,
    conflictDays,
    isComplete,
  };
}

/**
 * 驗證指定月份所有員工的排班完整性
 * 兼職人員（Employee.partTime）只是不套用排班「規範」檢核（一例一休、工時、班間隔，見 laborRuleValidationService）；
 * 這裡的「每天都有班表」完整性檢查照常計入，沒有排滿的兼職人員一樣算未完成。
 * @param {string} month - YYYY-MM 格式
 * @param {Object} options - 選項
 * @param {string} options.department - 部門ID (可選)
 * @param {string} options.subDepartment - 小單位ID (可選)
 * @param {string[]} options.employeeIds - 只檢查這些員工 (可選，非管理員的排班範圍)
 * @returns {Promise<Object>} 驗證結果
 */
export async function validateMonthSchedules(month, options = {}) {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Invalid month format. Expected YYYY-MM');
  }
  
  // 建立員工查詢條件
  const employeeQuery = {
    status: { $nin: ['離職員工'] }, // 排除離職員工
  };
  
  if (options.department) {
    employeeQuery.department = options.department;
  }
  
  if (options.subDepartment) {
    employeeQuery.subDepartment = options.subDepartment;
  }

  // 非管理員只檢查自己排班範圍內的員工（呼叫端傳入；沒傳代表不限制）
  if (Array.isArray(options.employeeIds)) {
    employeeQuery._id = { $in: options.employeeIds };
  }

  // 取得所有需要檢查的員工
  const employees = await Employee.find(employeeQuery).lean();
  const shiftMap = await loadShiftMap();
  // 主管可以選擇不參與排班
  const scheduledEmployees = employees.filter(
    (employee) => !(employee.role === 'supervisor' && employee.requiresScheduling === false)
  );
  // 核准請假整個月一起讀：所有員工共用同一份（每個請假表單一個查詢），不會每位員工各查一次
  const { start: monthStart, end: monthEnd } = getMonthRange(month);
  const leaveSource = createMonthLeaveSource(scheduledEmployees.map((employee) => employee._id), monthStart, monthEnd);

  // 逐一檢查每個員工
  const results = [];
  for (const employee of scheduledEmployees) {
    const result = await validateEmployeeSchedule(employee, month, shiftMap, leaveSource);
    results.push(result);
  }
  
  // 統計結果
  const incomplete = results.filter(r => !r.isComplete);
  const complete = results.filter(r => r.isComplete);
  const withConflicts = results.filter(r => r.conflictDays.length > 0);
  const withMissing = results.filter(r => r.missingDays.length > 0);
  
  return {
    month,
    totalEmployees: results.length,
    completeCount: complete.length,
    incompleteCount: incomplete.length,
    conflictCount: withConflicts.length,
    missingCount: withMissing.length,
    allComplete: incomplete.length === 0,
    results,
    incompleteEmployees: incomplete,
  };
}

/**
 * 取得需要排班提醒的員工清單
 * @param {string} month - YYYY-MM 格式
 * @param {Object} options - 選項
 * @returns {Promise<Array>} 未完成排班的員工清單
 */
export async function getIncompleteScheduleEmployees(month, options = {}) {
  const validation = await validateMonthSchedules(month, options);
  return validation.incompleteEmployees;
}

/**
 * 檢查是否可以完成發布
 * @param {string} month - YYYY-MM 格式
 * @param {Object} options - 選項
 * @returns {Promise<Object>} 檢查結果
 */
export async function canFinalizeSchedules(month, options = {}) {
  const validation = await validateMonthSchedules(month, options);
  
  return {
    canFinalize: validation.allComplete,
    reason: validation.allComplete 
      ? 'All employees have complete schedules' 
      : `${validation.incompleteCount} employee(s) have incomplete schedules`,
    incompleteEmployees: validation.incompleteEmployees,
  };
}
