import { jest } from '@jest/globals'

const mockAttendanceRecord = { find: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockEmployee = { findById: jest.fn() }
const mockHoliday = { find: jest.fn() }
const mockHolidayMoveSetting = { find: jest.fn() }
const mockFormField = { find: jest.fn() }

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }))
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }))
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getLeaveFieldIds: jest.fn().mockResolvedValue({}),
}))
jest.unstable_mockModule('../src/services/nightShiftAllowanceService.js', () => ({
  calculateNightShiftAllowance: jest.fn(),
}))

let calculateWorkHours
let calculateOvertimePay

beforeAll(async () => {
  ({ calculateWorkHours, calculateOvertimePay } = await import('../src/services/workHoursCalculationService.js'))
})

beforeEach(() => {
  mockEmployee.findById.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockShiftSchedule.find.mockReset()
  mockAttendanceRecord.find.mockReset()
  mockApprovalRequest.find.mockReset()
  mockHoliday.find.mockReset()
  mockHolidayMoveSetting.find.mockReset()
  mockFormField.find.mockReset()
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

  it('calculates segmented overtime pay from dynamic ObjectId-backed form fields', async () => {
    mockEmployee.findById.mockResolvedValue({
      _id: 'emp1', autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪',
    })
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        form: { _id: 'form1', name: '加班申請', semanticType: 'overtime' },
        form_data: { hoursField: 4, dateField: '2026-09-10', reasonField: '測試加班' },
      }]),
    })
    mockFormField.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { form: 'form1', _id: 'hoursField', label: '加班時數' },
        { form: 'form1', _id: 'dateField', label: '加班日期' },
        { form: 'form1', _id: 'reasonField', label: '加班原因' },
      ]),
    })
    mockAttendanceSetting.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        shifts: [{ _id: 'day', semanticType: 'work', code: 'D', name: '日班' }],
      }),
    })
    mockShiftSchedule.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { employee: 'emp1', date: new Date('2026-09-10T00:00:00.000Z'), shiftId: 'day' },
      ]),
    })
    mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })

    const result = await calculateOvertimePay('emp1', '2026-09-01')

    expect(result.overtimeHours).toBe(4)
    expect(result.overtimePay).toBe(900)
    expect(result.overtimeRecords[0]).toEqual(expect.objectContaining({
      dayType: 'workday',
      reason: '測試加班',
      pay: 900,
    }))
  })

  describe('overtime derived from start/end time when no hours field is present', () => {
    function mockCommonLookups() {
      mockEmployee.findById.mockResolvedValue({
        _id: 'emp1', autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪',
      })
      mockFormField.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
      mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: [] }) })
      mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
      mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
      mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    }

    it('wraps a negative start/end diff by 24 hours when the record is flagged cross-day', async () => {
      mockCommonLookups()
      mockApprovalRequest.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{
          form: { _id: 'form2', name: '加班申請', semanticType: 'overtime' },
          form_data: {
            開始時間: '2026-09-10T23:00:00.000Z',
            結束時間: '2026-09-10T02:00:00.000Z',
            是否跨日: true,
          },
        }]),
      })

      const result = await calculateOvertimePay('emp1', '2026-09-01')

      // Raw diff is -21h; the cross-day flag adds 24h back, yielding 3h of OT.
      expect(result.overtimeHours).toBe(3)
      expect(result.overtimePay).toBe(650)
      expect(result.overtimeRecords[0]).toEqual(expect.objectContaining({ hours: 3, dayType: 'workday', hasIssue: false }))
      expect(result.overtimeIssues).toEqual([])
    })

    it('clamps the same negative diff to zero hours and surfaces an issue instead of silently dropping it when cross-day is not flagged', async () => {
      mockCommonLookups()
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      mockApprovalRequest.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{
          form: { _id: 'form3', name: '加班申請', semanticType: 'overtime' },
          form_data: {
            開始時間: '2026-09-10T23:00:00.000Z',
            結束時間: '2026-09-10T02:00:00.000Z',
          },
        }]),
      })

      const result = await calculateOvertimePay('emp1', '2026-09-01')

      // Without the cross-day flag, a form-entry mistake (or a genuinely
      // cross-midnight shift the requester forgot to flag) still produces
      // zero overtime hours/pay -- but it's no longer silent: the record is
      // marked hasIssue and a human-readable message is surfaced both on the
      // record and in the top-level overtimeIssues list so it reaches the
      // payroll review UI instead of only a server-side console.warn.
      expect(result.overtimeHours).toBe(0)
      expect(result.overtimePay).toBe(0)
      expect(result.overtimeRecords[0]).toEqual(expect.objectContaining({
        hours: 0,
        pay: 0,
        hasIssue: true,
        issue: expect.stringContaining('未勾選「跨日」'),
      }))
      expect(result.overtimeIssues).toEqual([expect.stringContaining('未勾選「跨日」')])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('negative duration without cross-day flag'))
      warnSpy.mockRestore()
    })
  })
})
