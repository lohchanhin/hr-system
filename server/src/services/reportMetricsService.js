import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import ApprovalRequest from '../models/approval_request.js';
import FormTemplate from '../models/form_template.js';
import FormField from '../models/form_field.js';
import { getLeaveFieldIds } from './leaveFieldService.js';

export class ReportAccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const APPROVAL_FORM_CONFIGS = {
  overtime: {
    templateNames: ['加班', '加班申請', '加班單'],
    fields: {
      date: ['加班日期', '日期'],
      startTime: ['開始時間', '加班開始', '開始時刻'],
      endTime: ['結束時間', '加班結束', '結束時刻'],
      hours: ['加班時數', '時數', '時長'],
      reason: ['加班原因', '原因', '說明'],
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
    templateNames: ['補打卡', '補打卡申請', '補卡'],
    fields: {
      date: ['補卡日期', '日期'],
      category: ['補卡類別', '類別', '類型'],
      note: ['補卡說明', '說明', '原因'],
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
  if (shift.crossDay || end <= start) {
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
  const [schedules, attendanceRecords] = await Promise.all([
    ShiftSchedule.find({
      employee: { $in: employeeIds },
      date: { $gte: start, $lt: end },
    })
      .lean()
      .exec(),
    AttendanceRecord.find({
      employee: { $in: employeeIds },
      timestamp: { $gte: start, $lt: end },
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
    results.push(base);
  });

  schedules.forEach((schedule) => {
    const employeeId = normalizeId(schedule.employee);
    const record = attendanceCounter.get(employeeId);
    if (!record) return;
    record.scheduled += 1;
    const dateKey = buildDateKey(schedule.date);
    const entry = recordMap.get(`${employeeId}::${dateKey}`);
    if (entry && entry.clockIns.length) {
      record.attended += 1;
    }
  });

  results.forEach((record) => {
    record.absent = Math.max(record.scheduled - record.attended, 0);
    summary.scheduled += record.scheduled;
    summary.attended += record.attended;
    summary.absent += record.absent;
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
    if (!shift) return;
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
    if (!shift) return;
    const { end } = computeShiftTimes(schedule.date, shift);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    if (!dayRecord || !dayRecord.clockOuts.length) return;
    const lastClockOut = dayRecord.clockOuts[dayRecord.clockOuts.length - 1];
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
    if (!shift) return;
    const { start, end } = computeShiftTimes(schedule.date, shift);
    const breakMinutes = getShiftBreakMinutes(shift, schedule.date);
    const scheduledMinutes = Math.max(minutesBetween(start, end) - breakMinutes, 0);
    const dayRecord = recordMap.get(`${employeeId}::${dateKey}`);
    let workedMinutes = 0;
    if (dayRecord && dayRecord.clockIns.length && dayRecord.clockOuts.length) {
      const first = dayRecord.clockIns[0];
      const last = dayRecord.clockOuts[dayRecord.clockOuts.length - 1];
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

async function resolveApprovalFormConfig(type) {
  const config = APPROVAL_FORM_CONFIGS[type];
  if (!config) return null;
  const form = await FormTemplate.findOne({ name: { $in: config.templateNames } }).lean();
  if (!form) return null;
  const fields = await FormField.find({ form: form._id }).lean();
  const fieldMap = {};
  Object.entries(config.fields).forEach(([key, labels]) => {
    const match = fields.find((field) => labels.includes(field.label));
    fieldMap[key] = match ? normalizeId(match._id) : '';
  });
  return { formId: normalizeId(form._id), fieldMap };
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

async function buildApprovalRecords({
  type,
  employeeIds,
  start,
  end,
  employees,
}) {
  if (type === 'specialLeave') {
    const { formId, startId, endId, typeId, typeOptions } = await getLeaveFieldIds();
    if (!formId) return { records: [], summary: {} };
    const approvals = await ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
      createdAt: { $gte: start, $lt: end },
    })
      .populate('applicant_employee', 'name')
      .lean();
    const typeMap = new Map(typeOptions?.map((opt) => [String(opt.value), opt.label]));
    const employeeMap = buildEmployeeMap(employees);
    const records = [];
    let totalDays = 0;
    approvals.forEach((approval) => {
      const resolved = ensureEmployeeApproval(approval, employeeMap);
      if (!resolved) return;
      const typeValue = typeId ? approval.form_data?.[typeId] : undefined;
      const typeCode = typeValue ? String(typeValue.code ?? typeValue.value ?? typeValue) : '';
      const labelCandidate = typeValue?.label ?? typeMap.get(typeCode) ?? typeCode;
      const normalizedLabel = labelCandidate ? String(labelCandidate) : '';
      if (normalizedLabel !== '特休') return;
      const startValue = startId ? approval.form_data?.[startId] : undefined;
      const endValue = endId ? approval.form_data?.[endId] : undefined;
      const days = Math.max(parseNumber(approval.form_data?.days ?? approval.form_data?.duration ?? 0), 0);
      if (days) totalDays += days;
      records.push({
        approvalId: normalizeId(approval._id),
        employee: resolved.employeeId,
        name: resolved.employee.name ?? '',
        startDate: formatDate(startValue),
        endDate: formatDate(endValue),
        days,
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

  const config = await resolveApprovalFormConfig(type);
  if (!config?.formId) {
    return { records: [], summary: {} };
  }
  const approvals = await ApprovalRequest.find({
    form: config.formId,
    status: 'approved',
    applicant_employee: { $in: employeeIds },
    createdAt: { $gte: start, $lt: end },
  })
    .populate('applicant_employee', 'name')
    .lean();
  const employeeMap = buildEmployeeMap(employees);
  if (type === 'overtime') {
    let totalHours = 0;
    const records = approvals
      .map((approval) => {
        const resolved = ensureEmployeeApproval(approval, employeeMap);
        if (!resolved) return null;
        const { employee, employeeId } = resolved;
        const hours = parseNumber(approval.form_data?.[config.fieldMap.hours]);
        totalHours += hours;
        return {
          approvalId: normalizeId(approval._id),
          employee: employeeId,
          name: employee.name ?? '',
          date: formatDate(approval.form_data?.[config.fieldMap.date] ?? approval.createdAt),
          startTime: formatTime(approval.form_data?.[config.fieldMap.startTime]),
          endTime: formatTime(approval.form_data?.[config.fieldMap.endTime]),
          hours,
          reason: approval.form_data?.[config.fieldMap.reason] ?? '',
        };
      })
      .filter(Boolean);
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
    const records = approvals
      .map((approval) => {
        const resolved = ensureEmployeeApproval(approval, employeeMap);
        if (!resolved) return null;
        const { employee, employeeId } = resolved;
        const hours = parseNumber(approval.form_data?.[config.fieldMap.hours]);
        totalHours += hours;
        return {
          approvalId: normalizeId(approval._id),
          employee: employeeId,
          name: employee.name ?? '',
          date: formatDate(approval.form_data?.[config.fieldMap.date] ?? approval.createdAt),
          hours,
          overtimeReference: approval.form_data?.[config.fieldMap.reference] ?? '',
        };
      })
      .filter(Boolean);
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
    const records = approvals
      .map((approval) => {
        const resolved = ensureEmployeeApproval(approval, employeeMap);
        if (!resolved) return null;
        const { employee, employeeId } = resolved;
        const category = approval.form_data?.[config.fieldMap.category] ?? '';
        const normalizedCategory = category ? String(category) : '未分類';
        const count = categoryMap.get(normalizedCategory) ?? 0;
        categoryMap.set(normalizedCategory, count + 1);
        return {
          approvalId: normalizeId(approval._id),
          employee: employeeId,
          name: employee.name ?? '',
          date: formatDate(approval.form_data?.[config.fieldMap.date] ?? approval.createdAt),
          category: normalizedCategory,
          note: approval.form_data?.[config.fieldMap.note] ?? '',
        };
      })
      .filter(Boolean);
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
    const { formId, startId, endId, typeId, typeOptions } = await getLeaveFieldIds();
    if (!formId) {
      // Return empty data structure if leave form is not configured
      return {
        records: [],
        summary: { totalLeaves: 0, totalDays: 0, byType: [] }
      };
    }
    const approvals = await ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
      createdAt: { $gte: start, $lt: end },
    })
      .populate('applicant_employee', 'name')
      .lean();
    if (!approvals.length) {
      // Return empty data structure instead of throwing error
      return {
        records: [],
        summary: { totalLeaves: 0, totalDays: 0, byType: [] }
      };
    }
    const typeMap = new Map(typeOptions?.map((opt) => [String(opt.value), opt.label]));
    const records = [];
    const typeSummary = new Map();
    let totalDays = 0;
    approvals.forEach((approval) => {
      const employee = approval.applicant_employee;
      if (!employee) return;
      const startValue = startId ? approval.form_data?.[startId] : undefined;
      const endValue = endId ? approval.form_data?.[endId] : undefined;
      const typeValue = typeId ? approval.form_data?.[typeId] : undefined;
      const typeCode = typeValue?.code ?? typeValue?.value ?? typeValue ?? '';
      const code = typeCode ? String(typeCode) : '';
      const labelCandidate = typeValue?.label ?? typeMap.get(code) ?? code;
      const label = labelCandidate ? String(labelCandidate) : code;
      const days = Math.max(parseNumber(approval.form_data?.days ?? approval.form_data?.duration ?? 0), 0);
      totalDays += days;
      records.push({
        approvalId: normalizeId(approval._id),
        employee: normalizeId(employee._id ?? employee),
        name: employee.name ?? '',
        leaveType: label,
        leaveCode: code,
        startDate: formatDate(startValue),
        endDate: formatDate(endValue),
        days,
      });
      const summaryEntry = typeSummary.get(label) || { leaveType: label, leaveCode: code, count: 0, days: 0 };
      summaryEntry.count += 1;
      summaryEntry.days += days;
      typeSummary.set(label, summaryEntry);
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
  buildWorkHoursSummary,
};

