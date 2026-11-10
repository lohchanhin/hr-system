/**
 * 日期格式化工具
 * 提供統一的日期格式化方法；一律以台灣時間顯示（不受使用者裝置的時區影響）。
 * 畫面上的日期時間格式：YYYY/MM/DD、HH:mm（規範見 docs/ui-guidelines.md）。
 */
import { getTimezone } from './timeWindow'

const WEEKDAY_LABELS = Object.freeze(['日', '一', '二', '三', '四', '五', '六'])
const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })

// Intl.DateTimeFormat 建立成本高（打卡頁每秒更新時鐘），每個時區只建一次
const partsFormatters = new Map()

function getPartsFormatter(timeZone) {
  let formatter = partsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23'
    })
    partsFormatters.set(timeZone, formatter)
  }
  return formatter
}

function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * 取得某個時間點在台灣時間的各個欄位（都是補零後的字串）。
 * @param {string|number|Date} value
 * @returns {{year:string,month:string,day:string,hour:string,minute:string,second:string,weekday:string}|null}
 */
export function getTaiwanParts(value, timeZone = getTimezone()) {
  const date = toValidDate(value)
  if (!date) return null
  const parts = {}
  getPartsFormatter(timeZone).formatToParts(date).forEach(part => {
    if (part.type !== 'literal') parts[part.type] = part.value
  })
  if (!parts.year || !parts.month || !parts.day) return null
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // 部分 ICU 版本會把午夜寫成 24:00
    hour: parts.hour === '24' ? '00' : parts.hour,
    minute: parts.minute,
    second: parts.second,
    weekday: WEEKDAY_LABELS[WEEKDAY_INDEX[parts.weekday]] || ''
  }
}

/** 台灣日期的鍵值 YYYY-MM-DD（用來比較「是不是同一天」），無效時回傳空字串 */
export function taiwanDateKey(value, timeZone = getTimezone()) {
  const parts = getTaiwanParts(value, timeZone)
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : ''
}

/** 台灣日期 YYYY/MM/DD */
export function formatTaiwanDate(value, fallback = '') {
  const parts = getTaiwanParts(value)
  return parts ? `${parts.year}/${parts.month}/${parts.day}` : fallback
}

/** 台灣時間 HH:mm（seconds 為 true 時 HH:mm:ss，只用在需要秒數的地方，例如即時時鐘） */
export function formatTaiwanTime(value, { seconds = false, fallback = '' } = {}) {
  const parts = getTaiwanParts(value)
  if (!parts) return fallback
  return seconds
    ? `${parts.hour}:${parts.minute}:${parts.second}`
    : `${parts.hour}:${parts.minute}`
}

/** 台灣日期時間 YYYY/MM/DD HH:mm */
export function formatTaiwanDateTime(value, { seconds = false, fallback = '' } = {}) {
  const parts = getTaiwanParts(value)
  if (!parts) return fallback
  return `${parts.year}/${parts.month}/${parts.day} ${formatTaiwanTime(value, { seconds })}`
}

/** 台灣時間的星期（日、一…六） */
export function taiwanWeekday(value) {
  return getTaiwanParts(value)?.weekday || ''
}

/**
 * 班表日期的鍵值 YYYY-MM-DD。
 * 班表日期是「哪一天」而不是時間點：後端回傳 2026/11/02 或以 UTC 午夜儲存（2026-11-02T00:00:00.000Z），
 * 直接取年月日，不做時區換算（用裝置時區換算會在台灣以外的時區差一天）。
 */
export function scheduleDateKey(value) {
  if (value === null || value === undefined || value === '') return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return value.toISOString().slice(0, 10)
  }
  const match = String(value).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!match) return ''
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

/** 班表日期 YYYY/MM/DD */
export function formatScheduleDate(value, fallback = '') {
  const key = scheduleDateKey(value)
  return key ? key.replace(/-/g, '/') : fallback
}

/** 日期鍵值（YYYY-MM-DD）是星期幾（日、一…六） */
export function weekdayOfDateKey(key) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return WEEKDAY_LABELS[date.getUTCDay()] || ''
}

/** 日期鍵值（YYYY-MM-DD）加減天數 */
export function shiftDateKey(key, days) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return date.toISOString().slice(0, 10)
}

/**
 * 格式化日期為 YYYY-MM-DD 格式（台灣時間）
 * @param {string|Date} dateString - 日期字串或日期物件
 * @returns {string} 格式化後的日期字串，格式為 YYYY-MM-DD，錯誤時返回 '-'
 */
export function formatDate(dateString) {
  return taiwanDateKey(dateString) || '-'
}

/**
 * 格式化時間為 HH:MM 格式（台灣時間）
 * @param {string} isoString - ISO 格式的時間字串
 * @returns {string} 格式化後的時間字串，格式為 HH:MM，錯誤時返回 '-'
 */
export function formatTime(isoString) {
  return formatTaiwanTime(isoString, { fallback: '-' })
}

/**
 * 格式化日期時間為 YYYY-MM-DD HH:MM 格式（台灣時間）
 * @param {string|Date} dateString - 日期字串或日期物件
 * @returns {string} 格式化後的日期時間字串，錯誤時返回 '-'
 */
export function formatDateTime(dateString) {
  const date = taiwanDateKey(dateString)
  return date ? `${date} ${formatTime(dateString)}` : '-'
}
