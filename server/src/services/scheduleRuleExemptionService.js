import Employee from '../models/Employee.js';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// 兼職人員（Employee.partTime === true）不套用排班規範檢核（每週一例一休、連續上班日、每日工時、班與班間隔）；
// 沒有 partTime 欄位或不是布林值的舊資料一律算正職，維持原本的檢核。
export function isScheduleRuleExempt(employee) {
  return employee?.partTime === true;
}

/**
 * 回傳 employeeIds 中免套用排班規範的員工 id 集合（現場讀 Employee.partTime，不另存狀態）。
 * 不是 24 碼 ObjectId 的 id 不會去查詢；查詢失敗直接往外丟，由呼叫端依原本的錯誤流程處理，
 * 不會因此靜默放行。
 */
export async function loadScheduleRuleExemptEmployeeIds(employeeIds) {
  const ids = [...new Set((employeeIds || []).map((id) => String(id)))]
    .filter((id) => OBJECT_ID_PATTERN.test(id));
  if (!ids.length) return new Set();
  let query = Employee.find({ _id: { $in: ids }, partTime: true });
  if (query && typeof query.select === 'function') query = query.select('_id');
  const rows = query && typeof query.lean === 'function' ? await query.lean() : await query;
  return new Set((rows || []).map((row) => String(row._id)));
}
