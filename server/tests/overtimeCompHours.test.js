// 「積假（天）」改成「加班補休時數（小時）」並加上「加班補休已使用時數」（2026/11）：
// 還沒填過加班補休時數的舊資料用積假天數乘 8；有填就以加班補休時數為準，剩餘 = 總時數 - 已使用（不小於 0）
import { presentAnnualLeave, readOvertimeCompHours } from '../src/utils/annualLeaveHours.js';

describe('readOvertimeCompHours', () => {
  it('uses the legacy 積假 days x8 when no overtime comp hours were entered', () => {
    expect(readOvertimeCompHours({ accumulatedLeave: 2.5 })).toEqual({ totalHours: 20, usedHours: 0, remainingHours: 20 });
    expect(readOvertimeCompHours({})).toEqual({ totalHours: 0, usedHours: 0, remainingHours: 0 });
    expect(readOvertimeCompHours(undefined)).toEqual({ totalHours: 0, usedHours: 0, remainingHours: 0 });
  });

  it('prefers the entered hours (even 0) over the legacy days and subtracts the used hours', () => {
    expect(readOvertimeCompHours({ accumulatedLeave: 3, overtimeCompHours: 12.5, overtimeCompUsedHours: 4 }))
      .toEqual({ totalHours: 12.5, usedHours: 4, remainingHours: 8.5 });
    expect(readOvertimeCompHours({ accumulatedLeave: 3, overtimeCompHours: 0 }).totalHours).toBe(0);
  });

  it('never reports a negative remainder or negative inputs', () => {
    expect(readOvertimeCompHours({ overtimeCompHours: 4, overtimeCompUsedHours: 10 }).remainingHours).toBe(0);
    expect(readOvertimeCompHours({ overtimeCompHours: -5, overtimeCompUsedHours: -1 })).toEqual({ totalHours: 0, usedHours: 0, remainingHours: 0 });
  });
});

describe('presentAnnualLeave', () => {
  it('adds the resolved overtime comp hours for the employee form', () => {
    const presented = presentAnnualLeave({ totalHours: 80, usedHours: 8, accumulatedLeave: 1, overtimeCompUsedHours: 2 });
    expect(presented).toMatchObject({ overtimeCompHours: 8, overtimeCompUsedHours: 2, overtimeCompRemainingHours: 6, accumulatedLeave: 1 });
  });
});
