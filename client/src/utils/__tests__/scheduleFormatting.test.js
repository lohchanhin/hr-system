import { describe, it, expect } from 'vitest'
import {
  formatShiftLabel,
  formatScheduleImportIssue,
  formatScheduleImportPayloadIssues,
  normalizeNotificationDetails,
  parseDelegatedBoolean,
  getEmployeeIssueLabel,
  formatLaborRuleViolation,
} from '../scheduleFormatting.js'

describe('formatShiftLabel', () => {
  it('combines code and name as "CODE(name)"', () => {
    expect(formatShiftLabel({ code: 'D1', name: '早班' })).toBe('D1(早班)')
  })
  it('falls back to just the code when name is missing', () => {
    expect(formatShiftLabel({ code: 'D1' })).toBe('D1')
  })
  it('returns empty string for a missing shift or a shift with neither field', () => {
    expect(formatShiftLabel(null)).toBe('')
    expect(formatShiftLabel({})).toBe('')
  })
})

describe('formatScheduleImportIssue / formatScheduleImportPayloadIssues', () => {
  it('uses the shift-code phrasing when a day is present alongside a code', () => {
    expect(formatScheduleImportIssue({ row: 5, day: 10, code: 'A001', message: '找不到班別' }))
      .toBe('第 5 列／10 日／班別代號或名稱「A001」：找不到班別')
  })

  it('uses the employee-code phrasing when no day is present (row-level identity error)', () => {
    expect(formatScheduleImportIssue({ row: 3, code: 'A002', message: '員工不存在' }))
      .toBe('第 3 列／員工代號「A002」：員工不存在')
  })

  it('falls back to "-" for row and "資料錯誤" for message when omitted', () => {
    expect(formatScheduleImportIssue({})).toBe('第 - 列：資料錯誤')
  })

  it('maps every payload.errors entry through formatScheduleImportIssue', () => {
    const issues = formatScheduleImportPayloadIssues({
      errors: [{ row: 1, message: 'A' }, { row: 2, message: 'B' }],
    })
    expect(issues).toEqual(['第 1 列：A', '第 2 列：B'])
  })

  it('reports employee-id conflicts instead of row errors for EMPLOYEE_ID_AMBIGUOUS', () => {
    const issues = formatScheduleImportPayloadIssues({
      code: 'EMPLOYEE_ID_AMBIGUOUS',
      errors: [{ row: 1, message: 'ignored' }],
      conflicts: [{ employeeId: 'A001', count: 2 }],
    })
    expect(issues).toEqual(['員工代號「A001」在系統內有 2 筆資料，請先修正員工資料再匯入'])
  })
})

describe('normalizeNotificationDetails', () => {
  it('wraps a plain string detail as { message }', () => {
    expect(normalizeNotificationDetails(['hello'])).toEqual([{ message: 'hello' }])
  })

  it('normalizes an object detail, preferring rule/code and employee._id/employee', () => {
    const result = normalizeNotificationDetails([{
      rule: 'shift-gap', employee: { _id: 'e1' }, date: '2026-09-01', message: '間隔不足',
    }])
    expect(result).toEqual([{ rule: 'shift-gap', employee: 'e1', date: '2026-09-01', message: '間隔不足' }])
  })

  it('drops entries whose message is empty after trimming', () => {
    expect(normalizeNotificationDetails(['  ', { message: '' }])).toEqual([])
  })

  it('returns an empty array for non-array input', () => {
    expect(normalizeNotificationDetails(null)).toEqual([])
    expect(normalizeNotificationDetails('not-an-array')).toEqual([])
  })
})

describe('parseDelegatedBoolean', () => {
  it('reads a boolean checked property off a DOM-like target', () => {
    expect(parseDelegatedBoolean({ checked: true })).toBe(true)
    expect(parseDelegatedBoolean({ checked: false })).toBe(false)
  })
  it('returns undefined for a missing target or non-boolean checked', () => {
    expect(parseDelegatedBoolean(null)).toBeUndefined()
    expect(parseDelegatedBoolean({})).toBeUndefined()
  })
})

describe('getEmployeeIssueLabel', () => {
  const employees = [{ _id: 'e1', employeeId: 'A001', name: 'Alice' }]

  it('combines employeeId and name when the employee is found', () => {
    expect(getEmployeeIssueLabel('e1', employees)).toBe('A001 Alice')
  })
  it('falls back to a generic "員工 <id>" label when not found', () => {
    expect(getEmployeeIssueLabel('missing', employees)).toBe('員工 missing')
  })
  it('returns empty string for an empty/falsy id', () => {
    expect(getEmployeeIssueLabel('', employees)).toBe('')
    expect(getEmployeeIssueLabel(null, employees)).toBe('')
  })
})

describe('formatLaborRuleViolation', () => {
  const employees = [{ _id: 'e1', employeeId: 'A001', name: 'Alice' }]

  it('passes a plain string violation through unchanged', () => {
    expect(formatLaborRuleViolation('自訂訊息', employees)).toBe('自訂訊息')
  })

  it('composes employee label + date + mapped rule name + message', () => {
    const result = formatLaborRuleViolation({
      employee: 'e1', date: '2026-09-10', rule: 'shift-gap', message: '換班間隔不足',
    }, employees)
    expect(result).toBe('A001 Alice 2026-09-10 [換班休息間隔]：換班間隔不足')
  })

  it('falls back to the raw rule code when it is not in the known label map', () => {
    const result = formatLaborRuleViolation({ employee: 'e1', rule: 'some-new-rule', message: 'x' }, employees)
    expect(result).toContain('[some-new-rule]')
  })

  it('omits the date segment when no date/weekStart/startDate/dates is present', () => {
    const result = formatLaborRuleViolation({ employee: 'e1', message: '問題' }, employees)
    expect(result).toBe('A001 Alice：問題')
  })

  it('falls back to the generic message when none is provided', () => {
    const result = formatLaborRuleViolation({ employee: 'e1' }, employees)
    expect(result).toBe('A001 Alice：排班規範檢核未通過')
  })
})
