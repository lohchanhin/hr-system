// 請假單的「假別辨識」與「天數計算」。簽核通過後的特休扣減、送出時的餘額檢查、
// 核准後撤回的返還、特休使用紀錄都共用這裡，天數才會一致。
// 純函式，不碰資料庫。日期一律以台灣時間判斷「哪一天」（見 utils/taipeiTime.js）。
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js'
import { computeLeaveDuration } from '../utils/leaveDuration.js'
import { inclusiveTaipeiDayCount, toTaipeiDateKey } from '../utils/taipeiTime.js'

export const ANNUAL_LEAVE_TYPES = ['特休', '特休假'] // 特休假別類型常數
// 單張假單天數的合理上限（超過視為填錯，避免一個誤填就把餘額清空）
export const MAX_LEAVE_REQUEST_DAYS = 366

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

export function isAnnualLeaveType(rawValue, typeOptions) {
  return collectLeaveTypeNames(rawValue, typeOptions).some(name => ANNUAL_LEAVE_TYPES.includes(name))
}

/* 「天數」欄位填的正數（可能是 0.5 天）；沒填或不是正數回傳 null */
export function parseLeaveDays(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  const days = Number(rawValue)
  return Number.isFinite(days) && days > 0 ? days : null
}

/**
 * 假單天數（特休餘額檢查、核准後扣減、返還共用；有開始／結束時間時的換算與薪資、報表是同一個函式：utils/leaveDuration）：
 * 1. 表單有「天數」欄位且填了正數 → 以它為準（可填 0.5）。
 * 2. 否則由開始／結束時間推算（台灣時間）：整天的日期含頭尾算日曆日；有時分的請假只算實際時數
 *    （同一天 09:00-13:00 的 4 小時 = 0.5 天），單日最多 8 小時（09:00-18:00 含午休也是 1 天）。
 *    跨日時每一天都照日曆日算，不會跳過週末與國定假日（與薪資、報表一致）。
 * 3. 都沒有時沿用舊行為：表單資料的 days，再不行就 1 天。
 * invalidRange：有開始與結束，但結束日期早於開始日期（無法推算）。
 */
export function computeLeaveRequestDays({ formData, leaveFields } = {}) {
  const data = formData && typeof formData === 'object' ? formData : {}
  const fields = leaveFields || {}
  const filledDays = fields.daysId ? parseLeaveDays(data[fields.daysId]) : null
  if (filledDays !== null) return { days: filledDays, source: 'field', invalidRange: false }

  const startValue = fields.startId ? data[fields.startId] : undefined
  const endValue = fields.endId ? data[fields.endId] : undefined
  let invalidRange = false
  if (startValue && endValue) {
    const duration = computeLeaveDuration({
      startValue,
      endValue,
      hoursPerDay: WORK_HOURS_CONFIG.HOURS_PER_DAY,
    })
    if (duration.source === 'dates' && duration.days > 0) {
      return { days: duration.days, source: 'dates', invalidRange: false }
    }
    // 開始與結束是同一個時間點（長度為 0）：沿用日曆日計算，同一天算 1 天
    const count = inclusiveTaipeiDayCount(startValue, endValue)
    if (count) return { days: count, source: 'dates', invalidRange: false }
    invalidRange = Boolean(toTaipeiDateKey(startValue) && toTaipeiDateKey(endValue))
  }

  const legacyDays = parseLeaveDays(data.days)
  if (legacyDays !== null) return { days: legacyDays, source: 'legacy', invalidRange }
  return { days: 1, source: 'default', invalidRange }
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
  collectLeaveTypeNames,
  isAnnualLeaveType,
  parseLeaveDays,
  computeLeaveRequestDays,
  leaveStartInstant,
}
