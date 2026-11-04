import Employee from '../models/Employee.js';
import Department from '../models/Department.js';
import SubDepartment from '../models/SubDepartment.js';
import OtherControlSetting from '../models/OtherControlSetting.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import * as settingsStore from './otherControlSettingsStore.js';
import { isNonWorkShift } from './shiftSemanticService.js';

/*
 * 排班權限：誰可以開排班頁、可以排誰的班（說明見 docs/scheduler-access.md）。
 * 1. 管理員：全部。
 * 2. 主管：預設（scheduleAccessMode 'scheduler_only'，2026/11 客戶要求）不因為是主管而能排班；
 *    其他控制設定存成 'supervisor_and_scheduler' 時才排自己與直屬部屬（dbcd121 以前的規則）。
 * 3. 排班人員：小單位設定的「排班人員」（任何角色都可以），範圍是那些小單位的所有員工；
 *    部門的「排班管理者」（舊欄位 deptManager）視為整個部門（所有小單位與沒有小單位的員工）的排班人員，兩種模式都一樣。
 * 範圍取聯集。主管欄位不受影響，作為簽核使用：主管不論哪種模式都看得到直屬部屬的簽核單、假別餘額與調休存摺
 * （唯讀範圍在 controllers/schedule/scheduleShared.js 的 resolveEmployeeReadAccess，和能不能排班分開）。
 */

export const SCHEDULE_ACCESS_MODES = Object.freeze(['scheduler_only', 'supervisor_and_scheduler']);
// 沒有存過設定時的模式：只有被指定的排班人員能排班（客戶：主管帳號與排班功能切開，主管欄位主要作為簽核使用）
export const DEFAULT_SCHEDULE_ACCESS_MODE = 'scheduler_only';
// 主管也能因為是主管而排班的模式（要由管理員在其他控制設定 > 排班權限明確存成這個值）
export const SUPERVISOR_SCHEDULE_ACCESS_MODE = 'supervisor_and_scheduler';

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
 * 資料庫斷線時一律取最嚴格的結果（fail closed），不會因為斷線放寬權限或班別限制：
 * - 排班權限模式用預設值（只有排班人員能排班），排班人員指派當作沒有：斷線期間主管與排班人員都不能排班；
 * - 寫入班表前的「使用班別」檢查丟出 ScheduleAccessUnavailableError（503），不會略過檢查（以前斷線時當作不限班別）。
 * mongoose 斷線時會把查詢排隊等連線（最久 10 秒），所以斷線時不查，直接用上面的結果。
 * 沒有這個方法的 model（只模擬部分 model 的測試替身）也不查，結果同上。
 */
function isDisconnected(model) {
  const state = model?.db?.readyState;
  return state !== undefined && state !== 1;
}

function canQuery(model, method) {
  return typeof model?.[method] === 'function' && !isDisconnected(model);
}

export class ScheduleAccessUnavailableError extends Error {
  constructor() {
    super('排班權限暫時無法確認（資料庫連線中斷），請稍後再試');
    this.status = 503;
    this.code = 'SCHEDULE_ACCESS_UNAVAILABLE';
  }
}

// 寫入前的檢查：資料庫斷線就不能檢查，丟出錯誤讓這次寫入失敗
function assertConnected(...models) {
  if (models.some(isDisconnected)) throw new ScheduleAccessUnavailableError();
}

/** 其他控制設定裡沒有存過、或存了看不懂的值，都當成預設（只有排班人員能排班） */
export function normalizeScheduleAccessMode(value) {
  return SCHEDULE_ACCESS_MODES.includes(value) ? value : DEFAULT_SCHEDULE_ACCESS_MODE;
}

/**
 * 目前的排班權限模式與是否存過：{ mode, saved }。saved 是 false 代表其他控制設定沒有存過（或存了看不懂的值），用的是預設值。
 * 管理員明確存過的 'supervisor_and_scheduler' 照樣有效。
 */
export async function getScheduleAccessModeState() {
  if (typeof settingsStore.getSettings !== 'function' || !canQuery(OtherControlSetting, 'findOne')) {
    return { mode: DEFAULT_SCHEDULE_ACCESS_MODE, saved: false };
  }
  const settings = await settingsStore.getSettings();
  const saved = SCHEDULE_ACCESS_MODES.includes(settings?.scheduleAccessMode);
  return { mode: normalizeScheduleAccessMode(settings?.scheduleAccessMode), saved };
}

export async function getScheduleAccessMode() {
  return (await getScheduleAccessModeState()).mode;
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

/**
 * 排班頁員工名單的範圍（Employee.find 的條件，非管理員；排班頁的名單與上方「排班員工數」共用，兩邊才會一致）：
 * 只有主管範圍時是直屬部屬，勾「包含自己」再加自己；排班人員是被指定小單位（排班管理者的整個部門）的員工，
 * 主管範圍與排班人員範圍取聯集（主管沒勾「包含自己」不含自己）；沒有排班權限只有自己。
 */
export function buildScheduleViewEmployeeFilter(access, actorId, actorRole, includeSelf = false) {
  const actor = toId(actorId);
  if (!access?.canSchedule) return { _id: actor };
  const supervisorClause = includeSelf ? { $or: [{ _id: actor }, { supervisor: actor }] } : { supervisor: actor };
  const unitClauses = schedulerEmployeeFilters(access);
  if (!unitClauses.length) return supervisorClause;
  const scope = { $or: [...(access.supervisorScope ? [supervisorClause] : []), ...unitClauses] };
  // 主管沒勾「包含自己」：自己就算在被指定的小單位裡也不列出（與「包含自己」開關一致）
  return actorRole === 'supervisor' && !includeSelf ? { $and: [scope, { _id: { $ne: actor } }] } : scope;
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
    supervisorScope = mode === SUPERVISOR_SCHEDULE_ACCESS_MODE;
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
 * 不用上班的班別（休息日、例假、國定假日、請假，以及沒有工作時間的班別，判斷同 isNonWorkShift）的 _id：
 * 每個小單位一律可以用，不受「使用班別」限制（設定畫面也只讓管理員選上班的班別）。
 * 沒有班別設定、資料庫斷線（或只模擬部分 model 的測試替身）時是空的，也就是只看小單位的設定（比較嚴格，不會放寬限制）。
 */
async function loadNonWorkShiftIds() {
  if (!canQuery(AttendanceSetting, 'findOne')) return new Set();
  let query = AttendanceSetting.findOne();
  if (typeof query?.select === 'function') query = query.select('shifts');
  const setting = typeof query?.lean === 'function' ? await query.lean() : await query;
  const shifts = Array.isArray(setting?.shifts) ? setting.shifts : [];
  return new Set(shifts.filter((shift) => shift && isNonWorkShift(shift)).map((shift) => toId(shift._id)).filter(Boolean));
}

/**
 * 小單位可以用的班別（AttendanceSetting.shifts 的 _id 字串）；回傳空陣列代表全部班別。
 * 任一個小單位沒有設定（或找不到）就代表全部，否則取所有小單位的聯集，再加上一律可以用的不用上班的班別。
 */
export async function getAllowedShiftIdsFor({ subDepartmentIds = [] } = {}) {
  const ids = uniqueIds(subDepartmentIds).filter((id) => OBJECT_ID_PATTERN.test(id));
  if (!ids.length || !canQuery(SubDepartment, 'find')) return [];
  const units = await runLean(SubDepartment.find({ _id: { $in: ids } }).select('_id allowedShiftIds'));
  if (units.length < ids.length) return [];
  if (units.some((unit) => !Array.isArray(unit.allowedShiftIds) || !unit.allowedShiftIds.length)) return [];
  return uniqueIds([...units.flatMap((unit) => unit.allowedShiftIds), ...await loadNonWorkShiftIds()]);
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
  if (!list.length) return [];
  // 寫入班表前的檢查：資料庫斷線時不能略過（503），以前斷線時當作小單位不限班別
  assertConnected(SubDepartment, Employee);
  if (!canQuery(SubDepartment, 'find')) return [];

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

/**
 * 小單位 → { name, allowedShiftIds, nonWorkShiftIds }：只列有設定「使用班別」的小單位（沒設定的不限制）。
 * nonWorkShiftIds 是一律可以用的不用上班的班別（所有小單位共用同一份），有限制的小單位才去讀班別設定。
 */
export async function loadUnitShiftRules(subDepartmentIds) {
  const ids = uniqueIds(subDepartmentIds).filter((id) => OBJECT_ID_PATTERN.test(id));
  if (!ids.length) return new Map();
  // 匯入班表用這份規則檢查每一格：資料庫斷線時不能當作不限班別（503）
  assertConnected(SubDepartment);
  if (!canQuery(SubDepartment, 'find')) return new Map();
  const units = (await runLean(SubDepartment.find({ _id: { $in: ids } }).select('_id name allowedShiftIds')))
    .filter((unit) => Array.isArray(unit.allowedShiftIds) && unit.allowedShiftIds.length > 0);
  if (!units.length) return new Map();
  const nonWorkShiftIds = await loadNonWorkShiftIds();
  return new Map(units.map((unit) => [toId(unit._id), {
    name: unit.name || '',
    allowedShiftIds: unit.allowedShiftIds.map(String),
    nonWorkShiftIds,
  }]));
}

/**
 * 依 loadUnitShiftRules 的結果判斷：小單位沒有設定就是允許；
 * 不用上班的班別（休息日、例假、國定假日、請假）一律允許，選過的舊設定裡有沒有這些班別都一樣
 */
export function isShiftAllowedByRules(rules, subDepartmentId, shiftId) {
  const rule = rules?.get?.(toId(subDepartmentId));
  if (!rule) return true;
  const id = toId(shiftId);
  return rule.allowedShiftIds.includes(id) || Boolean(rule.nonWorkShiftIds?.has?.(id));
}

/** 啟動時的紀錄：有設定「排班管理者」的部門數（這些人現在也能排整個部門的班） */
export async function countLegacyDeptManagers() {
  return Department.countDocuments({ deptManager: { $nin: ['', null] } });
}

/**
 * 啟動時的紀錄（只讀、不修改資料）：目前生效的排班權限模式、是存過的還是預設值；
 * 只有排班人員能排班時，再算出沒有任何排班指派（小單位排班人員、部門排班管理者）的主管人數——他們的選單沒有「排班管理」。
 * 回傳 { mode, saved, supervisorsWithoutAssignment }（supervisor_and_scheduler 模式時 supervisorsWithoutAssignment 是 null）。
 */
export async function describeScheduleAccessForStartup() {
  const { mode, saved } = await getScheduleAccessModeState();
  if (mode === SUPERVISOR_SCHEDULE_ACCESS_MODE) return { mode, saved, supervisorsWithoutAssignment: null };
  const [unitSchedulers, deptManagers] = await Promise.all([
    SubDepartment.distinct('schedulers'),
    Department.distinct('deptManager'),
  ]);
  const assigned = uniqueIds([...(unitSchedulers || []), ...(deptManagers || [])]).filter((id) => OBJECT_ID_PATTERN.test(id));
  const supervisorsWithoutAssignment = await Employee.countDocuments({ role: 'supervisor', _id: { $nin: assigned } });
  return { mode, saved, supervisorsWithoutAssignment };
}
