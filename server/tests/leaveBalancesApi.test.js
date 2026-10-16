import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import { oid } from './helpers/approvalTestKit.js'

// GET /api/approvals/leave-balances：誰看得到誰的假別餘額。資料層換成替身，只驗證權限、參數與路由順序。
const EMP = oid(1)
const SUP = oid(2)
const REPORT = oid(3)
const OTHER = oid(4)
const HR = oid(5)
const ADMIN = oid(6)

const mockBuildLeaveBalances = jest.fn()
const mockApprovalRequest = { exists: jest.fn(), findById: jest.fn() }
const mockEmployee = { find: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockGetSettings = jest.fn()
let currentUser
let app

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
  await jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: mockGetSettings }))
  await jest.unstable_mockModule('../src/services/leaveBalanceService.js', () => ({
    buildLeaveBalances: mockBuildLeaveBalances,
    currentTaipeiYear: () => 2026,
    describeRequestFocus: jest.fn(),
    evaluateLeaveRequestAgainstBalance: jest.fn(),
  }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => { req.user = currentUser; next() },
    authorizeRoles: () => (req, res, next) => { req.user = currentUser; next() },
  }))
  const routes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/approvals', routes)
})

beforeEach(() => {
  currentUser = { id: EMP, role: 'employee' }
  mockBuildLeaveBalances.mockReset()
  mockBuildLeaveBalances.mockImplementation(async ({ employeeId, year }) => ({ employee: { _id: employeeId }, year, items: [] }))
  mockApprovalRequest.exists.mockReset()
  mockApprovalRequest.exists.mockResolvedValue(null)
  mockEmployee.find.mockReset()
  mockShiftSchedule.find.mockReset()
  mockShiftSchedule.find.mockReturnValue({ lean: async () => [] })
  mockAttendanceSetting.findOne.mockReset()
  mockGetSettings.mockReset()
  mockGetSettings.mockResolvedValue({})
  // 主管的直屬部屬
  mockEmployee.find.mockReturnValue({ select: () => ({ lean: async () => [{ _id: REPORT }] }) })
})

describe('GET /api/approvals/leave-balances', () => {
  it('returns the caller\'s own balances when no employee is given, for the current Taiwan year', async () => {
    const res = await request(app).get('/api/approvals/leave-balances')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ employee: { _id: EMP }, year: 2026 })
    expect(mockBuildLeaveBalances).toHaveBeenCalledWith({ employeeId: EMP, year: 2026 })
  })

  it('is not swallowed by GET /:id (which would answer 400 "簽核單編號格式不正確")', async () => {
    const res = await request(app).get('/api/approvals/leave-balances?year=2025')
    expect(res.status).toBe(200)
    expect(res.body.error).toBeUndefined()
    expect(mockBuildLeaveBalances).toHaveBeenCalledWith({ employeeId: EMP, year: 2025 })
  })

  it('lets an employee ask for himself by id and refuses (404) to show anybody else', async () => {
    expect((await request(app).get(`/api/approvals/leave-balances?employeeId=${EMP}`)).status).toBe(200)

    const other = await request(app).get(`/api/approvals/leave-balances?employeeId=${OTHER}`)
    expect(other.status).toBe(404)
    expect(other.body).toEqual({ error: '找不到這位員工的資料' })
    expect(mockBuildLeaveBalances).toHaveBeenCalledTimes(1)
  })

  it('lets a supervisor see a direct report but nobody else', async () => {
    currentUser = { id: SUP, role: 'supervisor' }
    expect((await request(app).get(`/api/approvals/leave-balances?employeeId=${REPORT}`)).status).toBe(200)
    expect((await request(app).get(`/api/approvals/leave-balances?employeeId=${OTHER}`)).status).toBe(404)
    expect(mockApprovalRequest.exists).toHaveBeenCalledWith({ applicant_employee: OTHER, 'steps.approvers.approver': SUP })
  })

  it('lets a step approver of that employee (e.g. 人資) see the balances even when he is not the supervisor', async () => {
    currentUser = { id: HR, role: 'employee' }
    mockApprovalRequest.exists.mockResolvedValue({ _id: oid(900) })

    const res = await request(app).get(`/api/approvals/leave-balances?employeeId=${OTHER}`)

    expect(res.status).toBe(200)
    expect(mockApprovalRequest.exists).toHaveBeenCalledWith({ applicant_employee: OTHER, 'steps.approvers.approver': HR })
  })

  it('lets an admin see everybody without looking anything up', async () => {
    currentUser = { id: ADMIN, role: 'admin' }
    const res = await request(app).get(`/api/approvals/leave-balances?employeeId=${OTHER}&year=2024`)
    expect(res.status).toBe(200)
    expect(mockBuildLeaveBalances).toHaveBeenCalledWith({ employeeId: OTHER, year: 2024 })
    expect(mockApprovalRequest.exists).not.toHaveBeenCalled()
  })

  it('answers 404 when the employee does not exist', async () => {
    currentUser = { id: ADMIN, role: 'admin' }
    mockBuildLeaveBalances.mockResolvedValue(null)
    const res = await request(app).get(`/api/approvals/leave-balances?employeeId=${OTHER}`)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: '找不到這位員工的資料' })
  })

  it('validates the employee id and the year', async () => {
    const badId = await request(app).get('/api/approvals/leave-balances?employeeId=abc')
    expect(badId.status).toBe(400)
    expect(badId.body).toEqual({ error: '員工編號格式不正確' })

    for (const year of ['1999', '2101', 'abc', '2026.5']) {
      const res = await request(app).get(`/api/approvals/leave-balances?year=${year}`)
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('年度必須是 2000 到 2100 之間的整數')
    }
    expect(mockBuildLeaveBalances).not.toHaveBeenCalled()
  })

  it('answers 500 without leaking the error when the calculation fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockBuildLeaveBalances.mockRejectedValue(new Error('mongodb://secret-host failed'))
    const res = await request(app).get('/api/approvals/leave-balances')
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('secret-host')
  })

  it('requires a logged-in user', async () => {
    currentUser = undefined
    const res = await request(app).get('/api/approvals/leave-balances')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/approvals/leave-hours-hint (hours from the caller\'s own schedule)', () => {
  const NIGHT = { _id: 'night', startTime: '19:00', endTime: '07:00', crossDay: true, semanticType: 'work' }
  const DAY = { _id: 'day', startTime: '07:00', endTime: '19:00', semanticType: 'work' }
  const REST = { _id: 'rest', startTime: '00:00', endTime: '00:00', semanticType: 'rest_day' }
  const scheduleOf = (rows) => {
    mockShiftSchedule.find.mockReturnValue({ lean: async () => rows.map(([date, shift]) => ({ date: new Date(`${date}T00:00:00.000Z`), shiftId: shift._id })) })
    mockAttendanceSetting.findOne.mockReturnValue({ lean: async () => ({ shifts: [NIGHT, DAY, REST] }) })
  }
  const hint = (query) => request(app).get('/api/approvals/leave-hours-hint').query(query)

  it('is not swallowed by GET /:id and uses only the caller\'s own schedule', async () => {
    scheduleOf([['2026-03-02', DAY]])

    const res = await hint({ start: '2026-03-02', end: '2026-03-02' })

    expect(res.status).toBe(200)
    expect(mockShiftSchedule.find.mock.calls[0][0].employee).toBe(EMP)
    expect(res.body).toMatchObject({ valid: true, allDay: true, maxHours: 12, suggestedHours: 12, maxHoursPerDay: 8, minUnitHours: 0.5, scheduleChecked: true })
  })

  it('counts days off as 0 and scheduled work days as their shift hours, with a calendar-day fallback for unscheduled days', async () => {
    scheduleOf([['2026-03-02', DAY], ['2026-03-03', REST]])

    const res = await hint({ start: '2026-03-02', end: '2026-03-04' })

    expect(res.body.suggestedHours).toBe(20) // 12 + 0 + 8
    expect(res.body.days.map(day => [day.dateKey, day.suggestedHours, day.scheduled])).toEqual([
      ['2026-03-02', 12, 'work'], ['2026-03-03', 0, 'off'], ['2026-03-04', 8, null],
    ])
  })

  it('reads ISO instants and the date typing of the fields (a date picker sends Taiwan midnight as UTC)', async () => {
    scheduleOf([])
    const res = await hint({ start: '2026-03-01T16:00:00.000Z', end: '2026-03-02T16:00:00.000Z', startType: 'date', endType: 'date' })
    expect(res.body).toMatchObject({ valid: true, allDay: true, suggestedHours: 16 })
    const timed = await hint({ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T05:00:00.000Z' })
    expect(timed.body).toMatchObject({ allDay: false, suggestedHours: 4 })
  })

  it('answers valid: false for a reversed range without looking at the schedule, and 400 for missing or unreadable values', async () => {
    const reversed = await hint({ start: '2026-03-05', end: '2026-03-02' })
    expect(reversed.status).toBe(200)
    expect(reversed.body).toMatchObject({ valid: false, reversed: true, maxHours: 0 })
    expect(mockShiftSchedule.find).not.toHaveBeenCalled()

    expect((await hint({ start: '2026-03-05' })).status).toBe(400)
    expect((await hint({ start: 'abc', end: 'def' })).status).toBe(400)
    expect((await hint({ start: 'x'.repeat(100), end: '2026-03-02' })).status).toBe(400)
  })

  it('falls back to the calendar-day estimate when the schedule cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockShiftSchedule.find.mockReturnValue({ lean: async () => { throw new Error('db down') } })

    const res = await hint({ start: '2026-03-02', end: '2026-03-03' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ valid: true, suggestedHours: 16, scheduleChecked: false })
  })

  it('requires a logged-in user', async () => {
    currentUser = undefined
    expect((await hint({ start: '2026-03-02', end: '2026-03-02' })).status).toBe(401)
  })
})
