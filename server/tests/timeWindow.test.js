import { describe, it, expect, jest } from '@jest/globals'
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

  it('treats an evening shift ending at midnight as eight hours across ICU versions', () => {
    const scheduleDate = new Date(Date.UTC(2024, 3, 1))
    const shift = { startTime: '16:00', endTime: '00:00', crossDay: true }
    const span = computeShiftSpan(scheduleDate, shift)

    expect(span.start.toISOString()).toBe('2024-04-01T08:00:00.000Z')
    expect(span.end.toISOString()).toBe('2024-04-01T16:00:00.000Z')
    expect(span.end.getTime() - span.start.getTime()).toBe(8 * 60 * 60 * 1000)
  })

  describe('computeShiftSpan crossDay semantics', () => {
    const scheduleDate = new Date(Date.UTC(2026, 5, 2))
    const hours = (span) => (span.end.getTime() - span.start.getTime()) / (60 * 60 * 1000)

    it('ignores the crossDay flag when the end time is later than the start time', () => {
      const span = computeShiftSpan(scheduleDate, { startTime: '00:00', endTime: '08:00', crossDay: true })
      expect(hours(span)).toBe(8)
      expect(span.start.toISOString()).toBe('2026-06-01T16:00:00.000Z')
      expect(span.end.toISOString()).toBe('2026-06-02T00:00:00.000Z')
      expect(hours(computeShiftSpan(scheduleDate, { startTime: '08:00', endTime: '17:00', crossDay: true }))).toBe(9)
    })

    it('keeps start equal to end with crossDay as a 24 hour span', () => {
      const span = computeShiftSpan(scheduleDate, { startTime: '00:00', endTime: '00:00', crossDay: true })
      expect(hours(span)).toBe(24)
    })

    it('turns start equal to end without crossDay into a zero length span, never 24 hours', () => {
      const span = computeShiftSpan(scheduleDate, { startTime: '00:00', endTime: '00:00' })
      expect(hours(span)).toBe(0)
      expect(span.end.getTime()).toBe(span.start.getTime())
      expect(hours(computeShiftSpan(scheduleDate, { startTime: '00:00', endTime: '00:00', crossDay: false }))).toBe(0)
    })

    it('still rolls an overnight shift (end earlier than start) to the next day with or without the flag', () => {
      expect(hours(computeShiftSpan(scheduleDate, { startTime: '22:00', endTime: '06:00' }))).toBe(8)
      expect(hours(computeShiftSpan(scheduleDate, { startTime: '22:00', endTime: '06:00', crossDay: true }))).toBe(8)
      expect(hours(computeShiftSpan(scheduleDate, { startTime: '16:00', endTime: '00:00' }))).toBe(8)
    })
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

// 排班檢核的耗時幾乎都花在每次呼叫就 new 一個 Intl.DateTimeFormat：改成每個時區只建一次，輸出必須和舊的逐次建立完全一樣。
// 下面兩個函式是改之前的做法（逐字照舊，每次呼叫都建新的 formatter），當作對照組。
describe('timeWindow formatter reuse', () => {
  function legacyCreateDateFromParts(parts, timeZone = 'Asia/Taipei') {
    const { year, month, day, hour = 0, minute = 0, second = 0 } = parts || {}
    if (!year || !month || !day) return null
    const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second)
    const baseDate = new Date(naiveUtc)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    const mapped = formatter.formatToParts(baseDate).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value
      return acc
    }, {})
    const mappedHour = Number(mapped.hour) === 24 ? 0 : Number(mapped.hour)
    const tzUtc = Date.UTC(
      Number(mapped.year),
      Number(mapped.month) - 1,
      Number(mapped.day),
      mappedHour,
      Number(mapped.minute),
      Number(mapped.second)
    )
    const offset = tzUtc - baseDate.getTime()
    return new Date(naiveUtc - offset)
  }

  function legacyGetLocalDateParts(date, timeZone = 'Asia/Taipei') {
    if (!date) return null
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    const parts = formatter.formatToParts(new Date(date)).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value
      return acc
    }, {})
    const year = Number(parts.year)
    const month = Number(parts.month)
    const day = Number(parts.day)
    if (!year || !month || !day) return null
    return { year, month, day }
  }

  // 台灣沒有日光節約；其他時區挑有日光節約、半小時與 45 分時差、跨日期變更線的，以及各自轉換日前後
  const ZONES = [
    'Asia/Taipei',
    'UTC',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'Asia/Kathmandu',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Australia/Lord_Howe',
    'Pacific/Auckland',
    'Pacific/Kiritimati',
    'Pacific/Pago_Pago'
  ]
  const PARTS = [
    { year: 2024, month: 1, day: 1 },
    { year: 2024, month: 1, day: 1, hour: 9, minute: 0 },
    { year: 2024, month: 2, day: 29, hour: 23, minute: 59, second: 59 },
    { year: 2024, month: 3, day: 10, hour: 2, minute: 30 },
    { year: 2024, month: 3, day: 10, hour: 3, minute: 0 },
    { year: 2024, month: 3, day: 31, hour: 1, minute: 30 },
    { year: 2024, month: 4, day: 7, hour: 2, minute: 15 },
    { year: 2024, month: 10, day: 6, hour: 2, minute: 15 },
    { year: 2024, month: 10, day: 27, hour: 1, minute: 30 },
    { year: 2024, month: 11, day: 3, hour: 1, minute: 30 },
    { year: 2026, month: 6, day: 2, hour: 22 },
    { year: 2026, month: 7, day: 1, hour: 0, minute: 0, second: 0 },
    { year: 2026, month: 12, day: 31, hour: 23, minute: 59, second: 59 },
    { year: 2027, month: 1, day: 1, hour: 0 }
  ]
  const INSTANTS = [
    '2024-01-01T00:00:00.000Z',
    '2024-03-10T06:59:59.000Z',
    '2024-03-10T07:00:00.000Z',
    '2024-03-31T00:59:59.000Z',
    '2024-03-31T01:00:00.000Z',
    '2024-04-06T14:29:59.000Z',
    '2024-04-06T14:30:00.000Z',
    '2024-10-26T14:30:00.000Z',
    '2024-10-27T00:59:59.000Z',
    '2024-11-03T05:59:59.000Z',
    '2024-11-03T06:00:00.000Z',
    '2026-06-01T16:00:00.000Z',
    '2026-12-31T23:59:59.999Z',
    new Date('2026-07-01T16:00:00.000Z'),
    Date.UTC(2026, 8, 30, 15, 59, 59)
  ]

  it('returns exactly what building a formatter on every call returned, over a table of time zones and dates', () => {
    let compared = 0
    for (const zone of ZONES) {
      for (const parts of PARTS) {
        expect(createDateFromParts(parts, zone)).toEqual(legacyCreateDateFromParts(parts, zone))
        compared += 1
      }
      for (const instant of INSTANTS) {
        expect(getLocalDateParts(instant, zone)).toEqual(legacyGetLocalDateParts(instant, zone))
        compared += 1
      }
    }
    // 沒有指定時區時用預設時區（台灣）
    for (const parts of PARTS) {
      expect(createDateFromParts(parts)).toEqual(legacyCreateDateFromParts(parts))
      compared += 1
    }
    for (const instant of INSTANTS) {
      expect(getLocalDateParts(instant)).toEqual(legacyGetLocalDateParts(instant))
      compared += 1
    }
    expect(compared).toBe(ZONES.length * (PARTS.length + INSTANTS.length) + PARTS.length + INSTANTS.length)
  })

  it('returns the same shift span as the per-call formatter for work, overnight and midnight-ending shifts', () => {
    const shifts = [
      { startTime: '08:00', endTime: '17:00' },
      { startTime: '22:00', endTime: '06:00', crossDay: true },
      { startTime: '16:00', endTime: '00:00', crossDay: true },
      { startTime: '00:00', endTime: '00:00', crossDay: true },
      { startTime: '00:00', endTime: '00:00' }
    ]
    for (const zone of ['Asia/Taipei', 'America/New_York', 'Europe/London']) {
      for (const shift of shifts) {
        for (const day of [new Date(Date.UTC(2024, 2, 9)), new Date(Date.UTC(2024, 2, 10)), new Date(Date.UTC(2026, 5, 2))]) {
          const baseParts = legacyGetLocalDateParts(day, zone)
          const expectedStart = legacyCreateDateFromParts({ ...baseParts, hour: Number(shift.startTime.slice(0, 2)), minute: 0 }, zone)
          let expectedEnd = legacyCreateDateFromParts({ ...baseParts, hour: Number(shift.endTime.slice(0, 2)), minute: 0 }, zone)
          if (expectedEnd < expectedStart || (expectedEnd.getTime() === expectedStart.getTime() && shift.crossDay)) {
            expectedEnd = new Date(expectedEnd.getTime() + 24 * 60 * 60 * 1000)
          }
          expect(computeShiftSpan(day, shift, zone)).toEqual({ start: expectedStart, end: expectedEnd })
        }
      }
    }
  })

  it('builds one formatter per time zone and reuses it for every later call', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat')
    try {
      // Pacific/Chatham 在這個檔案的其他測試都沒用過，所以第一次呼叫才會建立
      for (let index = 0; index < 40; index += 1) {
        createDateFromParts({ year: 2026, month: 7, day: 1 + (index % 28), hour: index % 24 }, 'Pacific/Chatham')
        getLocalDateParts(Date.UTC(2026, 6, 1 + (index % 28), index % 24), 'Pacific/Chatham')
        computeShiftSpan(new Date(Date.UTC(2026, 6, 1 + (index % 28))), { startTime: '08:00', endTime: '17:00' }, 'Pacific/Chatham')
      }
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toMatchObject({ timeZone: 'Pacific/Chatham' })

      // 預設時區（台灣）：先暖機，之後不論從哪個函式進來都不再建立
      computeShiftSpan(new Date(Date.UTC(2026, 6, 1)), { startTime: '08:00', endTime: '17:00' })
      const afterWarmUp = spy.mock.calls.length
      for (let index = 0; index < 100; index += 1) {
        computeShiftSpan(new Date(Date.UTC(2026, 6, 1 + (index % 28))), { startTime: '22:00', endTime: '06:00', crossDay: true })
        getLocalDateParts(Date.UTC(2026, 6, 1 + (index % 28)))
      }
      expect(spy.mock.calls.length).toBe(afterWarmUp)
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps throwing for an invalid time zone on every call (a failure is never cached)', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat')
    try {
      expect(() => createDateFromParts({ year: 2026, month: 7, day: 1 }, 'Not/AZone')).toThrow(RangeError)
      expect(() => createDateFromParts({ year: 2026, month: 7, day: 1 }, 'Not/AZone')).toThrow(RangeError)
      expect(() => getLocalDateParts(Date.UTC(2026, 6, 1), 'Not/AZone')).toThrow(RangeError)
      expect(spy).toHaveBeenCalledTimes(3)
    } finally {
      spy.mockRestore()
    }
  })
})
