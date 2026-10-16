// 請假單的「假別辨識」與「時數／天數計算」。簽核通過後的特休扣減、送出時的餘額檢查、
// 核准後撤回的返還、特休使用紀錄、假別餘額都共用這裡，數字才會一致。
// 請假的數量以「小時」為單位（computeLeaveRequestHours）；computeLeaveRequestDays 只是時數 / 8 的天數換算。
// 純函式，不碰資料庫。日期一律以台灣時間判斷「哪一天」（見 utils/taipeiTime.js）。
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js'
import { ANNUAL_LEAVE_TYPE_ALIASES } from '../config/leavePolicyConfig.js'
import { computeLeaveDuration, parseLeaveInterval } from '../utils/leaveDuration.js'
import { MAX_LEAVE_REQUEST_HOURS, parseLeaveHours, roundHours } from '../utils/leaveHours.js'
import { inclusiveTaipeiDayCount, toTaipeiDateKey } from '../utils/taipeiTime.js'

export const ANNUAL_LEAVE_TYPES = ['特休', '特休假'] // 特休假別類型常數
// 單張假單天數的合理上限（超過視為填錯，避免一個誤填就把餘額清空）
export const MAX_LEAVE_REQUEST_DAYS = 366
export { MAX_LEAVE_REQUEST_HOURS }
// 沒有任何數量資訊的舊假單，沿用舊行為算 1 天 = 8 小時
const DEFAULT_LEAVE_HOURS = WORK_HOURS_CONFIG.HOURS_PER_DAY

// 假別名稱比對用：全形轉半形、轉小寫、去掉空白與括號
function normalizeTypeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s()[\]]/g, '')
}
const ANNUAL_ALIAS_KEYS = ANNUAL_LEAVE_TYPE_ALIASES.map(normalizeTypeName)

const DATE_ONLY_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/

/* 假別欄位的值可能是名稱字串、{ label, value } 物件或陣列；回傳所有可用來辨識假別的名稱（值本身與選項對應的標籤） */
export function collectLeaveTypeNames(rawValue, typeOptions) {
  const labelByValue = new Map((typeOptions || []).map(opt => [String(opt.value), opt.label]))
  const names = new Set()
  const add = (candidate) => {
    if (candidate === undefined || candidate === null) return
    const text = String(candidate).trim()
    if (text) names.add(text)
  }
  const visit = (item) => {
    if (Array.isArray(item)) {
      item.forEach(visit)
    } else if (item && typeof item === 'object') {
      add(item.label)
      add(item.name)
      add(item.value)
      if (item.value !== undefined && item.value !== null) add(labelByValue.get(String(item.value)))
    } else {
      add(item)
      if (item !== undefined && item !== null) add(labelByValue.get(String(item)))
    }
  }
  visit(rawValue)
  return [...names]
}

// 特休：名稱要完全相同（忽略空白與全半形）才算，「特休」「特休假」「特別休假」三種寫法；名稱只是「包含」特休的不算（與特休統計報表一致）。
// 與假別餘額（leavePolicyService.matchLeaveType）使用同一份名稱清單、同樣只認完全相同，顯示的餘額與實際扣減的假別不會分岔
export function isAnnualLeaveType(rawValue, typeOptions) {
  return collectLeaveTypeNames(rawValue, typeOptions).some(name => ANNUAL_ALIAS_KEYS.includes(normalizeTypeName(name)))
}

/* 「天數」欄位填的正數（可能是 0.5 天）；沒填或不是正數回傳 null */
export function parseLeaveDays(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  const days = Number(rawValue)
  return Number.isFinite(days) && days > 0 ? days : null
}

/**
 * 假單的請假時數（特休餘額檢查、核准後扣減、返還、假別餘額共用；有開始／結束時間時的換算與薪資、報表是同一個函式：utils/leaveDuration）：
 * 1. 表單有「時數」欄位且填了正數 → 以它為準（請假的單位是小時，可填 4.5）。
 * 2. 舊表單的「天數」欄位填了正數 → 天數 x 8 小時（可填 0.5 天）。
 * 3. 否則由開始／結束時間推算（台灣時間）：整天的日期含頭尾算日曆日（每天 8 小時）；有時分的請假只算實際時數
 *    （同一天 09:00-13:00 是 4 小時），單日最多 8 小時（09:00-18:00 含午休也是 8 小時）。
 *    跨日時每一天都照日曆日算，不會跳過週末與國定假日（與薪資、報表一致）。
 * 4. 都沒有時沿用舊行為：表單資料的 hours / days，再不行就 1 天 = 8 小時。
 * invalidRange：有開始與結束，但結束早於開始（無法推算）。
 * 回傳 { hours, days, source, invalidRange }；source 是 hours-field / days-field / dates / legacy / default，days 只是 hours / 8 的換算。
 */
export function computeLeaveRequestHours({ formData, leaveFields } = {}) {
  const data = formData && typeof formData === 'object' ? formData : {}
  const fields = leaveFields || {}
  const hoursPerDay = WORK_HOURS_CONFIG.HOURS_PER_DAY
  const startValue = fields.startId ? data[fields.startId] : undefined
  const endValue = fields.endId ? data[fields.endId] : undefined

  const filledHours = fields.hoursId ? parseLeaveHours(data[fields.hoursId]) : null
  if (filledHours !== null) {
    let invalidRange = false
    if (startValue && endValue) {
      const interval = parseLeaveInterval(startValue, endValue)
      invalidRange = Boolean(interval?.reversed)
    }
    return { hours: roundHours(filledHours), days: roundHours(filledHours / hoursPerDay), source: 'hours-field', invalidRange }
  }

  const filledDays = fields.daysId ? parseLeaveDays(data[fields.daysId]) : null
  if (filledDays !== null) {
    return { hours: roundHours(filledDays * hoursPerDay), days: filledDays, source: 'days-field', invalidRange: false }
  }

  let invalidRange = false
  if (startValue && endValue) {
    const duration = computeLeaveDuration({ startValue, endValue, hoursPerDay })
    if (duration.source === 'dates' && duration.hours > 0) {
      return { hours: duration.hours, days: duration.days, source: 'dates', invalidRange: false }
    }
    // 開始與結束是同一個時間點（長度為 0）：沿用日曆日計算，同一天算 1 天
    const count = inclusiveTaipeiDayCount(startValue, endValue)
    if (count) return { hours: count * hoursPerDay, days: count, source: 'dates', invalidRange: false }
    invalidRange = Boolean(toTaipeiDateKey(startValue) && toTaipeiDateKey(endValue))
  }

  const legacyHours = parseLeaveHours(data.hours)
  if (legacyHours !== null) {
    return { hours: roundHours(legacyHours), days: roundHours(legacyHours / hoursPerDay), source: 'legacy', invalidRange }
  }
  const legacyDays = parseLeaveDays(data.days ?? data.duration)
  if (legacyDays !== null) {
    return { hours: roundHours(legacyDays * hoursPerDay), days: legacyDays, source: 'legacy', invalidRange }
  }
  return { hours: DEFAULT_LEAVE_HOURS, days: roundHours(DEFAULT_LEAVE_HOURS / hoursPerDay), source: 'default', invalidRange }
}

const DAYS_SOURCE_NAMES = { 'hours-field': 'hours', 'days-field': 'field', dates: 'dates', legacy: 'legacy', default: 'default' }

/**
 * 假單天數（computeLeaveRequestHours 的天數換算，舊呼叫端用）。回傳 { days, source, invalidRange }；
 * source：hours（時數欄位）、field（天數欄位）、dates（日期推算）、legacy、default。
 */
export function computeLeaveRequestDays({ formData, leaveFields } = {}) {
  const result = computeLeaveRequestHours({ formData, leaveFields })
  return {
    days: result.days,
    source: DAYS_SOURCE_NAMES[result.source] || result.source,
    invalidRange: result.invalidRange,
  }
}

/**
 * 假期開始的時間點：純日期字串（2026-06-19）視為台灣當天 00:00，其餘照一般時間解析。
 * 無法解析回傳 null。
 */
export function leaveStartInstant(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    const key = toTaipeiDateKey(value)
    return key ? new Date(`${key}T00:00:00+08:00`) : null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export default {
  ANNUAL_LEAVE_TYPES,
  MAX_LEAVE_REQUEST_DAYS,
  MAX_LEAVE_REQUEST_HOURS,
  collectLeaveTypeNames,
  isAnnualLeaveType,
  parseLeaveDays,
  computeLeaveRequestHours,
  computeLeaveRequestDays,
  leaveStartInstant,
}
