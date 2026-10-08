import { jest } from '@jest/globals'

// 排班頁的請假資料（GET /api/schedules/leave-approvals 與員工列表的「請假中」篩選）以台灣日期判斷哪一天、哪個月：
// 台灣 2026-07-01 的一天假存成 2026-06-30T16:00:00.000Z，字串比 '2026-07-01' 小，
// 只靠資料庫的字串比較或伺服器本地時區的 dayjs 會把它漏掉或排到 6 月。
// 這個檔案要在 TZ=UTC 與 TZ=Asia/Taipei 兩種主機時區下都通過。

const mockShiftSchedule = { find: jest.fn() }
const mockEmployee = { find: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos }))

let listLeaveApprovals
let listMonthlySchedules

beforeAll(async () => {
  ;({ listLeaveApprovals, listMonthlySchedules } = await import('../src/controllers/schedule/scheduleQueryController.js'))
})

const FORM = { formId: 'leave-form', startId: 's', endId: 'e', typeId: 't', isActive: true }
const EMPLOYEE = { _id: 'e1', name: 'A員工', department: 'd1' }

// 每筆假單存的是前端日期選擇器送出的 UTC ISO 字串
const LEAVES = {
  // 台灣 7/1 一整天（開始、結束都是台灣 7/1 00:00）
  july1: { _id: 'july1', form_data: { s: '2026-06-30T16:00:00.000Z', e: '2026-06-30T16:00:00.000Z', t: '事假' } },
  // 台灣 6/30 一整天
  june30: { _id: 'june30', form_data: { s: '2026-06-29T16:00:00.000Z', e: '2026-06-29T16:00:00.000Z', t: '病假' } },
  // 台灣 6/30 到 7/2
  crossing: { _id: 'crossing', form_data: { s: '2026-06-29T16:00:00.000Z', e: '2026-07-01T16:00:00.000Z', t: '特休假' } },
  // 台灣 7/31 一整天
  july31: { _id: 'july31', form_data: { s: '2026-07-30T16:00:00.000Z', e: '2026-07-30T16:00:00.000Z', t: '公假' } },
  // 日期型欄位直接存的純日期
  plain: { _id: 'plain', form_data: { s: '2026-07-15', e: '2026-07-16', t: '事假' } },
}

// 模擬 MongoDB 對 Mixed 欄位的字串比較（$lt / $gte），其餘條件（表單、狀態、員工）不看
function mongoMatches(row, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (!key.startsWith('form_data.') || !condition || typeof condition !== 'object') return true
    const value = row.form_data?.[key.slice('form_data.'.length)]
    if (typeof value !== 'string') return false
    if ('$lt' in condition && !(value < condition.$lt)) return false
    if ('$gte' in condition && !(value >= condition.$gte)) return false
    return true
  })
}

function useApprovedLeaves(rows) {
  mockApprovalRequest.find.mockImplementation((filter) => {
    const matched = rows.map((row) => ({
      applicant_employee: { _id: 'e1', name: 'A員工' },
      status: 'approved',
      ...row,
    })).filter((row) => mongoMatches(row, filter))
    const query = {
      select: jest.fn(() => query),
      populate: jest.fn(() => query),
      lean: jest.fn(async () => matched),
    }
    return query
  })
}

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
}

beforeEach(() => {
  mockShiftSchedule.find.mockReset()
  mockEmployee.find.mockReset()
  mockApprovalRequest.find.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
  mockGetAllLeaveFieldInfos.mockResolvedValue([FORM])
  mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts: [] }) })
  mockEmployee.find.mockImplementation(() => {
    const query = {
      select: jest.fn(() => query),
      lean: jest.fn(async () => [EMPLOYEE]),
      then: (resolve) => Promise.resolve([EMPLOYEE]).then(resolve),
    }
    return query
  })
  mockShiftSchedule.find.mockImplementation(() => {
    const query = {
      select: jest.fn(() => query),
      populate: jest.fn(() => query),
      lean: jest.fn(async () => []),
    }
    return query
  })
})

async function leaveApprovalsOf(month) {
  const res = createRes()
  await listLeaveApprovals({ query: { month, employee: 'e1' }, user: { id: 'admin1', role: 'admin' } }, res)
  return res
}

async function employeesWithStatus(month, status) {
  const res = createRes()
  await listMonthlySchedules({ query: { month, status, department: 'd1' }, user: { id: 'admin1', role: 'admin' } }, res)
  return res
}

describe(`GET /api/schedules/leave-approvals (host time zone ${process.env.TZ || 'default'})`, () => {
  it('shows a one-day leave on Taipei 7/1 (stored 06-30T16:00Z) in July and not in June', async () => {
    useApprovedLeaves([LEAVES.july1])

    const july = await leaveApprovalsOf('2026-07')
    const june = await leaveApprovalsOf('2026-06')

    expect(july.statusCode).toBe(200)
    expect(july.body.approvals.map((item) => item._id)).toEqual(['july1'])
    expect(july.body.leaves).toHaveLength(1)
    expect(june.body).toEqual({ leaves: [], approvals: [] })
  })

  it('shows a one-day leave on Taipei 6/30 in June and not in July', async () => {
    useApprovedLeaves([LEAVES.june30])

    expect((await leaveApprovalsOf('2026-06')).body.approvals.map((item) => item._id)).toEqual(['june30'])
    expect((await leaveApprovalsOf('2026-07')).body.approvals).toEqual([])
  })

  it('shows a leave that crosses the month end in both months', async () => {
    useApprovedLeaves([LEAVES.crossing])

    expect((await leaveApprovalsOf('2026-06')).body.approvals.map((item) => item._id)).toEqual(['crossing'])
    expect((await leaveApprovalsOf('2026-07')).body.approvals.map((item) => item._id)).toEqual(['crossing'])
  })

  it('keeps the last Taipei day of a month out of the next month', async () => {
    useApprovedLeaves([LEAVES.july31])

    expect((await leaveApprovalsOf('2026-07')).body.approvals.map((item) => item._id)).toEqual(['july31'])
    expect((await leaveApprovalsOf('2026-08')).body.approvals).toEqual([])
  })

  it('treats plain date answers as that very day', async () => {
    useApprovedLeaves([LEAVES.plain])

    expect((await leaveApprovalsOf('2026-07')).body.approvals.map((item) => item._id)).toEqual(['plain'])
    expect((await leaveApprovalsOf('2026-06')).body.approvals).toEqual([])
  })

  it('widens the database string filter by a day on both sides and leaves the exact day to the Taipei date check', async () => {
    useApprovedLeaves([LEAVES.july1])

    await leaveApprovalsOf('2026-07')

    const filter = mockApprovalRequest.find.mock.calls[0][0]
    expect(filter['form_data.s']).toEqual({ $lt: '2026-08-02' })
    expect(filter['form_data.e']).toEqual({ $gte: '2026-06-30' })
  })

  it('also lists the approved leave of a retired (inactive) leave form', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{ ...FORM, isActive: false }])
    useApprovedLeaves([LEAVES.plain])

    expect((await leaveApprovalsOf('2026-07')).body.approvals.map((item) => item._id)).toEqual(['plain'])
  })

  it('reads the dates and the type from the retired same-label fields of an older request', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      ...FORM, startId: 's2', endId: 'e2', typeId: 't2',
      startIds: ['s2', 's'], endIds: ['e2', 'e'], typeIds: ['t2', 't'],
    }])
    useApprovedLeaves([
      LEAVES.july1,
      { _id: 'new', form_data: { s2: '2026-07-20', e2: '2026-07-20', t2: '特休假' } },
      { _id: 'elsewhere', form_data: { s2: '2026-09-20', e2: '2026-09-20' } },
    ])

    const res = await leaveApprovalsOf('2026-07')

    expect(res.body.approvals.map((item) => [item._id, item.leaveType, item.startDate])).toEqual([
      ['july1', '事假', '2026-06-30T16:00:00.000Z'],
      ['new', '特休假', '2026-07-20'],
    ])
    const filter = mockApprovalRequest.find.mock.calls[0][0]
    expect(filter.$and[0].$or).toHaveLength(4)
  })
})

describe(`schedule employee list, status = onLeave (host time zone ${process.env.TZ || 'default'})`, () => {
  it('counts the Taipei 7/1 one-day leave for July and not for June', async () => {
    useApprovedLeaves([LEAVES.july1])

    const july = await employeesWithStatus('2026-07', 'onLeave')
    const june = await employeesWithStatus('2026-06', 'onLeave')

    expect(july.statusCode).toBe(200)
    expect(july.body.employees.map((employee) => employee._id)).toEqual(['e1'])
    expect(june.body.employees).toEqual([])
  })

  it('does not count a leave of the neighbouring month (Taipei 6/30 is not a July leave)', async () => {
    useApprovedLeaves([LEAVES.june30])

    expect((await employeesWithStatus('2026-07', 'onLeave')).body.employees).toEqual([])
    expect((await employeesWithStatus('2026-06', 'onLeave')).body.employees.map((employee) => employee._id)).toEqual(['e1'])
  })

  it('counts leave of a retired (inactive) form and leave read from a retired field', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      ...FORM, isActive: false, startId: 's2', endId: 'e2', startIds: ['s2', 's'], endIds: ['e2', 'e'],
    }])
    useApprovedLeaves([LEAVES.july1])

    expect((await employeesWithStatus('2026-07', 'onLeave')).body.employees.map((employee) => employee._id)).toEqual(['e1'])
  })

  it('does not call a month with only a Taipei 7/1 leave "unscheduled" for the leave day', async () => {
    useApprovedLeaves([LEAVES.july1])

    // 有請假的人狀態是「請假中」，不算未排班；6 月沒有請假也沒有排班才是未排班
    expect((await employeesWithStatus('2026-07', 'unscheduled')).body.employees).toEqual([])
    expect((await employeesWithStatus('2026-06', 'unscheduled')).body.employees.map((employee) => employee._id)).toEqual(['e1'])
  })
})
