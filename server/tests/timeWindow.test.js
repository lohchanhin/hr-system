import { describe, it, expect } from '@jest/globals'
import {
  buildScheduleDate,
  computeActionWindow,
  computeShiftSpan,
  createDateFromParts,
  formatWindow,
  getLocalDateParts,
  isWithinWindow,
  __TESTING__
} from '../src/utils/timeWindow.js'

describe('timeWindow utilities', () => {
  it('computes normal shift span in Asia/Taipei', () => {
    const scheduleDate = new Date(Date.UTC(2024, 0, 1))
    const shift = { startTime: '09:00', endTime: '18:00' }
    const span = computeShiftSpan(scheduleDate, shift)
    expect(span.start.toISOString()).toBe('2024-01-01T01:00:00.000Z')
    expect(span.end.toISOString()).toBe('2024-01-01T10:00:00.000Z')
  })

  it('extends cross-day shift end time to the next day', () => {
    const scheduleDate = new Date(Date.UTC(2024, 0, 1))
    const shift = { startTime: '22:00', endTime: '06:00', crossDay: true }
    const span = computeShiftSpan(scheduleDate, shift)
    expect(span.start.toISOString()).toBe('2024-01-01T14:00:00.000Z')
    expect(span.end.toISOString()).toBe('2024-01-01T22:00:00.000Z')
  })

  it('derives action windows with buffers', () => {
    const scheduleDate = new Date(Date.UTC(2024, 0, 1))
    const shift = { startTime: '09:00', endTime: '18:00' }
    const span = computeShiftSpan(scheduleDate, shift)
    const clockInWindow = computeActionWindow('clockIn', span.start, span.end)
    expect(clockInWindow.start.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(clockInWindow.end.toISOString()).toBe('2024-01-01T05:00:00.000Z')
    const clockOutWindow = computeActionWindow('clockOut', span.start, span.end)
    expect(clockOutWindow.start.toISOString()).toBe('2024-01-01T06:00:00.000Z')
    expect(clockOutWindow.end.toISOString()).toBe('2024-01-01T12:00:00.000Z')
  })

  it('formats time window label and checks membership', () => {
    const scheduleDate = new Date(Date.UTC(2024, 5, 10))
    const shift = { startTime: '08:30', endTime: '17:30' }
    const span = computeShiftSpan(scheduleDate, shift)
    const window = computeActionWindow('clockIn', span.start, span.end)
    const label = formatWindow(window)
    expect(label.start).toMatch(/^\d{2}:\d{2}$/)
    expect(label.end).toMatch(/^\d{2}:\d{2}$/)
    const inside = new Date('2024-06-10T02:00:00.000Z')
    const outside = new Date('2024-06-09T22:00:00.000Z')
    expect(isWithinWindow(inside, window)).toBe(true)
    expect(isWithinWindow(outside, window)).toBe(false)
  })

  it('uses custom action buffers from settings', () => {
    const scheduleDate = new Date(Date.UTC(2024, 2, 15))
    const span = computeShiftSpan(scheduleDate, { startTime: '10:00', endTime: '19:00' })
    const buffers = {
      clockIn: { earlyMinutes: 15, lateMinutes: 45 },
      clockOut: { earlyMinutes: 120, lateMinutes: 240 },
    }
    const customIn = computeActionWindow('clockIn', span.start, span.end, buffers)
    expect(customIn.start.toISOString()).toBe('2024-03-15T01:45:00.000Z')
    expect(customIn.end.toISOString()).toBe('2024-03-15T02:45:00.000Z')
    const customOut = computeActionWindow('clockOut', span.start, span.end, buffers)
    expect(customOut.start.toISOString()).toBe('2024-03-15T09:00:00.000Z')
    expect(customOut.end.toISOString()).toBe('2024-03-15T15:00:00.000Z')
  })

  it('clamps invalid buffer numbers to safe limits', () => {
    const normalized = __TESTING__.normalizeActionBuffers({
      clockIn: { earlyMinutes: -30, lateMinutes: 999 },
      clockOut: { earlyMinutes: 'abc', lateMinutes: 1000 }
    })
    expect(normalized.clockIn.earlyMinutes).toBe(0)
    expect(normalized.clockIn.lateMinutes).toBe(__TESTING__.BUFFER_LIMITS.lateMinutes.max)
    expect(normalized.clockOut.earlyMinutes).toBe(__TESTING__.DEFAULT_ACTION_BUFFERS.clockOut.earlyMinutes)
    expect(normalized.clockOut.lateMinutes).toBe(__TESTING__.BUFFER_LIMITS.lateMinutes.max)
  })

  it('builds schedule date from local parts', () => {
    const date = new Date('2024-03-15T03:00:00.000Z')
    const parts = getLocalDateParts(date)
    const scheduleDate = buildScheduleDate(parts)
    expect(scheduleDate.toISOString()).toBe('2024-03-15T00:00:00.000Z')
    const midnight = createDateFromParts({ ...parts }, 'Asia/Taipei')
    expect(midnight.toISOString()).toBe('2024-03-14T16:00:00.000Z')
  })
})
