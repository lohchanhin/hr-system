import AttendanceRecord from '../models/AttendanceRecord.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import ApprovalRequest from '../models/approval_request.js';
import Employee from '../models/Employee.js';
import Holiday from '../models/Holiday.js';
import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import FormField from '../models/form_field.js';
import { getAllLeaveFieldInfos } from './leaveFieldService.js';
import { calculateNightShiftAllowance } from './nightShiftAllowanceService.js';
import { isNonWorkShift, resolveShiftSemanticType } from './shiftSemanticService.js';
import { buildCountedHolidayDays } from './countedHolidayService.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';
import { computeLeaveDuration, sumLeaveHoursInRange } from '../utils/leaveDuration.js';
import { isOvertimeFormTemplate } from '../utils/formSemantics.js';
import { candidateSelectKeys, orderFieldCandidateIds, pickFieldValue, resolveCandidateIds } from '../utils/fieldCandidates.js';
import {
  WORK_HOURS_CONFIG,
  OVERTIME_FIELDS,
  resolveLeavePay,
  convertToHourlyRate,
  convertToDailyRate,
  calculateTaiwanOvertimeAmount
} from '../config/salaryConfig.js';

/**
 * 計算兩個時間點之間的分鐘數
 */
function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const diff = (new Date(end)).getTime() - (new Date(start)).getTime();
  if (!Number.isFinite(diff)) return 0;
  return Math.round(diff / 60000);
}

/**
 * 將分鐘轉換為小時
 */
function hoursFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * 解析時間字串 (HH:MM)
 */
function parseTimeParts(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour >= 24 || minute < 0 || minute >= 60) {
    return null;
  }
  return { hour, minute };
}

/**
 * 建立包含時間的日期物件
 */
function buildDateWithTime(baseDate, timeString) {
  const parts = parseTimeParts(timeString);
  if (!parts) return null;
  const date = new Date(baseDate);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date;
}

/**
 * 計算班別的休息時間(分鐘)
 */
function getShiftBreakMinutes(shift, date) {
  if (!shift) return 0;
  const base = new Date(date ?? Date.now());
  base.setUTCHours(0, 0, 0, 0);

  // 如果有明確的休息時間窗口
  if (Array.isArray(shift.breakWindows) && shift.breakWindows.length) {
    let windowMinutes = 0;
    shift.breakWindows.forEach((win) => {
      if (!win) return;
      const start = buildDateWithTime(base, win.start);
      let end = buildDateWithTime(base, win.end);
      if (!start || !end) return;
      if (end <= start) {
        end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
      }
      windowMinutes += Math.max(minutesBetween(start, end), 0);
    });
    if (windowMinutes > 0) return windowMinutes;
  }

  // 否則使用休息時長設定
  const durationCandidates = [shift.breakDuration, shift.breakMinutes];
  for (const candidate of durationCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  // 最後嘗試從 breakTime 解析
  if (shift.breakTime) {
    const parts = parseTimeParts(shift.breakTime);
    if (parts) return parts.hour * 60 + parts.minute;
  }
  return 0;
}

/**
 * 計算班別的開始和結束時間
 */
function computeShiftTimes(date, shift) {
  if (!shift) return { start: null, end: null };
  const base = new Date(date);
  base.setUTCHours(0, 0, 0, 0);
  
  const start = new Date(base);
  const [startHours, startMinutes] = String(shift.startTime ?? '00:00').split(':').map((value) => parseInt(value, 10) || 0);
  start.setUTCHours(startHours, startMinutes, 0, 0);
  
  const end = new Date(base);
  const [endHours, endMinutes] = String(shift.endTime ?? '00:00').split(':').map((value) => parseInt(value, 10) || 0);
  end.setUTCHours(endHours, endMinutes, 0, 0);
  
  // 結束早於開始 → 隔天；開始等於結束時，只有勾「跨日」才算整整 24 小時；
  // 結束晚於開始（例如 00:00-08:00）時，跨日旗標不再多加 24 小時
  if (end < start || (end.getTime() === start.getTime() && shift.crossDay)) {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  
  return { start, end };
}

/**
 * 格式化日期為 YYYY-MM-DD
 */
function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 建立日期鍵值
 */
function buildDateKey(date) {
  return formatDate(date);
}

/**
 * 將出勤記錄按員工和日期分組
 */
function groupAttendanceRecords(records) {
  const map = new Map();
  records.forEach((record) => {
    const employeeId = record.employee.toString();
    const dateKey = buildDateKey(record.timestamp);
    if (!employeeId || !dateKey) return;
    const key = `${employeeId}::${dateKey}`;
    if (!map.has(key)) {
      map.set(key, { clockIns: [], clockOuts: [] });
    }
    const entry = map.get(key);
    if (record.action === 'clockIn') {
      entry.clockIns.push(new Date(record.timestamp));
    } else if (record.action === 'clockOut') {
      entry.clockOuts.push(new Date(record.timestamp));
    }
  });
  
  // 排序打卡時間
  map.forEach((value) => {
    value.clockIns.sort((a, b) => a - b);
    value.clockOuts.sort((a, b) => a - b);
  });
  
  return map;
}

/**
 * 取得員工在特定月份的工作時數資料
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @returns {Object} - 工作時數計算結果
 */
export async function calculateWorkHours(employeeId, month, context = {}) {
  const employee = context.employee ?? await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }
  context.employee = employee;
  
  // 解析月份範圍
  const monthDate = new Date(month);
  const startDate = new Date(monthDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  
  // 取得班表設定
  const recordRangeEnd = new Date(endDate);
  recordRangeEnd.setUTCDate(recordRangeEnd.getUTCDate() + 1);
  const [attendanceSetting, schedules, attendanceRecords] = await Promise.all([
    context.attendanceSetting ?? AttendanceSetting.findOne().lean(),
    context.schedules ?? ShiftSchedule.find({
      employee: employeeId,
      date: { $gte: startDate, $lt: endDate }
    }).lean(),
    context.attendanceRecords ?? AttendanceRecord.find({
      employee: employeeId,
      timestamp: { $gte: startDate, $lt: recordRangeEnd },
      action: { $in: ['clockIn', 'clockOut'] }
    }).lean(),
  ]);
  context.attendanceSetting = attendanceSetting;
  context.schedules = schedules;
  context.attendanceRecords = attendanceRecords;

  const shiftMap = new Map();
  if (attendanceSetting && attendanceSetting.shifts) {
    attendanceSetting.shifts.forEach((shift) => {
      if (shift && shift._id) {
        shiftMap.set(shift._id.toString(), shift);
      }
    });
  }
  
  // 分組出勤記錄
  const recordMap = groupAttendanceRecords(attendanceRecords);
  
  // 計算工作時數
  let totalScheduledMinutes = 0;
  let totalWorkedMinutes = 0;
  let workDays = 0;
  const dailyDetails = [];
  
  schedules.forEach((schedule) => {
    const dateKey = buildDateKey(schedule.date);
    const shift = shiftMap.get(schedule.shiftId.toString());
    
    if (!shift) return;

    // 休息日 / 例假 / 國定假日 / 請假 / 沒有工作時間的班別：不排時數，也不算出勤日
    if (isNonWorkShift(shift)) {
      dailyDetails.push({
        date: dateKey,
        scheduledHours: 0,
        workedHours: 0,
        hasAttendance: false,
        shiftName: shift.name || 'Unnamed shift',
        clockInTime: null,
        clockOutTime: null
      });
      return;
    }
    
    const { start, end } = computeShiftTimes(schedule.date, shift);
    const breakMinutes = getShiftBreakMinutes(shift, schedule.date);
    const scheduledMinutes = Math.max(minutesBetween(start, end) - breakMinutes, 0);
    
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    let workedMinutes = 0;
    let hasAttendance = false;
    let clockInTime = null;
    let clockOutTime = null;
    
    // For cross-day shifts, we need to check both current day and next day for clock records
    // Also check previous day for clock-in if this is a cross-day shift
    let first = null;
    let last = null;
    
    // Check for clock-in on schedule date
    if (dayRecord && dayRecord.clockIns.length) {
      first = dayRecord.clockIns[0];
    }
    
    // For cross-day shifts, also check previous day for clock-in
    if (!first && shift.crossDay) {
      const prevDate = new Date(schedule.date);
      prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      const prevDateKey = buildDateKey(prevDate);
      const prevDayRecord = recordMap.get(`${employeeId}::${prevDateKey}`);
      
      if (prevDayRecord && prevDayRecord.clockIns.length) {
        first = prevDayRecord.clockIns[prevDayRecord.clockIns.length - 1]; // Use the last clock-in of previous day
      }
    }
    
    if (first) {
      clockInTime = first;
      
      // First, try to find clock-out on the same day as clock-in
      const clockInDateKey = buildDateKey(first);
      const clockInDayRecord = recordMap.get(`${employeeId}::${clockInDateKey}`);
      
      if (clockInDayRecord && clockInDayRecord.clockOuts.length) {
        // Find the first clock-out after the clock-in time
        for (const clockOut of clockInDayRecord.clockOuts) {
          if (clockOut > first) {
            last = clockOut;
            break;
          }
        }
      }
      
      // If no clock-out found on the same day, check next day (for cross-day shifts)
      if (!last) {
        const clockInNextDay = new Date(first);
        clockInNextDay.setUTCDate(clockInNextDay.getUTCDate() + 1);
        const nextDateKey = buildDateKey(clockInNextDay);
        const nextDayRecord = recordMap.get(`${employeeId}::${nextDateKey}`);
        
        if (nextDayRecord && nextDayRecord.clockOuts.length) {
          last = nextDayRecord.clockOuts[0]; // Use the first clock-out of next day
        }
      }
      
      if (last) {
        clockOutTime = last;
        workedMinutes = Math.max(minutesBetween(first, last) - breakMinutes, 0);
        hasAttendance = true;
        workDays++;
      }
    }
    
    totalScheduledMinutes += scheduledMinutes;
    totalWorkedMinutes += workedMinutes;
    
    dailyDetails.push({
      date: dateKey,
      scheduledHours: hoursFromMinutes(scheduledMinutes),
      workedHours: hoursFromMinutes(workedMinutes),
      hasAttendance,
      shiftName: shift.name || '未命名班別',
      clockInTime: clockInTime ? clockInTime.toISOString() : null,
      clockOutTime: clockOutTime ? clockOutTime.toISOString() : null
    });
  });
  
  return {
    workDays,
    scheduledHours: hoursFromMinutes(totalScheduledMinutes),
    actualWorkHours: hoursFromMinutes(totalWorkedMinutes),
    dailyDetails
  };
}

/**
 * 計算請假對薪資的影響
 * 請假依「請假日期」歸屬月份（台灣日期，跨月的假單拆到各自的月份），不看送簽（建立）的月份。
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @param {Object} options.withDailyBreakdown - 另外回傳每天的給薪請假時數（payableLeaveByDay），日薪計算要用
 * @returns {Object} - 請假扣款資料
 */
export async function calculateLeaveImpact(employeeId, month, context = {}, { withDailyBreakdown = false } = {}) {
  const employee = context.employee ?? await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }

  // 解析月份範圍
  const monthDate = new Date(month);
  const startDate = new Date(monthDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  // 薪資月份對應的台灣日期範圍 [windowStartKey, windowEndKey)
  const windowStartKey = formatDate(startDate);
  const windowEndKey = formatDate(endDate);

  // 取得所有請假表單配置（預設的「請假」與自建的請假表單並存時，每張都要計入；已停用的表單底下已核准的假單也要計入）
  const leaveForms = await getAllLeaveFieldInfos();

  if (!leaveForms.length) {
    return {
      leaveHours: 0,
      paidLeaveHours: 0,
      unpaidLeaveHours: 0,
      sickLeaveHours: 0,
      personalLeaveHours: 0,
      leaveDeduction: 0,
      leaveRecords: [],
      ...(withDailyBreakdown ? { payableLeaveByDay: {}, undatedPayableLeaveHours: 0 } : {})
    };
  }

  let totalLeaveHours = 0;
  let paidLeaveHours = 0;
  let unpaidLeaveHours = 0;
  let sickLeaveHours = 0;
  let personalLeaveHours = 0;
  const leaveRecords = [];
  // 每個台灣日期的給薪請假時數（全薪算全部、半薪算一半）；沒有請假日期的舊資料無從分日，另外累計
  const payableLeaveByDay = {};
  let undatedPayableLeaveHours = 0;

  // 每張請假表單各查一次該員工已核准的請假記錄（一張假單只屬於一張表單，不會重複計算）。
  // form_data 的日期是字串，沒辦法用資料庫的日期條件篩選，所以取回後依請假日期在程式裡篩出落在本月的部分。
  for (const leaveForm of leaveForms) {
    const { formId, startId, endId, typeId, daysId, typeOptions } = leaveForm;
    // 欄位被停用或換成同標籤的新欄位後，舊假單的答案還在舊欄位 ID 底下：逐張假單用第一個有填值的同標籤欄位
    const startIds = resolveCandidateIds(leaveForm.startIds, startId);
    const endIds = resolveCandidateIds(leaveForm.endIds, endId);
    const typeIds = resolveCandidateIds(leaveForm.typeIds, typeId);
    const daysIds = resolveCandidateIds(leaveForm.daysIds, daysId);
    let approvalQuery = ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: employeeId
    });
    if (approvalQuery && typeof approvalQuery.select === 'function') {
      const projection = ['createdAt', 'form_data.days', 'form_data.duration', 'form_data.hours']
        .concat(candidateSelectKeys(startIds, endIds, typeIds, daysIds).map((id) => `form_data.${id}`));
      approvalQuery = approvalQuery.select(projection.join(' '));
    }
    const approvals = (await approvalQuery.lean()) || [];

    // 建立假別類型映射
    const typeMap = new Map(typeOptions?.map((opt) => [String(opt.value), opt.label]));

    approvals.forEach((approval) => {
      const formData = approval.form_data || {};
      const typeValue = pickFieldValue(formData, typeIds);
      const typeCode = typeValue ? String(typeValue.code ?? typeValue.value ?? typeValue) : '';
      const leaveType = typeValue?.label ?? typeMap.get(typeCode) ?? typeCode;

      // 請假時數：表單有「天數」欄位且填了正數就以它為準，其次是舊資料的 days / duration / hours 鍵，
      // 否則由開始/結束時間推算（台灣時間；4 小時就是 4 小時，不再一律當成整天）
      const duration = computeLeaveDuration({
        startValue: pickFieldValue(formData, startIds),
        endValue: pickFieldValue(formData, endIds),
        filledDays: pickFieldValue(formData, daysIds),
        literalDays: formData.days ?? formData.duration,
        literalHours: formData.hours,
        hoursPerDay: WORK_HOURS_CONFIG.HOURS_PER_DAY,
      });

      let days;
      let hours;
      if (duration.perDay.length) {
        // 有請假日期：只算落在本月的部分
        hours = sumLeaveHoursInRange(duration.perDay, windowStartKey, windowEndKey);
        if (hours <= 0) return;
        days = Math.round((hours / WORK_HOURS_CONFIG.HOURS_PER_DAY) * 10000) / 10000;
      } else {
        // 沒有請假日期的舊資料，才退回用送簽（建立）時間歸屬月份
        const createdAt = approval.createdAt ? new Date(approval.createdAt) : null;
        if (createdAt && (createdAt < startDate || createdAt >= endDate)) return;
        ({ days, hours } = duration);
        if (hours <= 0) return;
      }

      totalLeaveHours += hours;

      // 依假別薪資對照表（salaryConfig.LEAVE_TYPE_PAY_TABLE）決定給薪方式：全薪不扣、半薪扣一半、無薪全扣
      const pay = resolveLeavePay(leaveType);
      unpaidLeaveHours += hours * (1 - pay.payRate);
      if (pay.category === 'paid') {
        paidLeaveHours += hours;
      } else if (pay.category === 'sick') {
        sickLeaveHours += hours;
      } else if (pay.known) {
        // 事假、家庭照顧假等明列的無薪假
        personalLeaveHours += hours;
      }
      // 對照表查不到的假別預設為無薪（只計入無薪時數）

      if (duration.perDay.length) {
        if (pay.payRate > 0) {
          duration.perDay.forEach((item) => {
            if (item.dateKey < windowStartKey || item.dateKey >= windowEndKey) return;
            payableLeaveByDay[item.dateKey] = (payableLeaveByDay[item.dateKey] ?? 0) + item.hours * pay.payRate;
          });
        }
      } else {
        undatedPayableLeaveHours += hours * pay.payRate;
      }

      const record = {
        leaveType,
        startDate: duration.startKey,
        endDate: duration.endKey,
        days,
        hours,
        payRate: pay.payRate,
        // 有給薪（全薪或半薪）才算有薪；全額扣款的假別是無薪
        isPaid: pay.payRate > 0
      };
      if (duration.perDay.length && hours < duration.hours) {
        // 跨月的假單：days / hours 是本月的部分，另外附上整張假單的天數與時數
        record.totalDays = duration.days;
        record.totalHours = duration.hours;
      }
      leaveRecords.push(record);
    });
  }

  // 計算請假扣款 - 使用配置的轉換函數。日薪、時薪是按出勤與有薪假給薪，
  // 無薪假沒有薪水可領，不能再扣一次，所以只有月薪才有請假扣款
  const salaryType = employee.salaryType || '月薪';
  const hourlyRate = convertToHourlyRate(employee.salaryAmount || 0, salaryType);
  const leaveDeduction = salaryType === '日薪' || salaryType === '時薪'
    ? 0
    : unpaidLeaveHours * hourlyRate;

  return {
    leaveHours: totalLeaveHours,
    paidLeaveHours,
    unpaidLeaveHours,
    sickLeaveHours,
    personalLeaveHours,
    leaveDeduction: Math.round(leaveDeduction),
    leaveRecords,
    ...(withDailyBreakdown ? { payableLeaveByDay, undatedPayableLeaveHours } : {})
  };
}

/**
 * 判斷加班日的日別：國定假日 > 休息日 > 平日。
 * 國定假日只看 holidayDays（已排除補班日與說明為空的週末），排班上的「國」班別不會自己變成國定假日。
 */
function resolveOvertimeDayType(dateKey, holidayDays, shift) {
  if (holidayDays.has(dateKey)) return 'national_holiday';
  return shift && resolveShiftSemanticType(shift) === 'rest_day' ? 'rest_day' : 'workday';
}

/**
 * 計算加班費
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @returns {Object} - 加班資料
 */
export async function calculateOvertimePay(employeeId, month, context = {}) {
  const employee = context.employee ?? await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }
  
  // 解析月份範圍
  const monthDate = new Date(month);
  const startDate = new Date(monthDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  // 薪資月份對應的台灣日期範圍 [windowStartKey, windowEndKey)
  const windowStartKey = formatDate(startDate);
  const windowEndKey = formatDate(endDate);
  
  // 如果員工設定為自動計算加班，從簽核系統取得加班記錄
  if (!employee.autoOvertimeCalc) {
    return {
      overtimeHours: 0,
      overtimePay: 0,
      overtimeRecords: []
    };
  }
  
  // 依实际加班日期归属月份，不以送签建立时间判断，避免跨月送签漏算。
  const overtimeForms = await ApprovalRequest.find({
    applicant_employee: employeeId,
    status: 'approved'
  }).populate('form').lean();
  
  // 表單性質有設定就以它為準，沒有表單性質的舊表單才用名稱推論
  const overtimeRecords = overtimeForms.filter((request) => isOvertimeFormTemplate(request.form));
  const overtimeFormIds = Array.from(new Set(overtimeRecords
    .map((request) => request.form?._id?.toString?.())
    .filter(Boolean)));
  // 停用的欄位也要載入：欄位被停用（或換成同標籤的新欄位）後，舊加班單的答案還在舊欄位 ID 底下
  const overtimeFields = overtimeFormIds.length
    ? await FormField.find({ form: { $in: overtimeFormIds } }).lean()
    : [];
  const fieldsByForm = new Map();
  for (const field of overtimeFields || []) {
    const formId = field.form?.toString?.() || '';
    if (!fieldsByForm.has(formId)) fieldsByForm.set(formId, []);
    fieldsByForm.get(formId).push(field);
  }

  const attendanceSetting = context.attendanceSetting ?? await AttendanceSetting.findOne().lean();
  const schedules = context.schedules ?? await ShiftSchedule.find({
    employee: employeeId,
    date: { $gte: startDate, $lt: endDate },
  }).lean();
  const shiftMap = new Map((attendanceSetting?.shifts || []).map((shift) => [String(shift._id), shift]));
  const scheduleByDate = new Map((schedules || []).map((schedule) => [
    new Date(schedule.date).toISOString().slice(0, 10),
    schedule,
  ]));
  const [holidays, holidayMoves] = await Promise.all([
    Holiday.find({ date: { $gte: startDate, $lt: endDate } }).lean(),
    HolidayMoveSetting.find({ enableHolidayMove: true }).lean(),
  ]);
  // 只讀「算數的國定假日」：補班日、工作日、說明為空的週末都不是國定假日
  const holidayDays = buildCountedHolidayDays({
    holidays,
    moves: holidayMoves,
    start: startDate,
    end: endDate,
  });
  
  let totalOvertimeHours = 0;
  let overtimePay = 0;
  const records = [];
  const overtimeIssues = [];
  const hourlyRate = convertToHourlyRate(employee.salaryAmount || 0, employee.salaryType || '月薪');

  for (const record of overtimeRecords) {
    const formFields = fieldsByForm.get(record.form?._id?.toString?.() || '') || [];
    const valueByLabels = (labels) => {
      const normalizedLabels = labels.map((label) => String(label).trim().toLowerCase());
      const matched = formFields.filter((candidate) => normalizedLabels.includes(String(candidate.label || '').trim().toLowerCase()));
      // 同標籤的欄位可能不只一個（舊欄位被停用後新增了同標籤的欄位）：啟用中的在前、停用的在後，
      // 這一張單用第一個有填值的欄位
      const candidateIds = orderFieldCandidateIds(matched);
      const picked = pickFieldValue(record.form_data, candidateIds);
      if (picked !== undefined) return picked;
      const field = matched.find((candidate) => String(candidate._id) === candidateIds[0]);
      for (const key of [field?._id?.toString?.(), field?.label, ...labels].filter(Boolean)) {
        if (Object.prototype.hasOwnProperty.call(record.form_data || {}, key)) return record.form_data[key];
      }
      return undefined;
    };
    // 嘗試從多個可能的欄位名稱取得加班時數
    let hours = parseFloat(valueByLabels(OVERTIME_FIELDS.hours)) || 0;
    let recordIssue = null;

    // 如果沒有直接的時數欄位，嘗試從開始/結束時間計算
    if (hours === 0) {
      const startTime = valueByLabels(['開始時間', '開始日期', 'startTime', 'start']);
      const endTime = valueByLabels(['結束時間', '結束日期', 'endTime', 'end']);
      const isCrossDay = valueByLabels(['是否跨日', 'crossDay']);

      if (startTime && endTime) {
        const start = new Date(startTime);
        const end = new Date(endTime);

        if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
          // 計算時間差異（小時）
          let diffMs = end.getTime() - start.getTime();

          // 記錄異常情況（在調整前）：結束時間早於開始時間，但申請單未勾選「跨日」。
          // 這通常代表申請人忘記勾選跨日，而不是真的 0 小時加班，因此不靜默略過，
          // 而是把時數算為 0 並回報成一筆需要人工確認的問題，而非默默漏發加班費。
          if (diffMs < 0 && !isCrossDay) {
            const message = `加班申請時間為 ${start.toISOString()} - ${end.toISOString()}，結束時間早於開始時間但未勾選「跨日」，時數已算為 0，請確認是否漏勾跨日`;
            console.warn(`Overtime record has negative duration without cross-day flag (start: ${start.toISOString()}, end: ${end.toISOString()}). Setting hours to 0.`);
            recordIssue = message;
          }

          // 如果時間為負值且標記為跨日，加上 24 小時
          if (diffMs < 0 && isCrossDay) {
            diffMs += 24 * 60 * 60 * 1000;
          }

          hours = Math.max(0, diffMs / (1000 * 60 * 60)); // 轉換為小時，確保非負
        }
      }
    }
    
    // 取得加班日期
    let date = valueByLabels(OVERTIME_FIELDS.date);
    
    // 如果沒有日期欄位，嘗試使用開始時間作為日期
    if (!date) {
      const startTime = valueByLabels(['開始時間', '開始日期', 'startTime', 'start']);
      if (startTime) {
        date = startTime;
      }
    }
    
    // 取得加班原因
    let reason = valueByLabels(OVERTIME_FIELDS.reason) || '';
    
    // 如果沒有原因欄位，嘗試'事由'欄位
    if (!reason) reason = valueByLabels(['事由']) || '';
    
    // 加班屬於哪一天、哪個月以台灣時間判斷：台灣 11/1 早上 06:00（UTC 10/31 22:00）是 11 月的加班，
    // 也要用 11/1 的班表與假日判斷日別，不能取 UTC 日期而算成 10 月、前一天的平日
    const overtimeDateKey = date ? toTaipeiDateKey(date) : null;
    if (!overtimeDateKey || overtimeDateKey < windowStartKey || overtimeDateKey >= windowEndKey) {
      continue;
    }
    const schedule = scheduleByDate.get(overtimeDateKey);
    const dayType = resolveOvertimeDayType(
      overtimeDateKey,
      holidayDays,
      shiftMap.get(String(schedule?.shiftId || '')),
    );
    const calculation = calculateTaiwanOvertimeAmount(hours, hourlyRate, dayType);

    totalOvertimeHours += hours;
    overtimePay += calculation.amount;
    records.push({
      date: overtimeDateKey,
      hours,
      reason,
      dayType,
      pay: calculation.amount,
      rateSegments: calculation.segments,
      hasIssue: Boolean(recordIssue),
      issue: recordIssue,
    });
    if (recordIssue) {
      overtimeIssues.push(`${overtimeDateKey}：${recordIssue}`);
    }
  }

  return {
    overtimeHours: totalOvertimeHours,
    overtimePay,
    overtimeRecords: records,
    overtimeIssues,
  };
}

/**
 * 日薪要另外加計的「只請假沒上班」天數。
 * 有出勤的那一天（workDays 已經算整天）請了半天有薪假，不能再把假的部分加一次：
 * 日薪 2000 的人上 4 小時班、請 5 小時特休，那天只領 2000，不是 3250。
 * 所以有出勤的日子不另外加請假，沒出勤的日子才依當天的給薪請假時數（全薪算全部、半薪算一半）加，每天最多 1 天。
 * 沒有請假日期的舊資料無法判斷是哪一天，照時數換算成天數。
 */
function countPaidLeaveOnlyDays(dailyDetails, leaveImpact) {
  const attendedDates = new Set((dailyDetails || []).filter((day) => day.hasAttendance).map((day) => day.date));
  let days = 0;
  Object.entries(leaveImpact.payableLeaveByDay || {}).forEach(([dateKey, hours]) => {
    if (attendedDates.has(dateKey)) return;
    days += Math.min(1, hours / WORK_HOURS_CONFIG.HOURS_PER_DAY);
  });
  days += (leaveImpact.undatedPayableLeaveHours || 0) / WORK_HOURS_CONFIG.HOURS_PER_DAY;
  return days;
}

/**
 * 整合計算員工的完整工作時數和薪資數據
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @returns {Object} - 完整的工作時數和薪資計算結果
 */
export async function calculateCompleteWorkData(employeeId, month, context = {}) {
  const employee = context.employee ?? await Employee.findById(employeeId);
  if (!employee) throw new Error('Employee not found');
  context.employee = employee;

  // Work hours loads the shared attendance context once. The other calculations
  // reuse it instead of repeating the same employee, setting and schedule reads.
  const workHours = await calculateWorkHours(employeeId, month, context);
  const [leaveImpact, overtimePay, nightShiftAllowanceData] = await Promise.all([
    calculateLeaveImpact(employeeId, month, context, { withDailyBreakdown: true }),
    calculateOvertimePay(employeeId, month, context),
    calculateNightShiftAllowance(employeeId, month, employee, context)
  ]);
  
  // 計算基本薪資 - 使用配置的轉換函數
  let baseSalary = 0;
  const hourlyRate = convertToHourlyRate(employee.salaryAmount || 0, employee.salaryType || '月薪');
  const dailyRate = convertToDailyRate(employee.salaryAmount || 0, employee.salaryType || '月薪');
  
  // 日薪、時薪是按出勤給薪：有薪假（全薪，以及半薪假的給薪部分）要算進去，
  // 無薪假沒出勤本來就沒有薪水，所以也不會再有請假扣款（calculateLeaveImpact 只對月薪回傳扣款）
  const payableLeaveHours = Math.max(
    Math.round((leaveImpact.leaveHours - leaveImpact.unpaidLeaveHours) * 10000) / 10000,
    0
  );
  if (employee.salaryType === '時薪') {
    baseSalary = (workHours.actualWorkHours + payableLeaveHours) * hourlyRate;
  } else if (employee.salaryType === '日薪') {
    baseSalary = (workHours.workDays + countPaidLeaveOnlyDays(workHours.dailyDetails, leaveImpact)) * dailyRate;
  } else { // 月薪
    baseSalary = employee.salaryAmount || 0;
  }
  
  // 應用請假扣款（月薪）
  baseSalary -= leaveImpact.leaveDeduction;
  baseSalary = Math.max(0, baseSalary); // 確保不為負數
  
  return {
    // 工作時數
    workDays: workHours.workDays,
    scheduledHours: workHours.scheduledHours,
    actualWorkHours: workHours.actualWorkHours,
    hourlyRate,
    dailyRate,
    
    // 請假資料
    leaveHours: leaveImpact.leaveHours,
    paidLeaveHours: leaveImpact.paidLeaveHours,
    unpaidLeaveHours: leaveImpact.unpaidLeaveHours,
    sickLeaveHours: leaveImpact.sickLeaveHours,
    personalLeaveHours: leaveImpact.personalLeaveHours,
    leaveDeduction: leaveImpact.leaveDeduction,
    
    // 加班資料
    overtimeHours: overtimePay.overtimeHours,
    overtimePay: overtimePay.overtimePay,
    overtimeIssues: overtimePay.overtimeIssues ?? [],
    
    // 夜班資料
    nightShiftDays: nightShiftAllowanceData?.nightShiftDays ?? 0,
    nightShiftHours: nightShiftAllowanceData?.nightShiftHours ?? 0,
    nightShiftAllowance: nightShiftAllowanceData?.allowanceAmount ?? 0,
    nightShiftCalculationMethod: nightShiftAllowanceData?.calculationMethod ?? 'not_calculated',
    nightShiftBreakdown: nightShiftAllowanceData?.shiftBreakdown ?? [],
    nightShiftConfigurationIssues: nightShiftAllowanceData?.configurationIssues ?? [],
    
    // 基本薪資 (已扣除請假)
    baseSalary: Math.round(baseSalary),
    
    // 詳細記錄
    dailyDetails: workHours.dailyDetails,
    leaveRecords: leaveImpact.leaveRecords,
    overtimeRecords: overtimePay.overtimeRecords
  };
}

export const __testUtils = {
  minutesBetween,
  hoursFromMinutes,
  parseTimeParts,
  buildDateWithTime,
  getShiftBreakMinutes,
  computeShiftTimes,
  formatDate,
  buildDateKey,
  groupAttendanceRecords,
  resolveOvertimeDayType
};

export default {
  calculateWorkHours,
  calculateLeaveImpact,
  calculateOvertimePay,
  calculateCompleteWorkData
};
