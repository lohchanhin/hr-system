import {
  computeLeaveDuration,
  describeLeaveInterval,
  leaveIntervalsOverlap,
  parseLeaveInterval,
  splitLeaveByDay,
  sumLeaveHoursInRange,
  taipeiMidnightMs,
} from '../src/utils/leaveDuration.js';

// 前端日期選擇器送出 UTC ISO 字串，台灣時間 = UTC + 8
describe('parseLeaveInterval', () => {
  it('reads date-only strings as whole Taipei days, ends included', () => {
    const interval = parseLeaveInterval('2026-09-02', '2026-09-05');

    expect(interval).toMatchObject({ allDay: true, reversed: false, startKey: '2026-09-02', endKey: '2026-09-05' });
    expect(interval.endMs - interval.startMs).toBe(4 * 24 * 60 * 60 * 1000);
    expect(interval.startMs).toBe(taipeiMidnightMs('2026-09-02'));
  });

  it('reads the UTC instants of Taipei midnight (date pickers) as whole days', () => {
    expect(parseLeaveInterval('2026-10-08T16:00:00.000Z', '2026-10-09T16:00:00.000Z')).toMatchObject({
      allDay: true, startKey: '2026-10-09', endKey: '2026-10-10',
    });
  });

  it('keeps hours and minutes for a datetime range', () => {
    const interval = parseLeaveInterval('2026-06-18T16:00:00.000Z', '2026-06-19T10:00:00.000Z');

    // 台灣 6/19 00:00 到 18:00
    expect(interval).toMatchObject({ allDay: false, reversed: false, startKey: '2026-06-19', endKey: '2026-06-19', lastKey: '2026-06-19' });
    expect(interval.endMs - interval.startMs).toBe(18 * 60 * 60 * 1000);
  });

  it('treats a date-typed field as whole days even when the value carries a time', () => {
    expect(parseLeaveInterval('2026-06-18T16:00:00.000Z', '2026-06-19T01:00:00.000Z', { startType: 'date', endType: 'date' }))
      .toMatchObject({ allDay: true, startKey: '2026-06-19', endKey: '2026-06-19' });
  });

  it('flags a reversed range', () => {
    expect(parseLeaveInterval('2026-09-05', '2026-09-02').reversed).toBe(true);
    expect(parseLeaveInterval('2026-09-02T09:00:00.000Z', '2026-09-02T01:00:00.000Z').reversed).toBe(true);
  });

  it('flags a datetime range whose end equals its start, but not a whole-day range of one day', () => {
    expect(parseLeaveInterval('2026-09-02T01:00:00.000Z', '2026-09-02T01:00:00.000Z').reversed).toBe(true);
    expect(parseLeaveInterval('2026-09-02', '2026-09-02').reversed).toBe(false);
  });

  it('returns null when a value cannot be read', () => {
    expect(parseLeaveInterval('', '2026-09-02')).toBeNull();
    expect(parseLeaveInterval('亂填', '2026-09-02')).toBeNull();
    expect(parseLeaveInterval(undefined, undefined)).toBeNull();
  });

  it('ends a datetime range at midnight on the previous day', () => {
    // 台灣 9/2 13:00 到 9/3 00:00
    expect(parseLeaveInterval('2026-09-02T05:00:00.000Z', '2026-09-02T16:00:00.000Z').lastKey).toBe('2026-09-02');
  });
});

describe('leaveIntervalsOverlap', () => {
  const at = (start, end) => parseLeaveInterval(start, end);

  it('detects overlap and touching ends', () => {
    // 9:00-13:00 與 12:00-15:00 重疊
    expect(leaveIntervalsOverlap(at('2026-10-05T01:00:00.000Z', '2026-10-05T05:00:00.000Z'), at('2026-10-05T04:00:00.000Z', '2026-10-05T07:00:00.000Z'))).toBe(true);
    // 9:00-13:00 與 13:00-17:00 只是相接
    expect(leaveIntervalsOverlap(at('2026-10-05T01:00:00.000Z', '2026-10-05T05:00:00.000Z'), at('2026-10-05T05:00:00.000Z', '2026-10-05T09:00:00.000Z'))).toBe(false);
  });

  it('lets a whole-day leave cover a partial one on the same day', () => {
    expect(leaveIntervalsOverlap(at('2026-10-05', '2026-10-06'), at('2026-10-06T01:00:00.000Z', '2026-10-06T02:00:00.000Z'))).toBe(true);
    expect(leaveIntervalsOverlap(at('2026-10-05', '2026-10-06'), at('2026-10-07T01:00:00.000Z', '2026-10-07T02:00:00.000Z'))).toBe(false);
  });

  it('never reports overlap for unreadable or reversed ranges', () => {
    expect(leaveIntervalsOverlap(null, at('2026-10-05', '2026-10-06'))).toBe(false);
    expect(leaveIntervalsOverlap(at('2026-10-06', '2026-10-05'), at('2026-10-05', '2026-10-06'))).toBe(false);
  });
});

describe('describeLeaveInterval', () => {
  it('prints Taipei time', () => {
    expect(describeLeaveInterval(parseLeaveInterval('2026-10-05T01:00:00.000Z', '2026-10-05T05:00:00.000Z')))
      .toBe('2026-10-05 09:00 ~ 2026-10-05 13:00');
    expect(describeLeaveInterval(parseLeaveInterval('2026-10-05', '2026-10-05'))).toBe('2026-10-05');
    expect(describeLeaveInterval(parseLeaveInterval('2026-10-05', '2026-10-07'))).toBe('2026-10-05 ~ 2026-10-07');
    expect(describeLeaveInterval(null)).toBe('');
  });
});

describe('splitLeaveByDay', () => {
  const split = (start, end, options) => splitLeaveByDay(parseLeaveInterval(start, end), options);

  it('gives 4 hours to a 09:00-13:00 leave, not a whole day', () => {
    expect(split('2026-09-10T01:00:00.000Z', '2026-09-10T05:00:00.000Z')).toEqual([{ dateKey: '2026-09-10', hours: 4 }]);
  });

  it('caps a day at the standard hours (09:00-18:00 including lunch is one 8 hour day)', () => {
    expect(split('2026-09-10T01:00:00.000Z', '2026-09-10T10:00:00.000Z')).toEqual([{ dateKey: '2026-09-10', hours: 8 }]);
  });

  it('counts every calendar day of a whole-day range, ends included', () => {
    expect(split('2026-09-02', '2026-09-04')).toEqual([
      { dateKey: '2026-09-02', hours: 8 },
      { dateKey: '2026-09-03', hours: 8 },
      { dateKey: '2026-09-04', hours: 8 },
    ]);
  });

  it('splits a leave that runs over midnight by the covered hours of each day', () => {
    // 台灣 9/2 22:00 到 9/3 06:00
    expect(split('2026-09-02T14:00:00.000Z', '2026-09-02T22:00:00.000Z')).toEqual([
      { dateKey: '2026-09-02', hours: 2 },
      { dateKey: '2026-09-03', hours: 6 },
    ]);
  });

  it('splits a range across a month boundary', () => {
    const days = split('2026-10-30', '2026-11-03');

    expect(days.map((item) => item.dateKey)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('honours the hours-per-day option', () => {
    expect(split('2026-09-02', '2026-09-02', { hoursPerDay: 7.5 })).toEqual([{ dateKey: '2026-09-02', hours: 7.5 }]);
  });

  it('returns nothing for a reversed or unreadable range', () => {
    expect(split('2026-09-05', '2026-09-02')).toEqual([]);
    expect(splitLeaveByDay(null)).toEqual([]);
  });
});

describe('computeLeaveDuration', () => {
  it('derives hours from the dates when nothing else is filled', () => {
    const result = computeLeaveDuration({ startValue: '2026-09-02', endValue: '2026-09-03' });

    expect(result).toMatchObject({ source: 'dates', days: 2, hours: 16, startKey: '2026-09-02', endKey: '2026-09-03' });
    expect(result.perDay).toEqual([{ dateKey: '2026-09-02', hours: 8 }, { dateKey: '2026-09-03', hours: 8 }]);
  });

  it('counts a 3 day leave as 3 days (the old date difference gave 2) and a 4 hour leave as 4 hours', () => {
    expect(computeLeaveDuration({ startValue: '2026-09-01', endValue: '2026-09-03' })).toMatchObject({ days: 3, hours: 24 });
    expect(computeLeaveDuration({
      startValue: '2026-09-10T01:00:00.000Z', endValue: '2026-09-10T05:00:00.000Z',
    })).toMatchObject({ days: 0.5, hours: 4 });
  });

  it('lets the 天數 field decide the total and spreads it over the days', () => {
    const result = computeLeaveDuration({ startValue: '2026-09-10', endValue: '2026-09-10', filledDays: 0.5 });

    expect(result).toMatchObject({ source: 'days-field', days: 0.5, hours: 4 });
    expect(result.perDay).toEqual([{ dateKey: '2026-09-10', hours: 4 }]);
  });

  it('scales the daily split to the filled days', () => {
    const result = computeLeaveDuration({ startValue: '2026-09-10', endValue: '2026-09-11', filledDays: '1.5' });

    expect(result.hours).toBe(12);
    expect(result.perDay.map((item) => item.hours)).toEqual([6, 6]);
  });

  it('ignores a 天數 that is empty, zero or not a number', () => {
    for (const filledDays of ['', 0, 'abc', null, undefined, -1]) {
      expect(computeLeaveDuration({ startValue: '2026-09-02', endValue: '2026-09-03', filledDays }))
        .toMatchObject({ source: 'dates', days: 2 });
    }
  });

  it('prefers the legacy days / hours keys over the dates and keeps their values as they are', () => {
    expect(computeLeaveDuration({ literalDays: 2 })).toMatchObject({ source: 'legacy', days: 2, hours: 16, perDay: [] });
    expect(computeLeaveDuration({ literalHours: 3 })).toMatchObject({ source: 'legacy', days: 0, hours: 3, perDay: [] });
    expect(computeLeaveDuration({ literalDays: '2', startValue: '2026-09-02', endValue: '2026-09-02' }))
      .toMatchObject({ source: 'legacy', hours: 16 });
  });

  it('returns an empty duration when nothing can be read', () => {
    expect(computeLeaveDuration({})).toMatchObject({ source: 'none', days: 0, hours: 0, perDay: [], startKey: '' });
    expect(computeLeaveDuration({ startValue: '2026-09-05', endValue: '2026-09-02' })).toMatchObject({ source: 'none', hours: 0 });
  });

  it('gives the in-month hours of a leave that crosses a month end', () => {
    const result = computeLeaveDuration({ startValue: '2026-10-30', endValue: '2026-11-03' });

    expect(result.hours).toBe(40);
    expect(sumLeaveHoursInRange(result.perDay, '2026-10-01', '2026-11-01')).toBe(16);
    expect(sumLeaveHoursInRange(result.perDay, '2026-11-01', '2026-12-01')).toBe(24);
  });

  it('puts an October 16-17 leave filed in September into October only', () => {
    const result = computeLeaveDuration({ startValue: '2026-10-16', endValue: '2026-10-17' });

    expect(sumLeaveHoursInRange(result.perDay, '2026-09-01', '2026-10-01')).toBe(0);
    expect(sumLeaveHoursInRange(result.perDay, '2026-10-01', '2026-11-01')).toBe(16);
  });
});
