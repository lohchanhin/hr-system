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
        label: '國定假日8小時內加發一日工資',
        amount: 1200,
      }]);
    });
  });
});
