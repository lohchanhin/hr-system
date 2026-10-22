// 調休存摺（compensatoryLeaveService）：額度的狀態與期限、來源文字、依到期日／取得日先後扣用（可跨好幾筆、扣部分時數）、
// 調休單的每日分布（哪幾天是整天調休），以及部署時的資料轉換（舊的補假義務、員工資料的補休時數；各只做一次）。
// 原子扣用、返還在真實 MongoDB 的端對端測試（compensatoryLeave.integration.test.js）驗證。
import { jest } from '@jest/globals';

const mockCompensatoryCredit = { bulkWrite: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() };
const mockCompensatoryLeaveState = { updateOne: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() };
const mockHolidayCompensation = { find: jest.fn() };
const mockEmployee = { find: jest.fn(), findById: jest.fn() };

jest.unstable_mockModule('../src/models/CompensatoryCredit.js', () => ({ default: mockCompensatoryCredit }));
jest.unstable_mockModule('../src/models/CompensatoryLeaveState.js', () => ({ default: mockCompensatoryLeaveState, COMPENSATORY_LEAVE_STATE_KEY: 'bank' }));
jest.unstable_mockModule('../src/models/HolidayCompensation.js', () => ({ default: mockHolidayCompensation }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: async () => ({}) }));

const service = await import('../src/services/compensatoryLeaveService.js');
const {
  allocateCompLeaveDays,
  creditExpiryKey,
  creditFromLegacyCompensation,
  creditPolicyOf,
  creditView,
  describeCreditSource,
  ensureCompensatoryLeaveState,
  migrateHolidayCompensationsToCredits,
  migrateLegacyCompensatoryHours,
  planConsumption,
  serializeCredit,
  sortCreditsForConsumption,
  summarizeCredits,
} = service;

const utc = (key) => new Date(`${key}T00:00:00.000Z`);
const lean = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
const credit = (id, earned, extra = {}) => ({
  _id: id, employee: 'emp1', sourceType: 'holiday_rest', reason: 'rest_day', holidayDate: utc(earned), holidayName: '國定假日',
  earnedDate: utc(earned), hours: 8, usedHours: 0, usages: [], status: 'available', createdAt: utc(earned), ...extra,
});

describe("a credit's state, expiry and source text", () => {
  it('reads the policy: 8 hours per credit and no expiry by default', () => {
    expect(creditPolicyOf({})).toEqual({ hoursPerCredit: 8, expiryMonths: 0, minUnitHours: 0.5 });
    expect(creditPolicyOf({ compensationHoursPerCredit: 12, compensationExpiryMonths: 6, minUnitHours: 1 })).toEqual({ hoursPerCredit: 12, expiryMonths: 6, minUnitHours: 1 });
  });

  it('tells available, partly used, used, void and (only with an expiry) expired apart', () => {
    const today = '2026-11-01';
    expect(creditView(credit('a', '2026-10-25'), { todayKey: today })).toMatchObject({ status: 'available', remainingHours: 8, expiresOn: null });
    expect(creditView(credit('b', '2026-10-25', { usedHours: 4 }), { todayKey: today })).toMatchObject({ status: 'partial', remainingHours: 4, usedHours: 4 });
    expect(creditView(credit('c', '2026-10-25', { usedHours: 8, status: 'used' }), { todayKey: today })).toMatchObject({ status: 'used', remainingHours: 0 });
    expect(creditView(credit('d', '2026-10-25', { status: 'void' }), { todayKey: today })).toMatchObject({ status: 'void', remainingHours: 0 });
    // 不設期限：多久以前取得的都還能用
    expect(creditView(credit('e', '2020-01-01'), { todayKey: today }).status).toBe('available');
    // 期限 6 個月：2026-04-25 取得的，最後一天是 10/24；過期的剩餘時數不列入餘額
    expect(creditExpiryKey(credit('f', '2026-04-25'), 6)).toBe('2026-10-24');
    expect(creditView(credit('f', '2026-04-25', { usedHours: 2 }), { todayKey: today, expiryMonths: 6 })).toMatchObject({ status: 'expired', remainingHours: 0, expiredHours: 6 });
    // 月底對齊：1/31 + 1 個月 = 2/28，最後一天 2/27
    expect(creditExpiryKey(credit('g', '2026-01-31'), 1)).toBe('2026-02-27');
  });

  it('describes the source: the holiday, its date and why, a manual credit with its note, or the moved 補休 hours', () => {
    expect(describeCreditSource(credit('a', '2026-10-25', { holidayName: '臺灣光復暨金門古寧頭大捷紀念日', reason: 'office_sunday' })))
      .toBe('2026-10-25 臺灣光復暨金門古寧頭大捷紀念日 適逢週日');
    expect(describeCreditSource(credit('b', '2026-10-10', { holidayName: '國慶日', reason: 'regular_rest' }))).toBe('2026-10-10 國慶日 適逢例假');
    expect(describeCreditSource({ sourceType: 'manual', reason: 'manual', note: '加班換休' })).toBe('人資手動給予：加班換休');
    expect(describeCreditSource({ sourceType: 'legacy_balance', reason: 'legacy' })).toBe('轉入既有補休時數');
  });

  it('serializes a credit with its uses and the approval that used it', () => {
    const used = credit('a', '2026-10-25', {
      usedHours: 8, status: 'used',
      usages: [{ _id: 'u1', kind: 'leave_request', hours: 8, approvalRequest: 'req1', days: [{ date: '2026-10-26', hours: 8 }], fullDayDates: ['2026-10-26'], by: 'boss' }],
    });
    const view = serializeCredit(used, { todayKey: '2026-11-01', nameById: new Map([['boss', '主管']]), requestById: new Map([['req1', { status: 'approved' }]]) });
    expect(view).toMatchObject({ id: 'a', status: 'used', statusLabel: '已使用', remainingHours: 0, assignedDate: null });
    expect(view.usages[0]).toMatchObject({ kind: 'leave_request', kindLabel: '調休簽核', approvalRequestId: 'req1', approvalStatus: 'approved', fullDayDates: ['2026-10-26'], byName: '主管' });
  });
});

describe('using the bank: earliest to expire first, then earliest earned, partial hours allowed', () => {
  const today = '2026-12-01';

  it('orders credits by expiry (no expiry last) and then by the day they were earned', () => {
    const credits = [credit('late', '2026-10-25'), credit('early', '2026-02-28'), credit('mid', '2026-10-10')];
    expect(sortCreditsForConsumption(credits).map((item) => item._id)).toEqual(['early', 'mid', 'late']);
  });

  it('splits 12 hours over two credits and leaves the rest of the second one', () => {
    const credits = [credit('second', '2026-10-25'), credit('first', '2026-10-10')];
    const { plan, availableHours, shortHours } = planConsumption(credits, 12, { todayKey: today });
    expect(plan.map((item) => [item.credit._id, item.take])).toEqual([['first', 8], ['second', 4]]);
    expect(availableHours).toBe(16);
    expect(shortHours).toBe(0);
  });

  it('takes 4 + 4 hours from the same credit across two requests', () => {
    const first = planConsumption([credit('a', '2026-10-25')], 4, { todayKey: today });
    expect(first.plan.map((item) => item.take)).toEqual([4]);
    const second = planConsumption([credit('a', '2026-10-25', { usedHours: 4 })], 4, { todayKey: today });
    expect(second.plan.map((item) => item.take)).toEqual([4]);
    expect(second.availableHours).toBe(4);
  });

  it('skips used, void and expired credits and reports what is missing', () => {
    const credits = [
      credit('used', '2026-02-28', { usedHours: 8, status: 'used' }),
      credit('void', '2026-04-04', { status: 'void' }),
      credit('old', '2026-01-01'),
      credit('ok', '2026-10-25', { usedHours: 2 }),
    ];
    const withExpiry = planConsumption(credits, 8, { todayKey: today, expiryMonths: 6 });
    expect(withExpiry.plan.map((item) => [item.credit._id, item.take])).toEqual([['ok', 6]]);
    expect(withExpiry).toMatchObject({ availableHours: 6, shortHours: 2 });
    // 期限較早的先扣
    const both = planConsumption([credit('later', '2026-10-25'), credit('sooner', '2026-09-01')], 8, { todayKey: today, expiryMonths: 6 });
    expect(both.plan[0].credit._id).toBe('sooner');
  });

  it('adds up the bank without void credits and without expired hours', () => {
    const summary = summarizeCredits([
      credit('a', '2026-10-25', { usedHours: 4 }),
      credit('b', '2026-01-01'),
      credit('c', '2026-10-10', { status: 'void' }),
      credit('d', '2026-02-28', { usedHours: 8, status: 'used', conflict: true }),
    ], { todayKey: today, expiryMonths: 6 });
    expect(summary).toEqual({ earnedHours: 24, usedHours: 12, balanceHours: 4, expiredHours: 8, credits: 3, conflicts: 1 });
  });
});

describe('which days of a 調休 request are whole days off', () => {
  const day = (dateKey, hours = 24) => ({ dateKey, hours });

  it('treats an 8-hour 調休 on a workday as a whole day', () => {
    expect(allocateCompLeaveDays({ covered: [day('2026-10-26')], hours: 8 })).toEqual({ days: [{ date: '2026-10-26', hours: 8 }], fullDayDates: ['2026-10-26'] });
  });

  it('treats 4 hours as part of the day (no holiday status)', () => {
    expect(allocateCompLeaveDays({ covered: [day('2026-11-02')], hours: 4 })).toEqual({ days: [{ date: '2026-11-02', hours: 4 }], fullDayDates: [] });
  });

  it('skips the weekend of a Friday-to-Monday request and gives Friday and Monday the whole day', () => {
    const capacity = { '2026-11-06': 8, '2026-11-07': 0, '2026-11-08': 0, '2026-11-09': 8 };
    const result = allocateCompLeaveDays({
      covered: ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map((key) => day(key)), hours: 16, capacityOf: (key) => capacity[key],
    });
    expect(result).toEqual({ days: [{ date: '2026-11-06', hours: 8 }, { date: '2026-11-09', hours: 8 }], fullDayDates: ['2026-11-06', '2026-11-09'] });
  });

  it('needs the whole 12-hour shift of a nurse for a whole day', () => {
    expect(allocateCompLeaveDays({ covered: [day('2026-11-03')], hours: 8, capacityOf: () => 12 }).fullDayDates).toEqual([]);
    expect(allocateCompLeaveDays({ covered: [day('2026-11-03')], hours: 12, capacityOf: () => 12 }).fullDayDates).toEqual(['2026-11-03']);
  });

  it('keeps hours that fit nowhere on the last day without making it whole, and follows the covered hours of a timed request', () => {
    expect(allocateCompLeaveDays({ covered: [day('2026-11-07')], hours: 8, capacityOf: () => 0 })).toEqual({ days: [{ date: '2026-11-07', hours: 8 }], fullDayDates: [] });
    const timed = allocateCompLeaveDays({ covered: [{ dateKey: '2026-11-02', hours: 4 }], hours: 4, allDay: false, capacityOf: () => 8 });
    expect(timed).toEqual({ days: [{ date: '2026-11-02', hours: 4 }], fullDayDates: [] });
  });
});

describe('deployment: old 補假 obligations and the 補休 hours move into the bank once', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCompensatoryLeaveState.updateOne.mockResolvedValue({ acknowledged: true });
    mockCompensatoryCredit.bulkWrite.mockImplementation(async (ops) => ({ upsertedCount: ops.length }));
  });

  it('turns an open obligation into an available credit, an assigned one into a used credit (HR 指定 on the assigned day) and a void one into a void credit', () => {
    const base = { _id: 'hc1', employee: 'emp1', holidayDate: utc('2026-10-10'), holidayName: '國慶日', origin: 'roster_rest_day', dayKindAtDetection: 'rest_day' };
    expect(creditFromLegacyCompensation({ ...base, status: 'open', suggestedDate: utc('2026-10-12') })).toMatchObject({
      sourceType: 'holiday_rest', sourceKey: 'holiday_rest:2026-10-10', reason: 'rest_day', status: 'available', hours: 8, usedHours: 0,
      earnedDate: utc('2026-10-10'), suggestedDate: utc('2026-10-12'), migratedFrom: 'hc1',
    });
    const assigned = creditFromLegacyCompensation({
      ...base, status: 'assigned', assignedDate: utc('2026-10-14'), agreementNote: '協商於 10/14', assignedBy: 'boss', conflict: true,
    });
    expect(assigned).toMatchObject({ status: 'used', usedHours: 8, conflict: true, conflictReason: 'trigger_gone' });
    expect(assigned.usages).toEqual([expect.objectContaining({
      kind: 'hr_assigned', hours: 8, days: [{ date: '2026-10-14', hours: 8 }], fullDayDates: ['2026-10-14'], note: '協商於 10/14', by: 'boss',
    })]);
    expect(creditFromLegacyCompensation({ ...base, status: 'void', voidReason: 'covered_by_roster' })).toMatchObject({ status: 'void', voidReason: 'covered_by_roster' });
    expect(creditFromLegacyCompensation({ ...base, origin: 'office_weekend', status: 'open' }).reason).toBe('office_saturday');
    expect(creditFromLegacyCompensation({ ...base, origin: 'manual', status: 'open' }).reason).toBe('manual_holiday');
    expect(creditFromLegacyCompensation({ ...base, dayKindAtDetection: 'regular_rest', status: 'open' }).reason).toBe('regular_rest');
  });

  it('records the cutover once: the day after the first start (Taipei), never changed afterwards', async () => {
    mockCompensatoryLeaveState.findOne.mockReturnValue(lean({ key: 'bank', officeGovMakeupCutover: '2026-10-23' }));
    const state = await ensureCompensatoryLeaveState({ now: new Date('2026-10-22T17:30:00.000Z') }); // 台灣 10/23 01:30
    expect(state.officeGovMakeupCutover).toBe('2026-10-23');
    const [insert] = mockCompensatoryLeaveState.updateOne.mock.calls[0];
    expect(insert).toEqual({ key: 'bank' });
    expect(mockCompensatoryLeaveState.updateOne.mock.calls[0][1]).toEqual({ $setOnInsert: { key: 'bank', officeGovMakeupCutover: '2026-10-24' } });
    expect(mockCompensatoryLeaveState.updateOne.mock.calls[0][2]).toEqual({ upsert: true });
    // 只補空白的切換日，有值的不改
    expect(mockCompensatoryLeaveState.updateOne.mock.calls[1][0]).toEqual({ key: 'bank', officeGovMakeupCutover: { $in: ['', null] } });
  });

  it('moves every old obligation with an idempotent upsert keyed on employee + holiday, logs counts, and skips once marked', async () => {
    mockCompensatoryLeaveState.findOne.mockReturnValue(lean({ key: 'bank', officeGovMakeupCutover: '2026-10-23' }));
    mockHolidayCompensation.find.mockReturnValue(lean([
      { _id: 'h1', employee: 'emp1', holidayDate: utc('2026-10-10'), status: 'open', origin: 'roster_rest_day' },
      { _id: 'h2', employee: 'emp2', holidayDate: utc('2026-02-28'), status: 'assigned', assignedDate: utc('2026-03-02'), origin: 'roster_rest_day' },
      { _id: 'h3', employee: 'emp3', holidayDate: utc('2026-04-04'), status: 'void', voidReason: 'not_applicable', origin: 'roster_rest_day' },
    ]));
    const result = await migrateHolidayCompensationsToCredits({ now: new Date('2026-10-22T04:00:00.000Z') });
    expect(result).toEqual({ skipped: false, created: 3, open: 1, assigned: 1, void: 1, checked: 3 });
    const [ops] = mockCompensatoryCredit.bulkWrite.mock.calls[0];
    expect(ops.map((op) => op.updateOne.filter)).toEqual([
      { employee: 'emp1', sourceKey: 'holiday_rest:2026-10-10' },
      { employee: 'emp2', sourceKey: 'holiday_rest:2026-02-28' },
      { employee: 'emp3', sourceKey: 'holiday_rest:2026-04-04' },
    ]);
    expect(ops.every((op) => op.updateOne.upsert === true && op.updateOne.update.$setOnInsert && !op.updateOne.update.$set)).toBe(true);
    expect(mockCompensatoryLeaveState.updateOne).toHaveBeenLastCalledWith({ key: 'bank' }, { $set: { compensationsMigratedAt: expect.any(Date) } });

    mockCompensatoryCredit.bulkWrite.mockClear();
    mockCompensatoryLeaveState.findOne.mockReturnValue(lean({ key: 'bank', officeGovMakeupCutover: '2026-10-23', compensationsMigratedAt: new Date() }));
    expect(await migrateHolidayCompensationsToCredits()).toMatchObject({ skipped: true, created: 0 });
    expect(mockCompensatoryCredit.bulkWrite).not.toHaveBeenCalled();
  });

  it('moves the 補休 hours of the employee record into one 「轉入既有補休時數」 credit per employee, once', async () => {
    mockCompensatoryLeaveState.findOne.mockReturnValue(lean({ key: 'bank', officeGovMakeupCutover: '2026-10-23' }));
    mockEmployee.find.mockReturnValue(lean([
      { _id: 'emp1', annualLeave: { compensatoryHours: 6 } },
      { _id: 'emp2', annualLeave: { compensatoryHours: 0 } },
    ]));
    const result = await migrateLegacyCompensatoryHours({ now: new Date('2026-10-22T04:00:00.000Z') });
    expect(result).toEqual({ skipped: false, created: 1, employees: 1 });
    expect(mockEmployee.find).toHaveBeenCalledWith({ 'annualLeave.compensatoryHours': { $gt: 0 } });
    const [ops] = mockCompensatoryCredit.bulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter).toEqual({ employee: 'emp1', sourceKey: 'legacy_balance' });
    expect(ops[0].updateOne.update.$setOnInsert).toMatchObject({
      sourceType: 'legacy_balance', reason: 'legacy', hours: 6, usedHours: 0, status: 'available', note: '轉入既有補休時數', earnedDate: utc('2026-10-22'),
    });

    mockCompensatoryLeaveState.findOne.mockReturnValue(lean({ key: 'bank', legacyHoursMigratedAt: new Date() }));
    mockEmployee.find.mockClear();
    expect(await migrateLegacyCompensatoryHours()).toMatchObject({ skipped: true });
    expect(mockEmployee.find).not.toHaveBeenCalled();
  });

  it('treats a duplicate-key race between two PM2 workers as done', async () => {
    mockCompensatoryLeaveState.findOne.mockReturnValue(lean({ key: 'bank' }));
    mockHolidayCompensation.find.mockReturnValue(lean([{ _id: 'h1', employee: 'emp1', holidayDate: utc('2026-10-10'), status: 'open', origin: 'roster_rest_day' }]));
    mockCompensatoryCredit.bulkWrite.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000, result: { upsertedCount: 0 } }));
    await expect(migrateHolidayCompensationsToCredits()).resolves.toMatchObject({ created: 0, checked: 1 });
  });
});

// 審查發現：兩筆調休申請同時送出時都通過檢查、合計超過存摺，之後兩筆都核准不了。
// 送出調休申請改成先拿這位員工的鎖（CompensatoryLeaveState 的 key 唯一索引），檢查存摺到建立單據之間只處理一筆。
describe('the filing lease: one 調休 filing per employee at a time', () => {
  const { acquireCompLeaveFilingLease } = service;
  // 記憶體版的鎖：key 唯一，鎖住時 upsert 撞到重複鍵（和 MongoDB 一樣）
  function installLeaseStore() {
    const docs = new Map();
    mockCompensatoryLeaveState.findOneAndUpdate.mockImplementation(async (filter, update, options) => {
      const doc = docs.get(filter.key);
      const free = !doc || !doc.leaseUntil || doc.leaseUntil.getTime() <= filter.$or[0].leaseUntil.$lte.getTime();
      if (doc && free) {
        Object.assign(doc, update.$set);
        return { ...doc };
      }
      if (doc || !options?.upsert) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      docs.set(filter.key, { key: filter.key, ...update.$set });
      return { ...docs.get(filter.key) };
    });
    mockCompensatoryLeaveState.deleteOne.mockImplementation(async (filter) => {
      const doc = docs.get(filter.key);
      if (doc && doc.leaseToken === filter.leaseToken) docs.delete(filter.key);
      return { deletedCount: doc ? 1 : 0 };
    });
    return docs;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('takes the lease with an upsert keyed on the employee, and release removes only its own lease, once', async () => {
    const docs = installLeaseStore();
    const lease = await acquireCompLeaveFilingLease({ employeeId: 'emp1' });
    const [filter, update, options] = mockCompensatoryLeaveState.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ key: 'filing:emp1', $or: [{ leaseUntil: { $lte: expect.any(Date) } }, { leaseUntil: null }] });
    expect(update.$set).toEqual({ leaseToken: expect.any(String), leaseUntil: expect.any(Date) });
    expect(update.$set.leaseUntil.getTime()).toBeGreaterThan(Date.now());
    expect(options).toEqual({ upsert: true, new: true });
    expect(docs.has('filing:emp1')).toBe(true);

    await lease.release();
    await lease.release();
    expect(mockCompensatoryLeaveState.deleteOne).toHaveBeenCalledTimes(1);
    expect(mockCompensatoryLeaveState.deleteOne).toHaveBeenCalledWith({ key: 'filing:emp1', leaseToken: update.$set.leaseToken });
    expect(docs.has('filing:emp1')).toBe(false);
  });

  it('makes a second filing of the same employee wait until the first one is done; another employee does not wait', async () => {
    installLeaseStore();
    const order = [];
    const file = async (employeeId, label) => {
      const lease = await acquireCompLeaveFilingLease({ employeeId, pollMs: 1 });
      order.push(`${label} start`);
      await new Promise((resolve) => { setTimeout(resolve, 15); });
      order.push(`${label} end`);
      await lease.release();
    };
    await Promise.all([file('emp1', 'A'), file('emp1', 'B'), file('emp2', 'C')]);
    expect(order.indexOf('B start')).toBeGreaterThan(order.indexOf('A end'));
    expect(order.indexOf('C start')).toBeLessThan(order.indexOf('A end'));
  });

  it('takes over a lease that expired (the process stopped without releasing it)', async () => {
    const docs = installLeaseStore();
    docs.set('filing:emp1', { key: 'filing:emp1', leaseToken: 'stale', leaseUntil: new Date(Date.now() - 1000) });
    const lease = await acquireCompLeaveFilingLease({ employeeId: 'emp1', waitMs: 0 });
    expect(docs.get('filing:emp1').leaseToken).not.toBe('stale');
    await lease.release();
    expect(docs.has('filing:emp1')).toBe(false);
  });

  it('gives up with 409 COMP_LEAVE_FILING_BUSY after waiting, and passes other database errors on', async () => {
    const docs = installLeaseStore();
    docs.set('filing:emp1', { key: 'filing:emp1', leaseToken: 'other', leaseUntil: new Date(Date.now() + 60000) });
    await expect(acquireCompLeaveFilingLease({ employeeId: 'emp1', waitMs: 20, pollMs: 5 }))
      .rejects.toMatchObject({ status: 409, code: 'COMP_LEAVE_FILING_BUSY', message: '另一筆調休申請正在送出，請稍後再試' });
    expect(mockCompensatoryLeaveState.findOneAndUpdate.mock.calls.length).toBeGreaterThan(1);

    mockCompensatoryLeaveState.findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error('network'), { name: 'MongoNetworkError' }));
    await expect(acquireCompLeaveFilingLease({ employeeId: 'emp2' })).rejects.toThrow('network');
  });
});
