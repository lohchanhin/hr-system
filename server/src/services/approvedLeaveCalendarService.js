import ApprovalRequest from '../models/approval_request.js';
import { getAllLeaveFieldInfos } from './leaveFieldService.js';
import { dateKeyToUtcMidnight, toTaipeiDateKey } from '../utils/taipeiTime.js';
import { parseLeaveInterval } from '../utils/leaveDuration.js';
import { candidateSelectKeys, pickFieldValue, resolveCandidateIds } from '../utils/fieldCandidates.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) {
    return normalizeId(value._id);
  }
  return typeof value.toString === 'function' ? value.toString() : String(value);
}

// 請假的開始、結束與查詢範圍一律以台灣時間判斷是哪一天：台灣 6/19 00:00 存成 2026-06-18T16:00:00.000Z，
// 直接取 UTC 日期會把假排到前一天。回傳以 UTC 午夜代表那個台灣日期（與班表日期同一種表示）。
function taipeiDay(value) {
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value.trim())) {
    return null;
  }
  const key = toTaipeiDateKey(value);
  return key ? dateKeyToUtcMidnight(key) : null;
}

// 假別欄位的值可能是字串，也可能是 { label, value }
function leaveTypeLabel(value) {
  if (value && typeof value === 'object') return String(value.label ?? value.name ?? value.value ?? '').trim();
  return String(value ?? '').trim();
}

function addUtcDays(value, days) {
  return new Date(value.getTime() + days * MS_PER_DAY);
}

// 這張請假表單讀單據用的欄位：開始、結束、假別各自的同標籤候選欄位（啟用中的在前、停用的在後）。
// 欄位被停用或換成同標籤的新欄位後，舊假單的答案還在舊欄位 ID 底下，所以逐張假單用第一個有填值的；
// 呼叫端只給單一欄位 ID（沒有候選清單）時就只用那一個。
function leaveFormFields({ startId, endId, typeId, startIds, endIds, typeIds }) {
  const candidates = {
    startIds: resolveCandidateIds(startIds, startId),
    endIds: resolveCandidateIds(endIds, endId),
    typeIds: resolveCandidateIds(typeIds, typeId),
  };
  const select = ['applicant_employee']
    .concat(candidateSelectKeys(candidates.startIds, candidates.endIds, candidates.typeIds).map((id) => `form_data.${id}`))
    .join(' ');
  return { ...candidates, select };
}

/**
 * ApprovalRequest.form_data is Mixed and stores ISO date strings. Querying those
 * values with BSON Date operands misses valid approvals, so range filtering is
 * intentionally performed after the scoped approval query.
 *
 * 系統預設的「請假」與客戶自建的請假表單可以並存：每張請假表單各查一次核准的假單（用該表單自己的欄位 ID），
 * 合併進同一份日曆。一張假單只屬於一張表單，不會重複計入；同一人同一天在多張表單都有請假時只留一筆。
 * 已停用（含軟刪除）的請假表單底下已核准的假單照樣計入：表單不再開放申請，不代表已核准的假消失。
 */
export async function loadApprovedLeaveCalendar({ employeeIds, start, end } = {}) {
  const ids = Array.from(new Set((employeeIds || []).map(normalizeId).filter(Boolean)));
  const rangeStart = taipeiDay(start);
  const rangeEnd = taipeiDay(end);
  const calendar = new Map(ids.map((id) => [id, new Map()]));
  if (!ids.length || !rangeStart || !rangeEnd || rangeEnd <= rangeStart) return calendar;

  const leaveForms = await getAllLeaveFieldInfos({ withTypeOptions: false });
  const lastRangeDay = addUtcDays(rangeEnd, -1);

  for (const leaveForm of leaveForms) {
    const { formId, startId, endId } = leaveForm;
    if (!formId || !startId || !endId) continue;
    const fields = leaveFormFields(leaveForm);

    let query = ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: ids },
    });
    if (query && typeof query.select === 'function') {
      query = query.select(fields.select);
    }
    const approvals = query && typeof query.lean === 'function' ? await query.lean() : await query;

    for (const approval of approvals || []) {
      const employeeId = normalizeId(approval.applicant_employee);
      const bucket = calendar.get(employeeId);
      if (!bucket) continue;
      const leaveStart = taipeiDay(pickFieldValue(approval.form_data, fields.startIds));
      const leaveEnd = taipeiDay(pickFieldValue(approval.form_data, fields.endIds));
      if (!leaveStart || !leaveEnd || leaveEnd < leaveStart) continue;

      const firstDay = leaveStart > rangeStart ? leaveStart : rangeStart;
      const lastDay = leaveEnd < lastRangeDay ? leaveEnd : lastRangeDay;
      if (lastDay < firstDay) continue;

      const leaveType = leaveTypeLabel(pickFieldValue(approval.form_data, fields.typeIds)) || '請假';
      for (let pointer = firstDay; pointer <= lastDay; pointer = addUtcDays(pointer, 1)) {
        bucket.set(pointer.toISOString().slice(0, 10), leaveType);
      }
    }
  }

  return calendar;
}

/**
 * 已核准的請假「時間區間」（含時分，整天的假是 00:00 到隔天 00:00）：Map(員工 ID -> [{ startMs, endMs, allDay, leaveType }])。
 * 遲到早退扣款用它判斷員工是不是請假中：半天的假不會被算成遲到或早退。
 * 只保留和 [start, end) 前後各多一天內有交集的假單（班別可能跨日）。
 */
export async function loadApprovedLeaveIntervals({ employeeIds, start, end } = {}) {
  const ids = Array.from(new Set((employeeIds || []).map(normalizeId).filter(Boolean)));
  const intervals = new Map(ids.map((id) => [id, []]));
  const rangeStart = taipeiDay(start);
  const rangeEnd = taipeiDay(end);
  if (!ids.length || !rangeStart || !rangeEnd || rangeEnd <= rangeStart) return intervals;

  const firstKey = toTaipeiDateKey(addUtcDays(rangeStart, -1));
  const lastKey = toTaipeiDateKey(addUtcDays(rangeEnd, 1));
  const leaveForms = await getAllLeaveFieldInfos({ withTypeOptions: false });

  for (const leaveForm of leaveForms) {
    const { formId, startId, endId } = leaveForm;
    if (!formId || !startId || !endId) continue;
    const fields = leaveFormFields(leaveForm);

    let query = ApprovalRequest.find({
      form: formId,
      status: 'approved',
      applicant_employee: { $in: ids },
    });
    if (query && typeof query.select === 'function') {
      query = query.select(fields.select);
    }
    const approvals = query && typeof query.lean === 'function' ? await query.lean() : await query;

    for (const approval of approvals || []) {
      const bucket = intervals.get(normalizeId(approval.applicant_employee));
      if (!bucket) continue;
      const interval = parseLeaveInterval(
        pickFieldValue(approval.form_data, fields.startIds),
        pickFieldValue(approval.form_data, fields.endIds),
      );
      if (!interval || interval.reversed) continue;
      if (interval.lastKey < firstKey || interval.startKey > lastKey) continue;
      bucket.push({
        startMs: interval.startMs,
        endMs: interval.endMs,
        allDay: interval.allDay,
        leaveType: leaveTypeLabel(pickFieldValue(approval.form_data, fields.typeIds)) || '請假',
      });
    }
  }

  return intervals;
}

export function leaveDaysFromCalendar(calendar, employeeId, separator = '-') {
  const dates = calendar.get(normalizeId(employeeId))?.keys?.() || [];
  return new Set(Array.from(dates, (date) => separator === '/' ? date.replaceAll('-', '/') : date));
}

export const __testUtils = { normalizeId, taipeiDay };
