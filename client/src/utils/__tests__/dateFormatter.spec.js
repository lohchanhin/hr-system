import { describe, it, expect, afterEach } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatScheduleDate,
  formatTaiwanDate,
  formatTaiwanDateTime,
  formatTaiwanTime,
  formatTime,
  getTaiwanParts,
  scheduleDateKey,
  shiftDateKey,
  taiwanDateKey,
  taiwanWeekday,
  weekdayOfDateKey
} from '../dateFormatter'

describe('日期時間一律以台灣時間顯示', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('時間點換算成台灣的日期與時間（YYYY/MM/DD、HH:mm）', () => {
    // UTC 16:30 是台灣隔天 00:30
    const value = '2026-11-09T16:30:05.000Z'
    expect(formatTaiwanDate(value)).toBe('2026/11/10')
    expect(formatTaiwanTime(value)).toBe('00:30')
    expect(formatTaiwanTime(value, { seconds: true })).toBe('00:30:05')
    expect(formatTaiwanDateTime(value)).toBe('2026/11/10 00:30')
    expect(taiwanDateKey(value)).toBe('2026-11-10')
    expect(taiwanWeekday(value)).toBe('二')
    expect(getTaiwanParts(new Date(value))).toMatchObject({ year: '2026', month: '11', day: '10', hour: '00', minute: '30' })
  })

  it('裝置在其他時區時結果相同', () => {
    const value = '2026-11-09T16:30:00.000Z'
    // 確認測試環境真的換了時區：洛杉磯當地還是 11/9
    process.env.TZ = 'America/Los_Angeles'
    expect(new Date(value).getDate()).toBe(9)
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      process.env.TZ = tz
      expect(formatTaiwanDateTime(value)).toBe('2026/11/10 00:30')
      expect(taiwanDateKey(value)).toBe('2026-11-10')
      expect(formatDate(value)).toBe('2026-11-10')
      expect(formatTime(value)).toBe('00:30')
      expect(formatDateTime(value)).toBe('2026-11-10 00:30')
    }
  })

  it('無效或空白的值回傳空字串（舊函式回傳 -）', () => {
    expect(formatTaiwanDate('')).toBe('')
    expect(formatTaiwanDate('not a date', '—')).toBe('—')
    expect(formatTaiwanTime(null)).toBe('')
    expect(formatTaiwanDateTime(undefined)).toBe('')
    expect(taiwanDateKey('x')).toBe('')
    expect(formatDate('')).toBe('-')
    expect(formatDate('x')).toBe('-')
    expect(formatTime(null)).toBe('-')
    expect(formatDateTime(undefined)).toBe('-')
  })

  it('班表日期是「哪一天」，不做時區換算', () => {
    expect(scheduleDateKey('2026/11/02')).toBe('2026-11-02')
    expect(scheduleDateKey('2026-11-2')).toBe('2026-11-02')
    // 以 UTC 午夜儲存的班表日期
    expect(scheduleDateKey('2026-11-02T00:00:00.000Z')).toBe('2026-11-02')
    expect(scheduleDateKey(new Date(Date.UTC(2026, 10, 2)))).toBe('2026-11-02')
    expect(formatScheduleDate('2026-11-02T00:00:00.000Z')).toBe('2026/11/02')
    expect(scheduleDateKey('')).toBe('')
    expect(formatScheduleDate(undefined)).toBe('')
    process.env.TZ = 'America/Los_Angeles'
    expect(formatScheduleDate('2026-11-02T00:00:00.000Z')).toBe('2026/11/02')
  })

  it('日期鍵值的星期與加減天數', () => {
    expect(weekdayOfDateKey('2026-11-10')).toBe('二')
    expect(weekdayOfDateKey('2026-11-15')).toBe('日')
    expect(weekdayOfDateKey('bad')).toBe('')
    expect(shiftDateKey('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDateKey('2026-11-10', -7)).toBe('2026-11-03')
  })
})
