import { jest } from '@jest/globals'

const mockFormTemplate = { findById: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn() }
const mockApprovalRequest = { create: jest.fn(), findById: jest.fn(), findOne: jest.fn() }
const mockEmployee = { findById: jest.fn() }
const mockAssertApprovalRequestCompliance = jest.fn()
const mockIsLaborRuleValidationError = jest.fn((error) => Array.isArray(error?.violations))

let createApprovalRequest
let actOnApproval
let cancelApprovalRequest
let resubmitApprovalRequest

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
    assertApprovalRequestCompliance: mockAssertApprovalRequestCompliance,
    isLaborRuleValidationError: mockIsLaborRuleValidationError,
  }))
  const mod = await import('../src/controllers/approvalRequestController.js')
  createApprovalRequest = mod.createApprovalRequest
  actOnApproval = mod.actOnApproval
  cancelApprovalRequest = mod.cancelApprovalRequest
  resubmitApprovalRequest = mod.resubmitApprovalRequest
})

beforeEach(() => {
  mockFormTemplate.findById.mockReset()
  mockApprovalWorkflow.findOne.mockReset()
  mockApprovalRequest.create.mockReset()
  mockApprovalRequest.findById.mockReset()
  mockApprovalRequest.findOne.mockReset()
  mockEmployee.findById.mockReset()
  mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
  mockAssertApprovalRequestCompliance.mockReset()
  mockAssertApprovalRequestCompliance.mockResolvedValue({ ok: true, violations: [] })
  mockIsLaborRuleValidationError.mockClear()
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

function makeCreateReq(body, userId = 'emp1') {
  return { body, user: { id: userId, role: 'employee' } }
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
    _id: overrides._id || 'req1',
    steps,
    logs,
    save: jest.fn().mockResolvedValue(),
  }
}

describe('createApprovalRequest', () => {
  it('creates request when form and workflow exist', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', name: 'Form', is_active: true })
    mockApprovalWorkflow.findOne.mockResolvedValue({
      _id: 'wf1',
      form: 'form1',
      steps: [{ step_order: 1, approver_type: 'user', approver_value: ['lead1'] }],
    })
    mockApprovalRequest.create.mockImplementation(async (payload) => {
      const doc = buildMockDoc(payload)
      mockApprovalRequest.findById.mockResolvedValue(doc)
      return doc
    })
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' }), res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ _id: 'req1' }))
  })

  it('returns error if form missing', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: 'bad', form_data: {}, applicant_employee_id: 'emp1' }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'form not found' })
  })

  it('returns error if workflow missing', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', is_active: true })
    mockApprovalWorkflow.findOne.mockResolvedValue(null)
    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'workflow not configured' })
  })

  it('returns overtime rule violations before creating request', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', name: '加班申請', is_active: true })
    mockApprovalWorkflow.findOne.mockResolvedValue({
      _id: 'wf1',
      form: 'form1',
      steps: [{ step_order: 1, approver_type: 'user', approver_value: ['lead1'] }],
    })
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
    const error = new Error('加班規範檢核未通過')
    error.status = 400
    error.violations = [{ rule: 'regular-rest-overtime', message: '例假不得加班' }]
    mockAssertApprovalRequestCompliance.mockRejectedValue(error)

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' }), res)

    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: '加班規範檢核未通過',
      violations: error.violations,
    })
  })

  it('skips empty initial step when applicant has no supervisor', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', name: '外出單', is_active: true })
    mockApprovalWorkflow.findOne.mockResolvedValue({
      _id: 'wf1',
      form: 'form1',
      steps: [
        { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
        { step_order: 2, approver_type: 'user', approver_value: ['lead1'] },
      ],
    })
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1', supervisor: null })

    let createdDoc
    mockApprovalRequest.create.mockImplementation(async (payload) => {
      createdDoc = buildMockDoc(payload)
      mockApprovalRequest.findById.mockResolvedValue(createdDoc)
      return createdDoc
    })

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' }), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(createdDoc.current_step_index).toBe(1)
    expect(createdDoc.steps[0].finished_at).toBeInstanceOf(Date)
    expect(createdDoc.steps[1].started_at).toBeInstanceOf(Date)
  })

  it('merges consecutive steps with identical approvers and config', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', name: '出差單', is_active: true })
    mockApprovalWorkflow.findOne.mockResolvedValue({
      _id: 'wf1',
      form: 'form1',
      steps: [
        { step_order: 1, approver_type: 'user', approver_value: ['lead1'], all_must_approve: true, is_required: true, can_return: false },
        { step_order: 2, approver_type: 'user', approver_value: ['lead1'], all_must_approve: true, is_required: true, can_return: false },
        { step_order: 3, approver_type: 'user', approver_value: ['lead2'], all_must_approve: false, is_required: true, can_return: false },
      ],
    })

    let createdDoc
    mockApprovalRequest.create.mockImplementation(async (payload) => {
      createdDoc = buildMockDoc(payload)
      mockApprovalRequest.findById.mockResolvedValue(createdDoc)
      return createdDoc
    })

    const res = makeRes()
    await createApprovalRequest(makeCreateReq({ form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' }), res)

    expect(mockApprovalRequest.create).toHaveBeenCalledTimes(1)
    const payload = mockApprovalRequest.create.mock.calls[0][0]
    expect(payload.steps).toHaveLength(2)
    expect(payload.steps[0].step_order).toBe(1)
    expect(payload.steps[0].approvers).toEqual([{ approver: 'lead1', decision: 'pending' }])
    expect(payload.steps[1].step_order).toBe(2)
    expect(payload.steps[1].approvers).toEqual([{ approver: 'lead2', decision: 'pending' }])

    expect(createdDoc.current_step_index).toBe(0)
    expect(res.status).toHaveBeenCalledWith(201)
    const responseDoc = res.json.mock.calls[0][0]
    expect(responseDoc.steps).toHaveLength(2)
    expect(responseDoc.steps[0].step_order).toBe(1)
    expect(responseDoc.steps[1].step_order).toBe(2)
  })

  it('rejects creating a request for another employee', async () => {
    const res = makeRes()

    await createApprovalRequest(
      makeCreateReq({ form_id: 'form1', form_data: {}, applicant_employee_id: 'other-employee' }),
      res,
    )

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' })
    expect(mockFormTemplate.findById).not.toHaveBeenCalled()
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })

  it('returns the existing request for a repeated idempotency key', async () => {
    const existing = { _id: 'existing-request', status: 'pending' }
    mockApprovalRequest.findOne.mockResolvedValue(existing)
    const res = makeRes()

    await createApprovalRequest({
      body: { form_id: 'form1', form_data: {} },
      user: { id: 'emp1', role: 'employee' },
      get: name => name === 'Idempotency-Key' ? 'same-key' : undefined,
    }, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(existing)
    expect(mockApprovalRequest.create).not.toHaveBeenCalled()
  })
})

describe('actOnApproval authorization', () => {
  it('does not allow an employee to act as a body-supplied supervisor', async () => {
    const doc = {
      _id: 'req1',
      status: 'pending',
      current_step_index: 0,
      steps: [{ approvers: [{ approver: 'sup1', decision: 'pending' }] }],
      logs: [],
      save: jest.fn().mockResolvedValue(),
    }
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await actOnApproval({
      params: { id: 'req1' },
      user: { id: 'emp1', role: 'employee' },
      body: { employee_id: 'sup1', decision: 'approve' },
    }, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' })
    expect(mockApprovalRequest.findById).not.toHaveBeenCalled()
    expect(doc.save).not.toHaveBeenCalled()
    expect(doc.steps[0].approvers[0].decision).toBe('pending')
  })

  it('does not reveal the status of a request to a non-participant', async () => {
    const doc = {
      _id: 'req1',
      applicant_employee: 'emp2',
      status: 'approved',
      current_step_index: 0,
      steps: [{ approvers: [{ approver: 'sup1', decision: 'approved' }] }],
      logs: [],
      save: jest.fn().mockResolvedValue(),
    }
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await actOnApproval({
      params: { id: 'req1' },
      user: { id: 'unrelated', role: 'employee' },
      body: { decision: 'approve' },
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'not found' })
    expect(doc.save).not.toHaveBeenCalled()
  })
})

describe('applicant approval state actions', () => {
  it('allows the applicant to cancel once and treats a duplicate cancel as idempotent', async () => {
    const doc = buildMockDoc({
      applicant_employee: 'emp1',
      status: 'pending',
      steps: [],
      logs: [],
    })
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({
      params: { id: 'req1' },
      user: { id: 'emp1', role: 'employee' },
      body: {},
    }, res)
    await cancelApprovalRequest({
      params: { id: 'req1' },
      user: { id: 'emp1', role: 'employee' },
      body: {},
    }, res)

    expect(doc.status).toBe('canceled')
    expect(doc.logs.filter(log => log.action === 'cancel')).toHaveLength(1)
    expect(doc.save).toHaveBeenCalledTimes(1)
  })

  it('does not reveal or cancel another employee request', async () => {
    const doc = buildMockDoc({
      applicant_employee: 'emp2',
      status: 'pending',
      steps: [],
      logs: [],
    })
    mockApprovalRequest.findById.mockResolvedValue(doc)
    const res = makeRes()

    await cancelApprovalRequest({
      params: { id: 'req1' },
      user: { id: 'emp1', role: 'employee' },
      body: {},
    }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('revalidates and resets a returned request before resubmitting', async () => {
    const doc = buildMockDoc({
      form: 'form1',
      applicant_employee: 'emp1',
      status: 'returned',
      current_step_index: 0,
      steps: [{
        approvers: [{ approver: 'lead1', decision: 'returned', comment: 'fix' }],
      }],
      logs: [],
    })
    mockApprovalRequest.findById.mockResolvedValue(doc)
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', is_active: true })
    const res = makeRes()

    await resubmitApprovalRequest({
      params: { id: 'req1' },
      user: { id: 'emp1', role: 'employee' },
      body: {},
    }, res)

    expect(mockAssertApprovalRequestCompliance).toHaveBeenCalled()
    expect(doc.status).toBe('pending')
    expect(doc.steps[0].approvers[0]).toEqual(expect.objectContaining({ decision: 'pending' }))
    expect(doc.save).toHaveBeenCalledTimes(1)
  })
})
