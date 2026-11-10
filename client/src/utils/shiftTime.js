// 班別設定畫面的時間計算：班別長度、休息、實際工時、跨日判斷與表單檢查（純函式）。
// 規則與伺服器一致：班別起訖看 utils/timeWindow.js 的 computeShiftSpan，
// 休息與工時看 services/leaveShiftHours.js 的 shiftBreakMinutes / shiftSpanHours（工時計算、勞基法檢核同一套）。
import { buildShiftStyle } from './shiftColors'

const MINUTES_PER_DAY = 24 * 60
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?$/

/** 'HH:mm' -> 當天第幾分鐘；讀不懂回傳 null（'00:00' 是 0，不是空值） */
export function timeToMinutes(value) {
  const match = TIME_PATTERN.exec(String(value ?? '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * 班別從上班到下班的分鐘數。
 * 下班早於上班：一定跨日；下班等於上班：勾跨日才是 24 小時，沒勾是 0；下班晚於上班：同一天（跨日旗標不影響）。
 * 時間還沒填好回傳 null。
 */
export function shiftSpanMinutes(shift) {
  const start = timeToMinutes(shift?.startTime)
  const end = timeToMinutes(shift?.endTime)
  if (start === null || end === null) return null
  let minutes = end - start
  if (minutes < 0 || (minutes === 0 && shift?.crossDay)) minutes += MINUTES_PER_DAY
  return minutes
}

/** 下班時間落在隔天 */
export function crossesMidnight(shift) {
  const start = timeToMinutes(shift?.startTime)
  const end = timeToMinutes(shift?.endTime)
  if (start === null || end === null) return false
  return end < start || (end === start && Boolean(shift?.crossDay))
}

/**
 * 要存的「跨日班」旗標：下班早於上班一定是 true、晚於上班一定是 false，
 * 只有上下班時間相同時才由管理者決定（24 小時的班）。
 * 旗標和時間不一致時（22:00-06:00 沒勾、或 00:00-08:00 有勾），伺服器的夜班津貼與報表會算錯。
 */
export function resolveCrossDayFlag(shift) {
  const start = timeToMinutes(shift?.startTime)
  const end = timeToMinutes(shift?.endTime)
  if (start === null || end === null) return Boolean(shift?.crossDay)
  if (end < start) return true
  if (end > start) return false
  return Boolean(shift?.crossDay)
}

function breakWindowMinutes(window) {
  const start = timeToMinutes(window?.start)
  const end = timeToMinutes(window?.end)
  if (start === null || end === null) return null
  return end > start ? end - start : end + MINUTES_PER_DAY - start
}

/** 休息分鐘數：有填休息時段就以時段加總為準，否則用休息時長（與伺服器相同） */
export function shiftBreakMinutes(shift) {
  if (!shift) return 0
  if (Array.isArray(shift.breakWindows) && shift.breakWindows.length) {
    const total = shift.breakWindows.reduce((sum, window) => sum + (breakWindowMinutes(window) ?? 0), 0)
    if (total > 0) return total
  }
  for (const value of [shift.breakDuration, shift.breakMinutes]) {
    if (value === null || value === undefined || value === '') continue
    const minutes = Number(value)
    if (Number.isFinite(minutes) && minutes >= 0) return minutes
  }
  return timeToMinutes(shift.breakTime) ?? 0
}

/** 休息時間是不是由休息時段決定（此時「休息時長」不會被拿來計算） */
export function breakComesFromWindows(shift) {
  if (!Array.isArray(shift?.breakWindows)) return false
  return shift.breakWindows.reduce((sum, window) => sum + (breakWindowMinutes(window) ?? 0), 0) > 0
}

/** 實際工作分鐘數（班別長度扣掉休息，最少 0）；時間還沒填好回傳 null */
export function shiftWorkMinutes(shift) {
  const span = shiftSpanMinutes(shift)
  if (span === null) return null
  return Math.max(span - shiftBreakMinutes(shift), 0)
}

/** 480 -> '8'、450 -> '7.5'、465 -> '7.75' */
export function formatHours(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return ''
  return String(Math.round((Number(minutes) / 60) * 100) / 100)
}

/**
 * 工作班的時間檢查，回傳要顯示給管理者的問題（沒有問題回傳空陣列）。
 * 伺服器只檢查格式；休息比班別長、休息時段不在上班時間內都存得進去，之後工時會算成 0 或少算。
 */
export function validateWorkShiftTimes(shift) {
  const problems = []
  const start = timeToMinutes(shift?.startTime)
  const end = timeToMinutes(shift?.endTime)
  if (start === null) problems.push('請選擇上班時間')
  if (end === null) problems.push('請選擇下班時間')
  if (start === null || end === null) return problems
  const span = shiftSpanMinutes(shift)
  if (span === 0) return problems // 上下班時間相同由班別性質的檢查處理

  const windows = Array.isArray(shift.breakWindows) ? shift.breakWindows : []
  windows.forEach((window, index) => {
    const label = `第 ${index + 1} 筆休息時段`
    const windowStart = timeToMinutes(window?.start)
    const windowEnd = timeToMinutes(window?.end)
    if (windowStart === null && windowEnd === null) {
      if (String(window?.label || '').trim()) problems.push(`${label}請填寫開始與結束時間`)
      return
    }
    if (windowStart === null || windowEnd === null) {
      problems.push(`${label}請填寫開始與結束時間`)
      return
    }
    if (windowStart === windowEnd) {
      problems.push(`${label}的開始與結束不得相同`)
      return
    }
    // 以「上班後第幾分鐘」比較，跨日班的休息（例如 22:00-06:00 的 01:00-02:00）才判斷得對
    const offset = (windowStart - start + MINUTES_PER_DAY) % MINUTES_PER_DAY
    if (offset + breakWindowMinutes(window) > span) problems.push(`${label}不在上班時間內`)
  })
  if (problems.length) return problems

  const breakMinutes = shiftBreakMinutes(shift)
  if (breakMinutes >= span) problems.push('休息時間不可等於或超過上班到下班的時間')
  return problems
}

function relativeLuminance(hex) {
  const value = String(hex || '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  const channel = (index) => {
    const part = parseInt(value.slice(index, index + 2), 16) / 255
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** 兩個顏色的對比（WCAG，1 ~ 21）；顏色讀不懂回傳 null */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  if (a === null || b === null) return null
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// 班表格子的字是粗體小字，對比低於 3 就很難讀
export const MIN_SHIFT_TEXT_CONTRAST = 3

/** 班別在班表上的樣子：底色（班表格子實際顯示的顏色）、文字色、邊框，以及文字看不看得清楚 */
export function shiftChipAppearance(shift) {
  const style = buildShiftStyle(shift || {})
  const background = style['--shift-cell-bg-start'] || '#f1f5f9'
  const color = style['--shift-text-color'] || '#0f172a'
  const borderColor = style['--shift-border-color'] || '#cbd5e1'
  const ratio = contrastRatio(background, color)
  return {
    style: { background, color, borderColor },
    contrast: ratio,
    lowContrast: ratio !== null && ratio < MIN_SHIFT_TEXT_CONTRAST
  }
}
