// Test for annual leave field handling in employee update
import { buildEmployeePatch, buildEmployeeDoc } from '../src/controllers/employeeController.js';

describe('Annual Leave Field Handling', () => {
  describe('buildEmployeePatch', () => {
    it('should handle annualLeave fields in patch operation', () => {
      const body = {
        annualLeave: {
          totalDays: 10,
          usedDays: 3,
          year: 2026,
          expiryDate: '2026-12-31',
          accumulatedLeave: 2,
          notes: 'Test notes'
        }
      };

      const result = buildEmployeePatch(body, {});
      
      expect(result.$set['annualLeave.totalDays']).toBe(10);
      expect(result.$set['annualLeave.usedDays']).toBe(3);
      expect(result.$set['annualLeave.year']).toBe(2026);
      expect(result.$set['annualLeave.expiryDate']).toBeInstanceOf(Date);
      expect(result.$set['annualLeave.accumulatedLeave']).toBe(2);
      expect(result.$set['annualLeave.notes']).toBe('Test notes');
    });

    it('should handle partial annualLeave updates', () => {
      const body = {
        annualLeave: {
          totalDays: 15,
          // other fields not provided
        }
      };

      const result = buildEmployeePatch(body, {});
      
      expect(result.$set['annualLeave.totalDays']).toBe(15);
      expect(result.$set['annualLeave.usedDays']).toBeUndefined();
      expect(result.$set['annualLeave.year']).toBeUndefined();
    });

    it('should not add annualLeave fields when not provided', () => {
      const body = {
        name: 'Test Employee'
      };

      const result = buildEmployeePatch(body, {});

      expect(result.$set['annualLeave.totalDays']).toBeUndefined();
      expect(result.$set['annualLeave.usedDays']).toBeUndefined();
    });

    it('should handle compensatoryHours alongside the other annualLeave fields', () => {
      const body = {
        annualLeave: {
          compensatoryHours: 12.5
        }
      };

      const result = buildEmployeePatch(body, {});

      expect(result.$set['annualLeave.compensatoryHours']).toBe(12.5);
    });

    it('should handle the labor/health insurance override fields', () => {
      const body = {
        laborInsuredSalary: 45800,
        pensionInsuredSalary: 45800,
        healthInsuredSalary: 45800,
        dependentCount: 2
      };

      const result = buildEmployeePatch(body, {});

      expect(result.$set.laborInsuredSalary).toBe(45800);
      expect(result.$set.pensionInsuredSalary).toBe(45800);
      expect(result.$set.healthInsuredSalary).toBe(45800);
      expect(result.$set.dependentCount).toBe(2);
    });

    it('should not add the insurance override fields when not provided', () => {
      const result = buildEmployeePatch({ name: 'Test Employee' }, {});

      expect(result.$set.laborInsuredSalary).toBeUndefined();
      expect(result.$set.pensionInsuredSalary).toBeUndefined();
      expect(result.$set.healthInsuredSalary).toBeUndefined();
      expect(result.$set.dependentCount).toBeUndefined();
    });
  });

  describe('buildEmployeeDoc', () => {
    it('should include annualLeave in new employee document', () => {
      const body = {
        name: 'Test Employee',
        employeeNo: 'EMP001',
        annualLeave: {
          totalDays: 10,
          usedDays: 3,
          year: 2026,
          expiryDate: '2026-12-31',
          accumulatedLeave: 2,
          notes: 'Test notes'
        }
      };

      const result = buildEmployeeDoc(body);
      
      expect(result.annualLeave).toBeDefined();
      expect(result.annualLeave.totalDays).toBe(10);
      expect(result.annualLeave.usedDays).toBe(3);
      expect(result.annualLeave.year).toBe(2026);
      expect(result.annualLeave.expiryDate).toBeInstanceOf(Date);
      expect(result.annualLeave.accumulatedLeave).toBe(2);
      expect(result.annualLeave.notes).toBe('Test notes');
    });

    it('should use default values when annualLeave not provided', () => {
      const body = {
        name: 'Test Employee',
        employeeNo: 'EMP001'
      };

      const result = buildEmployeeDoc(body);
      
      expect(result.annualLeave).toBeDefined();
      expect(result.annualLeave.totalDays).toBe(0);
      expect(result.annualLeave.usedDays).toBe(0);
      expect(result.annualLeave.year).toBe(new Date().getFullYear());
      expect(result.annualLeave.accumulatedLeave).toBe(0);
      expect(result.annualLeave.notes).toBe('');
    });

    it('should include compensatoryHours and default the insurance override fields to 0', () => {
      const body = {
        name: 'Test Employee',
        employeeNo: 'EMP001',
        annualLeave: { compensatoryHours: 8 }
      };

      const result = buildEmployeeDoc(body);

      expect(result.annualLeave.compensatoryHours).toBe(8);
      expect(result.laborInsuredSalary).toBe(0);
      expect(result.pensionInsuredSalary).toBe(0);
      expect(result.healthInsuredSalary).toBe(0);
      expect(result.dependentCount).toBe(0);
    });

    it('should include the labor/health insurance override fields when provided', () => {
      const body = {
        name: 'Test Employee',
        employeeNo: 'EMP001',
        laborInsuredSalary: 45800,
        pensionInsuredSalary: 45800,
        healthInsuredSalary: 45800,
        dependentCount: 3
      };

      const result = buildEmployeeDoc(body);

      expect(result.laborInsuredSalary).toBe(45800);
      expect(result.pensionInsuredSalary).toBe(45800);
      expect(result.healthInsuredSalary).toBe(45800);
      expect(result.dependentCount).toBe(3);
    });
  });
});
