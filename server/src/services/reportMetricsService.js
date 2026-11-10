import mongoose from 'mongoose';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import ApprovalRequest from '../models/approval_request.js';
import FormTemplate from '../models/form_template.js';
import FormField from '../models/form_field.js';
import CompensatoryCredit from '../models/CompensatoryCredit.js';
import { getAllLeaveFieldInfos } from './leaveFieldService.js';
import { loadApprovedLeaveIntervals } from './approvedLeaveCalendarService.js';
import { buildLeaveDayCheck } from './leaveCoverageService.js';
import { computeShiftSpan } from '../utils/timeWindow.js';
import { isNonWorkShift } from './shiftSemanticService.js';
import {
  formatLocalTime,
  groupPunchesByEmployee,
  matchSchedulesPunches,
  matchShiftPunches,
  resolveAttendanceSource,
} from './attendancePunchService.js';
import { ANNUAL_LEAVE_TYPES, WORK_HOURS_CONFIG } from '../config/salaryConfig.js';
import { COMP_LEAVE_TYPE_ALIASES, COMP_LEAVE_TYPE_NAME } from '../config/leavePolicyConfig.js';
import { toTaipeiDateKey, toTaipeiParts } from '../utils/taipeiTime.js';
import { normalizeLeaveFieldLabel } from '../utils/leaveFieldLabels.js';
import { computeLeaveDuration, sumLeaveHoursInRange } from '../utils/leaveDuration.js';
import { isOvertimeFormTemplate } from '../utils/formSemantics.js';
import { orderFieldCandidateIds, pickFieldValue, resolveCandidateIds } from '../utils/fieldCandidates.js';

export class ReportAccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 各簽核報表對應的表單與欄位標籤（form_data 以欄位 ID 為鍵，所以要先依標籤找到欄位 ID）。
// 加班報表依表單性質（semanticType）找表單，改名也找得到；預設的「加班申請」沒有時數欄位，時數由開始、結束時間算出。
const APPROVAL_FORM_CONFIGS = {
  overtime: {
    semanticType: 'overtime',
    isForm: isOvertimeFormTemplate,
    templateNames: ['加班', '加班申請', '加班單'],
    fields: {
      date: ['加班日期', '日期'],
      startTime: ['開始時間', '加班開始', '開始時刻'],
      endTime: ['結束時間', '加班結束', '結束時刻'],
      hours: ['加班時數', '時數', '時長'],
      reason: ['加班原因', '原因', '說明', '事由'],
      crossDay: ['是否跨日', '跨日'],
    },
  },
  // 補休（調休、移休）從 2026/10 起是請假單上的假別（調休存摺），報表主要統計那些請假單（buildCompTimeReport）；
  // 這裡是更早以前另外建「補休申請」表單的舊資料，有的話一併列出
  compTime: {
    templateNames: ['補休', '補休申請', '補休單'],
    fields: {
      date: ['補休日期', '日期'],
      hours: ['補休時數', '時數'],
      reference: ['來源加班單號', '加班單號', '來源單號'],
    },
  },
  makeUp: {
    templateNames: ['補打卡', '補打卡申請', '補卡', '補簽申請', '補簽'],
    fields: {
      date: ['補卡日期', '補簽日期', '日期', '開始時間'],
      category: ['補卡類別', '類別', '類型'],
      note: ['補卡說明', '說明', '原因', '事由'],
    },
  },
};

const REPORT_NAME_MAP = {
  attendance: '出勤統計',
  leave: '請假統計',
  tardiness: '遲到統計',
  earlyLeave: '早退統計',
  workHours: '工時統計',
  overtime: '加班申請統計',
  compTime: '補休申請統計',
  makeUp: '補打卡申請統計',
  specialLeave: '特休統計',
};

function assertRequired(value, message) {
  if (!value) {
    throw new ReportAccessError(400, message);
  }
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const HOURS_PER_DAY = WORK_HOURS_CONFIG.HOURS_PER_DAY;
const roundTwo = (value) => Math.round(value * 100) / 100;

function parseMonthRange(month) {
  assertRequired(month, 'month required');
  // 只收 YYYY-MM：「2026」會被當成一月、「+275760-09」算下個月時變成無效日期（以前回 500）
  if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
    throw new ReportAccessError(400, 'invalid month');
  }
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new ReportAccessError(400, 'invalid month');
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function normalizeId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const hours = `${date.getUTCHours()}`.padStart(2, '0');
    const minutes = `${date.getUTCMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const diff = (end.getTime?.() ?? new Date(end).getTime()) - (start.getTime?.() ?? new Date(start).getTime());
  if (!Number.isFinite(diff)) return 0;
  return Math.round(diff / 60000);
}

function hoursFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}

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

function buildDateWithTime(baseDate, timeString) {
  const parts = parseTimeParts(timeString);
  if (!parts) return null;
  const date = new Date(baseDate);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date;
}

function getShiftBreakMinutes(shift, date) {
  if (!shift) return 0;
  const base = new Date(date ?? Date.now());
  base.setUTCHours(0, 0, 0, 0);

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

  const durationCandidates = [shift.breakDuration, shift.breakMinutes];
  for (const candidate of durationCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  if (shift.breakTime) {
    const parts = parseTimeParts(shift.breakTime);
    if (parts) return parts.hour * 60 + parts.minute;
  }
  return 0;
}

function buildDateKey(date) {
  const obj = new Date(date);
  if (Number.isNaN(obj.getTime())) return '';
  return formatDate(obj);
}

export async function resolveDepartmentEmployees(departmentId, actor) {
  assertRequired(departmentId, 'department required');
  // 只收字串：網址上的 department[$gte]=… 會被解析成物件、department=A&department=B 是陣列，
  // 原樣放進查詢條件會變成運算子查詢，部門的排班管理者可以拿到別的部門的員工
  if (typeof departmentId !== 'string') {
    throw new ReportAccessError(400, 'invalid department');
  }
  const role = actor?.role;
  const actorId = actor?.id;
  const normalizedDepartmentId = normalizeId(departmentId);

  if (role === 'supervisor') {
    if (!actorId) {
      throw new ReportAccessError(403, 'Forbidden');
    }

    const managedDepartments = new Set();
    const supervisorIdentifiers = new Set();
    supervisorIdentifiers.add(normalizeId(actorId));

    const supervisorRecord = await Employee.findById(actorId);
    if (supervisorRecord) {
      const ownDepartmentId = normalizeId(supervisorRecord.department);
      if (ownDepartmentId) {
        managedDepartments.add(ownDepartmentId);
      }
      const employeeIdentifier = normalizeId(supervisorRecord.employeeId);
      if (employeeIdentifier) {
        supervisorIdentifiers.add(employeeIdentifier);
      }

      const extraDepartmentFields = [
        supervisorRecord.managedDepartments,
        supervisorRecord.departmentsManaged,
        supervisorRecord.managedDeptIds,
        supervisorRecord.departments,
      ];
      extraDepartmentFields.forEach((value) => {
        if (!value) return;
        if (Array.isArray(value)) {
          value.forEach((dept) => {
            const normalized = normalizeId(dept);
            if (normalized) managedDepartments.add(normalized);
          });
          return;
        }
        const normalized = normalizeId(value);
        if (normalized) managedDepartments.add(normalized);
      });
    }

    let hasDepartmentAccess = managedDepartments.has(normalizedDepartmentId);
    if (!hasDepartmentAccess) {
      const department = await Department.findById(departmentId);
      if (department) {
        const deptManagerId = normalizeId(department.deptManager);
        if (deptManagerId && supervisorIdentifiers.has(deptManagerId)) {
          hasDepartmentAccess = true;
        }
      }
    }

    if (!hasDepartmentAccess) {
      const employees = await Employee.find({ department: departmentId, supervisor: actorId });
      if (employees.length) {
        return employees;
      }
      const exists = await Employee.exists({ department: departmentId });
      if (exists) throw new ReportAccessError(403, 'Forbidden');
      throw new ReportAccessError(404, 'No data');
    }

    const employees = await Employee.find({ department: departmentId });
    if (!employees.length) throw new ReportAccessError(404, 'No data');
    return employees;
  }

  const employees = await Employee.find({ department: departmentId });
  if (!employees.length) throw new ReportAccessError(404, 'No data');
  return employees;
}

async function buildAttendanceSettingContext() {
  const setting = await AttendanceSetting.findOne().lean();
  const shiftMap = new Map();
  let lateGrace = 0;
  let earlyGrace = 0;
  if (setting) {
    (setting.shifts ?? []).forEach((shift) => {
      if (!shift) return;
      const key = normalizeId(shift._id ?? shift.id ?? shift.code ?? shift.name);
      if (!key) return;
      shiftMap.set(key, shift);
    });
    lateGrace = Number(setting.abnormalRules?.lateGrace ?? 0) || 0;
    earlyGrace = Number(setting.abnormalRules?.earlyLeaveGrace ?? 0) || 0;
  }
  return { shiftMap, lateGrace, earlyGrace, actionBuffers: setting?.actionBuffers };
}

// 依這一班的簽到、簽退時段（台灣時間，與線上打卡、薪資的遲到早退判斷相同）找打卡，線上打卡與指紋匯入一起看：
// 簽到取最早、簽退取最晚（services/attendancePunchService.js）。沒有帶 punchesByEmployee 的呼叫端回傳 null，沿用依日期比對
function matchSchedulePunches({ punchesByEmployee, actionBuffers }, employeeId, schedule, shift) {
  if (!punchesByEmployee) return null;
  return matchShiftPunches({
    records: punchesByEmployee.get(employeeId) ?? [],
    scheduleDate: schedule.date,
    shift,
    actionBuffers,
  });
}

// 出勤與工時：每位員工整個月的班表一起比對打卡（與薪資工時相同，services/attendancePunchService.js 的 matchSchedulesPunches），
// 同一筆打卡只算給一個班，缺勤那天不會拿到隔天班的打卡。回傳 Map(班表 → 比對結果)；沒有帶 punchesByEmployee 的呼叫端回傳 null，沿用依日期比對
// leadingSchedules：月初前一天的班表，只用來讓那一班認領自己的打卡（不在結果裡，也不算進報表）
function assignSchedulePunches({ schedules, leadingSchedules = [], shiftMap, punchesByEmployee, actionBuffers }) {
  if (!punchesByEmployee) return null;
  const schedulesByEmployee = new Map();
  const add = (schedule, contextOnly) => {
    const employeeId = normalizeId(schedule.employee);
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    if (!schedulesByEmployee.has(employeeId)) schedulesByEmployee.set(employeeId, []);
    schedulesByEmployee.get(employeeId).push({
      key: schedule,
      scheduleDate: schedule.date,
      shift,
      nonWork: !shift || isNonWorkShift(shift),
      contextOnly,
    });
  };
  (leadingSchedules || []).forEach((schedule) => add(schedule, true));
  schedules.forEach((schedule) => add(schedule, false));
  const assigned = new Map();
  schedulesByEmployee.forEach((items, employeeId) => {
    matchSchedulesPunches({ records: punchesByEmployee.get(employeeId) ?? [], schedules: items, actionBuffers })
      .forEach((value, schedule) => assigned.set(schedule, value));
  });
  return assigned;
}

// 這一班在請假中的部分不算遲到或早退（與薪資的 attendanceDeductionService.trimSpanByLeave 相同）：
// 請假涵蓋上班時間，從請假結束才開始算遲到；請假涵蓋下班時間，只看請假開始之前有沒有走。
// 整班都在請假中時回傳的結束時間不晚於開始時間，呼叫端略過這一班。
function trimSpanByLeave(span, leaves) {
  let start = span.start.getTime();
  let end = span.end.getTime();
  for (let round = 0; round <= leaves.length; round += 1) {
    let changed = false;
    for (const leave of leaves) {
      if (leave.endMs <= start || leave.startMs >= end) continue;
      if (leave.startMs <= start) {
        start = Math.min(leave.endMs, end);
        changed = true;
      } else if (leave.endMs >= end) {
        end = Math.max(leave.startMs, start);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { start: new Date(start), end: new Date(end) };
}

const usableLeaveIntervals = (leaveIntervals, employeeId) => (leaveIntervals?.get(employeeId) ?? [])
  .filter((leave) => Number.isFinite(leave?.startMs) && Number.isFinite(leave?.endMs) && leave.endMs > leave.startMs);

// 該月已核准的請假區間：Map(員工 ID → [{ startMs, endMs, allDay }])。沒有資料庫連線（單元測試）或查詢失敗時當作沒有請假，報表照常產生
async function loadLeaveIntervalsForReport({ employeeIds, start, end }) {
  if (mongoose.connection.readyState !== 1) return new Map();
  try {
    return await loadApprovedLeaveIntervals({ employeeIds, start, end });
  } catch (error) {
    console.error(`[report] approved leave lookup skipped: ${error?.name || 'Error'}`);
    return new Map();
  }
}

// 與薪資的遲到早退計算（attendanceDeductionService）相同，不足一分鐘不計
function wholeMinutesBetween(start, end) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(diff) ? Math.floor(diff / 60000) : 0;
}

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

function groupAttendanceRecords(records) {
  const map = new Map();
  records.forEach((record) => {
    const employeeId = normalizeId(record.employee);
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
  map.forEach((value) => {
    value.clockIns.sort((a, b) => a - b);
    value.clockOuts.sort((a, b) => a - b);
  });
  return map;
}

function buildEmployeeMap(employees) {
  const map = new Map();
  employees.forEach((emp) => {
    map.set(normalizeId(emp._id), emp);
  });
  return map;
}

async function loadAttendanceData({ employeeIds, start, end }) {
  // 打卡多讀前後各一天：月初第一天台灣時間 08:00 以前的打卡在 UTC 是前一天，月底跨日班的下班打卡在下個月
  const recordRangeStart = new Date(start);
  recordRangeStart.setUTCDate(recordRangeStart.getUTCDate() - 1);
  const recordRangeEnd = new Date(end);
  recordRangeEnd.setUTCDate(recordRangeEnd.getUTCDate() + 1);
  // 班表多讀月初前一天（leadingSchedules）：不算進報表，只用來讓那一班認領自己的打卡
  const [scheduleRows, attendanceRecords] = await Promise.all([
    ShiftSchedule.find({
      employee: { $in: employeeIds },
      date: { $gte: recordRangeStart, $lt: end },
    })
      .lean()
      .exec(),
    AttendanceRecord.find({
      employee: { $in: employeeIds },
      timestamp: { $gte: recordRangeStart, $lt: recordRangeEnd },
      action: { $in: ['clockIn', 'clockOut'] },
    })
      .lean()
      .exec(),
  ]);
  const inMonth = (row) => new Date(row.date).getTime() >= start.getTime();
  return {
    schedules: (scheduleRows || []).filter(inMonth),
    leadingSchedules: (scheduleRows || []).filter((row) => !inMonth(row)),
    attendanceRecords,
  };
}

/*
 * 出勤統計：應出勤＝這個月排的工作班；出勤＝有簽到；請假（onLeave）＝沒有簽到、但那一班在核准的請假中；
 * 缺勤＝已經開始的班裡，沒有簽到也沒有請假的。還沒開始的班（這個月之後的日子）算在應出勤，不算缺勤。
 * leaveIntervals（Map 員工 → 請假區間）與 now 由實際的報表帶入；沒有帶時（舊的呼叫端）維持原本的算法：缺勤＝應出勤－出勤。
 */
function buildAttendanceSummary({ employees, schedules, leadingSchedules = [], recordMap, shiftMap, punchesByEmployee, actionBuffers, leaveIntervals = null, now = null }) {
  const leaveAware = Boolean(leaveIntervals) || Boolean(now);
  const nowMs = now ? new Date(now).getTime() : null;
  const summary = leaveAware ? { scheduled: 0, attended: 0, onLeave: 0, absent: 0 } : { scheduled: 0, attended: 0, absent: 0 };
  const results = [];
  const attendanceCounter = new Map();
  const upcomingCounter = new Map();

  employees.forEach((emp) => {
    const id = normalizeId(emp._id);
    const base = leaveAware
      ? { employee: id, name: emp.name ?? '', scheduled: 0, attended: 0, onLeave: 0, absent: 0 }
      : { employee: id, name: emp.name ?? '', scheduled: 0, attended: 0, absent: 0 };
    attendanceCounter.set(id, base);
  });

  // 每位員工「某天是不是在請假中」：整天的假，或有時分的假涵蓋整個班次（與排班、國定假日休假紀錄同一個判斷）
  const leaveChecks = new Map();
  // 每位員工各天排的班別（第一次用到才整理一次，500 人一個月的班表不必每個人都掃一遍）
  let shiftsByEmployee = null;
  const shiftsOf = (employeeId) => {
    if (!shiftsByEmployee) {
      shiftsByEmployee = new Map();
      schedules.forEach((item) => {
        const itemShift = shiftMap.get(normalizeId(item.shiftId));
        if (!itemShift) return;
        const owner = normalizeId(item.employee);
        if (!shiftsByEmployee.has(owner)) shiftsByEmployee.set(owner, new Map());
        shiftsByEmployee.get(owner).set(buildDateKey(item.date), itemShift);
      });
    }
    return shiftsByEmployee.get(employeeId) ?? new Map();
  };
  const isOnLeave = (employeeId, schedule, shift) => {
    if (!leaveIntervals) return false;
    if (!leaveChecks.has(employeeId)) {
      const shiftByDate = shiftsOf(employeeId);
      leaveChecks.set(employeeId, buildLeaveDayCheck(
        usableLeaveIntervals(leaveIntervals, employeeId),
        (dateKey) => (shiftByDate.has(dateKey) ? { kind: isNonWorkShift(shiftByDate.get(dateKey)) ? 'rest' : 'work', shift: shiftByDate.get(dateKey) } : null),
      ));
    }
    return shift ? leaveChecks.get(employeeId)(buildDateKey(schedule.date)) : false;
  };

  const assigned = assignSchedulePunches({ schedules, leadingSchedules, shiftMap, punchesByEmployee, actionBuffers });
  schedules.forEach((schedule) => {
    const employeeId = normalizeId(schedule.employee);
    const record = attendanceCounter.get(employeeId);
    if (!record) return;
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    // 休息日 / 例假 / 國定假日 / 請假 / 沒有工作時間的班別：不算應出勤，也就不會算缺勤
    if (!shift || isNonWorkShift(shift)) return;
    record.scheduled += 1;
    let attended = false;
    if (assigned) {
      // 這一班有簽到（時段內的，或依日期比對、沒有被別的班用掉的）就算出勤
      attended = Boolean(assigned.get(schedule)?.clockIn);
    } else {
      const dateKey = buildDateKey(schedule.date);
      const entry = recordMap.get(`${employeeId}::${dateKey}`);
      attended = Boolean(entry && entry.clockIns.length);
    }
    if (attended) {
      record.attended += 1;
      return;
    }
    if (!leaveAware) return;
    if (isOnLeave(employeeId, schedule, shift)) {
      record.onLeave += 1;
      return;
    }
    // 還沒開始的班不是缺勤
    const span = nowMs !== null ? computeShiftSpan(schedule.date, shift) : null;
    if (span && span.start.getTime() > nowMs) {
      upcomingCounter.set(employeeId, (upcomingCounter.get(employeeId) ?? 0) + 1);
    }
  });

  // Only include employees who have schedules
  attendanceCounter.forEach((record, employeeId) => {
    if (record.scheduled > 0) {
      const excused = leaveAware ? record.onLeave + (upcomingCounter.get(employeeId) ?? 0) : 0;
      record.absent = Math.max(record.scheduled - record.attended - excused, 0);
      summary.scheduled += record.scheduled;
      summary.attended += record.attended;
      if (leaveAware) summary.onLeave += record.onLeave;
      summary.absent += record.absent;
      results.push(record);
    }
  });

  return { records: results, summary };
}

function buildTardinessSummary({ schedules, recordMap, shiftMap, employees, lateGrace, punchesByEmployee, actionBuffers, leaveIntervals = null }) {
  const summary = { totalLateCount: 0, totalLateMinutes: 0, averageLateMinutes: 0 };
  const employeeMap = buildEmployeeMap(employees);
  const records = [];

  schedules.forEach((schedule) => {
    const employeeId = normalizeId(schedule.employee);
    const employee = employeeMap.get(employeeId);
    if (!employee) return;
    const dateKey = buildDateKey(schedule.date);
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    if (!shift || isNonWorkShift(shift)) return;
    if (punchesByEmployee) {
      // 依簽到時段內最早的打卡（線上或指紋）判斷，與薪資的遲到扣款一致
      const punches = matchSchedulePunches({ punchesByEmployee, actionBuffers }, employeeId, schedule, shift);
      if (!punches?.clockIn) return;
      const clockIn = new Date(punches.clockIn.timestamp);
      // 核准的請假中不算遲到：請假涵蓋上班時間時，從請假結束才開始算（與薪資的遲到扣款相同）
      const leaves = usableLeaveIntervals(leaveIntervals, employeeId);
      const span = leaves.length ? trimSpanByLeave(punches.span, leaves) : punches.span;
      if (span.end.getTime() <= span.start.getTime()) return;
      const lateMinutes = Math.max(wholeMinutesBetween(span.start, clockIn) - lateGrace, 0);
      if (lateMinutes <= 0) return;
      summary.totalLateCount += 1;
      summary.totalLateMinutes += lateMinutes;
      records.push({
        employee: employeeId,
        name: employee.name ?? '',
        date: dateKey,
        scheduledStart: formatLocalTime(span.start),
        actualClockIn: formatLocalTime(clockIn),
        // 實際打卡的來源：online 線上、import 指紋匯入、manual 手動補登、legacy 舊資料未標示
        clockInSource: resolveAttendanceSource(punches.clockIn),
        minutesLate: lateMinutes,
      });
      return;
    }
    const { start } = computeShiftTimes(schedule.date, shift);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    if (!dayRecord || !dayRecord.clockIns.length) return;
    const firstClockIn = dayRecord.clockIns[0];
    const diffMinutes = Math.max(minutesBetween(start, firstClockIn) - lateGrace, 0);
    if (diffMinutes <= 0) return;
    summary.totalLateCount += 1;
    summary.totalLateMinutes += diffMinutes;
    records.push({
      employee: employeeId,
      name: employee.name ?? '',
      date: dateKey,
      scheduledStart: formatTime(start),
      actualClockIn: formatTime(firstClockIn),
      minutesLate: diffMinutes,
    });
  });

  if (summary.totalLateCount) {
    summary.averageLateMinutes = Math.round((summary.totalLateMinutes / summary.totalLateCount) * 100) / 100;
  }

  return { summary, records };
}

function buildEarlyLeaveSummary({ schedules, recordMap, shiftMap, employees, earlyGrace, punchesByEmployee, actionBuffers, leaveIntervals = null }) {
  const summary = { totalEarlyLeaveCount: 0, totalEarlyMinutes: 0, averageEarlyMinutes: 0 };
  const employeeMap = buildEmployeeMap(employees);
  const records = [];

  schedules.forEach((schedule) => {
    const employeeId = normalizeId(schedule.employee);
    const employee = employeeMap.get(employeeId);
    if (!employee) return;
    const dateKey = buildDateKey(schedule.date);
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    if (!shift || isNonWorkShift(shift)) return;
    if (punchesByEmployee) {
      // 依簽退時段內最晚的打卡（線上或指紋）判斷，與薪資的早退扣款一致
      const punches = matchSchedulePunches({ punchesByEmployee, actionBuffers }, employeeId, schedule, shift);
      if (!punches?.clockOut) return;
      const clockOut = new Date(punches.clockOut.timestamp);
      // 核准的請假中不算早退：請假涵蓋下班時間時，只看請假開始之前有沒有走（與薪資的早退扣款相同）
      const leaves = usableLeaveIntervals(leaveIntervals, employeeId);
      const span = leaves.length ? trimSpanByLeave(punches.span, leaves) : punches.span;
      if (span.end.getTime() <= span.start.getTime()) return;
      const earlyMinutes = Math.max(wholeMinutesBetween(clockOut, span.end) - earlyGrace, 0);
      if (earlyMinutes <= 0) return;
      summary.totalEarlyLeaveCount += 1;
      summary.totalEarlyMinutes += earlyMinutes;
      records.push({
        employee: employeeId,
        name: employee.name ?? '',
        date: dateKey,
        scheduledEnd: formatLocalTime(span.end),
        actualClockOut: formatLocalTime(clockOut),
        clockOutSource: resolveAttendanceSource(punches.clockOut),
        minutesEarly: earlyMinutes,
      });
      return;
    }
    const { start, end } = computeShiftTimes(schedule.date, shift);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    const clockOuts = [...(dayRecord?.clockOuts ?? [])];
    if (shift.crossDay || buildDateKey(end) !== dateKey) {
      const nextDayRecord = recordMap.get(`${employeeId}::${buildDateKey(end)}`);
      clockOuts.push(...(nextDayRecord?.clockOuts ?? []));
    }
    const latestRelevantClockOut = new Date(end.getTime() + 6 * 60 * 60 * 1000);
    const relevantClockOuts = clockOuts
      .filter((clockOut) => clockOut > start && clockOut <= latestRelevantClockOut)
      .sort((a, b) => a - b);
    if (!relevantClockOuts.length) return;
    const lastClockOut = relevantClockOuts[relevantClockOuts.length - 1];
    const diffMinutes = Math.max(minutesBetween(lastClockOut, end) - earlyGrace, 0);
    if (diffMinutes <= 0) return;
    summary.totalEarlyLeaveCount += 1;
    summary.totalEarlyMinutes += diffMinutes;
    records.push({
      employee: employeeId,
      name: employee.name ?? '',
      date: dateKey,
      scheduledEnd: formatTime(end),
      actualClockOut: formatTime(lastClockOut),
      minutesEarly: diffMinutes,
    });
  });

  if (summary.totalEarlyLeaveCount) {
    summary.averageEarlyMinutes = Math.round((summary.totalEarlyMinutes / summary.totalEarlyLeaveCount) * 100) / 100;
  }

  return { summary, records };
}

function buildWorkHoursSummary({ schedules, leadingSchedules = [], recordMap, shiftMap, employees, punchesByEmployee, actionBuffers, now = null }) {
  const employeeMap = buildEmployeeMap(employees);
  const records = [];
  let totalScheduledMinutes = 0;
  let totalWorkedMinutes = 0;
  const assigned = assignSchedulePunches({ schedules, leadingSchedules, shiftMap, punchesByEmployee, actionBuffers });
  const nowMs = now ? new Date(now).getTime() : null;

  schedules.forEach((schedule) => {
    const employeeId = normalizeId(schedule.employee);
    const employee = employeeMap.get(employeeId);
    if (!employee) return;
    const dateKey = buildDateKey(schedule.date);
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    if (!shift || isNonWorkShift(shift)) return;
    // 還沒開始的班不列入：不然這個月之後的每一天都是「實際 0 小時、差異 -8 小時」，合計也被拉低
    if (nowMs !== null) {
      const span = computeShiftSpan(schedule.date, shift);
      if (span && span.start.getTime() > nowMs) return;
    }
    const { start, end } = computeShiftTimes(schedule.date, shift);
    const breakMinutes = getShiftBreakMinutes(shift, schedule.date);
    const scheduledMinutes = Math.max(minutesBetween(start, end) - breakMinutes, 0);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    let workedMinutes = 0;
    // 有帶打卡（實際的報表）時，用整個月一起比對的結果：先依班別時段（線上與指紋一起看，簽到取最早、簽退取最晚），
    // 時段內找不到才依日期比對，同一筆打卡只算給一個班。沒有帶打卡的呼叫端沿用下面依日期比對
    const punches = assigned?.get(schedule);

    // For cross-day shifts, we need to check both current day and next day for clock records
    // Also check previous day for clock-in if this is a cross-day shift
    let first = punches?.clockIn ? new Date(punches.clockIn.timestamp) : null;
    let last = first && punches?.clockOut ? new Date(punches.clockOut.timestamp) : null;

    // Check for clock-in on schedule date
    if (!assigned && !first && dayRecord && dayRecord.clockIns.length) {
      first = dayRecord.clockIns[0];
    }

    // For cross-day shifts, also check previous day for clock-in
    if (!assigned && !first && shift.crossDay) {
      const prevDate = new Date(schedule.date);
      prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      const prevDateKey = buildDateKey(prevDate);
      const prevDayRecord = recordMap.get(`${employeeId}::${prevDateKey}`);
      
      if (prevDayRecord && prevDayRecord.clockIns.length) {
        first = prevDayRecord.clockIns[prevDayRecord.clockIns.length - 1]; // Use the last clock-in of previous day
      }
    }
    
    if (first && !assigned) {
      // First, try to find clock-out on the same day as clock-in
      const clockInDateKey = buildDateKey(first);
      const clockInDayRecord = recordMap.get(`${employeeId}::${clockInDateKey}`);
      
      if (!last && clockInDayRecord && clockInDayRecord.clockOuts.length) {
        // Find the first clock-out after the clock-in time
        for (const clockOut of clockInDayRecord.clockOuts) {
          if (clockOut > first) {
            last = clockOut;
            break;
          }
        }
      }
      
      // If no clock-out found on the same day, check next day
      if (!last) {
        const clockInNextDay = new Date(first);
        clockInNextDay.setUTCDate(clockInNextDay.getUTCDate() + 1);
        const nextDateKey = buildDateKey(clockInNextDay);
        const nextDayRecord = recordMap.get(`${employeeId}::${nextDateKey}`);
        
        if (nextDayRecord && nextDayRecord.clockOuts.length) {
          last = nextDayRecord.clockOuts[0]; // Use the first clock-out of next day
        }
      }
    }

    if (first && last) {
      workedMinutes = Math.max(minutesBetween(first, last) - breakMinutes, 0);
    }

    totalScheduledMinutes += Math.max(scheduledMinutes, 0);
    totalWorkedMinutes += Math.max(workedMinutes, 0);
    records.push({
      employee: employeeId,
      name: employee.name ?? '',
      date: dateKey,
      scheduledHours: hoursFromMinutes(scheduledMinutes),
      workedHours: hoursFromMinutes(workedMinutes),
      differenceHours: hoursFromMinutes(workedMinutes - scheduledMinutes),
    });
  });

  return {
    summary: {
      totalScheduledHours: hoursFromMinutes(totalScheduledMinutes),
      totalWorkedHours: hoursFromMinutes(totalWorkedMinutes),
      differenceHours: hoursFromMinutes(totalWorkedMinutes - totalScheduledMinutes),
    },
    records,
  };
}

// 欄位標籤的寬鬆比對：全形轉半形、轉小寫、去掉空白與括號，「加班 時數」「加班時數」視為相同
function labelMatches(label, aliases) {
  const normalized = normalizeLeaveFieldLabel(label);
  return aliases.some((alias) => normalizeLeaveFieldLabel(alias) === normalized);
}

// 找出這張表單裡各用途的欄位 ID：同標籤有多個欄位時全部列為候選（啟用中的在前、停用的在後），
// 欄位被停用或換成同標籤的新欄位後，舊單據的答案還在舊欄位 ID 底下，每一張單各自用第一個有填值的
function mapFormFields(fields, fieldLabels) {
  const fieldMap = {};
  Object.entries(fieldLabels).forEach(([key, labels]) => {
    // 依 labels 的順序找：靠前的標籤優先（例如「加班日期」比「日期」優先）
    let candidateIds = [];
    for (const label of labels) {
      candidateIds = orderFieldCandidateIds(fields.filter((field) => labelMatches(field.label, [label])));
      if (candidateIds.length) break;
    }
    fieldMap[key] = candidateIds;
  });
  return fieldMap;
}

// 這個報表對應的所有表單與各自的欄位對應。加班報表依表單性質找（改名也找得到），其他報表依名稱
async function resolveApprovalFormConfigs(type) {
  const config = APPROVAL_FORM_CONFIGS[type];
  if (!config) return [];
  const query = config.semanticType
    ? {
      $or: [
        { semanticType: config.semanticType },
        // 沒有表單性質的舊表單才用名稱推論
        { semanticType: null, name: { $in: config.templateNames } },
      ],
    }
    : { name: { $in: config.templateNames } };
  const forms = (await FormTemplate.find(query).lean()) || [];
  const matched = config.semanticType ? forms.filter(config.isForm) : forms;
  const configs = [];
  for (const form of matched) {
    const fields = (await FormField.find({ form: form._id }).lean()) || [];
    configs.push({ formId: normalizeId(form._id), fieldMap: mapFormFields(fields, config.fields) });
  }
  return configs;
}

function parseNumber(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(String(value).replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureEmployeeApproval(approval, employeeMap) {
  const employeeId = normalizeId(
    approval.applicant_employee?._id ?? approval.applicant_employee ?? approval.employee
  );
  const employee = employeeMap.get(employeeId);
  if (!employee) return null;
  return { employeeId, employee };
}

function monthKeysOf(start, end) {
  return { startKey: start.toISOString().slice(0, 10), endKey: end.toISOString().slice(0, 10) };
}

/**
 * 該月的已核准請假（所有請假表單）。請假依「請假日期」歸屬月份（台灣日期），不是送簽日期；
 * 跨月的假單只算本月的天數。天數取自表單的「天數」欄位，沒有時才由開始、結束時間推算。
 * 每筆回傳：{ approvalId, employeeId, name, leaveType, leaveCode, startDate, endDate, days, hours }
 */
async function loadMonthlyLeaveRows({ employeeIds, start, end }) {
  const leaveForms = await getAllLeaveFieldInfos();
  const { startKey, endKey } = monthKeysOf(start, end);
  const rows = [];
  for (const leaveForm of leaveForms || []) {
    const { formId, startId, endId, typeId, daysId, typeOptions } = leaveForm;
    if (!formId) continue;
    // 已停用的請假表單照樣計入；欄位被停用或換成同標籤的新欄位後，逐張假單用第一個有填值的同標籤欄位
    const startIds = resolveCandidateIds(leaveForm.startIds, startId);
    const endIds = resolveCandidateIds(leaveForm.endIds, endId);
    const typeIds = resolveCandidateIds(leaveForm.typeIds, typeId);
    const daysIds = resolveCandidateIds(leaveForm.daysIds, daysId);
    // 「時數」欄位（請假以小時為單位）；舊表單沒有這個欄位時為空陣列
    const hoursIds = resolveCandidateIds(leaveForm.hoursIds, leaveForm.hoursId);
    // 只取用得到的欄位：關卡與紀錄（steps、logs）佔單據的大部分，報表用不到
    let approvalQuery = ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
    });
    if (typeof approvalQuery?.select === 'function') approvalQuery = approvalQuery.select('form_data applicant_employee createdAt');
    const approvals = await approvalQuery
      .populate('applicant_employee', 'name')
      .lean();
    const typeMap = new Map(typeOptions?.map((opt) => [String(opt.value), opt.label]));
    for (const approval of approvals || []) {
      const employee = approval.applicant_employee;
      if (!employee) continue;
      const formData = approval.form_data || {};
      const typeValue = pickFieldValue(formData, typeIds);
      const typeCode = typeValue?.code ?? typeValue?.value ?? typeValue ?? '';
      const code = typeCode ? String(typeCode) : '';
      const labelCandidate = typeValue?.label ?? typeMap.get(code) ?? code;
      const leaveType = labelCandidate ? String(labelCandidate) : code;

      const duration = computeLeaveDuration({
        startValue: pickFieldValue(formData, startIds),
        endValue: pickFieldValue(formData, endIds),
        filledHours: pickFieldValue(formData, hoursIds),
        filledDays: pickFieldValue(formData, daysIds),
        literalDays: formData.days ?? formData.duration,
        literalHours: formData.hours,
        hoursPerDay: WORK_HOURS_CONFIG.HOURS_PER_DAY,
      });
      let days = duration.days;
      let hours = duration.hours;
      if (duration.perDay.length) {
        hours = sumLeaveHoursInRange(duration.perDay, startKey, endKey);
        if (hours <= 0) continue;
        days = Math.round((hours / WORK_HOURS_CONFIG.HOURS_PER_DAY) * 100) / 100;
      } else {
        // 沒有請假日期的舊資料，退回用送簽日期歸屬月份
        const createdKey = toTaipeiDateKey(approval.createdAt);
        if (createdKey && (createdKey < startKey || createdKey >= endKey)) continue;
      }
      rows.push({
        approvalId: normalizeId(approval._id),
        employeeId: normalizeId(employee._id ?? employee),
        name: employee.name ?? '',
        leaveType,
        leaveCode: code,
        startDate: duration.startKey,
        endDate: duration.endKey,
        days: Math.max(days, 0),
        hours,
      });
    }
  }
  return rows;
}

// 表單日期時間（前端日期選擇器送出的 UTC ISO 字串）一律以台灣時間顯示
function formatFormDate(value) {
  return toTaipeiDateKey(value) ?? '';
}

function formatFormTime(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value.trim())) return value.trim();
  const parts = toTaipeiParts(value);
  if (!parts) return typeof value === 'string' ? value.trim() : '';
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function isCrossDayFlag(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'y', '是', '跨日'].includes(String(value ?? '').trim().toLowerCase());
}

// 加班時數：有時數欄位就用它，沒有（預設的加班申請只有開始、結束時間）就由開始、結束時間算
function overtimeHoursOf(read) {
  const filled = parseNumber(read('hours'));
  if (filled > 0) return filled;
  const startMs = new Date(read('startTime')).getTime();
  const endMs = new Date(read('endTime')).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  let diff = endMs - startMs;
  if (diff < 0 && isCrossDayFlag(read('crossDay'))) diff += 24 * 60 * 60 * 1000;
  return diff > 0 ? Math.round((diff / (60 * 60 * 1000)) * 100) / 100 : 0;
}

// 這個報表對應的表單底下已核准的單（每張符合的表單各查一次，依各自的欄位 ID 取值）
async function loadApprovalFormItems({ type, employeeIds, employeeMap }) {
  const configs = await resolveApprovalFormConfigs(type);
  const items = [];
  for (const config of configs) {
    let approvalQuery = ApprovalRequest.find({
      form: config.formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
    });
    if (typeof approvalQuery?.select === 'function') approvalQuery = approvalQuery.select('form_data applicant_employee createdAt');
    const approvals = await approvalQuery
      .populate('applicant_employee', 'name')
      .lean();
    for (const approval of approvals || []) {
      const resolved = ensureEmployeeApproval(approval, employeeMap);
      if (!resolved) continue;
      const read = (key) => pickFieldValue(approval.form_data, config.fieldMap[key]);
      items.push({ approval, resolved, read });
    }
  }
  return items;
}

// 調休的各種寫法（調休、補休、補假、移休…，與調休存摺扣用的名稱同一份：config/leavePolicyConfig.js）
const normalizeLeaveTypeName = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s()[\]【】]/g, '');
const COMP_LEAVE_NAME_KEYS = new Set([COMP_LEAVE_TYPE_NAME, ...COMP_LEAVE_TYPE_ALIASES].map(normalizeLeaveTypeName));
const isCompLeaveRow = (row) => COMP_LEAVE_NAME_KEYS.has(normalizeLeaveTypeName(row.leaveType))
  || COMP_LEAVE_NAME_KEYS.has(normalizeLeaveTypeName(row.leaveCode));

// 調休存摺的資料只在連上資料庫時讀（單元測試以替身取代其他模型時不讀，報表照常產出）
const creditStoreReady = () => mongoose.connection?.readyState === 1;

const creditLabel = (credit) => {
  const dateKey = formatDate(credit.holidayDate || credit.earnedDate);
  if (credit.sourceType === 'holiday_rest') return [credit.holidayName, dateKey].filter(Boolean).join(' ');
  return [credit.sourceType === 'legacy_balance' ? '既有補休時數' : '人資給予', dateKey].filter(Boolean).join(' ');
};

// 每張調休單扣用了哪幾筆額度：Map(簽核單 ID -> 「國慶日 2026-10-10」這樣的說明)
async function loadCreditSourcesByRequest(approvalIds) {
  const result = new Map();
  if (!approvalIds.length || !creditStoreReady()) return result;
  const requestIds = approvalIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
  if (!requestIds.length) return result;
  const credits = await CompensatoryCredit.find({ 'usages.approvalRequest': { $in: requestIds } })
    .select('sourceType holidayName holidayDate earnedDate usages.approvalRequest')
    .sort({ earnedDate: 1 })
    .lean();
  for (const credit of credits || []) {
    const label = creditLabel(credit);
    for (const requestId of new Set((credit.usages || []).map((usage) => normalizeId(usage.approvalRequest)).filter(Boolean))) {
      if (!result.has(requestId)) result.set(requestId, []);
      result.get(requestId).push(label);
    }
  }
  return new Map(Array.from(result, ([requestId, labels]) => [requestId, labels.join('、')]));
}

// 這個月存入調休存摺的額度（取得日在這個月，作廢的不算）
async function loadEarnedCredits({ employeeIds, start, end }) {
  if (!creditStoreReady()) return { earnedCredits: 0, earnedHours: 0 };
  const credits = await CompensatoryCredit.find({
    employee: { $in: employeeIds },
    earnedDate: { $gte: start, $lt: end },
    status: { $ne: 'void' },
  }).select('hours').lean();
  const hours = (credits || []).reduce((sum, credit) => sum + (Number(credit.hours) || 0), 0);
  return { earnedCredits: (credits || []).length, earnedHours: roundTwo(hours) };
}

/**
 * 補休申請統計：這個月的調休使用（請假單上假別是 調休／補休／補假／移休 的已核准假單，依請假日期歸屬月份、跨月只算本月的時數），
 * 加上更早以前「補休申請」表單的舊資料；summary 另外帶這個月存入調休存摺的筆數與時數。
 * 以前只找名稱是 補休／補休申請／補休單 的表單，補休改成請假單的假別之後報表永遠是空的。
 */
async function buildCompTimeReport({ employeeIds, start, end, employeeMap }) {
  const { startKey, endKey } = monthKeysOf(start, end);
  const records = [];
  let totalHours = 0;

  const leaveRows = (await loadMonthlyLeaveRows({ employeeIds, start, end }))
    .filter((row) => employeeMap.has(row.employeeId) && isCompLeaveRow(row));
  const sources = await loadCreditSourcesByRequest(leaveRows.map((row) => row.approvalId));
  leaveRows.forEach((row) => {
    totalHours += row.hours || 0;
    records.push({
      approvalId: row.approvalId,
      employee: row.employeeId,
      name: employeeMap.get(row.employeeId).name ?? row.name ?? '',
      date: row.startDate,
      endDate: row.endDate,
      leaveType: row.leaveType,
      hours: row.hours,
      // 欄位名稱沿用舊報表（來源加班單）：現在放的是這張單扣用的調休額度來源
      overtimeReference: sources.get(row.approvalId) ?? '',
    });
  });

  for (const { approval, resolved, read } of await loadApprovalFormItems({ type: 'compTime', employeeIds, employeeMap })) {
    const date = formatFormDate(read('date')) || formatFormDate(approval.createdAt);
    if (!date || date < startKey || date >= endKey) continue;
    const hours = parseNumber(read('hours'));
    totalHours += hours;
    records.push({
      approvalId: normalizeId(approval._id),
      employee: resolved.employeeId,
      name: resolved.employee.name ?? '',
      date,
      hours,
      overtimeReference: read('reference') ?? '',
    });
  }
  records.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.name).localeCompare(String(b.name), 'zh-Hant'));

  const earned = await loadEarnedCredits({ employeeIds, start, end });
  return {
    records,
    summary: {
      totalRequests: records.length,
      totalHours: roundTwo(totalHours),
      ...earned,
    },
  };
}

async function buildApprovalRecords({
  type,
  employeeIds,
  start,
  end,
  employees,
}) {
  const employeeMap = buildEmployeeMap(employees);
  const { startKey, endKey } = monthKeysOf(start, end);

  if (type === 'specialLeave') {
    const rows = (await loadMonthlyLeaveRows({ employeeIds, start, end }))
      // 舊資料的「特休」與字典項目的「特休假」都算特休
      .filter((row) => ANNUAL_LEAVE_TYPES.includes(row.leaveType));
    const records = [];
    let totalDays = 0;
    let totalHours = 0;
    rows.forEach((row) => {
      if (!employeeMap.has(row.employeeId)) return;
      if (row.days) totalDays += row.days;
      if (row.hours) totalHours += row.hours;
      records.push({
        approvalId: row.approvalId,
        employee: row.employeeId,
        name: employeeMap.get(row.employeeId).name ?? row.name ?? '',
        startDate: row.startDate,
        endDate: row.endDate,
        days: row.days,
        hours: row.hours,
      });
    });
    return {
      records,
      summary: {
        totalRequests: records.length,
        // 天數由總時數換算（每一列各自四捨五入後再加總會和時數對不起來：八張 1 小時的假會變成 1.04 天）
        totalDays: totalHours > 0 ? roundTwo(totalHours / HOURS_PER_DAY) : roundTwo(totalDays),
        totalHours: Math.round(totalHours * 100) / 100,
      },
    };
  }

  if (type === 'compTime') {
    return buildCompTimeReport({ employeeIds, start, end, employeeMap });
  }

  // 每張符合的表單各查一次已核准的單，依各自的欄位 ID 取值，月份以單上的日期（台灣時間）為準
  const items = await loadApprovalFormItems({ type, employeeIds, employeeMap });

  if (type === 'overtime') {
    let totalHours = 0;
    const records = [];
    for (const { approval, resolved, read } of items) {
      // 加班日期：有日期欄位用它，否則用開始時間的台灣日期，最後才是送簽日期
      const date = formatFormDate(read('date')) || formatFormDate(read('startTime')) || formatFormDate(approval.createdAt);
      if (!date || date < startKey || date >= endKey) continue;
      const hours = overtimeHoursOf(read);
      totalHours += hours;
      records.push({
        approvalId: normalizeId(approval._id),
        employee: resolved.employeeId,
        name: resolved.employee.name ?? '',
        date,
        startTime: formatFormTime(read('startTime')),
        endTime: formatFormTime(read('endTime')),
        hours,
        reason: read('reason') ?? '',
      });
    }
    return {
      records,
      summary: {
        totalRequests: records.length,
        totalHours: Math.round(totalHours * 100) / 100,
      },
    };
  }
  if (type === 'makeUp') {
    const categoryMap = new Map();
    const records = [];
    for (const { approval, resolved, read } of items) {
      const date = formatFormDate(read('date')) || formatFormDate(approval.createdAt);
      if (!date || date < startKey || date >= endKey) continue;
      const category = read('category') ?? '';
      const normalizedCategory = category ? String(category) : '未分類';
      categoryMap.set(normalizedCategory, (categoryMap.get(normalizedCategory) ?? 0) + 1);
      records.push({
        approvalId: normalizeId(approval._id),
        employee: resolved.employeeId,
        name: resolved.employee.name ?? '',
        date,
        category: normalizedCategory,
        note: read('note') ?? '',
      });
    }
    return {
      records,
      summary: {
        totalRequests: records.length,
        byCategory: Array.from(categoryMap.entries()).map(([label, count]) => ({ label, count })),
      },
    };
  }
  return { records: [], summary: {} };
}

async function buildDepartmentReportData({ type, month, departmentId, actor }, context = {}) {
  if (!REPORT_NAME_MAP[type]) {
    throw new ReportAccessError(404, 'Unknown report type');
  }
  const { start, end } = parseMonthRange(month);
  const employees = await resolveDepartmentEmployees(departmentId, actor);
  context.employees = employees;
  const employeeIds = employees.map((emp) => normalizeId(emp._id)).filter(Boolean);
  if (!employeeIds.length) {
    throw new ReportAccessError(404, 'No data');
  }
  if (type === 'attendance' || type === 'tardiness' || type === 'earlyLeave' || type === 'workHours') {
    const [{ schedules, leadingSchedules, attendanceRecords }, { shiftMap, lateGrace, earlyGrace, actionBuffers }] = await Promise.all([
      loadAttendanceData({ employeeIds, start, end }),
      buildAttendanceSettingContext(),
    ]);
    if (!schedules.length) {
      // Return empty data structure instead of throwing error
      return { summary: {}, records: [] };
    }
    const recordMap = groupAttendanceRecords(attendanceRecords);
    // 線上打卡與指紋匯入不分來源，依班別時段比對（簽到取最早、簽退取最晚）
    const punchesByEmployee = groupPunchesByEmployee(attendanceRecords);
    const now = new Date();
    // 核准的請假：請假中的班不是缺勤，請假涵蓋的時段不算遲到早退（工時報表用不到，不查）
    const leaveIntervals = type === 'workHours' ? null : await loadLeaveIntervalsForReport({ employeeIds, start, end });
    if (type === 'attendance') {
      return buildAttendanceSummary({ employees, schedules, leadingSchedules, recordMap, shiftMap, punchesByEmployee, actionBuffers, leaveIntervals, now });
    }
    if (type === 'tardiness') {
      const data = buildTardinessSummary({ schedules, recordMap, shiftMap, employees, lateGrace, punchesByEmployee, actionBuffers, leaveIntervals });
      if (!data.records.length) {
        // Return empty data structure instead of throwing error
        return { summary: { totalLateCount: 0, totalLateMinutes: 0, averageLateMinutes: 0 }, records: [] };
      }
      return data;
    }
    if (type === 'earlyLeave') {
      const data = buildEarlyLeaveSummary({ schedules, recordMap, shiftMap, employees, earlyGrace, punchesByEmployee, actionBuffers, leaveIntervals });
      if (!data.records.length) {
        // Return empty data structure instead of throwing error
        return { summary: { totalEarlyLeaveCount: 0, totalEarlyMinutes: 0, averageEarlyMinutes: 0 }, records: [] };
      }
      return data;
    }
    if (type === 'workHours') {
      const data = buildWorkHoursSummary({ schedules, leadingSchedules, recordMap, shiftMap, employees, punchesByEmployee, actionBuffers, now });
      if (!data.records.length) {
        // Return empty data structure instead of throwing error
        return { summary: { totalScheduledHours: 0, totalWorkedHours: 0, differenceHours: 0 }, records: [] };
      }
      return data;
    }
  }
  if (type === 'leave') {
    const rows = await loadMonthlyLeaveRows({ employeeIds, start, end });
    if (!rows.length) {
      // Return empty data structure instead of throwing error
      return {
        records: [],
        summary: { totalLeaves: 0, totalDays: 0, totalHours: 0, byType: [] }
      };
    }
    const records = [];
    const typeSummary = new Map();
    let totalDays = 0;
    let totalHours = 0;
    rows.forEach((row) => {
      totalDays += row.days;
      totalHours += row.hours;
      records.push({
        approvalId: row.approvalId,
        employee: row.employeeId,
        name: row.name,
        leaveType: row.leaveType,
        leaveCode: row.leaveCode,
        startDate: row.startDate,
        endDate: row.endDate,
        days: row.days,
        hours: row.hours,
      });
      const summaryEntry = typeSummary.get(row.leaveType) || { leaveType: row.leaveType, leaveCode: row.leaveCode, count: 0, days: 0, hours: 0 };
      summaryEntry.count += 1;
      summaryEntry.days += row.days;
      summaryEntry.hours = Math.round((summaryEntry.hours + row.hours) * 100) / 100;
      typeSummary.set(row.leaveType, summaryEntry);
    });
    // 天數的合計由時數換算（1 天 = 8 小時）：每一列各自四捨五入成天數再加總，會和時數對不起來（八張 1 小時的假變成 1.04 天）
    const daysFromHours = (hours, summedDays) => (hours > 0 ? roundTwo(hours / HOURS_PER_DAY) : roundTwo(summedDays));
    return {
      records,
      summary: {
        totalLeaves: records.length,
        totalDays: daysFromHours(totalHours, totalDays),
        totalHours: Math.round(totalHours * 100) / 100,
        byType: Array.from(typeSummary.values()).map((entry) => ({ ...entry, days: daysFromHours(entry.hours, entry.days) })),
      },
    };
  }

  if (type === 'specialLeave' || type === 'overtime' || type === 'compTime' || type === 'makeUp') {
    const data = await buildApprovalRecords({ type, employeeIds, start, end, employees });
    // 補休報表：這個月沒有人用調休，但有存入調休存摺的額度時，仍要回報存入的筆數與時數
    if (!data.records.length && !(data.summary?.earnedCredits > 0)) {
      // Return empty data structure instead of throwing error
      return { summary: {}, records: [] };
    }
    return data;
  }

  // Log warning for unknown report types but return empty data to avoid breaking API
  console.warn(`Unknown report type requested: ${type}. Returning empty data.`);
  return { summary: {}, records: [] };
}

// 預覽表格的每一列要能顯示員工頭像：員工資料已經載入，把有照片的列帶上 photo（儲存的路徑，與其他員工物件相同）
function attachEmployeePhotos(data, employees) {
  if (!data || !Array.isArray(data.records) || !Array.isArray(employees) || !employees.length) return data;
  const photoById = new Map();
  employees.forEach((emp) => {
    const photo = typeof emp?.photo === 'string' ? emp.photo.trim() : '';
    if (photo) photoById.set(normalizeId(emp._id), photo);
  });
  if (!photoById.size) return data;
  return {
    ...data,
    records: data.records.map((record) => {
      const photo = record && typeof record === 'object' ? photoById.get(normalizeId(record.employee ?? record.employeeObjectId)) : '';
      return photo ? { ...record, photo } : record;
    }),
  };
}

export async function getDepartmentReportData(params) {
  const context = {};
  const data = await buildDepartmentReportData(params, context);
  return attachEmployeePhotos(data, context.employees);
}

export function getReportDisplayName(type) {
  return REPORT_NAME_MAP[type] || '報表';
}

export const __testUtils = {
  computeShiftTimes,
  getShiftBreakMinutes,
  groupAttendanceRecords,
  minutesBetween,
  buildAttendanceSummary,
  buildTardinessSummary,
  buildEarlyLeaveSummary,
  buildWorkHoursSummary,
};

