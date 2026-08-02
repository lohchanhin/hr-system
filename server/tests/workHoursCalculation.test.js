import { jest } from '@jest/globals'

const mockAttendanceRecord = { find: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockEmployee = { findById: jest.fn() }

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getLeaveFieldIds: jest.fn().mockResolvedValue({}),
}))
jest.unstable_mockModule('../src/services/nightShiftAllowanceService.js', () => ({
  calculateNightShiftAllowance: jest.fn(),
}))

let calculateWorkHours

beforeAll(async () => {
  ({ calculateWorkHours } = await import('../src/services/workHoursCalculationService.js'))
})

beforeEach(() => {
  mockEmployee.findById.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockShiftSchedule.find.mockReset()
  mockAttendanceRecord.find.mockReset()
})

describe('work-hours calculation', () => {
  it('counts rest and regular-rest schedules as zero planned hours', async () => {
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        shifts: [
          { _id: 'day', code: 'D', name: 'Day', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
          { _id: 'rest', code: 'REST', name: 'Rest day', startTime: '00:00', endTime: '00:00' },
          { _id: 'regular-rest', code: 'OFF', name: 'Regular rest', startTime: '00:00', endTime: '00:00' },
        ],
      }),
    })
    mockShiftSchedule.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { employee: 'emp1', date: new Date('2026-09-01T00:00:00.000Z'), shiftId: 'day' },
        { employee: 'emp1', date: new Date('2026-09-02T00:00:00.000Z'), shiftId: 'rest' },
        { employee: 'emp1', date: new Date('2026-09-03T00:00:00.000Z'), shiftId: 'regular-rest' },
      ]),
    })
    mockAttendanceRecord.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    })

    const result = await calculateWorkHours('emp1', '2026-09-01')

    expect(result.scheduledHours).toBe(8)
    expect(result.dailyDetails).toHaveLength(3)
    expect(result.dailyDetails.map(day => day.scheduledHours)).toEqual([8, 0, 0])
    expect(result.workDays).toBe(0)
  })
})
