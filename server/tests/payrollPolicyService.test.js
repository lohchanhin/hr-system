import { describe, expect, it } from '@jest/globals'
import {
  PayrollPolicyValidationError,
  buildPayrollPolicyUpdate,
  getDefaultPayrollPolicy,
  loadPayrollPolicy,
  parseOvertimeRate,
  resolvePayrollPolicy,
} from '../src/services/payrollPolicyService.js'
import { DEFAULT_OVERTIME_RATES, OVERTIME_CONFIG } from '../src/config/salaryConfig.js'
import { summarizeOverviewRows } from '../src/controllers/payrollController.js'

// 薪資政策：沒存的欄位就是預設值（以前寫死的做法），驗證與部分更新的規則
describe('payrollPolicyService', () => {
  it('預設值就是以前寫死的常數：days30、OVERTIME_CONFIG 的倍率、新進員工預設開啟', () => {
    const policy = getDefaultPayrollPolicy()
    expect(policy.proration.method).toBe('days30')
    expect(policy.overtime.newEmployeeAutoCalc).toBe(true)
    expect(policy.overtime.rates).toEqual(DEFAULT_OVERTIME_RATES)
    expect(policy.overtime.rates.weekdayFirst2).toBe(OVERTIME_CONFIG.WEEKDAY_FIRST_2_HOURS)
    expect(policy.overtime.rates.holidayAfter8First2).toBe(OVERTIME_CONFIG.WEEKDAY_FIRST_2_HOURS)
    expect(policy.overtime.rates.holidayAfter10).toBe(OVERTIME_CONFIG.WEEKDAY_AFTER_2_HOURS)
    // 每次都是新的複本
    policy.overtime.rates.weekdayFirst2 = 9
    expect(getDefaultPayrollPolicy().overtime.rates.weekdayFirst2).toBe(4 / 3)
  })

  it('沒有資料庫連線時 loadPayrollPolicy 回傳預設值', async () => {
    expect(await loadPayrollPolicy()).toEqual(getDefaultPayrollPolicy())
  })

  it('倍率：1～5，最多小數兩位或三分之一的倍數；接受數字字串與分數字串', () => {
    expect(parseOvertimeRate(1.5)).toBe(1.5)
    expect(parseOvertimeRate('2.25')).toBe(2.25)
    expect(parseOvertimeRate('4/3')).toBe(4 / 3)
    expect(parseOvertimeRate(4 / 3)).toBe(4 / 3)
    expect(parseOvertimeRate(1.3333333333333333)).toBe(4 / 3)
    expect(parseOvertimeRate(1)).toBe(1)
    expect(parseOvertimeRate(5)).toBe(5)
    for (const bad of [0.99, 5.01, 1.333, 1.005, '1.2.3', 'abc', '', null, undefined, NaN, Infinity, true, {}, [2], '7/6']) {
      expect(parseOvertimeRate(bad)).toBeNull()
    }
  })

  it('讀取：沒有文件、欄位缺少或存的值不合格都用預設值；customized 只標出真的改過的欄位', () => {
    expect(resolvePayrollPolicy(null)).toEqual({
      policy: getDefaultPayrollPolicy(),
      customized: { prorationMethod: false, overtimeRates: [], newEmployeeAutoCalc: false },
    })
    const { policy, customized } = resolvePayrollPolicy({
      proration: { method: 'none' },
      overtime: { rates: { weekdayFirst2: 2, weekdayAfter2: 99, restDayFirst2: 'abc', holidayWithin8: 1 }, newEmployeeAutoCalc: false },
    })
    expect(policy.proration.method).toBe('none')
    expect(policy.overtime.rates).toEqual({ ...DEFAULT_OVERTIME_RATES, weekdayFirst2: 2 })
    expect(policy.overtime.newEmployeeAutoCalc).toBe(false)
    expect(customized).toEqual({ prorationMethod: true, overtimeRates: ['weekdayFirst2'], newEmployeeAutoCalc: true })
    expect(resolvePayrollPolicy({ proration: { method: 'weekly' } }).policy.proration.method).toBe('days30')
  })

  it('部分更新：只改有送的欄位；送 null 或預設值就清掉已存的值（回到預設）', () => {
    expect(buildPayrollPolicyUpdate({ proration: { method: 'calendarDays' } })).toEqual({ $set: { 'proration.method': 'calendarDays' }, $unset: {} })
    expect(buildPayrollPolicyUpdate({ proration: { method: 'days30' } })).toEqual({ $set: {}, $unset: { 'proration.method': 1 } })
    expect(buildPayrollPolicyUpdate({ overtime: { rates: { weekdayFirst2: '2', weekdayAfter2: 5 / 3, restDayFirst2: null }, newEmployeeAutoCalc: false } })).toEqual({
      $set: { 'overtime.rates.weekdayFirst2': 2, 'overtime.newEmployeeAutoCalc': false },
      $unset: { 'overtime.rates.weekdayAfter2': 1, 'overtime.rates.restDayFirst2': 1 },
    })
    // GET 回傳的 defaults 原樣送回來：全部清掉
    const defaults = getDefaultPayrollPolicy()
    const reset = buildPayrollPolicyUpdate(defaults)
    expect(reset.$set).toEqual({})
    expect(Object.keys(reset.$unset).sort()).toEqual([
      'overtime.newEmployeeAutoCalc', 'proration.method',
      ...Object.keys(DEFAULT_OVERTIME_RATES).map((key) => `overtime.rates.${key}`),
    ].sort())
  })

  it('不合格的內容丟出中文的驗證錯誤', () => {
    const cases = [
      [null, /格式不正確/], [[], /格式不正確/], [{}, /沒有要更新/], [{ foo: 1 }, /不認得的設定：foo/],
      [{ proration: 'none' }, /proration/], [{ proration: { method: 'x' } }, /days30、calendarDays、none/],
      [{ proration: { method: 'none', basis: 30 } }, /proration\.basis/],
      [{ overtime: { rates: [] } }, /overtime\.rates/], [{ overtime: { rates: { nightBonus: 2 } } }, /overtime\.rates\.nightBonus/],
      [{ overtime: { rates: { weekdayFirst2: 6 } } }, /平日加班前 2 小時/], [{ overtime: { newEmployeeAutoCalc: 1 } }, /true 或 false/],
      [{ overtime: { extra: true } }, /overtime\.extra/],
    ]
    for (const [body, message] of cases) {
      expect(() => buildPayrollPolicyUpdate(body)).toThrow(PayrollPolicyValidationError)
      expect(() => buildPayrollPolicyUpdate(body)).toThrow(message)
    }
  })
})

describe('summarizeOverviewRows（薪資總覽的 summary）', () => {
  it('各列先四捨五入成整數再加；headCount 是符合條件的人數', () => {
    const summary = summarizeOverviewRows([
      { netPay: 100.4, totalBonus: 10, totalPayment: 110.4, baseSalary: 200, hasPayrollRecord: true },
      { netPay: 50.6, totalBonus: undefined, totalPayment: 'x', baseSalary: 0 },
    ], 2)
    expect(summary.headCount).toBe(2)
    expect(summary.withPayrollRecord).toBe(1)
    expect(summary.totals).toMatchObject({ netPay: 151, totalBonus: 10, totalPayment: 110, baseSalary: 200, overtimePay: 0 })
    expect(summarizeOverviewRows([], 0)).toMatchObject({ headCount: 0, withPayrollRecord: 0, totals: { netPay: 0 } })
  })
})
