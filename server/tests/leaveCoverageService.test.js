// 核准請假有沒有涵蓋班次：排班（匯入、單格、批次、完整性檢查）與國定假日休假紀錄共用同一個判斷。
// 這裡固定住規則：只請幾小時不擋上班班別；核准的整天請假、或有時分的請假涵蓋整個班次（休息時間可以不在請假內）才擋；
// 不用上班的班別（休/例/國/請假）一律不擋；而且排班與國定假日休假紀錄用的是同一個函式，兩邊不會對同一天給出不同答案。
import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: { find: jest.fn() } }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: { find: jest.fn() } }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: { find: jest.fn() } }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: { find: jest.fn() } }));
jest.unstable_mockModule('../src/models/HolidayRestResolution.js', () => ({ default: { find: jest.fn() } }));
jest.unstable_mockModule('../src/services/approvedLeaveCalendarService.js', () => ({
  loadApprovedLeaveIntervals: jest.fn(),
}));

const { buildLeaveDayCheck, buildRosterLeaveCheck, ROSTER_LEAVE_BLOCK } = await import('../src/services/leaveCoverageService.js');
const ledger = await import('../src/services/holidayRestLedgerService.js');

const DAY_MS = 24 * 60 * 60 * 1000;
// 台灣時間的時間點（毫秒）；請假區間的格式與 loadApprovedLeaveIntervals 相同
const taipei = (key, time = '00:00') => Date.parse(`${key}T${time}:00+08:00`);
const hoursLeave = (key, from, to, endKey = key) => ({ startMs: taipei(key, from), endMs: taipei(endKey, to), allDay: false, leaveType: '事假' });
const allDayLeave = (key, lastKey = key) => ({ startMs: taipei(key), endMs: taipei(lastKey) + DAY_MS, allDay: true, leaveType: '特休' });

const DAY_SHIFT = { code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
const AFTERNOON = { code: '午', semanticType: 'work', startTime: '13:00', endTime: '17:00' };
const NIGHT = { code: '夜', semanticType: 'work', startTime: '22:00', endTime: '06:00', crossDay: true };
const REST_DAY = { code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' };
const REGULAR = { code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' };
const HOLIDAY = { code: '國', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' };
const LEAVE_SHIFT = { code: '特', semanticType: 'leave', startTime: '00:00', endTime: '00:00' };
const DAY = '2026-06-10';

describe('buildRosterLeaveCheck', () => {
  it('blocks nothing without any approved leave', () => {
    const check = buildRosterLeaveCheck([]);
    expect(check.reason(DAY, DAY_SHIFT)).toBe('');
    expect(check.blocks(DAY, DAY_SHIFT)).toBe(false);
    expect(check.blocks(DAY)).toBe(false);
    expect(check.hasLeaveOn(DAY)).toBe(false);
    expect(buildRosterLeaveCheck(undefined).blocks(DAY, DAY_SHIFT)).toBe(false);
  });

  it('lets a working shift be rostered on a day with only a 2-hour leave, and still reports that the day has leave', () => {
    const check = buildRosterLeaveCheck([hoursLeave(DAY, '09:00', '11:00')]);
    expect(check.blocks(DAY, DAY_SHIFT)).toBe(false);
    expect(check.blocks(DAY, AFTERNOON)).toBe(false);
    expect(check.blocks(DAY, NIGHT)).toBe(false);
    expect(check.hasLeaveOn(DAY)).toBe(true);
    expect(check.hasLeaveOn('2026-06-11')).toBe(false);
  });

  it('never blocks a shift that is not worked (rest day, regular rest, national holiday, leave), whatever the leave is', () => {
    const check = buildRosterLeaveCheck([allDayLeave(DAY), hoursLeave('2026-06-11', '09:00', '11:00')]);
    [REST_DAY, REGULAR, HOLIDAY, LEAVE_SHIFT].forEach((shift) => {
      expect(check.blocks(DAY, shift)).toBe(false);
      expect(check.blocks('2026-06-11', shift)).toBe(false);
    });
    // 沒有工作時間又被標成上班的班別也不算上班
    expect(check.blocks(DAY, { code: '婚', semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe(false);
  });

  it('with strictNonWork (manual roster edits) still blocks a non-work shift on a whole-day leave, but not on a part-day leave', () => {
    const check = buildRosterLeaveCheck([
      allDayLeave(DAY),
      hoursLeave('2026-06-11', '09:00', '11:00'),
      hoursLeave('2026-06-12', '13:00', '10:00', '2026-06-14'),
    ]);
    const strict = { strictNonWork: true };
    [REST_DAY, REGULAR, HOLIDAY, LEAVE_SHIFT].forEach((shift) => {
      expect(check.reason(DAY, shift, strict)).toBe(ROSTER_LEAVE_BLOCK.ALL_DAY);
      expect(check.blocks('2026-06-11', shift, strict)).toBe(false);
      expect(check.blocks('2026-06-12', shift, strict)).toBe(false);
      // 有時分的假跨多日：中間那天整天都在請假中
      expect(check.blocks('2026-06-13', shift, strict)).toBe(true);
      expect(check.blocks('2026-06-14', shift, strict)).toBe(false);
      // 匯入（沒有 strictNonWork）一律不擋
      expect(check.blocks(DAY, shift)).toBe(false);
      expect(check.blocks('2026-06-13', shift)).toBe(false);
    });
  });

  it('blocks every working shift on an all-day leave, including each day of a multi-day leave', () => {
    const check = buildRosterLeaveCheck([allDayLeave('2026-06-10', '2026-06-12')]);
    ['2026-06-10', '2026-06-11', '2026-06-12'].forEach((key) => {
      expect(check.reason(key, DAY_SHIFT)).toBe(ROSTER_LEAVE_BLOCK.ALL_DAY);
      expect(check.blocks(key, AFTERNOON)).toBe(true);
      expect(check.blocks(key, NIGHT)).toBe(true);
    });
    expect(check.blocks('2026-06-09', DAY_SHIFT)).toBe(false);
    expect(check.blocks('2026-06-13', DAY_SHIFT)).toBe(false);
  });

  it('blocks a shift only when the timed leave covers all of it, letting the unpaid break stay uncovered', () => {
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '13:00', '17:00')]).reason(DAY, AFTERNOON)).toBe(ROSTER_LEAVE_BLOCK.COVERS_SHIFT);
    // 日班 08:00-17:00（休息 60 分鐘）
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '13:00', '17:00')]).blocks(DAY, DAY_SHIFT)).toBe(false);
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '08:00', '17:00')]).blocks(DAY, DAY_SHIFT)).toBe(true);
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '09:00', '17:00')]).blocks(DAY, DAY_SHIFT)).toBe(true);
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '08:00', '16:00')]).blocks(DAY, DAY_SHIFT)).toBe(true);
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '09:30', '17:00')]).blocks(DAY, DAY_SHIFT)).toBe(false);
    // 午班沒有休息時間，差一分鐘沒涵蓋就不擋
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '13:01', '17:00')]).blocks(DAY, AFTERNOON)).toBe(false);
  });

  it('adds up several leaves on the same day, overlapping ones only once', () => {
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '08:00', '12:00'), hoursLeave(DAY, '12:00', '17:00')]).blocks(DAY, DAY_SHIFT)).toBe(true);
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '08:00', '11:00'), hoursLeave(DAY, '10:00', '12:00')]).blocks(DAY, DAY_SHIFT)).toBe(false);
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '08:00', '12:00'), hoursLeave(DAY, '11:00', '17:00')]).blocks(DAY, DAY_SHIFT)).toBe(true);
  });

  it('judges a timed leave that runs over several days one day at a time', () => {
    const check = buildRosterLeaveCheck([hoursLeave('2026-06-10', '13:00', '10:00', '2026-06-12')]);
    expect(check.blocks('2026-06-10', DAY_SHIFT)).toBe(false);
    expect(check.blocks('2026-06-10', AFTERNOON)).toBe(true);
    expect(check.blocks('2026-06-11', DAY_SHIFT)).toBe(true);
    expect(check.blocks('2026-06-11', NIGHT)).toBe(true);
    expect(check.blocks('2026-06-12', DAY_SHIFT)).toBe(false);
  });

  it('covers a night shift that crosses midnight only when the leave runs through to its end', () => {
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '22:00', '00:00', '2026-06-11')]).blocks(DAY, NIGHT)).toBe(false);
    expect(buildRosterLeaveCheck([hoursLeave(DAY, '22:00', '06:00', '2026-06-11')]).blocks(DAY, NIGHT)).toBe(true);
  });

  it('takes the Taiwan calendar day, not the UTC day', () => {
    // 台灣 6/10 00:30-02:00 = UTC 6/9 16:30-18:00
    const check = buildRosterLeaveCheck([hoursLeave(DAY, '00:30', '02:00')]);
    expect(check.hasLeaveOn(DAY)).toBe(true);
    expect(check.hasLeaveOn('2026-06-09')).toBe(false);
    expect(check.blocks(DAY, DAY_SHIFT)).toBe(false);
  });

  it('keeps the old day-level answer when no shift is given (the shift id is not in the shift table)', () => {
    const hours = buildRosterLeaveCheck([hoursLeave(DAY, '09:00', '11:00')]);
    expect(hours.reason(DAY)).toBe(ROSTER_LEAVE_BLOCK.ANY_LEAVE);
    expect(hours.reason(DAY, null)).toBe(ROSTER_LEAVE_BLOCK.ANY_LEAVE);
    expect(hours.blocks('2026-06-11')).toBe(false);
    expect(buildRosterLeaveCheck([allDayLeave(DAY)]).reason(DAY)).toBe(ROSTER_LEAVE_BLOCK.ALL_DAY);
  });

  it('ignores unreadable or empty leave intervals', () => {
    const check = buildRosterLeaveCheck([
      { startMs: NaN, endMs: taipei(DAY, '12:00'), allDay: true },
      { startMs: taipei(DAY, '09:00'), endMs: taipei(DAY, '09:00'), allDay: false },
      null,
    ]);
    expect(check.blocks(DAY, DAY_SHIFT)).toBe(false);
    expect(check.hasLeaveOn(DAY)).toBe(false);
  });

  it('gives an invalid date key no leave', () => {
    const check = buildRosterLeaveCheck([allDayLeave(DAY)]);
    expect(check.blocks('not-a-date', DAY_SHIFT)).toBe(false);
    expect(check.hasLeaveOn('not-a-date')).toBe(false);
  });
});

describe('rostering and the holiday ledger use the same leave rule', () => {
  it('the ledger exports the very same buildLeaveDayCheck function', () => {
    expect(ledger.buildLeaveDayCheck).toBe(buildLeaveDayCheck);
  });

  it('agrees with buildLeaveDayCheck for every working shift, on every kind of leave', () => {
    const scenarios = {
      none: [],
      twoHours: [hoursLeave(DAY, '09:00', '11:00')],
      afternoon: [hoursLeave(DAY, '13:00', '17:00')],
      wholeShift: [hoursLeave(DAY, '08:00', '17:00')],
      withinBreak: [hoursLeave(DAY, '09:00', '17:00')],
      allDay: [allDayLeave(DAY)],
      multiDay: [allDayLeave('2026-06-09', '2026-06-11')],
      timedMultiDay: [hoursLeave('2026-06-09', '13:00', '10:00', '2026-06-11')],
      split: [hoursLeave(DAY, '08:00', '12:00'), hoursLeave(DAY, '12:00', '17:00')],
      mixed: [hoursLeave(DAY, '09:00', '11:00'), allDayLeave('2026-06-11')],
    };
    for (const [name, intervals] of Object.entries(scenarios)) {
      const roster = buildRosterLeaveCheck(intervals);
      for (const shift of [DAY_SHIFT, AFTERNOON, NIGHT]) {
        for (const key of ['2026-06-09', DAY, '2026-06-11', '2026-06-12']) {
          const ledgerAnswer = buildLeaveDayCheck(intervals, () => ({ kind: 'work', shift }))(key);
          expect({ name, shift: shift.code, key, blocked: roster.blocks(key, shift) })
            .toEqual({ name, shift: shift.code, key, blocked: ledgerAnswer });
        }
      }
    }
  });
});
