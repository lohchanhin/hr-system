import { describe, expect, it } from '@jest/globals';
import { calculateTaiwanOvertimeAmount } from '../src/config/salaryConfig.js';

describe('Taiwan overtime rate segmentation', () => {
  it('segments four weekday overtime hours at 4/3 and 5/3', () => {
    const result = calculateTaiwanOvertimeAmount(4, 150, 'workday');
    expect(result.amount).toBe(900);
    expect(result.segments.map((segment) => segment.hours)).toEqual([2, 2]);
  });

  it('segments rest-day hours after the eighth hour at 8/3', () => {
    const result = calculateTaiwanOvertimeAmount(10, 150, 'rest_day');
    expect(result.amount).toBe(2700);
    expect(result.segments.map((segment) => segment.multiplier)).toEqual([4 / 3, 5 / 3, 8 / 3]);
  });

  it('pays a full extra day for national-holiday attendance within eight hours', () => {
    const result = calculateTaiwanOvertimeAmount(2, 150, 'national_holiday');
    expect(result.amount).toBe(1200);
    expect(result.segments[0].hours).toBe(8);
  });
});
