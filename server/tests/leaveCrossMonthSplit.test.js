import { jest } from '@jest/globals'
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js'

// 跨月的請假單填了總時數（或總天數）時，各月份分到幾小時：依班表上要上班的日子分，不把休息日、例假算進去。
// 以前月薪人員是把總時數平均分到每個日曆日：週四 10/29 到週一 11/2 的 24 小時事假（中間週六休息日、週日例假），
// 10 月算 14.4 小時、11 月算 9.6 小時，應該是 16 與 8；日薪、時薪人員只拿掉「計算的那個月」的休息日，兩個月加起來不到 24 小時。

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

await registerHolidayResolverModelMocks(jest)

let calculateLeaveImpact

beforeAll(async () => {
  ;({ calculateLeaveImpact } = await import('../src/services/workHoursCalculationService.js'))
})

const LEAVE_FORM = {
  formId: 'leave-form', startId: 'start', endId: 'end', typeId: 'type', daysId: 'days', hoursId: 'hours',
  typeOptions: [{ value: '事假', label: '事假' }, { value: '特休假', label: '特休假' }],
}
const SHIFTS = [
  { _id: 'day', code: 'D', name: '日班', semanticType: 'work', startTime: '09:00', endTime: '18:00', breakDuration: 60 },
  { _id: 'rest', code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: 'reg', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
]
const day = (iso) => new Date(`${iso}T00:00:00.000Z`)
// 10/29（四）、10/30（五）上班，10/31（六）休息日，11/1（日）例假，11/2（一）上班
const ROSTER = [
  { employee: 'emp1', date: day('2026-10-29'), shiftId: 'day' },
  { employee: 'emp1', date: day('2026-10-30'), shiftId: 'day' },
  { employee: 'emp1', date: day('2026-10-31'), shiftId: 'rest' },
  { employee: 'emp1', date: day('2026-11-01'), shiftId: 'reg' },
  { employee: 'emp1', date: day('2026-11-02'), shiftId: 'day' },
]

function setup({ employee, leave, roster = ROSTER }) {
  mockEmployee.findById.mockResolvedValue(employee)
  mockGetAllLeaveFieldInfos.mockResolvedValue([LEAVE_FORM])
  mockApprovalRequest.find.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue([{ form_data: leave }]) }))
  mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: SHIFTS }) })
  // 班表查詢依日期條件回傳（當月的班表，與跨月假單在其他月份的那幾天）
  mockShiftSchedule.find.mockImplementation((filter = {}) => {
    const from = filter.date?.$gte ?? new Date(0)
    const to = filter.date?.$lt ?? new Date(8640000000000000)
    return { lean: jest.fn().mockResolvedValue(roster.filter(row => row.date >= from && row.date < to)) }
  })
}

beforeEach(() => {
  for (const mock of [mockEmployee.findById, mockApprovalRequest.find, mockAttendanceSetting.findOne, mockShiftSchedule.find, mockGetAllLeaveFieldInfos]) {
    mock.mockReset()
  }
})

describe('a leave with a filled total that crosses a month end is split by the scheduled workdays', () => {
  const MONTHLY = { _id: 'emp1', salaryAmount: 30000, salaryType: '月薪' } // 時薪 125
  const DAILY = { _id: 'emp1', salaryAmount: 2000, salaryType: '日薪' }
  const THU_TO_MON = { type: '事假', start: '2026-10-29', end: '2026-11-02' }

  it('monthly pay: a 24-hour 事假 from Thu 10/29 to Mon 11/2 is 16 hours in October and 8 in November', async () => {
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 } })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 } })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    // 以前 14.4 / 9.6（把 24 小時平均分到 5 個日曆日，休息日與例假也分到）
    expect(october).toMatchObject({ leaveHours: 16, personalLeaveHours: 16, leaveDeduction: 2000 })
    expect(november).toMatchObject({ leaveHours: 8, personalLeaveHours: 8, leaveDeduction: 1000 })
    expect(october.leaveRecords[0]).toMatchObject({ hours: 16, days: 2, totalHours: 24, totalDays: 3, startDate: '2026-10-29', endDate: '2026-11-02' })
    expect(november.leaveRecords[0]).toMatchObject({ hours: 8, days: 1, totalHours: 24, totalDays: 3 })
  })

  it('monthly pay: the same with the old 天數 field (3 days)', async () => {
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, days: 3 } })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, days: 3 } })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    expect([october.leaveHours, november.leaveHours]).toEqual([16, 8])
    expect(october.leaveDeduction + november.leaveDeduction).toBe(3000)
  })

  it('monthly pay: October does not change when the November roster is not made yet', async () => {
    // 算 10 月薪資時 11 月的班表還沒排：10/29、10/30 各 8 小時仍然算在 10 月，剩下的 8 小時留給 11 月
    const octoberOnly = ROSTER.filter(row => row.date < day('2026-11-01'))
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 }, roster: octoberOnly })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 }, roster: octoberOnly })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    expect([october.leaveHours, november.leaveHours]).toEqual([16, 8])
  })

  it('monthly pay: a leave with a time of day only takes the part of each shift it covers', async () => {
    // 週四 13:00 到下週一 12:00（班別 09:00-18:00，休息 1 小時），時數欄位填 16 小時
    const leave = { type: '事假', start: '2026-10-29T05:00:00.000Z', end: '2026-11-02T04:00:00.000Z', hours: 16 }
    setup({ employee: MONTHLY, leave })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    // 週四 13:00-18:00 與班次重疊 5 小時、週五 8 小時，剩下 3 小時在週一（以前 16 小時平均分到 5 天：10 月 9.6、11 月 6.4）
    expect([october.leaveHours, november.leaveHours]).toEqual([13, 3])
  })

  it('monthly pay: hours beyond the scheduled shift hours are still all counted', async () => {
    // 排的是 8 小時班，卻填了 30 小時：多的 6 小時依比例分給三個上班日，總時數不變
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 30 } })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 30 } })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    expect([october.leaveHours, november.leaveHours]).toEqual([20, 10])
  })

  it('monthly pay: keeps the whole total when every day of the range is a rest day on the roster', async () => {
    const restOnly = ROSTER.map(row => ({ ...row, shiftId: 'rest' }))
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 }, roster: restOnly })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 }, roster: restOnly })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    // 班表上沒有任何一天要上班：無從判斷，維持日曆日的分法，總時數不會不見
    expect(october.leaveHours + november.leaveHours).toBeCloseTo(24, 4)
  })

  it('monthly pay without a roster keeps the calendar-day split (nothing says which days are rest days)', async () => {
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 }, roster: [] })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave: { ...THU_TO_MON, hours: 24 }, roster: [] })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    expect([october.leaveHours, november.leaveHours]).toEqual([14.4, 9.6])
  })

  it('monthly pay: a leave counted from its dates (no filled total) is still counted in calendar days', async () => {
    setup({ employee: MONTHLY, leave: THU_TO_MON })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: MONTHLY, leave: THU_TO_MON })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    expect([october.leaveHours, november.leaveHours]).toEqual([24, 16])
  })

  it('daily pay: the two months of a 3-day 特休 over the weekend add up to 3 days (16 + 8 hours)', async () => {
    const leave = { type: '特休假', start: '2026-10-29', end: '2026-11-02', days: 3 }
    setup({ employee: DAILY, leave })
    const october = await calculateLeaveImpact('emp1', '2026-10-01')
    setup({ employee: DAILY, leave })
    const november = await calculateLeaveImpact('emp1', '2026-11-01')

    // 以前算 10 月時只知道 10/31 是休息日、算 11 月時只知道 11/1 是例假：12 + 6 = 18 小時，少了 6 小時的有薪假
    expect([october.paidLeaveHours, november.paidLeaveHours]).toEqual([16, 8])
  })

  it('daily pay: October does not change when the November roster is not made yet (date-order fill, like monthly pay)', async () => {
    // 算 10 月薪資時 11 月的班表還沒排：以前依比例分（11/1、11/2 沒有班表，各分到一份）→ 10 月只有 12 小時，
    // 11 月排好班表後再算 11 月是 8 小時：兩個月加起來 20 小時，少了 4 小時的有薪假，而且 10 月已經發出去的數字對不起來
    const leave = { type: '特休假', start: '2026-10-29', end: '2026-11-02', hours: 24 }
    const octoberOnly = ROSTER.filter(row => row.date < day('2026-11-01'))
    setup({ employee: DAILY, leave, roster: octoberOnly })
    const october = await calculateLeaveImpact('emp1', '2026-10-01', {}, { withDailyBreakdown: true })
    setup({ employee: DAILY, leave })
    const november = await calculateLeaveImpact('emp1', '2026-11-01', {}, { withDailyBreakdown: true })

    expect([october.paidLeaveHours, november.paidLeaveHours]).toEqual([16, 8])
    expect(october.payableLeaveByDay).toEqual({ '2026-10-29': 8, '2026-10-30': 8 })
    expect(november.payableLeaveByDay).toEqual({ '2026-11-02': 8 })
  })

  it('daily pay: a leave inside one month still drops the rest days from the roster', async () => {
    const leave = { type: '特休假', start: '2026-10-29', end: '2026-10-31', days: 2 }
    setup({ employee: DAILY, leave })
    const october = await calculateLeaveImpact('emp1', '2026-10-01', {}, { withDailyBreakdown: true })
    expect(october.payableLeaveByDay).toEqual({ '2026-10-29': 8, '2026-10-30': 8 })
  })
})
