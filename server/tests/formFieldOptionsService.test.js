import { jest } from '@jest/globals'

const mockGetSettings = jest.fn()
const mockGetDictionaryItems = jest.fn()

let service

// 字典：C12 假別、C03 職稱、C20 目前沒有項目
let dictionaries

beforeAll(async () => {
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    getDictionaryItems: mockGetDictionaryItems,
  }))
  service = await import('../src/services/formFieldOptionsService.js')
})

beforeEach(() => {
  dictionaries = {
    C12: [{ name: '特休假', code: '特休假' }, { name: '病假', code: '病假' }, { name: '事假', code: '事假' }],
    C03: [{ name: '助理', code: '助理' }, { name: '專員', code: '專員' }],
    C20: [],
  }
  mockGetSettings.mockReset()
  mockGetDictionaryItems.mockReset()
  mockGetSettings.mockImplementation(async () => ({ itemSettings: { ...dictionaries } }))
  mockGetDictionaryItems.mockImplementation(async (key) => dictionaries[key] || [])
})

const leaveOptions = [
  { label: '特休假', value: '特休假' },
  { label: '病假', value: '病假' },
  { label: '事假', value: '事假' },
]

describe('pure helpers', () => {
  it('extracts the dictionary code at the end of a label (half and full width parentheses)', () => {
    expect(service.extractDictionaryCodeFromLabel('假別類別 (C12)')).toBe('C12')
    expect(service.extractDictionaryCodeFromLabel('假別類別（C12）')).toBe('C12')
    expect(service.extractDictionaryCodeFromLabel('假別類別( C12 ) ')).toBe('C12')
    expect(service.extractDictionaryCodeFromLabel('假別類別 (C12) 備註')).toBe('')
    expect(service.extractDictionaryCodeFromLabel('假別類別 (c12)')).toBe('')
    expect(service.extractDictionaryCodeFromLabel('假別類別')).toBe('')
    expect(service.extractDictionaryCodeFromLabel(undefined)).toBe('')
  })

  it('parses field_key input: untouched, cleared, valid and invalid', () => {
    expect(service.normalizeFieldKeyInput(undefined)).toEqual({ valid: true, provided: false, value: undefined })
    expect(service.normalizeFieldKeyInput(null)).toEqual({ valid: true, provided: true, value: '' })
    expect(service.normalizeFieldKeyInput('')).toEqual({ valid: true, provided: true, value: '' })
    expect(service.normalizeFieldKeyInput('   ')).toEqual({ valid: true, provided: true, value: '' })
    expect(service.normalizeFieldKeyInput(' C12 ')).toEqual({ valid: true, provided: true, value: 'C12' })
    expect(service.normalizeFieldKeyInput('uniform_size-2')).toEqual({ valid: true, provided: true, value: 'uniform_size-2' })
    expect(service.normalizeFieldKeyInput('a'.repeat(41)).valid).toBe(false)
    expect(service.normalizeFieldKeyInput('C12; drop').valid).toBe(false)
    expect(service.normalizeFieldKeyInput('../C12').valid).toBe(false)
    expect(service.normalizeFieldKeyInput({ $ne: 1 }).valid).toBe(false)
    expect(service.normalizeFieldKeyInput(12).valid).toBe(false)
  })

  it('only select and checkbox fields can be linked', () => {
    expect(service.getDictionaryKeyCandidate({ type_1: 'select', field_key: 'C12' })).toBe('C12')
    expect(service.getDictionaryKeyCandidate({ type_1: 'checkbox', label: '假別 (C12)' })).toBe('C12')
    expect(service.getDictionaryKeyCandidate({ type_1: 'text', field_key: 'C12', label: '假別 (C12)' })).toBe('')
    expect(service.getDictionaryKeyCandidate({ type_1: 'select', label: '制服尺寸' })).toBe('')
  })

  it('an explicit empty field_key means manual input and disables the label auto-link', () => {
    expect(service.getDictionaryKeyCandidate({ type_1: 'select', field_key: '', label: '假別類別 (C12)' })).toBe('')
    expect(service.getDictionaryKeyCandidate({ type_1: 'select', field_key: null, label: '假別類別 (C12)' })).toBe('C12')
    expect(service.getDictionaryKeyCandidate({ type_1: 'select', label: '假別類別 (C12)' })).toBe('C12')
  })

  it('builds options from dictionary items using the name as both label and value, without duplicates', () => {
    expect(service.buildDictionaryOptions([
      { name: '特休假', code: 'A' },
      { name: '特休假', code: 'B' },
      { name: '  病假  ', code: 'C' },
      { name: '', code: 'D' },
      '事假',
      null,
    ])).toEqual(leaveOptions)
    expect(service.buildDictionaryOptions(undefined)).toEqual([])
  })
})

describe('resolveFieldOptions', () => {
  it('uses the live dictionary for an explicit field_key', async () => {
    const field = { _id: 'f1', label: '假別', type_1: 'select', field_key: 'C12', options: ['休假', '事假', '公假'] }

    const resolved = await service.resolveFieldOptions(field)

    expect(resolved.options).toEqual(leaveOptions)
    expect(resolved.dictionaryKey).toBe('C12')
    expect(resolved.optionsSource).toBe('dictionary')
    expect(resolved.label).toBe('假別')
  })

  it('auto-links a legacy field whose label ends with the dictionary code', async () => {
    // 客戶的欄位：選項是手動輸入的休假/事假/公假，沒有 field_key
    const field = { _id: 'f1', label: '假別類別 (C12)', type_1: 'select', options: ['休假', '事假', '公假'] }

    const resolved = await service.resolveFieldOptions(field)

    expect(resolved.options).toEqual(leaveOptions)
    expect(resolved.dictionaryKey).toBe('C12')
    expect(resolved.optionsSource).toBe('dictionary')
  })

  it('auto-links when the label uses full-width parentheses', async () => {
    const resolved = await service.resolveFieldOptions({ label: '假別類別（C12）', type_1: 'select', options: ['休假'] })

    expect(resolved.dictionaryKey).toBe('C12')
    expect(resolved.options).toEqual(leaveOptions)
  })

  it('links checkbox fields too', async () => {
    const resolved = await service.resolveFieldOptions({ label: '職稱 (C03)', type_1: 'checkbox' })

    expect(resolved.dictionaryKey).toBe('C03')
    expect(resolved.optionsSource).toBe('dictionary')
    expect(resolved.options).toEqual([{ label: '助理', value: '助理' }, { label: '專員', value: '專員' }])
  })

  it('keeps a non-linked select on its own options and never reads the dictionary', async () => {
    const field = { _id: 'f2', label: '制服尺寸', type_1: 'select', options: ['S', 'M', 'L'] }

    const resolved = await service.resolveFieldOptions(field)

    expect(resolved.options).toEqual(['S', 'M', 'L'])
    expect(resolved.dictionaryKey).toBeNull()
    expect(resolved.optionsSource).toBe('own')
    expect(mockGetSettings).not.toHaveBeenCalled()
    expect(mockGetDictionaryItems).not.toHaveBeenCalled()
  })

  it('does not link text fields even when the label ends with a dictionary code', async () => {
    const resolved = await service.resolveFieldOptions({ label: '假別 (C12)', type_1: 'text', field_key: 'C12' })

    expect(resolved.dictionaryKey).toBeNull()
    expect(resolved.optionsSource).toBe('own')
    expect(mockGetDictionaryItems).not.toHaveBeenCalled()
  })

  it('does not auto-link when field_key is an explicit empty string (admin chose manual input)', async () => {
    const field = { label: '假別類別 (C12)', type_1: 'select', field_key: '', options: ['休假', '事假', '公假'] }

    const resolved = await service.resolveFieldOptions(field)

    expect(resolved.options).toEqual(['休假', '事假', '公假'])
    expect(resolved.dictionaryKey).toBeNull()
    expect(resolved.optionsSource).toBe('own')
  })

  it('does not link an explicit field_key that is not a dictionary', async () => {
    const field = { label: '制服', type_1: 'select', field_key: 'uniformSize', options: ['S', 'M'] }

    const resolved = await service.resolveFieldOptions(field)

    expect(resolved.options).toEqual(['S', 'M'])
    expect(resolved.dictionaryKey).toBeNull()
    expect(resolved.optionsSource).toBe('own')
  })

  it('ignores a dictionary code in the label when that dictionary does not exist', async () => {
    const field = { label: '其他 (C99)', type_1: 'select', options: ['a', 'b'] }

    const resolved = await service.resolveFieldOptions(field)

    expect(resolved.options).toEqual(['a', 'b'])
    expect(resolved.dictionaryKey).toBeNull()
    expect(resolved.optionsSource).toBe('own')
  })

  it('falls back to the own options while the dictionary has no items, but stays linked', async () => {
    const field = { label: '空字典 (C20)', type_1: 'select', options: ['舊選項'] }

    const resolved = await service.resolveFieldOptions(field)

    expect(resolved.options).toEqual(['舊選項'])
    expect(resolved.dictionaryKey).toBe('C20')
    expect(resolved.optionsSource).toBe('own')
  })

  it('falls back to the own options when the dictionary is missing entirely', async () => {
    delete dictionaries.C12

    const resolved = await service.resolveFieldOptions({ label: '假別類別 (C12)', type_1: 'select', options: ['休假'] })

    expect(resolved.options).toEqual(['休假'])
    expect(resolved.dictionaryKey).toBeNull()
    expect(resolved.optionsSource).toBe('own')
  })

  it('de-duplicates dictionary items', async () => {
    dictionaries.C12 = [{ name: '特休假', code: 'a' }, { name: '特休假', code: 'b' }, { name: '病假', code: 'c' }]

    const resolved = await service.resolveFieldOptions({ label: '假別類別 (C12)', type_1: 'select' })

    expect(resolved.options).toEqual([{ label: '特休假', value: '特休假' }, { label: '病假', value: '病假' }])
  })

  it('does not overwrite the stored options (plain object and mongoose-like document)', async () => {
    const stored = ['休假', '事假', '公假']
    const plain = { label: '假別類別 (C12)', type_1: 'select', options: stored }
    const doc = {
      toObject() { return { label: '假別類別 (C12)', type_1: 'select', options: stored } },
    }

    const fromPlain = await service.resolveFieldOptions(plain)
    const fromDoc = await service.resolveFieldOptions(doc)

    expect(plain.options).toBe(stored)
    expect(stored).toEqual(['休假', '事假', '公假'])
    expect(fromPlain).not.toBe(plain)
    expect(fromPlain.options).toEqual(leaveOptions)
    expect(fromDoc.options).toEqual(leaveOptions)
    expect(fromDoc.dictionaryKey).toBe('C12')
  })

  it('reflects dictionary changes immediately without touching the field', async () => {
    const field = { label: '假別類別 (C12)', type_1: 'select', options: ['休假'] }

    const before = await service.resolveFieldOptions(field)
    dictionaries.C12 = [{ name: '婚假', code: '婚假' }, { name: '喪假', code: '喪假' }]
    const after = await service.resolveFieldOptions(field)

    expect(before.options).toEqual(leaveOptions)
    expect(after.options).toEqual([{ label: '婚假', value: '婚假' }, { label: '喪假', value: '喪假' }])
    expect(field.options).toEqual(['休假'])
  })

  it('falls back to the own options instead of throwing when the settings store fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetDictionaryItems.mockRejectedValue(new Error('db down'))

    const resolved = await service.resolveFieldOptions({ label: '假別類別 (C12)', type_1: 'select', options: ['休假'] })

    expect(resolved.options).toEqual(['休假'])
    expect(resolved.dictionaryKey).toBeNull()
    expect(resolved.optionsSource).toBe('own')
    warn.mockRestore()
  })

  it('always adds dictionaryKey and optionsSource, even for fields without options', async () => {
    const resolved = await service.resolveFieldOptions({ _id: 'f3', label: '事由', type_1: 'textarea' })

    expect(resolved).toEqual({ _id: 'f3', label: '事由', type_1: 'textarea', dictionaryKey: null, optionsSource: 'own' })
    expect('options' in resolved).toBe(false)
  })
})

describe('resolveFieldsOptions', () => {
  it('resolves every field and reads each dictionary only once', async () => {
    const fields = [
      { _id: 'a', label: '假別類別 (C12)', type_1: 'select', options: ['休假'] },
      { _id: 'b', label: '假別 2', type_1: 'select', field_key: 'C12' },
      { _id: 'c', label: '事由', type_1: 'textarea' },
      { _id: 'd', label: '制服', type_1: 'select', options: ['S'] },
    ]

    const resolved = await service.resolveFieldsOptions(fields)

    expect(resolved.map((f) => f.dictionaryKey)).toEqual(['C12', 'C12', null, null])
    expect(resolved.map((f) => f.optionsSource)).toEqual(['dictionary', 'dictionary', 'own', 'own'])
    expect(resolved[0].options).toEqual(leaveOptions)
    expect(resolved[3].options).toEqual(['S'])
    expect(mockGetDictionaryItems).toHaveBeenCalledTimes(1)
    expect(mockGetSettings).not.toHaveBeenCalled()
  })

  it('returns an empty list for non-array input', async () => {
    expect(await service.resolveFieldsOptions(undefined)).toEqual([])
    expect(await service.resolveFieldsOptions(null)).toEqual([])
  })
})

describe('detectDictionaryKey', () => {
  it('returns the explicit or auto-linked dictionary key and null otherwise', async () => {
    expect(await service.detectDictionaryKey({ type_1: 'select', field_key: 'C03' })).toBe('C03')
    expect(await service.detectDictionaryKey({ type_1: 'select', label: '假別類別 (C12)' })).toBe('C12')
    expect(await service.detectDictionaryKey({ type_1: 'select', label: '假別類別 (C12)', field_key: '' })).toBeNull()
    expect(await service.detectDictionaryKey({ type_1: 'select', label: '其他 (C99)' })).toBeNull()
    expect(await service.detectDictionaryKey({ type_1: 'text', label: '假別 (C12)' })).toBeNull()
    expect(await service.detectDictionaryKey({ type_1: 'select', field_key: 'C20' })).toBe('C20')
  })
})
