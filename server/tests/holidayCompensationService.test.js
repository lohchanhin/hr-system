// 國定假日的調休（調休存摺的國定假日來源）：班表推算觸發條件後建立／作廢／重新開啟（可重複執行）、HR 指定調休日的檢查順序、每日排程的範圍。
// 2026-10 客戶要求後，舊的補假義務（HolidayCompensation，待排 -> 人資排定）改成調休存摺（CompensatoryCredit）：
// 存入後預設保存，由員工發起調休簽核；人資仍可指定日期（HR 指定，協商紀錄必填）。下面的情境沿用舊測試，期待值改成存摺的寫法。
// 調休存摺用記憶體替身（支援這裡用到的查詢、陣列欄位、bulkWrite 與 $inc／$push／$pull），才能驗證第二次同步不會重複寫入。
import { jest } from '@jest/globals';
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js';

const oid = (n) => n.toString(16).padStart(24, '0');
const utc = (key) => new Date(`${key}T00:00:00.000Z`);
const clone = (value) => (value === undefined ? value : structuredClone(value));

/* ---------------------------- 記憶體版查詢 ---------------------------- */
const sameValue = (a, b) => ((a instanceof Date || b instanceof Date) ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b));
const compare = (a, b) => ((a instanceof Date || b instanceof Date) ? new Date(a).getTime() - new Date(b).getTime() : (String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0)));
function matchScalar(value, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((key) => key.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$in') return arg.some((item) => value != null && sameValue(value, item));
      if (op === '$ne') return value == null ? arg != null : !sameValue(value, arg);
      if (op === '$gte') return value != null && compare(value, arg) >= 0;
      if (op === '$lt') return value != null && compare(value, arg) < 0;
      if (op === '$lte') return value != null && compare(value, arg) <= 0;
      if (op === '$gt') return value != null && compare(value, arg) > 0;
      if (op === '$exists') return arg ? value !== undefined : value === undefined;
      throw new Error(`unsupported operator ${op}`);
    });
  }
  if (cond === null) return value == null;
  return value != null && sameValue(value, cond);
}
// 路徑經過陣列時取出每一個元素的值（usages.fullDayDates、usages._id）
function valuesAt(doc, key) {
  let nodes = [doc];
  for (const part of key.split('.')) {
    nodes = nodes.flatMap((node) => {
      const next = node?.[part];
      return Array.isArray(next) ? next : [next];
    });
  }
  return nodes;
}
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((part) => matches(doc, part));
    if (key === '$and') return cond.every((part) => matches(doc, part));
    if (key === '$expr') throw new Error('unsupported $expr');
    const values = valuesAt(doc, key);
    if (cond && typeof cond === 'object' && '$ne' in cond) return values.every((value) => matchScalar(value, cond));
    return values.some((value) => matchScalar(value, cond));
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
function applyUpdate(doc, update, filter = {}) {
  const usageIndex = filter['usages._id'] ? (doc.usages || []).findIndex((usage) => sameValue(usage._id, filter['usages._id'])) : -1;
  for (const [key, value] of Object.entries(update.$set || {})) {
    if (key.startsWith('usages.$.')) doc.usages[usageIndex][key.slice('usages.$.'.length)] = clone(value);
    else doc[key] = clone(value);
  }
  for (const key of Object.keys(update.$unset || {})) delete doc[key];
  for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (Number(doc[key]) || 0) + value;
  for (const [key, value] of Object.entries(update.$push || {})) doc[key] = [...(doc[key] || []), clone(value)];
  for (const [key, cond] of Object.entries(update.$pull || {})) doc[key] = (doc[key] || []).filter((item) => !matches(item, cond));
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
    applyUpdate(doc, update, filter);
    return clone(doc);
  });
  model.create.mockImplementation(async (doc) => clone(insert(doc)));
  model.bulkWrite.mockImplementation(async (ops) => {
    let upsertedCount = 0;
    for (const { updateOne } of ops) {
      const doc = docs.find((item) => matches(item, updateOne.filter));
      if (doc) applyUpdate(doc, updateOne.update, updateOne.filter);
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
const mockGetSettings = jest.fn();

jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/HolidayRestResolution.js', () => ({ default: mockHolidayRestResolution }));
jest.unstable_mockModule('../src/services/approvedLeaveCalendarService.js', () => ({
  loadApprovedLeaveIntervals: mockLoadApprovedLeaveIntervals,
}));
// 假別規則（每筆調休的時數）：沒有存過設定，用預設值 8 小時
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: mockGetSettings }));
const { CalendarYear, HolidaySwap, CompensatoryCredit, CompensatoryLeaveState } = await registerHolidayResolverModelMocks(jest);

const {
  assignHolidayCompensation,
  createManualHolidayCompensation,
  listHolidayCompensations,
  syncHolidayCompensationsForMonths,
  syncRecentHolidayCompensations,
  unassignHolidayCompensation,
} = await import('../src/services/holidayCompensationService.js');
const { buildHolidayRestLedger, describeLedgerItem } = await import('../src/services/holidayRestLedgerService.js');
const { voidCredit } = await import('../src/services/compensatoryLeaveService.js');
const { isNationalHolidayFor, loadHolidayContext } = await import('../src/services/holidayResolver.js');
const { resetLeavePolicyCache } = await import('../src/services/leavePolicyService.js');

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
let credits;
let swaps;

beforeEach(() => {
  jest.clearAllMocks();
  roster = [];
  credits = createStore(CompensatoryCredit, {
    unique: (a, b) => sameValue(a.employee, b.employee) && a.sourceKey === b.sourceKey,
  });
  swaps = createStore(HolidaySwap, {
    unique: (a, b) => a.status === 'active' && b.status === 'active' && sameValue(a.employee, b.employee) && sameValue(a.originalDate, b.originalDate),
  });
  CalendarYear.__setRows([{ year: 2026, state: 'approved' }, { year: 2021, state: 'approved' }]);
  CompensatoryLeaveState.__setRows([]);
  mockGetSettings.mockResolvedValue({});
  resetLeavePolicyCache();
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
const brief = () => credits.map((doc) => ({
  employee: doc.employee, holidayDate: doc.holidayDate.toISOString().slice(0, 10), status: doc.status, reason: doc.reason, voidReason: doc.voidReason, conflict: doc.conflict,
}));
const NOTE = '與員工協商於 10/14 補假';

describe('syncing 調休 credits from the roster', () => {
  it('creates one available 8-hour credit when 國慶日 (Sat) falls on the nurse\'s rostered rest day and no 國 covers it', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-12', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    const result = await syncOctober();
    expect(result).toEqual({ created: 1, voided: 0, reopened: 0, conflicts: 0 });
    expect(brief()).toEqual([{ employee: ID.nurse, holidayDate: '2026-10-10', status: 'available', reason: 'rest_day', voidReason: undefined, conflict: false }]);
    expect(credits[0]).toMatchObject({
      sourceType: 'holiday_rest', sourceKey: 'holiday_rest:2026-10-10', holidayName: '國慶日', hours: 8, usedHours: 0, usages: [],
      earnedDate: utc('2026-10-10'), suggestedDate: utc('2026-10-12'), createdBy: null,
    });
  });

  it('uses the hours per credit of the leave policy', async () => {
    mockGetSettings.mockResolvedValue({ leavePolicy: { compensationHoursPerCredit: 12 } });
    resetLeavePolicyCache();
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    expect(credits[0].hours).toBe(12);
  });

  it('is idempotent: a second sync writes nothing', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    CompensatoryCredit.bulkWrite.mockClear();
    const second = await syncOctober();
    expect(second).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 0 });
    expect(CompensatoryCredit.bulkWrite).not.toHaveBeenCalled();
    expect(credits).toHaveLength(1);
  });

  it('creates nothing when another 國 in the month covers the holiday, when the nurse is unscheduled, or while the roster is a draft', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-15', 'guo'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    expect((await syncOctober()).created).toBe(0);

    roster = [rosterRow(ID.nurse, '2026-10-25', 'guo')];
    expect((await syncOctober()).created).toBe(0);

    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest', 'draft'), rosterRow(ID.nurse, '2026-10-25', 'guo', 'draft')];
    expect((await syncOctober([nurse()], new Date('2026-10-05T04:00:00.000Z'))).created).toBe(0);
    expect(credits).toHaveLength(0);
  });

  it('voids the unused credit once a 國 covers it and reopens it when the 國 is removed again', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();

    roster.push(rosterRow(ID.nurse, '2026-10-15', 'guo'));
    expect(await syncOctober()).toEqual({ created: 0, voided: 1, reopened: 0, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'covered_by_roster' });

    roster = roster.filter((row) => row.date.getTime() !== utc('2026-10-15').getTime());
    expect(await syncOctober()).toEqual({ created: 0, voided: 0, reopened: 1, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'available', voidReason: undefined });
    expect(credits[0].voidedAt).toBeUndefined();
  });

  // 審查發現：人資作廢（例如已改發加倍工資）後，員工打開自己的休假紀錄就觸發同步把額度重新開啟，8 小時又回到存摺
  it('never reopens a credit HR voided by hand while the trigger still holds; the ledger shows it as handled, not 待存入調休', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    const voided = await voidCredit({ id: credits[0]._id, note: '已發加倍工資，不另給調休', actorId: ID.boss, now: AFTER_OCTOBER });
    expect(voided).toMatchObject({ status: 'void', voidReason: 'manual' });

    CompensatoryCredit.bulkWrite.mockClear();
    expect(await syncOctober()).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 0 });
    expect(CompensatoryCredit.bulkWrite).not.toHaveBeenCalled();
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'manual' });
    expect(credits[0].note).toBe('作廢：已發加倍工資，不另給調休');

    // 員工自己看休假紀錄（GET /api/holiday-ledger 會同步）：仍是作廢，格子顯示已處理
    const ledger = await buildHolidayRestLedger({ month: '2026-10', employees: [nurse()], today: AFTER_OCTOBER, syncCompensations: true });
    expect(ledger.sync).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'manual' });
    const item = ledger.employees[0].items.find((entry) => entry.originalDate === '2026-10-10');
    expect(item).toMatchObject({ status: 'not_taken', needsAction: null, compensation: { via: 'bank', creditStatus: 'void', voidReason: 'manual', conflict: false } });
    expect(describeLedgerItem(item)).toBe('調休已作廢（人資）');
    expect(ledger.employees[0].open).toBe(0);
    expect(ledger.summary.compensationOpen).toBe(0);
  });

  it('does not reopen a credit that HR voids by hand between the sync reading it and writing', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    roster.push(rosterRow(ID.nurse, '2026-10-15', 'guo'));
    await syncOctober();
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'covered_by_roster' });

    // 同步讀到的是「班表已排國」作廢的額度，寫入之前人資把它改成人資作廢
    roster = roster.filter((row) => row.date.getTime() !== utc('2026-10-15').getTime());
    const write = CompensatoryCredit.bulkWrite.getMockImplementation();
    CompensatoryCredit.bulkWrite.mockImplementationOnce(async (ops) => {
      credits[0].voidReason = 'manual';
      return write(ops);
    });
    await syncOctober();
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'manual' });
  });

  it('voids an unused credit when the roster turns the 例 into a work shift (the holiday is worked instead), and updates the reason when 休 becomes 例', async () => {
    const regular = { _id: 'regular', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' };
    mockAttendanceSetting.findOne.mockImplementation(() => chain(() => ({ shifts: [...SHIFTS, regular] })));
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    roster[0] = rosterRow(ID.nurse, '2026-10-10', 'regular');
    expect(await syncOctober()).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'available', reason: 'regular_rest' });
    roster[0] = rosterRow(ID.nurse, '2026-10-10', 'day');
    expect(await syncOctober()).toEqual({ created: 0, voided: 1, reopened: 0, conflicts: 0 });
    expect(brief()[0]).toMatchObject({ status: 'void', voidReason: 'roster_changed' });
  });

  it('never voids a used credit (HR 指定): it is flagged as a conflict while the trigger is gone, and cleared again', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    await assignHolidayCompensation({ id: credits[0]._id, assignedDate: '2026-10-14', agreementNote: NOTE, actorId: ID.boss });
    expect(credits[0]).toMatchObject({ status: 'used', usedHours: 8 });
    expect(credits[0].usages[0]).toMatchObject({ kind: 'hr_assigned', hours: 8, fullDayDates: ['2026-10-14'], note: NOTE, by: ID.boss });

    // 班表改成 10/10 排「國」：條件不成立，但已用掉的調休不自動收回
    roster = [rosterRow(ID.nurse, '2026-10-10', 'guo'), rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    expect(await syncOctober()).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 1 });
    expect(brief()[0]).toMatchObject({ status: 'used', conflict: true });
    expect(credits[0].conflictReason).toBe('trigger_gone');

    roster[0] = rosterRow(ID.nurse, '2026-10-10', 'rest');
    await syncOctober();
    expect(brief()[0]).toMatchObject({ status: 'used', conflict: false });
  });

  it('never voids a partly used credit either (a 4-hour 調休 approval)', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    credits[0].usedHours = 4;
    credits[0].usages = [{ _id: oid(0x700), kind: 'leave_request', hours: 4, approvalRequest: oid(0x800), days: [{ date: '2026-11-02', hours: 4 }], fullDayDates: [] }];
    roster.push(rosterRow(ID.nurse, '2026-10-15', 'guo'));
    expect(await syncOctober()).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 1 });
    expect(brief()[0]).toMatchObject({ status: 'available', conflict: true });
  });

  it('gives office staff the government make-up day instead of a credit before the cutover (2026-02-28), but creates one for a weekend holiday without it (2021-05-01)', async () => {
    const february = await syncHolidayCompensationsForMonths({ months: ['2026-02'], employees: [office()], now: AFTER_OCTOBER });
    expect(february.created).toBe(0);

    const may2021 = await syncHolidayCompensationsForMonths({ months: ['2021-05'], employees: [office()], now: AFTER_OCTOBER });
    expect(may2021.created).toBe(1);
    expect(brief()).toEqual([{ employee: ID.office, holidayDate: '2021-05-01', status: 'available', reason: 'office_saturday', voidReason: undefined, conflict: false }]);
    expect(credits[0]).toMatchObject({ suggestedDate: utc('2021-05-03') });
  });

  it('after the cutover, banks 2026-10-25 (Sunday) for office staff with the government make-up day as the suggested date, and keeps 10/9 as an automatic day off', async () => {
    CompensatoryLeaveState.__setRows([{ key: 'bank', officeGovMakeupCutover: '2026-10-23' }]);
    const result = await syncHolidayCompensationsForMonths({ months: ['2026-10'], employees: [office()], now: new Date('2026-10-23T04:00:00.000Z') });
    expect(result.created).toBe(1);
    expect(brief()).toEqual([{ employee: ID.office, holidayDate: '2026-10-25', status: 'available', reason: 'office_sunday', voidReason: undefined, conflict: false }]);
    expect(credits[0]).toMatchObject({ holidayName: '臺灣光復暨金門古寧頭大捷紀念日', suggestedDate: utc('2026-10-26'), hours: 8 });

    // 員工沒有用：10/26 不是他的假日；10/9（切換日之前）照舊是行政人員的補假
    const context = await loadHolidayContext({ start: '2026-10-01', end: '2026-11-01', employees: [office()] });
    expect(isNationalHolidayFor(context, office(), '2026-10-26').holiday).toBe(false);
    expect(isNationalHolidayFor(context, office(), '2026-10-09')).toMatchObject({ holiday: true, reason: 'gov_makeup' });

    const ledger = await buildHolidayRestLedger({ month: '2026-10', employees: [office()], today: new Date('2026-10-23T04:00:00.000Z') });
    const items = ledger.employees[0].items;
    expect(items.find((item) => item.originalDate === '2026-10-10')).toMatchObject({ status: 'compensated', compensation: { via: 'gov_makeup', date: '2026-10-09' } });
    expect(items.find((item) => item.originalDate === '2026-10-25')).toMatchObject({
      status: 'compensated', needsAction: null, compensation: { via: 'bank', creditStatus: 'available', hours: 8, suggestedDate: '2026-10-26' },
    });
    expect(ledger.summary).toMatchObject({ banked: 1, compensationOpen: 0, open: 0 });
  });

  it('voids an unused credit whose holiday is no longer statutory (the calendar was corrected)', async () => {
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

  it('leaves a credit HR added by hand alone', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'guo'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-10', note: '員工 10/10 值班', actorId: ID.boss });
    await syncOctober();
    expect(brief()[0]).toMatchObject({ status: 'available', reason: 'manual_holiday' });
  });
});

describe('HR 指定調休日', () => {
  async function openCredit() {
    roster = [
      rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-13', 'rest'),
      rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo'),
    ];
    await syncOctober();
    return credits[0]._id;
  }
  const codeOf = (promise) => promise.then(() => 'OK', (err) => err.code);

  it('checks the date in order: range, already a holiday, taken, not a workday, not employed', async () => {
    const id = await openCredit();
    const assign = (assignedDate, extra = {}) => assignHolidayCompensation({ id, assignedDate, agreementNote: NOTE, ...extra });
    expect(await codeOf(assign('2027-12-31'))).toBe('OUT_OF_RANGE');
    expect(await codeOf(assign('2026-02-30'))).toBe('OUT_OF_RANGE');
    expect(await codeOf(assign('2026-10-25'))).toBe('ALREADY_HOLIDAY');
    // 2026-10-09 是公務機關補假日：對輪班人員不是假日，可以排
    swaps.push({ _id: oid(0x7001), employee: ID.nurse, originalDate: utc('2026-09-28'), targetDate: utc('2026-10-20'), status: 'active', consent: { method: 'signature', consentedAt: utc('2026-09-01'), evidenceRef: 'A-1' } });
    expect(await codeOf(assign('2026-10-20'))).toBe('DATE_TAKEN');
    expect(await codeOf(assign('2026-10-13'))).toBe('TARGET_NOT_WORKDAY');

    const resignedId = (await CompensatoryCredit.create({
      employee: ID.resigned, sourceType: 'holiday_rest', sourceKey: 'holiday_rest:2026-10-10', reason: 'manual_holiday', holidayDate: utc('2026-10-10'),
      earnedDate: utc('2026-10-10'), hours: 8, usedHours: 0, usages: [], status: 'available',
    }))._id;
    expect(await codeOf(assignHolidayCompensation({ id: resignedId, assignedDate: '2026-10-20', agreementNote: NOTE }))).toBe('NOT_EMPLOYED');
  });

  it('requires an agreement note the first time (HR 指定 always leaves a note on the credit)', async () => {
    const id = await openCredit();
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14' }))).toBe('NOTE_REQUIRED');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14', agreementNote: '   ' }))).toBe('NOTE_REQUIRED');
    expect(credits[0].status).toBe('available');
  });

  it('assigns, and the resolver then reports the day as that employee\'s 補假; unassign returns the hours', async () => {
    const id = await openCredit();
    const saved = await assignHolidayCompensation({ id, assignedDate: '2026-10-14', agreementNote: '協商於 10/14', actorId: ID.boss });
    expect(saved).toMatchObject({ status: 'used', assignedDate: '2026-10-14', holidayDate: '2026-10-10', assignNote: '協商於 10/14', remainingHours: 0, conflict: false, name: '護理甲' });
    expect(saved.usages[0]).toMatchObject({ kind: 'hr_assigned', kindLabel: 'HR 指定', byName: '主管' });

    const context = await loadHolidayContext({ start: '2026-10-14', end: '2026-10-15', employees: [nurse()] });
    expect(isNationalHolidayFor(context, nurse(), '2026-10-14')).toMatchObject({ holiday: true, reason: 'compensation', via: 'hr_assigned', compensatesDate: '2026-10-10' });
    // 已指定的調休改指定同一天不算衝突（協商紀錄沿用）
    expect((await assignHolidayCompensation({ id, assignedDate: '2026-10-14' })).status).toBe('used');
    expect(credits[0].usages).toHaveLength(1);

    const ledger = await buildHolidayRestLedger({ month: '2026-10', employees: [nurse()], today: AFTER_OCTOBER });
    expect(ledger.employees[0].items[0]).toMatchObject({ status: 'compensated', compensation: { date: '2026-10-14', via: 'hr_assigned' } });

    const reopened = await unassignHolidayCompensation({ id });
    expect(reopened).toMatchObject({ status: 'available', assignedDate: null, remainingHours: 8 });
    expect(credits[0]).toMatchObject({ status: 'available', usedHours: 0, usages: [] });
  });

  it('refuses a void credit and a credit the employee already used part of, and asks the authorize callback first', async () => {
    const id = await openCredit();
    const authorize = jest.fn(async () => { throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); });
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14', agreementNote: NOTE, authorize }))).toBe('FORBIDDEN');
    expect(authorize).toHaveBeenCalledWith(ID.nurse);
    credits[0].usedHours = 4;
    credits[0].usages = [{ _id: oid(0x701), kind: 'leave_request', hours: 4, approvalRequest: oid(0x801), days: [], fullDayDates: [] }];
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14', agreementNote: NOTE }))).toBe('CREDIT_PARTIALLY_USED');
    credits[0].status = 'void';
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14', agreementNote: NOTE }))).toBe('COMPENSATION_VOID');
  });

  it('refuses an expired credit when the leave policy sets an expiry', async () => {
    const id = await openCredit();
    mockGetSettings.mockResolvedValue({ leavePolicy: { compensationExpiryMonths: 1 } });
    resetLeavePolicyCache();
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2026-10-14', agreementNote: NOTE, now: new Date('2026-12-01T04:00:00.000Z') }))).toBe('CREDIT_EXPIRED');
  });

  it('refuses an office employee\'s 補假 on a day the company calendar already gives off (Saturday, company rest day), without a roster', async () => {
    // 回歸：行政人員沒有班表，以前只看班表，週六也能排補假，畫面卻顯示「已補假」
    mockHoliday.find.mockImplementation((filter) => chain(() => [
      ...HOLIDAY_ROWS,
      { _id: oid(0x300), date: utc('2021-05-04'), name: '公司休息日', kind: 'company_off', archived: false },
    ].filter((row) => matches(row, filter))));
    await syncHolidayCompensationsForMonths({ months: ['2021-05'], employees: [office()], now: AFTER_OCTOBER });
    const id = credits[0]._id;
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2021-05-08', agreementNote: NOTE }))).toBe('TARGET_NOT_WORKDAY');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2021-05-09', agreementNote: NOTE }))).toBe('TARGET_NOT_WORKDAY');
    expect(await codeOf(assignHolidayCompensation({ id, assignedDate: '2021-05-04', agreementNote: NOTE }))).toBe('TARGET_NOT_WORKDAY');
    expect(credits[0].status).toBe('available');
    expect((await assignHolidayCompensation({ id, assignedDate: '2021-05-03', agreementNote: NOTE })).status).toBe('used');
  });

  it('adds a manual credit only for a statutory day and refuses a duplicate', async () => {
    expect(await codeOf(createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-09' }))).toBe('NOT_STATUTORY');
    const created = await createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-10', note: '值班', actorId: ID.boss });
    expect(created).toMatchObject({ reason: 'manual_holiday', status: 'available', holidayName: '國慶日', hours: 8, sourceText: '2026-10-10 國慶日 人資補登' });
    expect(await codeOf(createManualHolidayCompensation({ employeeId: ID.nurse, holidayDate: '2026-10-10' }))).toBe('DUPLICATE');
  });
});

describe('a used 調休 date that is later rostered as a rest day', () => {
  // 回歸：補假日之後被改排「休」，休假紀錄仍顯示「補假 10/14」、沒有任何提醒，員工等於少休一天
  const october = () => buildHolidayRestLedger({ month: '2026-10', employees: [nurse()], today: AFTER_OCTOBER, syncCompensations: true });

  it('flags the item and the stored credit as a conflict, and clears both once the day is a workday again', async () => {
    roster = [rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-14', 'day'), rosterRow(ID.nurse, '2026-10-25', 'guo')];
    await syncOctober();
    await assignHolidayCompensation({ id: credits[0]._id, assignedDate: '2026-10-14', agreementNote: '協商於 10/14' });

    roster[1] = rosterRow(ID.nurse, '2026-10-14', 'rest');
    const changed = await october();
    const [row] = changed.employees;
    expect(row.items[0]).toMatchObject({
      status: 'compensated',
      compensation: { date: '2026-10-14', via: 'hr_assigned', conflict: true, conflictReason: 'date_not_workday' },
    });
    expect(row.open).toBe(1);
    expect(changed.sync).toEqual({ created: 0, voided: 0, reopened: 0, conflicts: 1 });
    expect(brief()[0]).toMatchObject({ status: 'used', conflict: true });
    expect(credits[0].conflictReason).toBe('date_not_workday');
    // 年度清單的件數也看得到
    expect((await listHolidayCompensations({ employees: PEOPLE, year: 2026 })).summary.conflict).toBe(1);

    roster[1] = rosterRow(ID.nurse, '2026-10-14', 'day');
    const restored = await october();
    expect(restored.employees[0].items[0].compensation).toMatchObject({ conflict: false });
    expect(restored.employees[0].open).toBe(0);
    expect(brief()[0]).toMatchObject({ status: 'used', conflict: false });
  });

  it('reads the roster of a 調休 date in another month and flags it when that day became a rest day', async () => {
    roster = [
      rosterRow(ID.nurse, '2026-10-10', 'rest'), rosterRow(ID.nurse, '2026-10-25', 'guo'),
      rosterRow(ID.nurse, '2026-11-18', 'day'),
    ];
    await syncOctober();
    await assignHolidayCompensation({ id: credits[0]._id, assignedDate: '2026-11-18', agreementNote: NOTE });
    expect((await october()).employees[0].items[0].compensation).toMatchObject({ date: '2026-11-18', conflict: false });

    roster[2] = rosterRow(ID.nurse, '2026-11-18', 'rest');
    mockShiftSchedule.find.mockClear();
    const ledger = await october();
    expect(ledger.employees[0].items[0].compensation).toMatchObject({ date: '2026-11-18', conflict: true, conflictReason: 'date_not_workday' });
    expect(brief()[0]).toMatchObject({ status: 'used', conflict: true });
    // 本月班表之外只多一次查詢：只查那幾天
    const outside = mockShiftSchedule.find.mock.calls.map(([filter]) => filter).filter((filter) => filter.date?.$in);
    expect(outside).toHaveLength(1);
    expect(outside[0].date.$in.map((date) => date.toISOString().slice(0, 10))).toEqual(['2026-11-18']);
  });

  it('flags an office employee\'s 補假 once the company calendar turns that day into a rest day', async () => {
    await syncHolidayCompensationsForMonths({ months: ['2021-05'], employees: [office()], now: AFTER_OCTOBER });
    await assignHolidayCompensation({ id: credits[0]._id, assignedDate: '2021-05-03', agreementNote: NOTE });
    mockHoliday.find.mockImplementation((filter) => chain(() => [
      ...HOLIDAY_ROWS,
      { _id: oid(0x301), date: utc('2021-05-03'), name: '公司休息日', kind: 'company_off', archived: false },
    ].filter((row) => matches(row, filter))));

    const ledger = await buildHolidayRestLedger({ month: '2021-05', employees: [office()], today: AFTER_OCTOBER, syncCompensations: true });
    expect(ledger.employees[0].items[0]).toMatchObject({
      status: 'compensated', compensation: { date: '2021-05-03', conflict: true, conflictReason: 'date_not_workday' },
    });
    expect(brief()[0]).toMatchObject({ employee: ID.office, status: 'used', conflict: true });
  });
});

describe('the year list and the daily job', () => {
  const credit = (employee, holidayKey, extra = {}) => ({
    employee, sourceType: 'holiday_rest', sourceKey: `holiday_rest:${holidayKey}`, reason: 'rest_day', holidayDate: utc(holidayKey), earnedDate: utc(holidayKey),
    hours: 8, usedHours: 0, usages: [], status: 'available', ...extra,
  });

  it('lists the available credits of the year by default, with counts of every status', async () => {
    await CompensatoryCredit.create(credit(ID.nurse, '2026-10-10', { holidayName: '國慶日' }));
    await CompensatoryCredit.create(credit(ID.nurse, '2026-02-28', {
      holidayName: '和平紀念日', status: 'used', usedHours: 8, conflict: true, conflictReason: 'trigger_gone',
      usages: [{ _id: oid(0x702), kind: 'hr_assigned', hours: 8, days: [{ date: '2026-03-02', hours: 8 }], fullDayDates: ['2026-03-02'], note: '協商' }],
    }));
    await CompensatoryCredit.create(credit(ID.office, '2026-04-04', { status: 'void', voidReason: 'covered_by_roster' }));
    await CompensatoryCredit.create(credit(ID.nurse, '2025-12-25'));
    await CompensatoryCredit.create({ ...credit(ID.nurse, '2026-06-01'), sourceType: 'manual', sourceKey: 'manual:1', reason: 'manual', holidayDate: null, note: '加班換休', usedHours: 4 });

    const open = await listHolidayCompensations({ employees: PEOPLE, year: 2026, now: AFTER_OCTOBER });
    expect(open.compensations.map((entry) => [entry.name, entry.earnedDate, entry.status, entry.regime])).toEqual([
      ['護理甲', '2026-06-01', 'partial', 'roster'],
      ['護理甲', '2026-10-10', 'available', 'roster'],
    ]);
    expect(open.compensations[0].sourceText).toBe('人資手動給予：加班換休');
    expect(open.summary).toEqual({ available: 2, used: 1, expired: 0, void: 1, conflict: 1 });
    const all = await listHolidayCompensations({ employees: PEOPLE, year: 2026, status: 'all', now: AFTER_OCTOBER });
    expect(all.compensations.map((entry) => entry.earnedDate)).toEqual(['2026-02-28', '2026-04-04', '2026-06-01', '2026-10-10']);
    expect(all.compensations[0]).toMatchObject({ assignedDate: '2026-03-02', assignNote: '協商', conflict: true, conflictReason: 'trigger_gone' });
    // 權限範圍外的員工看不到
    const scoped = await listHolidayCompensations({ employees: [office()], year: 2026, status: 'all', now: AFTER_OCTOBER });
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

  it('also banks the coming weekend holidays of the year for office staff (they need no roster), only for years with a calendar', async () => {
    CompensatoryLeaveState.__setRows([{ key: 'bank', officeGovMakeupCutover: '2026-10-01' }]);
    // 台灣 2026-09-15：本月與上個月沒有落在週末的國定假日；10/10（週六）、10/25（週日）在之後的月份
    const result = await syncRecentHolidayCompensations({ now: new Date('2026-09-15T04:00:00.000Z') });
    expect(brief().filter((entry) => entry.employee === ID.office).map((entry) => [entry.holidayDate, entry.reason])).toEqual([
      ['2026-10-10', 'office_saturday'],
      ['2026-10-25', 'office_sunday'],
    ]);
    expect(result.created).toBe(2);
    const yearQuery = CalendarYear.find.mock.calls.map(([filter]) => filter).find((filter) => filter?.year?.$in);
    expect(yearQuery.year.$in).toEqual([2026, 2027]);
  });
});
