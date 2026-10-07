import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildScheduleDate,
  computeActionWindow,
  computeShiftSpan,
  determineActionAvailability,
  formatWindow,
  getLocalDateParts,
  isNonWorkShift,
  parseScheduleDate,
  __TESTING__
} from '../timeWindow'

describe('timeWindow utilities (client)', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('parses schedule dates with slash format', () => {
    const date = parseScheduleDate('2024/03/05')
    expect(date.toISOString()).toBe('2024-03-05T00:00:00.000Z')
  })

  it('computes shift span and window', () => {
    const scheduleDate = new Date(Date.UTC(2024, 4, 20))
    const shift = { startTime: '08:00', endTime: '17:00' }
    const span = computeShiftSpan(scheduleDate, shift)
    expect(span.start.toISOString()).toBe('2024-05-20T00:00:00.000Z')
    expect(span.end.toISOString()).toBe('2024-05-20T09:00:00.000Z')
    const window = computeActionWindow('clockOut', span.start, span.end)
    expect(window.start.toISOString()).toBe('2024-05-20T05:00:00.000Z')
    expect(window.end.toISOString()).toBe('2024-05-20T11:00:00.000Z')
  })

  it('treats an evening shift ending at midnight as eight hours across ICU versions', () => {
    const scheduleDate = new Date(Date.UTC(2024, 3, 1))
    const shift = { startTime: '16:00', endTime: '00:00', crossDay: true }
    const span = computeShiftSpan(scheduleDate, shift)

    expect(span.start.toISOString()).toBe('2024-04-01T08:00:00.000Z')
    expect(span.end.toISOString()).toBe('2024-04-01T16:00:00.000Z')
    expect(span.end.getTime() - span.start.getTime()).toBe(8 * 60 * 60 * 1000)
  })

  it('formats window in zh-TW locale', () => {
    const scheduleDate = new Date(Date.UTC(2024, 6, 1))
    const shift = { startTime: '09:30', endTime: '18:30' }
    const span = computeShiftSpan(scheduleDate, shift)
    const window = computeActionWindow('clockIn', span.start, span.end)
    const text = formatWindow(window, 'UTC')
    expect(text.start).toBe('00:30')
    expect(text.end).toBe('05:30')
  })

  it('returns disabled states when no schedules', () => {
    const result = determineActionAvailability({ now: new Date('2024-01-01T00:00:00Z') })
    expect(result.actions.clockIn.disabled).toBe(true)
    expect(result.actions.clockIn.reason).toContain('未設定班表')
  })

  it('detects availability for current shift', () => {
    const scheduleDate = new Date(Date.UTC(2024, 0, 1))
    const result = determineActionAvailability({
      now: new Date('2024-01-01T02:30:00.000Z'),
      schedules: [{ date: '2024/01/01', shiftId: 's1' }],
      shifts: [{ _id: 's1', startTime: '09:00', endTime: '18:00' }]
    })
    expect(result.actions.clockIn.disabled).toBe(false)
    expect(result.actions.clockOut.disabled).toBe(true)
    expect(result.actions.clockOut.reason).toContain('尚未開放')
  })

  it('handles cross-day shift for early morning clock out', () => {
    const result = determineActionAvailability({
      now: new Date('2024-01-01T21:30:00.000Z'),
      schedules: [{ date: '2024/01/01', shiftId: 'night' }],
      shifts: [{ _id: 'night', startTime: '22:00', endTime: '06:00', crossDay: true }]
    })
    expect(result.actions.clockOut.disabled).toBe(false)
  })

  it('applies custom buffer rules when provided', () => {
    const scheduleDate = new Date(Date.UTC(2024, 0, 1))
    const shift = { startTime: '09:00', endTime: '18:00' }
    const span = computeShiftSpan(scheduleDate, shift)
    const buffers = {
      clockIn: { earlyMinutes: 15, lateMinutes: 60 },
      clockOut: { earlyMinutes: 120, lateMinutes: 300 }
    }
    const window = computeActionWindow('clockIn', span.start, span.end, buffers)
    expect(window.start.toISOString()).toBe('2024-01-01T00:45:00.000Z')
    expect(window.end.toISOString()).toBe('2024-01-01T02:00:00.000Z')
    const availability = determineActionAvailability({
      now: new Date('2024-01-01T02:15:00.000Z'),
      schedules: [{ date: '2024/01/01', shiftId: 's1' }],
      shifts: [{ _id: 's1', ...shift }],
      actionBuffers: buffers
    })
    expect(availability.actions.clockIn.disabled).toBe(true)
  })

  it('clamps out-of-range buffer numbers', () => {
    const normalized = __TESTING__.normalizeActionBuffers({
      clockIn: { earlyMinutes: -5, lateMinutes: 800 },
      clockOut: { earlyMinutes: null, lateMinutes: 900 }
    })
    expect(normalized.clockIn.earlyMinutes).toBe(0)
    expect(normalized.clockIn.lateMinutes).toBe(__TESTING__.BUFFER_LIMITS.lateMinutes.max)
    expect(normalized.clockOut.earlyMinutes).toBe(0)
    expect(normalized.clockOut.lateMinutes).toBe(__TESTING__.BUFFER_LIMITS.lateMinutes.max)
  })

  describe('non-work shifts (rest day / regular rest / national holiday / leave)', () => {
    const zero = (_id, semanticType, extra = {}) => ({
      _id, semanticType, startTime: '00:00', endTime: '00:00', ...extra
    })

    it('isNonWorkShift mirrors the server rule', () => {
      expect(isNonWorkShift(null)).toBe(false)
      expect(isNonWorkShift({ semanticType: 'rest_day', startTime: '09:00', endTime: '18:00' })).toBe(true)
      expect(isNonWorkShift({ semanticType: 'regular_rest', startTime: '09:00', endTime: '18:00' })).toBe(true)
      expect(isNonWorkShift({ semanticType: 'holiday', startTime: '09:00', endTime: '18:00' })).toBe(true)
      expect(isNonWorkShift({ semanticType: 'LEAVE', startTime: '09:00', endTime: '18:00' })).toBe(true)
      expect(isNonWorkShift({ semanticType: 'work', startTime: '08:00', endTime: '17:00' })).toBe(false)
      expect(isNonWorkShift({ startTime: '22:00', endTime: '06:00', crossDay: true })).toBe(false)
      // 夜班 00:00-08:00 勾了跨日、小夜 16:00-00:00 勾了跨日，都是真的上班
      expect(isNonWorkShift({ semanticType: 'work', startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(false)
      expect(isNonWorkShift({ semanticType: 'work', startTime: '16:00', endTime: '00:00', crossDay: true })).toBe(false)
    })

    it('isNonWorkShift treats start == end without cross-day as no working time, whatever the semantic type', () => {
      expect(isNonWorkShift({ semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe(true)
      expect(isNonWorkShift({ startTime: '00:00', endTime: '00:00' })).toBe(true)
      expect(isNonWorkShift({ startTime: '8:00', endTime: '08:00:00' })).toBe(true)
      expect(isNonWorkShift({ semanticType: 'work', startTime: '00:00', endTime: '00:00', crossDay: true })).toBe(false)
      expect(isNonWorkShift({ semanticType: 'work' })).toBe(false)
    })

    it('computeShiftSpan follows the same cross-day rule as the server', () => {
      const scheduleDate = new Date(Date.UTC(2024, 5, 1))
      const hours = shift => {
        const span = computeShiftSpan(scheduleDate, shift, 'UTC')
        return (span.end.getTime() - span.start.getTime()) / 3600000
      }
      expect(hours({ startTime: '00:00', endTime: '00:00' })).toBe(0)
      expect(hours({ startTime: '00:00', endTime: '00:00', crossDay: true })).toBe(24)
      expect(hours({ startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(8)
      expect(hours({ startTime: '16:00', endTime: '00:00', crossDay: true })).toBe(8)
      expect(hours({ startTime: '22:00', endTime: '06:00' })).toBe(8)
    })

    it.each([
      ['rest_day', '今日為休息日，不需打卡'],
      ['holiday', '今日為國定假日，不需打卡'],
      ['leave', '今日為請假日，不需打卡'],
      ['regular_rest', '例假不得打卡或加班']
    ])('offers no clock window on a %s day', (semanticType, expectedReason) => {
      // 台北時間 2024-01-01 23:30：舊的 24 小時視窗(23:00-04:00)內
      const result = determineActionAvailability({
        now: new Date('2024-01-01T15:30:00.000Z'),
        schedules: [{ date: '2024/01/01', shiftId: 'off' }],
        shifts: [zero('off', semanticType)]
      })

      for (const action of ['clockIn', 'clockOut']) {
        expect(result.actions[action]).toEqual({
          disabled: true, reason: expectedReason, window: null, formatted: null
        })
      }
      expect(result.context).toBeNull()
      expect(result.dayOff.reason).toBe(expectedReason)
    })

    it('treats a zero-time shift whose semantic type says work as a day off', () => {
      const result = determineActionAvailability({
        now: new Date('2024-01-01T02:30:00.000Z'),
        schedules: [{ date: '2024/01/01', shiftId: 'legacy' }],
        shifts: [zero('legacy', 'work')]
      })
      expect(result.actions.clockIn.disabled).toBe(true)
      expect(result.actions.clockIn.reason).toBe('今日為休假日，不需打卡')
    })

    it('keeps yesterday\'s cross-day night shift clock-out open on the morning of a day off', () => {
      const shifts = [
        { _id: 'night', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true },
        zero('rest', 'rest_day')
      ]
      const schedules = [
        { date: '2023/12/31', shiftId: 'night' },
        { date: '2024/01/01', shiftId: 'rest' }
      ]
      // 台北時間 2024-01-01 06:30
      const result = determineActionAvailability({ now: new Date('2023-12-31T22:30:00.000Z'), schedules, shifts })

      expect(result.dayOff).toBeUndefined()
      expect(result.actions.clockOut.disabled).toBe(false)
      expect(result.actions.clockIn.disabled).toBe(true)
    })

    it('shows the day-off outcome instead of yesterday\'s finished day shift', () => {
      const shifts = [
        { _id: 'day', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
        zero('rest', 'rest_day')
      ]
      const schedules = [
        { date: '2023/12/31', shiftId: 'day' },
        { date: '2024/01/01', shiftId: 'rest' }
      ]
      const result = determineActionAvailability({ now: new Date('2024-01-01T02:30:00.000Z'), schedules, shifts })

      expect(result.actions.clockIn.reason).toBe('今日為休息日，不需打卡')
      expect(result.actions.clockOut.reason).toBe('今日為休息日，不需打卡')
    })

    it('finds today\'s day off among a whole month of schedules', () => {
      const shifts = [
        { _id: 'day', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
        zero('holiday', 'holiday')
      ]
      const schedules = [
        { date: '2024/01/01', shiftId: 'day' },
        { date: '2024/01/02', shiftId: 'holiday' },
        { date: '2024/01/03', shiftId: 'day' }
      ]
      const result = determineActionAvailability({ now: new Date('2024-01-02T02:30:00.000Z'), schedules, shifts })

      expect(result.actions.clockIn.disabled).toBe(true)
      expect(result.dayOff.reason).toBe('今日為國定假日，不需打卡')
    })

    it('reports no schedule when only another day is a day off', () => {
      const result = determineActionAvailability({
        now: new Date('2024-01-05T02:30:00.000Z'),
        schedules: [{ date: '2024/01/01', shiftId: 'rest' }],
        shifts: [zero('rest', 'rest_day')]
      })

      expect(result.actions.clockIn.reason).toContain('未設定班表')
      expect(result.dayOff).toBeUndefined()
    })

    it('still opens the window for a normal shift when yesterday was a day off', () => {
      const result = determineActionAvailability({
        now: new Date('2024-01-01T02:30:00.000Z'),
        schedules: [
          { date: '2023/12/31', shiftId: 'rest' },
          { date: '2024/01/01', shiftId: 'day' }
        ],
        shifts: [zero('rest', 'rest_day'), { _id: 'day', semanticType: 'work', startTime: '09:00', endTime: '18:00' }]
      })

      expect(result.actions.clockIn.disabled).toBe(false)
      expect(result.dayOff).toBeUndefined()
    })
  })

  it('builds schedule date from local parts', () => {
    const parts = getLocalDateParts(new Date('2024-02-15T03:00:00.000Z'))
    const scheduleDate = buildScheduleDate(parts)
    expect(scheduleDate.toISOString()).toBe('2024-02-15T00:00:00.000Z')
  })
})
