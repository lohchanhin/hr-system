import { jest } from '@jest/globals'

const mockFormTemplate = {
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
  updateMany: jest.fn(),
  updateOne: jest.fn(),
}
const mockFormField = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  deleteMany: jest.fn(),
}
const mockApprovalWorkflow = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn(),
}
const mockApprovalRequest = { countDocuments: jest.fn() }
const mockEmployee = { find: jest.fn() }
const mockResetLeaveFieldCache = jest.fn()
const mockGetSettings = jest.fn()
const mockGetDictionaryItems = jest.fn()

let controller
let dictionaries

// 客戶在簽核流程設定建立的欄位：選項是手動輸入的休假/事假/公假，沒有 field_key
const CUSTOMER_FIELDS = [
  { _id: 'c-type', form: '000000000000000000000f09', label: '假別類別 (C12)', type_1: 'select', options: ['休假', '事假', '公假'], order: 1 },
  { _id: 'c-start', form: '000000000000000000000f09', label: '日期(起)', type_1: 'date', order: 2 },
  { _id: 'c-days', form: '000000000000000000000f09', label: '天數', type_1: 'number', order: 3 },
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
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
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
  for (const model of [mockFormTemplate, mockFormField, mockApprovalWorkflow, mockApprovalRequest, mockEmployee]) {
    Object.values(model).forEach((fn) => fn.mockReset())
  }
  mockApprovalRequest.countDocuments.mockResolvedValue(0)
  mockEmployee.find.mockImplementation(() => ({ lean: async () => [] }))
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
    ['(全)假別申請單', 'leave'],
    ['假別申請單', 'leave'],
    ['Leave Request', 'leave'],
    ['加班申請', 'overtime'],
    ['Overtime', 'overtime'],
    ['加班補休請假', 'overtime'],
    ['特休保留', 'general'],
    ['在職證明', 'general'],
    ['病假證明申請', 'general'],
    ['特休結算', 'general'],
    ['銷假單', 'general'],
    ['公假出差申請', 'general'],
    ['出差(公假)', 'general'],
    ['出差申請單', 'general'],
    ['出差加班申請', 'overtime'],
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

  it('marks the semanticType as written, whether it was chosen or inferred from the name', async () => {
    await controller.createFormTemplate({ body: { name: '採購申請', semanticType: 'general' } }, makeRes())
    await controller.createFormTemplate({ body: { name: '事假單' } }, makeRes())

    expect(mockFormTemplate.create.mock.calls[0][0]).toEqual(expect.objectContaining({ semanticType: 'general', semantic_type_set: true }))
    expect(mockFormTemplate.create.mock.calls[1][0]).toEqual(expect.objectContaining({ semanticType: 'leave', semantic_type_set: true }))
  })

  it('trims the name and rejects a blank one with a Chinese message', async () => {
    const blank = makeRes()
    await controller.createFormTemplate({ body: { name: '   ' } }, blank)
    expect(blank.status).toHaveBeenCalledWith(400)
    expect(blank.json).toHaveBeenCalledWith({ error: '請輸入表單名稱' })
    expect(mockFormTemplate.create).not.toHaveBeenCalled()

    await controller.createFormTemplate({ body: { name: '  補休申請 ' } }, makeRes())
    expect(mockFormTemplate.create.mock.calls[0][0].name).toBe('補休申請')
  })

  it('answers a duplicate name with a Chinese 409 instead of the raw E11000 text', async () => {
    mockFormTemplate.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key error collection'), { code: 11000 }))
    const res = makeRes()

    await controller.createFormTemplate({ body: { name: '請假' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: '已經有同名的表單樣板，請換一個名稱' })
    expect(mockApprovalWorkflow.create).not.toHaveBeenCalled()
  })

  it('creates the empty default workflow with the default policy', async () => {
    await controller.createFormTemplate({ body: { name: '補休申請' } }, makeRes())

    expect(mockApprovalWorkflow.create).toHaveBeenCalledWith({
      form: 'new-form',
      steps: [],
      policy: { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' },
    })
  })

  it('removes the template again when its workflow cannot be created', async () => {
    mockApprovalWorkflow.create.mockRejectedValue(new Error('workflow failed'))
    mockFormTemplate.deleteOne.mockResolvedValue({})
    const res = makeRes()

    await controller.createFormTemplate({ body: { name: '補休申請' } }, res)

    expect(mockFormTemplate.deleteOne).toHaveBeenCalledWith({ _id: 'new-form' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'workflow failed' })
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
    expect(res.json).toHaveBeenCalledWith({ error: '表單性質不正確' })
    expect(mockFormTemplate.create).not.toHaveBeenCalled()
  })
})

describe('updateFormTemplate semanticType', () => {
  it('saves the chosen semanticType and clears the leave field cache', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({ _id: '000000000000000000000f09', semanticType: 'leave' })
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { name: '休假申請單', semanticType: 'leave' } }, res)

    expect(mockFormTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      '000000000000000000000f09',
      { $set: expect.objectContaining({ name: '休假申請單', semanticType: 'leave', semantic_type_set: true }) },
      { new: true, runValidators: true },
    )
    expect(res.json).toHaveBeenCalledWith({ _id: '000000000000000000000f09', semanticType: 'leave' })
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('marks an explicit 一般 as written so a restart never turns the form back into a leave form', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({ _id: '000000000000000000000f09', semanticType: 'general' })

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { name: '請假申請', semanticType: 'general' } }, makeRes())

    const update = mockFormTemplate.findByIdAndUpdate.mock.calls[0][1]
    expect(update.$set).toEqual(expect.objectContaining({ semanticType: 'general', semantic_type_set: true }))
  })

  it('only sets the fields that were sent', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({ _id: '000000000000000000000f09' })

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { is_active: false } }, makeRes())

    expect(mockFormTemplate.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $set: { is_active: false } })
  })

  it('trims the name and refuses to blank it', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({ _id: '000000000000000000000f09' })
    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { name: '請假 ' } }, makeRes())
    expect(mockFormTemplate.findByIdAndUpdate.mock.calls[0][1].$set.name).toBe('請假')

    mockFormTemplate.findByIdAndUpdate.mockClear()
    const res = makeRes()
    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { name: '  ' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '表單名稱不可空白' })
    expect(mockFormTemplate.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('rejects an is_active value that is not a boolean', async () => {
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { is_active: 'maybe' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockFormTemplate.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('answers a duplicate name with a Chinese 409', async () => {
    mockFormTemplate.findByIdAndUpdate.mockRejectedValue(Object.assign(new Error('E11000 duplicate key error ... index: name_1_owner_org_id_1'), { code: 11000 }))
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { name: '請假' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: '已經有同名的表單樣板，請換一個名稱' })
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })

  it('maps a validator failure to a Chinese 400', async () => {
    mockFormTemplate.findByIdAndUpdate.mockRejectedValue(Object.assign(new Error('x'), {
      name: 'ValidationError',
      errors: { name: { path: 'name', kind: 'maxlength' } },
    }))
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { name: 'x'.repeat(200) } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '資料格式不正確：「名稱」太長' })
  })

  it('answers 404 for an unknown template', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue(null)
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: 'nope' }, body: { name: 'x' } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })

  it('does not change the semanticType when none is sent (no name based re-inference)', async () => {
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({ _id: '000000000000000000000f09' })

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { name: '請假申請' } }, makeRes())

    const update = mockFormTemplate.findByIdAndUpdate.mock.calls[0][1]
    expect(update.$set.semanticType).toBeUndefined()
  })

  it('rejects an unknown semanticType before touching the database', async () => {
    const res = makeRes()

    await controller.updateFormTemplate({ params: { id: '000000000000000000000f09' }, body: { semanticType: 'bogus' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '表單性質不正確' })
    expect(mockFormTemplate.findByIdAndUpdate).not.toHaveBeenCalled()
  })
})

describe('migrateLeaveKeywordForms', () => {
  let store

  function install(initial) {
    store = initial.map((form) => ({ ...form }))
    const pending = (form) => form.leave_keyword_migrated !== true
    mockFormTemplate.find.mockImplementation((filter) => {
      expect(filter).toEqual({ leave_keyword_migrated: { $ne: true } })
      return { lean: async () => store.filter(pending).map(({ _id, name, semanticType }) => ({ _id, name, semanticType })) }
    })
    mockFormTemplate.updateMany.mockImplementation(async (filter, update, options) => {
      expect(options).toEqual({ timestamps: false })
      let modifiedCount = 0
      store.forEach((form) => {
        if (!filter._id.$in.includes(form._id) || !pending(form)) return
        if (filter.semanticType && !(form.semanticType === 'general' || form.semanticType == null)) return
        Object.assign(form, update.$set)
        modifiedCount += 1
      })
      return { modifiedCount }
    })
  }

  const byId = () => Object.fromEntries(store.map((form) => [form._id, form.semanticType]))

  it('turns a general form named like (全)假別申請單 into a leave form once, and marks every form it looked at', async () => {
    install([
      { _id: 'a', name: '(全)假別申請單', semanticType: 'general', semantic_type_set: true },
      { _id: 'b', name: '假別申請', semanticType: undefined, semantic_type_set: true },
      { _id: 'c', name: '在職證明', semanticType: 'general', semantic_type_set: true },
      { _id: 'd', name: '請假', semanticType: 'general', semantic_type_set: true }, // 沒有「假別」二字：不歸這次處理
      { _id: 'e', name: '假別證明', semanticType: 'general', semantic_type_set: true }, // 證明不是請假申請
      { _id: 'f', name: '假別申請', semanticType: 'overtime', semantic_type_set: true },
    ])

    expect(await controller.migrateLeaveKeywordForms()).toBe(2)
    expect(byId()).toEqual({ a: 'leave', b: 'leave', c: 'general', d: 'general', e: 'general', f: 'overtime' })
    expect(store.every((form) => form.leave_keyword_migrated === true)).toBe(true)
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('does not touch a form again once it was processed (an admin choice of 一般 sticks across restarts)', async () => {
    install([{ _id: 'a', name: '(全)假別申請單', semanticType: 'general' }])
    expect(await controller.migrateLeaveKeywordForms()).toBe(1)

    store[0].semanticType = 'general' // 管理員在介面特地改回「一般」
    mockFormTemplate.updateMany.mockClear()
    expect(await controller.migrateLeaveKeywordForms()).toBe(0)
    expect(mockFormTemplate.updateMany).not.toHaveBeenCalled()
    expect(byId().a).toBe('general')
  })
})

describe('migrateLeaveFormSemantics', () => {
  // 以記憶體資料模擬 FormTemplate 集合，驗證篩選條件、標記與重複執行
  let store

  function install(initial) {
    store = initial.map((form) => ({ ...form }))
    const unmarked = (form) => form.semantic_type_set !== true
    const isGeneral = (form) => form.semanticType === 'general' || form.semanticType === null || form.semanticType === undefined
    mockFormTemplate.find.mockImplementation((filter) => {
      expect(filter).toEqual({ semantic_type_set: { $ne: true } })
      return { lean: async () => store.filter(unmarked).map(({ _id, name, semanticType }) => ({ _id, name, semanticType })) }
    })
    mockFormTemplate.updateMany.mockImplementation(async (filter, update, options) => {
      expect(options).toEqual({ timestamps: false })
      expect(filter.semantic_type_set).toEqual({ $ne: true })
      let modifiedCount = 0
      store.forEach((form) => {
        if (!filter._id.$in.includes(form._id) || !unmarked(form)) return
        if (filter.semanticType && !isGeneral(form)) return
        Object.assign(form, update.$set)
        modifiedCount += 1
      })
      return { modifiedCount }
    })
  }

  const byId = () => Object.fromEntries(store.map((form) => [form._id, form.semanticType]))

  it('flags general forms with leave-like (or overtime-like) names, leaves everything else alone, and is idempotent', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
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

    expect(first).toBe(3) // 回傳的是改成請假的筆數；加班單只記在日誌
    expect(second).toBe(0)
    // 第一輪：改成請假、改成加班、補標記各一次；第二輪沒有任何寫入
    expect(mockFormTemplate.updateMany).toHaveBeenCalledTimes(3)
    expect(byId()).toEqual({
      a: 'leave', b: 'leave', c: 'leave',
      d: 'overtime', e: 'general', f: 'general',
      g: 'overtime', h: 'business_trip', i: 'leave',
    })
    expect(store.every((form) => form.semantic_type_set === true)).toBe(true)
    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(1)
  })

  it('migrates an old general form named like 加班 to overtime exactly once, with the same marker rules as leave', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    install([
      { _id: 'ot-1', name: '加班申請單（人事類）', semanticType: 'general' },
      { _id: 'ot-2', name: 'Overtime request', semanticType: undefined },
      { _id: 'ot-3', name: '出差加班申請', semanticType: 'general' },
      { _id: 'ot-both', name: '加班補休請假', semanticType: 'general' }, // 名稱兩種都像：和 inferSemanticType 一致，加班優先
      { _id: 'ot-chosen', name: '加班費申請', semanticType: 'general', semantic_type_set: true }, // 管理員明確選了「一般」
      { _id: 'ot-trip', name: '加班出差', semanticType: 'business_trip' },
    ])

    expect(await controller.migrateLeaveFormSemantics()).toBe(0) // 沒有請假單被改
    expect(byId()).toEqual({
      'ot-1': 'overtime', 'ot-2': 'overtime', 'ot-3': 'overtime', 'ot-both': 'overtime',
      'ot-chosen': 'general', 'ot-trip': 'business_trip',
    })
    expect(store.filter((form) => form.semanticType === 'overtime').every((form) => form.semantic_type_set === true)).toBe(true)
    expect(logSpy).toHaveBeenCalledWith('Migrated semantic types for 4 overtime forms')
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled() // 加班單不在請假欄位快取裡

    // 再執行不會有任何變動，管理員之後改回「一般」也不會被改回去
    mockFormTemplate.updateMany.mockClear()
    store.find((form) => form._id === 'ot-1').semanticType = 'general'
    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
    expect(mockFormTemplate.updateMany).not.toHaveBeenCalled()
    expect(byId()['ot-1']).toBe('general')
  })

  it('only touches rows whose filter still says general or unset (a form edited meanwhile keeps the admin choice)', async () => {
    install([{ _id: 'raced', name: '加班申請', semanticType: 'general' }])
    mockFormTemplate.updateMany.mockImplementationOnce(async (filter) => {
      expect(filter).toEqual({
        _id: { $in: ['raced'] },
        semantic_type_set: { $ne: true },
        semanticType: { $in: ['general', null] },
      })
      return { modifiedCount: 0 } // 剛好被管理員改過，條件不再符合
    })
    jest.spyOn(console, 'log').mockImplementation(() => {})

    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
  })

  it('never infers 銷假單 / 出差 style names as leave forms, but still marks them', async () => {
    install([
      { _id: 'cancel', name: '銷假單', semanticType: 'general' },
      { _id: 'trip-1', name: '公假出差申請', semanticType: 'general' },
      { _id: 'trip-2', name: '出差(公假)', semanticType: 'general' },
      { _id: 'trip-3', name: '出差申請單', semanticType: undefined },
    ])

    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
    expect(await controller.migrateLeaveFormSemantics()).toBe(0)

    expect(byId()).toEqual({ cancel: 'general', 'trip-1': 'general', 'trip-2': 'general', 'trip-3': undefined })
    expect(store.every((form) => form.semantic_type_set === true)).toBe(true)
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })

  it('keeps an explicit 一般 across restarts (the marker stops the second migration from touching it)', async () => {
    install([{ _id: 'legacy', name: '請假申請', semanticType: 'general' }])

    expect(await controller.migrateLeaveFormSemantics()).toBe(1) // 舊資料：第一次升級補成請假
    expect(byId().legacy).toBe('leave')

    // 管理員在介面上明確改成「一般」（updateFormTemplate 會同時寫入標記）
    store[0].semanticType = 'general'
    store[0].semantic_type_set = true

    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
    expect(byId().legacy).toBe('general')
  })

  it('does not touch forms created or edited after this release (marker already true)', async () => {
    install([
      { _id: 'new-general', name: '請假申請', semanticType: 'general', semantic_type_set: true },
      { _id: 'new-leave', name: '採購申請', semanticType: 'leave', semantic_type_set: true },
    ])

    expect(await controller.migrateLeaveFormSemantics()).toBe(0)

    expect(byId()).toEqual({ 'new-general': 'general', 'new-leave': 'leave' })
    expect(mockFormTemplate.updateMany).not.toHaveBeenCalled()
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })

  it('only marks (and does not clear the cache) when no form needs flipping', async () => {
    install([{ _id: 'a', name: '採購申請', semanticType: 'general' }])

    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
    expect(mockFormTemplate.updateMany).toHaveBeenCalledTimes(1)
    expect(mockFormTemplate.updateMany.mock.calls[0][1]).toEqual({ $set: { semantic_type_set: true } })
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })

  it('does nothing at all when every form is already marked', async () => {
    install([])

    expect(await controller.migrateLeaveFormSemantics()).toBe(0)
    expect(mockFormTemplate.updateMany).not.toHaveBeenCalled()
  })
})

describe('endpoints that hand form fields to the client', () => {
  it('getFormTemplate returns the dictionary options for the customer field, with dictionaryKey and optionsSource', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: '000000000000000000000f09', name: '休假/事假/公假申請單' })
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })
    mockApprovalWorkflow.findOne.mockResolvedValue({ _id: 'wf' })
    const res = makeRes()

    await controller.getFormTemplate({ params: { id: '000000000000000000000f09' } }, res)

    const body = res.json.mock.calls[0][0]
    expect(body.fields[0]).toMatchObject({
      _id: 'c-type', label: '假別類別 (C12)', options: DICTIONARY_OPTIONS, dictionaryKey: 'C12', optionsSource: 'dictionary',
    })
    expect(body.fields[1]).toMatchObject({ _id: 'c-start', dictionaryKey: null, optionsSource: 'own' })
    expect(body.fields[2]).toMatchObject({ _id: 'c-days', dictionaryKey: null, optionsSource: 'own' })
    expect(CUSTOMER_FIELDS[0].options).toEqual(['休假', '事假', '公假'])
    // 填寫申請用的欄位：停用的欄位不會出現
    expect(mockFormField.find).toHaveBeenCalledWith({ form: '000000000000000000000f09', is_active: { $ne: false } })
  })

  it('listFields returns resolved fields, including inactive ones, to an admin (the designer needs them)', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })
    const res = makeRes()

    await controller.listFields({ params: { formId: '000000000000000000000f09' }, user: { id: 'admin1', role: 'admin' }, query: {} }, res)

    expect(mockFormField.find).toHaveBeenCalledWith({ form: '000000000000000000000f09' })
    const fields = res.json.mock.calls[0][0]
    expect(fields).toHaveLength(3)
    expect(fields[0].options).toEqual(DICTIONARY_OPTIONS)
    expect(fields[0].dictionaryKey).toBe('C12')
    expect(fields[0].optionsSource).toBe('dictionary')
  })

  it.each(['employee', 'supervisor'])('listFields hides inactive fields from a %s (the apply page)', async (role) => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })

    await controller.listFields({ params: { formId: '000000000000000000000f09' }, user: { id: 'u1', role }, query: {} }, makeRes())

    expect(mockFormField.find).toHaveBeenCalledWith({ form: '000000000000000000000f09', is_active: { $ne: false } })
  })

  it('listFields without a signed-in role is treated like an employee', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })

    await controller.listFields({ params: { formId: '000000000000000000000f09' } }, makeRes())

    expect(mockFormField.find).toHaveBeenCalledWith({ form: '000000000000000000000f09', is_active: { $ne: false } })
  })

  it('listFields lets an admin ask for only the active (or only the inactive) fields', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })
    const admin = { id: 'admin1', role: 'admin' }

    await controller.listFields({ params: { formId: '000000000000000000000f09' }, user: admin, query: { is_active: 'true' } }, makeRes())
    await controller.listFields({ params: { formId: '000000000000000000000f09' }, user: admin, query: { is_active: 'false' } }, makeRes())

    expect(mockFormField.find).toHaveBeenNthCalledWith(1, { form: '000000000000000000000f09', is_active: { $ne: false } })
    expect(mockFormField.find).toHaveBeenNthCalledWith(2, { form: '000000000000000000000f09', is_active: false })
  })

  it('an employee cannot widen the field list with ?is_active=false', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) })

    await controller.listFields({ params: { formId: '000000000000000000000f09' }, user: { id: 'u1', role: 'employee' }, query: { is_active: 'false' } }, makeRes())

    expect(mockFormField.find).toHaveBeenCalledWith({ form: '000000000000000000000f09', is_active: { $ne: false } })
  })

  it('listFields follows dictionary changes without any change to the form', async () => {
    mockFormField.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(CUSTOMER_FIELDS) })
    const first = makeRes()
    const second = makeRes()

    await controller.listFields({ params: { formId: '000000000000000000000f09' }, user: { role: 'admin' }, query: {} }, first)
    dictionaries.C12 = [{ name: '婚假', code: '婚假' }]
    await controller.listFields({ params: { formId: '000000000000000000000f09' }, user: { role: 'admin' }, query: {} }, second)

    expect(first.json.mock.calls[0][0][0].options).toEqual(DICTIONARY_OPTIONS)
    expect(second.json.mock.calls[0][0][0].options).toEqual([{ label: '婚假', value: '婚假' }])
  })

  it('ensureLeaveForm returns resolved fields', async () => {
    mockFormTemplate.find.mockReturnValue({ lean: async () => [{ _id: '000000000000000000000f09', name: '請假', semanticType: 'leave', is_active: true }] })
    mockFormTemplate.findById.mockResolvedValue({ _id: '000000000000000000000f09', name: '請假', is_active: true })
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
    mockFormTemplate.findById.mockResolvedValue({ _id: '000000000000000000000f09' })
    mockFormField.create.mockImplementation(async (data) => ({ ...data, _id: 'new-field' }))
  })

  it('persists field_key and keeps the typed options as the fallback snapshot', async () => {
    const res = makeRes()

    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: { ...baseBody, field_key: 'C12' } }, res)

    expect(mockFormField.create).toHaveBeenCalledWith(expect.objectContaining({
      form: '000000000000000000000f09', label: '假別類別 (C12)', type_1: 'select', options: ['休假', '事假', '公假'], field_key: 'C12',
    }))
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json.mock.calls[0][0]).toMatchObject({
      _id: 'new-field', field_key: 'C12', dictionaryKey: 'C12', optionsSource: 'dictionary', options: DICTIONARY_OPTIONS,
    })
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('stores an empty string when the admin chose manual input', async () => {
    const res = makeRes()

    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: { ...baseBody, field_key: '' } }, res)

    expect(mockFormField.create.mock.calls[0][0].field_key).toBe('')
    expect(res.json.mock.calls[0][0]).toMatchObject({ dictionaryKey: null, optionsSource: 'own', options: ['休假', '事假', '公假'] })
  })

  it('does not send field_key to the model when the request has none', async () => {
    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: baseBody }, makeRes())

    expect('field_key' in mockFormField.create.mock.calls[0][0]).toBe(false)
  })

  it('rejects an unsafe field_key', async () => {
    const res = makeRes()

    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: { ...baseBody, field_key: 'C12; drop' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '欄位代碼格式不正確' })
    expect(mockFormField.create).not.toHaveBeenCalled()
  })

  it('trims the label and rejects a blank label or a missing type with a Chinese message', async () => {
    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: { ...baseBody, label: '  備註 ' } }, makeRes())
    expect(mockFormField.create.mock.calls[0][0].label).toBe('備註')

    const blank = makeRes()
    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: { ...baseBody, label: '  ' } }, blank)
    expect(blank.status).toHaveBeenCalledWith(400)
    expect(blank.json).toHaveBeenCalledWith({ error: '請填寫欄位名稱並選擇欄位型別' })

    const noType = makeRes()
    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: { label: '備註' } }, noType)
    expect(noType.status).toHaveBeenCalledWith(400)
    expect(mockFormField.create).toHaveBeenCalledTimes(1)
  })

  it('maps an unknown type_1 rejected by the model to a Chinese 400', async () => {
    mockFormField.create.mockRejectedValue(Object.assign(new Error('x'), {
      name: 'ValidationError',
      errors: { type_1: { path: 'type_1', kind: 'enum' } },
    }))
    const res = makeRes()

    await controller.addField({ params: { formId: '000000000000000000000f09' }, body: { ...baseBody, type_1: 'banana' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '資料格式不正確：「欄位型別」的值不在允許的範圍內' })
  })

  it('answers 404 for an unknown form', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    const res = makeRes()

    await controller.addField({ params: { formId: 'missing' }, body: baseBody }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockFormField.create).not.toHaveBeenCalled()
  })
})

describe('updateField', () => {
  beforeEach(() => {
    mockFormField.findOneAndUpdate.mockImplementation(async (filter, update) => ({ _id: filter._id, form: '000000000000000000000f09', ...update.$set }))
  })

  it('persists field_key with the other attributes', async () => {
    const res = makeRes()

    await controller.updateField({
      params: { formId: '000000000000000000000f09', fieldId: 'c-type' },
      body: { label: '假別類別 (C12)', type_1: 'select', options: ['休假'], field_key: 'C12' },
    }, res)

    expect(mockFormField.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'c-type', form: '000000000000000000000f09' },
      { $set: expect.objectContaining({ label: '假別類別 (C12)', options: ['休假'], field_key: 'C12' }) },
      { new: true, runValidators: true },
    )
    expect(res.json.mock.calls[0][0]).toMatchObject({ field_key: 'C12', dictionaryKey: 'C12', optionsSource: 'dictionary', options: DICTIONARY_OPTIONS })
    expect(mockResetLeaveFieldCache).toHaveBeenCalled()
  })

  it('keeps the existing link when the request does not mention field_key', async () => {
    await controller.updateField({ params: { fieldId: 'c-type' }, body: { label: '假別類別 (C12)', type_1: 'select' } }, makeRes())

    expect('field_key' in mockFormField.findOneAndUpdate.mock.calls[0][1].$set).toBe(false)
  })

  it('unlinks with an empty string or null by storing an empty string', async () => {
    await controller.updateField({ params: { fieldId: 'c-type' }, body: { type_1: 'select', field_key: '' } }, makeRes())
    await controller.updateField({ params: { fieldId: 'c-type' }, body: { type_1: 'select', field_key: null } }, makeRes())

    expect(mockFormField.findOneAndUpdate.mock.calls[0][1].$set.field_key).toBe('')
    expect(mockFormField.findOneAndUpdate.mock.calls[1][1].$set.field_key).toBe('')
  })

  it('rejects a field_key that is not a short safe string', async () => {
    const res = makeRes()

    await controller.updateField({ params: { fieldId: 'c-type' }, body: { field_key: { $gt: '' } } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '欄位代碼格式不正確' })
    expect(mockFormField.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown field', async () => {
    mockFormField.findOneAndUpdate.mockResolvedValue(null)
    const res = makeRes()

    await controller.updateField({ params: { fieldId: 'missing' }, body: { label: 'x' } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })

  it('only edits a field of the form named in the URL', async () => {
    mockFormField.findOneAndUpdate.mockResolvedValue(null) // 欄位屬於別張表單 → 篩不到
    const res = makeRes()

    await controller.updateField({ params: { formId: 'formA', fieldId: 'field-of-B' }, body: { label: 'hijacked' } }, res)

    expect(mockFormField.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'field-of-B', form: 'formA' })
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('only sets the attributes that were sent, trims the label and keeps booleans real', async () => {
    await controller.updateField({
      params: { formId: '000000000000000000000f09', fieldId: 'c-type' },
      body: { label: '  備註 ', required: true, is_active: false, order: 3 },
    }, makeRes())

    expect(mockFormField.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $set: { label: '備註', required: true, is_active: false, order: 3 },
    })
  })

  it('refuses a blank label and a non-boolean required flag', async () => {
    const blank = makeRes()
    await controller.updateField({ params: { formId: '000000000000000000000f09', fieldId: 'c-type' }, body: { label: '   ' } }, blank)
    expect(blank.status).toHaveBeenCalledWith(400)
    expect(blank.json).toHaveBeenCalledWith({ error: '欄位名稱不可空白' })

    const flag = makeRes()
    await controller.updateField({ params: { formId: '000000000000000000000f09', fieldId: 'c-type' }, body: { required: 'sure' } }, flag)
    expect(flag.status).toHaveBeenCalledWith(400)
    expect(mockFormField.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('maps a validator failure (for example an unknown type_1) to a Chinese 400', async () => {
    mockFormField.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('x'), {
      name: 'ValidationError',
      errors: { type_1: { path: 'type_1', kind: 'enum' } },
    }))
    const res = makeRes()

    await controller.updateField({ params: { formId: '000000000000000000000f09', fieldId: 'c-type' }, body: { type_1: 'banana' } }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: '資料格式不正確：「欄位型別」的值不在允許的範圍內' })
  })
})

describe('leave field cache invalidation', () => {
  it('is cleared when a form or field is deleted', async () => {
    mockFormTemplate.findById.mockResolvedValue({ _id: '000000000000000000000f09' })
    mockFormTemplate.deleteOne.mockResolvedValue({})
    mockFormField.deleteMany.mockResolvedValue({})
    mockApprovalWorkflow.deleteOne.mockResolvedValue({})
    mockFormField.findOne.mockResolvedValue({ _id: 'c-type', form: '000000000000000000000f09', label: '假別' })
    mockFormField.findByIdAndDelete.mockResolvedValue({ _id: 'c-type' })

    await controller.deleteFormTemplate({ params: { id: '000000000000000000000f09' } }, makeRes())
    await controller.deleteField({ params: { formId: '000000000000000000000f09', fieldId: 'c-type' } }, makeRes())

    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(2)
  })

  it('is cleared when a form or field is deactivated instead of deleted', async () => {
    mockApprovalRequest.countDocuments.mockResolvedValue(3)
    mockFormTemplate.findById.mockResolvedValue({ _id: '000000000000000000000f09' })
    mockFormTemplate.findByIdAndUpdate.mockResolvedValue({})
    mockFormField.findOne.mockResolvedValue({ _id: 'c-type', form: '000000000000000000000f09', label: '假別' })
    mockFormField.findByIdAndUpdate.mockResolvedValue({})

    await controller.deleteFormTemplate({ params: { id: '000000000000000000000f09' } }, makeRes())
    await controller.deleteField({ params: { formId: '000000000000000000000f09', fieldId: 'c-type' } }, makeRes())

    expect(mockResetLeaveFieldCache).toHaveBeenCalledTimes(2)
  })

  it('is not cleared when nothing was deleted', async () => {
    mockFormTemplate.findById.mockResolvedValue(null)
    mockFormField.findOne.mockResolvedValue(null)

    await controller.deleteFormTemplate({ params: { id: '00000000000000000000dead' } }, makeRes())
    await controller.deleteField({ params: { fieldId: 'missing' } }, makeRes())

    expect(mockResetLeaveFieldCache).not.toHaveBeenCalled()
  })
})

describe('restoreDefaultTemplates semanticType', () => {
  it('gives restored defaults their fixed semanticType (leave / overtime / general)', async () => {
    mockFormTemplate.find.mockReturnValue({ lean: async () => [] })
    mockFormField.insertMany.mockResolvedValue([])
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
