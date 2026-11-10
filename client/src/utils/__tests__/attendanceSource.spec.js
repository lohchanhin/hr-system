import { describe, it, expect } from 'vitest'
import {
  attendanceSourceLabel,
  attendanceSourceTagType,
  isAttendanceSourceNotable,
  resolveAttendanceSource
} from '../attendanceSource'

describe('打卡來源顯示', () => {
  it('線上打卡、指紋匯入、手動補登各有標籤', () => {
    expect(attendanceSourceLabel('online')).toBe('線上')
    expect(attendanceSourceLabel('import')).toBe('指紋匯入')
    expect(attendanceSourceLabel('manual')).toBe('手動補登')
    expect(attendanceSourceTagType('online')).toBe('success')
    expect(attendanceSourceTagType('import')).toBe('warning')
  })

  it('沒有來源的舊資料或不認得的值顯示「未標示」', () => {
    expect(resolveAttendanceSource(undefined)).toBe('legacy')
    expect(resolveAttendanceSource('toString')).toBe('legacy')
    expect(attendanceSourceLabel(undefined)).toBe('未標示')
    expect(attendanceSourceLabel('legacy')).toBe('未標示')
    expect(attendanceSourceTagType('unknown')).toBe('info')
  })

  // 員工的打卡頁只標示指紋匯入與手動補登；線上打卡（預設）與舊資料的「未標示」不顯示標籤
  it('員工的打卡記錄只標示不是自己線上打的來源', () => {
    expect(isAttendanceSourceNotable('import')).toBe(true)
    expect(isAttendanceSourceNotable('manual')).toBe(true)
    expect(isAttendanceSourceNotable('online')).toBe(false)
    expect(isAttendanceSourceNotable('legacy')).toBe(false)
    expect(isAttendanceSourceNotable(undefined)).toBe(false)
  })
})
