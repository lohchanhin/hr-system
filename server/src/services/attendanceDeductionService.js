import AttendanceRecord from '../models/AttendanceRecord.js'
import AttendanceSetting from '../models/AttendanceSetting.js'
import ShiftSchedule from '../models/ShiftSchedule.js'
import { classifyShift } from './laborRuleValidationService.js'
import {
  computeActionWindow,
  computeShiftSpan,
  getTimezone,
  normalizeActionBuffers,
} from '../utils/timeWindow.js'

const DATE_FORMAT_REGEX = /^(19|20)\d{2}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/
const EXPECTED_FORMATS = 'YYYY-MM format, YYYY-MM-DD format, or Date object'
const VALID_YEAR_MIN = 1900
const VALID_YEAR_MAX = 2099

function getMinutesDifference(time1, time2) {
  return Math.floor((new Date(time2) - new Date(time1)) / 60000)
}

function parseMonthRange(month) {
  if (month === null || month === undefined) {
    throw new Error('Month parameter is required')
  }

  let monthStr
  if (typeof month === 'string') {
    if (!DATE_FORMAT_REGEX.test(month)) {
      throw new Error(`Invalid month format: ${month}. Expected ${EXPECTED_FORMATS}.`)
    }
    monthStr = month.slice(0, 7)
  } else if (month instanceof Date) {
    if (Number.isNaN(month.getTime())) throw new Error('Invalid Date object provided for month parameter')
    const year = month.getUTCFullYear()
    if (year < VALID_YEAR_MIN || year > VALID_YEAR_MAX) {
      throw new Error(`Year ${year} is out of valid range (${VALID_YEAR_MIN}-${VALID_YEAR_MAX})`)
    }
    monthStr = `${year}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`
  } else {
    throw new Error(`Invalid month parameter type: ${typeof month}. Expected ${EXPECTED_FORMATS}.`)
  }

  const start = new Date(`${monthStr}-01T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Failed to create valid date from month: ${monthStr}`)
  }
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { start, end }
}

function buildShiftMap(setting) {
  const shiftMap = new Map()
  for (const shift of setting?.shifts ?? []) {
    if (shift?._id) shiftMap.set(shift._id.toString(), shift)
  }
  return shiftMap
}

function findPunch({ records, employeeId, schedule, action, window }) {
  const scheduleId = schedule._id?.toString?.()
  const expectedKey = scheduleId ? `${employeeId}:${scheduleId}:${action}` : ''
  const matching = records.filter((record) => {
    if (record.action !== action) return false
    if (expectedKey && record.punchKey === expectedKey) return true
    const time = new Date(record.timestamp).getTime()
    return Number.isFinite(time) && time >= window.start.getTime() && time <= window.end.getTime()
  })
  matching.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  return action === 'clockIn' ? matching[0] : matching[matching.length - 1]
}

async function loadAttendanceContext(employeeId, monthRange, context) {
  const recordRangeEnd = new Date(monthRange.end)
  recordRangeEnd.setUTCDate(recordRangeEnd.getUTCDate() + 1)
  const [setting, schedules, records] = await Promise.all([
    context.attendanceSetting ?? AttendanceSetting.findOne().lean(),
    context.schedules ?? ShiftSchedule.find({
      employee: employeeId,
      date: { $gte: monthRange.start, $lt: monthRange.end },
    }).lean(),
    context.attendanceRecords ?? AttendanceRecord.find({
      employee: employeeId,
      timestamp: { $gte: monthRange.start, $lt: recordRangeEnd },
      action: { $in: ['clockIn', 'clockOut'] },
    }).lean(),
  ])

  context.attendanceSetting = setting
  context.schedules = schedules
  context.attendanceRecords = records
  return { setting, schedules, records }
}

export async function calculateLateEarlyCount(employeeId, month, context = {}) {
  const monthRange = parseMonthRange(month)
  const { setting, schedules, records } = await loadAttendanceContext(employeeId, monthRange, context)
  const shiftMap = buildShiftMap(setting)
  const lateGrace = Math.max(Number(setting?.abnormalRules?.lateGrace) || 0, 0)
  const earlyLeaveGrace = Math.max(Number(setting?.abnormalRules?.earlyLeaveGrace) || 0, 0)
  const actionBuffers = normalizeActionBuffers(setting?.actionBuffers)
  const timeZone = getTimezone()
  const lateDetails = []
  const earlyLeaveDetails = []

  for (const schedule of schedules) {
    if (!schedule?.shiftId) continue
    const shift = shiftMap.get(schedule.shiftId.toString())
    if (!shift || classifyShift(shift).isNonWork) continue
    const span = computeShiftSpan(schedule.date, shift, timeZone)
    if (!span) continue

    const clockInWindow = computeActionWindow('clockIn', span.start, span.end, actionBuffers)
    const clockOutWindow = computeActionWindow('clockOut', span.start, span.end, actionBuffers)
    if (!clockInWindow || !clockOutWindow) continue

    const clockIn = findPunch({ records, employeeId, schedule, action: 'clockIn', window: clockInWindow })
    const clockOut = findPunch({ records, employeeId, schedule, action: 'clockOut', window: clockOutWindow })
    const date = new Date(schedule.date).toISOString().slice(0, 10)

    if (clockIn?.timestamp) {
      const actualClockIn = new Date(clockIn.timestamp)
      const minutesLate = Math.max(getMinutesDifference(span.start, actualClockIn) - lateGrace, 0)
      if (minutesLate > 0) {
        lateDetails.push({
          date,
          clockIn: actualClockIn,
          scheduledStart: span.start,
          minutesLate,
        })
      }
    }

    if (clockOut?.timestamp) {
      const actualClockOut = new Date(clockOut.timestamp)
      const minutesEarly = Math.max(getMinutesDifference(actualClockOut, span.end) - earlyLeaveGrace, 0)
      if (minutesEarly > 0) {
        earlyLeaveDetails.push({
          date,
          clockOut: actualClockOut,
          scheduledEnd: span.end,
          minutesEarly,
        })
      }
    }
  }

  return {
    employeeId,
    month,
    lateCount: lateDetails.length,
    earlyLeaveCount: earlyLeaveDetails.length,
    lateDetails,
    earlyLeaveDetails,
  }
}

export async function calculateLateEarlyDeductions(employeeId, month, context = {}) {
  const setting = context.attendanceSetting ?? await AttendanceSetting.findOne().lean()
  context.attendanceSetting = setting

  const lateDeductionEnabled = setting?.abnormalRules?.lateDeductionEnabled || false
  const lateDeductionAmount = Number(setting?.abnormalRules?.lateDeductionAmount) || 0
  const earlyLeaveDeductionEnabled = setting?.abnormalRules?.earlyLeaveDeductionEnabled || false
  const earlyLeaveDeductionAmount = Number(setting?.abnormalRules?.earlyLeaveDeductionAmount) || 0
  const counts = await calculateLateEarlyCount(employeeId, month, context)
  const lateDeduction = lateDeductionEnabled ? counts.lateCount * lateDeductionAmount : 0
  const earlyLeaveDeduction = earlyLeaveDeductionEnabled
    ? counts.earlyLeaveCount * earlyLeaveDeductionAmount
    : 0

  return {
    ...counts,
    lateDeductionAmount,
    earlyLeaveDeductionAmount,
    lateDeduction,
    earlyLeaveDeduction,
    totalDeduction: lateDeduction + earlyLeaveDeduction,
    settings: {
      lateDeductionEnabled,
      lateDeductionAmount,
      earlyLeaveDeductionEnabled,
      earlyLeaveDeductionAmount,
    },
  }
}

export async function calculateBatchLateEarlyDeductions(employeeIds, month) {
  const sharedSetting = await AttendanceSetting.findOne().lean()
  const results = []
  for (const employeeId of employeeIds) {
    try {
      results.push(await calculateLateEarlyDeductions(employeeId, month, {
        attendanceSetting: sharedSetting,
      }))
    } catch (err) {
      console.error(`Error calculating deductions for employee ${employeeId}:`, err)
      results.push({ employeeId, month, error: err.message, totalDeduction: 0 })
    }
  }
  return results
}
