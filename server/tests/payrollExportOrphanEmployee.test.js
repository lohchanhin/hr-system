import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import ExcelJS from 'exceljs'

// 員工被刪除後，薪資記錄 populate('employee') 會得到 null；
// 銀行匯款匯出以前會因為讀不到 employee.name 而整個月份都失敗。
const mockPayrollRecord = { find: jest.fn() }
const mockEmployee = { find: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }

let generatePayrollExcel

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/PayrollRecord.js', () => ({ default: mockPayrollRecord }))
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
  await jest.unstable_mockModule('../src/services/payrollService.js', () => ({
    calculateEmployeePayroll: jest.fn(),
    extractRecurringAllowance: jest.fn(),
  }))
  await jest.unstable_mockModule('../src/services/workHoursCalculationService.js', () => ({
    calculateCompleteWorkData: jest.fn(),
  }))
  ;({ generatePayrollExcel } = await import('../src/services/payrollExportService.js'))
})

const liveRecord = {
  employee: { name: '在職員工', idNumber: 'A123456789', email: 'live@example.com' },
  bankAccountA: { accountNumber: '111222333', bankCode: '050', branchCode: '5206' },
  bankAccountB: {},
  netPay: 40000,
}
const orphanRecord = { employee: null, bankAccountA: { accountNumber: '999888777' }, bankAccountB: {}, netPay: 30000 }

function mockRecords(records) {
  mockPayrollRecord.find.mockReturnValue({
    populate: () => ({ sort: () => Promise.resolve(records) }),
  })
}

async function sheetText(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const lines = []
  workbook.worksheets[0].eachRow(row => lines.push(row.values.slice(1).join('|')))
  return lines.join('\n')
}

beforeEach(() => {
  mockPayrollRecord.find.mockReset()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('generatePayrollExcel with payroll records of deleted employees', () => {
  it.each(['taiwan', 'taichung'])('skips the orphan record and still exports the rest (%s)', async format => {
    mockRecords([liveRecord, orphanRecord])

    const buffer = await generatePayrollExcel('2026-09-01', format, {})

    const text = await sheetText(buffer)
    expect(text).toContain('在職員工')
    expect(text).not.toContain('999888777')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('1 record(s)'))
  })

  it('does not warn when every record still has its employee', async () => {
    mockRecords([liveRecord])

    await generatePayrollExcel('2026-09-01', 'taiwan', {})

    expect(console.warn).not.toHaveBeenCalled()
  })
})
