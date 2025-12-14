import { aggregateBonusFromApprovals, extractNumericAmount } from './payrollPreviewUtils.js';

describe('payrollPreviewUtils', () => {
  test('extractNumericAmount prioritizes configured fields and falls back to any numeric', () => {
    expect(extractNumericAmount({ amount: '1500', note: 'ignore' })).toBe(1500);
    expect(extractNumericAmount({ 金額: 800 })).toBe(800);
    expect(extractNumericAmount({ description: 'none', extra: '3000' })).toBe(3000);
    expect(extractNumericAmount({})).toBe(0);
  });

  test('extractNumericAmount ignores Date objects to prevent astronomical values', () => {
    const testDate = new Date('2024-12-01');
    // Date objects should be ignored, not converted to milliseconds
    expect(extractNumericAmount({ startDate: testDate, endDate: new Date() })).toBe(0);
    // But if there's a proper amount field with a date, the amount should be extracted
    expect(extractNumericAmount({ amount: 5000, startDate: testDate })).toBe(5000);
    // Mixed data should return the amount, not the date
    expect(extractNumericAmount({ date: testDate, value: '8000' })).toBe(8000);
    // Null values should be handled gracefully
    expect(extractNumericAmount({ nullValue: null, amount: 2000 })).toBe(2000);
    // Objects should be skipped but primitives should work
    expect(extractNumericAmount({ config: { nested: 'value' }, price: 1500 })).toBe(1500);
  });

  test('aggregateBonusFromApprovals categorizes bonuses by form name or bonus type', () => {
    const approvals = [
      {
        form: { name: '夜班津貼申請' },
        form_data: { amount: 500 },
      },
      {
        form: { name: '績效獎金' },
        form_data: { 金額: '1200' },
      },
      {
        form: { name: '獎金申請' },
        form_data: { bonusType: '專案獎金', 金額: 3000 },
      },
      {
        form: { name: '其他' },
        form_data: { amount: 0 },
      },
    ];

    const result = aggregateBonusFromApprovals(approvals);

    expect(result).toEqual({
      nightShiftAllowance: 500,
      performanceBonus: 1200,
      otherBonuses: 3000,
    });
  });
});
