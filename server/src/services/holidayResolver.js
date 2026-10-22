/**
 * 國定假日判斷的唯一入口：「這一天對這位員工是不是國定假日、為什麼」。
 *
 * 排班頁標頭、排班規範（連續 7 日）、班表匯入提醒、加班費日別、國定假日休假紀錄與匯出都呼叫這裡，
 * 不再各自從假日名稱或類型文字猜。行事曆每一筆的類型 kind 見 holidayCalendarRules.js：
 *  - 國定假日（statutory）對所有員工都是假日，包括落在週末、落在員工自己休息日的日子；
 *  - 公務機關補假（gov_makeup_off）只是政府機關的補假：行政人員在調休存摺上線（officeGovMakeupCutover）之前照舊自動放假，
 *    之後只是「建議調休日」，國定假日落在週末改為存入調休（CompensatoryCredit），由員工發起調休簽核；輪班人員一律依班表；
 *  - 公司挪移（HolidayMoveSetting）、個人調移（HolidaySwap）讓原日期變成一般工作日、目標日變成假日；
 *  - 整天的調休（調休簽核核准、HR 指定日期，見 compensatoryLeaveService）當天是該員工的假日（reason = compensation）；
 *  - 指定應放假日（designated）只適用當天原應出勤、沒有被排除的員工，不補假、不可調移；
 *  - 調整放假、補行上班、公司休息日／上班日永遠不是國定假日（只影響行政人員的上班日／休息日）。
 * createHolidayContext 是純函式（同步、不碰資料庫），loadHolidayContext 一次把需要的資料讀齊：
 * 查詢次數固定、與員工人數無關，不跨請求快取（多個 PM2 執行個體也安全），排班或算薪資時絕不連線政府資料。
 */
import Holiday from '../models/Holiday.js';
import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import CalendarYear from '../models/CalendarYear.js';
import CompensatoryCredit from '../models/CompensatoryCredit.js';
import CompensatoryLeaveState, { COMPENSATORY_LEAVE_STATE_KEY } from '../models/CompensatoryLeaveState.js';
import HolidaySwap from '../models/HolidaySwap.js';
import Employee from '../models/Employee.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import {
  HOLIDAY_KINDS,
  HOLIDAY_KIND_LABELS,
  effectiveHolidayKind,
  fixedStatutoryDaysForYear,
  resolveHolidayRegime,
  weekdayOfKey,
} from './holidayCalendarRules.js';
import { isEmptyWeekendHoliday } from './countedHolidayService.js';
import { resolveShiftSemanticType } from './shiftSemanticService.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

export const HOLIDAY_REASONS = ['statutory', 'company_move', 'swap', 'compensation', 'gov_makeup', 'designated', 'indigenous'];
export const NOT_HOLIDAY_REASONS = ['moved_away', 'swapped_away', 'designated_excluded', 'designated_not_applicable'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// 補假與國定假日、調移與原日期的連結最多相隔 7 天：整年度之外再多讀前後 7 天
const LINK_WINDOW_DAYS = 7;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INDIGENOUS_LEAVE_PATTERN = /原民假|原住民歲時祭儀假|歲時祭儀/;
// 指定應放假日：當天原應出勤（排了上班、國或請假）才適用；未排班、休、例不適用
const DESIGNATED_APPLICABLE_ROSTER_KINDS = new Set(['work', 'holiday', 'leave']);
const HEADER_DISPLAY_ORDER = { holiday: 0, designated: 1, moved_away: 2, gov_info: 3, company_off: 4, company_workday: 5 };

function toId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (value._id !== undefined && value._id !== value) return toId(value._id);
    if (value.id !== undefined && value.id !== value) return toId(value.id);
    return '';
  }
  return String(value);
}

// 只有 id（字串或 ObjectId），不是員工資料
function isBareId(value) {
  return typeof value === 'string' || (value != null && typeof value === 'object' && typeof value.toHexString === 'function');
}

/** Date（UTC 午夜）或 'YYYY-MM-DD' -> 'YYYY-MM-DD'；不合法回傳 '' */
function toKey(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && DATE_KEY_PATTERN.test(value.trim())) {
    const key = value.trim();
    const check = new Date(`${key}T00:00:00.000Z`);
    return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === key ? key : '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function keyToDate(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDays(key, days) {
  return new Date(keyToDate(key).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function yearOfKey(key) {
  return Number(String(key).slice(0, 4));
}

function monthDayText(key) {
  return `${key.slice(5, 7)}/${key.slice(8, 10)}`;
}

function listKeys(startKey, endKey) {
  const keys = [];
  for (let key = startKey; key < endKey; key = addDays(key, 1)) keys.push(key);
  return keys;
}

async function leanResult(query) {
  if (!query) return [];
  const value = typeof query.lean === 'function' ? await query.lean() : await query;
  return value || [];
}

async function leanOne(query) {
  if (!query) return null;
  const value = typeof query.lean === 'function' ? await query.lean() : await query;
  return value || null;
}

function withSelect(query, fields) {
  return query && typeof query.select === 'function' ? query.select(fields) : query;
}

function defaultNameOf(kind) {
  return HOLIDAY_KIND_LABELS[kind] || '國定假日';
}

function normalizeRow(row) {
  if (!row || row.archived === true) return null;
  const date = toKey(row.date);
  if (!date) return null;
  // 舊版一鍵匯入留下的「說明為空的週末」只是一般週末
  if (isEmptyWeekendHoliday(row)) return null;
  const kind = effectiveHolidayKind(row);
  if (!HOLIDAY_KINDS.includes(kind)) return null;
  return {
    id: toId(row._id) || null,
    date,
    kind,
    name: String(row.name || row.description || row.desc || '').trim() || defaultNameOf(kind),
    statutoryKey: String(row.statutoryKey || ''),
    compensatesDate: toKey(row.compensatesDate) || null,
    compensatesName: String(row.compensatesName || '').trim(),
    excludedEmployees: new Set((row.excludedEmployees || []).map(toId).filter(Boolean)),
    needsReview: row.needsReview === true,
    synthetic: row.synthetic === true,
  };
}

function syntheticStatutoryRow({ date, key, name }) {
  return {
    id: null,
    date,
    kind: 'statutory',
    name,
    statutoryKey: key,
    compensatesDate: null,
    compensatesName: '',
    excludedEmployees: new Set(),
    needsReview: false,
    synthetic: true,
  };
}

function minDocumentYear(yearDocs) {
  let min = null;
  for (const year of yearDocs.keys()) if (min === null || year < min) min = year;
  return min;
}

/**
 * 沒有建立行事曆的年度用固定日期的國定假日暫代（農曆與節氣假日無法推算，不列入），條件全部成立才套用：
 * 這一年沒有年度文件、沒有任何有效資料，而且更早的年度有年度文件（全新系統、測試環境不會憑空產生假日）。
 */
function isSyntheticYear(yearDocs, yearsWithRows, year) {
  if (yearDocs.has(year) || yearsWithRows.has(year)) return false;
  const min = minDocumentYear(yearDocs);
  return min !== null && min < year;
}

/**
 * 依已經讀好的資料建立判斷用的 context（純函式、同步，測試與其他服務可以直接用記憶體資料建立）。
 * rows：Holiday 資料（含舊資料，kind 依 effectiveHolidayKind 判斷）；years：CalendarYear 文件；
 * moves：HolidayMoveSetting；credits：調休存摺（CompensatoryCredit，整天調休的日子是假日）；
 * compensations：舊格式的已排定補假（{ employee, holidayDate, assignedDate, status: 'assigned' }，記憶體資料用；資料庫已改讀 credits）；
 * swaps：HolidaySwap；officeGovMakeupCutover：行政人員公務機關補假日停止自動放假的第一天（YYYY-MM-DD，沒有就一律照舊放假）；
 * employees：員工資料或 id；rosterKindOf(員工 id, 日期) -> 班別性質（work/rest_day/regular_rest/holiday/leave/none）；
 * leaveTypeOf(員工 id, 日期) -> 請假假別（判斷原住民族歲時祭儀用）。
 */
export function createHolidayContext({
  start,
  end,
  rows = [],
  years = [],
  moves = [],
  compensations = [],
  credits = [],
  swaps = [],
  employees = [],
  rosterKindOf = null,
  leaveTypeOf = null,
  today = new Date(),
  designatedRosterKinds = null,
  officeGovMakeupCutover = null,
} = {}) {
  const startKey = toKey(start);
  const endKey = toKey(end);
  if (!startKey || !endKey || endKey < startKey) throw new Error('invalid holiday context range');
  const lastKey = endKey > startKey ? addDays(endKey, -1) : startKey;

  const yearDocs = new Map();
  for (const doc of years || []) {
    const year = Number(doc?.year);
    if (Number.isInteger(year)) yearDocs.set(year, doc);
  }

  const normalizedRows = (rows || [])
    .map(normalizeRow)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const yearsWithRows = new Set(normalizedRows.map((row) => yearOfKey(row.date)));
  const syntheticYears = new Set();
  for (let year = yearOfKey(startKey); year <= yearOfKey(lastKey); year += 1) {
    if (!isSyntheticYear(yearDocs, yearsWithRows, year)) continue;
    syntheticYears.add(year);
    for (const fixed of fixedStatutoryDaysForYear(year)) normalizedRows.push(syntheticStatutoryRow(fixed));
  }
  normalizedRows.sort((a, b) => a.date.localeCompare(b.date));

  // 同一天同一類型只取一筆（轉換前的重複舊資料）
  const byKind = Object.fromEntries(HOLIDAY_KINDS.map((kind) => [kind, new Map()]));
  for (const row of normalizedRows) {
    if (!byKind[row.kind].has(row.date)) byKind[row.kind].set(row.date, row);
  }

  // 公司挪移：來源日必須是有效的國定假日才算，其餘略過並記在 warnings（可以跨月）
  const warnings = [];
  const movesBySource = new Map();
  const movesByTarget = new Map();
  for (const move of moves || []) {
    if (move?.enableHolidayMove === false) continue;
    const source = toKey(move?.sourceDate);
    const target = toKey(move?.targetDate);
    if (!source || !target || source === target) continue;
    const moveId = toId(move?._id) || null;
    const sourceRow = byKind.statutory.get(source);
    if (!sourceRow) {
      warnings.push({ code: 'MOVE_SOURCE_NOT_STATUTORY', moveId, sourceDate: source, targetDate: target });
      continue;
    }
    if (movesBySource.has(source) || movesByTarget.has(target)) {
      warnings.push({ code: 'MOVE_DUPLICATE', moveId, sourceDate: source, targetDate: target });
      continue;
    }
    const entry = { id: moveId, source, target, row: sourceRow };
    movesBySource.set(source, entry);
    movesByTarget.set(target, entry);
  }

  const swapsByEmployee = new Map();
  for (const swap of swaps || []) {
    if (swap?.status && swap.status !== 'active') continue;
    const employeeId = toId(swap?.employee);
    const original = toKey(swap?.originalDate);
    const target = toKey(swap?.targetDate);
    if (!employeeId || !original || !target || original === target) continue;
    if (!swapsByEmployee.has(employeeId)) swapsByEmployee.set(employeeId, { byOriginal: new Map(), byTarget: new Map() });
    const bucket = swapsByEmployee.get(employeeId);
    if (bucket.byOriginal.has(original) || bucket.byTarget.has(target)) continue;
    const entry = {
      id: toId(swap._id) || null,
      employeeId,
      original,
      target,
      name: String(swap.originalName || '').trim() || byKind.statutory.get(original)?.name || defaultNameOf('statutory'),
    };
    bucket.byOriginal.set(original, entry);
    bucket.byTarget.set(target, entry);
  }

  // 員工的補假／整天調休：byAssigned（那一天是假日）、byHoliday（國定假日已經用哪一天補）
  const compensationsByEmployee = new Map();
  const bucketOf = (employeeId) => {
    if (!compensationsByEmployee.has(employeeId)) {
      compensationsByEmployee.set(employeeId, { byAssigned: new Map(), byHoliday: new Map() });
    }
    return compensationsByEmployee.get(employeeId);
  };
  for (const compensation of compensations || []) {
    if (compensation?.status && compensation.status !== 'assigned') continue;
    const employeeId = toId(compensation?.employee);
    const holidayDate = toKey(compensation?.holidayDate);
    const assignedDate = toKey(compensation?.assignedDate);
    if (!employeeId || !holidayDate || !assignedDate) continue;
    const bucket = bucketOf(employeeId);
    if (bucket.byAssigned.has(assignedDate) || bucket.byHoliday.has(holidayDate)) continue;
    const entry = {
      id: toId(compensation._id) || null,
      employeeId,
      holidayDate,
      assignedDate,
      holidayName: String(compensation.holidayName || '').trim() || byKind.statutory.get(holidayDate)?.name || defaultNameOf('statutory'),
      calendarDayId: toId(compensation.calendarDay) || null,
      via: 'assigned',
      requestId: null,
    };
    bucket.byAssigned.set(assignedDate, entry);
    bucket.byHoliday.set(holidayDate, entry);
  }
  // 調休存摺：每一筆使用紀錄的整天調休日都是假日；HR 指定的日子排在前面（國定假日「補到哪一天」優先顯示它）
  for (const credit of credits || []) {
    if (!credit || credit.status === 'void') continue;
    const employeeId = toId(credit.employee);
    if (!employeeId) continue;
    const holidayDate = toKey(credit.holidayDate) || null;
    const holidayName = String(credit.holidayName || '').trim()
      || (holidayDate ? byKind.statutory.get(holidayDate)?.name || '' : '');
    const usages = [...(credit.usages || [])]
      .sort((a, b) => (a?.kind === 'hr_assigned' ? 0 : 1) - (b?.kind === 'hr_assigned' ? 0 : 1));
    for (const usage of usages) {
      for (const date of [...(usage?.fullDayDates || [])].sort()) {
        const assignedDate = toKey(date);
        if (!assignedDate) continue;
        const bucket = bucketOf(employeeId);
        const entry = {
          id: toId(credit._id) || null,
          employeeId,
          holidayDate,
          assignedDate,
          holidayName,
          calendarDayId: toId(credit.calendarDay) || null,
          via: usage.kind === 'hr_assigned' ? 'hr_assigned' : 'comp_leave',
          requestId: toId(usage.approvalRequest) || null,
        };
        if (!bucket.byAssigned.has(assignedDate)) bucket.byAssigned.set(assignedDate, entry);
        if (holidayDate && !bucket.byHoliday.has(holidayDate)) bucket.byHoliday.set(holidayDate, entry);
      }
    }
  }

  const employeesById = new Map();
  for (const employee of employees || []) {
    const id = toId(employee);
    if (!id) continue;
    if (isBareId(employee)) {
      if (!employeesById.has(id)) employeesById.set(id, { _id: id });
    } else {
      employeesById.set(id, employee);
    }
  }

  return {
    start: startKey,
    end: endKey,
    today: toTaipeiDateKey(today) || toKey(new Date()),
    rows: normalizedRows,
    byKind,
    yearDocs,
    yearsWithRows,
    syntheticYears,
    movesBySource,
    movesByTarget,
    swapsByEmployee,
    compensationsByEmployee,
    employeesById,
    rosterKindOf: typeof rosterKindOf === 'function' ? rosterKindOf : null,
    leaveTypeOf: typeof leaveTypeOf === 'function' ? leaveTypeOf : null,
    designatedRosterKinds: designatedRosterKinds instanceof Map ? designatedRosterKinds : null,
    officeGovMakeupCutover: toKey(officeGovMakeupCutover) || null,
    warnings,
  };
}

/**
 * 從資料庫讀齊 [start, end) 需要的資料再建立 context。
 * 最多 3 輪查詢、次數固定（與員工人數無關），不連線外部；資料庫錯誤直接往外丟。
 * 呼叫端要把之後會問到的員工都放進 employees；不在 context 裡的員工只會得到行事曆層級的答案（沒有個人調移與補假）。
 */
export async function loadHolidayContext({
  start,
  end,
  employees = [],
  rosterKindOf = null,
  leaveTypeOf = null,
  today = new Date(),
} = {}) {
  const startKey = toKey(start);
  const endKey = toKey(end);
  if (!startKey || !endKey || endKey < startKey) throw new Error('invalid holiday context range');
  const lastKey = endKey > startKey ? addDays(endKey, -1) : startKey;
  const firstYear = yearOfKey(startKey);
  const lastYear = yearOfKey(lastKey);

  const inputs = (employees || []).filter((employee) => toId(employee));
  const validIds = [...new Set(inputs.map(toId).filter((id) => OBJECT_ID_PATTERN.test(id)))];
  // 只有 id 的員工才需要讀假日制度；不是 ObjectId 的 id 不查詢，一律當作輪班人員
  const missingIds = [...new Set(inputs.filter(isBareId).map(toId).filter((id) => OBJECT_ID_PATTERN.test(id)))];
  const personalFrom = keyToDate(addDays(startKey, -LINK_WINDOW_DAYS));
  const personalTo = keyToDate(addDays(endKey, LINK_WINDOW_DAYS));
  const personalRange = { $gte: personalFrom, $lt: personalTo };

  const personalKeyRange = { $gte: addDays(startKey, -LINK_WINDOW_DAYS), $lt: addDays(endKey, LINK_WINDOW_DAYS) };

  const [moves, years, credits, swaps, fetchedEmployees, state] = await Promise.all([
    leanResult(HolidayMoveSetting.find({ enableHolidayMove: true })),
    leanResult(CalendarYear.find({})),
    validIds.length
      ? leanResult(CompensatoryCredit.find({
        employee: { $in: validIds },
        status: { $ne: 'void' },
        // 整天調休日在範圍內（當天是假日），或來源的國定假日在範圍內（休假紀錄要知道它用哪一天調休，可能隔好幾個月）
        $or: [{ 'usages.fullDayDates': personalKeyRange }, { holidayDate: personalRange }],
      }))
      : [],
    validIds.length
      ? leanResult(HolidaySwap.find({
        employee: { $in: validIds },
        status: 'active',
        $or: [{ originalDate: personalRange }, { targetDate: personalRange }],
      }))
      : [],
    missingIds.length
      ? leanResult(withSelect(Employee.find({ _id: { $in: missingIds } }), '_id holidayRegime requiresScheduling isIndigenous'))
      : [],
    leanOne(withSelect(CompensatoryLeaveState.findOne({ key: COMPENSATORY_LEAVE_STATE_KEY }), 'officeGovMakeupCutover')),
  ]);

  // 整個年度（約 40 筆）都讀：才知道年度有沒有資料，補假與國定假日的連結也能跨月、跨年
  const windowStart = new Date(Date.UTC(firstYear, 0, 1) - LINK_WINDOW_DAYS * MS_PER_DAY);
  const windowEnd = new Date(Date.UTC(lastYear + 1, 0, 1) + LINK_WINDOW_DAYS * MS_PER_DAY);
  const outsideDates = new Set();
  const addOutside = (value) => {
    const key = toKey(value);
    if (!key) return;
    const date = keyToDate(key);
    if (date < windowStart || date >= windowEnd) outsideDates.add(key);
  };
  for (const move of moves || []) {
    addOutside(move?.sourceDate);
    addOutside(move?.targetDate);
  }
  for (const swap of swaps || []) addOutside(swap?.originalDate);
  const dateWindow = { $gte: windowStart, $lt: windowEnd };
  const holidayFilter = outsideDates.size
    ? { archived: { $ne: true }, $or: [{ date: dateWindow }, { date: { $in: [...outsideDates].sort().map(keyToDate) } }] }
    : { archived: { $ne: true }, date: dateWindow };
  const rows = await leanResult(Holiday.find(holidayFilter));

  // 指定應放假日要知道當天有沒有排班：呼叫端沒有提供班表時才讀那幾天的班表
  let designatedRosterKinds = null;
  if (typeof rosterKindOf !== 'function' && validIds.length) {
    const designatedDates = [...new Set((rows || [])
      .filter((row) => row && row.archived !== true && effectiveHolidayKind(row) === 'designated')
      .map((row) => toKey(row.date))
      .filter((key) => key && key >= startKey && key < endKey))];
    if (designatedDates.length) {
      const [scheduleRows, setting] = await Promise.all([
        leanResult(withSelect(ShiftSchedule.find({
          employee: { $in: validIds },
          date: { $in: designatedDates.map(keyToDate) },
        }), 'employee date shiftId')),
        leanOne(AttendanceSetting.findOne()),
      ]);
      const shiftById = new Map((setting?.shifts || []).map((shift) => [toId(shift?._id), shift]));
      designatedRosterKinds = new Map();
      for (const row of scheduleRows || []) {
        const key = toKey(row?.date);
        const employeeId = toId(row?.employee);
        if (!key || !employeeId) continue;
        const shift = shiftById.get(toId(row.shiftId));
        designatedRosterKinds.set(`${employeeId}:${key}`, shift ? resolveShiftSemanticType(shift) : 'work');
      }
    }
  }

  const fetchedById = new Map((fetchedEmployees || []).map((employee) => [toId(employee?._id), employee]));
  const mergedEmployees = inputs.map((employee) => (isBareId(employee) ? (fetchedById.get(toId(employee)) || toId(employee)) : employee));

  return createHolidayContext({
    start: startKey,
    end: endKey,
    rows,
    years,
    moves,
    credits,
    swaps,
    employees: mergedEmployees,
    rosterKindOf,
    leaveTypeOf,
    today,
    designatedRosterKinds,
    officeGovMakeupCutover: state?.officeGovMakeupCutover || null,
  });
}

function followAdjustments(context, year) {
  return context?.yearDocs?.get(year)?.followGovernmentAdjustments === true;
}

function yearInfo(context, year) {
  const doc = context.yearDocs.get(year) || null;
  let state = 'none';
  if (doc) state = doc.state === 'approved' ? 'approved' : 'draft';
  else if (context.yearsWithRows.has(year)) state = 'draft';
  return {
    year,
    state,
    migrated: doc?.migrated === true,
    approvedAt: doc?.approvedAt ?? null,
    followGovernmentAdjustments: doc?.followGovernmentAdjustments === true,
    synthetic: context.syntheticYears.has(year) || isSyntheticYear(context.yearDocs, context.yearsWithRows, year),
  };
}

function isProvisionalDate(context, dateKey) {
  return yearInfo(context, yearOfKey(dateKey)).state !== 'approved';
}

// 呼叫端帶的員工資料優先；只有 id 或欄位不完整時用 context 裡讀到的資料
function resolveEmployee(context, employee) {
  const id = toId(employee);
  const own = employee && typeof employee === 'object' && !isBareId(employee) ? employee : null;
  const known = id ? context.employeesById.get(id) : null;
  const hasFields = (value) => value && (
    value.holidayRegime !== undefined || value.requiresScheduling !== undefined || value.isIndigenous !== undefined
  );
  const info = [own, known].find(hasFields) || own || known || null;
  return { id, info };
}

function rosterKindFor(context, employeeId, dateKey, option) {
  if (option !== undefined && option !== null) return option;
  const fromCaller = context.rosterKindOf && employeeId ? context.rosterKindOf(employeeId, dateKey) : undefined;
  if (fromCaller !== undefined && fromCaller !== null) return fromCaller;
  if (context.designatedRosterKinds) return context.designatedRosterKinds.get(`${employeeId}:${dateKey}`) || 'none';
  return undefined;
}

function designatedApplies(context, employeeId, regime, dateKey, option) {
  const kind = rosterKindFor(context, employeeId, dateKey, option);
  if (DESIGNATED_APPLICABLE_ROSTER_KINDS.has(kind)) return true;
  if (regime === 'office' && (kind === undefined || kind === null || kind === 'none')) {
    const weekday = weekdayOfKey(dateKey);
    return weekday >= 1 && weekday <= 5 && officeDayKind(context, dateKey) === 'work';
  }
  return false;
}

/**
 * 公務機關補假連結的國定假日 L 對這位員工是否仍在原日期生效：
 * L 是國定假日（資料、暫代資料，或沒有資料的鄰近年度的固定日期國定假日），而且沒有被個人調移或公司挪移。
 * 沒有連結（L 為 null）的補假照舊放假。
 */
function linkedStatutoryEffective(context, employeeId, linkedDate) {
  if (!linkedDate) return true;
  const year = yearOfKey(linkedDate);
  const exists = context.byKind.statutory.has(linkedDate)
    || (!context.yearsWithRows.has(year) && fixedStatutoryDaysForYear(year).some((day) => day.date === linkedDate));
  if (!exists) return false;
  if (context.movesBySource.has(linkedDate)) return false;
  if (employeeId && context.swapsByEmployee.get(employeeId)?.byOriginal.has(linkedDate)) return false;
  return true;
}

/**
 * 這一天的公務機關補假日還是不是行政人員自動放假的日子：調休存摺上線（officeGovMakeupCutover）之前的照舊放假，
 * 之後的只是建議調休日（國定假日落在週末改存入調休）。沒有切換日（舊資料、記憶體測試資料）一律照舊。
 */
export function isGovMakeupAutomatic(context, dateKey) {
  const cutover = context?.officeGovMakeupCutover;
  return !cutover || String(dateKey) < cutover;
}

/**
 * 國定假日 holidayKey 對應的「建議調休日」：連結到它、在切換日（含）之後的公務機關補假日；沒有回傳 null。
 * 切換日之前的公務機關補假日是行政人員自動放假的日子（不是建議），也回傳 null。
 */
export function suggestedGovMakeupDate(context, holidayKey) {
  if (!context || !holidayKey) return null;
  for (const row of context.byKind.gov_makeup_off.values()) {
    if (row.compensatesDate === holidayKey && !isGovMakeupAutomatic(context, row.date)) return row.date;
  }
  return null;
}

function emptyVerdict(context, dateKey) {
  return {
    holiday: false,
    reason: null,
    name: '',
    originalDate: null,
    compensatesDate: null,
    compensatesName: '',
    notHolidayReason: null,
    movedTo: null,
    sourceId: null,
    synthetic: false,
    provisional: context && dateKey ? isProvisionalDate(context, dateKey) : true,
  };
}

/**
 * 這一天對這位員工是不是國定假日（依序取第一個成立的）：
 * 1 個人調移的目標日 2 整天的調休日（調休簽核核准、HR 指定，via = comp_leave／hr_assigned）3 公司挪移的目標日
 * 4 國定假日（被個人調移或公司挪移走的不算）5 行政人員的公務機關補假（連結的國定假日仍在原日期生效，而且在調休存摺上線之前）
 * 6 指定應放假日（當天原應出勤且未被排除）7 原住民族歲時祭儀（具原住民身分且當天請原民假）8 其餘都不是。
 */
export function isNationalHolidayFor(context, employee, dateKey, { rosterKind } = {}) {
  const day = toKey(dateKey);
  const verdict = emptyVerdict(context, day);
  if (!context || !day) return verdict;
  const { id, info } = resolveEmployee(context, employee);
  const swaps = id ? context.swapsByEmployee.get(id) : null;
  const compensations = id ? context.compensationsByEmployee.get(id) : null;

  const swapIn = swaps?.byTarget.get(day);
  if (swapIn) {
    return { ...verdict, holiday: true, reason: 'swap', name: swapIn.name, originalDate: swapIn.original, sourceId: swapIn.id };
  }
  const compensation = compensations?.byAssigned.get(day);
  if (compensation) {
    return {
      ...verdict,
      holiday: true,
      reason: 'compensation',
      name: compensationNameOf(compensation),
      compensatesDate: compensation.holidayDate,
      compensatesName: compensation.holidayName,
      sourceId: compensation.id,
      via: compensation.via,
    };
  }
  const moveIn = context.movesByTarget.get(day);
  if (moveIn) {
    return {
      ...verdict,
      holiday: true,
      reason: 'company_move',
      name: moveIn.row.name,
      originalDate: moveIn.source,
      sourceId: moveIn.id,
      synthetic: moveIn.row.synthetic,
    };
  }

  const statutory = context.byKind.statutory.get(day);
  if (statutory) {
    const common = { name: statutory.name, originalDate: day, sourceId: statutory.id, synthetic: statutory.synthetic };
    const swapOut = swaps?.byOriginal.get(day);
    if (swapOut) return { ...verdict, ...common, notHolidayReason: 'swapped_away', movedTo: swapOut.target };
    const moveOut = context.movesBySource.get(day);
    if (moveOut) return { ...verdict, ...common, notHolidayReason: 'moved_away', movedTo: moveOut.target };
    // 落在週末、落在員工自己的休息日也照算國定假日（加班費以國定假日計）
    return { ...verdict, ...common, holiday: true, reason: 'statutory' };
  }

  const regime = resolveHolidayRegime(info);
  const government = context.byKind.gov_makeup_off.get(day);
  if (government && regime === 'office' && isGovMakeupAutomatic(context, day)
    && linkedStatutoryEffective(context, id, government.compensatesDate)) {
    return {
      ...verdict,
      holiday: true,
      reason: 'gov_makeup',
      name: government.name,
      compensatesDate: government.compensatesDate,
      compensatesName: government.compensatesName,
      sourceId: government.id,
    };
  }

  const designated = context.byKind.designated.get(day);
  if (designated) {
    const common = { name: designated.name, originalDate: day, sourceId: designated.id };
    if (id && designated.excludedEmployees.has(id)) return { ...verdict, ...common, notHolidayReason: 'designated_excluded' };
    if (designatedApplies(context, id, regime, day, rosterKind)) return { ...verdict, ...common, holiday: true, reason: 'designated' };
    return { ...verdict, ...common, notHolidayReason: 'designated_not_applicable' };
  }

  if (context.leaveTypeOf && id && info?.isIndigenous === true) {
    const label = context.leaveTypeOf(id, day);
    if (label && INDIGENOUS_LEAVE_PATTERN.test(String(label))) {
      return { ...verdict, holiday: true, reason: 'indigenous', name: '原住民族歲時祭儀' };
    }
  }
  return verdict;
}

/**
 * 行政人員（沒有班表時）的日別：公司上班日或（依政府調整時）補行上班 -> work；
 * 公司休息日或（依政府調整時）調整放假 -> rest_day；週日 -> regular_rest；週六 -> rest_day；其餘 work。
 * 「依政府調整放假」只看該年度的設定，而且永遠不套用在輪班人員。
 */
export function officeDayKind(context, dateKey) {
  const day = toKey(dateKey);
  if (!context || !day) return 'work';
  const follow = followAdjustments(context, yearOfKey(day));
  if (context.byKind.company_workday.has(day) || (follow && context.byKind.gov_makeup_workday.has(day))) return 'work';
  if (context.byKind.company_off.has(day) || (follow && context.byKind.gov_bridge_off.has(day))) return 'rest_day';
  const weekday = weekdayOfKey(day);
  if (weekday === 0) return 'regular_rest';
  if (weekday === 6) return 'rest_day';
  return 'work';
}

/**
 * 加班費日別：國定假日（依本模組判斷）> 班表的休息日 > 其他班別一律平日；
 * 沒有班表的行政人員依 officeDayKind（休息日、例假都以休息日計）。
 */
export function resolveDayType(context, employee, dateKey, { rosterKind } = {}) {
  const verdict = isNationalHolidayFor(context, employee, dateKey, { rosterKind });
  if (verdict.holiday) return { dayType: 'national_holiday', verdict };
  if (rosterKind === 'rest_day') return { dayType: 'rest_day', verdict };
  if (rosterKind && rosterKind !== 'none') return { dayType: 'workday', verdict };
  const { info } = resolveEmployee(context, employee);
  if (resolveHolidayRegime(info) === 'office') {
    return { dayType: officeDayKind(context, dateKey) === 'work' ? 'workday' : 'rest_day', verdict };
  }
  return { dayType: 'workday', verdict };
}

// 補假／調休日的名稱：HR 指定與舊的已排定補假是「國慶日補假」，員工的調休是「調休（國慶日）」
function compensationNameOf(entry) {
  if (entry.via === 'comp_leave') return entry.holidayName ? `調休（${entry.holidayName}）` : '調休';
  return `${entry.holidayName || '國定假日'}補假`;
}

function rangeOf(context, start, end) {
  return { startKey: toKey(start) || context.start, endKey: toKey(end) || context.end };
}

/**
 * 員工在 [start, end) 的國定假日清單：
 *  - 應休（ENTITLEMENT）：每個國定假日一筆（有效日期 = 個人調移目標、公司挪移目標或原日期，在範圍內才列），
 *    compensation 是它已經補到哪一天（行政人員的公務機關補假，或已排定的補假）；適用的指定應放假日也各一筆；
 *  - 補假（COMPENSATION，includeCompensations）：補假日在範圍內的已排定補假，以及行政人員的公務機關補假日。
 * 依日期、id 排序。
 */
export function listEmployeeHolidays(context, employee, { start, end, rosterKindOf, includeCompensations = true } = {}) {
  if (!context) return [];
  const { startKey, endKey } = rangeOf(context, start, end);
  const inRange = (key) => Boolean(key) && key >= startKey && key < endKey;
  const { id, info } = resolveEmployee(context, employee);
  const regime = resolveHolidayRegime(info);
  const swaps = id ? context.swapsByEmployee.get(id) : null;
  const compensations = id ? context.compensationsByEmployee.get(id) : null;

  // 行政人員：國定假日 -> 對應的公務機關補假日（只有調休存摺上線之前、自動放假的那些）
  const governmentByLink = new Map();
  if (regime === 'office') {
    for (const row of context.byKind.gov_makeup_off.values()) {
      if (!isGovMakeupAutomatic(context, row.date)) continue;
      if (row.compensatesDate && !governmentByLink.has(row.compensatesDate)) governmentByLink.set(row.compensatesDate, row);
    }
  }

  const entries = [];
  for (const row of context.byKind.statutory.values()) {
    const original = row.date;
    const swap = swaps?.byOriginal.get(original) || null;
    const move = swap ? null : (context.movesBySource.get(original) || null);
    const effective = swap ? swap.target : (move ? move.target : original);
    if (!inRange(effective)) continue;
    let compensation = null;
    const government = !swap && !move ? governmentByLink.get(original) : null;
    if (government) {
      compensation = { date: government.date, via: 'gov_makeup', compensationId: null, calendarDayId: government.id };
    } else {
      const assigned = compensations?.byHoliday.get(original);
      if (assigned) {
        compensation = { date: assigned.assignedDate, via: assigned.via, compensationId: assigned.id, calendarDayId: assigned.calendarDayId };
      }
    }
    entries.push({
      id: `statutory:${original}`,
      type: 'statutory',
      name: row.name,
      originalDate: original,
      date: effective,
      movedFrom: effective !== original ? original : null,
      via: swap ? 'swap' : (move ? 'company_move' : null),
      moveId: move?.id ?? null,
      swapId: swap?.id ?? null,
      calendarDayId: row.id,
      synthetic: row.synthetic,
      compensation,
    });
  }

  const kindOf = typeof rosterKindOf === 'function' ? rosterKindOf : null;
  for (const row of context.byKind.designated.values()) {
    if (!inRange(row.date)) continue;
    if (id && row.excludedEmployees.has(id)) continue;
    const option = kindOf ? kindOf(id, row.date) : undefined;
    if (!designatedApplies(context, id, regime, row.date, option)) continue;
    entries.push({
      id: `designated:${row.date}`,
      type: 'designated',
      name: row.name,
      originalDate: row.date,
      date: row.date,
      movedFrom: null,
      via: null,
      moveId: null,
      swapId: null,
      calendarDayId: row.id,
      synthetic: false,
      compensation: null,
    });
  }

  if (includeCompensations) {
    for (const assigned of compensations?.byAssigned.values() || []) {
      if (!inRange(assigned.assignedDate)) continue;
      entries.push({
        // 沒有國定假日來源的調休（人資手動給予、轉入的補休時數）以日期當鍵
        id: `compensation:${assigned.holidayDate || assigned.assignedDate}`,
        type: 'compensation',
        name: compensationNameOf(assigned),
        holidayName: assigned.holidayName || '',
        originalDate: assigned.holidayDate,
        date: assigned.assignedDate,
        via: assigned.via,
        compensationId: assigned.id,
        calendarDayId: assigned.calendarDayId,
      });
    }
    if (regime === 'office') {
      for (const row of context.byKind.gov_makeup_off.values()) {
        if (!inRange(row.date) || !isGovMakeupAutomatic(context, row.date)) continue;
        if (!linkedStatutoryEffective(context, id, row.compensatesDate)) continue;
        entries.push({
          id: `compensation:${row.compensatesDate || row.date}`,
          type: 'compensation',
          name: row.compensatesName ? `${row.compensatesName}補假` : row.name,
          holidayName: row.compensatesName || '',
          originalDate: row.compensatesDate,
          date: row.date,
          via: 'gov_makeup',
          compensationId: null,
          calendarDayId: row.id,
        });
      }
    }
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** [start, end) 之間對這位員工是假日（isNationalHolidayFor 為真）的日期 */
export function buildEmployeeHolidayDaySet(context, employee, { start, end, rosterKindOf } = {}) {
  const days = new Set();
  if (!context) return days;
  const { startKey, endKey } = rangeOf(context, start, end);
  const id = toId(employee);
  const kindOf = typeof rosterKindOf === 'function' ? rosterKindOf : null;
  for (const key of listKeys(startKey, endKey)) {
    const rosterKind = kindOf ? kindOf(id, key) : undefined;
    if (isNationalHolidayFor(context, employee, key, { rosterKind }).holiday) days.add(key);
  }
  return days;
}

/**
 * 排班頁標頭、匯出「行事曆」列用的行事曆層級標示（不分員工）：
 * 國定假日（被公司挪移的顯示「已調移至 MM/DD」、挪移目標日顯示原假日名稱）、指定應放假日、
 * 公務機關補假／調整放假／補行上班（灰字資訊）、公司休息日／上班日。
 */
export function listCalendarHeaders(context, { start, end } = {}) {
  if (!context) return [];
  const { startKey, endKey } = rangeOf(context, start, end);
  const inRange = (key) => Boolean(key) && key >= startKey && key < endKey;
  const entries = [];
  const push = (fields) => entries.push({
    date: '',
    kind: '',
    displayKind: '',
    label: '',
    name: '',
    compensatesDate: null,
    compensatesName: '',
    movedFrom: null,
    movedTo: null,
    appliesTo: 'info',
    synthetic: false,
    needsReview: false,
    ...fields,
  });

  for (const kind of HOLIDAY_KINDS) {
    for (const row of context.byKind[kind].values()) {
      if (!inRange(row.date)) continue;
      const base = { date: row.date, kind, name: row.name, synthetic: row.synthetic, needsReview: row.needsReview };
      const follow = followAdjustments(context, yearOfKey(row.date));
      if (kind === 'statutory') {
        const move = context.movesBySource.get(row.date);
        if (move) {
          push({ ...base, displayKind: 'moved_away', label: `已調移至 ${monthDayText(move.target)}`, movedTo: move.target, appliesTo: 'all' });
        } else {
          push({ ...base, displayKind: 'holiday', label: row.name, appliesTo: 'all' });
        }
      } else if (kind === 'designated') {
        push({ ...base, displayKind: 'designated', label: row.name, appliesTo: 'eligible' });
      } else if (kind === 'gov_makeup_off') {
        const link = { compensatesDate: row.compensatesDate, compensatesName: row.compensatesName };
        if (isGovMakeupAutomatic(context, row.date)) {
          push({ ...base, ...link, displayKind: 'gov_info', label: '公務機關補假', appliesTo: 'office' });
        } else {
          // 調休存摺上線後：輪班人員看到的是公務機關的補假（僅供參考），行政人員看到的是建議調休日（不是自動放假）
          push({ ...base, ...link, displayKind: 'gov_info', label: '公務機關補假', appliesTo: 'roster' });
          push({ ...base, ...link, displayKind: 'gov_info', label: '建議調休日', appliesTo: 'office' });
        }
      } else if (kind === 'gov_bridge_off') {
        push({ ...base, displayKind: 'gov_info', label: follow ? '行政人員休息日（調整放假）' : '公務機關調整放假', appliesTo: follow ? 'office' : 'info' });
      } else if (kind === 'gov_makeup_workday') {
        push({ ...base, displayKind: 'gov_info', label: follow ? '行政人員補行上班' : '公務機關補行上班', appliesTo: follow ? 'office' : 'info' });
      } else if (kind === 'company_off') {
        push({ ...base, displayKind: 'company_off', label: row.name || '公司休息日', appliesTo: 'office' });
      } else if (kind === 'company_workday') {
        push({ ...base, displayKind: 'company_workday', label: row.name || '公司上班日', appliesTo: 'office' });
      }
    }
  }
  for (const move of context.movesByTarget.values()) {
    if (!inRange(move.target)) continue;
    push({
      date: move.target,
      kind: 'statutory',
      displayKind: 'holiday',
      label: move.row.name,
      name: move.row.name,
      movedFrom: move.source,
      appliesTo: 'all',
      synthetic: move.row.synthetic,
    });
  }

  return entries.sort((a, b) => (
    a.date.localeCompare(b.date)
    || (HEADER_DISPLAY_ORDER[a.displayKind] ?? 9) - (HEADER_DISPLAY_ORDER[b.displayKind] ?? 9)
  ));
}

/**
 * 年度行事曆狀態：[from, to] 涵蓋的每個年度（none／draft／approved），
 * provisional = 其中有任何年度尚未核定；lastApprovedDate = 從今年（台灣時間）起連續核定到哪一年的 12/31（今年沒核定為 null）。
 */
export function calendarStatusFromContext(context, { from, to } = {}) {
  const fromKey = toKey(from) || context.start;
  const toKeyValue = toKey(to) || (context.end > context.start ? addDays(context.end, -1) : context.start);
  const firstYear = yearOfKey(fromKey);
  const lastYear = Math.max(firstYear, yearOfKey(toKeyValue));
  const years = [];
  for (let year = firstYear; year <= lastYear; year += 1) years.push(yearInfo(context, year));
  const provisionalYears = years.filter((item) => item.state !== 'approved').map((item) => item.year);

  let lastApprovedDate = null;
  const currentYear = yearOfKey(context.today);
  if (yearInfo(context, currentYear).state === 'approved') {
    let year = currentYear;
    while (yearInfo(context, year + 1).state === 'approved') year += 1;
    lastApprovedDate = `${year}-12-31`;
  }
  return { years, provisional: provisionalYears.length > 0, provisionalYears, lastApprovedDate };
}

/** 讀取 [from, to] 的年度行事曆狀態（請假單、排班提醒用；不連線外部） */
export async function getCalendarStatus({ from, to, today = new Date() } = {}) {
  const fromKey = toKey(from);
  const toKeyValue = toKey(to) || fromKey;
  if (!fromKey || toKeyValue < fromKey) throw new Error('invalid calendar status range');
  const firstYear = yearOfKey(fromKey);
  const lastYear = yearOfKey(toKeyValue);
  const [years, rows] = await Promise.all([
    leanResult(CalendarYear.find({})),
    leanResult(withSelect(Holiday.find({
      archived: { $ne: true },
      date: { $gte: new Date(Date.UTC(firstYear, 0, 1)), $lt: new Date(Date.UTC(lastYear + 1, 0, 1)) },
    }), 'date kind type name description desc source archived')),
  ]);
  const context = createHolidayContext({ start: fromKey, end: addDays(toKeyValue, 1), rows, years, today });
  return calendarStatusFromContext(context, { from: fromKey, to: toKeyValue });
}
