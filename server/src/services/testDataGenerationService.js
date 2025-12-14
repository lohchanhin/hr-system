import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import ApprovalRequest from '../models/approval_request.js';
import FormTemplate from '../models/form_template.js';
import AttendanceSetting from '../models/AttendanceSetting.js';

// Configuration constants
const SCHEDULE_COMPLETENESS_RATIO = 0.7; // 70% completion for incomplete schedules
const ATTENDANCE_SCENARIOS = {
  NORMAL: 0.6,      // 60% normal attendance
  LATE: 0.15,       // 15% late
  EARLY_LEAVE: 0.10, // 10% early leave
  LATE_AND_EARLY: 0.07, // 7% both late and early leave
  MISSING: 0.08,    // 8% missing punch
};

/**
 * 生成多樣化的排班測試資料
 * 涵蓋以下場景：
 * 1. 完整排班（所有天數都有排班）
 * 2. 缺少排班（部分天數未排班）
 * 3. 有請假的排班（請假日期不排班）
 * 4. 排班與請假衝突（錯誤場景）
 */
export async function generateDiverseScheduleTestData(month = '2024-01') {
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  
  const employees = await Employee.find({ status: '正職員工' }).limit(10).lean();
  if (employees.length === 0) {
    console.log('No employees found for schedule test data generation');
    return;
  }

  const setting = await AttendanceSetting.findOne().lean();
  const shifts = setting?.shifts || [];
  if (shifts.length === 0) {
    console.log('No shifts found, cannot generate schedule test data');
    return;
  }

  // 場景1：完整排班員工（3人）
  const completeEmployees = employees.slice(0, 3);
  for (const employee of completeEmployees) {
    await generateCompleteSchedule(employee._id, monthStart, monthEnd, shifts);
  }

  // 場景2：部分缺少排班（2人）
  const incompleteEmployees = employees.slice(3, 5);
  for (const employee of incompleteEmployees) {
    await generateIncompleteSchedule(employee._id, monthStart, monthEnd, shifts, SCHEDULE_COMPLETENESS_RATIO);
  }

  // 場景3：有請假的排班（2人）
  const leaveEmployees = employees.slice(5, 7);
  for (const employee of leaveEmployees) {
    await generateScheduleWithLeave(employee._id, monthStart, monthEnd, shifts);
  }

  // 場景4：主管選擇不排班（1人）
  const supervisorEmployee = employees.find(e => e.role === 'supervisor');
  if (supervisorEmployee) {
    await Employee.findByIdAndUpdate(supervisorEmployee._id, {
      requiresScheduling: false,
    });
  }

  console.log('Diverse schedule test data generated successfully');
}

/**
 * 生成完整排班（所有天數）
 */
async function generateCompleteSchedule(employeeId, monthStart, monthEnd, shifts) {
  const schedules = [];
  let current = new Date(monthStart);
  
  while (current < monthEnd) {
    const shift = shifts[Math.floor(Math.random() * shifts.length)];
    schedules.push({
      employee: employeeId,
      date: new Date(current),
      shiftId: shift._id,
      state: 'finalized',
    });
    current.setDate(current.getDate() + 1);
  }
  
  await ShiftSchedule.insertMany(schedules, { ordered: false }).catch((err) => {
    console.error(`Error inserting complete schedules for employee ${employeeId}:`, err.message);
  });
}

/**
 * 生成不完整排班（部分天數缺少）
 */
async function generateIncompleteSchedule(employeeId, monthStart, monthEnd, shifts, completeness = SCHEDULE_COMPLETENESS_RATIO) {
  const schedules = [];
  let current = new Date(monthStart);
  
  while (current < monthEnd) {
    // 根據完成度決定是否排班
    if (Math.random() < completeness) {
      const shift = shifts[Math.floor(Math.random() * shifts.length)];
      schedules.push({
        employee: employeeId,
        date: new Date(current),
        shiftId: shift._id,
        state: 'draft',
      });
    }
    current.setDate(current.getDate() + 1);
  }
  
  await ShiftSchedule.insertMany(schedules, { ordered: false }).catch((err) => {
    console.error(`Error inserting incomplete schedules for employee ${employeeId}:`, err.message);
  });
}

/**
 * 生成有請假的排班
 */
async function generateScheduleWithLeave(employeeId, monthStart, monthEnd, shifts) {
  // 先生成請假申請（3-5天）
  const leaveDays = 3 + Math.floor(Math.random() * 3);
  const leaveStart = new Date(monthStart);
  leaveStart.setDate(leaveStart.getDate() + 5); // 從月初第5天開始請假
  
  const leaveEnd = new Date(leaveStart);
  leaveEnd.setDate(leaveEnd.getDate() + leaveDays - 1);
  
  // 創建請假申請（需要有對應的表單）
  const leaveForm = await FormTemplate.findOne({ category: 'leave' }).lean();
  if (leaveForm) {
    try {
      await ApprovalRequest.create({
        form: leaveForm._id,
        workflow: leaveForm.workflow,
        applicant_employee: employeeId,
        status: 'approved',
        form_data: {
          startDate: leaveStart,
          endDate: leaveEnd,
          leaveType: '事假',
          reason: '個人事務',
        },
      });
    } catch (err) {
      console.log('Leave request creation skipped:', err.message);
    }
  }
  
  // 生成排班（排除請假日）
  const schedules = [];
  let current = new Date(monthStart);
  
  while (current < monthEnd) {
    const isLeaveDay = current >= leaveStart && current <= leaveEnd;
    
    if (!isLeaveDay) {
      const shift = shifts[Math.floor(Math.random() * shifts.length)];
      schedules.push({
        employee: employeeId,
        date: new Date(current),
        shiftId: shift._id,
        state: 'finalized',
      });
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  await ShiftSchedule.insertMany(schedules, { ordered: false }).catch((err) => {
    console.error(`Error inserting schedules with leave for employee ${employeeId}:`, err.message);
  });
}

/**
 * 生成多樣化的出勤測試資料
 * 涵蓋以下場景：
 * 1. 正常出勤（準時打卡）
 * 2. 遲到（超過寬容時間）
 * 3. 早退（超過寬容時間）
 * 4. 遲到又早退
 * 5. 缺卡（忘記打卡）
 */
export async function generateDiverseAttendanceTestData(month = '2024-01') {
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  
  const schedules = await ShiftSchedule.find({
    date: { $gte: monthStart, $lt: monthEnd },
  }).populate('employee').limit(100).lean();
  
  const setting = await AttendanceSetting.findOne().lean();
  const shiftMap = new Map();
  
  if (setting?.shifts) {
    setting.shifts.forEach(shift => {
      shiftMap.set(shift._id.toString(), shift);
    });
  }
  
  // Calculate cumulative thresholds from ATTENDANCE_SCENARIOS
  const thresholds = {
    normal: ATTENDANCE_SCENARIOS.NORMAL,
    late: ATTENDANCE_SCENARIOS.NORMAL + ATTENDANCE_SCENARIOS.LATE,
    earlyLeave: ATTENDANCE_SCENARIOS.NORMAL + ATTENDANCE_SCENARIOS.LATE + ATTENDANCE_SCENARIOS.EARLY_LEAVE,
    lateAndEarly: ATTENDANCE_SCENARIOS.NORMAL + ATTENDANCE_SCENARIOS.LATE + ATTENDANCE_SCENARIOS.EARLY_LEAVE + ATTENDANCE_SCENARIOS.LATE_AND_EARLY,
  };
  
  for (const schedule of schedules) {
    const shift = shiftMap.get(schedule.shiftId.toString());
    if (!shift || !schedule.employee) continue;
    
    const scenario = Math.random();
    
    if (scenario < thresholds.normal) {
      // Normal attendance
      await generateNormalAttendance(schedule, shift);
    } else if (scenario < thresholds.late) {
      // Late
      await generateLateAttendance(schedule, shift, 10, 30);
    } else if (scenario < thresholds.earlyLeave) {
      // Early leave
      await generateEarlyLeaveAttendance(schedule, shift, 10, 30);
    } else if (scenario < thresholds.lateAndEarly) {
      // Late and early leave
      await generateLateAndEarlyAttendance(schedule, shift);
    } else {
      // Missing punch
      await generateMissingAttendance(schedule, shift);
    }
  }
  
  console.log('Diverse attendance test data generated successfully');
}

/**
 * 生成正常出勤記錄
 */
async function generateNormalAttendance(schedule, shift) {
  const date = new Date(schedule.date);
  const [startHour, startMin] = shift.startTime.split(':').map(Number);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);
  
  const clockIn = new Date(date);
  clockIn.setHours(startHour, startMin - 5 + Math.floor(Math.random() * 10), 0, 0); // 前後5分鐘
  
  const clockOut = new Date(date);
  clockOut.setHours(endHour, endMin - 5 + Math.floor(Math.random() * 10), 0, 0);
  
  await AttendanceRecord.create({
    employee: schedule.employee._id,
    date,
    clockIn,
    clockOut,
    status: 'normal',
  }).catch((err) => { console.error('Error inserting attendance record:', err.message); });
}

/**
 * 生成遲到記錄
 */
async function generateLateAttendance(schedule, shift, minLate, maxLate) {
  const date = new Date(schedule.date);
  const [startHour, startMin] = shift.startTime.split(':').map(Number);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);
  
  const lateMinutes = minLate + Math.floor(Math.random() * (maxLate - minLate));
  
  const clockIn = new Date(date);
  clockIn.setHours(startHour, startMin + lateMinutes, 0, 0);
  
  const clockOut = new Date(date);
  clockOut.setHours(endHour, endMin, 0, 0);
  
  await AttendanceRecord.create({
    employee: schedule.employee._id,
    date,
    clockIn,
    clockOut,
    status: 'late',
  }).catch((err) => { console.error('Error inserting attendance record:', err.message); });
}

/**
 * 生成早退記錄
 */
async function generateEarlyLeaveAttendance(schedule, shift, minEarly, maxEarly) {
  const date = new Date(schedule.date);
  const [startHour, startMin] = shift.startTime.split(':').map(Number);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);
  
  const earlyMinutes = minEarly + Math.floor(Math.random() * (maxEarly - minEarly));
  
  const clockIn = new Date(date);
  clockIn.setHours(startHour, startMin, 0, 0);
  
  const clockOut = new Date(date);
  clockOut.setHours(endHour, endMin - earlyMinutes, 0, 0);
  
  await AttendanceRecord.create({
    employee: schedule.employee._id,
    date,
    clockIn,
    clockOut,
    status: 'early_leave',
  }).catch((err) => { console.error('Error inserting attendance record:', err.message); });
}

/**
 * 生成遲到又早退記錄
 */
async function generateLateAndEarlyAttendance(schedule, shift) {
  const date = new Date(schedule.date);
  const [startHour, startMin] = shift.startTime.split(':').map(Number);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);
  
  const lateMinutes = 10 + Math.floor(Math.random() * 20);
  const earlyMinutes = 10 + Math.floor(Math.random() * 20);
  
  const clockIn = new Date(date);
  clockIn.setHours(startHour, startMin + lateMinutes, 0, 0);
  
  const clockOut = new Date(date);
  clockOut.setHours(endHour, endMin - earlyMinutes, 0, 0);
  
  await AttendanceRecord.create({
    employee: schedule.employee._id,
    date,
    clockIn,
    clockOut,
    status: 'late_and_early',
  }).catch((err) => { console.error('Error inserting attendance record:', err.message); });
}

/**
 * 生成缺卡記錄
 */
async function generateMissingAttendance(schedule, shift) {
  const date = new Date(schedule.date);
  
  // 隨機決定是缺上班卡還是下班卡
  if (Math.random() < 0.5) {
    // 缺上班卡
    const [endHour, endMin] = shift.endTime.split(':').map(Number);
    const clockOut = new Date(date);
    clockOut.setHours(endHour, endMin, 0, 0);
    
    await AttendanceRecord.create({
      employee: schedule.employee._id,
      date,
      clockOut,
      status: 'missing_clock_in',
    }).catch((err) => { console.error('Error inserting attendance record:', err.message); });
  } else {
    // 缺下班卡
    const [startHour, startMin] = shift.startTime.split(':').map(Number);
    const clockIn = new Date(date);
    clockIn.setHours(startHour, startMin, 0, 0);
    
    await AttendanceRecord.create({
      employee: schedule.employee._id,
      date,
      clockIn,
      status: 'missing_clock_out',
    }).catch((err) => { console.error('Error inserting attendance record:', err.message); });
  }
}

/**
 * 生成多樣化的簽核測試資料
 * 涵蓋各種審核狀態的獎金/扣款申請
 */
export async function generateDiverseApprovalTestData() {
  const employees = await Employee.find({ status: '正職員工' }).limit(10).lean();
  if (employees.length === 0) return;
  
  const bonusForm = await FormTemplate.findOne({ category: 'bonus' }).lean();
  if (!bonusForm) {
    console.log('Bonus form not found, skipping approval test data');
    return;
  }
  
  const statuses = ['pending', 'approved', 'rejected'];
  const bonusTypes = ['績效獎金', '專案獎金', '年終獎金', '業績獎金'];
  const amounts = [3000, 5000, 8000, 10000, 15000];
  
  for (const employee of employees) {
    // 每個員工生成2-4個獎金申請
    const count = 2 + Math.floor(Math.random() * 3);
    
    for (let i = 0; i < count; i++) {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const bonusType = bonusTypes[Math.floor(Math.random() * bonusTypes.length)];
      const amount = amounts[Math.floor(Math.random() * amounts.length)];
      
      await ApprovalRequest.create({
        form: bonusForm._id,
        workflow: bonusForm.workflow,
        applicant_employee: employee._id,
        status,
        form_data: {
          bonusType,
          amount,
          reason: `${bonusType}申請`,
        },
      }).catch((err) => { console.error('Error inserting attendance record:', err.message); });
    }
  }
  
  console.log('Diverse approval test data generated successfully');
}
