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
  });
});
