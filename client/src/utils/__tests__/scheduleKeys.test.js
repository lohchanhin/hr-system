import { describe, it, expect } from 'vitest'
import {
  buildCellKey,
  parseCellKey,
  normalizeOptionalReferenceId,
  sortEmployeesByDept,
  parseScheduleDate,
  scheduleDayOfMonth,
  scheduleDateKey,
} from '../scheduleKeys.js'

describe('buildCellKey / parseCellKey', () => {
  it('round-trips an employee id and day number', () => {
    const key = buildCellKey('emp1', 5)
    expect(key).toBe('emp1::5')
    expect(parseCellKey(key)).toEqual({ empId: 'emp1', day: 5 })
  })

  it('uses the LAST "::" as the separator, so an id containing "::" still parses correctly', () => {
    const key = buildCellKey('weird::id', 10)
    expect(parseCellKey(key)).toEqual({ empId: 'weird::id', day: 10 })
  })

  it('returns NaN for the day when the key has no separator', () => {
    const result = parseCellKey('not-a-real-key')
    expect(result.empId).toBe('not-a-real-key')
    expect(Number.isNaN(result.day)).toBe(true)
  })
})

describe('normalizeOptionalReferenceId', () => {
  it('extracts _id from a populated Mongo document', () => {
    expect(normalizeOptionalReferenceId({ _id: 'dept1', name: 'X' })).toBe('dept1')
  })

  it('extracts id when _id is absent', () => {
    expect(normalizeOptionalReferenceId({ id: 'dept2' })).toBe('dept2')
  })

  it('passes through a plain id string unchanged', () => {
    expect(normalizeOptionalReferenceId('dept3')).toBe('dept3')
  })

  it('returns undefined for null/undefined/empty input', () => {
    expect(normalizeOptionalReferenceId(null)).toBeUndefined()
    expect(normalizeOptionalReferenceId(undefined)).toBeUndefined()
    expect(normalizeOptionalReferenceId('')).toBeUndefined()
    expect(normalizeOptionalReferenceId('   ')).toBeUndefined()
  })
})

describe('sortEmployeesByDept', () => {
  it('sorts by department first, then by name within the same department', () => {
    const input = [
      { name: '王小明', department: 'B部門' },
      { name: '陳大文', department: 'A部門' },
      { name: '林小美', department: 'A部門' },
    ]
    const sorted = sortEmployeesByDept(input)
    // Same department (A) sorts before B; localeCompare here uses the
    // runtime's default locale (no 'zh-Hant' argument), so within A the
    // ordering follows default Unicode/locale comparison, not pinyin.
    expect(sorted.map(e => e.name)).toEqual(['林小美', '陳大文', '王小明'])
  })

  it('does not mutate the original array', () => {
    const input = [{ name: 'B', department: 'X' }, { name: 'A', department: 'X' }]
    const original = [...input]
    sortEmployeesByDept(input)
    expect(input).toEqual(original)
  })

  it('treats missing department/name as empty strings rather than throwing', () => {
    const input = [{ name: 'Z' }, {}]
    expect(() => sortEmployeesByDept(input)).not.toThrow()
  })
})

describe('班表日期（伺服器存成該日的 UTC 午夜）', () => {
  it('UTC 午夜的字串直接取日期部分：1 號就是 1 號、月底就是月底', () => {
    expect(scheduleDayOfMonth('2026-11-01T00:00:00.000Z')).toBe(1)
    expect(scheduleDayOfMonth('2026-11-30T00:00:00.000Z')).toBe(30)
    expect(scheduleDayOfMonth('2027-01-01T00:00:00Z')).toBe(1)
    expect(scheduleDayOfMonth('2026-12-31')).toBe(31)
    expect(parseScheduleDate('2027-03-01T00:00:00.000Z')).toEqual({ year: 2027, month: 3, day: 1 })
    expect(scheduleDateKey('2026-11-01T00:00:00.000Z')).toBe('2026-11-01')
    expect(scheduleDateKey('2026-06-29')).toBe('2026-06-29')
  })

  it('不依電腦的時區換算：時區在 UTC 以西時，用本地時間換算會變成前一天', () => {
    const value = '2026-11-01T00:00:00.000Z'
    const originalTz = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      // 這個環境換得了時區時（本地時間是 10/31），確認結果仍然是 1 號；換不了就只驗證結果
      const localDay = new Date(value).getDate()
      expect(scheduleDayOfMonth(value)).toBe(1)
      expect(scheduleDateKey(value)).toBe('2026-11-01')
      if (localDay === 31) {
        expect(new Date(value).getMonth()).toBe(9)
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })

  it('其他格式維持用本地時間；無法解析回傳 NaN／空字串／null', () => {
    const localNoon = new Date(2026, 10, 5, 12, 0, 0)
    expect(scheduleDayOfMonth(localNoon)).toBe(5)
    expect(scheduleDayOfMonth(localNoon.toISOString())).toBe(5)
    expect(scheduleDateKey(localNoon)).toBe('2026-11-05')
    expect(Number.isNaN(scheduleDayOfMonth('不是日期'))).toBe(true)
    expect(Number.isNaN(scheduleDayOfMonth(''))).toBe(true)
    expect(scheduleDateKey(null)).toBe('')
    expect(parseScheduleDate(undefined)).toBeNull()
  })
})
