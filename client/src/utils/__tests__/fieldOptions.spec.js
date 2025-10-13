import { describe, it, expect } from 'vitest'
import {
  editableListToOptions,
  normalizeCustomFieldOptions,
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
