import { jest } from '@jest/globals';
import { checkMinimumWageCompliance, MINIMUM_WAGE_2026 } from '../src/config/salaryConfig.js';

const mockInsuranceRateTable = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
};
const mockLaborInsuranceRate = {
  find: jest.fn(),
  findOne: jest.fn(),
};

jest.unstable_mockModule('../src/models/InsuranceRateTable.js', () => ({ default: mockInsuranceRateTable }));
jest.unstable_mockModule('../src/models/LaborInsuranceRate.js', () => ({ default: mockLaborInsuranceRate }));
jest.unstable_mockModule('../src/services/attendanceDeductionService.js', () => ({
  calculateLateEarlyDeductions: jest.fn().mockResolvedValue({ totalDeduction: 0 }),
}));

const { loadVersionedRateTable } = await import('../src/services/laborInsuranceService.js');
const { calculateEmployeePayroll } = await import('../src/services/payrollService.js');

describe('P1 Insurance Versioning & 2026 Minimum Wage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('checkMinimumWageCompliance flags below-minimum monthly/hourly wages and exempts partTime monthly', () => {
    expect(MINIMUM_WAGE_2026).toMatchObject({ monthly: 29500, hourly: 196 });

    const lowMonthly = checkMinimumWageCompliance(28590, '月薪', false);
    expect(lowMonthly.compliant).toBe(false);
    expect(lowMonthly.warning.code).toBe('BELOW_MINIMUM_WAGE_2026');

    const partTimeMonthly = checkMinimumWageCompliance(20000, '月薪', true);
    expect(partTimeMonthly.compliant).toBe(true);

    const lowHourly = checkMinimumWageCompliance(190, '時薪', true);
    expect(lowHourly.compliant).toBe(false);

    expect(checkMinimumWageCompliance(29500, '月薪', false).compliant).toBe(true);
    expect(checkMinimumWageCompliance(196, '時薪', true).compliant).toBe(true);
  });

  it('loadVersionedRateTable queries InsuranceRateTable by effectiveFrom/effectiveTo for payroll month', async () => {
    const rates2026 = [{ level: 18, insuredSalary: 29500, workerFee: 738, employerFee: 2582 }];
    const chain = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ type: 'laborInsurance', rates: rates2026 }),
    };
    mockInsuranceRateTable.findOne.mockReturnValue(chain);

    const loaded = await loadVersionedRateTable('laborInsurance', '2026-03-01');
    expect(loaded).toEqual(rates2026);
    expect(mockInsuranceRateTable.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'laborInsurance',
        effectiveFrom: expect.objectContaining({ $lte: new Date('2026-03-01') }),
      })
    );
  });

  it('calculateEmployeePayroll uses declared laborInsuredSalary, caps health dependents at 3, and emits wage warnings', async () => {
    const employee = {
      _id: 'emp1',
      name: '王小明',
      salaryAmount: 28000,
      salaryType: '月薪',
      partTime: false,
      laborInsuredSalary: 33300,
      healthInsuredSalary: 33300,
      dependentCount: 5,
      salaryItems: [],
      salaryItemAmounts: {},
    };

    const laborRates = [
      { level: 17, insuredSalary: 28590, workerFee: 715, employerFee: 2501 },
      { level: 21, insuredSalary: 33300, workerFee: 833, employerFee: 2914 },
    ];
    const healthRates = [
      { level: 1, insuredSalary: 29500, workerFee: 458, employerFee: 1428 },
      { level: 3, insuredSalary: 33300, workerFee: 516, employerFee: 1611 },
    ];

    const result = await calculateEmployeePayroll('emp1', '2026-03-01', {}, {
      employee,
      workData: { baseSalary: 28000, workDays: 22, scheduledHours: 176, actualWorkHours: 176 },
      nightShiftAllowanceData: { allowanceAmount: 0 },
      insuranceRates: laborRates,
      healthInsuranceRates: healthRates,
      approvedBonusApplied: true,
    });

    expect(result.laborInsuranceFee).toBe(833);
    expect(result.insuredSalary).toBe(33300);
    expect(result.healthInsuranceFee).toBe(516 * 4);
    expect(result.complianceWarnings).toHaveLength(1);
    expect(result.complianceWarnings[0].code).toBe('BELOW_MINIMUM_WAGE_2026');
  });
});
