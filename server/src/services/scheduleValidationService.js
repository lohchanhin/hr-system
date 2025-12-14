import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import ApprovalRequest from '../models/approval_request.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import { getLeaveFieldIds } from './leaveFieldService.js';

/**
 * 取得指定月份的所有天數
 * @param {string} month - YYYY-MM 格式
 * @returns {Array<string>} 日期陣列 (YYYY-MM-DD 格式)
 */
function getMonthDays(month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  
  const days = [];
  const pointer = new Date(start);
  
  while (pointer < end) {
    days.push(pointer.toISOString().slice(0, 10));
    pointer.setDate(pointer.getDate() + 1);
  }
  
  return days;
}

/**
 * 取得員工在指定月份的批准請假天數
 * @param {string} employeeId - 員工ID
 * @param {Date} monthStart - 月份開始日期
 * @param {Date} monthEnd - 月份結束日期
 * @returns {Promise<Set<string>>} 請假日期集合 (YYYY-MM-DD 格式)
 */
async function getApprovedLeaveDays(employeeId, monthStart, monthEnd) {
  const leaveDays = new Set();
  
  try {
    const { formId, startId, endId } = await getLeaveFieldIds();
    if (!formId || !startId || !endId) {
      return leaveDays;
    }
    
    const query = {
      form: formId,
      status: 'approved',
      applicant_employee: employeeId,
    };
    query[`form_data.${startId}`] = { $lte: monthEnd };
    query[`form_data.${endId}`] = { $gte: monthStart };
    
    const approvals = await ApprovalRequest.find(query).lean();
    
    approvals.forEach((approval) => {
      const rawStart = approval.form_data?.[startId];
      const rawEnd = approval.form_data?.[endId];
      const startDate = rawStart ? new Date(rawStart) : null;
      const endDate = rawEnd ? new Date(rawEnd) : null;
      
      if (!startDate || !endDate || isNaN(startDate) || isNaN(endDate)) {
        return;
      }
      
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);
      
      const leaveStart = startDate < monthStart ? new Date(monthStart) : new Date(startDate);
      const leaveEnd = endDate >= monthEnd ? new Date(monthEnd.getTime() - 86400000) : new Date(endDate);
      
      if (leaveEnd < leaveStart) {
        return;
      }
      
      let pointer = new Date(leaveStart);
      while (pointer <= leaveEnd) {
        const key = pointer.toISOString().slice(0, 10);
        leaveDays.add(key);
        pointer = new Date(pointer.getTime() + 86400000);
      }
    });
  } catch (err) {
    console.error(`Error fetching leave days for employee ${employeeId}:`, err);
  }
  
  return leaveDays;
}

/**
 * 檢查單個員工的排班完整性
 * @param {Object} employee - 員工資料
 * @param {string} month - YYYY-MM 格式
 * @returns {Promise<Object>} 檢查結果
 */
async function validateEmployeeSchedule(employee, month) {
  const monthDays = getMonthDays(month);
  const totalDays = monthDays.length;
  
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  
  // 取得該員工的排班記錄
  const schedules = await ShiftSchedule.find({
    employee: employee._id,
    date: { $gte: monthStart, $lt: monthEnd },
  }).lean();
  
  const scheduledDays = new Set(
    schedules.map(s => new Date(s.date).toISOString().slice(0, 10))
  );
  
  // 取得批准的請假天數
  const leaveDays = await getApprovedLeaveDays(employee._id, monthStart, monthEnd);
  
  // 計算應排班天數 = 總天數 - 請假天數
  const requiredDays = totalDays - leaveDays.size;
  const actualScheduledDays = scheduledDays.size;
  
  // 檢查是否有請假日被排班
  const conflictDays = [];
  leaveDays.forEach(day => {
    if (scheduledDays.has(day)) {
      conflictDays.push(day);
    }
  });
  
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
 * @param {string} month - YYYY-MM 格式
 * @param {Object} options - 選項
 * @param {string} options.department - 部門ID (可選)
 * @param {string} options.subDepartment - 小單位ID (可選)
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
  
  // 取得所有需要檢查的員工
  const employees = await Employee.find(employeeQuery).lean();
  
  // 逐一檢查每個員工
  const results = [];
  for (const employee of employees) {
    // 主管可以選擇不參與排班
    if (employee.role === 'supervisor' && employee.requiresScheduling === false) {
      continue;
    }
    
    const result = await validateEmployeeSchedule(employee, month);
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
