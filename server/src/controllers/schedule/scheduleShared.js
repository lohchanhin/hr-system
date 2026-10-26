import { isPayableNationalHoliday } from '../../services/countedHolidayService.js';
import ShiftSchedule from '../../models/ShiftSchedule.js';
import Employee from '../../models/Employee.js';
import AttendanceSetting from '../../models/AttendanceSetting.js';
import Department from '../../models/Department.js';
import {
  leaveDaysFromCalendar,
  loadApprovedLeaveCalendar,
  loadApprovedLeaveIntervals,
} from '../../services/approvedLeaveCalendarService.js';
import { buildRosterLeaveCheck } from '../../services/leaveCoverageService.js';
import { isLaborRuleValidationError } from '../../services/laborRuleValidationService.js';
import { normalizeShiftIdentifier } from '../../services/shiftIdentityService.js';
import {
  findDisallowedShiftAssignments,
  getScheduleAccess,
  getScheduleAccessForRequest,
  getScheduleAccessSummaryForRequest,
} from '../../services/scheduleAccessService.js';
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

/**
 * 看得到誰的班表（排班頁、相關簽核、國定假日休假紀錄、簽核單明細等共用）：管理員 null（全部）；
 * 其他人一律看得到自己，再加上排班權限的範圍（主管：自己與直屬部屬；排班人員：被指定小單位的所有員工），規則在 scheduleAccessService。
 */
export async function getAllowedScheduleEmployeeIds(req) {
  const actorId = toEntityId(req.user?.id);
  if (!actorId) return [];
  if (req.user?.role === 'admin') return null;
  if (!['employee', 'supervisor'].includes(req.user?.role)) return [];

  const access = await getScheduleAccessForRequest(req);
  return Array.from(new Set([actorId, ...(access?.employeeIds || [])]));
}

/**
 * 可以排（新增、修改、刪除、匯入）誰的班：管理員 null（全部）；有排班權限的人是自己的排班範圍；
 * 沒有排班權限是空陣列。和「看得到」不同：沒被指定的員工只看得到自己的班表，不能排自己的班。
 */
export async function getEditableScheduleEmployeeIds(req) {
  if (!toEntityId(req.user?.id)) return [];
  if (req.user?.role === 'admin') return null;
  const access = await getScheduleAccessForRequest(req);
  return access?.canSchedule ? access.employeeIds : [];
}

/**
 * 非管理員寫入班表前檢查小單位的「使用班別」：有不允許的班別就丟出 400（中文訊息附上單位名稱），管理員不限制。
 * entries：[{ employee, shiftId, subDepartment }]
 */
export async function assertShiftsAllowedForScope(req, entries) {
  if (req.user?.role === 'admin') return;
  const disallowed = await findDisallowedShiftAssignments(entries);
  if (!disallowed.length) return;
  const unitNames = Array.from(new Set(disallowed.map((item) => item.subDepartmentName).filter(Boolean)));
  const err = createError(
    `${unitNames.length ? `「${unitNames.join('、')}」` : '這個小單位'}沒有開放使用這個班別，請改選小單位設定的使用班別`,
    400,
  );
  err.code = 'SHIFT_NOT_ALLOWED';
  err.disallowed = disallowed.map(({ employee, shiftId, subDepartment }) => ({ employee, shiftId, subDepartment }));
  throw err;
}

export function respondShiftNotAllowed(res, err) {
  if (err?.code !== 'SHIFT_NOT_ALLOWED') return false;
  res.status(400).json({ error: err.message, code: err.code, disallowed: err.disallowed || [] });
  return true;
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
  const access = await getScheduleAccessSummaryForRequest(req);
  if (access?.isAdmin) return true;
  if (!access?.canSchedule) return false;
  // 被指定為這個小單位（或整個部門）的排班人員：小單位裡還沒有員工也可以管理
  if (subDepartment && access.subDepartmentIds.includes(String(subDepartment))) return true;
  if (!subDepartment && access.wholeDepartmentIds.includes(String(department))) return true;
  // 其他情況（主管範圍）：範圍內有員工在這個部門／單位（原本的規則）
  const allowedEmployeeIds = await getEditableScheduleEmployeeIds(req);
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
 * 班別設定 -> Map(班別 ID 字串, 班別)。找不到的班別 ID（或設定讀不到）不在表裡，
 * 排班判斷請假時就維持最嚴格的「當天有任何核准請假都不能排」。
 */
export async function loadShiftLookup() {
  const query = AttendanceSetting.findOne();
  const setting = query && typeof query.lean === 'function' ? await query.lean() : await query;
  return new Map((setting?.shifts || [])
    .filter((shift) => shift?._id)
    .map((shift) => [toEntityId(shift._id), shift]));
}

/**
 * loadApprovedLeaveIntervals 的結果 -> (員工 ID) => 排班用的請假檢查（buildRosterLeaveCheck，每位員工只建一次）。
 * 檢查的 blocks(日期, 班別) / reason(日期, 班別) 看核准請假是否擋住這個班別，規則與國定假日休假紀錄共用（leaveCoverageService）。
 */
export function buildRosterLeaveChecks(intervalsByEmployee) {
  const checks = new Map();
  return (employeeId) => {
    const id = toEntityId(employeeId);
    if (!checks.has(id)) checks.set(id, buildRosterLeaveCheck(intervalsByEmployee?.get?.(id)));
    return checks.get(id);
  };
}

/**
 * 該日的核准請假是否擋住這個班別而不能排班。
 * 傳入 shift：不用上班的班別（休息日／例假／國定假日／請假）不擋；上班班別只有在核准的整天請假、
 * 或有時分的請假涵蓋整個班次時才擋，只請幾小時的假不擋（與國定假日休假紀錄同一個判斷）。
 * 沒傳 shift 維持原本「當天有任何核准請假都衝突」。
 * 選項 strictNonWork（手動新增、修改排班用）：不用上班的班別遇到整天都在請假中的日子仍然擋（原本的行為，匯入不擋）。
 */
export async function hasLeaveConflict(employeeId, date, shift = null, { strictNonWork = false } = {}) {
  if (shift && isNonWorkShift(shift) && !strictNonWork) return false;
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return false;
  day.setUTCHours(0, 0, 0, 0);
  const end = new Date(day.getTime() + 86400000);
  if (!shift) {
    const calendar = await loadApprovedLeaveCalendar({ employeeIds: [employeeId], start: day, end });
    return (calendar.get(toEntityId(employeeId))?.size || 0) > 0;
  }
  const intervals = await loadApprovedLeaveIntervals({ employeeIds: [employeeId], start: day, end });
  return buildRosterLeaveChecks(intervals)(employeeId).blocks(day.toISOString().slice(0, 10), shift, { strictNonWork });
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

/**
 * 發布、完成發布、排班檢核的員工範圍：管理員 null（全部）；有排班權限的人是排班範圍，
 * 主管沒勾「包含自己」時不含自己（原本的規則）；沒有排班權限是空陣列。
 */
export async function resolveScopedEmployeeIds(user, { includeSelf = false } = {}) {
  if (!user) throw new Error('unauthorized');
  const { role, id } = user;
  if (['admin'].includes(role)) {
    return null;
  }
  const access = await getScheduleAccess(user);
  if (!access.canSchedule) return [];
  const actorId = String(id);
  return role === 'supervisor' && !includeSelf
    ? access.employeeIds.filter((employeeId) => employeeId !== actorId)
    : [...access.employeeIds];
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

// 跨月週還無法判斷的項目（不算違規）整理成回給前端的樣子：員工 id 轉字串、date 用該週的週一，與 violations 同一種形狀
export function formatPendingWeeks(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    employee: toEntityId(item.employee),
    date: item.weekStart || null,
  }));
}

// 檢核結果的每一項（違規、跨月週待判斷）附上員工代號與姓名：畫面只載入一頁員工，不在那一頁的員工也要能直接看到是誰。
// 名字只是顯示用，查不到或查詢失敗都不影響檢核結果。
export async function attachEmployeeLabels(items) {
  const list = Array.isArray(items) ? items : [];
  const ids = [...new Set(list.map((item) => toEntityId(item.employee)))].filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
  if (!ids.length) return list;
  try {
    const query = Employee.find({ _id: { $in: ids } }).select('_id employeeId name');
    const rows = query && typeof query.lean === 'function' ? await query.lean() : await query;
    const byId = new Map((rows || []).map((row) => [toEntityId(row._id), row]));
    return list.map((item) => {
      const row = byId.get(toEntityId(item.employee));
      return row ? { ...item, employeeCode: row.employeeId || '', employeeName: row.name || '' } : item;
    });
  } catch {
    return list;
  }
}

// 跨月週待判斷的項目：整理成回給前端的樣子，再附上員工代號與姓名
export async function describePendingWeeks(items) {
  return attachEmployeeLabels(formatPendingWeeks(items));
}

export function respondLaborRuleError(res, err) {
  if (!isLaborRuleValidationError(err)) return false;
  const pendingWeeks = formatPendingWeeks(err.pendingWeeks);
  res.status(err.status || 400).json({
    error: err.message,
    violations: err.violations || [],
    ...(pendingWeeks.length ? { pendingWeeks } : {}),
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
    .populate({ path: 'employee', select: 'name title photo' })
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
    const employeePhoto = employeeDoc?.photo || '';

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
        photo: employeePhoto,
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
                  photo: emp.photo,
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

