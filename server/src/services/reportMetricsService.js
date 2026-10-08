import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import ApprovalRequest from '../models/approval_request.js';
import FormTemplate from '../models/form_template.js';
import FormField from '../models/form_field.js';
import { getAllLeaveFieldInfos } from './leaveFieldService.js';
import { isNonWorkShift } from './shiftSemanticService.js';
import { ANNUAL_LEAVE_TYPES, WORK_HOURS_CONFIG } from '../config/salaryConfig.js';
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

function parseMonthRange(month) {
  assertRequired(month, 'month required');
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
  return { shiftMap, lateGrace, earlyGrace };
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
  const recordRangeEnd = new Date(end);
  recordRangeEnd.setUTCDate(recordRangeEnd.getUTCDate() + 1);
  const [schedules, attendanceRecords] = await Promise.all([
    ShiftSchedule.find({
      employee: { $in: employeeIds },
      date: { $gte: start, $lt: end },
    })
      .lean()
      .exec(),
    AttendanceRecord.find({
      employee: { $in: employeeIds },
      timestamp: { $gte: start, $lt: recordRangeEnd },
      action: { $in: ['clockIn', 'clockOut'] },
    })
      .lean()
      .exec(),
  ]);
  return { schedules, attendanceRecords };
}

function buildAttendanceSummary({ employees, schedules, recordMap, shiftMap }) {
  const employeeMap = buildEmployeeMap(employees);
  const summary = { scheduled: 0, attended: 0, absent: 0 };
  const results = [];
  const attendanceCounter = new Map();

  employees.forEach((emp) => {
    const id = normalizeId(emp._id);
    const base = { employee: id, name: emp.name ?? '', scheduled: 0, attended: 0, absent: 0 };
    attendanceCounter.set(id, base);
  });

  schedules.forEach((schedule) => {
    const employeeId = normalizeId(schedule.employee);
    const record = attendanceCounter.get(employeeId);
    if (!record) return;
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    // 休息日 / 例假 / 國定假日 / 請假 / 沒有工作時間的班別：不算應出勤，也就不會算缺勤
    if (!shift || isNonWorkShift(shift)) return;
    record.scheduled += 1;
    const dateKey = buildDateKey(schedule.date);
    const entry = recordMap.get(`${employeeId}::${dateKey}`);
    if (entry && entry.clockIns.length) {
      record.attended += 1;
    }
  });

  // Only include employees who have schedules
  attendanceCounter.forEach((record) => {
    if (record.scheduled > 0) {
      record.absent = Math.max(record.scheduled - record.attended, 0);
      summary.scheduled += record.scheduled;
      summary.attended += record.attended;
      summary.absent += record.absent;
      results.push(record);
    }
  });

  return { records: results, summary };
}

function buildTardinessSummary({ schedules, recordMap, shiftMap, employees, lateGrace }) {
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

function buildEarlyLeaveSummary({ schedules, recordMap, shiftMap, employees, earlyGrace }) {
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

function buildWorkHoursSummary({ schedules, recordMap, shiftMap, employees }) {
  const employeeMap = buildEmployeeMap(employees);
  const records = [];
  let totalScheduledMinutes = 0;
  let totalWorkedMinutes = 0;

  schedules.forEach((schedule) => {
    const employeeId = normalizeId(schedule.employee);
    const employee = employeeMap.get(employeeId);
    if (!employee) return;
    const dateKey = buildDateKey(schedule.date);
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    if (!shift || isNonWorkShift(shift)) return;
    const { start, end } = computeShiftTimes(schedule.date, shift);
    const breakMinutes = getShiftBreakMinutes(shift, schedule.date);
    const scheduledMinutes = Math.max(minutesBetween(start, end) - breakMinutes, 0);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    let workedMinutes = 0;
    
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
      
      if (last) {
        workedMinutes = Math.max(minutesBetween(first, last) - breakMinutes, 0);
      }
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
    const approvals = await ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
    })
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
    rows.forEach((row) => {
      if (!employeeMap.has(row.employeeId)) return;
      if (row.days) totalDays += row.days;
      records.push({
        approvalId: row.approvalId,
        employee: row.employeeId,
        name: employeeMap.get(row.employeeId).name ?? row.name ?? '',
        startDate: row.startDate,
        endDate: row.endDate,
        days: row.days,
      });
    });
    return {
      records,
      summary: {
        totalRequests: records.length,
        totalDays,
      },
    };
  }

  const configs = await resolveApprovalFormConfigs(type);
  if (!configs.length) {
    return { records: [], summary: {} };
  }
  // 每張符合的表單各查一次已核准的單，依各自的欄位 ID 取值，月份以單上的日期（台灣時間）為準
  const items = [];
  for (const config of configs) {
    const approvals = await ApprovalRequest.find({
      form: config.formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
    })
      .populate('applicant_employee', 'name')
      .lean();
    for (const approval of approvals || []) {
      const resolved = ensureEmployeeApproval(approval, employeeMap);
      if (!resolved) continue;
      const read = (key) => pickFieldValue(approval.form_data, config.fieldMap[key]);
      items.push({ approval, resolved, read });
    }
  }

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
  if (type === 'compTime') {
    let totalHours = 0;
    const records = [];
    for (const { approval, resolved, read } of items) {
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

export async function getDepartmentReportData({ type, month, departmentId, actor }) {
  if (!REPORT_NAME_MAP[type]) {
    throw new ReportAccessError(404, 'Unknown report type');
  }
  const { start, end } = parseMonthRange(month);
  const employees = await resolveDepartmentEmployees(departmentId, actor);
  const employeeIds = employees.map((emp) => normalizeId(emp._id)).filter(Boolean);
  if (!employeeIds.length) {
    throw new ReportAccessError(404, 'No data');
  }
  if (type === 'attendance' || type === 'tardiness' || type === 'earlyLeave' || type === 'workHours') {
    const [{ schedules, attendanceRecords }, { shiftMap, lateGrace, earlyGrace }] = await Promise.all([
      loadAttendanceData({ employeeIds, start, end }),
      buildAttendanceSettingContext(),
    ]);
    if (!schedules.length) {
      // Return empty data structure instead of throwing error
      return { summary: {}, records: [] };
    }
    const recordMap = groupAttendanceRecords(attendanceRecords);
    if (type === 'attendance') {
      return buildAttendanceSummary({ employees, schedules, recordMap, shiftMap });
    }
    if (type === 'tardiness') {
      const data = buildTardinessSummary({ schedules, recordMap, shiftMap, employees, lateGrace });
      if (!data.records.length) {
        // Return empty data structure instead of throwing error
        return { summary: { totalLateCount: 0, totalLateMinutes: 0, averageLateMinutes: 0 }, records: [] };
      }
      return data;
    }
    if (type === 'earlyLeave') {
      const data = buildEarlyLeaveSummary({ schedules, recordMap, shiftMap, employees, earlyGrace });
      if (!data.records.length) {
        // Return empty data structure instead of throwing error
        return { summary: { totalEarlyLeaveCount: 0, totalEarlyMinutes: 0, averageEarlyMinutes: 0 }, records: [] };
      }
      return data;
    }
    if (type === 'workHours') {
      const data = buildWorkHoursSummary({ schedules, recordMap, shiftMap, employees });
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
        summary: { totalLeaves: 0, totalDays: 0, byType: [] }
      };
    }
    const records = [];
    const typeSummary = new Map();
    let totalDays = 0;
    rows.forEach((row) => {
      totalDays += row.days;
      records.push({
        approvalId: row.approvalId,
        employee: row.employeeId,
        name: row.name,
        leaveType: row.leaveType,
        leaveCode: row.leaveCode,
        startDate: row.startDate,
        endDate: row.endDate,
        days: row.days,
      });
      const summaryEntry = typeSummary.get(row.leaveType) || { leaveType: row.leaveType, leaveCode: row.leaveCode, count: 0, days: 0 };
      summaryEntry.count += 1;
      summaryEntry.days += row.days;
      typeSummary.set(row.leaveType, summaryEntry);
    });
    return {
      records,
      summary: {
        totalLeaves: records.length,
        totalDays,
        byType: Array.from(typeSummary.values()),
      },
    };
  }

  if (type === 'specialLeave' || type === 'overtime' || type === 'compTime' || type === 'makeUp') {
    const data = await buildApprovalRecords({ type, employeeIds, start, end, employees });
    if (!data.records.length) {
      // Return empty data structure instead of throwing error
      return { summary: {}, records: [] };
    }
    return data;
  }

  // Log warning for unknown report types but return empty data to avoid breaking API
  console.warn(`Unknown report type requested: ${type}. Returning empty data.`);
  return { summary: {}, records: [] };
}

export function getReportDisplayName(type) {
  return REPORT_NAME_MAP[type] || '報表';
}

export const __testUtils = {
  computeShiftTimes,
  getShiftBreakMinutes,
  minutesBetween,
  buildAttendanceSummary,
  buildTardinessSummary,
  buildEarlyLeaveSummary,
  buildWorkHoursSummary,
};

