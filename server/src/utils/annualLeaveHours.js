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

/**
 * 解讀舊資料的「年度特休總天數 / 已使用天數」。
 * 法定特休最多 30 天，公司再給也到不了 40 天，所以任何一個數字大於 40 就不可能是天數（客戶匯入的 170、219 其實是小時），
 * 原樣當成小時；否則當成天數，乘上 8 換成小時。啟動時的資料搬移與「尚未搬移」的資料讀取共用這個函式，兩邊結果一致。
 * @returns {{ totalHours: number, usedHours: number, unitSource: 'migrated-days' | 'migrated-hours' }}
 */
export function interpretLegacyAnnualLeave(totalDays, usedDays) {
  const total = nonNegative(totalDays)
  const used = nonNegative(usedDays)
  if (Math.max(total, used) > LEGACY_ANNUAL_LEAVE_DAYS_MAX) {
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
 * 有 totalHours 就用時數欄位（usedHours 沒有算 0）；沒有就是還沒搬移的舊資料，用 interpretLegacyAnnualLeave 解讀。
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

export default { interpretLegacyAnnualLeave, isLegacyAnnualLeave, readAnnualLeaveHours, presentAnnualLeave }
