// 個人調移（HolidaySwap）：必須有員工本人的同意紀錄；只能調移法定國定假日（指定應放假日、公務機關補假日不行）、
// 公司已統一調移或已經調移過的不行、調移日要是原本上班的日子；可以跨月；撤銷只改狀態、紀錄保留。
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
const { CalendarYear, HolidaySwap, CompensatoryCredit } = await registerHolidayResolverModelMocks(jest);

const { createHolidaySwap, listHolidaySwaps, revokeHolidaySwap } = await import('../src/services/holidayCompensationService.js');
const { buildHolidayRestLedger } = await import('../src/services/holidayRestLedgerService.js');
const { isNationalHolidayFor, loadHolidayContext } = await import('../src/services/holidayResolver.js');

/* ---------------------------- 2026 行事曆與班表 ---------------------------- */
const STATUTORY = [
  ['2026-09-25', '中秋節'], ['2026-09-28', '孔子誕辰紀念日/教師節'], ['2026-10-10', '國慶日'],
  ['2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'], ['2026-12-25', '行憲紀念日'], ['2027-01-01', '開國紀念日'],
];
const HOLIDAY_ROWS = [
  ...STATUTORY.map(([key, name], index) => ({ _id: oid(0x100 + index), date: utc(key), name, kind: 'statutory', archived: false })),
  { _id: oid(0x200), date: utc('2026-10-09'), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc('2026-10-10'), archived: false },
  { _id: oid(0x201), date: utc('2026-11-28'), name: '公民投票日', kind: 'designated', archived: false },
];
const SHIFTS = [
  { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
  { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: 'guo', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
];
const ID = { nurseA: oid(1), nurseB: oid(2), office: oid(3), boss: oid(9) };
const PEOPLE = [
  { _id: ID.nurseA, employeeId: 'N001', name: '護理甲', status: '正職員工' },
  { _id: ID.nurseB, employeeId: 'N002', name: '護理乙', status: '正職員工' },
  { _id: ID.office, employeeId: 'O001', name: '行政丙', status: '正職員工', requiresScheduling: false },
  { _id: ID.boss, employeeId: 'S001', name: '主管', status: '正職員工' },
];
let roster = [];
let moves = [];
const rosterRow = (employee, key, shiftId, state = 'finalized') => ({ employee, date: utc(key), shiftId, state });
let compensations;
let swaps;
const NOW = new Date('2026-09-20T04:00:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  roster = [];
  moves = [];
  // 已排定的補假改存在調休存摺（HR 指定的使用紀錄）
  compensations = createStore(CompensatoryCredit, {
    unique: (a, b) => sameValue(a.employee, b.employee) && a.sourceKey === b.sourceKey,
  });
  swaps = createStore(HolidaySwap, {
    unique: (a, b) => a.status === 'active' && b.status === 'active' && sameValue(a.employee, b.employee) && sameValue(a.originalDate, b.originalDate),
  });
  CalendarYear.__setRows([{ year: 2026, state: 'approved' }]);
  mockHoliday.find.mockImplementation((filter) => chain(() => HOLIDAY_ROWS.filter((row) => matches(row, filter))));
  mockHolidayMoveSetting.find.mockImplementation(() => chain(() => moves));
  mockShiftSchedule.find.mockImplementation((filter) => chain(() => roster.filter((row) => matches(row, filter))));
  mockShiftSchedule.findOne.mockImplementation((filter) => chain(() => roster.find((row) => matches(row, filter)) ?? null));
  mockAttendanceSetting.findOne.mockImplementation(() => chain(() => ({ shifts: SHIFTS })));
  mockEmployee.find.mockImplementation((filter) => chain(() => PEOPLE.filter((person) => matches(person, filter))));
  mockEmployee.findById.mockImplementation((id) => chain(() => PEOPLE.find((person) => person._id === String(id)) ?? null));
  mockHolidayRestResolution.find.mockImplementation(() => chain(() => []));
  mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map());
});

const CONSENT = { method: 'signature', consentedAt: '2026-09-15', evidenceRef: '同意書 115-0915-01', note: '' };
const swapBody = (extra = {}) => ({
  employeeId: ID.nurseA, originalDate: '2026-09-28', targetDate: '2026-10-05', reason: '員工希望連休', consent: CONSENT, actorId: ID.boss, now: NOW, ...extra,
});
const codeOf = (promise) => promise.then(() => 'OK', (err) => err.code);

describe('creating a personal holiday swap', () => {
  it('requires the employee\'s own consent evidence', async () => {
    expect(await codeOf(createHolidaySwap(swapBody({ consent: undefined })))).toBe('CONSENT_REQUIRED');
    expect(await codeOf(createHolidaySwap(swapBody({ consent: { ...CONSENT, evidenceRef: '  ' } })))).toBe('CONSENT_REQUIRED');
    expect(await codeOf(createHolidaySwap(swapBody({ consent: { ...CONSENT, method: 'union' } })))).toBe('CONSENT_REQUIRED');
    // 同意日期不能是未來
    expect(await codeOf(createHolidaySwap(swapBody({ consent: { ...CONSENT, consentedAt: '2026-09-21' } })))).toBe('CONSENT_REQUIRED');
    expect(swaps).toHaveLength(0);
  });

  it('only swaps a statutory day: designated days and government make-up days are refused', async () => {
    roster = [rosterRow(ID.nurseA, '2026-11-28', 'day')];
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-11-28', targetDate: '2026-11-30' })))).toBe('DESIGNATED_NOT_SWAPPABLE');
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-10-09', targetDate: '2026-10-13' })))).toBe('NOT_STATUTORY');
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-10-07', targetDate: '2026-10-13' })))).toBe('NOT_STATUTORY');
  });

  it('refuses a day already moved by the company, a second swap, a holiday target, a taken target and a rest-day target', async () => {
    moves = [{ _id: oid(0x300), enableHolidayMove: true, sourceDate: utc('2026-12-25'), targetDate: utc('2026-12-24') }];
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-12-25', targetDate: '2026-12-28' })))).toBe('MOVE_EXISTS');

    expect(await codeOf(createHolidaySwap(swapBody()))).toBe('OK');
    expect(await codeOf(createHolidaySwap(swapBody({ targetDate: '2026-10-06' })))).toBe('ALREADY_SWAPPED');

    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-09-25', targetDate: '2026-10-10' })))).toBe('ALREADY_HOLIDAY');
    // 10/5 已經是 9/28 的調移日
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-09-25', targetDate: '2026-10-05' })))).toBe('DATE_TAKEN');
    compensations.push({
      _id: oid(0x400), employee: ID.nurseA, sourceType: 'holiday_rest', sourceKey: 'holiday_rest:2026-10-10', holidayDate: utc('2026-10-10'), status: 'used', hours: 8, usedHours: 8,
      usages: [{ kind: 'hr_assigned', hours: 8, days: [{ date: '2026-10-14', hours: 8 }], fullDayDates: ['2026-10-14'] }],
    });
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-09-25', targetDate: '2026-10-14' })))).toBe('DATE_TAKEN');
    roster = [rosterRow(ID.nurseA, '2026-10-13', 'rest')];
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-09-25', targetDate: '2026-10-13' })))).toBe('TARGET_NOT_WORKDAY');
    expect(await codeOf(createHolidaySwap(swapBody({ originalDate: '2026-09-25', targetDate: '2027-09-27' })))).toBe('OUT_OF_RANGE');
  });

  it('refuses an office employee\'s swap onto a weekend without a roster row, and allows a weekday', async () => {
    // 回歸：行政人員沒有班表，以前週六也能當調移日
    expect(await codeOf(createHolidaySwap(swapBody({ employeeId: ID.office, targetDate: '2026-10-03' })))).toBe('TARGET_NOT_WORKDAY');
    expect(await codeOf(createHolidaySwap(swapBody({ employeeId: ID.office, targetDate: '2026-10-04' })))).toBe('TARGET_NOT_WORKDAY');
    expect(swaps).toHaveLength(0);
    expect(await codeOf(createHolidaySwap(swapBody({ employeeId: ID.office, targetDate: '2026-10-05' })))).toBe('OK');
  });

  it('allows a cross-month swap: the original day becomes a normal workday and the target day a holiday for that employee only', async () => {
    const saved = await createHolidaySwap(swapBody());
    expect(saved).toMatchObject({
      employeeId: ID.nurseA, originalDate: '2026-09-28', originalName: '孔子誕辰紀念日/教師節', targetDate: '2026-10-05', status: 'active',
      consent: { method: 'signature', consentedAt: '2026-09-15', evidenceRef: '同意書 115-0915-01' }, createdByName: '主管',
    });
    const context = await loadHolidayContext({ start: '2026-09-28', end: '2026-10-06', employees: [PEOPLE[0], PEOPLE[1]] });
    expect(isNationalHolidayFor(context, PEOPLE[0], '2026-09-28')).toMatchObject({ holiday: false, notHolidayReason: 'swapped_away', movedTo: '2026-10-05' });
    expect(isNationalHolidayFor(context, PEOPLE[0], '2026-10-05')).toMatchObject({ holiday: true, reason: 'swap', originalDate: '2026-09-28' });
    expect(isNationalHolidayFor(context, PEOPLE[1], '2026-09-28')).toMatchObject({ holiday: true, reason: 'statutory' });

    roster = [rosterRow(ID.nurseA, '2026-10-05', 'guo'), rosterRow(ID.nurseA, '2026-10-10', 'guo'), rosterRow(ID.nurseA, '2026-10-25', 'guo')];
    const october = await buildHolidayRestLedger({ month: '2026-10', employees: [PEOPLE[0]], today: new Date('2026-11-03T04:00:00.000Z') });
    expect(october.employees[0].items[0]).toMatchObject({ holidayId: 'statutory:2026-09-28', holidayDate: '2026-10-05', via: 'swap', status: 'rested_on_date' });
    expect(october.employees[0].entitled).toBe(3);
  });

  it('turns a race on the partial unique index into ALREADY_SWAPPED', async () => {
    HolidaySwap.create.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    expect(await codeOf(createHolidaySwap(swapBody()))).toBe('ALREADY_SWAPPED');
  });
});

describe('revoking and listing personal swaps', () => {
  it('keeps the record, needs a reason and restores the original holiday', async () => {
    const saved = await createHolidaySwap(swapBody());
    expect(await codeOf(revokeHolidaySwap({ id: saved.id, reason: ' ', actorId: ID.boss }))).toBe('REASON_REQUIRED');
    const revoked = await revokeHolidaySwap({ id: saved.id, reason: '員工改變心意', actorId: ID.boss, now: NOW });
    expect(revoked).toMatchObject({ status: 'revoked', revokeReason: '員工改變心意' });
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({ status: 'revoked', revokedBy: ID.boss });
    expect(await codeOf(revokeHolidaySwap({ id: saved.id, reason: '再撤銷一次' }))).toBe('ALREADY_REVOKED');

    const context = await loadHolidayContext({ start: '2026-09-28', end: '2026-10-06', employees: [PEOPLE[0]] });
    expect(isNationalHolidayFor(context, PEOPLE[0], '2026-09-28')).toMatchObject({ holiday: true, reason: 'statutory' });
    // 撤銷之後可以重新調移（部分唯一索引只限有效的調移）
    expect(await codeOf(createHolidaySwap(swapBody({ targetDate: '2026-10-06' })))).toBe('OK');
  });

  it('lists active swaps by default and all of them on request, only for the employees in scope', async () => {
    const first = await createHolidaySwap(swapBody());
    await revokeHolidaySwap({ id: first.id, reason: '取消' });
    await createHolidaySwap(swapBody({ targetDate: '2026-10-06' }));
    await createHolidaySwap(swapBody({ employeeId: ID.nurseB, originalDate: '2026-10-10', targetDate: '2026-10-12' }));

    const active = await listHolidaySwaps({ employees: PEOPLE, year: 2026 });
    expect(active.swaps.map((swap) => [swap.name, swap.originalDate, swap.targetDate, swap.status])).toEqual([
      ['護理甲', '2026-09-28', '2026-10-06', 'active'],
      ['護理乙', '2026-10-10', '2026-10-12', 'active'],
    ]);
    const all = await listHolidaySwaps({ employees: [PEOPLE[0]], status: 'all' });
    expect(all.swaps.map((swap) => swap.status).sort()).toEqual(['active', 'revoked']);
    expect((await listHolidaySwaps({ employees: PEOPLE, year: 2025 })).swaps).toEqual([]);
  });
});
