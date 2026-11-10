import { describe, expect, it } from '@jest/globals';
import { calculateTaiwanOvertimeAmount, DEFAULT_OVERTIME_RATES } from '../src/config/salaryConfig.js';

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

  describe('boundary conditions', () => {
    it('returns zero amount and no segments for zero hours on every day type', () => {
      expect(calculateTaiwanOvertimeAmount(0, 150, 'workday')).toEqual({ amount: 0, segments: [] });
      expect(calculateTaiwanOvertimeAmount(0, 150, 'rest_day')).toEqual({ amount: 0, segments: [] });
      expect(calculateTaiwanOvertimeAmount(0, 150, 'national_holiday')).toEqual({ amount: 0, segments: [] });
    });

    it('clamps negative hours and negative hourly rate to zero instead of going negative', () => {
      const result = calculateTaiwanOvertimeAmount(-4, -150, 'workday');
      expect(result).toEqual({ amount: 0, segments: [] });
    });

    it('caps workday overtime at 4 hours, silently dropping anything beyond it', () => {
      const withinCap = calculateTaiwanOvertimeAmount(4, 150, 'workday');
      const beyondCap = calculateTaiwanOvertimeAmount(10, 150, 'workday');
      // 6 extra hours worked on top of the legal 4h weekday OT cap produce the
      // exact same pay as stopping at 4 hours -- there is no segment or warning
      // for hours 5-10, so upstream data that allows >4h weekday OT will be
      // silently underpaid relative to the actual hours worked.
      expect(beyondCap.amount).toBe(withinCap.amount);
      expect(beyondCap.segments.reduce((sum, s) => sum + s.hours, 0)).toBe(4);
    });

    it('splits exactly 2 rest-day hours into only the first-2-hours segment', () => {
      const result = calculateTaiwanOvertimeAmount(2, 150, 'rest_day');
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toMatchObject({ hours: 2, multiplier: 4 / 3 });
      expect(result.amount).toBe(Math.round(2 * 150 * (4 / 3)));
    });

    it('fills all three rest-day segments up to the 12-hour cap and drops the rest', () => {
      const atCap = calculateTaiwanOvertimeAmount(12, 150, 'rest_day');
      const beyondCap = calculateTaiwanOvertimeAmount(15, 150, 'rest_day');
      expect(atCap.segments.map((s) => s.hours)).toEqual([2, 6, 4]);
      expect(beyondCap.amount).toBe(atCap.amount);
      expect(beyondCap.segments.reduce((sum, s) => sum + s.hours, 0)).toBe(12);
    });

    it('pays only the flat 8-hour holiday segment when attendance stays within 8 hours', () => {
      const result = calculateTaiwanOvertimeAmount(8, 150, 'national_holiday');
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].hours).toBe(8);
      expect(result.amount).toBe(1200);
    });

    it('adds the two national-holiday excess tiers up to the 12-hour cap and drops the rest', () => {
      const atCap = calculateTaiwanOvertimeAmount(12, 150, 'national_holiday');
      const beyondCap = calculateTaiwanOvertimeAmount(20, 150, 'national_holiday');
      expect(atCap.segments.map((s) => s.hours)).toEqual([8, 2, 2]);
      expect(beyondCap.amount).toBe(atCap.amount);
    });

    it('still pays the full flat holiday day for a partial (sub-hour) attendance', () => {
      // Any attendance at all on a national holiday triggers the full 8-hour
      // flat segment -- 0.5 hours worked pays the same as 8 hours worked.
      const result = calculateTaiwanOvertimeAmount(0.5, 150, 'national_holiday');
      expect(result.segments).toEqual([{
        hours: 8,
        multiplier: 1,
        rateKey: 'holidayWithin8',
        label: '國定假日8小時內加發一日工資',
        amount: 1200,
      }]);
    });
  });

  describe('薪資政策的加班倍率（overtime.rates）', () => {
    it('沒有傳倍率、或傳預設值時與原本的常數完全相同', () => {
      for (const [hours, dayType] of [[4, 'workday'], [10, 'rest_day'], [12, 'national_holiday'], [3.5, 'rest_day']]) {
        const plain = calculateTaiwanOvertimeAmount(hours, 213.33, dayType);
        expect(calculateTaiwanOvertimeAmount(hours, 213.33, dayType, DEFAULT_OVERTIME_RATES)).toEqual(plain);
        expect(calculateTaiwanOvertimeAmount(hours, 213.33, dayType, {})).toEqual(plain);
      }
      expect(DEFAULT_OVERTIME_RATES).toEqual({
        weekdayFirst2: 4 / 3, weekdayAfter2: 5 / 3,
        restDayFirst2: 4 / 3, restDayHours3To8: 5 / 3, restDayHours9To12: 8 / 3,
        holidayWithin8: 1, holidayAfter8First2: 4 / 3, holidayAfter10: 5 / 3,
      });
    });

    it('每一段用自己的倍率，並標出 rateKey', () => {
      const rates = { ...DEFAULT_OVERTIME_RATES, weekdayFirst2: 1.5, weekdayAfter2: 2, holidayAfter8First2: 2.5 };
      const weekday = calculateTaiwanOvertimeAmount(4, 100, 'workday', rates);
      expect(weekday.segments.map((s) => [s.rateKey, s.multiplier])).toEqual([['weekdayFirst2', 1.5], ['weekdayAfter2', 2]]);
      expect(weekday.amount).toBe(2 * 100 * 1.5 + 2 * 100 * 2);
      // 國定假日超過 8 小時的部分不再跟著平日倍率走
      const holiday = calculateTaiwanOvertimeAmount(12, 100, 'national_holiday', rates);
      expect(holiday.segments.map((s) => [s.rateKey, s.multiplier])).toEqual([
        ['holidayWithin8', 1], ['holidayAfter8First2', 2.5], ['holidayAfter10', 5 / 3],
      ]);
      expect(holiday.amount).toBe(Math.round(800 + 500 + 200 * 5 / 3));
    });
  });
});
