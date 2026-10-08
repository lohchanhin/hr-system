import { describe, it, expect } from 'vitest'
import {
  formatTaipeiDate,
  formatTaipeiDateTime,
  formatTaipeiTime,
  formatFormValue,
  normalizeFieldOptions,
  isBlankValue,
  personNameOrFallback,
} from '../src/utils/approvalDisplay'

describe('approvalDisplay 台灣時間格式', () => {
  it('UTC 時間換算成台灣時間，顯示 YYYY/MM/DD HH:mm', () => {
    // 稽核回報：台灣 06/19 09:00 的開始時間被顯示成 UTC 01:00
    expect(formatTaipeiDateTime('2026-06-19T01:00:00.000Z')).toBe('2026/06/19 09:00')
    // 台灣 00:00 起算的整天請假，不能顯示成前一天
    expect(formatTaipeiDateTime('2026-11-01T16:00:00.000Z')).toBe('2026/11/02 00:00')
    expect(formatTaipeiDate('2026-11-01T16:00:00.000Z')).toBe('2026/11/02')
  })

  it('午夜與跨年不會出現 24 點或前一天', () => {
    expect(formatTaipeiDateTime('2026-12-31T16:00:00.000Z')).toBe('2027/01/01 00:00')
    expect(formatTaipeiTime('2026-12-31T15:59:00.000Z')).toBe('23:59')
  })

  it('接受 Date 與時間戳記', () => {
    const date = new Date('2026-03-05T05:30:00.000Z')
    expect(formatTaipeiDateTime(date)).toBe('2026/03/05 13:30')
    expect(formatTaipeiDateTime(date.getTime())).toBe('2026/03/05 13:30')
  })

  it('沒有時區資訊的日期 / 時間字串視為已經是台灣時間，原樣顯示', () => {
    expect(formatTaipeiDate('2026-11-02')).toBe('2026/11/02')
    expect(formatTaipeiDateTime('2026-11-02')).toBe('2026/11/02')
    expect(formatTaipeiDateTime('2026-11-02T08:30:00')).toBe('2026/11/02 08:30')
    expect(formatTaipeiDateTime('2026-11-02 08:30')).toBe('2026/11/02 08:30')
    expect(formatTaipeiTime('08:05:00')).toBe('08:05')
  })

  it('空值與無法辨識的值回傳預設文字', () => {
    expect(formatTaipeiDateTime('')).toBe('-')
    expect(formatTaipeiDateTime(null)).toBe('-')
    expect(formatTaipeiDateTime(undefined)).toBe('-')
    expect(formatTaipeiDateTime('not a date')).toBe('-')
    expect(formatTaipeiDateTime('not a date', '無')).toBe('無')
  })
})

describe('approvalDisplay normalizeFieldOptions', () => {
  it('字串、{label,value}、{name,code} 與物件選項都統一成 {label,value}', () => {
    expect(normalizeFieldOptions({ options: ['休假', '事假'] })).toEqual([
      { label: '休假', value: '休假' },
      { label: '事假', value: '事假' },
    ])
    expect(normalizeFieldOptions({ options: [{ label: '特休假', value: 'ANNUAL' }] })).toEqual([
      { label: '特休假', value: 'ANNUAL' },
    ])
    expect(normalizeFieldOptions({ options: [{ name: '病假', code: 'SICK' }] })).toEqual([
      { label: '病假', value: '病假' },
    ])
    expect(normalizeFieldOptions({ options: { A: '甲' } })).toEqual([{ label: '甲', value: 'A' }])
    expect(normalizeFieldOptions({})).toEqual([])
    expect(normalizeFieldOptions(null)).toEqual([])
  })
})

describe('approvalDisplay personNameOrFallback', () => {
  it('有名稱用名稱；查不到名稱時不顯示資料庫編號', () => {
    expect(personNameOrFallback('Alice', 'u1')).toBe('Alice')
    expect(personNameOrFallback('', '6ac7a15ac47c42dfad21f594')).toBe('（無法辨識的人員）')
    expect(personNameOrFallback(undefined, 'E001')).toBe('E001')
    expect(personNameOrFallback(undefined, undefined)).toBe('-')
  })
})

describe('approvalDisplay formatFormValue', () => {
  const lookups = {
    user: id => ({ u1: '王小明' })[id],
    department: id => ({ d1: '護理部' })[id],
    org: id => ({ o1: '總院' })[id],
  }

  it('日期欄位用台灣時間顯示，不再顯示原始 ISO 字串', () => {
    expect(formatFormValue({ type_1: 'datetime' }, '2026-06-19T01:00:00.000Z')).toBe('2026/06/19 09:00')
    expect(formatFormValue({ type_1: 'date' }, '2026-06-18T16:00:00.000Z')).toBe('2026/06/19')
    expect(formatFormValue({ type_1: 'time' }, '2026-06-18T16:30:00.000Z')).toBe('00:30')
  })

  it('員工 / 部門 / 機構顯示名稱，不顯示資料庫編號', () => {
    const ctx = { lookups }
    expect(formatFormValue({ type_1: 'user' }, 'u1', ctx)).toBe('王小明')
    expect(formatFormValue({ type_1: 'department' }, 'd1', ctx)).toBe('護理部')
    expect(formatFormValue({ type_1: 'org' }, 'o1', ctx)).toBe('總院')
    const rawId = '6ac7a15ac47c42dfad21f594'
    expect(formatFormValue({ type_1: 'user' }, rawId, ctx)).not.toContain(rawId)
    expect(formatFormValue({ type_1: 'department' }, rawId, {})).not.toContain(rawId)
  })

  it('下拉與複選顯示選項的標籤', () => {
    const select = { type_1: 'select', options: [{ label: '病假', value: 'sick' }] }
    expect(formatFormValue(select, 'sick')).toBe('病假')
    const group = { type_1: 'checkbox', options: [{ label: '甲', value: 'a' }, { label: '乙', value: 'b' }] }
    expect(formatFormValue(group, ['a', 'b'])).toBe('甲、乙')
    // 值本身是 {label,value} 物件時也顯示標籤
    expect(formatFormValue(select, { label: '事假', value: 'personal' })).toBe('事假')
  })

  it('布林值顯示是 / 否，空字串與空陣列顯示 -', () => {
    expect(formatFormValue({ type_1: 'checkbox' }, true)).toBe('是')
    expect(formatFormValue({ type_1: 'checkbox' }, false)).toBe('否')
    expect(formatFormValue({ type_1: 'text' }, '')).toBe('-')
    expect(formatFormValue({ type_1: 'text' }, '   ')).toBe('-')
    expect(formatFormValue({ type_1: 'checkbox', options: ['a'] }, [])).toBe('-')
    expect(formatFormValue({ type_1: 'text' }, null)).toBe('-')
  })

  it('數字 0 要顯示，不當成空值', () => {
    expect(formatFormValue({ type_1: 'number' }, 0)).toBe('0')
    expect(isBlankValue(0)).toBe(false)
  })

  it('附件物件顯示檔名，不顯示 [object Object]', () => {
    const attachment = { name: 'proof.pdf', url: '/upload/approvals/x.pdf' }
    expect(formatFormValue(undefined, attachment)).toBe('proof.pdf')
    expect(formatFormValue(undefined, [attachment])).toBe('proof.pdf')
  })
})
