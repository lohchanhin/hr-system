import { jest } from '@jest/globals'

const mockFormTemplate = {
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  deleteMany: jest.fn(),
}

const mockFormField = {
  find: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
}

const mockApprovalWorkflow = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn(),
  deleteMany: jest.fn(),
}

const mockEmployee = { find: jest.fn() }
const mockResetLeaveFieldCache = jest.fn()

let restoreDefaultTemplates
let ensureLeaveForm

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ resetLeaveFieldCache: mockResetLeaveFieldCache }))
  ;({ restoreDefaultTemplates, ensureLeaveForm } = await import('../src/controllers/approvalTemplateController.js'))
})

// 資料庫裡目前的表單 / 流程 / 員工（各測試自行指定）
let templates
let workflows
let employees

beforeEach(() => {
  for (const model of [mockFormTemplate, mockFormField, mockApprovalWorkflow, mockEmployee]) {
    Object.values(model).forEach((fn) => fn.mockReset())
  }
  mockResetLeaveFieldCache.mockReset()
  templates = []
  workflows = []
  employees = []
  let counter = 0
  mockFormTemplate.find.mockImplementation(() => ({ lean: async () => templates }))
  mockFormTemplate.findById.mockImplementation(async (id) => templates.find((item) => item._id === id) || null)
  mockFormTemplate.findOne.mockResolvedValue(null)
  mockFormTemplate.create.mockImplementation(async (data) => ({ ...data, _id: `form-${++counter}` }))
  mockFormTemplate.updateOne.mockResolvedValue({ modifiedCount: 1 })
  mockFormField.insertMany.mockResolvedValue([])
  mockFormField.find.mockImplementation(() => ({ sort: async () => [] }))
  mockApprovalWorkflow.find.mockImplementation(() => ({ lean: async () => workflows }))
  mockApprovalWorkflow.findOne.mockImplementation((filter) => {
    const found = workflows.find((item) => item.form === filter.form) || null
    const result = Promise.resolve(found)
    result.lean = async () => found
    return result
  })
  mockApprovalWorkflow.findOneAndUpdate.mockResolvedValue({})
  mockApprovalWorkflow.create.mockResolvedValue({})
  mockEmployee.find.mockImplementation(() => ({ lean: async () => employees }))
})

function makeReq() {
  return { user: { id: 'admin1', role: 'admin' }, body: {} }
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

const GENERIC_SERVER_ERROR = '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員'
const DEFAULT_NAMES = ['請假', '支援申請', '特休保留', '在職證明', '離職證明', '加班申請', '補簽申請', '獎金申請']

async function runRestore() {
  const res = makeRes()
  await restoreDefaultTemplates(makeReq(), res)
  return { res, body: res.json.mock.calls[0][0] }
}

describe('restoreDefaultTemplates', () => {
  it('creates all missing defaults without deleting existing data', async () => {
    const { res, body } = await runRestore()

    expect(mockFormTemplate.find).toHaveBeenCalledTimes(1)
    expect(mockFormTemplate.create).toHaveBeenCalledTimes(8)
    expect(mockFormField.insertMany).toHaveBeenCalledTimes(8)
    expect(mockApprovalWorkflow.create).toHaveBeenCalledTimes(8)
    expect(mockFormTemplate.deleteMany).not.toHaveBeenCalled()
    expect(mockFormTemplate.deleteOne).not.toHaveBeenCalled()
    expect(mockFormField.deleteMany).not.toHaveBeenCalled()
    expect(mockApprovalWorkflow.deleteMany).not.toHaveBeenCalled()
    expect(mockApprovalWorkflow.deleteOne).not.toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(body).toEqual(expect.objectContaining({
      success: true,
      count: 8,
      createdCount: 8,
      preservedCount: 0,
      repairedCount: 0,
    }))
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('creates every default with a fixed default_key, its explicit semanticType and the semantic marker', async () => {
    await runRestore()

    const created = mockFormTemplate.create.mock.calls.map(([data]) => data)
    expect(created.map((data) => data.name)).toEqual(DEFAULT_NAMES)
    expect(new Set(created.map((data) => data.default_key)).size).toBe(8)
    expect(created.every((data) => data.default_key && data.semantic_type_set === true && data.is_active === true)).toBe(true)
    const bySemantic = Object.fromEntries(created.map((data) => [data.name, data.semanticType]))
    expect(bySemantic).toEqual({
      請假: 'leave', 加班申請: 'overtime',
      支援申請: 'general', 特休保留: 'general', 在職證明: 'general', 離職證明: 'general', 補簽申請: 'general', 獎金申請: 'general',
    })
    expect(created[0].created_by).toBe('admin1')
  })

  it('preserves matching and custom forms and only creates missing defaults', async () => {
    templates = [
      { _id: 'existing-leave', name: '請假', semanticType: 'leave' },
      { _id: 'custom', name: '自訂採購單', semanticType: 'general' },
    ]
    workflows = [{ form: 'existing-leave', steps: [{ step_order: 1, approver_type: 'manager' }] }]

    const { body } = await runRestore()

    expect(mockFormTemplate.create).toHaveBeenCalledTimes(7)
    expect(mockFormTemplate.create).not.toHaveBeenCalledWith(expect.objectContaining({ name: '請假' }))
    expect(mockFormTemplate.deleteMany).not.toHaveBeenCalled()
    expect(body).toEqual(expect.objectContaining({ count: 7, createdCount: 7, preservedCount: 1, repairedCount: 0 }))
    // 認得是預設的請假：補上固定代號，之後改名也不會被當成缺少
    expect(mockFormTemplate.updateOne).toHaveBeenCalledWith(
      { _id: 'existing-leave', default_key: { $in: [null, ''] } },
      { $set: { default_key: 'leave' } },
      { timestamps: false },
    )
  })

  it('does not create a duplicate of a renamed default that carries its default_key', async () => {
    templates = [{ _id: 'renamed', name: '請假單（本院）', semanticType: 'leave', default_key: 'leave', is_active: true }]
    workflows = [{ form: 'renamed', steps: [{ step_order: 1, approver_type: 'manager' }] }]

    const { body } = await runRestore()

    expect(mockFormTemplate.create).toHaveBeenCalledTimes(7)
    expect(mockFormTemplate.create.mock.calls.map(([data]) => data.name)).not.toContain('請假')
    expect(body.preservedCount).toBe(1)
    expect(mockFormTemplate.updateOne).not.toHaveBeenCalled()
    expect(body.templates.find((item) => item.key === 'leave')).toEqual(expect.objectContaining({
      name: '請假單（本院）', formId: 'renamed', status: 'preserved', matchedBy: 'key',
    }))
  })

  it('treats an existing form of the same semanticType as the leave / overtime default even without a default_key', async () => {
    templates = [
      { _id: 'customer-leave', name: '休假/事假/公假申請單（人事類-出勤標準）', semanticType: 'leave', is_active: true },
      { _id: 'overtime-form', name: '臨時加班單', semanticType: 'overtime', is_active: false },
    ]
    workflows = [
      { form: 'customer-leave', steps: [{ step_order: 1, approver_type: 'manager' }] },
      { form: 'overtime-form', steps: [{ step_order: 1, approver_type: 'manager' }] },
    ]

    const { body } = await runRestore()

    const createdNames = mockFormTemplate.create.mock.calls.map(([data]) => data.name)
    expect(createdNames).not.toContain('請假')
    expect(createdNames).not.toContain('加班申請')
    expect(createdNames).toHaveLength(6)
    expect(body.preservedCount).toBe(2)
    // 只靠性質認出來的表單不是「預設那張」，不改它的代號也不動它的流程
    expect(mockFormTemplate.updateOne).not.toHaveBeenCalled()
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('prefers an active form when several forms share the semanticType', async () => {
    templates = [
      { _id: 'old', name: '舊請假單', semanticType: 'leave', is_active: false },
      { _id: 'current', name: '現行請假單', semanticType: 'leave', is_active: true },
    ]
    workflows = [{ form: 'old', steps: [{ step_order: 1, approver_type: 'manager' }] }, { form: 'current', steps: [{ step_order: 1, approver_type: 'manager' }] }]

    const { body } = await runRestore()

    expect(body.templates.find((item) => item.key === 'leave').formId).toBe('current')
  })

  it('repairs an existing default whose approval chain is empty instead of skipping it', async () => {
    templates = [{ _id: 'leave-form', name: '請假', semanticType: 'leave', default_key: 'leave' }]
    workflows = [{ form: 'leave-form', steps: [] }]

    const { body } = await runRestore()

    expect(mockApprovalWorkflow.findOneAndUpdate).toHaveBeenCalledTimes(1)
    const [filter, update, options] = mockApprovalWorkflow.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ form: 'leave-form' })
    expect(update.$set.steps).toEqual([
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ])
    expect(options).toEqual(expect.objectContaining({ upsert: true }))
    expect(body).toEqual(expect.objectContaining({ createdCount: 7, preservedCount: 1, repairedCount: 1 }))
    expect(body.repaired).toEqual([{ _id: 'leave-form', name: '請假' }])
    expect(body.templates.find((item) => item.key === 'leave')).toEqual(expect.objectContaining({ status: 'repaired', stepCount: 2 }))
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('repairs a default that has no workflow document at all', async () => {
    templates = [{ _id: 'bonus-form', name: '獎金申請', semanticType: 'general' }]
    workflows = []

    const { body } = await runRestore()

    expect(mockApprovalWorkflow.findOneAndUpdate).toHaveBeenCalledWith(
      { form: 'bonus-form' },
      { $set: { steps: expect.any(Array) } },
      expect.objectContaining({ upsert: true }),
    )
    expect(body.repairedCount).toBe(1)
  })

  it('does not rewrite a chain the admin customised', async () => {
    templates = [{ _id: 'leave-form', name: '請假', semanticType: 'leave', default_key: 'leave' }]
    workflows = [{ form: 'leave-form', steps: [{ step_order: 1, approver_type: 'tag', approver_value: '主任' }] }]

    await runRestore()

    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('lists, per default template, the tags it needs and how many eligible employees hold each', async () => {
    employees = [
      { signTags: ['人資', '排班負責人'] },
      { signTags: ['人資 ', '人資'] }, // 同一人重複 / 含空白：只算一位
      { signTags: ['財務覆核'] },
    ]

    const { body } = await runRestore()

    expect(body.templates).toHaveLength(8)
    const leave = body.templates.find((item) => item.key === 'leave')
    expect(leave).toEqual(expect.objectContaining({ name: '請假', status: 'created', isActive: true, stepCount: 2 }))
    expect(leave.requiredTags).toEqual([{ tag: '人資', step: 2, holders: 2, required: true }])
    const overtime = body.templates.find((item) => item.key === 'overtime')
    expect(overtime.requiredTags).toEqual([
      { tag: '排班負責人', step: 2, holders: 1, required: true },
      { tag: '人資', step: 3, holders: 2, required: true },
    ])
    const support = body.templates.find((item) => item.key === 'support')
    expect(support.requiredTags.find((item) => item.tag === '支援單位主管')).toEqual({ tag: '支援單位主管', step: 2, holders: 0, required: true })
  })

  it('asks only for eligible employees (account enabled, not 離職 / 留職停薪)', async () => {
    await runRestore()

    const [filter] = mockEmployee.find.mock.calls[0]
    expect(filter.accountEnabled).toEqual({ $ne: false })
    expect(filter.status).toEqual({ $nin: ['離職員工', '留職停薪'] })
    expect(filter.signTags).toEqual({ $exists: true, $ne: [] })
  })

  it('warns, per step, when a required tag step would resolve to nobody', async () => {
    employees = [{ signTags: ['人資'] }]

    const { body } = await runRestore()

    const tags = body.warnings.filter((item) => item.type === 'tag_without_holder')
    expect(tags.map((item) => `${item.form}:${item.step}:${item.tag}`).sort()).toEqual([
      '加班申請:2:排班負責人',
      '支援申請:2:支援單位主管',
      '獎金申請:2:財務覆核',
    ])
    expect(tags[0].message).toContain('目前沒有任何人持有')
    expect(tags[0].formId).toBeTruthy()
  })

  it('gives no tag warnings when every required tag has an eligible holder', async () => {
    employees = [{ signTags: ['人資', '排班負責人', '支援單位主管', '財務覆核'] }]

    const { body } = await runRestore()

    expect(body.warnings).toEqual([])
  })

  it('checks the real chain of a preserved default, and ignores optional steps', async () => {
    templates = [{ _id: 'leave-form', name: '請假', semanticType: 'leave', default_key: 'leave' }]
    workflows = [{
      form: 'leave-form',
      steps: [
        { step_order: 1, approver_type: 'tag', approver_value: '院長室', is_required: true },
        { step_order: 2, approver_type: 'tag', approver_value: '副院長', is_required: false },
        { step_order: 3, approver_type: 'manager' },
      ],
    }]
    employees = [{ signTags: ['人資', '排班負責人', '支援單位主管', '財務覆核'] }]

    const { body } = await runRestore()

    const leaveWarnings = body.warnings.filter((item) => item.form === '請假')
    expect(leaveWarnings).toHaveLength(1)
    expect(leaveWarnings[0]).toEqual(expect.objectContaining({ type: 'tag_without_holder', step: 1, tag: '院長室' }))
    const leave = body.templates.find((item) => item.key === 'leave')
    expect(leave.requiredTags.map((item) => [item.tag, item.required])).toEqual([['院長室', true], ['副院長', false]])
  })

  it('warns about a matched form that still has no approval chain (and did not qualify for repair)', async () => {
    templates = [{ _id: 'customer-leave', name: '休假申請單', semanticType: 'leave' }]
    workflows = [{ form: 'customer-leave', steps: [] }]

    const { body } = await runRestore()

    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'empty_workflow', form: '休假申請單', formId: 'customer-leave' }),
    ]))
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('still succeeds, without tag warnings, when the holder count cannot be computed', async () => {
    mockEmployee.find.mockImplementation(() => ({ lean: async () => { throw new Error('employee collection down') } }))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const { res, body } = await runRestore()

    expect(res.status).not.toHaveBeenCalled()
    expect(body.createdCount).toBe(8)
    expect(body.warnings).toEqual([])
    expect(body.templates[0].requiredTags[0].holders).toBeNull()
    errorSpy.mockRestore()
  })

  it('treats a name collision from a concurrent restore as already existing instead of failing', async () => {
    mockFormTemplate.create.mockImplementation(async (data) => {
      if (data.name === '請假') throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      return { ...data, _id: `form-${data.name}` }
    })
    mockFormTemplate.findOne.mockImplementation(async ({ name }) => (name === '請假' ? { _id: 'raced', name: '請假', is_active: true } : null))

    const { res, body } = await runRestore()

    expect(res.status).not.toHaveBeenCalled()
    expect(body.createdCount).toBe(7)
    expect(body.preservedCount).toBe(1)
  })

  it('removes a half-built default when its fields or workflow cannot be created, then reports the failure in Chinese', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFormField.insertMany.mockRejectedValue(new Error('insert failed'))
    mockFormField.deleteMany.mockResolvedValue({})
    mockApprovalWorkflow.deleteOne.mockResolvedValue({})
    mockFormTemplate.deleteOne.mockResolvedValue({})
    const res = makeRes()

    await restoreDefaultTemplates(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: GENERIC_SERVER_ERROR })
    expect(errorSpy).toHaveBeenCalledWith('[approval-template] restore defaults failed: Error')
    errorSpy.mockRestore()
    expect(mockFormField.deleteMany).toHaveBeenCalledWith({ form: 'form-1' })
    expect(mockApprovalWorkflow.deleteOne).toHaveBeenCalledWith({ form: 'form-1' })
    expect(mockFormTemplate.deleteOne).toHaveBeenCalledWith({ _id: 'form-1' })
  })

  it('returns a failure without starting destructive cleanup (and without echoing the database message)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFormTemplate.find.mockImplementation(() => ({ lean: async () => { throw new Error('Database error') } }))
    const res = makeRes()

    await restoreDefaultTemplates(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: GENERIC_SERVER_ERROR })
    errorSpy.mockRestore()
    expect(mockFormTemplate.deleteMany).not.toHaveBeenCalled()
    expect(mockFormTemplate.create).not.toHaveBeenCalled()
  })

  it('warns, in Chinese, about a default form that is deactivated: the restore does not switch it back on', async () => {
    templates = [{ _id: 'cert-form', name: '在職證明', semanticType: 'general', default_key: 'employment_certificate', is_active: false }]
    workflows = [{ form: 'cert-form', steps: [{ step_order: 1, approver_type: 'tag', approver_value: '人資' }] }]
    employees = [{ signTags: ['人資', '排班負責人', '支援單位主管', '財務覆核'] }]

    const { res, body } = await runRestore()

    expect(res.status).not.toHaveBeenCalled()
    const inactive = body.warnings.filter((item) => item.type === 'inactive_template')
    expect(inactive).toEqual([{
      type: 'inactive_template',
      form: '在職證明',
      formId: 'cert-form',
      message: '「在職證明」目前是停用狀態，員工看不到也無法申請，請到「編輯」重新啟用。',
    }])
    // 報表本身也標出它是停用的；補齊不會偷偷替管理員重新啟用
    expect(body.templates.find((item) => item.formId === 'cert-form')).toEqual(expect.objectContaining({ isActive: false, status: 'preserved' }))
    expect(mockFormTemplate.updateOne).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ is_active: true }) }), expect.anything())
    expect(mockFormTemplate.create).not.toHaveBeenCalledWith(expect.objectContaining({ name: '在職證明' }))
  })

  it('gives no inactive warning for active defaults, including the ones it has just created', async () => {
    const { body } = await runRestore()

    expect(body.warnings.filter((item) => item.type === 'inactive_template')).toEqual([])
    expect(body.templates.every((item) => item.isActive === true)).toBe(true)
  })

  it('is idempotent: a second run creates nothing, repairs nothing and changes nothing', async () => {
    const first = await runRestore()
    // 第一輪建出的表單與流程，成為第二輪看到的資料庫
    templates = mockFormTemplate.create.mock.calls.map(([data], index) => ({ ...data, _id: `form-${index + 1}` }))
    workflows = templates.map((template) => ({ form: template._id, steps: [{ step_order: 1, approver_type: 'manager' }] }))
    mockFormTemplate.create.mockClear()
    mockApprovalWorkflow.findOneAndUpdate.mockClear()
    mockFormTemplate.updateOne.mockClear()
    mockResetLeaveFieldCache.mockClear()
    mockFormTemplate.find.mockClear()
    mockEmployee.find.mockClear()
    mockApprovalWorkflow.find.mockClear()
    mockFormTemplate.find.mockImplementation(() => ({ lean: async () => templates }))

    const secondRes = makeRes()
    await restoreDefaultTemplates(makeReq(), secondRes)
    expect(secondRes.json.mock.calls[0][0]).toEqual(expect.objectContaining({ createdCount: 0, preservedCount: 8, repairedCount: 0 }))

    expect(first.body.createdCount).toBe(8)
    expect(mockFormTemplate.create).not.toHaveBeenCalled()
    expect(mockApprovalWorkflow.findOneAndUpdate).not.toHaveBeenCalled()
    expect(mockFormTemplate.updateOne).not.toHaveBeenCalled()
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })
})

describe('ensureLeaveForm', () => {
  it('creates the default leave form (fields, chain, default_key) only when no leave form exists', async () => {
    const res = makeRes()

    await ensureLeaveForm({ user: { id: 'admin1' } }, res)

    expect(mockFormTemplate.create).toHaveBeenCalledTimes(1)
    expect(mockFormTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      name: '請假', semanticType: 'leave', semantic_type_set: true, default_key: 'leave', is_active: true,
    }))
    expect(mockFormField.insertMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: '相關證明', type_1: 'file', form: 'form-1' }),
    ]))
    expect(mockApprovalWorkflow.create).toHaveBeenCalledWith(expect.objectContaining({ form: 'form-1' }))
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ generated: true, inactive: false }))
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('returns an existing leave form as is: no duplicate, no re-added 相關證明 field, no cache reset', async () => {
    templates = [{ _id: 'leave-form', name: '請假', semanticType: 'leave', is_active: true }]
    const res = makeRes()

    await ensureLeaveForm({ user: { id: 'admin1' } }, res)

    expect(mockFormTemplate.create).not.toHaveBeenCalled()
    expect(mockFormField.create).not.toHaveBeenCalled()
    expect(mockFormField.insertMany).not.toHaveBeenCalled()
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ generated: false }))
    expect(res.json.mock.calls[0][0].form._id).toBe('leave-form')
  })

  it('does not fail with a duplicate-key error when the leave form is inactive, and says it is inactive', async () => {
    templates = [{ _id: 'leave-form', name: '請假', semanticType: 'leave', is_active: false }]
    const res = makeRes()

    await ensureLeaveForm({ user: { id: 'admin1' } }, res)

    expect(mockFormTemplate.create).not.toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ generated: false, inactive: true }))
  })

  it('does not create a second leave form after the default was renamed', async () => {
    templates = [{ _id: 'renamed', name: '休假申請', semanticType: 'general', default_key: 'leave', is_active: true }]

    await ensureLeaveForm({ user: { id: 'admin1' } }, makeRes())

    expect(mockFormTemplate.create).not.toHaveBeenCalled()
  })

  it('answers a generic Chinese 500 (no database message) when it cannot read the templates', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFormTemplate.find.mockImplementation(() => ({ lean: async () => { throw new Error('Database error') } }))
    const res = makeRes()

    await ensureLeaveForm({ user: { id: 'admin1' } }, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: GENERIC_SERVER_ERROR })
    expect(errorSpy).toHaveBeenCalledWith('[approval-template] ensure leave form failed: Error')
    expect(mockFormTemplate.create).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns only the active fields of the form', async () => {
    templates = [{ _id: 'leave-form', name: '請假', semanticType: 'leave', is_active: true }]

    await ensureLeaveForm({ user: { id: 'admin1' } }, makeRes())

    expect(mockFormField.find).toHaveBeenCalledWith({ form: 'leave-form', is_active: { $ne: false } })
  })
})
