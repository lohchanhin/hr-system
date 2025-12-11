import ExcelJS from 'exceljs'
import { generateBonusSlipExcel } from '../payrollExportService.js'

describe('generateBonusSlipExcel', () => {
  it('應產生包含獎金欄位的工作表', async () => {
    const payrollRecords = [
      {
        employee: {
          employeeId: 'E001',
          name: '王小明',
          department: { name: '研發部' }
        },
        month: new Date('2024-05-01'),
        overtimePay: 1200,
        nightShiftAllowance: 800,
        performanceBonus: 1500,
        otherBonuses: 500,
        bonusAdjustment: -200,
        bankAccountB: { bankCode: '004', accountNumber: '123456789012' }
      }
    ]

    const buffer = await generateBonusSlipExcel(payrollRecords, { companyName: '測試公司' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)

    const sheet = workbook.getWorksheet('獎金紙條')
    expect(sheet).toBeDefined()

    const title = sheet.getCell('A1').value
    expect(title).toContain('測試公司')

    const headerRow = sheet.getRow(4)
    expect(headerRow.getCell(1).value).toBe('員工編號')
    expect(headerRow.getCell(11).value).toBe('獎金合計')

    const dataRow = sheet.getRow(5)
    expect(dataRow.getCell(1).value).toBe('E001')
    expect(dataRow.getCell(2).value).toBe('王小明')
    expect(dataRow.getCell(11).value).toBe(3800)
  })
})
