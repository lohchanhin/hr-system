// 表單日期時間一律以台灣時間（UTC+8，無日光節約）判斷「哪一天」。
// 前端日期選擇器送出的是 UTC ISO 字串（例如台灣 6/19 00:00 會變成 2026-06-18T16:00:00.000Z），
// 直接取 UTC 日期會少一天；這裡統一轉成台灣日期再比較。
export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

const DATE_ONLY_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/

function pad(value) {
  return String(value).padStart(2, '0')
}

function parseDateLike(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const fromNumber = new Date(value)
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber
  }
  const text = String(value).trim()
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * 回傳台灣日期 'YYYY-MM-DD'，無法解析時回傳 null。
 * 純日期字串（2026-06-19、2026/6/19）視為當天，不做時區位移。
 */
export function toTaipeiDateKey(value) {
  if (typeof value === 'string') {
    const match = DATE_ONLY_PATTERN.exec(value.trim())
    if (match) {
      const [, year, month, day] = match
      const key = `${year}-${pad(month)}-${pad(day)}`
      const check = new Date(`${key}T00:00:00.000Z`)
      return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== key ? null : key
    }
  }
  const date = parseDateLike(value)
  if (!date) return null
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10)
}

/** 台灣時間的日期與時分（純日期字串回傳 00:00）。 */
export function toTaipeiParts(value) {
  const dateKey = toTaipeiDateKey(value)
  if (!dateKey) return null
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    return { dateKey, hour: 0, minute: 0 }
  }
  const date = parseDateLike(value)
  const shifted = new Date(date.getTime() + TAIPEI_OFFSET_MS)
  return { dateKey, hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() }
}

/** 排班與請假資料以 UTC 午夜代表某一天，這裡把台灣日期鍵轉成同樣的表示。 */
export function dateKeyToUtcMidnight(dateKey) {
  if (!dateKey) return null
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 台灣日曆日的天數（含頭尾），結束早於開始或無法解析時回傳 null。 */
export function inclusiveTaipeiDayCount(startValue, endValue) {
  const startKey = toTaipeiDateKey(startValue)
  const endKey = toTaipeiDateKey(endValue)
  if (!startKey || !endKey) return null
  const start = dateKeyToUtcMidnight(startKey).getTime()
  const end = dateKeyToUtcMidnight(endKey).getTime()
  if (end < start) return null
  return Math.round((end - start) / MS_PER_DAY) + 1
}

/** 列出台灣日期鍵（含頭尾），結束早於開始或無法解析時回傳空陣列。 */
export function listTaipeiDateKeys(startValue, endValue, { maxDays = 400 } = {}) {
  const count = inclusiveTaipeiDayCount(startValue, endValue)
  if (!count) return []
  const startKey = toTaipeiDateKey(startValue)
  const start = dateKeyToUtcMidnight(startKey).getTime()
  const keys = []
  for (let offset = 0; offset < Math.min(count, maxDays); offset += 1) {
    keys.push(new Date(start + offset * MS_PER_DAY).toISOString().slice(0, 10))
  }
  return keys
}
