import { describe, it, expect } from 'vitest'
import {
  COMP_LEAVE_HELP_TEXT,
  describeBankSummary,
  describeCreditHours,
  describeUsage,
  formatDateKey,
  validateManualForm,
} from '../compensatoryLeave'
import { evaluateRequest, STATUS_LABELS } from '../leaveBalance'

describe('調休存摺的顯示文字', () => {
  it('formats a date key without any timezone shift', () => {
    expect(formatDateKey('2026-10-26')).toBe('2026/10/26')
    expect(formatDateKey('')).toBe('')
  })

  it('describes the hours of a credit: total, used, left and expired', () => {
    expect(describeCreditHours({ hours: 8, usedHours: 0, remainingHours: 8, status: 'available' })).toBe('8 小時，剩 8 小時')
    expect(describeCreditHours({ hours: 8, usedHours: 4, remainingHours: 4, status: 'partial' })).toBe('8 小時，已用 4 小時，剩 4 小時')
    expect(describeCreditHours({ hours: 8, usedHours: 8, remainingHours: 0, status: 'used' })).toBe('8 小時，已用 8 小時')
    expect(describeCreditHours({ hours: 8, usedHours: 2, remainingHours: 0, expiredHours: 6, status: 'expired' })).toBe('8 小時，已用 2 小時，過期 6 小時')
  })

  it('describes each use: a whole-day 調休 approval, half a day, an HR assignment with its note and an HR deduction', () => {
    expect(describeUsage({ kind: 'leave_request', kindLabel: '調休簽核', hours: 8, approvalStatus: 'approved', days: [{ date: '2026-10-26', hours: 8 }], fullDayDates: ['2026-10-26'] }))
      .toBe('調休簽核 8 小時（2026/10/26 整天，已核准）')
    expect(describeUsage({ kind: 'leave_request', hours: 4, approvalStatus: 'approved', days: [{ date: '2026-11-02', hours: 4 }], fullDayDates: [] }))
      .toBe('調休簽核 4 小時（2026/11/02 4 小時，已核准）')
    expect(describeUsage({ kind: 'hr_assigned', kindLabel: 'HR 指定', hours: 8, days: [{ date: '2026-03-02', hours: 8 }], fullDayDates: ['2026-03-02'], note: '與員工協商' }))
      .toBe('HR 指定 8 小時（2026/03/02 整天）：與員工協商')
    expect(describeUsage({ kind: 'adjustment', kindLabel: '人資扣除', hours: 2, days: [], fullDayDates: [], note: '更正' })).toBe('人資扣除 2 小時：更正')
  })

  it('sums up the bank in one line and explains how to use it', () => {
    expect(describeBankSummary({ availableHours: 12, balanceHours: 16, pendingHours: 4 })).toBe('可用 12 小時（1 天 4 小時）；存摺剩餘 16 小時、簽核中 4 小時')
    expect(describeBankSummary({ availableHours: 8, balanceHours: 8, pendingHours: 0 })).toBe('可用 8 小時（1 天）；存摺剩餘 8 小時')
    expect(COMP_LEAVE_HELP_TEXT).toContain('發起簽核')
  })

  it('checks the manual credit / deduction form: positive hours in the minimum unit and a note', () => {
    expect(validateManualForm({ hours: 0, note: 'x' })).toBe('請輸入大於 0 的時數')
    expect(validateManualForm({ hours: 1.2, note: 'x' })).toBe('時數必須是 0.5 小時的倍數')
    expect(validateManualForm({ hours: 1.5, note: 'x' }, { minUnitHours: 1 })).toBe('時數必須是 1 小時的倍數')
    expect(validateManualForm({ hours: 8, note: '  ' })).toBe('請填寫備註（給予或調整的原因）')
    expect(validateManualForm({ hours: 8, note: '加班換休' })).toBe('')
  })
})

describe('調休在請假單上的提示（與伺服器送出時的檢查相同）', () => {
  const comp = { key: 'comp', name: '調休', aliases: ['補休', '補假'], source: 'bank', enforcement: 'block', status: 'bank', period: 'none', quotaHours: 16, usedHours: 4, pendingHours: 4, remainingHours: 12, availableHours: 8 }

  it('shows how much of the bank is left after the request', () => {
    expect(evaluateRequest(comp, [comp], 8)).toMatchObject({ level: 'info', exceeded: false, remainingAfter: 0 })
    expect(evaluateRequest(comp, [comp], 8).text).toContain('調休：目前可請 8 小時')
  })

  it('refuses a request over the hours available (balance minus pending), whatever the stored over-quota setting says', () => {
    const verdict = evaluateRequest({ ...comp, enforcement: 'warn' }, [comp], 12)
    expect(verdict).toMatchObject({ level: 'error', exceeded: true, blocking: true })
    expect(verdict.text).toBe('調休存摺剩餘 12 小時、簽核中 4 小時，可用 8 小時，本次申請 12 小時，將超出 4 小時，無法送出')
    expect(STATUS_LABELS.bank).toBe('調休存摺')
  })
})
