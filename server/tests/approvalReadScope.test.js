// 2026/11 客戶：「主管帳號將與排班功能切開，維持主管欄位，主要作為簽核使用」。唯讀範圍和能不能排班分開：
// - 預設（只有排班人員能排班）下，沒被指定為排班人員的主管照樣唯讀開啟直屬部屬的任何簽核單、下載附件、看假別餘額；
// - 員工角色的排班人員只看得到被指定小單位員工的請假、加班、換班單（離職等其他表單、附件都不給）；
// - 其他人一律 404。範圍規則在 controllers/schedule/scheduleShared.js 的 resolveEmployeeReadAccess。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import { oid, queryResult } from './helpers/approvalTestKit.js'

const ID = {
  boss: oid(2), nurse: oid(3), outsider: oid(4), scheduler: oid(7), otherBoss: oid(8),
  unit: oid(200), otherUnit: oid(201), dept: oid(100),
  resign: oid(300), overtime: oid(301), formResign: oid(400), formOvertime: oid(401),
}

// 護理甲在 A1（直屬主管 boss）；排班員（員工角色）被指定為 A1 的排班人員；外人在別的小單位、沒有主管
const EMPLOYEES = [
  { _id: ID.boss, role: 'supervisor', department: ID.dept, subDepartment: ID.otherUnit },
  { _id: ID.nurse, role: 'employee', department: ID.dept, subDepartment: ID.unit, supervisor: ID.boss },
  { _id: ID.outsider, role: 'employee', department: ID.dept, subDepartment: ID.otherUnit },
  { _id: ID.scheduler, role: 'employee', department: ID.dept, subDepartment: ID.otherUnit },
  { _id: ID.otherBoss, role: 'supervisor', department: ID.dept },
]
const UNITS = [{ _id: ID.unit, department: ID.dept, schedulers: [ID.scheduler] }]

const valueMatches = (value, condition) => {
  if (condition && typeof condition === 'object' && Array.isArray(condition.$in)) return condition.$in.map(String).includes(String(value))
  if (Array.isArray(value)) return value.map(String).includes(String(condition))
  return String(value ?? '') === String(condition ?? '')
}
const matches = (row, filter = {}) => Object.entries(filter).every(([key, condition]) => (
  key === '$or' ? condition.some((clause) => matches(row, clause)) : valueMatches(row[key], condition)
))
// 一般函式（不是 jest.fn）：資料庫查詢的替身
const rowsQuery = (rows) => {
  const query = { select: () => query, lean: async () => rows, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) }
  return query
}
const mockEmployee = { find: (filter) => rowsQuery(EMPLOYEES.filter((row) => matches(row, filter))) }
const mockSubDepartment = { find: (filter) => rowsQuery(UNITS.filter((row) => matches(row, filter))) }
const mockDepartment = { find: () => rowsQuery([]) }

const FORMS = {
  [ID.formResign]: { _id: ID.formResign, name: '離職申請', category: '人事類', semanticType: 'general' },
  [ID.formOvertime]: { _id: ID.formOvertime, name: '加班申請', category: '人事類', semanticType: 'overtime' },
}
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadDir = path.join(__dirname, '../../upload/approvals')
const filename = 'read-scope-test.pdf'

function approvalDoc(id, formId) {
  const plain = {
    _id: id,
    applicant_employee: { _id: ID.nurse, name: '護理甲' },
    form: FORMS[formId],
    status: 'pending',
    current_step_index: 0,
    // 簽核人是人資（不是主管）：主管、排班人員都不是這張單的參與者
    steps: [{ approvers: [{ approver: { _id: oid(9) }, decision: 'pending' }] }],
    form_data: { reason: '個人生涯規劃（機密）', proof: [{ name: 'proof.pdf', url: `/upload/approvals/${filename}` }] },
    logs: [],
  }
  return { ...plain, toObject: () => JSON.parse(JSON.stringify(plain)) }
}
const DOCS = { [ID.resign]: approvalDoc(ID.resign, ID.formResign), [ID.overtime]: approvalDoc(ID.overtime, ID.formOvertime) }
const mockApprovalRequest = {
  findById: (id) => queryResult(DOCS[String(id)] || null),
  exists: async () => null,
}
const mockApprovalAttachment = { findOne: () => ({ lean: async () => null }) }
const mockFormField = { find: () => queryResult([]) }
const mockBuildLeaveBalances = jest.fn(async ({ employeeId }) => ({ employeeId, items: [] }))

let currentUser
let app

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }))
  await jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/approval_attachment.js', () => ({ default: mockApprovalAttachment }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/services/leaveBalanceService.js', () => ({
    buildLeaveBalances: mockBuildLeaveBalances,
    describeRequestFocus: jest.fn(),
    evaluateLeaveRequestAgainstBalance: jest.fn(),
    computeCompLeavePendingHours: jest.fn(async () => 0),
    currentTaipeiYear: () => 2026,
  }))
  // 其他控制設定沒有存過：排班權限模式是預設的「只有排班人員能排班」
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: async () => ({}),
    getDictionaryItems: async () => [],
  }))
  await jest.unstable_mockModule('../src/models/OtherControlSetting.js', () => ({ default: { findOne: () => ({ lean: async () => null }) } }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => { req.user = currentUser; next() },
    authorizeRoles: () => (req, res, next) => { req.user = currentUser; next() },
  }))
  const approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/approvals', approvalRoutes)
  fs.mkdirSync(uploadDir, { recursive: true })
  fs.writeFileSync(path.join(uploadDir, filename), '%PDF-1.4\n%%EOF\n')
})

afterAll(() => {
  try {
    fs.unlinkSync(path.join(uploadDir, filename))
  } catch {
    // 已經刪掉就算了
  }
})

const loginAs = (key, role) => { currentUser = { id: ID[key], role } }
const detail = (id) => request(app).get(`/api/approvals/${id}`)
const attachment = (id) => request(app).get(`/api/approvals/${id}/attachments/${filename}`)
const balances = (employeeId) => request(app).get(`/api/approvals/leave-balances?employeeId=${employeeId}`)

describe('a supervisor who is not a scheduler (default scheduler_only mode)', () => {
  it('still opens any request of a direct report read-only, downloads its attachment and sees the balances', async () => {
    loginAs('boss', 'supervisor')
    const resign = await detail(ID.resign)
    expect(resign.status).toBe(200)
    expect(resign.body.form_data.reason).toBe('個人生涯規劃（機密）')
    expect(resign.body.viewer).toMatchObject({ is_applicant: false, can_act: false })
    expect((await detail(ID.overtime)).status).toBe(200)
    expect((await attachment(ID.resign)).status).toBe(200)

    const res = await balances(ID.nurse)
    expect(res.status).toBe(200)
    expect(mockBuildLeaveBalances).toHaveBeenCalledWith(expect.objectContaining({ employeeId: ID.nurse }))
  })

  it('gets 404 for somebody who is not a direct report', async () => {
    loginAs('otherBoss', 'supervisor')
    expect((await detail(ID.resign)).status).toBe(404)
    expect((await attachment(ID.resign)).status).toBe(404)
    expect((await balances(ID.nurse)).status).toBe(404)
  })
})

describe('an employee-role scheduler of the applicant\'s unit', () => {
  it('opens the leave, overtime and shift requests it needs for rostering, but not a resignation and never an attachment', async () => {
    loginAs('scheduler', 'employee')
    expect((await detail(ID.overtime)).status).toBe(200)
    const resign = await detail(ID.resign)
    expect(resign.status).toBe(404)
    expect(resign.body).not.toHaveProperty('form_data')
    expect((await attachment(ID.overtime)).status).toBe(404)
    expect((await attachment(ID.resign)).status).toBe(404)
    // 假別餘額：請假單明細本來就附上，排班範圍內照樣看得到
    expect((await balances(ID.nurse)).status).toBe(200)
  })

  it('gets nothing for an employee outside the assigned unit, and an unassigned employee gets nothing at all', async () => {
    loginAs('scheduler', 'employee')
    expect((await balances(ID.outsider)).status).toBe(404)
    loginAs('outsider', 'employee')
    expect((await detail(ID.overtime)).status).toBe(404)
    expect((await balances(ID.nurse)).status).toBe(404)
  })
})
