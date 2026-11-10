// 薪資月份對應的時間範圍（純函式）。薪資月份（YYYY-MM-01）一律以台灣時間的整個月計算：
// 例如 2026-07 是 [2026-06-30T16:00:00.000Z, 2026-07-31T16:00:00.000Z)，不是 UTC 的 7 月。
import { TAIPEI_OFFSET_MS } from './taipeiTime.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 把薪資月份整理成 'YYYY-MM-01'：接受 'YYYY-MM'、'YYYY-MM-01' 與該月第一天的 ISO 字串或 Date，其餘回傳 null。
 * 月中的日期（例如 2026-10-15）不接受：薪資的計算範圍、薪資記錄的月份都以每月第一天為準，
 * 月中的日期會算成「15 日到下個月 15 日」，存下來的記錄在薪資總覽也查不到。
 */
export function normalizePayrollMonth(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()) || value.getUTCDate() !== 1) return null;
    return `${value.toISOString().slice(0, 7)}-01`;
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01(?:T00:00:00(?:\.000)?Z)?)?$/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-01` : null;
}

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

export default { normalizePayrollMonth, payrollMonthRange, approvedInMonthFilter };
