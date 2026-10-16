// 請假「時數」的共用小工具（純函式，不碰資料庫）。
// 系統內請假一律以「小時」為單位儲存與計算；天數只是時數 / 8 的換算顯示，不另外儲存。
import { splitLeaveByDay } from './leaveDuration.js'

// 1 天 = 8 小時：只用在「換算顯示」與舊資料（天數欄位、特休天數）轉成時數；與薪資用的 WORK_HOURS_CONFIG.HOURS_PER_DAY 一致
export const LEAVE_DAY_EQUIVALENT_HOURS = 8
// 請假時數的最小單位（小時）：0.5 小時的倍數
export const DEFAULT_MIN_UNIT_HOURS = 0.5
// 單日最多可請的時數（表單的每日上限；管理員可在「請假與加班設定」調整，例如 12 小時輪班）
export const DEFAULT_MAX_HOURS_PER_DAY = 8
// 單張假單時數的合理上限（366 天 x 8 小時，超過視為填錯，避免一個誤填就把餘額清空）
export const MAX_LEAVE_REQUEST_HOURS = 366 * LEAVE_DAY_EQUIVALENT_HOURS

/** 小時數四捨五入到 digits 位（預設 4 位，足以精確表示 0.25 的倍數） */
export function roundHours(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

/** 時數換算成天數（只用於顯示；預設取到小數 2 位） */
export function hoursToDays(hours, dayHours = LEAVE_DAY_EQUIVALENT_HOURS, digits = 2) {
  const number = Number(hours)
  if (!Number.isFinite(number)) return 0
  return roundHours(number / dayHours, digits)
}

/** 天數換算成時數（舊資料的「天數」欄位、特休天數用） */
export function daysToHours(days, dayHours = LEAVE_DAY_EQUIVALENT_HOURS) {
  const number = Number(days)
  if (!Number.isFinite(number)) return 0
  return roundHours(number * dayHours)
}

/** 「時數」欄位填的正數；沒填、不是數字或不是正數回傳 null */
export function parseLeaveHours(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  if (typeof rawValue === 'boolean') return null
  const hours = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
  return Number.isFinite(hours) && hours > 0 ? hours : null
}

/** 欄位有沒有填（0 與 false 算有填；空字串、只有空白、null、undefined 不算） */
export function isLeaveHoursFilled(rawValue) {
  if (rawValue === undefined || rawValue === null) return false
  if (typeof rawValue === 'string') return rawValue.trim() !== ''
  return true
}

/** hours 是否剛好是 step 的整數倍（容許浮點誤差；step 預設 0.5） */
export function isMultipleOfStep(hours, step = DEFAULT_MIN_UNIT_HOURS) {
  const unit = Number(step)
  const number = Number(hours)
  if (!Number.isFinite(number) || !(unit > 0)) return false
  const ratio = number / unit
  return Math.abs(ratio - Math.round(ratio)) < 1e-6
}

/**
 * 一段請假區間（utils/leaveDuration.parseLeaveInterval 的結果）最多能容納幾小時：
 * 每個台灣日曆日最多 maxHoursPerDay 小時；整天的區間每天都算滿，有時分的區間只算實際涵蓋的時數。
 * 區間無法判讀或結束早於開始回傳 0。
 */
export function maxHoursOfInterval(interval, maxHoursPerDay = DEFAULT_MAX_HOURS_PER_DAY, dayCeilings = null) {
  if (!interval || interval.reversed) return 0
  const ceilings = dayCeilings instanceof Map ? dayCeilings : null
  if (!ceilings || ceilings.size === 0) {
    const total = splitLeaveByDay(interval, { hoursPerDay: maxHoursPerDay })
      .reduce((sum, item) => sum + item.hours, 0)
    return roundHours(total)
  }
  // 某幾天有比每日上限更長的班（例如排了 12 小時班）：那幾天的上限放寬成班別的時數
  const ceilingOf = (dateKey) => Math.max(maxHoursPerDay, Number(ceilings.get(dateKey)) || 0)
  const total = splitLeaveByDay(interval, { hoursPerDay: 24 })
    .reduce((sum, item) => sum + (interval.allDay ? ceilingOf(item.dateKey) : Math.min(item.hours, ceilingOf(item.dateKey))), 0)
  return roundHours(total)
}

/** 給訊息用的時數文字：整數不帶小數（40 小時、7.5 小時） */
export function formatHoursText(hours) {
  const number = Number(hours)
  if (!Number.isFinite(number)) return `${hours} 小時`
  return `${Number(roundHours(number, 2).toFixed(2))} 小時`
}

/** 給訊息用：「40 小時（5 天）」；不是整天時是「44 小時（5.5 天）」 */
export function formatHoursWithDays(hours, dayHours = LEAVE_DAY_EQUIVALENT_HOURS) {
  const days = hoursToDays(hours, dayHours)
  return `${formatHoursText(hours)}（${Number(days.toFixed(2))} 天）`
}

export default {
  LEAVE_DAY_EQUIVALENT_HOURS,
  DEFAULT_MIN_UNIT_HOURS,
  DEFAULT_MAX_HOURS_PER_DAY,
  MAX_LEAVE_REQUEST_HOURS,
  roundHours,
  hoursToDays,
  daysToHours,
  parseLeaveHours,
  isLeaveHoursFilled,
  isMultipleOfStep,
  maxHoursOfInterval,
  formatHoursText,
  formatHoursWithDays,
}
