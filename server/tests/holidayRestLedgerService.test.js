// 國定假日休假紀錄：班表的「國」與國定假日的對應規則、有效假日清單、整月紀錄與匯入提醒。
import { jest } from '@jest/globals';
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js';

const chain = (rows) => {
  const query = {
    select: jest.fn(() => query),
    populate: jest.fn(() => query),
    lean: jest.fn(async () => rows),
  };
  return query;
};

const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockEmployee = { find: jest.fn() };
const mockHolidayRestResolution = { find: jest.fn() };
const mockLoadApprovedLeaveIntervals = jest.fn();

jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/HolidayRestResolution.js', () => ({ default: mockHolidayRestResolution }));
jest.unstable_mockModule('../src/services/approvedLeaveCalendarService.js', () => ({
  loadApprovedLeaveIntervals: mockLoadApprovedLeaveIntervals,
}));
// 假別規則（建立調休額度時讀每筆的時數）：沒有存過設定，用預設值
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: async () => ({}) }));
// 國定假日判斷（holidayResolver）用到的年度行事曆、調休存摺、個人調移：沒有替身 mongoose 會一直等連線
const resolverMocks = await registerHolidayResolverModelMocks(jest);

const {
  assignHolidayRests,
  buildHolidayRestLedger,
  buildImportHolidayWarnings,
  buildShiftSemanticLookup,
  buildTenureCheck,
  describeLedgerItem,
  parseLedgerMonth,
} = await import('../src/services/holidayRestLedgerService.js');
const {
  buildCountedHolidayDays,
  buildEffectiveMonthHolidays,
} = await import('../src/services/countedHolidayService.js');
const { createHolidayContext } = await import('../src/services/holidayResolver.js');

const utc = (key) => new Date(`${key}T00:00:00.000Z`);
// 台灣時間的時間點（毫秒）；請假區間的格式與 loadApprovedLeaveIntervals 相同（整天的假是台灣當天 00:00 到最後一天隔天 00:00）
const taipei = (key, time = '00:00') => Date.parse(`${key}T${time}:00+08:00`);
const hoursLeave = (key, from, to, extra = {}) => ({ startMs: taipei(key, from), endMs: taipei(key, to), allDay: false, leaveType: '事假', ...extra });
const allDayLeave = (key, lastKey = key) => ({ startMs: taipei(key), endMs: taipei(lastKey) + 24 * 60 * 60 * 1000, allDay: true, leaveType: '特休' });
const holidayDoc = (key, name, extra = {}) => ({ date: utc(key), name, type: '國定假日', ...extra });
const H25 = { id: '2026-09-25', name: '中秋節', date: '2026-09-25', originalDate: '2026-09-25', movedFrom: null };
const H28 = { id: '2026-09-28', name: '教師節', date: '2026-09-28', originalDate: '2026-09-28', movedFrom: null };

// 以 {日期: 狀態} 表示員工當月的班表狀態
const kindsOf = (map) => (key) => map[key] || 'none';
const summarize = (result, holidays) => holidays.map((holiday) => {
  const item = result.items.get(holiday.id);
  return [holiday.id.slice(5), item.status, item.guoDate ? item.guoDate.slice(5) : null, item.reason];
});

describe('assignHolidayRests', () => {
  it('1. a 國 on the holiday date is rested on date', () => {
    const result = assignHolidayRests({ holidays: [H25], guoDates: ['2026-09-25'], dayKindOf: kindsOf({ '2026-09-25': 'holiday' }) });
    expect(summarize(result, [H25])).toEqual([['09-25', 'rested_on_date', '09-25', null]]);
    expect(result.extraGuoDates).toEqual([]);
    expect(result.items.get(H25.id).offsetDays).toBeNull();
  });

  it('2. two holidays with 國 on other days: the earliest 國 goes to the earliest holiday, with the moved date and signed offset', () => {
    const result = assignHolidayRests({
      holidays: [H25, H28],
      guoDates: ['2026-09-27', '2026-09-20'],
      dayKindOf: kindsOf({ '2026-09-25': 'work', '2026-09-28': 'work' }),
    });
    expect(summarize(result, [H25, H28])).toEqual([
      ['09-25', 'moved', '09-20', null],
      ['09-28', 'moved', '09-27', null],
    ]);
    expect(result.items.get(H25.id).offsetDays).toBe(-5);
    expect(result.items.get(H28.id).offsetDays).toBe(-1);
  });

  it('3. one 國, one holiday already on a rest day and one worked: the worked holiday gets the 國, the rest-day one is informational', () => {
    const result = assignHolidayRests({
      holidays: [H25, H28],
      guoDates: ['2026-09-27'],
      dayKindOf: kindsOf({ '2026-09-25': 'rest_day', '2026-09-28': 'work' }),
    });
    expect(summarize(result, [H25, H28])).toEqual([
      ['09-25', 'not_taken', null, 'on_rest_day'],
      ['09-28', 'moved', '09-27', null],
    ]);
  });

  it('4. two 國 for one holiday: the earliest is used and the other is an extra 國', () => {
    const result = assignHolidayRests({
      holidays: [H25],
      guoDates: ['2026-09-26', '2026-09-24'],
      dayKindOf: kindsOf({ '2026-09-25': 'work' }),
    });
    expect(summarize(result, [H25])).toEqual([['09-25', 'moved', '09-24', null]]);
    expect(result.extraGuoDates).toEqual(['2026-09-26']);
  });

  it('5. a company-moved holiday: the 國 kept on the original date counts as moved there, and the other 國 serves the other holiday', () => {
    const moved = { ...H25, id: '2026-09-25', date: '2026-09-24', movedFrom: '2026-09-25' };
    const result = assignHolidayRests({
      holidays: [moved, H28],
      guoDates: ['2026-09-25', '2026-09-20'],
      dayKindOf: kindsOf({ '2026-09-24': 'work', '2026-09-28': 'work' }),
    });
    expect(summarize(result, [moved, H28])).toEqual([
      ['09-25', 'moved', '09-25', null],
      ['09-28', 'moved', '09-20', null],
    ]);
    expect(result.items.get(moved.id).offsetDays).toBe(1);
  });

  it('5b. a 國 on the company-moved target date is rested on date', () => {
    const moved = { ...H25, date: '2026-09-24', movedFrom: '2026-09-25' };
    const result = assignHolidayRests({ holidays: [moved], guoDates: ['2026-09-24'], dayKindOf: kindsOf({}) });
    expect(summarize(result, [moved])).toEqual([['09-25', 'rested_on_date', '09-24', null]]);
  });

  it('6. a holiday before the hire date is not applicable and does not eat a 國', () => {
    const result = assignHolidayRests({
      holidays: [H25, H28],
      guoDates: ['2026-09-29'],
      dayKindOf: kindsOf({ '2026-09-28': 'work' }),
      tenureNaReason: (holiday) => (holiday.date < '2026-09-26' ? 'before_hire' : null),
    });
    expect(summarize(result, [H25, H28])).toEqual([
      ['09-25', 'na', null, 'before_hire'],
      ['09-28', 'moved', '09-29', null],
    ]);
    expect(result.extraGuoDates).toEqual([]);
  });

  it('7. no schedule at all: not taken because unscheduled', () => {
    const result = assignHolidayRests({ holidays: [H25], guoDates: [], dayKindOf: kindsOf({}) });
    expect(summarize(result, [H25])).toEqual([['09-25', 'not_taken', null, 'unscheduled']]);
  });

  it('8. two holidays on the same effective date with one 國: one rested on date, one not taken because the date is shared', () => {
    const a = { id: '2026-09-24', name: 'A', date: '2026-09-24', originalDate: '2026-09-24', movedFrom: null };
    const b = { id: '2026-09-25', name: 'B', date: '2026-09-24', originalDate: '2026-09-25', movedFrom: '2026-09-25' };
    const result = assignHolidayRests({ holidays: [a, b], guoDates: ['2026-09-24'], dayKindOf: kindsOf({ '2026-09-24': 'holiday' }) });
    expect(summarize(result, [a, b])).toEqual([
      ['09-24', 'rested_on_date', '09-24', null],
      ['09-25', 'not_taken', null, 'shared_date'],
    ]);
  });

  it('9. duplicate 國 dates are counted once', () => {
    const result = assignHolidayRests({ holidays: [H25], guoDates: ['2026-09-25', '2026-09-25'], dayKindOf: kindsOf({}) });
    expect(summarize(result, [H25])).toEqual([['09-25', 'rested_on_date', '09-25', null]]);
    expect(result.extraGuoDates).toEqual([]);
  });

  it('10. a resigned employee: the later holiday is not applicable, the earlier worked holiday is not taken', () => {
    const result = assignHolidayRests({
      holidays: [H25, H28],
      guoDates: [],
      dayKindOf: kindsOf({ '2026-09-25': 'work' }),
      tenureNaReason: (holiday) => (holiday.date > '2026-09-26' ? 'after_resignation' : null),
    });
    expect(summarize(result, [H25, H28])).toEqual([
      ['09-25', 'not_taken', null, 'worked'],
      ['09-28', 'na', null, 'after_resignation'],
    ]);
  });

  it('11. every kind of non-working day gets its own reason, including approved leave', () => {
    const holidays = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].map((key) => ({ id: key, name: key, date: key, originalDate: key, movedFrom: null }));
    const result = assignHolidayRests({
      holidays,
      guoDates: [],
      dayKindOf: kindsOf({ '2026-09-21': 'rest_day', '2026-09-22': 'regular_rest', '2026-09-23': 'leave', '2026-09-24': 'work' }),
    });
    expect(holidays.map((holiday) => result.items.get(holiday.id).reason)).toEqual(['on_rest_day', 'on_regular_rest', 'on_leave', 'worked']);
  });

  it('12. offsetDays is the signed day difference between the 國 and the holiday date', () => {
    const later = assignHolidayRests({ holidays: [H25], guoDates: ['2026-09-30'], dayKindOf: kindsOf({ '2026-09-25': 'work' }) });
    const earlier = assignHolidayRests({ holidays: [H25], guoDates: ['2026-09-01'], dayKindOf: kindsOf({ '2026-09-25': 'work' }) });
    expect(later.items.get(H25.id).offsetDays).toBe(5);
    expect(earlier.items.get(H25.id).offsetDays).toBe(-24);
  });

  it('keeps the totals exact whatever the pairing: entitled holidays = rested + moved + not taken', () => {
    const holidays = [H25, H28];
    const result = assignHolidayRests({ holidays, guoDates: ['2026-09-03', '2026-09-10', '2026-09-17'], dayKindOf: kindsOf({}) });
    const statuses = holidays.map((holiday) => result.items.get(holiday.id).status);
    expect(statuses).toEqual(['moved', 'moved']);
    expect(result.extraGuoDates).toEqual(['2026-09-17']);
  });
});

describe('buildEffectiveMonthHolidays', () => {
  const docs = [
    holidayDoc('2026-09-25', '中秋節'),
    holidayDoc('2026-09-28', '教師節'),
    holidayDoc('2026-09-12', '補班日', { type: '補班日' }),
    holidayDoc('2026-10-10', '國慶日'),
  ];

  it('lists only the counted holidays of the month, sorted, with no move', () => {
    const list = buildEffectiveMonthHolidays({ holidays: docs, moves: [], month: '2026-09' });
    expect(list.map((holiday) => [holiday.id, holiday.name, holiday.date, holiday.movedFrom])).toEqual([
      ['2026-09-25', '中秋節', '2026-09-25', null],
      ['2026-09-28', '教師節', '2026-09-28', null],
    ]);
  });

  it('agrees with buildCountedHolidayDays for ordinary data, with and without a company move', () => {
    const move = { enableHolidayMove: true, sourceDate: utc('2026-09-25'), targetDate: utc('2026-09-24') };
    for (const moves of [[], [move]]) {
      const effective = buildEffectiveMonthHolidays({ holidays: docs, moves, month: '2026-09' }).map((holiday) => holiday.date);
      const counted = [...buildCountedHolidayDays({
        holidays: docs,
        moves,
        start: utc('2026-09-01'),
        end: utc('2026-10-01'),
      })].filter((key) => key.startsWith('2026-09')).sort();
      expect(effective).toEqual(counted);
    }
  });

  it('moves a holiday to the target date and remembers the original date', () => {
    const move = { enableHolidayMove: true, sourceDate: utc('2026-09-25'), targetDate: utc('2026-09-24') };
    const list = buildEffectiveMonthHolidays({ holidays: docs, moves: [move], month: '2026-09' });
    expect(list[0]).toMatchObject({ id: '2026-09-25', originalDate: '2026-09-25', date: '2026-09-24', movedFrom: '2026-09-25' });
  });

  it('ignores a move whose source holiday does not exist, a disabled move and a cross-month move', () => {
    const moves = [
      { enableHolidayMove: true, sourceDate: utc('2026-09-26'), targetDate: utc('2026-09-24') },
      { enableHolidayMove: false, sourceDate: utc('2026-09-28'), targetDate: utc('2026-09-29') },
      { enableHolidayMove: true, sourceDate: utc('2026-09-25'), targetDate: utc('2026-10-02') },
    ];
    const list = buildEffectiveMonthHolidays({ holidays: docs, moves, month: '2026-09' });
    expect(list.map((holiday) => holiday.date)).toEqual(['2026-09-25', '2026-09-28']);
    expect(list.every((holiday) => holiday.movedFrom === null)).toBe(true);
  });

  it('keeps one holiday per date even when the calendar has duplicates', () => {
    const list = buildEffectiveMonthHolidays({
      holidays: [holidayDoc('2026-09-25', '中秋節'), holidayDoc('2026-09-25', '中秋節（重複）')],
      month: '2026-09',
    });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('中秋節');
  });

  it('returns nothing for an invalid month', () => {
    expect(buildEffectiveMonthHolidays({ holidays: docs, month: '2026-9' })).toEqual([]);
    expect(buildEffectiveMonthHolidays({ holidays: docs })).toEqual([]);
  });
});

describe('buildTenureCheck', () => {
  it('uses the Taipei hire date, so the hire day itself still counts', () => {
    // 台灣 9/26 00:00 = UTC 9/25 16:00
    const check = buildTenureCheck({ status: '正職員工', appointment: { hireDate: new Date('2026-09-25T16:00:00.000Z') } });
    expect(check('2026-09-25')).toBe('before_hire');
    expect(check('2026-09-26')).toBeNull();
  });

  it('applies the resignation date only to employees whose status is resigned', () => {
    const resigned = buildTenureCheck({ status: '離職員工', appointment: { resignationDate: new Date('2026-09-25T16:00:00.000Z') } });
    expect(resigned('2026-09-26')).toBeNull();
    expect(resigned('2026-09-27')).toBe('after_resignation');
    const rehired = buildTenureCheck({ status: '正職員工', appointment: { resignationDate: new Date('2026-01-31T16:00:00.000Z') } });
    expect(rehired('2026-09-27')).toBeNull();
  });

  it('falls back to the last scheduled day for a resigned employee without a date, and to the whole month without a schedule', () => {
    expect(buildTenureCheck({ status: '離職員工' }, { hasRows: true, lastScheduledKey: '2026-09-26' })('2026-09-28')).toBe('after_resignation');
    expect(buildTenureCheck({ status: '離職員工' }, { hasRows: true, lastScheduledKey: '2026-09-26' })('2026-09-25')).toBeNull();
    expect(buildTenureCheck({ status: '離職員工' }, { hasRows: false })('2026-09-25')).toBe('after_resignation');
  });

  it('treats unpaid leave without any schedule as not applicable for the whole month', () => {
    expect(buildTenureCheck({ status: '留職停薪' }, { hasRows: false })('2026-09-25')).toBe('leave_of_absence');
    expect(buildTenureCheck({ status: '留職停薪' }, { hasRows: true })('2026-09-25')).toBeNull();
  });
});

describe('buildHolidayRestLedger (September 2026)', () => {
  const SHIFTS = [
    { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
    { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
    { _id: 'guo', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
  ];
  const row = (employee, key, shiftId, state = 'draft') => ({ employee, date: utc(key), shiftId, state });
  const person = (id, extra = {}) => ({
    _id: id,
    employeeId: `N${id}`,
    name: `員工${id}`,
    title: '護理師',
    subDepartment: { name: '內科' },
    status: '正職員工',
    ...extra,
  });
  const AFTER_MONTH = new Date('2026-10-05T04:00:00.000Z');
  const DURING_MONTH = new Date('2026-09-10T04:00:00.000Z');

  beforeEach(() => {
    jest.resetAllMocks();
    mockHoliday.find.mockReturnValue(chain([holidayDoc('2026-09-25', '中秋節'), holidayDoc('2026-09-28', '教師節')]));
    mockHolidayMoveSetting.find.mockReturnValue(chain([]));
    mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: SHIFTS }));
    mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map());
    mockHolidayRestResolution.find.mockReturnValue(chain([]));
    mockEmployee.find.mockReturnValue(chain([]));
    mockShiftSchedule.find.mockReturnValue(chain([]));
  });

  function schedule(rows) {
    mockShiftSchedule.find.mockReturnValue(chain(rows));
  }

  it('records who rested on the date, who moved (and to when), who did not rest, who has extra 國 and who is not applicable', async () => {
    schedule([
      // A：9/25 當日休，9/28 移到 9/20
      row('A', '2026-09-25', 'guo'), row('A', '2026-09-20', 'guo'), row('A', '2026-09-28', 'day'),
      // C：兩個假日都沒休（9/25 上班、9/28 剛好休息日）
      row('C', '2026-09-25', 'day'), row('C', '2026-09-28', 'rest'),
      // D：9/26 到職
      row('D', '2026-09-28', 'guo'),
      // F：三個國
      row('F', '2026-09-25', 'guo'), row('F', '2026-09-28', 'guo'), row('F', '2026-09-30', 'guo'),
    ]);
    const employees = [
      person('A'),
      person('C'),
      person('D', { appointment: { hireDate: new Date('2026-09-25T16:00:00.000Z') } }),
      person('E', { partTime: true }),
      person('F'),
    ];

    const ledger = await buildHolidayRestLedger({ month: '2026-09', employees, today: AFTER_MONTH });

    expect(ledger.holidays.map((holiday) => [holiday.name, holiday.date])).toEqual([['中秋節', '2026-09-25'], ['教師節', '2026-09-28']]);
    const byId = Object.fromEntries(ledger.employees.map((entry) => [entry.employeeId, entry]));
    const brief = (id) => byId[id].items.map((item) => [item.holidayDate.slice(5), item.status, item.guoDate?.slice(5) ?? null, item.reason, item.needsAction]);

    expect(brief('A')).toEqual([['09-25', 'rested_on_date', '09-25', null, null], ['09-28', 'moved', '09-20', null, null]]);
    expect(byId.A).toMatchObject({ entitled: 2, rested: 1, moved: 1, notTaken: 0, open: 0, extraGuoDates: [] });
    // 9/28 剛好是 C 的休息日：依勞基法施行細則 §23-1 要另排補假，改成待處理的「待排補假」（以前只是提示）
    expect(brief('C')).toEqual([['09-25', 'not_taken', null, 'worked', 'resolve'], ['09-28', 'not_taken', null, 'on_rest_day', 'assign_compensation']]);
    expect(byId.C).toMatchObject({ entitled: 2, notTaken: 2, open: 2 });
    expect(brief('D')).toEqual([['09-25', 'na', null, 'before_hire', null], ['09-28', 'rested_on_date', '09-28', null, null]]);
    expect(byId.D.entitled).toBe(1);
    expect(byId.F).toMatchObject({ rested: 2, moved: 0, extraGuoDates: ['2026-09-30'] });
    // 兼職人員和一般員工一樣有紀錄，只是帶有 partTime 標示（沒排班，兩個假日都是未排班）；
    // 兼職不要求排班，「未排班」只是提示，不列入待處理（一般員工同樣情況是待處理）
    expect(byId.E).toMatchObject({ partTime: true, notTaken: 2, open: 0 });
    expect(brief('E').map((item) => item[3])).toEqual(['unscheduled', 'unscheduled']);
    expect(brief('E').map((item) => item[4])).toEqual([null, null]);
    expect(ledger.summary).toEqual({
      employees: 5, holidays: 2, entitled: 9, rested: 4, moved: 1, compensated: 0, notTaken: 4, open: 2, compensationOpen: 1, banked: 0, extra: 1, excluded: { notScheduled: 0 },
    });
    expect(byId.A).toMatchObject({ employeeNo: 'NA', name: '員工A', title: '護理師', subDepartmentName: '內科', partTime: false });
  });

  it('honours a company move: the holiday shows on the new date and a 國 there is rested on date', async () => {
    mockHolidayMoveSetting.find.mockReturnValue(chain([
      { enableHolidayMove: true, sourceDate: utc('2026-09-25'), targetDate: utc('2026-09-24') },
    ]));
    schedule([row('A', '2026-09-24', 'guo'), row('A', '2026-09-28', 'guo'), row('B', '2026-09-25', 'guo'), row('B', '2026-09-28', 'guo')]);

    const ledger = await buildHolidayRestLedger({ month: '2026-09', employees: [person('A'), person('B')], today: AFTER_MONTH });

    expect(ledger.holidays[0]).toMatchObject({ date: '2026-09-24', originalDate: '2026-09-25', movedFrom: '2026-09-25' });
    const a = ledger.employees.find((entry) => entry.employeeId === 'A');
    const b = ledger.employees.find((entry) => entry.employeeId === 'B');
    expect(a.items[0]).toMatchObject({ holidayId: 'statutory:2026-09-25', holidayDate: '2026-09-24', status: 'rested_on_date', guoDate: '2026-09-24' });
    // B 把國留在原本的 9/25：算移休（比公司挪移後的日期晚一天）
    expect(b.items[0]).toMatchObject({ status: 'moved', guoDate: '2026-09-25', offsetDays: 1 });
  });

  it('treats approved leave on the holiday as a leave reason, never an open item', async () => {
    mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map([['A', [allDayLeave('2026-09-25')]]]));
    schedule([row('A', '2026-09-28', 'guo')]);

    const ledger = await buildHolidayRestLedger({ month: '2026-09', employees: [person('A')], today: AFTER_MONTH });

    expect(ledger.employees[0].items[0]).toMatchObject({ status: 'not_taken', reason: 'on_leave', needsAction: null, dateKind: 'leave' });
    expect(ledger.employees[0].open).toBe(0);
  });

  it('marks a draft roster of a month that has not ended as provisional ("schedule it") instead of not taken', async () => {
    schedule([row('A', '2026-09-25', 'day', 'draft')]);
    const draft = await buildHolidayRestLedger({ month: '2026-09', employees: [person('A')], today: DURING_MONTH });
    expect(draft.employees[0].provisional).toBe(true);
    expect(draft.employees[0].items[0]).toMatchObject({ status: 'not_taken', reason: 'worked', needsAction: 'schedule' });

    schedule([row('A', '2026-09-25', 'day', 'finalized')]);
    const finalized = await buildHolidayRestLedger({ month: '2026-09', employees: [person('A')], today: DURING_MONTH });
    expect(finalized.employees[0].provisional).toBe(false);
    expect(finalized.employees[0].items[0].needsAction).toBe('resolve');

    schedule([row('A', '2026-09-25', 'day', 'draft')]);
    const ended = await buildHolidayRestLedger({ month: '2026-09', employees: [person('A')], today: AFTER_MONTH });
    expect(ended.employees[0].provisional).toBe(false);
    expect(ended.employees[0].items[0].needsAction).toBe('resolve');
  });

  it('attaches the recorded resolution to a not-taken holiday and then stops calling it open', async () => {
    schedule([row('C', '2026-09-28', 'rest')]);
    mockHolidayRestResolution.find.mockReturnValue(chain([{
      _id: 'r1',
      employee: 'C',
      holidayDate: utc('2026-09-25'),
      month: '2026-09',
      kind: 'compensatory_leave',
      compensatoryHours: 8,
      note: '改補休',
      resolvedBy: 'boss',
      updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    }]));
    mockEmployee.find.mockReturnValue(chain([{ _id: 'boss', name: '主管王' }]));

    const ledger = await buildHolidayRestLedger({ month: '2026-09', employees: [person('C')], today: AFTER_MONTH });

    const item = ledger.employees[0].items[0];
    expect(item.status).toBe('not_taken');
    expect(item.needsAction).toBeNull();
    expect(item.resolution).toMatchObject({ id: 'r1', kind: 'compensatory_leave', compensatoryHours: 8, note: '改補休', resolvedByName: '主管王' });
    // 9/25 已登記不再算待處理；9/28 剛好是休息日，要排補假（以前休息日只是提示，所以原本是 0）
    expect(ledger.employees[0].items[1]).toMatchObject({ reason: 'on_rest_day', needsAction: 'assign_compensation' });
    expect(ledger.employees[0].open).toBe(1);
    expect(describeLedgerItem(item)).toBe('未休（補休）');
  });

  it('flags a recorded resolution as a conflict, instead of hiding it, once the roster gains a 國 for that holiday', async () => {
    schedule([row('C', '2026-09-20', 'guo')]);
    mockHolidayRestResolution.find.mockReturnValue(chain([{
      _id: 'r1', employee: 'C', holidayDate: utc('2026-09-25'), month: '2026-09', kind: 'paid', resolvedBy: 'boss', createdBy: 'first',
    }]));
    mockEmployee.find.mockReturnValue(chain([{ _id: 'boss', name: '主管王' }, { _id: 'first', name: '人資李' }]));

    const ledger = await buildHolidayRestLedger({ month: '2026-09', employees: [person('C')], today: AFTER_MONTH });

    const [moved, notTaken] = ledger.employees[0].items;
    expect(moved).toMatchObject({
      status: 'moved',
      guoDate: '2026-09-20',
      needsAction: null,
      resolutionConflict: true,
      resolution: { id: 'r1', kind: 'paid', resolvedByName: '主管王', createdByName: '人資李' },
    });
    // 沒有登記過的、以及仍然沒休的項目不受影響
    expect(notTaken).toMatchObject({ status: 'not_taken', resolution: null, resolutionConflict: false });
    // 要人確認的衝突算在待處理裡（否則「待處理」篩選會漏掉）
    expect(ledger.employees[0]).toMatchObject({ moved: 1, notTaken: 1, open: 2 });
    expect(ledger.summary.open).toBe(2);
    expect(describeLedgerItem(moved)).toBe('移休 09/20（已登記處理，請確認）');
    expect(describeLedgerItem({ ...moved, status: 'rested_on_date' })).toBe('當日休（已登記處理，請確認）');
  });

  it('flags a recorded resolution when the 國 is on the holiday date too, and keeps a plain stored resolution of a still-open holiday as before', async () => {
    schedule([row('C', '2026-09-25', 'guo'), row('D', '2026-09-28', 'rest')]);
    mockHolidayRestResolution.find.mockReturnValue(chain([
      { _id: 'r1', employee: 'C', holidayDate: utc('2026-09-25'), month: '2026-09', kind: 'waived', note: '放棄', resolvedBy: 'boss' },
      { _id: 'r2', employee: 'D', holidayDate: utc('2026-09-25'), month: '2026-09', kind: 'paid', resolvedBy: 'boss' },
    ]));

    const ledger = await buildHolidayRestLedger({ month: '2026-09', employees: [person('C'), person('D')], today: AFTER_MONTH });

    const c = ledger.employees.find((entry) => entry.employeeId === 'C');
    const d = ledger.employees.find((entry) => entry.employeeId === 'D');
    expect(c.items[0]).toMatchObject({ status: 'rested_on_date', resolutionConflict: true, resolution: { id: 'r1', kind: 'waived' } });
    expect(d.items[0]).toMatchObject({ status: 'not_taken', resolutionConflict: false, resolution: { id: 'r2' }, needsAction: null });
    // 登記過的 9/25 不算待處理；9/28 落在休息日要排補假（以前休息日只是提示）
    expect(d.items[1]).toMatchObject({ reason: 'on_rest_day', needsAction: 'assign_compensation' });
    expect(d.open).toBe(1);
  });

  it('leaves out resigned, unpaid-leave and no-scheduling employees who have no schedule, but keeps them when they do', async () => {
    schedule([row('R', '2026-09-25', 'day'), row('N', '2026-09-25', 'day')]);
    const employees = [
      person('R', { status: '離職員工', appointment: { resignationDate: new Date('2026-09-26T04:00:00.000Z') } }),
      person('L', { status: '留職停薪' }),
      person('O', { status: '離職員工' }),
      person('N', { requiresScheduling: false }),
      person('S', { requiresScheduling: false }),
    ];

    const ledger = await buildHolidayRestLedger({ month: '2026-09', employees, today: AFTER_MONTH });

    expect(ledger.employees.map((entry) => entry.employeeId).sort()).toEqual(['N', 'R']);
    expect(ledger.summary.excluded.notScheduled).toBe(3);
    const resigned = ledger.employees.find((entry) => entry.employeeId === 'R');
    expect(resigned.items.map((item) => [item.status, item.reason])).toEqual([['not_taken', 'worked'], ['na', 'after_resignation']]);
  });

  describe('part-day (hourly) approved leave', () => {
    const NIGHT = { _id: 'night', code: '夜', name: '夜班', semanticType: 'work', startTime: '22:00', endTime: '06:00' };
    const DAY_BREAK = { _id: 'dayBreak', code: '日休', name: '日班含休息', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60 };

    // A 在中秋節（9/25）排日班、教師節（9/28）休息日，核准的請假由 intervals 指定
    async function ledgerWithLeave(intervals, rows = [row('A', '2026-09-25', 'day'), row('A', '2026-09-28', 'rest')]) {
      mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: [...SHIFTS, NIGHT, DAY_BREAK] }));
      mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map([['A', intervals]]));
      schedule(rows);
      const ledger = await buildHolidayRestLedger({ month: '2026-09', employees: [person('A')], today: AFTER_MONTH });
      return ledger.employees[0];
    }
    const itemOn925 = (entry) => entry.items[0];

    it('keeps a worked holiday open when the leave on that day is only 2 hours', async () => {
      const withLeave = await ledgerWithLeave([hoursLeave('2026-09-25', '09:00', '11:00')]);
      const without = await ledgerWithLeave([]);

      expect(itemOn925(withLeave)).toMatchObject({ status: 'not_taken', reason: 'worked', needsAction: 'resolve', dateKind: 'work' });
      // 另外 9/28 是休息日、要排補假（以前休息日只是提示，所以原本是 1）
      expect(withLeave.open).toBe(2);
      expect(itemOn925(without)).toMatchObject({ reason: 'worked', needsAction: 'resolve' });
    });

    it('treats a full-day leave as leave even when the roster still shows a work shift', async () => {
      const entry = await ledgerWithLeave([allDayLeave('2026-09-25')]);

      expect(itemOn925(entry)).toMatchObject({ status: 'not_taken', reason: 'on_leave', needsAction: null, dateKind: 'leave' });
      // 請假的 9/25 不是待處理；剩下的 1 件是 9/28 休息日要排補假（以前休息日只是提示，所以原本是 0）
      expect(entry.items[1]).toMatchObject({ reason: 'on_rest_day', needsAction: 'assign_compensation' });
      expect(entry.open).toBe(1);
    });

    it('treats a multi-day full leave that spans the holiday as leave', async () => {
      const entry = await ledgerWithLeave([allDayLeave('2026-09-24', '2026-09-26')]);
      expect(itemOn925(entry)).toMatchObject({ reason: 'on_leave', needsAction: null });
    });

    it('treats a leave that covers the whole shift as leave, also when it comes from several requests', async () => {
      const whole = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '17:00')]);
      expect(itemOn925(whole)).toMatchObject({ reason: 'on_leave', needsAction: null, dateKind: 'leave' });

      const morningAndAfternoon = await ledgerWithLeave([hoursLeave('2026-09-25', '12:00', '17:00'), hoursLeave('2026-09-25', '08:00', '12:00')]);
      expect(itemOn925(morningAndAfternoon)).toMatchObject({ reason: 'on_leave' });

      const overlapping = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '13:00'), hoursLeave('2026-09-25', '11:00', '18:00')]);
      expect(itemOn925(overlapping)).toMatchObject({ reason: 'on_leave' });
    });

    it('does not count a leave that leaves part of the shift uncovered', async () => {
      const gap = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '12:00'), hoursLeave('2026-09-25', '13:00', '17:00')]);
      expect(itemOn925(gap)).toMatchObject({ reason: 'worked', needsAction: 'resolve' });

      const afterWork = await ledgerWithLeave([hoursLeave('2026-09-25', '18:00', '20:00')]);
      expect(itemOn925(afterWork)).toMatchObject({ reason: 'worked' });
    });

    it('lets the unpaid break of the shift stay outside the leave', async () => {
      const rows = [row('A', '2026-09-25', 'dayBreak'), row('A', '2026-09-28', 'rest')];
      // 日班 08:00-17:00 含 60 分鐘休息：請 8 小時（08:00-16:00，或兩段中間空出休息時間）算整班請假
      const eightHours = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '16:00')], rows);
      expect(itemOn925(eightHours)).toMatchObject({ reason: 'on_leave' });
      const aroundBreak = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '12:00'), hoursLeave('2026-09-25', '13:00', '17:00')], rows);
      expect(itemOn925(aroundBreak)).toMatchObject({ reason: 'on_leave' });
      const sevenHours = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '15:00')], rows);
      expect(itemOn925(sevenHours)).toMatchObject({ reason: 'worked' });
      // 沒設定休息時間的班別，同樣的 8 小時不算整班
      const noBreak = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '16:00')]);
      expect(itemOn925(noBreak)).toMatchObject({ reason: 'worked' });
    });

    it('follows a night shift across midnight', async () => {
      const rows = [row('A', '2026-09-25', 'night'), row('A', '2026-09-28', 'rest')];
      const wholeShift = { startMs: taipei('2026-09-25', '22:00'), endMs: taipei('2026-09-26', '06:00'), allDay: false, leaveType: '事假' };
      const whole = await ledgerWithLeave([wholeShift], rows);
      expect(itemOn925(whole)).toMatchObject({ reason: 'on_leave' });
      const half = await ledgerWithLeave([hoursLeave('2026-09-25', '22:00', '23:59')], rows);
      expect(itemOn925(half)).toMatchObject({ reason: 'worked' });
    });

    it('counts a leave of any length as leave when nothing is scheduled that day, and lets the roster decide on non-working days', async () => {
      const unscheduled = await ledgerWithLeave([hoursLeave('2026-09-25', '09:00', '11:00')], [row('A', '2026-09-28', 'rest')]);
      expect(itemOn925(unscheduled)).toMatchObject({ reason: 'on_leave', needsAction: null, dateKind: 'leave' });

      const restDay = await ledgerWithLeave([hoursLeave('2026-09-25', '09:00', '11:00')], [row('A', '2026-09-25', 'rest'), row('A', '2026-09-28', 'rest')]);
      expect(itemOn925(restDay)).toMatchObject({ reason: 'on_rest_day', dateKind: 'rest_day' });
    });

    it('does not guess when the scheduled shift is unknown: a part-day leave then does not hide the holiday', async () => {
      const entry = await ledgerWithLeave([hoursLeave('2026-09-25', '08:00', '17:00')], [row('A', '2026-09-25', 'ghost'), row('A', '2026-09-28', 'rest')]);
      expect(itemOn925(entry)).toMatchObject({ reason: 'worked', needsAction: 'resolve' });
    });

    it('gives the 國 to the holiday that was really worked (only a 2-hour leave) before the one on a rest day', async () => {
      // 一個國排在 9/20：9/28 上班只請了 2 小時的假（需要國），9/25 是休息日（不需要國）
      const entry = await ledgerWithLeave(
        [hoursLeave('2026-09-28', '09:00', '11:00')],
        [row('A', '2026-09-20', 'guo'), row('A', '2026-09-25', 'rest'), row('A', '2026-09-28', 'day')],
      );
      expect(entry.items.map((item) => [item.holidayDate.slice(5), item.status, item.guoDate?.slice(5) ?? null, item.reason])).toEqual([
        ['09-25', 'not_taken', null, 'on_rest_day'],
        ['09-28', 'moved', '09-20', null],
      ]);
    });
  });

  describe('people who are not expected on a roster', () => {
    it('does not make "unscheduled" an open item for part-time staff, but still does when they worked the holiday', async () => {
      schedule([row('P', '2026-09-25', 'day', 'finalized'), row('F', '2026-09-25', 'day', 'finalized')]);
      const ledger = await buildHolidayRestLedger({
        month: '2026-09',
        employees: [person('P', { partTime: true }), person('F')],
        today: AFTER_MONTH,
      });

      const part = ledger.employees.find((entry) => entry.employeeId === 'P');
      const full = ledger.employees.find((entry) => entry.employeeId === 'F');
      // 中秋節上班、教師節沒排班
      expect(part.items.map((item) => [item.reason, item.needsAction])).toEqual([['worked', 'resolve'], ['unscheduled', null]]);
      expect(full.items.map((item) => [item.reason, item.needsAction])).toEqual([['worked', 'resolve'], ['unscheduled', 'resolve']]);
      expect(part).toMatchObject({ notTaken: 2, open: 1, partTime: true });
      expect(full.open).toBe(2);
      expect(describeLedgerItem(part.items[1])).toBe('未休（未排班）');
    });

    describe('administrator and supervisor accounts without any roster', () => {
      const rosterRows = (rows) => mockShiftSchedule.find.mockImplementation((query) => chain(rows.filter((entry) => (
        query.employee.$in.includes(entry.employee) && entry.date >= query.date.$gte && entry.date < query.date.$lt
      ))));
      const idsOf = (ledger) => ledger.employees.map((entry) => entry.employeeId).sort();

      it('leaves them out when they have had no roster for the last three months, and keeps them once they had one', async () => {
        rosterRows([
          row('N', '2026-09-25', 'day'),
          row('SEPT', '2026-09-25', 'day'),
          row('ADMIN_JULY', '2026-07-01', 'day'),
          row('SUP_AUG', '2026-08-31', 'day'),
          row('ADMIN_JUNE', '2026-06-30', 'day'),
        ]);
        const employees = [
          person('N'),
          person('SEPT', { role: 'supervisor' }),
          person('ADMIN_NEVER', { role: 'admin' }),
          person('SUP_NEVER', { role: 'supervisor' }),
          person('ADMIN_JULY', { role: 'admin' }),
          person('SUP_AUG', { role: 'supervisor' }),
          person('ADMIN_JUNE', { role: 'admin' }),
          person('NURSE_NONE', { role: 'employee' }),
          person('NO_ROLE'),
        ];

        const ledger = await buildHolidayRestLedger({ month: '2026-09', employees, today: AFTER_MONTH });

        // 本月有班表的、前兩個月（7、8 月）排過的照常列入；一直沒排過（含只在 6 月排過）的管理員、主管不列入；
        // 一般員工與沒有帶 role 的員工沒排班照樣是「未排班」
        expect(idsOf(ledger)).toEqual(['N', 'NURSE_NONE', 'NO_ROLE', 'SEPT', 'SUP_AUG', 'ADMIN_JULY'].sort());
        expect(ledger.summary.excluded.notScheduled).toBe(3);
        const nurse = ledger.employees.find((entry) => entry.employeeId === 'NURSE_NONE');
        expect(nurse).toMatchObject({ notTaken: 2, open: 2 });
        // 只多查一次前面幾個月的班表，而且只查本月沒有班表的管理員、主管
        expect(mockShiftSchedule.find).toHaveBeenCalledTimes(2);
        const lookup = mockShiftSchedule.find.mock.calls[1][0];
        expect([...lookup.employee.$in].sort()).toEqual(['ADMIN_JULY', 'ADMIN_JUNE', 'ADMIN_NEVER', 'SUP_AUG', 'SUP_NEVER']);
        expect(lookup.date.$gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
        expect(lookup.date.$lt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      });

      it('does not look further back when nobody qualifies, and skips accounts flagged as not requiring a schedule without another query', async () => {
        rosterRows([]);
        const none = await buildHolidayRestLedger({ month: '2026-09', employees: [person('A'), person('B', { role: 'employee' })], today: AFTER_MONTH });
        expect(none.employees).toHaveLength(2);
        expect(mockShiftSchedule.find).toHaveBeenCalledTimes(1);

        // requiresScheduling = false 的帳號在本月沒有班表時本來就不列入，不必再查前面的月份
        mockShiftSchedule.find.mockClear();
        const flagged = await buildHolidayRestLedger({
          month: '2026-09',
          employees: [person('X', { role: 'admin', requiresScheduling: false }), person('Y', { role: 'admin' })],
          today: AFTER_MONTH,
        });
        expect(flagged.employees).toEqual([]);
        expect(flagged.summary.excluded.notScheduled).toBe(2);
        expect(mockShiftSchedule.find.mock.calls[1][0].employee.$in).toEqual(['Y']);
      });

      it('looks back across a year boundary', async () => {
        mockHoliday.find.mockReturnValue(chain([holidayDoc('2026-01-01', '元旦')]));
        rosterRows([row('SUP', '2025-12-02', 'day')]);
        const ledger = await buildHolidayRestLedger({
          month: '2026-01',
          employees: [person('SUP', { role: 'supervisor' }), person('ADM', { role: 'admin' })],
          today: new Date('2026-02-05T04:00:00.000Z'),
        });
        expect(idsOf(ledger)).toEqual(['SUP']);
        expect(mockShiftSchedule.find.mock.calls[1][0].date.$gte.toISOString()).toBe('2025-11-01T00:00:00.000Z');
      });
    });
  });

  it('returns an empty ledger without touching the roster when the month has no national holiday', async () => {
    mockHoliday.find.mockReturnValue(chain([holidayDoc('2026-08-05', '補班日', { type: '補班日' })]));

    const ledger = await buildHolidayRestLedger({ month: '2026-08', employees: [person('A')], today: AFTER_MONTH });

    expect(ledger).toMatchObject({ holidays: [], employees: [] });
    expect(mockShiftSchedule.find).not.toHaveBeenCalled();
    // 公司挪移設定現在由 holidayResolver 和行事曆一起讀（每次固定一次查詢，挪移可以跨月），以前沒有國定假日時不讀
    expect(mockHolidayMoveSetting.find).toHaveBeenCalledTimes(1);
  });

  it('uses preloaded holidays and moves without querying again, and rejects an invalid month', async () => {
    schedule([row('A', '2026-09-25', 'guo')]);
    const ledger = await buildHolidayRestLedger({
      month: '2026-09',
      employees: [person('A')],
      today: AFTER_MONTH,
      holidayDocs: [holidayDoc('2026-09-25', '中秋節')],
      moves: [],
    });
    expect(ledger.employees[0].rested).toBe(1);
    expect(mockHoliday.find).not.toHaveBeenCalled();
    expect(mockHolidayMoveSetting.find).not.toHaveBeenCalled();
    await expect(buildHolidayRestLedger({ month: '2026-13', employees: [] })).rejects.toThrow('invalid month');
  });

  it('queries the roster once for all employees, however many there are', async () => {
    schedule([]);
    await buildHolidayRestLedger({ month: '2026-09', employees: [person('A'), person('B'), person('C')], today: AFTER_MONTH });
    expect(mockShiftSchedule.find).toHaveBeenCalledTimes(1);
    expect(mockLoadApprovedLeaveIntervals).toHaveBeenCalledTimes(1);
    expect(mockShiftSchedule.find.mock.calls[0][0].employee.$in).toEqual(['A', 'B', 'C']);
  });
});

describe('describeLedgerItem', () => {
  it('describes each state in plain Chinese', () => {
    expect(describeLedgerItem({ status: 'rested_on_date' })).toBe('當日休');
    expect(describeLedgerItem({ status: 'moved', guoDate: '2026-09-20' })).toBe('移休 09/20');
    expect(describeLedgerItem({ status: 'na' })).toBe('—');
    expect(describeLedgerItem({ status: 'not_taken', reason: 'worked', needsAction: 'resolve' })).toBe('未休（上班）');
    expect(describeLedgerItem({ status: 'not_taken', reason: 'unscheduled', needsAction: 'resolve' })).toBe('未休（未排班）');
    expect(describeLedgerItem({ status: 'not_taken', reason: 'worked', needsAction: 'schedule' })).toBe('尚未排國');
    expect(describeLedgerItem({ status: 'not_taken', reason: 'on_rest_day', needsAction: null })).toBe('適逢休息日');
    expect(describeLedgerItem({ status: 'not_taken', reason: 'on_regular_rest', needsAction: null })).toBe('適逢例假');
    expect(describeLedgerItem({ status: 'not_taken', reason: 'on_leave', needsAction: null })).toBe('適逢請假');
    expect(describeLedgerItem(undefined)).toBe('');
  });
});

describe('helpers', () => {
  it('parses a ledger month and rejects bad ones', () => {
    expect(parseLedgerMonth('2026-09')).toMatchObject({ month: '2026-09', lastKey: '2026-09-30' });
    expect(parseLedgerMonth('2026-02').lastKey).toBe('2026-02-28');
    expect(parseLedgerMonth('2026-9')).toBeNull();
    expect(parseLedgerMonth('')).toBeNull();
  });

  it('maps shift ids to semantic types, defaulting unknown ids to work in the callers', () => {
    const lookup = buildShiftSemanticLookup({ shifts: [{ _id: 'g', code: '國', semanticType: 'holiday' }, { _id: 'x', code: '日', startTime: '08:00', endTime: '17:00' }] });
    expect(lookup.get('g')).toBe('holiday');
    expect(lookup.get('x')).toBe('work');
    expect(lookup.get('missing')).toBeUndefined();
  });
});

describe('buildImportHolidayWarnings', () => {
  const holidays = [H25, H28];
  const cell = (key, day, rowNumber = 5) => ({ rowNumber, day, code: '國', dateKey: key });
  const state = (extra = {}) => ({
    id: 'e1',
    employee: { status: '正職員工' },
    rowNumber: 5,
    employeeCode: 'A001',
    cells: [],
    candidateKinds: new Map(),
    ...extra,
  });
  const SETTING = { shifts: [{ _id: 'guo', code: '國', semanticType: 'holiday' }, { _id: 'day', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00' }] };

  it('does not warn about a 國 moved to another day of the month', () => {
    const warnings = buildImportHolidayWarnings({
      holidays,
      states: [state({
        cells: [cell('2026-09-24', 24), cell('2026-09-27', 27)],
        candidateKinds: new Map([['2026-09-24', 'holiday'], ['2026-09-27', 'holiday']]),
      })],
      fullMonth: false,
    });
    expect(warnings).toEqual([]);
  });

  it('warns about every 國 beyond the number of national holidays, naming the calendar', () => {
    const warnings = buildImportHolidayWarnings({
      holidays: [H25],
      states: [state({
        cells: [cell('2026-09-10', 10), cell('2026-09-25', 25), cell('2026-09-30', 30)],
        candidateKinds: new Map([['2026-09-10', 'holiday'], ['2026-09-25', 'holiday'], ['2026-09-30', 'holiday']]),
      })],
      fullMonth: false,
    });
    // 9/25 剛好是國定假日當天；另外兩個國（9/10、9/30）超過 1 個國定假日
    expect(warnings.map((warning) => [warning.day, warning.code])).toEqual([[10, '國'], [30, '國']]);
    expect(warnings[0].message).toContain('假日日曆');
    expect(warnings[0].message).toContain('1 個國定假日');
  });

  it('keeps the old wording when the calendar has no national holiday at all', () => {
    const warnings = buildImportHolidayWarnings({
      holidays: [],
      states: [state({ cells: [cell('2026-09-02', 2)], candidateKinds: new Map([['2026-09-02', 'holiday']]) })],
      fullMonth: false,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('「國」為國定假日班別，但系統假日日曆沒有該日期的國定假日，請確認假日設定');
  });

  it('counts the 國 already in the roster (not overwritten by the file) when judging extras', () => {
    const warnings = buildImportHolidayWarnings({
      holidays: [H25],
      states: [state({ cells: [cell('2026-09-30', 30)], candidateKinds: new Map([['2026-09-30', 'holiday']]) })],
      existingSchedules: [{ employee: 'e1', date: utc('2026-09-25'), shiftId: 'guo' }],
      setting: SETTING,
      fullMonth: false,
    });
    expect(warnings.map((warning) => warning.day)).toEqual([30]);
  });

  it('adds one shortfall warning per employee only for a full-month file', () => {
    const kinds = new Map();
    for (let day = 1; day <= 30; day += 1) kinds.set(`2026-09-${String(day).padStart(2, '0')}`, 'work');
    kinds.set('2026-09-20', 'holiday');
    const input = {
      holidays,
      states: [state({ cells: [cell('2026-09-20', 20)], candidateKinds: kinds })],
    };

    const partial = buildImportHolidayWarnings({ ...input, fullMonth: false });
    expect(partial).toEqual([]);

    const full = buildImportHolidayWarnings({ ...input, fullMonth: true });
    expect(full).toHaveLength(1);
    expect(full[0]).toMatchObject({ row: 5, day: null, code: 'A001' });
    expect(full[0].message).toContain('本月 2 個國定假日只排了 1 個「國」');
    expect(full[0].message).toContain('教師節 09/28');
    expect(full[0].message).not.toContain('中秋節');
  });

  it('does not count a holiday that falls on a rest day, approved leave, or before the hire date as missing', () => {
    const kinds = new Map([['2026-09-25', 'rest_day'], ['2026-09-28', 'work']]);
    const leaveIntervals = new Map([['e1', [allDayLeave('2026-09-28')]]]);
    expect(buildImportHolidayWarnings({ holidays, states: [state({ candidateKinds: kinds })], leaveIntervals, fullMonth: true })).toEqual([]);

    const hired = state({
      employee: { status: '正職員工', appointment: { hireDate: new Date('2026-09-27T00:00:00.000Z') } },
      candidateKinds: new Map([['2026-09-28', 'holiday']]),
      cells: [cell('2026-09-28', 28)],
    });
    expect(buildImportHolidayWarnings({ holidays, states: [hired], fullMonth: true })).toEqual([]);
  });

  describe('part-day (hourly) approved leave', () => {
    const DAY = { _id: 'day', code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00' };
    const workDays = () => new Map([['2026-09-25', 'work'], ['2026-09-28', 'work']]);
    const dayShifts = () => new Map([['2026-09-25', DAY], ['2026-09-28', DAY]]);
    const shortfall = (leaveIntervals, extra = {}) => buildImportHolidayWarnings({
      holidays,
      states: [state({ candidateKinds: workDays(), candidateShifts: dayShifts(), ...extra })],
      leaveIntervals,
      setting: SETTING,
      fullMonth: true,
    }).map((warning) => warning.message);

    it('still warns about a worked holiday that only has a 2-hour leave, but not when the leave is a full day or covers the whole shift', () => {
      const messages = shortfall(new Map([['e1', [
        hoursLeave('2026-09-25', '09:00', '11:00'),
        allDayLeave('2026-09-28'),
      ]]]));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('中秋節 09/25');
      expect(messages[0]).not.toContain('教師節');

      const covering = shortfall(new Map([['e1', [hoursLeave('2026-09-25', '08:00', '17:00'), hoursLeave('2026-09-28', '08:00', '12:00'), hoursLeave('2026-09-28', '12:00', '17:00')]]]));
      expect(covering).toEqual([]);
    });

    it('judges the shift of a roster row the file does not overwrite by its shift hours too', () => {
      const existingSchedules = [
        { employee: 'e1', date: utc('2026-09-25'), shiftId: 'day' },
        { employee: 'e1', date: utc('2026-09-28'), shiftId: 'day' },
      ];
      const run = (intervals) => buildImportHolidayWarnings({
        holidays,
        states: [state()],
        existingSchedules,
        setting: SETTING,
        leaveIntervals: new Map([['e1', intervals]]),
        fullMonth: true,
      }).map((warning) => warning.message);

      const partial = run([hoursLeave('2026-09-25', '09:00', '11:00'), hoursLeave('2026-09-28', '08:00', '17:00')]);
      expect(partial).toHaveLength(1);
      expect(partial[0]).toContain('中秋節 09/25');
      expect(partial[0]).not.toContain('教師節');
    });

    it('treats a leave on a day the roster leaves empty as leave, whatever its length', () => {
      const [message] = shortfall(new Map([['e1', [hoursLeave('2026-09-25', '09:00', '11:00')]]]), {
        candidateKinds: new Map([['2026-09-28', 'work']]),
        candidateShifts: new Map([['2026-09-28', DAY]]),
      });
      expect(message).toContain('教師節 09/28');
      expect(message).not.toContain('中秋節');
    });
  });

  it('does not report an unscheduled holiday for part-time staff, but still reports a worked one', () => {
    const kinds = new Map([['2026-09-25', 'work']]);
    const shifts = new Map([['2026-09-25', SETTING.shifts[1]]]);
    const run = (employee) => buildImportHolidayWarnings({
      holidays,
      states: [state({ employee, candidateKinds: kinds, candidateShifts: shifts })],
      setting: SETTING,
      fullMonth: true,
    }).map((warning) => warning.message);

    const regular = run({ status: '正職員工' });
    expect(regular[0]).toContain('中秋節 09/25');
    expect(regular[0]).toContain('教師節 09/28');

    const partTime = run({ status: '正職員工', partTime: true });
    expect(partTime[0]).toContain('中秋節 09/25');
    expect(partTime[0]).not.toContain('教師節');
    expect(run({ status: '正職員工', partTime: true, appointment: { hireDate: new Date('2026-09-26T00:00:00.000Z') } })).toEqual([]);
  });
});

/* ------------- 依員工判斷的應休國定假日（2026 年行事曆：16 個國定假日 + 6 個公務機關補假日） ------------- */
describe('buildHolidayRestLedger with the per-employee holiday resolver (2026 calendar)', () => {
  const STATUTORY_2026 = [
    ['2026-01-01', '開國紀念日'], ['2026-02-15', '小年夜'], ['2026-02-16', '農曆除夕'], ['2026-02-17', '春節'],
    ['2026-02-18', '春節'], ['2026-02-19', '春節'], ['2026-02-28', '和平紀念日'], ['2026-04-04', '兒童節'],
    ['2026-04-05', '民族掃墓節'], ['2026-05-01', '勞動節'], ['2026-06-19', '端午節'], ['2026-09-25', '中秋節'],
    ['2026-09-28', '孔子誕辰紀念日/教師節'], ['2026-10-10', '國慶日'], ['2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'],
    ['2026-12-25', '行憲紀念日'],
  ];
  const GOVERNMENT_2026 = [
    ['2026-02-20', '2026-02-15', '小年夜'], ['2026-02-27', '2026-02-28', '和平紀念日'], ['2026-04-03', '2026-04-04', '兒童節'],
    ['2026-04-06', '2026-04-05', '民族掃墓節'], ['2026-10-09', '2026-10-10', '國慶日'], ['2026-10-26', '2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'],
  ];
  const rows2026 = () => [
    ...STATUTORY_2026.map(([key, name]) => ({ _id: `h${key}`, date: utc(key), name, kind: 'statutory', archived: false })),
    ...GOVERNMENT_2026.map(([key, link, linkName]) => ({
      _id: `g${key}`, date: utc(key), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc(link), compensatesName: linkName, archived: false,
    })),
  ];
  const SHIFTS = [
    { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
    { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
    { _id: 'off', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
    { _id: 'guo', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
  ];
  const row = (employee, key, shiftId, state = 'finalized') => ({ employee, date: utc(key), shiftId, state });
  const nurse = (id, extra = {}) => ({ _id: id, employeeId: `N${id}`, name: `護理${id}`, status: '正職員工', ...extra });
  const office = (id, extra = {}) => ({ _id: id, employeeId: `O${id}`, name: `行政${id}`, status: '正職員工', requiresScheduling: false, ...extra });
  const contextFor = (start, end, extra = {}) => createHolidayContext({
    start, end, rows: rows2026(), years: [{ year: 2026, state: 'approved' }], ...extra,
  });
  const brief = (entry) => entry.items.map((item) => [item.holidayDate.slice(5), item.status, item.needsAction]);

  beforeEach(() => {
    jest.resetAllMocks();
    mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: SHIFTS }));
    mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map());
    mockHolidayRestResolution.find.mockReturnValue(chain([]));
    mockEmployee.find.mockReturnValue(chain([]));
    mockShiftSchedule.find.mockReturnValue(chain([]));
  });

  it('gives a roster nurse the 6 statutory days of February 2026 (not 8): government make-up days are no columns', async () => {
    mockShiftSchedule.find.mockReturnValue(chain([
      ...['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19'].map((key) => row('A', key, 'guo')),
      row('A', '2026-02-20', 'day'), row('A', '2026-02-27', 'day'), row('A', '2026-02-28', 'rest'),
    ]));

    const ledger = await buildHolidayRestLedger({
      month: '2026-02', employees: [nurse('A')], today: new Date('2026-03-05T04:00:00.000Z'), holidayContext: contextFor('2026-02-01', '2026-03-01'),
    });

    expect(ledger.holidays.map((holiday) => holiday.date)).toEqual(['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28']);
    expect(ledger.holidays.every((holiday) => holiday.id.startsWith('statutory:') && holiday.personal === false)).toBe(true);
    const [a] = ledger.employees;
    expect(a).toMatchObject({ regime: 'roster', entitled: 6, rested: 5, compensated: 0, notTaken: 1, open: 1 });
    // 2/28 和平紀念日是 A 的休息日：要存入調休（還沒同步時是「待存入調休」），不是用公務機關的 2/27
    expect(a.items.at(-1)).toMatchObject({ holidayDate: '2026-02-28', status: 'not_taken', reason: 'on_rest_day', needsAction: 'assign_compensation', compensation: null });
    expect(describeLedgerItem(a.items.at(-1))).toBe('待存入調休');
    expect(ledger.summary).toMatchObject({ entitled: 6, compensationOpen: 1 });
    expect(ledger.calendar).toEqual({ year: 2026, state: 'approved', provisional: false });
  });

  it('counts 16 statutory days for a roster nurse over 2026, and 16 + 6 government make-up days off for office staff', async () => {
    const context = contextFor('2025-12-25', '2027-01-08');
    const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
    const totals = { nurse: { entitled: 0, rested: 0 }, office: { entitled: 0, rested: 0, compensated: 0 } };
    for (const month of months) {
      // 護理 A 每個國定假日當天都排「國」；行政 O 每月 2 日有一筆班表（才會列入），其餘依行事曆
      mockShiftSchedule.find.mockReturnValue(chain([
        ...STATUTORY_2026.filter(([key]) => key.startsWith(month)).map(([key]) => row('A', key, 'guo')),
        row('O', `${month}-02`, 'day'),
      ]));
      const ledger = await buildHolidayRestLedger({
        month, employees: [nurse('A'), office('O')], today: new Date('2027-01-05T04:00:00.000Z'), holidayContext: context,
      });
      const a = ledger.employees.find((entry) => entry.employeeId === 'A');
      const o = ledger.employees.find((entry) => entry.employeeId === 'O');
      totals.nurse.entitled += a?.entitled || 0;
      totals.nurse.rested += a?.rested || 0;
      totals.office.entitled += o?.entitled || 0;
      totals.office.rested += o?.rested || 0;
      totals.office.compensated += o?.compensated || 0;
    }
    expect(totals.nurse).toEqual({ entitled: 16, rested: 16 });
    // 行政人員：16 個國定假日都應休；落在週末的 6 個用公務機關補假日補（2/20、2/27、4/3、4/6、10/9、10/26），全年放假 22 天
    expect(totals.office).toEqual({ entitled: 16, rested: 10, compensated: 6 });
  });

  it('lets office staff without a roster rest by the calendar, uses the government make-up day for a weekend holiday, and leaves them out when nothing is to do', async () => {
    const ledger = await buildHolidayRestLedger({
      month: '2026-02', employees: [office('O1')], today: new Date('2026-03-05T04:00:00.000Z'), holidayContext: contextFor('2026-02-01', '2026-03-01'),
    });
    // 2/15（週日）、2/28（週六）都有公務機關補假日（2/20、2/27），其餘是平日依行事曆放假：沒有要處理的事，不列入
    expect(ledger.employees).toEqual([]);
    expect(ledger.summary.excluded.notScheduled).toBe(1);
  });

  it('shows the government make-up date as the 補假 of an office employee who has some roster rows', async () => {
    mockShiftSchedule.find.mockReturnValue(chain([row('O2', '2026-02-02', 'day')]));
    const ledger = await buildHolidayRestLedger({
      month: '2026-02', employees: [office('O2', { holidayRegime: 'office' })], today: new Date('2026-03-05T04:00:00.000Z'),
      holidayContext: contextFor('2026-02-01', '2026-03-01'),
    });
    const [o2] = ledger.employees;
    expect(o2.regime).toBe('office');
    expect(brief(o2)).toEqual([
      ['02-15', 'compensated', null], ['02-16', 'rested_on_date', null], ['02-17', 'rested_on_date', null],
      ['02-18', 'rested_on_date', null], ['02-19', 'rested_on_date', null], ['02-28', 'compensated', null],
    ]);
    expect(o2.items[1].implicit).toBe(true);
    expect(describeLedgerItem(o2.items[1])).toBe('依行事曆放假');
    expect(o2.items[5].compensation).toMatchObject({ date: '2026-02-27', via: 'gov_makeup', conflict: false });
    expect(describeLedgerItem(o2.items[5])).toBe('補假 02/27（公務機關補假日）');
    expect(o2.compensations.map((entry) => [entry.date, entry.via, entry.taken])).toEqual([['2026-02-20', 'gov_makeup', true], ['2026-02-27', 'gov_makeup', true]]);
    expect(o2).toMatchObject({ entitled: 6, rested: 4, compensated: 2, notTaken: 0, open: 0 });
  });

  it('lists an office employee for a weekend statutory day without a government make-up day and syncs an office_saturday 調休 credit (2021-05-01)', async () => {
    const context = createHolidayContext({
      start: '2021-04-24',
      end: '2021-06-08',
      rows: [{ _id: 'labor', date: utc('2021-05-01'), name: '勞動節', kind: 'statutory', archived: false }],
      years: [{ year: 2021, state: 'approved' }],
    });
    resolverMocks.CompensatoryCredit.bulkWrite.mockResolvedValue({ upsertedCount: 1 });
    const ledger = await buildHolidayRestLedger({
      month: '2021-05', employees: [office('O3')], today: new Date('2021-06-02T04:00:00.000Z'), holidayContext: context, syncCompensations: true,
    });

    expect(ledger.employees.map((entry) => entry.employeeId)).toEqual(['O3']);
    // 替身沒有把新額度讀回來：畫面仍是「待存入調休」
    expect(ledger.employees[0].items[0]).toMatchObject({ status: 'not_taken', reason: 'on_rest_day', needsAction: 'assign_compensation' });
    const [ops] = resolverMocks.CompensatoryCredit.bulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(ops[0].updateOne.filter).toEqual({ employee: 'O3', sourceKey: 'holiday_rest:2021-05-01' });
    expect(ops[0].updateOne.update.$setOnInsert).toMatchObject({
      status: 'available', sourceType: 'holiday_rest', reason: 'office_saturday', hours: 8, usedHours: 0,
      holidayName: '勞動節', holidayDate: utc('2021-05-01'), earnedDate: utc('2021-05-01'), suggestedDate: utc('2021-05-03'),
    });
    expect(ledger.sync).toEqual({ created: 1, voided: 0, reopened: 0, conflicts: 0 });
  });

  it('shows a banked credit as compensated (no HR action), a used one with its 調休 date, and a used one whose trigger is gone as a conflict', async () => {
    const context = contextFor('2026-10-01', '2026-11-01');
    const credit = (holidayKey, extra = {}) => ({
      _id: `cr${holidayKey}`, employee: 'A', sourceType: 'holiday_rest', holidayDate: utc(holidayKey), status: 'available', hours: 8, usedHours: 0, usages: [], ...extra,
    });
    resolverMocks.CompensatoryCredit.find.mockReturnValue(chain([
      credit('2026-10-10'),
      credit('2026-10-25', {
        status: 'used', usedHours: 8,
        usages: [{ kind: 'leave_request', hours: 8, approvalRequest: 'req1', days: [{ date: '2026-10-27', hours: 8 }], fullDayDates: ['2026-10-27'] }],
      }),
    ]));
    mockShiftSchedule.find.mockReturnValue(chain([
      row('A', '2026-10-10', 'rest'), row('A', '2026-10-25', 'off'), row('A', '2026-10-27', 'day'),
    ]));
    const ledger = await buildHolidayRestLedger({ month: '2026-10', employees: [nurse('A')], today: new Date('2026-11-05T04:00:00.000Z'), holidayContext: context });
    const [a] = ledger.employees;
    expect(a.items[0]).toMatchObject({ status: 'compensated', needsAction: null, compensation: { via: 'bank', creditStatus: 'available', hours: 8, conflict: false } });
    expect(describeLedgerItem(a.items[0])).toBe('已存入調休');
    expect(a.items[1]).toMatchObject({ status: 'compensated', compensation: { via: 'comp_leave', date: '2026-10-27', creditStatus: 'used', conflict: false } });
    expect(describeLedgerItem(a.items[1])).toBe('調休 10/27');
    expect(a).toMatchObject({ compensated: 2, notTaken: 0, open: 0 });
    expect(ledger.summary).toMatchObject({ banked: 1, compensationOpen: 0 });

    // 班表把 10/25 的例假改成上班：調休已經用掉，不收回，標示請人資確認
    mockShiftSchedule.find.mockReturnValue(chain([
      row('A', '2026-10-10', 'rest'), row('A', '2026-10-25', 'day'), row('A', '2026-10-27', 'day'),
    ]));
    const changed = await buildHolidayRestLedger({ month: '2026-10', employees: [nurse('A')], today: new Date('2026-11-05T04:00:00.000Z'), holidayContext: context });
    expect(changed.employees[0].items[1]).toMatchObject({ compensation: { via: 'comp_leave', date: '2026-10-27', conflict: true, conflictReason: 'trigger_gone' } });
    expect(describeLedgerItem(changed.employees[0].items[1])).toBe('調休 10/27（班表已變更，請確認）');
  });

  it('marks a holiday on a rostered rest day as compensated once HR assigned the 補假, and the 國 on that day is not an extra 國', async () => {
    mockShiftSchedule.find.mockReturnValue(chain([
      row('A', '2026-10-10', 'rest'), row('A', '2026-10-14', 'guo'), row('A', '2026-10-25', 'guo'),
    ]));
    const context = contextFor('2026-10-01', '2026-11-01', {
      compensations: [{ _id: 'c1', employee: 'A', holidayDate: utc('2026-10-10'), assignedDate: utc('2026-10-14'), status: 'assigned', holidayName: '國慶日' }],
    });
    const ledger = await buildHolidayRestLedger({ month: '2026-10', employees: [nurse('A')], today: new Date('2026-11-03T04:00:00.000Z'), holidayContext: context });

    const [a] = ledger.employees;
    expect(brief(a)).toEqual([['10-10', 'compensated', null], ['10-25', 'rested_on_date', null]]);
    expect(a.items[0].compensation).toMatchObject({ date: '2026-10-14', via: 'assigned', compensationId: 'c1', conflict: false });
    expect(describeLedgerItem(a.items[0])).toBe('補假 10/14');
    expect(a.extraGuoDates).toEqual([]);
    expect(a.compensations).toEqual([{ date: '2026-10-14', originalDate: '2026-10-10', holidayName: '國慶日', via: 'assigned', compensationId: 'c1', taken: true }]);
    expect(a).toMatchObject({ compensated: 1, open: 0 });
  });

  it('keeps an assigned 補假 when the roster changes afterwards and flags it for review instead', async () => {
    mockShiftSchedule.find.mockReturnValue(chain([row('A', '2026-10-10', 'guo'), row('A', '2026-10-25', 'guo')]));
    const context = contextFor('2026-10-01', '2026-11-01', {
      compensations: [{ _id: 'c1', employee: 'A', holidayDate: utc('2026-10-10'), assignedDate: utc('2026-10-14'), status: 'assigned', holidayName: '國慶日' }],
    });
    const ledger = await buildHolidayRestLedger({ month: '2026-10', employees: [nurse('A')], today: new Date('2026-11-03T04:00:00.000Z'), holidayContext: context });
    const item = ledger.employees[0].items[0];
    expect(item).toMatchObject({ status: 'rested_on_date', compensation: { date: '2026-10-14', conflict: true } });
    expect(describeLedgerItem(item)).toBe('補假 10/14（班表已變更，請確認）');
    expect(ledger.employees[0].open).toBe(1);
  });

  it('lists a designated day only for employees scheduled to work it and not excluded', async () => {
    const designated = { _id: 'd1', date: utc('2026-11-28'), name: '公民投票日', kind: 'designated', excludedEmployees: ['C'], archived: false };
    mockShiftSchedule.find.mockReturnValue(chain([row('A', '2026-11-28', 'day'), row('B', '2026-11-28', 'rest'), row('C', '2026-11-28', 'day')]));
    const context = createHolidayContext({ start: '2026-11-01', end: '2026-12-01', rows: [...rows2026(), designated], years: [{ year: 2026, state: 'approved' }] });
    const ledger = await buildHolidayRestLedger({
      month: '2026-11', employees: [nurse('A'), nurse('B'), nurse('C')], today: new Date('2026-12-03T04:00:00.000Z'), holidayContext: context,
    });
    expect(ledger.holidays.map((holiday) => [holiday.id, holiday.type])).toEqual([['designated:2026-11-28', 'designated']]);
    const byId = Object.fromEntries(ledger.employees.map((entry) => [entry.employeeId, entry]));
    expect(byId.A.items).toEqual([expect.objectContaining({ type: 'designated', status: 'not_taken', reason: 'worked', needsAction: 'resolve' })]);
    // B 當天休息、C 沒有投票權（排除）：沒有這個項目，也沒有其他國定假日，不列入
    expect(byId.B).toBeUndefined();
    expect(byId.C).toBeUndefined();
    expect(ledger.summary.excluded.notScheduled).toBe(2);
  });

  it('builds the columns as the union of everyone, with a personal column for a swap into another month', async () => {
    const swaps = [{ _id: 's1', employee: 'A', originalDate: utc('2026-09-28'), targetDate: utc('2026-10-05'), status: 'active', originalName: '孔子誕辰紀念日/教師節' }];
    mockShiftSchedule.find.mockReturnValue(chain([
      row('A', '2026-10-05', 'guo'), row('A', '2026-10-10', 'guo'), row('A', '2026-10-25', 'guo'),
      row('B', '2026-10-10', 'guo'), row('B', '2026-10-25', 'guo'),
    ]));
    const october = await buildHolidayRestLedger({
      month: '2026-10', employees: [nurse('A'), nurse('B')], today: new Date('2026-11-03T04:00:00.000Z'), holidayContext: contextFor('2026-10-01', '2026-11-01', { swaps }),
    });
    expect(october.holidays.map((holiday) => [holiday.id, holiday.date, holiday.personal])).toEqual([
      ['statutory:2026-09-28', '2026-09-28', true],
      ['statutory:2026-10-10', '2026-10-10', false],
      ['statutory:2026-10-25', '2026-10-25', false],
    ]);
    const a = october.employees.find((entry) => entry.employeeId === 'A');
    const b = october.employees.find((entry) => entry.employeeId === 'B');
    expect(a.items[0]).toMatchObject({ holidayId: 'statutory:2026-09-28', holidayDate: '2026-10-05', via: 'swap', status: 'rested_on_date' });
    expect(a.swaps).toEqual([{ id: 's1', originalDate: '2026-09-28', targetDate: '2026-10-05' }]);
    expect(b.items.map((item) => item.holidayId)).toEqual(['statutory:2026-10-10', 'statutory:2026-10-25']);

    mockShiftSchedule.find.mockReturnValue(chain([row('A', '2026-09-28', 'day'), row('B', '2026-09-28', 'guo'), row('A', '2026-09-25', 'guo'), row('B', '2026-09-25', 'guo')]));
    const september = await buildHolidayRestLedger({
      month: '2026-09', employees: [nurse('A'), nurse('B')], today: new Date('2026-10-03T04:00:00.000Z'), holidayContext: contextFor('2026-09-01', '2026-10-01', { swaps }),
    });
    const aSep = september.employees.find((entry) => entry.employeeId === 'A');
    // 9/28 對 A 是一般工作日（已調移到 10/5），沒有這個項目；B 照常
    expect(aSep.items.map((item) => item.holidayId)).toEqual(['statutory:2026-09-25']);
    expect(aSep.swaps).toEqual([{ id: null, originalDate: '2026-09-28', targetDate: '2026-10-05' }]);
    expect(september.holidays.find((holiday) => holiday.id === 'statutory:2026-09-28').personal).toBe(false);
  });

  it('does not write anything while the roster is still a draft, and creates one 調休 credit per holiday once it is final', async () => {
    const context = contextFor('2026-10-01', '2026-11-01');
    resolverMocks.CompensatoryCredit.bulkWrite.mockResolvedValue({ upsertedCount: 1 });
    mockShiftSchedule.find.mockReturnValue(chain([row('A', '2026-10-10', 'rest', 'draft'), row('A', '2026-10-25', 'guo', 'draft')]));
    const draft = await buildHolidayRestLedger({
      month: '2026-10', employees: [nurse('A')], today: new Date('2026-10-05T04:00:00.000Z'), holidayContext: context, syncCompensations: true,
    });
    expect(draft.employees[0].items[0]).toMatchObject({ reason: 'on_rest_day', needsAction: 'schedule' });
    expect(resolverMocks.CompensatoryCredit.bulkWrite).not.toHaveBeenCalled();

    mockShiftSchedule.find.mockReturnValue(chain([
      row('A', '2026-10-10', 'rest'), row('A', '2026-10-12', 'day'), row('A', '2026-10-25', 'guo'),
    ]));
    const final = await buildHolidayRestLedger({
      month: '2026-10', employees: [nurse('A')], today: new Date('2026-10-05T04:00:00.000Z'), holidayContext: context, syncCompensations: true,
    });
    expect(final.sync.created).toBe(1);
    const [ops] = resolverMocks.CompensatoryCredit.bulkWrite.mock.calls[0];
    // 建議日：國定假日之後第一個排上班的日子（10/12）
    expect(ops[0].updateOne.update.$setOnInsert).toMatchObject({ reason: 'rest_day', status: 'available', suggestedDate: utc('2026-10-12') });
  });
});

describe('buildImportHolidayWarnings with the per-employee holiday resolver', () => {
  const rows = [
    ...['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28'].map((key) => ({ date: utc(key), name: key === '2026-02-28' ? '和平紀念日' : '春節', kind: 'statutory' })),
    { date: utc('2026-02-20'), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc('2026-02-15') },
    { date: utc('2026-02-27'), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc('2026-02-28') },
  ];
  const context = () => createHolidayContext({ start: '2026-02-01', end: '2026-03-01', rows, years: [{ year: 2026, state: 'approved' }] });
  const guoCells = (keys) => keys.map((key) => ({ rowNumber: 5, day: Number(key.slice(8)), code: '國', dateKey: key }));

  it('counts the statutory days of that employee only: a 國 on a government make-up day is an extra 國 for a roster nurse', () => {
    const keys = ['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-27'];
    const warnings = buildImportHolidayWarnings({
      month: '2026-02',
      holidayContext: context(),
      states: [{
        id: 'A', employee: { _id: 'A', status: '正職員工' }, rowNumber: 5, employeeCode: 'NA',
        cells: guoCells(keys), candidateKinds: new Map([...keys.map((key) => [key, 'holiday']), ['2026-02-28', 'rest_day']]),
      }],
      fullMonth: false,
    });
    // 輪班人員只有 6 個國定假日（2/20、2/27 是公務機關補假日，不算）：7 個國配完 6 個（2/20 的國配給 2/28），2/27 的國多出來
    expect(warnings.map((warning) => warning.day)).toEqual([27]);
    expect(warnings[0].message).toContain('只有 6 個國定假日');
  });

  it('keeps the old company-level list when no context is given', () => {
    const warnings = buildImportHolidayWarnings({
      holidays: [{ id: '2026-02-16', name: '春節', date: '2026-02-16', originalDate: '2026-02-16', movedFrom: null }],
      states: [{ id: 'A', employee: { status: '正職員工' }, rowNumber: 5, employeeCode: 'NA', cells: guoCells(['2026-02-16', '2026-02-17']), candidateKinds: new Map([['2026-02-16', 'holiday'], ['2026-02-17', 'holiday']]) }],
    });
    expect(warnings.map((warning) => warning.day)).toEqual([17]);
    expect(warnings[0].message).toContain('只有 1 個國定假日');
  });
});

describe('describeLedgerItem for 補假', () => {
  it('describes compensated, waiting and conflicting 補假 cells', () => {
    expect(describeLedgerItem({ status: 'compensated', compensation: { date: '2026-10-14', via: 'assigned' } })).toBe('補假 10/14');
    expect(describeLedgerItem({ status: 'compensated', compensation: { date: '2026-02-27', via: 'gov_makeup' } })).toBe('補假 02/27（公務機關補假日）');
    expect(describeLedgerItem({ status: 'not_taken', reason: 'on_rest_day', needsAction: 'assign_compensation' })).toBe('待存入調休');
    expect(describeLedgerItem({ status: 'compensated', compensation: { via: 'bank', creditStatus: 'available', usedHours: 0 } })).toBe('已存入調休');
    expect(describeLedgerItem({ status: 'compensated', compensation: { via: 'bank', creditStatus: 'partial', usedHours: 4 } })).toBe('已存入調休（已用 4 小時）');
    expect(describeLedgerItem({ status: 'compensated', compensation: { via: 'bank', creditStatus: 'used', usedHours: 8 } })).toBe('調休已使用');
    expect(describeLedgerItem({ status: 'compensated', compensation: { via: 'comp_leave', date: '2026-10-26' } })).toBe('調休 10/26');
    expect(describeLedgerItem({ status: 'compensated', compensation: { via: 'hr_assigned', date: '2026-10-14' } })).toBe('補假 10/14');
    expect(describeLedgerItem({ status: 'moved', guoDate: '2026-10-03', compensation: { via: 'bank', creditStatus: 'used', conflict: true } })).toBe('調休已使用（班表已變更，請確認）');
    expect(describeLedgerItem({ status: 'rested_on_date', implicit: true })).toBe('依行事曆放假');
    expect(describeLedgerItem({ status: 'moved', guoDate: '2026-10-03', compensation: { date: '2026-10-14', conflict: true } })).toBe('補假 10/14（班表已變更，請確認）');
  });
});
