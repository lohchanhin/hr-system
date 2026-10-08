import { jest } from '@jest/globals'

const mockFormTemplate = {
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  updateMany: jest.fn(),
}
const mockFormField = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  deleteMany: jest.fn(),
}
const mockApprovalWorkflow = {
  findOne: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn(),
}
const mockResetLeaveFieldCache = jest.fn()
const mockGetSettings = jest.fn()
const mockGetDictionaryItems = jest.fn()

let controller
let dictionaries

// 客戶在簽核流程設定建立的欄位：選項是手動輸入的休假/事假/公假，沒有 field_key
const CUSTOMER_FIELDS = [
  { _id: 'c-type', form: 'form9', label: '假別類別 (C12)', type_1: 'select', options: ['休假', '事假', '公假'], order: 1 },
  { _id: 'c-start', form: 'form9', label: '日期(起)', type_1: 'date', order: 2 },
  { _id: 'c-days', form: 'form9', label: '天數', type_1: 'number', order: 3 },
]
const DICTIONARY_OPTIONS = [
  { label: '特休假', value: '特休假' },
  { label: '病假', value: '病假' },
  { label: '事假', value: '事假' },
]

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
    resetLeaveFieldCache: mockResetLeaveFieldCache,
  }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    getDictionaryItems: mockGetDictionaryItems,
  }))
  controller = await import('../src/controllers/approvalTemplateController.js')
})

beforeEach(() => {
  dictionaries = {
    C12: [{ name: '特休假', code: '特休假' }, { name: '病假', code: '病假' }, { name: '事假', code: '事假' }],
  }
  for (const model of [mockFormTemplate, mockFormField, mockApprovalWorkflow]) {
    Object.values(model).forEach((fn) => fn.mockReset())
  }
  mockResetLeaveFieldCache.mockReset()
  mockGetSettings.mockReset()
  mockGetDictionaryItems.mockReset()
  mockGetSettings.mockImplementation(async () => ({ itemSettings: { ...dictionaries } }))
  mockGetDictionaryItems.mockImplementation(async (key) => dictionaries[key] || [])
  mockFormTemplate.create.mockImplementation(async (data) => ({ ...data, _id: 'new-form' }))
  mockApprovalWorkflow.create.mockResolvedValue({})
})

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() }
}

describe('inferSemanticType', () => {
  it.each([
    ['休假/事假/公假申請單（人事類-出勤標準）', 'leave'],
    ['請假', 'leave'],
    ['事假申請', 'leave'],
    ['病假單', 'leave'],
    ['特休申請', 'leave'],
    ['公假', 'leave'],
    ['外出假單', 'leave'],
    ['Leave Request', 'leave'],
    ['加班申請', 'overtime'],
    ['Overtime', 'overtime'],
    ['加班補休請假', 'overtime'],
    ['特休保留', 'general'],
    ['在職證明', 'general'],
    ['病假證明申請', 'general'],
    ['特休結算', 'general'],
    ['支援申請', 'general'],
    ['獎金申請', 'general'],
    ['', 'general'],
    [undefined, 'general'],
  ])('%s -> %s', (name, expected) => {
    expect(controller.inferSemanticType(name)).toBe(expected)
  })
})

describe('createFormTemplate semanticType', () => {
  it('infers leave from the customer form name, which has no 請假 in it', async () => {
    const res = makeRes()

    await controller.createFormTemplate({
      user: { id: 'admin1' },
      body: { name: '休假/事假/公假申請單（人事類-出勤標準）', category: '人事類' },
    }, res)

    expect(mockFormTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ semanticType: 'leave' }))
    expect(res.status).toHaveBeenCalledWith(201)
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('infers overtime and general from the name when no semanticType is given', async () => {
    await controller.createFormTemplate({ body: { name: '加班申請單' } }, makeRes())
    await controller.createFormTemplate({ body: { name: '採購申請' } }, makeRes())

    expect(mockFormTemplate.create.mock.calls[0][0].semanticType).toBe('overtime')
    expect(mockFormTemplate.create.mock.calls[1][0].semanticType).toBe('general')
  })

  it('lets an explicit semanticType win over the name inference', async () => {
    await controller.createFormTemplate({ body: { name: '請假申請', semanticType: 'general' } }, makeRes())
    await controller.createFormTemplate({ body: { name: '出勤補登', semanticType: 'leave' } }, makeRes())

    expect(mockFormTemplate.create.mock.calls[0][0].semanticType).toBe('general')
    expect(mockFormTemplate.create.mock.calls[1][0].semanticType).toBe('leave')
  })

  it('treats an empty semanticType as not provided', async () => {
    await controller.createFormTemplate({ body: { name: '事假單', semanticType: '' } }, makeRes())

    expect(mockFormTemplate.create.mock.calls[0][0].semanticType).toBe('leave')
  })

  it('rejects an unknown semanticType without creating anything', async () => {
    const res = makeRes()

    await controller.createFormTemplate({ body: { name: '請假申請', semanticType: 'payroll' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid semanticType' })
    expect(mockFormTemplate.create).not.toHaveBeenCalled()
  })
})

describe('updateFormTemplate semanticType', () => {
  it('saves the chosen semanticType and clears the leave field cache', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({ _id: 'form9', semanticType: 'leave' })
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: 'form9' }, body: { name: '休假申請單', semanticType: 'leave' } }, res)

    expect(mockFormTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      'form9',
      { $set: expect.objectContaining({ name: '休假申請單', semanticType: 'leave' }) },
      { new: true },
    )
    expect(res.json).toHaveBeenCalledWith({ _id: 'form9', semanticType: 'leave' })
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('does not change the semanticType when none is sent (no name based re-inference)', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({ _id: 'form9' })

    await controller.updateFormTemplate({ params: { id: 'form9' }, body: { name: '請假申請' } }, makeRes())

    const update = mockFormTemplate.findByIdAndUpdate.mock.calls[0][1]
    expect(update.$set.semanticType).toBeUndefined()
  })

  it('rejects an unknown semanticType before touching the database', async () => {
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: 'form9' }, body: { semanticType: 'bogus' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid semanticType' })
    expect(mockFormTemplate.findByIdAndUpdate).not.toHaveBeenCalled()
  })
})

describe('migrateLeaveFormSemantics', () => {
  // 以記憶體資料模擬 FormTemplate 集合，驗證篩選條件與重複執行
  let store

  function install(initial) {
    store = initial.map((form) => ({ ...form }))
    const isGeneral = (form) => form.semanticType === 'general' || form.semanticType === null || form.semanticType === undefined
    mockFormTemplate.find.mockImplementation((filter) => {
      expect(filter).toEqual({ semanticType: { $in: ['general', null] } })
      return { lean: async () => store.filter(isGeneral).map(({ _id, name, semanticType }) => ({ _id, name, semanticType })) }
    })
    mockFormTemplate.updateMany.mockImplementation(async (filter, update, options) => {
      expect(update).toEqual({ $set: { semanticType: 'leave' } })
      expect(options).toEqual({ timestamps: false })
      expect(filter.semanticType).toEqual({ $in: ['general', null] })
      let modifiedCount = 0
      store.forEach((form) => {
        if (filter._id.$in.includes(form._id) && isGeneral(form)) {
          form.semanticType = 'leave'
          modifiedCount += 1
        }
      })
      return { modifiedCount }
    })
  }

  it('flags general forms with leave-like names, leaves everything else alone, and is idempotent', async () => {
    install([
      { _id: 'a', name: '休假/事假/公假申請單（人事類-出勤標準）', semanticType: 'general' },
      { _id: 'b', name: '請假', semanticType: undefined },
      { _id: 'c', name: '病假單', semanticType: 'general' },
      { _id: 'd', name: '加班申請', semanticType: 'general' },
      { _id: 'e', name: '特休保留', semanticType: 'general' },
      { _id: 'f', name: '在職證明', semanticType: 'general' },
      { _id: 'g', name: '特休申請', semanticType: 'overtime' },
      { _id: 'h', name: '事假申請', semanticType: 'business_trip' },
      { _id: 'i', name: '公假', semanticType: 'leave' },
    ])

    const first = await controller.migrateLeaveFormSemantics()
    const second = await controller.migrateLeaveFormSemantics()

    expect(first).toBe(3)
    expect(second).toBe(0)
    expect(mockFormTemplate.updateMany).toHaveBeenCalledTimes(1)
    const byId = Object.fromEntries(store.map((form) => [form._id, form.semanticType]))
    expect(byId).toEqual({
      a: 'leave', b: 'leave', c: 'leave',
      d: 'general', e: 'general', f: 'general',
      g: 'overtime', h: 'business_trip', i: 'leave',
    })
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('does nothing (and does not clear the cache) when no form needs fixing', async () => {
    install([{ _id: 'a', name: '採購申請', semanticType: 'general' }])

    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
    expect(mockFormTemplate.updateMany).not.toHaveBeenCalled()
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })
})

describe('endpoints that hand form fields to the client', () => {
  it('getFormTemplate returns the dictionary options for the customer field, with dictionaryKey and optionsSource', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form9', name: '休假/事假/公假申請單' })
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })
    mockApprovalWorkflow.findOne.mockResolvedValue({ _id: 'wf' })
    const res = makeRes()

    await controller.getFormTemplate({ params: { id: 'form9' } }, res)

    const body = res.json.mock.calls[0][0]
    expect(body.fields[0]).toMatchObject({
      _id: 'c-type', label: '假別類別 (C12)', options: DICTIONARY_OPTIONS, dictionaryKey: 'C12', optionsSource: 'dictionary',
    })
    expect(body.fields[1]).toMatchObject({ _id: 'c-start', dictionaryKey: null, optionsSource: 'own' })
    expect(body.fields[2]).toMatchObject({ _id: 'c-days', dictionaryKey: null, optionsSource: 'own' })
    expect(CUSTOMER_FIELDS[0].options).toEqual(['休假', '事假', '公假'])
  })

  it('listFields returns resolved fields, including inactive ones', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })
    const res = makeRes()

    await controller.listFields({ params: { formId: 'form9' } }, res)

    expect(mockFormField.find).toHaveBeenCalledWith({ form: 'form9' })
    const fields = res.json.mock.calls[0][0]
    expect(fields).toHaveLength(3)
    expect(fields[0].options).toEqual(DICTIONARY_OPTIONS)
    expect(fields[0].dictionaryKey).toBe('C12')
    expect(fields[0].optionsSource).toBe('dictionary')
  })

  it('listFields follows dictionary changes without any change to the form', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })
    const first = makeRes()
    const second = makeRes()

    await controller.listFields({ params: { formId: 'form9' } }, first)
    dictionaries.C12 = [{ name: '婚假', code: '婚假' }]
    await controller.listFields({ params: { formId: 'form9' } }, second)

    expect(first.json.mock.calls[0][0][0].options).toEqual(DICTIONARY_OPTIONS)
    expect(second.json.mock.calls[0][0][0].options).toEqual([{ label: '婚假', value: '婚假' }])
  })

  it('ensureLeaveForm returns resolved fields', async () => {
    mockFormTemplate.findOne.mockResolvedValue({ _id: 'form9', name: '請假' })
    mockFormField.findOne.mockResolvedValue({ _id: 'proof' })
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })
    mockApprovalWorkflow.findOne.mockResolvedValue({ _id: 'wf' })
    const res = makeRes()

    await controller.ensureLeaveForm({ user: { id: 'admin1' } }, res)

    const body = res.json.mock.calls[0][0]
    expect(body.generated).toBe(false)
    expect(body.fields[0]).toMatchObject({ dictionaryKey: 'C12', optionsSource: 'dictionary', options: DICTIONARY_OPTIONS })
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })
})

describe('addField', () => {
  const baseBody = { label: '假別類別 (C12)', type_1: 'select', options: ['休假', '事假', '公假'], required: true, order: 1 }

  beforeEach(() => {
    mockFormTemplate.findById.mockResolvedValue({ _id: 'form9' })
    mockFormField.create.mockImplementation(async (data) => ({ ...data, _id: 'new-field' }))
  })

  it('persists field_key and keeps the typed options as the fallback snapshot', async () => {
    const res = makeRes()

    await controller.addField({ params: { formId: 'form9' }, body: { ...baseBody, field_key: 'C12' } }, res)

    expect(mockFormField.create).toHaveBeenCalledWith(expect.objectContaining({
      form: 'form9', label: '假別類別 (C12)', type_1: 'select', options: ['休假', '事假', '公假'], field_key: 'C12',
    }))
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0]).toMatchObject({
      _id: 'new-field', field_key: 'C12', dictionaryKey: 'C12', optionsSource: 'dictionary', options: DICTIONARY_OPTIONS,
    })
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('stores an empty string when the admin chose manual input', async () => {
    const res = makeRes()

    await controller.addField({ params: { formId: 'form9' }, body: { ...baseBody, field_key: '' } }, res)

    expect(mockFormField.create.mock.calls[0][0].field_key).toBe('')
    expect(res.json.mock.calls[0][0]).toMatchObject({ dictionaryKey: null, optionsSource: 'own', options: ['休假', '事假', '公假'] })
  })

  it('does not send field_key to the model when the request has none', async () => {
    await controller.addField({ params: { formId: 'form9' }, body: baseBody }, makeRes())

    expect('field_key' in mockFormField.create.mock.calls[0][0]).toBe(false)
  })

  it('rejects an unsafe field_key', async () => {
    const res = makeRes()

    await controller.addField({ params: { formId: 'form9' }, body: { ...baseBody, field_key: 'C12; drop' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid field_key' })
    expect(mockFormField.create).not.toHaveBeenCalled()
  })
})

describe('updateField', () => {
  beforeEach(() => {
    mockFormField.findByIdAndUpdate.mockImplementation(async (id, update) => ({ _id: id, form: 'form9', ...update.$set }))
  })

  it('persists field_key with the other attributes', async () => {
    const res = makeRes()

    await controller.updateField({
      params: { formId: 'form9', fieldId: 'c-type' },
      body: { label: '假別類別 (C12)', type_1: 'select', options: ['休假'], field_key: 'C12' },
    }, res)

    expect(mockFormField.findByIdAndUpdate).toHaveBeenCalledWith(
      'c-type',
      { $set: expect.objectContaining({ label: '假別類別 (C12)', options: ['休假'], field_key: 'C12' }) },
      { new: true },
    )
    expect(res.json.mock.calls[0][0]).toMatchObject({ field_key: 'C12', dictionaryKey: 'C12', optionsSource: 'dictionary', options: DICTIONARY_OPTIONS })
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('keeps the existing link when the request does not mention field_key', async () => {
    await controller.updateField({ params: { fieldId: 'c-type' }, body: { label: '假別類別 (C12)', type_1: 'select' } }, makeRes())

    expect('field_key' in mockFormField.findByIdAndUpdate.mock.calls[0][1].$set).toBe(false)
  })

  it('unlinks with an empty string or null by storing an empty string', async () => {
    await controller.updateField({ params: { fieldId: 'c-type' }, body: { type_1: 'select', field_key: '' } }, makeRes())
    await controller.updateField({ params: { fieldId: 'c-type' }, body: { type_1: 'select', field_key: null } }, makeRes())

    expect(mockFormField.findByIdAndUpdate.mock.calls[0][1].$set.field_key).toBe('')
    expect(mockFormField.findByIdAndUpdate.mock.calls[1][1].$set.field_key).toBe('')
  })

  it('rejects a field_key that is not a short safe string', async () => {
    const res = makeRes()

    await controller.updateField({ params: { fieldId: 'c-type' }, body: { field_key: { $gt: '' } } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid field_key' })
    expect(mockFormField.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown field', async () => {
    mockFormField.findByIdAndUpdate.mockResolvedValue(null)
    const res = makeRes()

    await controller.updateField({ params: { fieldId: 'missing' }, body: { label: 'x' } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })
})

describe('leave field cache invalidation', () => {
  it('is cleared when a form or field is deleted', async () => {
    mockFormTemplate.findByIdAndDelete.mockResolvedValue({ _id: 'form9' })
    mockFormField.deleteMany.mockResolvedValue({})
    mockApprovalWorkflow.deleteOne.mockResolvedValue({})
    mockFormField.findByIdAndDelete.mockResolvedValue({ _id: 'c-type' })

    await controller.deleteFormTemplate({ params: { id: 'form9' } }, makeRes())
    await controller.deleteField({ params: { fieldId: 'c-type' } }, makeRes())

    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(2)
  })

  it('is not cleared when nothing was deleted', async () => {
    mockFormTemplate.findByIdAndDelete.mockResolvedValue(null)
    mockFormField.findByIdAndDelete.mockResolvedValue(null)

    await controller.deleteFormTemplate({ params: { id: 'missing' } }, makeRes())
    await controller.deleteField({ params: { fieldId: 'missing' } }, makeRes())

    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })
})

describe('restoreDefaultTemplates semanticType', () => {
  it('gives restored defaults the semanticType inferred from their name', async () => {
    mockFormTemplate.findOne.mockResolvedValue(null)
    mockFormField.insertMany = jest.fn().mockResolvedValue([])
    let counter = 0
    mockFormTemplate.create.mockImplementation(async (data) => ({ ...data, _id: `form-${++counter}` }))

    await controller.restoreDefaultTemplates({ user: { id: 'admin1' } }, makeRes())

    const bySemantic = Object.fromEntries(mockFormTemplate.create.mock.calls.map(([data]) => [data.name, data.semanticType]))
    expect(bySemantic['請假']).toBe('leave')
    expect(bySemantic['加班申請']).toBe('overtime')
    expect(bySemantic['特休保留']).toBe('general')
    expect(bySemantic['在職證明']).toBe('general')
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })
})
