// Test for annual leave field handling in employee update（特休以「小時」儲存：totalHours / usedHours）
import { buildEmployeePatch, buildEmployeeDoc } from '../src/controllers/employeeController.js';

describe('Annual Leave Field Handling', () => {
  describe('buildEmployeePatch', () => {
    it('should handle annualLeave fields in patch operation', () => {
      const body = {
        annualLeave: {
          totalHours: 80,
          usedHours: 24,
          year: 2026,
          expiryDate: '2026-12-31',
          accumulatedLeave: 2,
          notes: 'Test notes'
        }
      };

      const result = buildEmployeePatch(body, {});

      expect(result.$set['annualLeave.totalHours']).toBe(80);
      expect(result.$set['annualLeave.usedHours']).toBe(24);
      expect(result.$set['annualLeave.year']).toBe(2026);
      expect(result.$set['annualLeave.expiryDate']).toBeInstanceOf(Date);
      expect(result.$set['annualLeave.accumulatedLeave']).toBe(2);
      expect(result.$set['annualLeave.notes']).toBe('Test notes');
    });

    it('should handle partial annualLeave updates', () => {
      const body = {
        annualLeave: {
          totalHours: 120,
          // other fields not provided
        }
      };

      const result = buildEmployeePatch(body, {});

      expect(result.$set['annualLeave.totalHours']).toBe(120);
      expect(result.$set['annualLeave.usedHours']).toBeUndefined();
      expect(result.$set['annualLeave.year']).toBeUndefined();
    });

    it('should not add annualLeave fields when not provided', () => {
      const body = {
        name: 'Test Employee'
      };

      const result = buildEmployeePatch(body, {});

      expect(result.$set['annualLeave.totalHours']).toBeUndefined();
      expect(result.$set['annualLeave.usedHours']).toBeUndefined();
    });

    it('should not write usedHours when the form sends the value that is already stored (a stale form must not undo a deduction)', () => {
      const existing = { annualLeave: { totalHours: 80, usedHours: 24 } };

      const result = buildEmployeePatch({ annualLeave: { totalHours: 96, usedHours: 24, notes: 'n' } }, existing);

      expect(result.$set['annualLeave.totalHours']).toBe(96);
      expect(result.$set['annualLeave.notes']).toBe('n');
      expect(result.$set).not.toHaveProperty(['annualLeave.usedHours']);
      // 表單欄位送來的是文字也一樣比較數值；0 對 0 也是沒有變更
      expect(buildEmployeePatch({ annualLeave: { usedHours: '24' } }, existing).$set).not.toHaveProperty(['annualLeave.usedHours']);
      expect(buildEmployeePatch({ annualLeave: { usedHours: 0 } }, { annualLeave: { totalHours: 8, usedHours: 0 } }).$set)
        .not.toHaveProperty(['annualLeave.usedHours']);
    });

    it('should write usedHours when the admin really changed it, including back to 0', () => {
      const existing = { annualLeave: { totalHours: 80, usedHours: 24 } };

      expect(buildEmployeePatch({ annualLeave: { usedHours: 40 } }, existing).$set['annualLeave.usedHours']).toBe(40);
      expect(buildEmployeePatch({ annualLeave: { usedHours: 0 } }, existing).$set['annualLeave.usedHours']).toBe(0);
      expect(buildEmployeePatch({ annualLeave: { usedHours: '' } }, existing).$set['annualLeave.usedHours']).toBe(0);
    });

    it('should keep writing usedHours when there is no stored value to compare with (bulk import, no existing)', () => {
      expect(buildEmployeePatch({ annualLeave: { usedHours: 24 } }).$set['annualLeave.usedHours']).toBe(24);
      expect(buildEmployeePatch({ annualLeave: { usedHours: 24 } }, null).$set['annualLeave.usedHours']).toBe(24);
      expect(buildEmployeePatch({ annualLeave: { usedHours: 24 } }, { annualLeave: {} }).$set['annualLeave.usedHours']).toBe(24);
    });

    it('should never write the applied approval request ids from the edit form', () => {
      const result = buildEmployeePatch(
        { annualLeave: { totalHours: 40, usedHours: 16, appliedApprovalRequestIds: ['a', 'b'] } },
        { annualLeave: { totalHours: 40, usedHours: 8 } },
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

    it('converts the old day fields (a cached browser bundle) x8 to hours without guessing, and never writes the day fields', () => {
      const result = buildEmployeePatch({ annualLeave: { totalDays: 10, usedDays: 3 } }, {});

      expect(result.$set['annualLeave.totalHours']).toBe(80);
      expect(result.$set['annualLeave.usedHours']).toBe(24);
      expect(JSON.stringify(result)).not.toMatch(/totalDays|usedDays/);
      // 170 天照樣乘 8：這是明確的天數參數，不套用匯入檔的推測規則
      expect(buildEmployeePatch({ annualLeave: { totalDays: 170 } }, {}).$set['annualLeave.totalHours']).toBe(1360);
    });

    it('lets the hours fields win over the old day fields when both are sent', () => {
      const result = buildEmployeePatch({ annualLeave: { totalHours: 40, totalDays: 99, usedHours: 8, usedDays: 99 } }, {});
      expect(result.$set['annualLeave.totalHours']).toBe(40);
      expect(result.$set['annualLeave.usedHours']).toBe(8);
    });

    it('converts a document that is still on the day fields as a whole, so neither half is lost', () => {
      const existing = { annualLeave: { totalDays: 14, usedDays: 2 } };

      const onlyNotes = buildEmployeePatch({ annualLeave: { notes: 'x' } }, existing);
      expect(onlyNotes.$set['annualLeave.totalHours']).toBe(112);
      expect(onlyNotes.$set['annualLeave.usedHours']).toBe(16);

      const onlyTotal = buildEmployeePatch({ annualLeave: { totalHours: 120 } }, existing);
      expect(onlyTotal.$set['annualLeave.totalHours']).toBe(120);
      expect(onlyTotal.$set['annualLeave.usedHours']).toBe(16);
    });

    it('marks the unit as confirmed when the admin confirms it or retypes a different total, and keeps the mark otherwise', () => {
      const existing = { annualLeave: { totalHours: 170, usedHours: 0, unitSource: 'migrated-hours' } };

      expect(buildEmployeePatch({ annualLeave: { unitConfirmed: true } }, existing).$set['annualLeave.unitSource']).toBe('entered');
      expect(buildEmployeePatch({ annualLeave: { totalHours: 1360 } }, existing).$set['annualLeave.unitSource']).toBe('entered');
      expect(buildEmployeePatch({ annualLeave: { totalHours: 170 } }, existing).$set).not.toHaveProperty(['annualLeave.unitSource']);
      expect(buildEmployeePatch({ annualLeave: { notes: 'x' } }, existing).$set).not.toHaveProperty(['annualLeave.unitSource']);
      // 匯入檔推測出來的來源可以帶進來
      expect(buildEmployeePatch({ annualLeave: { totalHours: 170, unitSource: 'migrated-hours' } }, null).$set['annualLeave.unitSource']).toBe('migrated-hours');
      expect(buildEmployeePatch({ annualLeave: { unitSource: 'whatever' } }, existing).$set).not.toHaveProperty(['annualLeave.unitSource']);
    });
  });

  describe('buildEmployeeDoc', () => {
    it('should include annualLeave in new employee document', () => {
      const body = {
        name: 'Test Employee',
        employeeNo: 'EMP001',
        annualLeave: {
          totalHours: 80,
          usedHours: 24,
          year: 2026,
          expiryDate: '2026-12-31',
          accumulatedLeave: 2,
          notes: 'Test notes'
        }
      };

      const result = buildEmployeeDoc(body);

      expect(result.annualLeave).toBeDefined();
      expect(result.annualLeave.totalHours).toBe(80);
      expect(result.annualLeave.usedHours).toBe(24);
      expect(result.annualLeave.unitSource).toBe('entered');
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
      expect(result.annualLeave.totalHours).toBe(0);
      expect(result.annualLeave.usedHours).toBe(0);
      expect(result.annualLeave.year).toBe(new Date().getFullYear());
      expect(result.annualLeave.accumulatedLeave).toBe(0);
      expect(result.annualLeave.notes).toBe('');
    });

    it('converts the old day fields x8 to hours', () => {
      const result = buildEmployeeDoc({ name: 'Test Employee', employeeNo: 'EMP001', annualLeave: { totalDays: 10, usedDays: 3 } });
      expect(result.annualLeave.totalHours).toBe(80);
      expect(result.annualLeave.usedHours).toBe(24);
      expect(result.annualLeave).not.toHaveProperty('totalDays');
    });

    it('takes the unit source an import worked out, and defaults to entered', () => {
      const result = buildEmployeeDoc({ name: 'A', employeeNo: 'E1', annualLeave: { totalHours: 170, unitSource: 'migrated-hours' } });
      expect(result.annualLeave.unitSource).toBe('migrated-hours');
      expect(buildEmployeeDoc({ name: 'A', employeeNo: 'E1', annualLeave: { unitSource: 'nonsense' } }).annualLeave.unitSource).toBe('entered');
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
// 契約：沒帶 usedHours 不碰；和目前存的相同不寫；不同才是管理員的更正，
// 帶了 usedHoursBase（開啟視窗當下的值）而且目前存的值已不是它，只套用管理員自己改的差額（$inc）
describe('buildEmployeePatch: usedHours with a stale edit dialog (usedHoursBase)', () => {
  const stored = (usedHours) => ({ annualLeave: { totalHours: 80, usedHours } });
  const usedHoursOf = (patch) => ({
    set: patch.$set['annualLeave.usedHours'],
    inc: patch.$inc?.['annualLeave.usedHours'],
  });

  it('never writes usedHours when the body does not carry it (other annual leave fields still update)', () => {
    const patch = buildEmployeePatch({ annualLeave: { totalHours: 96, notes: '調整總時數' } }, stored(32));

    expect(patch.$set['annualLeave.totalHours']).toBe(96);
    expect(patch.$set).not.toHaveProperty(['annualLeave.usedHours']);
    expect(patch).not.toHaveProperty('$inc');
  });

  it('ignores a lone usedHoursBase and never stores it', () => {
    const patch = buildEmployeePatch({ annualLeave: { totalHours: 96, usedHoursBase: 24 } }, stored(32));

    expect(usedHoursOf(patch)).toEqual({ set: undefined, inc: undefined });
    expect(JSON.stringify(patch)).not.toContain('usedHoursBase');
  });

  it('does not write when usedHours equals the stored value, with or without a base', () => {
    for (const annualLeave of [{ usedHours: 32 }, { usedHours: 32, usedHoursBase: 32 }, { usedHours: 32, usedHoursBase: 0 }]) {
      const patch = buildEmployeePatch({ annualLeave }, stored(32));
      expect(usedHoursOf(patch)).toEqual({ set: undefined, inc: undefined });
      expect(patch).not.toHaveProperty('$inc');
    }
  });

  it('sets the admin value when it differs from the stored one and there is no base (admin correction, as before)', () => {
    expect(usedHoursOf(buildEmployeePatch({ annualLeave: { usedHours: 56 } }, stored(32)))).toEqual({ set: 56, inc: undefined });
    expect(usedHoursOf(buildEmployeePatch({ annualLeave: { usedHours: 0 } }, stored(32)))).toEqual({ set: 0, inc: undefined });
  });

  it('sets the admin value when the base still equals the stored value (nothing happened meanwhile)', () => {
    const patch = buildEmployeePatch({ annualLeave: { usedHours: 56, usedHoursBase: 32 } }, stored(32));

    expect(usedHoursOf(patch)).toEqual({ set: 56, inc: undefined });
    expect(patch).not.toHaveProperty('$inc');
  });

  it('applies only the admin difference with $inc when a deduction happened since the dialog was opened', () => {
    // 視窗打開時 usedHours 是 0；之後核准扣了 8 小時（存的是 8）；管理員把 0 改成 16（差額 +16）
    const patch = buildEmployeePatch({ annualLeave: { usedHours: 16, usedHoursBase: 0 } }, stored(8));

    expect(patch.$set).not.toHaveProperty(['annualLeave.usedHours']);
    expect(patch.$inc).toEqual({ 'annualLeave.usedHours': 16 });
  });

  it('keeps a deduction made meanwhile when the dialog sends the untouched old value (stale form)', () => {
    const patch = buildEmployeePatch({ annualLeave: { totalHours: 96, usedHours: 0, usedHoursBase: 0 } }, stored(8));

    expect(patch.$set['annualLeave.totalHours']).toBe(96);
    expect(patch.$set).not.toHaveProperty(['annualLeave.usedHours']);
    expect(patch).not.toHaveProperty('$inc');
  });

  it('applies a negative admin difference but never takes usedHours below zero', () => {
    // 存的是 16（視窗打開時是 24，之後又返還 8 小時）；管理員把 24 改成 8（差額 -16）→ 16 + (-16) = 0
    expect(buildEmployeePatch({ annualLeave: { usedHours: 8, usedHoursBase: 24 } }, stored(16)).$inc)
      .toEqual({ 'annualLeave.usedHours': -16 });
    // 差額 -24 會把 16 扣成 -8：只扣到 0
    expect(buildEmployeePatch({ annualLeave: { usedHours: 0, usedHoursBase: 24 } }, stored(16)).$inc)
      .toEqual({ 'annualLeave.usedHours': -16 });
  });

  it('handles half hours and numeric text like the other number fields', () => {
    const patch = buildEmployeePatch({ annualLeave: { usedHours: '12.5', usedHoursBase: '0' } }, stored(4));

    expect(patch.$inc).toEqual({ 'annualLeave.usedHours': 12.5 });
  });

  it('falls back to a plain set when the base is not a number, and when there is no stored value to compare with', () => {
    expect(usedHoursOf(buildEmployeePatch({ annualLeave: { usedHours: 56, usedHoursBase: 'abc' } }, stored(32)))).toEqual({ set: 56, inc: undefined });
    expect(usedHoursOf(buildEmployeePatch({ annualLeave: { usedHours: 56, usedHoursBase: '' } }, stored(32)))).toEqual({ set: 56, inc: undefined });
    expect(usedHoursOf(buildEmployeePatch({ annualLeave: { usedHours: 56, usedHoursBase: 0 } }, null))).toEqual({ set: 56, inc: undefined });
    expect(usedHoursOf(buildEmployeePatch({ annualLeave: { usedHours: 56, usedHoursBase: 0 } }, { annualLeave: {} }))).toEqual({ set: 56, inc: undefined });
  });

  it('never writes the applied approval request ids, even together with a base', () => {
    const patch = buildEmployeePatch(
      { annualLeave: { usedHours: 24, usedHoursBase: 0, appliedApprovalRequestIds: ['a'] } },
      stored(8),
    );

    expect(JSON.stringify(patch)).not.toContain('appliedApprovalRequestIds');
  });

  it('keeps the same contract for a cached old browser bundle that still sends usedDays / usedDaysBase (x8)', () => {
    const patch = buildEmployeePatch({ annualLeave: { usedDays: 2, usedDaysBase: 0 } }, stored(8));

    expect(patch.$inc).toEqual({ 'annualLeave.usedHours': 16 });
    expect(JSON.stringify(patch)).not.toMatch(/usedDays|Base/);
  });
});
