// 核准請假有沒有涵蓋班次（純函式）：規則與伺服器 server/src/services/leaveCoverageService.js 的 buildLeaveDayCheck 完全相同。
// 排班畫面用它判斷「排了上班班別、而有時分的請假涵蓋整個班次」的日子：伺服器的完整性檢查、Excel 匯出、
// 國定假日休假紀錄與存檔都把那天當成請假，畫面也要和整天請假一樣顯示成請假，不能顯示成可以編輯、只提示「請假 N 小時」的格子。
// 修改伺服器的規則時要一併修改這裡。
import { TAIPEI_OFFSET_MS } from './leaveHours'
import { computeShiftSpan } from './timeWindow'
import { hasNoWorkingTime, isNonWorkSemanticType, resolveShiftSemanticType } from './shiftSemantics'

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

// 排班與請假資料以 UTC 午夜代表某一天（與伺服器 utils/taipeiTime 的 dateKeyToUtcMidnight 相同）
function dateKeyToUtcMidnight(dateKey) {
  if (!dateKey) return null
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

// 某個台灣日期鍵當天 00:00（台灣時間）的時間點（毫秒）
function taipeiMidnightMs(dateKey) {
  const midnight = dateKeyToUtcMidnight(dateKey)
  return midnight ? midnight.getTime() - TAIPEI_OFFSET_MS : null
}

// 班別的休息時間（不支薪，可以不在請假內）：breakDuration 優先，其次 breakMinutes
function shiftBreakMs(shift) {
  for (const value of [shift?.breakDuration, shift?.breakMinutes]) {
    const minutes = Number(value)
    if (Number.isFinite(minutes) && minutes > 0) return minutes * MINUTE_MS
  }
  return 0
}

// 班次時間內沒有被請假涵蓋到的毫秒數（多張假單先合併重疊的部分）
function uncoveredShiftMs(intervals, span) {
  const start = span.start.getTime()
  const end = span.end.getTime()
  const clipped = intervals
    .map(interval => [Math.max(interval.startMs, start), Math.min(interval.endMs, end)])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
  let covered = 0
  let cursor = start
  for (const [from, to] of clipped) {
    if (to <= cursor) continue
    covered += to - Math.max(from, cursor)
    cursor = to
  }
  return end - start - covered
}

function usableLeaves(intervals) {
  return (intervals || []).filter(leave => (
    Number.isFinite(leave?.startMs) && Number.isFinite(leave?.endMs) && leave.endMs > leave.startMs
  ))
}

/** 班別是否不用上班（休息日／例假／國定假日／請假，或沒有工作時間），與伺服器 shiftSemanticService.isNonWorkShift 相同 */
export function isNonWorkShift(shift = {}) {
  return isNonWorkSemanticType(resolveShiftSemanticType(shift)) || hasNoWorkingTime(shift)
}

/**
 * 某天算不算請假：回傳 (日期 YYYY-MM-DD) => boolean（與伺服器 leaveCoverageService.buildLeaveDayCheck 相同）。
 *  - 整天的假（allDay）一律算請假。
 *  - 有時分的假：當天沒有排班就算請假；排了工作班，要整個班次都在請假中才算（班別的休息時間可以不在請假內）。
 *  - 排的是休息日、例假、國定假日、請假，或只請了班次的一部分，都維持班表自己的狀態；
 *    排了工作班卻不知道是哪個班別（shift 為 null）無法判斷班次時間，不算請假。
 * intervals：這位員工的請假區間 [{ startMs, endMs, allDay }]（leaveHours.parseLeaveInterval 的格式）；
 * scheduleOf(日期)：該日的 { kind: 'work' | 'rest', shift }，沒排班回傳 null。
 */
export function buildLeaveDayCheck(intervals = [], scheduleOf = () => null) {
  const leaves = usableLeaves(intervals)
  if (!leaves.length) return () => false
  return dateKey => {
    const dayStart = taipeiMidnightMs(dateKey)
    if (dayStart === null) return false
    const dayEnd = dayStart + DAY_MS
    const onDay = leaves.filter(leave => leave.startMs < dayEnd && leave.endMs > dayStart)
    if (!onDay.length) return false
    if (onDay.some(leave => leave.allDay)) return true

    const scheduled = scheduleOf(dateKey)
    if (!scheduled) return true
    if (scheduled.kind !== 'work') return false
    const span = scheduled.shift ? computeShiftSpan(dateKeyToUtcMidnight(dateKey), scheduled.shift) : null
    const spanMs = span ? span.end.getTime() - span.start.getTime() : 0
    if (spanMs <= 0) return false
    return uncoveredShiftMs(leaves, span) <= Math.min(shiftBreakMs(scheduled.shift), spanMs - 1)
  }
}

/**
 * 排班畫面用：某天排了這個班別，核准請假是否涵蓋整個班次（buildLeaveDayCheck 的規則）。
 * 班別不明（shift 為 null，例如班別設定裡已經找不到）或不用上班的班別一律回傳 false，不猜。
 */
export function leaveCoversRosteredShift(intervals, dateKey, shift) {
  if (!shift) return false
  const kind = isNonWorkShift(shift) ? 'rest' : 'work'
  return buildLeaveDayCheck(intervals, () => ({ kind, shift }))(dateKey)
}

export default {
  buildLeaveDayCheck,
  leaveCoversRosteredShift,
  isNonWorkShift,
}
