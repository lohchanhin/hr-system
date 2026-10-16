// 請假時數與班表的關係（排班制的單位，例如 12 小時輪班的護理）：
// - 上限：某一天排的是工作班，那天最多可請的時數是「班別的時數」與「每日上限」中較大的那個，
//   所以排 12 小時班的人可以請整個 12 小時的班，不必管理員把全公司的每日上限調成 12。
// - 建議時數：整天的請假依班表算：排工作班的日子算班別的時數，排休息日／例假／國定假日／請假的日子算 0，
//   沒有班表的日子算每日上限（日曆日）。申請人看到的只是預設值，仍可自己調整。
import ShiftSchedule from '../models/ShiftSchedule.js'
import AttendanceSetting from '../models/AttendanceSetting.js'
import { isNonWorkShift } from './shiftSemanticService.js'
import { splitLeaveByDay } from '../utils/leaveDuration.js'
import { dateKeyToUtcMidnight } from '../utils/taipeiTime.js'
import { DEFAULT_MAX_HOURS_PER_DAY, DEFAULT_MIN_UNIT_HOURS, roundHours } from '../utils/leaveHours.js'

const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?$/
// 一次最多查多少天的班表（防呆）
export const MAX_SCHEDULE_LOOKUP_DAYS = 93

function toMinutes(value) {
  const match = TIME_PATTERN.exec(String(value ?? '').trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** 一個班別的時數（上下班時間差，跨日班加 24 小時）；沒有工作時間或時間讀不懂回傳 0 */
export function shiftSpanHours(shift) {
  const start = toMinutes(shift?.startTime)
  const end = toMinutes(shift?.endTime)
  if (start === null || end === null) return 0
  let minutes = end - start
  if (minutes < 0 || (minutes === 0 && shift?.crossDay)) minutes += 24 * 60
  return roundHours(minutes / 60)
}

function keysBetween(startKey, endKey) {
  const keys = []
  let cursor = dateKeyToUtcMidnight(startKey)
  const end = dateKeyToUtcMidnight(endKey)
  if (!cursor || !end) return keys
  while (cursor <= end && keys.length < MAX_SCHEDULE_LOOKUP_DAYS) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  }
  return keys
}

/**
 * 員工在 [startKey, endKey]（台灣日期鍵）的班表：Map(日期鍵 -> { work, hours })。
 * 排工作班的日子 work 為 true、hours 是班別的時數；排休息日／例假／國定假日／請假的日子 work 為 false；沒排班的日子不在 Map 裡。
 */
export async function loadScheduledShiftHours(employeeId, startKey, endKey) {
  const result = new Map()
  const keys = keysBetween(startKey, endKey)
  if (!employeeId || !keys.length) return result
  const rows = await ShiftSchedule.find({
    employee: employeeId,
    date: { $gte: dateKeyToUtcMidnight(keys[0]), $lte: dateKeyToUtcMidnight(keys[keys.length - 1]) },
  }).lean()
  if (!rows?.length) return result
  const setting = await AttendanceSetting.findOne().lean()
  const shiftById = new Map((setting?.shifts || []).map((shift) => [String(shift._id), shift]))
  for (const row of rows) {
    const shift = shiftById.get(String(row.shiftId))
    if (!shift) continue
    const key = new Date(row.date).toISOString().slice(0, 10)
    if (isNonWorkShift(shift)) {
      result.set(key, { work: false, hours: 0 })
    } else {
      result.set(key, { work: true, hours: shiftSpanHours(shift) })
    }
  }
  return result
}

/** 那一天的請假上限：每日上限與當天班別時數中較大的那個（沒排班、排休息日就是每日上限） */
export function dayCeiling(schedule, dateKey, maxHoursPerDay = DEFAULT_MAX_HOURS_PER_DAY) {
  const entry = schedule?.get?.(dateKey)
  return entry?.work ? Math.max(maxHoursPerDay, entry.hours) : maxHoursPerDay
}

/** 只留下「班別時數超過每日上限」的日子（驗證用；其餘的日子用每日上限即可） */
export function extraCeilings(schedule, maxHoursPerDay = DEFAULT_MAX_HOURS_PER_DAY) {
  const ceilings = new Map()
  for (const [dateKey, entry] of schedule || []) {
    if (entry.work && entry.hours > maxHoursPerDay) ceilings.set(dateKey, entry.hours)
  }
  return ceilings
}

function floorToStep(hours, step) {
  const unit = Number(step) > 0 ? Number(step) : DEFAULT_MIN_UNIT_HOURS
  return Math.floor(roundHours(hours / unit)) * unit
}

/**
 * 依區間與班表算出請假時數的上限與建議值（純函式，班表由呼叫端載入）。
 * 回傳 { valid, allDay, maxHours, suggestedHours, days: [{ dateKey, maxHours, suggestedHours, scheduled, shiftHours }] }。
 */
export function buildLeaveHoursHint({ interval, schedule = new Map(), maxHoursPerDay = DEFAULT_MAX_HOURS_PER_DAY, minUnitHours = DEFAULT_MIN_UNIT_HOURS }) {
  if (!interval || interval.reversed) return { valid: false, allDay: Boolean(interval?.allDay), maxHours: 0, suggestedHours: 0, days: [] }
  const covered = splitLeaveByDay(interval, { hoursPerDay: 24 })
  let maxHours = 0
  let suggestedHours = 0
  const days = covered.map((item) => {
    const entry = schedule.get(item.dateKey)
    const ceiling = dayCeiling(schedule, item.dateKey, maxHoursPerDay)
    const dayMax = interval.allDay ? ceiling : Math.min(item.hours, ceiling)
    let daySuggested = dayMax
    if (interval.allDay && entry) daySuggested = entry.work ? entry.hours : 0
    maxHours += dayMax
    suggestedHours += daySuggested
    return {
      dateKey: item.dateKey,
      maxHours: roundHours(dayMax),
      suggestedHours: roundHours(daySuggested),
      scheduled: entry ? (entry.work ? 'work' : 'off') : null,
      shiftHours: entry?.work ? entry.hours : 0,
    }
  })
  return {
    valid: true,
    allDay: interval.allDay,
    maxHours: roundHours(maxHours),
    suggestedHours: floorToStep(suggestedHours, minUnitHours),
    days,
  }
}

export default { shiftSpanHours, loadScheduledShiftHours, dayCeiling, extraCeilings, buildLeaveHoursHint }
