import { jest } from '@jest/globals'
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js'

const mockAttendanceRecord = { find: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockEmployee = { findById: jest.fn(), find: jest.fn() }
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

const { HolidaySwap, CalendarYear, CompensatoryCredit, CompensatoryLeaveState } = await registerHolidayResolverModelMocks(jest)

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

// 行事曆分類後：國定假日依員工判斷（holidayResolver），加班費不再把公務機關補假當成所有人的國定假日
describe('overtime day type follows the per-employee holiday resolver', () => {
  const EMPLOYEE_ID = '64b7f0c2a1b2c3d4e5f6a001'
  const REST_SHIFT = { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }
  const DAY_SHIFT = { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' }
  const day = (key) => new Date(`${key}T00:00:00.000Z`)
  // 2026 年 2 月：國定假日 2/15～2/19、2/28；公務機關補假 2/20（補 2/15）、2/27（補 2/28）
  const FEBRUARY_2026 = [
    ...['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28']
      .map((key) => ({ date: day(key), kind: 'statutory', type: '國定假日', name: '國定假日', source: 'dgpa' })),
    { date: day('2026-02-20'), kind: 'gov_makeup_off', type: '公務機關補假', name: '補假', source: 'dgpa', compensatesDate: day('2026-02-15') },
    { date: day('2026-02-27'), kind: 'gov_makeup_off', type: '公務機關補假', name: '補假', source: 'dgpa', compensatesDate: day('2026-02-28') },
  ]

  async function overtimeOn({ date, month, employee = {}, storedRegime = null, holidays = FEBRUARY_2026, schedules = [] }) {
    mockEmployee.findById.mockResolvedValue({
      _id: EMPLOYEE_ID, autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪', ...employee,
    })
    // 員工資料沒有假日制度欄位時，判斷模組會自己讀（storedRegime 是資料庫裡的欄位）
    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(storedRegime ? [{ _id: EMPLOYEE_ID, ...storedRegime }] : []),
    })
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        form: { _id: 'form1', name: '加班申請', semanticType: 'overtime' },
        form_data: { hoursField: 4, dateField: date, reasonField: '測試加班' },
      }]),
    })
    mockFormField.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { form: 'form1', _id: 'hoursField', label: '加班時數' },
        { form: 'form1', _id: 'dateField', label: '加班日期' },
        { form: 'form1', _id: 'reasonField', label: '加班原因' },
      ]),
    })
    mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: [REST_SHIFT, DAY_SHIFT] }) })
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(schedules) })
    mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(holidays) })
    mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    const result = await calculateOvertimePay(EMPLOYEE_ID, month)
    return result.overtimeRecords[0]
  }

  beforeEach(() => {
    HolidaySwap.__setRows([])
    CompensatoryCredit.__setRows([])
    CompensatoryLeaveState.__setRows([])
  })

  it('2026-02-20（公務機關補假）：輪班人員是平日，行政人員是國定假日', async () => {
    const roster = await overtimeOn({
      date: '2026-02-20',
      month: '2026-02-01',
      employee: { requiresScheduling: true },
      schedules: [{ employee: EMPLOYEE_ID, date: day('2026-02-20'), shiftId: 'day' }],
    })
    expect(roster).toEqual(expect.objectContaining({ dayType: 'workday', holidayReason: null }))

    const office = await overtimeOn({ date: '2026-02-20', month: '2026-02-01', employee: { requiresScheduling: false } })
    expect(office).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'gov_makeup', pay: 1200 }))
  })

  it('呼叫端帶入的員工資料沒有假日制度欄位（薪資總覽）：自己讀員工的假日制度', async () => {
    mockEmployee.find.mockClear()
    const office = await overtimeOn({ date: '2026-02-20', month: '2026-02-01', storedRegime: { requiresScheduling: false } })
    expect(office).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'gov_makeup' }))
    expect(mockEmployee.find).toHaveBeenCalledWith({ _id: { $in: [EMPLOYEE_ID] } })
    const roster = await overtimeOn({ date: '2026-02-20', month: '2026-02-01', storedRegime: { holidayRegime: 'roster', requiresScheduling: false } })
    expect(roster.dayType).toBe('workday')
  })

  it('國定假日落在輪班人員的休息日仍以國定假日計（2/28 週六）', async () => {
    const record = await overtimeOn({
      date: '2026-02-28',
      month: '2026-02-01',
      schedules: [{ employee: EMPLOYEE_ID, date: day('2026-02-28'), shiftId: 'rest' }],
    })
    expect(record).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'statutory' }))
  })

  it('個人調移：調移日以國定假日計，原國定假日變成平日', async () => {
    HolidaySwap.__setRows([{
      _id: 'swap1', employee: EMPLOYEE_ID, originalDate: day('2026-02-16'), originalName: '農曆除夕', targetDate: day('2026-02-24'), status: 'active',
    }])
    const schedules = [
      { employee: EMPLOYEE_ID, date: day('2026-02-16'), shiftId: 'day' },
      { employee: EMPLOYEE_ID, date: day('2026-02-24'), shiftId: 'day' },
    ]
    const target = await overtimeOn({ date: '2026-02-24', month: '2026-02-01', schedules })
    expect(target).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'swap' }))
    const original = await overtimeOn({ date: '2026-02-16', month: '2026-02-01', schedules })
    expect(original.dayType).toBe('workday')
  })

  // 已排定的補假改存在調休存摺（HR 指定的使用紀錄），和員工自己申請的整天調休一樣以國定假日計
  it('HR 指定的補假日以國定假日計', async () => {
    CompensatoryCredit.__setRows([{
      _id: 'comp1', employee: EMPLOYEE_ID, sourceType: 'holiday_rest', holidayDate: day('2026-02-28'), holidayName: '和平紀念日', status: 'used', hours: 8, usedHours: 8,
      usages: [{ kind: 'hr_assigned', hours: 8, days: [{ date: '2026-03-04', hours: 8 }], fullDayDates: ['2026-03-04'] }],
    }])
    const record = await overtimeOn({
      date: '2026-03-04',
      month: '2026-03-01',
      schedules: [{ employee: EMPLOYEE_ID, date: day('2026-03-04'), shiftId: 'day' }],
    })
    expect(record).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'compensation' }))
  })

  it('調休簽核核准的整天調休日以國定假日計（當天上班是國定假日出勤），只請幾小時的日子仍是平日', async () => {
    CompensatoryCredit.__setRows([
      {
        _id: 'comp2', employee: EMPLOYEE_ID, sourceType: 'holiday_rest', holidayDate: day('2026-02-28'), holidayName: '和平紀念日', status: 'used', hours: 8, usedHours: 8,
        usages: [{ kind: 'leave_request', hours: 8, approvalRequest: 'req1', days: [{ date: '2026-03-05', hours: 8 }], fullDayDates: ['2026-03-05'] }],
      },
      {
        _id: 'comp3', employee: EMPLOYEE_ID, sourceType: 'manual', holidayDate: null, status: 'available', hours: 8, usedHours: 4,
        usages: [{ kind: 'leave_request', hours: 4, approvalRequest: 'req2', days: [{ date: '2026-03-06', hours: 4 }], fullDayDates: [] }],
      },
    ])
    const schedules = [
      { employee: EMPLOYEE_ID, date: day('2026-03-05'), shiftId: 'day' },
      { employee: EMPLOYEE_ID, date: day('2026-03-06'), shiftId: 'day' },
    ]
    const fullDay = await overtimeOn({ date: '2026-03-05', month: '2026-03-01', schedules })
    expect(fullDay).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'compensation', pay: 1200 }))
    const partial = await overtimeOn({ date: '2026-03-06', month: '2026-03-01', schedules })
    expect(partial.dayType).toBe('workday')
  })

  it('調休存摺上線後（切換日之後），行政人員的公務機關補假日（2026-10-26）是平日；用了調休才是國定假日', async () => {
    const OCTOBER_2026 = [
      { date: day('2026-10-10'), kind: 'statutory', type: '國定假日', name: '國慶日', source: 'dgpa' },
      { date: day('2026-10-25'), kind: 'statutory', type: '國定假日', name: '臺灣光復暨金門古寧頭大捷紀念日', source: 'dgpa' },
      { date: day('2026-10-09'), kind: 'gov_makeup_off', type: '公務機關補假', name: '補假', source: 'dgpa', compensatesDate: day('2026-10-10') },
      { date: day('2026-10-26'), kind: 'gov_makeup_off', type: '公務機關補假', name: '補假', source: 'dgpa', compensatesDate: day('2026-10-25') },
    ]
    const office = { date: '2026-10-26', month: '2026-10-01', employee: { requiresScheduling: false }, holidays: OCTOBER_2026 }
    // 沒有切換日（舊資料）：照舊是行政人員的國定假日
    expect(await overtimeOn(office)).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'gov_makeup' }))
    CompensatoryLeaveState.__setRows([{ key: 'bank', officeGovMakeupCutover: '2026-10-23' }])
    const plain = await overtimeOn(office)
    expect(plain).toEqual(expect.objectContaining({ dayType: 'workday', holidayReason: null }))
    // 切換日之前的公務機關補假日照舊（10/9）
    const before = await overtimeOn({ ...office, date: '2026-10-09' })
    expect(before).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'gov_makeup' }))
    CompensatoryCredit.__setRows([{
      _id: 'comp4', employee: EMPLOYEE_ID, sourceType: 'holiday_rest', holidayDate: day('2026-10-25'), holidayName: '臺灣光復暨金門古寧頭大捷紀念日', status: 'used', hours: 8, usedHours: 8,
      usages: [{ kind: 'leave_request', hours: 8, approvalRequest: 'req3', days: [{ date: '2026-10-26', hours: 8 }], fullDayDates: ['2026-10-26'] }],
    }])
    const used = await overtimeOn(office)
    expect(used).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'compensation' }))
  })

  it('沒有班表的行政人員：週六以休息日計，輪班人員維持平日', async () => {
    const office = await overtimeOn({ date: '2026-03-07', month: '2026-03-01', employee: { requiresScheduling: false } })
    expect(office.dayType).toBe('rest_day')
    const explicitOffice = await overtimeOn({ date: '2026-03-07', month: '2026-03-01', employee: { holidayRegime: 'office' } })
    expect(explicitOffice.dayType).toBe('rest_day')
    const roster = await overtimeOn({ date: '2026-03-07', month: '2026-03-01' })
    expect(roster.dayType).toBe('workday')
  })

  describe('整批計算（薪資匯出、薪資總覽 PDF）共用一份國定假日資料', () => {
    const ROSTER_ID = '64b7f0c2a1b2c3d4e5f6a101'
    const OFFICE_ID = '64b7f0c2a1b2c3d4e5f6a102'
    const SWAPPED_ID = '64b7f0c2a1b2c3d4e5f6a103'
    const people = {
      [ROSTER_ID]: { _id: ROSTER_ID, autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪', requiresScheduling: true },
      [OFFICE_ID]: { _id: OFFICE_ID, autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪', requiresScheduling: false },
      [SWAPPED_ID]: { _id: SWAPPED_ID, autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪', requiresScheduling: true },
    }

    // 三個人都在 2026-02-20（公務機關補假）加班 4 小時；SWAPPED 把 2/16 個人調移到 2/20
    function mockBatchLookups() {
      mockEmployee.find.mockClear()
      HolidaySwap.find.mockClear()
      CompensatoryCredit.find.mockClear()
      CalendarYear.find.mockClear()
      mockEmployee.findById.mockImplementation(async (id) => people[String(id)] ?? null)
      mockEmployee.find.mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) })
      mockApprovalRequest.find.mockImplementation(() => ({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{
          form: { _id: 'form1', name: '加班申請', semanticType: 'overtime' },
          form_data: { hoursField: 4, dateField: '2026-02-20', reasonField: '測試加班' },
        }]),
      }))
      mockFormField.find.mockImplementation(() => ({
        lean: jest.fn().mockResolvedValue([
          { form: 'form1', _id: 'hoursField', label: '加班時數' },
          { form: 'form1', _id: 'dateField', label: '加班日期' },
          { form: 'form1', _id: 'reasonField', label: '加班原因' },
        ]),
      }))
      mockAttendanceSetting.findOne.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue({ shifts: [REST_SHIFT, DAY_SHIFT] }) }))
      mockShiftSchedule.find.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue([]) }))
      mockHoliday.find.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(FEBRUARY_2026) }))
      mockHolidayMoveSetting.find.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue([]) }))
      HolidaySwap.__setRows([{
        _id: 'swap1', employee: SWAPPED_ID, originalDate: day('2026-02-16'), originalName: '農曆除夕', targetDate: day('2026-02-20'), status: 'active',
      }])
    }

    const runBatch = (payrollBatch, ids) => Promise.all(ids.map((id) => (
      calculateOvertimePay(id, '2026-02-01', { payrollBatch }).then((result) => result.overtimeRecords[0])
    )))

    it('reads the holiday calendar once for the whole batch and gives every employee the same answer as a single calculation', async () => {
      mockBatchLookups()

      const payrollBatch = { employees: Object.values(people) }
      const [roster, office, swapped] = await runBatch(payrollBatch, [ROSTER_ID, OFFICE_ID, SWAPPED_ID])

      expect(roster).toEqual(expect.objectContaining({ dayType: 'workday', holidayReason: null }))
      expect(office).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'gov_makeup', pay: 1200 }))
      expect(swapped).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'swap' }))
      // 3 位員工，國定假日相關查詢各只有 1 次（逐人計算是各 3 次）
      expect(mockHoliday.find).toHaveBeenCalledTimes(1)
      expect(mockHolidayMoveSetting.find).toHaveBeenCalledTimes(1)
      expect(CalendarYear.find).toHaveBeenCalledTimes(1)
      expect(HolidaySwap.find).toHaveBeenCalledTimes(1)
      expect(CompensatoryCredit.find).toHaveBeenCalledTimes(1)
      expect(HolidaySwap.find.mock.calls[0][0].employee.$in).toEqual([ROSTER_ID, OFFICE_ID, SWAPPED_ID])
      // 員工資料已有假日制度欄位：不再另外讀員工
      expect(mockEmployee.find).not.toHaveBeenCalled()

      // 與單人計算（沒有 payrollBatch）結果相同
      mockHoliday.find.mockClear()
      const single = await Promise.all([ROSTER_ID, OFFICE_ID, SWAPPED_ID].map((id) => (
        calculateOvertimePay(id, '2026-02-01').then((result) => result.overtimeRecords[0])
      )))
      expect(single).toEqual([roster, office, swapped])
      expect(mockHoliday.find).toHaveBeenCalledTimes(3)
    })

    it('reads the holiday regime of employees loaded without holiday fields once for the batch (薪資總覽 PDF)', async () => {
      mockBatchLookups()
      mockEmployee.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: OFFICE_ID, requiresScheduling: false }, { _id: ROSTER_ID, requiresScheduling: true }]),
      })
      // 只選了薪資欄位的員工資料（沒有假日制度欄位）
      const payrollBatch = { employees: [{ _id: ROSTER_ID, salaryAmount: 36000 }, { _id: OFFICE_ID, salaryAmount: 36000 }] }
      const [roster, office] = await runBatch(payrollBatch, [ROSTER_ID, OFFICE_ID])

      expect(roster.dayType).toBe('workday')
      expect(office).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'gov_makeup' }))
      expect(mockEmployee.find).toHaveBeenCalledTimes(1)
      expect(mockEmployee.find).toHaveBeenCalledWith({ _id: { $in: [ROSTER_ID, OFFICE_ID] } })
      expect(mockHoliday.find).toHaveBeenCalledTimes(1)
    })

    it('falls back to a per-employee read for an employee outside the batch or when the shared read fails', async () => {
      mockBatchLookups()
      // 不在這一批的員工：只讀他自己的資料（個人調移仍算得到）
      const outside = await runBatch({ employees: [people[ROSTER_ID]] }, [ROSTER_ID, SWAPPED_ID])
      expect(outside[1]).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'swap' }))
      expect(mockHoliday.find).toHaveBeenCalledTimes(2)

      // 共用資料讀取失敗：只記錄錯誤類型，每位員工改為各自讀取，結果不變
      mockHoliday.find.mockClear()
      mockHoliday.find
        .mockImplementationOnce(() => ({ lean: jest.fn().mockRejectedValue(new TypeError('connection reset')) }))
        .mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(FEBRUARY_2026) }))
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const [roster, office] = await runBatch({ employees: [people[ROSTER_ID], people[OFFICE_ID]] }, [ROSTER_ID, OFFICE_ID])
        expect(roster.dayType).toBe('workday')
        expect(office).toEqual(expect.objectContaining({ dayType: 'national_holiday', holidayReason: 'gov_makeup' }))
        expect(mockHoliday.find).toHaveBeenCalledTimes(3)
        expect(errorSpy).toHaveBeenCalledTimes(1)
        expect(errorSpy).toHaveBeenCalledWith('Failed to load the shared holiday calendar for a payroll batch', 'TypeError')
      } finally {
        errorSpy.mockRestore()
      }
    })
  })

  it('__testUtils.resolveOvertimeDayType(dateKey, holidayContext, employee, shift)', async () => {
    const { createHolidayContext } = await import('../src/services/holidayResolver.js')
    const ctx = createHolidayContext({ start: '2026-02-01', end: '2026-03-01', rows: FEBRUARY_2026 })
    const { resolveOvertimeDayType } = __testUtils
    expect(resolveOvertimeDayType('2026-02-20', ctx, { _id: 'n', requiresScheduling: true }, DAY_SHIFT)).toBe('workday')
    expect(resolveOvertimeDayType('2026-02-20', ctx, { _id: 'o', requiresScheduling: false }, undefined)).toBe('national_holiday')
    expect(resolveOvertimeDayType('2026-02-11', ctx, { _id: 'n' }, REST_SHIFT)).toBe('rest_day')
    expect(resolveOvertimeDayType('2026-02-11', ctx, { _id: 'n' }, DAY_SHIFT)).toBe('workday')
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
      payRate: 1,
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

    // 預設表單沒有天數欄位：由日期推算，9/1 到 9/2 含頭尾是 2 天（16 小時），客戶表單 1 天 8 小時
    expect(result).toMatchObject({ leaveHours: 24, paidLeaveHours: 24, unpaidLeaveHours: 0, leaveDeduction: 0 })
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

  it('falls back to the calendar days of the dates (both ends included) when the 天數 field is empty or not positive', async () => {
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

    // 9/2-9/5 是 4 天、9/8 當天是 1 天、9/9-9/10 是 2 天、9/15-9/16 是 2 天（舊算法用日期差，少算了結束那一天）
    expect(result.leaveRecords.map((record) => record.days)).toEqual([4, 1, 2, 2])
    expect(result.leaveHours).toBe(72)
  })

  it('derives the hours of the default 請假 form (no 天數 field) from its dates, both ends included', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM])
    approvalsByForm({
      'default-form': [
        { form_data: { 'd-type': '事假', 'd-start': '2026-09-01', 'd-end': '2026-09-03' } },
        { form_data: { 'd-type': '病假', 'd-start': '2026-09-08', 'd-end': '2026-09-08' } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', MONTH)

    expect(result.leaveRecords.map((record) => [record.leaveType, record.days, record.hours])).toEqual([
      ['事假', 3, 24],
      ['病假', 1, 8],
    ])
    // 事假 24 小時全扣、病假 8 小時扣一半
    expect(result).toMatchObject({ leaveHours: 32, personalLeaveHours: 24, sickLeaveHours: 8, unpaidLeaveHours: 28, leaveDeduction: 3500 })
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
    // 預設表單 9/1-9/2 是 2 天（16 小時）事假，客戶表單 2 天事假 + 2 天特休假
    expect(result).toMatchObject({ leaveHours: 48, paidLeaveHours: 16, personalLeaveHours: 32, unpaidLeaveHours: 32, leaveDeduction: 4000 })
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
  it('treats 特休, 特休假 and 特別休假 as paid and shares one constant with the reports', async () => {
    const { ANNUAL_LEAVE_TYPES, LEAVE_POLICY } = await import('../src/config/salaryConfig.js')

    expect(ANNUAL_LEAVE_TYPES).toEqual(['特休', '特休假', '特別休假'])
    for (const name of ANNUAL_LEAVE_TYPES) {
      expect(LEAVE_POLICY.PAID_LEAVE_TYPES).toContain(name)
    }
    // 其餘有薪假別維持原樣，事假仍是無薪
    expect(LEAVE_POLICY.PAID_LEAVE_TYPES).toEqual(expect.arrayContaining(['年假', '婚假', '喪假', '產假', '陪產假']))
    expect(LEAVE_POLICY.UNPAID_LEAVE_TYPES).toContain('事假')
    expect(LEAVE_POLICY.PAID_LEAVE_TYPES).not.toContain('事假')
  })
})
