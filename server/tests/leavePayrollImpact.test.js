import { jest } from '@jest/globals'

// 請假與加班對薪資的影響：依請假日期（台灣時間）歸屬月份、跨月拆分、假別給薪對照表、日薪與時薪、凌晨加班。

const mockAttendanceRecord = { find: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockEmployee = { findById: jest.fn() }
const mockHoliday = { find: jest.fn() }
const mockHolidayMoveSetting = { find: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()

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

let calculateLeaveImpact
let calculateOvertimePay
let calculateCompleteWorkData

beforeAll(async () => {
  ;({ calculateLeaveImpact, calculateOvertimePay, calculateCompleteWorkData } = await import('../src/services/workHoursCalculationService.js'))
})

beforeEach(() => {
  mockEmployee.findById.mockReset()
  mockApprovalRequest.find.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockShiftSchedule.find.mockReset()
  mockAttendanceRecord.find.mockReset()
  mockHoliday.find.mockReset()
  mockHolidayMoveSetting.find.mockReset()
  mockFormField.find.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
})

// 月薪 30000 → 時薪 125
const MONTHLY = { _id: 'emp1', salaryAmount: 30000, salaryType: '月薪' }

const DEFAULT_FORM = {
  formId: 'default-form', startId: 'd-start', endId: 'd-end', typeId: 'd-type', typeOptions: [],
}
const CUSTOMER_FORM = {
  formId: 'customer-form',
  startId: 'c-start',
  endId: 'c-end',
  typeId: 'c-type',
  daysId: 'c-days',
  typeOptions: [{ value: '特休假', label: '特休假' }, { value: '病假', label: '病假' }, { value: '事假', label: '事假' }],
}

function approvalsByForm(rowsByForm) {
  mockApprovalRequest.find.mockImplementation((filter) => ({
    lean: jest.fn().mockResolvedValue(rowsByForm[filter.form] ?? []),
  }))
}

const customerLeave = (type, start, end, extra = {}) => ({
  form_data: { 'c-type': type, 'c-start': start, 'c-end': end, ...extra },
})

describe('leave is counted in the month the leave dates fall in', () => {
  beforeEach(() => {
    mockEmployee.findById.mockResolvedValue(MONTHLY)
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
  })

  it('does not charge a leave filed in September for October to September', async () => {
    approvalsByForm({
      // 9 月送簽（createdAt）、10/16-10/17 的事假
      'customer-form': [{ createdAt: new Date('2026-09-20T03:00:00.000Z'), ...customerLeave('事假', '2026-10-16', '2026-10-17', { 'c-days': 2 }) }],
    })

    const september = await calculateLeaveImpact('emp1', '2026-09-01')
    const october = await calculateLeaveImpact('emp1', '2026-10-01')

    expect(september).toMatchObject({ leaveHours: 0, leaveDeduction: 0, leaveRecords: [] })
    expect(october).toMatchObject({ leaveHours: 16, personalLeaveHours: 16, leaveDeduction: 2000 })
    expect(october.leaveRecords).toEqual([{
      leaveType: '事假', startDate: '2026-10-16', endDate: '2026-10-17', days: 2, hours: 16, payRate: 0, isPaid: false,
    }])
  })

  it('splits a leave that crosses a month end into the two months', async () => {
    approvalsByForm({
      'customer-form': [{ createdAt: new Date('2026-10-20T03:00:00.000Z'), ...customerLeave('事假', '2026-10-30', '2026-11-03') }],
    })

    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    // 10/30、10/31 兩天，11/1-11/3 三天
    expect(october.leaveHours).toBe(16)
    expect(november.leaveHours).toBe(24)
    expect(october.leaveDeduction).toBe(2000)
    expect(november.leaveDeduction).toBe(3000)
    expect(october.leaveRecords[0]).toMatchObject({ days: 2, hours: 16, totalDays: 5, totalHours: 40, startDate: '2026-10-30', endDate: '2026-11-03' })
    expect(november.leaveRecords[0]).toMatchObject({ days: 3, hours: 24, totalDays: 5, totalHours: 40 })
  })

  it('spreads the filled 天數 over the days of a leave that crosses a month end', async () => {
    approvalsByForm({
      'customer-form': [customerLeave('特休假', '2026-10-30', '2026-11-02', { 'c-days': 4 })],
    })

    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    expect(october.leaveHours).toBe(16)
    expect(november.leaveHours).toBe(16)
    expect(october.leaveHours + november.leaveHours).toBe(32)
  })

  it('reads the dates in Taipei time (a leave picked as 11/1 sent as 10/31 16:00 UTC is a November leave)', async () => {
    approvalsByForm({
      'customer-form': [customerLeave('事假', '2026-10-31T16:00:00.000Z', '2026-10-31T16:00:00.000Z', { 'c-days': 1 })],
    })

    expect((await calculateLeaveImpact('emp1', '2026-10-01')).leaveHours).toBe(0)
    expect((await calculateLeaveImpact('emp1', '2026-11-01')).leaveHours).toBe(8)
  })

  it('counts 4 hours of 事假 as 4 hours (500), not a whole day', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM])
    approvalsByForm({
      // 台灣 9/13 09:00-13:00
      'default-form': [{ form_data: { 'd-type': '事假', 'd-start': '2026-09-13T01:00:00.000Z', 'd-end': '2026-09-13T05:00:00.000Z' } }],
    })

    const result = await calculateLeaveImpact('emp1', '2026-09-01')

    expect(result).toMatchObject({ leaveHours: 4, personalLeaveHours: 4, unpaidLeaveHours: 4, leaveDeduction: 500 })
    expect(result.leaveRecords[0]).toMatchObject({ days: 0.5, hours: 4 })
  })

  it('counts a 2 day 事假 as 2 days and a 3 day 病假 as 3 days at half pay', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM])
    approvalsByForm({
      'default-form': [
        { form_data: { 'd-type': '事假', 'd-start': '2026-09-07', 'd-end': '2026-09-08' } },
        { form_data: { 'd-type': '病假', 'd-start': '2026-09-14', 'd-end': '2026-09-16' } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', '2026-09-01')

    expect(result.leaveRecords.map((record) => [record.leaveType, record.days, record.hours])).toEqual([['事假', 2, 16], ['病假', 3, 24]])
    // 事假 16 小時全扣，病假 24 小時扣一半 12 小時：28 小時 * 125
    expect(result).toMatchObject({ leaveHours: 40, personalLeaveHours: 16, sickLeaveHours: 24, unpaidLeaveHours: 28, leaveDeduction: 3500 })
  })

  it('pays a 特休假 of 2 days (天數 = 2) as 16 paid hours without any deduction', async () => {
    approvalsByForm({
      'customer-form': [customerLeave('特休假', '2026-09-02', '2026-09-03', { 'c-days': 2 })],
    })

    const result = await calculateLeaveImpact('emp1', '2026-09-01')

    expect(result).toMatchObject({ leaveHours: 16, paidLeaveHours: 16, unpaidLeaveHours: 0, leaveDeduction: 0 })
    expect(result.leaveRecords[0]).toMatchObject({ leaveType: '特休假', hours: 16, payRate: 1, isPaid: true })
  })

  it('falls back to the filing month only for old data that has no leave dates at all', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([DEFAULT_FORM])
    approvalsByForm({
      'default-form': [
        { createdAt: new Date('2026-09-10T03:00:00.000Z'), form_data: { 'd-type': '事假', days: 1 } },
        { createdAt: new Date('2026-10-10T03:00:00.000Z'), form_data: { 'd-type': '事假', days: 2 } },
      ],
    })

    const result = await calculateLeaveImpact('emp1', '2026-09-01')

    expect(result.leaveRecords.map((record) => record.hours)).toEqual([8])
  })

  it('asks for every approved request of the employee without a filing date filter', async () => {
    approvalsByForm({})

    await calculateLeaveImpact('emp1', '2026-09-01')

    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      form: 'customer-form', status: 'approved', applicant_employee: 'emp1',
    })
  })
})

describe('paid / unpaid / half pay follows the leave type table', () => {
  beforeEach(() => {
    mockEmployee.findById.mockResolvedValue(MONTHLY)
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
  })

  async function impactOf(leaveType) {
    approvalsByForm({ 'customer-form': [customerLeave(leaveType, '2026-09-02', '2026-09-02', { 'c-days': 1 })] })
    return calculateLeaveImpact('emp1', '2026-09-01')
  }

  it.each([
    '特休', '特休假', '公假', '補休', '休假', '公傷假', '婚假', '喪假', '產假', '陪產假', '產檢假', '年假',
  ])('pays %s in full', async (leaveType) => {
    const result = await impactOf(leaveType)

    expect(result).toMatchObject({ paidLeaveHours: 8, unpaidLeaveHours: 0, leaveDeduction: 0 })
    expect(result.leaveRecords[0]).toMatchObject({ payRate: 1, isPaid: true })
  })

  it.each(['病假', '生理假'])('pays %s at half rate', async (leaveType) => {
    const result = await impactOf(leaveType)

    expect(result).toMatchObject({ sickLeaveHours: 8, paidLeaveHours: 0, unpaidLeaveHours: 4, leaveDeduction: 500 })
    expect(result.leaveRecords[0]).toMatchObject({ payRate: 0.5, isPaid: true })
  })

  it.each(['事假', '家庭照顧假', '無薪假'])('does not pay %s', async (leaveType) => {
    const result = await impactOf(leaveType)

    expect(result).toMatchObject({ personalLeaveHours: 8, unpaidLeaveHours: 8, leaveDeduction: 1000 })
    expect(result.leaveRecords[0]).toMatchObject({ payRate: 0, isPaid: false })
  })

  it('treats a leave type that is not in the table as unpaid, and says so in isPaid', async () => {
    const result = await impactOf('颱風假')

    expect(result).toMatchObject({ unpaidLeaveHours: 8, personalLeaveHours: 0, leaveDeduction: 1000 })
    expect(result.leaveRecords[0]).toMatchObject({ payRate: 0, isPaid: false })
  })

  it('recognises a dictionary item that only contains a table name', async () => {
    const result = await impactOf('特休假（上午）')

    expect(result).toMatchObject({ paidLeaveHours: 8, leaveDeduction: 0 })
  })
})

describe('daily-wage and hourly employees', () => {
  const day = (iso) => new Date(`${iso}T00:00:00.000Z`)
  const shifts = [{ _id: 'day', code: 'D', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 }]

  // 9/1-9/3 三天出勤（8 小時），9/4 沒有出勤
  function attendanceContext(employee) {
    const schedules = ['2026-09-01', '2026-09-02', '2026-09-03'].map((iso) => ({ employee: 'emp1', date: day(iso), shiftId: 'day' }))
    const records = ['2026-09-01', '2026-09-02', '2026-09-03'].flatMap((iso) => [
      { employee: 'emp1', action: 'clockIn', timestamp: new Date(`${iso}T00:00:00.000Z`) },
      { employee: 'emp1', action: 'clockOut', timestamp: new Date(`${iso}T09:00:00.000Z`) },
    ])
    return { employee, attendanceSetting: { shifts }, schedules, attendanceRecords: records }
  }

  async function workData(employee, leaveRows = []) {
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
    approvalsByForm({ 'customer-form': leaveRows })
    return calculateCompleteWorkData('emp1', '2026-09-01', attendanceContext(employee))
  }

  describe('日薪 1000', () => {
    const DAILY = { _id: 'emp1', salaryAmount: 1000, salaryType: '日薪' }

    it('pays only the worked days when there is no leave', async () => {
      const data = await workData(DAILY)

      expect(data).toMatchObject({ workDays: 3, baseSalary: 3000 })
    })

    it('pays an approved 特休 day (3 worked days + 1 paid leave day = 4000)', async () => {
      const data = await workData(DAILY, [customerLeave('特休假', '2026-09-04', '2026-09-04', { 'c-days': 1 })])

      expect(data).toMatchObject({ paidLeaveHours: 8, leaveDeduction: 0, baseSalary: 4000 })
    })

    it('does not deduct an unpaid 事假 day a second time (the day was simply not worked = 3000)', async () => {
      const data = await workData(DAILY, [customerLeave('事假', '2026-09-04', '2026-09-04', { 'c-days': 1 })])

      expect(data).toMatchObject({ unpaidLeaveHours: 8, leaveDeduction: 0, baseSalary: 3000 })
    })

    it('pays half a day for a 病假 day', async () => {
      const data = await workData(DAILY, [customerLeave('病假', '2026-09-04', '2026-09-04', { 'c-days': 1 })])

      expect(data).toMatchObject({ sickLeaveHours: 8, leaveDeduction: 0, baseSalary: 3500 })
    })

    it('pays a half day of 特休假 as half a day', async () => {
      const data = await workData(DAILY, [customerLeave('特休假', '2026-09-04', '2026-09-04', { 'c-days': 0.5 })])

      expect(data.baseSalary).toBe(3500)
    })
  })

  describe('時薪 125', () => {
    const HOURLY = { _id: 'emp1', salaryAmount: 125, salaryType: '時薪' }

    it('pays the worked hours plus the paid leave hours and never deducts leave again', async () => {
      const worked = await workData(HOURLY)
      // 每天 9 小時打卡扣 1 小時休息 = 8 小時，三天 24 小時
      expect(worked).toMatchObject({ actualWorkHours: 24, baseSalary: 3000 })

      const withPaid = await workData(HOURLY, [customerLeave('特休假', '2026-09-04', '2026-09-04', { 'c-days': 1 })])
      expect(withPaid.baseSalary).toBe(4000)

      const withUnpaid = await workData(HOURLY, [customerLeave('事假', '2026-09-04', '2026-09-04', { 'c-days': 1 })])
      expect(withUnpaid).toMatchObject({ leaveDeduction: 0, baseSalary: 3000 })
    })
  })

  describe('月薪', () => {
    it('still deducts unpaid leave from the monthly salary and leaves paid leave alone', async () => {
      const data = await workData(MONTHLY, [
        customerLeave('事假', '2026-09-04', '2026-09-04', { 'c-days': 1 }),
        customerLeave('特休假', '2026-09-07', '2026-09-07', { 'c-days': 1 }),
      ])

      expect(data).toMatchObject({ leaveDeduction: 1000, baseSalary: 29000 })
    })
  })
})

describe('overtime date and month are Taipei dates', () => {
  const OT_EMPLOYEE = { _id: 'emp1', autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪' }
  const REST_SHIFT = { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }
  const DAY_SHIFT = { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' }

  function overtimeRequest(start, end, form = { _id: 'form1', name: '加班申請', semanticType: 'overtime' }) {
    return {
      form,
      form_data: { startField: start, endField: end, reasonField: '趕工' },
    }
  }

  async function overtimeIn(month, requests, schedules = []) {
    mockEmployee.findById.mockResolvedValue(OT_EMPLOYEE)
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(requests),
    })
    mockFormField.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { form: 'form1', _id: 'startField', label: '開始時間' },
        { form: 'form1', _id: 'endField', label: '結束時間' },
        { form: 'form1', _id: 'reasonField', label: '事由' },
      ]),
    })
    mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: [REST_SHIFT, DAY_SHIFT] }) })
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(schedules) })
    mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    return calculateOvertimePay('emp1', month)
  }

  it('pays overtime on 11/1 06:00 Taipei in November, not October', async () => {
    // 台灣 11/1 06:00-09:00 = UTC 10/31 22:00 - 11/1 01:00
    const request = overtimeRequest('2026-10-31T22:00:00.000Z', '2026-11-01T01:00:00.000Z')

    const october = await overtimeIn('2026-10-01', [request])
    const november = await overtimeIn('2026-11-01', [request])

    expect(october.overtimeRecords).toEqual([])
    expect(november.overtimeHours).toBe(3)
    expect(november.overtimeRecords[0]).toMatchObject({ date: '2026-11-01', hours: 3 })
  })

  it('prices early-morning overtime on a rest day as rest-day overtime (the schedule of that Taipei day)', async () => {
    // 台灣 10/17 06:00-09:00 = UTC 10/16 22:00 - 10/17 01:00；10/17 排休息日，10/16 排日班
    const request = overtimeRequest('2026-10-16T22:00:00.000Z', '2026-10-17T01:00:00.000Z')
    const schedules = [
      { employee: 'emp1', date: new Date('2026-10-16T00:00:00.000Z'), shiftId: 'day' },
      { employee: 'emp1', date: new Date('2026-10-17T00:00:00.000Z'), shiftId: 'rest' },
    ]

    const result = await overtimeIn('2026-10-01', [request], schedules)

    expect(result.overtimeRecords[0]).toMatchObject({ date: '2026-10-17', dayType: 'rest_day', hours: 3 })
  })

  it('still dates an evening overtime to its own Taipei day', async () => {
    // 台灣 10/17 19:00-22:00
    const request = overtimeRequest('2026-10-17T11:00:00.000Z', '2026-10-17T14:00:00.000Z')

    const result = await overtimeIn('2026-10-01', [request], [{ employee: 'emp1', date: new Date('2026-10-17T00:00:00.000Z'), shiftId: 'rest' }])

    expect(result.overtimeRecords[0]).toMatchObject({ date: '2026-10-17', dayType: 'rest_day' })
  })

  it('decides by the form type: a 加班費申請 form marked 一般 is not overtime, a renamed form marked 加班 is', async () => {
    const money = overtimeRequest('2026-10-17T11:00:00.000Z', '2026-10-17T14:00:00.000Z', { _id: 'form1', name: '加班費申請', semanticType: 'general' })
    const renamed = overtimeRequest('2026-10-17T11:00:00.000Z', '2026-10-17T14:00:00.000Z', { _id: 'form1', name: '延長工時單', semanticType: 'overtime' })
    const legacy = overtimeRequest('2026-10-17T11:00:00.000Z', '2026-10-17T14:00:00.000Z', { _id: 'form1', name: '加班單' })

    expect((await overtimeIn('2026-10-01', [money])).overtimeRecords).toEqual([])
    expect((await overtimeIn('2026-10-01', [renamed])).overtimeRecords).toHaveLength(1)
    expect((await overtimeIn('2026-10-01', [legacy])).overtimeRecords).toHaveLength(1)
  })
})

// 日薪：有出勤的那一天（算整天）請了部分有薪假，假不能再加一次；只有沒出勤的日子才依有薪請假時數加計
describe('daily wage with a partial-day paid leave on a worked day', () => {
  const day = (iso) => new Date(`${iso}T00:00:00.000Z`)
  // 日班 09:00-18:00（扣 60 分鐘午休，排定 8 小時）
  const shifts = [{ _id: 'day', code: 'D', name: '日班', semanticType: 'work', startTime: '09:00', endTime: '18:00', breakDuration: 60 }]
  const DAILY_2000 = { _id: 'emp1', salaryAmount: 2000, salaryType: '日薪' }
  const HOURLY_250 = { _id: 'emp1', salaryAmount: 250, salaryType: '時薪' }
  const MONTHLY_30000 = { _id: 'emp1', salaryAmount: 30000, salaryType: '月薪' }
  // 台灣 9/1 13:00-18:00 的特休（5 小時有薪）= UTC 05:00-10:00
  const AFTERNOON_LEAVE = customerLeave('特休假', '2026-09-01T05:00:00.000Z', '2026-09-01T10:00:00.000Z')

  // 9/1 只上半天（台灣 09:00-14:00 打卡，扣午休 = 4 小時），9/2 上滿 8 小時，9/3 沒出勤
  function context(employee) {
    const schedules = ['2026-09-01', '2026-09-02', '2026-09-03'].map((iso) => ({ employee: 'emp1', date: day(iso), shiftId: 'day' }))
    const records = [
      { employee: 'emp1', action: 'clockIn', timestamp: new Date('2026-09-01T01:00:00.000Z') },
      { employee: 'emp1', action: 'clockOut', timestamp: new Date('2026-09-01T06:00:00.000Z') },
      { employee: 'emp1', action: 'clockIn', timestamp: new Date('2026-09-02T01:00:00.000Z') },
      { employee: 'emp1', action: 'clockOut', timestamp: new Date('2026-09-02T10:00:00.000Z') },
    ]
    return { employee, attendanceSetting: { shifts }, schedules, attendanceRecords: records }
  }

  async function workData(employee, leaveRows = []) {
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
    approvalsByForm({ 'customer-form': leaveRows })
    return calculateCompleteWorkData('emp1', '2026-09-01', context(employee))
  }

  it('pays the day worked 4 hours plus 5 hours of paid leave once (2000), not 3250', async () => {
    const without = await workData(DAILY_2000)
    const withLeave = await workData(DAILY_2000, [AFTERNOON_LEAVE])

    expect(without).toMatchObject({ workDays: 2, baseSalary: 4000 })
    expect(withLeave).toMatchObject({ workDays: 2, leaveHours: 5, paidLeaveHours: 5, baseSalary: 4000 })
    // 這一天的 4 小時出勤 + 5 小時有薪假只領一天日薪：全月 2 天出勤共 4000
    expect(withLeave.dailyDetails[0]).toMatchObject({ date: '2026-09-01', workedHours: 4, scheduledHours: 8, hasAttendance: true })
  })

  it('still pays a paid-leave day nobody worked (the leave day adds one day)', async () => {
    const data = await workData(DAILY_2000, [customerLeave('特休假', '2026-09-03', '2026-09-03', { 'c-days': 1 })])

    expect(data).toMatchObject({ workDays: 2, paidLeaveHours: 8, baseSalary: 6000 })
  })

  it('pays the paid-leave hours of a day nobody worked in proportion, and leave on a worked day adds nothing', async () => {
    const data = await workData(DAILY_2000, [
      AFTERNOON_LEAVE,
      // 9/3 沒出勤，台灣 09:00-13:00 的特休 4 小時 = 半天
      customerLeave('特休假', '2026-09-03T01:00:00.000Z', '2026-09-03T05:00:00.000Z'),
    ])

    expect(data).toMatchObject({ paidLeaveHours: 9, baseSalary: 5000 })
  })

  it('never pays more than one day for a day, even when two leave requests cover the same day', async () => {
    const data = await workData(DAILY_2000, [
      customerLeave('特休假', '2026-09-03', '2026-09-03', { 'c-days': 1 }),
      customerLeave('公假', '2026-09-03', '2026-09-03', { 'c-days': 1 }),
    ])

    expect(data).toMatchObject({ paidLeaveHours: 16, baseSalary: 6000 })
  })

  it('pays half a day for sick leave on a day nobody worked, and nothing for unpaid leave on a worked day', async () => {
    const data = await workData(DAILY_2000, [
      customerLeave('病假', '2026-09-03', '2026-09-03', { 'c-days': 1 }),
      customerLeave('事假', '2026-09-01T05:00:00.000Z', '2026-09-01T10:00:00.000Z'),
    ])

    expect(data).toMatchObject({ sickLeaveHours: 8, personalLeaveHours: 5, leaveDeduction: 0, baseSalary: 5000 })
  })

  it('splits a multi-day paid leave over its days: worked days add nothing, the rest add a day each', async () => {
    const data = await workData(DAILY_2000, [customerLeave('特休假', '2026-09-02', '2026-09-04', { 'c-days': 3 })])

    // 9/2 有出勤不加，9/3、9/4 各加一天
    expect(data).toMatchObject({ paidLeaveHours: 24, baseSalary: 8000 })
  })

  it('converts the hours of old leave data without dates into days, as before', async () => {
    const data = await workData(DAILY_2000, [
      { createdAt: new Date('2026-09-10T03:00:00.000Z'), form_data: { 'c-type': '特休假', days: 1 } },
    ])

    expect(data).toMatchObject({ paidLeaveHours: 8, baseSalary: 6000 })
  })

  it('leaves the hourly result unchanged (worked hours plus paid leave hours)', async () => {
    const data = await workData(HOURLY_250, [AFTERNOON_LEAVE])

    // 出勤 4 + 8 = 12 小時，加 5 小時有薪假
    expect(data).toMatchObject({ actualWorkHours: 12, paidLeaveHours: 5, baseSalary: 17 * 250 })
  })

  it('leaves the monthly result unchanged (only unpaid leave is deducted)', async () => {
    const data = await workData(MONTHLY_30000, [
      AFTERNOON_LEAVE,
      customerLeave('事假', '2026-09-03', '2026-09-03', { 'c-days': 1 }),
    ])

    expect(data).toMatchObject({ leaveDeduction: 1000, baseSalary: 29000 })
  })

  it('does not return the daily breakdown from calculateLeaveImpact unless asked', async () => {
    mockEmployee.findById.mockResolvedValue(DAILY_2000)
    mockGetAllLeaveFieldInfos.mockResolvedValue([CUSTOMER_FORM])
    approvalsByForm({ 'customer-form': [AFTERNOON_LEAVE] })

    const plain = await calculateLeaveImpact('emp1', '2026-09-01')
    const detailed = await calculateLeaveImpact('emp1', '2026-09-01', {}, { withDailyBreakdown: true })

    expect(plain).not.toHaveProperty('payableLeaveByDay')
    expect(detailed.payableLeaveByDay).toEqual({ '2026-09-01': 5 })
    expect(detailed.undatedPayableLeaveHours).toBe(0)
  })
})

// 請假：已停用的表單、被停用或換成同標籤新欄位的開始 / 結束欄位，舊假單都要照常計入薪資
describe('leave on retired forms and retired fields still counts in the payroll', () => {
  beforeEach(() => {
    mockEmployee.findById.mockResolvedValue(MONTHLY)
  })

  it('counts the approved leave of a retired (inactive) leave form', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{ ...CUSTOMER_FORM, isActive: false }])
    approvalsByForm({ 'customer-form': [customerLeave('事假', '2026-09-07', '2026-09-08', { 'c-days': 2 })] })

    const result = await calculateLeaveImpact('emp1', '2026-09-01')

    expect(result).toMatchObject({ leaveHours: 16, personalLeaveHours: 16, leaveDeduction: 2000 })
  })

  it('reads the dates and the leave type from the retired same-label fields of an older request', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      ...CUSTOMER_FORM,
      startId: 'c-start-new', endId: 'c-end-new', typeId: 'c-type-new', daysId: 'c-days-new',
      startIds: ['c-start-new', 'c-start'],
      endIds: ['c-end-new', 'c-end'],
      typeIds: ['c-type-new', 'c-type'],
      daysIds: ['c-days-new', 'c-days'],
    }])
    const query = { select: jest.fn().mockReturnThis(), lean: jest.fn() }
    query.lean.mockResolvedValue([
      // 舊欄位（現在已停用）答的假單
      { form_data: { 'c-type': '事假', 'c-start': '2026-09-07', 'c-end': '2026-09-08', 'c-days': 2 } },
      // 新欄位答的假單
      { form_data: { 'c-type-new': '特休假', 'c-start-new': '2026-09-14', 'c-end-new': '2026-09-14', 'c-days-new': 1 } },
    ])
    mockApprovalRequest.find.mockReturnValue(query)

    const result = await calculateLeaveImpact('emp1', '2026-09-01')

    expect(result.leaveRecords.map((record) => [record.leaveType, record.hours, record.startDate])).toEqual([
      ['事假', 16, '2026-09-07'],
      ['特休假', 8, '2026-09-14'],
    ])
    expect(result).toMatchObject({ paidLeaveHours: 8, personalLeaveHours: 16, leaveDeduction: 2000 })
    // 查詢要把新舊欄位都投影出來
    const projection = query.select.mock.calls[0][0].split(' ')
    expect(projection).toEqual(expect.arrayContaining([
      'form_data.c-start-new', 'form_data.c-start', 'form_data.c-end-new', 'form_data.c-end',
      'form_data.c-type-new', 'form_data.c-type', 'form_data.c-days-new', 'form_data.c-days',
    ]))
  })
})

// 加班：加班單的開始 / 結束時間欄位被停用（刪除時因為已有單據而改為停用）或換成同標籤的新欄位後，舊加班單照常算加班費
describe('overtime of requests answered under retired fields', () => {
  const OT_EMPLOYEE = { _id: 'emp1', autoOvertimeCalc: true, salaryAmount: 36000, salaryType: '月薪' }
  const FORM = { _id: 'form1', name: '加班申請', semanticType: 'overtime' }
  const DAY_SHIFT = { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' }

  async function overtimeWith(fields, requests) {
    mockEmployee.findById.mockResolvedValue(OT_EMPLOYEE)
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(requests),
    })
    mockFormField.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(fields) })
    mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: [DAY_SHIFT] }) })
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    return calculateOvertimePay('emp1', '2026-10-01')
  }

  // 台灣 10/14 19:00-21:00（2 小時）
  const OT_START = '2026-10-14T11:00:00.000Z'
  const OT_END = '2026-10-14T13:00:00.000Z'

  it('loads the retired fields too (no is_active filter)', async () => {
    await overtimeWith([], [])
    // 沒有加班單時不查欄位；有加班單時才查
    expect(mockFormField.find).not.toHaveBeenCalled()

    await overtimeWith([], [{ form: FORM, form_data: {} }])

    expect(mockFormField.find).toHaveBeenCalledWith({ form: { $in: ['form1'] } })
  })

  it('still pays an approved 2 hour overtime after its 開始時間 / 結束時間 fields were deactivated', async () => {
    const result = await overtimeWith(
      [
        { form: 'form1', _id: 'startField', label: '開始時間', is_active: false },
        { form: 'form1', _id: 'endField', label: '結束時間', is_active: false },
      ],
      [{ form: FORM, form_data: { startField: OT_START, endField: OT_END } }],
    )

    expect(result.overtimeHours).toBe(2)
    expect(result.overtimeRecords[0]).toMatchObject({ date: '2026-10-14', hours: 2 })
    expect(result.overtimePay).toBeGreaterThan(0)
  })

  it('counts both an old request (retired field) and a new one (replacement field of the same label)', async () => {
    const result = await overtimeWith(
      [
        { form: 'form1', _id: 'startOld', label: '開始時間', is_active: false, order: 1 },
        { form: 'form1', _id: 'endOld', label: '結束時間', is_active: false, order: 2 },
        { form: 'form1', _id: 'startNew', label: '開始時間', order: 3 },
        { form: 'form1', _id: 'endNew', label: '結束時間', order: 4 },
      ],
      [
        { form: FORM, form_data: { startOld: OT_START, endOld: OT_END } },
        { form: FORM, form_data: { startNew: '2026-10-15T11:00:00.000Z', endNew: '2026-10-15T14:00:00.000Z' } },
      ],
    )

    expect(result.overtimeRecords.map((record) => [record.date, record.hours])).toEqual([['2026-10-14', 2], ['2026-10-15', 3]])
    expect(result.overtimeHours).toBe(5)
  })

  it('prefers the active field when a request has an answer under both', async () => {
    const result = await overtimeWith(
      [
        { form: 'form1', _id: 'startOld', label: '開始時間', is_active: false, order: 1 },
        { form: 'form1', _id: 'endOld', label: '結束時間', is_active: false, order: 2 },
        { form: 'form1', _id: 'startNew', label: '開始時間', order: 3 },
        { form: 'form1', _id: 'endNew', label: '結束時間', order: 4 },
      ],
      [{ form: FORM, form_data: { startOld: OT_START, endOld: OT_END, startNew: '2026-10-16T11:00:00.000Z', endNew: '2026-10-16T12:00:00.000Z' } }],
    )

    expect(result.overtimeRecords.map((record) => [record.date, record.hours])).toEqual([['2026-10-16', 1]])
  })

  it('reads the hours and date fields from retired fields as well', async () => {
    const result = await overtimeWith(
      [
        { form: 'form1', _id: 'hoursOld', label: '加班時數', is_active: false },
        { form: 'form1', _id: 'dateOld', label: '加班日期', is_active: false },
      ],
      [{ form: FORM, form_data: { hoursOld: '1.5', dateOld: '2026-10-20' } }],
    )

    expect(result.overtimeRecords[0]).toMatchObject({ date: '2026-10-20', hours: 1.5 })
  })
})
