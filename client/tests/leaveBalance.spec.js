import { describe, it, expect } from 'vitest'
import {
  describeOver,
  evaluateRequest,
  formatDays,
  formatDaysAndHours,
  formatHours,
  formatHoursWithDays,
  matchBalanceItem,
  readAnnualLeaveHours,
} from '../src/utils/leaveBalance'

const item = (patch) => ({
  key: 'personal', name: '事假', aliases: [], period: 'year', source: 'policy', enforcement: 'warn', status: 'ok',
  quotaHours: 112, usedHours: 44, pendingHours: 0, remainingHours: 68, availableHours: 68, countsAgainst: null, ...patch,
})

describe('hours and day formatting', () => {
  it('writes hours first and the day equivalent next to them (1 day = 8 hours)', () => {
    expect(formatHours(40)).toBe('40 小時')
    expect(formatHours(7.5)).toBe('7.5 小時')
    expect(formatDays(44)).toBe('5.5 天')
    expect(formatDaysAndHours(40)).toBe('5 天')
    expect(formatDaysAndHours(44)).toBe('5 天 4 小時')
    expect(formatDaysAndHours(4)).toBe('4 小時')
    expect(formatDaysAndHours(-4)).toBe('-4 小時')
    expect(formatHoursWithDays(44)).toBe('44 小時（5 天 4 小時）')
    expect(formatHoursWithDays(40)).toBe('40 小時（5 天）')
    expect(formatHoursWithDays(null)).toBe('—')
  })

  it('describes how far a type is over its quota', () => {
    expect(describeOver({ remainingHours: -12 })).toBe('已超出 12 小時')
    expect(describeOver({ remainingHours: 3 })).toBe('')
    expect(describeOver(null)).toBe('')
  })
})

describe('matchBalanceItem (same rules as the server)', () => {
  const items = [
    item({ key: 'annual', name: '特休', aliases: ['特休假', '特別休假'], source: 'employee' }),
    item({ key: 'personal', name: '事假' }),
    item({ key: 'sick', name: '病假', aliases: ['普通傷病假'] }),
    item({ key: 'work_injury', name: '公傷病假', aliases: ['公傷假'] }),
  ]

  it('matches names and aliases, ignoring spaces and brackets', () => {
    expect(matchBalanceItem(items, '事假').key).toBe('personal')
    expect(matchBalanceItem(items, ' 請事假 ').key).toBe('personal')
    expect(matchBalanceItem(items, '特別休假').key).toBe('annual')
    expect(matchBalanceItem(items, '普通傷病假（住院）').key).toBe('sick')
  })

  it('prefers the longest alias, and knows 特休 only by its exact names', () => {
    expect(matchBalanceItem(items, '公傷病假').key).toBe('work_injury')
    expect(matchBalanceItem(items, '特休假（上午）')).toBeUndefined()
  })

  it('returns undefined for nothing or an unknown type', () => {
    expect(matchBalanceItem(items, '')).toBeUndefined()
    expect(matchBalanceItem(items, '神祕假')).toBeUndefined()
    expect(matchBalanceItem(null, '事假')).toBeUndefined()
  })
})

describe('evaluateRequest (the hint under the form)', () => {
  it('tells the remaining hours before and after a request that fits', () => {
    const result = evaluateRequest(item(), [], 8)
    expect(result).toMatchObject({ level: 'info', exceeded: false, remainingAfter: 60 })
    expect(result.text).toBe('事假：目前可請 68 小時（8 天 4 小時）；本次申請 8 小時，核准後剩 60 小時（7 天 4 小時）')
  })

  it('warns, still allowing the filing, when a soft quota is exceeded', () => {
    const result = evaluateRequest(item({ usedHours: 44, pendingHours: 0 }), [], 80)
    expect(result).toMatchObject({ level: 'warning', exceeded: true, blocking: false })
    expect(result.text).toBe('事假今年額度 112 小時，已使用 44 小時，可請 68 小時，本次申請 80 小時，將超出 12 小時，仍可送出，簽核人會看到超額')
  })

  it('says the request cannot be filed when the admin set the type to block, and counts pending hours', () => {
    const result = evaluateRequest(item({ enforcement: 'block', usedHours: 100, pendingHours: 8, remainingHours: 12, availableHours: 4 }), [], 8)
    expect(result).toMatchObject({ level: 'error', exceeded: true, blocking: true })
    expect(result.text).toContain('已使用 100 小時、簽核中 8 小時')
    expect(result.text).toContain('無法送出')
  })

  it('compares 特休 with the remaining hours of the employee record', () => {
    const annual = item({ key: 'annual', name: '特休', source: 'employee', enforcement: 'block', quotaHours: 80, usedHours: 72, remainingHours: 8, availableHours: 8 })
    expect(evaluateRequest(annual, [], 8).exceeded).toBe(false)
    expect(evaluateRequest(annual, [], 9)).toMatchObject({ level: 'error', blocking: true })
    expect(evaluateRequest({ ...annual, status: 'unconfigured' }, [], 100)).toMatchObject({ exceeded: false })
  })

  // 伺服器對特休超過剩餘時數一律回 400（不看超額處理的設定），提示不能說「仍可送出」
  it('always treats 特休 over the remaining hours as blocking, whatever the stored over-quota setting says', () => {
    const base = { key: 'annual', name: '特休', source: 'employee', quotaHours: 80, usedHours: 72, remainingHours: 8, availableHours: 8 }
    for (const enforcement of ['warn', 'none', 'block', undefined]) {
      const result = evaluateRequest(item({ ...base, enforcement }), [], 9)
      expect(result).toMatchObject({ level: 'error', exceeded: true, blocking: true })
      expect(result.text).toContain('無法送出')
      expect(result.text).not.toContain('仍可送出')
      expect(evaluateRequest(item({ ...base, enforcement }), [], 8).exceeded).toBe(false)
    }
    // 其他假別的 warn 仍然只是警告
    expect(evaluateRequest(item({ enforcement: 'warn', usedHours: 44 }), [], 80)).toMatchObject({ level: 'warning', blocking: false })
  })

  it('compares per-event types with the per-request ceiling and has no remaining to show', () => {
    const marriage = item({ key: 'marriage', name: '婚假', period: 'event', quotaHours: 64, remainingHours: null, availableHours: null })
    expect(evaluateRequest(marriage, [], 64).exceeded).toBe(false)
    expect(evaluateRequest(marriage, [], 72).text).toContain('婚假每次最多 64 小時，本次申請 72 小時，超出 8 小時')
  })

  it('also checks the type it counts against (家庭照顧假 uses up 事假)', () => {
    const personal = item({ key: 'personal', usedHours: 108, remainingHours: 4, availableHours: 4 })
    const family = item({ key: 'family_care', name: '家庭照顧假', quotaHours: 56, usedHours: 0, remainingHours: 56, availableHours: 56, countsAgainst: { key: 'personal', exemptHours: 0 } })
    const result = evaluateRequest(family, [personal, family], 8)
    expect(result.exceeded).toBe(true)
    expect(result.text).toContain('家庭照顧假會併入事假計算')
    expect(result.text).toContain('本次併入 8 小時，將超出 4 小時')

    const menstrual = item({ key: 'menstrual', name: '生理假', quotaHours: 96, usedHours: 0, remainingHours: 96, availableHours: 96, countsAgainst: { key: 'sick', exemptHours: 24 } })
    const sick = item({ key: 'sick', name: '病假', usedHours: 238, remainingHours: 2, availableHours: 2 })
    expect(evaluateRequest(menstrual, [sick, menstrual], 8).exceeded).toBe(false) // 24 小時內不併入病假
  })

  it('shows nothing for a missing type or hours', () => {
    expect(evaluateRequest(undefined, [], 8)).toBeNull()
    expect(evaluateRequest(item(), [], 0)).toBeNull()
    expect(evaluateRequest(item({ status: 'manual', quotaHours: 6, availableHours: 6 }), [], 100).exceeded).toBe(false)
  })
})

describe('readAnnualLeaveHours (same reading as the server)', () => {
  it('uses the hours fields and reads old day fields the way the migration does', () => {
    expect(readAnnualLeaveHours({ totalHours: 80, usedHours: 12.5, totalDays: 99 })).toMatchObject({ totalHours: 80, usedHours: 12.5, remainingHours: 67.5, legacy: false })
    expect(readAnnualLeaveHours({ totalDays: 14, usedDays: 3 })).toMatchObject({ totalHours: 112, usedHours: 24, unitSource: 'migrated-days', legacy: true })
    expect(readAnnualLeaveHours({ totalDays: 170, usedDays: 8 })).toMatchObject({ totalHours: 170, usedHours: 8, unitSource: 'migrated-hours' })
    expect(readAnnualLeaveHours(undefined)).toMatchObject({ totalHours: 0, usedHours: 0, remainingHours: 0 })
  })
})
