import { jest } from '@jest/globals'

const mockFormTemplate = { find: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetSettings = jest.fn()
const mockGetDictionaryItems = jest.fn()

let service
let dictionaries
// 目前資料庫內的請假候選表單與欄位
let forms
let fields

function chain(result) {
  const query = {
    sort: jest.fn(() => query),
    lean: jest.fn(async () => result),
  }
  return query
}

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    getDictionaryItems: mockGetDictionaryItems,
  }))
  service = await import('../src/services/leaveFieldService.js')
})

beforeEach(() => {
  service.resetLeaveFieldCache()
  dictionaries = {
    C12: [{ name: '特休假', code: '特休假' }, { name: '病假', code: '病假' }, { name: '事假', code: '事假' }],
  }
  forms = []
  fields = []
  mockFormTemplate.find.mockReset()
  mockFormField.find.mockReset()
  mockGetSettings.mockReset()
  mockGetDictionaryItems.mockReset()
  mockFormTemplate.find.mockImplementation(() => chain(forms))
  mockFormField.find.mockImplementation((filter) => {
    const ids = filter.form?.$in ?? [filter.form]
    const wanted = new Set(ids.map(String))
    return { lean: async () => fields.filter((field) => wanted.has(String(field.form))) }
  })
  mockGetSettings.mockImplementation(async () => ({ itemSettings: { ...dictionaries } }))
  mockGetDictionaryItems.mockImplementation(async (key) => dictionaries[key] || [])
})

function field(id, form, label, extra = {}) {
  return { _id: id, form, label, type_1: 'text', order: 0, ...extra }
}

describe('label recognition', () => {
  it('normalises width, case, whitespace and parentheses', () => {
    expect(service.normalizeLeaveFieldLabel('日期（起）')).toBe('日期起')
    expect(service.normalizeLeaveFieldLabel(' 日期 (迄) ')).toBe('日期迄')
    expect(service.normalizeLeaveFieldLabel('假別類別 (C12)')).toBe('假別類別c12')
    expect(service.normalizeLeaveFieldLabel('開始　時間')).toBe('開始時間')
    expect(service.normalizeLeaveFieldLabel(undefined)).toBe('')
  })

  it('recognises the old and the tolerant start / end labels', () => {
    for (const label of ['開始時間', '開始日期', '日期(起)', '日期（起）', '日期 (起)', '起始時間', '起始日期', '請假起日', '開始']) {
      expect(service.isLeaveStartLabel(label)).toBe(true)
      expect(service.isLeaveEndLabel(label)).toBe(false)
    }
    for (const label of ['結束時間', '結束日期', '日期(迄)', '日期（迄）', '日期(訖)', '終止時間', '終止日期', '請假迄日', '結束']) {
      expect(service.isLeaveEndLabel(label)).toBe(true)
      expect(service.isLeaveStartLabel(label)).toBe(false)
    }
    expect(service.isLeaveStartLabel('事由')).toBe(false)
    expect(service.isLeaveEndLabel('天數')).toBe(false)
  })

  it('recognises 假別 and any label that starts with it, but not labels that merely contain it', () => {
    expect(service.isLeaveTypeLabel('假別')).toBe(true)
    expect(service.isLeaveTypeLabel('假別類別 (C12)')).toBe(true)
    expect(service.isLeaveTypeLabel('假別類別（C12）')).toBe(true)
    expect(service.isLeaveTypeLabel('請假假別')).toBe(false)
    expect(service.isLeaveTypeLabel('事由')).toBe(false)
  })

  it('recognises the leave days label', () => {
    expect(service.isLeaveDaysLabel('天數')).toBe(true)
    expect(service.isLeaveDaysLabel('請假天數')).toBe(true)
    expect(service.isLeaveDaysLabel('加班時數')).toBe(false)
  })
})

describe('getLeaveFieldIds', () => {
  it('returns an empty object when there is no leave form', async () => {
    expect(await service.getLeaveFieldIds()).toEqual({})
  })

  it('finds the default 請假 form by its old labels (behaviour unchanged)', async () => {
    forms = [{ _id: 'form1', name: '請假', semanticType: 'leave' }]
    fields = [
      field('f-type', 'form1', '假別', { order: 1, options: ['事假', '病假', '特休'] }),
      field('f-start', 'form1', '開始時間', { type_1: 'datetime', order: 2 }),
      field('f-end', 'form1', '結束時間', { type_1: 'datetime', order: 3 }),
      field('f-reason', 'form1', '事由', { type_1: 'textarea', order: 4 }),
    ]

    const info = await service.getLeaveFieldIds()

    expect(info).toMatchObject({
      formId: 'form1',
      startId: 'f-start',
      endId: 'f-end',
      typeId: 'f-type',
      startLabel: '開始時間',
      endLabel: '結束時間',
    })
    expect(info.typeOptions).toEqual([
      { value: '事假', label: '事假' },
      { value: '病假', label: '病假' },
      { value: '特休', label: '特休' },
    ])
    expect(info.daysId).toBeUndefined()
    expect(info.typeField).toBeUndefined()
  })

  it('still supports the older 開始日期 / 結束日期 labels', async () => {
    forms = [{ _id: 'form1', name: '請假', semanticType: 'leave' }]
    fields = [
      field('f-type', 'form1', '假別'),
      field('f-start', 'form1', '開始日期', { type_1: 'date' }),
      field('f-end', 'form1', '結束日期', { type_1: 'date' }),
    ]

    const info = await service.getLeaveFieldIds()

    expect(info).toMatchObject({ startId: 'f-start', endId: 'f-end', typeId: 'f-type', startLabel: '開始日期', endLabel: '結束日期' })
  })

  it('recognises the customer form (日期(起) 日期(迄) 天數 假別類別 (C12)) and uses the live dictionary for the type options', async () => {
    forms = [{ _id: 'form9', name: '休假/事假/公假申請單（人事類-出勤標準）', semanticType: 'leave' }]
    fields = [
      field('c-type', 'form9', '假別類別 (C12)', { type_1: 'select', order: 1, options: ['休假', '事假', '公假'] }),
      field('c-start', 'form9', '日期(起)', { type_1: 'date', order: 2 }),
      field('c-end', 'form9', '日期(迄)', { type_1: 'date', order: 3 }),
      field('c-days', 'form9', '天數', { type_1: 'number', order: 4 }),
    ]

    const info = await service.getLeaveFieldIds()

    expect(info).toMatchObject({
      formId: 'form9',
      startId: 'c-start',
      endId: 'c-end',
      typeId: 'c-type',
      daysId: 'c-days',
      startLabel: '日期(起)',
      endLabel: '日期(迄)',
      typeLabel: '假別類別 (C12)',
    })
    expect(info.typeOptions).toEqual([
      { value: '特休假', label: '特休假' },
      { value: '病假', label: '病假' },
      { value: '事假', label: '事假' },
    ])
  })

  it('picks up dictionary changes in the type options without clearing the cache', async () => {
    forms = [{ _id: 'form9', name: '休假申請', semanticType: 'leave' }]
    fields = [
      field('c-type', 'form9', '假別類別 (C12)', { type_1: 'select', options: ['休假'] }),
      field('c-start', 'form9', '日期(起)'),
      field('c-end', 'form9', '日期(迄)'),
    ]

    const before = await service.getLeaveFieldIds()
    dictionaries.C12 = [{ name: '婚假', code: '婚假' }]
    const after = await service.getLeaveFieldIds()

    expect(before.typeOptions.map((opt) => opt.value)).toEqual(['特休假', '病假', '事假'])
    expect(after.typeOptions.map((opt) => opt.value)).toEqual(['婚假'])
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(1)
  })

  it('prefers the candidate whose start, end and type fields are all recognised', async () => {
    forms = [
      // 沒有表單性質的舊表單才會靠名稱「請假」被選進來（設成「一般」的不會，見下方查詢條件的測試）
      { _id: 'incomplete', name: '請假' },
      { _id: 'complete', name: '休假申請單', semanticType: 'leave' },
    ]
    fields = [
      field('i-start', 'incomplete', '開始時間'),
      field('i-end', 'incomplete', '結束時間'),
      field('i-reason', 'incomplete', '事由'),
      field('c-type', 'complete', '假別類別 (C12)', { type_1: 'select' }),
      field('c-start', 'complete', '日期(起)'),
      field('c-end', 'complete', '日期(迄)'),
    ]

    const info = await service.getLeaveFieldIds()

    expect(info.formId).toBe('complete')
    expect(info.typeId).toBe('c-type')
  })

  it('keeps the form named 請假 first when several candidates are equally complete', async () => {
    forms = [
      { _id: 'first', name: '請假' },
      { _id: 'second', name: '休假申請單', semanticType: 'leave' },
    ]
    fields = [
      field('a-type', 'first', '假別'), field('a-start', 'first', '開始時間'), field('a-end', 'first', '結束時間'),
      field('b-type', 'second', '假別類別 (C12)'), field('b-start', 'second', '日期(起)'), field('b-end', 'second', '日期(迄)'),
    ]

    const info = await service.getLeaveFieldIds()

    expect(info.formId).toBe('first')
    const query = mockFormTemplate.find.mock.results[0].value
    // 排序改用不會因儲存而變動的 createdAt / _id（不再用 updatedAt）
    expect(query.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 })
  })

  it('falls back to the first candidate when none is complete', async () => {
    forms = [
      { _id: 'first', name: '請假', semanticType: 'leave' },
      { _id: 'second', name: 'Leave', semanticType: 'leave' },
    ]
    fields = [field('a-start', 'first', '開始時間'), field('b-type', 'second', '假別')]

    const info = await service.getLeaveFieldIds()

    expect(info.formId).toBe('first')
    expect(info.startId).toBe('a-start')
    expect(info.endId).toBeUndefined()
  })

  it('prefers an active field over an inactive duplicate with the same label and follows the order', async () => {
    forms = [{ _id: 'form1', name: '請假', semanticType: 'leave' }]
    fields = [
      field('old-start', 'form1', '開始時間', { is_active: false, order: 1 }),
      field('new-start', 'form1', '日期(起)', { order: 3 }),
      field('end', 'form1', '日期(迄)', { order: 4 }),
      field('type', 'form1', '假別', { order: 2 }),
      field('type-note', 'form1', '假別說明', { order: 1 }),
    ]

    const info = await service.getLeaveFieldIds()

    expect(info.startId).toBe('new-start')
    expect(info.typeId).toBe('type')
  })

  it('caches the result until resetLeaveFieldCache is called', async () => {
    forms = [{ _id: 'form1', name: '請假', semanticType: 'leave' }]
    fields = [field('s', 'form1', '開始時間'), field('e', 'form1', '結束時間'), field('t', 'form1', '假別')]

    await service.getLeaveFieldIds()
    await service.getLeaveFieldIds()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(1)

    forms = [{ _id: 'form2', name: '休假申請', semanticType: 'leave' }]
    fields = [field('s2', 'form2', '日期(起)'), field('e2', 'form2', '日期(迄)'), field('t2', 'form2', '假別類別 (C12)')]
    expect((await service.getLeaveFieldIds()).formId).toBe('form1')

    service.resetLeaveFieldCache()
    const refreshed = await service.getLeaveFieldIds()
    expect(refreshed.formId).toBe('form2')
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(2)
  })

  it('does not cache a result that was computed before a reset happened', async () => {
    forms = [{ _id: 'form1', name: '請假', semanticType: 'leave' }]
    fields = [field('s', 'form1', '開始時間'), field('e', 'form1', '結束時間'), field('t', 'form1', '假別')]
    let release
    const gate = new Promise((resolve) => { release = resolve })
    mockFormTemplate.find.mockImplementationOnce(() => ({
      sort() { return this },
      lean: async () => { await gate; return forms },
    }))

    const pending = service.getLeaveFieldIds()
    service.resetLeaveFieldCache()
    release()
    await pending

    await service.getLeaveFieldIds()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(2)
  })

  it('expires the cache after the time to live', async () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    forms = [{ _id: 'form1', name: '請假', semanticType: 'leave' }]
    fields = [field('s', 'form1', '開始時間'), field('e', 'form1', '結束時間'), field('t', 'form1', '假別')]

    await service.getLeaveFieldIds()
    now.mockReturnValue(1_000_000 + 30_000)
    await service.getLeaveFieldIds()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1_000_000 + 61_000)
    await service.getLeaveFieldIds()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })
})


// 預設的「請假」表單（舊欄位名稱）與客戶自建的「休假/事假/公假申請單」並存
function seedDefaultAndCustomForms({ defaultUpdatedAt, customUpdatedAt } = {}) {
  forms = [
    // 刻意把客戶表單排在資料庫回傳順序的前面，且 updatedAt 較新，模擬「管理員剛儲存過這張」
    { _id: 'custom', name: '休假/事假/公假申請單（人事類-出勤標準）', semanticType: 'leave', createdAt: new Date('2026-05-01'), updatedAt: customUpdatedAt ?? new Date('2026-09-30') },
    { _id: 'default', name: '請假', semanticType: 'leave', createdAt: new Date('2026-01-01'), updatedAt: defaultUpdatedAt ?? new Date('2026-02-01') },
  ]
  fields = [
    field('d-type', 'default', '假別', { order: 1 }),
    field('d-start', 'default', '開始時間', { type_1: 'datetime', order: 2 }),
    field('d-end', 'default', '結束時間', { type_1: 'datetime', order: 3 }),
    field('d-proof', 'default', '相關證明', { type_1: 'file', order: 5 }),
    field('c-type', 'custom', '假別類別 (C12)', { type_1: 'select', order: 1, options: ['休假', '事假', '公假'] }),
    field('c-start', 'custom', '日期(起)', { type_1: 'date', order: 2 }),
    field('c-end', 'custom', '日期(迄)', { type_1: 'date', order: 3 }),
    field('c-days', 'custom', '天數', { type_1: 'number', order: 4 }),
  ]
}

describe('which forms are leave forms', () => {
  it('trusts the form type when it is set and uses the name only for templates without a type', async () => {
    forms = [{ _id: 'form1', name: '請假', semanticType: 'leave' }]
    fields = [field('s', 'form1', '開始時間'), field('e', 'form1', '結束時間'), field('t', 'form1', '假別')]

    await service.getAllLeaveFieldInfos()

    // 表單性質明確設成「一般」等其他性質的表單，即使名稱叫「請假」也不算請假單；
    // 不依 is_active 篩選：停用（含軟刪除）的請假表單底下已核准的假單仍要被讀取端看到
    expect(mockFormTemplate.find).toHaveBeenCalledWith({
      $or: [
        { semanticType: 'leave' },
        { semanticType: null, name: '請假' },
        { semanticType: null, name: /leave/i },
      ],
    })
  })
})

describe('getLeaveFieldIds with several leave forms (deterministic pick)', () => {
  it('keeps the default 請假 form even though the customer form was saved more recently', async () => {
    seedDefaultAndCustomForms()

    const info = await service.getLeaveFieldIds()

    expect(info).toMatchObject({ formId: 'default', startId: 'd-start', endId: 'd-end', typeId: 'd-type' })
  })

  it('does not flip when either template is saved again (updatedAt is ignored)', async () => {
    seedDefaultAndCustomForms()
    expect((await service.getLeaveFieldIds()).formId).toBe('default')

    // 管理員重新儲存預設的請假表單：它的 updatedAt 變新
    service.resetLeaveFieldCache()
    seedDefaultAndCustomForms({ defaultUpdatedAt: new Date('2026-10-01') })
    expect((await service.getLeaveFieldIds()).formId).toBe('default')

    // 管理員重新儲存客戶表單：它的 updatedAt 又更新
    service.resetLeaveFieldCache()
    seedDefaultAndCustomForms({ customUpdatedAt: new Date('2026-10-05') })
    expect((await service.getLeaveFieldIds()).formId).toBe('default')
  })

  it('returns the same pick whatever order the database returns the forms in', async () => {
    seedDefaultAndCustomForms()
    const first = (await service.getLeaveFieldIds()).formId
    service.resetLeaveFieldCache()
    forms = [...forms].reverse()
    const second = (await service.getLeaveFieldIds()).formId

    expect([first, second]).toEqual(['default', 'default'])
  })

  it('only the exact name 請假 gets priority; a name that merely contains it does not', async () => {
    forms = [
      { _id: 'older', name: '特別請假申請', semanticType: 'leave', createdAt: new Date('2026-01-01') },
      { _id: 'newer', name: '請假', semanticType: 'leave', createdAt: new Date('2026-06-01') },
    ]
    fields = [
      field('n-type', 'newer', '假別'), field('n-start', 'newer', '開始時間'), field('n-end', 'newer', '結束時間'),
      field('o-type', 'older', '假別'), field('o-start', 'older', '開始時間'), field('o-end', 'older', '結束時間'),
    ]

    expect((await service.getLeaveFieldIds()).formId).toBe('newer')

    service.resetLeaveFieldCache()
    forms = [
      { _id: 'a-new', name: '休假申請', semanticType: 'leave', createdAt: new Date('2026-06-01') },
      { _id: 'b-old', name: '特別請假申請', semanticType: 'leave', createdAt: new Date('2026-01-01') },
    ]
    fields = [
      field('a-type', 'a-new', '假別'), field('a-start', 'a-new', '開始時間'), field('a-end', 'a-new', '結束時間'),
      field('b-type', 'b-old', '假別'), field('b-start', 'b-old', '開始時間'), field('b-end', 'b-old', '結束時間'),
    ]
    expect((await service.getLeaveFieldIds()).formId).toBe('b-old')
  })

  it('without a form named 請假 the oldest created complete form wins, then the smaller _id', async () => {
    forms = [
      { _id: 'z', name: '休假申請 B', semanticType: 'leave', createdAt: new Date('2026-03-01') },
      { _id: 'y', name: '休假申請 A', semanticType: 'leave', createdAt: new Date('2026-02-01') },
    ]
    fields = [
      field('z-type', 'z', '假別'), field('z-start', 'z', '開始時間'), field('z-end', 'z', '結束時間'),
      field('y-type', 'y', '假別'), field('y-start', 'y', '開始時間'), field('y-end', 'y', '結束時間'),
    ]
    expect((await service.getLeaveFieldIds()).formId).toBe('y')

    // createdAt 相同或缺漏時看 _id
    service.resetLeaveFieldCache()
    forms = [
      { _id: 'b-form', name: '休假申請 B', semanticType: 'leave' },
      { _id: 'a-form', name: '休假申請 A', semanticType: 'leave' },
    ]
    fields = [
      field('b-type', 'b-form', '假別'), field('b-start', 'b-form', '開始時間'), field('b-end', 'b-form', '結束時間'),
      field('a-type', 'a-form', '假別'), field('a-start', 'a-form', '開始時間'), field('a-end', 'a-form', '結束時間'),
    ]
    expect((await service.getLeaveFieldIds()).formId).toBe('a-form')
  })

  it('still prefers a complete form over an incomplete default 請假 form', async () => {
    forms = [
      { _id: 'default', name: '請假', semanticType: 'leave', createdAt: new Date('2026-01-01') },
      { _id: 'custom', name: '休假申請單', semanticType: 'leave', createdAt: new Date('2026-05-01') },
    ]
    fields = [
      field('d-start', 'default', '開始時間'), field('d-end', 'default', '結束時間'),
      field('c-type', 'custom', '假別類別 (C12)'), field('c-start', 'custom', '日期(起)'), field('c-end', 'custom', '日期(迄)'),
    ]

    expect((await service.getLeaveFieldIds()).formId).toBe('custom')
  })
})

describe('getAllLeaveFieldInfos', () => {
  it('returns an empty array when there is no leave form', async () => {
    expect(await service.getAllLeaveFieldInfos()).toEqual([])
  })

  it('returns every leave form with its own field ids, the default 請假 form first', async () => {
    seedDefaultAndCustomForms()

    const infos = await service.getAllLeaveFieldInfos()

    expect(infos.map((info) => info.formId)).toEqual(['default', 'custom'])
    expect(infos[0]).toMatchObject({ startId: 'd-start', endId: 'd-end', typeId: 'd-type', startLabel: '開始時間' })
    expect(infos[0].daysId).toBeUndefined()
    expect(infos[1]).toMatchObject({ startId: 'c-start', endId: 'c-end', typeId: 'c-type', daysId: 'c-days', typeLabel: '假別類別 (C12)' })
    // 每張表單的假別選項各自解析（客戶表單連結字典 C12）
    expect(infos[1].typeOptions.map((opt) => opt.value)).toEqual(['特休假', '病假', '事假'])
    expect(infos[0].typeField).toBeUndefined()
  })

  it('keeps forms that have start and end fields even without a type field, and drops the ones without', async () => {
    forms = [
      { _id: 'no-type', name: '休假申請 A', semanticType: 'leave', createdAt: new Date('2026-01-01') },
      { _id: 'no-end', name: '休假申請 B', semanticType: 'leave', createdAt: new Date('2026-02-01') },
      { _id: 'nothing', name: '休假申請 C', semanticType: 'leave', createdAt: new Date('2026-03-01') },
    ]
    fields = [
      field('a-start', 'no-type', '開始時間'), field('a-end', 'no-type', '結束時間'),
      field('b-type', 'no-end', '假別'), field('b-start', 'no-end', '開始時間'),
      field('c-note', 'nothing', '備註'),
    ]

    const infos = await service.getAllLeaveFieldInfos()

    expect(infos.map((info) => info.formId)).toEqual(['no-type'])
    expect(infos[0].typeId).toBeUndefined()
    expect(infos[0].typeOptions).toEqual([])
  })

  it('skips resolving the type options when withTypeOptions is false', async () => {
    seedDefaultAndCustomForms()

    const infos = await service.getAllLeaveFieldInfos({ withTypeOptions: false })

    expect(infos.map((info) => info.formId)).toEqual(['default', 'custom'])
    expect(infos[1]).toMatchObject({ typeId: 'c-type', daysId: 'c-days' })
    expect(infos[1]).not.toHaveProperty('typeOptions')
    expect(mockGetDictionaryItems).not.toHaveBeenCalled()
  })

  it('shares the cache with getLeaveFieldIds and is invalidated by resetLeaveFieldCache', async () => {
    seedDefaultAndCustomForms()

    await service.getLeaveFieldIds()
    await service.getAllLeaveFieldInfos()
    await service.getAllLeaveFieldInfos({ withTypeOptions: false })
    await service.getLeaveFieldIds()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(1)

    forms = [{ _id: 'form2', name: '休假申請', semanticType: 'leave', createdAt: new Date('2026-06-01') }]
    fields = [field('s2', 'form2', '日期(起)'), field('e2', 'form2', '日期(迄)'), field('t2', 'form2', '假別類別 (C12)')]
    expect((await service.getAllLeaveFieldInfos()).map((info) => info.formId)).toEqual(['default', 'custom'])

    service.resetLeaveFieldCache()
    expect((await service.getAllLeaveFieldInfos()).map((info) => info.formId)).toEqual(['form2'])
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(2)
  })

  it('expires after the same time to live as getLeaveFieldIds', async () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(2_000_000)
    seedDefaultAndCustomForms()

    await service.getAllLeaveFieldInfos()
    now.mockReturnValue(2_000_000 + 30_000)
    await service.getAllLeaveFieldInfos()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(1)

    now.mockReturnValue(2_000_000 + 61_000)
    await service.getAllLeaveFieldInfos()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('does not cache a result that was computed before a reset happened', async () => {
    seedDefaultAndCustomForms()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    mockFormTemplate.find.mockImplementationOnce(() => ({
      sort() { return this },
      lean: async () => { await gate; return forms },
    }))

    const pending = service.getAllLeaveFieldInfos()
    service.resetLeaveFieldCache()
    release()
    await pending

    await service.getAllLeaveFieldInfos()
    expect(mockFormTemplate.find).toHaveBeenCalledTimes(2)
  })

  it('does not change the shape of getLeaveFieldIds', async () => {
    seedDefaultAndCustomForms()

    const info = await service.getLeaveFieldIds()

    expect(Array.isArray(info)).toBe(false)
    expect(Object.keys(info).sort()).toEqual([
      'daysId', 'endId', 'endLabel', 'formId', 'startId', 'startLabel', 'typeId', 'typeLabel', 'typeOptions',
    ])
  })
})
describe('getLeaveFieldIdsForForm', () => {
  it('maps the fields of the given form even if another leave form is the globally picked one', async () => {
    forms = [{ _id: 'default', name: '請假', semanticType: 'leave' }]
    fields = [
      field('d-type', 'default', '假別'), field('d-start', 'default', '開始時間'), field('d-end', 'default', '結束時間'),
      field('c-type', 'custom', '假別類別 (C12)', { type_1: 'select' }),
      field('c-start', 'custom', '日期(起)'), field('c-end', 'custom', '日期(迄)'), field('c-days', 'custom', '天數'),
    ]

    const info = await service.getLeaveFieldIdsForForm({ _id: 'custom', name: '休假申請單' })

    expect(info).toMatchObject({ formId: 'custom', typeId: 'c-type', startId: 'c-start', endId: 'c-end', daysId: 'c-days' })
    expect(info.typeOptions.map((opt) => opt.value)).toEqual(['特休假', '病假', '事假'])
  })

  it('accepts a bare form id and returns an empty object without one', async () => {
    fields = [field('c-type', 'custom', '假別')]

    expect((await service.getLeaveFieldIdsForForm('custom')).typeId).toBe('c-type')
    expect(await service.getLeaveFieldIdsForForm(undefined)).toEqual({})
  })
})

// 停用（含軟刪除）的請假表單：新的假單不能再用它，但它底下已核准的假單仍要被讀取端（日曆、薪資、報表、重疊檢查）看到
describe('retired (inactive) leave forms', () => {
  function seedActiveAndRetiredForms() {
    forms = [
      // 預設的「請假」被停用（刪除時因為已有單據而改為停用），客戶自建的表單仍啟用
      { _id: 'default', name: '請假', semanticType: 'leave', is_active: false, createdAt: new Date('2026-01-01') },
      { _id: 'custom', name: '休假/事假/公假申請單', semanticType: 'leave', is_active: true, createdAt: new Date('2026-05-01') },
    ]
    fields = [
      field('d-type', 'default', '假別', { order: 1 }),
      field('d-start', 'default', '開始時間', { type_1: 'datetime', order: 2 }),
      field('d-end', 'default', '結束時間', { type_1: 'datetime', order: 3 }),
      field('c-type', 'custom', '假別類別 (C12)', { order: 1 }),
      field('c-start', 'custom', '日期(起)', { type_1: 'date', order: 2 }),
      field('c-end', 'custom', '日期(迄)', { type_1: 'date', order: 3 }),
    ]
  }

  it('getAllLeaveFieldInfos still returns the retired form, flagged isActive false, after the active ones', async () => {
    seedActiveAndRetiredForms()

    const infos = await service.getAllLeaveFieldInfos({ withTypeOptions: false })

    // 預設的「請假」雖然永遠排第一，但停用的表單排在所有啟用的表單之後
    expect(infos.map((info) => [info.formId, info.isActive])).toEqual([['custom', true], ['default', false]])
    expect(infos[1]).toMatchObject({ startId: 'd-start', endId: 'd-end', typeId: 'd-type' })
  })

  it('getAllLeaveFieldInfos returns a retired form even when it is the only leave form', async () => {
    forms = [{ _id: 'default', name: '請假', semanticType: 'leave', is_active: false }]
    fields = [field('d-type', 'default', '假別'), field('d-start', 'default', '開始時間'), field('d-end', 'default', '結束時間')]

    const infos = await service.getAllLeaveFieldInfos()

    expect(infos).toHaveLength(1)
    expect(infos[0]).toMatchObject({ formId: 'default', isActive: false, startId: 'd-start', endId: 'd-end' })
  })

  it('treats forms without an is_active value as active (old documents)', async () => {
    forms = [{ _id: 'legacy', name: '請假', semanticType: 'leave' }]
    fields = [field('l-start', 'legacy', '開始時間'), field('l-end', 'legacy', '結束時間')]

    expect((await service.getAllLeaveFieldInfos())[0].isActive).toBe(true)
  })

  it('getLeaveFieldIds (the form for NEW requests) never picks a retired form while an active one exists', async () => {
    seedActiveAndRetiredForms()

    const info = await service.getLeaveFieldIds()

    // 即使停用的是名稱剛好叫「請假」的預設表單
    expect(info).toMatchObject({ formId: 'custom', startId: 'c-start', endId: 'c-end', typeId: 'c-type' })
  })

  it('getLeaveFieldIds returns nothing when every leave form is retired, as before', async () => {
    forms = [{ _id: 'default', name: '請假', semanticType: 'leave', is_active: false }]
    fields = [field('d-type', 'default', '假別'), field('d-start', 'default', '開始時間'), field('d-end', 'default', '結束時間')]

    expect(await service.getLeaveFieldIds()).toEqual({})
  })

  it('getLeaveFieldIds prefers an incomplete active form over a complete retired one', async () => {
    forms = [
      { _id: 'old', name: '請假', semanticType: 'leave', is_active: false, createdAt: new Date('2026-01-01') },
      { _id: 'new', name: '休假申請', semanticType: 'leave', createdAt: new Date('2026-05-01') },
    ]
    fields = [
      field('o-type', 'old', '假別'), field('o-start', 'old', '開始時間'), field('o-end', 'old', '結束時間'),
      field('n-start', 'new', '日期(起)'), field('n-end', 'new', '日期(迄)'),
    ]

    expect((await service.getLeaveFieldIds()).formId).toBe('new')
  })

  it('does not change the shape of getLeaveFieldIds for the active form', async () => {
    seedActiveAndRetiredForms()

    const info = await service.getLeaveFieldIds()

    expect(info).not.toHaveProperty('isActive')
    expect(info).not.toHaveProperty('startIds')
  })

  it('getLeaveFieldIdsForForm works for a retired form and reports it', async () => {
    seedActiveAndRetiredForms()

    const info = await service.getLeaveFieldIdsForForm(forms[0])

    expect(info).toMatchObject({ formId: 'default', isActive: false, startId: 'd-start', endId: 'd-end', typeId: 'd-type' })
  })
})

// 欄位被停用或換成同標籤的新欄位：舊單據的答案還在舊欄位 ID 底下，所以回傳同標籤的全部候選欄位（啟用中的在前）
describe('same-label field candidates', () => {
  it('lists the active field first and the retired same-label field after it', async () => {
    forms = [{ _id: 'default', name: '請假', semanticType: 'leave' }]
    fields = [
      field('d-type', 'default', '假別', { order: 1 }),
      field('d-start-old', 'default', '開始時間', { order: 2, is_active: false }),
      field('d-end', 'default', '結束時間', { order: 3 }),
      field('d-start-new', 'default', '開始時間', { order: 9 }),
    ]

    const [info] = await service.getAllLeaveFieldInfos({ withTypeOptions: false })

    // 單一欄位 ID 仍是啟用中的那一個（給新單據用），候選清單另外列出新舊兩個
    expect(info).toMatchObject({ startId: 'd-start-new', endId: 'd-end', typeId: 'd-type' })
    expect(info.startIds).toEqual(['d-start-new', 'd-start-old'])
    expect(info.endIds).toEqual(['d-end'])
    expect(info.typeIds).toEqual(['d-type'])
    expect(info.daysIds).toEqual([])
  })

  it('uses the retired fields as the only candidates when no active field has that label', async () => {
    forms = [{ _id: 'default', name: '請假', semanticType: 'leave' }]
    fields = [
      field('d-start', 'default', '開始時間', { order: 1, is_active: false }),
      field('d-end', 'default', '結束時間', { order: 2, is_active: false }),
    ]

    const [info] = await service.getAllLeaveFieldInfos({ withTypeOptions: false })

    expect(info).toMatchObject({ startId: 'd-start', endId: 'd-end', startIds: ['d-start'], endIds: ['d-end'] })
  })

  it('matches same-label fields after normalising width and spaces, and never mixes in other labels', async () => {
    forms = [{ _id: 'custom', name: '休假申請', semanticType: 'leave' }]
    fields = [
      field('c-start', 'custom', '日期（起）', { order: 1 }),
      field('c-start-old', 'custom', '日期 (起)', { order: 2, is_active: false }),
      field('c-start-other', 'custom', '開始日期', { order: 3, is_active: false }),
      field('c-end', 'custom', '日期(迄)', { order: 4 }),
    ]

    const [info] = await service.getAllLeaveFieldInfos({ withTypeOptions: false })

    expect(info.startIds).toEqual(['c-start', 'c-start-old'])
  })

  it('also reports the candidates through getLeaveFieldIdsForForm', async () => {
    fields = [
      field('x-start', 'x', '開始時間', { order: 1, is_active: false }),
      field('y-start', 'x', '開始時間', { order: 2 }),
      field('x-end', 'x', '結束時間', { order: 3 }),
    ]

    const info = await service.getLeaveFieldIdsForForm('x')

    expect(info).toMatchObject({ startId: 'y-start', startIds: ['y-start', 'x-start'], endIds: ['x-end'], isActive: true })
  })
})
