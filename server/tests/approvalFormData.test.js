import { describe, it, expect } from '@jest/globals'
import {
  MAX_FORM_DATA_BYTES,
  collectAttachmentFilenames,
  sanitizeApprovalFormData,
} from '../src/services/approvalFormData.js'

const fields = [
  { _id: 'f-text', label: '事由', type_1: 'text' },
  { _id: 'f-area', label: '說明', type_1: 'textarea' },
  { _id: 'f-num', label: '金額', type_1: 'number' },
  { _id: 'f-date', label: '日期', type_1: 'date' },
  { _id: 'f-dt', label: '開始時間', type_1: 'datetime' },
  { _id: 'f-time', label: '時間', type_1: 'time' },
  { _id: 'f-sel', label: '類別', type_1: 'select', options: ['甲', '乙'] },
  { _id: 'f-dict', label: '假別類別 (C12)', type_1: 'select', options: ['舊選項'] },
  { _id: 'f-objsel', label: '物件選項', type_1: 'select', options: [{ label: 'A', value: 'a' }] },
  { _id: 'f-chk', label: '多選', type_1: 'checkbox', options: ['一', '二'] },
  { _id: 'f-file', label: '附件', type_1: 'file' },
  { _id: 'f-user', label: '員工', type_1: 'user' },
]

const run = (formData, list = fields) => sanitizeApprovalFormData({ fields: list, formData })

describe('sanitizeApprovalFormData', () => {
  it('keeps the values the front end sends (ids as keys, ISO strings, option strings, arrays)', () => {
    const { data, fileFieldIds } = run({
      'f-text': '出差', 'f-area': '內容', 'f-num': 3, 'f-date': '2026-03-01T16:00:00.000Z',
      'f-dt': '2026-03-02T01:00:00.000Z', 'f-time': '1970-01-01T01:00:00.000Z', 'f-sel': '甲',
      'f-chk': ['一'], 'f-file': [], 'f-user': oidLike(),
    })

    expect(data['f-text']).toBe('出差')
    expect(data['f-num']).toBe(3)
    expect(data['f-date']).toBe('2026-03-01T16:00:00.000Z')
    expect(data['f-chk']).toEqual(['一'])
    expect(data['f-file']).toEqual([])
    expect(fileFieldIds).toEqual(['f-file'])
  })

  it('drops keys that are not fields of the form (hours, days, amount ... never reach payroll)', () => {
    const { data } = run({ 'f-text': 'x', hours: 0.001, days: 9, amount: 50000, bonus: 1, 金額額外: 1, __proto__: { polluted: true } })
    expect(Object.keys(data)).toEqual(['f-text'])
  })

  it('maps label keys of older callers back to the field id', () => {
    const { data } = run({ 事由: '舊式送法', 'f-num': 1 })
    expect(data['f-text']).toBe('舊式送法')
  })

  it('prefers the id key over a label key for the same field', () => {
    const { data } = run({ 事由: 'label', 'f-text': 'id' })
    expect(data['f-text']).toBe('id')
  })

  it('stores numeric strings as numbers and rejects non-numeric number fields', () => {
    expect(run({ 'f-num': '12.5' }).data['f-num']).toBe(12.5)
    expect(run({ 'f-num': '' }).data['f-num']).toBe('')
    expect(() => run({ 'f-num': 'abc' })).toThrow(/金額/)
    expect(() => run({ 'f-num': { a: 1 } })).toThrow(/數字/)
    expect(() => run({ 'f-num': 1e12 })).toThrow(/合理/)
  })

  it('rejects objects and arrays in text fields', () => {
    expect(() => run({ 'f-text': { a: 1 } })).toThrow(/事由/)
    expect(() => run({ 'f-area': ['x'] })).toThrow(/說明/)
  })

  it('validates date fields', () => {
    expect(() => run({ 'f-date': 'not a date' })).toThrow(/日期/)
    expect(() => run({ 'f-date': 20260301 })).toThrow(/日期/)
    expect(run({ 'f-time': '09:30' }).data['f-time']).toBe('09:30')
    expect(run({ 'f-date': '' }).data['f-date']).toBe('')
  })

  it('checks select values only against static string options', () => {
    expect(() => run({ 'f-sel': '丙' })).toThrow(/類別/)
    expect(run({ 'f-sel': '乙' }).data['f-sel']).toBe('乙')
    // 連結字典的欄位（標籤尾端 (C12)）選項即時變動，不比對備援選項
    expect(run({ 'f-dict': '特休假' }).data['f-dict']).toBe('特休假')
    // 物件選項不比對
    expect(run({ 'f-objsel': 'zzz' }).data['f-objsel']).toBe('zzz')
    // 舊資料的 { label, value } 選取值可以接受
    expect(run({ 'f-dict': { label: '特休假', value: '特休假' } }).data['f-dict']).toEqual({ label: '特休假', value: '特休假' })
  })

  it('validates checkbox arrays', () => {
    expect(() => run({ 'f-chk': ['一', '三'] })).toThrow(/多選/)
    expect(() => run({ 'f-chk': [{ a: 1 }] })).toThrow(/多選/)
    expect(run({ 'f-chk': '' }).data['f-chk']).toEqual([])
  })

  it('only accepts attachment urls inside the approval upload directory', () => {
    const good = run({ 'f-file': [{ name: 'a.pdf', url: '/upload/approvals/1700000000000-abcdef0123456789.pdf', size: 99999, type: 'application/pdf' }] })
    expect(good.data['f-file']).toEqual([{ name: 'a.pdf', url: '/upload/approvals/1700000000000-abcdef0123456789.pdf' }])
    expect(collectAttachmentFilenames(good.data, good.fileFieldIds)).toEqual(['1700000000000-abcdef0123456789.pdf'])

    expect(() => run({ 'f-file': [{ url: '/upload/approvals/../../secret.txt' }] })).toThrow(/附件/)
    expect(() => run({ 'f-file': [{ url: 'https://evil.example/x.pdf' }] })).toThrow(/附件/)
    expect(() => run({ 'f-file': ['plain string'] })).toThrow(/附件/)
  })

  it('rejects a body that is not a plain object or is too large', () => {
    expect(() => run([1, 2])).toThrow(/格式/)
    expect(() => run('text')).toThrow(/格式/)
    const huge = { 'f-area': 'x'.repeat(MAX_FORM_DATA_BYTES + 10) }
    expect(() => run(huge)).toThrow(/過大/)
    expect(run(undefined).data).toEqual({})
    expect(run(null).data).toEqual({})
  })

  it('limits the length of a single text value', () => {
    expect(() => run({ 'f-text': 'x'.repeat(2001) })).toThrow(/過長/)
  })
})

function oidLike() {
  return '507f1f77bcf86cd799439011'
}
