// 國定假日休假紀錄 API：依班表的權限範圍（員工自己、主管直屬部屬、管理員全部）查詢、登記／刪除處理方式、匯出。
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { registerHolidayResolverModelMocks } from './helpers/holidayResolverMocks.js';

const chain = (rows) => {
  const query = {
    select: jest.fn(() => query),
    populate: jest.fn(() => query),
    lean: jest.fn(async () => rows),
  };
  return query;
};

const mockEmployee = { find: jest.fn(), findById: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockDepartment = { findById: jest.fn(), find: jest.fn() };
// 排班人員：小單位的 schedulers（預設沒有任何指派，個別測試再設定）
const mockSubDepartment = { find: jest.fn() };
const mockLoadApprovedLeaveCalendar = jest.fn();
const mockLoadApprovedLeaveIntervals = jest.fn();

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));
jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: mockSubDepartment }));
jest.unstable_mockModule('../src/services/approvedLeaveCalendarService.js', () => ({
  loadApprovedLeaveCalendar: mockLoadApprovedLeaveCalendar,
  loadApprovedLeaveIntervals: mockLoadApprovedLeaveIntervals,
  leaveDaysFromCalendar: jest.fn(() => new Set()),
}));
jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
  isLaborRuleValidationError: jest.fn(() => false),
}));
// 假別規則（調休的時數與期限）：沒有存過設定，用預設值
jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({ getSettings: async () => ({}) }));
// 國定假日判斷（holidayResolver）用到的年度行事曆、補假、個人調移
const resolverMocks = await registerHolidayResolverModelMocks(jest);

const { default: HolidayRestResolution } = await import('../src/models/HolidayRestResolution.js');
const { default: holidayLedgerRoutes } = await import('../src/routes/holidayLedgerRoutes.js');

const oid = (n) => n.toString(16).padStart(24, '0');
const ID = { admin: oid(1), boss: oid(2), nurseA: oid(3), nurseB: oid(4), otherNurse: oid(5), otherBoss: oid(6), dept: oid(100), sub: oid(101), otherSub: oid(102) };
const utc = (key) => new Date(`${key}T00:00:00.000Z`);

const person = (id, name, extra = {}) => ({
  _id: id,
  employeeId: `N-${name}`,
  name,
  title: '護理師',
  subDepartment: { name: '內科' },
  department: ID.dept,
  status: '正職員工',
  ...extra,
});
// unitId：員工所屬小單位的 _id（排班人員範圍的查詢 { subDepartment: { $in } } 用；subDepartment 是 populate 後顯示用的名稱）
const ALL_EMPLOYEES = [
  person(ID.admin, '管理員', { title: '人資' }),
  person(ID.boss, '主管', { supervisor: ID.admin, unitId: ID.sub }),
  person(ID.nurseA, '護理甲', { supervisor: ID.boss, unitId: ID.sub }),
  person(ID.nurseB, '護理乙', { supervisor: ID.boss, partTime: true, unitId: ID.sub }),
  person(ID.otherNurse, '護理丙', { supervisor: ID.otherBoss, unitId: ID.otherSub }),
  person(ID.otherBoss, '他組主管', { supervisor: ID.admin, unitId: ID.otherSub }),
];

const SHIFTS = [
  { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
  { _id: 'guo', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
];
const rowOf = (employee, key, shiftId) => ({ employee, date: utc(key), shiftId, state: 'finalized' });

let currentUser;
let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = currentUser;
    next();
  });
  app.use('/api/holiday-ledger', holidayLedgerRoutes);
});

function loginAs(role, id) {
  currentUser = { id, role };
}

const resolutionStore = [];

beforeEach(() => {
  jest.resetAllMocks();
  resolutionStore.length = 0;
  loginAs('admin', ID.admin);

  mockEmployee.find.mockImplementation((query = {}) => {
    let rows = ALL_EMPLOYEES;
    if (query.supervisor) rows = rows.filter((employee) => employee.supervisor === query.supervisor);
    if (query._id?.$in) rows = rows.filter((employee) => query._id.$in.includes(employee._id));
    if (query.subDepartment?.$in) rows = rows.filter((employee) => query.subDepartment.$in.includes(employee.unitId));
    if (query.department) rows = rows.filter((employee) => employee.department === query.department);
    if (query.$or) rows = rows.filter((employee) => query.$or.some((clause) => Object.entries(clause).every(([key, rx]) => rx.test(employee[key] || ''))));
    return chain(rows);
  });
  mockEmployee.findById.mockImplementation((id) => chain(ALL_EMPLOYEES.find((employee) => employee._id === id) || null));
  mockHoliday.find.mockImplementation((query = {}) => {
    const docs = [
      { date: utc('2026-09-25'), name: '中秋節', type: '國定假日' },
      { date: utc('2026-09-28'), name: '教師節', type: '國定假日' },
      { date: utc('2026-09-12'), name: '補班日', type: '補班日' },
    ];
    if (query.date instanceof Date) return chain(docs.filter((doc) => doc.date.getTime() === query.date.getTime()));
    return chain(docs.filter((doc) => !query.date?.$gte || (doc.date >= query.date.$gte && doc.date < query.date.$lt)));
  });
  mockHolidayMoveSetting.find.mockReturnValue(chain([]));
  mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: SHIFTS }));
  mockDepartment.findById.mockReturnValue(chain({ name: '護理部', unitName: '內科病房' }));
  // 排班權限：預設沒有人被指定為部門的排班管理者或小單位的排班人員
  mockDepartment.find.mockReturnValue(chain([]));
  mockSubDepartment.find.mockReturnValue(chain([]));
  mockLoadApprovedLeaveCalendar.mockResolvedValue(new Map());
  mockLoadApprovedLeaveIntervals.mockResolvedValue(new Map());
  mockShiftSchedule.find.mockImplementation((query) => {
    const ids = query.employee.$in;
    const rows = [
      rowOf(ID.nurseA, '2026-09-25', 'guo'), rowOf(ID.nurseA, '2026-09-20', 'guo'),
      rowOf(ID.nurseB, '2026-09-25', 'day'),
      rowOf(ID.otherNurse, '2026-09-25', 'day'),
      rowOf(ID.boss, '2026-09-25', 'guo'), rowOf(ID.boss, '2026-09-28', 'guo'),
    ];
    return chain(rows.filter((row) => ids.includes(row.employee)));
  });

  jest.spyOn(HolidayRestResolution, 'find').mockImplementation(() => chain(resolutionStore));
  jest.spyOn(HolidayRestResolution, 'findById').mockImplementation((id) => chain(resolutionStore.find((doc) => doc._id === id) || null));
  jest.spyOn(HolidayRestResolution, 'deleteOne').mockResolvedValue({ deletedCount: 1 });
  jest.spyOn(HolidayRestResolution, 'findOneAndUpdate').mockImplementation(async (filter, update) => ({
    _id: oid(900),
    employee: filter.employee,
    holidayDate: filter.holidayDate,
    ...update.$set,
    updatedAt: new Date('2026-10-12T00:00:00.000Z'),
  }));
});

const ledgerRows = (body, month = 0) => body.months[month].employees;
const idsOf = (body) => ledgerRows(body).map((row) => row.employeeId).sort();
const sorted = (...ids) => [...ids].sort();
const url = (query = '') => `/api/holiday-ledger?month=2026-09${query}`;

describe('GET /api/holiday-ledger scope', () => {
  it('lets an administrator see everyone and filters by department, sub department and search', async () => {
    const all = await request(app).get(url());
    expect(all.status).toBe(200);
    expect(idsOf(all.body)).toEqual(sorted(ID.admin, ID.boss, ID.nurseA, ID.nurseB, ID.otherNurse, ID.otherBoss));

    const search = await request(app).get(url('&search=護理甲'));
    expect(idsOf(search.body)).toEqual([ID.nurseA]);

    const dept = await request(app).get(url(`&department=${ID.dept}&subDepartment=${ID.sub}`));
    expect(dept.status).toBe(200);
    expect(mockEmployee.find.mock.calls.at(-1)[0]).toMatchObject({ department: ID.dept, subDepartment: ID.sub });
  });

  it('limits a supervisor to direct reports, adds themselves only with includeSelf, and never shows other teams', async () => {
    loginAs('supervisor', ID.boss);

    const own = await request(app).get(url());
    expect(own.status).toBe(200);
    expect(idsOf(own.body)).toEqual(sorted(ID.nurseA, ID.nurseB));

    const withSelf = await request(app).get(url('&includeSelf=true'));
    expect(idsOf(withSelf.body)).toEqual(sorted(ID.boss, ID.nurseA, ID.nurseB));

    const other = await request(app).get(url(`&employee=${ID.otherNurse}`));
    expect(other.status).toBe(403);

    const report = await request(app).get(url(`&employee=${ID.nurseA}`));
    expect(report.status).toBe(200);
    expect(idsOf(report.body)).toEqual([ID.nurseA]);
  });

  it('lets an employee see only themselves and refuses asking for someone else', async () => {
    loginAs('employee', ID.nurseA);

    const mine = await request(app).get(url('&includeSelf=true'));
    expect(mine.status).toBe(200);
    expect(idsOf(mine.body)).toEqual([ID.nurseA]);

    const someoneElse = await request(app).get(url(`&employee=${ID.nurseB}`));
    expect(someoneElse.status).toBe(403);
    const search = await request(app).get(url('&search=護理乙'));
    expect(idsOf(search.body)).toEqual([]);
  });

  it('refuses an unknown role and an anonymous caller', async () => {
    loginAs('guest', ID.nurseA);
    expect((await request(app).get(url())).status).toBe(403);
    currentUser = undefined;
    expect((await request(app).get(url())).status).toBe(401);
  });
});

describe('GET /api/holiday-ledger content', () => {
  it('returns the holidays, per-employee statuses and a summary', async () => {
    const res = await request(app).get(url(`&employee=${ID.nurseA}`));

    expect(res.status).toBe(200);
    const [month] = res.body.months;
    expect(month.month).toBe('2026-09');
    expect(month.holidays.map((holiday) => [holiday.name, holiday.date])).toEqual([['中秋節', '2026-09-25'], ['教師節', '2026-09-28']]);
    const row = month.employees[0];
    expect(row).toMatchObject({ employeeNo: 'N-護理甲', name: '護理甲', rested: 1, moved: 1, notTaken: 0, open: 0 });
    expect(row.items.map((item) => [item.status, item.guoDate])).toEqual([['rested_on_date', '2026-09-25'], ['moved', '2026-09-20']]);
    expect(res.body.summary).toMatchObject({ employees: 1, holidays: 2, rested: 1, moved: 1, notTaken: 0, open: 0, extra: 0 });
  });

  it('includes part-time employees and flags them, but "unscheduled" is no open item for them', async () => {
    const res = await request(app).get(url(`&employee=${ID.nurseB}`));
    const row = ledgerRows(res.body)[0];
    expect(row.partTime).toBe(true);
    expect(row.items[0]).toMatchObject({ status: 'not_taken', reason: 'worked', needsAction: 'resolve' });
    expect(row.items[1]).toMatchObject({ status: 'not_taken', reason: 'unscheduled', needsAction: null });
    expect(row.notTaken).toBe(2);
    expect(row.open).toBe(1);
  });

  it('status=open keeps only employees with something to handle and recomputes the summary', async () => {
    const res = await request(app).get(url('&status=open'));
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(sorted(ID.nurseB, ID.otherNurse, ID.admin, ID.otherBoss));
    expect(res.body.summary.employees).toBe(4);
    expect(res.body.summary.open).toBe(ledgerRows(res.body).reduce((sum, row) => sum + row.open, 0));
  });

  it('filters by every status the dialog offers, with the same names, and treats anything else as everyone', async () => {
    const all = sorted(ID.admin, ID.boss, ID.nurseA, ID.nurseB, ID.otherNurse, ID.otherBoss);

    const moved = await request(app).get(url('&status=moved'));
    expect(idsOf(moved.body)).toEqual([ID.nurseA]);
    expect(moved.body.summary).toMatchObject({ employees: 1, moved: 1, rested: 1 });

    const notTaken = await request(app).get(url('&status=notTaken'));
    expect(idsOf(notTaken.body)).toEqual(sorted(ID.admin, ID.nurseB, ID.otherNurse, ID.otherBoss));
    expect(notTaken.body.summary.employees).toBe(4);

    const noExtra = await request(app).get(url('&status=extra'));
    expect(idsOf(noExtra.body)).toEqual([]);
    expect(noExtra.body.summary).toMatchObject({ employees: 0, holidays: 2 });

    for (const status of ['all', 'bogus', 'constructor', '']) {
      const res = await request(app).get(url(`&status=${status}`));
      expect(idsOf(res.body)).toEqual(all);
    }
  });

  it('status=extra keeps the employees that have a 國 beyond the number of holidays', async () => {
    mockShiftSchedule.find.mockImplementation((query) => chain([
      rowOf(ID.nurseA, '2026-09-25', 'guo'), rowOf(ID.nurseA, '2026-09-28', 'guo'), rowOf(ID.nurseA, '2026-09-30', 'guo'),
      rowOf(ID.nurseB, '2026-09-25', 'guo'),
    ].filter((row) => query.employee.$in.includes(row.employee))));
    const res = await request(app).get(url('&status=extra'));
    expect(idsOf(res.body)).toEqual([ID.nurseA]);
    expect(res.body.summary.extra).toBe(1);
  });

  it('flags a stored resolution as a conflict once the roster has the 國, and counts it as something to handle', async () => {
    resolutionStore.push({
      _id: oid(800),
      employee: ID.nurseA,
      holidayDate: utc('2026-09-25'),
      month: '2026-09',
      kind: 'paid',
      resolvedBy: ID.boss,
      createdBy: ID.admin,
    });

    const res = await request(app).get(url(`&employee=${ID.nurseA}`));

    const [rested] = ledgerRows(res.body)[0].items;
    expect(rested).toMatchObject({
      status: 'rested_on_date',
      resolutionConflict: true,
      needsAction: null,
      resolution: { id: oid(800), kind: 'paid', resolvedByName: '主管', createdByName: '管理員' },
    });
    expect(ledgerRows(res.body)[0].open).toBe(1);
    const open = await request(app).get(url('&status=open'));
    expect(idsOf(open.body)).toContain(ID.nurseA);
  });

  it('asks the employee data for the role and leaves out administrators and supervisors who have never been on a roster', async () => {
    const withRoles = ALL_EMPLOYEES.map((employee) => (
      [ID.admin, ID.otherBoss].includes(employee._id) ? { ...employee, role: employee._id === ID.admin ? 'admin' : 'supervisor' } : employee
    ));
    const query = chain(withRoles);
    mockEmployee.find.mockImplementation((filter = {}) => (filter._id?.$in ? chain(withRoles.filter((employee) => filter._id.$in.includes(employee._id))) : query));

    const res = await request(app).get(url());

    expect(query.select).toHaveBeenCalledWith(expect.stringMatching(/(^| )role( |$)/));
    expect(idsOf(res.body)).toEqual(sorted(ID.boss, ID.nurseA, ID.nurseB, ID.otherNurse));
    expect(res.body.summary.excluded.notScheduled).toBe(2);
    // 前面幾個月都沒有班表才不列入：只查有可能被跳過的兩個帳號
    const lookup = mockShiftSchedule.find.mock.calls.at(-1)[0];
    expect([...lookup.employee.$in].sort()).toEqual(sorted(ID.admin, ID.otherBoss));
  });

  it('supports a month range and caps it at 12 months', async () => {
    const range = await request(app).get('/api/holiday-ledger?from=2026-08&to=2026-10&employee=' + ID.nurseA);
    expect(range.status).toBe(200);
    expect(range.body.months.map((entry) => entry.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(range.body.months[0].employees).toEqual([]);
    expect(range.body.months[1].employees).toHaveLength(1);

    const tooLong = await request(app).get('/api/holiday-ledger?from=2025-01&to=2026-02');
    expect(tooLong.status).toBe(400);
    const exactlyYear = await request(app).get('/api/holiday-ledger?from=2026-01&to=2026-12&employee=' + ID.nurseA);
    expect(exactlyYear.status).toBe(200);
    expect(exactlyYear.body.months).toHaveLength(12);
  });

  it('rejects bad input with 400', async () => {
    expect((await request(app).get('/api/holiday-ledger')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?month=2026-13')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?month=2026-9')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?from=2026-10&to=2026-09')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?from=2026-10')).status).toBe(400);
    expect((await request(app).get(url('&employee=not-an-id'))).status).toBe(400);
    expect((await request(app).get(url('&department=bad'))).status).toBe(400);
    expect((await request(app).get(url('&subDepartment=bad'))).status).toBe(400);
  });

  it('asks to narrow the scope instead of loading thousands of employees', async () => {
    const many = Array.from({ length: 2001 }, (_, index) => person(oid(5000 + index), `員工${index}`));
    mockEmployee.find.mockReturnValue(chain(many));
    const res = await request(app).get(url());
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('narrow');
  });

  it('answers 500 with a generic message when the ledger cannot be built', async () => {
    mockShiftSchedule.find.mockImplementation(() => { throw new Error('db down'); });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get(url());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('db down');
    errorSpy.mockRestore();
  });
});

describe('POST /api/holiday-ledger/resolutions', () => {
  const body = (extra = {}) => ({ employee: ID.nurseA, holidayDate: '2026-09-25', kind: 'compensatory_leave', ...extra });

  it('records a compensatory leave with 8 hours by default and stores the original holiday date', async () => {
    loginAs('supervisor', ID.boss);
    const res = await request(app).post('/api/holiday-ledger/resolutions').send(body());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ employee: ID.nurseA, holidayDate: '2026-09-25', holidayName: '中秋節', kind: 'compensatory_leave', compensatoryHours: 8 });
    const [filter, update, options] = HolidayRestResolution.findOneAndUpdate.mock.calls[0];
    expect(filter.employee).toBe(ID.nurseA);
    expect(filter.holidayDate.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(update.$set).toMatchObject({ kind: 'compensatory_leave', compensatoryHours: 8, month: '2026-09', resolvedBy: ID.boss, holidayName: '中秋節' });
    expect(update.$unset).toEqual({ restedDate: '' });
    expect(options).toMatchObject({ upsert: true, new: true });
  });

  it('keeps the first author: createdBy is only set when the record is created, resolvedBy is always the latest editor', async () => {
    loginAs('supervisor', ID.boss);
    await request(app).post('/api/holiday-ledger/resolutions').send(body());
    loginAs('admin', ID.admin);
    await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'paid' }));

    const [[, first], [, second]] = HolidayRestResolution.findOneAndUpdate.mock.calls;
    expect(first.$set.resolvedBy).toBe(ID.boss);
    expect(second.$set.resolvedBy).toBe(ID.admin);
    // 寫在 $setOnInsert：資料庫只有在新增時才寫入，第二個人修改時不會蓋掉第一個人
    for (const [update, actor] of [[first, ID.boss], [second, ID.admin]]) {
      expect(update.$setOnInsert).toEqual({ createdBy: actor });
      expect(update.$set).not.toHaveProperty('createdBy');
    }
  });

  it('accepts custom hours, paid, rested later with a date, and waived with a note', async () => {
    const hours = await request(app).post('/api/holiday-ledger/resolutions').send(body({ compensatoryHours: 4 }));
    expect(hours.body.compensatoryHours).toBe(4);

    const paid = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'paid', compensatoryHours: 99 }));
    expect(paid.status).toBe(200);
    expect(HolidayRestResolution.findOneAndUpdate.mock.calls.at(-1)[1].$unset).toEqual({ compensatoryHours: '', restedDate: '' });

    const later = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'rested_later', restedDate: '2026-10-03' }));
    expect(later.status).toBe(200);
    expect(later.body.restedDate).toBe('2026-10-03');

    const waived = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'waived', note: '員工放棄' }));
    expect(waived.status).toBe(200);
    expect(waived.body.note).toBe('員工放棄');
  });

  it('validates the body', async () => {
    const post = (extra) => request(app).post('/api/holiday-ledger/resolutions').send(body(extra));
    expect((await post({ kind: 'cash' })).status).toBe(400);
    expect((await post({ kind: undefined })).status).toBe(400);
    expect((await post({ compensatoryHours: 0 })).status).toBe(400);
    expect((await post({ compensatoryHours: 25 })).status).toBe(400);
    expect((await post({ compensatoryHours: 'abc' })).status).toBe(400);
    expect((await post({ kind: 'rested_later' })).status).toBe(400);
    expect((await post({ kind: 'rested_later', restedDate: '2026-02-30' })).status).toBe(400);
    expect((await post({ kind: 'waived' })).status).toBe(400);
    expect((await post({ kind: 'waived', note: '   ' })).status).toBe(400);
    expect((await post({ note: 'x'.repeat(501) })).status).toBe(400);
    expect((await post({ holidayDate: '2026/09/25' })).status).toBe(400);
    expect((await post({ holidayDate: '2026-02-30' })).status).toBe(400);
    expect((await post({ employee: 'abc' })).status).toBe(400);
    expect((await post({ employee: undefined })).status).toBe(400);
    // 補班日、一般日期不是國定假日
    expect((await post({ holidayDate: '2026-09-12' })).status).toBe(400);
    expect((await post({ holidayDate: '2026-09-13' })).status).toBe(400);
    expect(HolidayRestResolution.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an employee that does not exist', async () => {
    const res = await request(app).post('/api/holiday-ledger/resolutions').send(body({ employee: oid(777) }));
    expect(res.status).toBe(404);
  });

  it('applies the schedule permission scope: a supervisor handles direct reports only, never themselves or other teams', async () => {
    loginAs('supervisor', ID.boss);
    const post = (employee) => request(app).post('/api/holiday-ledger/resolutions').send(body({ employee }));

    expect((await post(ID.nurseB)).status).toBe(200);
    expect((await post(ID.boss)).status).toBe(403);
    expect((await post(ID.otherNurse)).status).toBe(403);

    loginAs('admin', ID.admin);
    expect((await post(ID.otherNurse)).status).toBe(200);
    expect((await post(ID.admin)).status).toBe(200);

    loginAs('employee', ID.nurseA);
    expect((await post(ID.nurseA)).status).toBe(403);
    expect(HolidayRestResolution.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('is idempotent: a second save of the same holiday updates the same document, and a duplicate-key race is retried once', async () => {
    const first = await request(app).post('/api/holiday-ledger/resolutions').send(body());
    const second = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'paid' }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const [firstFilter] = HolidayRestResolution.findOneAndUpdate.mock.calls[0];
    const [secondFilter] = HolidayRestResolution.findOneAndUpdate.mock.calls[1];
    expect(secondFilter.employee).toBe(firstFilter.employee);
    expect(secondFilter.holidayDate.getTime()).toBe(firstFilter.holidayDate.getTime());

    HolidayRestResolution.findOneAndUpdate.mockReset();
    HolidayRestResolution.findOneAndUpdate
      .mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }))
      .mockResolvedValueOnce({ _id: oid(901), employee: ID.nurseA, holidayDate: utc('2026-09-25'), kind: 'paid', month: '2026-09' });
    const raced = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'paid' }));
    expect(raced.status).toBe(200);
    expect(HolidayRestResolution.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('DELETE /api/holiday-ledger/resolutions/:id', () => {
  const stored = (employee) => ({ _id: oid(800), employee, holidayDate: utc('2026-09-25'), kind: 'paid', month: '2026-09' });
  let infoSpy;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('writes one audit line with the ids and the holiday date only, and none when nothing was deleted', async () => {
    resolutionStore.push({ ...stored(ID.nurseA), note: '員工要求折發', holidayName: '中秋節', resolvedBy: ID.boss });
    loginAs('supervisor', ID.boss);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(200);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith('Holiday ledger resolution deleted', {
      actorId: ID.boss,
      employeeId: ID.nurseA,
      holidayDate: '2026-09-25',
    });
    const logged = JSON.stringify(infoSpy.mock.calls);
    for (const personal of ['員工要求折發', '護理甲', '主管']) expect(logged).not.toContain(personal);

    infoSpy.mockClear();
    loginAs('employee', ID.nurseA);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(403);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(801)}`)).status).toBe(403);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('deletes within the permission scope', async () => {
    resolutionStore.push(stored(ID.nurseA));
    loginAs('supervisor', ID.boss);
    const res = await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`);
    expect(res.status).toBe(200);
    expect(HolidayRestResolution.deleteOne).toHaveBeenCalledWith({ _id: oid(800) });
  });

  it('refuses another team, the supervisor themselves and employees; admin may', async () => {
    resolutionStore.push(stored(ID.otherNurse));
    loginAs('supervisor', ID.boss);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(403);

    resolutionStore.length = 0;
    resolutionStore.push(stored(ID.boss));
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(403);

    loginAs('employee', ID.nurseA);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(403);
    expect(HolidayRestResolution.deleteOne).not.toHaveBeenCalled();

    loginAs('admin', ID.admin);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(200);
  });

  it('answers 400 for a bad id and 404 for a missing one', async () => {
    expect((await request(app).delete('/api/holiday-ledger/resolutions/abc')).status).toBe(400);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(801)}`)).status).toBe(404);
  });
});

describe('排班人員 (scheduler of a unit) uses the same scope as the roster', () => {
  // 護理丙（員工角色，屬於另一個小單位）被指定為「內科」小單位（ID.sub）的排班人員
  beforeEach(() => {
    mockSubDepartment.find.mockImplementation((query = {}) => (
      query.schedulers === ID.otherNurse ? chain([{ _id: ID.sub, department: ID.dept }]) : chain([])
    ));
  });

  it('lists the employees of the assigned unit (and themselves) for an employee-role scheduler, never other units', async () => {
    loginAs('employee', ID.otherNurse);
    const res = await request(app).get(url());
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(sorted(ID.boss, ID.nurseA, ID.nurseB, ID.otherNurse));

    expect((await request(app).get(url(`&employee=${ID.nurseA}`))).status).toBe(200);
    expect((await request(app).get(url(`&employee=${ID.otherBoss}`))).status).toBe(403);
  });

  it('lets the scheduler record and delete resolutions inside the unit only, never for themselves', async () => {
    loginAs('employee', ID.otherNurse);
    const post = (employee) => request(app)
      .post('/api/holiday-ledger/resolutions')
      .send({ employee, holidayDate: '2026-09-25', kind: 'paid' });
    expect((await post(ID.nurseA)).status).toBe(200);
    expect((await post(ID.otherBoss)).status).toBe(403);
    expect((await post(ID.otherNurse)).status).toBe(403);

    resolutionStore.push({ _id: oid(800), employee: ID.nurseB, holidayDate: utc('2026-09-25'), kind: 'paid', month: '2026-09' });
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(200);
  });

  it('opens the export to the scheduler, while an employee without an assignment is still refused', async () => {
    loginAs('employee', ID.otherNurse);
    expect((await request(app).get('/api/holiday-ledger/export?month=2026-09')).status).toBe(200);
    loginAs('employee', ID.nurseA);
    expect((await request(app).get('/api/holiday-ledger/export?month=2026-09')).status).toBe(403);
  });
});

describe('GET /api/holiday-ledger/export', () => {
  const download = (query) => request(app)
    .get(`/api/holiday-ledger/export${query}`)
    .buffer(true)
    .parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });

  it('downloads one workbook with the ledger sheet for the requested scope', async () => {
    loginAs('supervisor', ID.boss);
    const res = await download(`?month=2026-09&department=${ID.dept}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('holiday-ledger-202609.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['國定假日休假紀錄']);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toContain('內科病房');
    expect(sheet.getRow(3).values.slice(1, 7)).toEqual(['員工代號', '姓名', '單位', '職稱', '中秋節 09/25', '教師節 09/28']);
    const names = [];
    sheet.eachRow((row, number) => { if (number > 3) names.push(row.getCell(2).value); });
    expect(names.sort()).toEqual(['護理乙', '護理甲'].sort());
  });

  async function exportedNames(query) {
    const res = await download(query);
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    const sheet = workbook.worksheets[0];
    const names = [];
    sheet.eachRow((row, number) => { if (number > 3) names.push(row.getCell(2).value); });
    exportedTitle = sheet.getRow(1).getCell(1).value;
    return names.sort();
  }
  let exportedTitle = '';

  it('exports only what the dialog is filtered to: status and search', async () => {
    loginAs('supervisor', ID.boss);
    // 護理甲都休了；護理乙（兼職）國定假日上班沒休，有一個待處理
    expect(await exportedNames('?month=2026-09')).toEqual(['護理乙', '護理甲'].sort());
    expect(await exportedNames('?month=2026-09&status=open')).toEqual(['護理乙']);
    expect(await exportedNames('?month=2026-09&status=moved')).toEqual(['護理甲']);
    expect(await exportedNames('?month=2026-09&status=notTaken')).toEqual(['護理乙']);
    expect(await exportedNames('?month=2026-09&status=extra')).toEqual([]);
    expect(await exportedNames('?month=2026-09&search=護理甲')).toEqual(['護理甲']);
    expect(await exportedNames('?month=2026-09&status=open&search=護理甲')).toEqual([]);
    expect(await exportedNames('?month=2026-09&status=bogus')).toEqual(['護理乙', '護理甲'].sort());
  });

  it('says in the title that a filtered export is not the full list', async () => {
    loginAs('supervisor', ID.boss);
    await exportedNames('?month=2026-09');
    expect(exportedTitle).toBe('2026年09月 國定假日休假紀錄');
    await exportedNames('?month=2026-09&status=open');
    expect(exportedTitle).toBe('2026年09月 國定假日休假紀錄（僅列出待處理）');
    await exportedNames('?month=2026-09&status=moved&search=護理甲');
    expect(exportedTitle).toBe('2026年09月 國定假日休假紀錄（僅列出移休、搜尋「護理甲」）');
    await exportedNames('?month=2026-09&status=bogus&search=%20%20');
    expect(exportedTitle).toBe('2026年09月 國定假日休假紀錄');
  });

  it('refuses employees and bad months', async () => {
    loginAs('employee', ID.nurseA);
    expect((await download('?month=2026-09')).status).toBe(403);
    loginAs('admin', ID.admin);
    expect((await download('')).status).toBe(400);
    expect((await download('?month=2026-00')).status).toBe(400);
  });
});

describe('resolutions are checked per employee with the holiday resolver', () => {
  it('refuses a resolution on a government make-up day (2026-02-20 is no national holiday for roster staff)', async () => {
    mockHoliday.find.mockImplementation(() => chain([
      { date: utc('2026-02-15'), name: '小年夜', kind: 'statutory' },
      { date: utc('2026-02-20'), name: '補假', kind: 'gov_makeup_off', compensatesDate: utc('2026-02-15') },
    ]));
    const refused = await request(app).post('/api/holiday-ledger/resolutions').send({ employee: ID.nurseA, holidayDate: '2026-02-20', kind: 'paid' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('holidayDate is not a national holiday');
    const accepted = await request(app).post('/api/holiday-ledger/resolutions').send({ employee: ID.nurseA, holidayDate: '2026-02-15', kind: 'paid' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.holidayName).toBe('小年夜');
  });
});

describe('調休 and personal swap endpoints', () => {
  // 國定假日的調休已改存在調休存摺（CompensatoryCredit）
  const compensationRow = (employee, extra = {}) => ({
    _id: oid(700), employee, sourceType: 'holiday_rest', sourceKey: 'holiday_rest:2026-10-10', reason: 'rest_day',
    holidayDate: utc('2026-10-10'), earnedDate: utc('2026-10-10'), holidayName: '國慶日', status: 'available', hours: 8, usedHours: 0, usages: [], ...extra,
  });
  const sortableChain = (rows) => {
    const query = chain(rows);
    query.sort = jest.fn(() => query);
    return query;
  };

  it('lets everyone read the year list within their schedule scope, and only managers write', async () => {
    resolverMocks.CompensatoryCredit.find.mockImplementation((filter) => sortableChain([
      compensationRow(ID.nurseA), compensationRow(ID.otherNurse, { _id: oid(701) }),
    ].filter((doc) => filter.employee.$in.includes(doc.employee))));

    loginAs('employee', ID.nurseA);
    const own = await request(app).get('/api/holiday-ledger/compensations?year=2026');
    expect(own.status).toBe(200);
    expect(own.body.compensations.map((entry) => entry.employeeId)).toEqual([ID.nurseA]);
    expect(own.body.compensations[0]).toMatchObject({ status: 'available', sourceText: '2026-10-10 國慶日 適逢休息日', remainingHours: 8 });
    expect(own.body.summary).toEqual({ available: 1, used: 0, expired: 0, void: 0, conflict: 0 });
    expect((await request(app).post(`/api/holiday-ledger/compensations/${oid(700)}/assign`).send({ assignedDate: '2026-10-14' })).status).toBe(403);
    expect((await request(app).post('/api/holiday-ledger/compensations/sync').send({ from: '2026-10', to: '2026-10' })).status).toBe(403);
    expect((await request(app).post('/api/holiday-ledger/swaps').send({ employee: ID.nurseA })).status).toBe(403);
    expect((await request(app).get('/api/holiday-ledger/swaps')).status).toBe(200);

    loginAs('supervisor', ID.boss);
    const team = await request(app).get('/api/holiday-ledger/compensations?year=2026&status=all');
    expect(team.body.compensations.map((entry) => entry.employeeId)).toEqual([ID.nurseA]);
    expect((await request(app).get('/api/holiday-ledger/compensations?status=bogus')).body.code).toBe('INVALID_STATUS');
  });

  // HR 指定調休日與手動補登調休只有管理員（客戶 2026-10：調休由員工自己發起簽核，人資指定是管理員的動作）
  it('lets only an administrator assign a 調休 date or add a credit by hand: supervisors are refused even for their own team', async () => {
    resolverMocks.CompensatoryCredit.findById.mockImplementation(() => chain(compensationRow(ID.nurseA)));
    loginAs('supervisor', ID.boss);
    const res = await request(app).post(`/api/holiday-ledger/compensations/${oid(700)}/assign`).send({ assignedDate: '2026-10-14', agreementNote: '協商' });
    expect(res.status).toBe(403);
    expect((await request(app).post(`/api/holiday-ledger/compensations/${oid(700)}/unassign`)).status).toBe(403);
    expect((await request(app).post('/api/holiday-ledger/compensations').send({ employee: ID.nurseA, holidayDate: '2026-10-10' })).status).toBe(403);
    expect(resolverMocks.CompensatoryCredit.findOneAndUpdate).not.toHaveBeenCalled();

    loginAs('admin', ID.admin);
    const badId = await request(app).post('/api/holiday-ledger/compensations/not-an-id/assign').send({ assignedDate: '2026-10-14' });
    expect(badId.status).toBe(400);
    expect(badId.body.code).toBe('INVALID_ID');
    const noNote = await request(app).post(`/api/holiday-ledger/compensations/${oid(700)}/assign`).send({ assignedDate: '2026-10-14' });
    expect(noNote.status).toBe(400);
    expect(noNote.body.code).toBe('NOTE_REQUIRED');
  });

  it('answers the validation codes of the swap and sync endpoints', async () => {
    loginAs('supervisor', ID.boss);
    const noConsent = await request(app).post('/api/holiday-ledger/swaps').send({ employee: ID.nurseA, originalDate: '2026-09-28', targetDate: '2026-10-05' });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body).toEqual({ error: '個人調移必須有員工本人的同意紀錄（簽名、同意書或電子紀錄）', code: 'CONSENT_REQUIRED' });
    expect((await request(app).post('/api/holiday-ledger/swaps').send({ employee: ID.otherNurse })).status).toBe(403);
    expect((await request(app).post('/api/holiday-ledger/swaps').send({ employee: 'bad' })).status).toBe(400);

    const badRange = await request(app).post('/api/holiday-ledger/compensations/sync').send({ from: '2026-10', to: '2026-09' });
    expect(badRange.body.code).toBe('INVALID_RANGE');
    const tooLong = await request(app).post('/api/holiday-ledger/compensations/sync').send({ from: '2025-01', to: '2026-02' });
    expect(tooLong.body.code).toBe('RANGE_TOO_LONG');
    const synced = await request(app).post('/api/holiday-ledger/compensations/sync').send({ from: '2026-09', to: '2026-10' });
    expect(synced.status).toBe(200);
    expect(synced.body).toEqual({ months: ['2026-09', '2026-10'], created: 0, voided: 0, reopened: 0, conflicts: 0 });
  });

  it('recomputes in batches of 2000 employees instead of refusing an administrator with more employee records', async () => {
    // 回歸：管理員的員工資料（含離職）超過 2000 筆時，「重新計算 YYYY 年」一律 400，而且沒有縮小範圍的方法
    const many = Array.from({ length: 2300 }, (_, index) => person(oid(5000 + index), `員工${index}`));
    const employeeQueries = [];
    mockEmployee.find.mockImplementation((filter = {}) => {
      employeeQueries.push(filter);
      const after = filter.$and?.[1]?._id?.$gt;
      let limit = Infinity;
      const query = {
        select: jest.fn(() => query),
        populate: jest.fn(() => query),
        sort: jest.fn(() => query),
        limit: jest.fn((value) => { limit = value; return query; }),
        lean: jest.fn(async () => (after ? many.filter((employee) => employee._id > after) : many).slice(0, limit)),
      };
      return query;
    });
    mockShiftSchedule.find.mockImplementation(() => chain([]));

    const res = await request(app).post('/api/holiday-ledger/compensations/sync').send({ from: '2026-09', to: '2026-09' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ months: ['2026-09'], created: 0, voided: 0, reopened: 0, conflicts: 0 });
    expect(employeeQueries).toHaveLength(2);
    expect(employeeQueries[1].$and[1]._id.$gt).toBe(many[1999]._id);
    // 每一批各自推算一次休假紀錄：2000 人與 300 人
    const batchSizes = mockShiftSchedule.find.mock.calls
      .map(([filter]) => filter)
      .filter((filter) => filter.date?.$gte)
      .map((filter) => filter.employee.$in.length);
    expect(batchSizes).toEqual([2000, 300]);
  });

  it('filters the ledger by 調休 and syncs the compensatory leave bank on every GET', async () => {
    mockShiftSchedule.find.mockImplementation((query) => chain([
      rowOf(ID.nurseA, '2026-09-25', 'guo'), { employee: ID.nurseA, date: utc('2026-09-28'), shiftId: 'rest', state: 'finalized' },
    ].filter((row) => query.employee.$in.includes(row.employee))));
    mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: [...SHIFTS, { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }] }));
    resolverMocks.CompensatoryCredit.bulkWrite.mockResolvedValue({ upsertedCount: 1 });

    const res = await request(app).get(url('&status=compensation'));
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([ID.nurseA]);
    expect(ledgerRows(res.body)[0].items[1]).toMatchObject({ reason: 'on_rest_day', needsAction: 'assign_compensation' });
    expect(res.body.summary.compensationOpen).toBe(1);
    expect(res.body.months[0]).not.toHaveProperty('sync');
    const [ops] = resolverMocks.CompensatoryCredit.bulkWrite.mock.calls[0];
    expect(ops.map((op) => [op.updateOne.filter.employee, op.updateOne.filter.sourceKey])).toEqual([[ID.nurseA, 'holiday_rest:2026-09-28']]);
    expect(ops[0].updateOne.update.$setOnInsert).toMatchObject({ status: 'available', hours: 8, reason: 'rest_day' });
  });

  it('counts a banked credit in the 調休 filter and the summary, without anything for HR to handle', async () => {
    mockShiftSchedule.find.mockImplementation((query) => chain([
      rowOf(ID.nurseA, '2026-09-25', 'guo'), { employee: ID.nurseA, date: utc('2026-09-28'), shiftId: 'rest', state: 'finalized' },
    ].filter((row) => query.employee.$in.includes(row.employee))));
    mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: [...SHIFTS, { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' }] }));
    resolverMocks.CompensatoryCredit.find.mockImplementation(() => chain([compensationRow(ID.nurseA, {
      sourceKey: 'holiday_rest:2026-09-28', holidayDate: utc('2026-09-28'), earnedDate: utc('2026-09-28'), holidayName: '教師節',
    })]));

    const res = await request(app).get(url('&status=compensation'));
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([ID.nurseA]);
    expect(ledgerRows(res.body)[0].items[1]).toMatchObject({ status: 'compensated', needsAction: null, compensation: { via: 'bank', creditStatus: 'available' } });
    expect(res.body.summary).toMatchObject({ banked: 1, compensationOpen: 0 });
    expect(resolverMocks.CompensatoryCredit.bulkWrite).not.toHaveBeenCalled();
  });
});
