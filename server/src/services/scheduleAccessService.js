import Employee from '../models/Employee.js';
import Department from '../models/Department.js';
import SubDepartment from '../models/SubDepartment.js';
import OtherControlSetting from '../models/OtherControlSetting.js';
import * as settingsStore from './otherControlSettingsStore.js';

/*
 * 排班權限：誰可以開排班頁、可以排誰的班（說明見 docs/scheduler-access.md）。
 * 1. 管理員：全部。
 * 2. 主管：自己與直屬部屬（原本的規則）。其他控制設定 scheduleAccessMode 設成 'scheduler_only' 時，主管不再因為是主管而能排班。
 * 3. 排班人員：小單位設定的「排班人員」（任何角色都可以），範圍是那些小單位的所有員工；
 *    部門的「排班管理者」（舊欄位 deptManager）視為整個部門（所有小單位與沒有小單位的員工）的排班人員。
 * 範圍取聯集。主管欄位不受影響，仍然只作為簽核使用。
 */

export const SCHEDULE_ACCESS_MODES = Object.freeze(['supervisor_and_scheduler', 'scheduler_only']);
export const DEFAULT_SCHEDULE_ACCESS_MODE = 'supervisor_and_scheduler';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

function toId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) return toId(value._id);
  return typeof value.toString === 'function' ? value.toString() : String(value);
}

function uniqueIds(values) {
  return Array.from(new Set((values || []).map(toId).filter(Boolean)));
}

async function runLean(query) {
  const rows = query && typeof query.lean === 'function' ? await query.lean() : await query;
  return Array.isArray(rows) ? rows : [];
}

/*
 * 這個 model 現在能不能查：沒有這個方法（只模擬部分 model 的測試）不查；
 * 資料庫還沒連線時 mongoose 會把查詢排隊等連線（最久 10 秒），也不查，
 * 這時當作沒有排班人員指派、排班權限模式用預設值，也就是維持原本「主管看直屬部屬」的規則。
 */
function canQuery(model, method) {
  if (typeof model?.[method] !== 'function') return false;
  const state = model.db?.readyState;
  return state === undefined || state === 1;
}

/** 其他控制設定裡沒有存過、或存了看不懂的值，都當成預設（主管與排班人員都能排班，與原本相同） */
export function normalizeScheduleAccessMode(value) {
  return value === 'scheduler_only' ? 'scheduler_only' : DEFAULT_SCHEDULE_ACCESS_MODE;
}

export async function getScheduleAccessMode() {
  if (typeof settingsStore.getSettings !== 'function' || !canQuery(OtherControlSetting, 'findOne')) {
    return DEFAULT_SCHEDULE_ACCESS_MODE;
  }
  const settings = await settingsStore.getSettings();
  return normalizeScheduleAccessMode(settings?.scheduleAccessMode);
}

export class ScheduleAccessSettingError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export async function setScheduleAccessMode(mode) {
  if (!SCHEDULE_ACCESS_MODES.includes(mode)) {
    throw new ScheduleAccessSettingError('排班權限模式只能是 supervisor_and_scheduler 或 scheduler_only');
  }
  if (typeof settingsStore.updateSettings !== 'function') {
    throw new Error('其他控制設定無法儲存');
  }
  const settings = await settingsStore.updateSettings((current) => {
    current.scheduleAccessMode = mode;
  });
  return normalizeScheduleAccessMode(settings?.scheduleAccessMode);
}

/**
 * 這位員工被指定為排班人員的範圍：
 * - subDepartmentIds：指定的小單位，加上「排班管理者」部門底下的所有小單位
 * - wholeDepartmentIds：擔任「排班管理者」的部門（整個部門，含沒有小單位的員工）
 * - departmentIds：上面兩者涉及的所有部門（排班頁的部門篩選用）
 */
export async function findSchedulerAssignments(employeeId) {
  const id = toId(employeeId);
  const empty = { subDepartmentIds: [], wholeDepartmentIds: [], departmentIds: [] };
  if (!OBJECT_ID_PATTERN.test(id)) return empty;
  const unitsQueryable = canQuery(SubDepartment, 'find');

  const [units, managedDepartments] = await Promise.all([
    unitsQueryable ? runLean(SubDepartment.find({ schedulers: id }).select('_id department')) : [],
    canQuery(Department, 'find') ? runLean(Department.find({ deptManager: id }).select('_id')) : [],
  ]);
  const wholeDepartmentIds = uniqueIds(managedDepartments.map((dept) => dept._id));
  const departmentUnits = wholeDepartmentIds.length && unitsQueryable
    ? await runLean(SubDepartment.find({ department: { $in: wholeDepartmentIds } }).select('_id department'))
    : [];
  return {
    subDepartmentIds: uniqueIds([...units, ...departmentUnits].map((unit) => unit._id)),
    wholeDepartmentIds,
    departmentIds: uniqueIds([...wholeDepartmentIds, ...units.map((unit) => unit.department)]),
  };
}

/**
 * 登入者的排班權限：
 * { canSchedule, mode, supervisorScope, subDepartmentIds, departmentIds, wholeDepartmentIds, employeeIds, isAdmin }
 * - employeeIds：可以排的員工（主管範圍「自己 + 直屬部屬」與排班人員範圍的聯集）；管理員是全部，這裡留空陣列，請看 isAdmin
 * - subDepartmentIds／departmentIds／wholeDepartmentIds：只列排班人員的指派（主管範圍不列在這裡）
 * - mode：只有主管需要讀設定，其他角色是 null
 */
export async function getScheduleAccess(user, summary = null) {
  const resolved = summary || await getScheduleAccessSummary(user);
  if (resolved.isAdmin || !resolved.canSchedule) return { ...resolved, employeeIds: [] };
  const id = toId(user?.id ?? user?._id);

  const supervisorIds = [];
  if (resolved.supervisorScope) {
    const reports = await runLean(Employee.find({ supervisor: id }).select('_id'));
    supervisorIds.push(id, ...reports.map((employee) => employee._id));
  }
  const unitFilters = schedulerEmployeeFilters(resolved);
  const unitEmployees = unitFilters.length
    ? await runLean(Employee.find(unitFilters.length === 1 ? unitFilters[0] : { $or: unitFilters }).select('_id'))
    : [];

  return {
    ...resolved,
    employeeIds: uniqueIds([...supervisorIds, ...unitEmployees.map((employee) => employee._id)]),
  };
}

/**
 * 排班人員範圍的員工查詢條件（給 Employee.find 用，多個條件時以 $or 合併）：
 * 被指定小單位的員工、擔任「排班管理者」部門的所有員工（含沒有小單位的）。沒有指派時是空陣列。
 */
export function schedulerEmployeeFilters(access) {
  const filters = [];
  if (access?.subDepartmentIds?.length) filters.push({ subDepartment: { $in: access.subDepartmentIds } });
  if (access?.wholeDepartmentIds?.length) filters.push({ department: { $in: access.wholeDepartmentIds } });
  return filters;
}

/** 員工資料（含 supervisor、department、subDepartment）是否在排班範圍內：逐筆檢查用，不必展開整份名單 */
export function isEmployeeInScheduleScope(access, actorId, employee) {
  if (!access?.canSchedule || !employee) return false;
  if (access.isAdmin) return true;
  const actor = toId(actorId);
  const employeeId = toId(employee._id ?? employee.id);
  if (access.supervisorScope && (employeeId === actor || toId(employee.supervisor) === actor)) return true;
  return access.subDepartmentIds.includes(toId(employee.subDepartment))
    || access.wholeDepartmentIds.includes(toId(employee.department));
}

/**
 * 只判斷能不能排班與被指定的單位，不展開員工名單（選單、個人資料用，比 getScheduleAccess 少查員工）：
 * { canSchedule, mode, supervisorScope, subDepartmentIds, departmentIds, wholeDepartmentIds, isAdmin }
 */
export async function getScheduleAccessSummary(user) {
  const id = toId(user?.id ?? user?._id);
  const role = user?.role;
  const base = {
    canSchedule: false,
    mode: null,
    supervisorScope: false,
    subDepartmentIds: [],
    departmentIds: [],
    wholeDepartmentIds: [],
    isAdmin: false,
  };
  if (!id) return base;
  if (role === 'admin') return { ...base, canSchedule: true, isAdmin: true };
  if (!['employee', 'supervisor'].includes(role)) return base;

  const assignments = await findSchedulerAssignments(id);
  let mode = null;
  let supervisorScope = false;
  if (role === 'supervisor') {
    mode = await getScheduleAccessMode();
    supervisorScope = mode === DEFAULT_SCHEDULE_ACCESS_MODE;
  }
  const isScheduler = assignments.subDepartmentIds.length > 0 || assignments.wholeDepartmentIds.length > 0;
  return {
    ...base,
    canSchedule: supervisorScope || isScheduler,
    mode,
    supervisorScope,
    subDepartmentIds: assignments.subDepartmentIds,
    departmentIds: assignments.departmentIds,
    wholeDepartmentIds: assignments.wholeDepartmentIds,
  };
}

// 同一個請求只算一次排班權限（一個 API 常要檢查好幾次範圍）；登入者換了就重算
function requestCache(req) {
  const key = `${toId(req.user?.id)}:${req.user?.role || ''}`;
  if (!req.scheduleAccessCache || req.scheduleAccessCache.key !== key) {
    req.scheduleAccessCache = { key, summary: null, full: null };
  }
  return req.scheduleAccessCache;
}

/** 這個請求的登入者能不能排班與被指定的單位（不展開員工名單），同一個請求只查一次 */
export function getScheduleAccessSummaryForRequest(req) {
  if (!req) return getScheduleAccessSummary(null);
  const cache = requestCache(req);
  if (!cache.summary) cache.summary = getScheduleAccessSummary(req.user);
  return cache.summary;
}

/** 這個請求的登入者的完整排班權限（含員工名單），同一個請求只查一次 */
export function getScheduleAccessForRequest(req) {
  if (!req) return getScheduleAccess(null);
  const cache = requestCache(req);
  if (!cache.full) {
    cache.full = getScheduleAccessSummaryForRequest(req).then((summary) => getScheduleAccess(req.user, summary));
  }
  return cache.full;
}

/**
 * 小單位可以用的班別（AttendanceSetting.shifts 的 _id 字串）；回傳空陣列代表全部班別。
 * 任一個小單位沒有設定（或找不到）就代表全部，否則取所有小單位的聯集。
 */
export async function getAllowedShiftIdsFor({ subDepartmentIds = [] } = {}) {
  const ids = uniqueIds(subDepartmentIds).filter((id) => OBJECT_ID_PATTERN.test(id));
  if (!ids.length || !canQuery(SubDepartment, 'find')) return [];
  const units = await runLean(SubDepartment.find({ _id: { $in: ids } }).select('_id allowedShiftIds'));
  if (units.length < ids.length) return [];
  if (units.some((unit) => !Array.isArray(unit.allowedShiftIds) || !unit.allowedShiftIds.length)) return [];
  return uniqueIds(units.flatMap((unit) => unit.allowedShiftIds));
}

/**
 * 檢查班表用的班別是否在小單位的「使用班別」內。
 * entries：[{ employee, shiftId, subDepartment }]，小單位以班表上的為準，沒有就用員工資料的小單位；沒有設定的小單位不限制。
 * 回傳不允許的項目 [{ employee, shiftId, subDepartment, subDepartmentName }]。
 */
export async function findDisallowedShiftAssignments(entries) {
  const list = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      employee: toId(entry?.employee),
      shiftId: toId(entry?.shiftId),
      subDepartment: toId(entry?.subDepartment),
    }))
    .filter((entry) => entry.shiftId);
  if (!list.length || !canQuery(SubDepartment, 'find')) return [];

  const needEmployeeUnit = uniqueIds(list.filter((entry) => !entry.subDepartment).map((entry) => entry.employee))
    .filter((id) => OBJECT_ID_PATTERN.test(id));
  const employeeUnits = new Map();
  if (needEmployeeUnit.length) {
    const rows = await runLean(Employee.find({ _id: { $in: needEmployeeUnit } }).select('_id subDepartment'));
    rows.forEach((row) => employeeUnits.set(toId(row._id), toId(row.subDepartment)));
  }
  const resolved = list.map((entry) => ({
    ...entry,
    subDepartment: entry.subDepartment || employeeUnits.get(entry.employee) || '',
  }));
  const rules = await loadUnitShiftRules(resolved.map((entry) => entry.subDepartment));
  return resolved
    .filter((entry) => isShiftAllowedByRules(rules, entry.subDepartment, entry.shiftId) === false)
    .map((entry) => ({ ...entry, subDepartmentName: rules.get(entry.subDepartment)?.name || '' }));
}

/** 小單位 → { name, allowedShiftIds }：只列有設定「使用班別」的小單位（沒設定的不限制） */
export async function loadUnitShiftRules(subDepartmentIds) {
  const ids = uniqueIds(subDepartmentIds).filter((id) => OBJECT_ID_PATTERN.test(id));
  if (!ids.length || !canQuery(SubDepartment, 'find')) return new Map();
  const units = await runLean(SubDepartment.find({ _id: { $in: ids } }).select('_id name allowedShiftIds'));
  return new Map(units
    .filter((unit) => Array.isArray(unit.allowedShiftIds) && unit.allowedShiftIds.length > 0)
    .map((unit) => [toId(unit._id), { name: unit.name || '', allowedShiftIds: unit.allowedShiftIds.map(String) }]));
}

/** 依 loadUnitShiftRules 的結果判斷：小單位沒有設定就是允許 */
export function isShiftAllowedByRules(rules, subDepartmentId, shiftId) {
  const rule = rules?.get?.(toId(subDepartmentId));
  if (!rule) return true;
  return rule.allowedShiftIds.includes(toId(shiftId));
}

/** 啟動時的紀錄：有設定「排班管理者」的部門數（這些人現在也能排整個部門的班） */
export async function countLegacyDeptManagers() {
  return Department.countDocuments({ deptManager: { $nin: ['', null] } });
}
