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
