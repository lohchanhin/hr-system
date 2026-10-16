// 國定假日休假紀錄 API：查詢（與班表相同的權限範圍）、登記／刪除「沒休的處理方式」、匯出 Excel。
// 休假紀錄本身由班表推算（holidayRestLedgerService），這裡只存人工的處理決定。
import { Types } from 'mongoose';
import Employee from '../models/Employee.js';
import Holiday from '../models/Holiday.js';
import Department from '../models/Department.js';
import HolidayRestResolution, { HOLIDAY_RESOLUTION_KINDS } from '../models/HolidayRestResolution.js';
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js';
import { isPayableNationalHoliday } from '../services/countedHolidayService.js';
import {
  buildHolidayRestLedger,
  parseLedgerMonth,
  serializeHolidayResolution,
  summarizeLedger,
} from '../services/holidayRestLedgerService.js';
import { appendHolidayLedgerSheet } from '../services/holidayLedgerWorkbook.js';
import { buildLiteralSearchRegex } from '../utils/safeSearch.js';
import { getAllowedScheduleEmployeeIds, toEntityId } from './schedule/scheduleShared.js';

const MAX_LEDGER_MONTHS = 12;
// 一次最多處理的員工數：全公司沒有選單位時可能很多人，請使用者縮小範圍
const MAX_LEDGER_EMPLOYEES = 2000;
const MAX_NOTE_LENGTH = 500;
const EMPLOYEE_SELECT = '_id employeeId name title practiceTitle subDepartment partTime requiresScheduling status appointment';

class LedgerRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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
 * 依登入者的權限（與班表相同：管理員全部、主管為自己與直屬部屬、員工只有自己）與篩選條件取出要列入的員工。
 * 主管預設不含自己（和排班頁一樣，includeSelf=true 才含）。
 */
async function loadLedgerEmployees(req) {
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

  const find = Employee.find(query).select(EMPLOYEE_SELECT);
  const populated = typeof find.populate === 'function' ? find.populate({ path: 'subDepartment', select: 'name' }) : find;
  const employees = (await leanResult(populated)) || [];
  if (employees.length > MAX_LEDGER_EMPLOYEES) {
    throw new LedgerRequestError(400, `too many employees (${employees.length}); narrow by department or subDepartment`);
  }
  return employees;
}

function respondError(res, err, label) {
  if (err instanceof LedgerRequestError) return res.status(err.status).json({ error: err.message });
  console.error(label, err?.name ?? 'Error');
  return res.status(500).json({ error: 'internal error' });
}

// status=open 只回傳還有待處理項目的員工；合計跟著回傳的員工重算
function keepOpenEmployees(ledger) {
  const employees = ledger.employees.filter((employee) => employee.open > 0);
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
    total.notTaken += summary.notTaken;
    total.open += summary.open;
    total.extra += summary.extra;
    total.excluded.notScheduled += summary.excluded.notScheduled;
  }
  return total;
}

export async function getHolidayLedger(req, res) {
  try {
    const months = resolveMonths(req.query);
    const employees = await loadLedgerEmployees(req);
    const onlyOpen = String(req.query.status || 'all').trim() === 'open';
    const ledgers = [];
    for (const month of months) {
      const ledger = await buildHolidayRestLedger({ month, employees });
      ledgers.push(onlyOpen ? keepOpenEmployees(ledger) : ledger);
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
    const onlyOpen = String(req.query.status || 'all').trim() === 'open';
    const built = await buildHolidayRestLedger({ month, employees });
    const ledger = onlyOpen ? keepOpenEmployees(built) : built;

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
    appendHolidayLedgerSheet(workbook, ledger, { departmentName });
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

    const $set = { kind, note, month: holiday.key.slice(0, 7), resolvedBy: toEntityId(req.user?.id) };
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

    const target = await leanResult(Employee.findById(employeeId).select('_id'));
    if (!target) throw new LedgerRequestError(404, 'employee not found');
    const holidayDocs = (await leanResult(Holiday.find({ date: holiday.date }))) || [];
    const holidayDoc = holidayDocs.find(isPayableNationalHoliday);
    if (!holidayDoc) throw new LedgerRequestError(400, 'holidayDate is not a national holiday');
    $set.holidayName = String(holidayDoc.name || holidayDoc.description || holidayDoc.desc || '國定假日').trim().slice(0, 100);

    const update = { $set };
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
    return res.json({ success: true });
  } catch (err) {
    return respondError(res, err, 'Holiday ledger resolution delete failed');
  }
}
