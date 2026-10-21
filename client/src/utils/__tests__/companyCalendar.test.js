import { describe, it, expect } from 'vitest'
import {
  buildDefaultDecisions,
  currentTaipeiYear,
  dayFlags,
  describeDayLink,
  describeDiffSide,
  describeKindCounts,
  formatDateWithWeekday,
  formatTaipeiDateTime,
  lastErrorLabel,
  originLabel,
  readApiError,
  stateBannerText,
  statutoryCountOfYear,
  weekdayLabel
} from '../companyCalendar'

describe('companyCalendar utils', () => {
  it('formats dates with weekdays and Taipei times', () => {
    expect(weekdayLabel('2026-02-28')).toBe('六')
    expect(formatDateWithWeekday('2026-02-27')).toBe('2026/02/27 (五)')
    expect(formatTaipeiDateTime('2026-10-20T16:30:00.000Z')).toBe('2026/10/21 00:30')
    expect(currentTaipeiYear(new Date('2026-12-31T17:00:00.000Z'))).toBe(2027)
  })

  it('describes the link column for make-up days and designated days', () => {
    expect(describeDayLink({ kind: 'gov_makeup_off', compensatesDate: '2026-02-28', compensatesName: '和平紀念日' })).toBe('補 02/28 和平紀念日')
    expect(describeDayLink({ kind: 'gov_makeup_off', compensatesDate: null })).toBe('未對應')
    expect(describeDayLink({ kind: 'designated', excludedEmployees: ['a', 'b'] })).toBe('排除 2 人')
    expect(describeDayLink({ kind: 'statutory' })).toBe('')
  })

  it('labels sources and flags', () => {
    expect(originLabel('public')).toBe('政府資料')
    expect(originLabel('rule')).toBe('系統規則')
    expect(originLabel('migrated')).toBe('舊版轉換')
    expect(originLabel(undefined)).toBe('手動')
    expect(dayFlags({ hrEdited: true, needsReview: true, archived: true })).toEqual(['HR 已修改', '待確認', '已刪除'])
  })

  it('builds the state banner text', () => {
    expect(stateBannerText({ year: 2028, state: 'none' })).toBe('尚未建立 2028 年公司行事曆')
    expect(stateBannerText({ year: 2026, state: 'draft', migrated: true })).toContain('舊版把公務機關補假也當成國定假日')
    expect(stateBannerText({ year: 2026, state: 'draft' })).toContain('核定前排班、薪資仍會使用這份草稿')
    expect(stateBannerText({ year: 2026, state: 'approved', approvedByName: '人資王', approvedAt: '2026-10-20T02:00:00.000Z' }))
      .toBe('已核定（人資王，2026/10/20 10:00）')
  })

  it('summarizes kind counts and diff sides', () => {
    expect(describeKindCounts({ statutory: 16, gov_makeup_off: 6, gov_bridge_off: 0 })).toBe('國定假日 16、公務機關補假 6')
    expect(describeDiffSide({ kind: 'gov_makeup_off', name: '補假', compensatesDate: '2026-02-28' })).toBe('公務機關補假 補假（補 02/28）')
    expect(describeDiffSide({ kind: 'statutory', name: '國定假日', archived: true })).toBe('國定假日（已刪除）')
    expect(describeDiffSide(null)).toBe('—')
  })

  it('keeps conflicts by default and counts this year\'s statutory days', () => {
    expect(buildDefaultDecisions({ changes: [{ key: 'a', defaultDecision: 'keep' }, { key: 'b', defaultDecision: 'accept' }, { key: 'c' }] }))
      .toEqual({ a: 'keep', b: 'accept', c: 'accept' })
    expect(statutoryCountOfYear([{ year: 2026, counts: { statutory: 16 } }], 2026)).toBe(16)
    expect(statutoryCountOfYear([], 2026)).toBe(0)
  })

  it('translates source errors and API error codes', async () => {
    expect(lastErrorLabel('FETCH_TIMEOUT')).toBe('無法連線政府資料平台')
    expect(lastErrorLabel('HTTP_503')).toBe('政府資料平台暫時無法使用（503）')
    expect(lastErrorLabel('')).toBe('')
    const duplicate = await readApiError({ json: async () => ({ code: 'DUPLICATE_DAY', error: '這一天已有相同類型的行事曆紀錄' }) }, 'x')
    expect(duplicate).toMatchObject({ code: 'DUPLICATE_DAY', message: '這一天已有相同類型的紀錄' })
    const plain = await readApiError({ json: async () => ({ error: '需要管理員權限' }) }, 'x')
    expect(plain.message).toBe('需要管理員權限')
    const review = await readApiError({ json: async () => ({ code: 'NEEDS_REVIEW_ROWS', error: '還有 2 筆待確認的日期', count: 2 }) }, 'x')
    expect(review).toMatchObject({ code: 'NEEDS_REVIEW_ROWS', count: 2, message: '還有 2 筆待確認的日期' })
  })
})
