/**
 * 國定假日休假紀錄（Holiday Rest Ledger）。
 *
 * 紀錄是「推算」出來的，不另外存一份：班表（ShiftSchedule）才是唯一的資料來源，
 * 員工在哪一天排了「國」（班別性質 holiday）就是在那天休了國定假日。
 * 每位員工「應休」哪些國定假日由 holidayResolver 決定（一律不從假日名稱猜）：輪班人員只有勞基法的國定假日
 * （公務機關補假日不算，2026 年全年 16 天）；公司挪移、個人調移後以該員工的有效日期為準；指定應放假日只列適用的員工。
 * 每個員工 × 每個應休的國定假日得到下列狀態：
 *   rested_on_date  國定假日當天就排了「國」（行政人員沒有班表、當天本來要上班時依行事曆放假，implicit）
 *   moved           國定假日當天沒有休，但同月其他日期排了「國」（移休，會記錄是哪一天）
 *   compensated     國定假日落在員工自己的休息日／例假，已經有補償：存入調休存摺（via bank，員工自己決定什麼時候用）、
 *                   已用掉的整天調休（via comp_leave 調休簽核／hr_assigned HR 指定），或調休存摺上線前行政人員的公務機關補假日（via gov_makeup）
 *   not_taken       本月沒有對應的「國」（沒休；reason 說明當天是上班、沒排班、休息日、請假…）
 *   na              不在職（到職前、離職後、留職停薪），不計入應休
 * 國定假日落在員工自己的休息日／例假時，依勞基法施行細則第 23-1 條應另給補假：
 * 系統在調休存摺建立一筆調休（CompensatoryCredit，見 holidayCompensationService）；還沒建立（沒有同步的檢視，例如匯出）時是
 * needsAction = assign_compensation（待存入調休）。人資作廢的調休（voidReason manual）算已處理：compensation.creditStatus = 'void'，不列入待處理。
 * 本月多出來、沒有對應到任何國定假日的「國」另外列為 extraGuoDates（多排的國）；整天調休日上的「國」由該調休使用，不算多排。
 * 「沒休的國定假日後續怎麼處理」這種人工決定存在 HolidayRestResolution；
 * 登記之後班表又排了「國」（變成當日休、移休或已補假）時，登記的紀錄不會被藏起來，項目會帶 resolutionConflict 請人確認。
 */
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import Employee from '../models/Employee.js';
import HolidayRestResolution from '../models/HolidayRestResolution.js';
import CompensatoryCredit from '../models/CompensatoryCredit.js';
import { loadApprovedLeaveIntervals } from './approvedLeaveCalendarService.js';
import { resolveShiftSemanticType } from './shiftSemanticService.js';
import { isScheduleRuleExempt } from './scheduleRuleExemptionService.js';
import { buildLeaveDayCheck } from './leaveCoverageService.js';
import { resolveHolidayRegime, weekdayOfKey } from './holidayCalendarRules.js';
import {
  calendarStatusFromContext,
  createHolidayContext,
  isNationalHolidayFor,
  listEmployeeHolidays,
  loadHolidayContext,
  officeDayKind,
  suggestedGovMakeupDate,
} from './holidayResolver.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

// 請假有沒有涵蓋班次的判斷與排班共用（leaveCoverageService），這裡照舊匯出，原本從這裡匯入的地方不用改
export { buildLeaveDayCheck };

export const LEDGER_STATUS = Object.freeze({
  RESTED_ON_DATE: 'rested_on_date',
  MOVED: 'moved',
  COMPENSATED: 'compensated',
  NOT_TAKEN: 'not_taken',
  NA: 'na',
});

export const LEDGER_STATUS_LABELS = Object.freeze({
  rested_on_date: '當日休',
  moved: '移休',
  compensated: '補假',
  not_taken: '未休',
  na: '不適用',
});

// 沒休（not_taken）時，國定假日當天員工是什麼狀態
export const LEDGER_REASON_LABELS = Object.freeze({
  worked: '上班',
  unscheduled: '未排班',
  on_rest_day: '適逢休息日',
  on_regular_rest: '適逢例假',
  on_leave: '適逢請假',
  shared_date: '同日有多個假日',
  before_hire: '到職前',
  after_resignation: '離職後',
  leave_of_absence: '留職停薪',
});

export const LEDGER_RESOLUTION_LABELS = Object.freeze({
  compensatory_leave: '補休',
  paid: '折發工資',
  rested_later: '已另行補休',
  waived: '不補',
});

// 國定假日當天的班表狀態 -> 沒休的原因
const REASON_BY_DAY_KIND = Object.freeze({
  work: 'worked',
  none: 'unscheduled',
  rest_day: 'on_rest_day',
  regular_rest: 'on_regular_rest',
  leave: 'on_leave',
  holiday: 'shared_date',
});

// 這些原因代表國定假日當天是上班、沒排或被別的假日佔用，需要人登記處理方式；
// 適逢休息日、例假改由補假處理（needsAction = assign_compensation，見 buildHolidayRestLedger），適逢請假只是提示
const ACTIONABLE_REASONS = new Set(['worked', 'unscheduled', 'shared_date']);

// 國定假日當天本來就不用休息（上班或沒排班）的才「需要」一個國；其餘日子優先配給這類假日
const NEEDS_REST_DAY_KINDS = new Set(['work', 'none']);

// 管理員、主管的帳號不一定在班表上（沒有排班不代表漏排）；連續這麼多個月（含本月）都沒有任何班表才當作不用排班
const ROSTER_OPTIONAL_ROLES = new Set(['admin', 'supervisor']);
const ROSTER_LOOKBACK_MONTHS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dayNumber(key) {
  return Math.round(Date.parse(`${key}T00:00:00.000Z`) / DAY_MS);
}

function toId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) return toId(value._id);
  return typeof value.toString === 'function' ? value.toString() : String(value);
}

async function leanResult(query) {
  return query && typeof query.lean === 'function' ? query.lean() : query;
}

export function parseLedgerMonth(month) {
  const text = String(month ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return null;
  const start = new Date(`${text}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastKey = new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10);
  return { month: text, start, end, lastKey };
}

/** 班別設定 -> Map(班別 ID 字串, 班別性質)；找不到的班別 ID 一律當作工作班 */
export function buildShiftSemanticLookup(setting) {
  const lookup = new Map();
  for (const shift of setting?.shifts || []) {
    const id = toId(shift?._id);
    if (id) lookup.set(id, resolveShiftSemanticType(shift));
  }
  return lookup;
}

/** 班別設定 -> Map(班別 ID 字串, 班別本身)；請假有沒有涵蓋整個班次要用班別的上下班時間判斷 */
export function buildShiftDocLookup(setting) {
  const lookup = new Map();
  for (const shift of setting?.shifts || []) {
    const id = toId(shift?._id);
    if (id) lookup.set(id, shift);
  }
  return lookup;
}

/**
 * 沒休到的原因要不要人處理。上班、同日多個假日一律要處理；
 * 「未排班」對兼職人員只是提示（兼職不要求排班，和排班規範一樣免檢核），不列入待處理，兼職人員上班沒休照樣要處理。
 */
export function isActionableReason(reason, employee = null) {
  if (!ACTIONABLE_REASONS.has(reason)) return false;
  return !(reason === 'unscheduled' && isScheduleRuleExempt(employee));
}

/**
 * 員工在這個月「不用給國定假日」的原因判斷：回傳 (假日有效日期 YYYY-MM-DD) => 原因或 null。
 * - 到職日以台灣日期判斷，到職前的假日不適用。
 * - 只有目前狀態是「離職員工」才套用離職日（離職日、解聘日，都沒有就用本月最後一筆班表日期，連班表都沒有整月不適用）。
 *   在職員工不看離職日，所以離職後再任用的人不會被誤判。
 * - 留職停薪且本月沒有任何班表：整月不適用。
 */
export function buildTenureCheck(employee, { hasRows = false, lastScheduledKey = '' } = {}) {
  const appointment = employee?.appointment || {};
  const status = String(employee?.status || '');
  const hire = appointment.hireDate ? toTaipeiDateKey(appointment.hireDate) : null;
  const resigned = status === '離職員工';
  const end = resigned
    ? (toTaipeiDateKey(appointment.resignationDate) || toTaipeiDateKey(appointment.dismissalDate) || lastScheduledKey || '')
    : '';
  const onLeaveOfAbsence = status === '留職停薪' && !hasRows;
  return (dateKey) => {
    if (onLeaveOfAbsence) return 'leave_of_absence';
    if (hire && dateKey < hire) return 'before_hire';
    if (resigned && (!end || dateKey > end)) return 'after_resignation';
    return null;
  };
}

/**
 * 把員工本月的「國」對應到本月的國定假日（純函式，不碰資料庫）。
 *
 * 規則（班表沒有「這個國是哪個假日」的連結，所以用下列順序推算，總數一定正確，個別對應是依序配對）：
 *  1. 不在職的假日 -> na，不吃掉任何一個國。
 *  2. 國定假日當天就排了國 -> rested_on_date。
 *  3. 公司挪移過的假日，員工仍把國留在原本的日期 -> moved。
 *  4. 其餘還沒對應的假日，依日期先後配給還沒對應的國（最早的國配給最早的假日）-> moved，記錄是哪一天（offsetDays = 國的日期 - 假日日期）。
 *     當天本來要上班或沒排班的假日優先配對，已經是休息日／例假／請假的假日排在後面，
 *     這樣一個國不會被「本來就休息」的假日用掉，而讓真正上班的假日被誤判為沒休。
 *  5. 仍沒有國可配的假日 -> not_taken，reason 依假日當天的班表狀態。
 *  6. 配完剩下的國 -> extraGuoDates（多排的國）。
 *
 * holidays：[{ id, date, movedFrom }]（holidayResolver.listEmployeeHolidays 的應休項目，date 是該員工的有效日期）；guoDates：員工本月排了「國」的日期。
 * dayKindOf(日期)：該日的班表狀態 work / rest_day / regular_rest / holiday / leave / none。
 * tenureNaReason(假日)：回傳不適用原因或 null。
 */
export function assignHolidayRests({ holidays = [], guoDates = [], dayKindOf = () => 'none', tenureNaReason = null } = {}) {
  const items = new Map();
  const free = [...new Set((guoDates || []).filter(Boolean))].sort();
  const take = (key) => {
    const index = free.indexOf(key);
    if (index < 0) return false;
    free.splice(index, 1);
    return true;
  };
  const ordered = [...(holidays || [])].sort((a, b) => (
    String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id))
  ));
  const set = (holiday, status, guoDate = null, reason = null) => {
    items.set(holiday.id, {
      status,
      guoDate,
      reason,
      offsetDays: status === LEDGER_STATUS.MOVED && guoDate ? dayNumber(guoDate) - dayNumber(holiday.date) : null,
    });
  };

  let pending = [];
  for (const holiday of ordered) {
    const naReason = tenureNaReason ? tenureNaReason(holiday) : null;
    if (naReason) set(holiday, LEDGER_STATUS.NA, null, naReason);
    else pending.push(holiday);
  }

  pending = pending.filter((holiday) => {
    if (!take(holiday.date)) return true;
    set(holiday, LEDGER_STATUS.RESTED_ON_DATE, holiday.date);
    return false;
  });

  pending = pending.filter((holiday) => {
    if (!holiday.movedFrom || !take(holiday.movedFrom)) return true;
    set(holiday, LEDGER_STATUS.MOVED, holiday.movedFrom);
    return false;
  });

  const needy = pending.filter((holiday) => NEEDS_REST_DAY_KINDS.has(dayKindOf(holiday.date)));
  const others = pending.filter((holiday) => !NEEDS_REST_DAY_KINDS.has(dayKindOf(holiday.date)));
  for (const holiday of [...needy, ...others]) {
    if (!free.length) break;
    set(holiday, LEDGER_STATUS.MOVED, free.shift());
  }

  for (const holiday of ordered) {
    if (items.has(holiday.id)) continue;
    set(holiday, LEDGER_STATUS.NOT_TAKEN, null, REASON_BY_DAY_KIND[dayKindOf(holiday.date)] || 'unscheduled');
  }

  return { items, extraGuoDates: free };
}

function monthDayOf(dateKey) {
  return String(dateKey || '').slice(5).replace('-', '/');
}

// 調休存摺的額度在休假紀錄上的文字：沒有日期的（還沒用、部分使用、用在沒有整天的請假、過期）
function describeBankCompensation(compensation) {
  const used = Number(compensation?.usedHours) || 0;
  if (compensation?.creditStatus === 'used') return '調休已使用';
  if (compensation?.creditStatus === 'expired') return '調休已過期';
  return used > 0 ? `已存入調休（已用 ${used} 小時）` : '已存入調休';
}

// 有日期的補償：調休簽核的整天調休是「調休 MM/DD」，HR 指定與舊的已排定補假是「補假 MM/DD」
function describeDatedCompensation(compensation) {
  const prefix = compensation?.via === 'comp_leave' ? '調休' : '補假';
  return `${prefix} ${monthDayOf(compensation?.date)}`;
}

/**
 * 一個項目在報表（Excel）上顯示的文字；班表還是草稿、本月還沒結束的待處理項目（needsAction = schedule）顯示「尚未排國」，
 * 國定假日落在休息日／例假、調休還沒存入存摺的顯示「待存入調休」，已存入的顯示「已存入調休」。
 */
export function describeLedgerItem(item) {
  if (!item) return '';
  // 已登記處理方式、班表之後卻排了「國」：照常顯示休假狀態，另外註明要確認（不能讓登記的紀錄默默消失）
  const conflict = item.resolutionConflict ? '（已登記處理，請確認）' : '';
  // 已用掉的調休／補假、班表之後又改了：不會自動收回，註明要確認
  if (item.compensation?.conflict && item.compensation?.date) return `${describeDatedCompensation(item.compensation)}（班表已變更，請確認）`;
  if (item.compensation?.conflict && item.compensation?.via === 'bank') return `${describeBankCompensation(item.compensation)}（班表已變更，請確認）`;
  if (item.status === LEDGER_STATUS.RESTED_ON_DATE) return `${item.implicit ? '依行事曆放假' : '當日休'}${conflict}`;
  if (item.status === LEDGER_STATUS.MOVED) return `移休 ${monthDayOf(item.guoDate)}${conflict}`;
  if (item.status === LEDGER_STATUS.COMPENSATED) {
    if (item.compensation?.via === 'bank') return `${describeBankCompensation(item.compensation)}${conflict}`;
    const government = item.compensation?.via === 'gov_makeup' ? '（公務機關補假日）' : '';
    return `${describeDatedCompensation(item.compensation)}${government}${conflict}`;
  }
  if (item.status === LEDGER_STATUS.NA) return '—';
  if (item.resolution) return `未休（${LEDGER_RESOLUTION_LABELS[item.resolution.kind] || '已處理'}）`;
  if (item.compensation?.via === 'bank' && item.compensation.creditStatus === 'void') return '調休已作廢（人資）';
  if (item.needsAction === 'assign_compensation') return '待存入調休';
  if (item.needsAction === 'schedule') return '尚未排國';
  if (item.reason === 'worked') return '未休（上班）';
  if (item.reason === 'unscheduled') return '未休（未排班）';
  if (item.reason === 'shared_date') return '未休（同日多個假日）';
  return LEDGER_REASON_LABELS[item.reason] || '未休';
}

/** 一個月份的合計：rows = 回傳的員工列，notScheduled = 因為沒有排班或不在職而未列入的人數 */
export function summarizeLedger(rows = [], holidayCount = 0, notScheduled = 0) {
  const summary = {
    employees: rows.length,
    holidays: holidayCount,
    entitled: 0,
    rested: 0,
    moved: 0,
    compensated: 0,
    notTaken: 0,
    open: 0,
    compensationOpen: 0,
    banked: 0,
    extra: 0,
    excluded: { notScheduled },
  };
  for (const row of rows) {
    summary.entitled += row.entitled;
    summary.rested += row.rested;
    summary.moved += row.moved;
    summary.compensated += row.compensated || 0;
    summary.notTaken += row.notTaken;
    summary.open += row.open;
    summary.compensationOpen += (row.items || []).filter((item) => item.needsAction === 'assign_compensation').length;
    // 已存入調休、員工還沒用完的
    summary.banked += (row.items || []).filter((item) => (
      item.compensation?.via === 'bank' && ['available', 'partial'].includes(item.compensation.creditStatus)
    )).length;
    summary.extra += row.extraGuoDates.length;
  }
  return summary;
}

export function serializeHolidayResolution(doc, nameById = new Map()) {
  if (!doc) return null;
  return {
    id: toId(doc._id),
    kind: doc.kind,
    compensatoryHours: doc.kind === 'compensatory_leave' && typeof doc.compensatoryHours === 'number' ? doc.compensatoryHours : null,
    restedDate: doc.restedDate ? utcDateKey(doc.restedDate) : null,
    note: doc.note || '',
    resolvedAt: doc.updatedAt || doc.createdAt || null,
    resolvedByName: nameById.get(toId(doc.resolvedBy)) || '',
    // 最初登記的人（之後被別人修改也不會變）；舊資料沒有這個欄位
    createdByName: nameById.get(toId(doc.createdBy)) || '',
  };
}

/**
 * 本月沒有班表、角色是管理員或主管、也需要排班（預設）的帳號中，前面幾個月（含本月共 ROSTER_LOOKBACK_MONTHS 個月）
 * 也都沒有班表的員工 ID：這些帳號本來就不在班表上，不是漏排；有任何一個月排過班就照常列入。
 * 員工資料沒有 role（呼叫端沒有查角色）時一律不跳過。只有這類帳號存在時才多查一次班表（員工 + 日期索引）。
 */
async function findNeverRosteredIds({ employees, rowsByEmployee, start }) {
  const candidateIds = employees
    .filter((employee) => (
      ROSTER_OPTIONAL_ROLES.has(employee.role)
      && employee.requiresScheduling !== false
      && resolveHolidayRegime(employee) === 'roster'
      && !rowsByEmployee.has(toId(employee._id))
    ))
    .map((employee) => toId(employee._id));
  if (!candidateIds.length) return new Set();
  const lookbackStart = new Date(start);
  lookbackStart.setUTCMonth(lookbackStart.getUTCMonth() - (ROSTER_LOOKBACK_MONTHS - 1));
  const earlier = (await leanResult(ShiftSchedule.find({
    employee: { $in: candidateIds },
    date: { $gte: lookbackStart, $lt: start },
  }).select('employee'))) || [];
  const rostered = new Set(earlier.map((row) => toId(row.employee)));
  return new Set(candidateIds.filter((id) => !rostered.has(id)));
}

/* ---------------------------- 個人化的應休清單 ---------------------------- */

// context 讀取的範圍比本月前後多 7 天（補假與國定假日的連結、建議補假日）
const LINK_WINDOW_DAYS = 7;
// 建議補假日最多往後找 60 天
const SUGGESTION_WINDOW_DAYS = 60;
const REST_DAY_REASONS = new Set(['on_rest_day', 'on_regular_rest']);
const REST_ROSTER_KINDS = new Set(['rest_day', 'regular_rest']);
const STATUTORY_NOT_HOLIDAY_REASONS = new Set(['moved_away', 'swapped_away']);

function addDaysKey(key, days) {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function keyToDate(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function isEntitlementEntry(entry) {
  return entry?.type === 'statutory' || entry?.type === 'designated';
}

/**
 * 員工某天的狀態：已核准的整天請假 -> leave；有班表 -> 班別性質；
 * 行政人員當天沒有班表 -> 依公司行事曆（work／rest_day／regular_rest）；其餘 none（未排班）。
 */
export function buildDayKindOf({ scheduled, onLeave = () => false, regime = 'roster', context = null } = {}) {
  return (key) => {
    if (onLeave(key)) return 'leave';
    const kind = scheduled?.get?.(key)?.kind;
    if (kind) return kind;
    if (regime === 'office' && context) return officeDayKind(context, key);
    return 'none';
  };
}

// 已核准的整天請假 -> (員工 id, 日期) => 假別；holidayResolver 用來判斷原住民族歲時祭儀
function buildLeaveTypeLookup(getIntervals) {
  return (employeeId, dateKey) => {
    const intervals = getIntervals()?.get?.(toId(employeeId));
    if (!Array.isArray(intervals) || !intervals.length) return undefined;
    const dayStart = Date.parse(`${dateKey}T00:00:00+08:00`);
    const dayEnd = dayStart + DAY_MS;
    const hit = intervals.find((interval) => interval?.allDay && interval.startMs <= dayStart && interval.endMs >= dayEnd);
    return hit?.leaveType || undefined;
  };
}

/**
 * assignHolidayRests 再加上「行政人員依行事曆放假」：implicitOf(假日) 為真（行政人員當天沒有班表、本來要上班）
 * 的假日直接算當日休（implicit），不參與「國」的配對，也不吃掉任何一個國。
 */
function assignWithImplicit({ holidays, guoDates, dayKindOf, tenureNaReason, implicitOf }) {
  const implicit = holidays.filter((holiday) => implicitOf(holiday));
  const result = assignHolidayRests({
    holidays: holidays.filter((holiday) => !implicitOf(holiday)),
    guoDates,
    dayKindOf,
    tenureNaReason,
  });
  for (const holiday of implicit) {
    const naReason = tenureNaReason ? tenureNaReason(holiday) : null;
    result.items.set(holiday.id, naReason
      ? { status: LEDGER_STATUS.NA, guoDate: null, reason: naReason, offsetDays: null }
      : { status: LEDGER_STATUS.RESTED_ON_DATE, guoDate: null, reason: null, offsetDays: null, implicit: true });
  }
  return result;
}

/**
 * 系統建議的補假日：國定假日之後 60 天內，第一個「原本要上班」而且不是該員工假日的日子。
 * 有班表的日子看班表（上班班別才算）；行政人員沒有班表的日子依公司行事曆；
 * 輪班人員本月沒排班的日子略過，超出本月的日子取週一至週五。只是建議，實際日期由勞雇雙方協商。
 */
export function suggestCompensationDate({ context, employee, fromKey, scheduled = new Map(), regime = 'roster', monthLastKey = '' } = {}) {
  if (!context || !fromKey) return null;
  for (let offset = 1; offset <= SUGGESTION_WINDOW_DAYS; offset += 1) {
    const key = addDaysKey(fromKey, offset);
    const rosterKind = scheduled.get(key)?.kind;
    let workday;
    if (rosterKind) workday = rosterKind === 'work';
    else if (regime === 'office') workday = officeDayKind(context, key) === 'work';
    else if (key <= monthLastKey) workday = false;
    else {
      const weekday = weekdayOfKey(key);
      workday = weekday >= 1 && weekday <= 5;
    }
    if (!workday) continue;
    if (isNationalHolidayFor(context, employee, key, { rosterKind }).holiday) continue;
    return key;
  }
  return null;
}

// 補假義務不成立時的作廢原因
function voidReasonOf({ base, storedDoc, governmentCompensated }) {
  if (base.status === LEDGER_STATUS.NA || storedDoc || governmentCompensated) return 'not_applicable';
  if ((base.status === LEDGER_STATUS.RESTED_ON_DATE || base.status === LEDGER_STATUS.MOVED) && !base.implicit) return 'covered_by_roster';
  return 'roster_changed';
}

// 本月相關的調休額度：來源國定假日在本月（含作廢的，同步要能重新開啟）、整天調休日在本月、或跨月的原始日期
async function loadCompensationDocs({ ids, start, end, outsideOriginals = [] }) {
  const monthRange = { $gte: start, $lt: end };
  const keyRange = { $gte: utcDateKey(start), $lt: utcDateKey(end) };
  const or = [{ holidayDate: monthRange }, { 'usages.fullDayDates': keyRange }];
  if (outsideOriginals.length) or.push({ holidayDate: { $in: outsideOriginals.map(keyToDate) } });
  return (await leanResult(CompensatoryCredit.find({ employee: { $in: ids }, $or: or }))) || [];
}

// 一筆調休額度的整天調休日（HR 指定優先）
function datedUsageDates(doc) {
  const usages = [...(doc?.usages || [])].sort((a, b) => (a?.kind === 'hr_assigned' ? 0 : 1) - (b?.kind === 'hr_assigned' ? 0 : 1));
  return usages.flatMap((usage) => (usage?.fullDayDates || []).map((date) => ({ date, via: usage.kind === 'hr_assigned' ? 'hr_assigned' : 'comp_leave' })));
}

function isCreditUsed(doc) {
  return (Number(doc?.usedHours) || 0) > 0 || doc?.status === 'used';
}

/** 調休額度在休假紀錄上的樣子（沒有日期的部分）：額度狀態、時數、建議調休日；不看期限（期限在調休存摺顯示） */
function bankCompensationOf(doc) {
  const hours = Number(doc?.hours) || 0;
  const usedHours = Math.min(Math.max(Number(doc?.usedHours) || 0, 0), hours);
  let creditStatus = 'available';
  if (usedHours >= hours && hours > 0) creditStatus = 'used';
  else if (usedHours > 0) creditStatus = 'partial';
  return {
    via: 'bank',
    date: null,
    compensationId: toId(doc._id),
    calendarDayId: toId(doc.calendarDay) || null,
    creditStatus,
    hours,
    usedHours,
    remainingHours: Math.max(hours - usedHours, 0),
    suggestedDate: doc.suggestedDate ? utcDateKey(doc.suggestedDate) : null,
  };
}

/**
 * 整天調休日不在本月的調休：另外讀那幾天的班表（一次查詢），回傳 Map('員工 id:日期' -> 班別性質)。
 * 用來確認調休日仍是原本要上班的日子（之後被排成休、例時要提醒）；沒有這種調休時不查詢。
 */
async function loadOutsideAssignedRosterKinds({ docs = [], startKey, endKey, semanticByShiftId }) {
  const kinds = new Map();
  const wanted = new Set();
  const employeeIds = new Set();
  const dateKeys = new Set();
  for (const doc of docs) {
    if (doc?.status === 'void') continue;
    for (const { date: key } of datedUsageDates(doc)) {
      if (!key || (key >= startKey && key < endKey)) continue;
      const employeeId = toId(doc.employee);
      wanted.add(`${employeeId}:${key}`);
      employeeIds.add(employeeId);
      dateKeys.add(key);
    }
  }
  if (!wanted.size) return kinds;
  const rows = (await leanResult(ShiftSchedule.find({
    employee: { $in: [...employeeIds] },
    date: { $in: [...dateKeys].sort().map(keyToDate) },
  }).select('employee date shiftId'))) || [];
  for (const row of rows) {
    const pair = `${toId(row.employee)}:${utcDateKey(row.date)}`;
    if (wanted.has(pair)) kinds.set(pair, semanticByShiftId.get(toId(row.shiftId)) || 'work');
  }
  return kinds;
}

// 國定假日在公司層級（只看公司挪移，不看個人調移）的有效日期
function buildCompanyDateLookup(context) {
  const cache = new Map();
  return (entry) => {
    if (entry.type !== 'statutory') return entry.originalDate;
    if (!cache.has(entry.originalDate)) {
      const verdict = isNationalHolidayFor(context, null, entry.originalDate);
      cache.set(entry.originalDate, verdict.notHolidayReason === 'moved_away' && verdict.movedTo ? verdict.movedTo : entry.originalDate);
    }
    return cache.get(entry.originalDate);
  };
}

function columnOf(entry, companyDateOf, personal = false) {
  const date = companyDateOf(entry);
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    originalDate: entry.originalDate,
    date,
    movedFrom: date !== entry.originalDate ? entry.originalDate : null,
    personal,
  };
}

function ledgerCalendarOf(context, startKey, lastKey) {
  const year = Number(startKey.slice(0, 4));
  const status = calendarStatusFromContext(context, { from: startKey, to: lastKey });
  const info = (status.years || []).find((entry) => entry.year === year);
  return { year, state: info?.state || 'none', provisional: status.provisional === true };
}

function emptySyncResult() {
  return { created: 0, voided: 0, reopened: 0, conflicts: 0 };
}

/**
 * 單一月份的國定假日休假紀錄。
 * employees：lean 員工資料（_id、employeeId、name、title、practiceTitle、subDepartment、status、appointment、requiresScheduling、
 *   holidayRegime、isIndigenous、partTime、role）。
 * holidayContext：呼叫端已經建好的 holidayResolver context（班表匯出）時直接使用，不重複查詢；
 *   沒有時自行讀取（範圍為本月前後 7 天）。holidayDocs / moves 是舊介面：只帶本月假日與挪移設定時，用它們建立行事曆層級的 context
 *   （沒有個人調移、補假與年度狀態），有 holidayContext 時忽略。
 * syncCompensations：true 時依推算結果同步補假義務（GET 休假紀錄、每日排程、重新計算）；匯出不同步。
 * 回傳 { month, holidays（欄位：所有員工應休項目的聯集）, employees, summary, calendar: { year, state, provisional } }，
 *   同步時另外帶 sync: { created, voided, reopened, conflicts }；本月沒有任何應休的國定假日時不查班表，直接回傳空清單。
 * 兼職人員與一般員工一樣有紀錄（partTime 只是標示），差別是國定假日當天「未排班」只是提示、不列入待處理。
 * 管理員、主管的帳號（employee.role）連續幾個月都沒有班表時當作不用排班，不列入。
 * 行政人員沒有班表時，只有本月有補假要處理（未排或已排的補假、落在週末又沒有公務機關補假日的國定假日）才列入。
 */
export async function buildHolidayRestLedger({
  month,
  employees = [],
  today = new Date(),
  holidayContext = null,
  syncCompensations = false,
  holidayDocs: legacyHolidayDocs = null,
  moves: legacyMoves = null,
} = {}) {
  const range = parseLedgerMonth(month);
  if (!range) throw new Error('invalid month');
  const { start, end, lastKey } = range;
  const startKey = utcDateKey(start);
  const endKey = utcDateKey(end);
  const withSync = (result, sync) => (syncCompensations ? { ...result, sync: sync || emptySyncResult() } : result);

  // 班表與請假要確定本月有國定假日才讀；context 先拿到查詢函式（閉包），讀完班表就查得到
  const scheduledByEmployee = new Map();
  let leaveIntervals = new Map();
  const rosterKindOf = (employeeId, key) => scheduledByEmployee.get(toId(employeeId))?.get(key)?.kind;
  const leaveTypeOf = buildLeaveTypeLookup(() => leaveIntervals);
  const contextRange = { start: addDaysKey(startKey, -LINK_WINDOW_DAYS), end: addDaysKey(endKey, LINK_WINDOW_DAYS) };
  let context = holidayContext;
  if (!context && Array.isArray(legacyHolidayDocs)) {
    context = createHolidayContext({
      ...contextRange, rows: legacyHolidayDocs, moves: legacyMoves || [], employees, rosterKindOf, leaveTypeOf, today,
    });
  }
  if (!context) context = await loadHolidayContext({ ...contextRange, employees, rosterKindOf, leaveTypeOf, today });
  const calendar = ledgerCalendarOf(context, startKey, lastKey);
  const companyDateOf = buildCompanyDateLookup(context);
  const companyEntries = listEmployeeHolidays(context, null, { start: startKey, end: endKey, includeCompensations: false })
    .filter(isEntitlementEntry);

  if (!employees.length) {
    const holidays = companyEntries.map((entry) => columnOf(entry, companyDateOf));
    return withSync({ month, holidays, employees: [], summary: summarizeLedger([], holidays.length, 0), calendar });
  }

  // 初步的應休清單（班表還沒讀，指定應放假日先當作有上班）：本月完全沒有就不讀班表；也用來找出跨月的原始日期
  const prepass = employees.map((employee) => listEmployeeHolidays(context, employee, {
    start: startKey, end: endKey, rosterKindOf: () => 'work',
  }));
  if (!prepass.some((entries) => entries.length)) {
    return withSync({ month, holidays: [], employees: [], summary: summarizeLedger([], 0, 0), calendar });
  }
  const outsideOriginals = [...new Set(prepass.flat().map((entry) => entry.originalDate)
    .filter((key) => key && (key < startKey || key >= endKey)))].sort();

  const ids = employees.map((employee) => toId(employee._id));
  const resolutionFilter = outsideOriginals.length
    ? { employee: { $in: ids }, $or: [{ month }, { holidayDate: { $in: outsideOriginals.map(keyToDate) } }] }
    : { employee: { $in: ids }, month };
  const [scheduleRows, setting, intervals, resolutionRows, compensationRows] = await Promise.all([
    leanResult(ShiftSchedule.find({
      employee: { $in: ids },
      date: { $gte: start, $lt: end },
    }).select('employee date shiftId state')),
    leanResult(AttendanceSetting.findOne()),
    loadApprovedLeaveIntervals({ employeeIds: ids, start, end }),
    leanResult(HolidayRestResolution.find(resolutionFilter)),
    loadCompensationDocs({ ids, start, end, outsideOriginals }),
  ]);
  leaveIntervals = intervals || new Map();

  const semanticByShiftId = buildShiftSemanticLookup(setting);
  const shiftById = buildShiftDocLookup(setting);
  const rowsByEmployee = new Map();
  for (const row of scheduleRows || []) {
    const employeeId = toId(row.employee);
    if (!rowsByEmployee.has(employeeId)) rowsByEmployee.set(employeeId, []);
    rowsByEmployee.get(employeeId).push(row);
    const key = utcDateKey(row.date);
    if (!key) continue;
    if (!scheduledByEmployee.has(employeeId)) scheduledByEmployee.set(employeeId, new Map());
    const shiftKey = toId(row.shiftId);
    scheduledByEmployee.get(employeeId).set(key, { kind: semanticByShiftId.get(shiftKey) || 'work', shift: shiftById.get(shiftKey) || null });
  }
  const neverRostered = await findNeverRosteredIds({ employees, rowsByEmployee, start });
  const outsideAssignedKinds = await loadOutsideAssignedRosterKinds({ docs: compensationRows || [], startKey, endKey, semanticByShiftId });
  // 公司行事曆只讀了 context 範圍所在的年度：其他年度的日期不依行事曆判斷，免得把公司上班日的週六誤判成休息日
  const firstContextYear = Number(String(context.start || startKey).slice(0, 4));
  const lastContextYear = Number(addDaysKey(String(context.end || endKey), -1).slice(0, 4));
  /**
   * 已排定的補假日現在是不是休息日／例假：班表排了休、例，或行政人員當天沒有班表、公司行事曆不是上班日。
   * 是的話員工並沒有因此多休一天（等於被每週的休息日吸收），要標成衝突請人改排。
   */
  const assignedDateIsRest = ({ employeeId, regime, scheduled, key }) => {
    if (!key) return false;
    const rosterKind = key >= startKey && key < endKey
      ? scheduled.get(key)?.kind
      : outsideAssignedKinds.get(`${employeeId}:${key}`);
    if (rosterKind) return REST_ROSTER_KINDS.has(rosterKind);
    const year = Number(key.slice(0, 4));
    if (regime !== 'office' || year < firstContextYear || year > lastContextYear) return false;
    return officeDayKind(context, key) !== 'work';
  };

  const resolutions = resolutionRows || [];
  const authorIds = [...new Set(resolutions.flatMap((doc) => [toId(doc.resolvedBy), toId(doc.createdBy)]).filter(Boolean))];
  const nameById = new Map();
  if (authorIds.length) {
    const people = (await leanResult(Employee.find({ _id: { $in: authorIds } }).select('name'))) || [];
    for (const person of people) nameById.set(toId(person._id), person.name || '');
  }
  const resolutionByKey = new Map(resolutions.map((doc) => [`${toId(doc.employee)}:${utcDateKey(doc.holidayDate)}`, doc]));

  const monthEnded = (toTaipeiDateKey(today) || '') > lastKey;
  const plans = [];
  const detections = [];
  const processedEmployeeIds = new Set();
  let notScheduled = 0;
  const holidayDocKey = (doc) => (doc?.sourceType === 'holiday_rest' && doc.holidayDate ? `${toId(doc.employee)}:${utcDateKey(doc.holidayDate)}` : null);
  const initialDocByKey = new Map((compensationRows || []).map((doc) => [holidayDocKey(doc), doc]).filter(([key]) => key));

  for (const employee of employees) {
    const employeeId = toId(employee._id);
    const employeeRows = rowsByEmployee.get(employeeId) || [];
    const status = String(employee.status || '');
    const regime = resolveHolidayRegime(employee);
    // 離職、留職停薪、一直沒排過班的管理員與主管、不需要排班的輪班人員，本月沒有任何班表就不列入（不然每個假日都會是「未排班」）
    if (!employeeRows.length && (
      status === '離職員工' || status === '留職停薪' || neverRostered.has(employeeId)
      || (regime !== 'office' && employee.requiresScheduling === false)
    )) {
      notScheduled += 1;
      continue;
    }
    processedEmployeeIds.add(employeeId);

    // 日期 -> { 班別性質, 班別 }：判斷國定假日當天是上班、休息還是沒排班
    const scheduled = scheduledByEmployee.get(employeeId) || new Map();
    let lastScheduledKey = '';
    for (const key of scheduled.keys()) if (key > lastScheduledKey) lastScheduledKey = key;
    const onLeave = buildLeaveDayCheck(leaveIntervals?.get?.(employeeId), (key) => scheduled.get(key) || null);
    const dayKindOf = buildDayKindOf({ scheduled, onLeave, regime, context });
    const entries = listEmployeeHolidays(context, employee, {
      start: startKey, end: endKey, rosterKindOf: (_id, key) => scheduled.get(key)?.kind,
    });
    const entitlements = entries.filter(isEntitlementEntry);
    const compensationEntries = entries.filter((entry) => entry.type === 'compensation');
    // 排定的補假日、公務機關補假日上的「國」由那個補假使用，不配給其他國定假日、也不算多排的國
    const reserved = new Set(compensationEntries.map((entry) => entry.date));
    const guoDates = [...scheduled].filter(([key, day]) => day.kind === 'holiday' && !reserved.has(key)).map(([key]) => key);

    const tenure = buildTenureCheck(employee, { hasRows: employeeRows.length > 0, lastScheduledKey });
    const implicitOf = (holiday) => regime === 'office' && !scheduled.has(holiday.date) && dayKindOf(holiday.date) === 'work';
    const { items, extraGuoDates } = assignWithImplicit({
      holidays: entitlements,
      guoDates,
      dayKindOf,
      tenureNaReason: (holiday) => tenure(holiday.date),
      implicitOf,
    });

    // 班表還是草稿、本月又還沒結束：沒排國只是「還沒排」，不是真的沒休。行政人員沒有班表時依行事曆，不必等班表
    const provisional = employeeRows.length
      ? !monthEnded && !employeeRows.every((row) => row.state === 'finalized')
      : (regime === 'office' ? false : !monthEnded);

    const drafts = entitlements.map((entry) => {
      const base = items.get(entry.id);
      const dateKind = dayKindOf(entry.date);
      const storedDoc = resolutionByKey.get(`${employeeId}:${entry.originalDate}`) || null;
      const onRestDay = base.status === LEDGER_STATUS.NOT_TAKEN && REST_DAY_REASONS.has(base.reason);
      const governmentCompensated = entry.compensation?.via === 'gov_makeup';
      if (entry.type === 'statutory') {
        // 補假義務：國定假日落在自己的休息日／例假、本月沒有「國」可用、沒有公務機關補假日、也沒有登記其他處理方式
        const trigger = onRestDay && !governmentCompensated && !storedDoc;
        const officeDay = regime === 'office' && !scheduled.has(entry.date);
        const existing = initialDocByKey.get(`${employeeId}:${entry.originalDate}`);
        const needsSuggestion = trigger && !provisional && (!existing || existing.status === 'void');
        const weekday = weekdayOfKey(entry.date);
        let reason = dateKind === 'regular_rest' ? 'regular_rest' : 'rest_day';
        if (officeDay) reason = weekday === 6 ? 'office_saturday' : (weekday === 0 ? 'office_sunday' : 'office_rest_day');
        const usedDates = existing && existing.status !== 'void' ? datedUsageDates(existing).map((usage) => usage.date) : [];
        detections.push({
          employeeId,
          holidayDate: entry.originalDate,
          holidayName: entry.name,
          calendarDayId: entry.calendarDayId || null,
          trigger,
          skip: provisional,
          reason,
          origin: officeDay ? 'office_weekend' : 'roster_rest_day',
          dayKindAtDetection: officeDay ? 'office_rest_day' : (dateKind === 'regular_rest' ? 'regular_rest' : 'rest_day'),
          voidReason: trigger ? null : voidReasonOf({ base, storedDoc, governmentCompensated }),
          // 已用掉的整天調休日之後被排成休息日／例假：員工並沒有因此多休一天
          usedDateRest: usedDates.some((key) => assignedDateIsRest({ employeeId, regime, scheduled, key })),
          // 建議調休日：行政人員是公務機關補假日（調休存摺上線後），其他是國定假日之後第一個上班日
          suggestedDate: needsSuggestion
            ? ((regime === 'office' ? suggestedGovMakeupDate(context, entry.originalDate) : null)
              || suggestCompensationDate({ context, employee, fromKey: entry.date, scheduled, regime, monthLastKey: lastKey }))
            : null,
        });
      }
      return { entry, base, dateKind, storedDoc, onRestDay, governmentCompensated };
    });

    plans.push({
      employee, employeeId, employeeRows, regime, scheduled, dayKindOf, provisional, drafts, extraGuoDates, compensationEntries, entitlements,
    });
  }

  let sync = null;
  let compensationDocs = compensationRows || [];
  if (syncCompensations) {
    const { syncHolidayCompensationsForLedger } = await import('./holidayCompensationService.js');
    sync = await syncHolidayCompensationsForLedger({
      ledger: { month, detections, docs: compensationDocs, processedEmployeeIds, context },
      now: today,
    });
    if (sync?.writes) compensationDocs = await loadCompensationDocs({ ids, start, end, outsideOriginals });
    sync = {
      created: sync?.created || 0, voided: sync?.voided || 0, reopened: sync?.reopened || 0, conflicts: sync?.conflicts || 0,
    };
  }
  const docByKey = new Map(compensationDocs.map((doc) => [holidayDocKey(doc), doc]).filter(([key]) => key));
  const docsByEmployee = new Map();
  for (const doc of compensationDocs) {
    const employeeId = toId(doc.employee);
    if (!docsByEmployee.has(employeeId)) docsByEmployee.set(employeeId, []);
    docsByEmployee.get(employeeId).push(doc);
  }
  const inMonth = (value) => {
    const key = value ? utcDateKey(value) : '';
    return Boolean(key) && key >= startKey && key < endKey;
  };

  const rows = [];
  for (const plan of plans) {
    const { employee, employeeId, regime, scheduled, dayKindOf, provisional, drafts, extraGuoDates } = plan;
    const list = drafts.map(({ entry, base, dateKind, storedDoc, onRestDay, governmentCompensated }) => {
      const obligation = docByKey.get(`${employeeId}:${entry.originalDate}`) || null;
      const credit = obligation && obligation.status !== 'void' ? obligation : null;
      // 人資作廢的調休（例如已改發加倍工資）：已處理，不再顯示「待存入調休」（同步也不會重新開啟）
      const manualVoid = obligation?.status === 'void' && obligation.voidReason === 'manual' ? obligation : null;
      let status = base.status;
      let compensation = null;
      const firstDated = credit ? datedUsageDates(credit)[0] : null;
      // 有日期的補償：resolver 已經連結到的（整天調休、HR 指定，或記憶體資料的已排定補假），或這筆額度上的第一個整天調休日
      const dated = entry.compensation && entry.compensation.via !== 'gov_makeup'
        ? entry.compensation
        : (!governmentCompensated && firstDated
          ? { date: firstDated.date, via: firstDated.via, compensationId: toId(credit._id), calendarDayId: toId(credit.calendarDay) || null }
          : null);
      const bankFields = credit ? bankCompensationOf(credit) : null;
      const withBank = (value) => (bankFields
        ? { ...value, creditStatus: bankFields.creditStatus, hours: bankFields.hours, usedHours: bankFields.usedHours, remainingHours: bankFields.remainingHours }
        : value);
      if (entry.type === 'statutory' && onRestDay && (governmentCompensated || dated || credit)) {
        status = LEDGER_STATUS.COMPENSATED;
        if (governmentCompensated) {
          compensation = { ...entry.compensation, conflict: false };
        } else if (dated) {
          // 整天調休日之後被排成休息日／例假：仍算已補償，但標示衝突請人改排（員工並沒有因此多休一天）
          const dateRest = assignedDateIsRest({ employeeId, regime, scheduled, key: dated.date });
          compensation = withBank({ ...dated, conflict: dateRest });
          if (dateRest) compensation.conflictReason = 'date_not_workday';
        } else {
          compensation = { ...bankFields, conflict: false };
        }
      } else if (dated) {
        // 已用掉的調休、班表之後又改了（觸發條件不成立）：不自動收回，標示請人確認
        compensation = withBank({ ...dated, conflict: true, conflictReason: 'trigger_gone' });
      } else if (credit && isCreditUsed(credit)) {
        compensation = { ...bankFields, conflict: true, conflictReason: 'trigger_gone' };
      } else if (manualVoid && entry.type === 'statutory' && onRestDay && status === LEDGER_STATUS.NOT_TAKEN) {
        compensation = {
          ...bankCompensationOf(manualVoid), creditStatus: 'void', voidReason: 'manual', usedHours: 0, remainingHours: 0, suggestedDate: null, conflict: false,
        };
      }
      // 登記之後班表又排了「國」或已經補假：登記的紀錄不隱藏，標成衝突請人確認（可能重複補償）
      const resolutionConflict = Boolean(storedDoc) && [
        LEDGER_STATUS.RESTED_ON_DATE, LEDGER_STATUS.MOVED, LEDGER_STATUS.COMPENSATED,
      ].includes(status);
      const resolutionDoc = status === LEDGER_STATUS.NOT_TAKEN || resolutionConflict ? storedDoc : null;
      const resolution = serializeHolidayResolution(resolutionDoc, nameById);
      let needsAction = null;
      if (status === LEDGER_STATUS.NOT_TAKEN && !resolution) {
        if (entry.type === 'statutory' && onRestDay) {
          // 還沒存入調休（沒有同步的檢視）；班表草稿時是「尚未排國」；人資作廢的調休已處理
          if (!manualVoid) needsAction = provisional ? 'schedule' : 'assign_compensation';
        } else if (isActionableReason(base.reason, employee)) {
          needsAction = provisional ? 'schedule' : 'resolve';
        }
      }
      return {
        holidayId: entry.id,
        type: entry.type,
        holidayName: entry.name,
        holidayDate: entry.date,
        originalDate: entry.originalDate,
        movedFrom: entry.movedFrom,
        via: entry.via || null,
        status,
        guoDate: base.guoDate,
        offsetDays: base.offsetDays,
        dateKind,
        reason: base.reason,
        needsAction,
        resolution,
        resolutionConflict,
        compensation,
        implicit: base.implicit === true,
      };
    });

    const counts = {
      entitled: list.filter((item) => item.status !== LEDGER_STATUS.NA).length,
      rested: list.filter((item) => item.status === LEDGER_STATUS.RESTED_ON_DATE).length,
      moved: list.filter((item) => item.status === LEDGER_STATUS.MOVED).length,
      compensated: list.filter((item) => item.status === LEDGER_STATUS.COMPENSATED).length,
      notTaken: list.filter((item) => item.status === LEDGER_STATUS.NOT_TAKEN).length,
      open: list.filter((item) => item.needsAction || item.resolutionConflict || item.compensation?.conflict).length,
    };
    if (!counts.entitled && !extraGuoDates.length) {
      notScheduled += 1;
      continue;
    }
    if (regime === 'office' && !plan.employeeRows.length) {
      // 行政人員沒有班表：國定假日都依行事曆放假，只有本月有調休（來源或整天調休日在本月）才列入
      const touchesObligation = (docsByEmployee.get(employeeId) || []).some((doc) => (
        doc.status !== 'void' && (inMonth(doc.holidayDate) || datedUsageDates(doc).some((usage) => inMonth(usage.date)))
      ));
      const weekendWithoutLink = list.some((item) => (
        item.type === 'statutory'
        && item.status !== LEDGER_STATUS.NA
        && (item.dateKind === 'rest_day' || item.dateKind === 'regular_rest')
        && item.compensation?.via !== 'gov_makeup'
      ));
      if (!touchesObligation && !weekendWithoutLink) {
        notScheduled += 1;
        continue;
      }
    }

    const swapsById = new Map();
    for (const entry of plan.entitlements) {
      if (entry.via === 'swap') swapsById.set(entry.swapId || `swap:${entry.originalDate}`, { id: entry.swapId || null, originalDate: entry.originalDate, targetDate: entry.date });
    }
    for (const entry of companyEntries) {
      const verdict = isNationalHolidayFor(context, employee, entry.originalDate);
      if (verdict.notHolidayReason !== 'swapped_away') continue;
      const known = [...swapsById.values()].some((swap) => swap.originalDate === entry.originalDate);
      if (!known) swapsById.set(`swap:${entry.originalDate}`, { id: null, originalDate: entry.originalDate, targetDate: verdict.movedTo });
    }
    const indigenousDates = [];
    if (employee.isIndigenous === true) {
      for (let key = startKey; key < endKey; key = addDaysKey(key, 1)) {
        if (isNationalHolidayFor(context, employee, key, { rosterKind: scheduled.get(key)?.kind }).reason === 'indigenous') indigenousDates.push(key);
      }
    }

    rows.push({
      employeeId,
      employeeNo: employee.employeeId || '',
      name: employee.name || '',
      title: employee.practiceTitle || employee.title || '',
      subDepartmentName: employee.subDepartment?.name || '',
      partTime: employee.partTime === true,
      regime,
      isIndigenous: employee.isIndigenous === true,
      provisional,
      ...counts,
      items: list,
      extraGuoDates,
      compensations: plan.compensationEntries.map((entry) => ({
        date: entry.date,
        originalDate: entry.originalDate,
        holidayName: entry.holidayName ?? String(entry.name || '').replace(/補假$/, ''),
        via: entry.via,
        compensationId: entry.compensationId || null,
        // 補假當天有排「國」，或行政人員當天沒有班表（依行事曆放假）就算休到了
        taken: dayKindOf(entry.date) === 'holiday' || (regime === 'office' && !scheduled.has(entry.date)),
      })),
      swaps: [...swapsById.values()].sort((a, b) => String(a.originalDate).localeCompare(String(b.originalDate))),
      indigenousDates,
    });
  }

  rows.sort((a, b) => (
    String(a.employeeNo).localeCompare(String(b.employeeNo), 'zh-Hant', { numeric: true })
    || String(a.name).localeCompare(String(b.name), 'zh-Hant')
  ));

  // 欄位：公司層級本月的國定假日，加上各員工個人的應休項目（個人調移進來的、適用的指定應放假日）
  const columns = new Map(companyEntries.map((entry) => [entry.id, columnOf(entry, companyDateOf)]));
  for (const row of rows) {
    for (const item of row.items) {
      const existing = columns.get(item.holidayId);
      if (!existing) {
        columns.set(item.holidayId, columnOf({ id: item.holidayId, type: item.type, name: item.holidayName, originalDate: item.originalDate }, companyDateOf, item.via === 'swap'));
      } else if (item.via !== 'swap') {
        existing.personal = false;
      }
    }
  }
  const holidays = [...columns.values()].sort((a, b) => (
    String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id))
  ));
  return withSync({ month, holidays, employees: rows, summary: summarizeLedger(rows, holidays.length, notScheduled), calendar }, sync);
}

function personOfState(state) {
  if (state?.employee && typeof state.employee === 'object') {
    return state.employee._id ? state.employee : { ...state.employee, _id: state.id };
  }
  return state?.id;
}

/**
 * 班表匯入預覽用的國定假日核對（只產生提醒，不擋匯入）。
 * month + holidayContext：每位員工的應休國定假日由 holidayResolver 決定（輪班人員不含公務機關補假日、個人調移與補假依各人計算），
 *   排定補假日上的「國」由該補假使用。沒有 holidayContext、只帶 holidays 時沿用舊的公司層級清單（相容舊呼叫端）。
 * states：每位匯入員工一筆 { id, employee, rowNumber, employeeCode, cells: [{ rowNumber, day, code, dateKey }], candidateKinds: Map(日期 -> 班別性質), candidateShifts: Map(日期 -> 班別) }，
 *   cells 是匯入檔裡的「國」格子，candidateKinds 是匯入檔每個會寫入的格子的班別性質，candidateShifts 是那些格子的班別（判斷請假有沒有涵蓋整個班次用）。
 * existingSchedules：這些員工本月既有的班表（沒被匯入檔覆蓋的格子仍然有效）；setting：班別設定；
 * leaveIntervals：已核准的請假時間區間 Map(員工 ID -> 區間)（loadApprovedLeaveIntervals），只請幾小時的假不會把整天當成請假。
 * 回傳 [{ row, day, code, message }]：
 *  - 多排的國：比該員工本月應休國定假日還多的「國」格子；沒有任何國定假日時沿用「日曆沒有該日期」的說明。
 *    「國」可以排在當月任何一天（移休），所以只有超過國定假日天數的才提醒。
 *  - 整月檔案（fullMonth）才會有的「國排不足」：本月有國定假日當天上班、未排班、卻沒有國可對應，每位員工一則。
 */
export function buildImportHolidayWarnings({
  month = null,
  holidayContext = null,
  states = [],
  existingSchedules = [],
  setting = null,
  leaveIntervals = null,
  fullMonth = false,
  holidays = undefined,
} = {}) {
  const range = holidayContext ? parseLedgerMonth(month) : null;
  const semanticByShiftId = buildShiftSemanticLookup(setting);
  const shiftById = buildShiftDocLookup(setting);
  const existingDays = new Map();
  for (const schedule of existingSchedules || []) {
    const id = toId(schedule.employee);
    const key = utcDateKey(schedule.date);
    if (!id || !key) continue;
    if (!existingDays.has(id)) existingDays.set(id, new Map());
    const shiftKey = toId(schedule.shiftId);
    existingDays.get(id).set(key, { kind: semanticByShiftId.get(shiftKey) || 'work', shift: shiftById.get(shiftKey) || null });
  }

  const warnings = [];
  for (const state of states) {
    // 日期 -> { 班別性質, 班別 }：既有的班表加上匯入檔會寫入的格子（匯入檔優先）
    const scheduled = new Map(existingDays.get(state.id) || []);
    for (const [key, kind] of state.candidateKinds || []) scheduled.set(key, { kind, shift: state.candidateShifts?.get?.(key) || null });

    let employeeHolidays = Array.isArray(holidays) ? holidays : [];
    let reserved = new Set();
    let regime = 'roster';
    if (holidayContext && range) {
      const person = personOfState(state);
      regime = resolveHolidayRegime(person);
      const entries = listEmployeeHolidays(holidayContext, person, {
        start: range.start,
        end: range.end,
        rosterKindOf: (_id, key) => scheduled.get(key)?.kind,
      });
      employeeHolidays = entries.filter(isEntitlementEntry);
      reserved = new Set(entries.filter((entry) => entry.type === 'compensation').map((entry) => entry.date));
    }
    const guoDates = [...scheduled].filter(([key, day]) => day.kind === 'holiday' && !reserved.has(key)).map(([key]) => key);
    if (!guoDates.length && !fullMonth) continue;

    const onLeave = buildLeaveDayCheck(leaveIntervals?.get?.(state.id), (key) => scheduled.get(key) || null);
    const dayKindOf = buildDayKindOf({ scheduled, onLeave, regime, context: holidayContext });
    const tenure = buildTenureCheck(state.employee, {
      hasRows: true,
      lastScheduledKey: [...scheduled.keys()].sort().pop() || '',
    });
    const { items, extraGuoDates } = assignWithImplicit({
      holidays: employeeHolidays,
      guoDates,
      dayKindOf,
      tenureNaReason: (holiday) => tenure(holiday.date),
      implicitOf: (holiday) => regime === 'office' && !scheduled.has(holiday.date) && dayKindOf(holiday.date) === 'work',
    });

    const extra = new Set(extraGuoDates);
    for (const cell of state.cells || []) {
      if (!extra.has(cell.dateKey)) continue;
      warnings.push({
        row: cell.rowNumber,
        day: cell.day,
        code: cell.code,
        message: employeeHolidays.length
          ? `「${cell.code}」為國定假日班別，但本月系統假日日曆只有 ${employeeHolidays.length} 個國定假日，這個「${cell.code}」超過國定假日天數，請確認假日設定或排班`
          : `「${cell.code}」為國定假日班別，但系統假日日曆沒有該日期的國定假日，請確認假日設定`,
      });
    }

    if (!fullMonth) continue;
    const missing = employeeHolidays.filter((holiday) => {
      const item = items.get(holiday.id);
      return item?.status === LEDGER_STATUS.NOT_TAKEN && isActionableReason(item.reason, state.employee);
    });
    if (!missing.length) continue;
    const entitled = employeeHolidays.filter((holiday) => items.get(holiday.id)?.status !== LEDGER_STATUS.NA).length;
    const placed = guoDates.length - extraGuoDates.length;
    warnings.push({
      row: state.rowNumber,
      day: null,
      code: state.employeeCode,
      message: `本月 ${entitled} 個國定假日只排了 ${placed} 個「國」，尚未休到：${missing.map((holiday) => `${holiday.name} ${holiday.date.slice(5).replace('-', '/')}`).join('、')}；請補排，或匯入後在排班頁「國定假日休假」登記處理方式`,
    });
  }
  return warnings;
}

export const __testUtils = { dayNumber, utcDateKey, toId, REASON_BY_DAY_KIND, ACTIONABLE_REASONS };
