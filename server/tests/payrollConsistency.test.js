import { jest } from '@jest/globals'
import ExcelJS from 'exceljs'

// 同一位員工同一個月，在薪資總覽、月薪資總覽 PDF、銀行匯款 Excel 要是同樣的數字。
// 修正前（以真實資料重現過）：
// - 薪資總覽與 PDF 的員工投影沒有 autoOvertimeCalc，加班費一律是 0（明細與匯出卻有）
// - 本薪算出 0 元（整月無薪假、時薪沒有出勤）時，總覽把它換成員工的薪資金額
// - 只要當月有任何一筆薪資記錄，匯款檔就只剩有記錄的那幾個人
// - 沒有薪資記錄時匯款檔的帳號欄全部空白（員工資料的帳號欄位是 acct，匯款檔讀 accountNumber）
// - 已離職（整月不在職、沒有任何金額）的員工仍列在匯款名單
// - 獎金紙條的合計沒有定期津貼；PDF 的扣款欄把請假扣款算了兩次、又漏了借支與債權扣押
// - 個人薪資表把請假扣了兩次，「職退健」印的是級距序號

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
  extractRecurringAllowance: jest.fn(),
}))
jest.unstable_mockModule('../src/services/workHoursCalculationService.js', () => ({
  calculateWorkHours: jest.fn(),
  calculateLeaveImpact: jest.fn(),
  calculateOvertimePay: jest.fn(),
  calculateCompleteWorkData: mockCalculateCompleteWorkData,
}))

let controller
let exportService
let pdfService
let batchService

beforeAll(async () => {
  controller = await import('../src/controllers/payrollController.js')
  exportService = await import('../src/services/payrollExportService.js')
  pdfService = await import('../src/services/payrollPdfExportService.js')
  batchService = await import('../src/services/payrollBatchService.js')
})

const ID_A = '507f1f77bcf86cd799439a01'
const ID_B = '507f1f77bcf86cd799439a02'
const ID_C = '507f1f77bcf86cd799439a03'

function makeEmployee(id, name, extra = {}) {
  return {
    _id: id,
    employeeId: `E-${name}`,
    name,
    salaryType: '月薪',
    salaryAmount: 48000,
    salaryItems: ['組長加給'],
    salaryItemAmounts: { 組長加給: 2000 },
    monthlySalaryAdjustments: {},
    department: { _id: 'dept1', name: '護理部' },
    organization: 'org1',
    salaryAccountA: { bank: '050', acct: `A-${name}` },
    salaryAccountB: { bank: '053', acct: `B-${name}` },
    ...extra,
  }
}

const WORK_DATA = {
  workDays: 18, scheduledHours: 176, actualWorkHours: 144.5, hourlyRate: 200, dailyRate: 1600,
  leaveHours: 16, paidLeaveHours: 0, unpaidLeaveHours: 16, sickLeaveHours: 8, personalLeaveHours: 12, leaveDeduction: 3200,
  overtimeHours: 19, overtimePay: 4867, overtimeIssues: [], baseSalary: 44800,
  nightShiftDays: 2, nightShiftHours: 14, nightShiftAllowance: 600,
  nightShiftCalculationMethod: 'calculated', nightShiftBreakdown: [], nightShiftConfigurationIssues: [],
  employment: { employed: true, ratio: 1 },
}

// payrollService 的行為：customData 優先，扣款後是實領
function fakeCalculate(customData = {}, employee = {}) {
  const baseSalary = customData.baseSalary ?? employee.salaryAmount ?? 0
  const deductions = { laborInsuranceFee: 1145, healthInsuranceFee: 710, laborPensionSelf: 1000, employeeAdvance: 500, debtGarnishment: 300, otherDeductions: 150 }
  const total = Object.values(deductions).reduce((sum, value) => sum + value, 0)
  return {
    ...customData,
    baseSalary,
    ...deductions,
    netPay: Math.max(baseSalary - total, 0),
    overtimePay: customData.overtimePay ?? 0,
    nightShiftAllowance: customData.nightShiftAllowance ?? 0,
    performanceBonus: customData.performanceBonus ?? 4000,
    otherBonuses: customData.otherBonuses ?? 800,
    recurringAllowance: 2000,
    insuranceLevel: 28,
  }
}

function employeeQuery(employees, terminal) {
  const query = { populate: jest.fn(), select: jest.fn(), sort: jest.fn(), skip: jest.fn(), limit: jest.fn() }
  Object.values(query).forEach((fn) => fn.mockReturnValue(query))
  query[terminal].mockResolvedValue(employees)
  return query
}

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
    setHeader() {},
    send(payload) { this.body = payload; return this },
  }
}

async function sheetRows(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const rows = []
  workbook.worksheets[0].eachRow((row) => rows.push(row.values.slice(1)))
  return rows
}

beforeEach(() => {
  mockPayrollRecord.find.mockReset()
  mockEmployee.find.mockReset()
  mockEmployee.countDocuments.mockReset()
  mockApprovalRequest.find.mockReset()
  mockFormField.find.mockReset()
  mockCalculateEmployeePayroll.mockReset()
  mockCalculateCompleteWorkData.mockReset()

  mockFormField.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) })
  mockApprovalRequest.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) })
  mockCalculateCompleteWorkData.mockResolvedValue({ ...WORK_DATA })
  mockCalculateEmployeePayroll.mockImplementation(async (employeeId, month, customData, context) => fakeCalculate(customData, context?.employee))
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('薪資總覽', () => {
  async function overview(employees, records = []) {
    const query = employeeQuery(employees, 'limit')
    mockEmployee.find.mockReturnValue(query)
    mockEmployee.countDocuments.mockResolvedValue(employees.length)
    mockPayrollRecord.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(records) })
    const res = createRes()
    await controller.getMonthlyPayrollOverview({ query: { month: '2026-10-01' } }, res)
    return { res, query }
  }

  it('員工投影帶了算加班費、在職期間、國定假日要用的欄位（少了 autoOvertimeCalc 加班費會一律是 0）', async () => {
    const { res, query } = await overview([makeEmployee(ID_A, '甲')])

    expect(res.statusCode).toBe(200)
    const fields = query.select.mock.calls[0][0].split(' ')
    expect(fields).toEqual(expect.arrayContaining([
      'autoOvertimeCalc', 'status', 'appointment', 'holidayRegime', 'requiresScheduling', 'isIndigenous',
      'salaryAmount', 'salaryType', 'salaryItems', 'salaryItemAmounts', 'monthlySalaryAdjustments',
      'laborPensionSelf', 'employeeAdvance', 'salaryAccountA', 'salaryAccountB', 'photo',
    ]))
    // 計算時拿到的就是這位員工（含上述欄位），加班費照工時資料帶入
    expect(mockCalculateCompleteWorkData.mock.calls[0][2].employee).toBe(mockCalculateEmployeePayroll.mock.calls[0][3].employee)
    expect(res.body.items[0]).toMatchObject({ overtimeHours: 19, overtimePay: 4867 })
  })

  it('各項加起來等於總額：獎金合計 = 加班 + 夜班 + 績效 + 其他 + 定期津貼，總額 = 實領 + 獎金合計', async () => {
    const { res } = await overview([makeEmployee(ID_A, '甲')])
    const row = res.body.items[0]

    expect(row).toMatchObject({ baseSalary: 44800, netPay: 44800 - 3805, overtimePay: 4867, nightShiftAllowance: 600, performanceBonus: 4000, otherBonuses: 800, recurringAllowance: 2000 })
    expect(row.totalBonus).toBe(4867 + 600 + 4000 + 800 + 2000)
    expect(row.totalPayment).toBe(row.netPay + row.totalBonus)
    expect(row.employment).toEqual({ employed: true, ratio: 1 })
  })

  it('本薪算出 0 元（整月無薪假、時薪沒有出勤、已離職）就顯示 0，不會換成員工的薪資金額', async () => {
    mockCalculateCompleteWorkData.mockResolvedValue({ ...WORK_DATA, baseSalary: 0, overtimeHours: 0, overtimePay: 0, nightShiftAllowance: 0, employment: { employed: false, ratio: 0, reason: 'after_resignation' } })
    const { res } = await overview([makeEmployee(ID_A, '時薪零出勤', { salaryType: '時薪', salaryAmount: 200 })])

    expect(res.body.items[0]).toMatchObject({ baseSalary: 0, netPay: 0 })
    expect(res.body.items[0].employment).toMatchObject({ employed: false, reason: 'after_resignation' })
  })

  it('有薪資記錄：金額用記錄的，夜班津貼照現在的班表重算；沒有記錄的員工即時計算', async () => {
    const record = {
      _id: 'rec-a', employee: ID_A, baseSalary: 40000, netPay: 37000, overtimePay: 1000, nightShiftAllowance: 0,
      performanceBonus: 500, otherBonuses: 0, recurringAllowance: 2000, laborInsuranceFee: 1002,
    }
    const { res } = await overview([makeEmployee(ID_A, '甲'), makeEmployee(ID_B, '乙')], [record])
    const [a, b] = res.body.items

    expect(a).toMatchObject({ hasPayrollRecord: true, baseSalary: 40000, netPay: 37000, overtimePay: 1000, performanceBonus: 500, nightShiftAllowance: 600 })
    expect(a.totalBonus).toBe(1000 + 600 + 500 + 0 + 2000)
    expect(a.totalPayment).toBe(37000 + a.totalBonus)
    expect(b).toMatchObject({ hasPayrollRecord: false, baseSalary: 44800, overtimePay: 4867 })
    // 有記錄的員工不重新計算薪資
    expect(mockCalculateEmployeePayroll).toHaveBeenCalledTimes(1)
    expect(mockCalculateEmployeePayroll.mock.calls[0][0]).toBe(ID_B)
  })
})

describe('月份與參數檢查', () => {
  it.each([
    ['calculatePayroll', { body: { employeeId: ID_A, month: '2026-10-15' } }],
    ['calculateAndSavePayroll', { body: { employeeId: ID_A, month: '2026-10-15' } }],
    ['calculateBatchPayrolls', { body: { employees: [ID_A], month: 'abc' } }],
    ['listPayrolls', { query: { month: 'abc' } }],
    ['exportPayrollExcel', { query: { month: '2026-10-15', format: 'taiwan' }, body: {} }],
    ['exportMonthlyPayrollOverviewPdf', { query: { month: '2026/10' } }],
    ['exportIndividualPayrollExcel', { query: { employeeId: ID_A, month: '2026-10-31' } }],
  ])('%s：月中的日期或無法解析的月份回 400，不會計算或存檔', async (handler, req) => {
    const res = createRes()
    await controller[handler](req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('Invalid month format')
    expect(mockCalculateEmployeePayroll).not.toHaveBeenCalled()
  })

  it('月薪資總覽 PDF：部門等篩選條件不是合法的 ID 時回 400（不是資料庫的轉型錯誤訊息），也不會去查員工', async () => {
    const res = createRes()
    await controller.exportMonthlyPayrollOverviewPdf({ query: { month: '2026-10-01', department: 'bad' } }, res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid department filter' })
    expect(mockEmployee.find).not.toHaveBeenCalled()
  })

  it('calculatePayroll：YYYY-MM 也接受，交給計算的是該月第一天', async () => {
    const res = createRes()
    await controller.calculatePayroll({ body: { employeeId: ID_A, month: '2026-10' } }, res)

    expect(res.statusCode).toBe(200)
    expect(mockCalculateEmployeePayroll).toHaveBeenCalledWith(ID_A, '2026-10-01', {})
  })
})

describe('銀行匯款 Excel', () => {
  function setup({ records = [], employees }) {
    mockPayrollRecord.find.mockReturnValue({ populate: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(records) }) })
    mockEmployee.find.mockReturnValue(employeeQuery(employees, 'sort'))
  }

  it('沒有薪資記錄：帳號取自員工資料（acct），轉入金額是實領', async () => {
    setup({ employees: [makeEmployee(ID_A, '甲'), makeEmployee(ID_B, '乙')] })

    const taichung = await sheetRows(await exportService.generatePayrollExcel('2026-10-01', 'taichung', {}))
    const taiwan = await sheetRows(await exportService.generatePayrollExcel('2026-10-01', 'taiwan', {}))

    const list = taichung.filter((row) => typeof row[0] === 'number')
    expect(list.map((row) => [row[4], row[6], row[9]])).toEqual([
      ['甲', 'B-甲', '40,995'],
      ['乙', 'B-乙', '40,995'],
    ])
    expect(taiwan.filter((row) => row[0] === '0002').map((row) => [row[3], row[2]])).toEqual([['甲', 'A-甲'], ['乙', 'A-乙']])
  })

  it('只有一部分員工有薪資記錄：有記錄的用記錄的金額，其他員工即時計算，一個都不會少', async () => {
    const employees = [makeEmployee(ID_A, '甲'), makeEmployee(ID_B, '乙'), makeEmployee(ID_C, '丙')]
    const record = {
      employee: { _id: ID_B, name: '乙' }, baseSalary: 40000, netPay: 37000, overtimePay: 1000, performanceBonus: 500,
      otherBonuses: 0, recurringAllowance: 2000, nightShiftAllowance: 0,
      bankAccountA: { bank: '050', accountNumber: 'REC-A' }, bankAccountB: { bank: '053', accountNumber: 'REC-B' },
    }
    setup({ records: [record], employees })

    const rows = await sheetRows(await exportService.generatePayrollExcel('2026-10-01', 'taichung', {}))
    const list = rows.filter((row) => typeof row[0] === 'number')

    expect(list.map((row) => [row[4], row[6], row[9]])).toEqual([
      ['甲', 'B-甲', '40,995'],
      ['乙', 'REC-B', '37,000'],
      ['丙', 'B-丙', '40,995'],
    ])
    expect(rows.some((row) => row[0] === '共3筆')).toBe(true)
    // 有記錄的員工不重新計算薪資，另外兩位才計算
    expect(mockCalculateEmployeePayroll.mock.calls.map((call) => call[0]).sort()).toEqual([ID_A, ID_C])
  })

  it('獎金紙條：有定期津貼一欄，合計等於匯入獎金帳戶的金額（與薪資總覽的獎金合計相同）', async () => {
    setup({ employees: [makeEmployee(ID_A, '甲')] })

    const rows = await sheetRows(await exportService.generatePayrollExcel('2026-10-01', 'bonusSlip', {}))
    const header = rows.find((row) => row[0] === '員工編號')
    const data = rows.find((row) => row[1] === '甲')

    expect(header).toEqual(['員工編號', '姓名', '部門', '銀行代碼', '帳號末四碼', '加班費', '夜班津貼', '績效獎金', '其他獎金', '定期津貼', '簽核調整', '獎金合計', '備註'])
    expect(data.slice(5, 12)).toEqual([4867, 600, 4000, 800, 2000, 0, 4867 + 600 + 4000 + 800 + 2000])
    expect(data[2]).toBe('護理部')
    expect(data[4]).toBe('*B-甲'.slice(-4).padStart(4, '*'))
  })

  it('整個月都不在職而且沒有任何金額的員工不列入匯款名單；月中離職（還有薪水）照列', async () => {
    const gone = makeEmployee(ID_A, '去年離職', { status: '離職員工', salaryItems: [], salaryItemAmounts: {} })
    const leaver = makeEmployee(ID_B, '月中離職', { status: '離職員工' })
    setup({ employees: [gone, leaver] })
    mockCalculateCompleteWorkData.mockImplementation(async (employeeId) => (employeeId === ID_A
      ? { ...WORK_DATA, baseSalary: 0, overtimeHours: 0, overtimePay: 0, nightShiftAllowance: 0, employment: { employed: false, ratio: 0, reason: 'after_resignation' } }
      : { ...WORK_DATA, baseSalary: 24000, employment: { employed: true, ratio: 0.5, reason: 'partial_month' } }))
    mockCalculateEmployeePayroll.mockImplementation(async (employeeId, month, customData) => (employeeId === ID_A
      ? { baseSalary: 0, netPay: 0, overtimePay: 0, nightShiftAllowance: 0, performanceBonus: 0, otherBonuses: 0, recurringAllowance: 0 }
      : fakeCalculate(customData)))

    const rows = await sheetRows(await exportService.generatePayrollExcel('2026-10-01', 'taichung', {}))
    const list = rows.filter((row) => typeof row[0] === 'number')

    expect(list.map((row) => row[4])).toEqual(['月中離職'])
    expect(rows.some((row) => row[0] === '共1筆')).toBe(true)
  })

  it('整批的獎金申請只查一次（不是每位員工各查一次），每位員工的工時資料也只算一次', async () => {
    setup({ employees: [makeEmployee(ID_A, '甲'), makeEmployee(ID_B, '乙'), makeEmployee(ID_C, '丙')] })

    await exportService.generatePayrollExcel('2026-10-01', 'taiwan', {})

    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1)
    expect(mockApprovalRequest.find.mock.calls[0][0].applicant_employee).toEqual({ $in: [ID_A, ID_B, ID_C] })
    expect(mockCalculateCompleteWorkData).toHaveBeenCalledTimes(3)
    // 薪資計算沿用已經算好的工時資料，核准的獎金也已經加總過，不會再各查一次
    mockCalculateEmployeePayroll.mock.calls.forEach((call) => {
      expect(call[3]).toMatchObject({ workData: expect.any(Object), approvedBonusApplied: true })
    })
  })

  it('付款日的預設值是台灣的今天（伺服器是 UTC 時，台灣早上 8 點以前不會變成前一天）', async () => {
    setup({ employees: [makeEmployee(ID_A, '甲')] })
    jest.useFakeTimers({ now: new Date('2026-11-04T17:30:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] })
    try {
      const taiwan = await sheetRows(await exportService.generatePayrollExcel('2026-10-01', 'taiwan', {}))
      const taichung = await sheetRows(await exportService.generatePayrollExcel('2026-10-01', 'taichung', {}))

      // UTC 11/4 17:30 = 台灣 11/5 01:30
      expect(taiwan[1][1]).toBe('20261105')
      expect(taichung.some((row) => String(row[1]).includes('2026/11/05'))).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('月薪資總覽 PDF 的資料', () => {
  async function pdfRows(employees, records = []) {
    const query = employeeQuery(employees, 'select')
    mockEmployee.find.mockReturnValue(query)
    mockPayrollRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(records) })
    const { rows } = await pdfService.buildMonthlyPayrollOverviewRows('2026-10-01', {})
    return { rows, query }
  }

  it('與薪資總覽同一套計算：加班費、獎金、總額相同；員工投影也帶了加班與扣款要用的欄位', async () => {
    const { rows, query } = await pdfRows([makeEmployee(ID_A, '甲')])

    expect(query.select.mock.calls[0][0].split(' ')).toEqual(expect.arrayContaining(['autoOvertimeCalc', 'laborPensionSelf', 'employeeAdvance', 'status', 'appointment']))
    expect(rows[0]).toMatchObject({ baseSalary: 44800, overtimePay: 4867, nightShiftAllowance: 600, performanceBonus: 4000, otherBonuses: 800, recurringAllowance: 2000, netPay: 40995 })
    expect(rows[0].totalPayment).toBe(40995 + 4867 + 600 + 4000 + 800 + 2000)
  })

  it('扣款欄 = 勞保 + 健保 + 勞退 + 借支 + 債權扣押 + 其他（不含已經從底薪扣掉的請假扣款），底薪 - 扣款 = 實領', async () => {
    const { rows } = await pdfRows([makeEmployee(ID_A, '甲')])
    const row = rows[0]

    expect(row.leaveDeduction).toBe(3200)
    expect(row.deductions).toBe(1145 + 710 + 1000 + 500 + 300 + 150)
    expect(row.baseSalary - row.deductions).toBe(row.netPay)
  })

  it('仍然產生 PDF', async () => {
    mockEmployee.find.mockReturnValue(employeeQuery([makeEmployee(ID_A, '甲')], 'select'))
    mockPayrollRecord.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) })

    const buffer = await pdfService.generateMonthlyPayrollOverviewPdf('2026-10-01', {})

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  })
})

describe('computeEmployeePayroll（三個地方共用的計算）', () => {
  it('有薪資記錄時夜班津貼 = 現在的班表算出的津貼 + 本月核准的夜班獎金申請', async () => {
    const employee = makeEmployee(ID_A, '甲')
    const bonusForm = { _id: 'bonus-form', name: '獎金申請' }
    const approvals = [{
      form: bonusForm, status: 'approved', applicant_employee: ID_A, form_data: { 'f-type': '夜班', 'f-amount': 300 },
      logs: [{ action: 'finish', at: new Date('2026-10-05T02:00:00.000Z') }],
    }]
    const fieldsByForm = new Map([['bonus-form', [{ _id: 'f-type', label: '獎金類型' }, { _id: 'f-amount', label: '金額' }]]])

    const result = await batchService.computeEmployeePayroll({
      employee,
      month: '2026-10-01',
      storedRecord: { employee: ID_A, baseSalary: 40000, netPay: 37000, overtimePay: 0, nightShiftAllowance: 0, performanceBonus: 0, otherBonuses: 0, recurringAllowance: 0 },
      approvals,
      bonusFieldsByForm: fieldsByForm,
      bonusRange: { start: new Date('2026-09-30T16:00:00.000Z'), end: new Date('2026-10-31T16:00:00.000Z') },
    })

    expect(result.hasPayrollRecord).toBe(true)
    expect(result.payroll.nightShiftAllowance).toBe(600 + 300)
    expect(result.totalBonus).toBe(900)
    expect(result.totalPayment).toBe(37900)
    expect(mockCalculateEmployeePayroll).not.toHaveBeenCalled()
  })

  it('整批共用的班表與打卡依員工分開帶入，沒有資料的員工是空陣列（不會再各查一次）', () => {
    const employee = makeEmployee(ID_A, '甲')
    const batchData = {
      attendanceSetting: { shifts: [] },
      schedulesByEmployee: new Map([[ID_A, [{ employee: ID_A, date: new Date('2026-10-01') }]]]),
      recordsByEmployee: new Map(),
    }
    const payrollBatch = { employees: [employee] }

    const context = batchService.createCalculationContext(batchData, employee, payrollBatch)
    const other = batchService.createCalculationContext(batchData, makeEmployee(ID_B, '乙'), payrollBatch)

    expect(context).toMatchObject({ employee, payrollBatch, attendanceSetting: batchData.attendanceSetting, attendanceRecords: [] })
    expect(context.schedules).toHaveLength(1)
    expect(other.schedules).toEqual([])
    // 沒有預先讀好的資料時不放這些鍵，計算函式才會自己查
    expect(batchService.createCalculationContext({}, employee)).toEqual({ employee })
  })
})

describe('個人薪資表', () => {
  const record = {
    month: new Date('2026-10-01T00:00:00.000Z'),
    baseSalary: 44800, leaveDeduction: 3200, hourlyRate: 200, personalLeaveHours: 12, sickLeaveHours: 8,
    laborInsuranceFee: 1145, healthInsuranceFee: 710, laborPensionSelf: 1000, employeeAdvance: 500, debtGarnishment: 0, otherDeductions: 150,
    netPay: 41295, insuranceLevel: 28, insuredSalary: 45800,
  }
  const employee = { employeeId: 'P001', name: '王月薪', salaryItems: ['組長加給'], salaryItemAmounts: { 組長加給: 2000 }, annualLeave: {} }

  async function rowsOf(payrollRecord) {
    const rows = await sheetRows(await exportService.generateIndividualPayrollExcel(payrollRecord, employee, { organizationName: '和泰' }))
    return Object.fromEntries(rows.filter((row) => row.length).map((row) => [row[0], row]))
  }

  it('本薪是請假扣款前的金額：本薪 + 事假扣薪 + 病假扣薪 = 小計，小計 - 應扣項目 = 實領金額', async () => {
    const rows = await rowsOf(record)

    expect(rows['本薪'][1]).toBe(48000)
    expect(rows['事假扣薪'][1]).toBe(-2400)
    expect(rows['病假扣薪'][1]).toBe(-800)
    expect(rows['小計'][1]).toBe(44800)
    const deductions = 1145 + 710 + 1000 + 500 + 0 + 150
    expect(rows['小計'][1] - deductions).toBe(rows['小計'][5])
    expect(rows['小計'][5]).toBe(41295)
  })

  it('其餘的無薪假（事假、病假以外）與進位差放在「其他」，三列加起來一定等於請假扣款', async () => {
    const rows = await rowsOf({ ...record, baseSalary: 43000, leaveDeduction: 5000 })

    expect(rows['本薪'][1]).toBe(48000)
    expect(rows['其他：其餘無薪假'][1]).toBe(-(5000 - 2400 - 800))
    expect(rows['小計'][1]).toBe(43000)
  })

  it('日薪、時薪沒有請假扣款：事假、病假兩列是 0，本薪就是算出來的薪資', async () => {
    const rows = await rowsOf({ ...record, baseSalary: 24000, leaveDeduction: 0, hourlyRate: 250, personalLeaveHours: 8, sickLeaveHours: 4 })

    expect(rows['本薪'][1]).toBe(24000)
    expect(rows['事假扣薪'][1]).toBe(0)
    expect(rows['病假扣薪'][1]).toBe(0)
    expect(rows['小計'][1]).toBe(24000)
  })

  it('「職退健」印投保薪資、雇主勞退是投保薪資的 6%（不是級距序號 28 與 2 元）', async () => {
    const rows = await sheetRows(await exportService.generateIndividualPayrollExcel(record, employee, {}))
    const info = rows.find((row) => String(row[0]).startsWith('勞健保級距'))

    expect(info[0]).toBe('勞健保級距：職退健 45,800')
    expect(info[3]).toBe('雇主勞退 6% 提繳：2,748')
  })

  it('年月用薪資月份本身（UTC 的該月第一天），民國 115 年 10 月', async () => {
    const rows = await sheetRows(await exportService.generateIndividualPayrollExcel(record, employee, {}))

    expect(rows[0][0]).toContain('115 年 10 月')
    expect(rows[0][0]).toContain('支付日期：115.11.10')
  })
})
