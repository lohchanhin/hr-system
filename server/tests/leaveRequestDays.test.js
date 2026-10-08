import { describe, it, expect } from '@jest/globals'
import {
  collectLeaveTypeNames,
  computeLeaveRequestDays,
  isAnnualLeaveType,
  leaveStartInstant,
  parseLeaveDays,
} from '../src/services/leaveRequestDays.js'

const fields = { startId: 's', endId: 'e', daysId: 'd', typeId: 't' }

describe('computeLeaveRequestDays', () => {
  it('uses the 天數 field first, including half days', () => {
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-02', e: '2026-03-08', d: '0.5' }, leaveFields: fields }))
      .toEqual({ days: 0.5, source: 'field', invalidRange: false })
  })

  it('counts a full working day as one day (no +1 / ceil), and 4 hours as half a day like payroll and reports', () => {
    // 台灣 2026-03-02 09:00 ~ 18:00（UTC 01:00 ~ 10:00）：9 小時含午休，單日最多 8 小時 = 1 天
    expect(computeLeaveRequestDays({
      formData: { s: '2026-03-02T01:00:00.000Z', e: '2026-03-02T10:00:00.000Z' },
      leaveFields: { startId: 's', endId: 'e' },
    })).toEqual({ days: 1, source: 'dates', invalidRange: false })
    // 09:00 ~ 13:00 只有 4 小時
    expect(computeLeaveRequestDays({
      formData: { s: '2026-03-02T01:00:00.000Z', e: '2026-03-02T05:00:00.000Z' },
      leaveFields: { startId: 's', endId: 'e' },
    })).toEqual({ days: 0.5, source: 'dates', invalidRange: false })
  })

  it('counts the real hours of a leave that has clock times (2 hours, 6 hours, a half-day slot)', () => {
    const days = (start, end) => computeLeaveRequestDays({
      formData: { s: start, e: end },
      leaveFields: { startId: 's', endId: 'e' },
    }).days
    expect(days('2026-03-02T01:00:00.000Z', '2026-03-02T03:00:00.000Z')).toBe(0.25) // 09:00-11:00
    expect(days('2026-03-02T01:00:00.000Z', '2026-03-02T07:00:00.000Z')).toBe(0.75) // 09:00-15:00
    expect(days('2026-03-02T05:00:00.000Z', '2026-03-02T10:00:00.000Z')).toBe(0.625) // 13:00-18:00
  })

  it('keeps whole days and date ranges as before, and gives them the same number as payroll', () => {
    const leaveFields = { startId: 's', endId: 'e' }
    // 整天（日期字串、日期選擇器的午夜）
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-02', e: '2026-03-02' }, leaveFields }).days).toBe(1)
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-01T16:00:00.000Z', e: '2026-03-01T16:00:00.000Z' }, leaveFields }).days).toBe(1)
    // 09:00 到第三天 18:00：每一天都算整天，含週末也照日曆日（和薪資、報表一樣，不查班表）
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-06T01:00:00.000Z', e: '2026-03-09T10:00:00.000Z' }, leaveFields }).days).toBe(4)
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-06', e: '2026-03-09' }, leaveFields }).days).toBe(4)
  })

  it('still lets the 天數 field win over the times', () => {
    expect(computeLeaveRequestDays({
      formData: { s: '2026-03-02T01:00:00.000Z', e: '2026-03-02T05:00:00.000Z', d: 2 },
      leaveFields: fields,
    })).toEqual({ days: 2, source: 'field', invalidRange: false })
  })

  it('counts a zero-length leave (same start and end instant) as one day instead of nothing', () => {
    expect(computeLeaveRequestDays({
      formData: { s: '2026-03-02T01:00:00.000Z', e: '2026-03-02T01:00:00.000Z' },
      leaveFields: { startId: 's', endId: 'e' },
    })).toEqual({ days: 1, source: 'dates', invalidRange: false })
  })

  it('counts calendar days in Taiwan time, inclusive of both ends', () => {
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-02', e: '2026-03-04' }, leaveFields: fields }).days).toBe(3)
    // 日期選擇器的午夜：台灣 3/2 00:00 = 3/1 16:00Z，台灣 3/3 00:00 = 3/2 16:00Z → 兩天
    expect(computeLeaveRequestDays({
      formData: { s: '2026-03-01T16:00:00.000Z', e: '2026-03-02T16:00:00.000Z' },
      leaveFields: fields,
    }).days).toBe(2)
  })

  it('falls back to the dates when 天數 is blank or not a positive number', () => {
    for (const blank of ['', 0, -1, 'abc', null]) {
      expect(computeLeaveRequestDays({ formData: { s: '2026-03-02', e: '2026-03-03', d: blank }, leaveFields: fields }).days).toBe(2)
    }
  })

  it('reports an end date before the start date', () => {
    const result = computeLeaveRequestDays({ formData: { s: '2026-03-05', e: '2026-03-02' }, leaveFields: fields })
    expect(result.invalidRange).toBe(true)
    expect(result.days).toBe(1)
  })

  it('falls back to the legacy days value, then to one day', () => {
    expect(computeLeaveRequestDays({ formData: { days: 2 }, leaveFields: { startId: 's', endId: 'e' } }))
      .toEqual({ days: 2, source: 'legacy', invalidRange: false })
    expect(computeLeaveRequestDays({ formData: {}, leaveFields: {} }))
      .toEqual({ days: 1, source: 'default', invalidRange: false })
  })
})

describe('leave type recognition', () => {
  it('reads names from strings, objects, arrays and option labels', () => {
    const options = [{ value: 'AL', label: '特休' }]
    expect(collectLeaveTypeNames('AL', options)).toEqual(expect.arrayContaining(['AL', '特休']))
    expect(isAnnualLeaveType({ label: '特休假', value: 'x' }, [])).toBe(true)
    expect(isAnnualLeaveType(['病假'], [])).toBe(false)
    expect(isAnnualLeaveType('AL', options)).toBe(true)
  })

  it('parses day counts', () => {
    expect(parseLeaveDays('5')).toBe(5)
    expect(parseLeaveDays(0.5)).toBe(0.5)
    expect(parseLeaveDays('')).toBeNull()
    expect(parseLeaveDays(-2)).toBeNull()
  })
})

describe('leaveStartInstant', () => {
  it('treats a date-only value as the start of that day in Taiwan', () => {
    expect(leaveStartInstant('2026-03-02').toISOString()).toBe('2026-03-01T16:00:00.000Z')
  })

  it('parses ISO instants and rejects garbage', () => {
    expect(leaveStartInstant('2026-03-01T16:00:00.000Z').toISOString()).toBe('2026-03-01T16:00:00.000Z')
    expect(leaveStartInstant('nonsense')).toBeNull()
    expect(leaveStartInstant('')).toBeNull()
  })
})
