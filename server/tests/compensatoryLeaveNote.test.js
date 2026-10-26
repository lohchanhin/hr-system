// R4「管理者帳號，可由該員工的人事資料填寫備註」：員工調休（移休）存摺的備註。
// 存在 CompensatoryLeaveState（key = note:<員工 _id>，每位員工一筆）；管理員在員工管理填寫，看得到存摺的人（本人、主管、管理員）唯讀看得到。
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const oid = (n) => n.toString(16).padStart(24, '0');
const ID = { admin: oid(1), boss: oid(2), nurse: oid(3), otherNurse: oid(4) };

const mockCompensatoryCredit = { bulkWrite: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() };
const mockCompensatoryLeaveState = { updateOne: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() };
const mockHolidayCompensation = { find: jest.fn() };
const people = {
  [ID.admin]: { _id: ID.admin, name: '人資小林', employeeId: 'A001' },
  [ID.nurse]: { _id: ID.nurse, name: '護理師小陳', employeeId: 'N001' },
};
const leanQuery = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
const mockEmployee = { find: jest.fn(), findById: jest.fn((id) => leanQuery(people[String(id)] || null)) };

jest.unstable_mockModule('../src/models/CompensatoryCredit.js', () => ({ default: mockCompensatoryCredit }));
jest.unstable_mockModule('../src/models/CompensatoryLeaveState.js', () => ({ default: mockCompensatoryLeaveState, COMPENSATORY_LEAVE_STATE_KEY: 'bank' }));
jest.unstable_mockModule('../src/models/HolidayCompensation.js', () => ({ default: mockHolidayCompensation }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: async () => ({}) }));

const service = await import('../src/services/compensatoryLeaveService.js');

// 記憶體內的 note 文件：updateOne（upsert + $set）、findOne、deleteOne
let stateRows = [];
beforeEach(() => {
  jest.clearAllMocks();
  stateRows = [];
  mockCompensatoryLeaveState.updateOne.mockImplementation(async (filter, update, options) => {
    let row = stateRows.find(item => item.key === filter.key);
    if (!row && options?.upsert) {
      row = { key: filter.key };
      stateRows.push(row);
    }
    if (row) Object.assign(row, update.$set);
    return { acknowledged: true };
  });
  mockCompensatoryLeaveState.findOne.mockImplementation((filter) => leanQuery(stateRows.find(item => item.key === filter.key) || null));
  mockCompensatoryLeaveState.deleteOne.mockImplementation(async (filter) => {
    stateRows = stateRows.filter(item => item.key !== filter.key);
    return { deletedCount: 1 };
  });
});

describe('the bank note (service)', () => {
  it('saves a trimmed note per employee and reads it back with who wrote it and when', async () => {
    const now = new Date('2026-10-26T02:00:00.000Z');
    const saved = await service.saveEmployeeBankNote({ employeeId: ID.nurse, note: '  10/10 國慶日改發加倍工資，不另給移休  ', actorId: ID.admin, now });

    expect(saved).toEqual({ text: '10/10 國慶日改發加倍工資，不另給移休', updatedAt: now, updatedBy: { id: ID.admin, name: '人資小林' } });
    expect(mockCompensatoryLeaveState.updateOne).toHaveBeenCalledWith(
      { key: `note:${ID.nurse}` },
      { $set: { employee: ID.nurse, note: '10/10 國慶日改發加倍工資，不另給移休', noteUpdatedBy: ID.admin, noteUpdatedAt: now } },
      { upsert: true, setDefaultsOnInsert: false },
    );
    expect(await service.getEmployeeBankNote(ID.nurse)).toEqual(saved);
    // 另一位員工沒有備註
    expect(await service.getEmployeeBankNote(ID.otherNurse)).toEqual({ text: '', updatedAt: null, updatedBy: null });
  });

  it('replaces the note on a second save and clears it with a blank one', async () => {
    await service.saveEmployeeBankNote({ employeeId: ID.nurse, note: '第一版', actorId: ID.admin });
    await service.saveEmployeeBankNote({ employeeId: ID.nurse, note: '第二版', actorId: ID.admin });
    expect(stateRows).toHaveLength(1);
    expect((await service.getEmployeeBankNote(ID.nurse)).text).toBe('第二版');

    expect(await service.saveEmployeeBankNote({ employeeId: ID.nurse, note: '   ', actorId: ID.admin })).toEqual({ text: '', updatedAt: null, updatedBy: null });
    expect(stateRows).toHaveLength(0);
  });

  it('retries once when two admins create the first note at the same time', async () => {
    mockCompensatoryLeaveState.updateOne.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    await service.saveEmployeeBankNote({ employeeId: ID.nurse, note: '同時填寫', actorId: ID.admin });
    expect(mockCompensatoryLeaveState.updateOne).toHaveBeenCalledTimes(2);
    expect((await service.getEmployeeBankNote(ID.nurse)).text).toBe('同時填寫');
  });

  it('refuses a bad employee, an unknown employee, a non-text note and a note that is too long, in Chinese', async () => {
    await expect(service.saveEmployeeBankNote({ employeeId: 'nope', note: 'x' })).rejects.toMatchObject({ status: 400, code: 'INVALID_EMPLOYEE' });
    await expect(service.saveEmployeeBankNote({ employeeId: ID.otherNurse, note: 'x' })).rejects.toMatchObject({ status: 404, code: 'EMPLOYEE_NOT_FOUND' });
    await expect(service.saveEmployeeBankNote({ employeeId: ID.nurse, note: { $set: 1 } })).rejects.toMatchObject({ status: 400, code: 'INVALID_NOTE' });
    await expect(service.saveEmployeeBankNote({ employeeId: ID.nurse, note: 'a'.repeat(1001) }))
      .rejects.toMatchObject({ status: 400, code: 'NOTE_TOO_LONG', message: '備註不可超過 1000 個字' });
    expect(mockCompensatoryLeaveState.updateOne).not.toHaveBeenCalled();
  });
});

describe('PUT /api/compensatory-leave/note and the note in the bank', () => {
  let app;
  let currentUser = null;

  beforeAll(async () => {
    // 存摺本身換成替身（存摺規則在 compensatoryLeaveService 的測試），備註用真的服務與上面的記憶體文件
    jest.unstable_mockModule('../src/services/leaveBalanceService.js', () => ({ computeCompLeavePendingHours: async () => 4 }));
    const { default: routes } = await import('../src/routes/compensatoryLeaveRoutes.js');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = currentUser; next(); });
    app.use('/api/compensatory-leave', routes);
  });

  beforeEach(() => {
    mockCompensatoryCredit.find.mockImplementation(() => ({ sort: () => ({ lean: async () => [] }), lean: async () => [] }));
  });

  it('lets only an admin write the note and passes who wrote it', async () => {
    for (const [role, id] of [['employee', ID.nurse], ['supervisor', ID.boss]]) {
      currentUser = { id, role };
      expect((await request(app).put('/api/compensatory-leave/note').send({ employeeId: ID.nurse, note: 'x' })).status).toBe(403);
    }
    expect(mockCompensatoryLeaveState.updateOne).not.toHaveBeenCalled();

    currentUser = { id: ID.admin, role: 'admin' };
    const res = await request(app).put('/api/compensatory-leave/note').send({ employeeId: ID.nurse, note: '移休以天計' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: '移休以天計', updatedBy: { id: ID.admin, name: '人資小林' } });
  });

  it('passes the Chinese validation message through', async () => {
    currentUser = { id: ID.admin, role: 'admin' };
    const res = await request(app).put('/api/compensatory-leave/note').send({ employeeId: ID.nurse, note: 'a'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '備註不可超過 1000 個字', code: 'NOTE_TOO_LONG' });
  });

  it('shows the note read-only to the employee in 我的調休', async () => {
    stateRows = [{ key: `note:${ID.nurse}`, note: '10/10 改發加倍工資', noteUpdatedBy: ID.admin, noteUpdatedAt: new Date('2026-10-26T02:00:00.000Z') }];
    currentUser = { id: ID.nurse, role: 'employee' };
    const res = await request(app).get('/api/compensatory-leave/mine');

    expect(res.status).toBe(200);
    expect(res.body.note).toEqual({ text: '10/10 改發加倍工資', updatedAt: '2026-10-26T02:00:00.000Z', updatedBy: { id: ID.admin, name: '人資小林' } });
    expect(res.body).toHaveProperty('credits');
  });
});
