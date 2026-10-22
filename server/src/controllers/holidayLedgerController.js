// 國定假日休假紀錄 API：查詢（與班表相同的權限範圍）、登記／刪除「沒休的處理方式」、匯出 Excel，
// 以及國定假日的調休（年度調休清單、重新計算、管理員的 HR 指定調休日與手動補登）與個人調移（須有員工本人的同意紀錄）。
// 休假紀錄本身由班表推算（holidayRestLedgerService），這裡只存人工的處理決定；查詢時順便同步調休存摺。
import { Types } from 'mongoose';
import Employee from '../models/Employee.js';
import Department from '../models/Department.js';
import HolidayRestResolution, { HOLIDAY_RESOLUTION_KINDS } from '../models/HolidayRestResolution.js';
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js';
import { isNationalHolidayFor, loadHolidayContext } from '../services/holidayResolver.js';
import {
  buildHolidayRestLedger,
  parseLedgerMonth,
  serializeHolidayResolution,
  summarizeLedger,
} from '../services/holidayRestLedgerService.js';
import {
  COMPENSATION_LIST_STATUSES,
  HolidayCompensationError,
  MAX_SYNC_MONTHS,
  assignHolidayCompensation,
  createHolidaySwap,
  createManualHolidayCompensation,
  listHolidayCompensations,
  listHolidaySwaps,
  listSyncMonths,
  revokeHolidaySwap,
  syncHolidayCompensationsForMonths,
  unassignHolidayCompensation,
} from '../services/holidayCompensationService.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';
import { appendHolidayLedgerSheet } from '../services/holidayLedgerWorkbook.js';
import { buildLiteralSearchRegex } from '../utils/safeSearch.js';
import { getAllowedScheduleEmployeeIds, toEntityId } from './schedule/scheduleShared.js';

const MAX_LEDGER_MONTHS = 12;
// 一次最多處理的員工數：全公司沒有選單位時可能很多人，請使用者縮小範圍
const MAX_LEDGER_EMPLOYEES = 2000;
const MAX_NOTE_LENGTH = 500;
const EMPLOYEE_SELECT = '_id employeeId name title practiceTitle subDepartment partTime requiresScheduling holidayRegime isIndigenous status appointment role';
const RESOLUTION_EMPLOYEE_SELECT = '_id holidayRegime requiresScheduling isIndigenous';
// 登記處理方式時，原始日期要是該員工的國定假日（或適用的指定應放假日）；被公司挪移、個人調移走的原日期也算
const RESOLVABLE_REASONS = new Set(['statutory', 'designated', 'company_move']);
const RESOLVABLE_NOT_HOLIDAY_REASONS = new Set(['moved_away', 'swapped_away']);

class LedgerRequestError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function leanResult(query) {
  return query && typeof query.lean === 'function' ? query.lean() : query;
}

function isObjectId(value) {
  return typeof value === 'string' && Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value;
}

function parseDayKey(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return { key: text, date };
}

function listMonths(from, to) {
  const months = [];
  const start = parseLedgerMonth(from);
  const stop = parseLedgerMonth(to);
  if (!start || !stop || start.start > stop.start) return null;
  const pointer = new Date(start.start);
  while (pointer <= stop.start) {
    months.push(pointer.toISOString().slice(0, 7));
    pointer.setUTCMonth(pointer.getUTCMonth() + 1);
    if (months.length > MAX_LEDGER_MONTHS) break;
  }
  return months;
}

function resolveMonths(query, { single = false } = {}) {
  const { month, from, to } = query;
  if (!single && (from || to)) {
    const months = listMonths(from, to);
    if (!months) throw new LedgerRequestError(400, 'from and to must be valid months (YYYY-MM) with from <= to');
    if (months.length > MAX_LEDGER_MONTHS) throw new LedgerRequestError(400, `range cannot exceed ${MAX_LEDGER_MONTHS} months`);
    return months;
  }
  if (!month) throw new LedgerRequestError(400, 'month required');
  if (!parseLedgerMonth(month)) throw new LedgerRequestError(400, 'invalid month format');
  return [String(month).trim()];
}

/**
 * 依登入者的權限（與班表相同：管理員全部、主管為自己與直屬部屬、員工只有自己）與篩選條件組出員工查詢條件。
 * 主管預設不含自己（和排班頁一樣，includeSelf=true 才含）。
 */
async function buildLedgerEmployeeQuery(req) {
  const actorId = toEntityId(req.user?.id);
  if (!actorId) throw new LedgerRequestError(401, 'Invalid user');
  const allowed = await getAllowedScheduleEmployeeIds(req);
  if (allowed !== null && allowed.length === 0) throw new LedgerRequestError(403, 'forbidden');

  const {
    employee: employeeParam,
    department,
    subDepartment,
    search: searchRaw,
    includeSelf: includeSelfRaw,
  } = req.query;
  const includeSelf = String(includeSelfRaw).toLowerCase() === 'true';

  let scoped = allowed;
  if (req.user?.role === 'supervisor' && Array.isArray(allowed) && !includeSelf) {
    scoped = allowed.filter((id) => id !== actorId);
  }
  if (employeeParam) {
    const requested = String(employeeParam).trim();
    if (!isObjectId(requested)) throw new LedgerRequestError(400, 'invalid employee');
    if (allowed !== null && !allowed.includes(requested)) throw new LedgerRequestError(403, 'forbidden');
    scoped = [requested];
  }

  const query = {};
  if (Array.isArray(scoped)) query._id = { $in: scoped };
  if (department) {
    if (!isObjectId(String(department))) throw new LedgerRequestError(400, 'invalid department');
    query.department = String(department);
  }
  if (subDepartment) {
    if (!isObjectId(String(subDepartment))) throw new LedgerRequestError(400, 'invalid subDepartment');
    query.subDepartment = String(subDepartment);
  }
  const search = String(searchRaw || '').trim();
  if (search) {
    const rx = buildLiteralSearchRegex(search);
    query.$or = [{ name: rx }, { employeeId: rx }];
  }
  return query;
}

/** 依權限範圍與篩選條件取出要列入的員工（一次最多 2000 人，超過時請使用者縮小範圍） */
async function loadLedgerEmployees(req) {
  const query = await buildLedgerEmployeeQuery(req);
  const find = Employee.find(query).select(EMPLOYEE_SELECT);
  const populated = typeof find.populate === 'function' ? find.populate({ path: 'subDepartment', select: 'name' }) : find;
  const employees = (await leanResult(populated)) || [];
  if (employees.length > MAX_LEDGER_EMPLOYEES) {
    throw new LedgerRequestError(400, `too many employees (${employees.length}); narrow by department or subDepartment`);
  }
  return employees;
}

/**
 * 重新計算用：依權限範圍分批讀員工（依 _id 排序，每批最多 2000 人），每批交給 handle 處理。
 * 和每日排程一樣分批，管理員的員工資料（含離職員工）超過 2000 筆時也能完成，不必縮小範圍。
 */
async function forEachLedgerEmployeeBatch(req, handle) {
  const query = await buildLedgerEmployeeQuery(req);
  let lastId = null;
  for (;;) {
    let find = Employee.find(lastId === null ? query : { $and: [query, { _id: { $gt: lastId } }] }).select(EMPLOYEE_SELECT);
    if (typeof find?.sort === 'function') find = find.sort({ _id: 1 });
    if (typeof find?.limit === 'function') find = find.limit(MAX_LEDGER_EMPLOYEES);
    const batch = (await leanResult(find)) || [];
    if (!batch.length) break;
    await handle(batch);
    if (batch.length < MAX_LEDGER_EMPLOYEES) break;
    const nextId = batch[batch.length - 1]._id;
    // 防呆：游標沒有前進就停止，不會無限重複同一批
    if (lastId !== null && String(nextId) === String(lastId)) break;
    lastId = nextId;
  }
}

function respondError(res, err, label) {
  if (err instanceof LedgerRequestError) {
    return res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
  }
  if (err instanceof HolidayCompensationError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(label, err?.name ?? 'Error');
  return res.status(500).json({ error: 'internal error' });
}

// status 篩選（與視窗上的篩選鈕同名）：只回傳符合條件的員工；沒帶或不認得的 status 一律是全部
const STATUS_FILTERS = new Map([
  ['open', { label: '待處理', matches: (employee) => employee.open > 0 }],
  ['notTaken', { label: '未休', matches: (employee) => employee.notTaken > 0 }],
  ['moved', { label: '移休', matches: (employee) => employee.moved > 0 }],
  ['extra', { label: '多排的國', matches: (employee) => employee.extraGuoDates.length > 0 }],
  // 國定假日適逢休息日／例假：已存入調休（含已用掉的整天調休、HR 指定），或還沒存入的
  ['compensation', { label: '調休', matches: (employee) => employee.items.some(isCompensationItem) }],
]);

const BANK_VIAS = new Set(['bank', 'comp_leave', 'hr_assigned', 'assigned']);

function isCompensationItem(item) {
  return item.needsAction === 'assign_compensation' || BANK_VIAS.has(item.compensation?.via);
}

function statusFilterOf(query) {
  return STATUS_FILTERS.get(String(query.status || '').trim()) || null;
}

// 合計跟著回傳的員工重算
function keepEmployees(ledger, filter) {
  if (!filter) return ledger;
  const employees = ledger.employees.filter(filter.matches);
  return {
    ...ledger,
    employees,
    summary: summarizeLedger(employees, ledger.holidays.length, ledger.summary.excluded.notScheduled),
  };
}

function mergeSummaries(ledgers) {
  const total = summarizeLedger([], 0, 0);
  for (const ledger of ledgers) {
    const summary = ledger.summary;
    total.employees += summary.employees;
    total.holidays += summary.holidays;
    total.entitled += summary.entitled;
    total.rested += summary.rested;
    total.moved += summary.moved;
    total.compensated += summary.compensated || 0;
    total.notTaken += summary.notTaken;
    total.open += summary.open;
    total.compensationOpen += summary.compensationOpen || 0;
    total.banked += summary.banked || 0;
    total.extra += summary.extra;
    total.excluded.notScheduled += summary.excluded.notScheduled;
  }
  return total;
}

export async function getHolidayLedger(req, res) {
  try {
    const months = resolveMonths(req.query);
    const employees = await loadLedgerEmployees(req);
    const filter = statusFilterOf(req.query);
    const ledgers = [];
    for (const month of months) {
      // 查詢時順便同步調休存摺（國定假日落在休息日／例假存入的調休），班表改過之後不必另外觸發
      const { sync, ...ledger } = await buildHolidayRestLedger({ month, employees, syncCompensations: true });
      ledgers.push(keepEmployees(ledger, filter));
    }
    return res.json({ months: ledgers, summary: mergeSummaries(ledgers) });
  } catch (err) {
    return respondError(res, err, 'Holiday ledger query failed');
  }
}

export async function exportHolidayLedger(req, res) {
  try {
    const [month] = resolveMonths(req.query, { single: true });
    const employees = await loadLedgerEmployees(req);
    const filter = statusFilterOf(req.query);
    const ledger = keepEmployees(await buildHolidayRestLedger({ month, employees }), filter);
    // 篩選過的匯出要在標題註明，免得被當成整個單位的完整名單
    const search = String(req.query.search || '').trim().slice(0, 100);
    const filterText = [filter && `僅列出${filter.label}`, search && `搜尋「${search}」`].filter(Boolean).join('、');

    let departmentName = '';
    if (req.query.department && isObjectId(String(req.query.department))) {
      try {
        const departmentDoc = await leanResult(Department.findById(req.query.department).select('name unitName'));
        departmentName = departmentDoc?.unitName || departmentDoc?.name || '';
      } catch {
        departmentName = '';
      }
    }

    let ExcelJS;
    try {
      ExcelJS = (await import('exceljs')).default;
    } catch {
      return res.status(500).json({ error: 'exceljs module not installed' });
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HR System';
    workbook.created = new Date();
    appendHolidayLedgerSheet(workbook, ledger, { departmentName, filterText });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="holiday-ledger-${month.replace('-', '')}.xlsx"`);
    return res.send(await workbook.xlsx.writeBuffer());
  } catch (err) {
    return respondError(res, err, 'Holiday ledger export failed');
  }
}

/** 主管只能處理直屬部屬（不含自己）；管理員不限 */
async function assertCanResolveFor(req, employeeId) {
  const role = req.user?.role;
  if (role === 'admin') return;
  if (role !== 'supervisor') throw new LedgerRequestError(403, 'forbidden');
  const actorId = toEntityId(req.user?.id);
  const allowed = await getAllowedScheduleEmployeeIds(req);
  if (!Array.isArray(allowed) || employeeId === actorId || !allowed.includes(employeeId)) {
    throw new LedgerRequestError(403, 'forbidden');
  }
}

async function upsertResolution(filter, update) {
  const options = { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true };
  try {
    return await HolidayRestResolution.findOneAndUpdate(filter, update, options);
  } catch (err) {
    // 兩個人同時第一次登記同一筆：唯一索引會擋掉其中一個，重試一次就變成更新
    if (err?.code === 11000) return HolidayRestResolution.findOneAndUpdate(filter, update, options);
    throw err;
  }
}

function plainResolution(doc) {
  const plain = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...serializeHolidayResolution(plain),
    employee: toEntityId(plain.employee),
    holidayDate: plain.holidayDate ? new Date(plain.holidayDate).toISOString().slice(0, 10) : null,
    holidayName: plain.holidayName || '',
  };
}

export async function saveHolidayLedgerResolution(req, res) {
  try {
    const body = req.body || {};
    const employeeId = String(body.employee ?? '').trim();
    if (!isObjectId(employeeId)) throw new LedgerRequestError(400, 'invalid employee');
    await assertCanResolveFor(req, employeeId);
    const holiday = parseDayKey(body.holidayDate);
    if (!holiday) throw new LedgerRequestError(400, 'holidayDate must be YYYY-MM-DD');
    const kind = String(body.kind ?? '').trim();
    if (!HOLIDAY_RESOLUTION_KINDS.includes(kind)) throw new LedgerRequestError(400, 'invalid kind');
    const note = String(body.note ?? '').trim();
    if (note.length > MAX_NOTE_LENGTH) throw new LedgerRequestError(400, `note cannot exceed ${MAX_NOTE_LENGTH} characters`);

    const actorId = toEntityId(req.user?.id);
    // resolvedBy 是最後一次登記的人；第一次登記的人只在新增時寫入 createdBy，之後別人修改也不會蓋掉
    const $set = { kind, note, month: holiday.key.slice(0, 7), resolvedBy: actorId };
    const $unset = {};
    if (kind === 'compensatory_leave') {
      const hours = body.compensatoryHours === undefined || body.compensatoryHours === null || body.compensatoryHours === ''
        ? WORK_HOURS_CONFIG.HOURS_PER_DAY
        : Number(body.compensatoryHours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
        throw new LedgerRequestError(400, 'compensatoryHours must be greater than 0 and at most 24');
      }
      $set.compensatoryHours = hours;
    } else {
      $unset.compensatoryHours = '';
    }
    if (kind === 'rested_later') {
      const restedDate = parseDayKey(body.restedDate);
      if (!restedDate) throw new LedgerRequestError(400, 'restedDate must be YYYY-MM-DD for rested_later');
      $set.restedDate = restedDate.date;
    } else {
      $unset.restedDate = '';
    }
    if (kind === 'waived' && !note) throw new LedgerRequestError(400, 'note required when kind is waived');

    const target = await leanResult(Employee.findById(employeeId).select(RESOLUTION_EMPLOYEE_SELECT));
    if (!target) throw new LedgerRequestError(404, 'employee not found');
    // 依該員工判斷（輪班人員的公務機關補假日不是國定假日）；鍵是國定假日的原始日期
    const nextDay = new Date(holiday.date.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const context = await loadHolidayContext({ start: holiday.key, end: nextDay, employees: [target] });
    const verdict = isNationalHolidayFor(context, target, holiday.key);
    const resolvable = verdict.originalDate === holiday.key
      && (RESOLVABLE_REASONS.has(verdict.reason) || RESOLVABLE_NOT_HOLIDAY_REASONS.has(verdict.notHolidayReason));
    if (!resolvable) throw new LedgerRequestError(400, 'holidayDate is not a national holiday');
    $set.holidayName = String(verdict.name || '國定假日').trim().slice(0, 100);

    const update = { $set, $setOnInsert: { createdBy: actorId } };
    if (Object.keys($unset).length) update.$unset = $unset;
    const saved = await upsertResolution({ employee: employeeId, holidayDate: holiday.date }, update);
    return res.json(plainResolution(saved));
  } catch (err) {
    return respondError(res, err, 'Holiday ledger resolution failed');
  }
}

export async function deleteHolidayLedgerResolution(req, res) {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!isObjectId(id)) throw new LedgerRequestError(400, 'invalid id');
    const existing = await leanResult(HolidayRestResolution.findById(id));
    if (!existing) throw new LedgerRequestError(404, 'resolution not found');
    await assertCanResolveFor(req, toEntityId(existing.employee));
    await HolidayRestResolution.deleteOne({ _id: id });
    // 直接刪除、沒有歷史紀錄：至少留下是誰刪了誰的哪一天（只記 _id 與日期，不含姓名與備註）
    console.info('Holiday ledger resolution deleted', {
      actorId: toEntityId(req.user?.id),
      employeeId: toEntityId(existing.employee),
      holidayDate: existing.holidayDate ? new Date(existing.holidayDate).toISOString().slice(0, 10) : null,
    });
    return res.json({ success: true });
  } catch (err) {
    return respondError(res, err, 'Holiday ledger resolution delete failed');
  }
}

/* ---------------------------- 國定假日的調休 ---------------------------- */

function currentTaipeiYear() {
  return Number(String(toTaipeiDateKey(new Date()) || '').slice(0, 4)) || new Date().getUTCFullYear();
}

function parseYear(value) {
  if (value === undefined || value === null || value === '') return currentTaipeiYear();
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new LedgerRequestError(400, '年度不正確', 'INVALID_YEAR');
  return year;
}

// 調休、調移的寫入：主管只能處理直屬部屬（不含自己），管理員不限（HR 指定與手動補登在路由只開放管理員）
const authorizeFor = (req) => (employeeId) => assertCanResolveFor(req, employeeId);

/** GET /api/holiday-ledger/compensations?year=&status=available|used|expired|void|all：年度調休清單（預設未使用） */
export async function listHolidayLedgerCompensations(req, res) {
  try {
    const year = parseYear(req.query.year);
    const status = String(req.query.status || 'available').trim();
    if (!COMPENSATION_LIST_STATUSES.includes(status)) throw new LedgerRequestError(400, '狀態篩選不正確', 'INVALID_STATUS');
    const employees = await loadLedgerEmployees(req);
    return res.json(await listHolidayCompensations({ employees, year, status }));
  } catch (err) {
    return respondError(res, err, 'Holiday compensation list failed');
  }
}

/** POST /api/holiday-ledger/compensations/sync { from, to }：重新計算（最多 12 個月；權限範圍內的員工分批處理） */
export async function syncHolidayLedgerCompensations(req, res) {
  try {
    const body = req.body || {};
    const months = listSyncMonths(body.from, body.to);
    if (!months) throw new LedgerRequestError(400, '請提供有效的起訖月份（YYYY-MM）', 'INVALID_RANGE');
    if (months.length > MAX_SYNC_MONTHS) throw new LedgerRequestError(400, `一次最多重新計算 ${MAX_SYNC_MONTHS} 個月`, 'RANGE_TOO_LONG');
    const result = { created: 0, voided: 0, reopened: 0, conflicts: 0 };
    await forEachLedgerEmployeeBatch({ user: req.user, query: {} }, async (employees) => {
      const part = await syncHolidayCompensationsForMonths({ months, employees });
      for (const key of Object.keys(result)) result[key] += Number(part?.[key]) || 0;
    });
    return res.json({ months, ...result });
  } catch (err) {
    return respondError(res, err, 'Holiday compensation sync failed');
  }
}

/** POST /api/holiday-ledger/compensations/:id/assign { assignedDate, agreementNote }：HR 指定調休日（用掉這筆調休，協商紀錄必填） */
export async function assignHolidayLedgerCompensation(req, res) {
  try {
    const body = req.body || {};
    const saved = await assignHolidayCompensation({
      id: String(req.params.id ?? '').trim(),
      assignedDate: body.assignedDate,
      agreementNote: body.agreementNote,
      actorId: toEntityId(req.user?.id) || null,
      authorize: authorizeFor(req),
    });
    return res.json(saved);
  } catch (err) {
    return respondError(res, err, 'Holiday compensation assign failed');
  }
}

/** POST /api/holiday-ledger/compensations/:id/unassign：取消 HR 指定（這筆調休回到未使用） */
export async function unassignHolidayLedgerCompensation(req, res) {
  try {
    const saved = await unassignHolidayCompensation({ id: String(req.params.id ?? '').trim(), authorize: authorizeFor(req) });
    return res.json(saved);
  } catch (err) {
    return respondError(res, err, 'Holiday compensation unassign failed');
  }
}

/** POST /api/holiday-ledger/compensations { employee, holidayDate, note }：人資手動補登國定假日的調休 */
export async function createHolidayLedgerCompensation(req, res) {
  try {
    const body = req.body || {};
    const employeeId = String(body.employee ?? '').trim();
    if (!isObjectId(employeeId)) throw new LedgerRequestError(400, 'invalid employee');
    await assertCanResolveFor(req, employeeId);
    const saved = await createManualHolidayCompensation({
      employeeId,
      holidayDate: body.holidayDate,
      note: body.note,
      actorId: toEntityId(req.user?.id) || null,
    });
    return res.status(201).json(saved);
  } catch (err) {
    return respondError(res, err, 'Holiday compensation create failed');
  }
}

/* ---------------------------- 個人調移 ---------------------------- */

/** GET /api/holiday-ledger/swaps?employee=&year=&status=active|all */
export async function listHolidayLedgerSwaps(req, res) {
  try {
    const status = String(req.query.status || 'active').trim();
    if (!['active', 'all'].includes(status)) throw new LedgerRequestError(400, '狀態篩選不正確', 'INVALID_STATUS');
    const year = req.query.year === undefined || req.query.year === '' ? null : parseYear(req.query.year);
    const employees = await loadLedgerEmployees(req);
    return res.json(await listHolidaySwaps({ employees, year, status }));
  } catch (err) {
    return respondError(res, err, 'Holiday swap list failed');
  }
}

/** POST /api/holiday-ledger/swaps { employee, originalDate, targetDate, reason?, consent }：建立個人調移 */
export async function createHolidayLedgerSwap(req, res) {
  try {
    const body = req.body || {};
    const employeeId = String(body.employee ?? '').trim();
    if (!isObjectId(employeeId)) throw new LedgerRequestError(400, 'invalid employee');
    await assertCanResolveFor(req, employeeId);
    const saved = await createHolidaySwap({
      employeeId,
      originalDate: body.originalDate,
      targetDate: body.targetDate,
      reason: body.reason,
      consent: body.consent,
      actorId: toEntityId(req.user?.id) || null,
    });
    return res.status(201).json(saved);
  } catch (err) {
    return respondError(res, err, 'Holiday swap create failed');
  }
}

/** POST /api/holiday-ledger/swaps/:id/revoke { reason }：撤銷（紀錄保留） */
export async function revokeHolidayLedgerSwap(req, res) {
  try {
    const saved = await revokeHolidaySwap({
      id: String(req.params.id ?? '').trim(),
      reason: req.body?.reason,
      actorId: toEntityId(req.user?.id) || null,
      authorize: authorizeFor(req),
    });
    return res.json(saved);
  } catch (err) {
    return respondError(res, err, 'Holiday swap revoke failed');
  }
}
