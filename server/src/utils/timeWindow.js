const DEFAULT_TIMEZONE = process.env.ATTENDANCE_TIMEZONE || 'Asia/Taipei'

const MS_PER_MINUTE = 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

const ACTION_BUFFERS = Object.freeze({
  clockIn: { earlyMinutes: 60, lateMinutes: 240 },
  clockOut: { earlyMinutes: 240, lateMinutes: 120 }
})

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : NaN
}

export function parseTimeString(value) {
  if (!value || typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const hour = toNumber(match[1])
  const minute = toNumber(match[2])
  const second = match[3] ? toNumber(match[3]) : 0
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second) ||
    hour < 0 ||
    hour >= 24 ||
    minute < 0 ||
    minute >= 60 ||
    second < 0 ||
    second >= 60
  ) {
    return null
  }
  return { hour, minute, second }
}

export function createDateFromParts(parts, timeZone = DEFAULT_TIMEZONE) {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts || {}
  if (!year || !month || !day) return null
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const baseDate = new Date(naiveUtc)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const mapped = formatter.formatToParts(baseDate).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  const tzUtc = Date.UTC(
    Number(mapped.year),
    Number(mapped.month) - 1,
    Number(mapped.day),
    Number(mapped.hour),
    Number(mapped.minute),
    Number(mapped.second)
  )
  const offset = tzUtc - baseDate.getTime()
  return new Date(naiveUtc - offset)
}

export function getLocalDateParts(date, timeZone = DEFAULT_TIMEZONE) {
  if (!date) return null
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const parts = formatter.formatToParts(new Date(date)).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  if (!year || !month || !day) return null
  return { year, month, day }
}

export function buildScheduleDate({ year, month, day }) {
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}

export function computeShiftSpan(scheduleDate, shift, timeZone = DEFAULT_TIMEZONE) {
  if (!scheduleDate || !shift) return null
  const baseParts = getLocalDateParts(scheduleDate, timeZone)
  const startParts = parseTimeString(shift.startTime)
  const endParts = parseTimeString(shift.endTime)
  if (!baseParts || !startParts || !endParts) return null
  const start = createDateFromParts({ ...baseParts, ...startParts }, timeZone)
  let end = createDateFromParts({ ...baseParts, ...endParts }, timeZone)
  if (!start || !end) return null
  if (shift.crossDay || end <= start) {
    end = new Date(end.getTime() + MS_PER_DAY)
  }
  return { start, end }
}

export function computeActionWindow(action, shiftStart, shiftEnd) {
  if (!shiftStart || !shiftEnd) return null
  const buffers = ACTION_BUFFERS[action]
  if (!buffers) return null
  const { earlyMinutes, lateMinutes } = buffers
  if (action === 'clockIn') {
    const start = new Date(shiftStart.getTime() - earlyMinutes * MS_PER_MINUTE)
    const endCandidate = new Date(shiftStart.getTime() + lateMinutes * MS_PER_MINUTE)
    const end = endCandidate < shiftEnd ? endCandidate : shiftEnd
    return { start, end }
  }
  if (action === 'clockOut') {
    const startCandidate = new Date(shiftEnd.getTime() - earlyMinutes * MS_PER_MINUTE)
    const start = startCandidate > shiftStart ? startCandidate : shiftStart
    const end = new Date(shiftEnd.getTime() + lateMinutes * MS_PER_MINUTE)
    return { start, end }
  }
  return null
}

export function isWithinWindow(timestamp, window) {
  if (!timestamp || !window) return false
  const time = new Date(timestamp).getTime()
  if (Number.isNaN(time)) return false
  return time >= window.start.getTime() && time <= window.end.getTime()
}

export function formatWindow(window, timeZone = DEFAULT_TIMEZONE) {
  if (!window) return null
  const formatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  return {
    start: formatter.format(window.start),
    end: formatter.format(window.end)
  }
}

export function getTimezone() {
  return DEFAULT_TIMEZONE
}

export const __TESTING__ = {
  ACTION_BUFFERS,
  MS_PER_DAY,
  MS_PER_MINUTE
}
