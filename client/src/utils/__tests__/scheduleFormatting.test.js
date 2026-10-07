import { describe, it, expect } from 'vitest'
import {
  formatShiftLabel,
  formatScheduleImportIssue,
  formatScheduleImportPayloadIssues,
  normalizeNotificationDetails,
  parseDelegatedBoolean,
  getEmployeeIssueLabel,
  formatLaborRuleViolation,
  formatScheduleImportWarning,
  limitDialogLines,
  buildScheduleImportConfirmMessage,
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

describe('formatScheduleImportWarning', () => {
  it('有列號時沿用匯入問題的格式', () => {
    expect(formatScheduleImportWarning({ row: 4, day: 19, code: '國', message: '系統假日日曆沒有該日期' }))
      .toBe('第 4 列／19 日／班別代號或名稱「國」：系統假日日曆沒有該日期')
  })

  it('沒有列號的提醒（例如匯入後檢核無法完成）只顯示訊息，不出現「第 - 列」', () => {
    expect(formatScheduleImportWarning({ row: null, day: null, code: '', message: '匯入已完成，但檢核暫時無法完成' }))
      .toBe('匯入已完成，但檢核暫時無法完成')
    expect(formatScheduleImportWarning('純文字提醒')).toBe('純文字提醒')
  })
})

describe('limitDialogLines', () => {
  it('未超過上限時原樣回傳（並濾掉空行）', () => {
    expect(limitDialogLines(['a', '', 'b'], 5)).toEqual(['a', 'b'])
    expect(limitDialogLines(undefined)).toEqual([])
  })

  it('超過上限時截斷並加上「…另有 N 項」', () => {
    const lines = Array.from({ length: 25 }, (_, index) => `第 ${index + 1} 項`)
    const limited = limitDialogLines(lines, 20)
    expect(limited).toHaveLength(21)
    expect(limited[19]).toBe('第 20 項')
    expect(limited[20]).toContain('…另有 5 項')
  })
})

describe('buildScheduleImportConfirmMessage', () => {
  it('列出員工數、班次數，沒有提醒時不出現提醒區塊', () => {
    const text = buildScheduleImportConfirmMessage({ employees: 8, scheduleDays: 240 })
    expect(text).toBe('將匯入 8 名員工、240 個班次。')
  })

  it('完整列出資料提醒與排班規範問題的文字，並顯示假日 / 請假標記天數', () => {
    const text = buildScheduleImportConfirmMessage({
      employees: 8,
      scheduleDays: 232,
      informationalDays: 8,
      skippedDays: 3,
      warnings: ['第 2 列／19 日／班別代號或名稱「國」：公版標記為國定假日，但系統假日日曆沒有該日期'],
      violations: ['A0003 2026-06-29 [每週一例一休]：該週沒有例假'],
    })
    expect(text).toContain('將匯入 8 名員工、232 個班次。')
    expect(text).toContain('班表中共有 8 天為國定假日或請假標記，其中 3 天因班別設定中沒有對應的班別，不會建立班表')
    expect(text).toContain('資料提醒（1 項）：\n・第 2 列／19 日／班別代號或名稱「國」：公版標記為國定假日')
    expect(text).toContain('排班規範問題（1 項，可先存為草稿，發布前必須修正）：\n・A0003 2026-06-29 [每週一例一休]：該週沒有例假')
    expect(text).not.toMatch(/[项资规范问题汇确认]/)
  })

  it('國定假日 / 請假標記的說明依略過天數調整', () => {
    const base = { employees: 1, scheduleDays: 5, informationalDays: 4 }
    expect(buildScheduleImportConfirmMessage({ ...base, skippedDays: 0 }))
      .toContain('班表中共有 4 天為國定假日或請假標記，皆已依班別設定存入班表。')
    expect(buildScheduleImportConfirmMessage({ ...base }))
      .toContain('班表中共有 4 天為國定假日或請假標記。')
    expect(buildScheduleImportConfirmMessage({ ...base, skippedDays: 99 }))
      .toContain('其中 4 天因班別設定中沒有對應的班別')
    expect(buildScheduleImportConfirmMessage({ employees: 1, scheduleDays: 5, informationalDays: 0, skippedDays: 0 }))
      .not.toContain('國定假日或請假標記')
  })

  it('清單過長時每個區塊各自截斷，收尾行不加項目符號', () => {
    const warnings = Array.from({ length: 30 }, (_, index) => `提醒 ${index + 1}`)
    const text = buildScheduleImportConfirmMessage({ employees: 1, scheduleDays: 1, warnings, lineLimit: 20 })
    expect(text).toContain('資料提醒（30 項）：')
    expect(text).toContain('・提醒 20')
    expect(text).not.toContain('提醒 21')
    expect(text).toContain('\n…另有 10 項')
    expect(text).not.toContain('・…另有')
  })

  it('覆蓋匯入時先說明會取代原班別', () => {
    const text = buildScheduleImportConfirmMessage({ employees: 1, scheduleDays: 3, overwriteCount: 2 })
    expect(text.startsWith('發現 2 個日期已有班表。選擇「覆蓋匯入」會取代原班別')).toBe(true)
    expect(text).toContain('將匯入 1 名員工、3 個班次。')
  })
})
