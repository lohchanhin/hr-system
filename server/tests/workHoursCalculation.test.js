import { jest } from '@jest/globals'

const mockAttendanceRecord = { find: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockEmployee = { findById: jest.fn() }
const mockHoliday = { find: jest.fn() }
const mockHolidayMoveSetting = { find: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn().mockResolvedValue([])

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }))
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }))
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}))
jest.unstable_mockModule('../src/services/nightShiftAllowanceService.js', () => ({
  calculateNightShiftAllowance: jest.fn(),
}))

let calculateWorkHours
let calculateOvertimePay
let calculateLeaveImpact
let __testUtils

beforeAll(async () => {
  ({ calculateWorkHours, calculateOvertimePay, calculateLeaveImpact, __testUtils } = await import('../src/services/workHoursCalculationService.js'))
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
  mockGetAllLeaveFieldInfos.mockReset()
  mockGetAllLeaveFieldInfos.mockResolvedValue([])
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

describe('work-hours calculation: holiday / leave / zero-time shifts are not working time', () => {
  const zero = (_id, code, name, semanticType) => ({
    _id, code, name, startTime: '00:00', endTime: '00:00', breakDuration: 0, semanticType,
  })
  const shifts = [
    { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
    zero('holiday', '國', '國定假日', 'holiday'),
    zero('regular', '例', '例假', 'regular_rest'),
    zero('rest', '休', '休假', 'rest_day'),
    zero('leave', '特', '特休', 'leave'),
    zero('injury', '公傷', '公傷假', 'leave'),
    // 班別性質被預設成 work 的休假類班別：沒有工作時間，也不能算 24 小時
    zero('legacy', 'XX', '未分類', 'work'),
    // 班別性質明確是國定假日，但填了時間
    { _id: 'holiday-timed', code: '國B', name: '國定假日(有時間)', semanticType: 'holiday', startTime: '09:00', endTime: '18:00' },
    { _id: 'night', code: 'N', name: '夜班', semanticType: 'work', startTime: '00:00', endTime: '08:00', crossDay: true, breakDuration: 0 },
  ]
  const ids = ['day', 'holiday', 'regular', 'rest', 'leave', 'injury', 'day']
  const sampleSchedules = ids.map((shiftId, index) => ({
    employee: 'emp1', date: new Date(`2026-06-0${index + 1}T00:00:00.000Z`), shiftId,
  }))

  function mockMonth(schedules, records = []) {
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
    mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts }) })
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(schedules) })
    mockAttendanceRecord.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(records) })
  }

  it('sample month (日, 國, 例, 休, 特, 公傷, 日) schedules 16 hours, not 88', async () => {
    mockMonth(sampleSchedules)

    const result = await calculateWorkHours('emp1', '2026-06-01')

    expect(result.scheduledHours).toBe(16)
    expect(result.workDays).toBe(0)
    expect(result.dailyDetails.map(day => day.scheduledHours)).toEqual([8, 0, 0, 0, 0, 0, 8])
    expect(result.dailyDetails.map(day => day.shiftName)).toEqual(['日班', '國定假日', '例假', '休假', '特休', '公傷假', '日班'])
  })

  it('zero-time or holiday/leave rows never count as a working day even with punches', async () => {
    mockMonth(
      [
        { employee: 'emp1', date: new Date('2026-06-02T00:00:00.000Z'), shiftId: 'holiday' },
        { employee: 'emp1', date: new Date('2026-06-03T00:00:00.000Z'), shiftId: 'legacy' },
        { employee: 'emp1', date: new Date('2026-06-04T00:00:00.000Z'), shiftId: 'holiday-timed' },
        { employee: 'emp1', date: new Date('2026-06-05T00:00:00.000Z'), shiftId: 'day' },
      ],
      [
        { employee: 'emp1', action: 'clockIn', timestamp: new Date('2026-06-02T03:00:00.000Z') },
        { employee: 'emp1', action: 'clockOut', timestamp: new Date('2026-06-02T12:00:00.000Z') },
        { employee: 'emp1', action: 'clockIn', timestamp: new Date('2026-06-04T01:00:00.000Z') },
        { employee: 'emp1', action: 'clockOut', timestamp: new Date('2026-06-04T10:00:00.000Z') },
        { employee: 'emp1', action: 'clockIn', timestamp: new Date('2026-06-05T08:00:00.000Z') },
        { employee: 'emp1', action: 'clockOut', timestamp: new Date('2026-06-05T17:00:00.000Z') },
      ],
    )

    const result = await calculateWorkHours('emp1', '2026-06-01')

    expect(result.workDays).toBe(1)
    expect(result.scheduledHours).toBe(8)
    expect(result.actualWorkHours).toBe(8)
    expect(result.dailyDetails.map(day => [day.date, day.scheduledHours, day.workedHours, day.hasAttendance])).toEqual([
      ['2026-06-02', 0, 0, false],
      ['2026-06-03', 0, 0, false],
      ['2026-06-04', 0, 0, false],
      ['2026-06-05', 8, 8, true],
    ])
  })

  it('a night shift 00:00-08:00 flagged cross-day is 8 scheduled hours, not 32', async () => {
    mockMonth([{ employee: 'emp1', date: new Date('2026-06-01T00:00:00.000Z'), shiftId: 'night' }])

    const result = await calculateWorkHours('emp1', '2026-06-01')

    expect(result.scheduledHours).toBe(8)
  })

  it('computeShiftTimes only adds a day for end<start, or start==end with the cross-day flag', () => {
    const { computeShiftTimes } = __testUtils
    const hours = (shift) => {
      const { start, end } = computeShiftTimes('2026-06-01T00:00:00.000Z', shift)
      return (end.getTime() - start.getTime()) / 3600000
    }
    expect(hours({ startTime: '00:00', endTime: '00:00' })).toBe(0)
    expect(hours({ startTime: '00:00', endTime: '00:00', crossDay: true })).toBe(24)
    expect(hours({ startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(8)
    expect(hours({ startTime: '22:00', endTime: '06:00', crossDay: true })).toBe(8)
    expect(hours({ startTime: '22:00', endTime: '06:00' })).toBe(8)
  })
})

describe('overtime day type uses only counted national holidays', () => {
  const REST_SHIFT = { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }
  const DAY_SHIFT = { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' }
  const HOLIDAY_SHIFT = { _id: 'holiday', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' }

  async function overtimeRecordFor({ date, holidays = [], moves = [], schedules = [], hours = 4 }) {
    mockEmployee.findById.mockResolvedValue({
      _id: 'emp1', autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪',
    })
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        form: { _id: 'form1', name: '加班申請', semanticType: 'overtime' },
        form_data: { hoursField: hours, dateField: date, reasonField: '測試加班' },
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
      lean: jest.fn().mockResolvedValue({ shifts: [REST_SHIFT, DAY_SHIFT, HOLIDAY_SHIFT] }),
    })
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(schedules) })
    mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(holidays) })
    mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(moves) })

    const result = await calculateOvertimePay('emp1', '2026-09-01')
    return result.overtimeRecords[0]
  }

  const scheduleOn = (date, shiftId) => ({ employee: 'emp1', date: new Date(`${date}T00:00:00.000Z`), shiftId })

  it('keeps genuine national holidays at the national-holiday rate (4h = 8h flat day = 1200)', async () => {
    const record = await overtimeRecordFor({
      date: '2026-09-25', // 週五，中秋節
      holidays: [{ date: new Date('2026-09-25T00:00:00.000Z'), type: '國定假日', name: '中秋節', description: '中秋節' }],
      schedules: [scheduleOn('2026-09-25', 'day')],
    })

    expect(record).toEqual(expect.objectContaining({ dayType: 'national_holiday', pay: 1200 }))
  })

  it('keeps rest-day overtime at the rest-day rate', async () => {
    const record = await overtimeRecordFor({
      date: '2026-09-12', // 週六
      schedules: [scheduleOn('2026-09-12', 'rest')],
    })

    // 150 * (2 * 4/3 + 2 * 5/3)
    expect(record).toEqual(expect.objectContaining({ dayType: 'rest_day', pay: 900 }))
  })

  it('ignores weekend documents with an empty description (old ROC import stored every weekend as a holiday)', async () => {
    const weekendDoc = {
      date: new Date('2026-09-12T00:00:00.000Z'), type: '國定假日', name: '假日', desc: '', description: '', source: 'roc-calendar',
    }

    const withRestShift = await overtimeRecordFor({
      date: '2026-09-12',
      holidays: [weekendDoc],
      schedules: [scheduleOn('2026-09-12', 'rest')],
    })
    expect(withRestShift.dayType).toBe('rest_day')

    const withoutSchedule = await overtimeRecordFor({ date: '2026-09-12', holidays: [weekendDoc] })
    expect(withoutSchedule.dayType).toBe('workday')
  })

  it('keeps a manually created weekend holiday (no roc-calendar source) as a national holiday', async () => {
    const manual = {
      date: new Date('2026-09-12T00:00:00.000Z'), type: '國定假日', name: '公司指定假日', source: 'manual',
    }
    const record = await overtimeRecordFor({
      date: '2026-09-12',
      holidays: [manual],
      schedules: [scheduleOn('2026-09-12', 'rest')],
    })
    expect(record.dayType).toBe('national_holiday')
  })

  it('ignores makeup-work / working-day documents', async () => {
    for (const doc of [
      { type: '工作日', name: '補班日', description: '補班' },
      { type: '國定假日', name: '補行上班日', description: '補班' },
      { type: 'makeup work', name: 'Makeup Work Day' },
    ]) {
      const record = await overtimeRecordFor({
        date: '2026-09-12',
        holidays: [{ date: new Date('2026-09-12T00:00:00.000Z'), ...doc }],
        schedules: [scheduleOn('2026-09-12', 'rest')],
      })
      expect(record.dayType).toBe('rest_day')
    }
  })

  it('a 國 schedule row alone does not make a day a national holiday', async () => {
    const record = await overtimeRecordFor({
      date: '2026-09-10',
      schedules: [scheduleOn('2026-09-10', 'holiday')],
    })

    expect(record.dayType).toBe('workday')
  })

  it('applies an enabled holiday move to counted holidays only', async () => {
    const holidays = [{ date: new Date('2026-09-25T00:00:00.000Z'), type: '國定假日', name: '中秋節', description: '中秋節' }]
    const moves = [{
      enableHolidayMove: true,
      sourceDate: new Date('2026-09-25T00:00:00.000Z'),
      targetDate: new Date('2026-09-28T00:00:00.000Z'),
    }]

    const source = await overtimeRecordFor({ date: '2026-09-25', holidays, moves, schedules: [scheduleOn('2026-09-25', 'day')] })
    const target = await overtimeRecordFor({ date: '2026-09-28', holidays, moves, schedules: [scheduleOn('2026-09-28', 'day')] })

    expect(source.dayType).toBe('workday')
    expect(target.dayType).toBe('national_holiday')
  })
})

describe('calculateLeaveImpact', () => {
  // 月薪 30000 → 時薪 125
  const employee = { _id: 'emp1', salaryAmount: 30000, salaryType: '月薪' }
  const MONTH = '2026-09-01'

  // 預設的「請假」：沒有「天數」欄位（開始時間 / 結束時間 / 假別）
  const DEFAULT_FORM = {
    formId: 'default-form',
    startId: 'd-start',
    endId: 'd-end',
    typeId: 'd-type',
    typeOptions: [],
  }
  // 客戶自建的請假表單：假別連結字典 C12，有「天數」欄位
  const CUSTOMER_FORM = {
    formId: 'customer-form',
    startId: 'c-start',
    endId: 'c-end',
    typeId: 'c-type',
    daysId: 'c-days',
    typeOptions: [
      { value: '特休假', label: '特休假' },
      { value: '病假', label: '病假' },
      { value: '事假', label: '事假' },
    ],
  }

  function approvalsByForm(rowsByForm) {
    mockApprovalRequest.find.mockImplementation((filter) => ({
      lean: jest.fn().mockResolvedValue(rowsByForm[filter.form] ?? []),
    }))
  }

  beforeEach(() => {
    mockEmployee.findById.mockResolvedValue(employee)
  })

  it('returns zero everything and does not query approvals when there is no leave form', async () => {
    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result).toEqual({
      leaveHours: 0, paidLeaveHours: 0, unpaidLeaveHours: 0, sickLeaveHours: 0, personalLeaveHours: 0, leaveDeduction: 0, leaveRecords: [],
    })
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })

  it('counts an approved 特休假 of 2 days (天數 = 2) as 2 paid days, not 1', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
    approvalsByForm({
      'customer-form': [{
        form_data: { 'c-type': '特休假', 'c-start': '2026-09-02', 'c-end': '2026-09-03', 'c-days': 2 },
      }],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result).toMatchObject({ leaveHours: 16, paidLeaveHours: 16, unpaidLeaveHours: 0, personalLeaveHours: 0, leaveDeduction: 0 })
    expect(result.leaveRecords).toEqual([{
      leaveType: '特休假',
      startDate: '2026-09-02',
      endDate: '2026-09-03',
      days: 2,
      hours: 16,
      isPaid: true,
    }])
  })

  it('keeps 特休 (the old name) paid and treats 特休假 the same way', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM, CUSTOMER_FORM])
    approvalsByForm({
      'default-form': [{ form_data: { 'd-type': '特休', 'd-start': '2026-09-01', 'd-end': '2026-09-02' } }],
      'customer-form': [{ form_data: { 'c-type': '特休假', 'c-start': '2026-09-08', 'c-end': '2026-09-08', 'c-days': 1 } }],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    // 預設表單沒有天數欄位：沿用日期差（9/1 到 9/2 = 1 天，8 小時），客戶表單 1 天 8 小時
    expect(result).toMatchObject({ leaveHours: 16, paidLeaveHours: 16, unpaidLeaveHours: 0, leaveDeduction: 0 })
  })

  it('deducts a 事假 as unpaid hours using the 天數 field', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
    approvalsByForm({
      'customer-form': [{ form_data: { 'c-type': '事假', 'c-start': '2026-09-10', 'c-end': '2026-09-11', 'c-days': '2' } }],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result).toMatchObject({
      leaveHours: 16, paidLeaveHours: 0, personalLeaveHours: 16, unpaidLeaveHours: 16, leaveDeduction: 2000,
    })
    expect(result.leaveRecords[0]).toMatchObject({ leaveType: '事假', days: 2, hours: 16, isPaid: false })
  })

  it('supports half days from the 天數 field', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
    approvalsByForm({
      'customer-form': [{ form_data: { 'c-type': '特休假', 'c-start': '2026-09-10', 'c-end': '2026-09-10', 'c-days': 0.5 } }],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result).toMatchObject({ leaveHours: 4, paidLeaveHours: 4, leaveDeduction: 0 })
  })

  it('falls back to the date difference exactly as before when the 天數 field is empty or not positive', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
    approvalsByForm({
      'customer-form': [
        { form_data: { 'c-type': '事假', 'c-start': '2026-09-02', 'c-end': '2026-09-05', 'c-days': '' } },
        { form_data: { 'c-type': '事假', 'c-start': '2026-09-08', 'c-end': '2026-09-08', 'c-days': 0 } },
        { form_data: { 'c-type': '事假', 'c-start': '2026-09-09', 'c-end': '2026-09-10', 'c-days': 'abc' } },
        { form_data: { 'c-type': '事假', 'c-start': '2026-09-15', 'c-end': '2026-09-16' } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    // 3 天、至少 1 天、1 天、1 天（日期差不含起始日，同一天補到 1 天）
    expect(result.leaveRecords.map((record) => record.days)).toEqual([3, 1, 1, 1])
    expect(result.leaveHours).toBe(48)
  })

  it('does not change the default 請假 form (no 天數 field): date difference, at least one day', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM])
    approvalsByForm({
      'default-form': [
        { form_data: { 'd-type': '事假', 'd-start': '2026-09-01', 'd-end': '2026-09-03' } },
        { form_data: { 'd-type': '病假', 'd-start': '2026-09-08', 'd-end': '2026-09-08' } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result.leaveRecords.map((record) => [record.leaveType, record.days, record.hours])).toEqual([
      ['事假', 2, 16],
      ['病假', 1, 8],
    ])
    // 事假 16 小時全扣、病假 8 小時扣一半
    expect(result).toMatchObject({ leaveHours: 24, personalLeaveHours: 16, sickLeaveHours: 8, unpaidLeaveHours: 20, leaveDeduction: 2500 })
  })

  it('still honours the literal days / hours keys of old data', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM])
    approvalsByForm({
      'default-form': [
        { form_data: { 'd-type': '事假', days: 2 } },
        { form_data: { 'd-type': '事假', hours: 3 } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result.leaveRecords.map((record) => [record.days, record.hours])).toEqual([[2, 16], [0, 3]])
  })

  it('reads every leave form, one approvals query each, and adds the results together', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM, CUSTOMER_FORM])
    approvalsByForm({
      'default-form': [{ form_data: { 'd-type': '事假', 'd-start': '2026-09-01', 'd-end': '2026-09-02' } }],
      'customer-form': [
        { form_data: { 'c-type': '事假', 'c-start': '2026-09-10', 'c-end': '2026-09-11', 'c-days': 2 } },
        { form_data: { 'c-type': '特休假', 'c-start': '2026-09-14', 'c-end': '2026-09-15', 'c-days': 2 } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(2)
    expect(mockApprovalRequest.find).toHaveBeenCalledWith(expect.objectContaining({
      form: 'default-form', status: 'approved', applicant_employee: 'emp1',
    }))
    expect(mockApprovalRequest.find).toHaveBeenCalledWith(expect.objectContaining({
      form: 'customer-form', status: 'approved', applicant_employee: 'emp1',
    }))
    expect(result).toMatchObject({ leaveHours: 40, paidLeaveHours: 16, personalLeaveHours: 24, unpaidLeaveHours: 24, leaveDeduction: 3000 })
    expect(result.leaveRecords).toHaveLength(3)
  })

  it('resolves the leave type label from the option list of each form', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      ...CUSTOMER_FORM,
      typeOptions: [{ value: 'AL', label: '特休假' }, { value: 'PL', label: '事假' }],
    }])
    approvalsByForm({
      'customer-form': [
        { form_data: { 'c-type': 'AL', 'c-start': '2026-09-02', 'c-end': '2026-09-03', 'c-days': 2 } },
        { form_data: { 'c-type': { label: '事假', value: 'PL' }, 'c-start': '2026-09-08', 'c-end': '2026-09-08', 'c-days': 1 } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result.leaveRecords.map((record) => [record.leaveType, record.isPaid])).toEqual([['特休假', true], ['事假', false]])
    expect(result).toMatchObject({ paidLeaveHours: 16, unpaidLeaveHours: 8, leaveDeduction: 1000 })
  })
})

describe('LEAVE_POLICY annual leave names', () => {
  it('treats both 特休 and 特休假 as paid and shares one constant with the reports', async () => {
    const { ANNUAL_LEAVE_TYPES, LEAVE_POLICY } = await import('../src/config/salaryConfig.js')

    expect(ANNUAL_LEAVE_TYPES).toEqual(['特休', '特休假'])
    for (const name of ANNUAL_LEAVE_TYPES) {
      expect(LEAVE_POLICY.PAID_LEAVE_TYPES).toContain(name)
    }
    // 其餘有薪假別維持原樣，事假仍是無薪
    expect(LEAVE_POLICY.PAID_LEAVE_TYPES).toEqual(expect.arrayContaining(['年假', '婚假', '喪假', '產假', '陪產假']))
    expect(LEAVE_POLICY.UNPAID_LEAVE_TYPES).toContain('事假')
    expect(LEAVE_POLICY.PAID_LEAVE_TYPES).not.toContain('事假')
  })
})
