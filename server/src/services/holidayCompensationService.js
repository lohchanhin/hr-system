/**
 * 國定假日的補假義務（HolidayCompensation）與個人調移（HolidaySwap）。
 *
 * 補假義務：國定假日剛好落在員工自己的休息日／例假（輪班人員依班表，行政人員依週末、公司休息日），
 * 又沒有公務機關補假日可用時，依勞基法施行細則第 23-1 條要另給補假，日期由勞雇雙方協商（人資在這裡排定）。
 *  - 由國定假日休假紀錄（holidayRestLedgerService）推算觸發條件，syncHolidayCompensationsForLedger 依結果建立、作廢、重新開啟；
 *    可重複執行、不刪資料：已排定的補假不會自動作廢，觸發條件不成立時只標成 conflict 請人確認。
 *  - 不自動產生任何薪資（國定假日出勤仍須有核准的加班單）。
 * 個人調移：員工本人同意後把一個國定假日和一個工作日對調（勞動部解釋須經本人同意），只能撤銷、不刪除。
 * 判斷「這一天對這位員工是不是假日」一律呼叫 holidayResolver，不在這裡另外推算。
 */
import { Types } from 'mongoose';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import HolidayCompensation from '../models/HolidayCompensation.js';
import HolidaySwap from '../models/HolidaySwap.js';
import { isNationalHolidayFor, loadHolidayContext, officeDayKind } from './holidayResolver.js';
import { resolveHolidayRegime } from './holidayCalendarRules.js';
import { resolveShiftSemanticType } from './shiftSemanticService.js';
import { buildHolidayRestLedger, buildTenureCheck, parseLedgerMonth } from './holidayRestLedgerService.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// 補假、調移日與國定假日最多相隔 366 天
const MAX_DISTANCE_DAYS = 366;
const MAX_NOTE_LENGTH = 500;
const MAX_EVIDENCE_LENGTH = 200;
// 每日排程一次處理的員工數
const SYNC_BATCH_SIZE = 2000;
const MAX_SYNC_MONTHS = 12;
const CONSENT_METHOD_VALUES = ['signature', 'written_form', 'electronic'];
const REST_ROSTER_KINDS = new Set(['rest_day', 'regular_rest']);
const STATUTORY_NOT_HOLIDAY_REASONS = new Set(['moved_away', 'swapped_away']);
const SYNC_EMPLOYEE_SELECT = '_id employeeId name title practiceTitle subDepartment partTime requiresScheduling holidayRegime isIndigenous status appointment role';
const TARGET_EMPLOYEE_SELECT = '_id employeeId name status appointment requiresScheduling holidayRegime isIndigenous';

export const COMPENSATION_LIST_STATUSES = ['open', 'assigned', 'void', 'all'];

/** 補假、調移 API 的錯誤：status 是 HTTP 狀態碼，code 給前端對應訊息，message 是繁體中文 */
export class HolidayCompensationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HolidayCompensationError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new HolidayCompensationError(status, code, message);
}

function toId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) return toId(value._id);
  return typeof value.toString === 'function' ? value.toString() : String(value);
}

function isObjectId(value) {
  return typeof value === 'string' && Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value;
}

async function leanResult(query) {
  return query && typeof query.lean === 'function' ? query.lean() : query;
}

function dateKeyOf(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function keyToDate(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDaysKey(key, days) {
  return new Date(keyToDate(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function dayDistance(a, b) {
  return Math.round(Math.abs(keyToDate(a).getTime() - keyToDate(b).getTime()) / DAY_MS);
}

/** 'YYYY-MM-DD' -> { key, date }；格式不對或日期不存在回傳 null */
export function parseDayKey(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = keyToDate(text);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return { key: text, date };
}

function cleanNote(value, label = '備註') {
  const text = String(value ?? '').trim();
  if (text.length > MAX_NOTE_LENGTH) fail(400, 'NOTE_TOO_LONG', `${label}不可超過 ${MAX_NOTE_LENGTH} 個字`);
  return text;
}

function isDuplicateKeyOnly(err) {
  if (err?.code === 11000) return true;
  const writeErrors = err?.writeErrors || err?.result?.result?.writeErrors || [];
  return Array.isArray(writeErrors) && writeErrors.length > 0 && writeErrors.every((item) => (item?.code ?? item?.err?.code) === 11000);
}

/* ---------------------------- 補假義務的同步（由休假紀錄呼叫） ---------------------------- */

function emptySyncResult() {
  return { created: 0, voided: 0, reopened: 0, conflicts: 0 };
}

function addSyncResult(total, part) {
  for (const key of Object.keys(total)) total[key] += Number(part?.[key]) || 0;
  return total;
}

// 國定假日對這位員工是否仍是國定假日（含被公司挪移、個人調移到別天的）
function isStillStatutory(context, employeeId, holidayKey) {
  if (!context) return true;
  const verdict = isNationalHolidayFor(context, employeeId, holidayKey);
  return verdict.reason === 'statutory' || STATUTORY_NOT_HOLIDAY_REASONS.has(verdict.notHolidayReason);
}

/**
 * 依休假紀錄推算的觸發條件同步補假義務（可重複執行，不刪資料）：
 *  - 觸發條件成立、還沒有紀錄 -> 建立 open（upsert + $setOnInsert，兩個請求同時建立時重複鍵錯誤直接略過）；
 *  - open 但條件不成立 -> void（voidReason 由休假紀錄判斷：covered_by_roster／roster_changed／not_applicable）；
 *  - void 但條件又成立 -> 重新開啟；
 *  - assigned 一律不自動作廢：條件不成立、或排定的補假日現在是休息日／例假（assignedDateRest）時 conflict = true，都恢復時改回 false；
 *  - 本月的國定假日已經不是國定假日（行事曆改了）-> open 作廢（holiday_removed）、assigned 標 conflict；
 *  - 人資手動新增（origin manual）的不動。
 * ledger = { month, detections, docs, processedEmployeeIds, context }（休假紀錄內部的推算結果）。
 * 回傳 { created, voided, reopened, conflicts, writes }（writes = 實際送出的寫入筆數，休假紀錄據此決定要不要重新讀取）。
 */
export async function syncHolidayCompensationsForLedger({ ledger, now = new Date() } = {}) {
  const result = emptySyncResult();
  const range = parseLedgerMonth(ledger?.month);
  if (!range) return result;
  const startKey = range.start.toISOString().slice(0, 10);
  const detections = ledger?.detections || [];
  const docs = ledger?.docs || [];
  const processed = ledger?.processedEmployeeIds instanceof Set ? ledger.processedEmployeeIds : new Set();
  const docByKey = new Map(docs.map((doc) => [`${toId(doc.employee)}:${dateKeyOf(doc.holidayDate)}`, doc]));
  const ops = [];
  const seen = new Set();

  for (const detection of detections) {
    const key = `${detection.employeeId}:${detection.holidayDate}`;
    seen.add(key);
    // 班表還是草稿、本月還沒結束：不建立也不作廢，等班表定案
    if (detection.skip) continue;
    const doc = docByKey.get(key);
    if (!doc) {
      if (!detection.trigger) continue;
      ops.push({
        updateOne: {
          filter: { employee: detection.employeeId, holidayDate: keyToDate(detection.holidayDate) },
          update: {
            $setOnInsert: {
              status: 'open',
              origin: detection.origin,
              dayKindAtDetection: detection.dayKindAtDetection,
              holidayName: String(detection.holidayName || '').slice(0, 100),
              calendarDay: isObjectId(detection.calendarDayId) ? detection.calendarDayId : null,
              suggestedDate: detection.suggestedDate ? keyToDate(detection.suggestedDate) : null,
              conflict: false,
              createdBy: null,
            },
          },
          upsert: true,
        },
      });
      result.created += 1;
      continue;
    }
    if (doc.origin === 'manual') continue;
    if (doc.status === 'open' && !detection.trigger) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id, status: 'open' },
          update: { $set: { status: 'void', voidReason: detection.voidReason || 'not_applicable', voidedAt: now } },
        },
      });
      result.voided += 1;
    } else if (doc.status === 'void' && detection.trigger) {
      const $set = { status: 'open' };
      if (detection.suggestedDate) $set.suggestedDate = keyToDate(detection.suggestedDate);
      ops.push({
        updateOne: {
          filter: { _id: doc._id, status: 'void' },
          update: { $set, $unset: { voidReason: 1, voidedAt: 1 } },
        },
      });
      result.reopened += 1;
    } else if (doc.status === 'assigned') {
      // 觸發條件不成立，或排定的補假日之後被排成休息日／例假（員工並沒有因此多休一天）：都標成衝突請人確認
      const conflict = !detection.trigger || detection.assignedDateRest === true;
      if (Boolean(doc.conflict) !== conflict) {
        ops.push({ updateOne: { filter: { _id: doc._id, status: 'assigned' }, update: { $set: { conflict } } } });
        if (conflict) result.conflicts += 1;
      }
    }
  }

  // 本月的國定假日已經不是國定假日：只處理這次有推算過的員工（沒列入的員工不代表條件不成立）
  for (const doc of docs) {
    const employeeId = toId(doc.employee);
    const holidayKey = dateKeyOf(doc.holidayDate);
    const key = `${employeeId}:${holidayKey}`;
    if (!holidayKey || seen.has(key) || doc.origin === 'manual' || !processed.has(employeeId)) continue;
    if (holidayKey < startKey || holidayKey > range.lastKey) continue;
    // 仍是國定假日、只是被調移到別的月份：由那個月份的休假紀錄處理
    if (isStillStatutory(ledger?.context, employeeId, holidayKey)) continue;
    if (doc.status === 'open') {
      ops.push({
        updateOne: {
          filter: { _id: doc._id, status: 'open' },
          update: { $set: { status: 'void', voidReason: 'holiday_removed', voidedAt: now } },
        },
      });
      result.voided += 1;
    } else if (doc.status === 'assigned' && !doc.conflict) {
      ops.push({ updateOne: { filter: { _id: doc._id, status: 'assigned' }, update: { $set: { conflict: true } } } });
      result.conflicts += 1;
    }
  }

  if (!ops.length) return { ...result, writes: 0 };
  try {
    const written = await HolidayCompensation.bulkWrite(ops, { ordered: false });
    if (typeof written?.upsertedCount === 'number') result.created = written.upsertedCount;
  } catch (err) {
    // 兩個請求同時建立同一筆：唯一索引擋下的那一筆已經由另一個請求建立，其餘寫入照常完成
    if (!isDuplicateKeyOnly(err)) throw err;
    const upserted = err?.result?.upsertedCount ?? err?.result?.nUpserted;
    if (typeof upserted === 'number') result.created = upserted;
  }
  return { ...result, writes: ops.length };
}

/** 依月份重新計算一批員工的補假義務（每個月份都會推算一次休假紀錄並同步） */
export async function syncHolidayCompensationsForMonths({ months = [], employees = [], now = new Date() } = {}) {
  const total = emptySyncResult();
  if (!employees.length) return total;
  for (const month of months) {
    const ledger = await buildHolidayRestLedger({ month, employees, today: now, syncCompensations: true });
    addSyncResult(total, ledger?.sync);
  }
  return total;
}

function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * 每日排程：重新計算上個月與本月（台灣時間）的補假義務。
 * 涵蓋所有不是「離職員工」的員工，以及在這兩個月內離職的員工；每批最多 2000 人。
 */
export async function syncRecentHolidayCompensations({ now = new Date() } = {}) {
  const total = emptySyncResult();
  const currentMonth = String(toTaipeiDateKey(now) || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(currentMonth)) return total;
  const previousMonth = shiftMonth(currentMonth, -1);
  const months = [previousMonth, currentMonth];
  const since = new Date(`${previousMonth}-01T00:00:00+08:00`);
  const filter = {
    $or: [
      { status: { $ne: '離職員工' } },
      { status: '離職員工', 'appointment.resignationDate': { $gte: since } },
      { status: '離職員工', 'appointment.dismissalDate': { $gte: since } },
    ],
  };

  let lastId = null;
  for (;;) {
    const query = lastId ? { $and: [filter, { _id: { $gt: lastId } }] } : filter;
    let find = Employee.find(query);
    if (typeof find?.select === 'function') find = find.select(SYNC_EMPLOYEE_SELECT);
    if (typeof find?.sort === 'function') find = find.sort({ _id: 1 });
    if (typeof find?.limit === 'function') find = find.limit(SYNC_BATCH_SIZE);
    const batch = (await leanResult(find)) || [];
    if (!batch.length) break;
    addSyncResult(total, await syncHolidayCompensationsForMonths({ months, employees: batch, now }));
    if (batch.length < SYNC_BATCH_SIZE) break;
    lastId = batch[batch.length - 1]._id;
  }
  return total;
}

/** 月份區間（含頭尾，最多 12 個月）；不合法回傳 null */
export function listSyncMonths(from, to) {
  const start = parseLedgerMonth(from);
  const stop = parseLedgerMonth(to);
  if (!start || !stop || start.start > stop.start) return null;
  const months = [];
  for (let month = start.month; month <= stop.month; month = shiftMonth(month, 1)) {
    months.push(month);
    if (months.length > MAX_SYNC_MONTHS) break;
  }
  return months;
}

export { MAX_SYNC_MONTHS };

/* ---------------------------- 年度未排補假清單 ---------------------------- */

async function loadNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const nameById = new Map();
  if (!unique.length) return nameById;
  const people = (await leanResult(Employee.find({ _id: { $in: unique } }).select('name'))) || [];
  for (const person of people) nameById.set(toId(person._id), person.name || '');
  return nameById;
}

function serializeCompensation(doc, employee, nameById) {
  return {
    id: toId(doc._id),
    employeeId: toId(doc.employee),
    employeeNo: employee?.employeeId || '',
    name: employee?.name || '',
    subDepartmentName: employee?.subDepartment?.name || '',
    regime: resolveHolidayRegime(employee),
    holidayDate: dateKeyOf(doc.holidayDate),
    holidayName: doc.holidayName || '',
    origin: doc.origin,
    status: doc.status,
    suggestedDate: dateKeyOf(doc.suggestedDate),
    assignedDate: doc.status === 'assigned' ? dateKeyOf(doc.assignedDate) : null,
    agreementNote: doc.agreementNote || '',
    conflict: doc.conflict === true,
    assignedByName: nameById.get(toId(doc.assignedBy)) || '',
    assignedAt: doc.assignedAt || null,
    voidReason: doc.status === 'void' ? (doc.voidReason || null) : null,
    note: doc.note || '',
  };
}

/**
 * 年度的補假義務清單（依國定假日的年度），employees 是呼叫端已依權限範圍取出的員工。
 * status：open（預設，年度未排補假）／assigned／void／all。summary 一律是全部狀態的件數。
 */
export async function listHolidayCompensations({ employees = [], year, status = 'open' } = {}) {
  const numericYear = Number(year);
  const ids = employees.map((employee) => toId(employee._id)).filter(Boolean);
  const summary = { open: 0, assigned: 0, void: 0, conflict: 0 };
  if (!ids.length) return { year: numericYear, compensations: [], summary };
  let find = HolidayCompensation.find({
    employee: { $in: ids },
    holidayDate: { $gte: new Date(Date.UTC(numericYear, 0, 1)), $lt: new Date(Date.UTC(numericYear + 1, 0, 1)) },
  });
  if (typeof find?.sort === 'function') find = find.sort({ holidayDate: 1 });
  const docs = (await leanResult(find)) || [];
  for (const doc of docs) {
    if (summary[doc.status] !== undefined) summary[doc.status] += 1;
    if (doc.status === 'assigned' && doc.conflict === true) summary.conflict += 1;
  }
  const wanted = status === 'all' ? docs : docs.filter((doc) => doc.status === status);
  const nameById = await loadNames(wanted.map((doc) => toId(doc.assignedBy)));
  const employeeById = new Map(employees.map((employee) => [toId(employee._id), employee]));
  const compensations = wanted
    .map((doc) => serializeCompensation(doc, employeeById.get(toId(doc.employee)), nameById))
    .sort((a, b) => (
      String(a.holidayDate).localeCompare(String(b.holidayDate))
      || String(a.employeeNo).localeCompare(String(b.employeeNo), 'zh-Hant', { numeric: true })
    ));
  return { year: numericYear, compensations, summary };
}

/* ---------------------------- 排定、取消、手動新增補假 ---------------------------- */

// 員工某一天的班表性質（沒有班表回傳 undefined）
async function loadRosterKind(employeeId, dateKey) {
  const row = await leanResult(ShiftSchedule.findOne({ employee: employeeId, date: keyToDate(dateKey) }).select('shiftId'));
  if (!row) return undefined;
  const setting = await leanResult(AttendanceSetting.findOne());
  const shift = (setting?.shifts || []).find((item) => toId(item?._id) === toId(row.shiftId));
  return shift ? resolveShiftSemanticType(shift) : 'work';
}

async function loadTargetEmployee(employeeId) {
  const employee = await leanResult(Employee.findById(employeeId).select(TARGET_EMPLOYEE_SELECT));
  if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', '找不到這位員工');
  return employee;
}

// 補假日、調移日要是原本要上班的日子：有班表看班表（休、例不行）；行政人員沒有班表時依公司行事曆
// （週末、公司休息日、依政府調整放假的休息日都不行，不然員工並沒有因此多休一天）
function isOriginalWorkday(context, employee, dateKey, rosterKind) {
  if (rosterKind) return !REST_ROSTER_KINDS.has(rosterKind);
  if (resolveHolidayRegime(employee) === 'office') return officeDayKind(context, dateKey) === 'work';
  return true;
}

// 一天的 context（含該員工的個人調移與已排定的補假）
async function loadDayContext(employee, dateKey, rosterKind) {
  return loadHolidayContext({
    start: dateKey,
    end: addDaysKey(dateKey, 1),
    employees: [employee],
    rosterKindOf: (_id, key) => (key === dateKey ? rosterKind : undefined),
  });
}

async function findCompensation(id) {
  if (!isObjectId(String(id ?? ''))) fail(400, 'INVALID_ID', '補假紀錄編號不正確');
  const doc = await leanResult(HolidayCompensation.findById(id));
  if (!doc) fail(404, 'NOT_FOUND', '找不到這筆補假紀錄');
  return doc;
}

function plainDoc(doc) {
  return typeof doc?.toObject === 'function' ? doc.toObject() : doc;
}

/**
 * 排定補假日期。依序檢查：日期在國定假日前後 366 天內（OUT_OF_RANGE）、當天不是該員工的假日（ALREADY_HOLIDAY）、
 * 不是另一筆個人調移或補假的日子（DATE_TAKEN）、原本要上班（班表不是休息日／例假，行政人員沒有班表時依公司行事曆；TARGET_NOT_WORKDAY）、
 * 當天在職（NOT_EMPLOYED）。
 * authorize(員工 id) 由 controller 傳入，檢查登入者能不能處理這位員工。
 */
export async function assignHolidayCompensation({ id, assignedDate, agreementNote, actorId = null, authorize = null, now = new Date() } = {}) {
  const doc = await findCompensation(id);
  const employeeId = toId(doc.employee);
  if (authorize) await authorize(employeeId);
  if (doc.status === 'void') fail(409, 'COMPENSATION_VOID', '這筆補假義務已失效，不能排定');
  // 沒有送協商紀錄（例如只改日期）時保留原本的紀錄
  const note = agreementNote === undefined ? String(doc.agreementNote || '') : cleanNote(agreementNote, '協商紀錄');
  const holidayKey = dateKeyOf(doc.holidayDate);
  const target = parseDayKey(assignedDate);
  if (!target || !holidayKey || dayDistance(target.key, holidayKey) > MAX_DISTANCE_DAYS) {
    fail(400, 'OUT_OF_RANGE', `補假日期須在國定假日前後 ${MAX_DISTANCE_DAYS} 天內`);
  }

  const employee = await loadTargetEmployee(employeeId);
  const rosterKind = await loadRosterKind(employeeId, target.key);
  const context = await loadDayContext(employee, target.key, rosterKind);
  const verdict = isNationalHolidayFor(context, employee, target.key, { rosterKind });
  const ownCompensation = verdict.reason === 'compensation' && verdict.sourceId === toId(doc._id);
  if (verdict.holiday && verdict.reason !== 'swap' && verdict.reason !== 'compensation') {
    fail(400, 'ALREADY_HOLIDAY', '這一天已經是該員工的假日');
  }
  if (verdict.reason === 'swap' || (verdict.reason === 'compensation' && !ownCompensation)) {
    fail(400, 'DATE_TAKEN', '這一天已排了其他補假或個人調移');
  }
  if (!isOriginalWorkday(context, employee, target.key, rosterKind)) fail(400, 'TARGET_NOT_WORKDAY', '補假須排在原本要上班的日子');
  if (buildTenureCheck(employee, { hasRows: true })(target.key)) fail(400, 'NOT_EMPLOYED', '員工在這一天不在職');

  const updated = await HolidayCompensation.findOneAndUpdate(
    { _id: doc._id, status: { $in: ['open', 'assigned'] } },
    {
      $set: {
        status: 'assigned',
        assignedDate: target.date,
        assignedBy: actorId || null,
        assignedAt: now,
        agreementNote: note,
        conflict: false,
      },
    },
    { new: true },
  );
  if (!updated) fail(409, 'COMPENSATION_VOID', '這筆補假義務已失效，不能排定');
  const plain = plainDoc(updated);
  return serializeCompensation(plain, employee, await loadNames([toId(plain.assignedBy)]));
}

/** 取消排定：回到待排補假 */
export async function unassignHolidayCompensation({ id, authorize = null } = {}) {
  const doc = await findCompensation(id);
  if (authorize) await authorize(toId(doc.employee));
  if (doc.status !== 'assigned') fail(409, 'NOT_ASSIGNED', '這筆補假尚未排定');
  const updated = await HolidayCompensation.findOneAndUpdate(
    { _id: doc._id, status: 'assigned' },
    { $set: { status: 'open', assignedDate: null, assignedBy: null, assignedAt: null, conflict: false } },
    { new: true },
  );
  if (!updated) fail(409, 'NOT_ASSIGNED', '這筆補假尚未排定');
  const employee = await leanResult(Employee.findById(toId(doc.employee)).select(TARGET_EMPLOYEE_SELECT));
  return serializeCompensation(plainDoc(updated), employee, new Map());
}

/** 人資手動新增補假義務：日期必須是該員工的國定假日（原始日期） */
export async function createManualHolidayCompensation({ employeeId, holidayDate, note, actorId = null } = {}) {
  const id = String(employeeId ?? '').trim();
  if (!isObjectId(id)) fail(400, 'INVALID_EMPLOYEE', '員工編號不正確');
  const holiday = parseDayKey(holidayDate);
  if (!holiday) fail(400, 'INVALID_DATE', '日期格式不正確（YYYY-MM-DD）');
  const text = cleanNote(note);
  const employee = await loadTargetEmployee(id);
  const context = await loadDayContext(employee, holiday.key, undefined);
  const verdict = isNationalHolidayFor(context, employee, holiday.key);
  if (verdict.reason !== 'statutory' && !STATUTORY_NOT_HOLIDAY_REASONS.has(verdict.notHolidayReason)) {
    fail(400, 'NOT_STATUTORY', '這一天不是該員工的國定假日');
  }
  try {
    const created = await HolidayCompensation.create({
      employee: id,
      holidayDate: holiday.date,
      holidayName: String(verdict.name || '').slice(0, 100),
      calendarDay: isObjectId(verdict.sourceId) ? verdict.sourceId : null,
      origin: 'manual',
      dayKindAtDetection: 'manual',
      status: 'open',
      note: text,
      createdBy: actorId || null,
    });
    return serializeCompensation(plainDoc(created), employee, new Map());
  } catch (err) {
    if (err?.code === 11000) fail(409, 'DUPLICATE', '這位員工的這個國定假日已有補假紀錄');
    throw err;
  }
}

/* ---------------------------- 個人調移 ---------------------------- */

function serializeSwap(doc, employee, nameById = new Map()) {
  return {
    id: toId(doc._id),
    employeeId: toId(doc.employee),
    employeeNo: employee?.employeeId || '',
    name: employee?.name || '',
    originalDate: dateKeyOf(doc.originalDate),
    originalName: doc.originalName || '',
    targetDate: dateKeyOf(doc.targetDate),
    status: doc.status,
    consent: {
      method: doc.consent?.method || '',
      consentedAt: doc.consent?.consentedAt ? toTaipeiDateKey(doc.consent.consentedAt) : null,
      evidenceRef: doc.consent?.evidenceRef || '',
      note: doc.consent?.note || '',
    },
    reason: doc.reason || '',
    createdByName: nameById.get(toId(doc.createdBy)) || '',
    createdAt: doc.createdAt || null,
    revokedAt: doc.revokedAt || null,
    revokeReason: doc.revokeReason || '',
  };
}

/** 個人調移清單；employees 是呼叫端依權限範圍取出的員工，year 依原日期或調移日期篩選 */
export async function listHolidaySwaps({ employees = [], year = null, status = 'active' } = {}) {
  const ids = employees.map((employee) => toId(employee._id)).filter(Boolean);
  if (!ids.length) return { swaps: [] };
  const filter = { employee: { $in: ids } };
  if (status !== 'all') filter.status = 'active';
  const numericYear = Number(year);
  if (year !== null && year !== undefined && year !== '' && Number.isInteger(numericYear)) {
    const range = { $gte: new Date(Date.UTC(numericYear, 0, 1)), $lt: new Date(Date.UTC(numericYear + 1, 0, 1)) };
    filter.$or = [{ originalDate: range }, { targetDate: range }];
  }
  let find = HolidaySwap.find(filter);
  if (typeof find?.sort === 'function') find = find.sort({ originalDate: 1 });
  const docs = (await leanResult(find)) || [];
  const nameById = await loadNames(docs.map((doc) => toId(doc.createdBy)));
  const employeeById = new Map(employees.map((employee) => [toId(employee._id), employee]));
  return { swaps: docs.map((doc) => serializeSwap(doc, employeeById.get(toId(doc.employee)), nameById)) };
}

function parseConsent(consent, now) {
  const source = consent && typeof consent === 'object' ? consent : {};
  const method = String(source.method ?? '').trim();
  const evidenceRef = String(source.evidenceRef ?? '').trim();
  const consentedKey = source.consentedAt ? toTaipeiDateKey(source.consentedAt) : null;
  const todayKey = toTaipeiDateKey(now);
  if (!CONSENT_METHOD_VALUES.includes(method) || !evidenceRef || !consentedKey || (todayKey && consentedKey > todayKey)) {
    fail(400, 'CONSENT_REQUIRED', '個人調移必須有員工本人的同意紀錄（簽名、同意書或電子紀錄）');
  }
  if (evidenceRef.length > MAX_EVIDENCE_LENGTH) fail(400, 'CONSENT_REQUIRED', `同意文件編號或存放位置不可超過 ${MAX_EVIDENCE_LENGTH} 個字`);
  return { method, consentedAt: keyToDate(consentedKey), evidenceRef, note: cleanNote(source.note, '同意備註') };
}

/**
 * 建立個人調移。依序檢查：本人同意紀錄（CONSENT_REQUIRED）、原日期是該員工的國定假日（指定應放假日 DESIGNATED_NOT_SWAPPABLE，
 * 其他 NOT_STATUTORY）、沒有被公司統一調移（MOVE_EXISTS）、沒有調移過（ALREADY_SWAPPED）、調移日不是假日（ALREADY_HOLIDAY）、
 * 不是另一筆調移或補假的日子（DATE_TAKEN）、原本要上班（班表不是休息日／例假，行政人員沒有班表時依公司行事曆；TARGET_NOT_WORKDAY）、
 * 相隔 366 天內（OUT_OF_RANGE）。
 */
export async function createHolidaySwap({ employeeId, originalDate, targetDate, reason, consent, actorId = null, now = new Date() } = {}) {
  const id = String(employeeId ?? '').trim();
  if (!isObjectId(id)) fail(400, 'INVALID_EMPLOYEE', '員工編號不正確');
  const parsedConsent = parseConsent(consent, now);
  const original = parseDayKey(originalDate);
  const target = parseDayKey(targetDate);
  if (!original || !target) fail(400, 'INVALID_DATE', '日期格式不正確（YYYY-MM-DD）');
  if (original.key === target.key) fail(400, 'INVALID_DATE', '調移日不能和原日期相同');
  const reasonText = cleanNote(reason, '原因');

  const employee = await loadTargetEmployee(id);
  const rosterKind = await loadRosterKind(id, target.key);
  const [from, to] = original.key < target.key ? [original.key, target.key] : [target.key, original.key];
  const context = await loadHolidayContext({
    start: from,
    end: addDaysKey(to, 1),
    employees: [employee],
    rosterKindOf: (_id, key) => (key === target.key ? rosterKind : undefined),
  });

  const originalVerdict = isNationalHolidayFor(context, employee, original.key);
  if (originalVerdict.reason !== 'statutory') {
    if (originalVerdict.reason === 'designated' || String(originalVerdict.notHolidayReason || '').startsWith('designated')) {
      fail(400, 'DESIGNATED_NOT_SWAPPABLE', '選舉、公投等指定應放假日不可調移');
    }
    if (originalVerdict.notHolidayReason === 'moved_away') fail(409, 'MOVE_EXISTS', '這個國定假日已由公司統一調移，不能再個別調移');
    if (originalVerdict.notHolidayReason === 'swapped_away') fail(409, 'ALREADY_SWAPPED', '這位員工的這個國定假日已經調移過');
    fail(400, 'NOT_STATUTORY', '原日期不是該員工的國定假日');
  }
  const targetVerdict = isNationalHolidayFor(context, employee, target.key, { rosterKind });
  if (targetVerdict.holiday && targetVerdict.reason !== 'swap' && targetVerdict.reason !== 'compensation') {
    fail(400, 'ALREADY_HOLIDAY', '這一天已經是該員工的假日');
  }
  if (targetVerdict.reason === 'swap' || targetVerdict.reason === 'compensation') {
    fail(400, 'DATE_TAKEN', '這一天已排了其他補假或個人調移');
  }
  if (!isOriginalWorkday(context, employee, target.key, rosterKind)) fail(400, 'TARGET_NOT_WORKDAY', '調移日須是原本要上班的日子');
  if (dayDistance(original.key, target.key) > MAX_DISTANCE_DAYS) {
    fail(400, 'OUT_OF_RANGE', `調移日須在國定假日前後 ${MAX_DISTANCE_DAYS} 天內`);
  }

  try {
    const created = await HolidaySwap.create({
      employee: id,
      originalDate: original.date,
      originalName: String(originalVerdict.name || '').slice(0, 100),
      targetDate: target.date,
      status: 'active',
      consent: parsedConsent,
      reason: reasonText,
      createdBy: actorId || null,
    });
    return serializeSwap(plainDoc(created), employee, await loadNames([toId(actorId)]));
  } catch (err) {
    // 部分唯一索引（同一員工同一國定假日只能有一筆有效調移）：同時送出兩次的那一筆
    if (err?.code === 11000) fail(409, 'ALREADY_SWAPPED', '這位員工的這個國定假日已經調移過');
    throw err;
  }
}

/** 撤銷個人調移（必填原因）：紀錄保留，原日期恢復為國定假日 */
export async function revokeHolidaySwap({ id, reason, actorId = null, authorize = null, now = new Date() } = {}) {
  if (!isObjectId(String(id ?? ''))) fail(400, 'INVALID_ID', '調移紀錄編號不正確');
  const text = cleanNote(reason, '撤銷原因');
  if (!text) fail(400, 'REASON_REQUIRED', '撤銷個人調移需填寫原因');
  const doc = await leanResult(HolidaySwap.findById(id));
  if (!doc) fail(404, 'NOT_FOUND', '找不到這筆個人調移');
  if (authorize) await authorize(toId(doc.employee));
  if (doc.status !== 'active') fail(409, 'ALREADY_REVOKED', '這筆個人調移已經撤銷');
  const updated = await HolidaySwap.findOneAndUpdate(
    { _id: doc._id, status: 'active' },
    { $set: { status: 'revoked', revokedBy: actorId || null, revokedAt: now, revokeReason: text } },
    { new: true },
  );
  if (!updated) fail(409, 'ALREADY_REVOKED', '這筆個人調移已經撤銷');
  const employee = await leanResult(Employee.findById(toId(doc.employee)).select(TARGET_EMPLOYEE_SELECT));
  return serializeSwap(plainDoc(updated), employee, new Map());
}

export const __testUtils = { isDuplicateKeyOnly, shiftMonth, dayDistance };
