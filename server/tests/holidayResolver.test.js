import { jest } from '@jest/globals';
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js';

// 國定假日判斷（services/holidayResolver.js）：純函式 createHolidayContext 以 2026 年的實際行事曆
// （16 個國定假日＋6 個公務機關補假）驗證每一種情況；loadHolidayContext 用替身模型檢查查詢次數與條件。

const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockEmployee = { find: jest.fn() };
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };

jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
const { CalendarYear, HolidayCompensation, HolidaySwap } = await registerHolidayResolverModelMocks(jest);

const {
  HOLIDAY_REASONS,
  NOT_HOLIDAY_REASONS,
  buildEmployeeHolidayDaySet,
  calendarStatusFromContext,
  createHolidayContext,
  getCalendarStatus,
  isNationalHolidayFor,
  listCalendarHeaders,
  listEmployeeHolidays,
  loadHolidayContext,
  officeDayKind,
  resolveDayType,
} = await import('../src/services/holidayResolver.js');

const day = (key) => new Date(`${key}T00:00:00.000Z`);
let rowCounter = 0;
const statutory = (key, name) => ({ _id: `h${(rowCounter += 1)}`, date: day(key), kind: 'statutory', name, type: '國定假日', source: 'dgpa' });
const govMakeup = (key, compensates, compensatesName) => ({
  _id: `h${(rowCounter += 1)}`,
  date: day(key),
  kind: 'gov_makeup_off',
  name: '補假',
  type: '公務機關補假',
  source: 'dgpa',
  compensatesDate: day(compensates),
  compensatesName,
});
const kindRow = (key, kind, name, extra = {}) => ({ _id: `h${(rowCounter += 1)}`, date: day(key), kind, name, source: 'dgpa', ...extra });

// 115 年（2026）政府辦公日曆表分類後的結果：16 個國定假日、6 個公務機關補假
const STATUTORY_2026 = [
  ['2026-01-01', '開國紀念日'],
  ['2026-02-15', '小年夜'],
  ['2026-02-16', '農曆除夕'],
  ['2026-02-17', '春節'],
  ['2026-02-18', '春節'],
  ['2026-02-19', '春節'],
  ['2026-02-28', '和平紀念日'],
  ['2026-04-04', '兒童節'],
  ['2026-04-05', '清明節'],
  ['2026-05-01', '勞動節'],
  ['2026-06-19', '端午節'],
  ['2026-09-25', '中秋節'],
  ['2026-09-28', '孔子誕辰紀念日/教師節'],
  ['2026-10-10', '國慶日'],
  ['2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'],
  ['2026-12-25', '行憲紀念日'],
];
const GOV_2026 = [
  ['2026-02-20', '2026-02-15', '小年夜'],
  ['2026-02-27', '2026-02-28', '和平紀念日'],
  ['2026-04-03', '2026-04-04', '兒童節'],
  ['2026-04-06', '2026-04-05', '清明節'],
  ['2026-10-09', '2026-10-10', '國慶日'],
  ['2026-10-26', '2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'],
];
const rows2026 = () => [
  ...STATUTORY_2026.map(([key, name]) => statutory(key, name)),
  ...GOV_2026.map(([key, target, name]) => govMakeup(key, target, name)),
];

// 116 年（2027）：16 個國定假日、8 個補假（含跨月 03-01→02-28、跨年 12-31→2028-01-01）
const rows2027 = () => [
  ...[
    ['2027-01-01', '開國紀念日'], ['2027-02-04', '小年夜'], ['2027-02-05', '農曆除夕'], ['2027-02-06', '春節'],
    ['2027-02-07', '春節'], ['2027-02-08', '春節'], ['2027-02-28', '和平紀念日'], ['2027-04-04', '兒童節'],
    ['2027-04-05', '清明節'], ['2027-05-01', '勞動節'], ['2027-06-09', '端午節'], ['2027-09-15', '中秋節'],
    ['2027-09-28', '孔子誕辰紀念日/教師節'], ['2027-10-10', '國慶日'], ['2027-10-25', '臺灣光復暨金門古寧頭大捷紀念日'],
    ['2027-12-25', '行憲紀念日'],
  ].map(([key, name]) => statutory(key, name)),
  ...[
    ['2027-02-09', '2027-02-06', '春節'], ['2027-02-10', '2027-02-07', '春節'], ['2027-03-01', '2027-02-28', '和平紀念日'],
    ['2027-04-06', '2027-04-04', '兒童節'], ['2027-04-30', '2027-05-01', '勞動節'], ['2027-10-11', '2027-10-10', '國慶日'],
    ['2027-12-24', '2027-12-25', '行憲紀念日'], ['2027-12-31', '2028-01-01', '開國紀念日'],
  ].map(([key, target, name]) => govMakeup(key, target, name)),
];

// 112 年（2023）：有調整放假與補行上班
const rows2023 = () => [
  ...['2023-01-01', '2023-01-21', '2023-01-22', '2023-01-23', '2023-01-24', '2023-02-28', '2023-04-04', '2023-04-05',
    '2023-05-01', '2023-06-22', '2023-09-29', '2023-10-10'].map((key) => statutory(key, '國定假日')),
  govMakeup('2023-01-02', '2023-01-01', '開國紀念日'),
  govMakeup('2023-01-25', '2023-01-21', '農曆除夕'),
  govMakeup('2023-01-26', '2023-01-22', '春節'),
  ...['2023-01-20', '2023-01-27', '2023-02-27', '2023-04-03', '2023-06-23', '2023-10-09']
    .map((key) => kindRow(key, 'gov_bridge_off', '調整放假')),
  ...['2023-01-07', '2023-02-04', '2023-02-18', '2023-03-25', '2023-06-17', '2023-09-23']
    .map((key) => kindRow(key, 'gov_makeup_workday', '補行上班')),
];

const ROSTER = { _id: 'roster-nurse', requiresScheduling: true };
const OFFICE = { _id: 'office-clerk', requiresScheduling: false };
const year2026 = { start: '2026-01-01', end: '2027-01-01' };

function context2026(extra = {}) {
  return createHolidayContext({ ...year2026, rows: rows2026(), employees: [ROSTER, OFFICE], ...extra });
}

describe('createHolidayContext + isNationalHolidayFor（2026 年 16 個國定假日＋6 個公務機關補假）', () => {
  it('輪班人員：公務機關補假日不是假日；落在週六的和平紀念日是國定假日；全年 16 天', () => {
    const ctx = context2026();
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-02-20')).toMatchObject({ holiday: false, reason: null });
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-02-28')).toMatchObject({
      holiday: true,
      reason: 'statutory',
      name: '和平紀念日',
      originalDate: '2026-02-28',
      provisional: true,
    });
    const days = buildEmployeeHolidayDaySet(ctx, ROSTER, year2026);
    expect(days.size).toBe(16);
    expect(days.has('2026-02-20')).toBe(false);
  });

  it('行政人員：公務機關補假日自動放假並連結到補的國定假日；全年 22 天', () => {
    const ctx = context2026();
    expect(isNationalHolidayFor(ctx, OFFICE, '2026-02-20')).toMatchObject({
      holiday: true,
      reason: 'gov_makeup',
      compensatesDate: '2026-02-15',
      compensatesName: '小年夜',
    });
    expect(buildEmployeeHolidayDaySet(ctx, OFFICE, year2026).size).toBe(22);
  });

  it('只帶 id 的員工依預設當輪班人員，不在 context 的員工也能得到行事曆層級的答案', () => {
    const ctx = context2026();
    expect(isNationalHolidayFor(ctx, 'someone', '2026-02-20').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, 'someone', '2026-10-10').reason).toBe('statutory');
    // 呼叫端帶的員工資料優先（context 裡沒有這個人也照樣判斷行政人員）
    expect(isNationalHolidayFor(ctx, { _id: 'x', holidayRegime: 'office' }, '2026-10-09').reason).toBe('gov_makeup');
  });

  it('公司挪移可以跨月：原日期不是假日、目標日是；行政人員的補假在國定假日被挪走後不再放假', () => {
    const ctx = createHolidayContext({
      start: '2027-01-01',
      end: '2028-01-01',
      rows: rows2027(),
      moves: [{ _id: 'm1', enableHolidayMove: true, sourceDate: day('2027-02-28'), targetDate: day('2027-03-02') }],
      employees: [ROSTER, OFFICE],
    });
    expect(isNationalHolidayFor(ctx, ROSTER, '2027-02-28')).toMatchObject({
      holiday: false,
      notHolidayReason: 'moved_away',
      movedTo: '2027-03-02',
    });
    expect(isNationalHolidayFor(ctx, ROSTER, '2027-03-02')).toMatchObject({
      holiday: true,
      reason: 'company_move',
      name: '和平紀念日',
      originalDate: '2027-02-28',
      sourceId: 'm1',
    });
    expect(isNationalHolidayFor(ctx, OFFICE, '2027-03-01').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, OFFICE, '2027-03-02').reason).toBe('company_move');
    // 跨年的補假 12-31 補 2028-01-01（下一年沒有資料時以固定日期的國定假日判斷）
    expect(isNationalHolidayFor(ctx, OFFICE, '2027-12-31')).toMatchObject({ holiday: true, compensatesDate: '2028-01-01' });
  });

  it('來源日不是國定假日的公司挪移不生效，並記在 warnings', () => {
    const ctx = context2026({
      moves: [{ _id: 'bad', enableHolidayMove: true, sourceDate: day('2026-02-20'), targetDate: day('2026-02-23') }],
    });
    expect(isNationalHolidayFor(ctx, OFFICE, '2026-02-23').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, OFFICE, '2026-02-20').reason).toBe('gov_makeup');
    expect(ctx.warnings).toEqual([expect.objectContaining({ code: 'MOVE_SOURCE_NOT_STATUTORY', moveId: 'bad' })]);
  });

  it('個人調移只影響本人：原國定假日變成一般工作日、調移日變成假日', () => {
    const swap = {
      _id: 'sw1',
      employee: 'nurse-a',
      originalDate: day('2026-09-28'),
      originalName: '教師節',
      targetDate: day('2026-10-05'),
      status: 'active',
    };
    const ctx = context2026({ swaps: [swap], employees: ['nurse-a', 'nurse-b'] });
    expect(isNationalHolidayFor(ctx, 'nurse-a', '2026-09-28')).toMatchObject({
      holiday: false,
      notHolidayReason: 'swapped_away',
      movedTo: '2026-10-05',
    });
    expect(isNationalHolidayFor(ctx, 'nurse-a', '2026-10-05')).toMatchObject({
      holiday: true,
      reason: 'swap',
      name: '教師節',
      originalDate: '2026-09-28',
      sourceId: 'sw1',
    });
    expect(isNationalHolidayFor(ctx, 'nurse-b', '2026-09-28').reason).toBe('statutory');
    expect(isNationalHolidayFor(ctx, 'nurse-b', '2026-10-05').holiday).toBe(false);
    // 撤銷的調移不生效
    const revoked = context2026({ swaps: [{ ...swap, status: 'revoked' }], employees: ['nurse-a'] });
    expect(isNationalHolidayFor(revoked, 'nurse-a', '2026-09-28').reason).toBe('statutory');
  });

  it('已排定的補假日是該員工的假日', () => {
    const ctx = context2026({
      compensations: [{
        _id: 'c1',
        employee: 'nurse-a',
        holidayDate: day('2026-10-10'),
        holidayName: '國慶日',
        status: 'assigned',
        assignedDate: day('2026-10-14'),
      }],
      employees: ['nurse-a'],
    });
    expect(isNationalHolidayFor(ctx, 'nurse-a', '2026-10-14')).toMatchObject({
      holiday: true,
      reason: 'compensation',
      name: '國慶日補假',
      compensatesDate: '2026-10-10',
      sourceId: 'c1',
    });
    expect(isNationalHolidayFor(ctx, 'nurse-b', '2026-10-14').holiday).toBe(false);
    // 國定假日當天照樣是國定假日（補假是另外給的）
    expect(isNationalHolidayFor(ctx, 'nurse-a', '2026-10-10').reason).toBe('statutory');
  });

  it('指定應放假日只適用當天原應出勤、沒有被排除的員工', () => {
    const rows = [
      ...rows2026(),
      kindRow('2026-11-28', 'designated', '地方公職人員選舉', { excludedEmployees: ['excluded-nurse'] }),
      kindRow('2026-11-25', 'designated', '公民投票'),
    ];
    const ctx = createHolidayContext({ ...year2026, rows, employees: [ROSTER, OFFICE, 'excluded-nurse'] });
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-11-28', { rosterKind: 'work' })).toMatchObject({
      holiday: true,
      reason: 'designated',
      name: '地方公職人員選舉',
    });
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-11-28', { rosterKind: 'holiday' }).holiday).toBe(true);
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-11-28', { rosterKind: 'rest_day' })).toMatchObject({
      holiday: false,
      notHolidayReason: 'designated_not_applicable',
    });
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-11-28', { rosterKind: 'none' }).holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-11-28').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, 'excluded-nurse', '2026-11-28', { rosterKind: 'work' })).toMatchObject({
      holiday: false,
      notHolidayReason: 'designated_excluded',
    });
    // 週六：行政人員本來就不上班
    expect(isNationalHolidayFor(ctx, OFFICE, '2026-11-28').holiday).toBe(false);
    // 平日：行政人員適用
    expect(isNationalHolidayFor(ctx, OFFICE, '2026-11-25')).toMatchObject({ holiday: true, reason: 'designated' });
    // context 的 rosterKindOf 也會用到
    const withRoster = createHolidayContext({
      ...year2026,
      rows,
      employees: [ROSTER],
      rosterKindOf: (id, key) => (id === 'roster-nurse' && key === '2026-11-28' ? 'work' : 'none'),
    });
    expect(isNationalHolidayFor(withRoster, ROSTER, '2026-11-28').reason).toBe('designated');
  });

  it('依政府調整放假（勞基法第 30 條第 3 項）只影響行政人員，而且調整放假永遠不是國定假日', () => {
    const range = { start: '2023-01-01', end: '2024-01-01', rows: rows2023(), employees: [ROSTER, OFFICE] };
    const off = createHolidayContext({ ...range, years: [{ year: 2023, state: 'approved', followGovernmentAdjustments: false }] });
    const on = createHolidayContext({
      ...range,
      years: [{ year: 2023, state: 'approved', followGovernmentAdjustments: true, adjustmentAgreement: { reference: '勞資會議 112-1', date: day('2022-12-01') } }],
    });
    expect(resolveDayType(off, OFFICE, '2023-01-27').dayType).toBe('workday');
    expect(resolveDayType(on, OFFICE, '2023-01-27').dayType).toBe('rest_day');
    expect(resolveDayType(off, OFFICE, '2023-01-07').dayType).toBe('rest_day');
    expect(resolveDayType(on, OFFICE, '2023-01-07').dayType).toBe('workday');
    expect(officeDayKind(on, '2023-01-27')).toBe('rest_day');
    expect(officeDayKind(on, '2023-01-07')).toBe('work');
    expect(officeDayKind(off, '2023-01-08')).toBe('regular_rest');
    // 輪班人員不受影響（沒有班表就是平日）
    expect(resolveDayType(on, ROSTER, '2023-01-27').dayType).toBe('workday');
    expect(resolveDayType(on, ROSTER, '2023-01-07').dayType).toBe('workday');
    for (const ctx of [on, off]) {
      expect(isNationalHolidayFor(ctx, OFFICE, '2023-01-27').holiday).toBe(false);
      expect(isNationalHolidayFor(ctx, ROSTER, '2023-01-27').holiday).toBe(false);
    }
  });

  it('加班費日別：國定假日 > 班表休息日 > 平日；沒有班表的行政人員週末算休息日', () => {
    const ctx = context2026();
    expect(resolveDayType(ctx, ROSTER, '2026-02-20', { rosterKind: 'work' }).dayType).toBe('workday');
    expect(resolveDayType(ctx, OFFICE, '2026-02-20').dayType).toBe('national_holiday');
    expect(resolveDayType(ctx, ROSTER, '2026-02-28', { rosterKind: 'rest_day' })).toMatchObject({
      dayType: 'national_holiday',
      verdict: expect.objectContaining({ reason: 'statutory' }),
    });
    expect(resolveDayType(ctx, ROSTER, '2026-03-04', { rosterKind: 'rest_day' }).dayType).toBe('rest_day');
    expect(resolveDayType(ctx, ROSTER, '2026-03-08', { rosterKind: 'regular_rest' }).dayType).toBe('workday');
    expect(resolveDayType(ctx, OFFICE, '2026-03-07').dayType).toBe('rest_day');
    expect(resolveDayType(ctx, OFFICE, '2026-03-08').dayType).toBe('rest_day');
    expect(resolveDayType(ctx, OFFICE, '2026-03-09').dayType).toBe('workday');
    expect(resolveDayType(ctx, ROSTER, '2026-03-07').dayType).toBe('workday');
    // 有班表的行政人員依班表
    expect(resolveDayType(ctx, OFFICE, '2026-03-07', { rosterKind: 'work' }).dayType).toBe('workday');
  });

  it('具原住民身分且當天請原民假：原住民族歲時祭儀', () => {
    const ctx = context2026({
      employees: [{ _id: 'ind', isIndigenous: true }, { _id: 'non', isIndigenous: false }],
      leaveTypeOf: (id, key) => (key === '2026-08-10' ? '原民假' : undefined),
    });
    expect(isNationalHolidayFor(ctx, 'ind', '2026-08-10')).toMatchObject({ holiday: true, reason: 'indigenous' });
    expect(isNationalHolidayFor(ctx, 'non', '2026-08-10').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, 'ind', '2026-08-11').holiday).toBe(false);
  });

  it('沒有 kind 的舊資料依 legacyKindOf：補假、調整放假不算，說明為空的週末雜訊略過', () => {
    const ctx = createHolidayContext({
      ...year2026,
      rows: [
        { _id: 'a', date: day('2026-06-19'), type: '國定假日', name: '端午節', source: 'roc-calendar', description: '端午節' },
        { _id: 'b', date: day('2026-02-20'), type: '國定假日', name: '補假', source: 'roc-calendar', description: '補假' },
        { _id: 'c', date: day('2026-02-23'), type: '假日', name: '調整放假' },
        { _id: 'd', date: day('2026-06-20'), type: '國定假日', name: '', source: 'roc-calendar' },
        { _id: 'e', date: day('2026-06-22'), type: '國定假日', name: '端午節', archived: true },
      ],
    });
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-06-19').reason).toBe('statutory');
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-02-20').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, OFFICE, '2026-02-20').reason).toBe('gov_makeup');
    expect(isNationalHolidayFor(ctx, OFFICE, '2026-02-23').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-06-20').holiday).toBe(false);
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-06-22').holiday).toBe(false);
  });

  it('exports the reason vocabularies', () => {
    expect(HOLIDAY_REASONS).toEqual(['statutory', 'company_move', 'swap', 'compensation', 'gov_makeup', 'designated', 'indigenous']);
    expect(NOT_HOLIDAY_REASONS).toEqual(['moved_away', 'swapped_away', 'designated_excluded', 'designated_not_applicable']);
  });
});

describe('listEmployeeHolidays', () => {
  const february = { start: '2026-02-01', end: '2026-03-01' };

  it('輪班人員 2026 年 2 月只有 6 個國定假日（不是 8 個），公務機關補假不列入', () => {
    const entries = listEmployeeHolidays(context2026(), ROSTER, february);
    expect(entries.map((entry) => entry.date)).toEqual([
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28',
    ]);
    expect(entries.every((entry) => entry.type === 'statutory' && entry.compensation === null)).toBe(true);
    expect(entries[0]).toMatchObject({ id: 'statutory:2026-02-15', name: '小年夜', originalDate: '2026-02-15', movedFrom: null, via: null });
  });

  it('行政人員：國定假日連結公務機關補假，另列補假日', () => {
    const entries = listEmployeeHolidays(context2026(), OFFICE, february);
    const peace = entries.find((entry) => entry.id === 'statutory:2026-02-28');
    expect(peace.compensation).toMatchObject({ date: '2026-02-27', via: 'gov_makeup', compensationId: null });
    const compensations = entries.filter((entry) => entry.type === 'compensation');
    expect(compensations).toEqual([
      expect.objectContaining({ id: 'compensation:2026-02-15', date: '2026-02-20', originalDate: '2026-02-15', via: 'gov_makeup', name: '小年夜補假' }),
      expect.objectContaining({ id: 'compensation:2026-02-28', date: '2026-02-27', originalDate: '2026-02-28', via: 'gov_makeup' }),
    ]);
    expect(entries.map((entry) => entry.date)).toEqual([...entries.map((entry) => entry.date)].sort());
    expect(listEmployeeHolidays(context2026(), OFFICE, { ...february, includeCompensations: false })).toHaveLength(6);
  });

  it('個人調移與公司挪移改變有效日期；已排定的補假列在國定假日與補假日', () => {
    const ctx = createHolidayContext({
      ...year2026,
      rows: rows2026(),
      employees: ['nurse-a'],
      swaps: [{ _id: 'sw', employee: 'nurse-a', originalDate: day('2026-09-28'), targetDate: day('2026-10-05'), status: 'active' }],
      moves: [{ _id: 'mv', enableHolidayMove: true, sourceDate: day('2026-12-25'), targetDate: day('2026-12-24') }],
      compensations: [{ _id: 'cp', employee: 'nurse-a', holidayDate: day('2026-10-10'), holidayName: '國慶日', status: 'assigned', assignedDate: day('2026-10-14') }],
    });
    const october = listEmployeeHolidays(ctx, 'nurse-a', { start: '2026-10-01', end: '2026-11-01' });
    expect(october.find((entry) => entry.id === 'statutory:2026-09-28')).toMatchObject({
      date: '2026-10-05',
      movedFrom: '2026-09-28',
      via: 'swap',
      swapId: 'sw',
    });
    expect(october.find((entry) => entry.id === 'statutory:2026-10-10').compensation).toMatchObject({
      date: '2026-10-14',
      via: 'assigned',
      compensationId: 'cp',
    });
    expect(october.find((entry) => entry.id === 'compensation:2026-10-10')).toMatchObject({ date: '2026-10-14', name: '國慶日補假' });
    const september = listEmployeeHolidays(ctx, 'nurse-a', { start: '2026-09-01', end: '2026-10-01' });
    expect(september.map((entry) => entry.id)).toEqual(['statutory:2026-09-25']);
    const december = listEmployeeHolidays(ctx, 'nurse-a', { start: '2026-12-01', end: '2027-01-01' });
    expect(december).toEqual([expect.objectContaining({ id: 'statutory:2026-12-25', date: '2026-12-24', via: 'company_move', moveId: 'mv' })]);
  });

  it('指定應放假日：只有適用的員工才有應休項目', () => {
    const rows = [...rows2026(), kindRow('2026-11-28', 'designated', '地方公職人員選舉')];
    const ctx = createHolidayContext({ ...year2026, rows, employees: [ROSTER, OFFICE] });
    const november = { start: '2026-11-01', end: '2026-12-01' };
    expect(listEmployeeHolidays(ctx, ROSTER, { ...november, rosterKindOf: () => 'work' })).toEqual([
      expect.objectContaining({ id: 'designated:2026-11-28', type: 'designated', compensation: null }),
    ]);
    expect(listEmployeeHolidays(ctx, ROSTER, { ...november, rosterKindOf: () => 'rest_day' })).toEqual([]);
    expect(listEmployeeHolidays(ctx, OFFICE, november)).toEqual([]);
  });
});

describe('listCalendarHeaders', () => {
  it('2026 年 2 月：國定假日標示在 15–19 日與 28 日，20、27 日是公務機關補假資訊', () => {
    const entries = listCalendarHeaders(context2026(), { start: '2026-02-01', end: '2026-03-01' });
    const holidays = entries.filter((entry) => entry.displayKind === 'holiday').map((entry) => entry.date);
    expect(holidays).toEqual(['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28']);
    const info = entries.filter((entry) => entry.displayKind === 'gov_info');
    expect(info).toEqual([
      expect.objectContaining({ date: '2026-02-20', label: '公務機關補假', compensatesDate: '2026-02-15', compensatesName: '小年夜', appliesTo: 'office' }),
      expect.objectContaining({ date: '2026-02-27', label: '公務機關補假', compensatesDate: '2026-02-28', appliesTo: 'office' }),
    ]);
    expect(entries.find((entry) => entry.date === '2026-02-28')).toMatchObject({ label: '和平紀念日', appliesTo: 'all', kind: 'statutory' });
  });

  it('公司挪移：原日期顯示「已調移至」，目標日顯示原假日；調整放假依設定改文字', () => {
    const ctx = createHolidayContext({
      start: '2027-02-01',
      end: '2027-04-01',
      rows: rows2027(),
      moves: [{ _id: 'm1', enableHolidayMove: true, sourceDate: day('2027-02-28'), targetDate: day('2027-03-02') }],
    });
    const entries = listCalendarHeaders(ctx);
    expect(entries.find((entry) => entry.date === '2027-02-28')).toMatchObject({ displayKind: 'moved_away', label: '已調移至 03/02', movedTo: '2027-03-02' });
    expect(entries.find((entry) => entry.date === '2027-03-02')).toMatchObject({ displayKind: 'holiday', label: '和平紀念日', movedFrom: '2027-02-28' });

    const range = { start: '2023-01-01', end: '2023-02-01', rows: rows2023() };
    const off = listCalendarHeaders(createHolidayContext(range));
    const on = listCalendarHeaders(createHolidayContext({
      ...range,
      years: [{ year: 2023, state: 'draft', followGovernmentAdjustments: true }],
    }));
    expect(off.find((entry) => entry.date === '2023-01-27')).toMatchObject({ label: '公務機關調整放假', appliesTo: 'info' });
    expect(on.find((entry) => entry.date === '2023-01-27')).toMatchObject({ label: '行政人員休息日（調整放假）', appliesTo: 'office' });
    expect(off.find((entry) => entry.date === '2023-01-07')).toMatchObject({ label: '公務機關補行上班' });
    expect(on.find((entry) => entry.date === '2023-01-07')).toMatchObject({ label: '行政人員補行上班', appliesTo: 'office' });
  });

  it('公司休息日、上班日與指定應放假日', () => {
    const ctx = createHolidayContext({
      start: '2026-11-01',
      end: '2026-12-01',
      rows: [
        kindRow('2026-11-28', 'designated', '地方公職人員選舉'),
        kindRow('2026-11-13', 'company_off', '尾牙'),
        kindRow('2026-11-14', 'company_workday', ''),
      ],
    });
    expect(listCalendarHeaders(ctx)).toEqual([
      expect.objectContaining({ date: '2026-11-13', displayKind: 'company_off', label: '尾牙' }),
      expect.objectContaining({ date: '2026-11-14', displayKind: 'company_workday', label: '公司上班日' }),
      expect.objectContaining({ date: '2026-11-28', displayKind: 'designated', label: '地方公職人員選舉', appliesTo: 'eligible' }),
    ]);
  });
});

describe('年度狀態與暫代（沒有行事曆的年度）', () => {
  it('較早年度已建立、這一年沒有任何資料：用固定日期的國定假日暫代', () => {
    const ctx = createHolidayContext({
      start: '2027-12-01',
      end: '2028-02-01',
      rows: rows2027(),
      years: [{ year: 2026, state: 'approved' }, { year: 2027, state: 'draft' }],
      employees: [ROSTER, OFFICE],
    });
    expect(isNationalHolidayFor(ctx, ROSTER, '2028-01-01')).toMatchObject({
      holiday: true,
      reason: 'statutory',
      synthetic: true,
      provisional: true,
      sourceId: null,
    });
    // 農曆假日無法推算，不暫代
    expect(isNationalHolidayFor(ctx, ROSTER, '2028-01-25').holiday).toBe(false);
    const status = calendarStatusFromContext(ctx);
    expect(status.years).toEqual([
      expect.objectContaining({ year: 2027, state: 'draft', synthetic: false }),
      expect.objectContaining({ year: 2028, state: 'none', synthetic: true }),
    ]);
    expect(status).toMatchObject({ provisional: true, provisionalYears: [2027, 2028] });
    expect(listCalendarHeaders(ctx, { start: '2028-01-01', end: '2028-01-02' })).toEqual([
      expect.objectContaining({ date: '2028-01-01', displayKind: 'holiday', synthetic: true }),
    ]);
  });

  it('完全沒有年度文件（全新系統）時不暫代任何假日', () => {
    const ctx = createHolidayContext({ start: '2028-01-01', end: '2028-02-01', rows: [], years: [] });
    expect(isNationalHolidayFor(ctx, ROSTER, '2028-01-01').holiday).toBe(false);
    expect(calendarStatusFromContext(ctx).years).toEqual([expect.objectContaining({ year: 2028, state: 'none', synthetic: false })]);
  });

  it('年度有資料但沒有年度文件時是草稿；lastApprovedDate 從今年起連續核定到哪一年', () => {
    const ctx = createHolidayContext({
      ...year2026,
      rows: rows2026(),
      years: [{ year: 2026, state: 'approved', approvedAt: new Date('2026-06-30T00:00:00Z') }, { year: 2027, state: 'draft', migrated: true }],
      today: new Date('2026-10-21T04:00:00Z'),
    });
    const status = calendarStatusFromContext(ctx, { from: '2026-10-01', to: '2027-01-31' });
    expect(status.years).toEqual([
      expect.objectContaining({ year: 2026, state: 'approved', migrated: false }),
      expect.objectContaining({ year: 2027, state: 'draft', migrated: true }),
    ]);
    expect(status).toMatchObject({ provisional: true, provisionalYears: [2027], lastApprovedDate: '2026-12-31' });
    expect(isNationalHolidayFor(ctx, ROSTER, '2026-10-10').provisional).toBe(false);

    const both = createHolidayContext({
      ...year2026,
      rows: rows2026(),
      years: [{ year: 2026, state: 'approved' }, { year: 2027, state: 'approved' }],
      today: '2026-10-21',
    });
    expect(calendarStatusFromContext(both).lastApprovedDate).toBe('2027-12-31');
    const draftOnly = createHolidayContext({ ...year2026, rows: rows2026(), today: '2026-10-21' });
    expect(calendarStatusFromContext(draftOnly)).toMatchObject({
      years: [expect.objectContaining({ year: 2026, state: 'draft' })],
      lastApprovedDate: null,
    });
  });
});

function leanQuery(value) {
  const query = {
    select: jest.fn(() => query),
    lean: jest.fn(async () => value),
  };
  return query;
}

describe('loadHolidayContext（替身模型）', () => {
  const nurseId = '64b7f0c2a1b2c3d4e5f60001';
  const clerkId = '64b7f0c2a1b2c3d4e5f60002';
  let fetchSpy;

  beforeEach(() => {
    mockHoliday.find.mockReset().mockReturnValue(leanQuery(rows2026()));
    mockHolidayMoveSetting.find.mockReset().mockReturnValue(leanQuery([]));
    mockEmployee.find.mockReset().mockReturnValue(leanQuery([{ _id: clerkId, requiresScheduling: false }]));
    mockShiftSchedule.find.mockReset().mockReturnValue(leanQuery([]));
    mockAttendanceSetting.findOne.mockReset().mockReturnValue(leanQuery({ shifts: [] }));
    CalendarYear.find.mockClear();
    CalendarYear.__setRows([{ year: 2026, state: 'approved' }]);
    HolidayCompensation.find.mockClear();
    HolidayCompensation.__setRows([]);
    HolidaySwap.find.mockClear();
    HolidaySwap.__setRows([]);
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('network must not be used');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('每個集合最多查一次、整年度讀取，不查班表也不連線', async () => {
    const ctx = await loadHolidayContext({
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-03-01T00:00:00Z'),
      employees: [nurseId, clerkId, { _id: 'plain', requiresScheduling: true }],
    });
    expect(mockHoliday.find).toHaveBeenCalledTimes(1);
    expect(mockHolidayMoveSetting.find).toHaveBeenCalledTimes(1);
    expect(CalendarYear.find).toHaveBeenCalledTimes(1);
    expect(HolidayCompensation.find).toHaveBeenCalledTimes(1);
    expect(HolidaySwap.find).toHaveBeenCalledTimes(1);
    expect(mockEmployee.find).toHaveBeenCalledTimes(1);
    expect(mockShiftSchedule.find).not.toHaveBeenCalled();
    expect(mockAttendanceSetting.findOne).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    const holidayFilter = mockHoliday.find.mock.calls[0][0];
    expect(holidayFilter.archived).toEqual({ $ne: true });
    expect(holidayFilter.date.$gte).toEqual(new Date('2025-12-25T00:00:00.000Z'));
    expect(holidayFilter.date.$lt).toEqual(new Date('2027-01-08T00:00:00.000Z'));
    expect(mockEmployee.find.mock.calls[0][0]).toEqual({ _id: { $in: [nurseId, clerkId] } });
    expect(HolidaySwap.find.mock.calls[0][0]).toMatchObject({ employee: { $in: [nurseId, clerkId] }, status: 'active' });
    expect(HolidayCompensation.find.mock.calls[0][0]).toMatchObject({ employee: { $in: [nurseId, clerkId] }, status: 'assigned' });

    // 讀到的假日制度生效：行政人員有公務機關補假
    expect(isNationalHolidayFor(ctx, clerkId, '2026-02-20').reason).toBe('gov_makeup');
    expect(isNationalHolidayFor(ctx, nurseId, '2026-02-20').holiday).toBe(false);
    expect(calendarStatusFromContext(ctx).provisional).toBe(false);
  });

  it('不是 ObjectId 的員工 id 不查員工、補假與調移', async () => {
    await loadHolidayContext({ start: '2026-02-01', end: '2026-03-01', employees: ['emp1', 'emp2'] });
    expect(mockEmployee.find).not.toHaveBeenCalled();
    expect(HolidayCompensation.find).not.toHaveBeenCalled();
    expect(HolidaySwap.find).not.toHaveBeenCalled();
    expect(CalendarYear.find).toHaveBeenCalledTimes(1);
  });

  it('挪移與調移的日期在讀取範圍外時一併讀取', async () => {
    mockHolidayMoveSetting.find.mockReturnValue(leanQuery([
      { _id: 'm', enableHolidayMove: true, sourceDate: day('2026-12-25'), targetDate: day('2026-12-24') },
    ]));
    HolidaySwap.__setRows([
      { _id: 's', employee: nurseId, originalDate: day('2025-12-25'), targetDate: day('2026-01-05'), status: 'active' },
    ]);
    await loadHolidayContext({ start: '2027-01-01', end: '2027-02-01', employees: [nurseId] });
    const filter = mockHoliday.find.mock.calls[0][0];
    expect(filter.$or[0].date).toEqual({ $gte: new Date('2026-12-25T00:00:00.000Z'), $lt: new Date('2028-01-08T00:00:00.000Z') });
    expect(filter.$or[1].date.$in).toEqual([day('2025-12-25'), day('2026-12-24')]);
  });

  it('範圍內有指定應放假日、呼叫端沒有提供班表時，才讀那幾天的班表判斷是否原應出勤', async () => {
    mockHoliday.find.mockReturnValue(leanQuery([...rows2026(), kindRow('2026-11-28', 'designated', '地方公職人員選舉')]));
    mockShiftSchedule.find.mockReturnValue(leanQuery([{ employee: nurseId, date: day('2026-11-28'), shiftId: 'D' }]));
    mockAttendanceSetting.findOne.mockReturnValue(leanQuery({ shifts: [{ _id: 'D', code: 'D', name: '日班', startTime: '08:00', endTime: '17:00' }] }));
    const ctx = await loadHolidayContext({ start: '2026-11-01', end: '2026-12-01', employees: [nurseId, clerkId] });
    expect(mockShiftSchedule.find).toHaveBeenCalledTimes(1);
    expect(mockShiftSchedule.find.mock.calls[0][0]).toEqual({
      employee: { $in: [nurseId, clerkId] },
      date: { $in: [day('2026-11-28')] },
    });
    expect(isNationalHolidayFor(ctx, nurseId, '2026-11-28').reason).toBe('designated');
    expect(isNationalHolidayFor(ctx, clerkId, '2026-11-28').holiday).toBe(false);

    mockShiftSchedule.find.mockClear();
    await loadHolidayContext({ start: '2026-11-01', end: '2026-12-01', employees: [nurseId], rosterKindOf: () => 'none' });
    expect(mockShiftSchedule.find).not.toHaveBeenCalled();
  });

  it('查詢結果可以是陣列或 Promise；資料庫錯誤直接往外丟', async () => {
    mockHoliday.find.mockReturnValue(rows2026());
    mockHolidayMoveSetting.find.mockReturnValue(Promise.resolve([]));
    const ctx = await loadHolidayContext({ start: '2026-02-01', end: '2026-03-01' });
    expect(buildEmployeeHolidayDaySet(ctx, 'x').size).toBe(6);

    mockHoliday.find.mockReturnValue({ lean: () => Promise.reject(Object.assign(new Error('db down'), { name: 'MongoServerError' })) });
    await expect(loadHolidayContext({ start: '2026-02-01', end: '2026-03-01' })).rejects.toThrow('db down');
  });

  it('getCalendarStatus 讀年度文件與範圍內的資料', async () => {
    CalendarYear.__setRows([{ year: 2026, state: 'approved' }]);
    mockHoliday.find.mockReturnValue(leanQuery(rows2027()));
    const status = await getCalendarStatus({ from: '2026-12-20', to: '2027-01-10', today: '2026-10-21' });
    expect(status).toMatchObject({
      provisional: true,
      provisionalYears: [2027],
      lastApprovedDate: '2026-12-31',
      years: [expect.objectContaining({ year: 2026, state: 'approved' }), expect.objectContaining({ year: 2027, state: 'draft' })],
    });
    expect(mockHoliday.find.mock.calls[0][0].date).toEqual({
      $gte: new Date('2026-01-01T00:00:00.000Z'),
      $lt: new Date('2028-01-01T00:00:00.000Z'),
    });
  });

  it('不合法的範圍丟出錯誤', async () => {
    await expect(loadHolidayContext({ start: 'bad', end: '2026-03-01' })).rejects.toThrow('invalid holiday context range');
    expect(() => createHolidayContext({ start: '2026-03-01', end: '2026-02-01' })).toThrow('invalid holiday context range');
  });
});
