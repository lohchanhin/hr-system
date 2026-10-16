// 跨月週「目前無法判斷」只看員工在職的日子：
// 鄰月那幾天要是在到職日之前或離職日之後，永遠不會有班表，不能一直掛著「待判斷」，也不能算成補得上的日子。
// 員工的到職日（appointment.hireDate）、離職日（離職員工的 appointment.resignationDate / dismissalDate）現場讀 Employee。
import { jest } from '@jest/globals';
import { oid } from './helpers/approvalTestKit.js';

const mockShiftSchedule = { find: jest.fn(), findOne: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockApprovalRequest = { find: jest.fn() };
const mockFormField = { find: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockEmployee = { find: jest.fn() };
const mockGetAllLeaveFieldInfos = jest.fn();

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}));

const { assertScheduleRuleCompliance } = await import('../src/services/laborRuleValidationService.js');
const { loadScheduleRuleEmploymentWindows, isEmployedOn } = await import('../src/services/scheduleRuleExemptionService.js');

const leanQuery = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const sortableLeanQuery = (value) => {
  const chain = { sort: jest.fn(() => chain), lean: jest.fn().mockResolvedValue(value) };
  return chain;
};

const WEEKLY_RULE = 'weekly-one-regular-rest-one-rest-day';
const CONTROL = oid(21); // 沒有任何到職、離職資料的一般員工（舊資料）
const NEW_HIRE = oid(22);
const LEAVER = oid(23);
const UNDATED_LEAVER = oid(24); // 離職員工，但離職日、解聘日都沒填

const SETTING = {
  shifts: [
    { _id: '日', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakDuration: 60 },
    { _id: '休', code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
    { _id: '例', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
  ],
};
const JULY_RANGE = { start: new Date('2026-07-01T00:00:00.000Z'), end: new Date('2026-08-01T00:00:00.000Z') };
const DAY_MS = 24 * 60 * 60 * 1000;

const rowsFrom = (employee, startIso, codes) => codes.map((shiftId, index) => ({
  employee,
  date: new Date(new Date(`${startIso}T00:00:00.000Z`).getTime() + index * DAY_MS),
  shiftId,
}));

// 2026-07：7/1 是週三、7/31 是週五。首週 6/29～7/5 只有 7/1～7/5 在本月，末週 7/27～8/2 只有 7/27～7/31 在本月。
// 預設首週、末週的本月部分都是日班（沒有例也沒有休），中間三週例休齊全；last 可以縮短（離職者最後一筆班表）。
function julyRows(employee, { first = ['日', '日', '日', '日', '日'], last = ['日', '日', '日', '日', '日'] } = {}) {
  return [
    ...rowsFrom(employee, '2026-07-01', first),
    ...rowsFrom(employee, '2026-07-06', ['休', '日', '日', '日', '日', '例', '日']),
    ...rowsFrom(employee, '2026-07-13', ['日', '日', '日', '日', '日', '例', '休']),
    ...rowsFrom(employee, '2026-07-20', ['日', '日', '日', '日', '日', '例', '休']),
    ...rowsFrom(employee, '2026-07-27', last),
  ];
}

async function collect(args) {
  try {
    const result = await assertScheduleRuleCompliance(args);
    return { violations: result.violations, pendingWeeks: result.pendingWeeks || [], resolved: result };
  } catch (error) {
    if (Array.isArray(error?.violations)) {
      return { violations: error.violations, pendingWeeks: error.pendingWeeks || [], error };
    }
    throw error;
  }
}
const weeklyOf = (violations) => violations.filter((item) => item.rule === WEEKLY_RULE);
const weekStarts = (items) => items.map((item) => item.weekStart);
const check = (candidateSchedules) => collect({ candidateSchedules, range: JULY_RANGE, strictWeeklyRest: true });

// 以記憶體內的員工資料模擬 Employee.find({ _id: { $in } }).select().lean()
let employeeRows;
beforeEach(() => {
  [mockShiftSchedule.find, mockShiftSchedule.findOne, mockAttendanceSetting.findOne, mockApprovalRequest.find,
    mockFormField.find, mockHoliday.find, mockHolidayMoveSetting.find, mockEmployee.find, mockGetAllLeaveFieldInfos,
  ].forEach((fn) => fn.mockReset());
  employeeRows = [{ _id: CONTROL, partTime: false }];
  mockEmployee.find.mockImplementation((filter) => {
    const ids = (filter?._id?.$in || []).map(String);
    const found = employeeRows.filter((row) => (
      ids.includes(String(row._id)) && (filter.partTime === undefined || row.partTime === filter.partTime)
    ));
    const query = { select: jest.fn(() => query), lean: jest.fn().mockResolvedValue(found) };
    return query;
  });
  mockAttendanceSetting.findOne.mockReturnValue(leanQuery(SETTING));
  mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
  mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([]));
  mockFormField.find.mockReturnValue(sortableLeanQuery([]));
  mockHoliday.find.mockReturnValue(leanQuery([]));
  mockHolidayMoveSetting.find.mockReturnValue(leanQuery([]));
  mockGetAllLeaveFieldInfos.mockResolvedValue([]);
});

describe('isEmployedOn', () => {
  const hired = { hireKey: '2026-07-01', resigned: false, resignKey: '' };
  const left = { hireKey: '', resigned: true, resignKey: '2026-07-31' };

  it('counts the hire day and the resign day as employed, the days before / after as not', () => {
    expect(isEmployedOn(hired, '2026-06-30')).toBe(false);
    expect(isEmployedOn(hired, '2026-07-01')).toBe(true);
    expect(isEmployedOn(hired, '2026-12-31')).toBe(true);
    expect(isEmployedOn(left, '2026-07-31')).toBe(true);
    expect(isEmployedOn(left, '2026-08-01')).toBe(false);
    expect(isEmployedOn(left, '2020-01-01')).toBe(true);
  });

  it('treats a person without employment data as employed on every day', () => {
    expect(isEmployedOn(undefined, '2026-06-30')).toBe(true);
    expect(isEmployedOn(null, '1999-01-01')).toBe(true);
    expect(isEmployedOn({ hireKey: '', resigned: false, resignKey: '' }, '2030-01-01')).toBe(true);
  });

  it('uses the last scheduled day for a leaver without any resign date, and nothing at all when there is none either', () => {
    const undated = { hireKey: '', resigned: true, resignKey: '' };
    expect(isEmployedOn(undated, '2026-07-31', '2026-07-31')).toBe(true);
    expect(isEmployedOn(undated, '2026-08-01', '2026-07-31')).toBe(false);
    expect(isEmployedOn(undated, '2026-07-01', '')).toBe(false);
  });

  it('applies both ends to a person who joined and left', () => {
    const both = { hireKey: '2026-07-10', resigned: true, resignKey: '2026-07-20' };
    expect(['2026-07-09', '2026-07-10', '2026-07-20', '2026-07-21'].map((key) => isEmployedOn(both, key)))
      .toEqual([false, true, true, false]);
  });
});

describe('loadScheduleRuleEmploymentWindows', () => {
  it('reads hire and resign days as Taiwan day keys, and the resign day only for a leaver', async () => {
    employeeRows = [
      // 台灣 7/1 00:00 存成 UTC 6/30 16:00
      { _id: oid(31), status: '試用期員工', appointment: { hireDate: new Date('2026-06-30T16:00:00.000Z') } },
      // 日期選擇器存成 UTC 午夜的 7/1 = 台灣 7/1 08:00，同一天
      { _id: oid(32), status: '正職員工', appointment: { hireDate: new Date('2026-07-01T00:00:00.000Z') } },
      { _id: oid(33), status: '離職員工', appointment: { hireDate: new Date('2024-01-01T00:00:00.000Z'), resignationDate: new Date('2026-07-30T16:00:00.000Z') } },
      // 沒有離職日就用解聘日
      { _id: oid(34), status: '離職員工', appointment: { dismissalDate: new Date('2026-07-15T00:00:00.000Z') } },
      // 離職員工沒有任何日期：照樣標成離職，由班表最後一天決定
      { _id: oid(35), status: '離職員工' },
      // 在職員工即使有離職日（離職後再任用）也不看離職日；沒有到職日就沒有任何限制
      { _id: oid(36), status: '正職員工', appointment: { resignationDate: new Date('2025-01-01T00:00:00.000Z') } },
      // 什麼資料都沒有：不放進 Map
      { _id: oid(37), status: '正職員工' },
      { _id: oid(38) },
    ];

    const windows = await loadScheduleRuleEmploymentWindows([31, 32, 33, 34, 35, 36, 37, 38, 39].map(oid));

    expect(Object.fromEntries(windows)).toEqual({
      [oid(31)]: { hireKey: '2026-07-01', resigned: false, resignKey: '' },
      [oid(32)]: { hireKey: '2026-07-01', resigned: false, resignKey: '' },
      [oid(33)]: { hireKey: '2024-01-01', resigned: true, resignKey: '2026-07-31' },
      [oid(34)]: { hireKey: '', resigned: true, resignKey: '2026-07-15' },
      [oid(35)]: { hireKey: '', resigned: true, resignKey: '' },
    });
    // 在職員工的離職日不看，又沒有到職日（oid(36)）和什麼資料都沒有的人（oid(37)、oid(38)）都不放進 Map，任何一天都當作在職
    expect([36, 37, 38, 39].some((n) => windows.has(oid(n)))).toBe(false);
    // 只有一個查詢，欄位只取需要的
    expect(mockEmployee.find).toHaveBeenCalledTimes(1);
    const query = mockEmployee.find.mock.results[0].value;
    expect(query.select).toHaveBeenCalledWith('status appointment.hireDate appointment.resignationDate appointment.dismissalDate');
  });

  it('does not query for ids that are not 24-character ObjectIds, nor for an empty list', async () => {
    expect(await loadScheduleRuleEmploymentWindows(['A0003', 'emp1', ''])).toEqual(new Map());
    expect(await loadScheduleRuleEmploymentWindows([])).toEqual(new Map());
    expect(await loadScheduleRuleEmploymentWindows(undefined)).toEqual(new Map());
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });

  it('lets a database failure surface instead of silently judging without the dates', async () => {
    mockEmployee.find.mockImplementation(() => { throw new Error('db down'); });
    await expect(loadScheduleRuleEmploymentWindows([CONTROL])).rejects.toThrow('db down');
  });
});

describe('weekly rest: neighbouring days before the hire day / after the resign day', () => {
  it('keeps both edge weeks pending for a person with no employment dates (the unchanged behaviour)', async () => {
    const { violations, pendingWeeks } = await check(julyRows(CONTROL));
    expect(violations).toEqual([]);
    expect(weekStarts(pendingWeeks)).toEqual(['2026-06-29', '2026-07-27']);
    expect(pendingWeeks[0].missingDates).toEqual(['2026-06-29', '2026-06-30']);
    expect(pendingWeeks[1].missingDates).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('a new hired on 7/1 has no pending June week (6/29 and 6/30 are before the hire day) but keeps the August week', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-06-30T16:00:00.000Z') } });

    const { violations, pendingWeeks, resolved } = await check(julyRows(NEW_HIRE));

    expect(resolved.ok).toBe(true);
    expect(violations).toEqual([]);
    expect(pendingWeeks).toEqual([
      expect.objectContaining({
        rule: 'weekly-rest-pending',
        employee: NEW_HIRE,
        weekStart: '2026-07-27',
        weekEnd: '2026-08-02',
        missingDates: ['2026-08-01', '2026-08-02'],
        missingMonths: ['2026-08'],
      }),
    ]);
  });

  it('a leaver whose last day is 7/31 has no pending August week (8/1 and 8/2 are after the resign day) but keeps the June week', async () => {
    employeeRows.push({
      _id: LEAVER,
      status: '離職員工',
      appointment: { hireDate: new Date('2024-03-01T00:00:00.000Z'), resignationDate: new Date('2026-07-30T16:00:00.000Z') },
    });

    const { violations, pendingWeeks } = await check(julyRows(LEAVER));

    expect(violations).toEqual([]);
    expect(weekStarts(pendingWeeks)).toEqual(['2026-06-29']);
    expect(pendingWeeks[0].missingDates).toEqual(['2026-06-29', '2026-06-30']);
  });

  it('a person who joined on 7/1 and left on 7/31 has nothing pending at all', async () => {
    employeeRows.push({
      _id: NEW_HIRE,
      status: '離職員工',
      appointment: { hireDate: new Date('2026-07-01T00:00:00.000Z'), resignationDate: new Date('2026-07-31T00:00:00.000Z') },
    });
    const { violations, pendingWeeks } = await check(julyRows(NEW_HIRE));
    expect(violations).toEqual([]);
    expect(pendingWeeks).toEqual([]);
  });

  it('judges each person by their own dates in the same run', async () => {
    employeeRows.push(
      { _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-07-01T00:00:00.000Z') } },
      { _id: LEAVER, status: '離職員工', appointment: { resignationDate: new Date('2026-07-31T00:00:00.000Z') } },
    );

    const { pendingWeeks } = await check([...julyRows(CONTROL), ...julyRows(NEW_HIRE), ...julyRows(LEAVER)]);

    expect(pendingWeeks.map((item) => `${item.employee}:${item.weekStart}`).sort()).toEqual([
      `${CONTROL}:2026-06-29`,
      `${CONTROL}:2026-07-27`,
      `${LEAVER}:2026-06-29`,
      `${NEW_HIRE}:2026-07-27`,
    ].sort());
  });

  it('a leaver without a resign date ends at the dismissal date, and without any date at the last scheduled day', async () => {
    employeeRows.push(
      { _id: LEAVER, status: '離職員工', appointment: { dismissalDate: new Date('2026-07-31T00:00:00.000Z') } },
      { _id: UNDATED_LEAVER, status: '離職員工' },
    );
    const { pendingWeeks } = await check([...julyRows(LEAVER), ...julyRows(UNDATED_LEAVER)]);
    // 兩個人 8/1、8/2 都在離職後；6/29、6/30 沒有到職日可以排除，仍是待判斷
    expect(pendingWeeks.map((item) => `${item.employee}:${item.weekStart}`).sort())
      .toEqual([`${LEAVER}:2026-06-29`, `${UNDATED_LEAVER}:2026-06-29`].sort());
  });

  it('only a leaver status applies the resign date: an active employee with an old resign date is still judged normally', async () => {
    employeeRows.push({ _id: LEAVER, status: '正職員工', appointment: { resignationDate: new Date('2026-07-31T00:00:00.000Z') } });
    const { pendingWeeks } = await check(julyRows(LEAVER));
    expect(weekStarts(pendingWeeks)).toEqual(['2026-06-29', '2026-07-27']);
  });

  it('keeps the week pending when the hire day is on or before the first missing day', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '正職員工', appointment: { hireDate: new Date('2026-06-29T00:00:00.000Z') } });
    const { pendingWeeks } = await check(julyRows(NEW_HIRE));
    expect(pendingWeeks[0]).toEqual(expect.objectContaining({ weekStart: '2026-06-29', missingDates: ['2026-06-29', '2026-06-30'] }));
  });

  it('counts only the employed missing days: hired on 6/30 leaves 6/30 as the one day that can still be filled', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-06-30T00:00:00.000Z') } });
    // 7/1 例：首週已有 1 例，缺休息日；6/30 還補得上，6/29 在到職前不算
    const first = ['例', '日', '日', '日', '日'];

    const { violations, pendingWeeks } = await check(julyRows(NEW_HIRE, { first }));

    expect(violations).toEqual([]);
    expect(pendingWeeks[0]).toEqual(expect.objectContaining({
      weekStart: '2026-06-29',
      regularRestCount: 1,
      restDayCount: 0,
      missingDates: ['2026-06-30'],
      missingMonths: ['2026-06'],
    }));
    expect(pendingWeeks[0].message).toBe(
      '跨月週（2026-06-29～2026-07-05）：2026-06-30 尚未排班，暫時無法判斷每週一例一休（目前缺休息日）；2026年6月 班表排定後會重新檢核',
    );
  });

  it('does not count the days before the hire day as fillable: one fillable day cannot hold both a 例 and a 休', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-06-30T00:00:00.000Z') } });

    const { violations, pendingWeeks } = await check(julyRows(NEW_HIRE));

    // 6/29 不算補得上的日子：只剩 6/30 一天，補不齊 1 例 1 休（沒有排除時 6/29、6/30 兩天會被當成補得上而只提醒）
    expect(weeklyOf(violations)).toEqual([
      expect.objectContaining({
        employee: NEW_HIRE,
        weekStart: '2026-06-29',
        regularRestCount: 0,
        restDayCount: 0,
        crossMonth: true,
        outsideDates: ['2026-06-29', '2026-06-30'],
        missingDates: ['2026-06-30'],
        notEmployedDates: ['2026-06-29'],
      }),
    ]);
    expect(weeklyOf(violations)[0].message).toBe(
      '每週一至週日需至少1例1休：2026-06-29 週缺少例假與休息日（此週跨月：2026-06-30 屬相鄰月份且尚未排班，最多只能再補 1 天，仍補不齊缺少的例假與休息日；2026-06-29 在到職前或離職後，不計入）',
    );
    // 末週 8/1、8/2 仍在職、仍待判斷
    expect(weekStarts(pendingWeeks)).toEqual(['2026-07-27']);
  });

  it('counts the resign day itself as employed: a leaver whose last day is 8/1 can still fill 8/1', async () => {
    employeeRows.push({ _id: LEAVER, status: '離職員工', appointment: { resignationDate: new Date('2026-08-01T00:00:00.000Z') } });
    // 7/31 休：末週已有 1 休、缺例假；8/1 在職還補得上，8/2 離職後不算
    const last = ['日', '日', '日', '日', '休'];

    const { violations, pendingWeeks } = await check(julyRows(LEAVER, { last }));

    expect(violations).toEqual([]);
    expect(pendingWeeks).toEqual([
      expect.objectContaining({ weekStart: '2026-06-29' }),
      expect.objectContaining({ weekStart: '2026-07-27', regularRestCount: 0, restDayCount: 1, missingDates: ['2026-08-01'] }),
    ]);
  });

  it('still reports a week that really lacks a rest when every outside day is employed and already scheduled', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-06-29T00:00:00.000Z') } });
    // 6/29、6/30 已有班表，7/1～7/5 也全是日班：七天都有資料卻沒有例也沒有休
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFrom(NEW_HIRE, '2026-06-29', ['日', '日'])));

    const { violations } = await check(julyRows(NEW_HIRE));

    expect(weeklyOf(violations)).toEqual([
      expect.objectContaining({ weekStart: '2026-06-29', crossMonth: true, missingDates: [] }),
    ]);
    expect(weeklyOf(violations)[0]).not.toHaveProperty('notEmployedDates');
    expect(weeklyOf(violations)[0].message).toBe(
      '每週一至週日需至少1例1休：2026-06-29 週缺少例假與休息日（此週跨月：2026-06-29～2026-06-30 屬相鄰月份，已全部排班）',
    );
  });

  it('skips the week (no pending, no violation) when the only missing outside day is before the hire day, even though the other outside day is saved', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-06-30T00:00:00.000Z') } });
    // 6/30（到職日）已有班表，6/29 在到職前沒有班表也不會有：這一週在職的日子全都看得到了
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFrom(NEW_HIRE, '2026-06-30', ['日'])));

    const { violations, pendingWeeks } = await check(julyRows(NEW_HIRE));

    expect(violations).toEqual([]);
    expect(weekStarts(pendingWeeks)).toEqual(['2026-07-27']);
  });

  it('a week whose in-month days already hold a 例 and a 休 reports nothing, whatever the dates', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-07-01T00:00:00.000Z') } });
    const { violations, pendingWeeks } = await check(julyRows(NEW_HIRE, {
      first: ['日', '日', '日', '例', '休'],
      last: ['日', '日', '日', '例', '休'],
    }));
    expect(violations).toEqual([]);
    expect(pendingWeeks).toEqual([]);
  });

  it('queries the employment dates only for the weekly check, once, for the people who are not exempt', async () => {
    employeeRows.push({ _id: NEW_HIRE, status: '試用期員工', appointment: { hireDate: new Date('2026-07-01T00:00:00.000Z') } });

    await check(julyRows(NEW_HIRE));
    const withoutPartTimeFilter = mockEmployee.find.mock.calls.filter(([filter]) => filter.partTime === undefined);
    expect(withoutPartTimeFilter).toEqual([[{ _id: { $in: [NEW_HIRE] } }]]);

    mockEmployee.find.mockClear();
    await collect({ candidateSchedules: julyRows(NEW_HIRE), range: JULY_RANGE, strictWeeklyRest: false });
    expect(mockEmployee.find.mock.calls.filter(([filter]) => filter.partTime === undefined)).toEqual([]);
  });

  it('a failing employment lookup fails the check instead of being skipped', async () => {
    mockEmployee.find.mockImplementation((filter) => {
      if (filter.partTime === true) return { select: () => ({ lean: async () => [] }) };
      throw new Error('db down');
    });
    await expect(assertScheduleRuleCompliance({
      candidateSchedules: julyRows(NEW_HIRE), range: JULY_RANGE, strictWeeklyRest: true,
    })).rejects.toThrow('db down');
  });
});
