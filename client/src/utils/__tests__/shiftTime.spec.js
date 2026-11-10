import { describe, it, expect } from 'vitest'
import {
  breakComesFromWindows,
  contrastRatio,
  crossesMidnight,
  formatHours,
  resolveCrossDayFlag,
  shiftBreakMinutes,
  shiftChipAppearance,
  shiftSpanMinutes,
  shiftWorkMinutes,
  timeToMinutes,
  validateWorkShiftTimes
} from '../shiftTime'

describe('shiftTime：班別時間計算（與伺服器 leaveShiftHours / timeWindow 的規則相同）', () => {
  it('00:00 是有效時間（0 分），不是空值', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('8:05')).toBe(485)
    expect(timeToMinutes('08:05:30')).toBe(485)
    expect(timeToMinutes('')).toBeNull()
    expect(timeToMinutes('24:00')).toBeNull()
    expect(timeToMinutes('12:60')).toBeNull()
    expect(timeToMinutes(null)).toBeNull()
  })

  it('班別長度：同一天、跨午夜、下班在 00:00、00:00 開始的大夜', () => {
    expect(shiftSpanMinutes({ startTime: '08:00', endTime: '17:00' })).toBe(540)
    expect(shiftSpanMinutes({ startTime: '22:00', endTime: '06:00' })).toBe(480)
    // 小夜 16:00-00:00：下班 00:00 早於上班，一定是隔天
    expect(shiftSpanMinutes({ startTime: '16:00', endTime: '00:00' })).toBe(480)
    // 大夜 00:00-08:00：同一天，就算勾了跨日也不會多 24 小時
    expect(shiftSpanMinutes({ startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(480)
    expect(shiftSpanMinutes({ startTime: '08:00', endTime: '' })).toBeNull()
  })

  it('上下班時間相同：勾跨日才是 24 小時，沒勾是 0', () => {
    expect(shiftSpanMinutes({ startTime: '08:00', endTime: '08:00', crossDay: true })).toBe(1440)
    expect(shiftSpanMinutes({ startTime: '08:00', endTime: '08:00', crossDay: false })).toBe(0)
    expect(crossesMidnight({ startTime: '08:00', endTime: '08:00', crossDay: true })).toBe(true)
    expect(crossesMidnight({ startTime: '08:00', endTime: '08:00' })).toBe(false)
    expect(crossesMidnight({ startTime: '22:00', endTime: '06:00' })).toBe(true)
    expect(crossesMidnight({ startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(false)
  })

  it('跨日旗標由時間決定，只有上下班時間相同時才看勾選', () => {
    expect(resolveCrossDayFlag({ startTime: '22:00', endTime: '06:00', crossDay: false })).toBe(true)
    expect(resolveCrossDayFlag({ startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(false)
    expect(resolveCrossDayFlag({ startTime: '08:00', endTime: '08:00', crossDay: true })).toBe(true)
    expect(resolveCrossDayFlag({ startTime: '08:00', endTime: '08:00', crossDay: false })).toBe(false)
    // 時間還沒填好：保留原本的勾選
    expect(resolveCrossDayFlag({ startTime: '', endTime: '', crossDay: true })).toBe(true)
  })

  it('休息：有填休息時段就用時段合計，不用休息時長', () => {
    const shift = { startTime: '09:00', endTime: '18:00', breakDuration: 90, breakWindows: [{ start: '12:00', end: '13:00' }] }
    expect(shiftBreakMinutes(shift)).toBe(60)
    expect(breakComesFromWindows(shift)).toBe(true)
    expect(shiftWorkMinutes(shift)).toBe(480)
    // 沒填時段（或時段沒填完）才用休息時長
    expect(shiftBreakMinutes({ breakDuration: 90, breakWindows: [] })).toBe(90)
    expect(shiftBreakMinutes({ breakDuration: 90, breakWindows: [{ start: '', end: '' }] })).toBe(90)
    expect(breakComesFromWindows({ breakWindows: [{ start: '', end: '' }] })).toBe(false)
    // 休息時長 0 分鐘是有效的設定（不會退回舊欄位）
    expect(shiftBreakMinutes({ breakDuration: 0, breakMinutes: 45 })).toBe(0)
    expect(shiftBreakMinutes({ breakMinutes: 45 })).toBe(45)
    expect(shiftBreakMinutes({ breakTime: '01:30' })).toBe(90)
  })

  it('實際工時：跨午夜的夜班扣掉跨午夜的休息', () => {
    const night = { startTime: '22:00', endTime: '06:00', crossDay: true, breakDuration: 60, breakWindows: [{ start: '23:30', end: '00:30' }] }
    expect(shiftBreakMinutes(night)).toBe(60)
    expect(shiftWorkMinutes(night)).toBe(420)
    expect(formatHours(420)).toBe('7')
    expect(formatHours(450)).toBe('7.5')
    expect(formatHours(465)).toBe('7.75')
    expect(formatHours(null)).toBe('')
    // 休息比班別長：工時最少是 0，不會是負數
    expect(shiftWorkMinutes({ startTime: '08:00', endTime: '09:00', breakDuration: 120 })).toBe(0)
    expect(shiftWorkMinutes({ startTime: '', endTime: '' })).toBeNull()
  })

  it('檢查：沒填時間、休息時段不在上班時間內、休息比班別長', () => {
    expect(validateWorkShiftTimes({ startTime: '', endTime: '' })).toEqual(['請選擇上班時間', '請選擇下班時間'])
    expect(validateWorkShiftTimes({ startTime: '08:00', endTime: '17:00', breakDuration: 60, breakWindows: [] })).toEqual([])
    expect(validateWorkShiftTimes({ startTime: '08:00', endTime: '17:00', breakWindows: [{ start: '18:00', end: '19:00' }] }))
      .toEqual(['第 1 筆休息時段不在上班時間內'])
    // 休息結束超過下班時間
    expect(validateWorkShiftTimes({ startTime: '08:00', endTime: '17:00', breakWindows: [{ start: '16:30', end: '17:30' }] }))
      .toEqual(['第 1 筆休息時段不在上班時間內'])
    expect(validateWorkShiftTimes({ startTime: '08:00', endTime: '17:00', breakWindows: [{ start: '12:00', end: '12:00' }] }))
      .toEqual(['第 1 筆休息時段的開始與結束不得相同'])
    expect(validateWorkShiftTimes({ startTime: '08:00', endTime: '17:00', breakWindows: [{ start: '12:00', end: '' }] }))
      .toEqual(['第 1 筆休息時段請填寫開始與結束時間'])
    expect(validateWorkShiftTimes({ startTime: '08:00', endTime: '12:00', breakDuration: 240 }))
      .toEqual(['休息時間不可等於或超過上班到下班的時間'])
  })

  it('檢查：跨日班的休息時段以「上班後第幾分鐘」判斷', () => {
    const base = { startTime: '22:00', endTime: '06:00', crossDay: true }
    expect(validateWorkShiftTimes({ ...base, breakWindows: [{ start: '02:00', end: '03:00' }] })).toEqual([])
    expect(validateWorkShiftTimes({ ...base, breakWindows: [{ start: '23:30', end: '00:30' }] })).toEqual([])
    expect(validateWorkShiftTimes({ ...base, breakWindows: [{ start: '12:00', end: '13:00' }] }))
      .toEqual(['第 1 筆休息時段不在上班時間內'])
    // 下班時間 06:00 之後才結束
    expect(validateWorkShiftTimes({ ...base, breakWindows: [{ start: '05:30', end: '06:30' }] }))
      .toEqual(['第 1 筆休息時段不在上班時間內'])
  })

  it('顏色：文字和班表格子底色太接近時標示對比不足', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', 'oops')).toBeNull()
    // 淺黃底配白字：看不清楚
    const low = shiftChipAppearance({ code: 'D', bgColor: '#fef3c7', color: '#f8fafc' })
    expect(low.lowContrast).toBe(true)
    expect(low.style.color).toBe('#f8fafc')
    // 同樣的底色配深色字：沒問題
    expect(shiftChipAppearance({ code: 'D', bgColor: '#fef3c7', color: '#92400e' }).lowContrast).toBe(false)
    // 沒選文字顏色時系統自動挑對比足夠的顏色（深底配淺字）
    const auto = shiftChipAppearance({ code: 'N', bgColor: '#1e293b', color: '' })
    expect(auto.lowContrast).toBe(false)
    // 都沒選：使用預設配色，仍有底色與文字色
    const fallback = shiftChipAppearance({ code: 'X' })
    expect(fallback.style.background).toMatch(/^#/)
    expect(fallback.lowContrast).toBe(false)
  })
})
