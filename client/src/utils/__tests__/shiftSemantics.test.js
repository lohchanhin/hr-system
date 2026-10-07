import { describe, it, expect } from 'vitest'
import {
  SHIFT_SEMANTIC_OPTIONS,
  inferShiftSemanticType,
  resolveShiftSemanticType,
  hasNoWorkingTime,
  isNonWorkSemanticType,
  isWorkShiftWithoutWorkingTime,
  getShiftSemanticLabel,
} from '../shiftSemantics.js'

// 客戶公版班表的 17 個休假 / 請假代碼（00:00-00:00、休息 0 分鐘）與對應名稱
const CUSTOMER_OFF_TABLE = [
  { code: '休', name: '休假', type: 'rest_day' },
  { code: '例', name: '例假', type: 'regular_rest' },
  { code: '國', name: '國定假日', type: 'holiday' },
  { code: '事', name: '事假', type: 'leave' },
  { code: '特', name: '特休', type: 'leave' },
  { code: '補', name: '補休', type: 'leave' },
  { code: '原', name: '原民假', type: 'leave' },
  { code: '病', name: '病假', type: 'leave' },
  { code: '公', name: '公假', type: 'leave' },
  { code: '公傷', name: '公傷假', type: 'leave' },
  { code: '婚', name: '婚假', type: 'leave' },
  { code: '喪', name: '喪假', type: 'leave' },
  { code: '生', name: '生理假', type: 'leave' },
  { code: '檢', name: '產檢假', type: 'leave' },
  { code: '陪', name: '陪產檢假', type: 'leave' },
  { code: '產', name: '分娩假', type: 'leave' },
  { code: '家', name: '家庭照顧假', type: 'leave' },
]

// 客戶公版裡真的要上班的班別（含「休」開頭的假日出勤班）
const CUSTOMER_WORK_SHIFTS = [
  { code: '日', name: '日', startTime: '08:00', endTime: '17:00' },
  { code: 'N', name: 'N', startTime: '00:00', endTime: '08:00', crossDay: true },
  { code: 'E', name: 'E', startTime: '16:00', endTime: '00:00', crossDay: true },
  { code: '彈', name: '彈', startTime: '00:00', endTime: '23:59' },
  { code: '休D', name: '休D', startTime: '08:00', endTime: '17:00' },
  { code: '休E', name: '休E', startTime: '16:00', endTime: '00:00', crossDay: true },
  { code: '休N', name: '休N', startTime: '00:00', endTime: '08:00', crossDay: true },
  { code: '休支4', name: '休支4', startTime: '08:00', endTime: '12:00' },
  { code: '0630-1830', name: '0630-1830', startTime: '06:30', endTime: '18:30' },
  { code: '1830-0630', name: '1830-0630', startTime: '18:30', endTime: '06:30', crossDay: true },
  { code: '0800-2000', name: '0800-2000', startTime: '08:00', endTime: '20:00' },
  { code: '2000-0800', name: '2000-0800', startTime: '20:00', endTime: '08:00', crossDay: true },
]

describe('inferShiftSemanticType（與伺服器推斷規則一致）', () => {
  it.each(CUSTOMER_OFF_TABLE)('客戶代碼「$code」（$name）→ $type', ({ code, name, type }) => {
    const zero = { startTime: '00:00', endTime: '00:00' }
    expect(inferShiftSemanticType({ code, name, ...zero })).toBe(type)
    // 只輸入代碼（管理者剛開始輸入、名稱還沒填）也要判斷得出來
    expect(inferShiftSemanticType({ code })).toBe(type)
    // 代碼是自訂的，只靠名稱也要判斷得出來
    expect(inferShiftSemanticType({ code: 'ZZ9', name, ...zero })).toBe(type)
  })

  it.each(CUSTOMER_WORK_SHIFTS)('上班班別「$code」→ work', (shift) => {
    expect(inferShiftSemanticType(shift)).toBe('work')
    expect(inferShiftSemanticType({ code: shift.code, name: shift.name })).toBe('work')
  })

  it('開始等於結束、沒有跨日、又不屬於休息 / 例假 / 國定假日的班別一律視為請假，不會是工作班', () => {
    expect(inferShiftSemanticType({ code: 'XX', name: '自訂缺勤', startTime: '00:00', endTime: '00:00' })).toBe('leave')
    expect(inferShiftSemanticType({ code: 'XX', startTime: '09:00', endTime: '09:00' })).toBe('leave')
  })

  it('勾了跨日的同時刻班別是 24 小時班，仍是工作班', () => {
    expect(inferShiftSemanticType({ code: 'W24', startTime: '00:00', endTime: '00:00', crossDay: true })).toBe('work')
  })

  it('表單剛開始輸入、時間還是空白時不會誤判為請假', () => {
    expect(inferShiftSemanticType({ code: 'D', name: '早班', startTime: '', endTime: '' })).toBe('work')
    expect(inferShiftSemanticType({})).toBe('work')
  })

  it('沿用既有的英文與底線寫法', () => {
    expect(inferShiftSemanticType({ code: 'off' })).toBe('rest_day')
    expect(inferShiftSemanticType({ code: 'REST' })).toBe('rest_day')
    expect(inferShiftSemanticType({ code: 'A_休', startTime: '00:00', endTime: '00:00' })).toBe('rest_day')
    expect(inferShiftSemanticType({ code: 'A_例', startTime: '00:00', endTime: '00:00' })).toBe('regular_rest')
    expect(inferShiftSemanticType({ code: 'x', name: 'REST_DAY', startTime: '00:00', endTime: '00:00' })).toBe('rest_day')
    expect(inferShiftSemanticType({ code: '国' })).toBe('holiday')
  })
})

describe('resolveShiftSemanticType / 顯示輔助', () => {
  it('明確的班別性質優先，缺少時才依代碼推斷', () => {
    expect(resolveShiftSemanticType({ code: '休', semanticType: 'work' })).toBe('work')
    expect(resolveShiftSemanticType({ code: '休' })).toBe('rest_day')
    expect(resolveShiftSemanticType({ code: '休', semanticType: 'bogus' })).toBe('rest_day')
  })

  it('提供五種班別性質選項與中文名稱', () => {
    expect(SHIFT_SEMANTIC_OPTIONS.map(option => option.label)).toEqual(['工作班', '休息日', '例假', '國定假日', '請假'])
    expect(getShiftSemanticLabel({ semanticType: 'regular_rest' })).toBe('例假')
    expect(getShiftSemanticLabel({ code: '國' })).toBe('國定假日')
  })

  it('isNonWorkSemanticType 只認四種不需上班的類型', () => {
    ;['rest_day', 'regular_rest', 'holiday', 'leave'].forEach(type => expect(isNonWorkSemanticType(type)).toBe(true))
    expect(isNonWorkSemanticType('work')).toBe(false)
    expect(isNonWorkSemanticType('')).toBe(false)
  })

  it('hasNoWorkingTime 與伺服器一致：同時刻且未跨日才算沒有工作時間', () => {
    expect(hasNoWorkingTime({ startTime: '00:00', endTime: '00:00' })).toBe(true)
    expect(hasNoWorkingTime({ startTime: '00:00', endTime: '00:00', crossDay: true })).toBe(false)
    expect(hasNoWorkingTime({ startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(false)
    expect(hasNoWorkingTime({ startTime: '', endTime: '' })).toBe(false)
  })

  it('時間寫法不同（8:00、08:00:00）也視為同一時刻', () => {
    expect(hasNoWorkingTime({ startTime: '8:00', endTime: '08:00:00' })).toBe(true)
    expect(inferShiftSemanticType({ code: 'XX', startTime: '0:00', endTime: '00:00' })).toBe('leave')
    expect(inferShiftSemanticType({ code: 'A_休', startTime: '0:00', endTime: '00:00:00' })).toBe('rest_day')
  })

  it('標成工作班卻沒有工作時間的班別會被標示出來', () => {
    expect(isWorkShiftWithoutWorkingTime({ code: 'D', semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe(true)
    expect(isWorkShiftWithoutWorkingTime({ code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00' })).toBe(false)
    expect(isWorkShiftWithoutWorkingTime({ code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' })).toBe(false)
  })
})
