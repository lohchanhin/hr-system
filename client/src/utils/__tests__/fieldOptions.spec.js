import { describe, it, expect } from 'vitest'
import {
  dictionaryItemNames,
  editableListToOptions,
  getFieldDictionaryKey,
  isDictionaryCustomField,
  isDictionaryLinkableType,
  normalizeCustomFieldOptions,
  normalizeDictionaryItems,
  normalizeItemSettings,
  optionsToEditableList,
  parseCustomFieldOptionsInput,
  stringifyCustomFieldOptions
} from '../fieldOptions'

describe('fieldOptions utilities', () => {
  it('將陣列轉換成可編輯列表並保留名稱與代碼', () => {
    const list = optionsToEditableList([
      '文字選項',
      { name: '顯示名稱', code: 'display' },
      { label: '外部名稱', value: 'external' }
    ])

    expect(list).toEqual([
      { name: '文字選項', code: '' },
      { name: '顯示名稱', code: 'display' },
      { name: '外部名稱', code: 'external' }
    ])
  })

  it('可將可編輯列表轉回字串或物件陣列', () => {
    const stringOptions = editableListToOptions([
      { name: 'A', code: '' },
      { name: 'B', code: '' }
    ])
    expect(stringOptions).toEqual(['A', 'B'])

    const objectOptions = editableListToOptions([
      { name: '顯示', code: 'show' },
      { name: '', code: 'code-only' }
    ])
    expect(objectOptions).toEqual([
      { name: '顯示', code: 'show' },
      { name: 'code-only', code: 'code-only' }
    ])
  })

  it('可解析字串輸入並序列化為顯示字串', () => {
    const parsed = parseCustomFieldOptionsInput('A, B\nC')
    expect(parsed).toEqual(['A', 'B', 'C'])

    const normalized = normalizeCustomFieldOptions('[{"name":"X","code":"x"}]')
    expect(normalized).toEqual([{ name: 'X', code: 'x' }])

    const display = stringifyCustomFieldOptions([
      { name: 'X', code: 'x' },
      { name: 'Y', code: 'y' }
    ])
    expect(display).toBe('[{"name":"X","code":"x"},{"name":"Y","code":"y"}]')
  })
})

describe('fieldOptions 字典連結工具', () => {
  it('只有下拉與複選欄位可連結字典', () => {
    expect(isDictionaryLinkableType('select')).toBe(true)
    expect(isDictionaryLinkableType('checkbox')).toBe(true)
    expect(isDictionaryLinkableType('text')).toBe(false)
    expect(isDictionaryLinkableType('textarea')).toBe(false)
    expect(isDictionaryLinkableType(undefined)).toBe(false)
  })

  it('字典類自訂欄位以 category 為 dictionary 判斷', () => {
    expect(isDictionaryCustomField({ fieldKey: 'C12', category: 'dictionary' })).toBe(true)
    expect(isDictionaryCustomField({ fieldKey: 'uniformSize', category: 'employee' })).toBe(false)
    expect(isDictionaryCustomField({ fieldKey: 'x' })).toBe(false)
    expect(isDictionaryCustomField(null)).toBe(false)
  })

  it('取得表單欄位連結的字典代碼：dictionaryKey 優先，其次 optionsSource 為 dictionary 時的 field_key', () => {
    expect(getFieldDictionaryKey({ dictionaryKey: 'C12', optionsSource: 'dictionary' })).toBe('C12')
    expect(getFieldDictionaryKey({ dictionaryKey: ' C12 ', field_key: '' })).toBe('C12')
    expect(getFieldDictionaryKey({ optionsSource: 'dictionary', field_key: 'C14' })).toBe('C14')
    expect(getFieldDictionaryKey({ dictionaryKey: null, optionsSource: 'own', field_key: 'uniformSize' })).toBe('')
    expect(getFieldDictionaryKey({ field_key: 'C12' })).toBe('')
    expect(getFieldDictionaryKey(null)).toBe('')
    expect(getFieldDictionaryKey('C12')).toBe('')
  })

  it('字典項目正規化：字串與物件統一成 { name, code }，略過空白並依名稱去重', () => {
    expect(normalizeDictionaryItems([
      '特休假',
      ' 病假 ',
      { name: '事假', code: 'C' },
      { label: '公假', value: 'D' },
      { text: '喪假' },
      { code: 'only-code' },
      '病假',
      '',
      '   ',
      { name: '' },
      null,
      12
    ])).toEqual([
      { name: '特休假', code: '特休假' },
      { name: '病假', code: '病假' },
      { name: '事假', code: 'C' },
      { name: '公假', code: 'D' },
      { name: '喪假', code: '喪假' },
      { name: 'only-code', code: 'only-code' },
      { name: '12', code: '12' }
    ])
    expect(normalizeDictionaryItems(undefined)).toEqual([])
    expect(normalizeDictionaryItems('特休假')).toEqual([])
  })

  it('字典項目名稱清單可吃字串、物件與已解析的 label/value 選項', () => {
    expect(dictionaryItemNames(['特休假', '病假'])).toEqual(['特休假', '病假'])
    expect(dictionaryItemNames([
      { label: '特休假', value: '特休假' },
      { label: '病假', value: '病假' }
    ])).toEqual(['特休假', '病假'])
    expect(dictionaryItemNames(undefined)).toEqual([])
  })

  it('item-settings 回應可為字典物件或 { itemSettings } 包裝，非陣列的項目會被忽略', () => {
    const expected = {
      C12: [
        { name: '特休假', code: '特休假' },
        { name: '病假', code: '病假' }
      ]
    }
    expect(normalizeItemSettings({ C12: ['特休假', '病假'] })).toEqual(expected)
    expect(normalizeItemSettings({ itemSettings: { C12: ['特休假', '病假'] } })).toEqual(expected)
    expect(normalizeItemSettings({ C12: ['特休假', '病假'], note: 'x', other: { a: 1 } })).toEqual(expected)
    expect(normalizeItemSettings(null)).toEqual({})
    expect(normalizeItemSettings([])).toEqual({})
    expect(normalizeItemSettings('text')).toEqual({})
  })
})
