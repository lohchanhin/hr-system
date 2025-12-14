import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';

/**
 * 計算時間差（分鐘）
 */
function getMinutesDifference(time1, time2) {
  const d1 = new Date(time1);
  const d2 = new Date(time2);
  return Math.floor((d2 - d1) / 60000);
}

/**
 * 解析時間字串 (HH:mm) 並轉換為當天的 Date 物件
 */
function parseTimeToDate(timeStr, date) {
  if (!timeStr || !date) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;
  
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * 檢查是否遲到
 */
function isLate(clockInTime, scheduledStartTime, graceMinutes = 0) {
  if (!clockInTime || !scheduledStartTime) return false;
  const diff = getMinutesDifference(scheduledStartTime, clockInTime);
  return diff > graceMinutes;
}

/**
 * 檢查是否早退
 */
function isEarlyLeave(clockOutTime, scheduledEndTime, graceMinutes = 0) {
  if (!clockOutTime || !scheduledEndTime) return false;
  const diff = getMinutesDifference(clockOutTime, scheduledEndTime);
  return diff > graceMinutes;
}

/**
 * 計算單個員工在指定月份的遲到早退次數
 */
export async function calculateLateEarlyCount(employeeId, month) {
  // Parse month to handle both "YYYY-MM" and "YYYY-MM-DD" formats
  let monthStr = month;
  if (typeof month === 'string') {
    // Extract YYYY-MM from the input (handles both "YYYY-MM" and "YYYY-MM-DD")
    const match = month.match(/^(\d{4}-\d{2})/);
    if (match) {
      monthStr = match[1];
    } else {
      throw new Error(`Invalid month format: ${month}. Expected YYYY-MM or YYYY-MM-DD format.`);
    }
  } else if (month instanceof Date) {
    // If month is a Date object, format it as YYYY-MM
    if (isNaN(month.getTime())) {
      throw new Error('Invalid Date object provided for month parameter');
    }
    const year = month.getFullYear();
    const monthNum = String(month.getMonth() + 1).padStart(2, '0');
    monthStr = `${year}-${monthNum}`;
  }
  
  const monthStart = new Date(`${monthStr}-01T00:00:00.000Z`);
  // Validate the created date
  if (isNaN(monthStart.getTime())) {
    throw new Error(`Failed to create valid date from month: ${monthStr}`);
  }
  
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  // 取得出勤設定
  const setting = await AttendanceSetting.findOne().lean();
  const lateGrace = setting?.abnormalRules?.lateGrace || 0;
  const earlyLeaveGrace = setting?.abnormalRules?.earlyLeaveGrace || 0;

  // 建立班別對照表
  const shiftMap = new Map();
  if (setting?.shifts) {
    setting.shifts.forEach(shift => {
      if (shift._id) {
        shiftMap.set(shift._id.toString(), shift);
      }
    });
  }

  // 取得排班記錄
  const schedules = await ShiftSchedule.find({
    employee: employeeId,
    date: { $gte: monthStart, $lt: monthEnd },
  }).lean();

  const scheduleMap = new Map();
  schedules.forEach(schedule => {
    const dateKey = new Date(schedule.date).toISOString().slice(0, 10);
    scheduleMap.set(dateKey, schedule);
  });

  // 取得打卡記錄
  const records = await AttendanceRecord.find({
    employee: employeeId,
    date: { $gte: monthStart, $lt: monthEnd },
  }).sort({ date: 1 }).lean();

  let lateCount = 0;
  let earlyLeaveCount = 0;
  const lateDetails = [];
  const earlyLeaveDetails = [];

  records.forEach(record => {
    const dateKey = new Date(record.date).toISOString().slice(0, 10);
    const schedule = scheduleMap.get(dateKey);
    
    if (!schedule || !schedule.shiftId) return;

    const shift = shiftMap.get(schedule.shiftId.toString());
    if (!shift) return;

    // 檢查遲到
    if (record.clockIn && shift.startTime) {
      const scheduledStart = parseTimeToDate(shift.startTime, record.date);
      if (scheduledStart && isLate(record.clockIn, scheduledStart, lateGrace)) {
        lateCount++;
        lateDetails.push({
          date: dateKey,
          clockIn: record.clockIn,
          scheduledStart: scheduledStart,
          minutesLate: getMinutesDifference(scheduledStart, record.clockIn),
        });
      }
    }

    // 檢查早退
    if (record.clockOut && shift.endTime) {
      const scheduledEnd = parseTimeToDate(shift.endTime, record.date);
      if (scheduledEnd && isEarlyLeave(record.clockOut, scheduledEnd, earlyLeaveGrace)) {
        earlyLeaveCount++;
        earlyLeaveDetails.push({
          date: dateKey,
          clockOut: record.clockOut,
          scheduledEnd: scheduledEnd,
          minutesEarly: getMinutesDifference(record.clockOut, scheduledEnd),
        });
      }
    }
  });

  return {
    employeeId,
    month,
    lateCount,
    earlyLeaveCount,
    lateDetails,
    earlyLeaveDetails,
  };
}

/**
 * 計算遲到早退的扣款金額
 */
export async function calculateLateEarlyDeductions(employeeId, month) {
  const setting = await AttendanceSetting.findOne().lean();
  
  const lateDeductionEnabled = setting?.abnormalRules?.lateDeductionEnabled || false;
  const lateDeductionAmount = setting?.abnormalRules?.lateDeductionAmount || 0;
  const earlyLeaveDeductionEnabled = setting?.abnormalRules?.earlyLeaveDeductionEnabled || false;
  const earlyLeaveDeductionAmount = setting?.abnormalRules?.earlyLeaveDeductionAmount || 0;

  const counts = await calculateLateEarlyCount(employeeId, month);

  const lateDeduction = lateDeductionEnabled ? counts.lateCount * lateDeductionAmount : 0;
  const earlyLeaveDeduction = earlyLeaveDeductionEnabled ? counts.earlyLeaveCount * earlyLeaveDeductionAmount : 0;
  const totalDeduction = lateDeduction + earlyLeaveDeduction;

  return {
    ...counts,
    lateDeductionAmount,
    earlyLeaveDeductionAmount,
    lateDeduction,
    earlyLeaveDeduction,
    totalDeduction,
    settings: {
      lateDeductionEnabled,
      lateDeductionAmount,
      earlyLeaveDeductionEnabled,
      earlyLeaveDeductionAmount,
    },
  };
}

/**
 * 批量計算多個員工的遲到早退扣款
 */
export async function calculateBatchLateEarlyDeductions(employeeIds, month) {
  const results = [];
  
  for (const employeeId of employeeIds) {
    try {
      const result = await calculateLateEarlyDeductions(employeeId, month);
      results.push(result);
    } catch (err) {
      console.error(`Error calculating deductions for employee ${employeeId}:`, err);
      results.push({
        employeeId,
        month,
        error: err.message,
        totalDeduction: 0,
      });
    }
  }
  
  return results;
}
