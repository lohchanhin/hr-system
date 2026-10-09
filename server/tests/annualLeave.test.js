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

    it('should not write usedDays when the form sends the value that is already stored (a stale form must not undo a deduction)', () => {
      const existing = { annualLeave: { totalDays: 10, usedDays: 3 } };

      const result = buildEmployeePatch({ annualLeave: { totalDays: 12, usedDays: 3, notes: 'n' } }, existing);

      expect(result.$set['annualLeave.totalDays']).toBe(12);
      expect(result.$set['annualLeave.notes']).toBe('n');
      expect(result.$set).not.toHaveProperty(['annualLeave.usedDays']);
      // 表單欄位送來的是文字也一樣比較數值；0 對 0 也是沒有變更
      expect(buildEmployeePatch({ annualLeave: { usedDays: '3' } }, existing).$set).not.toHaveProperty(['annualLeave.usedDays']);
      expect(buildEmployeePatch({ annualLeave: { usedDays: 0 } }, { annualLeave: { usedDays: 0 } }).$set)
        .not.toHaveProperty(['annualLeave.usedDays']);
    });

    it('should write usedDays when the admin really changed it, including back to 0', () => {
      const existing = { annualLeave: { totalDays: 10, usedDays: 3 } };

      expect(buildEmployeePatch({ annualLeave: { usedDays: 5 } }, existing).$set['annualLeave.usedDays']).toBe(5);
      expect(buildEmployeePatch({ annualLeave: { usedDays: 0 } }, existing).$set['annualLeave.usedDays']).toBe(0);
      expect(buildEmployeePatch({ annualLeave: { usedDays: '' } }, existing).$set['annualLeave.usedDays']).toBe(0);
    });

    it('should keep writing usedDays when there is no stored value to compare with (bulk import, no existing)', () => {
      expect(buildEmployeePatch({ annualLeave: { usedDays: 3 } }).$set['annualLeave.usedDays']).toBe(3);
      expect(buildEmployeePatch({ annualLeave: { usedDays: 3 } }, null).$set['annualLeave.usedDays']).toBe(3);
      expect(buildEmployeePatch({ annualLeave: { usedDays: 3 } }, { annualLeave: {} }).$set['annualLeave.usedDays']).toBe(3);
    });

    it('should never write the applied approval request ids from the edit form', () => {
      const result = buildEmployeePatch(
        { annualLeave: { totalDays: 5, usedDays: 2, appliedApprovalRequestIds: ['a', 'b'] } },
        { annualLeave: { totalDays: 5, usedDays: 1 } },
      );

      expect(Object.keys(result.$set).filter((key) => key.includes('appliedApprovalRequestIds'))).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('appliedApprovalRequestIds');
    });

    it('should treat a supervisor of null or an empty string as "clear the supervisor"', () => {
      for (const supervisor of [null, '']) {
        const result = buildEmployeePatch({ supervisor }, { supervisor: 'someone' });
        expect(result.$unset).toEqual({ supervisor: 1 });
        expect(result.$set).not.toHaveProperty('supervisor');
      }
      expect(buildEmployeePatch({ supervisor: '507f1f77bcf86cd799439011' }).$set.supervisor).toBe('507f1f77bcf86cd799439011');
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

// 編輯員工視窗開著的時候，簽核核准又扣了特休：視窗存檔時不能把扣減蓋回去。
// 契約：沒帶 usedDays 不碰；和目前存的相同不寫；不同才是管理員的更正，
// 帶了 usedDaysBase（開啟視窗當下的值）而且目前存的值已不是它，只套用管理員自己改的差額（$inc）
describe('buildEmployeePatch: usedDays with a stale edit dialog (usedDaysBase)', () => {
  const stored = (usedDays) => ({ annualLeave: { totalDays: 10, usedDays } });
  const usedDaysOf = (patch) => ({
    set: patch.$set['annualLeave.usedDays'],
    inc: patch.$inc?.['annualLeave.usedDays'],
  });

  it('never writes usedDays when the body does not carry it (other annual leave fields still update)', () => {
    const patch = buildEmployeePatch({ annualLeave: { totalDays: 12, notes: '調整總天數' } }, stored(4));

    expect(patch.$set['annualLeave.totalDays']).toBe(12);
    expect(patch.$set).not.toHaveProperty(['annualLeave.usedDays']);
    expect(patch).not.toHaveProperty('$inc');
  });

  it('ignores a lone usedDaysBase and never stores it', () => {
    const patch = buildEmployeePatch({ annualLeave: { totalDays: 12, usedDaysBase: 3 } }, stored(4));

    expect(usedDaysOf(patch)).toEqual({ set: undefined, inc: undefined });
    expect(JSON.stringify(patch)).not.toContain('usedDaysBase');
  });

  it('does not write when usedDays equals the stored value, with or without a base', () => {
    for (const annualLeave of [{ usedDays: 4 }, { usedDays: 4, usedDaysBase: 4 }, { usedDays: 4, usedDaysBase: 0 }]) {
      const patch = buildEmployeePatch({ annualLeave }, stored(4));
      expect(usedDaysOf(patch)).toEqual({ set: undefined, inc: undefined });
      expect(patch).not.toHaveProperty('$inc');
    }
  });

  it('sets the admin value when it differs from the stored one and there is no base (admin correction, as before)', () => {
    expect(usedDaysOf(buildEmployeePatch({ annualLeave: { usedDays: 7 } }, stored(4)))).toEqual({ set: 7, inc: undefined });
    expect(usedDaysOf(buildEmployeePatch({ annualLeave: { usedDays: 0 } }, stored(4)))).toEqual({ set: 0, inc: undefined });
  });

  it('sets the admin value when the base still equals the stored value (nothing happened meanwhile)', () => {
    const patch = buildEmployeePatch({ annualLeave: { usedDays: 7, usedDaysBase: 4 } }, stored(4));

    expect(usedDaysOf(patch)).toEqual({ set: 7, inc: undefined });
    expect(patch).not.toHaveProperty('$inc');
  });

  it('applies only the admin difference with $inc when a deduction happened since the dialog was opened', () => {
    // 視窗打開時 usedDays 是 0；之後核准扣了 1 天（存的是 1）；管理員把 0 改成 2（差額 +2）
    const patch = buildEmployeePatch({ annualLeave: { usedDays: 2, usedDaysBase: 0 } }, stored(1));

    expect(patch.$set).not.toHaveProperty(['annualLeave.usedDays']);
    expect(patch.$inc).toEqual({ 'annualLeave.usedDays': 2 });
  });

  it('keeps a deduction made meanwhile when the dialog sends the untouched old value (stale form)', () => {
    const patch = buildEmployeePatch({ annualLeave: { totalDays: 12, usedDays: 0, usedDaysBase: 0 } }, stored(1));

    expect(patch.$set['annualLeave.totalDays']).toBe(12);
    expect(patch.$set).not.toHaveProperty(['annualLeave.usedDays']);
    expect(patch).not.toHaveProperty('$inc');
  });

  it('applies a negative admin difference but never takes usedDays below zero', () => {
    // 存的是 2（視窗打開時是 3，之後又返還 1 天）；管理員把 3 改成 1（差額 -2）→ 2 + (-2) = 0
    expect(buildEmployeePatch({ annualLeave: { usedDays: 1, usedDaysBase: 3 } }, stored(2)).$inc)
      .toEqual({ 'annualLeave.usedDays': -2 });
    // 差額 -3 會把 2 扣成 -1：只扣到 0
    expect(buildEmployeePatch({ annualLeave: { usedDays: 0, usedDaysBase: 3 } }, stored(2)).$inc)
      .toEqual({ 'annualLeave.usedDays': -2 });
  });

  it('handles half days and numeric text like the other number fields', () => {
    const patch = buildEmployeePatch({ annualLeave: { usedDays: '1.5', usedDaysBase: '0' } }, stored(0.5));

    expect(patch.$inc).toEqual({ 'annualLeave.usedDays': 1.5 });
  });

  it('falls back to a plain set when the base is not a number, and when there is no stored value to compare with', () => {
    expect(usedDaysOf(buildEmployeePatch({ annualLeave: { usedDays: 7, usedDaysBase: 'abc' } }, stored(4)))).toEqual({ set: 7, inc: undefined });
    expect(usedDaysOf(buildEmployeePatch({ annualLeave: { usedDays: 7, usedDaysBase: '' } }, stored(4)))).toEqual({ set: 7, inc: undefined });
    expect(usedDaysOf(buildEmployeePatch({ annualLeave: { usedDays: 7, usedDaysBase: 0 } }, null))).toEqual({ set: 7, inc: undefined });
    expect(usedDaysOf(buildEmployeePatch({ annualLeave: { usedDays: 7, usedDaysBase: 0 } }, { annualLeave: {} }))).toEqual({ set: 7, inc: undefined });
  });

  it('never writes the applied approval request ids, even together with a base', () => {
    const patch = buildEmployeePatch(
      { annualLeave: { usedDays: 3, usedDaysBase: 0, appliedApprovalRequestIds: ['a'] } },
      stored(1),
    );

    expect(JSON.stringify(patch)).not.toContain('appliedApprovalRequestIds');
  });
});
