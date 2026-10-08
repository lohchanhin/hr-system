import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockShiftSchedule = {
  find: jest.fn(),
  findOne: jest.fn(),
};
const mockAttendanceSetting = { findOne: jest.fn() };
const mockApprovalRequest = { find: jest.fn() };
const mockFormField = { find: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockGetAllLeaveFieldInfos = jest.fn();

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}));

const {
  assertScheduleRuleCompliance,
  assertApprovalRequestCompliance,
  assertOvertimeApprovalCompliance,
  __testUtils,
} = await import('../src/services/laborRuleValidationService.js');

function leanQuery(value) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function sortableLeanQuery(value) {
  const chain = {
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

const attendanceSetting = {
  shifts: [
    { _id: 'D', code: 'D', name: '日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
    { _id: 'E', code: 'E', name: '晚班', startTime: '16:00', endTime: '00:00', breakMinutes: 0, crossDay: true },
    { _id: 'EARLY', code: 'EARLY', name: '早班', startTime: '07:00', endTime: '16:00', breakMinutes: 60 },
    { _id: 'NINE', code: 'NINE', name: '九小時班', startTime: '08:00', endTime: '18:00', breakMinutes: 60 },
    { _id: 'LONG', code: 'L', name: '長班', startTime: '08:00', endTime: '22:00', breakMinutes: 60 },
    { _id: 'REST', code: '休', name: '休息日' },
    { _id: 'REG', code: '例', name: '例假' },
  ],
};

const overtimeFields = [
  { _id: 'start', label: '開始時間' },
  { _id: 'end', label: '結束時間' },
];

beforeEach(() => {
  mockShiftSchedule.find.mockReset();
  mockShiftSchedule.findOne.mockReset();
  mockAttendanceSetting.findOne.mockReset();
  mockApprovalRequest.find.mockReset();
  mockFormField.find.mockReset();
  mockHoliday.find.mockReset();
  mockHolidayMoveSetting.find.mockReset();
  mockGetAllLeaveFieldInfos.mockReset();

  mockAttendanceSetting.findOne.mockReturnValue(leanQuery(attendanceSetting));
  mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
  mockShiftSchedule.findOne.mockReturnValue(leanQuery(null));
  mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([]));
  mockFormField.find.mockReturnValue(sortableLeanQuery(overtimeFields));
  mockHoliday.find.mockReturnValue(leanQuery([]));
  mockHolidayMoveSetting.find.mockReturnValue(leanQuery([]));
  mockGetAllLeaveFieldInfos.mockResolvedValue([]);
});

describe('assertScheduleRuleCompliance', () => {
  it('normalizes MongoDB ObjectIds without following the self-referencing _id getter', () => {
    const id = new mongoose.Types.ObjectId();
    expect(__testUtils.normalizeId(id)).toBe(id.toHexString());
  });

  it('rejects shift changes with less than 11 hours between shifts', async () => {
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      { _id: 'old1', employee: 'emp1', date: new Date('2024-04-01'), shiftId: 'E' },
    ]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-02'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'shift-gap' })],
    });
  });

  it('rejects a scheduled workday longer than 12 hours', async () => {
    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-01'), shiftId: 'LONG' }],
    })).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ rule: 'daily-work-hours' }),
        expect.objectContaining({ rule: 'regular-work-hours' }),
      ]),
    });
  });

  it('collects all rule families and employees in one validation', async () => {
    const schedules = ['emp1', 'emp2'].flatMap(employee =>
      Array.from({ length: 7 }, (_, index) => ({
        employee,
        date: new Date(`2024-04-0${index + 1}`),
        shiftId: index === 0 ? 'LONG' : 'D',
      })),
    );
    let error;
    try {
      await assertScheduleRuleCompliance({
        candidateSchedules: schedules,
        range: { start: new Date('2024-04-01'), end: new Date('2024-04-08') },
        strictWeeklyRest: true,
      });
    } catch (caught) { error = caught; }
    expect(error?.violations).toBeDefined();
    for (const employee of ['emp1', 'emp2']) {
      expect(error.violations).toEqual(expect.arrayContaining([
        'daily-work-hours', 'regular-work-hours', 'shift-gap',
        'continuous-work-days', 'weekly-one-regular-rest-one-rest-day',
      ].map(rule => expect.objectContaining({ employee, rule }))));
    }
  });

  it('rejects a regular shift longer than eight working hours', async () => {
    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-01'), shiftId: 'NINE' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'regular-work-hours', minutes: 540 })],
    });
  });

  it('rejects seven consecutive days without rest or regular rest', async () => {
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      '2024-04-01',
      '2024-04-02',
      '2024-04-03',
      '2024-04-04',
      '2024-04-05',
      '2024-04-06',
    ].map((date, index) => ({
      _id: `old${index}`,
      employee: 'emp1',
      date: new Date(date),
      shiftId: 'D',
    }))));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-07'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'continuous-work-days' })],
    });
  });

  it('counts approved leave toward the six-day limit between rest days', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([{
      formId: 'leave-form',
      startId: 'leave-start',
      endId: 'leave-end',
    }]);
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([
      {
        applicant_employee: 'emp1',
        form_data: { 'leave-start': '2024-04-07', 'leave-end': '2024-04-08' },
      },
      {
        applicant_employee: 'emp1',
        form_data: { 'leave-start': '2024-04-13', 'leave-end': '2024-04-13' },
      },
    ]));
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      { _id: 'regular-rest', employee: 'emp1', date: new Date('2024-04-06'), shiftId: 'REG' },
      { _id: 'work-1', employee: 'emp1', date: new Date('2024-04-09'), shiftId: 'D' },
      { _id: 'work-2', employee: 'emp1', date: new Date('2024-04-10'), shiftId: 'D' },
      { _id: 'work-3', employee: 'emp1', date: new Date('2024-04-11'), shiftId: 'D' },
      { _id: 'work-4', employee: 'emp1', date: new Date('2024-04-12'), shiftId: 'D' },
      { _id: 'rest', employee: 'emp1', date: new Date('2024-04-14'), shiftId: 'REST' },
    ]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-12'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({
        rule: 'continuous-work-days',
        dates: [
          '2024-04-07',
          '2024-04-08',
          '2024-04-09',
          '2024-04-10',
          '2024-04-11',
          '2024-04-12',
          '2024-04-13',
        ],
      })],
    });
  });

  it('counts a national holiday toward the six-day limit between rest days', async () => {
    mockHoliday.find.mockReturnValue(leanQuery([
      { name: '國定假日', type: '國定假日', date: new Date('2024-04-07') },
    ]));
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      { _id: 'regular-rest', employee: 'emp1', date: new Date('2024-04-06'), shiftId: 'REG' },
      ...['08', '09', '10', '11', '12'].map((day, index) => ({
        _id: `work-${index}`,
        employee: 'emp1',
        date: new Date(`2024-04-${day}`),
        shiftId: 'D',
      })),
      { _id: 'rest', employee: 'emp1', date: new Date('2024-04-14'), shiftId: 'REST' },
    ]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-13'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({
        rule: 'continuous-work-days',
        dates: ['2024-04-07', '2024-04-08', '2024-04-09', '2024-04-10', '2024-04-11', '2024-04-12', '2024-04-13'],
      })],
    });
  });

  it('moves a national holiday only to its configured target day for streak checks', async () => {
    mockHoliday.find.mockReturnValue(leanQuery([
      { name: '國定假日', type: '國定假日', date: new Date('2024-04-07') },
    ]));
    mockHolidayMoveSetting.find.mockReturnValue(leanQuery([
      { enableHolidayMove: true, sourceDate: new Date('2024-04-07'), targetDate: new Date('2024-04-20') },
    ]));
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      { _id: 'regular-rest', employee: 'emp1', date: new Date('2024-04-06'), shiftId: 'REG' },
      ...['08', '09', '10', '11', '12'].map((day, index) => ({
        _id: `work-${index}`,
        employee: 'emp1',
        date: new Date(`2024-04-${day}`),
        shiftId: 'D',
      })),
      { _id: 'rest', employee: 'emp1', date: new Date('2024-04-14'), shiftId: 'REST' },
    ]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-13'), shiftId: 'D' }],
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('rejects publish when a Monday-Sunday week misses one regular rest day', async () => {
    const week = [
      ['2024-04-01', 'D'],
      ['2024-04-02', 'D'],
      ['2024-04-03', 'D'],
      ['2024-04-04', 'D'],
      ['2024-04-05', 'D'],
      ['2024-04-06', 'REST'],
      ['2024-04-07', 'D'],
    ].map(([date, shiftId], index) => ({
      _id: `candidate${index}`,
      employee: 'emp1',
      date: new Date(date),
      shiftId,
    }));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: week,
      range: { start: new Date('2024-04-01'), end: new Date('2024-04-08') },
      strictWeeklyRest: true,
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'weekly-one-regular-rest-one-rest-day' })],
    });
  });
});

// 客戶「班表公版」：17 個休假/請假班別（00:00-00:00）與上班班別
const CUSTOMER_OFF_SHIFTS = [
  ['休', '休假'], ['例', '例假'], ['國', '國定假日'], ['事', '事假'], ['特', '特休'], ['補', '補休'],
  ['原', '原民假'], ['病', '病假'], ['公', '公假'], ['公傷', '公傷假'], ['婚', '婚假'], ['喪', '喪假'],
  ['生', '生理假'], ['檢', '產檢假'], ['陪', '陪產檢假'], ['產', '分娩假'], ['家', '家庭照顧假'],
];
const CUSTOMER_LEAVE_CODES = CUSTOMER_OFF_SHIFTS.map(([code]) => code)
  .filter((code) => !['休', '例', '國'].includes(code));

// explicitWork：模擬管理者建立班別時沒改「班別性質」預設值，被存成 work 的情況
function customerSetting({ explicitWork = false } = {}) {
  return {
    shifts: [
      ...CUSTOMER_OFF_SHIFTS.map(([code, name]) => ({
        _id: code,
        code,
        name,
        startTime: '00:00',
        endTime: '00:00',
        breakMinutes: 0,
        ...(explicitWork ? { semanticType: 'work' } : {}),
      })),
      { _id: '日', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
      { _id: 'N', code: 'N', name: '夜班', startTime: '00:00', endTime: '08:00', breakMinutes: 0, crossDay: true },
      { _id: 'N9', code: 'N9', name: '九小時夜班', startTime: '00:00', endTime: '09:00', breakMinutes: 0, crossDay: true },
      { _id: 'E2', code: 'E2', name: '晚班', startTime: '16:00', endTime: '00:00', breakMinutes: 0, crossDay: true },
      { _id: 'FULL', code: 'FULL', name: '24小時班', startTime: '00:00', endTime: '00:00', breakMinutes: 0, crossDay: true },
    ],
  };
}

const utcDay = (iso) => new Date(`${iso}T00:00:00.000Z`);

// 由某天開始，一天一個班別代碼
function rowsFromCodes(employee, startIso, codes) {
  return codes.map((shiftId, index) => ({
    employee,
    date: new Date(utcDay(startIso).getTime() + index * 24 * 60 * 60 * 1000),
    shiftId,
  }));
}

const JUNE_EMPLOYEES = ['A0003', 'A0069', 'A0119', 'A0134', 'A0141', 'A0142', 'A0143', 'A0146'];
const JUNE_RANGE = { start: utcDay('2026-06-01'), end: utcDay('2026-07-01') };
// 6/6 6/13 6/20 6/27 例、6/7 6/14 6/21 6/28 休、6/19 端午節國定假日，其他天都是日班
const JUNE_CODES = Array.from({ length: 30 }, (_, index) => {
  const day = index + 1;
  if ([6, 13, 20, 27].includes(day)) return '例';
  if ([7, 14, 21, 28].includes(day)) return '休';
  if (day === 19) return '國';
  return '日';
});

function juneRows(employees = JUNE_EMPLOYEES, codes = JUNE_CODES) {
  return employees.flatMap((employee) => rowsFromCodes(employee, '2026-06-01', codes));
}

async function collectViolations(args) {
  try {
    await assertScheduleRuleCompliance(args);
    return [];
  } catch (error) {
    if (Array.isArray(error?.violations)) return error.violations;
    throw error;
  }
}

const HOURS_AND_GAP_RULES = ['daily-work-hours', 'regular-work-hours', 'shift-gap'];

describe('classifyShift with the customer shift table', () => {
  const { classifyShift } = __testUtils;

  it.each(CUSTOMER_OFF_SHIFTS)('treats %s (%s) as non-work and counts only 例 and 休 for weekly rest', (code, name) => {
    const shift = { _id: code, code, name, startTime: '00:00', endTime: '00:00', breakMinutes: 0 };
    expect(classifyShift(shift)).toMatchObject({
      isRegularRest: code === '例',
      isRestDay: code === '休',
      isHoliday: code === '國',
      isLeave: !['休', '例', '國'].includes(code),
      isNonWork: true,
    });
  });

  it('treats a zero-time shift saved with the default work type as non-work but not as 例 or 休', () => {
    const shift = { code: '休', name: '休假', startTime: '00:00', endTime: '00:00', semanticType: 'work' };
    expect(classifyShift(shift)).toMatchObject({
      semanticType: 'work', isRegularRest: false, isRestDay: false, isNonWork: true,
    });
  });

  it('keeps working shifts as work, including cross-day and 24 hour shifts', () => {
    for (const shift of customerSetting().shifts.filter((item) => !CUSTOMER_OFF_SHIFTS.some(([code]) => code === item.code))) {
      expect(classifyShift(shift)).toMatchObject({ isRegularRest: false, isRestDay: false, isNonWork: false });
    }
    expect(classifyShift({ code: '休D', name: '休息日出勤', startTime: '08:00', endTime: '17:00' }).isNonWork).toBe(false);
  });

  it('does not throw for a missing shift', () => {
    expect(classifyShift(undefined)).toMatchObject({ isRegularRest: false, isRestDay: false, isNonWork: false });
    expect(classifyShift(null).isNonWork).toBe(false);
  });
});

describe('assertScheduleRuleCompliance with the customer June 2026 schedule', () => {
  beforeEach(() => {
    mockAttendanceSetting.findOne.mockReturnValue(leanQuery(customerSetting()));
  });

  it('accepts the whole month for 8 employees with 例/休/國 saved as rows', async () => {
    const violations = await collectViolations({
      candidateSchedules: juneRows(),
      range: JUNE_RANGE,
      strictWeeklyRest: true,
    });
    expect(violations).toEqual([]);
  });

  it('raises no hours or gap findings when 國 and every leave code are saved as rows', async () => {
    for (const explicitWork of [false, true]) {
      mockAttendanceSetting.findOne.mockReturnValue(leanQuery(customerSetting({ explicitWork })));
      // 日班與各種請假/國定假日交錯，每個請假代碼各出現一次
      const codes = ['日', '國', '日', ...CUSTOMER_LEAVE_CODES.flatMap((code) => [code, '日']), '休', '例'];
      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-01', codes),
      });
      expect(violations.filter((item) => HOURS_AND_GAP_RULES.includes(item.rule))).toEqual([]);
    }
  });

  it('raises no hours or gap findings for the June file even when day-off shifts were saved as work', async () => {
    mockAttendanceSetting.findOne.mockReturnValue(leanQuery(customerSetting({ explicitWork: true })));
    const violations = await collectViolations({
      candidateSchedules: juneRows(['A0003']),
      range: JUNE_RANGE,
    });
    expect(violations.filter((item) => HOURS_AND_GAP_RULES.includes(item.rule))).toEqual([]);
  });

  describe('week by week', () => {
    it.each([
      ['2026-06-01', 6, '例假'],
      ['2026-06-08', 13, '例假'],
      ['2026-06-15', 20, '例假'],
      ['2026-06-22', 27, '例假'],
      ['2026-06-01', 7, '休息日'],
      ['2026-06-08', 14, '休息日'],
      ['2026-06-15', 21, '休息日'],
      ['2026-06-22', 28, '休息日'],
    ])('reports only the week of %s when the rest on 6/%i is replaced by a work day (%s missing)', async (weekStart, day, label) => {
      const codes = [...JUNE_CODES];
      codes[day - 1] = '日';
      const violations = await collectViolations({
        candidateSchedules: juneRows(['A0003'], codes),
        range: JUNE_RANGE,
        strictWeeklyRest: true,
      });
      expect(violations).toEqual([
        expect.objectContaining({
          rule: 'weekly-one-regular-rest-one-rest-day',
          employee: 'A0003',
          weekStart,
          regularRestCount: label === '例假' ? 0 : 1,
          restDayCount: label === '休息日' ? 0 : 1,
        }),
      ]);
      expect(violations[0].message).toContain(label);
    });
  });

  describe('partial last week of the month (6/29-7/5)', () => {
    const rowsFor = (codes, startIso = '2026-07-01') => rowsFromCodes('A0003', startIso, codes);

    it('is not reported when the rows after the month are missing', async () => {
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
      const violations = await collectViolations({
        candidateSchedules: juneRows(['A0003']),
        range: JUNE_RANGE,
        strictWeeklyRest: true,
      });
      expect(violations).toEqual([]);
    });

    it('is not reported when only some of 7/1..7/5 exist', async () => {
      // 7/4、7/5 沒有資料：下個月根本還沒排完
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFor(['日', '日', '日'])));
      const violations = await collectViolations({
        candidateSchedules: juneRows(['A0003']),
        range: JUNE_RANGE,
        strictWeeklyRest: true,
      });
      expect(violations).toEqual([]);
    });

    it('is reported when every day 7/1..7/5 exists but has neither 例 nor 休', async () => {
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFor(['日', '日', '日', '日', '日'])));
      const violations = await collectViolations({
        candidateSchedules: juneRows(['A0003']),
        range: JUNE_RANGE,
        strictWeeklyRest: true,
      });
      expect(violations.filter((item) => item.rule === 'weekly-one-regular-rest-one-rest-day')).toEqual([
        expect.objectContaining({ employee: 'A0003', weekStart: '2026-06-29', regularRestCount: 0, restDayCount: 0 }),
      ]);
    });

    it('reports only the missing 例 when 7/1..7/5 exist with a 休 but no 例', async () => {
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFor(['日', '日', '休', '日', '日'])));
      const violations = await collectViolations({
        candidateSchedules: juneRows(['A0003']),
        range: JUNE_RANGE,
        strictWeeklyRest: true,
      });
      expect(violations).toEqual([
        expect.objectContaining({
          rule: 'weekly-one-regular-rest-one-rest-day',
          weekStart: '2026-06-29',
          regularRestCount: 0,
          restDayCount: 1,
        }),
      ]);
    });

    it('passes when 7/1..7/5 exist and contain a 例 and a 休', async () => {
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFor(['日', '日', '例', '休', '日'])));
      const violations = await collectViolations({
        candidateSchedules: juneRows(['A0003']),
        range: JUNE_RANGE,
        strictWeeklyRest: true,
      });
      expect(violations).toEqual([]);
    });
  });

  describe('month that starts in the middle of a week (July 2026)', () => {
    const JULY_RANGE = { start: utcDay('2026-07-01'), end: utcDay('2026-08-01') };
    const julyRows = () => [
      ...rowsFromCodes('A0003', '2026-07-01', ['日', '日', '日', '日', '日']), // 6/29 週：整週沒有休/例
      ...rowsFromCodes('A0003', '2026-07-06', ['休', '日', '日', '日', '日', '例', '日']),
      ...rowsFromCodes('A0003', '2026-07-13', ['日', '日', '日', '日', '日', '例', '休']),
      ...rowsFromCodes('A0003', '2026-07-20', ['日', '日', '日', '日', '日', '例', '休']),
      ...rowsFromCodes('A0003', '2026-07-27', ['日', '日', '日', '日', '日']), // 7/27 週：8/1、8/2 不在範圍內
    ];
    const weeklyOf = (violations) => violations.filter((item) => item.rule === 'weekly-one-regular-rest-one-rest-day');

    it('skips both boundary weeks when the neighbouring months have no rows', async () => {
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
      const violations = await collectViolations({
        candidateSchedules: julyRows(), range: JULY_RANGE, strictWeeklyRest: true,
      });
      expect(violations).toEqual([]);
    });

    it('reports the first week when only one empty day is left for both a 例 and a 休', async () => {
      // 6/30 已排日，只剩 6/29 一天可以補：一天放不下 1 例 + 1 休，已經無法補齊
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFromCodes('A0003', '2026-06-30', ['日'])));
      const violations = await collectViolations({
        candidateSchedules: julyRows(), range: JULY_RANGE, strictWeeklyRest: true,
      });
      expect(weeklyOf(violations)).toEqual([
        expect.objectContaining({ weekStart: '2026-06-29', regularRestCount: 0, restDayCount: 0 }),
      ]);
    });

    it('skips the first week while the missing days can still hold the missing rest days', async () => {
      // 7/4 已有例，只缺 1 個休；6/29 還沒排，可以補休 → 先不報
      const rows = julyRows().filter((row) => row.date.toISOString().slice(0, 10) !== '2026-07-04');
      rows.push(...rowsFromCodes('A0003', '2026-07-04', ['例']));
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFromCodes('A0003', '2026-06-30', ['日'])));
      const violations = await collectViolations({
        candidateSchedules: rows, range: JULY_RANGE, strictWeeklyRest: true,
      });
      expect(weeklyOf(violations)).toEqual([]);
    });

    it('evaluates the first week when both 6/29 and 6/30 exist', async () => {
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFromCodes('A0003', '2026-06-29', ['日', '日'])));
      const violations = await collectViolations({
        candidateSchedules: julyRows(), range: JULY_RANGE, strictWeeklyRest: true,
      });
      expect(weeklyOf(violations)).toEqual([
        expect.objectContaining({ weekStart: '2026-06-29', regularRestCount: 0, restDayCount: 0 }),
      ]);
    });

    it('reports the last week once only one empty day is left, and also when both 8/1 and 8/2 exist', async () => {
      // 8/1 已排日，只剩 8/2 一天：放不下 1 例 + 1 休
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFromCodes('A0003', '2026-08-01', ['日'])));
      expect(weeklyOf(await collectViolations({
        candidateSchedules: julyRows(), range: JULY_RANGE, strictWeeklyRest: true,
      }))).toEqual([
        expect.objectContaining({ weekStart: '2026-07-27', regularRestCount: 0, restDayCount: 0 }),
      ]);

      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery(rowsFromCodes('A0003', '2026-08-01', ['日', '日'])));
      expect(weeklyOf(await collectViolations({
        candidateSchedules: julyRows(), range: JULY_RANGE, strictWeeklyRest: true,
      }))).toEqual([
        expect.objectContaining({ weekStart: '2026-07-27', regularRestCount: 0, restDayCount: 0 }),
      ]);
    });
  });

  describe('boundary weeks whose shortfall can no longer be fixed', () => {
    const weeklyOf = (violations) => violations.filter((item) => item.rule === 'weekly-one-regular-rest-one-rest-day');

    it('reports October 2026 (ends on Saturday) when 10/26-10/31 are six work days and only Sunday 11/1 is left', async () => {
      const range = { start: utcDay('2026-10-01'), end: utcDay('2026-11-01') };
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
      const violations = await collectViolations({
        candidateSchedules: [
          ...rowsFromCodes('A0003', '2026-10-19', ['日', '日', '日', '日', '日', '例', '休']),
          ...rowsFromCodes('A0003', '2026-10-26', ['日', '日', '日', '日', '日', '日']),
        ],
        range,
        strictWeeklyRest: true,
      });
      expect(weeklyOf(violations)).toEqual([
        expect.objectContaining({ weekStart: '2026-10-26', regularRestCount: 0, restDayCount: 0 }),
      ]);
    });

    it('reports September 2026 (starts on Tuesday) when 9/1-9/6 are all work days and only Monday 8/31 is left', async () => {
      const range = { start: utcDay('2026-09-01'), end: utcDay('2026-10-01') };
      mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));
      const violations = await collectViolations({
        candidateSchedules: [
          ...rowsFromCodes('A0003', '2026-09-01', ['日', '日', '日', '日', '日', '日']),
          ...rowsFromCodes('A0003', '2026-09-07', ['日', '日', '日', '日', '日', '例', '休']),
        ],
        range,
        strictWeeklyRest: true,
      });
      expect(weeklyOf(violations)).toEqual([
        expect.objectContaining({ weekStart: '2026-08-31', regularRestCount: 0, restDayCount: 0 }),
      ]);
    });
  });

  describe('genuine violations are still reported', () => {
    it('reports seven consecutive work days without 休 or 例', async () => {
      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-01', ['日', '日', '日', '日', '日', '日', '日']),
      });
      expect(violations).toEqual([
        expect.objectContaining({
          rule: 'continuous-work-days',
          dates: ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'],
        }),
      ]);
    });

    it('does not reset the seven day streak on 國 or a leave day', async () => {
      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-01', ['日', '日', '日', '國', '病', '日', '日']),
      });
      expect(violations).toEqual([expect.objectContaining({ rule: 'continuous-work-days' })]);
    });

    it('does not count 國 or a leave day as the weekly 例 or 休', async () => {
      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-01', ['日', '日', '日', '日', '日', '國', '病']),
        range: { start: utcDay('2026-06-01'), end: utcDay('2026-06-08') },
        strictWeeklyRest: true,
      });
      // 這 7 天同時也湊滿連續 7 日沒有休/例，這裡只看每週例休的部分
      expect(violations.filter((item) => item.rule === 'weekly-one-regular-rest-one-rest-day')).toEqual([
        expect.objectContaining({ weekStart: '2026-06-01', regularRestCount: 0, restDayCount: 0 }),
      ]);
    });

    it('still rejects a real working shift that is too long', async () => {
      mockAttendanceSetting.findOne.mockReturnValue(leanQuery({
        shifts: [{ _id: 'LONG', code: 'L', name: '長班', startTime: '08:00', endTime: '22:00', breakMinutes: 60 }],
      }));
      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-01', ['LONG']),
      });
      expect(violations.map((item) => item.rule)).toEqual(['daily-work-hours', 'regular-work-hours']);
    });
  });

  describe('cross-day working hours', () => {
    it('counts N 00:00-08:00 with the cross-day flag as 8 hours, not 32', async () => {
      expect(await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-02', ['N']),
      })).toEqual([]);

      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-02', ['N9']),
      });
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'regular-work-hours', minutes: 540 }),
      ]);
    });

    it('counts E 16:00-00:00 with the cross-day flag as 8 hours', async () => {
      expect(await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-02', ['E2']),
      })).toEqual([]);
    });

    it('keeps a 00:00-00:00 shift with the cross-day flag as a 24 hour shift', async () => {
      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-02', ['FULL']),
      });
      expect(violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ rule: 'daily-work-hours', minutes: 1440 }),
        expect.objectContaining({ rule: 'regular-work-hours', minutes: 1440 }),
      ]));
    });

    it('still checks the rest gap between real working shifts', async () => {
      // 日班 17:00 下班、隔天 00:00 夜班上班：只隔 7 小時
      const violations = await collectViolations({
        candidateSchedules: rowsFromCodes('A0003', '2026-06-01', ['日', 'N']),
      });
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'shift-gap', gapMinutes: 7 * 60 }),
      ]);
    });
  });
});

describe('assertOvertimeApprovalCompliance', () => {
  it('rejects overtime on a regular rest day', async () => {
    mockShiftSchedule.findOne.mockReturnValue(leanQuery({
      _id: 'sch1',
      employee: 'emp1',
      date: new Date('2024-04-07'),
      shiftId: 'REG',
    }));

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-07T02:00:00.000Z',
        end: '2024-04-07T04:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'regular-rest-overtime' })],
    });
  });

  it('rejects overtime when approved month total would exceed 46 hours', async () => {
    mockShiftSchedule.findOne.mockReturnValue(leanQuery({
      _id: 'sch1', employee: 'emp1', date: new Date('2024-04-10'), shiftId: 'D',
    }));
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([
      {
        _id: 'approved1',
        form_data: {
          start: '2024-04-01T00:00:00.000Z',
          end: '2024-04-02T21:00:00.000Z',
        },
      },
    ]));

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-10T00:00:00.000Z',
        end: '2024-04-10T02:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'monthly-overtime-hours' })],
    });
  });

  it('rejects cumulative approved overtime stored as ISO strings on the same day', async () => {
    mockShiftSchedule.findOne.mockReturnValue(leanQuery({
      _id: 'sch1', employee: 'emp1', date: new Date('2024-04-10'), shiftId: 'D',
    }));
    mockApprovalRequest.find.mockReturnValue(sortableLeanQuery([{
      _id: 'approved1',
      form_data: {
        start: '2024-04-10T09:00:00.000Z',
        end: '2024-04-10T12:00:00.000Z',
      },
    }]));

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-10T12:00:00.000Z',
        end: '2024-04-10T14:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'daily-overtime-hours', minutes: 300 })],
    });
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      status: 'approved', applicant_employee: 'emp1',
    });
  });

  it('aggregates approved overtime across different overtime form templates', async () => {
    mockShiftSchedule.findOne.mockReturnValue(leanQuery({
      _id: 'sch1', employee: 'emp1', date: new Date('2024-04-10'), shiftId: 'D',
    }));
    const approvalQuery = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: 'approved-other-form',
        form: { _id: 'form2', name: '臨時加班單', semanticType: 'overtime' },
        form_data: {
          start: '2024-04-01T00:00:00.000Z',
          end: '2024-04-02T21:00:00.000Z',
        },
      }]),
    };
    mockApprovalRequest.find.mockReturnValue(approvalQuery);

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請', semanticType: 'overtime' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-10T00:00:00.000Z',
        end: '2024-04-10T02:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'monthly-overtime-hours' })],
    });
  });

  it('rejects overtime when the employee has no schedule for that day', async () => {
    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-10T09:00:00.000Z',
        end: '2024-04-10T11:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'overtime-schedule-required' })],
    });
  });

  it('rejects overtime that leaves less than 11 hours before the next shift', async () => {
    const current = { _id: 'sch1', employee: 'emp1', date: new Date('2024-04-10'), shiftId: 'D' };
    mockShiftSchedule.findOne.mockReturnValue(leanQuery(current));
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      current,
      { _id: 'sch2', employee: 'emp1', date: new Date('2024-04-11'), shiftId: 'EARLY' },
    ]));

    await expect(assertOvertimeApprovalCompliance({
      form: { _id: 'form1', name: '加班申請' },
      applicantEmployeeId: 'emp1',
      formData: {
        start: '2024-04-10T09:00:00.000Z',
        end: '2024-04-10T13:00:00.000Z',
      },
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({ rule: 'overtime-shift-gap', gapMinutes: 600 })],
    });
  });
});

describe('assertApprovalRequestCompliance', () => {
  const leaveFields = [
    { _id: 'type', label: '假別', type_1: 'text', required: true },
    { _id: 'reason', label: '事由', type_1: 'textarea' },
    { _id: 'proof', label: '相關證明', type_1: 'file', required: true },
  ];

  it('rejects personal leave without a reason or an uploaded proof', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(leaveFields));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'leave-form', name: '請假' },
      formData: { type: '事假', reason: '', proof: ['proof.pdf'] },
      applicantEmployeeId: 'emp1',
    })).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ rule: 'personal-leave-reason' }),
        expect.objectContaining({ rule: 'leave-proof' }),
      ]),
    });
  });

  it('accepts personal leave with a reason and uploaded proof metadata', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(leaveFields));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'leave-form', name: '請假' },
      formData: {
        type: '事假',
        reason: '家庭事務',
        proof: [{ name: 'proof.pdf', url: '/upload/approvals/proof.pdf' }],
      },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });
});

// 客戶的「休假/事假/公假申請單（人事類-出勤標準）」：沒有檔案欄位，假別欄位是「假別類別 (C12)」
describe('assertApprovalRequestCompliance leave proof', () => {
  const customerForm = { _id: 'customer-form', name: '休假/事假/公假申請單（人事類-出勤標準）', semanticType: 'leave' };
  const customerFields = [
    { _id: 'c-type', label: '假別類別 (C12)', type_1: 'select', required: true },
    { _id: 'c-start', label: '日期(起)', type_1: 'date', required: true },
    { _id: 'c-end', label: '日期(迄)', type_1: 'date', required: true },
    { _id: 'c-days', label: '天數', type_1: 'number', required: true },
    { _id: 'c-note', label: '內容說明', type_1: 'textarea' },
  ];
  const customerData = { 'c-start': '2026-03-02', 'c-end': '2026-03-03', 'c-days': 2 };

  const defaultForm = { _id: 'leave-form', name: '請假', semanticType: 'leave' };
  const defaultFields = [
    { _id: 'type', label: '假別', type_1: 'text', required: true },
    { _id: 'start', label: '開始時間', type_1: 'datetime', required: true },
    { _id: 'end', label: '結束時間', type_1: 'datetime', required: true },
    { _id: 'reason', label: '事由', type_1: 'textarea' },
    { _id: 'proof', label: '相關證明', type_1: 'file', required: true },
  ];
  const defaultData = { type: '特休', start: '2026-03-02T09:00:00.000Z', end: '2026-03-02T18:00:00.000Z', reason: '休假' };

  async function violationsOf(form, formData) {
    try {
      await assertApprovalRequestCompliance({ form, formData, applicantEmployeeId: 'emp1' });
      return [];
    } catch (error) {
      return error.violations;
    }
  }

  it.each(['事假', '特休假', '公假'])('accepts a %s request on a leave form that has no proof field', async (leaveType) => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(customerFields));

    await expect(assertApprovalRequestCompliance({
      form: customerForm,
      formData: { ...customerData, 'c-type': leaveType },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('still enforces the required fields of a leave form that has no proof field', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(customerFields));

    const violations = await violationsOf(customerForm, { 'c-type': '特休假', 'c-start': '2026-03-02', 'c-end': '2026-03-03' });

    expect(violations).toEqual([
      expect.objectContaining({ rule: 'required-form-field', label: '天數' }),
    ]);
  });

  it('does not demand a reason for 事假 on a form whose type label is not exactly 假別 (rule unchanged)', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(customerFields));

    await expect(assertApprovalRequestCompliance({
      form: customerForm,
      formData: { ...customerData, 'c-type': '事假' },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('still demands the reason for 事假 on a form with a 假別 field, without also demanding proof when there is no proof field', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      { _id: 'type', label: '假別', type_1: 'text', required: true },
      { _id: 'reason', label: '事由', type_1: 'textarea' },
    ]));

    const violations = await violationsOf({ _id: 'no-proof', name: '請假', semanticType: 'leave' }, { type: '事假', reason: '' });

    expect(violations).toEqual([
      { rule: 'personal-leave-reason', message: '事假必須填寫事由', fieldId: 'reason' },
    ]);
  });

  it('keeps requiring proof on the default 請假 form (byte-for-byte violation)', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(defaultFields));

    const withoutProof = await violationsOf(defaultForm, defaultData);

    expect(withoutProof).toEqual([
      { rule: 'required-form-field', message: '必填欄位不可空白：相關證明', fieldId: 'proof', label: '相關證明' },
      { rule: 'leave-proof', message: '請假申請必須附上相關證明', fieldId: 'proof' },
    ]);
  });

  it('keeps rejecting a proof that is not an uploaded approval attachment on the default 請假 form', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(defaultFields));

    const violations = await violationsOf(defaultForm, { ...defaultData, proof: ['proof.pdf'] });

    expect(violations).toEqual([
      { rule: 'leave-proof', message: '請假申請必須附上相關證明', fieldId: 'proof' },
    ]);
  });

  it('accepts the default 請假 form with an uploaded proof', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery(defaultFields));

    await expect(assertApprovalRequestCompliance({
      form: defaultForm,
      formData: { ...defaultData, proof: [{ name: 'proof.pdf', url: '/upload/approvals/proof.pdf' }] },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('requires proof when the form has a proof-style text field (證明 / 附件) but nothing uploaded', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      { _id: 'type', label: '假別', type_1: 'text', required: true },
      { _id: 'note', label: '附件說明', type_1: 'text' },
    ]));

    const violations = await violationsOf({ _id: 'attach-form', name: '請假', semanticType: 'leave' }, { type: '特休', note: '' });

    expect(violations).toEqual([
      { rule: 'leave-proof', message: '請假申請必須附上相關證明', fieldId: 'note' },
    ]);
  });

  it('does not require proof from a file field the admin has deactivated', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      ...customerFields,
      { _id: 'c-file', label: '附件', type_1: 'file', is_active: false },
    ]));

    await expect(assertApprovalRequestCompliance({
      form: customerForm,
      formData: { ...customerData, 'c-type': '特休假' },
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });

  it('requires proof as soon as the customer form gets an active file field', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([
      ...customerFields,
      { _id: 'c-file', label: '請假證明', type_1: 'file' },
    ]));

    const violations = await violationsOf(customerForm, { ...customerData, 'c-type': '特休假' });

    expect(violations).toEqual([
      { rule: 'leave-proof', message: '請假申請必須附上相關證明', fieldId: 'c-file' },
    ]);
  });

  it('does not apply the leave rules to a form that is not a leave form', async () => {
    mockFormField.find.mockReturnValue(sortableLeanQuery([{ _id: 'note', label: '備註', type_1: 'text' }]));

    await expect(assertApprovalRequestCompliance({
      form: { _id: 'general-form', name: '在職證明', semanticType: 'general' },
      formData: {},
      applicantEmployeeId: 'emp1',
    })).resolves.toEqual({ ok: true, violations: [] });
  });
});

describe('assertScheduleRuleCompliance with several leave forms', () => {
  it('counts approved leave of every leave form toward the six-day limit', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([
      { formId: 'leave-form', startId: 'leave-start', endId: 'leave-end' },
      { formId: 'custom-form', startId: 'c-start', endId: 'c-end' },
    ]);
    mockApprovalRequest.find.mockImplementation((filter) => sortableLeanQuery(filter.form === 'leave-form'
      ? [{ applicant_employee: 'emp1', form_data: { 'leave-start': '2024-04-07', 'leave-end': '2024-04-08' } }]
      : [{ applicant_employee: 'emp1', form_data: { 'c-start': '2024-04-13', 'c-end': '2024-04-13' } }]));
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([
      { _id: 'regular-rest', employee: 'emp1', date: new Date('2024-04-06'), shiftId: 'REG' },
      { _id: 'work-1', employee: 'emp1', date: new Date('2024-04-09'), shiftId: 'D' },
      { _id: 'work-2', employee: 'emp1', date: new Date('2024-04-10'), shiftId: 'D' },
      { _id: 'work-3', employee: 'emp1', date: new Date('2024-04-11'), shiftId: 'D' },
      { _id: 'work-4', employee: 'emp1', date: new Date('2024-04-12'), shiftId: 'D' },
      { _id: 'rest', employee: 'emp1', date: new Date('2024-04-14'), shiftId: 'REST' },
    ]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-12'), shiftId: 'D' }],
    })).rejects.toMatchObject({
      violations: [expect.objectContaining({
        rule: 'continuous-work-days',
        // 04-07/04-08 來自預設的請假、04-13 來自客戶表單，缺一天都連不起來
        dates: ['2024-04-07', '2024-04-08', '2024-04-09', '2024-04-10', '2024-04-11', '2024-04-12', '2024-04-13'],
      })],
    });
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(2);
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      form: 'custom-form', status: 'approved', applicant_employee: { $in: ['emp1'] },
    });
  });

  it('does not query approvals when no leave form exists', async () => {
    mockShiftSchedule.find.mockReturnValue(sortableLeanQuery([]));

    await expect(assertScheduleRuleCompliance({
      candidateSchedules: [{ employee: 'emp1', date: new Date('2024-04-12'), shiftId: 'D' }],
    })).resolves.toEqual({ ok: true, violations: [] });
    expect(mockApprovalRequest.find).not.toHaveBeenCalled();
  });
});
