import Employee from '../models/Employee.js';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

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

/**
 * 回傳 employeeIds 的在職期間 Map(員工 id 字串 -> { hireKey, resigned, resignKey })，現場讀員工資料，不另存狀態。
 * 用在跨月週的「待判斷」：鄰月那幾天要是這個人還沒到職或已經離職，就永遠不會有班表，不能算「還補得上」。
 * - 到職日（appointment.hireDate）以台灣日期判斷。
 * - 離職日只有目前狀態是「離職員工」才套用（離職日 appointment.resignationDate，沒有就用解聘日 appointment.dismissalDate），
 *   在職員工不看離職日，所以離職後再任用的人不會被誤判；和國定假日休假紀錄（holidayRestLedgerService）的算法一致。
 * 沒有到職日、也不是離職員工的人不放進 Map（任何一天都當作在職，維持原本的判斷）。
 * 不是 24 碼 ObjectId 的 id 不會去查詢；查詢失敗直接往外丟，不會因此靜默放行。
 */
export async function loadScheduleRuleEmploymentWindows(employeeIds) {
  const windows = new Map();
  const ids = [...new Set((employeeIds || []).map((id) => String(id)))]
    .filter((id) => OBJECT_ID_PATTERN.test(id));
  if (!ids.length) return windows;
  let query = Employee.find({ _id: { $in: ids } });
  if (query && typeof query.select === 'function') {
    query = query.select('status appointment.hireDate appointment.resignationDate appointment.dismissalDate');
  }
  const rows = query && typeof query.lean === 'function' ? await query.lean() : await query;
  for (const row of rows || []) {
    const appointment = row?.appointment || {};
    const hireKey = toTaipeiDateKey(appointment.hireDate) || '';
    const resigned = row?.status === '離職員工';
    const resignKey = resigned
      ? (toTaipeiDateKey(appointment.resignationDate) || toTaipeiDateKey(appointment.dismissalDate) || '')
      : '';
    if (!hireKey && !resigned) continue;
    windows.set(String(row._id), { hireKey, resigned, resignKey });
  }
  return windows;
}

/**
 * 這個人在 dateKey（台灣日期 YYYY-MM-DD）這一天是不是在職（到職日、離職日當天都算在職）。
 * 沒有在職期間資料（window 為空）一律算在職。離職員工沒有離職日也沒有解聘日時，
 * 用 lastScheduledKey（他最後一筆班表的日期）當作最後在職的一天，與國定假日休假紀錄相同；連班表都沒有就整段都不算在職。
 */
export function isEmployedOn(window, dateKey, lastScheduledKey = '') {
  if (!window) return true;
  if (window.hireKey && dateKey < window.hireKey) return false;
  if (window.resigned) {
    const end = window.resignKey || lastScheduledKey;
    if (!end || dateKey > end) return false;
  }
  return true;
}
