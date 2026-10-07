import { isPayableNationalHoliday } from '../../services/countedHolidayService.js';
import ShiftSchedule from '../../models/ShiftSchedule.js';
import Employee from '../../models/Employee.js';
import AttendanceSetting from '../../models/AttendanceSetting.js';
import Department from '../../models/Department.js';
import { leaveDaysFromCalendar, loadApprovedLeaveCalendar } from '../../services/approvedLeaveCalendarService.js';
import { isLaborRuleValidationError } from '../../services/laborRuleValidationService.js';
import { normalizeShiftIdentifier } from '../../services/shiftIdentityService.js';
import {
  inferLegacyShiftSemanticType,
  isNonWorkSemanticType,
  isNonWorkShift,
  LEAVE_SHIFT_CODES,
  LEAVE_SHIFT_NAMES,
  resolveShiftSemanticType,
} from '../../services/shiftSemanticService.js';

export const SCHEDULE_EMPLOYEE_SELECT = 'name employeeId photo title practiceTitle department subDepartment supervisor role status';
export function toEntityId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) {
    return toEntityId(value._id);
  }
  return typeof value.toString === 'function' ? value.toString() : String(value);
}

export async function getAllowedScheduleEmployeeIds(req) {
  const actorId = toEntityId(req.user?.id);
  if (!actorId) return [];
  if (req.user?.role === 'admin') return null;
  if (req.user?.role === 'employee') return [actorId];
  if (req.user?.role !== 'supervisor') return [];

  const query = Employee.find({ supervisor: actorId }).select('_id');
  const directReports = typeof query.lean === 'function' ? await query.lean() : await query;
  return Array.from(new Set([
    actorId,
    ...(directReports || []).map((employee) => toEntityId(employee?._id)).filter(Boolean),
  ]));
}

export function formatDate(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

export async function attachShiftInfo(schedules) {
  const setting = await AttendanceSetting.findOne().lean();
  const map = {};
  const codeMap = {};
  setting?.shifts?.forEach((s) => {
    map[s._id.toString()] = s.name;
    codeMap[s._id.toString()] = s.code || '';
  });
  return schedules.map((s) => ({
    ...s,
    date: formatDate(s.date),
    shiftName: map[s.shiftId?.toString()] || '',
    shiftCode: codeMap[s.shiftId?.toString()] || '',
  }));
}

export async function buildLeaveDaysMapForMonth(employeeIds, month, monthStartDate, monthEndDate) {
  const calendar = await loadApprovedLeaveCalendar({
    employeeIds,
    start: monthStartDate,
    end: monthEndDate,
  });
  return new Map(employeeIds.map((employeeId) => [
    toEntityId(employeeId),
    leaveDaysFromCalendar(calendar, employeeId, '/'),
  ]));
}

export async function canManageScheduleScope(req, department, subDepartment = '') {
  const allowedEmployeeIds = await getAllowedScheduleEmployeeIds(req);
  if (allowedEmployeeIds === null) return true;
  if (!allowedEmployeeIds.length) return false;

  const query = { _id: { $in: allowedEmployeeIds }, department };
  if (subDepartment) query.subDepartment = subDepartment;
  const employeeQuery = Employee.find(query).select('_id');
  const matchingEmployees = employeeQuery && typeof employeeQuery.lean === 'function'
    ? await employeeQuery.lean()
    : await employeeQuery;
  return Array.isArray(matchingEmployees) && matchingEmployees.length > 0;
}

export function normalizeScheduleMemoDate(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return null;
  return date;
}

/**
 * 該日是否已有核准請假而不能再排班。
 * 傳入 shift 且它不用上班（休息日／例假／國定假日／請假）時，不算衝突；沒傳 shift 維持原本「任何排班都衝突」。
 */
export async function hasLeaveConflict(employeeId, date, shift = null) {
  if (shift && isNonWorkShift(shift)) return false;
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return false;
  day.setUTCHours(0, 0, 0, 0);
  const end = new Date(day.getTime() + 86400000);
  const calendar = await loadApprovedLeaveCalendar({ employeeIds: [employeeId], start: day, end });
  return (calendar.get(toEntityId(employeeId))?.size || 0) > 0;
}

export function buildMonthDays(startDate) {
  const start = new Date(startDate);
  start.setUTCHours(0, 0, 0, 0);
  const days = [];
  const pointer = new Date(start);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  while (pointer < end) {
    days.push(pointer.toISOString().slice(0, 10));
    pointer.setUTCDate(pointer.getUTCDate() + 1);
  }
  return days;
}

export function buildMonthRange(month) {
  if (!month) throw new Error('month required');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('invalid month format');
  }
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error('invalid month');
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export function normalizeScheduleField(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value) {
    if (value._id) return value._id.toString();
    if (value.id) return value.id.toString();
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      return value.toString();
    }
  }
  if (value === null || value === undefined) return '';
  return value.toString();
}

export function resetScheduleProgress(doc) {
  doc.state = 'draft';
  doc.publishedAt = null;
  doc.employeeResponse = 'pending';
  doc.responseNote = '';
  doc.responseAt = null;
  doc.needsReconfirm = true;
}

export function hasScheduleDiff(existing, nextData) {
  const fields = ['employee', 'date', 'shiftId', 'department', 'subDepartment'];
  return fields.some((field) => {
    const prev = normalizeScheduleField(existing[field]);
    const next = normalizeScheduleField(nextData[field]);
    return prev !== next;
  });
}

export async function resolveScopedEmployeeIds(user, { includeSelf = false } = {}) {
  if (!user) throw new Error('unauthorized');
  const { role, id } = user;
  if (['admin'].includes(role)) {
    return null;
  }
  if (role === 'supervisor') {
    const list = await Employee.find({ supervisor: id }).select('_id');
    const ids = list.map((e) => e._id.toString());
    if (includeSelf && id) ids.push(String(id));
    return ids;
  }
  if (role === 'employee' && id) {
    return [String(id)];
  }
  return [];
}

export function normalizeId(value) {
  if (!value && value !== 0) return '';
  if (typeof value === 'object') {
    if (value._id) return value._id.toString();
    if (value.id) return value.id.toString();
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      return value.toString();
    }
  }
  return String(value);
}

export function normalizeOptionalId(value) {
  const normalized = normalizeId(value).trim();
  return normalized || undefined;
}

export function respondLaborRuleError(res, err) {
  if (!isLaborRuleValidationError(err)) return false;
  res.status(err.status || 400).json({
    error: err.message,
    violations: err.violations || [],
  });
  return true;
}

export function buildScheduleConflictDetails({ employee, date, shiftId, existing }) {
  return {
    employee: normalizeId(employee),
    date: date instanceof Date ? date.toISOString() : new Date(date).toISOString(),
    existingScheduleId: normalizeId(existing?._id),
    existingShiftId: normalizeId(existing?.shiftId),
    requestedShiftId: normalizeId(shiftId),
  };
}
export async function buildScheduleOverview({ month, organizationId, departmentId, subDepartmentId }) {
  if (!month) throw new Error('month required');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('invalid month format');
  }

  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const days = buildMonthDays(start);
  const query = {
    date: { $gte: start, $lt: end },
  };

  // === 篩選條件維持原本邏輯 ===
  if (subDepartmentId) {
    query.subDepartment = subDepartmentId;
  }

  if (departmentId) {
    query.department = departmentId;
  }

  if (organizationId) {
    const deptDocs = await Department.find({ organization: organizationId })
      .select('_id organization name')
      .lean();
    const allowedIds = deptDocs.map((dept) => dept._id.toString());
    if (!allowedIds.length) {
      return { month, days, organizations: [] };
    }
    if (!departmentId) {
      query.department = { $in: allowedIds };
    } else if (!allowedIds.includes(String(departmentId))) {
      return { month, days, organizations: [] };
    }
  }

  const attendanceSetting = await AttendanceSetting.findOne().lean();
  const shiftNameMap = {};
  attendanceSetting?.shifts?.forEach((shift) => {
    if (shift?._id) {
      shiftNameMap[shift._id.toString()] = shift.name || '';
    }
  });

  const rawSchedules = await ShiftSchedule.find(query)
    .select('employee date shiftId department subDepartment')
    .populate({
      path: 'department',
      select: 'name organization',
      populate: { path: 'organization', select: 'name' },
    })
    .populate('subDepartment', 'name')
    .populate({ path: 'employee', select: 'name title' })
    .lean();

  const organizationMap = new Map();

  rawSchedules.forEach((schedule) => {
    // ⭐ 先取得員工，如果沒有員工，這筆就直接略過，不回傳到前端
    const employeeDoc = schedule.employee || null;
    const employeeId =
      employeeDoc?._id?.toString?.() ||
      (typeof schedule.employee === 'string'
        ? schedule.employee
        : schedule.employee?.toString?.());
    if (!employeeId) {
      // 沒有實際員工（例如用來標示全體休假之類），總覽頁不要顯示
      return;
    }

    const department = schedule.department || null;
    const organization = department?.organization || null;
    const subDepartment = schedule.subDepartment || null;

    const organizationKey = normalizeId(organization?._id) || 'unassigned';
    const departmentKey = normalizeId(department?._id) || 'unassigned';

    const orgName = organization?.name || '未指定機構';
    const deptName = department?.name || '未指定部門';

    // ⭐ 同一個「部門 + 小單位名稱」視為同一個小單位，避免 A 被拆兩塊
    const subDepartmentName = subDepartment?.name || '未指定單位';
    const subDepartmentKey = `${departmentKey}::${subDepartmentName}`;

    const employeeKey = employeeId;
    const employeeName = employeeDoc?.name || '未指定員工';
    const employeeTitle = employeeDoc?.title || '';

    if (!organizationMap.has(organizationKey)) {
      organizationMap.set(organizationKey, {
        id: organizationKey,
        name: orgName,
        departments: new Map(),
      });
    }

    const organizationEntry = organizationMap.get(organizationKey);
    if (!organizationEntry.departments.has(departmentKey)) {
      organizationEntry.departments.set(departmentKey, {
        id: departmentKey,
        name: deptName,
        subDepartments: new Map(),
      });
    }

    const departmentEntry = organizationEntry.departments.get(departmentKey);
    if (!departmentEntry.subDepartments.has(subDepartmentKey)) {
      departmentEntry.subDepartments.set(subDepartmentKey, {
        id: subDepartmentKey, // 邏輯 key（部門 + 小單位名稱）
        name: subDepartmentName,
        sourceSubDepartmentIds: new Set(), // 有需要除錯時可以看到有哪些真實 _id
        employees: new Map(),
      });
    }

    const subDepartmentEntry = departmentEntry.subDepartments.get(subDepartmentKey);
    if (subDepartment?._id) {
      subDepartmentEntry.sourceSubDepartmentIds.add(subDepartment._id.toString());
    }

    if (!subDepartmentEntry.employees.has(employeeKey)) {
      subDepartmentEntry.employees.set(employeeKey, {
        id: employeeKey,
        name: employeeName,
        title: employeeTitle,
        schedules: [],
      });
    }

    const entry = subDepartmentEntry.employees.get(employeeKey);
    const shiftId = normalizeId(schedule.shiftId);
    const scheduleDate =
      schedule.date instanceof Date
        ? schedule.date.toISOString().slice(0, 10)
        : new Date(schedule.date).toISOString().slice(0, 10);

    entry.schedules.push({
      date: scheduleDate,
      shiftId,
      shiftName: shiftNameMap[shiftId] || schedule.shiftName || '',
    });
  });

  const organizations = Array.from(organizationMap.values())
    .map((org) => ({
      id: org.id,
      name: org.name,
      departments: Array.from(org.departments.values())
        .map((dept) => ({
          id: dept.id,
          name: dept.name,
          subDepartments: Array.from(dept.subDepartments.values())
            .map((sub) => ({
              id: sub.id,
              name: sub.name,
              sourceSubDepartmentIds: Array.from(sub.sourceSubDepartmentIds || []),
              employees: Array.from(sub.employees.values())
                .map((emp) => ({
                  id: emp.id,
                  name: emp.name,
                  title: emp.title,
                  schedules: emp.schedules.sort((a, b) => a.date.localeCompare(b.date)),
                }))
                .sort((a, b) =>
                  a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }),
                ),
            }))
            .sort((a, b) =>
              a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }),
            ),
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }),
        ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { sensitivity: 'base' }));

  return { month, days, organizations };
}
export function buildPublishQuery({ start, end }, { department, subDepartment }) {
  const query = {
    date: { $gte: start, $lt: end },
    state: { $ne: 'finalized' },
    needsReconfirm: true,
  };
  if (department) query.department = department;
  if (subDepartment) query.subDepartment = subDepartment;
  return query;
}

export function summarizeEmployees(docs) {
  const map = new Map();
  docs.forEach((doc) => {
    const emp = doc.employee || {};
    const id = emp?._id?.toString?.() || doc.employee?.toString?.();
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: emp.name || '',
        response: doc.employeeResponse || 'pending',
        state: doc.state || 'draft',
      });
    }
  });
  return Array.from(map.values());
}

export function normalizeResponsePayload(response) {
  const value = String(response || '').trim().toLowerCase();
  if (!value) return '';
  return value;
}

export function sanitizeNote(note) {
  if (typeof note !== 'string') return '';
  const trimmed = note.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 1000);
}

export const CONFIRM_RESPONSES = new Set([
  'confirm',
  'confirmed',
  'approve',
  'approved',
  'accept',
  'accepted',
  'ok',
  'okay',
  'yes',
]);

export const DISPUTE_RESPONSES = new Set([
  'dispute',
  'disputed',
  'reject',
  'rejected',
  'no',
  'object',
  'objection',
  'issue',
]);

export function createError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function isTransactionNotSupportedError(err) {
  if (!err) return false;
  const { code, codeName } = err;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (message.includes('transaction numbers are only allowed')) {
    return true;
  }
  if (typeof code === 'number') {
    const unsupportedCodes = new Set([20, 303, 305]);
    if (unsupportedCodes.has(code)) {
      return true;
    }
  }
  if (typeof codeName === 'string') {
    const normalized = codeName.toLowerCase();
    if (['noreplicationenabled', 'notenoughreplicasetmembers', 'notprimary'].includes(normalized)) {
      return true;
    }
  }
  return false;
}

export function applyEmployeeResponse(schedule, normalized, noteValue, now = new Date()) {
  if (!schedule) throw createError('schedule not found', 404);
  if (schedule.state === 'finalized') {
    throw createError('schedule finalized');
  }
  if (schedule.state !== 'pending_confirmation') {
    throw createError('schedule not awaiting confirmation');
  }

  if (CONFIRM_RESPONSES.has(normalized)) {
    schedule.employeeResponse = 'confirmed';
    schedule.state = 'pending_confirmation';
    schedule.responseNote = '';
    schedule.responseAt = now;
    return schedule;
  }

  if (DISPUTE_RESPONSES.has(normalized)) {
    if (!noteValue) {
      throw createError('objection note required');
    }
    schedule.employeeResponse = 'disputed';
    schedule.state = 'changes_requested';
    schedule.responseNote = noteValue;
    schedule.responseAt = now;
    return schedule;
  }

  throw createError('invalid response');
}

// 公版班表的國定假日標記。班別設定裡有定義就照一般班別存成班表；沒定義才只當核對用途略過。
export const IMPORT_HOLIDAY_CODES = new Set(['國', '国', '國定假日', '国定假日']);

// 請假代碼／名稱：直接用 shiftSemanticService 推論班別性質時的同一份清單，兩邊不會不同步。
// 班別設定裡有定義就照一般班別存成班表；沒定義才只當核對用途略過。
export const IMPORT_LEAVE_CODES = new Set(
  [...LEAVE_SHIFT_CODES, ...LEAVE_SHIFT_NAMES].map((code) => normalizeShiftIdentifier(code)),
);

export function normalizeWorkbookCode(value) {
  return normalizeShiftIdentifier(value);
}

/**
 * 匯入時判斷班別屬於哪一類：work / rest_day / regular_rest / holiday / leave。
 * 沒有工作時間卻被標成 work 的班別（00:00-00:00）依代號名稱推論，推論不出來就當請假，絕不當成上班。
 */
export function resolveImportShiftKind(shift) {
  const semantic = resolveShiftSemanticType(shift);
  if (isNonWorkSemanticType(semantic)) return semantic;
  if (!isNonWorkShift(shift)) return 'work';
  const inferred = inferLegacyShiftSemanticType(shift);
  return isNonWorkSemanticType(inferred) ? inferred : 'leave';
}

/** 與 laborRuleValidationService 的國定假日判斷一致：工作日／補班日不算，其餘國定假日／假日算。 */
export function isCountedHolidayRecord(holiday) {
  return isPayableNationalHoliday(holiday);
}

export function scheduleImportError(row, day, code, message) {
  return { row, day, code, message };
}

