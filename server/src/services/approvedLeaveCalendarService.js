import ApprovalRequest from '../models/approval_request.js';
import { getLeaveFieldIds } from './leaveFieldService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) {
    return normalizeId(value._id);
  }
  return typeof value.toString === 'function' ? value.toString() : String(value);
}

function startOfUtcDay(value) {
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value.trim())) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(value, days) {
  return new Date(value.getTime() + days * MS_PER_DAY);
}

/**
 * ApprovalRequest.form_data is Mixed and stores ISO date strings. Querying those
 * values with BSON Date operands misses valid approvals, so range filtering is
 * intentionally performed after the scoped approval query.
 */
export async function loadApprovedLeaveCalendar({ employeeIds, start, end } = {}) {
  const ids = Array.from(new Set((employeeIds || []).map(normalizeId).filter(Boolean)));
  const rangeStart = startOfUtcDay(start);
  const rangeEnd = startOfUtcDay(end);
  const calendar = new Map(ids.map((id) => [id, new Map()]));
  if (!ids.length || !rangeStart || !rangeEnd || rangeEnd <= rangeStart) return calendar;

  const { formId, startId, endId, typeId } = await getLeaveFieldIds();
  if (!formId || !startId || !endId) return calendar;

  let query = ApprovalRequest.find({
    form: formId,
    status: 'approved',
    applicant_employee: { $in: ids },
  });
  if (query && typeof query.select === 'function') {
    query = query.select(`applicant_employee form_data.${startId} form_data.${endId}${typeId ? ` form_data.${typeId}` : ''}`);
  }
  const approvals = query && typeof query.lean === 'function' ? await query.lean() : await query;

  for (const approval of approvals || []) {
    const employeeId = normalizeId(approval.applicant_employee);
    const bucket = calendar.get(employeeId);
    if (!bucket) continue;
    const leaveStart = startOfUtcDay(approval.form_data?.[startId]);
    const leaveEnd = startOfUtcDay(approval.form_data?.[endId]);
    if (!leaveStart || !leaveEnd || leaveEnd < leaveStart) continue;

    const firstDay = leaveStart > rangeStart ? leaveStart : rangeStart;
    const lastRangeDay = addUtcDays(rangeEnd, -1);
    const lastDay = leaveEnd < lastRangeDay ? leaveEnd : lastRangeDay;
    if (lastDay < firstDay) continue;

    const leaveType = String(approval.form_data?.[typeId] || '請假').trim() || '請假';
    for (let pointer = firstDay; pointer <= lastDay; pointer = addUtcDays(pointer, 1)) {
      bucket.set(pointer.toISOString().slice(0, 10), leaveType);
    }
  }

  return calendar;
}

export function leaveDaysFromCalendar(calendar, employeeId, separator = '-') {
  const dates = calendar.get(normalizeId(employeeId))?.keys?.() || [];
  return new Set(Array.from(dates, (date) => separator === '/' ? date.replaceAll('-', '/') : date));
}

export const __testUtils = { normalizeId, startOfUtcDay };
