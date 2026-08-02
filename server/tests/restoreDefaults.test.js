import { jest } from '@jest/globals'

const mockFormTemplate = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  deleteMany: jest.fn(),
}

const mockFormField = {
  create: jest.fn(),
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
}

const mockApprovalWorkflow = {
  findOne: jest.fn(),
  create: jest.fn(),
  deleteMany: jest.fn(),
}

let restoreDefaultTemplates

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  ;({ restoreDefaultTemplates } = await import('../src/controllers/approvalTemplateController.js'))
})

beforeEach(() => {
  for (const model of [mockFormTemplate, mockFormField, mockApprovalWorkflow]) {
    Object.values(model).forEach((fn) => fn.mockReset())
  }
  let counter = 0
  mockFormTemplate.findOne.mockResolvedValue(null)
  mockFormTemplate.create.mockImplementation(async (data) => ({ ...data, _id: `form-${++counter}` }))
  mockFormField.insertMany.mockResolvedValue([])
  mockApprovalWorkflow.create.mockResolvedValue({})
})

function makeReq() {
  return { user: { id: 'admin1', role: 'admin' }, body: {} }
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

describe('restoreDefaultTemplates', () => {
  it('creates all missing defaults without deleting existing data', async () => {
    const res = makeRes()

    await restoreDefaultTemplates(makeReq(), res)

    expect(mockFormTemplate.findOne).toHaveBeenCalledTimes(8)
    expect(mockFormTemplate.create).toHaveBeenCalledTimes(8)
    expect(mockFormField.insertMany).toHaveBeenCalledTimes(8)
    expect(mockApprovalWorkflow.create).toHaveBeenCalledTimes(8)
    expect(mockFormTemplate.deleteMany).not.toHaveBeenCalled()
    expect(mockFormField.deleteMany).not.toHaveBeenCalled()
    expect(mockApprovalWorkflow.deleteMany).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      count: 8,
      createdCount: 8,
      preservedCount: 0,
    }))
  })

  it('preserves matching and custom forms and only creates missing defaults', async () => {
    mockFormTemplate.findOne.mockImplementation(async ({ name }) => (
      name === '請假' ? { _id: 'existing-leave', name } : null
    ))
    const res = makeRes()

    await restoreDefaultTemplates(makeReq(), res)

    expect(mockFormTemplate.create).toHaveBeenCalledTimes(7)
    expect(mockFormTemplate.create).not.toHaveBeenCalledWith(expect.objectContaining({ name: '請假' }))
    expect(mockFormTemplate.deleteMany).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      count: 7,
      createdCount: 7,
      preservedCount: 1,
    }))
  })

  it('returns a failure without starting destructive cleanup', async () => {
    mockFormTemplate.findOne.mockRejectedValue(new Error('Database error'))
    const res = makeRes()

    await restoreDefaultTemplates(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Database error' })
    expect(mockFormTemplate.deleteMany).not.toHaveBeenCalled()
  })
})
