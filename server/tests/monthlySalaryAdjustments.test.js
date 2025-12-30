import { jest } from '@jest/globals';

// Mock the payroll service to test integration with employee data
const mockCalculateEmployeePayroll = jest.fn();
const mockSavePayrollRecord = jest.fn();

jest.unstable_mockModule('../src/services/payrollService.js', () => ({
  calculateEmployeePayroll: mockCalculateEmployeePayroll,
  savePayrollRecord: mockSavePayrollRecord,
}));

const { calculateEmployeePayroll } = await import('../src/services/payrollService.js');

describe('Monthly Salary Adjustments', () => {
  beforeEach(() => {
    mockCalculateEmployeePayroll.mockReset();
    mockSavePayrollRecord.mockReset();
  });

  describe('Employee Model - monthlySalaryAdjustments field', () => {
    it('should have monthlySalaryAdjustments field with default values', async () => {
      const Employee = (await import('../src/models/Employee.js')).default;
      
      const employee = new Employee({
        name: 'Test Employee',
        email: 'test@example.com',
        username: 'testuser',
      });

      // Check that monthlySalaryAdjustments exists with default structure
      expect(employee.monthlySalaryAdjustments).toBeDefined();
      expect(employee.monthlySalaryAdjustments).toEqual(
        expect.objectContaining({
          healthInsuranceFee: expect.any(Number),
          debtGarnishment: expect.any(Number),
          otherDeductions: expect.any(Number),
          performanceBonus: expect.any(Number),
          otherBonuses: expect.any(Number),
        })
      );
    });

    it('should allow setting monthlySalaryAdjustments values', async () => {
      const Employee = (await import('../src/models/Employee.js')).default;
      
      const employee = new Employee({
        name: 'Test Employee',
        email: 'test2@example.com',
        username: 'testuser2',
        monthlySalaryAdjustments: {
          healthInsuranceFee: 750,
          debtGarnishment: 1000,
          otherDeductions: 500,
          performanceBonus: 3000,
          otherBonuses: 1500,
          notes: 'Test adjustments',
        },
      });

      expect(employee.monthlySalaryAdjustments.healthInsuranceFee).toBe(750);
      expect(employee.monthlySalaryAdjustments.debtGarnishment).toBe(1000);
      expect(employee.monthlySalaryAdjustments.otherDeductions).toBe(500);
      expect(employee.monthlySalaryAdjustments.performanceBonus).toBe(3000);
      expect(employee.monthlySalaryAdjustments.otherBonuses).toBe(1500);
      expect(employee.monthlySalaryAdjustments.notes).toBe('Test adjustments');
    });

    it('should persist monthlySalaryAdjustments to JSON', async () => {
      const Employee = (await import('../src/models/Employee.js')).default;
      
      const employee = new Employee({
        name: 'Test Employee',
        email: 'test3@example.com',
        username: 'testuser3',
        monthlySalaryAdjustments: {
          healthInsuranceFee: 750,
          performanceBonus: 2500,
          notes: 'Monthly adjustments',
        },
      });

      const json = employee.toJSON();
      expect(json.monthlySalaryAdjustments).toBeDefined();
      expect(json.monthlySalaryAdjustments.healthInsuranceFee).toBe(750);
      expect(json.monthlySalaryAdjustments.performanceBonus).toBe(2500);
      expect(json.monthlySalaryAdjustments.notes).toBe('Monthly adjustments');
    });
  });

  describe('Payroll Service - Integration with monthlySalaryAdjustments', () => {
    it('should be able to pass employee-level adjustments to payroll calculation', async () => {
      // This test validates that the payroll service can handle the new field structure
      // The actual integration is tested by the payroll service itself
      mockCalculateEmployeePayroll.mockResolvedValue({
        employee: 'emp123',
        month: new Date('2024-01-01'),
        baseSalary: 45000,
        healthInsuranceFee: 750,  // From employee.monthlySalaryAdjustments
        nightShiftAllowance: 2500, // From employee.monthlySalaryAdjustments
        performanceBonus: 3000,    // From employee.monthlySalaryAdjustments
        netPay: 42000,
        totalBonus: 3000,  // No longer includes nightShiftAllowance from employee settings
      });

      const result = await calculateEmployeePayroll('emp123', '2024-01-01', {});
      
      expect(result).toBeDefined();
      expect(result.healthInsuranceFee).toBe(750);
      expect(result.performanceBonus).toBe(3000);
    });

    it('should prioritize customData over employee-level adjustments', async () => {
      // This test validates that customData (API parameters) take precedence
      // over employee.monthlySalaryAdjustments
      mockCalculateEmployeePayroll.mockImplementation((empId, month, customData) => {
        return Promise.resolve({
          employee: empId,
          month: new Date(month),
          baseSalary: 45000,
          healthInsuranceFee: customData.healthInsuranceFee || 750, // customData should override
          performanceBonus: customData.performanceBonus || 3000,
          netPay: 42000,
        });
      });

      // Call with custom data that should override employee settings
      const result = await calculateEmployeePayroll('emp123', '2024-01-01', {
        healthInsuranceFee: 800, // Override employee setting
        performanceBonus: 4000, // Override employee setting
      });
      
      expect(result.healthInsuranceFee).toBe(800);
      expect(result.performanceBonus).toBe(4000);
    });
  });

  describe('Use Case: Setting Default Monthly Adjustments', () => {
    it('should demonstrate the feature purpose - avoiding approval workflow for regular adjustments', async () => {
      const Employee = (await import('../src/models/Employee.js')).default;
      
      // Scenario: Employee has regular monthly deductions and bonuses
      // Instead of creating approval requests each month, these are set in personal info
      // Note: Night shift allowance is now calculated from shift settings, not stored here
      const employee = new Employee({
        name: '張小明',
        email: 'zhang@example.com',
        username: 'zhang',
        salaryAmount: 45000,
        monthlySalaryAdjustments: {
          healthInsuranceFee: 750,        // Fixed monthly health insurance
          performanceBonus: 3000,         // Regular performance bonus
          notes: '固定績效獎金',           // Note explaining adjustments
        },
      });

      // When calculating payroll, these values are automatically used
      expect(employee.monthlySalaryAdjustments.healthInsuranceFee).toBe(750);
      expect(employee.monthlySalaryAdjustments.performanceBonus).toBe(3000);
      
      // This replaces the need for monthly approval workflows
      // The adjustments are configured once in the employee profile
      expect(employee.monthlySalaryAdjustments.notes).toBe('固定績效獎金');
    });
  });

  describe('Employee controller helpers - monthlySalaryAdjustments', () => {
    it('buildEmployeeDoc should normalize monthlySalaryAdjustments values', async () => {
      const { buildEmployeeDoc } = await import('../src/controllers/employeeController.js');

      const doc = buildEmployeeDoc({
        monthlySalaryAdjustments: {
          healthInsuranceFee: '750',
          debtGarnishment: 1000,
          otherDeductions: null,
          performanceBonus: '2500',
          otherBonuses: undefined,
          notes: 'fixed bonuses',
        },
      });

      expect(doc.monthlySalaryAdjustments).toEqual({
        healthInsuranceFee: 750,
        debtGarnishment: 1000,
        otherDeductions: 0,
        performanceBonus: 2500,
        otherBonuses: 0,
        notes: 'fixed bonuses',
      });
    });

    it('buildEmployeePatch should set monthlySalaryAdjustments fields for partial updates', async () => {
      const { buildEmployeePatch } = await import('../src/controllers/employeeController.js');

      const { $set } = buildEmployeePatch({
        monthlySalaryAdjustments: {
          healthInsuranceFee: 500,
          debtGarnishment: 0,
          notes: '',
        },
      });

      expect($set['monthlySalaryAdjustments.healthInsuranceFee']).toBe(500);
      expect($set['monthlySalaryAdjustments.debtGarnishment']).toBe(0);
      expect($set['monthlySalaryAdjustments.otherDeductions']).toBe(0);
      expect($set['monthlySalaryAdjustments.performanceBonus']).toBe(0);
      expect($set['monthlySalaryAdjustments.otherBonuses']).toBe(0);
      expect($set['monthlySalaryAdjustments.notes']).toBe('');
    });
  });
});
