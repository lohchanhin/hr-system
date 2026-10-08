import {
  toTaipeiDateKey,
  toTaipeiParts,
  dateKeyToUtcMidnight,
  inclusiveTaipeiDayCount,
  listTaipeiDateKeys,
} from '../src/utils/taipeiTime.js';

describe('taipeiTime', () => {
  describe('toTaipeiDateKey', () => {
    it('converts the UTC instant of a Taipei midnight back to the Taipei day', () => {
      // 台灣 6/19 00:00 = UTC 6/18 16:00；舊程式取 UTC 日期會少一天
      expect(toTaipeiDateKey('2026-06-18T16:00:00.000Z')).toBe('2026-06-19');
      expect(toTaipeiDateKey(new Date('2026-06-18T16:00:00.000Z'))).toBe('2026-06-19');
    });

    it('keeps the day for instants after 08:00 Taipei time', () => {
      expect(toTaipeiDateKey('2026-06-19T01:00:00.000Z')).toBe('2026-06-19');
      expect(toTaipeiDateKey('2026-06-19T15:59:59.000Z')).toBe('2026-06-19');
    });

    it('does not shift date-only strings', () => {
      expect(toTaipeiDateKey('2026-06-19')).toBe('2026-06-19');
      expect(toTaipeiDateKey('2026/6/9')).toBe('2026-06-09');
    });

    it('rejects impossible or empty values', () => {
      expect(toTaipeiDateKey('2026-02-30')).toBeNull();
      expect(toTaipeiDateKey('')).toBeNull();
      expect(toTaipeiDateKey(null)).toBeNull();
      expect(toTaipeiDateKey('not a date')).toBeNull();
    });
  });

  describe('toTaipeiParts', () => {
    it('returns the Taipei clock time of an instant', () => {
      expect(toTaipeiParts('2026-06-18T23:30:00.000Z')).toEqual({ dateKey: '2026-06-19', hour: 7, minute: 30 });
    });

    it('treats a date-only string as 00:00', () => {
      expect(toTaipeiParts('2026-06-19')).toEqual({ dateKey: '2026-06-19', hour: 0, minute: 0 });
    });

    it('returns null for invalid input', () => {
      expect(toTaipeiParts('x')).toBeNull();
    });
  });

  describe('day counting', () => {
    it('counts a same-day request as one day', () => {
      expect(inclusiveTaipeiDayCount('2026-06-18T16:00:00.000Z', '2026-06-19T08:00:00.000Z')).toBe(1);
    });

    it('counts calendar days inclusively across a month boundary', () => {
      expect(inclusiveTaipeiDayCount('2026-06-29', '2026-07-02')).toBe(4);
    });

    it('returns null when the end is before the start', () => {
      expect(inclusiveTaipeiDayCount('2026-06-20', '2026-06-19')).toBeNull();
    });

    it('lists every day of the range and caps absurd ranges', () => {
      expect(listTaipeiDateKeys('2026-06-18T16:00:00.000Z', '2026-06-20')).toEqual(['2026-06-19', '2026-06-20']);
      expect(listTaipeiDateKeys('2020-01-01', '2030-01-01', { maxDays: 5 })).toHaveLength(5);
      expect(listTaipeiDateKeys('x', '2026-06-20')).toEqual([]);
    });
  });

  it('converts a day key to the UTC-midnight representation used by schedules', () => {
    expect(dateKeyToUtcMidnight('2026-06-19').toISOString()).toBe('2026-06-19T00:00:00.000Z');
    expect(dateKeyToUtcMidnight(null)).toBeNull();
  });
});
