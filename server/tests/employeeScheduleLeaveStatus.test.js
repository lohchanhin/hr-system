import { jest } from '@jest/globals'

// 排班用員工列表的「請假中」狀態篩選：預設的「請假」與自建的請假表單並存時，每張表單的核准假單都要算

const mockEmployee = { find: jest.fn(), countDocuments: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}))

let listEmployeesSchedule

const ADMIN_ID = '64b000000000000000000001'
const EMPLOYEES = [
  { _id: 'e1', name: 'A員工' },
  { _id: 'e2', name: 'B員工' },
  { _id: 'e3', name: 'C員工' },
]

function createRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
  return res
}

function leanChain(rows) {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(async () => rows),
  }
  return chain
}

async function listWithStatus(status) {
  const res = createRes()
  await listEmployeesSchedule({
    user: { id: ADMIN_ID, role: 'admin' },
    query: { month: '2026-03', status },
  }, res)
  return res
}

beforeAll(async () => {
  ;({ listEmployeesSchedule } = await import('../src/controllers/employeeController.js'))
})

beforeEach(() => {
  mockEmployee.find.mockReset()
  mockShiftSchedule.find.mockReset()
  mockApprovalRequest.find.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
  mockEmployee.find.mockImplementation(() => leanChain(EMPLOYEES))
  mockShiftSchedule.find.mockImplementation(() => leanChain([]))
  mockGetAllLeaveFieldInfos.mockResolvedValue([])
})

describe('schedule employee list: onLeave status filter', () => {
  it('counts the approved leave of every leave form', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([
      { formId: 'default-form', startId: 'd-start', endId: 'd-end' },
      { formId: 'customer-form', startId: 'c-start', endId: 'c-end', typeId: 'c-type' },
    ])
    mockApprovalRequest.find.mockImplementation((query) => leanChain(query.form === 'default-form'
      ? [{ applicant_employee: 'e1', form_data: { 'd-start': '2026-03-05', 'd-end': '2026-03-06' } }]
      : [{ applicant_employee: 'e2', form_data: { 'c-start': '2026-03-20', 'c-end': '2026-03-20' } }]))

    const res = await listWithStatus('onLeave')

    expect(res.statusCode).toBe(200)
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(2)
    // 日期範圍不再用資料庫的字串比較（ISO 字串 / 台灣時區會比錯），改取回核准的假單後以台灣日期判斷
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      form: 'customer-form',
      status: 'approved',
      applicant_employee: { $in: ['e1', 'e2', 'e3'] },
    })
    expect(res.body.employees.map((employee) => employee._id)).toEqual(['e1', 'e2'])
  })

  it('does not look at approvals when there is no leave form, so nobody is on leave', async () => {
    const res = await listWithStatus('onLeave')

    expect(res.statusCode).toBe(200)
    expect(res.body.employees).toEqual([])
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })

  it('does not treat the employees who have leave as unscheduled', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([
      { formId: 'customer-form', startId: 'c-start', endId: 'c-end' },
    ])
    mockApprovalRequest.find.mockImplementation(() => leanChain([
      { applicant_employee: 'e2', form_data: { 'c-start': '2026-03-01', 'c-end': '2026-03-31' } },
    ]))

    const res = await listWithStatus('unscheduled')

    expect(res.body.employees.map((employee) => employee._id)).toEqual(['e1', 'e3'])
  })
})

// 請假日以台灣時間判斷，與伺服器所在時區無關：台灣 2026-07-01 的整天假存成 2026-06-30T16:00:00.000Z
describe('schedule employee list: onLeave status filter reads leave days in Taiwan time', () => {
  const FORM = { formId: 'leave-form', startId: 'start', endId: 'end', typeId: 'type' }
  const originalTz = process.env.TZ

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  async function listFor(month, status) {
    const res = createRes()
    await listEmployeesSchedule({
      user: { id: ADMIN_ID, role: 'admin' },
      query: { month, status },
    }, res)
    return res
  }

  function leaveRows(rows) {
    mockGetAllLeaveFieldInfos.mockResolvedValue([FORM])
    mockApprovalRequest.find.mockImplementation(() => leanChain(rows))
  }

  it.each(['UTC', 'Asia/Taipei', 'America/Los_Angeles'])('finds a one-day leave on Taiwan 2026-07-01 in July and not in June (server TZ=%s)', async (zone) => {
    process.env.TZ = zone
    leaveRows([{
      applicant_employee: 'e2',
      form_data: { start: '2026-06-30T16:00:00.000Z', end: '2026-06-30T16:00:00.000Z', type: '事假' },
    }])

    const july = await listFor('2026-07', 'onLeave')
    const june = await listFor('2026-06', 'onLeave')

    expect(july.statusCode).toBe(200)
    expect(july.body.employees.map((employee) => employee._id)).toEqual(['e2'])
    expect(june.body.employees).toEqual([])
  })

  it.each(['UTC', 'Asia/Taipei'])('finds a leave on Taiwan 2026-06-30 only in June, and a leave across the month end in both months (TZ=%s)', async (zone) => {
    process.env.TZ = zone
    leaveRows([
      // 台灣 6/30 整天
      { applicant_employee: 'e1', form_data: { start: '2026-06-29T16:00:00.000Z', end: '2026-06-29T16:00:00.000Z' } },
      // 台灣 6/29 到 7/2
      { applicant_employee: 'e3', form_data: { start: '2026-06-28T16:00:00.000Z', end: '2026-07-01T16:00:00.000Z' } },
    ])

    const june = await listFor('2026-06', 'onLeave')
    const july = await listFor('2026-07', 'onLeave')

    expect(june.body.employees.map((employee) => employee._id)).toEqual(['e1', 'e3'])
    expect(july.body.employees.map((employee) => employee._id)).toEqual(['e3'])
  })

  it('reads leave answers that sit under a replaced (deactivated) start / end field', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      ...FORM,
      startIds: ['start', 'old-start'],
      endIds: ['end', 'old-end'],
    }])
    mockApprovalRequest.find.mockImplementation(() => leanChain([
      { applicant_employee: 'e1', form_data: { 'old-start': '2026-07-05', 'old-end': '2026-07-06' } },
    ]))

    const res = await listFor('2026-07', 'onLeave')

    expect(res.body.employees.map((employee) => employee._id)).toEqual(['e1'])
  })

  it('queries the shift days with UTC-midnight bounds of the month and counts them by their stored UTC day', async () => {
    process.env.TZ = 'Asia/Taipei'
    mockGetAllLeaveFieldInfos.mockResolvedValue([])
    const everyDay = Array.from({ length: 31 }, (_, index) => ({
      employee: 'e1',
      date: new Date(Date.UTC(2026, 6, index + 1)),
      shiftId: 'day',
    }))
    mockShiftSchedule.find.mockImplementation(() => leanChain(everyDay))

    const scheduled = await listFor('2026-07', 'scheduled')
    const unscheduled = await listFor('2026-07', 'unscheduled')

    expect(mockShiftSchedule.find).toHaveBeenCalledWith({
      employee: { $in: ['e1', 'e2', 'e3'] },
      date: { $gte: new Date('2026-07-01T00:00:00.000Z'), $lt: new Date('2026-08-01T00:00:00.000Z') },
    })
    expect(scheduled.body.employees.map((employee) => employee._id)).toEqual(['e1'])
    expect(unscheduled.body.employees.map((employee) => employee._id)).toEqual(['e2', 'e3'])
  })

  it('rejects the status filter without a valid month', async () => {
    const res = await listFor(undefined, 'onLeave')

    expect(res.statusCode).toBe(400)
  })
})
