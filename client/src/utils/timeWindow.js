const DEFAULT_TIMEZONE = import.meta.env?.VITE_TIMEZONE || 'Asia/Taipei'

const MS_PER_MINUTE = 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

export const DEFAULT_ACTION_BUFFERS = Object.freeze({
  clockIn: { earlyMinutes: 60, lateMinutes: 240 },
  clockOut: { earlyMinutes: 240, lateMinutes: 120 }
})

const BUFFER_LIMITS = Object.freeze({
  earlyMinutes: { min: 0, max: 720 },
  lateMinutes: { min: 0, max: 720 }
})

function clampNumber(value, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.min(Math.max(num, min), max)
}

const ACTION_LABELS = Object.freeze({
  clockIn: '上班簽到',
  clockOut: '下班簽退'
})

export function normalizeActionBuffers(buffers = DEFAULT_ACTION_BUFFERS) {
  const normalized = { clockIn: { ...DEFAULT_ACTION_BUFFERS.clockIn }, clockOut: { ...DEFAULT_ACTION_BUFFERS.clockOut } }
  const source = typeof buffers === 'object' && buffers ? buffers : {}

  ;['clockIn', 'clockOut'].forEach(action => {
    const target = normalized[action]
    const incoming = source[action] || {}
    ;['earlyMinutes', 'lateMinutes'].forEach(field => {
      const clamped = clampNumber(incoming[field], BUFFER_LIMITS[field])
      if (clamped !== null) {
        target[field] = clamped
      }
    })
  })

  return normalized
}

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

export function parseScheduleDate(value, timeZone = DEFAULT_TIMEZONE) {
  if (!value && value !== 0) return null
  if (value instanceof Date) return new Date(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (!year || !month || !day) return null
    return new Date(Date.UTC(year, month - 1, day))
  }
  return null
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

export function computeActionWindow(action, shiftStart, shiftEnd, actionBuffers = DEFAULT_ACTION_BUFFERS) {
  if (!shiftStart || !shiftEnd) return null
  const buffers = normalizeActionBuffers(actionBuffers)[action]
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

function normalizeShiftId(value) {
  if (value && typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString()
  }
  if (value || value === 0) return String(value)
  return ''
}

export function determineActionAvailability({
  now = new Date(),
  schedules = [],
  shifts = [],
  timeZone = DEFAULT_TIMEZONE,
  actionBuffers = DEFAULT_ACTION_BUFFERS
} = {}) {
  const shiftMap = new Map()
  shifts.forEach(shift => {
    if (!shift?._id) return
    shiftMap.set(String(shift._id), shift)
  })

  const normalized = []
  schedules.forEach(schedule => {
    const scheduleDate = parseScheduleDate(schedule.date, timeZone)
    if (!scheduleDate) return
    const shiftId = normalizeShiftId(schedule.shiftId)
    const shift = shiftMap.get(shiftId)
    if (!shift) return
    const span = computeShiftSpan(scheduleDate, shift, timeZone)
    if (!span) return
    normalized.push({
      schedule,
      shift,
      scheduleDate,
      shiftStart: span.start,
      shiftEnd: span.end
    })
  })

  const baseParts = getLocalDateParts(now, timeZone)
  const todayScheduleDate = baseParts ? buildScheduleDate(baseParts) : null
  const baseMidnight = baseParts ? createDateFromParts(baseParts, timeZone) : null
  const previousMidnight = baseMidnight ? new Date(baseMidnight.getTime() - MS_PER_DAY) : null
  const previousParts = previousMidnight ? getLocalDateParts(previousMidnight, timeZone) : null
  const previousScheduleDate = previousParts ? buildScheduleDate(previousParts) : null

  if (!normalized.length) {
    return {
      context: null,
      actions: {
        clockIn: {
          disabled: true,
          reason: '今日未設定班表，無法打卡',
          window: null,
          formatted: null
        },
        clockOut: {
          disabled: true,
          reason: '今日未設定班表，無法打卡',
          window: null,
          formatted: null
        }
      },
      timeZone
    }
  }

  const todayKey = todayScheduleDate?.getTime()
  const previousKey = previousScheduleDate?.getTime()
  const nowMs = now.getTime()

  const activeContext = normalized.find(ctx => nowMs >= ctx.shiftStart.getTime() && nowMs <= ctx.shiftEnd.getTime())
  const todayContext = normalized.find(ctx => todayKey !== undefined && ctx.scheduleDate.getTime() === todayKey)
  const previousContext = normalized.find(ctx => previousKey !== undefined && ctx.scheduleDate.getTime() === previousKey)
  const selected = activeContext || todayContext || previousContext || normalized[0]

  const actions = {}
  const resolvedBuffers = normalizeActionBuffers(actionBuffers)
  ;['clockIn', 'clockOut'].forEach(action => {
    const window = computeActionWindow(action, selected.shiftStart, selected.shiftEnd, resolvedBuffers)
    if (!window) {
      actions[action] = {
        disabled: true,
        reason: '班別尚未設定簽到簽退時間',
        window: null,
        formatted: null
      }
      return
    }
    const formatted = formatWindow(window, timeZone)
    const within = isWithinWindow(now, window)
    const before = nowMs < window.start.getTime()
    const label = ACTION_LABELS[action] || action
    let reason
    if (within) {
      reason = formatted ? `${label}開放時段：${formatted.start} ~ ${formatted.end}` : `${label}開放中`
    } else if (before) {
      reason = formatted ? `${label}尚未開放，允許時段為 ${formatted.start} ~ ${formatted.end}` : `${label}尚未開放`
    } else {
      reason = formatted ? `${label}時段已結束，允許時段為 ${formatted.start} ~ ${formatted.end}` : `${label}時段已結束`
    }
    actions[action] = {
      disabled: !within,
      reason,
      window,
      formatted
    }
  })

  return {
    context: selected,
    actions,
    timeZone
  }
}

export function getTimezone() {
  return DEFAULT_TIMEZONE
}

export const __TESTING__ = {
  ACTION_LABELS,
  MS_PER_DAY,
  MS_PER_MINUTE,
  DEFAULT_ACTION_BUFFERS,
  BUFFER_LIMITS,
  normalizeActionBuffers
}
