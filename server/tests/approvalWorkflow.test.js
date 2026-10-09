import { jest } from '@jest/globals'
import { createFakeEmployeeModel, leanable, oid, queryResult } from './helpers/approvalTestKit.js'

const APPLICANT = oid(1)
const SUP = oid(2)
const HR1 = oid(3)
const HR2 = oid(4)
const HR3 = oid(5)
const ADMIN = oid(6)
const LEAD1 = oid(7)
const LEAD2 = oid(8)
const OTHER = oid(9)
const HR_LEFT = oid(10)
const FORM = oid(100)
const WF = oid(101)
const REQ = oid(200)

const mockFormTemplate = { findById: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn(), findById: jest.fn() }
const mockApprovalRequest = { create: jest.fn(), findById: jest.fn(), findOne: jest.fn() }
const mockApprovalAttachment = { find: jest.fn(), updateMany: jest.fn(), insertMany: jest.fn(), findOne: jest.fn() }
const mockEmployee = createFakeEmployeeModel([])
const mockAssertApprovalRequestCompliance = jest.fn()
const mockIsLaborRuleValidationError = jest.fn((error) => Array.isArray(error?.violations))
const mockDeductAnnualLeave = jest.fn()
const mockRefundAnnualLeave = jest.fn()

let createApprovalRequest
let actOnApproval
let cancelApprovalRequest
let resubmitApprovalRequest

function seedEmployees() {
  return [
    { _id: APPLICANT, name: '申請人', role: 'employee', supervisor: SUP, signTags: [], annualLeave: { totalDays: 0, usedDays: 0 } },
    { _id: SUP, name: '主管', role: 'supervisor', signTags: [] },
    { _id: HR1, name: '人資一', role: 'employee', signTags: ['人資'] },
    { _id: HR2, name: '人資二', role: 'employee', signTags: ['人資'] },
    { _id: HR3, name: '人資三', role: 'employee', signTags: ['人資'] },
    { _id: HR_LEFT, name: '離職人資', role: 'employee', signTags: ['人資'], status: '離職員工' },
    { _id: LEAD1, name: '組長一', role: 'employee', signTags: [] },
    { _id: LEAD2, name: '組長二', role: 'employee', signTags: [] },
    { _id: ADMIN, name: '管理員', role: 'admin', signTags: [] },
    { _id: OTHER, name: '路人', role: 'employee', signTags: [] },
  ]
}

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/approval_attachment.js', () => ({ default: mockApprovalAttachment }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
    assertApprovalRequestCompliance: mockAssertApprovalRequestCompliance,
    isLaborRuleValidationError: mockIsLaborRuleValidationError,
  }))
  await jest.unstable_mockModule('../src/services/annualLeaveService.js', () => ({
    deductAnnualLeave: mockDeductAnnualLeave,
    refundAnnualLeave: mockRefundAnnualLeave,
    getAnnualLeaveBalance: jest.fn(),
    isAnnualLeaveConfigured: (employee) => Number(employee?.annualLeave?.totalDays) > 0 || Number(employee?.annualLeave?.usedDays) > 0,
  }))
  const mod = await import('../src/controllers/approvalRequestController.js')
  createApprovalRequest = mod.createApprovalRequest
  actOnApproval = mod.actOnApproval
  cancelApprovalRequest = mod.cancelApprovalRequest
  resubmitApprovalRequest = mod.resubmitApprovalRequest
})

beforeEach(() => {
  for (const mock of [mockFormTemplate, mockFormField, mockApprovalWorkflow, mockApprovalRequest, mockApprovalAttachment]) {
    Object.values(mock).forEach(fn => fn.mockReset())
  }
  mockEmployee.rows.splice(0, mockEmployee.rows.length, ...seedEmployees())
  mockEmployee.find.mockClear()
  mockFormField.find.mockImplementation(() => queryResult([]))
  mockAssertApprovalRequestCompliance.mockReset()
  mockAssertApprovalRequestCompliance.mockResolvedValue({ ok: true, violations: [] })
  mockIsLaborRuleValidationError.mockClear()
  mockDeductAnnualLeave.mockReset()
  mockRefundAnnualLeave.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), set: jest.fn() }
}

function makeCreateReq(body, userId = APPLICANT, role = 'employee') {
  return { body, user: { id: userId, role } }
}

function buildMockDoc(payload, overrides = {}) {
  const steps = (payload.steps || []).map(step => ({
    ...step,
    approvers: (step.approvers || []).map(a => ({ ...a })),
  }))
  const logs = (payload.logs || []).map(log => ({ ...log }))
  return {
    ...payload,
    ...overrides,
    _id: overrides._id || payload._id || REQ,
    steps,
    logs,
    save: jest.fn().mockResolvedValue(),
  }
}

// 已存在的簽核單（供 act / cancel / resubmit 使用）；steps 簡寫：[{ approvers: [[id, decision]], ...旗標 }]
function makeRequestDoc({ steps, ...overrides } = {}) {
  return {
    _id: REQ,
    form: FORM,
    workflow: WF,
    form_data: {},
    applicant_employee: APPLICANT,
    status: 'pending',
    current_step_index: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    logs: [],
    ...overrides,
    steps: (steps || [{ approvers: [[SUP, 'pending']] }]).map(step => ({
      all_must_approve: true,
      is_required: true,
      can_return: true,
      ...step,
      approvers: (step.approvers || []).map(([approver, decision = 'pending']) => ({ approver, decision })),
    })),
    save: jest.fn().mockResolvedValue(),
    markModified: jest.fn(),
  }
}

function act(doc, { user, body }) {
  mockApprovalRequest.findById.mockResolvedValue(doc)
  const res = makeRes()
  return actOnApproval({ params: { id: REQ }, user, body }, res).then(() => res)
}

const supUser = (id = SUP) => ({ id, role: 'supervisor' })
const employeeUser = (id) => ({ id, role: 'employee' })
const adminUser = () => ({ id: ADMIN, role: 'admin' })
const decisions = (doc, stepIndex = 0) => doc.steps[stepIndex].approvers.map(a => a.decision)
const versionError = () => Object.assign(new Error('No matching document found'), { name: 'VersionError' })

function stubForm(overrides = {}) {
  const form = { _id: FORM, name: '外出單', is_active: true, ...overrides }
  mockFormTemplate.findById.mockImplementation(() => leanable(form))
  return form
}

function stubWorkflow(steps) {
  const wf = { _id: WF, form: FORM, steps }
  mockApprovalWorkflow.findOne.mockResolvedValue(wf)
  mockApprovalWorkflow.findById.mockResolvedValue(wf)
  return wf
}

function stubCreate() {
  const created = { doc: null }
  mockApprovalRequest.create.mockImplementation(async (payload) => {
    created.doc = buildMockDoc(payload)
    return created.doc
  })
  return created
}

describe('createApprovalRequest', () => {
  it('creates request when form and workflow exist', async () => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    const created = stubCreate()
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {}, applicant_employee_id: APPLICANT }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', applicant_employee: APPLICANT }))
    expect(created.doc.status).toBe('pending')
    expect(created.doc.steps[0].approvers).toEqual([{ approver: LEAD1, decision: 'pending' }])
    expect(created.doc.steps[0].started_at).toBeInstanceOf(Date)
    expect(created.doc.logs[0]).toEqual(expect.objectContaining({ action: 'create', by_employee: APPLICANT }))
  })

  it('runs the labor rule check on the sanitised data and asks for leave-conflict checking', async () => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockFormField.find.mockImplementation(() => queryResult([{ _id: 'f-text', label: '事由', type_1: 'text' }]))
    const created = stubCreate()

    await createApprovalRequest(makeCreateReq({
      form_id: FORM,
      form_data: { 'f-text': '出差', hours: 0.001, amount: 50000 },
    }), makeRes())

    expect(mockAssertApprovalRequestCompliance).toHaveBeenCalledWith(expect.objectContaining({
      formData: { 'f-text': '出差' },
      checkLeaveConflicts: true,
    }))
    expect(created.doc.form_data).toEqual({ 'f-text': '出差' })
  })

  it('rejects malformed form_data before anything is stored', async () => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockFormField.find.mockImplementation(() => queryResult([{ _id: 'f-num', label: '金額', type_1: 'number' }]))
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: { 'f-num': 'abc' } }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('金額'), code: 'INVALID_FORM_DATA' }))
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('returns a Chinese error if form missing', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: oid(999), form_data: {}, applicant_employee_id: APPLICANT }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '找不到這個表單' })
  })

  it('rejects a form id that is not an ObjectId', async () => {
    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: 'bad', form_data: {} }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '表單編號格式不正確' })
    expect(mockFormTemplate.findById).not.toHaveBeenCalled()
  })

  it('returns a Chinese error if workflow missing', async () => {
    stubForm({ name: '請假' })
    mockApprovalWorkflow.findOne.mockResolvedValue(null)
    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '【請假】尚未設定簽核流程，請聯絡管理員' })
  })

  it('returns overtime rule violations before creating request', async () => {
    stubForm({ name: '加班申請' })
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    const error = new Error('加班規範檢核未通過')
    error.status = 400
    error.violations = [{ rule: 'regular-rest-overtime', message: '例假不得加班' }]
    mockAssertApprovalRequestCompliance.mockRejectedValue(error)

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '加班規範檢核未通過', violations: error.violations })
  })

  it('rejects a required manager step when applicant has no supervisor, with an actionable Chinese message', async () => {
    stubForm()
    stubWorkflow([
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      { step_order: 2, approver_type: 'user', approver_value: [LEAD1] },
    ])
    mockEmployee.rows.find(row => row._id === APPLICANT).supervisor = null

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: '【外出單】第1關（申請者的主管）找不到可簽核的人員：申請人尚未設定直屬主管，請聯絡管理員設定',
      code: 'REQUIRED_APPROVER_MISSING',
      step: 1,
    })
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('names the tag in the error when a required tag step has no holder (step number is the designer step)', async () => {
    stubForm({ name: '請假' })
    stubWorkflow([
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      { step_order: 2, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      { step_order: 3, approver_type: 'tag', approver_value: '不存在的標籤' },
    ])

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: '【請假】第3關（標籤：不存在的標籤）找不到可簽核的人員，請聯絡管理員設定',
      code: 'REQUIRED_APPROVER_MISSING',
      step: 3,
    })
  })

  it('refuses an inactive tag holder and names the reason when the applicant is the only holder', async () => {
    stubForm({ name: '在職證明' })
    stubWorkflow([{ step_order: 1, approver_type: 'tag', approver_value: '唯一', scope_type: 'none' }])
    mockEmployee.rows.find(row => row._id === APPLICANT).signTags = ['唯一']
    mockEmployee.rows.find(row => row._id === HR_LEFT).signTags = ['唯一']

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: '【在職證明】第1關（標籤：唯一）找不到可簽核的人員：符合條件的簽核人只有申請人本人，請聯絡管理員設定',
      code: 'REQUIRED_APPROVER_MISSING',
    }))
  })

  it('never lists the applicant, or departed holders, among the approvers of a tag step', async () => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'tag', approver_value: '人資', all_must_approve: false }])
    mockEmployee.rows.find(row => row._id === APPLICANT).signTags = ['人資']
    const created = stubCreate()

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc.steps[0].approvers.map(a => a.approver).sort()).toEqual([HR1, HR2, HR3].sort())
    expect(created.doc.steps[0].all_must_approve).toBe(false)
  })

  it('resolves 角色 R003 and 層級 U002 steps through the employee sign settings', async () => {
    stubForm()
    stubWorkflow([
      { step_order: 1, approver_type: 'role', approver_value: 'R003' },
      { step_order: 2, approver_type: 'level', approver_value: 'U002' },
    ])
    mockEmployee.rows.find(row => row._id === LEAD1).signRole = 'R003'
    mockEmployee.rows.find(row => row._id === LEAD2).signLevel = 'U002'
    const created = stubCreate()

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc.steps.map(step => step.approvers.map(a => a.approver))).toEqual([[LEAD1], [LEAD2]])
  })

  it('skips an optional workflow step that resolves to no approver (first position)', async () => {
    stubForm()
    stubWorkflow([
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', is_required: false },
      { step_order: 2, approver_type: 'user', approver_value: [LEAD1], is_required: true },
    ])
    mockEmployee.rows.find(row => row._id === APPLICANT).supervisor = null
    const created = stubCreate()

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc.current_step_index).toBe(1)
    expect(created.doc.steps).toHaveLength(2)
    expect(created.doc.logs.map(log => log.action)).toEqual(['create', 'skip', 'move_next'])
  })

  it('refuses a workflow where every step is optional and empty instead of approving it silently', async () => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'tag', approver_value: '沒人有', is_required: false }])

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUIRED_APPROVER_MISSING', step: 1 }))
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('merges consecutive steps with identical approvers and config', async () => {
    stubForm({ name: '出差單' })
    stubWorkflow([
      { step_order: 1, approver_type: 'user', approver_value: [LEAD1], all_must_approve: true, is_required: true, can_return: false },
      { step_order: 2, approver_type: 'user', approver_value: [LEAD1], all_must_approve: true, is_required: true, can_return: false },
      { step_order: 3, approver_type: 'user', approver_value: [LEAD2], all_must_approve: false, is_required: true, can_return: false },
    ])
    const created = stubCreate()

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {}, applicant_employee_id: APPLICANT }), res)

    expect(mockApprovalRequest.create).toHaveBeenCalledTimes(1)
    const payload = mockApprovalRequest.create.mock.calls[0][0]
    expect(payload.steps).toHaveLength(2)
    expect(payload.steps[0].step_order).toBe(1)
    expect(payload.steps[0].approvers).toEqual([{ approver: LEAD1, decision: 'pending' }])
    expect(payload.steps[1].step_order).toBe(2)
    expect(payload.steps[1].approvers).toEqual([{ approver: LEAD2, decision: 'pending' }])

    expect(created.doc.current_step_index).toBe(0)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0].steps).toHaveLength(2)
  })

  it('rejects creating a request for another employee', async () => {
    const res = makeRes()

    await createApprovalRequest(
      makeCreateReq({ form_id: FORM, form_data: {}, applicant_employee_id: OTHER }),
      res,
    )

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: '不可代替他人送出申請' })
    expect(mockFormTemplate.findById).not.toHaveBeenCalled()
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('returns the existing request for a repeated idempotency key', async () => {
    const existing = { _id: 'existing-request', status: 'pending' }
    mockApprovalRequest.findOne.mockResolvedValue(existing)
    const res = makeRes()

    await createApprovalRequest({
      body: { form_id: FORM, form_data: {} },
      user: { id: APPLICANT, role: 'employee' },
      get: name => name === 'Idempotency-Key' ? 'same-key' : undefined,
    }, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(existing)
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('does not echo internal error messages to the client', async () => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockApprovalRequest.create.mockRejectedValue(new Error('E11000 duplicate key collection: hr.approvalrequests index: secret_idx'))

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    const body = res.json.mock.calls[0][0]
    expect(JSON.stringify(body)).not.toContain('secret_idx')
    expect(body.error).toMatch(/系統發生錯誤/)
  })

  it('maps Mongoose cast errors to a generic Chinese 400', async () => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockApprovalRequest.create.mockRejectedValue(Object.assign(new Error('Cast to ObjectId failed for value "abc"'), { name: 'CastError' }))

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '資料格式不正確，請確認後重新送出' })
  })
})

describe('createApprovalRequest - annual leave balance at filing', () => {
  const LEAVE_FIELDS = [
    { _id: 'l-type', label: '假別', type_1: 'select', options: ['特休', '病假'], order: 1 },
    { _id: 'l-start', label: '開始時間', type_1: 'datetime', order: 2 },
    { _id: 'l-end', label: '結束時間', type_1: 'datetime', order: 3 },
  ]

  function setupLeave({ annualLeave }) {
    stubForm({ name: '請假', semanticType: 'leave' })
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockFormField.find.mockImplementation(() => queryResult(LEAVE_FIELDS))
    mockEmployee.rows.find(row => row._id === APPLICANT).annualLeave = annualLeave
    return stubCreate()
  }

  it('rejects a 特休 request that exceeds the remaining balance', async () => {
    setupLeave({ annualLeave: { totalDays: 5, usedDays: 4 } })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({
      form_id: FORM,
      form_data: { 'l-type': '特休', 'l-start': '2026-03-02', 'l-end': '2026-03-04' },
    }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: '特休餘額不足：剩餘 1 天，本次申請 3 天',
      code: 'ANNUAL_LEAVE_INSUFFICIENT',
      remaining: 1,
      requested: 3,
    })
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('accepts a same-day 特休 request when one day is left (09:00-18:00 is one day, not two)', async () => {
    const created = setupLeave({ annualLeave: { totalDays: 5, usedDays: 4 } })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({
      form_id: FORM,
      form_data: { 'l-type': '特休', 'l-start': '2026-03-02T01:00:00.000Z', 'l-end': '2026-03-02T10:00:00.000Z' },
    }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc).toBeTruthy()
  })

  it('does not apply the balance check to other leave types', async () => {
    const created = setupLeave({ annualLeave: { totalDays: 5, usedDays: 5 } })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({
      form_id: FORM,
      form_data: { 'l-type': '病假', 'l-start': '2026-03-02', 'l-end': '2026-03-09' },
    }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc).toBeTruthy()
  })

  it('does not block employees whose annual leave quota was never configured', async () => {
    const created = setupLeave({ annualLeave: { totalDays: 0, usedDays: 0 } })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({
      form_id: FORM,
      form_data: { 'l-type': '特休', 'l-start': '2026-03-02', 'l-end': '2026-03-04' },
    }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc).toBeTruthy()
  })

  it('rejects an end date before the start date for 特休', async () => {
    setupLeave({ annualLeave: { totalDays: 5, usedDays: 0 } })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({
      form_id: FORM,
      form_data: { 'l-type': '特休', 'l-start': '2026-03-05', 'l-end': '2026-03-02' },
    }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '請假結束日期不可早於開始日期', code: 'INVALID_LEAVE_RANGE' })
  })
})

describe('createApprovalRequest - attachments', () => {
  const FILE_FIELDS = [{ _id: 'f-file', label: '附件', type_1: 'file' }]
  const FILENAME = '1700000000000-abcdef0123456789.pdf'

  beforeEach(() => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockFormField.find.mockImplementation(() => queryResult(FILE_FIELDS))
    mockApprovalAttachment.updateMany.mockResolvedValue({ modifiedCount: 1 })
  })

  const body = { form_id: FORM, form_data: { 'f-file': [{ name: '偽造.pdf', url: `/upload/approvals/${FILENAME}`, size: 1, type: 'x' }] } }

  it('binds an attachment the applicant uploaded and takes the stored metadata', async () => {
    mockApprovalAttachment.find.mockReturnValue({ lean: async () => [
      { filename: FILENAME, uploader: APPLICANT, request: null, original_name: '請假證明.pdf', size: 1234, mime: 'application/pdf' },
    ] })
    const created = stubCreate()

    const res = makeRes()
    await createApprovalRequest(makeCreateReq(body), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc.form_data['f-file']).toEqual([{
      name: '請假證明.pdf', url: `/upload/approvals/${FILENAME}`, size: 1234, type: 'application/pdf',
    }])
    expect(mockApprovalAttachment.updateMany).toHaveBeenCalledWith(
      { filename: { $in: [FILENAME] }, uploader: APPLICANT, request: null },
      { $set: { request: expect.anything() } },
    )
  })

  it('rejects a file somebody else uploaded', async () => {
    mockApprovalAttachment.find.mockReturnValue({ lean: async () => [
      { filename: FILENAME, uploader: OTHER, request: null },
    ] })

    const res = makeRes()
    await createApprovalRequest(makeCreateReq(body), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('不是由您上傳') }))
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('rejects a file already attached to another request and a made-up path', async () => {
    mockApprovalAttachment.find.mockReturnValue({ lean: async () => [
      { filename: FILENAME, uploader: APPLICANT, request: oid(777) },
    ] })
    const used = makeRes()
    await createApprovalRequest(makeCreateReq(body), used)
    expect(used.status).toHaveBeenCalledWith(400)
    expect(used.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('已被其他申請使用') }))

    mockApprovalAttachment.find.mockReturnValue({ lean: async () => [] })
    const madeUp = makeRes()
    await createApprovalRequest(makeCreateReq(body), madeUp)
    expect(madeUp.status).toHaveBeenCalledWith(400)
    expect(madeUp.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('附件無效') }))
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('releases the claimed files when the request cannot be stored', async () => {
    mockApprovalAttachment.find.mockReturnValue({ lean: async () => [
      { filename: FILENAME, uploader: APPLICANT, request: null },
    ] })
    mockApprovalRequest.create.mockRejectedValue(new Error('boom'))

    const res = makeRes()
    await createApprovalRequest(makeCreateReq(body), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(mockApprovalAttachment.updateMany).toHaveBeenLastCalledWith(
      { filename: { $in: [FILENAME] }, request: expect.anything() },
      { $set: { request: null } },
    )
  })
})

describe('actOnApproval authorization', () => {
  it('does not allow an employee to act as a body-supplied supervisor', async () => {
    const doc = makeRequestDoc()
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await actOnApproval({
      params: { id: REQ },
      user: employeeUser(OTHER),
      body: { employee_id: SUP, decision: 'approve' },
    }, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: '不可代替他人簽核' })
    expect(mockApprovalRequest.findById).not.toHaveBeenCalled()
    expect(doc.save).not.toHaveBeenCalled()
    expect(decisions(doc)).toEqual(['pending'])
  })

  it('does not reveal the status of a request to a non-participant', async () => {
    const doc = makeRequestDoc({ status: 'approved', steps: [{ approvers: [[SUP, 'approved']] }] })
    const res = await act(doc, { user: employeeUser(OTHER), body: { decision: 'approve' } })

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: '找不到這張簽核單' })
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('rejects a malformed request id and invalid payloads before touching the database', async () => {
    const badId = makeRes()
    await actOnApproval({ params: { id: 'abc' }, user: supUser(), body: { decision: 'approve' } }, badId)
    expect(badId.status).toHaveBeenCalledWith(400)
    expect(badId.json).toHaveBeenCalledWith({ error: '簽核單編號格式不正確' })

    const badComment = makeRes()
    await actOnApproval({ params: { id: REQ }, user: supUser(), body: { decision: 'approve', comment: { a: 1 } } }, badComment)
    expect(badComment.status).toHaveBeenCalledWith(400)
    expect(badComment.json).toHaveBeenCalledWith({ error: '意見內容格式不正確' })

    const badDecision = makeRes()
    await actOnApproval({ params: { id: REQ }, user: supUser(), body: { decision: 'maybe' } }, badDecision)
    expect(badDecision.status).toHaveBeenCalledWith(400)
    expect(mockApprovalRequest.findById).not.toHaveBeenCalled()
  })

  it('revalidates labor rules before approving and keeps the request pending on failure', async () => {
    const doc = makeRequestDoc({
      form_data: { start: '2038-03-16T09:00:00.000Z', end: '2038-03-16T12:00:00.000Z' },
      applicant_employee: APPLICANT,
    })
    mockFormTemplate.findById.mockImplementation(() => leanable({ _id: FORM, name: '加班申請', is_active: true }))
    const error = new Error('加班規範檢核未通過')
    error.status = 400
    error.violations = [{ rule: 'monthly-overtime-hours', minutes: 2820 }]
    mockAssertApprovalRequestCompliance.mockRejectedValue(error)

    const res = await act(doc, { user: supUser(), body: { decision: 'approve' } })

    expect(mockAssertApprovalRequestCompliance).toHaveBeenCalledWith({
      form: expect.objectContaining({ _id: FORM }),
      formData: doc.form_data,
      applicantEmployeeId: APPLICANT,
      ignoreRequestId: REQ,
      // 送簽之後才新增／改成必填的欄位不追溯，新增必填欄位不會讓待簽的單無法核可
      requiredFieldsAsOf: doc.createdAt,
    })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: error.message, violations: error.violations })
    expect(decisions(doc)).toEqual(['pending'])
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('refuses to approve when the form no longer exists, but still allows rejecting', async () => {
    const doc = makeRequestDoc()
    mockFormTemplate.findById.mockImplementation(() => leanable(null))
    const approve = await act(doc, { user: supUser(), body: { decision: 'approve' } })
    expect(approve.status).toHaveBeenCalledWith(409)
    expect(approve.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORM_NOT_AVAILABLE' }))

    const reject = await act(doc, { user: supUser(), body: { decision: 'reject', comment: '不同意' } })
    expect(doc.status).toBe('rejected')
    expect(reject.status).not.toHaveBeenCalledWith(409)
  })

  it('forbids the applicant from approving, returning or rejecting their own request', async () => {
    for (const decision of ['approve', 'reject', 'return']) {
      const doc = makeRequestDoc({ steps: [{ approvers: [[APPLICANT, 'pending'], [SUP, 'pending']] }] })
      const res = await act(doc, { user: employeeUser(APPLICANT), body: { decision } })
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SELF_APPROVAL' }))
      expect(doc.save).not.toHaveBeenCalled()
    }
  })

  it('forbids even an administrator from deciding on their own request', async () => {
    const doc = makeRequestDoc({ applicant_employee: ADMIN })
    const res = await act(doc, { user: adminUser(), body: { decision: 'approve' } })
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('tells a participant who is not on the current step what is going on (Chinese 409)', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[SUP, 'pending']] }, { approvers: [[HR1, 'pending']] }] })
    const res = await act(doc, { user: employeeUser(HR1), body: { decision: 'approve' } })

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_STEP_APPROVER', error: expect.stringMatching(/目前不是由您簽核/) }))
  })

  it('answers 409 in Chinese when the request is no longer pending', async () => {
    const doc = makeRequestDoc({ status: 'approved', steps: [{ approvers: [[SUP, 'approved']] }] })
    const res = await act(doc, { user: supUser(), body: { decision: 'approve' } })

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_PENDING' }))
  })
})

describe('actOnApproval step engine', () => {
  beforeEach(() => {
    stubForm()
  })

  it('approves a single-step request and finishes it', async () => {
    const doc = makeRequestDoc()
    const res = await act(doc, { user: supUser(), body: { decision: 'approve', comment: '同意' } })

    expect(doc.status).toBe('approved')
    expect(decisions(doc)).toEqual(['approved'])
    expect(doc.steps[0].approvers[0]).toEqual(expect.objectContaining({ comment: '同意', decided_at: expect.any(Date) }))
    expect(doc.logs.map(log => log.action)).toEqual(['approve', 'finish'])
    expect(doc.logs[0]).toEqual(expect.objectContaining({ comment: '同意', by_employee: SUP, step_order: 1 }))
    expect(res.json).toHaveBeenCalledWith(doc)
  })

  it('keeps an all-must-approve step open until every approver signed', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending']] }, { approvers: [[LEAD1, 'pending']] }] })
    await act(doc, { user: employeeUser(HR1), body: { decision: 'approve' } })

    expect(doc.current_step_index).toBe(0)
    expect(decisions(doc)).toEqual(['approved', 'pending'])

    await act(doc, { user: employeeUser(HR2), body: { decision: 'approve' } })
    expect(doc.current_step_index).toBe(1)
    expect(decisions(doc)).toEqual(['approved', 'approved'])
  })

  it('records the other approvers of an any-one step as skipped, not approved', async () => {
    const doc = makeRequestDoc({
      steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending'], [HR3, 'pending']], all_must_approve: false }],
    })
    await act(doc, { user: employeeUser(HR2), body: { decision: 'approve' } })

    expect(doc.status).toBe('approved')
    expect(decisions(doc)).toEqual(['skipped', 'approved', 'skipped'])
    expect(doc.steps[0].approvers[0].decided_at).toBeInstanceOf(Date)
    // 紀錄只有真正簽的人
    expect(doc.logs.filter(log => log.action === 'approve').map(log => log.by_employee)).toEqual([HR2])
  })

  it('skips an empty optional step in the middle and the last empty step', async () => {
    const doc = makeRequestDoc({
      steps: [
        { approvers: [[SUP, 'pending']] },
        { approvers: [], is_required: false },
        { approvers: [[LEAD1, 'pending']] },
        { approvers: [], is_required: false },
      ],
    })
    await act(doc, { user: supUser(), body: { decision: 'approve' } })
    expect(doc.current_step_index).toBe(2)
    expect(doc.status).toBe('pending')

    await act(doc, { user: employeeUser(LEAD1), body: { decision: 'approve' } })
    expect(doc.status).toBe('approved')
    expect(doc.logs.map(log => log.action)).toEqual(['approve', 'skip', 'move_next', 'approve', 'skip', 'finish'])
  })

  it('rejects the request and keeps the others pending', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending']] }] })
    await act(doc, { user: employeeUser(HR1), body: { decision: 'reject', comment: '資料不符' } })

    expect(doc.status).toBe('rejected')
    expect(decisions(doc)).toEqual(['rejected', 'pending'])
    expect(doc.logs[0]).toEqual(expect.objectContaining({ action: 'reject', comment: '資料不符' }))
  })

  it('stores the return comment on the approver and in the log when returning to the applicant', async () => {
    const doc = makeRequestDoc()
    await act(doc, { user: supUser(), body: { decision: 'return', comment: '請補附件' } })

    expect(doc.status).toBe('returned')
    expect(doc.steps[0].approvers[0]).toEqual(expect.objectContaining({ decision: 'returned', comment: '請補附件', decided_at: expect.any(Date) }))
    expect(doc.logs[0]).toEqual(expect.objectContaining({
      action: 'return',
      comment: '請補附件',
      message: '退回申請者：請補附件',
      by_employee: SUP,
      step_order: 1,
    }))
  })

  it('returns to the previous step and clears its decisions', async () => {
    const doc = makeRequestDoc({
      current_step_index: 1,
      steps: [{ approvers: [[SUP, 'approved']] }, { approvers: [[HR1, 'pending']] }],
    })
    await act(doc, { user: employeeUser(HR1), body: { decision: 'return', comment: '主管再確認' } })

    expect(doc.status).toBe('pending')
    expect(doc.current_step_index).toBe(0)
    expect(decisions(doc, 0)).toEqual(['pending'])
    expect(doc.steps[1].approvers[0]).toEqual(expect.objectContaining({ decision: 'returned', comment: '主管再確認' }))
    expect(doc.logs[0].message).toBe('退回到第 1 關：主管再確認')
  })

  it('returns past an empty optional step instead of stranding the request on it', async () => {
    const doc = makeRequestDoc({
      current_step_index: 2,
      steps: [{ approvers: [[SUP, 'approved']] }, { approvers: [], is_required: false }, { approvers: [[HR1, 'pending']] }],
    })
    await act(doc, { user: employeeUser(HR1), body: { decision: 'return' } })

    expect(doc.status).toBe('pending')
    expect(doc.current_step_index).toBe(0)
    expect(decisions(doc, 0)).toEqual(['pending'])
  })

  it('makes the whole returned step sign again when it is reached after the return', async () => {
    const doc = makeRequestDoc({
      current_step_index: 1,
      steps: [{ approvers: [[SUP, 'approved']] }, { approvers: [[HR1, 'approved'], [HR2, 'pending']] }],
    })
    await act(doc, { user: employeeUser(HR2), body: { decision: 'return' } })
    await act(doc, { user: supUser(), body: { decision: 'approve' } })

    expect(doc.current_step_index).toBe(1)
    expect(decisions(doc, 1)).toEqual(['pending', 'pending'])
  })

  it('refuses a return on a step that does not allow it', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[SUP, 'pending']], can_return: false }] })
    const res = await act(doc, { user: supUser(), body: { decision: 'return' } })

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RETURN_NOT_ALLOWED' }))
    expect(doc.save).not.toHaveBeenCalled()
  })
})

describe('actOnApproval concurrency', () => {
  beforeEach(() => stubForm())

  it('retries when a co-approver saved at the same moment and both approvals count', async () => {
    const stale = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending']] }] })
    stale.save.mockRejectedValueOnce(versionError())
    // 重新載入時 HR1 已經簽好了，HR2 仍是 pending
    const reloaded = makeRequestDoc({ steps: [{ approvers: [[HR1, 'approved'], [HR2, 'pending']] }] })
    mockApprovalRequest.findById.mockResolvedValueOnce(stale).mockResolvedValue(reloaded)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: employeeUser(HR2), body: { decision: 'approve' } }, res)

    expect(reloaded.save).toHaveBeenCalledTimes(1)
    expect(decisions(reloaded)).toEqual(['approved', 'approved'])
    expect(reloaded.status).toBe('approved')
    expect(res.status).not.toHaveBeenCalledWith(409)
  })

  it('tells the loser it was already decided (Chinese 409) when the reload shows the step finished without them', async () => {
    const stale = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending']], all_must_approve: false }] })
    stale.save.mockRejectedValueOnce(versionError())
    const reloaded = makeRequestDoc({
      steps: [{ approvers: [[HR1, 'approved'], [HR2, 'skipped']], all_must_approve: false }],
      status: 'approved',
    })
    mockApprovalRequest.findById.mockResolvedValueOnce(stale).mockResolvedValue(reloaded)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: employeeUser(HR2), body: { decision: 'approve' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_PENDING', error: expect.stringMatching(/已不是待簽核/) }))
    expect(reloaded.save).not.toHaveBeenCalled()
  })

  it('tells a loser on a still-open request that the request moved on (CONFLICT, not a second try on the next step)', async () => {
    const stale = makeRequestDoc({
      steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending']], all_must_approve: false }, { approvers: [[LEAD1, 'pending']] }],
    })
    stale.save.mockRejectedValueOnce(versionError())
    const reloaded = makeRequestDoc({
      current_step_index: 1,
      steps: [{ approvers: [[HR1, 'approved'], [HR2, 'skipped']], all_must_approve: false }, { approvers: [[LEAD1, 'pending']] }],
    })
    mockApprovalRequest.findById.mockResolvedValueOnce(stale).mockResolvedValue(reloaded)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: employeeUser(HR2), body: { decision: 'approve' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: '這張簽核單剛被其他人處理，目前關卡已經改變，請重新整理後再確認', code: 'CONFLICT' })
    expect(reloaded.save).not.toHaveBeenCalled()
  })

  it('does not replay an admin override on the next step when another admin overrode the same step first', async () => {
    const steps = () => [{ approvers: [[HR_LEFT, 'pending']] }, { approvers: [[LEAD1, 'pending']] }, { approvers: [[SUP, 'pending']] }]
    const stale = makeRequestDoc({ steps: steps() })
    stale.save.mockRejectedValueOnce(versionError())
    // 另一位管理員先一步代為核可了第 1 關，單據已經在第 2 關
    const reloaded = makeRequestDoc({
      current_step_index: 1,
      steps: [{ approvers: [[HR_LEFT, 'skipped']] }, { approvers: [[LEAD1, 'pending']] }, { approvers: [[SUP, 'pending']] }],
    })
    mockApprovalRequest.findById.mockResolvedValueOnce(stale).mockResolvedValue(reloaded)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: adminUser(), body: { decision: 'approve', comment: '代為核可' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }))
    expect(reloaded.save).not.toHaveBeenCalled()
    expect(reloaded.current_step_index).toBe(1)
    expect(decisions(reloaded, 1)).toEqual(['pending'])
    expect(reloaded.logs.filter(log => log.action === 'admin_override')).toEqual([])
  })

  it('does not return a request twice: the second 退簽 of the same step is refused instead of going one step further back', async () => {
    const stale = makeRequestDoc({ current_step_index: 1, steps: [{ approvers: [[SUP, 'approved']] }, { approvers: [[HR1, 'pending']] }] })
    stale.save.mockRejectedValueOnce(versionError())
    // 第一個退簽已存檔：單據回到第 1 關
    const reloaded = makeRequestDoc({ current_step_index: 0, steps: [{ approvers: [[SUP, 'pending']] }, { approvers: [[HR1, 'returned']] }] })
    mockApprovalRequest.findById.mockResolvedValueOnce(stale).mockResolvedValue(reloaded)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: employeeUser(HR1), body: { decision: 'return', comment: '資料不足' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }))
    expect(reloaded.save).not.toHaveBeenCalled()
    expect(reloaded.status).toBe('pending')
  })

  it('still retries when the reload shows the same step, even for an admin override', async () => {
    const stale = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending']] }, { approvers: [[LEAD1, 'pending']] }] })
    stale.save.mockRejectedValueOnce(versionError())
    // 只是別的欄位（例如紀錄）被別人更新了，關卡沒變：照常套用
    const reloaded = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending']] }, { approvers: [[LEAD1, 'pending']] }] })
    mockApprovalRequest.findById.mockResolvedValueOnce(stale).mockResolvedValue(reloaded)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: adminUser(), body: { decision: 'approve' } }, res)

    expect(res.status).not.toHaveBeenCalledWith(409)
    expect(reloaded.save).toHaveBeenCalledTimes(1)
    expect(reloaded.current_step_index).toBe(1)
    expect(reloaded.logs.filter(log => log.action === 'admin_override')).toHaveLength(1)
  })

  it('remembers the first step across several retries (a conflict on the third try is still detected)', async () => {
    const first = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending']] }, { approvers: [[LEAD1, 'pending']] }] })
    first.save.mockRejectedValueOnce(versionError())
    const second = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending']] }, { approvers: [[LEAD1, 'pending']] }] })
    second.save.mockRejectedValueOnce(versionError())
    const third = makeRequestDoc({ current_step_index: 1, steps: [{ approvers: [[HR_LEFT, 'skipped']] }, { approvers: [[LEAD1, 'pending']] }] })
    mockApprovalRequest.findById.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue(third)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: adminUser(), body: { decision: 'approve' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }))
    expect(third.save).not.toHaveBeenCalled()
  })

  it('gives up with a Chinese 409 when the conflict keeps happening', async () => {
    // 每次重新載入都是還沒簽的新資料，但存檔一律衝突（有人一直在更新同一張單）
    mockApprovalRequest.findById.mockImplementation(async () => {
      const doc = makeRequestDoc()
      doc.save.mockRejectedValue(versionError())
      return doc
    })

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: supUser(), body: { decision: 'approve' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }))
    expect(mockApprovalRequest.findById).toHaveBeenCalledTimes(12)
  })
})

describe('actOnApproval - optional step_order guard for a stale screen', () => {
  beforeEach(() => stubForm())
  const twoSteps = () => makeRequestDoc({
    current_step_index: 1,
    steps: [{ approvers: [[SUP, 'approved']] }, { step_order: 2, approvers: [[HR1, 'pending']] }, { approvers: [[LEAD1, 'pending']] }],
  })

  it('refuses an action meant for another step with a Chinese 409 (CONFLICT) and changes nothing', async () => {
    const doc = twoSteps()
    const res = await act(doc, { user: adminUser(), body: { decision: 'approve', step_order: 1 } })

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: '這張簽核單剛被其他人處理，目前關卡已經改變，請重新整理後再確認', code: 'CONFLICT' })
    expect(doc.save).not.toHaveBeenCalled()
    expect(doc.current_step_index).toBe(1)
  })

  it('applies the action when step_order is the current step (number or numeric text)', async () => {
    for (const stepOrder of [2, '2']) {
      const doc = twoSteps()
      const res = await act(doc, { user: employeeUser(HR1), body: { decision: 'approve', step_order: stepOrder } })
      expect(res.status).not.toHaveBeenCalledWith(409)
      expect(doc.current_step_index).toBe(2)
    }
  })

  it('falls back to the position when a step has no stored step_order', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[SUP, 'pending']] }] })
    const res = await act(doc, { user: supUser(), body: { decision: 'approve', step_order: 1 } })
    expect(res.status).not.toHaveBeenCalledWith(409)
    expect(doc.status).toBe('approved')
  })

  it.each([0, -1, 1.5, 'abc', {}, []])('rejects the malformed step_order %j with a Chinese 400 before reading the request', async (stepOrder) => {
    const doc = twoSteps()
    const res = await act(doc, { user: adminUser(), body: { decision: 'approve', step_order: stepOrder } })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '關卡編號格式不正確' })
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('ignores an empty step_order (older screens do not send it)', async () => {
    for (const stepOrder of [undefined, null, '']) {
      const doc = twoSteps()
      const res = await act(doc, { user: employeeUser(HR1), body: { decision: 'approve', step_order: stepOrder } })
      expect(res.status).not.toHaveBeenCalledWith(400)
      expect(doc.current_step_index).toBe(2)
    }
  })
})

describe('actOnApproval administrator override', () => {
  beforeEach(() => stubForm())

  it('lets an admin approve a stuck step on behalf of a departed approver and records admin_override', async () => {
    const doc = makeRequestDoc({
      steps: [{ approvers: [[HR1, 'approved'], [HR_LEFT, 'pending']] }, { approvers: [[LEAD1, 'pending']] }],
    })
    const res = await act(doc, { user: adminUser(), body: { decision: 'approve', comment: '離職交接，代為核可' } })

    expect(res.status).not.toHaveBeenCalledWith(409)
    expect(doc.current_step_index).toBe(1)
    expect(decisions(doc, 0)).toEqual(['approved', 'skipped'])
    expect(doc.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'admin_override',
        decision: 'approve',
        by_employee: ADMIN,
        step_order: 1,
        comment: '離職交接，代為核可',
        message: '管理員代為核可第 1 關：離職交接，代為核可',
      }),
    ]))
    expect(doc.logs.map(log => log.action)).toContain('move_next')
  })

  it('completes a request whose last step is stuck', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending']] }] })
    await act(doc, { user: adminUser(), body: { decision: 'approve' } })
    expect(doc.status).toBe('approved')
    expect(decisions(doc)).toEqual(['skipped'])
  })

  it('completes an any-one step even though nobody approved', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending'], [HR1, 'pending']], all_must_approve: false }] })
    await act(doc, { user: adminUser(), body: { decision: 'approve' } })
    expect(doc.status).toBe('approved')
  })

  it('lets an admin reject or return on behalf of the step', async () => {
    const rejected = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending']] }] })
    await act(rejected, { user: adminUser(), body: { decision: 'reject', comment: '無法處理' } })
    expect(rejected.status).toBe('rejected')
    expect(rejected.logs[0]).toEqual(expect.objectContaining({ action: 'admin_override', decision: 'reject' }))

    const returned = makeRequestDoc({ steps: [{ approvers: [[HR_LEFT, 'pending']] }] })
    await act(returned, { user: adminUser(), body: { decision: 'return', comment: '請補件' } })
    expect(returned.status).toBe('returned')
    expect(returned.logs[0]).toEqual(expect.objectContaining({ action: 'admin_override', decision: 'return' }))
  })

  it('treats an admin who is the step approver as a normal approver (no override entry)', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[ADMIN, 'pending']] }] })
    await act(doc, { user: adminUser(), body: { decision: 'approve' } })
    expect(doc.logs.map(log => log.action)).toEqual(['approve', 'finish'])
    expect(decisions(doc)).toEqual(['approved'])
  })

  it('does not give the override to a supervisor who is not on the step', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending']] }, { approvers: [[SUP, 'pending']] }] })
    const res = await act(doc, { user: supUser(), body: { decision: 'approve' } })
    expect(res.status).toHaveBeenCalledWith(409)
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('does not even give an explicit override flag to a non-admin who is not on the step', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending']] }, { approvers: [[SUP, 'pending']] }] })
    const res = await act(doc, { user: supUser(), body: { decision: 'approve', override: true } })
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_STEP_APPROVER' }))
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('keeps the override of an admin who is not named on the step, with or without the flag', async () => {
    const plain = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending']] }, { approvers: [[LEAD1, 'pending']] }] })
    await act(plain, { user: adminUser(), body: { decision: 'approve' } })
    expect(plain.logs.map(log => log.action)).toContain('admin_override')
    expect(decisions(plain, 0)).toEqual(['skipped', 'skipped'])

    const flagged = makeRequestDoc({ steps: [{ approvers: [[HR1, 'pending'], [HR2, 'pending']] }, { approvers: [[LEAD1, 'pending']] }] })
    await act(flagged, { user: adminUser(), body: { decision: 'approve', override: true } })
    expect(flagged.logs.map(log => log.action)).toContain('admin_override')
    expect(decisions(flagged, 0)).toEqual(['skipped', 'skipped'])
  })
})

// 管理員同時是這一關的簽核人：已經簽過再送一次（雙擊、另一個分頁）不能默默變成代為處理而跳過其他必簽的人
describe('actOnApproval - an administrator who is also a named approver and already decided', () => {
  beforeEach(() => stubForm())

  const stepWithAdmin = (adminDecision) => [
    { approvers: [[ADMIN, adminDecision], [HR1, 'pending'], [HR2, 'pending']] },
    { approvers: [[LEAD1, 'pending']] },
  ]
  const ALREADY_DECIDED = {
    error: '您已經處理過這一關，請重新整理頁面',
    code: 'ALREADY_DECIDED',
  }

  it.each(['approve', 'reject', 'return'])('answers the same ALREADY_DECIDED 409 for a repeated %s and changes nothing', async (decision) => {
    const doc = makeRequestDoc({ steps: stepWithAdmin('approved') })
    const res = await act(doc, { user: adminUser(), body: { decision } })

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(ALREADY_DECIDED)
    expect(doc.save).not.toHaveBeenCalled()
    expect(decisions(doc, 0)).toEqual(['approved', 'pending', 'pending'])
    expect(doc.current_step_index).toBe(0)
    expect(doc.status).toBe('pending')
    expect(doc.logs.filter(log => log.action === 'admin_override')).toEqual([])
  })

  it('treats the first approve as a normal one and the second as ALREADY_DECIDED (the other approvers stay required)', async () => {
    const doc = makeRequestDoc({ steps: stepWithAdmin('pending') })

    const first = await act(doc, { user: adminUser(), body: { decision: 'approve' } })
    expect(first.status).not.toHaveBeenCalledWith(409)
    expect(decisions(doc, 0)).toEqual(['approved', 'pending', 'pending'])
    expect(doc.logs.map(log => log.action)).toEqual(['approve'])

    const second = await act(doc, { user: adminUser(), body: { decision: 'approve' } })
    expect(second.status).toHaveBeenCalledWith(409)
    expect(second.json).toHaveBeenCalledWith(ALREADY_DECIDED)
    expect(decisions(doc, 0)).toEqual(['approved', 'pending', 'pending'])
    expect(doc.current_step_index).toBe(0)
    expect(doc.logs.map(log => log.action)).toEqual(['approve'])
  })

  it('answers the skipped wording when the admin was skipped because someone else finished the step', async () => {
    const doc = makeRequestDoc({ steps: [{ approvers: [[ADMIN, 'skipped'], [HR1, 'approved']], all_must_approve: false }] })
    const res = await act(doc, { user: adminUser(), body: { decision: 'approve' } })

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: '這一關已由其他簽核人處理完成', code: 'ALREADY_DECIDED' })
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('lets the override dialog through when the body carries override: true (代為核可 skips the others and is logged)', async () => {
    const doc = makeRequestDoc({ steps: stepWithAdmin('approved') })
    const res = await act(doc, { user: adminUser(), body: { decision: 'approve', comment: '其餘人員出差，代為核可', override: true } })

    expect(res.status).not.toHaveBeenCalledWith(409)
    expect(decisions(doc, 0)).toEqual(['approved', 'skipped', 'skipped'])
    expect(doc.current_step_index).toBe(1)
    expect(doc.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'admin_override', decision: 'approve', by_employee: ADMIN, step_order: 1 }),
    ]))
  })

  it('lets an explicit override reject or return too, but only a literal true counts', async () => {
    const rejected = makeRequestDoc({ steps: stepWithAdmin('approved') })
    await act(rejected, { user: adminUser(), body: { decision: 'reject', override: true } })
    expect(rejected.status).toBe('rejected')
    expect(rejected.logs[0]).toEqual(expect.objectContaining({ action: 'admin_override', decision: 'reject' }))

    const returned = makeRequestDoc({ steps: stepWithAdmin('approved') })
    await act(returned, { user: adminUser(), body: { decision: 'return', override: true } })
    expect(returned.status).toBe('returned')
    expect(returned.logs[0]).toEqual(expect.objectContaining({ action: 'admin_override', decision: 'return' }))

    for (const override of ['true', 1, 'yes', {}]) {
      const doc = makeRequestDoc({ steps: stepWithAdmin('approved') })
      const res = await act(doc, { user: adminUser(), body: { decision: 'approve', override } })
      expect(res.status).toHaveBeenCalledWith(409)
      expect(doc.save).not.toHaveBeenCalled()
    }
  })

  it('does not turn a still-pending approver decision into an override just because the flag is sent', async () => {
    const doc = makeRequestDoc({ steps: stepWithAdmin('pending') })
    await act(doc, { user: adminUser(), body: { decision: 'approve', override: true } })

    expect(decisions(doc, 0)).toEqual(['approved', 'pending', 'pending'])
    expect(doc.logs.map(log => log.action)).toEqual(['approve'])
  })

  it('does not let a version-conflict retry replay the admin approve as an override', async () => {
    // 兩個分頁同時按核可：兩邊都讀到 pending，第一個存檔成功，第二個存檔衝突、重新載入後看到自己已經簽過
    const stale = makeRequestDoc({ steps: stepWithAdmin('pending') })
    stale.save.mockRejectedValueOnce(versionError())
    const reloaded = makeRequestDoc({ steps: stepWithAdmin('approved') })
    mockApprovalRequest.findById.mockResolvedValueOnce(stale).mockResolvedValue(reloaded)

    const res = makeRes()
    await actOnApproval({ params: { id: REQ }, user: adminUser(), body: { decision: 'approve' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(ALREADY_DECIDED)
    expect(reloaded.save).not.toHaveBeenCalled()
    expect(decisions(reloaded, 0)).toEqual(['approved', 'pending', 'pending'])
    expect(reloaded.logs.filter(log => log.action === 'admin_override')).toEqual([])
  })
})

describe('actOnApproval - annual leave on final approval', () => {
  const LEAVE_FORM = { _id: FORM, name: '請假', semanticType: 'leave', is_active: true }
  const LEAVE_FIELDS = [
    { _id: 'l-type', form: FORM, label: '假別', type_1: 'select', options: ['特休', '病假'], order: 1 },
    { _id: 'l-start', form: FORM, label: '開始時間', type_1: 'datetime', order: 2 },
    { _id: 'l-end', form: FORM, label: '結束時間', type_1: 'datetime', order: 3 },
  ]

  beforeEach(() => {
    stubForm(LEAVE_FORM)
    mockFormField.find.mockImplementation(() => ({ lean: async () => LEAVE_FIELDS }))
  })

  it('deducts the days, records the outcome on the request and reports no warning', async () => {
    mockDeductAnnualLeave.mockResolvedValue({})
    const doc = makeRequestDoc({ form_data: { 'l-type': '特休', 'l-start': '2026-03-02', 'l-end': '2026-03-03' } })
    const res = await act(doc, { user: supUser(), body: { decision: 'approve' } })

    expect(mockDeductAnnualLeave).toHaveBeenCalledWith(APPLICANT, 2, REQ)
    expect(doc.annual_leave).toEqual(expect.objectContaining({ days: 2, state: 'deducted' }))
    expect(doc.logs.map(log => log.action)).toEqual(['approve', 'finish', 'annual_leave'])
    expect(res.json).toHaveBeenCalledWith(doc)
  })

  it('keeps the approval but reports a failed deduction in the log, on the request and in the response', async () => {
    mockDeductAnnualLeave.mockRejectedValue(Object.assign(new Error('Insufficient'), { code: 'INSUFFICIENT_BALANCE', remaining: 1, requested: 2 }))
    const doc = makeRequestDoc({ form_data: { 'l-type': '特休', 'l-start': '2026-03-02', 'l-end': '2026-03-03' } })
    const res = await act(doc, { user: supUser(), body: { decision: 'approve' } })

    expect(doc.status).toBe('approved')
    const message = '特休扣減失敗：餘額不足（剩餘 1 天，本次需扣 2 天），請人資確認特休天數後手動補登'
    expect(doc.annual_leave).toEqual(expect.objectContaining({ days: 2, state: 'failed', message }))
    expect(doc.logs).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'annual_leave_error', message })]))
    const body = res.json.mock.calls[0][0]
    expect(body.warnings).toEqual([{ code: 'ANNUAL_LEAVE_DEDUCTION_FAILED', message }])
  })

  it('does not touch the balance for other leave types', async () => {
    const doc = makeRequestDoc({ form_data: { 'l-type': '病假', 'l-start': '2026-03-02', 'l-end': '2026-03-03' } })
    await act(doc, { user: supUser(), body: { decision: 'approve' } })
    expect(mockDeductAnnualLeave).not.toHaveBeenCalled()
  })
})

describe('applicant approval state actions', () => {
  it('allows the applicant to cancel once and treats a duplicate cancel as idempotent', async () => {
    const doc = makeRequestDoc({ steps: [] })
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()
    const req = { params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }

    await cancelApprovalRequest(req, res)
    await cancelApprovalRequest(req, res)

    expect(doc.status).toBe('canceled')
    expect(doc.logs.filter(log => log.action === 'cancel')).toHaveLength(1)
    expect(doc.save).toHaveBeenCalledTimes(1)
  })

  it('does not reveal or cancel another employee request (admins can only handle approved annual leave)', async () => {
    const doc = makeRequestDoc({ applicant_employee: OTHER })
    mockApprovalRequest.findById.mockResolvedValue(doc)

    for (const user of [employeeUser(APPLICANT), adminUser()]) {
      const res = makeRes()
      await cancelApprovalRequest({ params: { id: REQ }, user, body: {} }, res)
      expect(res.status).toHaveBeenCalledWith(404)
    }
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('refuses to withdraw a finished request that is not annual leave', async () => {
    stubForm({ name: '外出單' })
    const doc = makeRequestDoc({ status: 'approved' })
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CANNOT_CANCEL' }))
    expect(doc.status).toBe('approved')
  })
})

describe('cancelling an approved annual leave', () => {
  const LEAVE_FORM = { _id: FORM, name: '請假', semanticType: 'leave', is_active: true }
  const LEAVE_FIELDS = [
    { _id: 'l-type', form: FORM, label: '假別', type_1: 'select', options: ['特休', '病假'], order: 1 },
    { _id: 'l-start', form: FORM, label: '開始時間', type_1: 'datetime', order: 2 },
    { _id: 'l-end', form: FORM, label: '結束時間', type_1: 'datetime', order: 3 },
  ]
  const FUTURE = '2099-03-02'
  const PAST = '2020-03-02'

  beforeEach(() => {
    stubForm(LEAVE_FORM)
    mockFormField.find.mockImplementation(() => ({ lean: async () => LEAVE_FIELDS }))
  })

  const approvedLeave = (start, extra = {}) => makeRequestDoc({
    status: 'approved',
    form_data: { 'l-type': '特休', 'l-start': start, 'l-end': start },
    annual_leave: { days: 1, state: 'deducted' },
    ...extra,
  })

  it('refunds the deducted days when the applicant withdraws before the leave starts', async () => {
    mockRefundAnnualLeave.mockResolvedValue({ refunded: true, days: 1 })
    const doc = approvedLeave(FUTURE)
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: { comment: '行程取消' } }, res)

    expect(mockRefundAnnualLeave).toHaveBeenCalledWith(APPLICANT, 1, REQ)
    expect(doc.status).toBe('canceled')
    expect(doc.annual_leave).toEqual(expect.objectContaining({ state: 'refunded', days: 1 }))
    expect(doc.logs[doc.logs.length - 1]).toEqual(expect.objectContaining({ action: 'cancel', message: '已撤回已核准的特休，返還 1 天：行程取消' }))
    expect(doc.save).toHaveBeenCalledTimes(1)
  })

  it('does not let the applicant withdraw once the leave has started', async () => {
    const doc = approvedLeave(PAST)
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'LEAVE_STARTED' }))
    expect(mockRefundAnnualLeave).not.toHaveBeenCalled()
    expect(doc.status).toBe('approved')
  })

  it('lets an admin withdraw an approved annual leave that already started', async () => {
    mockRefundAnnualLeave.mockResolvedValue({ refunded: true, days: 1 })
    const doc = approvedLeave(PAST)
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({ params: { id: REQ }, user: adminUser(), body: {} }, res)

    expect(res.status).not.toHaveBeenCalledWith(404)
    expect(mockRefundAnnualLeave).toHaveBeenCalledWith(APPLICANT, 1, REQ)
    expect(doc.status).toBe('canceled')
  })

  it('does not hide a failed refund behind a canceled request', async () => {
    mockRefundAnnualLeave.mockRejectedValue(new Error('db down'))
    const doc = approvedLeave(FUTURE)
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(doc.status).toBe('approved')
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('cancels without a refund when the original approval never deducted anything', async () => {
    mockRefundAnnualLeave.mockResolvedValue({ refunded: false, days: 0 })
    const doc = approvedLeave(FUTURE, { annual_leave: { days: 1, state: 'failed' } })
    mockApprovalRequest.findById.mockResolvedValue(doc)

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, makeRes())

    expect(doc.status).toBe('canceled')
    expect(doc.logs[doc.logs.length - 1].message).toContain('無需返還')
  })

  it('does not refund twice when the save has to be retried', async () => {
    mockRefundAnnualLeave.mockResolvedValue({ refunded: true, days: 1 })
    const first = approvedLeave(FUTURE)
    first.save.mockRejectedValueOnce(versionError())
    const second = approvedLeave(FUTURE)
    mockApprovalRequest.findById.mockResolvedValueOnce(first).mockResolvedValue(second)

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, makeRes())

    expect(mockRefundAnnualLeave).toHaveBeenCalledTimes(1)
    expect(second.status).toBe('canceled')
  })
})

describe('resubmitApprovalRequest', () => {
  const returnedDoc = (overrides = {}) => makeRequestDoc({
    status: 'returned',
    form_data: { 'f-text': '舊內容' },
    steps: [{ approvers: [[SUP, 'returned']] }, { approvers: [[HR_LEFT, 'pending']] }],
    ...overrides,
  })

  beforeEach(() => {
    stubForm()
    mockFormField.find.mockImplementation(() => queryResult([{ _id: 'f-text', label: '事由', type_1: 'text' }]))
  })

  it('revalidates and resets a returned request before resubmitting, re-resolving the approvers', async () => {
    stubWorkflow([
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資', all_must_approve: false },
    ])
    const doc = returnedDoc()
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await resubmitApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

    expect(mockAssertApprovalRequestCompliance).toHaveBeenCalledWith(expect.objectContaining({
      formData: { 'f-text': '舊內容' },
      applicantEmployeeId: APPLICANT,
      ignoreRequestId: REQ,
      checkLeaveConflicts: true,
    }))
    expect(doc.status).toBe('pending')
    expect(doc.current_step_index).toBe(0)
    // 簽核人重新解析：離職的人資不再出現，新的人資在第 2 關
    expect(doc.steps.map(step => step.approvers.map(a => a.approver))).toEqual([[SUP], [HR1, HR2, HR3]])
    expect(doc.steps.flatMap(step => step.approvers).every(a => a.decision === 'pending')).toBe(true)
    expect(doc.logs[doc.logs.length - 1].action).toBe('resubmit')
    expect(doc.save).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledWith(doc)
  })

  it('stores the corrected form_data (sanitised) and runs the checks on the new data', async () => {
    stubWorkflow([{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }])
    const doc = returnedDoc()
    mockApprovalRequest.findById.mockResolvedValue(doc)

    await resubmitApprovalRequest({
      params: { id: REQ },
      user: employeeUser(APPLICANT),
      body: { form_data: { 'f-text': '更正後', days: 9 }, comment: '已更正' },
    }, makeRes())

    expect(doc.form_data).toEqual({ 'f-text': '更正後' })
    expect(doc.markModified).toHaveBeenCalledWith('form_data')
    expect(mockAssertApprovalRequestCompliance).toHaveBeenCalledWith(expect.objectContaining({ formData: { 'f-text': '更正後' } }))
    expect(doc.logs[doc.logs.length - 1]).toEqual(expect.objectContaining({ action: 'resubmit', comment: '已更正' }))
  })

  it('refuses invalid corrected data without changing the request', async () => {
    stubWorkflow([{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }])
    mockFormField.find.mockImplementation(() => queryResult([{ _id: 'f-num', label: '金額', type_1: 'number' }]))
    const doc = returnedDoc()
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await resubmitApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: { form_data: { 'f-num': 'abc' } } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(doc.status).toBe('returned')
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('reports a required step that now has nobody, keeping the request returned', async () => {
    stubWorkflow([{ step_order: 1, approver_type: 'tag', approver_value: '已不存在的標籤' }])
    const doc = returnedDoc()
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await resubmitApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUIRED_APPROVER_MISSING', step: 1 }))
    expect(doc.status).toBe('returned')
  })

  it('only resubmits returned requests of the applicant', async () => {
    const pending = makeRequestDoc()
    mockApprovalRequest.findById.mockResolvedValue(pending)
    const notReturned = makeRes()
    await resubmitApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, notReturned)
    expect(notReturned.status).toHaveBeenCalledWith(409)
    expect(notReturned.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_RETURNED' }))

    mockApprovalRequest.findById.mockResolvedValue(returnedDoc())
    const stranger = makeRes()
    await resubmitApprovalRequest({ params: { id: REQ }, user: employeeUser(OTHER), body: {} }, stranger)
    expect(stranger.status).toHaveBeenCalledWith(404)
  })

  it('falls back to the stored approvers when the workflow no longer exists', async () => {
    mockApprovalWorkflow.findById.mockResolvedValue(null)
    mockApprovalWorkflow.findOne.mockResolvedValue(null)
    const doc = returnedDoc({ steps: [{ approvers: [[SUP, 'returned']] }] })
    mockApprovalRequest.findById.mockResolvedValue(doc)

    await resubmitApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, makeRes())

    expect(doc.status).toBe('pending')
    expect(decisions(doc)).toEqual(['pending'])
  })
})

describe('resubmitApprovalRequest - answers the apply screen cannot edit are kept', () => {
  const FIELDS = [
    { _id: 'f-text', label: '事由', type_1: 'text' },
    { _id: 'f-note', label: '附註', type_1: 'text' },
    { _id: 'f-extra', label: '補充', type_1: 'text' },
    { _id: 'f-old', label: '舊欄位', type_1: 'text', is_active: false },
  ]
  const returnedDoc = (formData) => makeRequestDoc({
    status: 'returned',
    form_data: formData,
    steps: [{ approvers: [[SUP, 'returned']] }],
  })
  const resubmit = async (doc, body) => {
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()
    await resubmitApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body }, res)
    return res
  }

  beforeEach(() => {
    stubForm()
    stubWorkflow([{ step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' }])
    mockFormField.find.mockImplementation(() => queryResult(FIELDS))
  })

  it('keeps the earlier answer of a deactivated field and of a field that was not submitted', async () => {
    const doc = returnedDoc({ 'f-text': '舊事由', 'f-old': '舊答案', 'f-extra': '補充說明', ghost: '不在表單內的舊 key' })

    // 畫面只送目前啟用的欄位（停用的「舊欄位」不會出現），而且這次只改了事由和附註
    const res = await resubmit(doc, { form_data: { 'f-note': 'b', 'f-text': '新事由' } })

    expect(res.status).not.toHaveBeenCalled()
    expect(doc.status).toBe('pending')
    expect(doc.form_data).toEqual({ 'f-old': '舊答案', 'f-extra': '補充說明', 'f-text': '新事由', 'f-note': 'b' })
    expect(doc.markModified).toHaveBeenCalledWith('form_data')
    expect(mockAssertApprovalRequestCompliance).toHaveBeenCalledWith(expect.objectContaining({
      formData: { 'f-old': '舊答案', 'f-extra': '補充說明', 'f-text': '新事由', 'f-note': 'b' },
    }))
  })

  it('lets the applicant clear an answer on purpose (a submitted blank wins) and overwrite a deactivated one', async () => {
    const doc = returnedDoc({ 'f-text': '舊事由', 'f-extra': '補充說明', 'f-old': '舊答案' })

    await resubmit(doc, { form_data: { 'f-text': '', 'f-old': '改過的舊答案' } })

    expect(doc.form_data).toEqual({ 'f-extra': '補充說明', 'f-text': '', 'f-old': '改過的舊答案' })
  })

  it('does not run the stored answer of a deactivated field through the checks again (its options may have changed since)', async () => {
    mockFormField.find.mockImplementation(() => queryResult([
      { _id: 'f-text', label: '事由', type_1: 'text' },
      { _id: 'f-kind', label: '類別', type_1: 'select', options: ['甲', '乙'], is_active: false },
    ]))
    const doc = returnedDoc({ 'f-text': '舊事由', 'f-kind': '已不在選項裡的丙' })

    const res = await resubmit(doc, { form_data: { 'f-text': '新事由' } })

    expect(res.status).not.toHaveBeenCalled()
    expect(doc.form_data).toEqual({ 'f-kind': '已不在選項裡的丙', 'f-text': '新事由' })
  })

  it('still rejects an invalid submitted value, and leaves the stored answers untouched', async () => {
    mockFormField.find.mockImplementation(() => queryResult([
      { _id: 'f-num', label: '金額', type_1: 'number' },
      { _id: 'f-old', label: '舊欄位', type_1: 'text', is_active: false },
    ]))
    const doc = returnedDoc({ 'f-num': 100, 'f-old': '舊答案' })

    const res = await resubmit(doc, { form_data: { 'f-num': 'abc' } })

    expect(res.status).toHaveBeenCalledWith(400)
    expect(doc.status).toBe('returned')
    expect(doc.form_data).toEqual({ 'f-num': 100, 'f-old': '舊答案' })
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('keeps the attachments of a deactivated file field without claiming them again', async () => {
    const file = { name: '證明.pdf', url: '/upload/approvals/1700000000000-abcdef0123456789.pdf', size: 10, type: 'application/pdf' }
    mockFormField.find.mockImplementation(() => queryResult([
      { _id: 'f-text', label: '事由', type_1: 'text' },
      { _id: 'f-file', label: '證明', type_1: 'file', is_active: false },
    ]))
    const doc = returnedDoc({ 'f-text': '舊事由', 'f-file': [file] })

    await resubmit(doc, { form_data: { 'f-text': '新事由' } })

    expect(doc.form_data).toEqual({ 'f-file': [file], 'f-text': '新事由' })
    expect(mockApprovalAttachment.find).not.toHaveBeenCalled()
    expect(mockApprovalAttachment.updateMany).not.toHaveBeenCalled()
  })

  it('keeps everything as is when no form_data is sent at all', async () => {
    const doc = returnedDoc({ 'f-text': '舊事由', 'f-old': '舊答案' })

    await resubmit(doc, {})

    expect(doc.form_data).toEqual({ 'f-text': '舊事由', 'f-old': '舊答案' })
    expect(doc.markModified).not.toHaveBeenCalled()
  })
})

describe('annual leave only applies to leave forms: an explicit 一般 type wins over the name 請假', () => {
  const LEAVE_FIELDS = [
    { _id: 'l-type', form: FORM, label: '假別', type_1: 'select', options: ['特休', '病假'], order: 1 },
    { _id: 'l-start', form: FORM, label: '開始時間', type_1: 'datetime', order: 2 },
    { _id: 'l-end', form: FORM, label: '結束時間', type_1: 'datetime', order: 3 },
  ]
  const TWO_DAYS = { 'l-type': '特休', 'l-start': '2099-03-02', 'l-end': '2099-03-03' }

  function setupFiling(formOverrides, annualLeave) {
    stubForm({ name: '請假', ...formOverrides })
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockFormField.find.mockImplementation(() => queryResult(LEAVE_FIELDS))
    mockEmployee.rows.find(row => row._id === APPLICANT).annualLeave = annualLeave
    return stubCreate()
  }

  it('does not check the balance of a form named 請假 that was explicitly set to 一般', async () => {
    const created = setupFiling({ semanticType: 'general' }, { totalDays: 5, usedDays: 5 })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: TWO_DAYS }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc).toBeTruthy()
  })

  it('still checks the balance of a leave-type form, and of an old form that only has the name', async () => {
    for (const semanticType of ['leave', undefined]) {
      setupFiling({ semanticType }, { totalDays: 5, usedDays: 5 })
      const res = makeRes()

      await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: TWO_DAYS }), res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ANNUAL_LEAVE_INSUFFICIENT', remaining: 0, requested: 2 }))
    }
  })

  describe('at approval and withdrawal', () => {
    beforeEach(() => {
      mockFormField.find.mockImplementation(() => ({ lean: async () => LEAVE_FIELDS }))
    })

    it('does not deduct anything for a 一般 form named 請假 and leaves no annual leave record', async () => {
      stubForm({ _id: FORM, name: '請假', semanticType: 'general', is_active: true })
      const doc = makeRequestDoc({ form_data: TWO_DAYS })

      await act(doc, { user: supUser(), body: { decision: 'approve' } })

      expect(doc.status).toBe('approved')
      expect(mockDeductAnnualLeave).not.toHaveBeenCalled()
      expect(doc.annual_leave).toBeUndefined()
      expect(doc.logs.map(log => log.action)).not.toContain('annual_leave')
    })

    it('deducts for a leave-type form and for an old form that only has the name', async () => {
      mockDeductAnnualLeave.mockResolvedValue({})
      for (const semanticType of ['leave', undefined]) {
        mockDeductAnnualLeave.mockClear()
        stubForm({ _id: FORM, name: '請假', semanticType, is_active: true })
        const doc = makeRequestDoc({ form_data: TWO_DAYS })

        await act(doc, { user: supUser(), body: { decision: 'approve' } })

        expect(mockDeductAnnualLeave).toHaveBeenCalledWith(APPLICANT, 2, REQ)
      }
    })

    it('cannot withdraw an approved 一般 form as annual leave (it is not one), so nothing is refunded', async () => {
      stubForm({ _id: FORM, name: '請假', semanticType: 'general', is_active: true })
      const doc = makeRequestDoc({ status: 'approved', form_data: TWO_DAYS })
      mockApprovalRequest.findById.mockResolvedValue(doc)
      const res = makeRes()

      await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CANNOT_CANCEL' }))
      expect(mockRefundAnnualLeave).not.toHaveBeenCalled()
    })
  })
})

describe('annual leave days are counted like payroll and reports (a 4-hour leave is half a day)', () => {
  const FORM_FIELDS = [
    { _id: 'l-type', form: FORM, label: '假別', type_1: 'select', options: ['特休', '病假'], order: 1 },
    { _id: 'l-start', form: FORM, label: '開始時間', type_1: 'datetime', order: 2 },
    { _id: 'l-end', form: FORM, label: '結束時間', type_1: 'datetime', order: 3 },
    { _id: 'l-days', form: FORM, label: '天數', type_1: 'number', order: 4 },
  ]
  // 台灣時間 2099-03-02 09:00-13:00（UTC 01:00-05:00）：4 小時
  const FOUR_HOURS = { 'l-type': '特休', 'l-start': '2099-03-02T01:00:00.000Z', 'l-end': '2099-03-02T05:00:00.000Z' }
  const LEAVE_FORM = { _id: FORM, name: '請假', semanticType: 'leave', is_active: true }

  function setupFiling(annualLeave) {
    stubForm(LEAVE_FORM)
    stubWorkflow([{ step_order: 1, approver_type: 'user', approver_value: [LEAD1] }])
    mockFormField.find.mockImplementation(() => queryResult(FORM_FIELDS))
    mockEmployee.rows.find(row => row._id === APPLICANT).annualLeave = annualLeave
    return stubCreate()
  }

  it('lets a 4-hour 特休 through when half a day is left', async () => {
    const created = setupFiling({ totalDays: 5, usedDays: 4.5 })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: FOUR_HOURS }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(created.doc).toBeTruthy()
  })

  it('stops a 4-hour 特休 when less than half a day is left, naming 0.5 days', async () => {
    setupFiling({ totalDays: 5, usedDays: 4.75 })
    const res = makeRes()

    await createApprovalRequest(makeCreateReq({ form_id: FORM, form_data: FOUR_HOURS }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: '特休餘額不足：剩餘 0.25 天，本次申請 0.5 天',
      code: 'ANNUAL_LEAVE_INSUFFICIENT',
      remaining: 0.25,
      requested: 0.5,
    })
  })

  describe('at approval and withdrawal', () => {
    beforeEach(() => {
      stubForm(LEAVE_FORM)
      mockFormField.find.mockImplementation(() => ({ lean: async () => FORM_FIELDS }))
      mockDeductAnnualLeave.mockResolvedValue({})
    })

    it('deducts 0.5 day for 4 hours and records exactly that', async () => {
      const doc = makeRequestDoc({ form_data: FOUR_HOURS })

      await act(doc, { user: supUser(), body: { decision: 'approve' } })

      expect(mockDeductAnnualLeave).toHaveBeenCalledWith(APPLICANT, 0.5, REQ)
      expect(doc.annual_leave).toEqual(expect.objectContaining({ days: 0.5, state: 'deducted' }))
      expect(doc.logs).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'annual_leave', message: '已扣除特休 0.5 天' })]))
    })

    it('keeps whole days and date ranges as before, and a 09:00-18:00 day is one day', async () => {
      const cases = [
        [{ 'l-start': '2099-03-02', 'l-end': '2099-03-04' }, 3],
        [{ 'l-start': '2099-03-02T01:00:00.000Z', 'l-end': '2099-03-04T10:00:00.000Z' }, 3],
        [{ 'l-start': '2099-03-02T01:00:00.000Z', 'l-end': '2099-03-02T10:00:00.000Z' }, 1],
        [{ 'l-start': '2099-03-01T16:00:00.000Z', 'l-end': '2099-03-02T16:00:00.000Z' }, 2], // 日期選擇器的午夜
      ]
      for (const [dates, expected] of cases) {
        mockDeductAnnualLeave.mockClear()
        const doc = makeRequestDoc({ form_data: { 'l-type': '特休', ...dates } })

        await act(doc, { user: supUser(), body: { decision: 'approve' } })

        expect(mockDeductAnnualLeave).toHaveBeenCalledWith(APPLICANT, expected, REQ)
      }
    })

    it('still lets the 天數 field win over the times', async () => {
      const doc = makeRequestDoc({ form_data: { ...FOUR_HOURS, 'l-days': 1.5 } })

      await act(doc, { user: supUser(), body: { decision: 'approve' } })

      expect(mockDeductAnnualLeave).toHaveBeenCalledWith(APPLICANT, 1.5, REQ)
    })

    it('refunds exactly the recorded days when the leave is withdrawn, whatever the dates would count today', async () => {
      mockRefundAnnualLeave.mockResolvedValue({ refunded: true, days: 0.5 })
      const half = makeRequestDoc({ status: 'approved', form_data: { ...FOUR_HOURS, 'l-start': '2099-03-02T01:00:00.000Z' }, annual_leave: { days: 0.5, state: 'deducted' } })
      mockApprovalRequest.findById.mockResolvedValue(half)

      await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, makeRes())

      expect(mockRefundAnnualLeave).toHaveBeenCalledWith(APPLICANT, 0.5, REQ)
      expect(half.annual_leave).toEqual(expect.objectContaining({ state: 'refunded', days: 0.5 }))

      // 以前的算法把 4 小時扣成 1 天並記下了 1：返還的也是記錄的 1 天，不會因為現在算成 0.5 而少還
      mockRefundAnnualLeave.mockReset()
      mockRefundAnnualLeave.mockResolvedValue({ refunded: true, days: 1 })
      const legacy = makeRequestDoc({ status: 'approved', form_data: FOUR_HOURS, annual_leave: { days: 1, state: 'deducted' } })
      mockApprovalRequest.findById.mockResolvedValue(legacy)

      await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, makeRes())

      expect(mockRefundAnnualLeave).toHaveBeenCalledWith(APPLICANT, 1, REQ)
    })
  })
})

// 假單還在簽核中時，管理員把假別 / 日期欄位刪掉（有申請單的欄位只是停用）又建立同標籤的新欄位：
// 答案仍在舊欄位 ID 底下，核准時的扣減、撤回時的返還都要逐張單據挑第一個有填值的欄位，不能漏掉
describe('annual leave when the leave fields were replaced while the request was pending', () => {
  const LEAVE_FORM = { _id: FORM, name: '請假', semanticType: 'leave', is_active: true }
  const REPLACED_FIELDS = [
    { _id: 'old-type', form: FORM, label: '假別', type_1: 'select', options: ['特休', '病假'], order: 1, is_active: false },
    { _id: 'old-start', form: FORM, label: '開始時間', type_1: 'datetime', order: 2, is_active: false },
    { _id: 'old-end', form: FORM, label: '結束時間', type_1: 'datetime', order: 3, is_active: false },
    { _id: 'new-type', form: FORM, label: '假別', type_1: 'select', options: ['特休', '病假'], order: 4 },
    { _id: 'new-start', form: FORM, label: '開始時間', type_1: 'datetime', order: 5 },
    { _id: 'new-end', form: FORM, label: '結束時間', type_1: 'datetime', order: 6 },
  ]

  beforeEach(() => {
    stubForm(LEAVE_FORM)
    mockFormField.find.mockImplementation(() => ({ lean: async () => REPLACED_FIELDS }))
  })

  it('deducts a 2-day 特休 whose answers sit under the deactivated fields when it is approved', async () => {
    mockDeductAnnualLeave.mockResolvedValue({})
    const doc = makeRequestDoc({
      form_data: { 'old-type': '特休', 'old-start': '2099-03-02', 'old-end': '2099-03-03' },
      steps: [{ approvers: [[SUP, 'pending']] }],
    })
    const res = await act(doc, { user: supUser(), body: { decision: 'approve' } })

    expect(res.status).not.toHaveBeenCalledWith(409)
    expect(mockDeductAnnualLeave).toHaveBeenCalledTimes(1)
    expect(mockDeductAnnualLeave).toHaveBeenCalledWith(APPLICANT, 2, REQ)
    expect(doc.annual_leave).toEqual(expect.objectContaining({ state: 'deducted', days: 2 }))
  })

  it('reads each request from the field set that holds its answers (old fields, new fields, a mix)', async () => {
    mockDeductAnnualLeave.mockResolvedValue({})
    const answers = [
      { 'old-type': '特休', 'old-start': '2099-03-02', 'old-end': '2099-03-03' }, // 全部在舊欄位
      { 'new-type': '特休', 'new-start': '2099-04-06', 'new-end': '2099-04-06' }, // 全部在新欄位
      { 'old-type': '特休', 'new-start': '2099-05-04', 'new-end': '2099-05-06' }, // 假別在舊、日期在新
      { 'old-type': '病假', 'old-start': '2099-06-01', 'old-end': '2099-06-01' }, // 不是特休
    ]
    for (const formData of answers) {
      const doc = makeRequestDoc({ form_data: formData, steps: [{ approvers: [[SUP, 'pending']] }] })
      await act(doc, { user: supUser(), body: { decision: 'approve' } })
    }

    expect(mockDeductAnnualLeave.mock.calls.map(([, days]) => days)).toEqual([2, 1, 3])
  })

  it('prefers the active field when both the old and the new field hold an answer', async () => {
    mockDeductAnnualLeave.mockResolvedValue({})
    const doc = makeRequestDoc({
      form_data: {
        'old-type': '特休', 'old-start': '2099-03-02', 'old-end': '2099-03-05',
        'new-type': '特休', 'new-start': '2099-03-02', 'new-end': '2099-03-02',
      },
      steps: [{ approvers: [[SUP, 'pending']] }],
    })
    await act(doc, { user: supUser(), body: { decision: 'approve' } })

    expect(mockDeductAnnualLeave).toHaveBeenCalledWith(APPLICANT, 1, REQ)
  })

  it('lets the applicant withdraw an approved 特休 whose answers sit under the old fields, and refunds the deducted days', async () => {
    mockRefundAnnualLeave.mockResolvedValue({ refunded: true, days: 2 })
    const doc = makeRequestDoc({
      status: 'approved',
      form_data: { 'old-type': '特休', 'old-start': '2099-03-02', 'old-end': '2099-03-03' },
      annual_leave: { days: 2, state: 'deducted' },
    })
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

    expect(res.status).not.toHaveBeenCalledWith(409)
    expect(mockRefundAnnualLeave).toHaveBeenCalledWith(APPLICANT, 2, REQ)
    expect(doc.status).toBe('canceled')
  })

  it('still knows the leave has started when the start date sits under the old field (the applicant cannot withdraw)', async () => {
    const doc = makeRequestDoc({
      status: 'approved',
      form_data: { 'old-type': '特休', 'old-start': '2020-03-02', 'old-end': '2020-03-02' },
      annual_leave: { days: 1, state: 'deducted' },
    })
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({ params: { id: REQ }, user: employeeUser(APPLICANT), body: {} }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'LEAVE_STARTED' }))
    expect(mockRefundAnnualLeave).not.toHaveBeenCalled()
  })
})
