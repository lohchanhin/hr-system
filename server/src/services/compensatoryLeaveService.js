/**
 * 調休存摺（CompensatoryCredit）：國定假日剛好落在員工自己的休息日／例假時，員工得到一筆調休（預設 8 小時），
 * 預設保存，員工自己決定要不要用、什麼時候用（發起調休簽核）；人資也可以手動給予、扣除，或替員工指定日期（HR 指定）。
 *  - 額度怎麼產生、作廢：holidayCompensationService.syncHolidayCompensationsForLedger（由國定假日休假紀錄推算觸發條件）。
 *  - 這裡負責：額度的狀態與顯示文字、餘額、依「到期日 → 取得日」先後扣用（簽核核准時）、撤回時返還、
 *    人資手動給予／扣除／作廢，以及部署時的資料轉換（舊的補假義務、員工資料的補休時數）。
 *  - 獨立的單機 MongoDB 沒有交易：每一筆額度各自用條件式原子更新（剩餘時數夠才扣、同一張簽核單只扣一次），
 *    跨好幾筆額度時中途失敗就把已扣的退回；返還只退「這張單確實扣過」的部分，所以重複呼叫不會重複返還。
 *  - 期限：假別規則的 compensationExpiryMonths（預設 0 = 不設期限）。設定後依取得日即時判斷「已過期」，不另存狀態，餘額不含已過期的時數。
 */
import { Types } from 'mongoose';
import CompensatoryCredit from '../models/CompensatoryCredit.js';
import CompensatoryLeaveState, { COMPENSATORY_LEAVE_STATE_KEY } from '../models/CompensatoryLeaveState.js';
import HolidayCompensation from '../models/HolidayCompensation.js';
import Employee from '../models/Employee.js';
import { getLeavePolicy } from './leavePolicyService.js';
import { isNationalHolidayFor, loadHolidayContext, officeDayKind } from './holidayResolver.js';
import { resolveHolidayRegime } from './holidayCalendarRules.js';
import { loadScheduledShiftHours, MAX_SCHEDULE_LOOKUP_DAYS } from './leaveShiftHours.js';
import { parseLeaveInterval, splitLeaveByDay } from '../utils/leaveDuration.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';
import { LEAVE_DAY_EQUIVALENT_HOURS, formatHoursText, isMultipleOfStep, roundHours } from '../utils/leaveHours.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE_LENGTH = 500;
const MAX_MANUAL_HOURS = 1000;
// 一次扣用遇到並行更新時，重新讀取再試的次數
const MAX_CONSUME_ATTEMPTS = 4;
const DEFAULT_HOURS_PER_CREDIT = 8;

export const CREDIT_STATUS_LABELS = Object.freeze({
  available: '未使用',
  partial: '部分使用',
  used: '已使用',
  expired: '已過期',
  void: '已失效',
});

export const CREDIT_REASON_LABELS = Object.freeze({
  rest_day: '適逢休息日',
  regular_rest: '適逢例假',
  office_saturday: '適逢週六',
  office_sunday: '適逢週日',
  office_rest_day: '適逢公司休息日',
  manual_holiday: '人資補登',
  manual: '人資手動給予',
  legacy: '轉入既有補休時數',
});

export const USAGE_KIND_LABELS = Object.freeze({
  leave_request: '調休簽核',
  hr_assigned: 'HR 指定',
  adjustment: '人資扣除',
});

export const CREDIT_VOID_REASON_LABELS = Object.freeze({
  covered_by_roster: '班表已排「國」休到這個假日',
  roster_changed: '班表已改（不再是休息日／例假）',
  holiday_removed: '這天已不是國定假日',
  not_applicable: '不適用（已另行處理或不在職）',
  manual: '人資作廢',
});

export const LEGACY_HOURS_NOTE = '轉入既有補休時數';

/** 存摺 API 的錯誤：status 是 HTTP 狀態碼，code 給前端對應訊息，message 是繁體中文 */
export class CompensatoryLeaveError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'CompensatoryLeaveError';
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

function fail(status, code, message, extra) {
  throw new CompensatoryLeaveError(status, code, message, extra);
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

function plainDoc(doc) {
  return typeof doc?.toObject === 'function' ? doc.toObject() : doc;
}

function dateKeyOf(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function keyToDate(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDaysKey(key, days) {
  return new Date(keyToDate(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 加 months 個月（月底對齊：1/31 + 1 個月 = 2/28） */
function addMonthsKey(key, months) {
  const [year, month, day] = key.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function todayKeyOf(now) {
  return toTaipeiDateKey(now) || new Date().toISOString().slice(0, 10);
}

function cleanNote(value, label = '備註') {
  const text = String(value ?? '').trim();
  if (text.length > MAX_NOTE_LENGTH) fail(400, 'NOTE_TOO_LONG', `${label}不可超過 ${MAX_NOTE_LENGTH} 個字`);
  return text;
}

/* ---------------------------- 假別規則 ---------------------------- */

/** 假別規則裡的調休設定：每筆幾小時（預設 8）、期限幾個月（預設 0 = 不設期限）、最小單位 */
export function creditPolicyOf(policy) {
  const hours = Number(policy?.compensationHoursPerCredit);
  const months = Number(policy?.compensationExpiryMonths);
  const unit = Number(policy?.minUnitHours);
  return {
    hoursPerCredit: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_HOURS_PER_CREDIT,
    expiryMonths: Number.isInteger(months) && months > 0 ? months : 0,
    minUnitHours: Number.isFinite(unit) && unit > 0 ? unit : 0.5,
  };
}

/* ---------------------------- 單筆額度的狀態（純函式） ---------------------------- */

/** 請休期限（最後一天，台灣日期）；不設期限回傳 null */
export function creditExpiryKey(credit, expiryMonths = 0) {
  if (!(expiryMonths > 0)) return null;
  const earned = dateKeyOf(credit?.earnedDate);
  if (!earned) return null;
  return addDaysKey(addMonthsKey(earned, expiryMonths), -1);
}

/**
 * 一筆額度現在的樣子：status 是 available／partial（部分使用）／used／expired／void，
 * remainingHours 是還能用的時數（已過期、作廢一律 0），expiredHours 是過期沒用掉的時數。
 */
export function creditView(credit, { todayKey, expiryMonths = 0 } = {}) {
  const hours = roundHours(Number(credit?.hours) || 0);
  const usedHours = roundHours(Math.min(Math.max(Number(credit?.usedHours) || 0, 0), hours));
  const left = roundHours(hours - usedHours);
  const expiresOn = creditExpiryKey(credit, expiryMonths);
  let status;
  if (credit?.status === 'void') status = 'void';
  else if (left <= 0) status = 'used';
  else if (expiresOn && todayKey && todayKey > expiresOn) status = 'expired';
  else status = usedHours > 0 ? 'partial' : 'available';
  return {
    status,
    hours,
    usedHours,
    remainingHours: status === 'available' || status === 'partial' ? left : 0,
    expiredHours: status === 'expired' ? left : 0,
    expiresOn,
  };
}

/** 來源的一行文字，例如「2026-10-25 臺灣光復暨金門古寧頭大捷紀念日 適逢週日」「人資手動給予：加班換休」 */
export function describeCreditSource(credit) {
  if (!credit) return '';
  const reasonText = CREDIT_REASON_LABELS[credit.reason] || '';
  if (credit.sourceType === 'holiday_rest') {
    const date = dateKeyOf(credit.holidayDate) || '';
    return [date, credit.holidayName || '國定假日', reasonText].filter(Boolean).join(' ');
  }
  if (credit.sourceType === 'legacy_balance') return LEGACY_HOURS_NOTE;
  const note = String(credit.note || '').trim();
  return note ? `${CREDIT_REASON_LABELS.manual}：${note}` : CREDIT_REASON_LABELS.manual;
}

/** 扣用順序：先到期的先扣（不設期限的排後面），再來是先取得的，最後依建立先後 */
export function sortCreditsForConsumption(credits = [], expiryMonths = 0) {
  return [...credits].sort((a, b) => {
    const ea = creditExpiryKey(a, expiryMonths);
    const eb = creditExpiryKey(b, expiryMonths);
    if (ea !== eb) {
      if (!ea) return 1;
      if (!eb) return -1;
      return ea.localeCompare(eb);
    }
    const da = dateKeyOf(a.earnedDate) || '';
    const db = dateKeyOf(b.earnedDate) || '';
    if (da !== db) return da.localeCompare(db);
    const ca = new Date(a.createdAt || 0).getTime();
    const cb = new Date(b.createdAt || 0).getTime();
    if (ca !== cb) return ca - cb;
    return toId(a._id).localeCompare(toId(b._id));
  });
}

/**
 * 依扣用順序把 hours 分到各筆額度（純函式）：回傳 { plan: [{ credit, take }], availableHours, shortHours }。
 * 只用還能用的額度（未過期、沒作廢、還有剩）。
 */
export function planConsumption(credits = [], hours, { todayKey, expiryMonths = 0 } = {}) {
  let left = roundHours(Number(hours) || 0);
  const plan = [];
  let availableHours = 0;
  for (const credit of sortCreditsForConsumption(credits, expiryMonths)) {
    const view = creditView(credit, { todayKey, expiryMonths });
    if (!(view.remainingHours > 0)) continue;
    availableHours = roundHours(availableHours + view.remainingHours);
    if (left <= 0) continue;
    const take = roundHours(Math.min(view.remainingHours, left));
    plan.push({ credit, take });
    left = roundHours(left - take);
  }
  return { plan, availableHours, shortHours: left > 0 ? left : 0 };
}

/** 整份存摺的合計（純函式） */
export function summarizeCredits(credits = [], { todayKey, expiryMonths = 0 } = {}) {
  const summary = { earnedHours: 0, usedHours: 0, balanceHours: 0, expiredHours: 0, credits: 0, conflicts: 0 };
  for (const credit of credits) {
    const view = creditView(credit, { todayKey, expiryMonths });
    if (view.status === 'void') continue;
    summary.credits += 1;
    summary.earnedHours = roundHours(summary.earnedHours + view.hours);
    summary.usedHours = roundHours(summary.usedHours + view.usedHours);
    summary.balanceHours = roundHours(summary.balanceHours + view.remainingHours);
    summary.expiredHours = roundHours(summary.expiredHours + view.expiredHours);
    if (credit.conflict === true) summary.conflicts += 1;
  }
  return summary;
}

function serializeUsage(usage, { nameById = new Map(), requestById = new Map() } = {}) {
  const requestId = toId(usage.approvalRequest) || null;
  const request = requestId ? requestById.get(requestId) : null;
  return {
    id: toId(usage._id) || null,
    kind: usage.kind,
    kindLabel: USAGE_KIND_LABELS[usage.kind] || '',
    hours: roundHours(Number(usage.hours) || 0),
    approvalRequestId: requestId,
    approvalStatus: request?.status || null,
    days: (usage.days || []).map((day) => ({ date: day.date, hours: roundHours(Number(day.hours) || 0) })),
    fullDayDates: [...(usage.fullDayDates || [])],
    note: usage.note || '',
    byName: nameById.get(toId(usage.by)) || '',
    at: usage.at || null,
  };
}

/** 一筆額度給畫面看的樣子（來源文字、狀態、剩餘、用在哪張簽核單） */
export function serializeCredit(credit, { todayKey, expiryMonths = 0, nameById = new Map(), requestById = new Map() } = {}) {
  const view = creditView(credit, { todayKey, expiryMonths });
  const usages = (credit.usages || []).map((usage) => serializeUsage(usage, { nameById, requestById }));
  const assigned = usages.find((usage) => usage.kind === 'hr_assigned') || null;
  return {
    id: toId(credit._id),
    employeeId: toId(credit.employee),
    sourceType: credit.sourceType,
    sourceText: describeCreditSource(credit),
    reason: credit.reason,
    reasonText: CREDIT_REASON_LABELS[credit.reason] || '',
    holidayDate: dateKeyOf(credit.holidayDate),
    holidayName: credit.holidayName || '',
    earnedDate: dateKeyOf(credit.earnedDate),
    hours: view.hours,
    usedHours: view.usedHours,
    remainingHours: view.remainingHours,
    expiredHours: view.expiredHours,
    status: view.status,
    statusLabel: CREDIT_STATUS_LABELS[view.status] || '',
    expiresOn: view.expiresOn,
    suggestedDate: dateKeyOf(credit.suggestedDate),
    assignedDate: assigned?.fullDayDates?.[0] || null,
    assignNote: assigned?.note || '',
    conflict: credit.conflict === true,
    conflictReason: credit.conflict === true ? (credit.conflictReason || 'trigger_gone') : null,
    voidReason: credit.status === 'void' ? (credit.voidReason || null) : null,
    voidReasonText: credit.status === 'void' ? (CREDIT_VOID_REASON_LABELS[credit.voidReason] || '') : '',
    note: credit.note || '',
    createdByName: nameById.get(toId(credit.createdBy)) || '',
    createdAt: credit.createdAt || null,
    usages,
  };
}

/* ---------------------------- 讀取存摺 ---------------------------- */

export async function loadEmployeeCredits(employeeId, { includeVoid = true } = {}) {
  const filter = { employee: employeeId };
  if (!includeVoid) filter.status = { $ne: 'void' };
  let find = CompensatoryCredit.find(filter);
  if (typeof find?.sort === 'function') find = find.sort({ earnedDate: 1, createdAt: 1 });
  return (await leanResult(find)) || [];
}

async function loadNames(ids) {
  const unique = [...new Set(ids.filter((id) => isObjectId(id)))];
  const nameById = new Map();
  if (!unique.length) return nameById;
  let find = Employee.find({ _id: { $in: unique } });
  if (typeof find?.select === 'function') find = find.select('name');
  const people = (await leanResult(find)) || [];
  for (const person of people) nameById.set(toId(person._id), person.name || '');
  return nameById;
}

async function loadRequestStatuses(ids) {
  const unique = [...new Set(ids.filter((id) => isObjectId(id)))];
  const requestById = new Map();
  if (!unique.length) return requestById;
  // 延後載入：只有要顯示「用在哪張簽核單」時才需要簽核單模型
  const { default: ApprovalRequest } = await import('../models/approval_request.js');
  let find = ApprovalRequest.find({ _id: { $in: unique } });
  if (typeof find?.select === 'function') find = find.select('status createdAt');
  const rows = (await leanResult(find)) || [];
  for (const row of rows) requestById.set(toId(row._id), { status: row.status });
  return requestById;
}

/** 把額度清單組成畫面用的資料（會查名字與簽核單狀態，各一次） */
export async function serializeCredits(credits = [], { now = new Date(), policy = null } = {}) {
  const activePolicy = policy || await getLeavePolicy();
  const { expiryMonths } = creditPolicyOf(activePolicy);
  const todayKey = todayKeyOf(now);
  const personIds = credits.flatMap((credit) => [toId(credit.createdBy), ...(credit.usages || []).map((usage) => toId(usage.by))]);
  const requestIds = credits.flatMap((credit) => (credit.usages || []).map((usage) => toId(usage.approvalRequest)));
  const [nameById, requestById] = await Promise.all([loadNames(personIds), loadRequestStatuses(requestIds)]);
  return credits.map((credit) => serializeCredit(credit, { todayKey, expiryMonths, nameById, requestById }));
}

/**
 * 員工的調休存摺：餘額（不含已過期）、簽核中的調休時數（呼叫端算好傳進來）、可再申請的時數，以及每一筆額度。
 * pendingHours：簽核中的調休申請時數（leaveBalanceService.computeCompLeavePendingHours）。
 */
export async function buildCompensatoryBank({ employeeId, pendingHours = 0, now = new Date(), policy = null, includeVoid = true } = {}) {
  const activePolicy = policy || await getLeavePolicy();
  const { hoursPerCredit, expiryMonths } = creditPolicyOf(activePolicy);
  const todayKey = todayKeyOf(now);
  const credits = await loadEmployeeCredits(employeeId, { includeVoid: true });
  const summary = summarizeCredits(credits, { todayKey, expiryMonths });
  const pending = roundHours(Math.max(Number(pendingHours) || 0, 0));
  const visible = includeVoid ? credits : credits.filter((credit) => credit.status !== 'void');
  const serialized = await serializeCredits([...visible].reverse(), { now, policy: activePolicy });
  return {
    employeeId: toId(employeeId),
    hoursPerCredit,
    expiryMonths,
    ...summary,
    pendingHours: pending,
    availableHours: roundHours(summary.balanceHours - pending),
    credits: serialized,
  };
}

/* ---------------------------- 調休單的每日分布（哪幾天是整天調休） ---------------------------- */

/**
 * 依各日「本來要上班的時數」分配這張調休單的時數（純函式）：covered 是 [{ dateKey, hours }]（splitLeaveByDay 以 24 小時切），
 * capacityOf(日期) 是那天本來要上班的時數（已是假日、休息日為 0）。依日期先後填滿，填滿當天上班時數的日子是「整天調休」。
 * 分不完的時數（例如請在休息日）記在最後一天，不算整天。回傳 { days: [{ date, hours }], fullDayDates }。
 */
export function allocateCompLeaveDays({ covered = [], hours, allDay = true, capacityOf = () => LEAVE_DAY_EQUIVALENT_HOURS } = {}) {
  let left = roundHours(Number(hours) || 0);
  const days = [];
  const fullDayDates = [];
  for (const item of covered) {
    if (left <= 0) break;
    const workHours = Math.max(Number(capacityOf(item.dateKey)) || 0, 0);
    const capacity = allDay ? workHours : Math.min(workHours, Number(item.hours) || 0);
    if (!(capacity > 0)) continue;
    const take = roundHours(Math.min(capacity, left));
    days.push({ date: item.dateKey, hours: take });
    // 有時分的請假要涵蓋那天全部的上班時數才算整天
    if (take >= workHours - 1e-6) fullDayDates.push(item.dateKey);
    left = roundHours(left - take);
  }
  if (left > 0) {
    if (days.length) days[days.length - 1] = { ...days[days.length - 1], hours: roundHours(days[days.length - 1].hours + left) };
    else if (covered.length) days.push({ date: covered[0].dateKey, hours: left });
  }
  return { days, fullDayDates };
}

/**
 * 一張調休單（核准時）的每日分布：哪幾天請了幾小時、哪幾天是整天調休（當天對這位員工具國定假日性質）。
 * 各日本來要上班的時數：當天已是該員工的假日 0；有班表看班表（工作班的實際工時，休、例、國、請假 0）；
 * 沒有班表時行政人員依公司行事曆（上班日 8 小時），輪班人員 8 小時。讀不到班表或行事曆時退回日曆日 8 小時，不擋核准。
 */
export async function buildCompLeaveDayPlan({ employee, startValue, endValue, startType, endType, hours } = {}) {
  const interval = parseLeaveInterval(startValue, endValue, { startType, endType });
  if (!interval || interval.reversed) return { days: [], fullDayDates: [] };
  const covered = splitLeaveByDay(interval, { hoursPerDay: 24 }).slice(0, MAX_SCHEDULE_LOOKUP_DAYS);
  if (!covered.length) return { days: [], fullDayDates: [] };
  const employeeId = toId(employee);
  const regime = resolveHolidayRegime(employee && typeof employee === 'object' ? employee : null);
  let capacityOf = () => LEAVE_DAY_EQUIVALENT_HOURS;
  try {
    const firstKey = covered[0].dateKey;
    const lastKey = covered[covered.length - 1].dateKey;
    const [schedule, context] = await Promise.all([
      loadScheduledShiftHours(employeeId, firstKey, lastKey),
      loadHolidayContext({ start: firstKey, end: addDaysKey(lastKey, 1), employees: [employee] }),
    ]);
    capacityOf = (dateKey) => {
      const entry = schedule.get(dateKey);
      const rosterKind = entry ? (entry.work ? 'work' : 'rest_day') : undefined;
      if (isNationalHolidayFor(context, employee, dateKey, { rosterKind }).holiday) return 0;
      if (entry) return entry.work ? entry.hours : 0;
      if (regime === 'office') return officeDayKind(context, dateKey) === 'work' ? LEAVE_DAY_EQUIVALENT_HOURS : 0;
      return LEAVE_DAY_EQUIVALENT_HOURS;
    };
  } catch (error) {
    console.error(`[CompLeave] Day plan fell back to calendar days: ${error?.name || 'Error'}`);
  }
  return allocateCompLeaveDays({ covered, hours, allDay: interval.allDay, capacityOf });
}

/* ---------------------------- 扣用與返還 ---------------------------- */

// 依扣用計畫逐筆原子扣減；任何一筆失敗（剩餘時數被別的請求用掉）就把這次已扣的退回，回傳 false 讓呼叫端重新讀取再試
async function applyPlan({ plan, usageOf, requestId }) {
  const applied = [];
  for (const { credit, take } of plan) {
    const usage = { _id: new Types.ObjectId(), ...usageOf(take) };
    const filter = {
      _id: credit._id,
      status: 'available',
      $expr: { $lte: [{ $add: [{ $ifNull: ['$usedHours', 0] }, take] }, '$hours'] },
    };
    if (requestId) filter['usages.approvalRequest'] = { $ne: requestId };
    const updated = await CompensatoryCredit.findOneAndUpdate(
      filter,
      { $inc: { usedHours: take }, $push: { usages: usage } },
      { new: true },
    );
    if (!updated) {
      for (const done of applied) await revertUsage(done.creditId, done.usageId, done.take);
      return null;
    }
    applied.push({ creditId: credit._id, usageId: usage._id, take });
    const plain = plainDoc(updated);
    if (roundHours(Number(plain?.usedHours) || 0) >= roundHours(Number(plain?.hours) || 0)) {
      await CompensatoryCredit.updateOne(
        { _id: credit._id, status: 'available', $expr: { $gte: ['$usedHours', '$hours'] } },
        { $set: { status: 'used' } },
      );
    }
  }
  return applied;
}

async function revertUsage(creditId, usageId, hours) {
  await CompensatoryCredit.updateOne(
    { _id: creditId, 'usages._id': usageId },
    { $inc: { usedHours: -hours }, $pull: { usages: { _id: usageId } }, $set: { status: 'available' } },
  );
}

/**
 * 依扣用順序扣 hours 小時（簽核核准、人資扣除共用）。剩餘不夠時丟出 409 COMP_LEAVE_INSUFFICIENT（含可用時數）。
 * usageOf(take) 回傳要記在額度上的使用紀錄（kind、days、fullDayDates、note、by…）。
 */
async function consumeHours({ employeeId, hours, usageOf, requestId = null, now = new Date(), policy = null }) {
  const amount = roundHours(Number(hours) || 0);
  if (!(amount > 0)) fail(400, 'INVALID_HOURS', '時數必須大於 0');
  const activePolicy = policy || await getLeavePolicy();
  const { expiryMonths } = creditPolicyOf(activePolicy);
  const todayKey = todayKeyOf(now);
  for (let attempt = 0; attempt < MAX_CONSUME_ATTEMPTS; attempt += 1) {
    const credits = await loadEmployeeCredits(employeeId, { includeVoid: false });
    const { plan, availableHours, shortHours } = planConsumption(credits, amount, { todayKey, expiryMonths });
    if (shortHours > 0) {
      fail(409, 'COMP_LEAVE_INSUFFICIENT', `調休餘額不足：可用 ${formatHoursText(availableHours)}，本次需扣 ${formatHoursText(amount)}`, {
        availableHours, requestedHours: amount,
      });
    }
    const applied = await applyPlan({ plan, usageOf, requestId });
    if (applied) {
      return {
        hours: amount,
        credits: applied.map((item) => ({ creditId: toId(item.creditId), hours: item.take })),
      };
    }
  }
  fail(409, 'CONFLICT', '調休存摺剛被其他人更新，請重新整理後再試');
  return null;
}

/** 這張簽核單在存摺上扣了哪些額度（沒有回傳 null） */
export async function findRequestConsumption(requestId) {
  if (!requestId) return null;
  const credits = (await leanResult(CompensatoryCredit.find({ 'usages.approvalRequest': requestId }))) || [];
  if (!credits.length) return null;
  const key = toId(requestId);
  let hours = 0;
  const parts = [];
  let fullDayDates = [];
  for (const credit of credits) {
    for (const usage of credit.usages || []) {
      if (toId(usage.approvalRequest) !== key) continue;
      hours = roundHours(hours + (Number(usage.hours) || 0));
      parts.push({ creditId: toId(credit._id), sourceText: describeCreditSource(credit), hours: roundHours(Number(usage.hours) || 0) });
      fullDayDates = [...new Set([...fullDayDates, ...(usage.fullDayDates || [])])].sort();
    }
  }
  return { hours, credits: parts, fullDayDates };
}

/**
 * 調休簽核核准時扣用存摺（依到期日、取得日先後，可以跨好幾筆額度、每筆扣部分時數）。
 * 同一張簽核單只扣一次：已經扣過就回傳 { state: 'already' }。剩餘不夠丟出 409 COMP_LEAVE_INSUFFICIENT。
 * days：這張單各日的時數；fullDayDates：整天調休的日子（當天對這位員工具國定假日性質）。
 */
export async function consumeCreditsForRequest({ employeeId, requestId, hours, days = [], fullDayDates = [], by = null, now = new Date(), policy = null } = {}) {
  if (!employeeId || !requestId) fail(400, 'INVALID_PARAMS', '缺少員工或簽核單');
  const existing = await findRequestConsumption(requestId);
  if (existing) return { state: 'already', ...existing };
  const result = await consumeHours({
    employeeId,
    hours,
    requestId,
    now,
    policy,
    usageOf: (take) => ({
      kind: 'leave_request',
      hours: take,
      approvalRequest: requestId,
      days: days.map((day) => ({ date: day.date, hours: roundHours(day.hours) })),
      fullDayDates: [...new Set(fullDayDates)].sort(),
      note: '',
      by,
      at: now,
    }),
  });
  return { state: 'consumed', ...result, fullDayDates: [...new Set(fullDayDates)].sort() };
}

/**
 * 返還某張簽核單扣過的調休（核准後撤回、管理員取消）。只退這張單確實扣過的部分，重複呼叫不會重複返還。
 * 回傳 { refunded, hours }。
 */
export async function refundCreditsForRequest({ requestId } = {}) {
  if (!requestId) return { refunded: false, hours: 0 };
  const key = toId(requestId);
  const credits = (await leanResult(CompensatoryCredit.find({ 'usages.approvalRequest': requestId }))) || [];
  let hours = 0;
  for (const credit of credits) {
    for (const usage of credit.usages || []) {
      if (toId(usage.approvalRequest) !== key) continue;
      const take = roundHours(Number(usage.hours) || 0);
      const result = await CompensatoryCredit.updateOne(
        { _id: credit._id, 'usages._id': usage._id },
        { $inc: { usedHours: -take }, $pull: { usages: { _id: usage._id } }, $set: { status: credit.status === 'void' ? 'void' : 'available' } },
      );
      if ((result?.modifiedCount ?? result?.nModified ?? 0) > 0) hours = roundHours(hours + take);
    }
  }
  // 已使用時數被人工調整後再返還，不可變成負數
  if (credits.length) {
    await CompensatoryCredit.updateMany(
      { _id: { $in: credits.map((credit) => credit._id) }, usedHours: { $lt: 0 } },
      { $set: { usedHours: 0 } },
    );
  }
  return { refunded: hours > 0, hours };
}

/* ---------------------------- 送出調休申請的短暫鎖 ---------------------------- */

const FILING_LEASE_MS = 15000;
const FILING_LEASE_WAIT_MS = 5000;
const FILING_LEASE_POLL_MS = 50;

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * 送出（或重新送出）調休申請前取得這位員工的鎖，檢查存摺到建立單據之間同一位員工只有一筆在處理：
 * 同時送出兩筆（連點、兩個分頁）時，第二筆等第一筆建立好才檢查，會把第一筆算進簽核中的時數，不會一起超過存摺。
 * 單機 MongoDB 沒有交易：以 CompensatoryLeaveState 的 key（唯一索引）搶鎖，鎖住時 upsert 會撞到重複鍵；
 * 程式中斷沒有釋放時 FILING_LEASE_MS 後自動失效。等了 waitMs 還拿不到丟出 409 COMP_LEAVE_FILING_BUSY。
 * 回傳 { release }（只刪除自己拿到的那把鎖，重複呼叫沒有影響）。
 */
export async function acquireCompLeaveFilingLease({ employeeId, waitMs = FILING_LEASE_WAIT_MS, pollMs = FILING_LEASE_POLL_MS } = {}) {
  const id = toId(employeeId);
  if (!id) return { release: async () => {} };
  const key = `filing:${id}`;
  const token = new Types.ObjectId().toString();
  const deadline = Date.now() + Math.max(Number(waitMs) || 0, 0);
  for (;;) {
    const now = new Date();
    let acquired = null;
    try {
      acquired = await CompensatoryLeaveState.findOneAndUpdate(
        { key, $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }] },
        { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + FILING_LEASE_MS) } },
        { upsert: true, new: true },
      );
    } catch (err) {
      // 別人正拿著鎖：這次的 upsert 撞到 key 的唯一索引
      if (err?.code !== 11000) throw err;
    }
    if (acquired) {
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          try {
            await CompensatoryLeaveState.deleteOne({ key, leaseToken: token });
          } catch (err) {
            // 釋放失敗不影響這次申請；鎖過期後自動失效
            console.error(`[CompLeave] Failed to release filing lease: ${err?.name || 'Error'}`);
          }
        },
      };
    }
    if (Date.now() >= deadline) fail(409, 'COMP_LEAVE_FILING_BUSY', '另一筆調休申請正在送出，請稍後再試');
    await sleep(pollMs);
  }
}

/* ---------------------------- 人資手動給予、扣除、作廢 ---------------------------- */

function parseHours(value, { minUnitHours }) {
  const hours = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_MANUAL_HOURS) {
    fail(400, 'INVALID_HOURS', `時數必須大於 0、不超過 ${MAX_MANUAL_HOURS} 小時`);
  }
  if (!isMultipleOfStep(hours, minUnitHours)) fail(400, 'INVALID_HOURS', `時數必須是 ${minUnitHours} 小時的倍數`);
  return roundHours(hours);
}

function requireNote(value) {
  const note = cleanNote(value);
  if (!note) fail(400, 'NOTE_REQUIRED', '請填寫備註（給予或調整的原因）');
  return note;
}

async function requireEmployee(employeeId) {
  const id = String(employeeId ?? '').trim();
  if (!isObjectId(id)) fail(400, 'INVALID_EMPLOYEE', '員工編號不正確');
  const employee = await leanResult(Employee.findById(id).select('_id name employeeId'));
  if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', '找不到這位員工');
  return employee;
}

/** 管理員手動給予一筆調休（備註必填），例如加班換休、更正 */
export async function createManualCredit({ employeeId, hours, note, earnedDate = null, actorId = null, now = new Date(), policy = null } = {}) {
  const activePolicy = policy || await getLeavePolicy();
  const { minUnitHours } = creditPolicyOf(activePolicy);
  const employee = await requireEmployee(employeeId);
  const amount = parseHours(hours, { minUnitHours });
  const text = requireNote(note);
  const todayKey = todayKeyOf(now);
  let earnedKey = todayKey;
  if (earnedDate !== null && earnedDate !== undefined && earnedDate !== '') {
    earnedKey = dateKeyOf(earnedDate);
    if (!earnedKey || keyToDate(earnedKey).toISOString().slice(0, 10) !== earnedKey) fail(400, 'INVALID_DATE', '取得日期格式不正確（YYYY-MM-DD）');
  }
  const created = await CompensatoryCredit.create({
    employee: employee._id,
    sourceType: 'manual',
    sourceKey: `manual:${new Types.ObjectId().toString()}`,
    reason: 'manual',
    earnedDate: keyToDate(earnedKey),
    hours: amount,
    usedHours: 0,
    usages: [],
    status: 'available',
    note: text,
    createdBy: actorId || null,
  });
  const [serialized] = await serializeCredits([plainDoc(created)], { now, policy: activePolicy });
  return serialized;
}

/** 管理員扣除調休（備註必填）：依扣用順序扣，沒有日期、不影響國定假日判斷 */
export async function adjustCredits({ employeeId, hours, note, actorId = null, now = new Date(), policy = null } = {}) {
  const activePolicy = policy || await getLeavePolicy();
  const { minUnitHours } = creditPolicyOf(activePolicy);
  const employee = await requireEmployee(employeeId);
  const amount = parseHours(hours, { minUnitHours });
  const text = requireNote(note);
  const result = await consumeHours({
    employeeId: employee._id,
    hours: amount,
    now,
    policy: activePolicy,
    usageOf: (take) => ({ kind: 'adjustment', hours: take, approvalRequest: null, days: [], fullDayDates: [], note: text, by: actorId || null, at: now }),
  });
  return { employeeId: toId(employee._id), ...result };
}

/** 管理員作廢一筆還沒用過的調休（備註必填）；用過的不能作廢，請改用扣除或撤回簽核單 */
export async function voidCredit({ id, note, actorId = null, now = new Date() } = {}) {
  if (!isObjectId(String(id ?? ''))) fail(400, 'INVALID_ID', '調休紀錄編號不正確');
  const text = requireNote(note);
  const credit = await leanResult(CompensatoryCredit.findById(id));
  if (!credit) fail(404, 'NOT_FOUND', '找不到這筆調休');
  if (credit.status === 'void') fail(409, 'ALREADY_VOID', '這筆調休已經失效');
  if ((Number(credit.usedHours) || 0) > 0) fail(409, 'CREDIT_USED', '這筆調休已經使用，不能作廢；請改用扣除調整或撤回簽核單');
  const updated = await CompensatoryCredit.findOneAndUpdate(
    { _id: credit._id, status: 'available', usedHours: { $lte: 0 } },
    { $set: { status: 'void', voidReason: 'manual', voidedAt: now, note: (credit.note ? `${credit.note}；作廢：${text}` : `作廢：${text}`).slice(0, MAX_NOTE_LENGTH) } },
    { new: true },
  );
  if (!updated) fail(409, 'CREDIT_USED', '這筆調休剛被使用，不能作廢');
  if (actorId) console.info('Compensatory credit voided', { actorId: toId(actorId), creditId: toId(credit._id) });
  const [serialized] = await serializeCredits([plainDoc(updated)], { now });
  return serialized;
}

/* ---------------------------- 部署時的資料轉換（冪等，只記錄筆數） ---------------------------- */

/**
 * 確保系統狀態存在：第一次啟動新版時記下「行政人員公務機關補假日自動放假」停止的第一天（台灣時間的隔天）。
 * 之前的公務機關補假日照舊是行政人員的假日，已放的假、已算的薪資不會被改掉。回傳狀態文件。
 */
export async function ensureCompensatoryLeaveState({ now = new Date() } = {}) {
  const cutover = addDaysKey(todayKeyOf(now), 1);
  try {
    await CompensatoryLeaveState.updateOne(
      { key: COMPENSATORY_LEAVE_STATE_KEY },
      { $setOnInsert: { key: COMPENSATORY_LEAVE_STATE_KEY, officeGovMakeupCutover: cutover } },
      { upsert: true },
    );
  } catch (err) {
    // 兩個 PM2 執行個體同時第一次啟動：另一個已經建立了
    if (err?.code !== 11000) throw err;
  }
  // 舊資料沒有切換日（欄位空白）：補上，之後不再改
  await CompensatoryLeaveState.updateOne(
    { key: COMPENSATORY_LEAVE_STATE_KEY, officeGovMakeupCutover: { $in: ['', null] } },
    { $set: { officeGovMakeupCutover: cutover } },
  );
  return leanResult(CompensatoryLeaveState.findOne({ key: COMPENSATORY_LEAVE_STATE_KEY }));
}

function reasonOfLegacyCompensation(doc) {
  if (doc.origin === 'manual') return 'manual_holiday';
  if (doc.origin === 'office_weekend') {
    const weekday = new Date(doc.holidayDate).getUTCDay();
    if (weekday === 6) return 'office_saturday';
    if (weekday === 0) return 'office_sunday';
    return 'office_rest_day';
  }
  return doc.dayKindAtDetection === 'regular_rest' ? 'regular_rest' : 'rest_day';
}

/** 一筆舊的補假義務轉成調休額度的內容（純函式）：待排 -> 未使用；已排定 -> 已使用（HR 指定，補假日當天是假日）；失效 -> 作廢 */
export function creditFromLegacyCompensation(doc, { hoursPerCredit = DEFAULT_HOURS_PER_CREDIT } = {}) {
  const holidayKey = dateKeyOf(doc.holidayDate);
  if (!holidayKey || !doc.employee) return null;
  const base = {
    employee: doc.employee,
    sourceType: 'holiday_rest',
    sourceKey: `holiday_rest:${holidayKey}`,
    reason: reasonOfLegacyCompensation(doc),
    holidayDate: keyToDate(holidayKey),
    holidayName: String(doc.holidayName || '').slice(0, 100),
    calendarDay: doc.calendarDay || null,
    earnedDate: keyToDate(holidayKey),
    hours: hoursPerCredit,
    usedHours: 0,
    usages: [],
    status: 'available',
    suggestedDate: doc.suggestedDate || null,
    conflict: false,
    note: String(doc.note || '').slice(0, MAX_NOTE_LENGTH),
    createdBy: doc.createdBy || null,
    migratedFrom: doc._id || null,
  };
  const assignedKey = dateKeyOf(doc.assignedDate);
  if (doc.status === 'assigned' && assignedKey) {
    return {
      ...base,
      status: 'used',
      usedHours: hoursPerCredit,
      usages: [{
        kind: 'hr_assigned',
        hours: hoursPerCredit,
        approvalRequest: null,
        days: [{ date: assignedKey, hours: hoursPerCredit }],
        fullDayDates: [assignedKey],
        note: String(doc.agreementNote || '').slice(0, MAX_NOTE_LENGTH) || 'HR 指定',
        by: doc.assignedBy || null,
        at: doc.assignedAt || doc.updatedAt || new Date(),
      }],
      conflict: doc.conflict === true,
      conflictReason: doc.conflict === true ? 'trigger_gone' : undefined,
    };
  }
  if (doc.status === 'void') {
    return { ...base, status: 'void', voidReason: doc.voidReason || 'not_applicable', voidedAt: doc.voidedAt || null };
  }
  return base;
}

function isDuplicateKeyOnly(err) {
  if (err?.code === 11000) return true;
  const writeErrors = err?.writeErrors || err?.result?.result?.writeErrors || [];
  return Array.isArray(writeErrors) && writeErrors.length > 0 && writeErrors.every((item) => (item?.code ?? item?.err?.code) === 11000);
}

async function upsertCredits(rows) {
  if (!rows.length) return 0;
  const ops = rows.map((row) => {
    const { employee, sourceKey, ...rest } = row;
    const setOnInsert = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
    return { updateOne: { filter: { employee, sourceKey }, update: { $setOnInsert: setOnInsert }, upsert: true } };
  });
  try {
    const written = await CompensatoryCredit.bulkWrite(ops, { ordered: false });
    return Number(written?.upsertedCount) || 0;
  } catch (err) {
    if (!isDuplicateKeyOnly(err)) throw err;
    return Number(err?.result?.upsertedCount ?? err?.result?.nUpserted) || 0;
  }
}

/**
 * 舊的補假義務（HolidayCompensation）轉入調休存摺，只做一次（狀態文件 compensationsMigratedAt）。
 * 以「員工 + 國定假日」為唯一鍵 upsert：中途失敗重跑不會重複；舊集合不修改、不刪除（回復舊版程式仍可使用）。
 * 回傳 { skipped, created, open, assigned, void, checked }（只有筆數）。
 */
export async function migrateHolidayCompensationsToCredits({ now = new Date(), policy = null } = {}) {
  const state = await ensureCompensatoryLeaveState({ now });
  const result = { skipped: false, created: 0, open: 0, assigned: 0, void: 0, checked: 0 };
  if (state?.compensationsMigratedAt) return { ...result, skipped: true };
  const activePolicy = policy || await getLeavePolicy();
  const { hoursPerCredit } = creditPolicyOf(activePolicy);
  const docs = (await leanResult(HolidayCompensation.find({}))) || [];
  const rows = [];
  for (const doc of docs) {
    const row = creditFromLegacyCompensation(doc, { hoursPerCredit });
    if (!row) continue;
    result.checked += 1;
    if (row.status === 'used') result.assigned += 1;
    else if (row.status === 'void') result.void += 1;
    else result.open += 1;
    rows.push(row);
  }
  result.created = await upsertCredits(rows);
  await CompensatoryLeaveState.updateOne({ key: COMPENSATORY_LEAVE_STATE_KEY }, { $set: { compensationsMigratedAt: now } });
  return result;
}

/**
 * 員工資料的「補休時數」（annualLeave.compensatoryHours，以前由人資手動維護）大於 0 的，轉成一筆「轉入既有補休時數」的調休，
 * 只做一次（狀態文件 legacyHoursMigratedAt）；每位員工以 legacy_balance 為唯一鍵，重跑不會重複。員工資料的欄位不修改。
 * 回傳 { skipped, created, employees }（只有筆數）。
 */
export async function migrateLegacyCompensatoryHours({ now = new Date() } = {}) {
  const state = await ensureCompensatoryLeaveState({ now });
  const result = { skipped: false, created: 0, employees: 0 };
  if (state?.legacyHoursMigratedAt) return { ...result, skipped: true };
  let find = Employee.find({ 'annualLeave.compensatoryHours': { $gt: 0 } });
  if (typeof find?.select === 'function') find = find.select('_id annualLeave.compensatoryHours');
  const people = (await leanResult(find)) || [];
  const earned = keyToDate(todayKeyOf(now));
  const rows = [];
  for (const person of people) {
    const hours = roundHours(Number(person?.annualLeave?.compensatoryHours) || 0);
    if (!(hours > 0)) continue;
    rows.push({
      employee: person._id,
      sourceType: 'legacy_balance',
      sourceKey: 'legacy_balance',
      reason: 'legacy',
      holidayDate: null,
      holidayName: '',
      earnedDate: earned,
      hours,
      usedHours: 0,
      usages: [],
      status: 'available',
      note: LEGACY_HOURS_NOTE,
      createdBy: null,
    });
  }
  result.employees = rows.length;
  result.created = await upsertCredits(rows);
  await CompensatoryLeaveState.updateOne({ key: COMPENSATORY_LEAVE_STATE_KEY }, { $set: { legacyHoursMigratedAt: now } });
  return result;
}

export const __testUtils = { addMonthsKey, addDaysKey, isDuplicateKeyOnly, reasonOfLegacyCompensation };
