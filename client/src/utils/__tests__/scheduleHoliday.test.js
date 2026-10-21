import { describe, it, expect } from 'vitest'
import { isCountedHoliday, getHolidayDisplayName } from '../scheduleHoliday.js'

describe('isCountedHoliday（排班標頭只標示算假日的紀錄）', () => {
  it('國定假日與其他假日類型算假日', () => {
    expect(isCountedHoliday({ type: '國定假日', name: '端午節' })).toBe(true)
    expect(isCountedHoliday({ type: '假日', name: '連假' })).toBe(true)
    expect(isCountedHoliday({ type: 'holiday', name: 'Labor Day' })).toBe(true)
  })

  it('沒有 type 的紀錄依資料表預設值視為國定假日', () => {
    expect(isCountedHoliday({ name: '元旦' })).toBe(true)
    expect(isCountedHoliday({ type: '', name: '元旦' })).toBe(true)
  })

  it('補班日與工作日不算假日', () => {
    expect(isCountedHoliday({ type: '補班日', name: '補班' })).toBe(false)
    expect(isCountedHoliday({ type: '工作日', name: '' })).toBe(false)
    expect(isCountedHoliday({ type: '國定假日', name: '補班上課' })).toBe(false)
    expect(isCountedHoliday({ type: 'makeup work', name: '' })).toBe(false)
  })

  it('公司自訂的例假日 / 公司休息日紀錄不算假日', () => {
    expect(isCountedHoliday({ type: '例假日', name: '週休' })).toBe(false)
    expect(isCountedHoliday({ type: '公司休息日', name: '尾牙' })).toBe(false)
  })

  it('空值或非物件不算假日', () => {
    expect(isCountedHoliday(null)).toBe(false)
    expect(isCountedHoliday(undefined)).toBe(false)
    expect(isCountedHoliday('國定假日')).toBe(false)
  })
})

describe('isCountedHoliday（行事曆分類：kind / displayKind）', () => {
  it('標頭資料依 displayKind：國定假日與指定應放假日才標示', () => {
    expect(isCountedHoliday({ displayKind: 'holiday', kind: 'statutory', name: '和平紀念日' })).toBe(true)
    expect(isCountedHoliday({ displayKind: 'designated', kind: 'designated', name: '選舉' })).toBe(true)
    for (const displayKind of ['gov_info', 'company_off', 'company_workday', 'moved_away']) {
      expect(isCountedHoliday({ displayKind, kind: 'statutory', name: '國定假日' })).toBe(false)
    }
  })

  it('有 kind 的資料：公務機關補假（即使名稱是補假、類型寫國定假日）不算', () => {
    expect(isCountedHoliday({ kind: 'gov_makeup_off', type: '國定假日', name: '補假' })).toBe(false)
    expect(isCountedHoliday({ kind: 'gov_bridge_off', type: '國定假日', name: '調整放假' })).toBe(false)
    expect(isCountedHoliday({ kind: 'statutory', type: '補班日', name: '和平紀念日' })).toBe(true)
    expect(isCountedHoliday({ kind: 'designated', name: '公民投票' })).toBe(true)
  })

  it('沒有 kind 的舊資料比照 server：補假、調整放假、條例施行前的小年夜不算', () => {
    expect(isCountedHoliday({ type: '國定假日', name: '補假' })).toBe(false)
    expect(isCountedHoliday({ type: '假日', name: '調整放假' })).toBe(false)
    expect(isCountedHoliday({ type: '國定假日', name: '小年夜', date: '2023-01-20T00:00:00.000Z' })).toBe(false)
    expect(isCountedHoliday({ type: '國定假日', name: '小年夜', date: '2026-02-15T00:00:00.000Z' })).toBe(true)
    expect(isCountedHoliday({ type: '國定假日', name: '孔子誕辰紀念日', date: '2025-09-28T00:00:00.000Z' })).toBe(true)
  })
})

describe('getHolidayDisplayName', () => {
  it('依序取 name、description、desc', () => {
    expect(getHolidayDisplayName({ name: '端午節', description: 'x' })).toBe('端午節')
    expect(getHolidayDisplayName({ name: '', description: '中秋節' })).toBe('中秋節')
    expect(getHolidayDisplayName({ desc: '國慶日' })).toBe('國慶日')
    expect(getHolidayDisplayName(null)).toBe('')
  })
})

describe('isCountedHoliday（舊版一鍵載入留下的週末雜訊）', () => {
  it('來源是 roc-calendar、說明為空的週末不算假日', () => {
    expect(isCountedHoliday({ date: '2026-06-06T00:00:00.000Z', type: '國定假日', name: '假日', description: '', source: 'roc-calendar' })).toBe(false)
    expect(isCountedHoliday({ date: '2026-06-07T00:00:00.000Z', type: '國定假日', name: '假日', source: 'roc-calendar' })).toBe(false)
  })

  it('真正的國定假日（有說明）即使落在週末也算', () => {
    expect(isCountedHoliday({ date: '2026-10-10T00:00:00.000Z', type: '國定假日', name: '國慶日', description: '國慶日', source: 'roc-calendar' })).toBe(true)
  })

  it('人工新增或沒有來源標記的週末假日一律算，不能誤判成雜訊', () => {
    expect(isCountedHoliday({ date: '2026-06-06T00:00:00.000Z', type: '國定假日', name: '公司指定假日', source: 'manual' })).toBe(true)
    expect(isCountedHoliday({ date: '2026-06-06T00:00:00.000Z', type: '國定假日', name: '假日' })).toBe(true)
  })

  it('平日說明為空的資料不受影響', () => {
    expect(isCountedHoliday({ date: '2026-06-10T00:00:00.000Z', type: '國定假日', name: '假日', source: 'roc-calendar' })).toBe(true)
  })
})
