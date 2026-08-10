import ShiftSchedule from '../models/ShiftSchedule.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import ApprovalRequest from '../models/approval_request.js';
import FormField from '../models/form_field.js';
import Holiday from '../models/Holiday.js';
import HolidayMoveSetting from '../models/HolidayMoveSetting.js';
import { computeShiftSpan } from '../utils/timeWindow.js';
import { getLeaveFieldIds } from './leaveFieldService.js';
import { resolveShiftSemanticType } from './shiftSemanticService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MIN_REST_BETWEEN_SHIFTS_MINUTES = 11 * 60;
const MAX_REGULAR_WORK_MINUTES_PER_DAY = 8 * 60;
const MAX_TOTAL_WORK_MINUTES_PER_DAY = 12 * 60;
const MAX_CONTINUOUS_NON_REST_DAYS = 6;
const MAX_DAILY_OVERTIME_MINUTES = 4 * 60;

class LaborRuleValidationError extends Error {
  constructor(message, violations = []) {
    super(message);
    this.name = 'LaborRuleValidationError';
    this.status = 400;
    this.violations = violations;
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
  const semanticType = resolveShiftSemanticType(shift);
  const isRegularRest = semanticType === 'regular_rest';
  const isRestDay = semanticType === 'rest_day';
  return {
    isRegularRest,
    isRestDay,
    isNonWork: isRegularRest || isRestDay,
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
      } else if (span.workMinutes > MAX_REGULAR_WORK_MINUTES_PER_DAY) {
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

function validateContinuousNonRestDays(
  grouped,
  shiftMap,
  { start, end },
  leaveDaysMap = new Map(),
  holidayDays = new Set(),
) {
  const violations = [];
  for (const [employee, schedules] of grouped) {
    const byDate = new Map(schedules.map((schedule) => [dateKey(schedule.date), schedule]));
    const leaveDays = leaveDaysMap.get(employee) || new Set();
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
  const { formId, startId, endId } = await getLeaveFieldIds();
  if (!formId || !startId || !endId || !employeeIds.length) return leaveDaysMap;

  const query = ApprovalRequest.find({
    form: formId,
    status: 'approved',
    applicant_employee: { $in: employeeIds },
  });
  const approvals = query && typeof query.lean === 'function' ? await query.lean() : await query;

  for (const approval of approvals || []) {
    const employeeId = normalizeId(approval.applicant_employee);
    const bucket = leaveDaysMap.get(employeeId);
    if (!bucket) continue;
    const leaveStart = startOfUtcDay(approval.form_data?.[startId]);
    const leaveEnd = startOfUtcDay(approval.form_data?.[endId]);
    if (!leaveStart || !leaveEnd || leaveEnd < leaveStart) continue;

    const clampedStart = leaveStart > start ? leaveStart : start;
    const clampedEnd = leaveEnd < addUtcDays(end, -1) ? leaveEnd : addUtcDays(end, -1);
    for (let pointer = new Date(clampedStart); pointer <= clampedEnd; pointer = addUtcDays(pointer, 1)) {
      bucket.add(dateKey(pointer));
    }
  }

  return leaveDaysMap;
}

function isCountedHoliday(holiday) {
  const text = [holiday?.type, holiday?.name, holiday?.description, holiday?.desc]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/工作日|補班|makeup\s*work/.test(text)) return false;
  return /國定|假日|holiday/.test(text);
}

async function resolvePlainQuery(query) {
  if (query && typeof query.lean === 'function') return query.lean();
  return query || [];
}

async function loadCountedHolidayDays(start, end) {
  const [holidays, moves] = await Promise.all([
    resolvePlainQuery(Holiday.find({ date: { $gte: start, $lt: end } })),
    resolvePlainQuery(HolidayMoveSetting.find({ enableHolidayMove: true })),
  ]);
  const holidayDays = new Set(
    (holidays || [])
      .filter(isCountedHoliday)
      .map((holiday) => dateKey(holiday.date))
      .filter(Boolean),
  );

  for (const move of moves || []) {
    const source = startOfUtcDay(move?.sourceDate);
    const target = startOfUtcDay(move?.targetDate);
    if (!source || !target || monthKey(source) !== monthKey(target)) continue;
    holidayDays.delete(dateKey(source));
    if (target >= start && target < end) holidayDays.add(dateKey(target));
  }
  return holidayDays;
}

function validateWeeklyRest(grouped, shiftMap, { strictStart, strictEnd }) {
  const violations = [];
  for (const [employee, schedules] of grouped) {
    const byDate = new Map(schedules.map((schedule) => [dateKey(schedule.date), schedule]));
    const firstWeekStart = weekStartMonday(strictStart);
    for (let weekStart = firstWeekStart; weekStart < strictEnd; weekStart = addUtcDays(weekStart, 7)) {
      const weekEnd = addUtcDays(weekStart, 7);
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
      if (hasScheduledInStrictRange && (regularRestCount < 1 || restDayCount < 1)) {
        violations.push(makeViolation(
          'weekly-one-regular-rest-one-rest-day',
          `每週一至週日需至少1例1休：${dateKey(weekStart)} 週缺少${regularRestCount < 1 ? '例假' : ''}${regularRestCount < 1 && restDayCount < 1 ? '與' : ''}${restDayCount < 1 ? '休息日' : ''}`,
          { employee, weekStart: dateKey(weekStart), regularRestCount, restDayCount },
        ));
      }
    }
  }
  return violations;
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
  const employeeIds = Array.from(new Set(normalizedCandidates.map((item) => item.employee).filter(Boolean)));
  if (!employeeIds.length) return { ok: true, violations: [] };

  const validationRange = buildValidationRange(normalizedCandidates, range);
  const existing = await resolveLean(ShiftSchedule.find({
    employee: { $in: employeeIds },
    date: { $gte: validationRange.start, $lt: validationRange.end },
  }));
  const allSchedules = mergeSchedules(existing, normalizedCandidates, ignoredScheduleIds);
  const grouped = groupSchedules(allSchedules);
  const [leaveDaysMap, holidayDays] = await Promise.all([
    loadApprovedLeaveDaysMap(
      employeeIds,
      validationRange.start,
      validationRange.end,
    ),
    loadCountedHolidayDays(validationRange.start, validationRange.end),
  ]);
  const violations = [
    ...validateDailyHours(grouped, shiftMap),
    ...validateShiftGap(grouped, shiftMap, policy.minShiftRestMinutes),
    ...validateContinuousNonRestDays(grouped, shiftMap, validationRange, leaveDaysMap, holidayDays),
  ];
  // The customer's internal policy remains stricter than flexible-work-time minima.
  if (strictWeeklyRest) {
    violations.push(...validateWeeklyRest(grouped, shiftMap, validationRange));
  }

  if (violations.length) {
    throw new LaborRuleValidationError('排班規範檢核未通過', violations);
  }
  return { ok: true, violations: [] };
}

function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function isOvertimeForm(form) {
  if (normalizeLabel(form?.semanticType) === 'overtime') return true;
  const name = normalizeLabel(form?.name);
  return name.includes('加班') || name.includes('overtime');
}

function isLeaveForm(form) {
  if (normalizeLabel(form?.semanticType) === 'leave') return true;
  const name = normalizeLabel(form?.name);
  return name.includes('請假') || name.includes('leave');
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

function hasUploadedAttachment(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => {
    const path = typeof item === 'object' && item
      ? item.url ?? item.path ?? ''
      : item;
    return /^\/upload\/approvals\//.test(String(path || '').trim());
  });
}

function validateRequiredFields(formData, fields) {
  return fields
    .filter((field) => field.required && field.type_1 !== 'checkbox')
    .filter((field) => isEmptyFormValue(extractFormValue(formData, field)))
    .map((field) => makeViolation(
      'required-form-field',
      `必填欄位不可空白：${field.label}`,
      { fieldId: normalizeId(field._id), label: field.label },
    ));
}

function validateLeaveRequest(formData, fields) {
  const violations = [];
  const leaveTypeField = findField(fields, [/^假別$/, /leave.*type/]);
  const reasonField = findField(fields, [/事由/, /原因/, /reason/]);
  const proofField = fields.find((field) => field.type_1 === 'file')
    || findField(fields, [/相關證明/, /證明/, /附件/, /proof/, /attachment/]);
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

  if (!proofField || !hasUploadedAttachment(extractFormValue(formData, proofField))) {
    violations.push(makeViolation(
      'leave-proof',
      '請假申請必須附上相關證明',
      { fieldId: normalizeId(proofField?._id) },
    ));
  }

  return violations;
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeLabel(value);
  return ['true', '1', 'yes', 'y', '是', '跨日'].includes(normalized);
}

function parseOvertimePayload(formData, fields) {
  const startField = findField(fields, [/開始.*(時間|日期)/, /start/]);
  const endField = findField(fields, [/結束.*(時間|日期)/, /end/]);
  const hoursField = findField(fields, [/加班.*時數/, /^時數$/, /hours?/]);
  const dateField = findField(fields, [/加班.*日期/, /^日期$/, /date/]);
  const crossDayField = findField(fields, [/跨日/]);

  const rawStart = extractFormValue(formData, startField);
  const rawEnd = extractFormValue(formData, endField);
  const rawHours = extractFormValue(formData, hoursField);
  const rawDate = extractFormValue(formData, dateField);
  const crossDay = boolValue(extractFormValue(formData, crossDayField));

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
  const date = rawDate ? new Date(rawDate) : null;
  if (Number.isFinite(hours) && hours > 0 && date && !Number.isNaN(date.getTime())) {
    const start = startOfUtcDay(date);
    return { start, end: new Date(start.getTime() + hours * 60 * MS_PER_MINUTE), minutes: Math.round(hours * 60) };
  }

  return null;
}

function parseOvertimeApprovalMinutes(approval, fields) {
  return parseOvertimePayload(approval?.form_data || {}, fields);
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
  const start = addUtcDays(startOfUtcDay(payload.start), -2);
  const end = addUtcDays(startOfUtcDay(payload.end), 3);
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

export async function assertOvertimeApprovalCompliance({ form, formData, applicantEmployeeId, fields: suppliedFields } = {}) {
  if (!isOvertimeForm(form)) return { ok: true, violations: [] };
  const employeeId = normalizeId(applicantEmployeeId);
  if (!employeeId) return { ok: true, violations: [] };

  const fields = suppliedFields || await loadFormFields(form._id);
  const payload = parseOvertimePayload(formData || {}, fields);
  if (!payload || payload.minutes <= 0) {
    throw new LaborRuleValidationError('加班申請時間無法判讀', [
      makeViolation('overtime-time-range', '加班申請需填寫可判讀的開始/結束時間或日期/時數'),
    ]);
  }
  const overtimeDate = startOfUtcDay(payload.start);
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
    if (approvedPayload.start >= rollingStart && approvedPayload.start < rollingEnd) {
      approvedThreeMonthMinutes += approvedPayload.minutes;
    }
    if (monthKey(approvedPayload.start) !== monthKey(overtimeDate)) continue;
    approvedMonthMinutes += approvedPayload.minutes;
    if (dateKey(approvedPayload.start) === dateKey(overtimeDate)) {
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

export async function assertApprovalRequestCompliance({ form, formData, applicantEmployeeId } = {}) {
  const fields = await loadFormFields(form?._id);
  const violations = validateRequiredFields(formData || {}, fields);
  if (isLeaveForm(form)) {
    violations.push(...validateLeaveRequest(formData || {}, fields));
  }
  if (violations.length) {
    throw new LaborRuleValidationError('送簽資料檢核未通過', violations);
  }

  await assertOvertimeApprovalCompliance({
    form,
    formData,
    applicantEmployeeId,
    fields,
  });
  return { ok: true, violations: [] };
}

export function isLaborRuleValidationError(error) {
  return error?.name === 'LaborRuleValidationError' || Array.isArray(error?.violations);
}

export const __testUtils = {
  dateKey,
  startOfUtcDay,
  classifyShift,
  normalizeId,
  parseOvertimePayload,
};
