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

// 建立 Intl.DateTimeFormat 很花時間，打卡頁會定時對整個月的班表重算打卡時段，
// 所以每個時區只建一次、之後重複使用（與伺服器 utils/timeWindow.js 相同的做法）
const dateTimePartsFormatters = new Map()

function getDateTimePartsFormatter(timeZone) {
  let formatter = dateTimePartsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    dateTimePartsFormatters.set(timeZone, formatter)
  }
  return formatter
}

export function createDateFromParts(parts, timeZone = DEFAULT_TIMEZONE) {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts || {}
  if (!year || !month || !day) return null
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const baseDate = new Date(naiveUtc)
  const formatter = getDateTimePartsFormatter(timeZone)
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
  const formatter = getDateTimePartsFormatter(timeZone)
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
  // 明天的班表也要看：00:00 開始的大夜班，前一晚（例如 23:50）就在簽到時段內（伺服器也會放行）
  const nextMidnight = baseMidnight ? new Date(baseMidnight.getTime() + MS_PER_DAY) : null
  const nextParts = nextMidnight ? getLocalDateParts(nextMidnight, timeZone) : null
  const nextScheduleDate = nextParts ? buildScheduleDate(nextParts) : null

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
  const nextKey = nextScheduleDate?.getTime()
  const nowMs = now.getTime()
  const resolvedBuffers = normalizeActionBuffers(actionBuffers)
  const windowOf = (ctx, action) => computeActionWindow(action, ctx.shiftStart, ctx.shiftEnd, resolvedBuffers)

  // 伺服器打卡時只看昨天、今天、明天的班表；其他日子的班不能拿來當「今天的班」
  const nearbyKeys = [previousKey, todayKey, nextKey].filter(key => key !== undefined)
  const nearbyContexts = normalized.filter(ctx => nearbyKeys.includes(ctx.scheduleDate.getTime()))
  // 另一個班（明天 00:00 的大夜班、昨天的跨日班、今天的班）的打卡時段包含現在時，伺服器會改用那一班；
  // 好幾個班都包含現在時，取時間最接近的（簽到比上班時間、簽退比下班時間）
  const pickOpenContext = action => {
    const nominalOf = ctx => (action === 'clockIn' ? ctx.shiftStart : ctx.shiftEnd).getTime()
    return nearbyContexts
      .filter(ctx => isWithinWindow(now, windowOf(ctx, action)))
      .reduce((best, ctx) => (
        !best || Math.abs(nowMs - nominalOf(ctx)) < Math.abs(nowMs - nominalOf(best)) ? ctx : best
      ), null)
  }

  const activeContext = normalized.find(ctx => nowMs >= ctx.shiftStart.getTime() && nowMs <= ctx.shiftEnd.getTime())
  const todayContext = normalized.find(ctx => todayKey !== undefined && ctx.scheduleDate.getTime() === todayKey)
  const previousContext = normalized.find(ctx => previousKey !== undefined && ctx.scheduleDate.getTime() === previousKey)
  const todayNonWork = nonWorkDays.find(ctx => todayKey !== undefined && ctx.scheduleDate.getTime() === todayKey)

  let selected = activeContext || todayContext
  if (!selected && previousContext) {
    // 今天排休時，前一天跨日班的下班打卡仍然放行；其餘情況一律顯示「今天休假」
    const previousStillOpen = ['clockIn', 'clockOut'].some(action => (
      isWithinWindow(now, windowOf(previousContext, action))
    ))
    if (!todayNonWork || previousStillOpen) selected = previousContext
  }
  // 今天沒有班（或排休），但明天 00:00 的班已經可以簽到
  if (!selected) selected = pickOpenContext('clockIn') || pickOpenContext('clockOut')
  if (!selected) {
    if (todayNonWork) {
      const reason = describeNonWorkDay(todayNonWork.shift)
      return disabledAvailability(reason, {
        dayOff: { schedule: todayNonWork.schedule, shift: todayNonWork.shift, reason }
      })
    }
    // 以前會退回用「這個月的第一筆班表」，今天沒排班卻顯示別天的打卡時段；伺服器在這種情況回覆「今日未設定班表」
    return noScheduleAvailability()
  }

  const actions = {}
  ;['clockIn', 'clockOut'].forEach(action => {
    // 選到的班現在不能做這個動作、另一個班的打卡時段卻包含現在：改用那一班（與伺服器相同）
    let context = selected
    if (!isWithinWindow(now, windowOf(context, action))) {
      context = pickOpenContext(action) || selected
    }
    const window = windowOf(context, action)
    if (!window) {
      actions[action] = {
        disabled: true,
        reason: '班別尚未設定簽到簽退時間',
        window: null,
        formatted: null,
        context
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
      // before / open / after：畫面用來顯示「幾點開放」或「已截止」
      phase: within ? 'open' : before ? 'before' : 'after',
      window,
      formatted,
      context
    }
  })

  return {
    context: selected,
    actions,
    timeZone
  }
}

/** 這一班的打卡範圍：最早可簽到 ~ 最晚可簽退（用來判斷哪些打卡記錄屬於這一班，例如跨日班前一晚的簽到） */
export function computeShiftPunchRange(context, actionBuffers = DEFAULT_ACTION_BUFFERS) {
  if (!context?.shiftStart || !context?.shiftEnd) return null
  const clockIn = computeActionWindow('clockIn', context.shiftStart, context.shiftEnd, actionBuffers)
  const clockOut = computeActionWindow('clockOut', context.shiftStart, context.shiftEnd, actionBuffers)
  if (!clockIn || !clockOut) return null
  return { start: clockIn.start, end: clockOut.end }
}

function recordTime(record) {
  const time = new Date(record?.timestamp).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * 從打卡記錄找出這一班已有的簽到／簽退，規則與伺服器 attendanceController.createRecord 一致：
 * - blocking：同一個動作、時間在該動作的允許時段內、來源不是指紋匯入 → 伺服器會以「重複打卡」擋下
 * - record：畫面顯示用（簽到取最早、簽退取最晚，任何來源都算）；
 *   簽到的範圍是「簽到時段開始 ~ 下班時間」，也就是伺服器判斷「簽退前要有簽到」的範圍
 * records 的 action 是後端的值（clockIn / clockOut），timestamp 可以是 ISO 字串或 Date。
 */
export function resolveShiftPunches(records = [], context, actionBuffers = DEFAULT_ACTION_BUFFERS) {
  const empty = { clockIn: { record: null, blocking: null }, clockOut: { record: null, blocking: null } }
  if (!context?.shiftStart || !context?.shiftEnd) return empty
  const clockInWindow = computeActionWindow('clockIn', context.shiftStart, context.shiftEnd, actionBuffers)
  const clockOutWindow = computeActionWindow('clockOut', context.shiftStart, context.shiftEnd, actionBuffers)
  if (!clockInWindow || !clockOutWindow) return empty

  const list = Array.isArray(records) ? records : []
  const between = (record, start, end) => {
    const time = recordTime(record)
    return time !== null && time >= start.getTime() && time <= end.getTime()
  }
  const earliest = (best, record) => (!best || recordTime(record) < recordTime(best) ? record : best)
  const latest = (best, record) => (!best || recordTime(record) > recordTime(best) ? record : best)
  const clockIns = list.filter(record => record?.action === 'clockIn')
  const clockOuts = list.filter(record => record?.action === 'clockOut')
  const notImported = record => record?.source !== 'import'

  return {
    clockIn: {
      record: clockIns
        .filter(record => between(record, clockInWindow.start, context.shiftEnd))
        .reduce(earliest, null),
      blocking: clockIns
        .filter(record => notImported(record) && isWithinWindow(record.timestamp, clockInWindow))
        .reduce(earliest, null)
    },
    clockOut: {
      record: clockOuts
        .filter(record => isWithinWindow(record.timestamp, clockOutWindow))
        .reduce(latest, null),
      blocking: clockOuts
        .filter(record => notImported(record) && isWithinWindow(record.timestamp, clockOutWindow))
        .reduce(latest, null)
    }
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
