import { describe, it, expect } from '@jest/globals'
import { resolveMonthlyEmployment } from '../src/utils/payrollEmployment.js'
import { normalizePayrollMonth } from '../src/utils/payrollMonth.js'

// 月薪人員當月的在職期間：月中到職、離職按在職日數比例給本薪，整個月都不在職（已離職、尚未到職、留職停薪）沒有本薪。
// 以前完全不看到職日與離職日：去年離職的人每個月還是算整個月的薪水，也會出現在銀行匯款檔裡。
const utc = (key) => new Date(`${key}T00:00:00.000Z`)

describe('resolveMonthlyEmployment', () => {
  it('在職員工（沒有到職日、或到職日早於本月）是整月在職', () => {
    expect(resolveMonthlyEmployment({}, '2026-10-01')).toMatchObject({ employed: true, ratio: 1, employedDays: 31, daysInMonth: 31, reason: null })
    expect(resolveMonthlyEmployment({ status: '正職員工', appointment: { hireDate: utc('2020-01-01') } }, '2026-10-01').ratio).toBe(1)
    // 沒有帶 status / appointment 欄位（舊的投影）也視為整月在職，不會被算成 0
    expect(resolveMonthlyEmployment(undefined, '2026-10-01').ratio).toBe(1)
  })

  it('月中到職：到職日（含）到月底的日曆天數 / 30', () => {
    const result = resolveMonthlyEmployment({ status: '試用期員工', appointment: { hireDate: utc('2026-10-16') } }, '2026-10-01')
    expect(result).toMatchObject({ employed: true, employedDays: 16, daysInMonth: 31, startKey: '2026-10-16', endKey: '2026-10-31', reason: 'partial_month' })
    expect(result.ratio).toBeCloseTo(16 / 30, 10)
  })

  it('到職日以台灣日期判斷（日期選擇器送出的台灣 10/16 00:00 是 UTC 10/15 16:00）', () => {
    const result = resolveMonthlyEmployment({ appointment: { hireDate: new Date('2026-10-15T16:00:00.000Z') } }, '2026-10-01')
    expect(result.startKey).toBe('2026-10-16')
  })

  it('月中離職：月初到離職日（含）的日曆天數 / 30；離職日在上個月以前整月不在職', () => {
    const leaver = { status: '離職員工', appointment: { hireDate: utc('2022-01-01'), resignationDate: utc('2026-10-15') } }
    expect(resolveMonthlyEmployment(leaver, '2026-10-01')).toMatchObject({ employed: true, employedDays: 15, endKey: '2026-10-15', ratio: 0.5 })
    expect(resolveMonthlyEmployment(leaver, '2026-11-01')).toMatchObject({ employed: false, ratio: 0, reason: 'after_resignation' })
    expect(resolveMonthlyEmployment(leaver, '2026-09-01').ratio).toBe(1)
  })

  it('離職員工沒有離職日時改看解聘日，再來是本月最後一筆班表；都沒有就整月不在職', () => {
    expect(resolveMonthlyEmployment({ status: '離職員工', appointment: { dismissalDate: utc('2026-10-10') } }, '2026-10-01').employedDays).toBe(10)
    expect(resolveMonthlyEmployment({ status: '離職員工' }, '2026-10-01', { scheduledKeys: ['2026-10-02', '2026-10-06', '2026-09-30'] }))
      .toMatchObject({ employed: true, employedDays: 6, endKey: '2026-10-06' })
    expect(resolveMonthlyEmployment({ status: '離職員工' }, '2026-10-01')).toMatchObject({ employed: false, ratio: 0, reason: 'after_resignation' })
  })

  it('在職員工不看離職日（離職後再任用的人不會被誤判）', () => {
    const rehired = { status: '正職員工', appointment: { hireDate: utc('2019-01-01'), resignationDate: utc('2024-06-30') } }
    expect(resolveMonthlyEmployment(rehired, '2026-10-01').ratio).toBe(1)
  })

  it('下個月才到職：本月不在職；留職停薪且本月沒有班表：不在職，有班表則照常', () => {
    expect(resolveMonthlyEmployment({ appointment: { hireDate: utc('2026-11-03') } }, '2026-10-01')).toMatchObject({ employed: false, ratio: 0, reason: 'before_hire' })
    expect(resolveMonthlyEmployment({ status: '留職停薪' }, '2026-10-01')).toMatchObject({ employed: false, ratio: 0, reason: 'leave_of_absence' })
    expect(resolveMonthlyEmployment({ status: '留職停薪' }, '2026-10-01', { scheduledKeys: ['2026-10-05'] }).ratio).toBe(1)
  })

  it('二月與跨年：整月在職一律是 1，不會因為只有 28 天變成 28/30；月中到職不超過 1', () => {
    expect(resolveMonthlyEmployment({}, '2026-02-01')).toMatchObject({ ratio: 1, daysInMonth: 28, employedDays: 28 })
    expect(resolveMonthlyEmployment({}, '2028-02-01').daysInMonth).toBe(29)
    // 2 月 2 日到職：27 天 / 30
    expect(resolveMonthlyEmployment({ appointment: { hireDate: utc('2026-02-02') } }, '2026-02-01').ratio).toBeCloseTo(27 / 30, 10)
    // 31 天的月份 2 日到職：在職 30 天，比例是 1（不會超過整月薪水）
    expect(resolveMonthlyEmployment({ appointment: { hireDate: utc('2026-12-02') } }, '2026-12-01')).toMatchObject({ ratio: 1, employedDays: 30, reason: 'partial_month' })
    // 12 月 31 日離職：整月在職
    expect(resolveMonthlyEmployment({ status: '離職員工', appointment: { resignationDate: utc('2026-12-31') } }, '2026-12-01').ratio).toBe(1)
    expect(resolveMonthlyEmployment({ status: '離職員工', appointment: { resignationDate: utc('2026-12-31') } }, '2027-01-01').ratio).toBe(0)
  })

  describe('比例的算法（薪資政策 proration.method）', () => {
    const hire = { appointment: { hireDate: utc('2026-10-16') } }
    const leaver = { status: '離職員工', appointment: { resignationDate: utc('2026-02-10') } }

    it('沒指定或不認得的算法：days30（以前的做法），結果標出 method 與分母 basisDays', () => {
      for (const method of [undefined, 'weekly', null]) {
        expect(resolveMonthlyEmployment(hire, '2026-10-01', { method })).toMatchObject({ method: 'days30', basisDays: 30, ratio: 16 / 30 })
      }
      expect(resolveMonthlyEmployment({}, '2026-10-01')).toMatchObject({ method: 'days30', basisDays: 30, ratio: 1 })
    })

    it('calendarDays：在職日曆天數 ÷ 當月天數', () => {
      expect(resolveMonthlyEmployment(hire, '2026-10-01', { method: 'calendarDays' })).toMatchObject({ ratio: 16 / 31, basisDays: 31, employedDays: 16, reason: 'partial_month' })
      expect(resolveMonthlyEmployment(leaver, '2026-02-01', { method: 'calendarDays' })).toMatchObject({ ratio: 10 / 28, basisDays: 28 })
      // 2 日到職的 31 天月份：30/31，不像 days30 被進位成整月
      expect(resolveMonthlyEmployment({ appointment: { hireDate: utc('2026-12-02') } }, '2026-12-01', { method: 'calendarDays' }).ratio).toBe(30 / 31)
      expect(resolveMonthlyEmployment({}, '2026-02-01', { method: 'calendarDays' }).ratio).toBe(1)
    })

    it('none：當月有在職就是 1（月中到職、離職都給整月）；整月不在職仍然是 0', () => {
      expect(resolveMonthlyEmployment(hire, '2026-10-01', { method: 'none' })).toMatchObject({ ratio: 1, basisDays: null, employedDays: 16, reason: 'partial_month', method: 'none' })
      expect(resolveMonthlyEmployment(leaver, '2026-02-01', { method: 'none' }).ratio).toBe(1)
      expect(resolveMonthlyEmployment(leaver, '2026-03-01', { method: 'none' })).toMatchObject({ employed: false, ratio: 0, reason: 'after_resignation' })
      expect(resolveMonthlyEmployment({ appointment: { hireDate: utc('2026-11-03') } }, '2026-10-01', { method: 'none' })).toMatchObject({ employed: false, ratio: 0, reason: 'before_hire' })
      expect(resolveMonthlyEmployment({ status: '留職停薪' }, '2026-10-01', { method: 'none' })).toMatchObject({ employed: false, ratio: 0, reason: 'leave_of_absence' })
    })
  })
})

describe('normalizePayrollMonth', () => {
  it('接受 YYYY-MM、YYYY-MM-01 與該月第一天的 Date / ISO 字串', () => {
    expect(normalizePayrollMonth('2026-10')).toBe('2026-10-01')
    expect(normalizePayrollMonth('2026-10-01')).toBe('2026-10-01')
    expect(normalizePayrollMonth(' 2026-02-01 ')).toBe('2026-02-01')
    expect(normalizePayrollMonth('2026-10-01T00:00:00.000Z')).toBe('2026-10-01')
    expect(normalizePayrollMonth(new Date('2026-12-01T00:00:00.000Z'))).toBe('2026-12-01')
  })

  it('月中的日期、不存在的月份、其他型別都不接受', () => {
    // 2026-10-15 以前會算成「10/15 到 11/15」，存下來的薪資記錄在薪資總覽也查不到
    for (const value of ['2026-10-15', '2026-13-01', '2026-00-01', '2026-1-01', 'abc', '', null, undefined, 202610, {}, ['2026-10-01'], new Date('2026-10-15T00:00:00.000Z'), new Date('x')]) {
      expect(normalizePayrollMonth(value)).toBeNull()
    }
  })
})
