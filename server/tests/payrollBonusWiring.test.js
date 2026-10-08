import { jest } from '@jest/globals'

// 薪資總覽、銀行匯款 Excel、月薪資總覽 PDF 三個呼叫端都要把核准的獎金申請「加在」員工設定的獎金之上：
// 績效獎金申請進績效獎金、夜班進夜班津貼、其他進其他獎金；員工設定的其他獎金不能被蓋掉。
// 獎金申請依核准完成的時間（台灣時間）歸屬月份，不看送簽時間。

const mockPayrollRecord = { find: jest.fn() }
const mockEmployee = { find: jest.fn(), countDocuments: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockCalculateEmployeePayroll = jest.fn()
const mockCalculateCompleteWorkData = jest.fn()

jest.unstable_mockModule('../src/models/PayrollRecord.js', () => ({ default: mockPayrollRecord }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
jest.unstable_mockModule('../src/services/payrollService.js', () => ({
  calculateEmployeePayroll: mockCalculateEmployeePayroll,
  calculateBatchPayroll: jest.fn(),
  savePayrollRecord: jest.fn(),
  getEmployeePayrollRecords: jest.fn(),
  extractRecurringAllowance: () => ({ total: 0, breakdown: [] }),
}))
jest.unstable_mockModule('../src/services/workHoursCalculationService.js', () => ({
  calculateWorkHours: jest.fn(),
  calculateLeaveImpact: jest.fn(),
  calculateOvertimePay: jest.fn(),
  calculateCompleteWorkData: mockCalculateCompleteWorkData,
}))

let getMonthlyPayrollOverview
let generatePayrollExcel
let generateMonthlyPayrollOverviewPdf

beforeAll(async () => {
  ;({ getMonthlyPayrollOverview } = await import('../src/controllers/payrollController.js'))
  ;({ generatePayrollExcel } = await import('../src/services/payrollExportService.js'))
  ;({ generateMonthlyPayrollOverviewPdf } = await import('../src/services/payrollPdfExportService.js'))
})

const EMPLOYEE_ID = '507f1f77bcf86cd799439041'
const BONUS_FORM = { _id: 'bonus-form', name: '獎金申請' }
const BONUS_FIELDS = [
  { _id: 'f-type', form: 'bonus-form', label: '獎金類型', order: 1 },
  { _id: 'f-amount', form: 'bonus-form', label: '金額', order: 2 },
]
const LEAVE_FORM = { _id: 'leave-form', name: '請假', semanticType: 'leave' }

// 員工設定：績效獎金 3000、其他獎金 1000
function makeEmployee() {
  return {
    _id: EMPLOYEE_ID,
    employeeId: 'E001',
    name: '王小明',
    salaryAmount: 40000,
    salaryType: '月薪',
    monthlySalaryAdjustments: { performanceBonus: 3000, otherBonuses: 1000 },
    department: { _id: 'dept1', name: '護理部' },
    organization: { _id: 'org1', name: '和泰' },
  }
}

const WORK_DATA = {
  workDays: 22, scheduledHours: 176, actualWorkHours: 176, hourlyRate: 166, dailyRate: 1333,
  leaveHours: 0, paidLeaveHours: 0, unpaidLeaveHours: 0, sickLeaveHours: 0, personalLeaveHours: 0, leaveDeduction: 0,
  overtimeHours: 0, overtimePay: 0, baseSalary: 40000,
  nightShiftDays: 4, nightShiftHours: 32, nightShiftAllowance: 800,
  nightShiftCalculationMethod: 'shift', nightShiftBreakdown: [], nightShiftConfigurationIssues: [],
}

const bonusRequest = (type, amount, { finishedAt, createdAt = '2026-09-20T03:00:00.000Z' } = {}) => ({
  form: BONUS_FORM,
  status: 'approved',
  applicant_employee: EMPLOYEE_ID,
  createdAt: new Date(createdAt),
  updatedAt: new Date(finishedAt),
  form_data: { 'f-type': type, 'f-amount': amount },
  logs: [{ action: 'create', at: new Date(createdAt) }, { action: 'finish', at: new Date(finishedAt) }],
})

// 2026 年 10 月（台灣時間）核准完成的獎金申請與其他不該算進來的單
function approvedRequests() {
  return [
    // 9 月送簽、10 月初核准的績效獎金 2000：算 10 月
    bonusRequest('績效獎金', 2000, { finishedAt: '2026-10-03T02:00:00.000Z' }),
    // 台灣 10/1 01:00（UTC 9/30 17:00）核准：算 10 月，不是 9 月
    bonusRequest('其他', 500, { finishedAt: '2026-09-30T17:00:00.000Z' }),
    bonusRequest('夜班津貼', 200, { finishedAt: '2026-10-12T02:00:00.000Z' }),
    // 10 月送簽但台灣 11/1 01:00（UTC 10/31 17:00）才核准：算 11 月
    bonusRequest('績效獎金', 7777, { finishedAt: '2026-10-31T17:00:00.000Z', createdAt: '2026-10-28T03:00:00.000Z' }),
    // 9 月核准的：算 9 月
    bonusRequest('績效獎金', 8888, { finishedAt: '2026-09-15T02:00:00.000Z' }),
    // 不是獎金的單
    { form: LEAVE_FORM, status: 'approved', applicant_employee: EMPLOYEE_ID, updatedAt: new Date('2026-10-05T02:00:00.000Z'), form_data: { 'l-days': 3 } },
  ]
}

// 員工 + 核准的單加上 payrollService 的覆寫順序（customData 優先，其次員工設定），回傳最後算出的獎金
function finalBonuses(customData, employee = makeEmployee()) {
  const adjustments = employee.monthlySalaryAdjustments
  return {
    performanceBonus: customData.performanceBonus ?? adjustments.performanceBonus,
    otherBonuses: customData.otherBonuses ?? adjustments.otherBonuses,
    nightShiftAllowance: customData.nightShiftAllowance ?? 0,
  }
}

beforeEach(() => {
  mockPayrollRecord.find.mockReset()
  mockEmployee.find.mockReset()
  mockEmployee.countDocuments.mockReset()
  mockApprovalRequest.find.mockReset()
  mockFormField.find.mockReset()
  mockCalculateEmployeePayroll.mockReset()
  mockCalculateCompleteWorkData.mockReset()

  mockFormField.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(BONUS_FIELDS) })
  mockCalculateCompleteWorkData.mockResolvedValue({ ...WORK_DATA })
  mockCalculateEmployeePayroll.mockImplementation(async (employeeId, month, customData = {}) => ({
    baseSalary: 40000,
    netPay: 38000,
    overtimePay: 0,
    ...finalBonuses(customData),
  }))
  mockApprovalRequest.find.mockReturnValue({
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(approvedRequests()),
  })
})

function approvalFilter() {
  expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1)
  return mockApprovalRequest.find.mock.calls[0][0]
}

function expectCompletionMonthFilter(filter) {
  // 台灣 2026-10 = [2026-09-30T16:00Z, 2026-10-31T16:00Z)；依核准完成時間歸屬，所以送簽時間只要早於月底
  expect(filter.status).toBe('approved')
  expect(filter.createdAt).toEqual({ $lt: new Date('2026-10-31T16:00:00.000Z') })
  expect(filter.updatedAt.$gte.getTime()).toBeLessThan(new Date('2026-09-30T16:00:00.000Z').getTime())
}

function expectBonusesAddedToConfigured(customData) {
  // 績效 3000(設定) + 2000(申請)；其他 1000(設定) + 500(申請)；夜班 800(動態計算) + 200(申請)
  expect(customData).toMatchObject({ performanceBonus: 5000, otherBonuses: 1500, nightShiftAllowance: 1000 })
  expect(finalBonuses(customData)).toEqual({ performanceBonus: 5000, otherBonuses: 1500, nightShiftAllowance: 1000 })
}

describe('monthly payroll overview', () => {
  function makeEmployeeQuery(employees) {
    const query = { populate: jest.fn(), select: jest.fn(), sort: jest.fn(), skip: jest.fn(), limit: jest.fn() }
    query.populate.mockReturnValue(query)
    query.select.mockReturnValue(query)
    query.sort.mockReturnValue(query)
    query.skip.mockReturnValue(query)
    query.limit.mockResolvedValue(employees)
    return query
  }

  function createRes() {
    return {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this },
      json(payload) { this.body = payload; return this },
    }
  }

  async function overview(month = '2026-10-01') {
    mockEmployee.find.mockReturnValue(makeEmployeeQuery([makeEmployee()]))
    mockEmployee.countDocuments.mockResolvedValue(1)
    mockPayrollRecord.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
    const res = createRes()
    await getMonthlyPayrollOverview({ query: { month } }, res)
    return res
  }

  it('adds the approved 績效獎金 request to the configured one and keeps the configured 其他獎金', async () => {
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([bonusRequest('績效獎金', 2000, { finishedAt: '2026-10-03T02:00:00.000Z' })]),
    })

    const res = await overview()

    expect(res.statusCode).toBe(200)
    const customData = mockCalculateEmployeePayroll.mock.calls[0][2]
    expect(customData.performanceBonus).toBe(5000)
    // 沒有其他獎金的申請：不放進 customData，薪資計算才會用員工設定的 1000
    expect(customData).not.toHaveProperty('otherBonuses')
    expect(res.body.items[0]).toMatchObject({ performanceBonus: 5000, otherBonuses: 1000 })
  })

  it('puts every typed request into its own bucket on top of the configured amounts', async () => {
    const res = await overview()

    expect(res.statusCode).toBe(200)
    expectBonusesAddedToConfigured(mockCalculateEmployeePayroll.mock.calls[0][2])
    // 回傳給畫面的也是加總後的數字，夜班津貼沒有被動態計算值蓋掉
    expect(res.body.items[0]).toMatchObject({ performanceBonus: 5000, otherBonuses: 1500, nightShiftAllowance: 1000 })
  })

  it('selects the requests by the month they were approved, not the month they were filed', async () => {
    await overview()

    expectCompletionMonthFilter(approvalFilter())
  })

  it('does not count a request approved in the next or the previous month (Taipei time)', async () => {
    const res = await overview()

    // 7777（台灣 11/1 核准）與 8888（9 月核准）都不在 customData 的加總裡
    expect(res.body.items[0].performanceBonus).toBe(5000)
  })

  it('loads the field definitions of the bonus forms once for the page and passes them on', async () => {
    await overview()

    expect(mockFormField.find).toHaveBeenCalledTimes(1)
    expect(mockFormField.find).toHaveBeenCalledWith({ form: { $in: ['bonus-form'] } })
  })

  it('shows the configured bonuses untouched when nothing was approved this month', async () => {
    mockApprovalRequest.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) })

    const res = await overview()

    expect(mockCalculateEmployeePayroll.mock.calls[0][2]).not.toHaveProperty('performanceBonus')
    expect(res.body.items[0]).toMatchObject({ performanceBonus: 3000, otherBonuses: 1000 })
  })
})

describe('bank transfer Excel export (no saved payroll records)', () => {
  async function exportExcel() {
    mockPayrollRecord.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
    })
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([{ ...makeEmployee(), salaryAccountB: { accountNumber: '123456789' } }]),
    })
    return generatePayrollExcel('2026-10-01', 'bonusSlip', { companyName: '測試公司' })
  }

  it('adds the approved requests to the configured bonuses', async () => {
    const buffer = await exportExcel()

    expect(buffer).toBeInstanceOf(Buffer)
    expect(mockCalculateEmployeePayroll).toHaveBeenCalledTimes(1)
    expectBonusesAddedToConfigured(mockCalculateEmployeePayroll.mock.calls[0][2])
  })

  it('selects the requests by the month they were approved, not the month they were filed', async () => {
    await exportExcel()

    expectCompletionMonthFilter(approvalFilter())
    expect(approvalFilter().applicant_employee).toBe(EMPLOYEE_ID)
  })

  it('keeps the configured bonuses when no bonus request was approved', async () => {
    mockApprovalRequest.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) })

    await exportExcel()

    const customData = mockCalculateEmployeePayroll.mock.calls[0][2]
    expect(customData).not.toHaveProperty('performanceBonus')
    expect(finalBonuses(customData)).toMatchObject({ performanceBonus: 3000, otherBonuses: 1000 })
  })
})

describe('monthly payroll overview PDF', () => {
  async function exportPdf() {
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([makeEmployee()]),
    })
    mockPayrollRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) })
    return generateMonthlyPayrollOverviewPdf('2026-10-01', {})
  }

  it('adds the approved requests to the configured bonuses', async () => {
    const buffer = await exportPdf()

    expect(buffer).toBeInstanceOf(Buffer)
    expect(mockCalculateEmployeePayroll).toHaveBeenCalledTimes(1)
    expectBonusesAddedToConfigured(mockCalculateEmployeePayroll.mock.calls[0][2])
  })

  it('selects the requests by the month they were approved, not the month they were filed', async () => {
    await exportPdf()

    expectCompletionMonthFilter(approvalFilter())
  })

  it('reads the configured bonuses of the employee (the monthly adjustments are part of the employee projection)', async () => {
    const select = jest.fn().mockResolvedValue([makeEmployee()])
    mockEmployee.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), select })
    mockPayrollRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) })

    await generateMonthlyPayrollOverviewPdf('2026-10-01', {})

    expect(select.mock.calls[0][0]).toContain('monthlySalaryAdjustments')
  })
})
