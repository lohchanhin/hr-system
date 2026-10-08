// 薪資月份對應的時間範圍（純函式）。薪資月份（YYYY-MM-01）一律以台灣時間的整個月計算：
// 例如 2026-07 是 [2026-06-30T16:00:00.000Z, 2026-07-31T16:00:00.000Z)，不是 UTC 的 7 月。
import { TAIPEI_OFFSET_MS } from './taipeiTime.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 薪資月份的台灣時間範圍 { start, end }（含頭不含尾的 Date），月份無法解析時回傳 null。 */
export function payrollMonthRange(month) {
  const parsed = month instanceof Date ? month : new Date(month);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const monthIndex = parsed.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, monthIndex, 1) - TAIPEI_OFFSET_MS),
    end: new Date(Date.UTC(year, monthIndex + 1, 1) - TAIPEI_OFFSET_MS),
  };
}

/**
 * 查「這個月核准完成的單」的資料庫條件，薪資的獎金申請用：依核准完成的時間歸屬月份，不看送簽（建立）時間。
 * 核准完成的時間是流程紀錄的 finish，資料庫只能粗篩：建立時間早於月底、最後更新時間不早於月初前一天
 * （更新時間一定不早於完成時間），精確的月份由 aggregateBonusFromApprovals 的 range 判斷。
 */
export function approvedInMonthFilter(range) {
  return {
    status: 'approved',
    createdAt: { $lt: range.end },
    updatedAt: { $gte: new Date(range.start.getTime() - MS_PER_DAY) },
  };
}

export default { payrollMonthRange, approvedInMonthFilter };
