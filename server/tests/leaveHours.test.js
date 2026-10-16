import { describe, it, expect } from '@jest/globals'
import {
  DEFAULT_MAX_HOURS_PER_DAY,
  MAX_LEAVE_REQUEST_HOURS,
  daysToHours,
  formatHoursText,
  formatHoursWithDays,
  hoursToDays,
  isLeaveHoursFilled,
  isMultipleOfStep,
  maxHoursOfInterval,
  parseLeaveHours,
  roundHours,
} from '../src/utils/leaveHours.js'
import { computeLeaveDuration, parseLeaveInterval } from '../src/utils/leaveDuration.js'
import { computeLeaveRequestDays, computeLeaveRequestHours, isAnnualLeaveType } from '../src/services/leaveRequestDays.js'
import { isLeaveHoursLabel, pickLeaveFields } from '../src/utils/leaveFieldLabels.js'
import { resolveLeaveFieldsForRequest } from '../src/utils/leaveFieldResolution.js'
import { checkLeaveHours } from '../src/services/leaveHoursValidation.js'

// 台灣時間 2026-03-02 的時間點（UTC+8）
const tw = (day, time) => `2026-03-${day}T${time}:00+08:00`

describe('leave hours helpers', () => {
  it('parses a positive number from numbers and numeric text only', () => {
    expect(parseLeaveHours(4)).toBe(4)
    expect(parseLeaveHours('7.5')).toBe(7.5)
    expect(parseLeaveHours(' 2 ')).toBe(2)
    for (const bad of [0, -1, '', null, undefined, 'abc', true, NaN, Infinity]) {
      expect(parseLeaveHours(bad)).toBeNull()
    }
  })

  it('tells a filled field from a blank one (0 counts as filled, blanks do not)', () => {
    expect(isLeaveHoursFilled(0)).toBe(true)
    expect(isLeaveHoursFilled('3')).toBe(true)
    expect(isLeaveHoursFilled('')).toBe(false)
    expect(isLeaveHoursFilled('  ')).toBe(false)
    expect(isLeaveHoursFilled(null)).toBe(false)
    expect(isLeaveHoursFilled(undefined)).toBe(false)
  })

  it('checks multiples of the minimum unit with a floating point tolerance', () => {
    expect(isMultipleOfStep(4)).toBe(true)
    expect(isMultipleOfStep(4.5)).toBe(true)
    expect(isMultipleOfStep(4.25)).toBe(false)
    expect(isMultipleOfStep(4.25, 0.25)).toBe(true)
    expect(isMultipleOfStep(1.5, 1)).toBe(false)
    expect(isMultipleOfStep(0.1 + 0.2 + 0.2, 0.5)).toBe(true) // 0.5000000000000001
    expect(isMultipleOfStep(Number.NaN)).toBe(false)
  })

  it('converts between hours and days with 1 day = 8 hours and rounds to a stable precision', () => {
    expect(hoursToDays(40)).toBe(5)
    expect(hoursToDays(44)).toBe(5.5)
    expect(hoursToDays(7.5)).toBe(0.94)
    expect(hoursToDays(7.5, 8, 4)).toBe(0.9375)
    expect(daysToHours(0.5)).toBe(4)
    expect(daysToHours(14)).toBe(112)
    expect(roundHours(0.1 + 0.2)).toBe(0.3)
    expect(MAX_LEAVE_REQUEST_HOURS).toBe(366 * 8)
  })

  it('formats hours for messages', () => {
    expect(formatHoursText(40)).toBe('40 小時')
    expect(formatHoursText(7.5)).toBe('7.5 小時')
    expect(formatHoursWithDays(40)).toBe('40 小時（5 天）')
    expect(formatHoursWithDays(44)).toBe('44 小時（5.5 天）')
  })
})

describe('maxHoursOfInterval', () => {
  const max = (start, end, options, hoursPerDay) => maxHoursOfInterval(parseLeaveInterval(start, end, options), hoursPerDay)

  it('counts the real hours of a timed leave and caps every Taiwan day at the per-day maximum', () => {
    expect(max(tw('02', '09:00'), tw('02', '13:00'))).toBe(4)
    expect(max(tw('02', '07:00'), tw('02', '19:00'))).toBe(8) // 12 小時班，單日上限 8
    expect(max(tw('02', '07:00'), tw('02', '19:00'), {}, 12)).toBe(12) // 管理員把每日上限調成 12
    expect(max(tw('02', '23:00'), tw('03', '07:00'))).toBe(8) // 跨日：1 + 7 小時
  })

  it('gives whole days the full per-day maximum, inclusive of both ends', () => {
    expect(max('2026-07-01', '2026-07-02')).toBe(16)
    expect(max('2026-07-01', '2026-07-01', {}, 12)).toBe(12)
  })

  it('is zero for a missing or reversed interval', () => {
    expect(maxHoursOfInterval(null)).toBe(0)
    expect(max('2026-07-05', '2026-07-01')).toBe(0)
    expect(DEFAULT_MAX_HOURS_PER_DAY).toBe(8)
  })
})

describe('computeLeaveDuration with the hours field', () => {
  it('uses the hours field before the days field, the legacy keys and the dates', () => {
    const base = { startValue: tw('02', '09:00'), endValue: tw('02', '18:00') }
    expect(computeLeaveDuration({ ...base, filledHours: 3.5, filledDays: 2, literalDays: 5 }))
      .toMatchObject({ source: 'hours-field', hours: 3.5, days: 0.4375 })
    expect(computeLeaveDuration({ ...base, filledDays: 2 })).toMatchObject({ source: 'days-field', hours: 16 })
    expect(computeLeaveDuration({ ...base })).toMatchObject({ source: 'dates', hours: 8 })
  })

  it('ignores a blank or non-positive hours field and falls back to the next source', () => {
    const base = { startValue: '2026-03-02', endValue: '2026-03-03' }
    for (const blank of ['', 0, -2, 'x', null, undefined]) {
      expect(computeLeaveDuration({ ...base, filledHours: blank }).source).toBe('dates')
    }
  })

  it('spreads the typed hours over the calendar days of the range proportionally (same as the days field), so splitting by month keeps working', () => {
    const duration = computeLeaveDuration({ startValue: '2026-03-30', endValue: '2026-04-02', filledHours: 24 })
    expect(duration.hours).toBe(24)
    expect(duration.perDay.map(item => [item.dateKey, item.hours])).toEqual([
      ['2026-03-30', 6], ['2026-03-31', 6], ['2026-04-01', 6], ['2026-04-02', 6],
    ])
  })

  it('keeps a 12-hour shift of leave as 12 hours on that one day (the payroll cap of 8 per day does not shrink what was typed)', () => {
    const duration = computeLeaveDuration({ startValue: tw('02', '07:00'), endValue: tw('02', '19:00'), filledHours: 12 })
    expect(duration.hours).toBe(12)
    expect(duration.perDay).toEqual([{ dateKey: '2026-03-02', hours: 12 }])
  })

  it('splits an overnight leave over the two Taiwan days it touches', () => {
    const duration = computeLeaveDuration({ startValue: tw('02', '23:00'), endValue: tw('03', '07:00'), filledHours: 8 })
    expect(duration.perDay).toEqual([{ dateKey: '2026-03-02', hours: 1 }, { dateKey: '2026-03-03', hours: 7 }])
  })
})

describe('computeLeaveRequestHours', () => {
  const fields = { startId: 's', endId: 'e', daysId: 'd', hoursId: 'h', typeId: 't' }

  it('prefers the hours field, then the days field (x8), then the dates, then the legacy keys, then 8 hours', () => {
    expect(computeLeaveRequestHours({ formData: { s: '2026-03-02', e: '2026-03-03', d: 2, h: 5 }, leaveFields: fields }))
      .toEqual({ hours: 5, days: 0.625, source: 'hours-field', invalidRange: false })
    expect(computeLeaveRequestHours({ formData: { s: '2026-03-02', e: '2026-03-03', d: 1.5 }, leaveFields: fields }))
      .toEqual({ hours: 12, days: 1.5, source: 'days-field', invalidRange: false })
    expect(computeLeaveRequestHours({ formData: { s: '2026-03-02', e: '2026-03-04' }, leaveFields: fields }))
      .toEqual({ hours: 24, days: 3, source: 'dates', invalidRange: false })
    expect(computeLeaveRequestHours({ formData: { hours: 3 }, leaveFields: {} }))
      .toEqual({ hours: 3, days: 0.375, source: 'legacy', invalidRange: false })
    expect(computeLeaveRequestHours({ formData: { days: 2 }, leaveFields: {} }))
      .toEqual({ hours: 16, days: 2, source: 'legacy', invalidRange: false })
    expect(computeLeaveRequestHours({ formData: {}, leaveFields: {} }))
      .toEqual({ hours: 8, days: 1, source: 'default', invalidRange: false })
  })

  it('counts 09:00-13:00 as 4 hours, a 09:00-18:00 day as 8 and an overnight 23:00-07:00 leave as 8', () => {
    const hours = (start, end) => computeLeaveRequestHours({ formData: { s: start, e: end }, leaveFields: fields }).hours
    expect(hours(tw('02', '09:00'), tw('02', '13:00'))).toBe(4)
    expect(hours(tw('02', '09:00'), tw('02', '18:00'))).toBe(8)
    expect(hours(tw('02', '23:00'), tw('03', '07:00'))).toBe(8)
  })

  it('exposes half-hour exactness (0.5 hour steps never drift)', () => {
    let total = 0
    for (let i = 0; i < 100; i += 1) total = roundHours(total + 0.5)
    expect(total).toBe(50)
    expect(computeLeaveRequestHours({ formData: { h: '7.5' }, leaveFields: fields }).days).toBe(0.9375)
  })

  it('still reports a reversed range, even when the hours field is filled', () => {
    expect(computeLeaveRequestHours({ formData: { s: '2026-03-05', e: '2026-03-02', h: 4 }, leaveFields: fields }).invalidRange).toBe(true)
    expect(computeLeaveRequestHours({ formData: { s: '2026-03-05', e: '2026-03-02' }, leaveFields: fields }).invalidRange).toBe(true)
  })

  it('is what computeLeaveRequestDays converts to days (the old shape and sources are unchanged)', () => {
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-02', e: '2026-03-03', h: 12 }, leaveFields: fields }))
      .toEqual({ days: 1.5, source: 'hours', invalidRange: false })
    expect(computeLeaveRequestDays({ formData: { s: '2026-03-02', e: '2026-03-03', d: 1.5 }, leaveFields: fields }))
      .toEqual({ days: 1.5, source: 'field', invalidRange: false })
  })
})

describe('leave type recognition for 特休 (the same list the balances use)', () => {
  it('recognises 特休, 特休假 and 特別休假 (spaces and full-width characters ignored) but not other leave or names that merely contain them', () => {
    for (const name of ['特休', '特休假', '特別休假', ' 特休假 ', '特　休']) {
      expect(isAnnualLeaveType(name, [])).toBe(true)
    }
    for (const name of ['病假', '事假', '補休', '公假', '', '特休假（上午）', '特休保留']) {
      expect(isAnnualLeaveType(name, [])).toBe(false)
    }
  })
})

describe('hours field label recognition', () => {
  it('accepts the hours labels loosely and ignores the days labels', () => {
    for (const label of ['時數', '請假時數', '小時', ' 小時數 ', '請假時數（小時）', '請假時數(小時)']) {
      expect(isLeaveHoursLabel(label)).toBe(true)
    }
    for (const label of ['天數', '日期(起)', '事由', '假別']) {
      expect(isLeaveHoursLabel(label)).toBe(false)
    }
  })

  it('picks the hours field next to the other leave fields, preferring an active one', () => {
    const picked = pickLeaveFields([
      { _id: 'a', label: '假別', order: 1 },
      { _id: 'b', label: '開始時間', order: 2 },
      { _id: 'c', label: '結束時間', order: 3 },
      { _id: 'old', label: '時數', order: 4, is_active: false },
      { _id: 'new', label: '時數', order: 5 },
      { _id: 'd', label: '天數', order: 6, is_active: false },
    ])
    expect(picked.hoursField._id).toBe('new')
    expect(picked.daysField._id).toBe('d')
  })

  it('resolves the hours field per request: the first candidate that holds an answer', () => {
    const leaveFields = { hoursId: 'new', hoursIds: ['new', 'old'], typeId: 't' }
    expect(resolveLeaveFieldsForRequest(leaveFields, { old: 6 }).hoursId).toBe('old')
    expect(resolveLeaveFieldsForRequest(leaveFields, { new: 2, old: 6 }).hoursId).toBe('new')
    expect(resolveLeaveFieldsForRequest(leaveFields, {}).hoursId).toBe('new')
  })
})

describe('checkLeaveHours (hours field validation at filing)', () => {
  const check = (hoursValue, start, end, extra = {}) => checkLeaveHours({
    hoursValue, hoursFieldId: 'h', startValue: start, endValue: end, ...extra,
  })

  it('accepts hours within the range, in half-hour steps', () => {
    expect(check(4, tw('02', '09:00'), tw('02', '13:00'))).toEqual([])
    expect(check(2.5, tw('02', '09:00'), tw('02', '13:00'))).toEqual([]) // 比期間少是可以的
    expect(check(16, '2026-07-01', '2026-07-02')).toEqual([])
  })

  it('rejects zero, negative, non-numeric and off-step hours with the Chinese message', () => {
    for (const bad of [0, -1, 'abc', 3.3]) {
      expect(check(bad, '2026-07-01', '2026-07-02')).toEqual([{
        rule: 'leave-hours-invalid',
        message: '請假時數必須是大於 0 的數字，且以 0.5 小時為單位',
        fieldId: 'h',
      }])
    }
  })

  it('rejects more hours than the range can hold, naming the limit and the per-day maximum', () => {
    expect(check(5, tw('02', '09:00'), tw('02', '13:00'))).toEqual([expect.objectContaining({
      rule: 'leave-hours-range',
      message: '請假時數 5 小時超過所選期間可請的上限 4 小時（每日最多 8 小時）',
      maxHours: 4,
    })])
    expect(check(17, '2026-07-01', '2026-07-02')).toHaveLength(1)
    // 12 小時班：管理員把每日上限調成 12 之後，一整個班的 12 小時可以請
    expect(check(12, tw('02', '07:00'), tw('02', '19:00'), { maxHoursPerDay: 12 })).toEqual([])
    expect(check(12, tw('02', '07:00'), tw('02', '19:00'))).toHaveLength(1)
  })

  it('does nothing for a blank hours field or when the range cannot be read', () => {
    expect(check('', '2026-07-01', '2026-07-02')).toEqual([])
    expect(check(undefined, '2026-07-01', '2026-07-02')).toEqual([])
    expect(check(5, undefined, undefined)).toEqual([])
    expect(check(5, '2026-07-05', '2026-07-01')).toEqual([]) // 順序顛倒由請假規範（leave-time-range）處理
  })

  it('honours a different minimum unit', () => {
    expect(check(3.25, '2026-07-01', '2026-07-01', { minUnitHours: 0.25 })).toEqual([])
    expect(check(3.25, '2026-07-01', '2026-07-01', { minUnitHours: 1 })[0].message).toContain('以 1 小時為單位')
  })
})
