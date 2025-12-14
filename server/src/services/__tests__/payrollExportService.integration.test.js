import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';

// Mock dependencies
const mockPayrollRecordFind = jest.fn();
const mockEmployeeFind = jest.fn();
const mockApprovalRequestFind = jest.fn();
const mockCalculateEmployeePayroll = jest.fn();
const mockCalculateCompleteWorkData = jest.fn();
const mockAggregateBonusFromApprovals = jest.fn();

jest.unstable_mockModule('../../models/PayrollRecord.js', () => ({
  default: {
    find: mockPayrollRecordFind
  }
}));

jest.unstable_mockModule('../../models/Employee.js', () => ({
  default: {
    find: mockEmployeeFind
  }
}));

jest.unstable_mockModule('../../models/approval_request.js', () => ({
  default: {
    find: mockApprovalRequestFind
  }
}));

jest.unstable_mockModule('../payrollService.js', () => ({
  calculateEmployeePayroll: mockCalculateEmployeePayroll
}));

jest.unstable_mockModule('../workHoursCalculationService.js', () => ({
  calculateCompleteWorkData: mockCalculateCompleteWorkData
}));

jest.unstable_mockModule('../../utils/payrollPreviewUtils.js', () => ({
  aggregateBonusFromApprovals: mockAggregateBonusFromApprovals
}));

const { generatePayrollExcel } = await import('../payrollExportService.js');

describe('generatePayrollExcel with dynamic calculation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCalculateCompleteWorkData.mockResolvedValue({
      workDays: 20,
      scheduledHours: 160,
      actualWorkHours: 160,
      hourlyRate: 200,
      dailyRate: 1600,
      leaveHours: 0,
      paidLeaveHours: 0,
      unpaidLeaveHours: 0,
      sickLeaveHours: 0,
      personalLeaveHours: 0,
      leaveDeduction: 0,
      overtimeHours: 10,
      overtimePay: 3000,
      baseSalary: 32000
    });
    mockAggregateBonusFromApprovals.mockReturnValue({
      nightShiftAllowance: 1000,
      performanceBonus: 2000,
      otherBonuses: 500,
      bonusAdjustment: 0
    });
    mockCalculateEmployeePayroll.mockResolvedValue({
      baseSalary: 32000,
      netPay: 28000,
      overtimePay: 3000,
      nightShiftAllowance: 1000,
      performanceBonus: 2000,
      otherBonuses: 500,
      bonusAdjustment: 0,
      totalBonus: 6500
    });
    mockApprovalRequestFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });
  });

  it('應在沒有薪資記錄時自動計算員工薪資並生成 bonusSlip 格式', async () => {
    // Setup: No payroll records exist
    mockPayrollRecordFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([])
    });

    // Setup: Employee exists
    const mockEmployee = {
      _id: 'emp123',
      employeeId: 'E001',
      name: '測試員工',
      salaryAmount: 32000,
      department: { name: '測試部門' },
      salaryAccountA: { bankCode: '004', accountNumber: '1234567890' },
      salaryAccountB: { bankCode: '822', accountNumber: '9876543210' }
    };

    mockEmployeeFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([mockEmployee])
    });

    // Execute
    const buffer = await generatePayrollExcel('2024-05-01', 'bonusSlip', { companyName: '測試公司' });

    // Verify calculation was called
    expect(mockCalculateCompleteWorkData).toHaveBeenCalledWith('emp123', '2024-05-01');
    expect(mockCalculateEmployeePayroll).toHaveBeenCalledWith('emp123', '2024-05-01', expect.any(Object));

    // Verify Excel was generated
    expect(buffer).toBeDefined();
    expect(buffer).toBeInstanceOf(Buffer);

    // Verify Excel content
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('獎金紙條');
    expect(sheet).toBeDefined();
  });

  it('應在沒有薪資記錄時自動計算員工薪資並生成 taiwan 格式', async () => {
    // Setup: No payroll records exist
    mockPayrollRecordFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([])
    });

    // Setup: Employee exists
    const mockEmployee = {
      _id: 'emp456',
      employeeId: 'E002',
      name: '另一位員工',
      salaryAmount: 40000,
      department: { name: '行政部' },
      salaryAccountA: { bankCode: '050', accountNumber: '1111222233', branchCode: '5206' },
      salaryAccountB: { bankCode: '004', accountNumber: '4444555566' }
    };

    mockEmployeeFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([mockEmployee])
    });

    // Execute
    const buffer = await generatePayrollExcel('2024-06-01', 'taiwan', {
      paymentAccount: '050-5206-123456789012',
      paymentAccountName: '測試公司',
      bankCode: '050',
      branchCode: '5206'
    });

    // Verify
    expect(buffer).toBeDefined();
    expect(buffer).toBeInstanceOf(Buffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('臺企匯款');
    expect(sheet).toBeDefined();
  });

  it('應在沒有薪資記錄時自動計算員工薪資並生成 taichung 格式', async () => {
    // Setup: No payroll records exist
    mockPayrollRecordFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([])
    });

    // Setup: Employee exists
    const mockEmployee = {
      _id: 'emp789',
      employeeId: 'E003',
      name: '第三位員工',
      salaryAmount: 35000,
      department: { name: '工程部' },
      salaryAccountA: { bankCode: '054', accountNumber: '7777888899' },
      salaryAccountB: { bankCode: '054', accountNumber: '1112223334' }
    };

    mockEmployeeFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([mockEmployee])
    });

    // Execute
    const buffer = await generatePayrollExcel('2024-07-01', 'taichung', {
      companyName: '測試企業',
      companyCode: '6204',
      transferAccount: '054-123-4567890',
      branchName: '埔里',
      branchFullCode: '054'
    });

    // Verify
    expect(buffer).toBeDefined();
    expect(buffer).toBeInstanceOf(Buffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('台中銀匯');
    expect(sheet).toBeDefined();
  });

  it('應在有既存薪資記錄時直接使用記錄', async () => {
    // Setup: Payroll records exist
    const mockPayrollRecord = {
      employee: {
        employeeId: 'E004',
        name: '已有記錄的員工',
        department: { name: '財務部' }
      },
      month: new Date('2024-08-01'),
      baseSalary: 45000,
      netPay: 40000,
      overtimePay: 2000,
      nightShiftAllowance: 500,
      performanceBonus: 3000,
      otherBonuses: 1000,
      bonusAdjustment: -500,
      bankAccountA: { bankCode: '004', accountNumber: '5556667778' },
      bankAccountB: { bankCode: '822', accountNumber: '9998887776' }
    };

    mockPayrollRecordFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([mockPayrollRecord])
    });

    // Execute
    const buffer = await generatePayrollExcel('2024-08-01', 'bonusSlip', { companyName: '測試公司' });

    // Verify calculation was NOT called since records exist
    expect(mockCalculateCompleteWorkData).not.toHaveBeenCalled();
    expect(mockCalculateEmployeePayroll).not.toHaveBeenCalled();
    expect(mockEmployeeFind).not.toHaveBeenCalled();

    // Verify Excel was still generated
    expect(buffer).toBeDefined();
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('應在沒有員工時拋出錯誤', async () => {
    // Setup: No payroll records
    mockPayrollRecordFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([])
    });

    // Setup: No employees
    mockEmployeeFind.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([])
    });

    // Execute & Verify
    await expect(generatePayrollExcel('2024-09-01', 'bonusSlip', {}))
      .rejects.toThrow('No employees found');
  });
});
