// 前端的「請假有沒有涵蓋班次」必須和伺服器 leaveCoverageService.buildLeaveDayCheck 一模一樣：
// 這裡的案例與伺服器 tests/leaveCoverageService.test.js 相同，排班畫面才不會和完整性檢查、匯出、國定假日休假紀錄給出不同答案。
import { describe, it, expect } from 'vitest'
import { buildLeaveDayCheck, isNonWorkShift, leaveCoversRosteredShift } from '../src/utils/leaveCoverage'
import { parseLeaveInterval } from '../src/utils/leaveHours'

const DAY_MS = 24 * 60 * 60 * 1000
// 台灣時間的時間點（毫秒）；請假區間的格式與伺服器 loadApprovedLeaveIntervals 相同
const taipei = (key, time = '00:00') => Date.parse(`${key}T${time}:00+08:00`)
const hoursLeave = (key, from, to, endKey = key) => ({ startMs: taipei(key, from), endMs: taipei(endKey, to), allDay: false })
const allDayLeave = (key, lastKey = key) => ({ startMs: taipei(key), endMs: taipei(lastKey) + DAY_MS, allDay: true })

const DAY_SHIFT = { code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }
const DAY_SHIFT_NO_BREAK = { code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00' }
const AFTERNOON = { code: '午', semanticType: 'work', startTime: '13:00', endTime: '17:00' }
const NIGHT = { code: '夜', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true }
const REST_DAY = { code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }
const DAY = '2026-06-10'

const covers = (intervals, shift, key = DAY) => leaveCoversRosteredShift(intervals, key, shift)

describe('leaveCoversRosteredShift (the server rule for a rostered shift)', () => {
  it('covers a 日班 08-17 by a leave of the whole working day', () => {
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], DAY_SHIFT)).toBe(true)
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], DAY_SHIFT_NO_BREAK)).toBe(true)
  })

  it('lets the unpaid break stay uncovered, but nothing more', () => {
    // 日班休息 60 分鐘：09:00-17:00、08:00-16:00 仍算涵蓋；09:30-17:00 差 90 分鐘就不算
    expect(covers([hoursLeave(DAY, '09:00', '17:00')], DAY_SHIFT)).toBe(true)
    expect(covers([hoursLeave(DAY, '08:00', '16:00')], DAY_SHIFT)).toBe(true)
    expect(covers([hoursLeave(DAY, '09:30', '17:00')], DAY_SHIFT)).toBe(false)
    // 沒有休息時間的班別，差一分鐘就不算
    expect(covers([hoursLeave(DAY, '09:00', '17:00')], DAY_SHIFT_NO_BREAK)).toBe(false)
    expect(covers([hoursLeave(DAY, '13:01', '17:00')], AFTERNOON)).toBe(false)
    // breakDuration 優先於 breakMinutes
    expect(covers([hoursLeave(DAY, '09:00', '17:00')], { ...DAY_SHIFT, breakDuration: 30 })).toBe(false)
    expect(covers([hoursLeave(DAY, '08:30', '17:00')], { ...DAY_SHIFT, breakDuration: 30 })).toBe(true)
  })

  it('covers the afternoon shift by an afternoon leave, but not the 日班 it only overlaps', () => {
    expect(covers([hoursLeave(DAY, '13:00', '17:00')], AFTERNOON)).toBe(true)
    expect(covers([hoursLeave(DAY, '13:00', '17:00')], DAY_SHIFT)).toBe(false)
    expect(covers([hoursLeave(DAY, '09:00', '11:00')], DAY_SHIFT)).toBe(false)
  })

  it('adds up several leaves on the same day, overlapping ones only once', () => {
    expect(covers([hoursLeave(DAY, '08:00', '12:00'), hoursLeave(DAY, '13:00', '17:00')], DAY_SHIFT)).toBe(true)
    expect(covers([hoursLeave(DAY, '08:00', '12:00'), hoursLeave(DAY, '13:00', '17:00')], DAY_SHIFT_NO_BREAK)).toBe(false)
    expect(covers([hoursLeave(DAY, '08:00', '12:00'), hoursLeave(DAY, '12:00', '17:00')], DAY_SHIFT)).toBe(true)
    expect(covers([hoursLeave(DAY, '08:00', '11:00'), hoursLeave(DAY, '10:00', '12:00')], DAY_SHIFT)).toBe(false)
    expect(covers([hoursLeave(DAY, '08:00', '12:00'), hoursLeave(DAY, '11:00', '17:00')], DAY_SHIFT)).toBe(true)
  })

  it('covers a night shift that crosses midnight only when the leave runs through to its end', () => {
    expect(covers([hoursLeave(DAY, '22:00', '06:00', '2026-06-11')], NIGHT)).toBe(true)
    expect(covers([hoursLeave(DAY, '22:00', '00:00', '2026-06-11')], NIGHT)).toBe(false)
    // 兩張假（當天 22-24、隔天 00-06）合起來也算
    expect(covers([hoursLeave(DAY, '22:00', '00:00', '2026-06-11'), hoursLeave('2026-06-11', '00:00', '06:00')], NIGHT)).toBe(true)
    // 隔天排的日班不受前一晚的假影響
    expect(covers([hoursLeave(DAY, '22:00', '06:00', '2026-06-11')], DAY_SHIFT, '2026-06-11')).toBe(false)
  })

  it('judges a timed leave that runs over several days one day at a time', () => {
    const leave = [hoursLeave('2026-06-10', '13:00', '10:00', '2026-06-12')]
    expect(covers(leave, DAY_SHIFT, '2026-06-10')).toBe(false)
    expect(covers(leave, AFTERNOON, '2026-06-10')).toBe(true)
    expect(covers(leave, DAY_SHIFT, '2026-06-11')).toBe(true)
    expect(covers(leave, NIGHT, '2026-06-11')).toBe(true)
    expect(covers(leave, DAY_SHIFT, '2026-06-12')).toBe(false)
  })

  it('never guesses: an unknown shift, a non-work shift or a shift without working time is not covered', () => {
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], null)).toBe(false)
    expect(covers([hoursLeave(DAY, '00:00', '00:00', '2026-06-11')], undefined)).toBe(false)
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], REST_DAY)).toBe(false)
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], { code: '婚', semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe(false)
    // 時間讀不懂的班別無法算出班次時間
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], { code: 'X', semanticType: 'work', startTime: '', endTime: '17:00' })).toBe(false)
  })

  it('takes the Taiwan calendar day, ignores unreadable leaves and gives an invalid date no leave', () => {
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], DAY_SHIFT, '2026-06-09')).toBe(false)
    expect(covers([{ startMs: NaN, endMs: taipei(DAY, '17:00') }, null, hoursLeave(DAY, '09:00', '09:00')], DAY_SHIFT)).toBe(false)
    expect(covers([hoursLeave(DAY, '08:00', '17:00')], DAY_SHIFT, 'not-a-date')).toBe(false)
    expect(covers(undefined, DAY_SHIFT)).toBe(false)
  })

  it('reads the intervals that parseLeaveInterval makes from the leave form values', () => {
    const interval = parseLeaveInterval('2026-06-10T00:00:00.000Z', '2026-06-10T09:00:00.000Z') // 台灣 08:00-17:00
    expect(covers([interval], DAY_SHIFT)).toBe(true)
    expect(covers([parseLeaveInterval('2026-06-10T01:00:00.000Z', '2026-06-10T03:00:00.000Z')], DAY_SHIFT)).toBe(false)
  })
})

describe('buildLeaveDayCheck (same answers as the server)', () => {
  it('counts an all-day leave and an unrostered day with a timed leave as leave, like the server', () => {
    expect(buildLeaveDayCheck([allDayLeave(DAY)], () => ({ kind: 'work', shift: DAY_SHIFT }))(DAY)).toBe(true)
    expect(buildLeaveDayCheck([hoursLeave(DAY, '09:00', '11:00')], () => null)(DAY)).toBe(true)
    expect(buildLeaveDayCheck([hoursLeave(DAY, '09:00', '11:00')], () => ({ kind: 'rest', shift: REST_DAY }))(DAY)).toBe(false)
    expect(buildLeaveDayCheck([hoursLeave(DAY, '09:00', '11:00')], () => ({ kind: 'work', shift: null }))(DAY)).toBe(false)
    expect(buildLeaveDayCheck([], () => null)(DAY)).toBe(false)
  })

  it('treats the same shifts as not worked as the server does', () => {
    expect(isNonWorkShift(REST_DAY)).toBe(true)
    expect(isNonWorkShift({ code: '國', startTime: '00:00', endTime: '00:00' })).toBe(true)
    expect(isNonWorkShift({ code: '特', name: '特休', startTime: '08:00', endTime: '17:00' })).toBe(true)
    expect(isNonWorkShift({ code: '婚', semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe(true)
    expect(isNonWorkShift(DAY_SHIFT)).toBe(false)
    expect(isNonWorkShift({ ...NIGHT, startTime: '00:00', endTime: '00:00' })).toBe(false)
  })
})
