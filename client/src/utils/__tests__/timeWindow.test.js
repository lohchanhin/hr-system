import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildScheduleDate,
  computeActionWindow,
  computeShiftSpan,
  determineActionAvailability,
  formatWindow,
  getLocalDateParts,
  parseScheduleDate
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

  it('builds schedule date from local parts', () => {
    const parts = getLocalDateParts(new Date('2024-02-15T03:00:00.000Z'))
    const scheduleDate = buildScheduleDate(parts)
    expect(scheduleDate.toISOString()).toBe('2024-02-15T00:00:00.000Z')
  })
})
