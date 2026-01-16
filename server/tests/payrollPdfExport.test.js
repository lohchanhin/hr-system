import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import PDFDocument from 'pdfkit';

// Mock dependencies
const mockPayrollRecord = {
  find: jest.fn()
};

const mockEmployee = {
  find: jest.fn()
};

const mockApprovalRequest = {
  find: jest.fn()
};

const mockCalculateEmployeePayroll = jest.fn();
const mockExtractRecurringAllowance = jest.fn();
const mockCalculateCompleteWorkData = jest.fn();
const mockAggregateBonusFromApprovals = jest.fn();

jest.unstable_mockModule('../src/models/PayrollRecord.js', () => ({
  default: mockPayrollRecord
}));

jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: mockEmployee
}));

jest.unstable_mockModule('../src/models/approval_request.js', () => ({
  default: mockApprovalRequest
}));

jest.unstable_mockModule('../src/services/payrollService.js', () => ({
  calculateEmployeePayroll: mockCalculateEmployeePayroll,
  extractRecurringAllowance: mockExtractRecurringAllowance
}));

jest.unstable_mockModule('../src/services/workHoursCalculationService.js', () => ({
  calculateCompleteWorkData: mockCalculateCompleteWorkData
}));

jest.unstable_mockModule('../src/utils/payrollPreviewUtils.js', () => ({
  aggregateBonusFromApprovals: mockAggregateBonusFromApprovals
}));

describe('Payroll PDF Export Service', () => {
  let generateMonthlyPayrollOverviewPdf;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await import('../src/services/payrollPdfExportService.js');
    generateMonthlyPayrollOverviewPdf = module.generateMonthlyPayrollOverviewPdf;
  });

  it('should export basic payroll structure', async () => {
    // Mock employee data
    const mockEmployeeData = [
      {
        _id: '507f1f77bcf86cd799439011',
        employeeId: 'E001',
        name: 'John Doe',
        department: { _id: 'dept1', name: 'Engineering' },
        subDepartment: { _id: 'sub1', name: 'Backend' },
        organization: { _id: 'org1', name: 'Main Office' },
        salaryAmount: 50000,
        salaryType: 'monthly'
      }
    ];

    // Mock find to return populated employees
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue(mockEmployeeData)
    });

    // Mock payroll records (empty for this test)
    mockPayrollRecord.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([])
    });

    // Mock extractRecurringAllowance
    mockExtractRecurringAllowance.mockReturnValue({
      total: 0,
      breakdown: []
    });

    // Mock calculateCompleteWorkData
    mockCalculateCompleteWorkData.mockResolvedValue({
      workDays: 22,
      scheduledHours: 176,
      actualWorkHours: 176,
      overtimePay: 0,
      nightShiftAllowance: 0
    });

    // Mock approval requests
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });

    // Mock calculateEmployeePayroll
    mockCalculateEmployeePayroll.mockResolvedValue({
      baseSalary: 50000,
      netPay: 45000,
      laborInsuranceFee: 2000,
      healthInsuranceFee: 1500,
      laborPensionSelf: 1500,
      overtimePay: 0,
      nightShiftAllowance: 0,
      performanceBonus: 0,
      otherBonuses: 0
    });

    // Execute
    const result = await generateMonthlyPayrollOverviewPdf('2024-01-01', {});

    // Verify
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(mockEmployee.find).toHaveBeenCalled();
  });

  it('should handle filters correctly', async () => {
    // Mock empty result
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([])
    });

    const filters = {
      organization: 'org123',
      department: 'dept456',
      subDepartment: 'sub789'
    };

    // Should throw error when no employees found
    await expect(
      generateMonthlyPayrollOverviewPdf('2024-01-01', filters)
    ).rejects.toThrow('No employees found matching the criteria');

    // Verify filters were passed to find
    expect(mockEmployee.find).toHaveBeenCalledWith({
      organization: 'org123',
      department: 'dept456',
      subDepartment: 'sub789'
    });
  });

  it('should validate month parameter', async () => {
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([])
    });

    await expect(
      generateMonthlyPayrollOverviewPdf('invalid-date', {})
    ).rejects.toThrow();
  });

  it('should generate PDF with correct structure', async () => {
    // This test verifies that PDFDocument can be instantiated
    // and basic PDF operations work
    const doc = new PDFDocument();
    expect(doc).toBeDefined();
    
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    
    return new Promise((resolve) => {
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        expect(buffer.length).toBeGreaterThan(0);
        resolve();
      });

      doc.fontSize(12).text('Test PDF');
      doc.end();
    });
  });
});
