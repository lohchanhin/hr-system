import { jest } from '@jest/globals'

const mockFormTemplate = { findById: jest.fn() }
const mockApprovalWorkflow = { findOne: jest.fn() }
const mockApprovalRequest = { create: jest.fn() }
const mockEmployee = { findById: jest.fn() }
const mockUser = { findById: jest.fn() }

let createApprovalRequest

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }))
  const mod = await import('../src/controllers/approvalRequestController.js')
  createApprovalRequest = mod.createApprovalRequest
})

beforeEach(() => {
  mockFormTemplate.findById.mockReset()
  mockApprovalWorkflow.findOne.mockReset()
  mockApprovalRequest.create.mockReset()
  mockEmployee.findById.mockReset()
  mockUser.findById.mockReset()
  mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

describe('createApprovalRequest', () => {
  it('creates request when form and workflow exist', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form1', is_active: true })
    mockApprovalWorkflow.findOne.mockResolvedValue({ _id: 'wf1', form: 'form1', steps: [{}] })
    mockApprovalRequest.create.mockResolvedValue({ _id: 'req1' })
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1' })
    const res = makeRes()
    await createApprovalRequest({ body: { form_id: 'form1', form_data: {}, applicant_employee_id: 'emp1' } }, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ _id: 'req1' })
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
})

