// 調休存摺 API 的權限：本人、該員工的主管（排班範圍內的直屬部屬）、管理員看得到；其他人一律 404。
// 手動給予、扣除、作廢只有管理員，備註必填（存摺本身的規則在 compensatoryLeaveService 的測試）。
import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

const mockEmployee = { find: jest.fn() }
const mockBuildCompensatoryBank = jest.fn()
const mockCreateManualCredit = jest.fn()
const mockAdjustCredits = jest.fn()
const mockVoidCredit = jest.fn()
const mockComputePending = jest.fn()

class MockCompensatoryLeaveError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    Object.assign(this, extra)
  }
}

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/services/compensatoryLeaveService.js', () => ({
  CompensatoryLeaveError: MockCompensatoryLeaveError,
  buildCompensatoryBank: mockBuildCompensatoryBank,
  createManualCredit: mockCreateManualCredit,
  adjustCredits: mockAdjustCredits,
  voidCredit: mockVoidCredit,
}))
jest.unstable_mockModule('../src/services/leaveBalanceService.js', () => ({ computeCompLeavePendingHours: mockComputePending }))
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: async () => ({}) }))

const { default: routes } = await import('../src/routes/compensatoryLeaveRoutes.js')

const oid = (n) => n.toString(16).padStart(24, '0')
const ID = { admin: oid(1), boss: oid(2), nurse: oid(3), otherNurse: oid(4) }
let currentUser = null
const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = currentUser
  next()
})
app.use('/api/compensatory-leave', routes)

const loginAs = (role, id) => { currentUser = { id, role } }

beforeEach(() => {
  jest.clearAllMocks()
  mockEmployee.find.mockImplementation((filter) => ({
    select: () => ({ lean: async () => (filter.supervisor === ID.boss ? [{ _id: ID.nurse }] : []) }),
  }))
  mockComputePending.mockResolvedValue(4)
  mockBuildCompensatoryBank.mockImplementation(async ({ employeeId, pendingHours }) => ({ employeeId, pendingHours, balanceHours: 8, availableHours: 8 - pendingHours, credits: [] }))
})

describe('GET /api/compensatory-leave', () => {
  it('gives everyone their own bank at /mine, with the pending 調休 hours taken off', async () => {
    loginAs('employee', ID.nurse)
    const res = await request(app).get('/api/compensatory-leave/mine')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ employeeId: ID.nurse, pendingHours: 4, availableHours: 4 })
    expect(mockComputePending).toHaveBeenCalledWith(expect.objectContaining({ employeeId: ID.nurse }))
  })

  it('lets an employee ask for himself by id and answers 404 for anybody else', async () => {
    loginAs('employee', ID.nurse)
    expect((await request(app).get(`/api/compensatory-leave?employeeId=${ID.nurse}`)).status).toBe(200)
    const other = await request(app).get(`/api/compensatory-leave?employeeId=${ID.otherNurse}`)
    expect(other.status).toBe(404)
    expect(other.body).toEqual({ error: '找不到這位員工的資料' })
    expect(mockBuildCompensatoryBank).toHaveBeenCalledTimes(1)
  })

  it('lets a supervisor see a direct report but nobody else, and an admin everybody', async () => {
    loginAs('supervisor', ID.boss)
    expect((await request(app).get(`/api/compensatory-leave?employeeId=${ID.nurse}`)).status).toBe(200)
    expect((await request(app).get(`/api/compensatory-leave?employeeId=${ID.otherNurse}`)).status).toBe(404)
    loginAs('admin', ID.admin)
    expect((await request(app).get(`/api/compensatory-leave?employeeId=${ID.otherNurse}`)).status).toBe(200)
    expect(mockEmployee.find).toHaveBeenCalledTimes(2)
  })

  it('validates the employee id and requires a login', async () => {
    loginAs('admin', ID.admin)
    expect((await request(app).get('/api/compensatory-leave?employeeId=nope')).body.code).toBe('INVALID_EMPLOYEE')
    currentUser = null
    expect((await request(app).get('/api/compensatory-leave/mine')).status).toBe(401)
  })

  it('answers 500 without the error details when the bank cannot be read', async () => {
    loginAs('employee', ID.nurse)
    mockBuildCompensatoryBank.mockRejectedValue(new Error('db down'))
    const res = await request(app).get('/api/compensatory-leave/mine')
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('db down')
  })
})

describe('POST /api/compensatory-leave (administrators only)', () => {
  it('refuses employees and supervisors', async () => {
    for (const [role, id] of [['employee', ID.nurse], ['supervisor', ID.boss]]) {
      loginAs(role, id)
      expect((await request(app).post('/api/compensatory-leave/credits').send({ employeeId: ID.nurse, hours: 8, note: 'x' })).status).toBe(403)
      expect((await request(app).post('/api/compensatory-leave/adjustments').send({ employeeId: ID.nurse, hours: 8, note: 'x' })).status).toBe(403)
      expect((await request(app).post(`/api/compensatory-leave/credits/${oid(9)}/void`).send({ note: 'x' })).status).toBe(403)
    }
    expect(mockCreateManualCredit).not.toHaveBeenCalled()
    expect(mockAdjustCredits).not.toHaveBeenCalled()
    expect(mockVoidCredit).not.toHaveBeenCalled()
  })

  it('lets an admin give, deduct and void, passing who did it', async () => {
    loginAs('admin', ID.admin)
    mockCreateManualCredit.mockResolvedValue({ id: 'c1', hours: 8 })
    mockAdjustCredits.mockResolvedValue({ hours: 4 })
    mockVoidCredit.mockResolvedValue({ id: 'c1', status: 'void' })
    const created = await request(app).post('/api/compensatory-leave/credits').send({ employeeId: ID.nurse, hours: 8, note: '加班換休', earnedDate: '2026-10-01' })
    expect(created.status).toBe(201)
    expect(mockCreateManualCredit).toHaveBeenCalledWith({ employeeId: ID.nurse, hours: 8, note: '加班換休', earnedDate: '2026-10-01', actorId: ID.admin })
    expect((await request(app).post('/api/compensatory-leave/adjustments').send({ employeeId: ID.nurse, hours: 4, note: '更正' })).status).toBe(201)
    expect(mockAdjustCredits).toHaveBeenCalledWith({ employeeId: ID.nurse, hours: 4, note: '更正', actorId: ID.admin })
    expect((await request(app).post(`/api/compensatory-leave/credits/${oid(9)}/void`).send({ note: '重複' })).body).toMatchObject({ status: 'void' })
    expect(mockVoidCredit).toHaveBeenCalledWith({ id: oid(9), note: '重複', actorId: ID.admin })
  })

  it('passes the Chinese validation message and code of the service through', async () => {
    loginAs('admin', ID.admin)
    mockCreateManualCredit.mockRejectedValue(new MockCompensatoryLeaveError(400, 'NOTE_REQUIRED', '請填寫備註（給予或調整的原因）'))
    const res = await request(app).post('/api/compensatory-leave/credits').send({ employeeId: ID.nurse, hours: 8 })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: '請填寫備註（給予或調整的原因）', code: 'NOTE_REQUIRED' })
    mockAdjustCredits.mockRejectedValue(new MockCompensatoryLeaveError(409, 'COMP_LEAVE_INSUFFICIENT', '調休餘額不足', { availableHours: 2, requestedHours: 8 }))
    const short = await request(app).post('/api/compensatory-leave/adjustments').send({ employeeId: ID.nurse, hours: 8, note: 'x' })
    expect(short.status).toBe(409)
    expect(short.body).toEqual({ error: '調休餘額不足', code: 'COMP_LEAVE_INSUFFICIENT', availableHours: 2, requestedHours: 8 })
  })
})
