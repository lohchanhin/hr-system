import { describe, it, expect } from 'vitest'
import {
  buildCellKey,
  parseCellKey,
  normalizeOptionalReferenceId,
  sortEmployeesByDept,
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
