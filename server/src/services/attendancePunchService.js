import {
  computeActionWindow,
  computeShiftSpan,
  getTimezone,
  normalizeActionBuffers,
} from '../utils/timeWindow.js'

// 打卡來源：線上打卡、指紋（考勤機）匯入、手動補登；舊資料沒有來源欄位，一律視為 legacy
export const ATTENDANCE_SOURCES = Object.freeze(['online', 'import', 'manual', 'legacy'])

export const ATTENDANCE_SOURCE_LABELS = Object.freeze({
  online: '線上',
  import: '指紋匯入',
  manual: '手動補登',
  legacy: '未標示',
})

const MS_PER_MINUTE = 60 * 1000

export function resolveAttendanceSource(record) {
  const source = record?.source
  return ATTENDANCE_SOURCES.includes(source) ? source : 'legacy'
}

function toEmployeeId(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value._id !== undefined) return String(value._id)
  return String(value)
}

function toTime(record) {
  const time = new Date(record?.timestamp).getTime()
  return Number.isFinite(time) ? time : NaN
}

function isWithin(time, window) {
  return Boolean(window) && time >= window.start.getTime() && time <= window.end.getTime()
}

/**
 * 「同一位員工、同一個動作、同一分鐘」視為同一筆打卡，匯入時用來略過已經有的打卡（不論來源）。
 * 時間無法解析時回傳空字串（呼叫端不比對）。
 */
export function punchMinuteKey(employee, action, timestamp) {
  const time = new Date(timestamp).getTime()
  const employeeId = toEmployeeId(employee)
  if (!Number.isFinite(time) || !employeeId || !action) return ''
  return `${employeeId}|${action}|${Math.floor(time / MS_PER_MINUTE)}`
}

/** 依員工分組（只留上下班打卡），每位員工的打卡依時間排序 */
export function groupPunchesByEmployee(records = []) {
  const map = new Map()
  for (const record of records || []) {
    if (record?.action !== 'clockIn' && record?.action !== 'clockOut') continue
    if (!Number.isFinite(toTime(record))) continue
    const employeeId = toEmployeeId(record.employee)
    if (!employeeId) continue
    if (!map.has(employeeId)) map.set(employeeId, [])
    map.get(employeeId).push(record)
  }
  map.forEach((list) => list.sort((a, b) => toTime(a) - toTime(b)))
  return map
}

/**
 * 找出某一班的上下班打卡。線上打卡、指紋匯入、舊資料放在一起看，不分來源：
 * 簽到取「簽到時段」內最早的一筆，簽退取「簽退時段」內、晚於簽到的最晚一筆，
 * 所以線上簽到配指紋簽退、或兩邊都打了卡，都會互相補齊，不會互相蓋掉。
 * 時段與線上打卡、遲到早退判斷相同：班別時間以考勤時區（預設台灣時間）計算，再加上「打卡緩衝」設定。
 * 回傳 { span, clockIn, clockOut }（找不到的打卡為 null，回傳的是原本的打卡資料）；班別沒有時間資訊時回傳 null。
 */
export function matchShiftPunches({ records = [], scheduleDate, shift, actionBuffers, timeZone = getTimezone() }) {
  const span = computeShiftSpan(scheduleDate, shift, timeZone)
  if (!span) return null
  const buffers = normalizeActionBuffers(actionBuffers)
  const clockInWindow = computeActionWindow('clockIn', span.start, span.end, buffers)
  const clockOutWindow = computeActionWindow('clockOut', span.start, span.end, buffers)

  let clockIn = null
  for (const record of records || []) {
    if (record?.action !== 'clockIn') continue
    const time = toTime(record)
    if (!isWithin(time, clockInWindow)) continue
    if (!clockIn || time < toTime(clockIn)) clockIn = record
  }

  const clockInTime = clockIn ? toTime(clockIn) : Number.NEGATIVE_INFINITY
  let clockOut = null
  for (const record of records || []) {
    if (record?.action !== 'clockOut') continue
    const time = toTime(record)
    if (!isWithin(time, clockOutWindow) || time <= clockInTime) continue
    if (!clockOut || time > toTime(clockOut)) clockOut = record
  }

  return { span, clockIn, clockOut }
}

/** 找出某個時間點、某個動作的打卡來源（同一時間有多筆時取第一筆） */
export function findPunchSource(records = [], action, time) {
  const target = new Date(time).getTime()
  if (!Number.isFinite(target)) return null
  const record = (records || []).find((item) => item?.action === action && toTime(item) === target)
  return record ? resolveAttendanceSource(record) : null
}

/** 考勤時區的 HH:mm（報表顯示用） */
export function formatLocalTime(value, timeZone = getTimezone()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  const hour = Number(parts.hour) === 24 ? '00' : String(parts.hour).padStart(2, '0')
  return `${hour}:${String(parts.minute).padStart(2, '0')}`
}
