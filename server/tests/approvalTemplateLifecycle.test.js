import { jest } from '@jest/globals'

const mockFormTemplate = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
}
const mockFormField = {
  find: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  deleteMany: jest.fn(),
}
const mockApprovalWorkflow = {
  findOne: jest.fn(),
  deleteOne: jest.fn(),
}
const mockApprovalRequest = { countDocuments: jest.fn() }
const mockResetLeaveFieldCache = jest.fn()

let controller

const GENERIC_SERVER_ERROR = '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員'

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ resetLeaveFieldCache: mockResetLeaveFieldCache }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: jest.fn().mockResolvedValue({ itemSettings: {} }),
    getDictionaryItems: jest.fn().mockResolvedValue([]),
  }))
  controller = await import('../src/controllers/approvalTemplateController.js')
})

beforeEach(() => {
  for (const model of [mockFormTemplate, mockFormField, mockApprovalWorkflow, mockApprovalRequest]) {
    Object.values(model).forEach((fn) => fn.mockReset())
  }
  mockResetLeaveFieldCache.mockReset()
  mockFormTemplate.findById.mockResolvedValue({ _id: '000000000000000000000f01', name: '請假' })
  mockFormTemplate.findByIdAndUpdate.mockResolvedValue({})
  mockFormTemplate.deleteOne.mockResolvedValue({})
  mockFormField.deleteMany.mockResolvedValue({})
  mockFormField.findByIdAndDelete.mockResolvedValue({})
  mockFormField.findByIdAndUpdate.mockResolvedValue({})
  mockApprovalWorkflow.deleteOne.mockResolvedValue({})
  mockApprovalRequest.countDocuments.mockResolvedValue(0)
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

describe('deleteFormTemplate', () => {
  it('deletes the template with its fields and workflow when no request ever used it', async () => {
    const res = makeRes()

    await controller.deleteFormTemplate({ params: { id: '000000000000000000000f01' } }, res)

    expect(mockApprovalRequest.countDocuments).toHaveBeenCalledWith({ form: '000000000000000000000f01' })
    expect(mockFormField.deleteMany).toHaveBeenCalledWith({ form: '000000000000000000000f01' })
    expect(mockApprovalWorkflow.deleteOne).toHaveBeenCalledWith({ form: '000000000000000000000f01' })
    expect(mockFormTemplate.deleteOne).toHaveBeenCalledWith({ _id: '000000000000000000000f01' })
    expect(mockFormTemplate.findByIdAndUpdate).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, deleted: true, deactivated: false }))
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('deactivates instead of deleting when requests exist, keeping fields, workflow and the template', async () => {
    mockApprovalRequest.countDocuments.mockImplementation(async (filter) => (filter.status === 'pending' ? 2 : 5))
    const res = makeRes()

    await controller.deleteFormTemplate({ params: { id: '000000000000000000000f01' } }, res)

    expect(mockFormTemplate.findByIdAndUpdate).toHaveBeenCalledWith('000000000000000000000f01', { $set: { is_active: false } })
    expect(mockFormField.deleteMany).not.toHaveBeenCalled()
    expect(mockApprovalWorkflow.deleteOne).not.toHaveBeenCalled()
    expect(mockFormTemplate.deleteOne).not.toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    const body = res.json.mock.calls[0][0]
    expect(body).toEqual(expect.objectContaining({
      success: true, deleted: false, deactivated: true, requestCount: 5, pendingCount: 2,
    }))
    expect(body.message).toContain('5 筆申請單')
    expect(body.message).toContain('2 筆簽核中')
    expect(body.message).toContain('停用')
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('deactivates even when the only requests are finished ones (their detail must stay readable)', async () => {
    mockApprovalRequest.countDocuments.mockImplementation(async (filter) => (filter.status === 'pending' ? 0 : 1))
    const res = makeRes()

    await controller.deleteFormTemplate({ params: { id: '000000000000000000000f01' } }, res)

    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ deactivated: true, pendingCount: 0, requestCount: 1 }))
    expect(mockFormTemplate.deleteOne).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown template and changes nothing', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()

    await controller.deleteFormTemplate({ params: { id: '00000000000000000000dead' } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: '找不到這張表單樣板' })
    expect(mockApprovalRequest.countDocuments).not.toHaveBeenCalled()
    expect(mockFormTemplate.deleteOne).not.toHaveBeenCalled()
  })

  it('does not delete anything when the request count cannot be read, and answers with a generic Chinese 500', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockApprovalRequest.countDocuments.mockRejectedValue(new Error('count failed'))
    const res = makeRes()

    await controller.deleteFormTemplate({ params: { id: '000000000000000000000f01' } }, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: GENERIC_SERVER_ERROR })
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('count failed')
    expect(errorSpy).toHaveBeenCalledWith('[approval-template] delete form failed: Error')
    expect(mockFormField.deleteMany).not.toHaveBeenCalled()
    expect(mockFormTemplate.deleteOne).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it.each([
    ['a word', 'zzz'],
    ['an object', { $ne: null }],
    ['too short', '12345'],
    ['empty', ''],
  ])('refuses %s as the form id with a Chinese 400 before touching the database', async (_label, id) => {
    const res = makeRes()

    await controller.deleteFormTemplate({ params: { id } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '表單編號格式不正確' })
    expect(mockFormTemplate.findById).not.toHaveBeenCalled()
    expect(mockApprovalRequest.countDocuments).not.toHaveBeenCalled()
  })
})

describe('deleteField', () => {
  const FIELD = { _id: 'field1', form: '000000000000000000000f01', label: '事由' }

  beforeEach(() => {
    mockFormField.findOne.mockResolvedValue(FIELD)
  })

  it('removes the field when the form has no requests', async () => {
    const res = makeRes()

    await controller.deleteField({ params: { formId: '000000000000000000000f01', fieldId: 'field1' } }, res)

    expect(mockFormField.findOne).toHaveBeenCalledWith({ _id: 'field1', form: '000000000000000000000f01' })
    expect(mockApprovalRequest.countDocuments).toHaveBeenCalledWith({ form: '000000000000000000000f01' })
    expect(mockFormField.findByIdAndDelete).toHaveBeenCalledWith('field1')
    expect(mockFormField.findByIdAndUpdate).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ success: true, deleted: true, deactivated: false })
  })

  it('deactivates the field instead of deleting when the form already has requests, so earlier answers stay readable', async () => {
    mockApprovalRequest.countDocuments.mockResolvedValue(4)
    const res = makeRes()

    await controller.deleteField({ params: { formId: '000000000000000000000f01', fieldId: 'field1' } }, res)

    expect(mockFormField.findByIdAndUpdate).toHaveBeenCalledWith('field1', { $set: { is_active: false } })
    expect(mockFormField.findByIdAndDelete).not.toHaveBeenCalled()
    const body = res.json.mock.calls[0][0]
    expect(body).toEqual(expect.objectContaining({ success: true, deleted: false, deactivated: true, requestCount: 4 }))
    expect(body.message).toContain('事由')
    expect(body.message).toContain('舊申請單仍會顯示')
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('refuses to delete a field through the URL of another form', async () => {
    mockFormField.findOne.mockResolvedValue(null)
    const res = makeRes()

    await controller.deleteField({ params: { formId: 'formA', fieldId: 'field-of-B' } }, res)

    expect(mockFormField.findOne).toHaveBeenCalledWith({ _id: 'field-of-B', form: 'formA' })
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: '找不到這個欄位' })
    expect(mockFormField.findByIdAndDelete).not.toHaveBeenCalled()
    expect(mockFormField.findByIdAndUpdate).not.toHaveBeenCalled()
  })
})

describe('listFormTemplates', () => {
  beforeEach(() => {
    mockFormTemplate.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ _id: '000000000000000000000f01' }]) })
  })

  it.each(['employee', 'supervisor'])('shows a %s only the active templates', async (role) => {
    const res = makeRes()

    await controller.listFormTemplates({ query: {}, user: { id: 'u1', role } }, res)

    expect(mockFormTemplate.find).toHaveBeenCalledWith({ is_active: { $ne: false } })
    expect(res.json).toHaveBeenCalledWith([{ _id: '000000000000000000000f01' }])
  })

  it('does not let a non-admin ask for the inactive ones', async () => {
    await controller.listFormTemplates({ query: { is_active: 'false' }, user: { id: 'u1', role: 'employee' } }, makeRes())

    expect(mockFormTemplate.find).toHaveBeenCalledWith({ is_active: { $ne: false } })
  })

  it('treats a request without a signed-in role like an employee', async () => {
    await controller.listFormTemplates({ query: {} }, makeRes())

    expect(mockFormTemplate.find).toHaveBeenCalledWith({ is_active: { $ne: false } })
  })

  it('shows an admin every template (each carries its is_active flag)', async () => {
    await controller.listFormTemplates({ query: {}, user: { id: 'a1', role: 'admin' } }, makeRes())

    expect(mockFormTemplate.find).toHaveBeenCalledWith({})
  })

  it('lets an admin filter by is_active', async () => {
    const admin = { id: 'a1', role: 'admin' }

    await controller.listFormTemplates({ query: { is_active: 'true' }, user: admin }, makeRes())
    await controller.listFormTemplates({ query: { is_active: 'false' }, user: admin }, makeRes())

    expect(mockFormTemplate.find).toHaveBeenNthCalledWith(1, { is_active: { $ne: false } })
    expect(mockFormTemplate.find).toHaveBeenNthCalledWith(2, { is_active: false })
  })

  it('searches by name and category with literal values only', async () => {
    await controller.listFormTemplates({
      query: { q: '請假.*', category: { $ne: 'x' } },
      user: { id: 'a1', role: 'admin' },
    }, makeRes())

    const filter = mockFormTemplate.find.mock.calls[0][0]
    expect(filter.name).toBeInstanceOf(RegExp)
    expect(filter.name.test('請假.*')).toBe(true)
    expect(filter.name.test('請假單')).toBe(false)
    expect(filter).not.toHaveProperty('category') // 物件形式的 category 會被忽略，不能當成查詢運算子
  })

  it('reports a database failure as a generic Chinese 500 without echoing the database message', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFormTemplate.find.mockImplementation(() => { throw new Error('db down') })
    const res = makeRes()

    await controller.listFormTemplates({ query: {}, user: { role: 'admin' } }, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: GENERIC_SERVER_ERROR })
    expect(errorSpy).toHaveBeenCalledWith('[approval-template] list forms failed: Error')
    errorSpy.mockRestore()
  })
})

describe('getFormTemplate', () => {
  it('returns only the active fields for the fill-in page', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
    mockApprovalWorkflow.findOne.mockResolvedValue({ _id: 'wf' })

    await controller.getFormTemplate({ params: { id: '000000000000000000000f01' } }, makeRes())

    expect(mockFormField.find).toHaveBeenCalledWith({ form: '000000000000000000000f01', is_active: { $ne: false } })
  })

  it('answers 404 with a Chinese message for an unknown template', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()

    await controller.getFormTemplate({ params: { id: '00000000000000000000dead' } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: '找不到這張表單樣板' })
  })
})

describe('getWorkflow', () => {
  it('answers 404 with a Chinese message when the form has no workflow yet', async () => {
    mockApprovalWorkflow.findOne.mockResolvedValue(null)
    const res = makeRes()

    await controller.getWorkflow({ params: { formId: '000000000000000000000f01' } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: '這張表單還沒有簽核流程' })
  })
})

describe('malformed ids and failures on the read endpoints (no English or internal messages)', () => {
  const BAD_IDS = ['zzz', '12345', { $gt: '' }]
  let errorSpy

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it.each(BAD_IDS)('getFormTemplate answers a Chinese 400 for the id %j without querying', async (id) => {
    const res = makeRes()

    await controller.getFormTemplate({ params: { id } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '表單編號格式不正確' })
    expect(mockFormTemplate.findById).not.toHaveBeenCalled()
  })

  it.each(BAD_IDS)('listFields answers a Chinese 400 for the id %j, also for an employee', async (formId) => {
    const res = makeRes()

    await controller.listFields({ params: { formId }, user: { id: 'u1', role: 'employee' }, query: {} }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '表單編號格式不正確' })
    expect(mockFormField.find).not.toHaveBeenCalled()
  })

  it.each(BAD_IDS)('getWorkflow answers a Chinese 400 for the id %j without querying', async (formId) => {
    const res = makeRes()

    await controller.getWorkflow({ params: { formId }, user: { id: 'u1', role: 'employee' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '表單編號格式不正確' })
    expect(mockApprovalWorkflow.findOne).not.toHaveBeenCalled()
  })

  it('maps a Mongoose cast error that slips through to a Chinese 400, never its English message', async () => {
    const castError = Object.assign(new Error('Cast to ObjectId failed for value "x" (type string) at path "form" for model "FormField"'), { name: 'CastError' })
    mockFormField.find.mockImplementation(() => { throw castError })
    const res = makeRes()

    await controller.listFields({ params: { formId: '000000000000000000000f01' }, user: { role: 'admin' }, query: {} }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '資料格式不正確，請檢查後再試' })
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(/Cast to ObjectId|FormField/)
  })

  it.each([
    ['getFormTemplate', 'get form', (res) => controller.getFormTemplate({ params: { id: '000000000000000000000f01' } }, res)],
    ['listFields', 'list fields', (res) => controller.listFields({ params: { formId: '000000000000000000000f01' }, user: { role: 'admin' }, query: {} }, res)],
    ['getWorkflow', 'get workflow', (res) => controller.getWorkflow({ params: { formId: '000000000000000000000f01' }, user: { id: 'u1', role: 'employee' } }, res)],
    ['deleteField', 'delete field', (res) => controller.deleteField({ params: { formId: '000000000000000000000f01', fieldId: 'field1' } }, res)],
  ])('%s answers a generic Chinese 500 and logs only the error name when the database fails', async (_name, context, call) => {
    const failure = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:27017'), { name: 'MongoNetworkError' })
    mockFormTemplate.findById.mockRejectedValue(failure)
    mockFormField.find.mockImplementation(() => { throw failure })
    mockFormField.findOne.mockRejectedValue(failure)
    mockApprovalWorkflow.findOne.mockRejectedValue(failure)
    const res = makeRes()

    await call(res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: GENERIC_SERVER_ERROR })
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('ECONNREFUSED')
    expect(errorSpy).toHaveBeenCalledWith(`[approval-template] ${context} failed: MongoNetworkError`)
  })
})
