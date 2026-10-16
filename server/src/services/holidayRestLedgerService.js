/**
 * 國定假日休假紀錄（Holiday Rest Ledger）。
 *
 * 紀錄是「推算」出來的，不另外存一份：班表（ShiftSchedule）才是唯一的資料來源，
 * 員工在哪一天排了「國」（班別性質 holiday）就是在那天休了國定假日。
 * 每個員工 × 每個國定假日得到下列狀態：
 *   rested_on_date  國定假日當天就排了「國」
 *   moved           國定假日當天沒有休，但同月其他日期排了「國」（移休，會記錄是哪一天）
 *   not_taken       本月沒有對應的「國」（沒休；reason 說明當天是上班、沒排班、休息日、請假…）
 *   na              不在職（到職前、離職後、留職停薪），不計入應休
 * 本月多出來、沒有對應到任何國定假日的「國」另外列為 extraGuoDates（多排的國）。
 * 只有「沒休的國定假日後續怎麼處理」這種人工決定才會存進資料庫（HolidayRestResolution）。
 *
 * 國定假日的認定與公司層級挪移（HolidayMoveSetting）和排班頁、加班費共用 countedHolidayService。
 */
import Holiday from '../models/Holiday.js';
import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import Employee from '../models/Employee.js';
import HolidayRestResolution from '../models/HolidayRestResolution.js';
import { buildEffectiveMonthHolidays, isPayableNationalHoliday } from './countedHolidayService.js';
import { loadApprovedLeaveCalendar } from './approvedLeaveCalendarService.js';
import { resolveShiftSemanticType } from './shiftSemanticService.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

export const LEDGER_STATUS = Object.freeze({
  RESTED_ON_DATE: 'rested_on_date',
  MOVED: 'moved',
  NOT_TAKEN: 'not_taken',
  NA: 'na',
});

export const LEDGER_STATUS_LABELS = Object.freeze({
  rested_on_date: '當日休',
  moved: '移休',
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

// 這些原因代表國定假日當天是上班、沒排或被別的假日佔用，需要人處理；
// 適逢休息日、例假、請假只是提示（法規與公司規定由 HR 判斷），不算待處理
const ACTIONABLE_REASONS = new Set(['worked', 'unscheduled', 'shared_date']);

// 國定假日當天本來就不用休息（上班或沒排班）的才「需要」一個國；其餘日子優先配給這類假日
const NEEDS_REST_DAY_KINDS = new Set(['work', 'none']);

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
 * holidays：[{ id, date, movedFrom }]（buildEffectiveMonthHolidays 的結果）；guoDates：員工本月排了「國」的日期。
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

/** 一個項目在報表（Excel）上顯示的文字；班表還是草稿、本月還沒結束的待處理項目（needsAction = schedule）顯示「尚未排國」 */
export function describeLedgerItem(item) {
  if (!item) return '';
  if (item.status === LEDGER_STATUS.RESTED_ON_DATE) return '當日休';
  if (item.status === LEDGER_STATUS.MOVED) return `移休 ${String(item.guoDate || '').slice(5).replace('-', '/')}`;
  if (item.status === LEDGER_STATUS.NA) return '—';
  if (item.resolution) return `未休（${LEDGER_RESOLUTION_LABELS[item.resolution.kind] || '已處理'}）`;
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
    notTaken: 0,
    open: 0,
    extra: 0,
    excluded: { notScheduled },
  };
  for (const row of rows) {
    summary.entitled += row.entitled;
    summary.rested += row.rested;
    summary.moved += row.moved;
    summary.notTaken += row.notTaken;
    summary.open += row.open;
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
  };
}

/**
 * 單一月份的國定假日休假紀錄。
 * employees：lean 員工資料（_id、employeeId、name、title、practiceTitle、subDepartment、status、appointment、requiresScheduling、partTime）。
 * holidayDocs / moves：呼叫端已經查好這個月的假日與已啟用的挪移設定時帶入，就不會重複查詢。
 * 回傳 { month, holidays, employees, summary }；沒有國定假日的月份不查班表，直接回傳空清單。
 * 兼職人員與一般員工一樣有紀錄（partTime 只是標示，方便畫面辨識）。
 */
export async function buildHolidayRestLedger({
  month,
  employees = [],
  today = new Date(),
  holidayDocs: preloadedHolidayDocs = null,
  moves: preloadedMoves = null,
} = {}) {
  const range = parseLedgerMonth(month);
  if (!range) throw new Error('invalid month');
  const { start, end, lastKey } = range;

  // 呼叫端（班表匯出）已經查過這個月的假日與挪移設定時可以直接帶入，省下重複查詢
  const holidayDocs = preloadedHolidayDocs
    || (await leanResult(Holiday.find({ date: { $gte: start, $lt: end } })))
    || [];
  if (!holidayDocs.some(isPayableNationalHoliday)) {
    return { month, holidays: [], employees: [], summary: summarizeLedger([], 0, 0) };
  }
  const moves = preloadedMoves
    || (await leanResult(HolidayMoveSetting.find({ enableHolidayMove: true })))
    || [];
  const holidays = buildEffectiveMonthHolidays({ holidays: holidayDocs, moves, month });
  if (!holidays.length || !employees.length) {
    return { month, holidays, employees: [], summary: summarizeLedger([], holidays.length, 0) };
  }

  const ids = employees.map((employee) => toId(employee._id));
  const [scheduleRows, setting, leaveCalendar, resolutionRows] = await Promise.all([
    leanResult(ShiftSchedule.find({
      employee: { $in: ids },
      date: { $gte: start, $lt: end },
    }).select('employee date shiftId state')),
    leanResult(AttendanceSetting.findOne()),
    loadApprovedLeaveCalendar({ employeeIds: ids, start, end }),
    leanResult(HolidayRestResolution.find({ employee: { $in: ids }, month })),
  ]);

  const semanticByShiftId = buildShiftSemanticLookup(setting);
  const rowsByEmployee = new Map();
  for (const row of scheduleRows || []) {
    const employeeId = toId(row.employee);
    if (!rowsByEmployee.has(employeeId)) rowsByEmployee.set(employeeId, []);
    rowsByEmployee.get(employeeId).push(row);
  }

  const resolutions = resolutionRows || [];
  const resolvedByIds = [...new Set(resolutions.map((doc) => toId(doc.resolvedBy)).filter(Boolean))];
  const nameById = new Map();
  if (resolvedByIds.length) {
    const people = (await leanResult(Employee.find({ _id: { $in: resolvedByIds } }).select('name'))) || [];
    for (const person of people) nameById.set(toId(person._id), person.name || '');
  }
  const resolutionByKey = new Map(resolutions.map((doc) => [`${toId(doc.employee)}:${utcDateKey(doc.holidayDate)}`, doc]));

  const monthEnded = (toTaipeiDateKey(today) || '') > lastKey;
  const rows = [];
  let notScheduled = 0;

  for (const employee of employees) {
    const employeeId = toId(employee._id);
    const employeeRows = rowsByEmployee.get(employeeId) || [];
    const status = String(employee.status || '');
    // 離職、留職停薪、不需要排班的人，本月沒有任何班表就不列入（不然每個假日都會是「未排班」）
    if (!employeeRows.length && (status === '離職員工' || status === '留職停薪' || employee.requiresScheduling === false)) {
      notScheduled += 1;
      continue;
    }

    const kindByDate = new Map();
    const guoDates = [];
    let lastScheduledKey = '';
    for (const row of employeeRows) {
      const key = utcDateKey(row.date);
      if (!key) continue;
      const kind = semanticByShiftId.get(toId(row.shiftId)) || 'work';
      kindByDate.set(key, kind);
      if (kind === 'holiday') guoDates.push(key);
      if (key > lastScheduledKey) lastScheduledKey = key;
    }
    const leaveDays = leaveCalendar?.get?.(employeeId);
    const dayKindOf = (key) => (leaveDays?.has(key) ? 'leave' : (kindByDate.get(key) || 'none'));

    const tenure = buildTenureCheck(employee, { hasRows: employeeRows.length > 0, lastScheduledKey });
    const { items, extraGuoDates } = assignHolidayRests({
      holidays,
      guoDates,
      dayKindOf,
      tenureNaReason: (holiday) => tenure(holiday.date),
    });

    // 班表還是草稿、本月又還沒結束：沒排國只是「還沒排」，不是真的沒休
    const provisional = !monthEnded && !(employeeRows.length > 0 && employeeRows.every((row) => row.state === 'finalized'));
    const list = holidays.map((holiday) => {
      const assigned = items.get(holiday.id);
      const resolutionDoc = assigned.status === LEDGER_STATUS.NOT_TAKEN
        ? resolutionByKey.get(`${employeeId}:${holiday.originalDate}`)
        : null;
      const resolution = serializeHolidayResolution(resolutionDoc, nameById);
      let needsAction = null;
      if (assigned.status === LEDGER_STATUS.NOT_TAKEN && !resolution && ACTIONABLE_REASONS.has(assigned.reason)) {
        needsAction = provisional ? 'schedule' : 'resolve';
      }
      return {
        holidayId: holiday.id,
        holidayName: holiday.name,
        holidayDate: holiday.date,
        originalDate: holiday.originalDate,
        movedFrom: holiday.movedFrom,
        status: assigned.status,
        guoDate: assigned.guoDate,
        offsetDays: assigned.offsetDays,
        dateKind: dayKindOf(holiday.date),
        reason: assigned.reason,
        needsAction,
        resolution,
      };
    });

    const counts = {
      entitled: list.filter((item) => item.status !== LEDGER_STATUS.NA).length,
      rested: list.filter((item) => item.status === LEDGER_STATUS.RESTED_ON_DATE).length,
      moved: list.filter((item) => item.status === LEDGER_STATUS.MOVED).length,
      notTaken: list.filter((item) => item.status === LEDGER_STATUS.NOT_TAKEN).length,
      open: list.filter((item) => item.needsAction).length,
    };
    if (!counts.entitled && !extraGuoDates.length) {
      notScheduled += 1;
      continue;
    }

    rows.push({
      employeeId,
      employeeNo: employee.employeeId || '',
      name: employee.name || '',
      title: employee.practiceTitle || employee.title || '',
      subDepartmentName: employee.subDepartment?.name || '',
      partTime: employee.partTime === true,
      provisional,
      ...counts,
      items: list,
      extraGuoDates,
    });
  }

  rows.sort((a, b) => (
    String(a.employeeNo).localeCompare(String(b.employeeNo), 'zh-Hant', { numeric: true })
    || String(a.name).localeCompare(String(b.name), 'zh-Hant')
  ));
  return { month, holidays, employees: rows, summary: summarizeLedger(rows, holidays.length, notScheduled) };
}

/**
 * 班表匯入預覽用的國定假日核對（只產生提醒，不擋匯入）。
 * states：每位匯入員工一筆 { id, employee, rowNumber, employeeCode, cells: [{ rowNumber, day, code, dateKey }], candidateKinds: Map(日期 -> 班別性質) }，
 *   cells 是匯入檔裡的「國」格子，candidateKinds 是匯入檔每個會寫入的格子的班別性質。
 * existingSchedules：這些員工本月既有的班表（沒被匯入檔覆蓋的格子仍然有效）；setting：班別設定；leaveCalendar：已核准請假日曆。
 * 回傳 [{ row, day, code, message }]：
 *  - 多排的國：比本月國定假日還多的「國」格子；本月沒有任何國定假日時沿用「日曆沒有該日期」的說明。
 *    「國」可以排在當月任何一天（移休），所以只有超過國定假日天數的才提醒。
 *  - 整月檔案（fullMonth）才會有的「國排不足」：本月有國定假日當天上班、未排班、卻沒有國可對應，每位員工一則。
 */
export function buildImportHolidayWarnings({
  holidays = [],
  states = [],
  existingSchedules = [],
  setting = null,
  leaveCalendar = null,
  fullMonth = false,
} = {}) {
  const semanticByShiftId = buildShiftSemanticLookup(setting);
  const existingKinds = new Map();
  for (const schedule of existingSchedules || []) {
    const id = toId(schedule.employee);
    const key = utcDateKey(schedule.date);
    if (!id || !key) continue;
    if (!existingKinds.has(id)) existingKinds.set(id, new Map());
    existingKinds.get(id).set(key, semanticByShiftId.get(toId(schedule.shiftId)) || 'work');
  }

  const warnings = [];
  for (const state of states) {
    const kinds = new Map(existingKinds.get(state.id) || []);
    for (const [key, kind] of state.candidateKinds || []) kinds.set(key, kind);
    const guoDates = [...kinds].filter(([, kind]) => kind === 'holiday').map(([key]) => key);
    if (!guoDates.length && !fullMonth) continue;

    const leaveDays = leaveCalendar?.get?.(state.id);
    const dayKindOf = (key) => (leaveDays?.has(key) ? 'leave' : (kinds.get(key) || 'none'));
    const tenure = buildTenureCheck(state.employee, {
      hasRows: true,
      lastScheduledKey: [...kinds.keys()].sort().pop() || '',
    });
    const { items, extraGuoDates } = assignHolidayRests({
      holidays,
      guoDates,
      dayKindOf,
      tenureNaReason: (holiday) => tenure(holiday.date),
    });

    const extra = new Set(extraGuoDates);
    for (const cell of state.cells || []) {
      if (!extra.has(cell.dateKey)) continue;
      warnings.push({
        row: cell.rowNumber,
        day: cell.day,
        code: cell.code,
        message: holidays.length
          ? `「${cell.code}」為國定假日班別，但本月系統假日日曆只有 ${holidays.length} 個國定假日，這個「${cell.code}」超過國定假日天數，請確認假日設定或排班`
          : `「${cell.code}」為國定假日班別，但系統假日日曆沒有該日期的國定假日，請確認假日設定`,
      });
    }

    if (!fullMonth) continue;
    const missing = holidays.filter((holiday) => {
      const item = items.get(holiday.id);
      return item?.status === LEDGER_STATUS.NOT_TAKEN && ACTIONABLE_REASONS.has(item.reason);
    });
    if (!missing.length) continue;
    const entitled = holidays.filter((holiday) => items.get(holiday.id)?.status !== LEDGER_STATUS.NA).length;
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
