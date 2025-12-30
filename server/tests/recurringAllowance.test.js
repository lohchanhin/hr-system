import { jest } from '@jest/globals';

const mockFindById = jest.fn();
jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: { findById: mockFindById }
}));

const mockCalculateCompleteWorkData = jest.fn();
jest.unstable_mockModule('../src/services/workHoursCalculationService.js', () => ({
  calculateCompleteWorkData: mockCalculateCompleteWorkData
}));

const mockCalculateLateEarlyDeductions = jest.fn();
jest.unstable_mockModule('../src/services/attendanceDeductionService.js', () => ({
  calculateLateEarlyDeductions: mockCalculateLateEarlyDeductions
}));

const mockCalculateNightShiftAllowance = jest.fn();
jest.unstable_mockModule('../src/services/nightShiftAllowanceService.js', () => ({
  calculateNightShiftAllowance: mockCalculateNightShiftAllowance
}));

const mockFindInsuranceLevelBySalary = jest.fn();
jest.unstable_mockModule('../src/services/laborInsuranceService.js', () => ({
  findInsuranceLevelBySalary: mockFindInsuranceLevelBySalary
}));

const { calculateEmployeePayroll, extractRecurringAllowance } = await import('../src/services/payrollService.js');

describe('Recurring allowance from salary items', () => {
  const baseEmployee = {
    _id: 'emp1',
    name: 'Allowance User',
    salaryItems: ['交通津貼', '伙食補助'],
    salaryItemAmounts: {
      交通津貼: 1200,
      伙食補助: 800,
      未選項目: 500
    },
    salaryAmount: 30000,
    salaryType: '月薪',
    laborPensionSelf: 0,
    employeeAdvance: 0,
    salaryAccountA: {},
    salaryAccountB: {},
    monthlySalaryAdjustments: {}
  };

  beforeEach(() => {
    mockFindById.mockReset();
    mockCalculateCompleteWorkData.mockReset();
    mockCalculateLateEarlyDeductions.mockReset();
    mockCalculateNightShiftAllowance.mockReset();
    mockFindInsuranceLevelBySalary.mockReset();

    mockFindById.mockResolvedValue({ ...baseEmployee });
    mockCalculateCompleteWorkData.mockResolvedValue({
      workDays: 0,
      scheduledHours: 0,
      actualWorkHours: 0,
      hourlyRate: 0,
      dailyRate: 0,
      leaveHours: 0,
      paidLeaveHours: 0,
      unpaidLeaveHours: 0,
      sickLeaveHours: 0,
      personalLeaveHours: 0,
      leaveDeduction: 0,
      overtimeHours: 0,
      overtimePay: 0,
      baseSalary: baseEmployee.salaryAmount
    });
    mockCalculateLateEarlyDeductions.mockResolvedValue({ totalDeduction: 0 });
    mockCalculateNightShiftAllowance.mockResolvedValue({
      allowanceAmount: 0,
      nightShiftDays: 0,
      nightShiftHours: 0,
      calculationMethod: 'not_calculated',
      shiftBreakdown: [],
      configurationIssues: []
    });
    mockFindInsuranceLevelBySalary.mockResolvedValue({
      workerFee: 0,
      level: 1,
      insuredSalary: baseEmployee.salaryAmount,
      employerFee: 0,
      ordinaryRate: 0,
      employmentInsuranceRate: 0
    });
  });

  it('extractRecurringAllowance sums selected salary item amounts', () => {
    const { total, breakdown } = extractRecurringAllowance(baseEmployee);
    expect(total).toBe(2000);
    expect(breakdown).toEqual([
      { item: '交通津貼', amount: 1200 },
      { item: '伙食補助', amount: 800 }
    ]);
  });

  it('calculateEmployeePayroll includes recurring allowance in bonus totals', async () => {
    const result = await calculateEmployeePayroll('emp1', '2025-01-01');

    expect(result.recurringAllowance).toBe(2000);
    expect(result.recurringAllowanceBreakdown).toEqual([
      { item: '交通津貼', amount: 1200 },
      { item: '伙食補助', amount: 800 }
    ]);
    expect(result.totalBonus).toBe(2000);
    expect(result.totalPayment).toBe(result.netPay + 2000);
  });
});
