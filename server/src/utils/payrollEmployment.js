// 員工在薪資月份內的在職期間（純函式）。月薪是整月的薪水：月中到職、離職要按在職日數比例給，
// 整個月都不在職（還沒到職、已經離職、留職停薪）就沒有本薪；日薪、時薪本來就按出勤給薪，不需要比例。
// 在職期間的判斷與國定假日休假紀錄（services/holidayRestLedgerService.buildTenureCheck）相同：
// - 到職日（appointment.hireDate）以台灣日期判斷，到職前不算在職。
// - 只有目前狀態是「離職員工」才套用離職日（離職日、解聘日，含當天）；兩個日期都沒填時用本月最後一筆班表日期，
//   連班表都沒有就整月不在職。在職員工不看離職日，離職後再任用的人不會被誤判。
// - 留職停薪且本月沒有任何班表：整月不在職。
// 月中到職、離職的比例怎麼算是薪資政策（services/payrollPolicyService.js 的 proration.method），預設 days30 是以前的做法：
// - days30：在職日曆天數 ÷ 30（WORK_HOURS_CONFIG.DAYS_PER_MONTH，與月薪換算日薪、時薪的基準相同），最多 1。
// - calendarDays：在職日曆天數 ÷ 當月天數（28～31）。
// - none：不按比例，當月只要有在職（哪怕一天）就是 1；整月都不在職仍然是 0。
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js';
import { toTaipeiDateKey } from './taipeiTime.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const PRORATION_METHOD_KEYS = ['days30', 'calendarDays', 'none'];
export const DEFAULT_PRORATION_METHOD = 'days30';

// 各方式的分母（天數）；none 沒有分母
function prorationBasisDays(method, daysInMonth) {
  if (method === 'calendarDays') return daysInMonth;
  if (method === 'none') return null;
  return WORK_HOURS_CONFIG.DAYS_PER_MONTH;
}

function dayNumber(dateKey) {
  return Math.round(new Date(`${dateKey}T00:00:00.000Z`).getTime() / MS_PER_DAY);
}

/**
 * @param {Object} employee - 需要 status 與 appointment（沒有這些欄位時視為整月在職）
 * @param {String|Date} month - 薪資月份（該月第一天）
 * @param {Object} options.scheduledKeys - 這位員工本月有班表的日期（YYYY-MM-DD），用來判斷沒填離職日的離職員工、留職停薪
 * @param {String} options.method - 比例的算法 'days30'（預設）、'calendarDays'、'none'（見檔案開頭）；不認得的值用預設
 * @returns {{ employed, ratio, employedDays, daysInMonth, startKey, endKey, reason, method, basisDays }}
 *   ratio：本薪要乘上的比例。整月在職是 1；月中到職或離職依 method（days30 是 在職日曆天數 / 30、最多 1）；整月不在職是 0。
 *   reason：null（整月在職）、'partial_month'、'before_hire'、'after_resignation'、'leave_of_absence'。
 *   method：套用的算法；basisDays：分母天數（days30 是 30、calendarDays 是當月天數、none 是 null）。
 */
export function resolveMonthlyEmployment(employee, month, { scheduledKeys = [], method: requestedMethod } = {}) {
  const method = PRORATION_METHOD_KEYS.includes(requestedMethod) ? requestedMethod : DEFAULT_PRORATION_METHOD;
  const parsed = month instanceof Date ? month : new Date(month);
  const year = parsed.getUTCFullYear();
  const monthIndex = parsed.getUTCMonth();
  const monthStartKey = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
  const monthEndKey = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
  const daysInMonth = dayNumber(monthEndKey) - dayNumber(monthStartKey) + 1;
  const basisDays = prorationBasisDays(method, daysInMonth);
  const full = { employed: true, ratio: 1, employedDays: daysInMonth, daysInMonth, startKey: monthStartKey, endKey: monthEndKey, reason: null, method, basisDays };
  if (Number.isNaN(parsed.getTime())) return { ...full, daysInMonth: 0, employedDays: 0, startKey: '', endKey: '', basisDays: method === 'none' ? null : 0 };
  const none = (reason) => ({ employed: false, ratio: 0, employedDays: 0, daysInMonth, startKey: '', endKey: '', reason, method, basisDays });

  const appointment = employee?.appointment || {};
  const status = String(employee?.status || '');
  const monthKeys = (scheduledKeys || []).filter((key) => key >= monthStartKey && key <= monthEndKey).sort();

  if (status === '留職停薪' && !monthKeys.length) return none('leave_of_absence');

  const hireKey = appointment.hireDate ? toTaipeiDateKey(appointment.hireDate) : null;
  if (hireKey && hireKey > monthEndKey) return none('before_hire');

  let endKey = monthEndKey;
  if (status === '離職員工') {
    const lastKey = toTaipeiDateKey(appointment.resignationDate)
      || toTaipeiDateKey(appointment.dismissalDate)
      || monthKeys[monthKeys.length - 1]
      || '';
    if (!lastKey || lastKey < monthStartKey) return none('after_resignation');
    if (lastKey < endKey) endKey = lastKey;
  }
  const startKey = hireKey && hireKey > monthStartKey ? hireKey : monthStartKey;
  if (startKey > endKey) return none(hireKey && hireKey > endKey ? 'before_hire' : 'after_resignation');

  const employedDays = dayNumber(endKey) - dayNumber(startKey) + 1;
  if (employedDays >= daysInMonth) return full;
  return {
    employed: true,
    ratio: basisDays === null ? 1 : Math.min(employedDays, basisDays) / basisDays,
    employedDays,
    daysInMonth,
    startKey,
    endKey,
    reason: 'partial_month',
    method,
    basisDays,
  };
}

export default { resolveMonthlyEmployment, PRORATION_METHOD_KEYS, DEFAULT_PRORATION_METHOD };
