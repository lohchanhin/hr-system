import { jest } from '@jest/globals'

// 請假時數與班表：排 12 小時班的日子可以請整個班，休息日不算時數
const mockShiftSchedule = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }

let service
let leaveDuration
let hoursUtils

const DAY_SHIFT = { _id: 'shift-day', code: '日', name: '日班', startTime: '07:00', endTime: '19:00', semanticType: 'work' }
const NIGHT_SHIFT = { _id: 'shift-night', code: '夜', name: '夜班', startTime: '19:00', endTime: '07:00', crossDay: true, semanticType: 'work' }
const SHORT_SHIFT = { _id: 'shift-short', code: '短', name: '短班', startTime: '09:00', endTime: '17:00', semanticType: 'work' }
const REST_SHIFT = { _id: 'shift-rest', code: '休', name: '休息日', startTime: '00:00', endTime: '00:00', semanticType: 'rest_day' }
const HOLIDAY_SHIFT = { _id: 'shift-holiday', code: '國', name: '國定假日', startTime: '00:00', endTime: '00:00', semanticType: 'holiday' }

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
  await jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
  service = await import('../src/services/leaveShiftHours.js')
  leaveDuration = await import('../src/utils/leaveDuration.js')
  hoursUtils = await import('../src/utils/leaveHours.js')
})

beforeEach(() => {
  mockShiftSchedule.find.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockAttendanceSetting.findOne.mockReturnValue({ lean: async () => ({ shifts: [DAY_SHIFT, NIGHT_SHIFT, SHORT_SHIFT, REST_SHIFT, HOLIDAY_SHIFT] }) })
})

const schedule = (rows) => mockShiftSchedule.find.mockReturnValue({ lean: async () => rows.map(([date, shift]) => ({ date: new Date(`${date}T00:00:00.000Z`), shiftId: shift._id })) })
const interval = (start, end, options) => leaveDuration.parseLeaveInterval(start, end, options)
const tw = (day, time) => `2026-03-${day}T${time}:00+08:00`

describe('shiftSpanHours', () => {
  it('is the length of the shift, one day longer for shifts across midnight, and 0 for shifts without working time', () => {
    expect(service.shiftSpanHours(DAY_SHIFT)).toBe(12)
    expect(service.shiftSpanHours(NIGHT_SHIFT)).toBe(12)
    expect(service.shiftSpanHours(SHORT_SHIFT)).toBe(8)
    expect(service.shiftSpanHours(REST_SHIFT)).toBe(0)
    expect(service.shiftSpanHours({ startTime: '08:00', endTime: '08:00', crossDay: true })).toBe(24)
    expect(service.shiftSpanHours({ startTime: 'x', endTime: '08:00' })).toBe(0)
  })
})

describe('loadScheduledShiftHours', () => {
  it('maps each Taiwan date to the hours of the work shift scheduled that day, and marks rest days, holidays and leave as not working', async () => {
    schedule([['2026-03-02', DAY_SHIFT], ['2026-03-03', REST_SHIFT], ['2026-03-04', HOLIDAY_SHIFT], ['2026-03-05', SHORT_SHIFT]])

    const result = await service.loadScheduledShiftHours('emp1', '2026-03-02', '2026-03-06')

    expect(Object.fromEntries(result)).toEqual({
      '2026-03-02': { work: true, hours: 12 },
      '2026-03-03': { work: false, hours: 0 },
      '2026-03-04': { work: false, hours: 0 },
      '2026-03-05': { work: true, hours: 8 },
    })
    const filter = mockShiftSchedule.find.mock.calls[0][0]
    expect(filter.employee).toBe('emp1')
    expect(filter.date.$gte.toISOString()).toBe('2026-03-02T00:00:00.000Z')
    expect(filter.date.$lte.toISOString()).toBe('2026-03-06T00:00:00.000Z')
  })

  it('skips the settings lookup when nothing is scheduled and ignores shifts that no longer exist', async () => {
    schedule([])
    expect((await service.loadScheduledShiftHours('emp1', '2026-03-02', '2026-03-03')).size).toBe(0)
    expect(mockAttendanceSetting.findOne).not.toHaveBeenCalled()

    mockShiftSchedule.find.mockReturnValue({ lean: async () => [{ date: new Date('2026-03-02T00:00:00.000Z'), shiftId: 'gone' }] })
    expect((await service.loadScheduledShiftHours('emp1', '2026-03-02', '2026-03-02')).size).toBe(0)
  })
})

describe('day ceilings', () => {
  const scheduled = new Map([
    ['2026-03-02', { work: true, hours: 12 }],
    ['2026-03-03', { work: true, hours: 8 }],
    ['2026-03-04', { work: false, hours: 0 }],
  ])

  it('lets a scheduled shift longer than the daily maximum raise that day\'s ceiling, and nothing else', () => {
    expect(service.dayCeiling(scheduled, '2026-03-02', 8)).toBe(12)
    expect(service.dayCeiling(scheduled, '2026-03-03', 8)).toBe(8)
    expect(service.dayCeiling(scheduled, '2026-03-04', 8)).toBe(8)
    expect(service.dayCeiling(scheduled, '2026-03-09', 8)).toBe(8)
    expect([...service.extraCeilings(scheduled, 8)]).toEqual([['2026-03-02', 12]])
  })

  it('raises the maximum of a leave interval only on those days', () => {
    const extra = service.extraCeilings(scheduled, 8)
    // 3/2 的 12 小時班全天（07:00-19:00）可以請 12 小時；沒排長班的日子還是 8
    expect(hoursUtils.maxHoursOfInterval(interval(tw('02', '07:00'), tw('02', '19:00')), 8, extra)).toBe(12)
    expect(hoursUtils.maxHoursOfInterval(interval(tw('02', '07:00'), tw('02', '19:00')), 8)).toBe(8)
    expect(hoursUtils.maxHoursOfInterval(interval('2026-03-02', '2026-03-03'), 8, extra)).toBe(20) // 12 + 8
    expect(hoursUtils.maxHoursOfInterval(interval(tw('03', '07:00'), tw('03', '19:00')), 8, extra)).toBe(8)
    // 夜班跨日：兩天各取實際涵蓋的時數
    expect(hoursUtils.maxHoursOfInterval(interval(tw('02', '19:00'), tw('03', '07:00')), 8, extra)).toBe(12)
  })
})

describe('buildLeaveHoursHint', () => {
  const policy = { maxHoursPerDay: 8, minUnitHours: 0.5 }

  it('suggests the shift hours for scheduled work days, 0 for days off and the daily maximum for unscheduled days (whole-day leave)', () => {
    const scheduled = new Map([
      ['2026-03-02', { work: true, hours: 12 }],
      ['2026-03-03', { work: false, hours: 0 }],
      ['2026-03-04', { work: true, hours: 8 }],
    ])

    const hint = service.buildLeaveHoursHint({ interval: interval('2026-03-02', '2026-03-05'), schedule: scheduled, ...policy })

    expect(hint).toMatchObject({ valid: true, allDay: true, suggestedHours: 28, maxHours: 36 })
    expect(hint.days.map(day => [day.dateKey, day.suggestedHours, day.scheduled, day.shiftHours])).toEqual([
      ['2026-03-02', 12, 'work', 12],
      ['2026-03-03', 0, 'off', 0],
      ['2026-03-04', 8, 'work', 8],
      ['2026-03-05', 8, null, 0],
    ])
  })

  it('without a schedule it is the plain calendar-day estimate', () => {
    expect(service.buildLeaveHoursHint({ interval: interval('2026-03-02', '2026-03-04'), ...policy }))
      .toMatchObject({ valid: true, maxHours: 24, suggestedHours: 24 })
  })

  it('for a leave with clock times it is the covered time, capped by the day ceiling (a 12-hour shift is covered fully)', () => {
    const scheduled = new Map([['2026-03-02', { work: true, hours: 12 }]])
    expect(service.buildLeaveHoursHint({ interval: interval(tw('02', '07:00'), tw('02', '19:00')), schedule: scheduled, ...policy }))
      .toMatchObject({ allDay: false, suggestedHours: 12, maxHours: 12 })
    expect(service.buildLeaveHoursHint({ interval: interval(tw('02', '09:00'), tw('02', '13:00')), schedule: scheduled, ...policy }))
      .toMatchObject({ suggestedHours: 4, maxHours: 4 })
    expect(service.buildLeaveHoursHint({ interval: interval(tw('02', '07:00'), tw('02', '19:00')), ...policy }))
      .toMatchObject({ suggestedHours: 8, maxHours: 8 })
  })

  it('floors the suggestion to the minimum unit and reports an unreadable or reversed interval as not valid', () => {
    const scheduled = new Map([['2026-03-02', { work: true, hours: 7.75 }]])
    expect(service.buildLeaveHoursHint({ interval: interval('2026-03-02', '2026-03-02'), schedule: scheduled, ...policy }).suggestedHours).toBe(7.5)
    expect(service.buildLeaveHoursHint({ interval: interval('2026-03-05', '2026-03-02'), ...policy })).toMatchObject({ valid: false, maxHours: 0, days: [] })
    expect(service.buildLeaveHoursHint({ interval: null, ...policy }).valid).toBe(false)
  })
})
