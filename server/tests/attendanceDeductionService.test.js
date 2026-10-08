import { jest } from '@jest/globals'

const mockAttendanceRecord = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))

let calculateLateEarlyCount
let calculateLateEarlyDeductions

beforeAll(async () => {
  ({ calculateLateEarlyCount, calculateLateEarlyDeductions } = await import(
    '../src/services/attendanceDeductionService.js'
  ))
})

beforeEach(() => {
  mockAttendanceRecord.find.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockShiftSchedule.find.mockReset()
})

function buildContext({ shift, schedule, records, abnormalRules = {} }) {
  return {
    attendanceSetting: {
      shifts: [shift],
      abnormalRules: {
        lateGrace: 5,
        earlyLeaveGrace: 5,
        lateDeductionEnabled: true,
        lateDeductionAmount: 100,
        earlyLeaveDeductionEnabled: true,
        earlyLeaveDeductionAmount: 200,
        ...abnormalRules,
      },
      actionBuffers: {
        clockIn: { earlyMinutes: 120, lateMinutes: 240 },
        clockOut: { earlyMinutes: 240, lateMinutes: 120 },
      },
    },
    schedules: [schedule],
    attendanceRecords: records,
  }
}

describe('attendance deduction service', () => {
  it('calculates late and early deductions from action/timestamp records', async () => {
    const context = buildContext({
      shift: {
        _id: 'shift1',
        code: 'D',
        name: 'Day',
        startTime: '09:00',
        endTime: '17:00',
        crossDay: false,
      },
      schedule: {
        _id: 'schedule1',
        shiftId: 'shift1',
        date: new Date('2026-09-10T00:00:00.000Z'),
      },
      records: [
        {
          action: 'clockIn',
          timestamp: new Date('2026-09-10T01:11:00.000Z'),
          punchKey: 'employee1:schedule1:clockIn',
        },
        {
          action: 'clockOut',
          timestamp: new Date('2026-09-10T08:50:00.000Z'),
          punchKey: 'employee1:schedule1:clockOut',
        },
      ],
    })

    const result = await calculateLateEarlyDeductions('employee1', '2026-09-01', context)

    expect(result.lateCount).toBe(1)
    expect(result.earlyLeaveCount).toBe(1)
    expect(result.lateDetails[0].minutesLate).toBe(6)
    expect(result.earlyLeaveDetails[0].minutesEarly).toBe(5)
    expect(result.totalDeduction).toBe(300)
    expect(mockAttendanceRecord.find).not.toHaveBeenCalled()
    expect(mockAttendanceSetting.findOne).not.toHaveBeenCalled()
    expect(mockShiftSchedule.find).not.toHaveBeenCalled()
  })

  it('handles cross-day shifts using the configured Taiwan timezone', async () => {
    const context = buildContext({
      shift: {
        _id: 'shift2',
        code: 'N',
        name: 'Night',
        startTime: '22:00',
        endTime: '06:00',
        crossDay: true,
      },
      schedule: {
        _id: 'schedule2',
        shiftId: 'shift2',
        date: new Date('2026-09-11T00:00:00.000Z'),
      },
      records: [
        { action: 'clockIn', timestamp: new Date('2026-09-11T14:00:00.000Z') },
        { action: 'clockOut', timestamp: new Date('2026-09-11T21:50:00.000Z') },
      ],
      abnormalRules: { lateGrace: 0, earlyLeaveGrace: 0 },
    })

    const result = await calculateLateEarlyCount('employee1', '2026-09', context)

    expect(result.lateCount).toBe(0)
    expect(result.earlyLeaveCount).toBe(1)
    expect(result.earlyLeaveDetails[0].minutesEarly).toBe(10)
  })

  it('does not count rest-day schedules as late or early', async () => {
    const context = buildContext({
      shift: {
        _id: 'rest1',
        code: 'REST',
        name: 'Rest day',
        startTime: '00:00',
        endTime: '00:00',
      },
      schedule: {
        _id: 'schedule3',
        shiftId: 'rest1',
        date: new Date('2026-09-12T00:00:00.000Z'),
      },
      records: [
        { action: 'clockIn', timestamp: new Date('2026-09-12T03:00:00.000Z') },
        { action: 'clockOut', timestamp: new Date('2026-09-12T04:00:00.000Z') },
      ],
    })

    const result = await calculateLateEarlyCount('employee1', '2026-09', context)

    expect(result.lateCount).toBe(0)
    expect(result.earlyLeaveCount).toBe(0)
  })

  it('rejects invalid month values before querying data', async () => {
    await expect(calculateLateEarlyCount('employee1', '2026-13')).rejects.toThrow('Invalid month format')
    expect(mockAttendanceRecord.find).not.toHaveBeenCalled()
  })
})

// 核准的請假中不算遲到或早退。日班 09:00-17:00（台灣時間）= UTC 01:00-09:00
describe('approved leave is not late or early', () => {
  const DAY = { _id: 'day', code: 'D', name: '日班', startTime: '09:00', endTime: '17:00', crossDay: false }
  const SCHEDULE = { _id: 'schedule1', shiftId: 'day', date: new Date('2026-09-10T00:00:00.000Z') }
  const at = (time) => new Date(`2026-09-10T${time}:00.000Z`)
  const leave = (startTime, endTime, extra = {}) => ({ startMs: at(startTime).getTime(), endMs: at(endTime).getTime(), allDay: false, ...extra })

  async function countWith({ clockIn, clockOut, leaves }) {
    const records = []
    if (clockIn) records.push({ action: 'clockIn', timestamp: at(clockIn) })
    if (clockOut) records.push({ action: 'clockOut', timestamp: at(clockOut) })
    const context = buildContext({
      shift: DAY,
      schedule: SCHEDULE,
      records,
      abnormalRules: { lateGrace: 0, earlyLeaveGrace: 0 },
    })
    if (leaves) context.approvedLeaveIntervals = leaves
    return calculateLateEarlyCount('employee1', '2026-09', context)
  }

  it('counts lateness from the end of a morning leave, not from the start of the shift', async () => {
    // 上午請假 09:00-12:00（UTC 01:00-04:00），12:10 才到
    const result = await countWith({ clockIn: '04:10', clockOut: '09:00', leaves: [leave('01:00', '04:00')] })

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([10])
    expect(result.earlyLeaveCount).toBe(0)
  })

  it('is not late at all when the employee arrives right after a morning leave', async () => {
    const result = await countWith({ clockIn: '03:55', clockOut: '09:00', leaves: [leave('01:00', '04:00')] })

    expect(result.lateCount).toBe(0)
  })

  it('without the leave the same punches are late for the whole morning', async () => {
    const result = await countWith({ clockIn: '03:55', clockOut: '09:00', leaves: [] })

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([175])
  })

  it('counts leaving early only before an afternoon leave starts', async () => {
    // 下午請假 14:00-17:00（UTC 06:00-09:00），13:30 下班比請假開始早 30 分鐘
    const leftBefore = await countWith({ clockIn: '01:00', clockOut: '05:30', leaves: [leave('06:00', '09:00')] })
    const leftAtLeaveStart = await countWith({ clockIn: '01:00', clockOut: '06:00', leaves: [leave('06:00', '09:00')] })

    expect(leftBefore.earlyLeaveDetails.map((item) => item.minutesEarly)).toEqual([30])
    expect(leftAtLeaveStart.earlyLeaveCount).toBe(0)
  })

  it('ignores a whole shift that is covered by leave, even with punches', async () => {
    // 整天請假（日期型）：00:00 到隔天 00:00（台灣時間）
    const wholeDay = { startMs: at('00:00').getTime() - 8 * 3600000, endMs: at('00:00').getTime() + 16 * 3600000, allDay: true }

    const result = await countWith({ clockIn: '03:00', clockOut: '04:00', leaves: [wholeDay] })

    expect(result.lateCount).toBe(0)
    expect(result.earlyLeaveCount).toBe(0)
  })

  it('does not change anything for leave on other days or in the middle of the shift', async () => {
    const otherDay = { startMs: at('01:00').getTime() + 24 * 3600000, endMs: at('09:00').getTime() + 24 * 3600000, allDay: false }
    const lunch = leave('04:00', '05:00')

    const result = await countWith({ clockIn: '01:30', clockOut: '08:30', leaves: [otherDay, lunch] })

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([30])
    expect(result.earlyLeaveDetails.map((item) => item.minutesEarly)).toEqual([30])
  })

  it('handles two leaves that join up to cover the start of the shift', async () => {
    const result = await countWith({ clockIn: '04:20', clockOut: '09:00', leaves: [leave('03:00', '04:00'), leave('01:00', '03:00')] })

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([20])
  })

  it('does not look for leave when nobody is late or early', async () => {
    const result = await countWith({ clockIn: '01:00', clockOut: '09:00' })

    expect(result).toMatchObject({ lateCount: 0, earlyLeaveCount: 0 })
  })

  it('does not query leave without a database connection (unit tests)', async () => {
    const result = await countWith({ clockIn: '02:00', clockOut: '09:00' })

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([60])
  })
})
