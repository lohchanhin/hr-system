// 國定假日補假義務：班表推算觸發條件後建立／作廢／重新開啟（可重複執行）、排定補假的檢查順序、每日排程的範圍。
// 補假集合用記憶體替身（支援這裡用到的查詢與 bulkWrite），才能驗證第二次同步不會重複寫入。
import { jest } from '@jest/globals';
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js';

const oid = (n) => n.toString(16).padStart(24, '0');
const utc = (key) => new Date(`${key}T00:00:00.000Z`);
const clone = (value) => (value === undefined ? value : structuredClone(value));

/* ---------------------------- 記憶體版查詢 ---------------------------- */
const sameValue = (a, b) => ((a instanceof Date || b instanceof Date) ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b));
function matchCondition(value, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((key) => key.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$in') return arg.some((item) => value != null && sameValue(value, item));
      if (op === '$ne') return value == null ? arg != null : !sameValue(value, arg);
      if (op === '$gte') return value != null && new Date(value) >= new Date(arg);
      if (op === '$lt') return value != null && new Date(value) < new Date(arg);
      if (op === '$gt') return value != null && String(value) > String(arg);
      if (op === '$exists') return arg ? value !== undefined : value === undefined;
      throw new Error(`unsupported operator ${op}`);
    });
  }
  if (cond === null) return value == null;
  return value != null && sameValue(value, cond);
}
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((part) => matches(doc, part));
    if (key === '$and') return cond.every((part) => matches(doc, part));
    return matchCondition(key.split('.').reduce((node, part) => node?.[part], doc), cond);
  });
}
const chain = (resolve) => {
  const query = {
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    limit: jest.fn(() => query),
    populate: jest.fn(() => query),
    lean: jest.fn(async () => resolve()),
    then: (onFulfilled, onRejected) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return query;
};
function applyUpdate(doc, update) {
  for (const [key, value] of Object.entries(update.$set || {})) doc[key] = clone(value);
  for (const key of Object.keys(update.$unset || {})) delete doc[key];
}
function createStore(model, { unique }) {
  const docs = [];
  let seq = 0;
  const insert = (doc) => {
    if (docs.some((existing) => unique(existing, doc))) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const stored = { _id: oid(0x9000 + (seq += 1)), createdAt: new Date(), ...clone(doc) };
    docs.push(stored);
    return stored;
  };
  model.find.mockImplementation((filter) => chain(() => docs.filter((doc) => matches(doc, filter)).map(clone)));
  model.findById.mockImplementation((id) => chain(() => clone(docs.find((doc) => doc._id === String(id))) ?? null));
  model.findOneAndUpdate.mockImplementation(async (filter, update) => {
    const doc = docs.find((item) => matches(item, filter));
    if (!doc) return null;
    applyUpdate(doc, update);
    return clone(doc);
  });
  model.create.mockImplementation(async (doc) => clone(insert(doc)));
  model.bulkWrite.mockImplementation(async (ops) => {
    let upsertedCount = 0;
    for (const { updateOne } of ops) {
      const doc = docs.find((item) => matches(item, updateOne.filter));
      if (doc) applyUpdate(doc, updateOne.update);
      else if (updateOne.upsert) {
        insert({ ...updateOne.filter, ...updateOne.update.$setOnInsert, ...(updateOne.update.$set || {}) });
        upsertedCount += 1;
      }
    }
    return { upsertedCount };
  });
  return docs;
}

/* ---------------------------- 模型替身 ---------------------------- */
const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockShiftSchedule = { find: jest.fn(), findOne: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockEmployee = { find: jest.fn(), findById: jest.fn() };
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
const { CalendarYear, HolidayCompensation, HolidaySwap } = await registerHolidayResolverModelMocks(jest);

const {
  assignHolidayCompensation,
  createManualHolidayCompensation,
  listHolidayCompensations,
  syncHolidayCompensationsForMonths,
  syncRecentHolidayCompensations,
  unassignHolidayCompensation,
} = await import('../src/services/holidayCompensationService.js');
const { buildHolidayRestLedger } = await import('../src/services/holidayRestLedgerService.js');
const { isNationalHolidayFor, loadHolidayContext } = await import('../src/services/holidayResolver.js');

/* ---------------------------- 2026 行事曆與班表 ---------------------------- */
const STATUTORY = [
  ['2026-01-01', '開國紀念日'], ['2026-02-15', '小年夜'], ['2026-02-16', '農曆除夕'], ['2026-02-17', '春節'], ['2026-02-18', '春節'],
  ['2026-02-19', '春節'], ['2026-02-28', '和平紀念日'], ['2026-04-04', '兒童節'], ['2026-04-05', '民族掃墓節'], ['2026-05-01', '勞動節'],
  ['2026-06-19', '端午節'], ['2026-09-25', '中秋節'], ['2026-09-28', '孔子誕辰紀念日/教師節'], ['2026-10-10', '國慶日'],
  ['2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'], ['2026-12-25', '行憲紀念日'], ['2021-05-01', '勞動節'],
];
const GOVERNMENT = [
  ['2026-02-20', '2026-02-15'], ['2026-02-27', '2026-02-28'], ['2026-04-03', '2026-04-04'], ['2026-04-06', '2026-04-05'],
  ['2026-10-09', '2026-10-10'], ['2026-10-26', '2026-10-25'],
];
const HOLIDAY_ROWS = [
  ...STATUTORY.map(([key, name], index) => ({ _id: oid(0x100 + index), date: utc(key), name, kind: 'statutory', archived: false })),
  ...GOVERNMENT.map(([key, link], index) => ({ _id: oid(0x200 + index), date: utc(key), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc(link), archived: false })),
];
const SHIFTS = [
  { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
  { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: 'guo', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
];
const ID = { nurse: oid(1), office: oid(2), resigned: oid(3), boss: oid(9) };
const PEOPLE = [
  { _id: ID.nurse, employeeId: 'N001', name: '護理甲', status: '正職員工', subDepartment: { name: '內科' } },
  { _id: ID.office, employeeId: 'O001', name: '行政乙', status: '正職員工', requiresScheduling: false },
  { _id: ID.resigned, employeeId: 'N002', name: '護理丙', status: '離職員工', appointment: { resignationDate: new Date('2026-10-15T16:00:00.000Z') } },
  { _id: ID.boss, employeeId: 'S001', name: '主管', status: '正職員工' },
];
let roster = [];
const rosterRow = (employee, key, shiftId, state = 'finalized') => ({ employee, date: utc(key), shiftId, state });
const AFTER_OCTOBER = new Date('2026-11-03T04:00:00.000Z');
let compensations;
let swaps;

beforeEach(() => {
  jest.clearAllMocks();
  roster = [];
  compensations = createStore(HolidayCompensation, {
    unique: (a, b) => sameValue(a.employee, b.employee) && sameValue(a.holidayDate, b.holidayDate),
  });
  swaps = createStore(HolidaySwap, {
    unique: (a, b) => a.status === 'active' && b.status === 'active' && sameValue(a.employee, b.employee) && sameValue(a.originalDate, b.originalDate),
  });
  CalendarYear.__setRows([{ year: 2026, state: 'approved' }, { year: 2021, state: 'approved' }]);
  mockHoliday.find.mockImplementation((filter) => chain(() => HOLIDAY_ROWS.filter((row) => matches(row, filter))));
  mockHolidayMoveSetting.find.mockImplementation(() => chain(() => []));
  mockShiftSchedule.find.mockImplementation((filter) => chain(() => roster.filter((row) => matches(row, filter))));
  mockShiftSchedule.findOne.mockImplementation((filter) => chain(() => roster.find((row) => matches(row, filter)) ?? null));
  mockAttendanceSetting.findOne.mockImplementation(() => chain(() => ({ shifts: SHIFTS })));
  mockEmployee.find.mockImplementation((filter) => chain(() => PEOPLE.filter((person) => matches(person, filter))));
  mockEmployee.findById.mockImplementation((id) => chain(() => PEOPLE.find((person) => person._id === String(id)) ?? null));
  mockHolidayRestResolution.find.mockImplementation(() => chain(() => []));
  mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map());
});

const nurse = () => PEOPLE.find((person) => person._id === ID.nurse);
const office = () => PEOPLE.find((person) => person._id === ID.office);
const syncOctober = (people = [nurse()], today = AFTER_OCTOBER) => syncHolidayCompensationsForMonths({ months: ['2026-10'], employees: people, now: today });
const brief = () => compensations.map((doc) => ({
  employee: doc.employee, holidayDate: doc.holidayDate.toISOString().slice(0, 10), status: doc.status, origin: doc.origin, voidReason: doc.voidReason, conflict: doc.conflict,
}));

describe('syncing 補假 obligations from the roster', () => {
  it('creates one open obligation when 國慶日 (Sat) falls on the nurse\'s rostered rest day and no 國 covers it', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-12', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    const result = await syncOctober();
    expect(result).toEqual({ created: 1, voided: 0, reopened: 0, conflicts: 0 });
    expect(brief()).toEqual([{ employee: ID.nurse, holidayDate: '2026-10-10', status: 'open', origin: 'roster_rest_day', voidReason: undefined, conflict: false }]);
    expect(compensations[0]).toMatchObject({ holidayName: '國慶日', dayKindAtDetection: 'rest_day', suggestedDate: utc('2026-10-12'), createdBy: null });
  });

  it('is idempotent: a second sync writes nothing', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    HolidayCompensation.bulkWrite.mockClear();
    const second = await syncOctober();
    expect(second).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 0 });
    expect(HolidayCompensation.bulkWrite).not.toHaveBeenCalled();
    expect(compensations).toHaveLength(1);
  });

  it('creates nothing when another 國 in the month covers the holiday, when the nurse is unscheduled, or while the roster is a draft', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-15', 'guo'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    expect((await syncOctober()).created).toBe(0);

    roster = [rosterRow(ID.nurse, '2026-10-25', 'guo')];
    expect((await syncOctober()).created).toBe(0);

    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest', 'draft'), rosterRow(ID.nurse, '2026-10-25', 'guo', 'draft')];
    expect((await syncOctober([nurse()], new Date('2026-10-05T04:00:00.000Z'))).created).toBe(0);
    expect(compensations).toHaveLength(0);
  });

  it('voids the open obligation once a 國 covers it and reopens it when the 國 is removed again', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();

    roster.push(rosterRow(ID.nurse, '2026-10-15', 'guo'));
    expect(await syncOctober()).toEqual({ created: 0, voided: 1, reopened: 0, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'covered_by_roster' });

    roster = roster.filter((row) => row.date.getTime() !== utc('2026-10-15').getTime());
    expect(await syncOctober()).toEqual({ created: 0, voided: 0, reopened: 1, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'open', voidReason: undefined });
    expect(compensations[0].voidedAt).toBeUndefined();
  });

  it('never voids an assigned 補假: it is flagged as a conflict while the trigger is gone, and cleared again', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    await assignHolidayCompensation({ id: compensations[0]._id, assignedDate: '2026-10-14', agreementNote: '與員工協商於 10/14 補假', actorId: ID.boss });
    expect(compensations[0]).toMatchObject({ status: 'assigned', assignedBy: ID.boss, agreementNote: '與員工協商於 10/14 補假' });

    // 班表改成 10/10 排「國」：條件不成立，但已排定的補假不自動取消
    roster = [rosterRow(ID.nurse, '2026-10-10', 'guo'), rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    expect(await syncOctober()).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 1 });
    expect(brief()[0]).toMatchObject({ status: 'assigned', conflict: true });

    roster[0] = rosterRow(ID.nurse, '2026-10-10', 'rest');
    await syncOctober();
    expect(brief()[0]).toMatchObject({ status: 'assigned', conflict: false });
  });

  it('gives office staff the government make-up day instead of an obligation (2026-02-28), but creates one for a weekend holiday without it (2021-05-01)', async () => {
    const february = await syncHolidayCompensationsForMonths({ months: ['2026-02'], employees: [office()], now: AFTER_OCTOBER });
    expect(february.created).toBe(0);

    const may2021 = await syncHolidayCompensationsForMonths({ months: ['2021-05'], employees: [office()], now: AFTER_OCTOBER });
    expect(may2021.created).toBe(1);
    expect(brief()).toEqual([{ employee: ID.office, holidayDate: '2021-05-01', status: 'open', origin: 'office_weekend', voidReason: undefined, conflict: false }]);
    expect(compensations[0]).toMatchObject({ dayKindAtDetection: 'office_rest_day', suggestedDate: utc('2021-05-03') });
  });

  it('voids an open obligation whose holiday is no longer statutory (the calendar was corrected)', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    const original = [...HOLIDAY_ROWS];
    // 管理員把 10/10 從行事曆刪掉（封存）
    mockHoliday.find.mockImplementation((filter) => chain(() => original
      .filter((row) => row.date.getTime() !== utc('2026-10-10').getTime())
      .filter((row) => matches(row, filter))));
    expect(await syncOctober()).toEqual({ created: 0, voided: 1, reopened: 0, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'holiday_removed' });
  });

  it('leaves a manual obligation alone', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'guo'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-10', note: '員工 10/10 值班', actorId: ID.boss });
    await syncOctober();
    expect(brief()[0]).toMatchObject({ status: 'open', origin: 'manual' });
  });
});

describe('assigning a 補假 date', () => {
  async function openObligation() {
    roster = [
      rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-13', 'rest'),
      rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo'),
    ];
    await syncOctober();
    return compensations[0]._id;
  }
  const codeOf = (promise) => promise.then(() => 'OK', (err) => err.code);

  it('checks the date in order: range, already a holiday, taken, not a workday, not employed', async () => {
    const id = await openObligation();
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2027-12-31' }))).toBe('OUT_OF_RANGE');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-02-30' }))).toBe('OUT_OF_RANGE');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-25' }))).toBe('ALREADY_HOLIDAY');
    // 2026-10-09 是公務機關補假日：對輪班人員不是假日，可以排
    swaps.push({ _id: oid(0x7001), employee: ID.nurse, originalDate: utc('2026-09-28'), targetDate: utc('2026-10-20'), status: 'active', consent: { method: 'signature', consentedAt: utc('2026-09-01'), evidenceRef: 'A-1' } });
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-20' }))).toBe('DATE_TAKEN');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-13' }))).toBe('TARGET_NOT_WORKDAY');

    const resignedId = (await HolidayCompensation.create({ employee: ID.resigned, holidayDate: utc('2026-10-10'), status: 'open', origin: 'manual' }))._id;
    expect(await codeOf(assignHolidayCompensation({ id: resignedId, assignedDate: '2026-10-20' }))).toBe('NOT_EMPLOYED');
  });

  it('assigns, and the resolver then reports the day as that employee\'s 補假; unassign returns it to open', async () => {
    const id = await openObligation();
    const saved = await assignHolidayCompensation({ id, assignedDate: '2026-10-14', agreementNote: '協商於 10/14', actorId: ID.boss });
    expect(saved).toMatchObject({ status: 'assigned', assignedDate: '2026-10-14', holidayDate: '2026-10-10', assignedByName: '主管', conflict: false });

    const context = await loadHolidayContext({ start: '2026-10-14', end: '2026-10-15', employees: [nurse()] });
    expect(isNationalHolidayFor(context, nurse(), '2026-10-14')).toMatchObject({ holiday: true, reason: 'compensation', compensatesDate: '2026-10-10' });
    // 已排定的補假改排同一天不算衝突
    expect((await assignHolidayCompensation({ id, assignedDate: '2026-10-14' })).status).toBe('assigned');

    const ledger = await buildHolidayRestLedger({ month: '2026-10', employees: [nurse()], today: AFTER_OCTOBER });
    expect(ledger.employees[0].items[0]).toMatchObject({ status: 'compensated', compensation: { date: '2026-10-14', via: 'assigned' } });

    const reopened = await unassignHolidayCompensation({ id });
    expect(reopened).toMatchObject({ status: 'open', assignedDate: null });
    expect(compensations[0].assignedDate).toBeNull();
  });

  it('refuses a void obligation and asks the authorize callback first', async () => {
    const id = await openObligation();
    const authorize = jest.fn(async () => { throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); });
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14', authorize }))).toBe('FORBIDDEN');
    expect(authorize).toHaveBeenCalledWith(ID.nurse);
    compensations[0].status = 'void';
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14' }))).toBe('COMPENSATION_VOID');
  });

  it('refuses an office employee\'s 補假 on a day the company calendar already gives off (Saturday, company rest day), without a roster', async () => {
    // 回歸：行政人員沒有班表，以前只看班表，週六也能排補假，畫面卻顯示「已補假」
    mockHoliday.find.mockImplementation((filter) => chain(() => [
      ...HOLIDAY_ROWS,
      { _id: oid(0x300), date: utc('2021-05-04'), name: '公司休息日', kind: 'company_off', archived: false },
    ].filter((row) => matches(row, filter))));
    await syncHolidayCompensationsForMonths({ months: ['2021-05'], employees: [office()], now: AFTER_OCTOBER });
    const id = compensations[0]._id;
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2021-05-08' }))).toBe('TARGET_NOT_WORKDAY');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2021-05-09' }))).toBe('TARGET_NOT_WORKDAY');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2021-05-04' }))).toBe('TARGET_NOT_WORKDAY');
    expect(compensations[0].status).toBe('open');
    expect((await assignHolidayCompensation({ id, assignedDate: '2021-05-03' })).status).toBe('assigned');
  });

  it('adds a manual obligation only for a statutory day and refuses a duplicate', async () => {
    expect(await codeOf(createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-09' }))).toBe('NOT_STATUTORY');
    const created = await createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-10', note: '值班', actorId: ID.boss });
    expect(created).toMatchObject({ origin: 'manual', status: 'open', holidayName: '國慶日' });
    expect(await codeOf(createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-10' }))).toBe('DUPLICATE');
  });
});

describe('an assigned 補假 date that is later rostered as a rest day', () => {
  // 回歸：補假日之後被改排「休」，休假紀錄仍顯示「補假 10/14」、沒有任何提醒，員工等於少休一天
  const october = () => buildHolidayRestLedger({ month: '2026-10', employees: [nurse()], today: AFTER_OCTOBER, syncCompensations: true });

  it('flags the item and the stored obligation as a conflict, and clears both once the day is a workday again', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    await assignHolidayCompensation({ id: compensations[0]._id, assignedDate: '2026-10-14', agreementNote: '協商於 10/14' });

    roster[1] = rosterRow(ID.nurse, '2026-10-14', 'rest');
    const changed = await october();
    const [row] = changed.employees;
    expect(row.items[0]).toMatchObject({
      status: 'compensated',
      compensation: { date: '2026-10-14', via: 'assigned', conflict: true, conflictReason: 'date_not_workday' },
    });
    expect(row.open).toBe(1);
    expect(changed.sync).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 1 });
    expect(brief()[0]).toMatchObject({ status: 'assigned', conflict: true });
    // 年度清單的件數也看得到
    expect((await listHolidayCompensations({ employees: PEOPLE, year: 2026 })).summary.conflict).toBe(1);

    roster[1] = rosterRow(ID.nurse, '2026-10-14', 'day');
    const restored = await october();
    expect(restored.employees[0].items[0].compensation).toMatchObject({ conflict: false });
    expect(restored.employees[0].open).toBe(0);
    expect(brief()[0]).toMatchObject({ status: 'assigned', conflict: false });
  });

  it('reads the roster of a 補假 date in another month and flags it when that day became a rest day', async () => {
    roster = [
      rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo'),
      rosterRow(ID.nurse, '2026-11-18', 'day'),
    ];
    await syncOctober();
    await assignHolidayCompensation({ id: compensations[0]._id, assignedDate: '2026-11-18' });
    expect((await october()).employees[0].items[0].compensation).toMatchObject({ date: '2026-11-18', conflict: false });

    roster[2] = rosterRow(ID.nurse, '2026-11-18', 'rest');
    mockShiftSchedule.find.mockClear();
    const ledger = await october();
    expect(ledger.employees[0].items[0].compensation).toMatchObject({ date: '2026-11-18', conflict: true, conflictReason: 'date_not_workday' });
    expect(brief()[0]).toMatchObject({ status: 'assigned', conflict: true });
    // 本月班表之外只多一次查詢：只查那幾天
    const outside = mockShiftSchedule.find.mock.calls.map(([filter]) => filter).filter((filter) => filter.date?.$in);
    expect(outside).toHaveLength(1);
    expect(outside[0].date.$in.map((date) => date.toISOString().slice(0, 10))).toEqual(['2026-11-18']);
  });

  it('flags an office employee\'s 補假 once the company calendar turns that day into a rest day', async () => {
    await syncHolidayCompensationsForMonths({ months: ['2021-05'], employees: [office()], now: AFTER_OCTOBER });
    await assignHolidayCompensation({ id: compensations[0]._id, assignedDate: '2021-05-03' });
    mockHoliday.find.mockImplementation((filter) => chain(() => [
      ...HOLIDAY_ROWS,
      { _id: oid(0x301), date: utc('2021-05-03'), name: '公司休息日', kind: 'company_off', archived: false },
    ].filter((row) => matches(row, filter))));

    const ledger = await buildHolidayRestLedger({ month: '2021-05', employees: [office()], today: AFTER_OCTOBER, syncCompensations: true });
    expect(ledger.employees[0].items[0]).toMatchObject({
      status: 'compensated', compensation: { date: '2021-05-03', conflict: true, conflictReason: 'date_not_workday' },
    });
    expect(brief()[0]).toMatchObject({ employee: ID.office, status: 'assigned', conflict: true });
  });
});

describe('the year-end list and the daily job', () => {
  it('lists open obligations of the year by default, with counts of every status', async () => {
    await HolidayCompensation.create({ employee: ID.nurse, holidayDate: utc('2026-10-10'), holidayName: '國慶日', status: 'open', origin: 'roster_rest_day' });
    await HolidayCompensation.create({ employee: ID.nurse, holidayDate: utc('2026-02-28'), holidayName: '和平紀念日', status: 'assigned', assignedDate: utc('2026-03-02'), conflict: true, origin: 'roster_rest_day' });
    await HolidayCompensation.create({ employee: ID.office, holidayDate: utc('2026-04-04'), status: 'void', voidReason: 'covered_by_roster', origin: 'roster_rest_day' });
    await HolidayCompensation.create({ employee: ID.nurse, holidayDate: utc('2025-12-25'), status: 'open', origin: 'roster_rest_day' });

    const open = await listHolidayCompensations({ employees: PEOPLE, year: 2026 });
    expect(open.compensations.map((entry) => [entry.name, entry.holidayDate, entry.status, entry.regime])).toEqual([['護理甲', '2026-10-10', 'open', 'roster']]);
    expect(open.summary).toEqual({ open: 1, assigned: 1, void: 1, conflict: 1 });
    const all = await listHolidayCompensations({ employees: PEOPLE, year: 2026, status: 'all' });
    expect(all.compensations.map((entry) => entry.holidayDate)).toEqual(['2026-02-28', '2026-04-04', '2026-10-10']);
    expect(all.compensations[0]).toMatchObject({ assignedDate: '2026-03-02', conflict: true });
    // 權限範圍外的員工看不到
    const scoped = await listHolidayCompensations({ employees: [office()], year: 2026, status: 'all' });
    expect(scoped.compensations.map((entry) => entry.employeeId)).toEqual([ID.office]);
  });

  it('recomputes the previous and the current Taipei month for active staff and those who resigned within them', async () => {
    roster = [rosterRow(ID.nurse, '2026-09-28', 'rest'), rosterRow(ID.nurse, '2026-09-25', 'guo'), rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    const result = await syncRecentHolidayCompensations({ now: new Date('2026-10-31T17:00:00.000Z') }); // 台灣 11/1 01:00
    // 台灣已經是 11 月：重算 10 月與 11 月；9/28 不在範圍內
    expect(brief().map((entry) => entry.holidayDate)).toEqual(['2026-10-10']);
    expect(result.created).toBe(1);
    const employeeQuery = mockEmployee.find.mock.calls[0][0];
    expect(JSON.stringify(employeeQuery)).toContain('離職員工');
    expect(employeeQuery.$or[1]['appointment.resignationDate'].$gte.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });
});
