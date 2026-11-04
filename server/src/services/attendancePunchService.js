import {
  computeActionWindow,
  computeShiftSpan,
  createDateFromParts,
  getLocalDateParts,
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
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE

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

// 原本依日期比對用的日期鍵：班表日期是 UTC 午夜，打卡取 UTC 日期（台灣 08:00 到隔天 08:00 是同一個鍵）
function utcDateKey(time) {
  return new Date(time).toISOString().slice(0, 10)
}

function localDayStart(scheduleDate, timeZone) {
  const parts = getLocalDateParts(scheduleDate, timeZone)
  return parts ? createDateFromParts(parts, timeZone) : null
}

/**
 * 一位員工一段期間（例如一個月）的班表一起找打卡：同一筆打卡只算給一個班，一組打卡不會被兩個班表各算一次。
 *
 * 1. 先依每一班的簽到、簽退時段比對（與 matchShiftPunches 相同：簽到取最早、簽退取晚於簽到的最晚一筆）。
 *    落在某一班時段內的打卡就保留給那一班；同一筆打卡落在兩個班的時段內時（打卡緩衝設得很大才會發生），
 *    算給時間比較接近的那一班（簽到比上班時間、簽退比下班時間）。
 * 2. 時段內找不到簽到或簽退的班，才沿用原本依日期比對的方式（例如遲到超過打卡緩衝的人仍算得到工時），但：
 *    - 已經被任何一班用掉的打卡（時段比對到的、前面的班依日期比對用掉的）不再使用；
 *    - 簽到要早於這一班的下班時間；
 *    - 簽退要晚於上班時間與簽到，且不晚於下一個班表的開始時間；後面沒有班表時（例如月底最後一班，
 *      下個月的班表不在這次計算裡），當作隔天休息：不晚於隔天 00:00，跨日班不晚於下班時間加簽退緩衝。
 *      之後日期的班表最早也是隔天 00:00 才開始，不會拿到它的簽退。
 *    依日期比對用到的打卡同樣保留給這一班。
 *
 * schedules：同一位員工的班表 [{ key, scheduleDate, shift, nonWork }]。不用上班的班表（nonWork）也要帶：
 * 不比對打卡，只當作前一班簽退的界線。
 * 回傳 Map(key → { span, clockIn, clockOut, windowClockIn, windowClockOut })：clockIn / clockOut 是這一班最後採用的打卡
 * （原本的打卡資料，找不到為 null）；windowClockIn / windowClockOut 是時段內比對到的。不用上班的班表不在結果裡。
 */
export function matchSchedulesPunches({ records = [], schedules = [], actionBuffers, timeZone = getTimezone() }) {
  const buffers = normalizeActionBuffers(actionBuffers)
  const punches = (records || [])
    .filter((record) => (record?.action === 'clockIn' || record?.action === 'clockOut') && Number.isFinite(toTime(record)))
    .sort((a, b) => toTime(a) - toTime(b))

  // 依開始時間排好的班表；不用上班的班表以當天 00:00（或班別的開始時間）當界線
  const entries = []
  for (const item of schedules || []) {
    if (!item?.scheduleDate) continue
    const span = item.shift ? computeShiftSpan(item.scheduleDate, item.shift, timeZone) : null
    const boundary = span?.start ?? localDayStart(item.scheduleDate, timeZone)
    if (!boundary) continue
    entries.push({ ...item, span, boundary: boundary.getTime(), work: Boolean(item.shift) && !item.nonWork })
  }
  entries.sort((a, b) => a.boundary - b.boundary)
  const workEntries = entries.filter((entry) => entry.work)
  workEntries.forEach((entry) => {
    const next = entries.find((other) => other.boundary > entry.boundary)
    entry.nextStart = next ? next.boundary : null
    // 後面沒有班表時的界線：隔天 00:00（與隔天排休相同）
    entry.nextDayStart = localDayStart(new Date(new Date(entry.scheduleDate).getTime() + MS_PER_DAY), timeZone)?.getTime() ?? null
    entry.windowRecords = []
    if (!entry.span) return
    entry.clockInWindow = computeActionWindow('clockIn', entry.span.start, entry.span.end, buffers)
    entry.clockOutWindow = computeActionWindow('clockOut', entry.span.start, entry.span.end, buffers)
  })

  // 1. 時段比對：每一筆打卡最多屬於一個班
  const used = new Set()
  for (const record of punches) {
    const time = toTime(record)
    const isClockIn = record.action === 'clockIn'
    let owner = null
    let ownerDistance = Number.POSITIVE_INFINITY
    for (const entry of workEntries) {
      if (!isWithin(time, isClockIn ? entry.clockInWindow : entry.clockOutWindow)) continue
      const distance = Math.abs(time - (isClockIn ? entry.span.start : entry.span.end).getTime())
      if (distance < ownerDistance) {
        owner = entry
        ownerDistance = distance
      }
    }
    if (owner) {
      owner.windowRecords.push(record)
      used.add(record)
    }
  }

  // 2. 依日期比對（依時間先後一班一班來），只用還沒被用掉、而且落在這一班合理範圍內的打卡
  const results = new Map()
  for (const entry of workEntries) {
    const matched = entry.span
      ? matchShiftPunches({ records: entry.windowRecords, scheduleDate: entry.scheduleDate, shift: entry.shift, actionBuffers: buffers, timeZone })
      : null
    const windowClockIn = matched?.clockIn ?? null
    const windowClockOut = matched?.clockOut ?? null
    const spanStart = entry.span ? entry.span.start.getTime() : Number.NEGATIVE_INFINITY
    const spanEnd = entry.span ? entry.span.end.getTime() : Number.POSITIVE_INFINITY
    const unused = (action) => punches.filter((record) => record.action === action && !used.has(record))

    let clockIn = windowClockIn
    if (!clockIn) {
      // 班表日期當天（UTC 日期）最早的簽到；跨日班再看前一天最晚的簽到
      const candidates = unused('clockIn').filter((record) => toTime(record) < spanEnd)
      const scheduleKey = utcDateKey(entry.scheduleDate)
      clockIn = candidates.find((record) => utcDateKey(toTime(record)) === scheduleKey) ?? null
      if (!clockIn && entry.shift.crossDay) {
        const previousKey = utcDateKey(new Date(entry.scheduleDate).getTime() - MS_PER_DAY)
        clockIn = candidates.filter((record) => utcDateKey(toTime(record)) === previousKey).at(-1) ?? null
      }
      if (clockIn) used.add(clockIn)
    }

    let clockOut = null
    if (clockIn) {
      const clockInTime = toTime(clockIn)
      if (windowClockOut && toTime(windowClockOut) > clockInTime) {
        clockOut = windowClockOut
      } else {
        // 簽到當天（UTC 日期）晚於簽到的第一筆簽退，沒有再看隔天的第一筆
        const lower = Math.max(clockInTime, spanStart)
        const upper = entry.nextStart
          ?? Math.max(spanEnd + buffers.clockOut.lateMinutes * MS_PER_MINUTE, entry.nextDayStart ?? Number.NEGATIVE_INFINITY)
        const candidates = unused('clockOut').filter((record) => toTime(record) > lower && toTime(record) <= upper)
        const clockInKey = utcDateKey(clockInTime)
        const nextKey = utcDateKey(clockInTime + MS_PER_DAY)
        clockOut = candidates.find((record) => utcDateKey(toTime(record)) === clockInKey)
          ?? candidates.find((record) => utcDateKey(toTime(record)) === nextKey)
          ?? null
        if (clockOut) used.add(clockOut)
      }
    }

    results.set(entry.key, { span: entry.span, clockIn, clockOut, windowClockIn, windowClockOut })
  }
  return results
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
