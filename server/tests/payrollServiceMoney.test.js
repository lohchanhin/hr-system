import { jest } from '@jest/globals'

// 薪資計算（services/payrollService.calculateEmployeePayroll）的金額規則：
// 每一項都是整數元、各項加起來等於總額、扣款超過本薪時列出沒扣到的金額、勞保級距在邊界與最高級的查法。

const mockFindById = jest.fn()
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: { findById: mockFindById } }))

const mockCalculateCompleteWorkData = jest.fn()
jest.unstable_mockModule('../src/services/workHoursCalculationService.js', () => ({
  calculateCompleteWorkData: mockCalculateCompleteWorkData,
}))

const mockCalculateLateEarlyDeductions = jest.fn()
jest.unstable_mockModule('../src/services/attendanceDeductionService.js', () => ({
  calculateLateEarlyDeductions: mockCalculateLateEarlyDeductions,
}))

const mockCalculateNightShiftAllowance = jest.fn()
jest.unstable_mockModule('../src/services/nightShiftAllowanceService.js', () => ({
  calculateNightShiftAllowance: mockCalculateNightShiftAllowance,
}))

const mockApprovalRequest = { find: jest.fn() }
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))

const mockLaborInsuranceRate = { findOne: jest.fn(), find: jest.fn() }
jest.unstable_mockModule('../src/models/LaborInsuranceRate.js', () => ({ default: mockLaborInsuranceRate }))

const { calculateEmployeePayroll } = await import('../src/services/payrollService.js')
const { findInsuranceLevelBySalary, DEFAULT_LABOR_INSURANCE_RATES } = await import('../src/services/laborInsuranceService.js')

const WORK_DATA = {
  workDays: 22, scheduledHours: 176, actualWorkHours: 176, hourlyRate: 200, dailyRate: 1600,
  leaveHours: 0, paidLeaveHours: 0, unpaidLeaveHours: 0, sickLeaveHours: 0, personalLeaveHours: 0, leaveDeduction: 0,
  overtimeHours: 3, overtimePay: 867, baseSalary: 48000,
}

function employee(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    name: '王月薪',
    salaryType: '月薪',
    salaryAmount: 48000,
    laborPensionSelf: 0,
    employeeAdvance: 0,
    salaryAccountA: { bank: '050', acct: '111' },
    salaryAccountB: { bank: '053', acct: '222' },
    monthlySalaryAdjustments: {},
    ...overrides,
  }
}

beforeEach(() => {
  mockFindById.mockReset()
  mockCalculateCompleteWorkData.mockReset().mockResolvedValue({ ...WORK_DATA })
  mockCalculateLateEarlyDeductions.mockReset().mockResolvedValue({ totalDeduction: 0 })
  mockCalculateNightShiftAllowance.mockReset().mockResolvedValue({ allowanceAmount: 0, nightShiftDays: 0, nightShiftHours: 0 })
  mockApprovalRequest.find.mockReset()
  mockLaborInsuranceRate.findOne.mockReset()
  mockLaborInsuranceRate.find.mockReset()
})

const MONEY_KEYS = [
  'baseSalary', 'laborInsuranceFee', 'healthInsuranceFee', 'laborPensionSelf', 'employeeAdvance', 'debtGarnishment',
  'otherDeductions', 'lateEarlyDeduction', 'deductionShortfall', 'netPay', 'nightShiftAllowance', 'performanceBonus',
  'otherBonuses', 'overtimePay', 'recurringAllowance', 'totalBonus', 'totalPayment', 'amount',
]

function expectReconciled(result) {
  MONEY_KEYS.forEach((key) => {
    expect([key, Number.isInteger(result[key])]).toEqual([key, true])
  })
  const deductions = result.laborInsuranceFee + result.healthInsuranceFee + result.laborPensionSelf
    + result.employeeAdvance + result.debtGarnishment + result.otherDeductions
  expect(result.netPay).toBe(Math.max(result.baseSalary - deductions, 0))
  expect(result.deductionShortfall).toBe(Math.max(deductions - result.baseSalary, 0))
  expect(result.totalBonus).toBe(
    result.nightShiftAllowance + result.performanceBonus + result.otherBonuses + result.overtimePay + result.recurringAllowance,
  )
  expect(result.totalPayment).toBe(result.netPay + result.totalBonus)
}

describe('calculateEmployeePayroll：金額是整數元，各項加起來等於總額', () => {
  it('設定值帶小數時各項先四捨五入再加總（實領、獎金合計、總額都不會有小數）', async () => {
    mockCalculateLateEarlyDeductions.mockResolvedValue({ totalDeduction: 100.5 }) // 每次遲到扣 33.5 元 × 3 次
    const person = employee({
      laborPensionSelf: 2748.6,
      employeeAdvance: 499.5,
      salaryItems: ['組長加給'],
      salaryItemAmounts: { 組長加給: 2000.4 },
      monthlySalaryAdjustments: { healthInsuranceFee: 710.25, debtGarnishment: 1000.75, otherDeductions: 50.5, performanceBonus: 1000.5, otherBonuses: 333.3 },
    })

    const result = await calculateEmployeePayroll(person._id, '2026-10-01', {}, { employee: person, insuranceRates: DEFAULT_LABOR_INSURANCE_RATES })

    expect(result).toMatchObject({
      baseSalary: 48000, laborInsuranceFee: 1145, healthInsuranceFee: 710, laborPensionSelf: 2749, employeeAdvance: 500,
      debtGarnishment: 1001, lateEarlyDeduction: 101, otherDeductions: 51 + 101,
      performanceBonus: 1001, otherBonuses: 333, recurringAllowance: 2000, overtimePay: 867,
    })
    expectReconciled(result)
  })

  it('不是數字的設定值算 0，不會讓實領變成 NaN', async () => {
    const person = employee({
      laborPensionSelf: 'abc',
      monthlySalaryAdjustments: { healthInsuranceFee: 'n/a', performanceBonus: undefined, otherBonuses: null },
    })

    const result = await calculateEmployeePayroll(person._id, '2026-10-01', { employeeAdvance: Number.NaN }, { employee: person, insuranceRates: DEFAULT_LABOR_INSURANCE_RATES })

    expect(result).toMatchObject({ healthInsuranceFee: 0, laborPensionSelf: 0, employeeAdvance: 0, netPay: 48000 - 1145 })
    expectReconciled(result)
  })

  it('扣款超過本薪：實領是 0，沒扣到的金額列在 deductionShortfall', async () => {
    mockCalculateCompleteWorkData.mockResolvedValue({ ...WORK_DATA, baseSalary: 30000, overtimePay: 0 })
    const person = employee({ salaryAmount: 30000, employeeAdvance: 50000 })

    const result = await calculateEmployeePayroll(person._id, '2026-10-01', {}, { employee: person, insuranceRates: DEFAULT_LABOR_INSURANCE_RATES })

    expect(result).toMatchObject({ baseSalary: 30000, laborInsuranceFee: 758, employeeAdvance: 50000, netPay: 0, deductionShortfall: 20758, totalPayment: 0 })
    expectReconciled(result)
  })

  it('整月無薪（本薪 0）：沒有勞保費，所有金額都是 0，不會出現 NaN', async () => {
    mockCalculateCompleteWorkData.mockResolvedValue({ ...WORK_DATA, workDays: 0, scheduledHours: 0, actualWorkHours: 0, hourlyRate: 0, dailyRate: 0, overtimeHours: 0, overtimePay: 0, baseSalary: 0 })
    const person = employee({ salaryType: undefined, salaryAmount: undefined, monthlySalaryAdjustments: undefined, salaryAccountA: undefined, salaryAccountB: undefined })

    const result = await calculateEmployeePayroll(person._id, '2026-10-01', {}, { employee: person, insuranceRates: DEFAULT_LABOR_INSURANCE_RATES })

    expect(result).toMatchObject({ baseSalary: 0, laborInsuranceFee: 0, netPay: 0, totalBonus: 0, totalPayment: 0, insuredSalary: 0 })
    expect(result.insuranceLevel).toBeUndefined()
    expect(result.bankAccountA).toEqual({ bank: '', accountNumber: '', accountName: '王月薪' })
    expectReconciled(result)
  })

  it('沒有資料庫連線（單元測試）時不查核准的獎金申請，獎金用員工的設定值', async () => {
    const person = employee({ monthlySalaryAdjustments: { performanceBonus: 3000, otherBonuses: 1000 } })

    const result = await calculateEmployeePayroll(person._id, '2026-10-01', {}, { employee: person, insuranceRates: DEFAULT_LABOR_INSURANCE_RATES })

    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
    expect(result).toMatchObject({ performanceBonus: 3000, otherBonuses: 1000 })
  })

  it('呼叫端已經把核准的獎金加總進 customData（approvedBonusApplied）時直接採用，不再查一次', async () => {
    const person = employee({ monthlySalaryAdjustments: { performanceBonus: 3000 } })

    const result = await calculateEmployeePayroll(person._id, '2026-10-01', { performanceBonus: 5000 }, {
      employee: person, insuranceRates: DEFAULT_LABOR_INSURANCE_RATES, approvedBonusApplied: true,
    })

    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
    expect(result.performanceBonus).toBe(5000)
  })

  it('整批計算帶入級距表（context.insuranceRates）時不再每位員工查一次資料庫', async () => {
    const person = employee()

    const result = await calculateEmployeePayroll(person._id, '2026-10-01', {}, { employee: person, insuranceRates: DEFAULT_LABOR_INSURANCE_RATES })

    expect(mockLaborInsuranceRate.findOne).not.toHaveBeenCalled()
    expect(result).toMatchObject({ insuranceLevel: 28, insuredSalary: 45800, laborInsuranceFee: 1145 })
    expect(result.insuranceRate).toMatchObject({ level: 28, insuredSalary: 45800, workerFee: 1145, employerFee: 4008 })
  })
})

describe('findInsuranceLevelBySalary：級距邊界與最高級（帶入整張級距表）', () => {
  const lookup = (salary) => findInsuranceLevelBySalary(salary, DEFAULT_LABOR_INSURANCE_RATES)

  it.each([
    [1, 1, 11100],
    [11100, 1, 11100], // 剛好在級距上：就是這一級
    [11101, 2, 12540], // 超過 1 元：下一級
    [28590, 17, 28590],
    [28591, 18, 29500],
    [29500, 18, 29500], // 2026 年基本工資
    [29501, 19, 30300],
    [45799, 28, 45800],
    [45800, 28, 45800],
    [45801, 28, 45800], // 超過最高級：最高級
    [300000, 28, 45800],
  ])('薪資 %i 元 → 第 %i 級（投保薪資 %i）', async (salary, level, insuredSalary) => {
    expect(await lookup(salary)).toMatchObject({ level, insuredSalary })
  })

  it('沒有薪資（0、負數、NaN、未填）不投保：回傳 null', async () => {
    for (const salary of [0, -1, Number.NaN, undefined, null]) {
      expect(await lookup(salary)).toBeNull()
    }
  })

  it('順序打亂的級距表也查得到同一級（不依賴陣列順序）', async () => {
    const shuffled = [...DEFAULT_LABOR_INSURANCE_RATES].reverse()
    expect(await findInsuranceLevelBySalary(29501, shuffled)).toMatchObject({ level: 19 })
    expect(await findInsuranceLevelBySalary(99999, shuffled)).toMatchObject({ level: 28 })
  })

  it('沒有帶級距表時照舊查資料庫：找大於等於薪資的最小級距，找不到就取最高級', async () => {
    const limit = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ level: 28, insuredSalary: 45800 })
    const sort = jest.fn(() => ({ limit }))
    mockLaborInsuranceRate.findOne.mockReturnValue({ sort })

    expect(await findInsuranceLevelBySalary(60000)).toEqual({ level: 28, insuredSalary: 45800 })
    expect(mockLaborInsuranceRate.findOne.mock.calls[0][0]).toEqual({ insuredSalary: { $gte: 60000 } })
    expect(sort.mock.calls).toEqual([[{ insuredSalary: 1 }], [{ level: -1 }]])
  })

  it('每一級的勞工自付額 = 普通事故 11.5% 與就業保險 1% 各自乘 20% 四捨五入後相加', () => {
    DEFAULT_LABOR_INSURANCE_RATES.forEach((rate) => {
      const expected = Math.round(rate.insuredSalary * 0.115 * 0.2) + Math.round(rate.insuredSalary * 0.01 * 0.2)
      expect([rate.level, rate.workerFee]).toEqual([rate.level, expected])
    })
  })
})
