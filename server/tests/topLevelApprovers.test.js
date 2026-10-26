import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import { createFakeEmployeeModel, oid } from './helpers/approvalTestKit.js'

// R5：無上級主管時的最高層簽核人。
// - 解析（services/approverResolution）：設定的人 → 沒設定或都不能簽時改送可簽核的系統管理員 → 都沒有才維持原本的錯誤；申請人一律排除。
// - 設定 API（GET / PUT /api/approvals/top-level-approvers）：只有管理員；存在其他控制設定的 topLevelApproverIds。
const APPLICANT = oid(1)
const ADMIN_A = oid(2)
const ADMIN_B = oid(3)
const ADMIN_LEFT = oid(4)
const DIRECTOR = oid(5)
const NURSE = oid(6)
const DISABLED = oid(7)

const seed = () => [
  { _id: APPLICANT, name: '護理長', role: 'supervisor', supervisor: null },
  { _id: ADMIN_A, name: '人資管理員', employeeId: 'A001', role: 'admin' },
  { _id: ADMIN_B, name: '系統管理員', employeeId: 'A002', role: 'admin' },
  { _id: ADMIN_LEFT, name: '離職管理員', role: 'admin', status: '離職員工' },
  { _id: DIRECTOR, name: '院長', employeeId: 'D001', role: 'supervisor' },
  { _id: NURSE, name: '護理師', role: 'employee', supervisor: APPLICANT },
  { _id: DISABLED, name: '停用帳號', role: 'employee', accountEnabled: false },
]

const mockEmployee = createFakeEmployeeModel([])
// 設定 API 用 Employee.find(...).lean()：在假模型上補一層 lean
const baseFind = mockEmployee.find
mockEmployee.find = jest.fn((...args) => {
  const promise = baseFind(...args)
  return Object.assign(promise, { lean: () => promise })
})
let storedSettings = {}
const mockGetSettings = jest.fn(async () => JSON.parse(JSON.stringify(storedSettings)))
const mockUpdateSettings = jest.fn(async (mutator) => {
  const next = JSON.parse(JSON.stringify(storedSettings))
  await mutator(next)
  storedSettings = next
  return next
})

let resolution
let app
let currentUser = null

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: { find: jest.fn(async () => []) } }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
  }))
  resolution = await import('../src/services/approverResolution.js')
  const { getTopLevelApprovers, updateTopLevelApprovers } = await import('../src/controllers/approvalPolicyController.js')
  const { authorizeRoles } = await import('../src/middleware/auth.js')
  // 與 approvalRoutes.js 相同的掛法（只有管理員）
  const router = express.Router()
  router.get('/top-level-approvers', authorizeRoles('admin'), getTopLevelApprovers)
  router.put('/top-level-approvers', authorizeRoles('admin'), updateTopLevelApprovers)
  app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = currentUser; next() })
  app.use('/api/approvals', router)
})

beforeEach(() => {
  mockEmployee.rows.splice(0, mockEmployee.rows.length, ...seed())
  storedSettings = {}
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

const applicant = () => mockEmployee.rows.find(row => row._id === APPLICANT)
const managerStep = (extra = {}) => ({ approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', ...extra })

describe('resolveTopLevelApprovers / resolveStepApprovers', () => {
  it('goes to every eligible admin (not the departed one) when nothing is configured', async () => {
    expect(await resolution.resolveTopLevelApprovers(applicant())).toEqual({ ids: [ADMIN_A, ADMIN_B], source: 'admins' })
  })

  it('goes to the configured people, skipping the ineligible ones and the applicant', async () => {
    storedSettings = { topLevelApproverIds: [DIRECTOR, DISABLED, APPLICANT, 'junk', DIRECTOR] }
    expect(await resolution.resolveTopLevelApprovers(applicant())).toEqual({ ids: [DIRECTOR], source: 'setting' })
  })

  it('goes to the admins when the configured people cannot sign (left, or only the applicant)', async () => {
    storedSettings = { topLevelApproverIds: [DISABLED] }
    expect((await resolution.resolveTopLevelApprovers(applicant())).source).toBe('admins')
    const director = mockEmployee.rows.find(row => row._id === DIRECTOR)
    expect(await resolution.resolveTopLevelApprovers(director, { configuredIds: [DIRECTOR] })).toEqual({ ids: [ADMIN_A, ADMIN_B], source: 'admins' })
  })

  it('keeps the old "nobody" answer when there is nobody to fall back to', async () => {
    for (const row of mockEmployee.rows) if (row.role === 'admin') row.status = '離職員工'
    expect(await resolution.resolveTopLevelApprovers(applicant())).toEqual({ ids: [], source: '' })
    expect(await resolution.resolveStepApprovers(managerStep(), applicant())).toEqual({ ids: [], reason: 'no-supervisor' })
  })

  it('treats a settings read failure like no setting (the admins still get the request)', async () => {
    mockGetSettings.mockRejectedValueOnce(Object.assign(new Error('db down'), { name: 'MongoNetworkError' }))
    expect((await resolution.resolveTopLevelApprovers(applicant())).source).toBe('admins')
    expect(console.error).toHaveBeenCalledWith('[approval] load top-level approvers failed: MongoNetworkError')
  })

  it('falls back only for a required manager step without an eligible supervisor', async () => {
    const fallback = await resolution.resolveStepApprovers(managerStep(), applicant())
    expect(fallback).toEqual({
      ids: [ADMIN_A, ADMIN_B],
      reason: '',
      fallback: { reason: 'no-supervisor', reason_text: '申請人沒有設定直屬主管', source: 'admins', text: '無上級主管，改由系統管理員簽核（任一位核准即可）' },
    })

    const nurse = mockEmployee.rows.find(row => row._id === NURSE)
    expect(await resolution.resolveStepApprovers(managerStep(), nurse)).toEqual({ ids: [APPLICANT], reason: '' })
    expect(await resolution.resolveStepApprovers(managerStep({ is_required: false }), applicant())).toEqual({ ids: [], reason: 'no-supervisor' })
    expect(await resolution.resolveStepApprovers(managerStep({ approver_value: 'garbage' }), applicant())).toEqual({ ids: [], reason: 'invalid-config' })
    expect(await resolution.resolveStepApprovers({ approver_type: 'tag', approver_value: '沒有人' }, applicant())).toEqual({ ids: [], reason: '' })
  })

  it('falls back when the supervisor is the applicant or a designated manager is not a supervisor', async () => {
    const selfSupervised = { ...applicant(), supervisor: APPLICANT }
    expect((await resolution.resolveStepApprovers(managerStep(), selfSupervised)).fallback).toMatchObject({ reason: 'only-applicant', reason_text: '主管就是申請人本人' })
    const designated = await resolution.resolveStepApprovers(managerStep({ approver_value: NURSE }), applicant())
    expect(designated.fallback).toMatchObject({ reason: 'manager-unavailable' })
  })

  it('normalizes the stored setting', () => {
    expect(resolution.normalizeTopLevelApproverIds([ADMIN_A, { _id: DIRECTOR }, ADMIN_A, 'x', null])).toEqual([ADMIN_A, DIRECTOR])
    expect(resolution.normalizeTopLevelApproverIds('nope')).toEqual([])
    expect(resolution.normalizeTopLevelApproverIds(Array.from({ length: 60 }, (_, i) => oid(1000 + i)))).toHaveLength(resolution.MAX_TOP_LEVEL_APPROVERS)
  })
})

describe('GET / PUT /api/approvals/top-level-approvers', () => {
  it.each(['employee', 'supervisor'])('refuses a %s', async (role) => {
    currentUser = { id: NURSE, role }
    expect((await request(app).get('/api/approvals/top-level-approvers')).status).toBe(403)
    expect((await request(app).put('/api/approvals/top-level-approvers').send({ ids: [] })).status).toBe(403)
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })

  it('shows an admin the empty default and the admins who get the requests', async () => {
    currentUser = { id: ADMIN_A, role: 'admin' }
    const res = await request(app).get('/api/approvals/top-level-approvers')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ids: [],
      approvers: [],
      admins: [
        { id: ADMIN_A, name: '人資管理員', employeeId: 'A001', role: 'admin' },
        { id: ADMIN_B, name: '系統管理員', employeeId: 'A002', role: 'admin' },
      ],
      maxCount: 50,
    })
  })

  it('saves the chosen people (once each) and clears them with an empty list', async () => {
    currentUser = { id: ADMIN_A, role: 'admin' }
    const saved = await request(app).put('/api/approvals/top-level-approvers').send({ ids: [DIRECTOR, ADMIN_B, DIRECTOR] })

    expect(saved.status).toBe(200)
    expect(storedSettings.topLevelApproverIds).toEqual([DIRECTOR, ADMIN_B])
    expect(saved.body.approvers).toEqual([
      { id: DIRECTOR, name: '院長', employeeId: 'D001', role: 'supervisor', eligible: true, ineligibleReason: '' },
      { id: ADMIN_B, name: '系統管理員', employeeId: 'A002', role: 'admin', eligible: true, ineligibleReason: '' },
    ])

    const read = await request(app).get('/api/approvals/top-level-approvers')
    expect(read.body.ids).toEqual([DIRECTOR, ADMIN_B])

    const cleared = await request(app).put('/api/approvals/top-level-approvers').send({ ids: [] })
    expect(cleared.status).toBe(200)
    expect(storedSettings.topLevelApproverIds).toEqual([])
  })

  it('marks a saved person who left since, so the admin can replace them', async () => {
    currentUser = { id: ADMIN_A, role: 'admin' }
    storedSettings = { topLevelApproverIds: [DIRECTOR] }
    mockEmployee.rows.find(row => row._id === DIRECTOR).status = '離職員工'

    const res = await request(app).get('/api/approvals/top-level-approvers')
    expect(res.body.approvers).toEqual([expect.objectContaining({ id: DIRECTOR, eligible: false, ineligibleReason: '已離職' })])
  })

  it('refuses a malformed list, unknown people and people who cannot sign, in Chinese, without saving', async () => {
    currentUser = { id: ADMIN_A, role: 'admin' }
    const cases = [
      [{ ids: 'all' }, '最高層簽核人格式不正確，請重新選擇'],
      [{ ids: ['nope'] }, '最高層簽核人格式不正確，請重新選擇'],
      [{ ids: [oid(999)] }, '找不到部分員工，請重新整理後再選'],
      [{ ids: [ADMIN_LEFT, DISABLED] }, '離職管理員（已離職）、停用帳號（帳號已停用）不能簽核，請改選在職且帳號啟用的員工'],
      [{ ids: Array.from({ length: 51 }, (_, i) => oid(2000 + i)) }, '最高層簽核人最多 50 位'],
    ]
    for (const [body, message] of cases) {
      const res = await request(app).put('/api/approvals/top-level-approvers').send(body)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: message })
    }
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })

  it('answers a generic Chinese 500 when the settings cannot be saved', async () => {
    currentUser = { id: ADMIN_A, role: 'admin' }
    mockUpdateSettings.mockRejectedValueOnce(Object.assign(new Error('secret'), { name: 'MongoServerError' }))
    const res = await request(app).put('/api/approvals/top-level-approvers').send({ ids: [DIRECTOR] })
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: '無法儲存最高層簽核人設定，請稍後再試' })
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('secret')
  })
})
