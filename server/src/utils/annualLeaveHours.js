// 員工特休的「時數」讀取與舊資料（天數欄位）的解讀。純函式，不碰資料庫，Employee 模型、特休服務、薪資、啟動時的資料搬移共用，
// 讀到的數字才會一致。特休以小時儲存在 annualLeave.totalHours / usedHours；舊的 totalDays / usedDays 搬移後凍結（供稽核與回復）。
import { LEGACY_ANNUAL_LEAVE_DAYS_MAX } from '../config/leavePolicyConfig.js'
import { LEAVE_DAY_EQUIVALENT_HOURS, roundHours } from './leaveHours.js'

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegative(value) {
  const number = finiteNumber(value)
  return number !== null && number > 0 ? number : 0
}

/** 一組舊的「天數」數字是不是明顯填的是小時：任何一個數字大於 40 都不可能是天數（法定特休最多 30 天，公司再給也到不了 40 天） */
export function exceedsLegacyDaysMax(totalDays, usedDays) {
  return Math.max(nonNegative(totalDays), nonNegative(usedDays)) > LEGACY_ANNUAL_LEAVE_DAYS_MAX
}

/**
 * 整份資料（資料庫裡所有員工、或匯入檔的所有列）是不是用「把小時填在天數欄位」的慣例：只要有任何一個人的數字大於 40，
 * 客戶就是把小時填進了「年度特休總天數」，同一份資料裡其他人的數字（例如 24、32、40）一樣是小時，不是天數。
 * @param {Iterable<{ totalDays?: any, usedDays?: any }>} records
 */
export function usesHoursInDaysColumn(records) {
  for (const record of records || []) {
    if (exceedsLegacyDaysMax(record?.totalDays, record?.usedDays)) return true
  }
  return false
}

/**
 * 解讀舊資料的「年度特休總天數 / 已使用天數」。
 * 單獨一個人：任何一個數字大於 40 就不可能是天數（客戶匯入的 170、219 其實是小時），原樣當成小時；否則當成天數，乘上 8 換成小時。
 * 整份資料：傳 hoursConvention（usesHoursInDaysColumn 的結果）時，這份資料的慣例是「小時填在天數欄位」，
 * 所以即使這個人的數字很小（24、32、40 都可能是小時）也原樣當成小時；兩個數字都是 0 的人沒有東西要判斷，維持 migrated-days。
 * 啟動時的資料搬移、匯入檔（整份檔案一起判斷）用整份資料的判斷；單獨讀取「尚未搬移」的文件（readAnnualLeaveHours）只能逐人判斷。
 * @returns {{ totalHours: number, usedHours: number, unitSource: 'migrated-days' | 'migrated-hours' }}
 */
export function interpretLegacyAnnualLeave(totalDays, usedDays, { hoursConvention = false } = {}) {
  const total = nonNegative(totalDays)
  const used = nonNegative(usedDays)
  const typedAsHours = Math.max(total, used) > LEGACY_ANNUAL_LEAVE_DAYS_MAX || (hoursConvention && (total > 0 || used > 0))
  if (typedAsHours) {
    return { totalHours: roundHours(total), usedHours: roundHours(used), unitSource: 'migrated-hours' }
  }
  return {
    totalHours: roundHours(total * LEAVE_DAY_EQUIVALENT_HOURS),
    usedHours: roundHours(used * LEAVE_DAY_EQUIVALENT_HOURS),
    unitSource: 'migrated-days',
  }
}

/** 這份 annualLeave 資料是不是舊格式（沒有 totalHours，數量還在天數欄位） */
export function isLegacyAnnualLeave(annualLeave) {
  return Boolean(annualLeave) && typeof annualLeave === 'object' && finiteNumber(annualLeave.totalHours) === null
}

/**
 * 員工特休的時數：{ totalHours, usedHours, remainingHours, legacy, unitSource, configured }。
 * 有 totalHours 就用時數欄位（usedHours 沒有算 0）；沒有就是還沒搬移的舊資料，用 interpretLegacyAnnualLeave 逐人解讀
 * （讀取當下沒有整份資料的資訊；啟動時的搬移會在伺服器開始服務之前完成，並以整份資料判斷）。
 * remainingHours 可能是負的（人工調低總時數後），顯示端自行決定要不要截成 0。
 * configured：有設定特休（總時數或已用時數大於 0）；匯入時沒填特休的員工視為尚未設定，送出申請時不以餘額擋下。
 */
export function readAnnualLeaveHours(annualLeave) {
  if (!annualLeave || typeof annualLeave !== 'object') {
    return { totalHours: 0, usedHours: 0, remainingHours: 0, legacy: false, unitSource: null, configured: false }
  }
  let totalHours
  let usedHours
  let legacy = false
  let unitSource = annualLeave.unitSource || null
  if (finiteNumber(annualLeave.totalHours) !== null) {
    totalHours = nonNegative(annualLeave.totalHours)
    usedHours = nonNegative(annualLeave.usedHours)
  } else {
    const legacyValues = interpretLegacyAnnualLeave(annualLeave.totalDays, annualLeave.usedDays)
    totalHours = legacyValues.totalHours
    usedHours = legacyValues.usedHours
    unitSource = unitSource || legacyValues.unitSource
    legacy = true
  }
  return {
    totalHours: roundHours(totalHours),
    usedHours: roundHours(usedHours),
    remainingHours: roundHours(totalHours - usedHours),
    legacy,
    unitSource,
    configured: totalHours > 0 || usedHours > 0,
  }
}

/**
 * 給畫面用的特休資料：原本的欄位加上時數（totalHours / usedHours / remainingHours）與剩餘天數（時數 / 8）。
 * 資料還是舊格式（沒有 totalHours）時，時數由天數欄位換算，畫面不必自己判斷單位。
 */
export function presentAnnualLeave(annualLeave) {
  if (!annualLeave || typeof annualLeave !== 'object') return annualLeave
  const hours = readAnnualLeaveHours(annualLeave)
  return {
    ...annualLeave,
    totalHours: hours.totalHours,
    usedHours: hours.usedHours,
    remainingHours: hours.remainingHours,
    remainingDays: roundHours(hours.remainingHours / LEAVE_DAY_EQUIVALENT_HOURS, 2),
    unitSource: annualLeave.unitSource ?? hours.unitSource ?? undefined,
  }
}

export default { exceedsLegacyDaysMax, usesHoursInDaysColumn, interpretLegacyAnnualLeave, isLegacyAnnualLeave, readAnnualLeaveHours, presentAnnualLeave }
