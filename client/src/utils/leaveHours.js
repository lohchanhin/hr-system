// 請假「時數」的前端換算：依起訖時間估出可請的時數上限與建議時數，讓申請人不必自己算。
// 規則與伺服器完全一致（server/src/utils/leaveDuration.js 的 parseLeaveInterval + splitLeaveByDay）：
// 日期一律以台灣時間（UTC+8，沒有日光節約）判斷是哪一天；整天的區間每天最多 maxHoursPerDay 小時，
// 有時分的區間只算實際涵蓋的時數，單日最多 maxHoursPerDay。伺服器仍是最後的把關（送出時會再檢查一次）。

export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR
// 一段請假最多展開的天數（防呆，與伺服器相同）
const MAX_LEAVE_DAYS = 3700
const DATE_ONLY_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/

export const DEFAULT_MAX_HOURS_PER_DAY = 8
export const DEFAULT_MIN_UNIT_HOURS = 0.5
export const LEAVE_DAY_HOURS = 8

function pad(value) {
  return String(value).padStart(2, '0')
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

// 台灣日期鍵 'YYYY-MM-DD'；純日期字串視為當天，不做時區位移；無法解析回傳 null
export function toTaipeiDateKey(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string') {
    const match = DATE_ONLY_PATTERN.exec(value.trim())
    if (match) {
      const key = `${match[1]}-${pad(match[2])}-${pad(match[3])}`
      const check = new Date(`${key}T00:00:00.000Z`)
      return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== key ? null : key
    }
  }
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value).trim())
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10)
}

function dateKeyToUtcMidnightMs(dateKey) {
  const ms = new Date(`${dateKey}T00:00:00.000Z`).getTime()
  return Number.isNaN(ms) ? null : ms
}

// 某個台灣日期鍵當天 00:00（台灣時間）的時間點（毫秒）
function taipeiMidnightMs(dateKey) {
  const midnight = dateKeyToUtcMidnightMs(dateKey)
  return midnight === null ? null : midnight - TAIPEI_OFFSET_MS
}

function addDaysToKey(dateKey, days) {
  return new Date(dateKeyToUtcMidnightMs(dateKey) + days * MS_PER_DAY).toISOString().slice(0, 10)
}

function toInstantInfo(value) {
  const dateKey = toTaipeiDateKey(value)
  if (!dateKey) return null
  const midnightMs = taipeiMidnightMs(dateKey)
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    return { dateKey, ms: midnightMs, atMidnight: true }
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(ms)) return null
  return { dateKey, ms, atMidnight: ms === midnightMs }
}

/** 把開始、結束整理成一段請假區間；無法判讀回傳 null（與伺服器的 parseLeaveInterval 相同）。 */
export function parseLeaveInterval(startValue, endValue, { startType, endType } = {}) {
  const start = toInstantInfo(startValue)
  const end = toInstantInfo(endValue)
  if (!start || !end) return null

  const typedAsDate = startType === 'date' && endType === 'date'
  const allDay = typedAsDate || (start.atMidnight && end.atMidnight)
  if (allDay) {
    return {
      allDay: true,
      reversed: end.dateKey < start.dateKey,
      startKey: start.dateKey,
      endKey: end.dateKey,
      lastKey: end.dateKey,
      startMs: taipeiMidnightMs(start.dateKey),
      endMs: taipeiMidnightMs(end.dateKey) + MS_PER_DAY,
    }
  }
  const lastKey = end.ms > start.ms ? toTaipeiDateKey(new Date(end.ms - 1)) : end.dateKey
  return {
    allDay: false,
    reversed: end.ms <= start.ms,
    startKey: start.dateKey,
    endKey: end.dateKey,
    lastKey,
    startMs: start.ms,
    endMs: end.ms,
  }
}

/** 把區間拆到每個台灣日曆日：[{ dateKey, hours }]（與伺服器的 splitLeaveByDay 相同） */
export function splitLeaveByDay(interval, { hoursPerDay = DEFAULT_MAX_HOURS_PER_DAY } = {}) {
  if (!interval || interval.reversed) return []
  const result = []
  let key = interval.startKey
  for (let count = 0; count < MAX_LEAVE_DAYS && key <= interval.lastKey; count += 1) {
    if (interval.allDay) {
      result.push({ dateKey: key, hours: hoursPerDay })
    } else {
      const dayStart = taipeiMidnightMs(key)
      const covered = Math.min(interval.endMs, dayStart + MS_PER_DAY) - Math.max(interval.startMs, dayStart)
      if (covered > 0) result.push({ dateKey: key, hours: Math.min(round4(covered / MS_PER_HOUR), hoursPerDay) })
    }
    key = addDaysToKey(key, 1)
  }
  return result
}

/** 區間最多能容納幾小時（每個台灣日曆日最多 maxHoursPerDay） */
export function maxHoursOfInterval(interval, maxHoursPerDay = DEFAULT_MAX_HOURS_PER_DAY) {
  if (!interval || interval.reversed) return 0
  return round4(splitLeaveByDay(interval, { hoursPerDay: maxHoursPerDay }).reduce((sum, item) => sum + item.hours, 0))
}

/** 向下取到最小單位（預設 0.5 小時）的倍數 */
export function floorToStep(hours, step = DEFAULT_MIN_UNIT_HOURS) {
  const unit = Number(step) > 0 ? Number(step) : DEFAULT_MIN_UNIT_HOURS
  return Math.floor(round4(Number(hours) / unit)) * unit
}

/**
 * 依起訖時間估算請假時數。
 * 回傳 { valid, reversed, allDay, maxHours, suggestedHours, perDay }：
 * - valid：兩個時間都讀得懂而且結束不早於開始。
 * - maxHours：這段期間最多可請幾小時；suggestedHours：預設帶入的時數（=最多可請，取到最小單位）。
 */
export function estimateLeaveHours(startValue, endValue, {
  startType,
  endType,
  maxHoursPerDay = DEFAULT_MAX_HOURS_PER_DAY,
  minUnitHours = DEFAULT_MIN_UNIT_HOURS,
} = {}) {
  const interval = parseLeaveInterval(startValue, endValue, { startType, endType })
  if (!interval) return { valid: false, reversed: false, allDay: false, maxHours: 0, suggestedHours: 0, perDay: [] }
  if (interval.reversed) return { valid: false, reversed: true, allDay: interval.allDay, maxHours: 0, suggestedHours: 0, perDay: [] }
  const perDay = splitLeaveByDay(interval, { hoursPerDay: maxHoursPerDay })
  const maxHours = round4(perDay.reduce((sum, item) => sum + item.hours, 0))
  return {
    valid: true,
    reversed: false,
    allDay: interval.allDay,
    maxHours,
    suggestedHours: floorToStep(maxHours, minUnitHours),
    perDay,
  }
}

// 單一欄位的標籤是不是「時數」：與伺服器 utils/leaveFieldLabels 的 HOURS_LABELS 相同（全形轉半形、轉小寫、去掉空白與括號）
const HOURS_LABELS = new Set(['時數', '請假時數', '小時', '小時數', '請假小時', '請假小時數', '時數小時', '請假時數小時'])
const START_LABELS = new Set(['開始時間', '開始日期', '日期起', '起始時間', '起始日期', '請假起日', '開始'])
const END_LABELS = new Set(['結束時間', '結束日期', '日期迄', '日期訖', '終止時間', '終止日期', '請假迄日', '結束'])
const DAYS_LABELS = new Set(['天數', '請假天數', '日數', '請假日數'])

export function normalizeLeaveLabel(label) {
  return String(label ?? '').normalize('NFKC').toLowerCase().replace(/[\s()]/g, '')
}
export const isLeaveHoursLabel = (label) => HOURS_LABELS.has(normalizeLeaveLabel(label))
export const isLeaveStartLabel = (label) => START_LABELS.has(normalizeLeaveLabel(label))
export const isLeaveEndLabel = (label) => END_LABELS.has(normalizeLeaveLabel(label))
export const isLeaveDaysLabel = (label) => DAYS_LABELS.has(normalizeLeaveLabel(label))
// 「假別」或任何以「假別」開頭的標籤，例如「假別類別 (C12)」
export const isLeaveTypeLabel = (label) => normalizeLeaveLabel(label).startsWith('假別')

function pickField(fields, matchesLabel) {
  const matches = fields.filter(field => matchesLabel(field.label))
  return matches.find(field => field.is_active !== false) ?? matches[0]
}

/**
 * 從一張表單的欄位清單挑出請假用的欄位（啟用中的優先），只在請假表單上使用。
 * 回傳 { startField, endField, typeField, hoursField, daysField }，找不到的欄位為 undefined。
 */
export function pickLeaveFormFields(fields) {
  const ordered = [...(fields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return {
    startField: pickField(ordered, isLeaveStartLabel),
    endField: pickField(ordered, isLeaveEndLabel),
    typeField: pickField(ordered, label => normalizeLeaveLabel(label) === '假別') ?? pickField(ordered, isLeaveTypeLabel),
    hoursField: pickField(ordered, isLeaveHoursLabel),
    daysField: pickField(ordered, isLeaveDaysLabel),
  }
}

export default {
  estimateLeaveHours,
  parseLeaveInterval,
  splitLeaveByDay,
  maxHoursOfInterval,
  floorToStep,
  toTaipeiDateKey,
  pickLeaveFormFields,
  isLeaveHoursLabel,
}
