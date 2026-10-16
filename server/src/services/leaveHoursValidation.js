// 請假「時數」欄位的送簽檢核（純函式）：
// - leave-hours-invalid：必須是大於 0 的數字，且是最小單位（預設 0.5 小時）的倍數。
// - leave-hours-range：不可超過所選起訖期間裡可請的時數上限（每個台灣日曆日最多 maxHoursPerDay 小時，
//   有時分的請假只算實際涵蓋的時數）。時數可以比期間「少」（半天、扣掉休息日），不能比期間「多」。
// 只在送出與重新送出時嚴格檢查；核准時不再檢查，管理員事後調低每日上限不會讓簽核中的單卡住。
import { parseLeaveInterval } from '../utils/leaveDuration.js'
import {
  DEFAULT_MAX_HOURS_PER_DAY,
  DEFAULT_MIN_UNIT_HOURS,
  formatHoursText,
  isLeaveHoursFilled,
  isMultipleOfStep,
  maxHoursOfInterval,
  parseLeaveHours,
} from '../utils/leaveHours.js'

export class LeaveHoursValidationError extends Error {
  constructor(violations) {
    super('送簽資料檢核未通過')
    this.name = 'LeaveHoursValidationError'
    this.status = 400
    this.violations = violations
  }
}

function violation(rule, message, extra = {}) {
  return { rule, message, ...extra }
}

/**
 * 檢查一張請假單的時數欄位，回傳違規清單（空陣列代表通過）。
 * hoursValue 沒填不在這裡處理（必填由必填欄位檢核負責）。
 */
export function checkLeaveHours({
  hoursValue,
  hoursFieldId = '',
  startValue,
  endValue,
  startType,
  endType,
  minUnitHours = DEFAULT_MIN_UNIT_HOURS,
  maxHoursPerDay = DEFAULT_MAX_HOURS_PER_DAY,
  dayCeilings = null,
} = {}) {
  if (!isLeaveHoursFilled(hoursValue)) return []
  const fieldId = String(hoursFieldId || '')
  const hours = parseLeaveHours(hoursValue)
  const unitText = Number(minUnitHours)
  if (hours === null || !isMultipleOfStep(hours, minUnitHours)) {
    return [violation(
      'leave-hours-invalid',
      `請假時數必須是大於 0 的數字，且以 ${unitText} 小時為單位`,
      { fieldId },
    )]
  }

  if (!isLeaveHoursFilled(startValue) || !isLeaveHoursFilled(endValue)) return []
  const interval = parseLeaveInterval(startValue, endValue, { startType, endType })
  if (!interval || interval.reversed) return []
  // dayCeilings：班表上排了比每日上限更長的班（例如 12 小時班）的日子，那幾天的上限放寬成班別的時數
  const max = maxHoursOfInterval(interval, maxHoursPerDay, dayCeilings)
  if (hours > max + 1e-6) {
    return [violation(
      'leave-hours-range',
      `請假時數 ${formatHoursText(hours)}超過所選期間可請的上限 ${formatHoursText(max)}（每日最多 ${formatHoursText(maxHoursPerDay)}${dayCeilings?.size ? '，排了更長的班的日子以班別時數為準' : ''}）`,
      { fieldId, hours, maxHours: max },
    )]
  }
  return []
}

export function assertLeaveHoursValid(options) {
  const violations = checkLeaveHours(options)
  if (violations.length) throw new LeaveHoursValidationError(violations)
}

export default { LeaveHoursValidationError, checkLeaveHours, assertLeaveHoursValid }
