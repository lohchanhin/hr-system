import { jest } from '@jest/globals'

const mockFormTemplate = { findById: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn() }
const mockApprovalRequest = { create: jest.fn(), findById: jest.fn() }
const mockEmployee = { findById: jest.fn() }

let createApprovalRequest

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  const mod = await import('../src/controllers/approvalRequestController.js')
  createApprovalRequest = mod.createApprovalRequest
})

beforeEach(() => {
  mockFormTemplate.findById.mockReset()
  mockApprovalWorkflow.findOne.mockReset()
  mockApprovalRequest.create.mockReset()
  mockApprovalRequest.findById.mockReset()
  mockEmployee.findById.mockReset()
  mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
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
    await createApprovalRequest({ body: { form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' } }, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ _id: 'req1' }))
  })

  it('returns error if form missing', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()
    await createApprovalRequest({ body: { form_id: 'bad', form_data: {}, applicant_employee_id: 'emp1' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'form not found' })
  })

  it('returns error if workflow missing', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', is_active: true })
    mockApprovalWorkflow.findOne.mockResolvedValue(null)
    const res = makeRes()
    await createApprovalRequest({ body: { form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'workflow not configured' })
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
    await createApprovalRequest({ body: { form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' } }, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(createdDoc.current_step_index).toBe(1)
    expect(createdDoc.steps[0].finished_at).toBeInstanceOf(Date)
    expect(createdDoc.steps[1].started_at).toBeInstanceOf(Date)
  })
})
