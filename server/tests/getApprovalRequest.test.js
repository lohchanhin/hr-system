import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'
import { oid, queryResult } from './helpers/approvalTestKit.js'

const EMP = oid(1)
const SUP = oid(2)
const ADMIN = oid(6)
const REQ = oid(200)

const mockApprovalRequest = { findById: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetAnnualLeaveBalance = jest.fn()
const mockGetSettings = jest.fn()
const mockGetDictionaryItems = jest.fn()
let currentUser

let app
let approvalRoutes

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/services/annualLeaveService.js', () => ({
    deductAnnualLeave: jest.fn(),
    refundAnnualLeave: jest.fn(),
    isAnnualLeaveConfigured: jest.fn(),
    getAnnualLeaveBalance: mockGetAnnualLeaveBalance,
  }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    getDictionaryItems: mockGetDictionaryItems,
  }))
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticate: (req, res, next) => { req.user = currentUser; next() },
    authorizeRoles: () => (req, res, next) => { req.user = currentUser; next() }
  }))
  approvalRoutes = (await import('../src/routes/approvalRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/approvals', approvalRoutes)
})

beforeEach(() => {
  currentUser = { id: EMP, role: 'employee' }
  mockApprovalRequest.findById.mockReset()
  mockFormField.find.mockReset()
  mockGetAnnualLeaveBalance.mockReset()
  mockGetSettings.mockReset()
  mockGetDictionaryItems.mockReset()
})

function mockDoc(doc) {
  const query = queryResult(doc)
  mockApprovalRequest.findById.mockReturnValue(query)
  return query
}

describe('GET /api/approvals/:id', () => {
  it('returns approval request with form fields', async () => {
    const doc = {
      _id: REQ,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: { _id: 'form1', name: 'F', category: 'C' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    const fields = [{ _id: 'field1', label: 'Field 1', order: 1 }]
    const query = mockDoc(doc)
    const sort = jest.fn().mockResolvedValue(fields)
    mockFormField.find.mockReturnValue({ sort })

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.status).toBe(200)
    // 每個欄位都會多帶 dictionaryKey / optionsSource（沒有連結字典的欄位為 null / 'own'）
    expect(res.body.form.fields).toEqual(fields.map(f => ({ ...f, dictionaryKey: null, optionsSource: 'own' })))
    expect(Object.keys(res.body.form_data)).toEqual(fields.map(f => f._id))
    expect(mockFormField.find).toHaveBeenCalledWith({ form: 'form1' })
    expect(sort).toHaveBeenCalledWith({ order: 1 })
    expect(query.populate).toHaveBeenCalledWith('logs.by_employee', 'name employeeId')
  })

  it('rejects a malformed id with a 400 instead of a Mongoose cast error', async () => {
    const res = await request(app).get('/api/approvals/abc')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: '簽核單編號格式不正確' })
    expect(mockApprovalRequest.findById).not.toHaveBeenCalled()
  })

  it('returns the live dictionary options (with dictionaryKey and optionsSource) for a dictionary-linked select field', async () => {
    const doc = {
      _id: REQ,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: { _id: 'form9', name: '休假/事假/公假申請單', category: 'C', semanticType: 'leave' },
      form_data: { 'f-type': '特休假' },
      toObject() { return this }
    }
    mockDoc(doc)
    const stored = ['休假', '事假', '公假']
    mockFormField.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        { _id: 'f-type', label: '假別類別 (C12)', type_1: 'select', options: stored, order: 1 },
        { _id: 'f-start', label: '日期(起)', type_1: 'date', order: 2 },
      ]),
    })
    mockGetSettings.mockResolvedValue({ itemSettings: { C12: ['特休假', '病假', '事假'] } })
    mockGetDictionaryItems.mockResolvedValue([
      { name: '特休假', code: '特休假' }, { name: '病假', code: '病假' }, { name: '事假', code: '事假' },
    ])
    mockGetAnnualLeaveBalance.mockResolvedValue({ remainingDays: 8 })

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.status).toBe(200)
    const [typeField, startField] = res.body.form.fields
    expect(typeField.options).toEqual([
      { label: '特休假', value: '特休假' }, { label: '病假', value: '病假' }, { label: '事假', value: '事假' },
    ])
    expect(typeField.dictionaryKey).toBe('C12')
    expect(typeField.optionsSource).toBe('dictionary')
    expect(startField.dictionaryKey).toBeNull()
    expect(startField.optionsSource).toBe('own')
    expect(stored).toEqual(['休假', '事假', '公假'])
    expect(res.body.leave_balance).toEqual({ remainingDays: 8 })
  })

  it('attaches the applicant\'s annual leave balance when the form is a leave-type approval', async () => {
    const doc = {
      _id: REQ,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: { _id: 'form1', name: '請假申請', category: 'C', semanticType: 'leave' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    mockDoc(doc)
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
    const balance = { employeeId: 'A001', name: 'Employee', totalDays: 14, usedDays: 6, remainingDays: 8, year: 2026 }
    mockGetAnnualLeaveBalance.mockResolvedValue(balance)

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.status).toBe(200)
    expect(res.body.leave_balance).toEqual(balance)
    expect(mockGetAnnualLeaveBalance).toHaveBeenCalledWith(EMP)
  })

  it('does not attach a leave balance (or call the balance lookup) for a non-leave-type approval', async () => {
    const doc = {
      _id: REQ,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: { _id: 'form1', name: '加班申請', category: 'C', semanticType: 'overtime' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    mockDoc(doc)
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.status).toBe(200)
    expect(res.body.leave_balance).toBeUndefined()
    expect(mockGetAnnualLeaveBalance).not.toHaveBeenCalled()
  })

  it('falls back to a null leave balance instead of failing the whole request when the balance lookup errors', async () => {
    const doc = {
      _id: REQ,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: { _id: 'form1', name: '請假申請', category: 'C', semanticType: 'leave' },
      form_data: { field1: 'v1' },
      toObject() { return this }
    }
    mockDoc(doc)
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
    mockGetAnnualLeaveBalance.mockRejectedValue(new Error('boom'))

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.status).toBe(200)
    expect(res.body.leave_balance).toBeNull()
  })

  it('returns not found when the employee is not a request participant', async () => {
    mockDoc({
      _id: REQ,
      applicant_employee: { _id: oid(77) },
      form: { _id: 'form1', name: 'F', category: 'C' },
      steps: [{ approvers: [{ approver: { _id: oid(78) } }] }],
    })

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: '找不到這張簽核單' })
    expect(mockFormField.find).not.toHaveBeenCalled()
  })

  it('still opens a request whose form template was deleted', async () => {
    const doc = {
      _id: REQ,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: null,
      populated: () => oid(100),
      form_data: {},
      steps: [],
      toObject() { return { _id: REQ, applicant_employee: this.applicant_employee, form: null, form_data: {}, steps: [] } },
    }
    mockDoc(doc)

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.status).toBe(200)
    expect(res.body.form).toEqual({ _id: oid(100), name: '（表單已刪除）', category: '', fields: [], deleted: true })
    expect(mockFormField.find).not.toHaveBeenCalled()
  })

  it('tells the viewer whether they can act, and exposes the last return reason', async () => {
    currentUser = { id: SUP, role: 'supervisor' }
    const doc = {
      _id: REQ,
      status: 'pending',
      current_step_index: 0,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: { _id: 'form1', name: 'F', category: 'C' },
      steps: [{ approvers: [{ approver: { _id: SUP, name: '主管' }, decision: 'pending' }] }],
      logs: [
        { action: 'create' },
        { action: 'return', at: '2026-01-02T00:00:00.000Z', comment: '請補件', message: '退回申請者：請補件', step_order: 1, by_employee: { _id: SUP, name: '主管' } },
      ],
      form_data: {},
      toObject() { return JSON.parse(JSON.stringify(this)) },
    }
    mockDoc(doc)
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })

    const res = await request(app).get(`/api/approvals/${REQ}`)

    expect(res.body.viewer).toEqual({ is_applicant: false, can_act: true, can_override: false })
    expect(res.body.last_return).toEqual({
      at: '2026-01-02T00:00:00.000Z',
      by: { _id: SUP, name: '主管' },
      comment: '請補件',
      message: '退回申請者：請補件',
      step_order: 1,
    })
  })

  it('offers the override to an administrator who is not on the step, and nothing to the applicant', async () => {
    const base = {
      _id: REQ,
      status: 'pending',
      current_step_index: 0,
      applicant_employee: { _id: EMP, name: 'Employee' },
      form: { _id: 'form1', name: 'F', category: 'C' },
      steps: [{ approvers: [{ approver: { _id: SUP, name: '主管' }, decision: 'pending' }] }],
      form_data: {},
      toObject() { return JSON.parse(JSON.stringify(this)) },
    }
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })

    currentUser = { id: ADMIN, role: 'admin' }
    mockDoc(base)
    const admin = await request(app).get(`/api/approvals/${REQ}`)
    expect(admin.body.viewer).toEqual({ is_applicant: false, can_act: false, can_override: true })
    expect(admin.body.last_return).toBeNull()

    currentUser = { id: EMP, role: 'employee' }
    mockDoc(base)
    const applicant = await request(app).get(`/api/approvals/${REQ}`)
    expect(applicant.body.viewer).toEqual({ is_applicant: true, can_act: false, can_override: false })
  })
})
