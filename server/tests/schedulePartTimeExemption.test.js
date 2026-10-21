// 兼職人員（Employee.partTime === true）不套用排班規範檢核：
// 單一出口在 assertScheduleRuleCompliance，草稿預檢、匯入預覽與匯入、發布、完成發布都走它。
import { jest } from '@jest/globals';
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js';
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
const holidayResolverMocks = await registerHolidayResolverModelMocks(jest);
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}));

const { assertScheduleRuleCompliance, assertOvertimeApprovalCompliance } = await import('../src/services/laborRuleValidationService.js');
const { isScheduleRuleExempt, loadScheduleRuleExemptEmployeeIds } = await import('../src/services/scheduleRuleExemptionService.js');

const leanQuery = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const sortableLeanQuery = (value) => {
  const chain = { sort: jest.fn(() => chain), lean: jest.fn().mockResolvedValue(value) };
  return chain;
};

// 24 碼 ObjectId 形狀的員工 id（排班檢核只對這種 id 查 Employee）
const PART_TIME = oid(1);
const FULL_TIME = oid(2);
const NO_FIELD = oid(3);
const SECOND_PART_TIME = oid(4);

// 以記憶體內的員工資料模擬 Employee.find({ _id: { $in }, partTime: true }).select().lean() 的比對方式：
// 只有 partTime 真的是布林 true 的才比對得到（欄位不存在、null、字串 'true' 都不算）
let employeeRows;
function installEmployeeFind() {
  mockEmployee.find.mockImplementation((filter) => {
    const ids = (filter?._id?.$in || []).map(String);
    const rows = employeeRows.filter((row) => (
      ids.includes(String(row._id)) && (filter.partTime === undefined || row.partTime === filter.partTime)
    ));
    const query = { select: jest.fn(() => query), lean: jest.fn().mockResolvedValue(rows) };
    return query;
  });
}

const SETTING = {
  shifts: [
    { _id: '日', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakDuration: 60 },
    { _id: 'E', code: 'E', name: '晚班', startTime: '16:00', endTime: '00:00', breakMinutes: 0, crossDay: true },
    { _id: 'LONG', code: 'L', name: '長班', startTime: '06:00', endTime: '22:00', breakMinutes: 0, breakDuration: 0 },
    { _id: 'REST', code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
    { _id: 'REG', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
  ],
};

const utcDay = (iso) => new Date(`${iso}T00:00:00.000Z`);
const rows = (employee, startIso, codes) => codes.map((shiftId, index) => ({
  employee,
  date: new Date(utcDay(startIso).getTime() + index * 24 * 60 * 60 * 1000),
  shiftId,
}));
const JUNE_RANGE = { start: utcDay('2026-06-01'), end: utcDay('2026-07-01') };

async function collect(args) {
  try {
    const result = await assertScheduleRuleCompliance(args);
    return { violations: result.violations, resolved: result };
  } catch (error) {
    if (Array.isArray(error?.violations)) return { violations: error.violations, error };
    throw error;
  }
}
const ruleNames = (violations) => [...new Set(violations.map((item) => item.rule))].sort();

beforeEach(() => {
  [mockShiftSchedule.find, mockShiftSchedule.findOne, mockAttendanceSetting.findOne, mockApprovalRequest.find,
    mockFormField.find, mockHoliday.find, mockHolidayMoveSetting.find, mockEmployee.find, mockGetAllLeaveFieldInfos,
  ].forEach((fn) => fn.mockReset());
  employeeRows = [
    { _id: PART_TIME, partTime: true },
    { _id: FULL_TIME, partTime: false },
    { _id: NO_FIELD },
    { _id: SECOND_PART_TIME, partTime: true },
  ];
  installEmployeeFind();
  mockAttendanceSetting.findOne.mockReturnValue(leanQuery(SETTING));
  mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
  mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([]));
  mockFormField.find.mockReturnValue(sortableLeanQuery([{ _id: 'start', label: '開始時間' }, { _id: 'end', label: '結束時間' }]));
  mockHoliday.find.mockReturnValue(leanQuery([]));
  mockHolidayMoveSetting.find.mockReturnValue(leanQuery([]));
  mockGetAllLeaveFieldInfos.mockResolvedValue([]);
});

describe('isScheduleRuleExempt', () => {
  it.each([
    [{ partTime: true }, true],
    [{ partTime: false }, false],
    [{}, false],
    [{ partTime: null }, false],
    [{ partTime: 'true' }, false],
    [{ partTime: 1 }, false],
    [{ isPartTime: true }, false],
    [null, false],
    [undefined, false],
  ])('%j -> %s', (employee, expected) => {
    expect(isScheduleRuleExempt(employee)).toBe(expected);
  });
});

describe('loadScheduleRuleExemptEmployeeIds', () => {
  it('asks Employee only for partTime true among the given ids and returns their ids as strings', async () => {
    const result = await loadScheduleRuleExemptEmployeeIds([PART_TIME, FULL_TIME, NO_FIELD, PART_TIME]);

    expect(result).toEqual(new Set([PART_TIME]));
    expect(mockEmployee.find).toHaveBeenCalledTimes(1);
    expect(mockEmployee.find).toHaveBeenCalledWith({ _id: { $in: [PART_TIME, FULL_TIME, NO_FIELD] }, partTime: true });
  });

  it('accepts ObjectId-like instances and skips anything that is not a 24-hex id without querying', async () => {
    const objectLike = { toString: () => PART_TIME };
    expect(await loadScheduleRuleExemptEmployeeIds([objectLike])).toEqual(new Set([PART_TIME]));

    mockEmployee.find.mockClear();
    expect(await loadScheduleRuleExemptEmployeeIds(['emp1', 'A0003', ''])).toEqual(new Set());
    expect(await loadScheduleRuleExemptEmployeeIds([])).toEqual(new Set());
    expect(await loadScheduleRuleExemptEmployeeIds(undefined)).toEqual(new Set());
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });

  it('works with a query that has no lean()', async () => {
    mockEmployee.find.mockReturnValue(Promise.resolve([{ _id: PART_TIME }]));
    expect(await loadScheduleRuleExemptEmployeeIds([PART_TIME])).toEqual(new Set([PART_TIME]));
  });

  it('does not swallow a database failure', async () => {
    mockEmployee.find.mockImplementation(() => {
      const query = { select: () => query, lean: () => Promise.reject(new Error('db down')) };
      return query;
    });
    await expect(loadScheduleRuleExemptEmployeeIds([PART_TIME])).rejects.toThrow('db down');
  });
});

describe('assertScheduleRuleCompliance for part-time employees', () => {
  // 週一、三、五上班、其他天沒有班表：正職缺例假與休息日，兼職本來就是只排上班那幾天
  const monWedFri = (employee) => [
    ...rows(employee, '2026-06-01', ['日', '', '日', '', '日']).filter((row) => row.shiftId),
    ...rows(employee, '2026-06-08', ['日', '', '日', '', '日']).filter((row) => row.shiftId),
    ...rows(employee, '2026-06-15', ['日', '', '日', '', '日']).filter((row) => row.shiftId),
    ...rows(employee, '2026-06-22', ['日', '', '日', '', '日']).filter((row) => row.shiftId),
    ...rows(employee, '2026-06-29', ['日', '', '日']).filter((row) => row.shiftId),
  ];

  it('control: a full-time employee with the same rows is still rejected for the weekly 例/休', async () => {
    const { violations } = await collect({ candidateSchedules: monWedFri(FULL_TIME), range: JUNE_RANGE, strictWeeklyRest: true });
    expect(ruleNames(violations)).toEqual(['weekly-one-regular-rest-one-rest-day']);
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });

  it('control: an employee without any partTime field is treated as full-time', async () => {
    const { violations } = await collect({ candidateSchedules: monWedFri(NO_FIELD), range: JUNE_RANGE, strictWeeklyRest: true });
    expect(ruleNames(violations)).toEqual(['weekly-one-regular-rest-one-rest-day']);
  });

  it('passes the weekly 一例一休 check for a part-time employee and returns the plain resolved value', async () => {
    await expect(assertScheduleRuleCompliance({
      candidateSchedules: monWedFri(PART_TIME), range: JUNE_RANGE, strictWeeklyRest: true,
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('does not report cross-month pending weeks for a part-time employee either', async () => {
    // 七月只排前五天（都是上班）：正職首週 6/29～7/5 待判斷，兼職不該有任何提醒
    const july = { start: utcDay('2026-07-01'), end: utcDay('2026-08-01') };
    const full = await assertScheduleRuleCompliance({
      candidateSchedules: rows(FULL_TIME, '2026-07-01', ['日', '日', '日', '日', '日']), range: july, strictWeeklyRest: true,
    });
    expect(full.pendingWeeks).toEqual([expect.objectContaining({ employee: FULL_TIME, weekStart: '2026-06-29' })]);

    const part = await assertScheduleRuleCompliance({
      candidateSchedules: rows(PART_TIME, '2026-07-01', ['日', '日', '日', '日', '日']), range: july, strictWeeklyRest: true,
    });
    expect(part).toEqual({ ok: true, violations: [] });
  });

  it('ignores the 12 hour / 8 hour caps for a part-time employee and keeps them for full-time', async () => {
    const part = await collect({ candidateSchedules: rows(PART_TIME, '2026-06-02', ['LONG']) });
    expect(part.violations).toEqual([]);

    const full = await collect({ candidateSchedules: rows(FULL_TIME, '2026-06-02', ['LONG']) });
    expect(ruleNames(full.violations)).toEqual(['daily-work-hours', 'regular-work-hours']);
  });

  it('ignores seven consecutive work days for a part-time employee and keeps the rule for full-time', async () => {
    const week = ['日', '日', '日', '日', '日', '日', '日'];
    expect((await collect({ candidateSchedules: rows(PART_TIME, '2026-06-01', week) })).violations).toEqual([]);
    expect(ruleNames((await collect({ candidateSchedules: rows(FULL_TIME, '2026-06-01', week) })).violations)).toEqual(['continuous-work-days']);
  });

  it('ignores a short rest between shifts for a part-time employee and keeps the rule for full-time', async () => {
    // 晚班 16:00-00:00 之後隔天 08:00 上日班：只間隔 8 小時
    const pair = ['E', '日'];
    expect((await collect({ candidateSchedules: rows(PART_TIME, '2026-06-02', pair) })).violations).toEqual([]);
    expect(ruleNames((await collect({ candidateSchedules: rows(FULL_TIME, '2026-06-02', pair) })).violations)).toEqual(['shift-gap']);
  });

  it('in a mixed batch reports only the full-time employee and loads only their schedules', async () => {
    const { violations } = await collect({
      candidateSchedules: [...monWedFri(PART_TIME), ...monWedFri(FULL_TIME), ...monWedFri(SECOND_PART_TIME)],
      range: JUNE_RANGE,
      strictWeeklyRest: true,
    });

    expect(violations.length).toBeGreaterThan(0);
    expect([...new Set(violations.map((item) => item.employee))]).toEqual([FULL_TIME]);
    expect(mockShiftSchedule.find).toHaveBeenCalledTimes(1);
    expect(mockShiftSchedule.find.mock.calls[0][0].employee).toEqual({ $in: [FULL_TIME] });
  });

  it('still judges employees the Employee lookup did not return (deleted or unknown ids)', async () => {
    const ghost = oid(99);
    const { violations } = await collect({ candidateSchedules: monWedFri(ghost), range: JUNE_RANGE, strictWeeklyRest: true });
    expect(ruleNames(violations)).toEqual(['weekly-one-regular-rest-one-rest-day']);
  });

  it('does not let an exempt employee’s saved rows leak into other employees’ checks', async () => {
    // 兼職那一天的班表若混進正職的資料，正職的連續上班天數就會被誤算
    const { violations } = await collect({
      candidateSchedules: [...rows(FULL_TIME, '2026-06-01', ['日', '例']), ...rows(PART_TIME, '2026-06-01', ['日', '日', '日', '日', '日', '日', '日'])],
    });
    expect(violations).toEqual([]);
  });

  it('skips every schedule / leave / holiday load when all employees in the batch are exempt', async () => {
    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [...monWedFri(PART_TIME), ...monWedFri(SECOND_PART_TIME)],
      range: JUNE_RANGE,
      strictWeeklyRest: true,
    })).resolves.toEqual({ ok: true, violations: [] });

    expect(mockShiftSchedule.find).not.toHaveBeenCalled();
    expect(mockHoliday.find).not.toHaveBeenCalled();
    expect(mockGetAllLeaveFieldInfos).not.toHaveBeenCalled();
  });

  it('lets a lookup failure fail the check instead of waiving the rules', async () => {
    mockEmployee.find.mockImplementation(() => {
      const query = { select: () => query, lean: () => Promise.reject(new Error('db down')) };
      return query;
    });
    await expect(assertScheduleRuleCompliance({
      candidateSchedules: monWedFri(FULL_TIME), range: JUNE_RANGE, strictWeeklyRest: true,
    })).rejects.toThrow('db down');
  });

  it('judges the whole month by the current flag (switching 兼職 off applies the rules to the whole month again)', async () => {
    const args = { candidateSchedules: monWedFri(PART_TIME), range: JUNE_RANGE, strictWeeklyRest: true };
    await expect(assertScheduleRuleCompliance(args)).resolves.toEqual({ ok: true, violations: [] });

    employeeRows = employeeRows.map((row) => (row._id === PART_TIME ? { ...row, partTime: false } : row));
    const { violations } = await collect(args);
    expect(ruleNames(violations)).toEqual(['weekly-one-regular-rest-one-rest-day']);
  });

  it('does not query Employee at all for ids that are not ObjectIds (existing fixtures keep working)', async () => {
    const { violations } = await collect({ candidateSchedules: rows('emp1', '2026-06-02', ['LONG']) });
    expect(ruleNames(violations)).toEqual(['daily-work-hours', 'regular-work-hours']);
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });
});

describe('what part-time exemption deliberately does not touch', () => {
  it('still rejects overtime on a regular rest day for a part-time applicant and never consults the exemption', async () => {
    mockShiftSchedule.findOne.mockReturnValue(leanQuery({
      _id: 'sch1', employee: PART_TIME, date: utcDay('2026-06-07'), shiftId: 'REG',
    }));

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'ot', name: '加班申請' },
      applicantEmployeeId: PART_TIME,
      formData: { start: '2026-06-07T02:00:00.000Z', end: '2026-06-07T04:00:00.000Z' },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'regular-rest-overtime' })],
    });
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });
});
