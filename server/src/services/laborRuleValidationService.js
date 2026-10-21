import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import ApprovalRequest from '../models/approval_request.js';
import FormField from '../models/form_field.js';
import { buildEmployeeHolidayDaySet, loadHolidayContext } from './holidayResolver.js';
import {
  isEmployedOn,
  loadScheduleRuleEmploymentWindows,
  loadScheduleRuleExemptEmployeeIds,
} from './scheduleRuleExemptionService.js';
import { computeShiftSpan } from '../utils/timeWindow.js';
import { getAllLeaveFieldInfos } from './leaveFieldService.js';
import { isNonWorkShift, resolveShiftSemanticType } from './shiftSemanticService.js';
import { TAIPEI_OFFSET_MS, dateKeyToUtcMidnight, toTaipeiDateKey } from '../utils/taipeiTime.js';
import { pickLeaveFields } from '../utils/leaveFieldLabels.js';
import { isLeaveFormTemplate, isOvertimeFormTemplate } from '../utils/formSemantics.js';
import { describeLeaveInterval, leaveIntervalsOverlap, parseLeaveInterval } from '../utils/leaveDuration.js';
import { candidateSelectKeys, orderFieldCandidateIds, pickFieldValue, resolveCandidateIds } from '../utils/fieldCandidates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 簽核附件上傳的資料夾（與 approvalAttachmentUpload / approvalRequestController 相同）；單元測試會換成暫存資料夾
let approvalUploadDir = path.join(__dirname, '../../../upload/approvals');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MIN_REST_BETWEEN_SHIFTS_MINUTES = 11 * 60;
const MAX_REGULAR_WORK_MINUTES_PER_DAY = 8 * 60;
const MAX_TOTAL_WORK_MINUTES_PER_DAY = 12 * 60;
const MAX_CONTINUOUS_NON_REST_DAYS = 6;
const MAX_DAILY_OVERTIME_MINUTES = 4 * 60;

class LaborRuleValidationError extends Error {
  // pendingWeeks：目前還無法判斷的跨月週（鄰月尚未排班），不算違規，隨錯誤一起回報讓畫面提醒
  constructor(message, violations = [], pendingWeeks = []) {
    super(message);
    this.name = 'LaborRuleValidationError';
    this.status = 400;
    this.violations = violations;
    this.pendingWeeks = pendingWeeks;
  }
}

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (value._id !== undefined && value._id !== value) return normalizeId(value._id);
    if (value.id !== undefined) return normalizeId(value.id);
  }
  return String(value);
}

function startOfUtcDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// 表單上填的日期時間（前端日期選擇器送出的是 UTC ISO 字串）一律用台灣時間判斷是哪一天，
// 並以 UTC 午夜代表那一天（與班表日期同一種表示）；上面的 startOfUtcDay 只用在班表自己的日期。
function formDay(value) {
  const key = toTaipeiDateKey(value);
  return key ? dateKeyToUtcMidnight(key) : null;
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function dateKey(value) {
  const date = startOfUtcDay(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function monthKey(value) {
  const date = startOfUtcDay(value);
  if (!date) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 把日期鍵合併成「a～b、c」：連續的日子合成一段，用在跨月週的提示文字
function dateRangeText(keys) {
  const runs = [];
  for (const key of Array.from(new Set(keys)).sort()) {
    const last = runs[runs.length - 1];
    if (last && dateKey(addUtcDays(new Date(`${last.end}T00:00:00.000Z`), 1)) === key) last.end = key;
    else runs.push({ start: key, end: key });
  }
  return runs.map((run) => (run.start === run.end ? run.start : `${run.start}～${run.end}`)).join('、');
}

// 日期鍵所屬的月份，寫成「2026年7月」
function monthText(keys) {
  const months = Array.from(new Set(keys.map((key) => key.slice(0, 7)))).sort();
  return months.map((month) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`).join('、');
}

function weekStartMonday(date) {
  const start = startOfUtcDay(date);
  const day = start.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addUtcDays(start, offset);
}

async function resolveLean(query) {
  if (!query) return [];
  if (typeof query.sort === 'function') {
    const sorted = query.sort({ date: 1 });
    if (sorted && typeof sorted.lean === 'function') return sorted.lean();
  }
  if (typeof query.lean === 'function') return query.lean();
  return query;
}

async function loadShiftMap() {
  const query = AttendanceSetting.findOne();
  const setting = query && typeof query.lean === 'function' ? await query.lean() : await query;
  const map = new Map();
  for (const shift of setting?.shifts || []) {
    const id = normalizeId(shift._id);
    if (id) map.set(id, shift);
  }
  return map;
}

async function loadLaborRulePolicy() {
  const query = AttendanceSetting.findOne();
  const setting = query && typeof query.lean === 'function' ? await query.lean() : await query;
  const rules = setting?.laborRules || {};
  const restExceptionEnabled = Boolean(
    rules.restIntervalExceptionEnabled && String(rules.restIntervalApprovalReference || '').trim(),
  );
  const extendedOvertimeEnabled = Boolean(
    rules.extendedOvertimeEnabled && String(rules.overtimeApprovalReference || '').trim(),
  );
  return {
    workTimeRegime: rules.workTimeRegime || 'standard',
    minShiftRestMinutes: restExceptionEnabled
      ? Math.max(Number(rules.restIntervalExceptionMinutes) || 480, 480)
      : Math.max(Number(rules.minShiftRestMinutes) || MIN_REST_BETWEEN_SHIFTS_MINUTES, MIN_REST_BETWEEN_SHIFTS_MINUTES),
    monthlyOvertimeMinutes: (extendedOvertimeEnabled
      ? Math.min(Number(rules.monthlyOvertimeHours) || 54, 54)
      : Math.min(Number(rules.monthlyOvertimeHours) || 46, 46)) * 60,
    threeMonthOvertimeMinutes: Math.min(Number(rules.threeMonthOvertimeHours) || 138, 138) * 60,
    extendedOvertimeEnabled,
    strictCompanyWeeklyRest: rules.strictCompanyWeeklyRest !== false,
  };
}

export function classifyShift(shift) {
  const target = shift || {};
  const semanticType = resolveShiftSemanticType(target);
  const isRegularRest = semanticType === 'regular_rest';
  const isRestDay = semanticType === 'rest_day';
  return {
    semanticType,
    // 週休計算只認這兩種：例假算「例」、休息日算「休」；國定假日與請假兩者都不算
    isRegularRest,
    isRestDay,
    isHoliday: semanticType === 'holiday',
    isLeave: semanticType === 'leave',
    // 休息日/例假/國定假日/請假/沒有工作時間的班別都不用上班，不產生工時
    isNonWork: isNonWorkShift(target),
  };
}

function getShiftBreakMinutes(shift) {
  if (!shift) return 0;
  if (Array.isArray(shift.breakWindows) && shift.breakWindows.length) {
    let total = 0;
    for (const window of shift.breakWindows) {
      const start = parseTimeToMinutes(window?.start);
      const end = parseTimeToMinutes(window?.end);
      if (start === null || end === null) continue;
      total += end > start ? end - start : end + 24 * 60 - start;
    }
    if (total > 0) return total;
  }
  for (const value of [shift.breakDuration, shift.breakMinutes]) {
    const minutes = Number(value);
    if (Number.isFinite(minutes) && minutes >= 0) return minutes;
  }
  const breakTime = parseTimeToMinutes(shift.breakTime);
  return breakTime ?? 0;
}

function parseTimeToMinutes(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function getWorkSpan(schedule, shift) {
  const classification = classifyShift(shift);
  if (classification.isNonWork) return null;
  const span = computeShiftSpan(schedule.date, shift);
  if (!span) return null;
  const grossMinutes = Math.round((span.end.getTime() - span.start.getTime()) / MS_PER_MINUTE);
  const workMinutes = Math.max(grossMinutes - getShiftBreakMinutes(shift), 0);
  return { ...span, workMinutes };
}

function makeViolation(rule, message, extra = {}) {
  return { rule, message, ...extra };
}

function uniqueByEmployeeDate(schedules) {
  const map = new Map();
  for (const raw of schedules || []) {
    const employee = normalizeId(raw.employee);
    const date = startOfUtcDay(raw.date);
    const shiftId = normalizeId(raw.shiftId);
    if (!employee || !date || !shiftId) continue;
    map.set(`${employee}::${dateKey(date)}`, {
      ...raw,
      employee,
      date,
      shiftId,
    });
  }
  return Array.from(map.values());
}

function groupSchedules(schedules) {
  const grouped = new Map();
  for (const schedule of schedules) {
    const employee = normalizeId(schedule.employee);
    if (!employee) continue;
    if (!grouped.has(employee)) grouped.set(employee, []);
    grouped.get(employee).push(schedule);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => startOfUtcDay(a.date).getTime() - startOfUtcDay(b.date).getTime());
  }
  return grouped;
}

function mergeSchedules(existingSchedules, candidateSchedules, ignoredScheduleIds = []) {
  const ignored = new Set(ignoredScheduleIds.map(normalizeId).filter(Boolean));
  const map = new Map();
  for (const schedule of existingSchedules || []) {
    const id = normalizeId(schedule._id);
    if (ignored.has(id)) continue;
    const employee = normalizeId(schedule.employee);
    const key = `${employee}::${dateKey(schedule.date)}`;
    if (employee && key) map.set(key, schedule);
  }
  for (const schedule of candidateSchedules) {
    map.set(`${schedule.employee}::${dateKey(schedule.date)}`, schedule);
  }
  return Array.from(map.values());
}

function buildValidationRange(candidateSchedules, range) {
  if (range?.start && range?.end) {
    return {
      start: addUtcDays(startOfUtcDay(range.start), -7),
      end: addUtcDays(startOfUtcDay(range.end), 7),
      strictStart: startOfUtcDay(range.start),
      strictEnd: startOfUtcDay(range.end),
    };
  }
  const dates = candidateSchedules.map((item) => startOfUtcDay(item.date)).filter(Boolean);
  const min = new Date(Math.min(...dates.map((date) => date.getTime())));
  const max = new Date(Math.max(...dates.map((date) => date.getTime())));
  return {
    start: addUtcDays(min, -7),
    end: addUtcDays(max, 8),
    strictStart: min,
    strictEnd: addUtcDays(max, 1),
  };
}

function validateDailyHours(grouped, shiftMap) {
  const violations = [];
  for (const [employee, schedules] of grouped) {
    for (const schedule of schedules) {
      const shift = shiftMap.get(normalizeId(schedule.shiftId));
      const span = getWorkSpan(schedule, shift);
      if (!span) continue;
      if (span.workMinutes > MAX_TOTAL_WORK_MINUTES_PER_DAY) {
        violations.push(makeViolation(
          'daily-work-hours',
          `每日工時不得超過12小時：${dateKey(schedule.date)} 已排 ${(span.workMinutes / 60).toFixed(1)} 小時`,
          { employee, date: dateKey(schedule.date), minutes: span.workMinutes },
        ));
      }
      if (span.workMinutes > MAX_REGULAR_WORK_MINUTES_PER_DAY) {
        violations.push(makeViolation(
          'regular-work-hours',
          `正常班每日工時不得超過8小時：${dateKey(schedule.date)} 已排 ${(span.workMinutes / 60).toFixed(1)} 小時`,
          { employee, date: dateKey(schedule.date), minutes: span.workMinutes },
        ));
      }
    }
  }
  return violations;
}

function validateShiftGap(grouped, shiftMap, minRestMinutes = MIN_REST_BETWEEN_SHIFTS_MINUTES) {
  const violations = [];
  for (const [employee, schedules] of grouped) {
    const workSpans = schedules
      .map((schedule) => {
        const shift = shiftMap.get(normalizeId(schedule.shiftId));
        const span = getWorkSpan(schedule, shift);
        return span ? { schedule, shift, ...span } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let index = 1; index < workSpans.length; index += 1) {
      const previous = workSpans[index - 1];
      const current = workSpans[index];
      const gapMinutes = Math.round((current.start.getTime() - previous.end.getTime()) / MS_PER_MINUTE);
      if (gapMinutes < minRestMinutes) {
        violations.push(makeViolation(
          'shift-gap',
          `班與班之間需間隔 ${(minRestMinutes / 60).toFixed(1)} 小時：${dateKey(previous.schedule.date)} 到 ${dateKey(current.schedule.date)} 僅間隔 ${(gapMinutes / 60).toFixed(1)} 小時`,
          { employee, previousDate: dateKey(previous.schedule.date), date: dateKey(current.schedule.date), gapMinutes, requiredMinutes: minRestMinutes },
        ));
      }
    }
  }
  return violations;
}

// 沒排班的日子只有「請假」或「對這位員工是國定假日」（holidayDaysByEmployee，依 holidayResolver 判斷）才算進連續上班天數：
// 公務機關補假只對行政人員是假日，輪班人員那天沒排班就是空班日，不會拉長連續天數
function validateContinuousNonRestDays(
  grouped,
  shiftMap,
  { start, end },
  leaveDaysMap = new Map(),
  holidayDaysByEmployee = new Map(),
) {
  const violations = [];
  for (const [employee, schedules] of grouped) {
    const byDate = new Map(schedules.map((schedule) => [dateKey(schedule.date), schedule]));
    const leaveDays = leaveDaysMap.get(employee) || new Set();
    const holidayDays = holidayDaysByEmployee.get(employee) || new Set();
    let streak = [];
    for (let pointer = new Date(start); pointer < end; pointer = addUtcDays(pointer, 1)) {
      const key = dateKey(pointer);
      const schedule = byDate.get(key);
      if (!schedule) {
        if (!leaveDays.has(key) && !holidayDays.has(key)) {
          streak = [];
          continue;
        }
      } else {
        const shift = shiftMap.get(normalizeId(schedule.shiftId));
        const classification = classifyShift(shift);
        if (classification.isRestDay || classification.isRegularRest) {
          streak = [];
          continue;
        }
      }
      streak.push(key);
      if (streak.length > MAX_CONTINUOUS_NON_REST_DAYS) {
        violations.push(makeViolation(
          'continuous-work-days',
          `不得連續7日未安排休/例：${streak.slice(-7).join('、')}`,
          { employee, dates: streak.slice(-7) },
        ));
        streak = streak.slice(-6);
      }
    }
  }
  return violations;
}

async function loadApprovedLeaveDaysMap(employeeIds, start, end) {
  const leaveDaysMap = new Map(employeeIds.map((employeeId) => [normalizeId(employeeId), new Set()]));
  if (!employeeIds.length) return leaveDaysMap;
  // 預設的「請假」與客戶自建的請假表單並存時，每張請假表單各查一次，請假日合併計入
  const leaveForms = await getAllLeaveFieldInfos({ withTypeOptions: false });

  for (const leaveForm of leaveForms) {
    const { formId, startId, endId } = leaveForm;
    if (!formId || !startId || !endId) continue;
    // 開始、結束欄位被停用或換成同標籤的新欄位後，舊假單的答案還在舊欄位 ID 底下：
    // 候選欄位全部取回，逐張假單用第一個有填值的（與假勤日曆 approvedLeaveCalendarService 相同）
    const startIds = resolveCandidateIds(leaveForm.startIds, startId);
    const endIds = resolveCandidateIds(leaveForm.endIds, endId);
    let query = ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: employeeIds },
    });
    if (query && typeof query.select === 'function') {
      query = query.select(['applicant_employee']
        .concat(candidateSelectKeys(startIds, endIds).map((id) => `form_data.${id}`))
        .join(' '));
    }
    const approvals = query && typeof query.lean === 'function' ? await query.lean() : await query;

    for (const approval of approvals || []) {
      const employeeId = normalizeId(approval.applicant_employee);
      const bucket = leaveDaysMap.get(employeeId);
      if (!bucket) continue;
      const leaveStart = formDay(pickFieldValue(approval.form_data, startIds));
      const leaveEnd = formDay(pickFieldValue(approval.form_data, endIds));
      if (!leaveStart || !leaveEnd || leaveEnd < leaveStart) continue;

      const clampedStart = leaveStart > start ? leaveStart : start;
      const clampedEnd = leaveEnd < addUtcDays(end, -1) ? leaveEnd : addUtcDays(end, -1);
      for (let pointer = new Date(clampedStart); pointer <= clampedEnd; pointer = addUtcDays(pointer, 1)) {
        bucket.add(dateKey(pointer));
      }
    }
  }

  return leaveDaysMap;
}

// 回傳 { violations, pendingWeeks }。
// 一週（週一至週日）跨出檢核範圍（跨月）時，範圍外那幾天以資料庫裡鄰月已存的班表補齊（兩個方向都一樣）：
//   - 例/休都齊了：通過，不回報
//   - 缺的例/休比範圍外還沒排的天數多（再怎麼補也補不齊）：違規
//   - 其餘（缺的例/休還補得上）：還無法判斷，回報 pendingWeeks 讓畫面提醒，鄰月排定後下次檢核自然會判斷
// 範圍外還沒排的日子只算這個人在職的日子（employmentWindows：員工 id -> 到職日、離職日，見 scheduleRuleExemptionService）：
// 到職日之前、離職日之後那幾天永遠不會有班表，不算補得上；範圍外沒排的日子全都是這種日子時，
// 這一週在職的日子都看得到了，沒有人能補，所以不回報待判斷，也不拿缺的天數當違規。
// 範圍內的整週沒有範圍外的日子，維持原本行為（缺例或缺休就是違規）。
function validateWeeklyRest(grouped, shiftMap, { strictStart, strictEnd }, employmentWindows = new Map()) {
  const violations = [];
  const pendingWeeks = [];
  for (const [employee, schedules] of grouped) {
    const byDate = new Map(schedules.map((schedule) => [dateKey(schedule.date), schedule]));
    const employmentWindow = employmentWindows.get(employee);
    // 離職員工沒有離職日也沒有解聘日時，以他最後一筆班表當作最後在職的一天（與國定假日休假紀錄相同）
    const lastScheduledKey = employmentWindow?.resigned && !employmentWindow.resignKey
      ? (Array.from(byDate.keys()).sort().pop() || '')
      : '';
    const firstWeekStart = weekStartMonday(strictStart);
    for (let weekStart = firstWeekStart; weekStart < strictEnd; weekStart = addUtcDays(weekStart, 7)) {
      const weekEnd = addUtcDays(weekStart, 7);
      const outsideDates = [];
      const missingDates = [];
      const notEmployedDates = [];
      for (let pointer = new Date(weekStart); pointer < weekEnd; pointer = addUtcDays(pointer, 1)) {
        if (pointer >= strictStart && pointer < strictEnd) continue;
        const key = dateKey(pointer);
        outsideDates.push(key);
        if (byDate.has(key)) continue;
        if (isEmployedOn(employmentWindow, key, lastScheduledKey)) missingDates.push(key);
        else notEmployedDates.push(key);
      }
      let hasScheduledInStrictRange = false;
      let regularRestCount = 0;
      let restDayCount = 0;
      for (let pointer = new Date(weekStart); pointer < weekEnd; pointer = addUtcDays(pointer, 1)) {
        const key = dateKey(pointer);
        const schedule = byDate.get(key);
        if (!schedule) continue;
        if (pointer >= strictStart && pointer < strictEnd) {
          hasScheduledInStrictRange = true;
        }
        const classification = classifyShift(shiftMap.get(normalizeId(schedule.shiftId)));
        if (classification.isRegularRest) regularRestCount += 1;
        else if (classification.isRestDay) restDayCount += 1;
      }
      const restShortfall = (regularRestCount < 1 ? 1 : 0) + (restDayCount < 1 ? 1 : 0);
      if (!hasScheduledInStrictRange || restShortfall === 0) continue;
      // 範圍外沒排的日子都在到職前或離職後：永遠不會有班表（不是「還沒排」），這週也沒有可補的日子，整週略過
      if (!missingDates.length && notEmployedDates.length) continue;
      const weekStartKey = dateKey(weekStart);
      if (restShortfall > missingDates.length) {
        const lacking = `${regularRestCount < 1 ? '例假' : ''}${regularRestCount < 1 && restDayCount < 1 ? '與' : ''}${restDayCount < 1 ? '休息日' : ''}`;
        const crossMonth = outsideDates.length > 0;
        violations.push(makeViolation(
          'weekly-one-regular-rest-one-rest-day',
          `每週一至週日需至少1例1休：${weekStartKey} 週缺少${lacking}${crossMonth ? crossMonthViolationNote(outsideDates, missingDates, lacking, notEmployedDates) : ''}`,
          {
            employee,
            weekStart: weekStartKey,
            regularRestCount,
            restDayCount,
            ...(crossMonth ? { crossMonth: true, outsideDates, missingDates } : {}),
            ...(notEmployedDates.length ? { notEmployedDates } : {}),
          },
        ));
        continue;
      }
      const lackingList = [regularRestCount < 1 ? '例假' : '', restDayCount < 1 ? '休息日' : ''].filter(Boolean).join('、');
      const weekEndKey = dateKey(addUtcDays(weekStart, 6));
      pendingWeeks.push(makeViolation(
        'weekly-rest-pending',
        `跨月週（${weekStartKey}～${weekEndKey}）：${dateRangeText(missingDates)} 尚未排班，暫時無法判斷每週一例一休（目前缺${lackingList}）；${monthText(missingDates)} 班表排定後會重新檢核`,
        {
          employee,
          weekStart: weekStartKey,
          weekEnd: weekEndKey,
          regularRestCount,
          restDayCount,
          missingDates,
          missingMonths: Array.from(new Set(missingDates.map((key) => key.slice(0, 7)))).sort(),
        },
      ));
    }
  }
  pendingWeeks.sort((a, b) => (
    a.weekStart.localeCompare(b.weekStart) || String(a.employee).localeCompare(String(b.employee))
  ));
  return { violations, pendingWeeks };
}

// 跨月週違規的補充說明：哪幾天屬於相鄰月份、哪幾天已排班或還沒排，讓人知道週別不只在本月
// notEmployedDates：範圍外、這個人還沒到職或已離職的日子，不算相鄰月份「已排班」或「還沒排」，另外說明不計入
function crossMonthViolationNote(outsideDates, missingDates, lacking, notEmployedDates = []) {
  const notEmployed = new Set(notEmployedDates);
  const employedOutside = outsideDates.filter((key) => !notEmployed.has(key));
  const outsideText = dateRangeText(employedOutside);
  const notEmployedNote = notEmployedDates.length
    ? `；${dateRangeText(notEmployedDates)} 在到職前或離職後，不計入`
    : '';
  if (!missingDates.length) return `（此週跨月：${outsideText} 屬相鄰月份，已全部排班${notEmployedNote}）`;
  const missing = new Set(missingDates);
  const scheduledOutside = employedOutside.filter((key) => !missing.has(key));
  const shortfall = `尚未排班，最多只能再補 ${missingDates.length} 天，仍補不齊缺少的${lacking}`;
  if (!scheduledOutside.length) return `（此週跨月：${outsideText} 屬相鄰月份且${shortfall}${notEmployedNote}）`;
  return `（此週跨月：${outsideText} 屬相鄰月份，${dateRangeText(scheduledOutside)} 已排班；${dateRangeText(missingDates)} ${shortfall}${notEmployedNote}）`;
}

export async function assertScheduleRuleCompliance({
  candidateSchedules,
  ignoredScheduleIds = [],
  range = null,
  strictWeeklyRest = false,
} = {}) {
  const normalizedCandidates = uniqueByEmployeeDate(candidateSchedules);
  if (!normalizedCandidates.length && !range) return { ok: true, violations: [] };

  const [shiftMap, policy] = await Promise.all([loadShiftMap(), loadLaborRulePolicy()]);
  const allEmployeeIds = Array.from(new Set(normalizedCandidates.map((item) => item.employee).filter(Boolean)));
  if (!allEmployeeIds.length) return { ok: true, violations: [] };

  // 兼職人員不套用排班規範：整個人從檢核裡拿掉（班表不載入、不進任何一項規則），
  // 單一出口，所以草稿預檢、匯入預覽與匯入、發布、完成發布都一致。
  const exemptIds = await loadScheduleRuleExemptEmployeeIds(allEmployeeIds);
  const employeeIds = allEmployeeIds.filter((id) => !exemptIds.has(id));
  if (!employeeIds.length) return { ok: true, violations: [] };
  const ruleCandidates = exemptIds.size
    ? normalizedCandidates.filter((item) => !exemptIds.has(item.employee))
    : normalizedCandidates;

  const validationRange = buildValidationRange(ruleCandidates, range);
  const existing = await resolveLean(ShiftSchedule.find({
    employee: { $in: employeeIds },
    date: { $gte: validationRange.start, $lt: validationRange.end },
  }));
  const allSchedules = mergeSchedules(existing, ruleCandidates, ignoredScheduleIds);
  const grouped = groupSchedules(allSchedules);
  // 班表的班別性質（沒排班為 none）：指定應放假日要知道當天原本是不是要上班
  const scheduleByEmployeeDate = new Map();
  for (const [employee, schedules] of grouped) {
    for (const schedule of schedules) scheduleByEmployeeDate.set(`${employee}::${dateKey(schedule.date)}`, schedule);
  }
  const rosterKindOf = (employee, key) => {
    const schedule = scheduleByEmployeeDate.get(`${employee}::${key}`);
    return schedule ? classifyShift(shiftMap.get(normalizeId(schedule.shiftId))).semanticType : 'none';
  };
  const [leaveDaysMap, holidayContext, employmentWindows] = await Promise.all([
    loadApprovedLeaveDaysMap(
      employeeIds,
      validationRange.start,
      validationRange.end,
    ),
    loadHolidayContext({
      start: validationRange.start,
      end: validationRange.end,
      employees: employeeIds,
      rosterKindOf,
    }),
    // 到職日、離職日只有判斷跨月週用得到（每週一例一休）
    strictWeeklyRest ? loadScheduleRuleEmploymentWindows(employeeIds) : new Map(),
  ]);
  // 每位員工各自的國定假日（含個人調移、已排定的補假；公務機關補假只算行政人員）
  const holidayDaysByEmployee = new Map(employeeIds.map((employee) => [
    employee,
    buildEmployeeHolidayDaySet(holidayContext, employee, {
      start: validationRange.start,
      end: validationRange.end,
      rosterKindOf,
    }),
  ]));
  const violations = [
    ...validateDailyHours(grouped, shiftMap),
    ...validateShiftGap(grouped, shiftMap, policy.minShiftRestMinutes),
    ...validateContinuousNonRestDays(grouped, shiftMap, validationRange, leaveDaysMap, holidayDaysByEmployee),
  ];
  // The customer's internal policy remains stricter than flexible-work-time minima.
  let pendingWeeks = [];
  if (strictWeeklyRest) {
    const weekly = validateWeeklyRest(grouped, shiftMap, validationRange, employmentWindows);
    violations.push(...weekly.violations);
    pendingWeeks = weekly.pendingWeeks;
  }

  if (violations.length) {
    throw new LaborRuleValidationError('排班規範檢核未通過', violations, pendingWeeks);
  }
  // pendingWeeks 只在有跨月週還無法判斷時才附上，沒有的時候維持原本的 { ok, violations }
  return { ok: true, violations: [], ...(pendingWeeks.length ? { pendingWeeks } : {}) };
}

function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase();
}

// 表單性質有設定就以它為準（「一般」就是一般，名稱含加班/請假也不套用規則），沒有表單性質的舊表單才用名稱推論
function isOvertimeForm(form) {
  return isOvertimeFormTemplate(form);
}

function isLeaveForm(form) {
  return isLeaveFormTemplate(form);
}

async function loadFormFields(formId) {
  const query = FormField.find({ form: formId });
  if (query && typeof query.sort === 'function') {
    const sorted = query.sort({ order: 1 });
    if (sorted && typeof sorted.lean === 'function') return sorted.lean();
  }
  if (query && typeof query.lean === 'function') return query.lean();
  return query || [];
}

function findField(fields, patterns) {
  return fields.find((field) => {
    const label = normalizeLabel(field.label);
    return patterns.some((pattern) => pattern.test(label));
  });
}

function extractFormValue(formData, field) {
  if (!field) return undefined;
  const keys = [field._id, normalizeId(field._id), field.label].filter(Boolean);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(formData || {}, key)) return formData[key];
  }
  return undefined;
}

function isEmptyFormValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function formValueText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(formValueText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return String(value.label ?? value.name ?? value.value ?? value.path ?? value.url ?? '').trim();
  }
  return String(value).trim();
}

const APPROVAL_UPLOAD_URL_PATTERN = /^\/upload\/approvals\/([^/\\?#]+)$/;

// 只有 /api/approvals/attachments 上傳端點回傳的附件才算數：物件（{ name, url, size, type }）、
// 網址指向簽核附件資料夾，而且檔案真的存在。自己編的路徑或純字串都不算。
function isUploadedApprovalAttachment(item) {
  if (!item || typeof item !== 'object') return false;
  const match = APPROVAL_UPLOAD_URL_PATTERN.exec(String(item.url ?? item.path ?? '').trim());
  if (!match) return false;
  const filename = match[1];
  if (filename === '.' || filename === '..' || path.basename(filename) !== filename) return false;
  try {
    return fs.statSync(path.join(approvalUploadDir, filename)).isFile();
  } catch {
    return false;
  }
}

function hasUploadedAttachment(value) {
  const items = (Array.isArray(value) ? value : [value]).filter((item) => !isEmptyFormValue(item));
  return items.length > 0 && items.every(isUploadedApprovalAttachment);
}

// asOf：以送簽當時的表單為準，送簽之後才新增或修改的欄位（例如後來加上的必填欄位）不追溯到已送出的單
function fieldExistedAsOf(field, asOf) {
  if (!asOf) return true;
  const limit = new Date(asOf).getTime();
  const touched = new Date(field.updatedAt ?? field.createdAt ?? 0).getTime();
  if (!Number.isFinite(limit) || !Number.isFinite(touched)) return true;
  return touched <= limit;
}

function validateRequiredFields(formData, fields, { asOf = null } = {}) {
  return fields
    // 停用的欄位不會出現在填單畫面，沒有人能填，不能拿來擋送簽與核准
    .filter((field) => field.is_active !== false)
    .filter((field) => field.required && field.type_1 !== 'checkbox')
    .filter((field) => fieldExistedAsOf(field, asOf))
    .filter((field) => isEmptyFormValue(extractFormValue(formData, field)))
    .map((field) => makeViolation(
      'required-form-field',
      `必填欄位不可空白：${field.label}`,
      { fieldId: normalizeId(field._id), label: field.label },
    ));
}

function validateLeaveRequest(formData, fields) {
  const violations = [];
  // 停用的欄位不會出現在填單畫面，一律不參與判斷
  const activeFields = fields.filter((field) => field.is_active !== false);
  const leaveTypeField = findField(activeFields, [/^假別$/, /leave.*type/]);
  const reasonField = findField(activeFields, [/事由/, /原因/, /reason/]);
  const proofField = activeFields.find((field) => field.type_1 === 'file')
    || findField(activeFields, [/相關證明/, /證明/, /附件/, /proof/, /attachment/]);
  const leaveType = formValueText(extractFormValue(formData, leaveTypeField));

  if (/事假|personal\s*leave/i.test(leaveType)) {
    const reason = formValueText(extractFormValue(formData, reasonField));
    if (!reason) {
      violations.push(makeViolation(
        'personal-leave-reason',
        '事假必須填寫事由',
        { fieldId: normalizeId(reasonField?._id) },
      ));
    }
  }

  // 只有表單真的有啟用中的證明欄位（檔案 / 證明 / 附件）才檢查附件，而且看那個欄位自己的必填設定：
  // 必填就一定要附上系統上傳的附件；選填的欄位可以不附，但附了就必須是真的上傳檔案。
  // 客戶自建的請假表單沒有檔案欄位，使用者根本無從上傳，不能因此擋下送簽與核准。
  if (proofField) {
    const proofValue = extractFormValue(formData, proofField);
    const filled = !isEmptyFormValue(proofValue);
    if (!hasUploadedAttachment(proofValue) && (proofField.required || filled)) {
      violations.push(makeViolation(
        'leave-proof',
        // 選填欄位填了不是系統上傳的檔案，要說清楚是附件有問題，而不是沒附
        proofField.required ? '請假申請必須附上相關證明' : '附件不是系統上傳的檔案，請重新上傳',
        { fieldId: normalizeId(proofField._id) },
      ));
    }
  }

  return violations;
}

const LEAVE_CONFLICT_STATUS_LABELS = { pending: '簽核中', approved: '已核准' };

// 同一位員工已送出（簽核中）或已核准的假單裡，有沒有和這段時間重疊的；退回、駁回、取消的不算
async function findConflictingLeave({ employeeId, interval, ignoreRequestId }) {
  const leaveForms = await getAllLeaveFieldInfos({ withTypeOptions: false });
  for (const leaveForm of leaveForms || []) {
    const { formId, startId, endId } = leaveForm;
    if (!formId || !startId || !endId) continue;
    // 欄位被停用或換成同標籤的新欄位後，舊假單的答案還在舊欄位 ID 底下：取回所有候選欄位，
    // 逐張假單用第一個有填值的（與假勤日曆 approvedLeaveCalendarService 相同）
    const startIds = resolveCandidateIds(leaveForm.startIds, startId);
    const endIds = resolveCandidateIds(leaveForm.endIds, endId);
    let query = ApprovalRequest.find({
      form: formId,
      status: { $in: ['pending', 'approved'] },
      applicant_employee: employeeId,
    });
    if (query && typeof query.select === 'function') {
      query = query.select(['status']
        .concat(candidateSelectKeys(startIds, endIds).map((id) => `form_data.${id}`))
        .join(' '));
    }
    const rows = query && typeof query.lean === 'function' ? await query.lean() : await query;
    for (const row of rows || []) {
      if (ignoreRequestId && normalizeId(row._id) === ignoreRequestId) continue;
      const other = parseLeaveInterval(pickFieldValue(row.form_data, startIds), pickFieldValue(row.form_data, endIds));
      if (leaveIntervalsOverlap(interval, other)) return { status: row.status, interval: other };
    }
  }
  return null;
}

// 請假的時間順序（結束必須晚於開始），以及（checkConflicts 時）不可和自己已送出或已核准的假單重疊。
// 日期以台灣時間判斷；找不到開始、結束欄位或欄位沒填的表單不在這裡檢查（必填由必填欄位檢核處理）。
async function validateLeaveTimeRules({ formData, fields, applicantEmployeeId, checkConflicts, ignoreRequestId }) {
  const activeFields = fields.filter((field) => field.is_active !== false);
  const { startField, endField } = pickLeaveFields(activeFields);
  if (!startField || !endField) return [];
  const startValue = extractFormValue(formData, startField);
  const endValue = extractFormValue(formData, endField);
  if (isEmptyFormValue(startValue) || isEmptyFormValue(endValue)) return [];

  const endFieldId = normalizeId(endField._id);
  const interval = parseLeaveInterval(startValue, endValue, { startType: startField.type_1, endType: endField.type_1 });
  if (!interval) {
    return [makeViolation('leave-time-range', '請假的開始或結束時間無法判讀，請重新選擇', { fieldId: endFieldId })];
  }
  if (interval.reversed) {
    return [makeViolation(
      'leave-time-range',
      interval.allDay ? '請假結束日期不可早於開始日期' : '請假結束時間必須晚於開始時間',
      { fieldId: endFieldId },
    )];
  }

  const employeeId = normalizeId(applicantEmployeeId);
  if (!checkConflicts || !employeeId) return [];
  const conflict = await findConflictingLeave({ employeeId, interval, ignoreRequestId: normalizeId(ignoreRequestId) });
  if (!conflict) return [];
  return [makeViolation(
    'leave-overlap',
    `請假時間與已申請的假單重疊（${LEAVE_CONFLICT_STATUS_LABELS[conflict.status] || conflict.status}：${describeLeaveInterval(conflict.interval)}），請勿重複申請`,
    { fieldId: endFieldId, status: conflict.status },
  )];
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeLabel(value);
  return ['true', '1', 'yes', 'y', '是', '跨日'].includes(normalized);
}

// 加班單的欄位（開始、結束、時數、日期、跨日）各自的候選欄位。
// 申請中的單據只看啟用中的欄位：停用的欄位不會出現在填單畫面，同名的停用欄位不能蓋掉啟用中的欄位。
// includeInactive（讀已核准的舊單據用）：欄位被停用或換成同標籤的新欄位後，舊單據的答案還在舊欄位 ID 底下，
// 所以同標籤的欄位都列為候選（啟用中的在前、停用的在後），每一張單據各自用第一個有填值的欄位。
function overtimeFieldCandidates(rawFields, patterns, includeInactive) {
  const fields = rawFields || [];
  if (!includeInactive) {
    const picked = findField(fields.filter((field) => field.is_active !== false), patterns);
    return picked ? [picked] : [];
  }
  const byId = new Map(fields.map((field) => [normalizeId(field._id), field]));
  const ordered = orderFieldCandidateIds(fields).map((id) => byId.get(id));
  const picked = findField(ordered, patterns);
  if (!picked) return [];
  const label = normalizeLabel(picked.label);
  return ordered.filter((field) => normalizeLabel(field.label) === label);
}

// 這張單據在候選欄位裡第一個有填值的值；都沒填回傳 undefined
function pickCandidateFormValue(formData, candidates) {
  for (const field of candidates) {
    const value = extractFormValue(formData, field);
    if (!isEmptyFormValue(value)) return value;
  }
  return undefined;
}

function parseOvertimePayload(formData, rawFields, { includeInactive = false } = {}) {
  const pick = (patterns) => pickCandidateFormValue(
    formData,
    overtimeFieldCandidates(rawFields, patterns, includeInactive),
  );

  const rawStart = pick([/開始.*(時間|日期)/, /start/]);
  const rawEnd = pick([/結束.*(時間|日期)/, /end/]);
  const rawHours = pick([/加班.*時數/, /^時數$/, /hours?/]);
  const rawDate = pick([/加班.*日期/, /^日期$/, /date/]);
  const crossDay = boolValue(pick([/跨日/]));

  if (rawStart && rawEnd) {
    const start = new Date(rawStart);
    let end = new Date(rawEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      if (crossDay && end <= start) end = addUtcDays(end, 1);
      return {
        start,
        end,
        minutes: Math.max(Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE), 0),
      };
    }
  }

  const hours = Number(rawHours);
  // 只有日期與時數時，從那一天台灣時間 00:00 起算
  const overtimeDay = rawDate ? formDay(rawDate) : null;
  if (Number.isFinite(hours) && hours > 0 && overtimeDay) {
    const start = new Date(overtimeDay.getTime() - TAIPEI_OFFSET_MS);
    return { start, end: new Date(start.getTime() + hours * 60 * MS_PER_MINUTE), minutes: Math.round(hours * 60) };
  }

  return null;
}

// 已核准的加班單：答案可能在已停用（或換成同標籤新欄位前）的舊欄位底下，要把停用的欄位也列為候選，
// 否則舊單據解析不出來，就會從每日、每月、連續三個月的加班上限累計裡消失
function parseOvertimeApprovalMinutes(approval, fields) {
  return parseOvertimePayload(approval?.form_data || {}, fields, { includeInactive: true });
}

async function loadScheduleForDate(employeeId, date) {
  const query = ShiftSchedule.findOne({ employee: employeeId, date: startOfUtcDay(date) });
  if (query && typeof query.lean === 'function') return query.lean();
  return query;
}

async function loadApprovedOvertimeApprovals({ employeeId }) {
  let query = ApprovalRequest.find({
    status: 'approved',
    applicant_employee: employeeId,
  });
  if (query && typeof query.populate === 'function') query = query.populate('form');
  if (query && typeof query.lean === 'function') return query.lean();
  return query || [];
}

async function loadNearbySchedules(employeeId, payload) {
  const start = addUtcDays(formDay(payload.start), -2);
  const end = addUtcDays(formDay(payload.end), 3);
  return resolveLean(ShiftSchedule.find({
    employee: employeeId,
    date: { $gte: start, $lt: end },
  }));
}

function validateOvertimeShiftGap({ employeeId, payload, schedule, schedules, shiftMap, minRestMinutes }) {
  const currentDate = dateKey(schedule?.date);
  const currentSpan = getWorkSpan(schedule, shiftMap.get(normalizeId(schedule?.shiftId)));
  const effectiveStart = new Date(Math.min(
    payload.start.getTime(),
    currentSpan?.start?.getTime?.() ?? payload.start.getTime(),
  ));
  const effectiveEnd = new Date(Math.max(
    payload.end.getTime(),
    currentSpan?.end?.getTime?.() ?? payload.end.getTime(),
  ));
  const adjacentSpans = (schedules || [])
    .filter((item) => normalizeId(item?._id) !== normalizeId(schedule?._id))
    .filter((item) => dateKey(item?.date) !== currentDate)
    .map((item) => {
      const span = getWorkSpan(item, shiftMap.get(normalizeId(item?.shiftId)));
      return span ? { schedule: item, ...span } : null;
    })
    .filter(Boolean);
  const previous = adjacentSpans
    .filter((item) => item.end <= effectiveStart)
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  const next = adjacentSpans
    .filter((item) => item.start >= effectiveEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const violations = [];

  if (previous) {
    const gapMinutes = Math.round((effectiveStart.getTime() - previous.end.getTime()) / MS_PER_MINUTE);
    if (gapMinutes < minRestMinutes) {
      violations.push(makeViolation(
        'overtime-shift-gap',
        `加班與前一班之間需間隔 ${(minRestMinutes / 60).toFixed(1)} 小時：${dateKey(previous.schedule.date)} 到 ${dateKey(schedule.date)} 僅間隔 ${(gapMinutes / 60).toFixed(1)} 小時`,
        { employee: employeeId, previousDate: dateKey(previous.schedule.date), date: currentDate, gapMinutes, requiredMinutes: minRestMinutes },
      ));
    }
  }
  if (next) {
    const gapMinutes = Math.round((next.start.getTime() - effectiveEnd.getTime()) / MS_PER_MINUTE);
    if (gapMinutes < minRestMinutes) {
      violations.push(makeViolation(
        'overtime-shift-gap',
        `加班後至下一班需間隔 ${(minRestMinutes / 60).toFixed(1)} 小時：${currentDate} 到 ${dateKey(next.schedule.date)} 僅間隔 ${(gapMinutes / 60).toFixed(1)} 小時`,
        { employee: employeeId, date: currentDate, nextDate: dateKey(next.schedule.date), gapMinutes, requiredMinutes: minRestMinutes },
      ));
    }
  }
  return violations;
}

export async function assertOvertimeApprovalCompliance({
  form, formData, applicantEmployeeId, fields: suppliedFields, includeInactive = false,
} = {}) {
  if (!isOvertimeForm(form)) return { ok: true, violations: [] };
  const employeeId = normalizeId(applicantEmployeeId);
  if (!employeeId) return { ok: true, violations: [] };

  const fields = suppliedFields || await loadFormFields(form._id);
  // 已送出的單（核准時重新檢核）可能填在後來被停用或取代的欄位下，要連停用的欄位一起讀
  const payload = parseOvertimePayload(formData || {}, fields, { includeInactive });
  if (!payload || payload.minutes <= 0) {
    throw new LaborRuleValidationError('加班申請時間無法判讀', [
      makeViolation('overtime-time-range', '加班申請需填寫可判讀的開始/結束時間或日期/時數'),
    ]);
  }
  // 加班屬於哪一天以台灣時間判斷：台灣早上 06:00 的加班是當天，不是 UTC 的前一天
  const overtimeDate = formDay(payload.start);
  const [approved, policy] = await Promise.all([
    loadApprovedOvertimeApprovals({ employeeId }),
    loadLaborRulePolicy(),
  ]);

  let approvedMonthMinutes = 0;
  let approvedThreeMonthMinutes = 0;
  let approvedDayMinutes = 0;
  const rollingStart = new Date(Date.UTC(overtimeDate.getUTCFullYear(), overtimeDate.getUTCMonth() - 2, 1));
  const rollingEnd = new Date(Date.UTC(overtimeDate.getUTCFullYear(), overtimeDate.getUTCMonth() + 1, 1));
  const fieldCache = new Map([[normalizeId(form._id), fields]]);
  for (const approval of approved || []) {
    const approvalForm = approval.form && typeof approval.form === 'object'
      ? approval.form
      : (!approval.form || normalizeId(approval.form) === normalizeId(form._id) ? form : null);
    if (!approvalForm || !isOvertimeForm(approvalForm)) continue;
    const approvalFormId = normalizeId(approvalForm._id || approval.form);
    if (!fieldCache.has(approvalFormId)) {
      fieldCache.set(approvalFormId, await loadFormFields(approvalFormId));
    }
    const approvedPayload = parseOvertimeApprovalMinutes(approval, fieldCache.get(approvalFormId));
    if (!approvedPayload) continue;
    const approvedDay = formDay(approvedPayload.start);
    if (approvedDay >= rollingStart && approvedDay < rollingEnd) {
      approvedThreeMonthMinutes += approvedPayload.minutes;
    }
    if (monthKey(approvedDay) !== monthKey(overtimeDate)) continue;
    approvedMonthMinutes += approvedPayload.minutes;
    if (dateKey(approvedDay) === dateKey(overtimeDate)) {
      approvedDayMinutes += approvedPayload.minutes;
    }
  }

  const violations = [];
  if (approvedDayMinutes + payload.minutes > MAX_DAILY_OVERTIME_MINUTES) {
    violations.push(makeViolation(
      'daily-overtime-hours',
      `每日加班不得超過4小時：${dateKey(overtimeDate)} 累計 ${((approvedDayMinutes + payload.minutes) / 60).toFixed(1)} 小時`,
      { date: dateKey(overtimeDate), minutes: approvedDayMinutes + payload.minutes },
    ));
  }
  if (approvedMonthMinutes + payload.minutes > policy.monthlyOvertimeMinutes) {
    violations.push(makeViolation(
      'monthly-overtime-hours',
      `${monthKey(overtimeDate)} 加班不得超過${policy.monthlyOvertimeMinutes / 60}小時：累計 ${((approvedMonthMinutes + payload.minutes) / 60).toFixed(1)} 小時`,
      { month: monthKey(overtimeDate), minutes: approvedMonthMinutes + payload.minutes, limitMinutes: policy.monthlyOvertimeMinutes },
    ));
  }
  if (policy.extendedOvertimeEnabled && approvedThreeMonthMinutes + payload.minutes > policy.threeMonthOvertimeMinutes) {
    violations.push(makeViolation(
      'three-month-overtime-hours',
      `连续3个月加班不得超过${policy.threeMonthOvertimeMinutes / 60}小时`,
      { minutes: approvedThreeMonthMinutes + payload.minutes, limitMinutes: policy.threeMonthOvertimeMinutes },
    ));
  }

  const shiftMap = await loadShiftMap();
  const schedule = await loadScheduleForDate(employeeId, overtimeDate);
  if (!schedule) {
    violations.push(makeViolation(
      'overtime-schedule-required',
      `加班申請必須先有當日班表：${dateKey(overtimeDate)}`,
      { date: dateKey(overtimeDate) },
    ));
  } else {
    const shift = shiftMap.get(normalizeId(schedule.shiftId));
    const classification = classifyShift(shift);
    if (classification.isRegularRest) {
      violations.push(makeViolation(
        'regular-rest-overtime',
        `例假不得加班：${dateKey(overtimeDate)} 已排例假`,
        { date: dateKey(overtimeDate) },
      ));
    } else {
      const span = getWorkSpan(schedule, shift);
      if (span && span.workMinutes + payload.minutes > MAX_TOTAL_WORK_MINUTES_PER_DAY) {
        violations.push(makeViolation(
          'daily-work-plus-overtime-hours',
          `每日工時含加班不得超過12小時：${dateKey(overtimeDate)} 累計 ${((span.workMinutes + payload.minutes) / 60).toFixed(1)} 小時`,
          { date: dateKey(overtimeDate), minutes: span.workMinutes + payload.minutes },
        ));
      }
    }
    const nearbySchedules = await loadNearbySchedules(employeeId, payload);
    violations.push(...validateOvertimeShiftGap({
      employeeId,
      payload,
      schedule,
      schedules: nearbySchedules,
      shiftMap,
      minRestMinutes: policy.minShiftRestMinutes,
    }));
  }

  if (violations.length) {
    throw new LaborRuleValidationError('加班規範檢核未通過', violations);
  }
  return { ok: true, violations: [] };
}

/**
 * 送簽資料檢核（必填欄位、請假規則、加班規範）。
 * - checkLeaveConflicts：送出新假單時設為 true，會拒絕和自己「簽核中 / 已核准」假單重疊（含完全重複）的請假；
 *   核准、重送等重新檢核既有單據時要同時帶 ignoreRequestId（該單自己的 ID），否則會和自己重疊。
 * - requiredFieldsAsOf：重新檢核既有單據（例如核准）時帶入該單的送簽時間，
 *   送簽之後才新增或修改的必填欄位不追溯，避免管理員加了一個必填欄位就讓所有待簽的單都無法核准。
 */
export async function assertApprovalRequestCompliance({
  form,
  formData,
  applicantEmployeeId,
  checkLeaveConflicts = false,
  ignoreRequestId = null,
  requiredFieldsAsOf = null,
} = {}) {
  const fields = await loadFormFields(form?._id);
  const violations = validateRequiredFields(formData || {}, fields, { asOf: requiredFieldsAsOf });
  if (isLeaveForm(form)) {
    violations.push(...validateLeaveRequest(formData || {}, fields));
    violations.push(...await validateLeaveTimeRules({
      formData: formData || {},
      fields,
      applicantEmployeeId,
      checkConflicts: checkLeaveConflicts,
      ignoreRequestId,
    }));
  }
  if (violations.length) {
    throw new LaborRuleValidationError('送簽資料檢核未通過', violations);
  }

  await assertOvertimeApprovalCompliance({
    form,
    formData,
    applicantEmployeeId,
    fields,
    includeInactive: Boolean(ignoreRequestId),
  });
  return { ok: true, violations: [] };
}

export function isLaborRuleValidationError(error) {
  return error?.name === 'LaborRuleValidationError' || Array.isArray(error?.violations);
}

// 只給單元測試用：把附件資料夾換成暫存資料夾，回傳原本的資料夾
function setApprovalUploadDir(dir) {
  const previous = approvalUploadDir;
  approvalUploadDir = dir;
  return previous;
}

export const __testUtils = {
  setApprovalUploadDir,
  dateKey,
  startOfUtcDay,
  formDay,
  hasUploadedAttachment,
  classifyShift,
  normalizeId,
  parseOvertimePayload,
};
