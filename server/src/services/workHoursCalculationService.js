import AttendanceRecord from '../models/AttendanceRecord.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import ApprovalRequest from '../models/approval_request.js';
import Employee from '../models/Employee.js';
import { getLeaveFieldIds } from './leaveFieldService.js';

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
  
  if (shift.crossDay || end <= start) {
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
export async function calculateWorkHours(employeeId, month) {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }
  
  // 解析月份範圍
  const monthDate = new Date(month);
  const startDate = new Date(monthDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  
  // 取得班表設定
  const attendanceSetting = await AttendanceSetting.findOne().lean();
  const shiftMap = new Map();
  if (attendanceSetting && attendanceSetting.shifts) {
    attendanceSetting.shifts.forEach((shift) => {
      if (shift && shift._id) {
        shiftMap.set(shift._id.toString(), shift);
      }
    });
  }
  
  // 取得該月份的班表
  const schedules = await ShiftSchedule.find({
    employee: employeeId,
    date: { $gte: startDate, $lt: endDate }
  }).lean();
  
  // 取得出勤記錄
  const attendanceRecords = await AttendanceRecord.find({
    employee: employeeId,
    timestamp: { $gte: startDate, $lt: endDate },
    action: { $in: ['clockIn', 'clockOut'] }
  }).lean();
  
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
    
    const { start, end } = computeShiftTimes(schedule.date, shift);
    const breakMinutes = getShiftBreakMinutes(shift, schedule.date);
    const scheduledMinutes = Math.max(minutesBetween(start, end) - breakMinutes, 0);
    
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    let workedMinutes = 0;
    let hasAttendance = false;
    
    if (dayRecord && dayRecord.clockIns.length && dayRecord.clockOuts.length) {
      const first = dayRecord.clockIns[0];
      const last = dayRecord.clockOuts[dayRecord.clockOuts.length - 1];
      workedMinutes = Math.max(minutesBetween(first, last) - breakMinutes, 0);
      hasAttendance = true;
      workDays++;
    }
    
    totalScheduledMinutes += scheduledMinutes;
    totalWorkedMinutes += workedMinutes;
    
    dailyDetails.push({
      date: dateKey,
      scheduledHours: hoursFromMinutes(scheduledMinutes),
      workedHours: hoursFromMinutes(workedMinutes),
      hasAttendance,
      shiftName: shift.name || '未命名班別'
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
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @returns {Object} - 請假扣款資料
 */
export async function calculateLeaveImpact(employeeId, month) {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }
  
  // 解析月份範圍
  const monthDate = new Date(month);
  const startDate = new Date(monthDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  
  // 取得請假表單配置
  const { formId, startId, endId, typeId, typeOptions } = await getLeaveFieldIds();
  
  if (!formId) {
    return {
      leaveHours: 0,
      paidLeaveHours: 0,
      unpaidLeaveHours: 0,
      sickLeaveHours: 0,
      personalLeaveHours: 0,
      leaveDeduction: 0,
      leaveRecords: []
    };
  }
  
  // 查詢該月份已核准的請假記錄
  const approvals = await ApprovalRequest.find({
    form: formId,
    status: 'approved',
    applicant_employee: employeeId,
    createdAt: { $gte: startDate, $lt: endDate }
  }).lean();
  
  // 建立假別類型映射
  const typeMap = new Map(typeOptions?.map((opt) => [String(opt.value), opt.label]));
  
  let totalLeaveHours = 0;
  let paidLeaveHours = 0;
  let unpaidLeaveHours = 0;
  let sickLeaveHours = 0;
  let personalLeaveHours = 0;
  const leaveRecords = [];
  
  approvals.forEach((approval) => {
    const typeValue = typeId ? approval.form_data?.[typeId] : undefined;
    const typeCode = typeValue ? String(typeValue.code ?? typeValue.value ?? typeValue) : '';
    const leaveType = typeValue?.label ?? typeMap.get(typeCode) ?? typeCode;
    
    // 從表單數據取得請假天數或時數
    const days = parseFloat(approval.form_data?.days ?? approval.form_data?.duration ?? 0);
    const hours = parseFloat(approval.form_data?.hours ?? (days * 8) ?? 0); // 假設一天8小時
    
    totalLeaveHours += hours;
    
    // 根據假別分類
    // 特休、婚假、喪假等為有薪假
    if (['特休', '年假', '婚假', '喪假', '產假', '陪產假'].includes(leaveType)) {
      paidLeaveHours += hours;
    }
    // 病假
    else if (['病假', '生理假'].includes(leaveType)) {
      sickLeaveHours += hours;
      // 病假通常半薪或全薪(依公司政策)，這裡假設前30天半薪
      // 簡化處理：病假計入無薪假的一半
      unpaidLeaveHours += hours * 0.5;
    }
    // 事假為無薪假
    else if (['事假', '無薪假'].includes(leaveType)) {
      personalLeaveHours += hours;
      unpaidLeaveHours += hours;
    }
    // 其他假別預設為無薪
    else {
      unpaidLeaveHours += hours;
    }
    
    leaveRecords.push({
      leaveType,
      startDate: formatDate(approval.form_data?.[startId]),
      endDate: formatDate(approval.form_data?.[endId]),
      days,
      hours,
      isPaid: !['事假', '無薪假'].includes(leaveType)
    });
  });
  
  // 計算請假扣款
  // 根據員工薪資類型計算
  let hourlyRate = 0;
  if (employee.salaryType === '時薪') {
    hourlyRate = employee.salaryAmount || 0;
  } else if (employee.salaryType === '日薪') {
    hourlyRate = (employee.salaryAmount || 0) / 8; // 假設一天8小時
  } else { // 月薪
    // 月薪換算時薪：月薪 / 30天 / 8小時
    hourlyRate = (employee.salaryAmount || 0) / 30 / 8;
  }
  
  const leaveDeduction = unpaidLeaveHours * hourlyRate;
  
  return {
    leaveHours: totalLeaveHours,
    paidLeaveHours,
    unpaidLeaveHours,
    sickLeaveHours,
    personalLeaveHours,
    leaveDeduction: Math.round(leaveDeduction),
    leaveRecords
  };
}

/**
 * 計算加班費
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @returns {Object} - 加班資料
 */
export async function calculateOvertimePay(employeeId, month) {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }
  
  // 解析月份範圍
  const monthDate = new Date(month);
  const startDate = new Date(monthDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  
  // 如果員工設定為自動計算加班，從簽核系統取得加班記錄
  if (!employee.autoOvertimeCalc) {
    return {
      overtimeHours: 0,
      overtimePay: 0,
      overtimeRecords: []
    };
  }
  
  // 查詢加班表單 (假設表單名稱為"加班")
  const overtimeForms = await ApprovalRequest.find({
    applicant_employee: employeeId,
    status: 'approved',
    createdAt: { $gte: startDate, $lt: endDate }
  }).populate('form').lean();
  
  // 篩選出加班表單
  const overtimeRecords = overtimeForms.filter(form => 
    form.form?.name === '加班' || 
    form.form?.name === '加班申請' || 
    form.form?.name === '加班單'
  );
  
  let totalOvertimeHours = 0;
  const records = [];
  
  overtimeRecords.forEach((record) => {
    const hours = parseFloat(record.form_data?.hours ?? record.form_data?.加班時數 ?? 0);
    totalOvertimeHours += hours;
    
    records.push({
      date: formatDate(record.form_data?.date ?? record.form_data?.加班日期 ?? record.createdAt),
      hours,
      reason: record.form_data?.reason ?? record.form_data?.加班原因 ?? ''
    });
  });
  
  // 計算加班費
  // 根據勞基法，加班費為平日1.33倍、1.66倍，假日2倍
  // 這裡簡化為統一1.5倍
  let hourlyRate = 0;
  if (employee.salaryType === '時薪') {
    hourlyRate = employee.salaryAmount || 0;
  } else if (employee.salaryType === '日薪') {
    hourlyRate = (employee.salaryAmount || 0) / 8;
  } else { // 月薪
    hourlyRate = (employee.salaryAmount || 0) / 30 / 8;
  }
  
  const overtimePay = Math.round(totalOvertimeHours * hourlyRate * 1.5);
  
  return {
    overtimeHours: totalOvertimeHours,
    overtimePay,
    overtimeRecords: records
  };
}

/**
 * 整合計算員工的完整工作時數和薪資數據
 * @param {String} employeeId - 員工 ID
 * @param {String} month - 月份 (YYYY-MM-DD 格式)
 * @returns {Object} - 完整的工作時數和薪資計算結果
 */
export async function calculateCompleteWorkData(employeeId, month) {
  const [workHours, leaveImpact, overtimePay] = await Promise.all([
    calculateWorkHours(employeeId, month),
    calculateLeaveImpact(employeeId, month),
    calculateOvertimePay(employeeId, month)
  ]);
  
  const employee = await Employee.findById(employeeId);
  
  // 計算基本薪資
  let baseSalary = 0;
  let hourlyRate = 0;
  let dailyRate = 0;
  
  if (employee.salaryType === '時薪') {
    hourlyRate = employee.salaryAmount || 0;
    baseSalary = workHours.actualWorkHours * hourlyRate;
  } else if (employee.salaryType === '日薪') {
    dailyRate = employee.salaryAmount || 0;
    hourlyRate = dailyRate / 8;
    baseSalary = workHours.workDays * dailyRate;
  } else { // 月薪
    baseSalary = employee.salaryAmount || 0;
    hourlyRate = baseSalary / 30 / 8;
    dailyRate = baseSalary / 30;
  }
  
  // 應用請假扣款
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
    
    // 基本薪資 (已扣除請假)
    baseSalary: Math.round(baseSalary),
    
    // 詳細記錄
    dailyDetails: workHours.dailyDetails,
    leaveRecords: leaveImpact.leaveRecords,
    overtimeRecords: overtimePay.overtimeRecords
  };
}

export default {
  calculateWorkHours,
  calculateLeaveImpact,
  calculateOvertimePay,
  calculateCompleteWorkData
};
