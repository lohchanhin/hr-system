import { jest } from '@jest/globals'

// Mock models
const mockFormTemplate = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  deleteMany: jest.fn()
}

const mockFormField = {
  find: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
  deleteMany: jest.fn()
}

const mockApprovalWorkflow = {
  findOne: jest.fn(),
  create: jest.fn(),
  deleteMany: jest.fn()
}

let restoreDefaultTemplates

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  
  const mod = await import('../src/controllers/approvalTemplateController.js')
  restoreDefaultTemplates = mod.restoreDefaultTemplates
})

beforeEach(() => {
  mockFormTemplate.find.mockReset()
  mockFormTemplate.findOne.mockReset()
  mockFormTemplate.create.mockReset()
  mockFormTemplate.deleteMany.mockReset()
  mockFormField.find.mockReset()
  mockFormField.create.mockReset()
  mockFormField.insertMany.mockReset()
  mockFormField.deleteMany.mockReset()
  mockApprovalWorkflow.findOne.mockReset()
  mockApprovalWorkflow.create.mockReset()
  mockApprovalWorkflow.deleteMany.mockReset()
})

function makeReq() {
  return {
    user: { id: 'user123' },
    params: {},
    body: {}
  }
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  }
}

describe('restoreDefaultTemplates', () => {
  it('should delete all existing forms and create default templates', async () => {
    const existingForms = [
      { _id: 'form1', name: '舊表單1' },
      { _id: 'form2', name: '舊表單2' }
    ]
    
    mockFormTemplate.find.mockResolvedValue(existingForms)
    mockFormField.deleteMany.mockResolvedValue({ deletedCount: 5 })
    mockApprovalWorkflow.deleteMany.mockResolvedValue({ deletedCount: 2 })
    mockFormTemplate.deleteMany.mockResolvedValue({ deletedCount: 2 })
    
    // Mock form creation
    let formIdCounter = 1
    mockFormTemplate.create.mockImplementation((data) => {
      return Promise.resolve({ ...data, _id: `new-form-${formIdCounter++}` })
    })
    
    mockFormField.insertMany.mockResolvedValue([{ _id: 'field123' }])
    mockApprovalWorkflow.create.mockResolvedValue({ _id: 'workflow123' })
    
    const req = makeReq()
    const res = makeRes()
    
    await restoreDefaultTemplates(req, res)
    
    // Verify deletion - now using $in operator for better performance
    expect(mockFormTemplate.find).toHaveBeenCalledWith({})
    expect(mockFormField.deleteMany).toHaveBeenCalledTimes(1)
    expect(mockFormField.deleteMany).toHaveBeenCalledWith({ form: { $in: ['form1', 'form2'] } })
    expect(mockApprovalWorkflow.deleteMany).toHaveBeenCalledTimes(1)
    expect(mockApprovalWorkflow.deleteMany).toHaveBeenCalledWith({ form: { $in: ['form1', 'form2'] } })
    expect(mockFormTemplate.deleteMany).toHaveBeenCalledWith({})
    
    // Verify creation of 8 default templates
    expect(mockFormTemplate.create).toHaveBeenCalledTimes(8)
    expect(mockFormTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '請假',
        category: '人事',
        is_active: true
      })
    )
    
    // Verify response
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: '已恢復預設簽核表單',
        count: 8
      })
    )
  })
  
  it('should handle errors gracefully', async () => {
    mockFormTemplate.find.mockRejectedValue(new Error('Database error'))
    
    const req = makeReq()
    const res = makeRes()
    
    await restoreDefaultTemplates(req, res)
    
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Database error' })
  })
  
  it('should create all 8 default form templates', async () => {
    mockFormTemplate.find.mockResolvedValue([])
    mockFormField.deleteMany.mockResolvedValue({ deletedCount: 0 })
    mockApprovalWorkflow.deleteMany.mockResolvedValue({ deletedCount: 0 })
    mockFormTemplate.deleteMany.mockResolvedValue({ deletedCount: 0 })
    
    let formIdCounter = 1
    mockFormTemplate.create.mockImplementation((data) => {
      return Promise.resolve({ ...data, _id: `form-${formIdCounter++}` })
    })
    
    mockFormField.insertMany.mockResolvedValue([{ _id: 'field123' }])
    mockApprovalWorkflow.create.mockResolvedValue({ _id: 'workflow123' })
    
    const req = makeReq()
    const res = makeRes()
    
    await restoreDefaultTemplates(req, res)
    
    const expectedForms = [
      '請假', '支援申請', '特休保留', '在職證明',
      '離職證明', '加班申請', '補簽申請', '獎金申請'
    ]
    
    expectedForms.forEach((name) => {
      expect(mockFormTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ name })
      )
    })
  })
})
