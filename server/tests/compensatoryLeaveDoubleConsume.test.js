// 調休存摺：同一張簽核單同時被扣用兩次（連點核准、兩個請求同時進來）只能扣一次。
// 2026-11 複查在真的 MongoDB 重現：兩筆 8 小時的額度、一張 8 小時的單同時扣用三次，結果兩筆額度各被扣 8 小時（共 16 小時）——
// 每一筆額度的原子條件只擋「同一筆額度被同一張單扣兩次」，第二個請求在第一筆額度失敗後重新規劃，改扣了下一筆。
// 這裡用記憶體裡的假資料表模擬同樣的交錯（每個資料庫操作之間都會讓出執行權）。
import { jest } from '@jest/globals';

const rows = new Map();
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

function matches(row, filter) {
  if (filter._id !== undefined && String(row._id) !== String(filter._id)) return false;
  if (filter.employee !== undefined && String(row.employee) !== String(filter.employee)) return false;
  if (typeof filter.status === 'string' && row.status !== filter.status) return false;
  if (filter.status?.$ne !== undefined && row.status === filter.status.$ne) return false;
  const usageFilter = filter['usages.approvalRequest'];
  if (usageFilter !== undefined) {
    const used = (row.usages || []).map((usage) => String(usage.approvalRequest));
    if (usageFilter?.$ne !== undefined) {
      if (used.includes(String(usageFilter.$ne))) return false;
    } else if (!used.includes(String(usageFilter))) return false;
  }
  if (filter['usages._id'] !== undefined && !(row.usages || []).some((usage) => String(usage._id) === String(filter['usages._id']))) return false;
  if (filter.$expr?.$lte) {
    // { $lte: [{ $add: [{ $ifNull: ['$usedHours', 0] }, take] }, '$hours'] }
    const take = filter.$expr.$lte[0].$add[1];
    if ((row.usedHours || 0) + take > row.hours) return false;
  }
  if (filter.$expr?.$gte && !((row.usedHours || 0) >= row.hours)) return false;
  return true;
}

function applyUpdate(row, update) {
  for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
  for (const [key, value] of Object.entries(update.$set || {})) row[key] = value;
  if (update.$push?.usages) row.usages.push(clone({ ...update.$push.usages, _id: String(update.$push.usages._id), approvalRequest: String(update.$push.usages.approvalRequest) }));
  if (update.$pull?.usages) row.usages = row.usages.filter((usage) => String(usage._id) !== String(update.$pull.usages._id));
}

const mockCompensatoryCredit = {
  find: jest.fn((filter) => {
    const result = async () => {
      await tick();
      return [...rows.values()].filter((row) => matches(row, filter)).map(clone);
    };
    const chain = { sort: () => chain, lean: result, then: (resolve, reject) => result().then(resolve, reject) };
    return chain;
  }),
  findOneAndUpdate: jest.fn(async (filter, update) => {
    await tick();
    const row = [...rows.values()].find((item) => matches(item, filter));
    if (!row) return null;
    applyUpdate(row, update);
    return clone(row);
  }),
  updateOne: jest.fn(async (filter, update) => {
    await tick();
    const row = [...rows.values()].find((item) => matches(item, filter));
    if (!row) return { modifiedCount: 0 };
    applyUpdate(row, update);
    return { modifiedCount: 1 };
  }),
  updateMany: jest.fn(async () => ({ modifiedCount: 0 })),
};

jest.unstable_mockModule('../src/models/CompensatoryCredit.js', () => ({ default: mockCompensatoryCredit }));
jest.unstable_mockModule('../src/models/CompensatoryLeaveState.js', () => ({ default: {}, COMPENSATORY_LEAVE_STATE_KEY: 'bank' }));
jest.unstable_mockModule('../src/models/HolidayCompensation.js', () => ({ default: {} }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: {} }));
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: async () => ({}) }));

const { consumeCreditsForRequest } = await import('../src/services/compensatoryLeaveService.js');

const credit = (id, earned, hours = 8) => ({
  _id: id, employee: 'emp1', sourceType: 'manual', sourceKey: `manual:${id}`, reason: 'manual',
  earnedDate: `${earned}T00:00:00.000Z`, createdAt: `${earned}T00:00:00.000Z`, hours, usedHours: 0, usages: [], status: 'available',
});
const usedHours = () => [...rows.values()].map((row) => [row._id, row.usedHours, row.usages.length]);
const consume = (requestId, hours) => consumeCreditsForRequest({
  employeeId: 'emp1', requestId, hours, now: new Date('2026-11-10T00:00:00.000Z'),
});

beforeEach(() => {
  rows.clear();
});

describe('同一張簽核單同時扣用調休', () => {
  it('兩筆 8 小時的額度、一張 8 小時的單同時扣用三次：只扣一筆，其餘回報已經扣過', async () => {
    rows.set('first', credit('first', '2026-01-05'));
    rows.set('second', credit('second', '2026-02-05'));

    const results = await Promise.all([consume('req-1', 8), consume('req-1', 8), consume('req-1', 8)]);

    expect(results.map((result) => result.state).sort()).toEqual(['already', 'already', 'consumed']);
    expect(usedHours()).toEqual([['first', 8, 1], ['second', 0, 0]]);
    // 已經扣過的那幾次回報的是同一筆扣用
    results.filter((result) => result.state === 'already').forEach((result) => {
      expect(result.hours).toBe(8);
      expect(result.credits.map((part) => part.creditId)).toEqual(['first']);
    });
  });

  it('只剩一筆額度時，慢一步的那次不會被當成「餘額不足」（這張單其實已經扣好了）', async () => {
    rows.set('only', credit('only', '2026-01-05'));

    const results = await Promise.all([consume('req-2', 8), consume('req-2', 8)]);

    expect(results.map((result) => result.state).sort()).toEqual(['already', 'consumed']);
    expect(usedHours()).toEqual([['only', 8, 1]]);
  });

  it('跨兩筆額度的單（12 小時）同時扣用兩次：合計還是 12 小時', async () => {
    rows.set('first', credit('first', '2026-01-05'));
    rows.set('second', credit('second', '2026-02-05'));
    rows.set('third', credit('third', '2026-03-05'));

    const results = await Promise.all([consume('req-3', 12), consume('req-3', 12)]);

    expect(results.filter((result) => result.state === 'consumed')).toHaveLength(1);
    expect(usedHours()).toEqual([['first', 8, 1], ['second', 4, 1], ['third', 0, 0]]);
  });

  it('兩張不同的單同時扣用：各扣各的；存摺不夠時後到的那張回 409', async () => {
    rows.set('first', credit('first', '2026-01-05'));
    rows.set('second', credit('second', '2026-02-05'));

    const both = await Promise.all([consume('req-a', 8), consume('req-b', 8)]);
    expect(both.map((result) => result.state)).toEqual(['consumed', 'consumed']);
    expect(usedHours()).toEqual([['first', 8, 1], ['second', 8, 1]]);

    await expect(consume('req-c', 4)).rejects.toMatchObject({ status: 409, code: 'COMP_LEAVE_INSUFFICIENT' });
  });
});
