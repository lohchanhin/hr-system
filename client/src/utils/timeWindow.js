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

// 不用上班的班別性質（與伺服器 shiftSemanticService 一致）
const NON_WORK_SEMANTIC_TYPES = Object.freeze(['rest_day', 'regular_rest', 'holiday', 'leave'])

const NON_WORK_DAY_LABELS = Object.freeze({
  rest_day: '休息日',
  holiday: '國定假日',
  leave: '請假日'
})

function normalizeText(value) {
  return String(value || '').trim().toUpperCase()
}

// 8:00、08:00:00 這類寫法統一成 HH:mm 再比較
function normalizeTimeText(value) {
  const text = normalizeText(value)
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text
}

/**
 * 這個班別是否「不用上班」（休息日 / 例假 / 國定假日 / 請假 / 沒有工作時間）。
 * 對應伺服器 shiftSemanticService.isNonWorkShift：班別性質屬於上述四種，
 * 或開始時間等於結束時間且沒有勾跨日（例如 00:00-00:00）。
 */
export function isNonWorkShift(shift) {
  if (!shift) return false
  const semanticType = String(shift.semanticType || '').trim().toLowerCase()
  if (NON_WORK_SEMANTIC_TYPES.includes(semanticType)) return true
  const start = normalizeTimeText(shift.startTime)
  const end = normalizeTimeText(shift.endTime)
  return Boolean(start) && start === end && !shift.crossDay
}

/** 不用上班的日子打卡按鈕要顯示的說明（文字與伺服器回覆一致） */
export function describeNonWorkDay(shift) {
  const semanticType = String(shift?.semanticType || '').trim().toLowerCase()
  if (semanticType === 'regular_rest') return '例假不得打卡或加班'
  return `今日為${NON_WORK_DAY_LABELS[semanticType] || '休假日'}，不需打卡`
}

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
    hourCycle: 'h23'
  })
  const mapped = formatter.formatToParts(baseDate).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  const mappedHour = Number(mapped.hour) === 24 ? 0 : Number(mapped.hour)
  const tzUtc = Date.UTC(
    Number(mapped.year),
    Number(mapped.month) - 1,
    Number(mapped.day),
    mappedHour,
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
    hourCycle: 'h23'
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
  // 結束早於開始 → 隔天；開始等於結束時，只有勾「跨日」才算整整 24 小時（沒勾就是零長度）；
  // 結束晚於開始（例如 00:00-08:00）時，跨日旗標不再多加 24 小時
  if (end < start || (end.getTime() === start.getTime() && shift.crossDay)) {
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
    hourCycle: 'h23'
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
  const nonWorkDays = []
  schedules.forEach(schedule => {
    const scheduleDate = parseScheduleDate(schedule.date, timeZone)
    if (!scheduleDate) return
    const shiftId = normalizeShiftId(schedule.shiftId)
    const shift = shiftMap.get(shiftId)
    if (!shift) return
    // 不用上班的班別沒有上下班時段，不計算打卡視窗
    if (isNonWorkShift(shift)) {
      nonWorkDays.push({ schedule, shift, scheduleDate })
      return
    }
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

  const disabledAvailability = (reason, extra = {}) => ({
    context: null,
    ...extra,
    actions: {
      clockIn: { disabled: true, reason, window: null, formatted: null },
      clockOut: { disabled: true, reason, window: null, formatted: null }
    },
    timeZone
  })

  const noScheduleAvailability = () => disabledAvailability('今日未設定班表，無法打卡')

  if (!normalized.length && !nonWorkDays.length) {
    return noScheduleAvailability()
  }

  const todayKey = todayScheduleDate?.getTime()
  const previousKey = previousScheduleDate?.getTime()
  const nowMs = now.getTime()
  const resolvedBuffers = normalizeActionBuffers(actionBuffers)

  const activeContext = normalized.find(ctx => nowMs >= ctx.shiftStart.getTime() && nowMs <= ctx.shiftEnd.getTime())
  const todayContext = normalized.find(ctx => todayKey !== undefined && ctx.scheduleDate.getTime() === todayKey)
  const previousContext = normalized.find(ctx => previousKey !== undefined && ctx.scheduleDate.getTime() === previousKey)
  const todayNonWork = nonWorkDays.find(ctx => todayKey !== undefined && ctx.scheduleDate.getTime() === todayKey)

  let selected = activeContext || todayContext
  if (!selected && previousContext) {
    // 今天排休時，前一天跨日班的下班打卡仍然放行；其餘情況一律顯示「今天休假」
    const previousStillOpen = ['clockIn', 'clockOut'].some(action => (
      isWithinWindow(now, computeActionWindow(action, previousContext.shiftStart, previousContext.shiftEnd, resolvedBuffers))
    ))
    if (!todayNonWork || previousStillOpen) selected = previousContext
  }
  if (!selected) {
    if (todayNonWork) {
      const reason = describeNonWorkDay(todayNonWork.shift)
      return disabledAvailability(reason, {
        dayOff: { schedule: todayNonWork.schedule, shift: todayNonWork.shift, reason }
      })
    }
    selected = normalized[0]
    if (!selected) return noScheduleAvailability()
  }

  const actions = {}
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
